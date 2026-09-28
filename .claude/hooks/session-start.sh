#!/bin/sh
# SessionStart hook: make a Claude Code on the web container able to run the
# pre-push gate (scripts/gate.sh) before the first push needs it.
#
# Does nothing outside the web (CLAUDE_CODE_REMOTE unset or not "true"): on
# the Mac the tools, node_modules and the surface venv already exist, and a
# session start must not run npm install there.
#
# Synchronous on purpose, so the session starts with the gate runnable, and
# idempotent: npm install and uv pip install are no-ops when satisfied, and
# the venv is created only when missing.

[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0

set -e
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# The root install covers both workspaces (interface, bridge). Not
# `npm run setup`: it links the surface into Live, which only a Mac has.
echo "session-start: npm install"
npm install --no-audit --no-fund --silent

# uv drives the surface venv and the AX helper's tests.
if ! command -v uv >/dev/null 2>&1; then
    echo "session-start: installing uv"
    python3 -m pip install --quiet --user uv 2>/dev/null \
        || python3 -m pip install --quiet --break-system-packages uv
    PATH="$HOME/.local/bin:$PATH"; export PATH
fi

# lsof: scripts/cleanup.sh lists nothing without it, and vitest's
# cleanupScoping.test.ts fails. Installed only where apt and root are both
# available.
if ! command -v lsof >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 \
    && [ "$(id -u)" -eq 0 ]; then
    echo "session-start: installing lsof"
    apt-get install -y -qq lsof >/dev/null 2>&1 \
        || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq lsof >/dev/null 2>&1; } \
        || echo "session-start: lsof install failed; cleanupScoping.test.ts will fail"
fi

echo "session-start: surface venv"
cd surface
[ -x .venv/bin/python3 ] || uv venv --quiet .venv
uv pip install --quiet --python .venv/bin/python3 -r requirements-dev.txt

echo "session-start: ready (npm run gate runs the pre-push gate)"
