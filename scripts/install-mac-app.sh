#!/usr/bin/env bash
#
# Install Vamp for Mac (owner/apps, the VampMac target) into ~/Applications,
# so Vamp starts from its icon instead of `npm run ipad` (ADR-490). Builds the
# Release configuration, copies the app over any earlier copy, and records
# this checkout as the one it runs: an app opened from the Dock has no
# working directory to find the repo from.
#
# Re-run after pulling changes to the app itself. Interface and server
# changes need no reinstall: the app runs `npm run ipad`, which rebuilds them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_DIR="$ROOT/owner/apps"
DEST="$HOME/Applications/Vamp.app"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "❌ Vamp for Mac needs Xcode to build."
  exit 1
fi

echo "🔨 building Vamp for Mac (Release)…"
xcodebuild build -project "$APPS_DIR/Vamp.xcodeproj" -scheme VampMac \
  -configuration Release -destination "generic/platform=macOS" \
  -derivedDataPath "$APPS_DIR/build" -quiet

BUILT="$APPS_DIR/build/Build/Products/Release/Vamp.app"
mkdir -p "$HOME/Applications"
# A running copy keeps its old code until it quits.
pkill -f "$DEST/Contents/MacOS/Vamp" 2>/dev/null || true
rm -rf "$DEST"
ditto "$BUILT" "$DEST"

defaults write com.benjuodvalkis.vamp.mac repoRoot "$ROOT"

echo "✅ installed $DEST"
echo "   It runs this checkout: $ROOT"
echo "   Open it from Launchpad or Finder; drag it to the Dock to keep it there."
