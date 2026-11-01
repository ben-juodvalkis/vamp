#!/usr/bin/env bash
#
# Vamp.dmg for the public (installer.plan.md Phase 5): the packaged app
# (scripts/package-mac-app.sh) signed with this Mac's Developer ID, in a dmg
# with an Applications link, notarized by Apple and stapled, plus the
# Sparkle appcast that announces it. Writes dist/Vamp-<version>.dmg, the same
# file as dist/Vamp.dmg, and dist/appcast.xml; publishes nothing. Uploading
# all three to a GitHub release tagged v<version> is what ships it: the app's
# feed is the latest release's appcast.xml, and the site and the README link
# to the latest release's Vamp.dmg, a name that never changes.
#
#   bash scripts/release-mac.sh
#
# Needs, all on this Mac:
#   - a "Developer ID Application" certificate in the keychain
#   - owner/apps/fastlane/.env with ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
#     (the App Store Connect key the iPad lanes use; notarytool takes it too)
#   - Sparkle's signing key: an Ed25519 key in
#     ~/Library/Application Support/Vamp Release/sparkle_ed25519.key (0600,
#     outside the repo), made on the first run. Sparkle's own generate_keys
#     keeps it in the keychain instead, and waits on a keychain prompt that
#     nobody may be there to answer (2026-11-01). Lose it and installed
#     copies can never update again: back it up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_DIR="$ROOT/owner/apps"
DIST="$ROOT/dist"
REPO_URL="https://github.com/ben-juodvalkis/vamp"

IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
[[ -n "$IDENTITY" ]] || { echo "❌ No Developer ID Application certificate in the keychain."; exit 1; }

set -a
# shellcheck disable=SC1091
source "$APPS_DIR/fastlane/.env"
set +a
for v in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do
  [[ -n "${!v:-}" ]] || { echo "❌ $v is missing from owner/apps/fastlane/.env"; exit 1; }
done
ASC_KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"

# Sparkle's tools come with its framework (scripts/fetch-sparkle.sh).
bash "$ROOT/scripts/fetch-sparkle.sh"
SPARKLE_BIN="$APPS_DIR/Vendor/Sparkle/bin"
KEY_DIR="$HOME/Library/Application Support/Vamp Release"
KEY_FILE="$KEY_DIR/sparkle_ed25519.key"
PEM="$KEY_DIR/sparkle_ed25519.pem"
if [[ ! -f "$PEM" ]]; then
  mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
  (umask 077 && openssl genpkey -algorithm ed25519 -out "$PEM")
  echo "🔑 made Sparkle's signing key in $KEY_DIR: back it up"
fi
# Sparkle's form of the key: the private seed and the public key, base64.
(umask 077 && openssl pkey -in "$PEM" -outform DER | tail -c 32 | base64 > "$KEY_FILE")
SPARKLE_PUBLIC_KEY="$(openssl pkey -in "$PEM" -pubout -outform DER | tail -c 32 | base64)"

SIGN_IDENTITY="$IDENTITY" SPARKLE_PUBLIC_KEY="$SPARKLE_PUBLIC_KEY" bash "$ROOT/scripts/package-mac-app.sh"
APP="$DIST/Vamp.app"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$APP/Contents/Info.plist")"
DMG="$DIST/Vamp-$VERSION.dmg"

echo "💿 $DMG…"
STAGE="$(mktemp -d)"
ditto "$APP" "$STAGE/Vamp.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Vamp" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" -quiet
rm -rf "$STAGE"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

echo "🍎 notarizing (Apple usually answers in a few minutes)…"
xcrun notarytool submit "$DMG" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"

# The appcast: one item, this release, EdDSA-signed.
SIG="$("$SPARKLE_BIN/sign_update" --ed-key-file "$KEY_FILE" "$DMG")"
cat > "$DIST/appcast.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Vamp</title>
    <link>$REPO_URL</link>
    <item>
      <title>Vamp $VERSION</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$BUILD</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <enclosure url="$REPO_URL/releases/download/v$VERSION/Vamp-$VERSION.dmg" $SIG type="application/octet-stream"/>
    </item>
  </channel>
</rss>
EOF

cp "$DMG" "$DIST/Vamp.dmg"

echo "✅ $DMG (notarized, stapled), $DIST/Vamp.dmg and $DIST/appcast.xml"
echo "   To ship: a GitHub release tagged v$VERSION with all three attached."
