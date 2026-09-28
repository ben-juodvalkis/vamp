#!/bin/bash
# Comprehensive cleanup script for Live Looping Interface
# Kills this repo's development servers and clears its reserved ports.
#
# Build caches are NOT cleared by default. Deleting interface/.svelte-kit on
# every launch made the Vite build gate (scripts/staleness.mjs) structurally
# impossible — the outputs were always missing, so every `npm run ipad` paid a
# full ~40s rebuild whether or not anything had changed. Staleness is now
# decided by fingerprinting the inputs. Pass --caches (or `npm run
# cleanup:caches`) to nuke them by hand when you suspect a stale artifact.
#
# Scope: every kill, by pattern or by port, is restricted to processes whose
# working directory is inside this repo. `pkill -f` matches a substring of a full command line, so
# the patterns below are not project-specific on their own — "vite dev" hits
# any Vite server on the machine, and `pkill -f "npm.*dev"` was measured on
# this Mac matching a terminal's own wrapper shell as well as the dev tree.
# Every `npm run dev` / `ipad` / `interface` runs this script, so the cwd
# filter is what makes keeping the patterns safe.
#
#   ./scripts/cleanup.sh --list     print what would be killed; kill nothing
#   ./scripts/cleanup.sh --caches   also nuke the build caches

CLEAR_CACHES=false
LIST_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --caches) CLEAR_CACHES=true ;;
    --list)   LIST_ONLY=true ;;
  esac
done

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)

# Command-line patterns for this project's long-running dev processes.
PATTERNS=(
  "concurrently"
  "npm.*dev"
  "npm.*preview"
  "node.*osc-bridge"
  "node.*enhanced-osc-bridge"
  "node.*create-status-page"
  "vite dev"
  "vite preview"
)

# Reserved ports.
#   3000 interface dev · 8081 OSC bridge WS · 8889 iPad preview · 8890 status
#
# 9001/9002 (Max4Live), 11001 (AbletonOSC) and 7400/7401 + 7500/7501 (the
# Omnisphere/NI preset servers) left this list 2026-09-23, with the patterns
# for those servers' launch scripts: every one of those backends is gone, so
# the sweep could only ever have killed somebody else's process on them.
#
# 8081, not 8080: constants.json `osc.webSocket.port` is 8081 and its own
# description records that 8080 produces RSV1 protocol errors here, so the
# bridge has never listened there. Sweeping 8080 could only ever have killed
# somebody else's server. (Verified against a running bridge: TCP *:8081,
# nothing on 8080.)
#
# DO NOT ADD THE SURFACE PORTS (11020 UDP, 11021 UDP, 11022 TCP) HERE.
#
# The process holding 11022 is **Ableton Live**. The cwd filter below
# would spare it today, but a port listed here is a promise that this
# repo's servers own it, and Live is not one of them. A stale surface
# socket is not a thing this script can fix: it clears when Live quits.
#
# The port sweep is `kill -9`, so it takes only listeners whose working
# directory is inside this repo, like the process sweep. It used to kill
# whatever held the port: any node or Python server on 3000, 8081, 8889 or
# 8890, whoever's (general-release plan.md §2). A listener that belongs to
# something else is named and left alone, and the start after this reports
# the port in use.
PORTS="3000,8081,8889,8890"

# `-sTCP:LISTEN` keeps the sweep to servers. Without it `lsof -i:<list>` also
# returns every *client* holding a socket to one of these ports, so the old
# `kill -9` reached Google Chrome's network process (ESTABLISHED to :3000 and
# :8081 — the UI tab) and Claude's, on every `npm run dev`. Measured: the
# filter drops those two and keeps the two real servers. It does not suppress
# UDP, which has no LISTEN state — `lsof -t -i:7401 -sTCP:LISTEN` still
# returns the bridge. The menu-bar app is also only a client of :8081, and
# launch-menubar.sh:49 already `pkill -x`es its own singleton.
PORT_LSOF_FILTER="-sTCP:LISTEN"

