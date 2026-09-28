# ADR-359: Unified Parameter Position Ownership (Armed + Speculative)

## Status
**Accepted** (2026-04-29) — supersedes [ADR-140](./140-xy-control-position-ownership.md), partially supersedes [ADR-001](./001-svelte5-runes.md) and [ADR-002](./002-svelte-map-reactivity.md) for the parameter-display path.

## Context

Three concurrent representations of "where is this parameter" had grown
across the FX components and stores:

1. **Component-local `$state`** — `cutoffValue = $state(1)` etc., set by
   either a finger gesture (`onInteraction`) or a one-shot `untrack()`'d
   read of the store on `device` arrival. The pattern ADR-140 introduced
   to dodge lossy round-trip jumps in Echo / AutoPan.
2. **`slot.pendingParams`** in `fxGridStore` — a separate Map, keyed by
   FX-grid slot, holding the user's pre-load gesture values. Drained by
   `checkLoadingCompletion` after the device record arrives.
3. **`v3Store.paramByPath`** — Live's authoritative parameter values,
   updated optimistically by `setParamValue` (ADR-001) and reconciled
   against state/full bundles (ADR-002 / ADR-003).

These never composed cleanly. The latest user-visible failure: tapping a
ghost AutoFilter XY pad to load the device left the visual snapped to
the ghost defaults (1.0, 0.0) after the load, even though Live had the
correct cutoff/resonance applied. The component's `$effect` mirror read
the store *before* `checkLoadingCompletion` had drained pending values
into it, so the `?? default` fallback won.

The cause was structural, not a missing branch. The pre-load handoff
mechanism (`storePendingParam` → drain) and the post-load read mechanism
(`untrack`'d `paramValue`) raced on every device arrival. Even when they
didn't race visibly, every new FX component had to learn two distinct
patterns to avoid snap-back, and the lossy-conversion controls (Echo,
AutoPan) carried a third mode where component-local state was the
source of truth and the store was effectively view-only.

## Decision

The store is the single source of truth for visual position. Component
local `$state` shadows go away. The store is taught two new tricks so
the same `$derived(paramValueArmed(...))` read works for every shape:

### Armed paths

A `SvelteMap<paramPath, {value, ts}>` records what the UI most recently
wrote. Arms are set by `setParamValue` and consulted in two places:

- `applyParamValue` — when a `param/value` echo arrives. If armed and
  the echo agrees with the armed value within `ARM_MATCH_TOLERANCE` the
  arm is cleared and the write applies. If armed and the echo disagrees
  (the lossy round-trip case: UI sent 0.7, surface sends back quantized
  0.667), the echo is dropped. The arm ages out after `ARM_TTL_MS`
  (1500 ms) as a safety net.
- `reconcileParams` (state/full path) — same suppression. Without it, a
  state/full landing mid-drag would replace armed values with their
  pre-write surface state.

Reads route through `paramValueArmed(path)`: returns the armed value if
present, else `paramByPath.get(path)?.value`. Components consume this
exclusively.

### Speculative writes

A second `SvelteMap<slotKey, Map<paramIndex, value>>` holds pre-load
gesture values. When the user drags a ghost FX-grid slot, the gesture
hits `storePendingParam`, which now also calls `armSpeculative`.

The v3 store exposes a `setNewDeviceHook` registration point. The FX
grid registers a hook that runs synchronously inside `reconcileDevices`
on every new-device insertion: it matches the device against
`(expectedClassName, defaultName)`, consumes any speculative entries
for the matching slot, splices them into the device's params Map
*before* the `existing.set(devicePath, inc)` call that makes the device
visible to the reactive graph. Components reading params on
device-arrival see the user's intent from the first frame — no race.

The hook also arms each path and sends the corresponding
`/looping/v3/param/set` so Live converges to the user-intended value.
The arm guarantees the surface's pre-write state echo (which arrives
shortly after) doesn't overwrite the user's value.

### Lossy controls (Echo, AutoPan, Delay, Pitch)

