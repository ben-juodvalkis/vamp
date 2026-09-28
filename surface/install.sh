#!/bin/sh
# Install the surface into Ableton Live's Remote Scripts folder, as "Vamp".
#
# Creates a symlink from Live's User Library Remote Scripts directory
# back to this source tree, so edits here take effect after a Live
# restart without a copy step. Live lists the surface by the link's name
# (general-release naming.md §4), so the link is `Remote Scripts/Vamp`.
# It used to be `Remote Scripts/Looping`: a Looping link that points at a
# looping-surface folder is removed, so Live lists one surface, not two.
# `npm run setup` runs this.
#
# Idempotent: if the symlink is already correct, exits 0. If a real
# directory exists at the target, refuses to overwrite. If a symlink
# points somewhere else, replaces it after printing what it was.
#
# Finding the User Library:
#
#   Live's User Library can live in several places depending on how
#   the user has configured it. Default on macOS is
#   ~/Music/Ableton/User Library, but it is common to relocate onto
#   external storage (this project's author has it under
#   /Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library).
#
#   This script, in order:
#     1. Honours $LOOPING_USER_LIBRARY if set (explicit override).
#     2. Parses Live's Library.cfg under ~/Library/Preferences/Ableton
#        to extract a canonical path. This is the source of truth Live
#        itself reads, so it cannot disagree with reality.
#     3. Falls back to the default macOS path
#        (~/Music/Ableton/User Library) only if Library.cfg is not
#        found (fresh Live install, no prefs yet).
#
# Usage:
#   ./surface/install.sh
#   LOOPING_USER_LIBRARY="/path/to/User Library" ./surface/install.sh
#   ./surface/install.sh --print-user-library
#
# `--print-user-library` runs step 1-3 above, prints the resolved path and
# exits without touching anything. It exists so the detection can be tested
# against a synthetic $HOME (see userLibraryDetection.test.ts) — same seam
# `cleanup.sh --list` has, for the same reason.
#
# Uninstall:
#   rm "<User Library>/Remote Scripts/Vamp"

set -e

PRINT_ONLY=0
if [ "$1" = "--print-user-library" ]; then
    PRINT_ONLY=1
fi

SOURCE_DIR=$(cd "$(dirname "$0")" && pwd)

USER_LIBRARY=""

if [ -n "$LOOPING_USER_LIBRARY" ]; then
    USER_LIBRARY="$LOOPING_USER_LIBRARY"
    if [ "$PRINT_ONLY" -eq 0 ]; then
        echo "Using override: $USER_LIBRARY"
    fi
else
    # Find the prefs directory Live most recently WROTE, by mtime.
    #
    # This used to take the last iteration of the glob and call it "newest",
    # with a comment claiming lexicographic order works because
    # "Live 12.3.6" > "Live 12.3.5". It does not, for two reasons, and both
    # bite on a machine that has run betas: "Live 12.9" sorts after
    # "Live 12.10", and 'b' > '.' so "Live 12.4b7" sorts after every
    # "Live 12.4.x" there is. Measured on the author's Mac 2026-09-11, with
    # 100 prefs directories present: the glob picked `Live 12.4b7`, last
    # written in February, while the Live actually in use was `Live 12.4.15b2`,
    # written that morning.
    #
    # mtime answers the question the script is really asking — which Live is
    # this person running — and needs no opinion about Ableton's version
    # strings. `stat` is tried in the GNU form first, then the BSD form: on
    # macOS `stat -c` fails with nothing on stdout, so the fallback runs; on
    # GNU coreutils `stat -f %m "$d"` does NOT fail cleanly — it reads `%m`
    # as a file name, prints the filesystem block for "$d" to stdout, then
    # exits 1 — so with the BSD form first `$m` was that block plus the real
    # mtime and the numeric compare below never fired (every
    # `userLibraryDetection` test red on Linux, 2026-09-12).
    PREFS_DIR=""
    PREFS_MTIME=0
    for d in "$HOME/Library/Preferences/Ableton/"Live*; do
        [ -d "$d" ] || continue
        [ -f "$d/Library.cfg" ] || continue
        m=$(stat -c %Y "$d" 2>/dev/null || stat -f %m "$d" 2>/dev/null || echo 0)
        [ -n "$m" ] || m=0
        if [ "$m" -gt "$PREFS_MTIME" ]; then
            PREFS_MTIME="$m"
            PREFS_DIR="$d"
        fi
    done

    if [ -n "$PREFS_DIR" ]; then
        # Extract any Path="..." that contains "/User Library/" and
        # lop off everything after "User Library" to get the root.
        # sed/awk is fine here — no XML parser in /bin/sh.
        SAMPLE_PATH=$(grep -oE 'Path="[^"]*/User Library[^"]*"' \
            "$PREFS_DIR/Library.cfg" | head -1 | \
            sed 's/^Path="//; s/"$//')
        if [ -n "$SAMPLE_PATH" ]; then
            # Cut at the FIRST "/User Library". The old `sed
            # 's|\(.*/User Library\).*|\1|'` is greedy, so a library that
            # happens to contain a nested "User Library" folder resolved to
            # the inner one — a path that exists, so the -d guard below
            # passes and the script reports success while installing the
            # Remote Script where Live will never look.
            USER_LIBRARY=$(awk -F'/User Library' '{printf "%s/User Library", $1}' <<EOF
$SAMPLE_PATH
EOF
)
            if [ "$PRINT_ONLY" -eq 0 ]; then
                echo "Detected from $(basename "$PREFS_DIR")/Library.cfg:"
                echo "  $USER_LIBRARY"
            fi
        fi
    fi

    if [ -z "$USER_LIBRARY" ]; then
        # No Library.cfg found — fresh Live install, try the default.
        USER_LIBRARY="$HOME/Music/Ableton/User Library"
        if [ "$PRINT_ONLY" -eq 0 ]; then
            echo "No Library.cfg found; trying default: $USER_LIBRARY"
        fi
    fi
