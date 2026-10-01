#!/bin/sh
# The gate. `git push` runs it (.githooks/pre-push); `npm run gate` runs it by
# hand. It tests the working tree, so commit what you mean to push.
#
# Six steps, at once (~40 s on the Mac when all run, the length of vitest):
#   types    svelte-check. The only step that type-checks: vite build and
#            vitest strip types, which is how 6c9db850 shipped a crash
#            svelte-check was reporting. A push runs `npm run check`
#            (--incremental --tsgo: a disk cache and the native TypeScript
#            preview, ~4 s where tsc takes ~20); a full run, CI's included,
#            runs `npm run check:full`, plain tsc, so the preview is never
#            the only judge for long.
#   vitest   the interface suite; it also runs ESLint's no-undef over the
#            bridge (bridgeLintGate.test.ts).
#   surface  the Python control surface's pytest.
#   ax       the AX helper's pytest (its own uv env; see package.json).
#   build    the production build `npm run ipad` serves.
#   serve    starts that build (vite preview, a free port) and asks for `/`:
#            a 200 carrying SvelteKit's page, or it fails. b08414b fixed a 500
#            on every page load that only the production bundle had, past a
#            green build and a green vitest.
#
# svelte-check, vitest and the build each rewrite SvelteKit's generated files
# when they start, so after one shared sync each gets its own outDir
# (LOOPING_KIT_OUT_DIR, read by interface/svelte.config.js).
#
# What runs. Every narrowing below errs toward running: this hook is what
# stops a broken push. CI (.github/workflows/gate.yml) runs this script with
# GATE_ALL=1 after each push, which catches a narrowing that was wrong only
# afterwards.
#   - A push runs the steps its changed files reach (classify, below). The
#     hook hands git's pre-push lines (`<local ref> <local sha> <remote ref>
#     <remote sha>`) on stdin; the changed files are each pushed range plus
#     whatever is uncommitted, since the steps see the working tree. A
#     docs-only push runs a NUL-byte check and nothing else.
#   - A step that already passed on exactly the files it reads is skipped
#     (cached): the push that was rejected because origin moved, pulled and
#     pushed again re-runs only what the pull changed.
#   - vitest runs only the test files related to the changed interface
#     sources (`vitest related`, Vite's import graph), plus every test that
#     reads the disk or spawns a process, which the import graph cannot see.
#     It runs whole when a deleted file, config or anything outside
#     interface/src/ is in play.
#   - Everything runs, uncached and whole, by hand (`npm run gate`), under
#     GATE_ALL=1, and on the first push after a day without a full pass, so a
#     suite that broke with no change of its own (a Node, Python or uv update)
#     shows up within a day. A new test that reads files in another tree
#     belongs in classify.
#   - GATE_PLAN=1 prints the plan and runs nothing.
# State (the last full pass, each step's last passing input) is under
# .git/gate/, per clone; deleting it costs one full run.

set -e
cd "$(git rev-parse --show-toplevel)"
# Paths as written, not C-quoted, so classify sees the real name.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

ALL_STEPS="types vitest surface ax build serve"
STATE=$(git rev-parse --git-path gate)
mkdir -p "$STATE"

LOGS=$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX")
trap 'rm -rf "$LOGS"' EXIT
CHANGED="$LOGS/changed"
DELETED="$LOGS/deleted"
: >"$CHANGED"
: >"$DELETED"

has() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }

# classify <path>: CLS = the steps whose tests can read that file. Ordered:
# the first match wins.
classify() {
    case $1 in
        # The AX helper's own pytest; nothing else imports it.
        owner/ax-helper/*) CLS="ax" ;;
        # userLibraryDetection.test.ts reads the installer.
        surface/install.sh) CLS="surface vitest" ;;
        surface/*) CLS="surface" ;;
        # Tests are not in the bundle: nothing to build or serve.
        interface/src/__tests__/*) CLS="types vitest" ;;
        # test_key_detect.py checks the surface's scales against this list.
        interface/src/lib/data/scales.ts) CLS="types vitest build serve surface" ;;
        interface/src/*) CLS="types vitest build serve" ;;
        # Read by no test (sourceBytes' NUL walk aside, covered below).
        *.md|docs/*|LICENSE) CLS="" ;;
        # The screenshot rig: it makes PNGs, and no test imports or reads it.
        scripts/shot/*) CLS="" ;;
        interface/*) CLS="types vitest build serve" ;;
        # config/, scripts/, data/, the rest of owner/, package files, the
        # hook and this script: read across suites, so everything.
        *) CLS=$ALL_STEPS ;;
    esac
}

# --- Why this run, and what changed ------------------------------------------

STAMP="$STATE/last-full"
FULL=""
if [ -n "$GATE_ALL" ]; then
    FULL="GATE_ALL=1"
elif [ -z "$GATE_FROM_HOOK" ]; then
    FULL="run by hand"
elif [ -z "$(find "$STAMP" -mmin -1440 2>/dev/null)" ]; then
    FULL="the daily full run (no full pass in the last 24 h)"
else
    while read -r _lref lsha _rref rsha; do
        [ -n "$lsha" ] || continue
        case $lsha in *[!0]*) ;; *) continue ;; esac          # a branch deletion
        case $rsha in
            *[!0]*) base=$rsha ;;
            *) base=$(git merge-base "$lsha" origin/main 2>/dev/null) || { FULL="no base to diff against"; break; } ;;
        esac
        git cat-file -e "$base^{commit}" 2>/dev/null || { FULL="no base to diff against"; break; }
        git diff --no-renames --name-only "$base" "$lsha" >>"$CHANGED" || { FULL="no base to diff against"; break; }
        git diff --no-renames --name-only --diff-filter=D "$base" "$lsha" >>"$DELETED"
    done
    if [ -z "$FULL" ]; then
        git diff --no-renames --name-only HEAD >>"$CHANGED"
        git diff --no-renames --name-only --diff-filter=D HEAD >>"$DELETED"
        git ls-files --others --exclude-standard >>"$CHANGED"
    fi
fi

# --- Which steps the changes reach -------------------------------------------

STEPS=""
want() { for s in "$@"; do has "$STEPS" "$s" || STEPS="$STEPS $s"; done; }
if [ -n "$FULL" ]; then
    want $ALL_STEPS
else
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        classify "$f"
        want $CLS
    done <"$CHANGED"
fi

# --- Each step's input, for the cache -----------------------------------------

# key_snapshot <dir>: <dir>/<step> = one line per file that step reads (its
# content hash and path), taken from the working tree through a scratch index
# so nothing in the real index moves.
key_snapshot() {
    dir=$1; mkdir -p "$dir"
    for s in $ALL_STEPS; do : >"$dir/$s"; done
    cp "$(git rev-parse --git-path index)" "$LOGS/index" 2>/dev/null || true
    GIT_INDEX_FILE="$LOGS/index" git add -A >/dev/null 2>&1
    GIT_INDEX_FILE="$LOGS/index" git ls-files -s | while IFS= read -r line; do
        path=${line#*	}
        classify "$path"
        for s in $CLS; do echo "$line" >>"$dir/$s"; done
    done
    for s in $ALL_STEPS; do git hash-object "$dir/$s" >"$dir/$s.key"; done
}
key_snapshot "$LOGS/before"

CACHED=""
RUN=""
for s in $STEPS; do
    if [ -z "$FULL" ] && [ "$(cat "$STATE/$s.pass" 2>/dev/null)" = "$(cat "$LOGS/before/$s.key")" ]; then
        CACHED="$CACHED $s"
    else
        RUN="$RUN $s"
    fi
done
# serve reads the build's output, which is the last build run, whatever its
# input: a serve that runs needs a build that runs.
if has "$RUN" serve && ! has "$RUN" build; then RUN="$RUN build"; CACHED=$(echo "$CACHED" | sed 's/ build//'); fi

SKIPPED=""
for s in $ALL_STEPS; do has "$STEPS" "$s" || has "$RUN" "$s" || SKIPPED="$SKIPPED $s"; done

# --- vitest: related tests, or the whole suite --------------------------------

VITEST_RELATED=""
if has "$RUN" vitest && [ -z "$FULL" ]; then
    VITEST_RELATED=yes
    : >"$LOGS/related"
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        classify "$f"
        has "$CLS" vitest || continue
        case $f in
            interface/src/__tests__/setup.ts) VITEST_RELATED=""; break ;;
            *" "*) VITEST_RELATED=""; break ;;
            interface/src/*) echo "${f#interface/}" >>"$LOGS/related" ;;
            *) VITEST_RELATED=""; break ;;
        esac
    done <"$CHANGED"
    grep -q '^interface/' "$DELETED" && VITEST_RELATED=""
fi
if [ -n "$VITEST_RELATED" ]; then
    # Tests that touch the disk or spawn a process: the import graph does not
    # see what they read, so they always run.
    ( cd interface && grep -rlE "node:fs|from 'fs'|node:child_process|createRequire|require\(" src --include='*.test.*' --include='*.spec.*' ) >>"$LOGS/related" || true
    VITEST_ARGS=$(sort -u "$LOGS/related" | tr '\n' ' ')
fi

# --- NUL bytes, when vitest's sourceBytes.test.ts is not running ---------------

if ! has "$RUN" vitest; then
    NUL=""
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        case $f in
            *.ts|*.js|*.mjs|*.cjs|*.svelte|*.py|*.md|*.json|*.css|*.html|*.sh|*.yml|*.yaml|*.txt) ;;
            *) continue ;;
        esac
        LC_ALL=C tr -d '\000' <"$f" | cmp -s - "$f" || NUL="$NUL $f"
    done <"$CHANGED"
    if [ -n "$NUL" ]; then echo "gate: raw NUL byte in:$NUL"; exit 1; fi
fi

# --- Say what runs ------------------------------------------------------------

[ -z "$FULL" ] || echo "gate: everything: $FULL"
if [ -z "$RUN" ]; then
    if [ -n "$CACHED" ]; then
        echo "gate: nothing to run; already passed on these exact files:$CACHED"
    else
        echo "gate: nothing to test for these files (docs only); NUL check ok"
    fi
    echo "gate: ok"
    exit 0
fi
if [ -z "$FULL" ]; then
    echo "gate: running$RUN"
    [ -z "$SKIPPED" ] || echo "gate:   skipped, untouched:$SKIPPED"
    [ -z "$CACHED" ] || echo "gate:   skipped, already passed on these exact files:$CACHED"
    [ -z "$VITEST_RELATED" ] || echo "gate:   vitest: only the tests related to the changed interface files, and those reading the disk"
fi

# GATE_PLAN=1: say what would run, run nothing.
if [ -n "$GATE_PLAN" ]; then
    [ -z "$VITEST_RELATED" ] || echo "gate: plan: vitest related $VITEST_ARGS"
    exit 0
fi

if has "$RUN" types || has "$RUN" vitest || has "$RUN" build; then
    ( cd interface && npm exec --no -- svelte-kit sync ) >/dev/null
fi

# --- The steps ----------------------------------------------------------------

# step <name> <command...>: run in the background if selected, output to a log,
# exit status to <name>.rc, seconds to <name>.time.
step() {
    name=$1; shift
    has "$RUN" "$name" || return 0
    (
        start=$(date +%s)
        if "$@" >"$LOGS/$name.log" 2>&1; then rc=0; else rc=1; fi
        # A step that waits on another (serve) writes when its own work began.
        [ ! -f "$LOGS/$name.start" ] || start=$(cat "$LOGS/$name.start")
        echo $(( $(date +%s) - start )) >"$LOGS/$name.time"
        echo $rc >"$LOGS/$name.rc"
    ) &
}

# serve: wait for the build, start it on a free port, ask for `/`.
# LOOPING_GATE_SERVE keeps the server from starting its Places scan
# (interface/src/hooks.server.ts).
serve_build() {
    while [ ! -f "$LOGS/build.rc" ]; do sleep 0.5; done
    date +%s >"$LOGS/serve.start"
    if [ "$(cat "$LOGS/build.rc")" != 0 ]; then echo "the build failed; nothing to serve"; return 1; fi
    cd interface
    NO_COLOR=1 LOOPING_GATE_SERVE=1 LOOPING_KIT_OUT_DIR=.svelte-kit/gate-build \
        ../node_modules/.bin/vite preview --port 0 --host 127.0.0.1 >"$LOGS/preview.log" 2>&1 &
    pid=$!
    url=""
    i=0
    while [ $i -lt 60 ]; do
        # Colour codes stripped too: CI forces colour (FORCE_COLOR) over
        # NO_COLOR, and they split `Local:` (the first CI run failed on it).
        url=$(tr -d '\033' <"$LOGS/preview.log" | sed 's/\[[0-9;]*m//g' \
            | sed -n 's/.*Local:[^h]*\(http:[^ ]*\).*/\1/p' | head -n 1)
        [ -z "$url" ] || break
        kill -0 $pid 2>/dev/null || break
        sleep 0.5
        i=$((i + 1))
    done
    code=000
    [ -z "$url" ] || code=$(curl -s -m 30 -o "$LOGS/page.html" -w '%{http_code}' "$url" || true)
    kill $pid 2>/dev/null || true
    wait $pid 2>/dev/null || true
    if [ -z "$url" ]; then
        echo "the preview server never came up:"; cat "$LOGS/preview.log"; return 1
    fi
    if [ "$code" != 200 ] || ! grep -q '__sveltekit_' "$LOGS/page.html"; then
        echo "GET / answered $code, not the app's page:"
        head -c 2000 "$LOGS/page.html" 2>/dev/null; echo
        cat "$LOGS/preview.log"
        return 1
    fi
    echo "GET / answered 200 with the app's page"
}