# Only the commands that can hold a reserved port are asked about. An
# unrestricted `lsof -i` walks every process on the machine to find the
# listeners, and on this Mac that walk measured ~100 s with Live running
# (2026-09-10 — name resolution off made no difference: 98 s), which is
# what held `npm run dev` at this step and timed out the cleanup guards in
# the pre-push gate. Restricted to node and python — the bridge, vite, the
# status page, the Omnisphere and NI servers — the same sweep finds the
# same listeners in 0.07 s. `-a` ANDs the command filter with the port
# filter; `-c` matches a command-name prefix, so `node` covers every
# node binary and `Python`/`python3` the two spellings macOS uses.
# A listener that is neither — a Docker container forwarding 3000 or 8081,
# say — is invisible to the sweep on purpose: the sweep kills what it finds,
# and the process holding a forwarded port is Docker's own backend. Same
# hazard the port list already avoids for Live on 11022 (code review,
# 2026-09-11). If a port stays busy after this sweep, look at it by hand:
#   lsof -nP -iTCP:3000 -sTCP:LISTEN
PORT_LSOF_COMMANDS="-c node -c Python -c python3"
# On Linux, `-c` reads /proc/<pid>/comm, and Node 24 renames its main thread
# to MainThread (measured 2026-09-25: v20.20.2 and v22.23.3 read `node`,
# v24.7.0 and v24.21.0 read `MainThread`), so `-c node` found no node
# listener at all there and cleanupScoping.test.ts failed the pre-push gate
# in a Linux container. macOS names the process after its executable,
# `node` on 24.7.0 too, so the command there is unchanged.
if [ "$(uname)" = "Linux" ]; then
  PORT_LSOF_COMMANDS="$PORT_LSOF_COMMANDS -c MainThread"
fi

# PIDs matching any pattern whose working directory is inside this repo.
#
# macOS pgrep already excludes the caller and all of its ancestors (see the -a
# flag in pkill(1)), which is why `npm run dev`'s own cleanup step has never
# killed the `concurrently` command line that spawned it. Linux procps excludes
# only the caller, and the cwd filter would happily select those ancestors — so
# they are dropped explicitly here rather than by platform accident.
repo_pids() {
  local ancestry=" $$ " p=$$ pid pat seen=" "
  local -a cand=()

  while [ "$p" -gt 1 ]; do
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    [ -z "$p" ] && break
    ancestry+="$p "
  done

  for pat in "${PATTERNS[@]}"; do
    while read -r pid; do
      [ -z "$pid" ] && continue
      case "$ancestry" in *" $pid "*) continue ;; esac
      case "$seen" in *" $pid "*) continue ;; esac
      seen+="$pid "
      cand+=("$pid")
    done < <(pgrep -f "$pat" 2>/dev/null)
  done

  [ ${#cand[@]} -eq 0 ] && return 0
  in_repo "${cand[@]}"
}

# The given PIDs whose working directory is this repo or inside it.
#
# One lsof for every candidate. macOS lsof is slow to start and the startup
# cost dominates the lookup — the same reason the port sweep below is a
# single call rather than one per port.
in_repo() {
  [ $# -eq 0 ] && return 0
  lsof -a -d cwd -Fpn -p "$(IFS=,; echo "$*")" 2>/dev/null | awk -v root="$REPO_ROOT" '
    /^p/ { pid = substr($0, 2); next }
    /^n/ { d = substr($0, 2); if (d == root || index(d, root "/") == 1) print pid }
  '
}

# Listeners on the reserved ports, whoever's.
# `-i:<list>` matches any protocol, exactly as the previous per-port `-ti:N` did.
port_listeners() {
  # shellcheck disable=SC2086
  lsof -nP ${PORT_LSOF_COMMANDS} -a -t -i:"${PORTS}" ${PORT_LSOF_FILTER} 2>/dev/null | sort -u
}

PROC_PIDS=$(repo_pids)
PORT_HOLDERS=$(port_listeners)
# shellcheck disable=SC2086
PORT_PIDS=$(in_repo $PORT_HOLDERS)
FOREIGN_PIDS=""
for pid in $PORT_HOLDERS; do
  case " $(echo $PORT_PIDS) " in *" $pid "*) ;; *) FOREIGN_PIDS="$FOREIGN_PIDS $pid" ;; esac
done

if [ "$LIST_ONLY" = true ]; then
  echo "repo root: $REPO_ROOT"
  echo "would-kill processes (cwd inside repo):"
  for pid in $PROC_PIDS; do ps -o pid=,command= -p "$pid" 2>/dev/null | sed 's/^/  /'; done
  echo "would-kill port holders (${PORTS}):"
  for pid in $PORT_PIDS; do ps -o pid=,command= -p "$pid" 2>/dev/null | sed 's/^/  /'; done
  echo "left alone, not this repo's (${PORTS}):"
  for pid in $FOREIGN_PIDS; do ps -o pid=,command= -p "$pid" 2>/dev/null | sed 's/^/  /'; done
  exit 0
fi

echo "🧹 Cleaning up all development servers..."

