#!/usr/bin/env bash
#
# Vamp for Mac with everything inside it (installer.plan.md Phases 3–4):
# the app, the standalone server (`npm run build:server`) in
# Contents/Resources/vamp, a universal Node 22 LTS in Contents/Resources/node,
# and the control surface and Vamp Devices that first launch copies into
# place (Contents/Resources/surface, Contents/Resources/Vamp Devices). Opened on a Mac with no checkout, it runs that
# server with that Node. Writes dist/Vamp.app; installs nothing.
#
#   bash scripts/package-mac-app.sh               ad-hoc signed, for a local try
#   SIGN_IDENTITY="Developer ID Application: …" bash scripts/package-mac-app.sh
#
# Node comes from nodejs.org once, checked against its SHASUMS256.txt, into
# scripts/.cache/node/ (gitignored); later runs reuse it. NODE_VERSION picks
# the release (default: the newest 22.x).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_DIR="$ROOT/owner/apps"
OUT="$ROOT/dist/Vamp.app"
CACHE="$ROOT/scripts/.cache/node"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
# Sparkle's public key (scripts/release-mac.sh passes it); empty, the app
# never checks for updates.
SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY:-}"
# A Developer ID signature carries Apple's secure timestamp; ad hoc has none.
if [[ "$SIGN_IDENTITY" == "-" ]]; then TS="--timestamp=none"; else TS="--timestamp"; fi

# --- Node, both chips, joined ------------------------------------------------
if [[ -z "${NODE_VERSION:-}" ]]; then
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(v=>v.version.startsWith("v22."));console.log(r.version)})')"
fi
NODE_DIR="$CACHE/$NODE_VERSION"
if [[ ! -x "$NODE_DIR/universal/bin/node" ]]; then
  echo "⬇️  Node $NODE_VERSION (arm64 and x64) from nodejs.org…"
  mkdir -p "$NODE_DIR"
  base="https://nodejs.org/dist/$NODE_VERSION"
  curl -fsSL "$base/SHASUMS256.txt" -o "$NODE_DIR/SHASUMS256.txt"
  for arch in arm64 x64; do
    tarball="node-$NODE_VERSION-darwin-$arch.tar.gz"
    curl -fsSL "$base/$tarball" -o "$NODE_DIR/$tarball"
    (cd "$NODE_DIR" && grep " $tarball\$" SHASUMS256.txt | shasum -a 256 -c -)
    mkdir -p "$NODE_DIR/$arch"
    tar -xzf "$NODE_DIR/$tarball" -C "$NODE_DIR/$arch" --strip-components 1
  done
  mkdir -p "$NODE_DIR/universal/bin"
  lipo -create "$NODE_DIR/arm64/bin/node" "$NODE_DIR/x64/bin/node" -output "$NODE_DIR/universal/bin/node"
  cp "$NODE_DIR/arm64/LICENSE" "$NODE_DIR/universal/LICENSE"
fi

# --- the server and the app --------------------------------------------------
npm run --prefix "$ROOT" build:server

bash "$ROOT/scripts/fetch-sparkle.sh"
echo "🔨 building Vamp for Mac (Release)…"
xcodebuild build -project "$APPS_DIR/Vamp.xcodeproj" -scheme VampMac \
  -configuration Release -destination "generic/platform=macOS" \
  -derivedDataPath "$APPS_DIR/build/package" -quiet \
  SPARKLE_PUBLIC_KEY="$SPARKLE_PUBLIC_KEY"

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
ditto "$APPS_DIR/build/package/Build/Products/Release/Vamp.app" "$OUT"
ditto "$ROOT/dist/vamp" "$OUT/Contents/Resources/vamp"
mkdir -p "$OUT/Contents/Resources/node/bin"
cp "$NODE_DIR/universal/bin/node" "$OUT/Contents/Resources/node/bin/node"
cp "$NODE_DIR/universal/LICENSE" "$OUT/Contents/Resources/node/LICENSE"
# What first launch copies into place (FirstLaunch.swift): the control surface
# without its tests and venv, and Vamp Devices.
rsync -a --exclude .venv --exclude tests --exclude __pycache__ --exclude '*.pyc' \
  --exclude pytest.ini --exclude requirements-dev.txt --exclude install.sh --exclude '*.md' \
  "$ROOT/surface/" "$OUT/Contents/Resources/surface/"
# Without Finder's metadata, which codesign refuses: Live stamps a type code
# on a device it saves, and Finder leaves .DS_Store.
ditto --norsrc --noextattr --noqtn "$ROOT/Vamp Devices" "$OUT/Contents/Resources/Vamp Devices"
find "$OUT/Contents/Resources" -name .DS_Store -delete

# --- signing: the inside first, then the app around it -----------------------
codesign --force --options runtime $TS \
  --entitlements "$APPS_DIR/Config/node.entitlements" \
  --sign "$SIGN_IDENTITY" "$OUT/Contents/Resources/node/bin/node"
# Sparkle's helpers, innermost first, as Sparkle's own docs sign them; the
# downloader keeps its entitlements.
SPK="$OUT/Contents/Frameworks/Sparkle.framework"
if [[ -d "$SPK" ]]; then
  codesign -f -s "$SIGN_IDENTITY" -o runtime $TS "$SPK/Versions/B/XPCServices/Installer.xpc"
  codesign -f -s "$SIGN_IDENTITY" -o runtime $TS --preserve-metadata=entitlements "$SPK/Versions/B/XPCServices/Downloader.xpc"
  codesign -f -s "$SIGN_IDENTITY" -o runtime $TS "$SPK/Versions/B/Autoupdate"
  codesign -f -s "$SIGN_IDENTITY" -o runtime $TS "$SPK/Versions/B/Updater.app"
  codesign -f -s "$SIGN_IDENTITY" -o runtime $TS "$SPK"
fi
codesign --force --options runtime $TS \
  --entitlements "$APPS_DIR/Config/mac.entitlements" \
  --sign "$SIGN_IDENTITY" "$OUT"
codesign --verify --deep --strict "$OUT"

echo "✅ $OUT ($(du -sh "$OUT" | cut -f1), Node $NODE_VERSION, $(lipo -archs "$OUT/Contents/Resources/node/bin/node"))"