fi

if [ "$PRINT_ONLY" -eq 1 ]; then
    echo "$USER_LIBRARY"
    exit 0
fi

if [ ! -d "$USER_LIBRARY" ]; then
    echo "error: $USER_LIBRARY does not exist." >&2
    echo "Set LOOPING_USER_LIBRARY to the path of your User Library and re-run." >&2
    echo "(Find it in Live → Preferences → Library → Location of User Library.)" >&2
    exit 1
fi

# A User Library always has a Presets folder. Without this, any directory
# that merely EXISTS at the resolved path satisfies the guard above — which
# is what let both detection bugs report success.
if [ ! -d "$USER_LIBRARY/Presets" ]; then
    echo "error: $USER_LIBRARY exists but has no Presets folder." >&2
    echo "That is probably not Live's User Library. Set LOOPING_USER_LIBRARY" >&2
    echo "and re-run. (Live -> Preferences -> Library -> Location of User Library.)" >&2
    exit 1
fi

TARGET_ROOT="$USER_LIBRARY/Remote Scripts"
TARGET="$TARGET_ROOT/Vamp"
LEGACY="$TARGET_ROOT/Looping"

if [ ! -d "$TARGET_ROOT" ]; then
    mkdir -p "$TARGET_ROOT"
    echo "Created: $TARGET_ROOT"
fi

# The old name. Only a link into a looping-surface folder is ours; anything
# else called Looping is left where it is.
RENAMED=0
if [ -L "$LEGACY" ]; then
    case "$(readlink "$LEGACY")" in
        */looping-surface|*/looping-surface/)
            rm "$LEGACY"
            RENAMED=1
            echo "Removed the old link: $LEGACY"
            ;;
    esac
fi

if [ -L "$TARGET" ]; then
    EXISTING=$(readlink "$TARGET")
    if [ "$EXISTING" = "$SOURCE_DIR" ]; then
        echo "Already installed: $TARGET -> $SOURCE_DIR"
        if [ "$RENAMED" -eq 1 ]; then
            echo "Pick 'Vamp' where Live → Settings → Link, Tempo & MIDI had 'Looping'."
        fi
        exit 0
    fi
    echo "Replacing existing symlink:"
    echo "  was: $TARGET -> $EXISTING"
    echo "  now: $TARGET -> $SOURCE_DIR"
    rm "$TARGET"
elif [ -e "$TARGET" ]; then
    echo "error: $TARGET exists and is not a symlink." >&2
    echo "Move or delete it manually, then re-run this script." >&2
    exit 1
fi

ln -s "$SOURCE_DIR" "$TARGET"
echo "Installed: $TARGET -> $SOURCE_DIR"
echo
if [ "$RENAMED" -eq 1 ]; then
    echo "The surface is now called Vamp. In Live → Settings → Link, Tempo & MIDI,"
    echo "      pick 'Vamp' in place of 'Looping', then quit and reopen Live."
else
    echo "Next: open Live → Settings → Link, Tempo & MIDI →"
    echo "      pick 'Vamp' in an empty Control Surface slot."
fi
echo "      Output stays 'None'. Input stays 'None' too, unless a pedal is on USB:"
echo "      then Input is the pedal's port, with that port's Track and Remote"
echo "      switches off in the MIDI Ports list."
echo "      Check Live's log for: 'INFO:looping: - Vamp surface init'."
