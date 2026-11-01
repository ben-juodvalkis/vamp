#!/usr/bin/env bash
#
# Sparkle, Vamp for Mac's updater (installer.plan.md Phase 4), as its
# release's prebuilt framework and tools, into owner/apps/Vendor/Sparkle/
# (gitignored). Xcode's Swift package fetch of it stalled here twice
# (2026-11-01), so the app links the framework from this folder instead.
# Pinned to one release and its SHA-256, taken when it was first fetched over
# HTTPS from Sparkle's GitHub release. Does nothing when it is already there.
set -euo pipefail

VERSION="2.10.1"
SHA256="1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/owner/apps/Vendor/Sparkle"

if [[ -f "$DEST/VERSION" && "$(cat "$DEST/VERSION")" == "$VERSION" ]]; then exit 0; fi
echo "⬇️  Sparkle $VERSION…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz" -o "$TMP/sparkle.tar.xz"
echo "$SHA256  $TMP/sparkle.tar.xz" | shasum -a 256 -c - >/dev/null
rm -rf "$DEST"
mkdir -p "$DEST"
tar -xJf "$TMP/sparkle.tar.xz" -C "$DEST" Sparkle.framework bin LICENSE
echo "$VERSION" > "$DEST/VERSION"