ADR-140 used component-local state to keep the visual smooth across
quantized round-trips (continuous X=0.7 → integer 2 → reconstructed
0.667 = visual jump). With the armed mechanism, that jump can't happen:
during the drag the arm suppresses the disagreeing echo. After
pointerup the arm ages out, at which point the surface's quantized
value wins — the visual snaps to the actual quantized value. We accept
this snap as **honest behavior**: ADR-140 was hiding Live's actual
quantization from the user. Most users would prefer to see what Live
will actually do.

`DeviceXY`'s during-drag `localX/localY` for smooth visual feedback
stays — that's an input-event smoothing layer, not a state shadow.

## Consequences

### Positive

- ✅ **One representation of position** — store is authoritative; reads
  are pure `$derived` against `paramValueArmed`.
- ✅ **Pre-load and post-load are the same code path** — `setParamValue`
  arms + applies + sends; the new-device hook does the deferred bind.
- ✅ **Snap-back is structurally impossible** — the store has the right
  value before any reactive consumer can observe the device-arrival.
- ✅ **External changes propagate naturally** — MIDI controller and
  automation echoes flow into `paramByPath`; idle (non-armed) reads
  see them. The trade-off ADR-140 had to accept (visual stale until
  next user interaction) goes away.
- ✅ **Lossy-conversion behavior is honest** — visual snaps to the
  actual quantized value Live applied, not a smooth reconstruction.

### Trade-offs

- ⚠️ **`slot.pendingParams` and `checkLoadingCompletion`'s drain are
  now redundant** with the new-device hook. They remain in this PR for
  safety (writes also flow through `armSpeculative`); cleanup is a
  follow-up.
- ⚠️ **Components reading `paramValueArmed` pay one extra Map lookup**
  per read (the `armed` consult) compared to the prior `paramValue`.
  Negligible at session scale; not a hot path.

## Implementation

- New module: [`paramArming.svelte.ts`](../../interface/src/lib/stores/v3/paramArming.svelte.ts) — armed + speculative primitives.
- Modified: [`normalized.svelte.ts`](../../interface/src/lib/stores/v3/normalized.svelte.ts) — `applyParamValue` and `reconcileParams` consult `reconcileEcho`; new `setNewDeviceHook` runs in `reconcileDevices` on new-device insert; `resetTree` / `resetForSurfaceRestart` / `_resetForTests` clear arming state.
- Modified: [`selectedTrackStore.svelte.ts`](../../interface/src/lib/stores/v6/selectedTrackStore.svelte.ts) — `setParamValue` arms before the optimistic apply; new `paramValueArmed()` reader.
- Modified: [`fxGridStore.svelte.ts`](../../interface/src/lib/stores/v6/fxGridStore.svelte.ts) — registers the new-device hook; `storePendingParam` mirrors writes to `armSpeculative`; `resetForTrackChange` clears speculative.
- Modified: [`useFxGridSlot.svelte.ts`](../../interface/src/lib/components/v6/central/useFxGridSlot.svelte.ts) — `paramValue` now reads via `paramValueArmed` (covers all 28 central views inheriting from this helper).
- Sweep: every FX device-panel control (`AutoFilterControl` through `VocalControl`, ~20 files) converted from `let foo = $state(default); $effect(...)` to `let foo = $derived(paramValueArmed(...))`. Direct mutations in `onInteraction` (`foo = x`) deleted — the store-routed `sendParam` arms+applies and the `$derived` re-runs.
- Sweep: 15 central views with direct `selectedTrackStore.paramValue` calls (Drift, Operator, Meld, etc.) updated to `paramValueArmed`.
- `clipOperations.ts` intentionally still uses `paramValue` — auto-trim wants the surface-authoritative value, not the UI-armed value.

## Verification

- 916/916 unit tests pass.
- Production build clean.
- Manual Playwright validation: AutoFilter ghost-tap-load no longer
  snaps back; XY tracks finger position post-load; Echo/Delay/Pitch
  visual snaps to quantized divisions during drag (intended).

## Tags

`v3-store`, `reactivity`, `fx-grid`, `param-arming`, `pre-load-gesture`
