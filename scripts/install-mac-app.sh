#!/usr/bin/env bash
#
# Install Vamp for Mac (owner/apps, the VampMac target) into /Applications,
# so Vamp starts from its icon instead of `npm run ipad` (ADR-490). Builds the
# Release configuration, copies the app over any earlier copy, and records
# this checkout as the one it runs: an app opened from the Dock has no
# working directory to find the repo from.
#
# Run it once by hand; after that the app keeps itself current: at startup it
# compares its code's fingerprint (scripts/mac-app-fingerprint.sh) with the
# one recorded here, and if they differ runs this with VAMP_SELF_UPDATE=1 and
# relaunches. Interface and server changes need no reinstall: the app runs
# `npm run ipad`, which rebuilds them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_DIR="$ROOT/owner/apps"
DEST="/Applications/Vamp.app"
# Where it was installed until 2026-10-30, out of sight of Finder's
# Applications: moved out of the way on the next install.
OLD_DEST="$HOME/Applications/Vamp.app"
BUNDLE_ID="com.benjuodvalkis.vamp.mac"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "❌ Vamp for Mac needs Xcode to build."
  exit 1
fi
if [[ ! -w /Applications ]]; then
  echo "❌ /Applications is not writable by this account (it takes an admin account)."
  exit 1
fi

echo "🔨 building Vamp for Mac (Release)…"
xcodebuild build -project "$APPS_DIR/Vamp.xcodeproj" -scheme VampMac \
  -configuration Release -destination "generic/platform=macOS" \
  -derivedDataPath "$APPS_DIR/build" -quiet

# A running copy keeps its old code until it quits. Quit it as the menu does,
# not with a signal: quitting is what stops the Vamp it started. Not when the
# app itself asked for this (VAMP_SELF_UPDATE=1): it waits, then relaunches.
was_running=0
if [[ -z "${VAMP_SELF_UPDATE:-}" ]] && pgrep -f "Applications/Vamp.app/Contents/MacOS/Vamp" >/dev/null; then
  was_running=1
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "Applications/Vamp.app/Contents/MacOS/Vamp" >/dev/null || break
    sleep 0.5
  done
fi

BUILT="$APPS_DIR/build/Build/Products/Release/Vamp.app"
rm -rf "$DEST"
ditto "$BUILT" "$DEST"
if [[ -d "$OLD_DEST" ]]; then
  rm -rf "$OLD_DEST"
  echo "🧹 removed the earlier copy in ~/Applications"
fi

defaults write "$BUNDLE_ID" repoRoot "$ROOT"
defaults write "$BUNDLE_ID" sourceFingerprint "$(bash "$ROOT/scripts/mac-app-fingerprint.sh")"

echo "✅ installed $DEST"
echo "   It runs this checkout: $ROOT"
echo "   Open it from Launchpad or Finder's Applications; drag it to the Dock to keep it there."
if [[ $was_running -eq 1 ]]; then
  open "$DEST"
  echo "   It was running: reopened the new copy, which starts Vamp again."
fi
