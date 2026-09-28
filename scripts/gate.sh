#!/bin/sh
# The gate. `git push` runs it (.githooks/pre-push); `npm run gate` runs it by
# hand. It tests the working tree, so commit what you mean to push.
#
# Five steps, all at once (~40 s on the Mac, the length of vitest):
#   types    svelte-check (`npm run check`). The only step that type-checks:
#            vite build and vitest strip types, which is how 6c9db850 shipped
#            a crash svelte-check was reporting.
#   vitest   the interface suite; it also runs ESLint's no-undef over the
#            bridge (bridgeLintGate.test.ts).
#   surface  the Python control surface's pytest.
#   ax       the AX helper's pytest (its own uv env; see package.json).
#   build    the production build `npm run ipad` serves.
#
# svelte-check, vitest and the build each rewrite SvelteKit's generated files
# when they start, so after one shared sync each gets its own outDir
# (LOOPING_KIT_OUT_DIR, read by interface/svelte.config.js).

set -e
cd "$(git rev-parse --show-toplevel)"

( cd interface && npm exec --no -- svelte-kit sync ) >/dev/null

LOGS=$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX")
trap 'rm -rf "$LOGS"' EXIT

# step <name> <command...>: run in the background, output to a log.
step() {
    name=$1; shift
    ( if "$@" >"$LOGS/$name.log" 2>&1; then echo 0; else echo 1; fi >"$LOGS/$name.rc" ) &
}

step types   sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-check npm run check --silent -- --threshold error'
step vitest  sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-vitest npm run test:run --silent'
step surface sh -c 'cd surface && { [ -x .venv/bin/python3 ] && PY=.venv/bin/python3 || PY=python3; } && "$PY" -m pytest -q'
step ax      npm run test:ax-helper --silent
step build   sh -c 'LOOPING_KIT_OUT_DIR=.svelte-kit/gate-build npm run build --silent'
wait

FAILED=""
for name in types vitest surface ax build; do
    if [ "$(cat "$LOGS/$name.rc" 2>/dev/null)" = 0 ]; then
        echo "gate: $name ok"
    else
        FAILED="$FAILED $name"
        echo "gate: $name FAILED:"
        sed 's/^/    /' "$LOGS/$name.log"
    fi
done
[ -z "$FAILED" ] || { echo "gate: failed:$FAILED"; exit 1; }

# The steps saw the working tree. Say so when it holds more than HEAD: a file
# left out of the commit passed here and is missing from what was pushed.
if [ -n "$(git status --porcelain)" ]; then
    echo "gate: note: uncommitted changes were tested too (git status)"
fi
echo "gate: ok"
