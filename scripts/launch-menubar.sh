#!/usr/bin/env bash
#
# Launch Vamp for Mac (owner/apps, the VampMac target) alongside `npm run dev`
# / `npm run ipad`: the menu-bar app that mirrors the session toggles over the
# bridge's WebSocket (owner/apps/Mac/Menu/README.md) and carries Vamp for
# iPad's link over the USB cable.
#
# This is a best-effort launcher: if the machine has no Xcode, or
# isn't macOS, it prints one line and idles (see skip() below) so it never
# breaks the dev run and never churns under concurrently's restart policy.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_DIR="$ROOT/owner/apps"
APP_BIN="$APPS_DIR/build/Build/Products/Debug/Vamp.app/Contents/MacOS/Vamp"

# The owner's app (general-release plan.md §4): only while features.menubar
# is on, in this Mac's config/constants.local.json. Off, it exits at once
# rather than idling like skip() below: `npm run dev` restarts nothing that
# exits, and `npm run ipad` checks the switch before it launches this.
if ! node -e 'process.exit(require(process.argv[1]).readFeatureFlags(require(process.argv[2]).loadConstants()).menubar ? 0 : 1)' \
    "$ROOT/interface/bridge/utils/features.js" "$ROOT/interface/bridge/utils/constants.js"; then
  echo "🔕 menu bar not launched (features.menubar is off)"
  exit 0
fi

# Idle forever without churning: under `npm run ipad` this script runs beneath
# `concurrently --restart-tries -1 --restart-after 1500`, which respawns any
# process that exits. A bare `exit 0` in the skip cases would spin a tight
# restart loop, so we park instead.
skip() {
  echo "🔕 menu bar skipped ($1)"
  # `tail -f /dev/null` blocks cheaply until concurrently tears us down.
  exec tail -f /dev/null
}

# macOS only — MenuBarExtra is an AppKit/SwiftUI construct.
if [[ "$(uname -s)" != "Darwin" ]]; then
  skip "not macOS"
fi

# Needs Xcode itself (the Command Line Tools alone have no xcodebuild that
# builds app targets).
if ! xcodebuild -version >/dev/null 2>&1; then
  skip "no Xcode — install it to enable"
fi

if [[ ! -d "$APPS_DIR/Vamp.xcodeproj" ]]; then
  skip "project not found at $APPS_DIR"
fi

# Point the app at this repo's constants.json regardless of CWD.
export LOOPING_PROJECT_ROOT="$ROOT"

# Singleton: a dev run torn down by concurrently can leave the app behind as
# an orphan, and repeated starts once piled up six identical menu-bar icons.
# Reap any existing instance first: the old SwiftPM menu-bar app by its exact
# name, and Vamp for Mac by its binary's path. Not `pkill -x Vamp`: the iPad
# app in the Simulator is a process named Vamp too.
pkill -x LoopingMenuBar 2>/dev/null || true
pkill -f "Vamp.app/Contents/MacOS/Vamp" 2>/dev/null || true

echo "📎 building + launching Vamp for Mac (a first build takes ~30s)…"
# Incremental: a few seconds when nothing changed.
if ! xcodebuild build -project "$APPS_DIR/Vamp.xcodeproj" -scheme VampMac \
     -configuration Debug -destination "generic/platform=macOS" \
     -derivedDataPath "$APPS_DIR/build" -quiet; then
  skip "Vamp for Mac did not build"
fi
exec "$APP_BIN"
