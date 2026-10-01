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
#
# A push runs only the steps its changed files can reach. The hook hands git's
# pre-push lines (`<local ref> <local sha> <remote ref> <remote sha>`) on
# stdin; the changed files are each pushed range plus whatever is uncommitted,
# since the steps see the working tree. A README-only push runs nothing but a
# NUL-byte check. `npm run gate`, `GATE_ALL=1`, or any path not named below
# runs all five. There is no CI behind this gate, so a path joins a narrower
# rule only when no other step's tests read it.

set -e
cd "$(git rev-parse --show-toplevel)"

ALL_STEPS="types vitest surface ax build"
ZERO=0000000000000000000000000000000000000000

LOGS=$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX")
trap 'rm -rf "$LOGS"' EXIT
CHANGED="$LOGS/changed"
: >"$CHANGED"

# Collect the changed files, or decide on the full gate.
FULL=""
if [ -n "$GATE_ALL" ] || [ -t 0 ] || [ -z "$GATE_FROM_HOOK" ]; then
    FULL=yes
else
    while read -r _lref lsha _rref rsha; do
        [ -n "$lsha" ] || continue
        case $lsha in *[!0]*) ;; *) continue ;; esac          # a branch deletion
        case $rsha in
            *[!0]*) base=$rsha ;;
            *) base=$(git merge-base "$lsha" origin/main 2>/dev/null) || { FULL=yes; break; } ;;
        esac
        git cat-file -e "$base^{commit}" 2>/dev/null || { FULL=yes; break; }
        git diff --name-only "$base" "$lsha" >>"$CHANGED" || { FULL=yes; break; }
    done
    if [ -z "$FULL" ]; then
        git diff --name-only HEAD >>"$CHANGED"
        git ls-files --others --exclude-standard >>"$CHANGED"
    fi
fi

# Map each changed file to the steps whose tests can see it.
STEPS=""
want() { for s in "$@"; do case " $STEPS " in *" $s "*) ;; *) STEPS="$STEPS $s" ;; esac; done; }
if [ -n "$FULL" ]; then
    want $ALL_STEPS
else
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        case $f in
            # Read by no test (sourceBytes' NUL walk aside, covered below).
            *.md|docs/*|LICENSE) ;;
            # The AX helper's own pytest; nothing else imports it.
            owner/ax-helper/*) want ax ;;
            # userLibraryDetection.test.ts reads the installer.
            surface/install.sh) want surface vitest ;;
            surface/*) want surface ;;
            # test_key_detect.py checks the surface's scales against this list.
            interface/src/lib/data/scales.ts) want types vitest build surface ;;
            interface/*) want types vitest build ;;
            # config/, scripts/, data/, the rest of owner/, package files, the
            # hook and this script: read across suites, so everything.
            *) want $ALL_STEPS ;;
        esac
    done <"$CHANGED"
fi

# sourceBytes.test.ts (vitest) keeps raw NUL bytes out of text sources. When
# vitest is skipped, check the changed text files here instead.
case " $STEPS " in
    *" vitest "*) ;;
    *)
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
        ;;
esac

if [ -z "$STEPS" ]; then
    echo "gate: nothing to test for these files (docs only); NUL check ok"
    echo "gate: ok"
    exit 0
fi
SKIPPED=""
for s in $ALL_STEPS; do case " $STEPS " in *" $s "*) ;; *) SKIPPED="$SKIPPED $s" ;; esac; done
[ -z "$SKIPPED" ] || echo "gate: running$STEPS (skipped, untouched:$SKIPPED)"

case " $STEPS " in
    *" types "*|*" vitest "*|*" build "*) ( cd interface && npm exec --no -- svelte-kit sync ) >/dev/null ;;
esac

# step <name> <command...>: run in the background, output to a log.
step() {
    name=$1; shift
    case " $STEPS " in *" $name "*) ;; *) return 0 ;; esac
    ( if "$@" >"$LOGS/$name.log" 2>&1; then echo 0; else echo 1; fi >"$LOGS/$name.rc" ) &
}

step types   sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-check npm run check --silent -- --threshold error'
step vitest  sh -c 'cd interface && LOOPING_KIT_OUT_DIR=.svelte-kit/gate-vitest npm run test:run --silent'
step surface sh -c 'cd surface && { [ -x .venv/bin/python3 ] && PY=.venv/bin/python3 || PY=python3; } && "$PY" -m pytest -q'
step ax      npm run test:ax-helper --silent
step build   sh -c 'LOOPING_KIT_OUT_DIR=.svelte-kit/gate-build npm run build --silent'
wait

FAILED=""
for name in $STEPS; do
    if [ "$(cat "$LOGS/$name.rc" 2>/dev/null)" = 0 ]; then
        echo "gate: $name ok"
    else
        FAILED="$FAILED $name"
        echo "gate: $name FAILED:"
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
[ -z "$FAILED" ] || { echo "gate: failed:$FAILED"; exit 1; }

# The steps saw the working tree. Say so when it holds more than HEAD: a file
# left out of the commit passed here and is missing from what was pushed.
if [ -n "$(git status --porcelain)" ]; then
    echo "gate: note: uncommitted changes were tested too (git status)"
fi
echo "gate: ok"
