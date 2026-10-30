#!/usr/bin/env bash
#
# The fingerprint of Vamp for Mac's own code: one hash over every file it is
# built from (owner/apps: Mac/, Shared/, project.yml, Config/Base.xcconfig).
# install-mac-app.sh records it in the app's defaults when it installs; the
# app recomputes it at startup and, if they differ, rebuilds and replaces
# itself before starting Vamp (ADR-490). Interface and server changes are not
# in it: npm run ipad's own fingerprint gate rebuilds those.
set -euo pipefail

APPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../owner/apps" && pwd)"
cd "$APPS_DIR"
find Mac Shared project.yml Config/Base.xcconfig -type f ! -name '.DS_Store' -print0 \
  | LC_ALL=C sort -z \
  | xargs -0 shasum -a 256 \
  | shasum -a 256 \
  | cut -d' ' -f1
