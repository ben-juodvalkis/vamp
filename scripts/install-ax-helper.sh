#!/usr/bin/env bash
#
# Install the Looping AX Helper (ADR-439): build its launcher, assemble and sign
# `~/Applications/Looping AX Helper.app`, and load its LaunchAgent.
#
#   npm run install-ax-helper                  build + install + (re)start
#   npm run install-ax-helper -- --status      agent state + the last log lines
#   npm run install-ax-helper -- --uninstall   stop the agent, remove app + plist
#
# macOS Accessibility trusts the app, not this repo or the terminal you run this
# from. The first start shows the system prompt; the switch in System Settings >
# Privacy & Security > Accessibility is yours to flip, and this script never
# touches it. A reinstall keeps the grant while the signing identity stays the
# same: the first "Apple Development" certificate in the keychain is used
# (override with LOOPING_AX_SIGN_IDENTITY). Ad-hoc signing changes the identity
# on every build, so each reinstall would need a fresh grant.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="$ROOT/owner/ax-helper"
LOADER="$ROOT/interface/bridge/utils/constants.js"

# From the config with this Mac's constants.local.json laid over it: the
# owner's bundle id is the owner's (general-release plan.md §3).
read_constant() {
  node -e 'const c = require(process.argv[1]).loadConstants().axHelper || {};
    if (c[process.argv[2]] === undefined) process.exit(1);
    console.log(c[process.argv[2]]);' "$LOADER" "$1" \
    || { echo "the config has no axHelper.$1" >&2; exit 1; }
}

APP_NAME="$(read_constant appName)"
BUNDLE_ID="$(read_constant bundleId)"
LABEL="$BUNDLE_ID"
APP_DIR="$HOME/Applications/$APP_NAME.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_FILE="$ROOT/logs/ax-helper.log"
DOMAIN="gui/$(id -u)"
UV="$(command -v uv || true)"
if [[ -z "$UV" && -x "$HOME/.local/bin/uv" ]]; then UV="$HOME/.local/bin/uv"; fi

status() {
  echo "app:   $APP_DIR $([[ -d "$APP_DIR" ]] && echo '(installed)' || echo '(missing)')"
  echo "agent: $PLIST $([[ -f "$PLIST" ]] && echo '(present)' || echo '(missing)')"
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E '^[[:space:]]*(state|pid|last exit code) =' \
    || echo "       not loaded"
  if [[ -f "$LOG_FILE" ]]; then
    echo "log:   $LOG_FILE"
    tail -n 8 "$LOG_FILE"
  fi
}

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$APP_DIR"
  echo "Removed the agent and the app. Its Accessibility entry stays in System Settings until you remove it there."
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --uninstall) uninstall; exit 0 ;;
  "") ;;
  *) echo "usage: install-ax-helper.sh [--status|--uninstall]" >&2; exit 64 ;;
esac

[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS only" >&2; exit 1; }
[[ -n "$UV" ]] || { echo "uv not found: https://docs.astral.sh/uv/" >&2; exit 1; }
command -v swiftc >/dev/null || { echo "swiftc not found: install the Xcode Command Line Tools" >&2; exit 1; }

echo "-> syncing the helper's Python environment"
"$UV" sync --frozen --no-dev --project "$HELPER_DIR"

BUILD="$HELPER_DIR/build"
STAGE="$BUILD/$APP_NAME.app"
rm -rf "$BUILD"
mkdir -p "$STAGE/Contents/MacOS"

echo "-> compiling the launcher"
swiftc -O -o "$STAGE/Contents/MacOS/$APP_NAME" "$HELPER_DIR/launcher/main.swift"

INFO="$STAGE/Contents/Info.plist"
cat > "$INFO" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>
EOF
plutil -insert CFBundleIdentifier -string "$BUNDLE_ID" "$INFO"
plutil -insert CFBundleName -string "$APP_NAME" "$INFO"
plutil -insert CFBundleDisplayName -string "$APP_NAME" "$INFO"
plutil -insert CFBundleExecutable -string "$APP_NAME" "$INFO"
plutil -insert LoopingUvPath -string "$UV" "$INFO"
plutil -insert LoopingHelperProject -string "$HELPER_DIR" "$INFO"
plutil -lint "$INFO" >/dev/null

IDENTITY="${LOOPING_AX_SIGN_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -nE 's/^[[:space:]]*[0-9]+\) ([0-9A-F]{40}) "Apple Development: .*"$/\1/p' | head -n 1)"
fi
if [[ -z "$IDENTITY" ]]; then
  echo "!! no Apple Development identity: signing ad-hoc, so every reinstall needs a fresh Accessibility grant"
  IDENTITY="-"
fi
echo "-> signing ($IDENTITY)"
codesign --force --sign "$IDENTITY" --identifier "$BUNDLE_ID" --timestamp=none "$STAGE"
codesign --verify --strict "$STAGE"

echo "-> installing $APP_DIR"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents" "$(dirname "$LOG_FILE")"
rm -rf "$APP_DIR"
ditto "$STAGE" "$APP_DIR"
rm -rf "$BUILD"

xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml "$LABEL")</string>
  <key>ProgramArguments</key>
  <array><string>$(xml "$APP_DIR/Contents/MacOS/$APP_NAME")</string></array>
  <key>AssociatedBundleIdentifiers</key>
  <array><string>$(xml "$BUNDLE_ID")</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$(xml "$LOG_FILE")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_FILE")</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

echo "-> loading the LaunchAgent"
launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 3
status
echo
echo "If the log says trusted=False: System Settings > Privacy & Security > Accessibility,"
echo "switch on \"$APP_NAME\". The helper notices within a few seconds; no restart needed."

# The bridge dials the helper only while the axHelper switch is on.
if ! node -e 'process.exit(require(process.argv[1]).loadConstants().features?.axHelper === true ? 0 : 1)' "$LOADER"; then
  echo
  echo "The bridge won't use it yet: the axHelper switch is off. Turn it on in"
  echo "config/constants.local.json (\"features\": { \"axHelper\": true }), then restart npm run dev."
fi