# Wait for pids to actually exit, escalating to SIGKILL.
#
# Why this is not optional. `setup-ipad-core` runs the bridge and the
# preview under `concurrently --restart-tries -1 --restart-after 1500`.
# SIGTERM is asynchronous: the supervisor has to notice, tear its
# children down and exit. A cleanup that fires SIGTERM and returns
# immediately leaves that window open, and the supervisor does exactly
# what it was told to do — sees its child gone and respawns it 1500 ms
# later, by which time the *next* `npm run ipad` is already starting.
# The result is two bridge processes: one owning 8081 and the surface
# ports, one owning nothing, racing for them at the next restart.
# Observed 2026-09-02 with pids 19074 and 19661 both alive.
#
# So cleanup has to be synchronous with respect to its own promise:
# "all ports cleared" must mean the processes are gone, not signalled.
reap() {
  local label="$1"; shift
  local pids="$*"
  [ -z "$pids" ] && return 0

  local deadline=$((SECONDS + 5)) alive pid
  while [ "$SECONDS" -lt "$deadline" ]; do
    alive=""
    for pid in $pids; do
      kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
    done
    [ -z "$alive" ] && return 0
    sleep 0.2
  done

  # Whatever is left ignored SIGTERM (or is a supervisor mid-restart).
  echo "   ⏳ $label: escalating to SIGKILL for$alive"
  # shellcheck disable=SC2086
  kill -9 $alive 2>/dev/null || true

  deadline=$((SECONDS + 3))
  while [ "$SECONDS" -lt "$deadline" ]; do
    alive=""
    for pid in $pids; do
      kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
    done
    [ -z "$alive" ] && return 0
    sleep 0.2
  done

  echo "   ⚠️  $label: still alive after SIGKILL:$alive"
  return 1
}

echo "🔪 Killing existing processes (this repo only)..."
if [ -n "$PROC_PIDS" ]; then
  # Supervisors first, and with SIGKILL. `concurrently --restart-tries -1`
  # never exits on SIGTERM: measured 2026-09-23, it was still alive 8 s after
  # one, busy respawning the bridge and preview it had just lost. So every
  # `npm run ipad` over a running session sat out reap's full 5 s grace and
  # then SIGKILLed it anyway. A supervisor holds no state worth a graceful
  # exit, and once it is gone nothing can respawn — so its children still get
  # the ordinary SIGTERM below and shut down cleanly.
  SUPERVISOR_PIDS=""
  for pid in $PROC_PIDS; do
    ps -o command= -p "$pid" 2>/dev/null | grep -q 'concurrently' && SUPERVISOR_PIDS="$SUPERVISOR_PIDS $pid"
  done
  if [ -n "$SUPERVISOR_PIDS" ]; then
    # shellcheck disable=SC2086
    kill -9 $SUPERVISOR_PIDS 2>/dev/null || true
    reap "supervisors" $SUPERVISOR_PIDS
  fi

  # The reap below is what guarantees nothing outlives the sweep.
  echo "$PROC_PIDS" | xargs kill 2>/dev/null || true
  reap "processes" $PROC_PIDS
fi

echo "🔌 Clearing reserved ports..."
if [ -n "$PORT_PIDS" ]; then
  echo "$PORT_PIDS" | xargs kill -9 2>/dev/null || true
  reap "port holders" $PORT_PIDS
fi
if [ -n "$FOREIGN_PIDS" ]; then
  echo "   ⚠️  a reserved port is held by something outside this repo; left running:"
  for pid in $FOREIGN_PIDS; do ps -o pid=,command= -p "$pid" 2>/dev/null | sed 's/^/     /'; done
fi

# A respawn can land between the sweep and here, so confirm the promise
# rather than assuming it. Anything still listening is reported by name:
# silence here is what makes "all ports cleared" trustworthy.
# shellcheck disable=SC2046
STRAGGLERS=$(in_repo $(port_listeners))
if [ -n "$STRAGGLERS" ]; then
  echo "   ⏳ late respawn on a reserved port — sweeping again"
  # shellcheck disable=SC2086
  kill -9 $STRAGGLERS 2>/dev/null || true
  reap "late port holders" $STRAGGLERS || {
    echo "   ⚠️  reserved ports still held; the next start may collide:"
    for pid in $STRAGGLERS; do ps -o pid=,command= -p "$pid" 2>/dev/null | sed 's/^/     /'; done
  }
fi

if [ "$CLEAR_CACHES" = true ]; then
  echo "📦 Clearing SvelteKit and Vite caches..."
  rm -rf interface/.svelte-kit 2>/dev/null || true &
  rm -rf interface/node_modules/.vite 2>/dev/null || true &
  rm -rf interface/dist 2>/dev/null || true &
  rm -rf scripts/.cache 2>/dev/null || true &
  wait
  echo "🗑️  Build caches cleared - next start pays a full rebuild"
else
  echo "📦 Build caches kept (staleness is fingerprinted) - nuke with: npm run cleanup:caches"
fi

if [ -n "$FOREIGN_PIDS" ]; then
  echo "✅ Cleanup complete - this repo's servers stopped"
else
  echo "✅ Cleanup complete - all ports cleared"
fi
echo "🚀 Ready for clean startup"