if [ -n "$VITEST_RELATED" ]; then
    # fsModuleCache keeps compiled modules on disk between runs: the related
    # run of a one-file interface push measured 14.3 s without it and 9.5 s
    # warm (2026-10-01), nearly all of it compiling the app the tests import.
    # Experimental in vitest 4, so only here: a whole run (by hand, daily, CI)
    # compiles fresh and would catch a stale cache within a day.
    # shellcheck disable=SC2086 # one word per test path (none hold a space)
    step vitest sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-vitest npm exec --no -- vitest related --run --passWithNoTests --experimental.fsModuleCache '"$VITEST_ARGS"
else
    step vitest sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-vitest npm run test:run --silent'
fi
if [ -n "$FULL" ]; then TYPES_SCRIPT=check:full; else TYPES_SCRIPT=check; fi
step types   sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-check npm run '"$TYPES_SCRIPT"' --silent -- --threshold error'
step surface sh -c 'cd surface && { [ -x .venv/bin/python3 ] && PY=.venv/bin/python3 || PY=python3; } && "$PY" -m pytest -q'
step ax      npm run test:ax-helper --silent
step build   sh -c 'LOOPING_KIT_OUT_DIR=.svelte-kit/gate-build npm run build --silent'
step serve   serve_build
wait

# --- Report -------------------------------------------------------------------

