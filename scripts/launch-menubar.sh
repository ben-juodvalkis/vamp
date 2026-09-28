#!/usr/bin/env bash
#
# Launch the macOS menu-bar utility (owner/menubar) alongside `npm run dev` /
# `npm run ipad`. It's a standalone SwiftUI MenuBarExtra app that talks to the
# bridge over WebSocket — see owner/menubar/README.md.
#
# This is a best-effort launcher: if the machine has no Swift toolchain, or
# isn't macOS, it prints one line and idles (see skip() below) so it never
# breaks the dev run and never churns under concurrently's restart policy.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT/owner/menubar/LoopingMenuBar"

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

# Needs a Swift toolchain (Xcode or Command Line Tools).
if ! command -v swift >/dev/null 2>&1; then
  skip "no swift toolchain — install Xcode CLT to enable"
fi

if [[ ! -d "$PKG_DIR" ]]; then
  skip "package not found at $PKG_DIR"
fi

# Point the app at this repo's constants.json regardless of CWD.
export LOOPING_PROJECT_ROOT="$ROOT"

# Singleton: when concurrently tears down a dev run it kills `swift run`, but
# the app binary that `swift run` spawned survives as an orphan — repeated
# `npm run dev`/`ipad` starts were observed piling up six identical menu-bar
# icons, all connected to the bridge. Reap any existing instance before
# launching ours. `-x` matches the exact process name (the app binary), so it
# can't hit this script, concurrently, or the swift toolchain.
pkill -x LoopingMenuBar 2>/dev/null || true

echo "📎 building + launching menu bar (first build can take ~30s)…"
# `swift run` in the package dir builds if needed then launches the agent.
# Suppress the Dock icon is handled in-app (setActivationPolicy(.accessory)).
cd "$PKG_DIR"
exec swift run
