# ADR-405: Bridge-Lifetime auto_capture Override Replay

## Status
**Accepted**

## Context

The `auto_capture` toggle is the sole gate for the performance-capture
behaviors (auto-record on transport start + save-as on stop,
wire-protocol §2.14). It lives in the Python surface's
`SessionSettingsComponent` and is deliberately not persisted to disk:
its *default* is launch-mode-derived (ipad→on, dev→off), re-seeded from
the first bridge heartbeat carrying a `mode` on every surface init, so a
dev↔ipad switch resets to the mode default instead of reusing a stale
cross-mode value. The other two session toggles (`auto_arm`,
`move_volume_knob`) persist to `logs/session-settings.json`.

The gap: Live tears down and reconstructs the whole Control Surface on
**every set load**, and the bridge heartbeats every ~2s continuously. So
"re-seeds on surface init" meant, in practice, "a user override is wiped
within ~2 seconds of every set load." The Live log from 2026-07-14/15
shows the fight: eight set loads, eight `auto_capture seeded from mode →
ENABLED` lines, six manual `DISABLED` writes chasing them. The user's
expected contract — an override persists across set loads and resets
only when the dev/ipad script starts — matched the *documented intent*
(guard against stale cross-mode values) but not the implementation.

Two candidate fixes:

1. **Persist surface-side with the seeding mode** (extend
   `session-settings.json` with `{auto_capture, seeded_mode}`; reuse the
   override only when the mode matches). Keeps state in one place, but
   deviates from the expected contract (override would survive same-mode
   script restarts) and — decisively — requires a full Live restart to
   take effect, since Live caches Remote Script bytecode.
2. **Bridge-lifetime memory + replay.** The bridge process *is* the
   lifetime the user expects ("reset when I start the dev or ipad
   script"), and it already terminates other capture-adjacent behavior
   (the save-as osascript automation).

## Decision

The bridge remembers and replays the override
(`interface/bridge/handlers/autoCaptureOverride.js`):

- **Record**: every WS-client write to `/looping/v3/session/auto_capture`
  is recorded in `WebSocketServer.routeMessageToUDP` (last valid 0/1
  wins), in memory only — bridge restart forgets it.
- **Replay**: the `pythonSurface` inbound middleware in
  `enhanced-osc-bridge.js` watches surface emits on the same address.
  When an emit disagrees with the recorded override (i.e. a rebuilt
  surface re-seeded the mode default after a set load), the bridge
  writes the override back, directly to the surface UDP port with an
  explicit `i` type tag (osc.js would otherwise infer a float, which the
  surface's strict bool01 parser rejects).

Properties:

- **Mismatch-triggered only, so it cannot oscillate**: a replay produces
  exactly one surface echo, which then equals the override. The replay
  also lands as a normal user write surface-side, committing the toggle
  so the (possibly later) mode seed is a no-op for that surface's life.
- **Inert until the user acts**: with no client write recorded this
  bridge run, the module never sends anything — the surface's seed rules
  apply untouched.
- **No surface changes**: the Python surface's seed/commit logic is
  unchanged, so the fix takes effect on the next bridge restart with no
  Live restart needed.

Two adjacent fixes shipped with it:

- The menu-bar utility's checkmarks are now **echo-confirmed** instead
  of optimistic (`AppState.set` no longer applies locally before
  sending). A write sent while Live is loading a set is silently
  swallowed (old surface torn down, new one not up); the optimistic flip
  made that look like "the set load reset my toggle."
- `scripts/launch-menubar.sh` reaps existing instances
  (`pkill -x LoopingMenuBar`) before launching — concurrently teardown
  orphans the app binary `swift run` spawned, and six accumulated
  instances (six identical menu-bar icons) were observed.

## Consequences

- An `auto_capture` override now survives set loads and Live restarts,
  and resets to the launch-mode default exactly when the dev/ipad script
  restarts. The dev↔ipad staleness guarantee is preserved — switching
  modes means restarting the script, which clears the memory.
- The toggle's authoritative state is now split across two processes:
  the surface holds the live value; the bridge holds the
  session-override intent. The bridge always converges the surface to
  the last client write, so a client that writes through the bridge
  cannot observe divergence — but a hypothetical direct-to-surface
  writer (ephemeral UDP, bypassing the bridge) would be overridden on
  the next mismatch emit. No such writer exists today (the
  looping-prefs extension writes only `auto_arm`/`move_volume_knob`).
- The UI may see a brief flicker after a set load: the seed emit
  broadcasts before the corrective replay's echo (~tens of ms).
- Menu-bar rows no longer flip instantly on click; they flip when the
  echo lands (~90ms, imperceptible since the menu closes on click). A
  dead write now honestly leaves the checkmark unchanged.

## Tags

`bridge`, `auto-capture`, `session-settings`, `set-load`, `menubar`,
`performance-capture`, `toggles`
