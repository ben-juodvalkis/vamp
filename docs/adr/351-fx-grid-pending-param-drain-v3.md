# ADR-351: FX Grid Pending-Param Drain (v3 Re-implementation)

## Status

**Accepted** — supersedes ADR-087 for the FX grid case.
2026-04-26.

## Context

When the user interacts with an FX grid control (XY pad, slider, dial, EQ
band, etc.) while the device is still loading, the control queues the
chosen value in `slot.pendingParams` via `selectedTrackStore.storePendingParam`.
Once the device appears in the LOM tree, those queued values must be
written to Live so the user's pre-load gesture isn't lost.

ADR-087 (2025-10-25) originally fixed this race by calling
`FXGridState.checkLoadingCompletion(device)` from
`handleCompleteDeviceState` — the M4L-era "complete state" handler that
ran on every `/looping/device/list` arrival.

The v3 Python control surface migration (cutoff 2026-04-21, see
`documentation/archive/m4l-to-python-v3/`) replaced
`handleCompleteDeviceState` with the `state/full` apply path
(`handleV3StateFullEnd` → `replaceTree` / `mergeSubtreeAtPath` →
`reconcileDevices`). Nothing called `checkLoadingCompletion` in the new
flow, so the queue filled but never drained. The bug class from ADR-087
silently re-emerged for the FX grid.

The bug was reproducible by:

1. Tapping a ghost FX slot to trigger `loadDevice`.
2. Dragging the control before the device finishes loading.
3. Observing that `pendingParams` accumulates correctly during the drag
   but never flushes when the device appears in the v3 tree.

The drained values reach Ableton, but only because the user happens to
release after the device loads — a fast load masked the bug, a slow
load exposed it.

## Decision

**Drain pending params via an `$effect.root` watcher in `FXGridState`
that observes the v3 device tree on rising edge.**

Concretely, in `interface/src/lib/stores/v6/fxGridStore.svelte.ts`:

- Track a `seenDevicePaths: Set<string>` of every `devicePath` previously
  observed on the selected track.
- An `$effect.root` watcher subscribes to `deps.getDevices()` (which
  proxies `selectedTrackStore.devicesByPath`).
- On every tick, devices whose `devicePath` is **not** in
  `seenDevicePaths` are passed to `checkLoadingCompletion(device)`,
  which iterates slots, matches by `expectedClassName + defaultName`,
  fires `setParamValue(paramPath(device, idx), value)` for each entry
  in `slot.pendingParams`, clears the queue, clears the load timeout,
  and resets `loadState` to `'ghost'` (which renders as `'active'` once
  the device is matched).
- `seenDevicePaths` is cleared in `resetForTrackChange()` to bound
  memory across long sessions.

`checkLoadingCompletion` itself was already implemented in
`fxGridStore.svelte.ts:225-270` from the ADR-087 era — it just had no
caller post-v3. The fix is purely about wiring.

### Why not a Python-emitted "device ready" event

The wire spec defines hint addresses `/looping/v3/devices/added` and
`/looping/v3/devices/removed`, but they are explicitly non-authoritative
("hints, not sole-authority", per `docs/reference/wire-protocol.md §2.5`)
and are not currently emitted by the surface. The authoritative signal
is the device appearing in a `state/full` bundle. Adding a parallel
"ready" event would fragment the single-source-of-truth design the v3
migration deliberately chose. UI-side rising-edge detection on the v3
tree is the v3-idiomatic pattern.

### Why this is safe under v3

Three v3 invariants make the drain robust without retry logic:

1. **Generation guard** (`DevicesComponent.handle_set_param_v3`). A
   write sent immediately after seeing the device is rejected with
   `generation-stale` if the UI hasn't yet processed the
   `state/invalidate` that preceded the `state/full`. No silent stale
   write.
2. **Ordering guarantee** (`docs/reference/wire-protocol.md §2.3`).
   `state/invalidate` precedes any new `param/value` echoes. By the
   time the UI sees the device in the tree, its generation is current.
3. **Init-rules win first** (`DeviceInitComponent` in
   `surface/components/`). Init-rule writes are
   deferred to the next control-thread tick and embedded in the scoped
   `state/full` emit. By the time our drain `$effect` fires,
   init-rule values are already in the tree — so our pending writes
   correctly **override** preset defaults, which is the user's intent
   when they moved the control.

## Audit findings (companion changes)

While diagnosing the FX grid bug, three other pending-param queues were
audited for the same v3-trigger-orphaning failure mode:

| Queue                                       | Status     | Notes                                                                                                     |
|---------------------------------------------|------------|-----------------------------------------------------------------------------------------------------------|
| `FXGridState.pendingParams` (this ADR)      | Fixed      | `$effect.root` rising-edge watcher                                                                        |
| `sequencerStore.pending`                    | Healthy    | Component-level `$effect` in 4 sequencer components calls `sequencerStore.onDeviceLoaded(device)`         |
| `FXSlotStore.pendingParams`                 | Dead code  | `_device` was last written by `updateFromDeviceList`, deleted in ROW 13b (2026-04-21). Both writer (`setParameter`) and drain (`applyPendingParams`) had zero callers post-v3 |

ADR-150 (sequencer pending-param fix) is **not** superseded — its drain
mechanism survived the v3 migration intact. The component-level
`$effect` watching `sequencerStore.device` rising edge is structurally
the same pattern as this ADR's `FXGridState.watchDeviceArrivals`, just
expressed at a different layer.

The `FXSlotStore` parameter-access methods (`pendingParams`,
`setParameter`, `getParameterValue`, `applyPendingParams`) plus the
`load()` / `loadTimeout` machinery were removed in this change, since
they were unreachable post-v3. `FXSlotStore` retains its role as a
config + load-state holder for `slotRegistry` / `BaseDeviceControl`.
A class header comment was added pointing future maintainers to
`FXGridState` as the authoritative drain owner.

## Consequences

**Positive**:

- ✅ FX grid pre-load gestures persist across slow device loads (XY,
  slider, dial, EQ multi-band — all 27 controls that route through
  `BaseDeviceControl`'s `storePendingParam` snippet).
- ✅ No new wire address; relies on the v3 `state/full` single source
  of truth.
- ✅ Init-rules vs. user-pending ordering is correct: user gesture
  overrides preset defaults, matching user intent.
- ✅ `FXSlotStore` is no longer a footgun — the dead pending-param
  queue is gone, and a class header comment names `FXGridState` as
  the authoritative drain owner.

**Negative**:

- ⚠️ Two `$effect`s key on `device` rising edge: this watcher and each
  control's local-state initializer (e.g. `AutoFilterControl`'s
  `$effect` at lines 39-49 with `untrack()`). Effect ordering across
  `$effect.root` and component scopes is not strictly guaranteed by
  Svelte 5; in practice the watcher runs first because `FXGridState`
  is constructed at module load (before any component mounts), but if
  ordering ever shifts the symptom would re-appear: store has the
  drained values, UI shows defaults. See **Caveat** below.

**Neutral**:

- Future cleanup: `FXSlotStore` is now ~50 lines of mostly-vestigial
  state. Worth folding into `slotRegistry` as a plain config record in
  a future pass — out of scope here.

## Caveat: dev-mode reactivity-cache corruption

During validation we hit a transient symptom where the drain wrote the
correct values to the v3 store but the XY pad UI rendered defaults.
Reloading with a fresh set restored correct behavior. Subsequent
identical gestures worked.

The likely cause is the Svelte 5 reactivity-tracking corruption that
`interface/CLAUDE.md` already documents: stale `.svelte-kit` / Vite
caches can produce a "store updates but `$derived`/`$effect` doesn't
fire" failure mode. The fix is `npm run cleanup`, which is part of
`npm run dev`.

If this symptom recurs in the field with a fresh build, the next thing
to check is effect ordering between `FXGridState.watchDeviceArrivals`
and `AutoFilterControl`'s init `$effect` — the latter uses `untrack()`
and only re-reads on `device` identity change, so a single missed
ordering invalidates the read. The remediation would be to drain
synchronously in the v3 apply path (e.g. a `reconcileDevices` callback
hook) instead of via downstream reactivity. We chose the `$effect.root`
approach for this fix because it avoids cross-layer coupling between
`stores/v3` and `stores/v6`, but the synchronous-callback path remains
the escape hatch if effect ordering becomes load-bearing.

## Validation

- `npm run build` — green
- `npm run test:run` (interface workspace) — 874/874 pass
- Manual: validated via Playwright probe against the live dev server.
  Captured 186 `storePendingParam` events during a pre-load XY drag,
  followed by exactly two `setParamValue` drain calls (`Frequency`,
  `Resonance`) at the moment AutoFilter appeared in the v3 tree, with
  the final-queued values landing intact in Live and reflected in
  `slot.pendingCount === 0`.

## Tags

`fx-grid`, `pending-parameters`, `device-loading`, `race-condition`,
`v3-migration`, `xy-gestures`, `supersedes-adr-087`