FAILED=""
for name in $ALL_STEPS; do
    has "$RUN" "$name" || continue
    secs="$(cat "$LOGS/$name.time" 2>/dev/null)s"
    if [ "$(cat "$LOGS/$name.rc" 2>/dev/null)" = 0 ]; then
        echo "gate: $name ok ($secs)"
    else
        FAILED="$FAILED $name"
        echo "gate: $name FAILED ($secs):"
        # Two SvelteKit notices every step prints and none means anything
        # here: each step's own outDir is not the one tsconfig.json extends
        # (4 lines), and the PWA plugin sets Vite's `base` (2 lines). Dropped
        # so the real error is what a failure shows.
        awk '/should extend the configuration generated by SvelteKit:/ { skip = 4 }
             /Vite config options will be overridden by SvelteKit:/ { skip = 2 }
             skip > 0 { skip--; next }
             { print "    " $0 }' "$LOGS/$name.log"
    fi
done

# Remember what passed, for the cache, unless a file changed under the run
# (another session editing this checkout): then the pass is not for these files.
key_snapshot "$LOGS/after"
for name in $RUN; do
    [ "$(cat "$LOGS/$name.rc" 2>/dev/null)" = 0 ] || continue
    if [ "$(cat "$LOGS/before/$name.key")" = "$(cat "$LOGS/after/$name.key")" ]; then
        cp "$LOGS/after/$name.key" "$STATE/$name.pass"
    fi
done

[ -z "$FAILED" ] || { echo "gate: failed:$FAILED"; exit 1; }

# Every step ran whole and passed: that is the full pass the daily rule counts.
if [ -z "$VITEST_RELATED" ] && [ -z "$CACHED" ] && [ -z "$SKIPPED" ]; then
    touch "$STAMP"
fi

# The steps saw the working tree. Say so when it holds more than HEAD: a file
# left out of the commit passed here and is missing from what was pushed.
if [ -n "$(git status --porcelain)" ]; then
    echo "gate: note: uncommitted changes were tested too (git status)"
fi
echo "gate: ok"
