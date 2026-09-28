# ADR-358: Optimistic store apply on UI-initiated writes

## Status
**Accepted**

## Context

UI-initiated writes to the v3 wire (volume, name, mute, params,
properties) take a round trip:

```
UI ─OSC─→ Surface ─LOM write─→ Live ─listener fire─→ Surface ─echo─→ UI store
```

To avoid jitter loops during fast drags (a slider firing 30+ writes
per second, each LOM write triggering a listener that echoes back to
the UI which re-renders which re-fires the slider...), the surface
arms one-shot **echo suppression** per UI write. The first listener
fire after a UI-initiated write is swallowed; subsequent fires (from
outside edits) pass through normally.

This is correct for keeping the wire quiet, but it leaves a hole on
the UI side: **the v3 store is never updated by anything the UI
sent**. It only updates from outside-edit echoes and state/full
bundles. As long as the UI keeps a parallel optimistic state during
the interaction, the user sees the new value — but the moment that
optimistic state clears, the UI falls back to the (stale) store
value.

Volume sliders surfaced this most visibly (issue #399 follow-up):
drag from 0.04 to 0.85, release, hold for 100 ms, slider snaps back
to 0.04. The wire write went through and Live's volume *was* 0.85;
the UI store just never heard about it. Same failure mode applies in
principle to every UI-initiated value write.

`setParamValue` and `setPropertyValue` (in `selectedTrackStore`)
already solved this for the param/property axes by writing the value
into the store *before* sending OSC — the store IS the optimistic
value during a drag. Track-metadata writes hadn't followed suit,
which is why `TrackVolumeMeter` had to invent a parallel
`optimisticVolume` field, two `$effect`s for clearing it, a 100 ms
safety-net timeout, and a "did the echo catch up?" matcher
(`Math.abs(opt - track.volume) < 0.01`). When the echo was
permanently suppressed, the safety-net timeout always fired, and the
slider always snapped to the stale store value.

## Decision

**Every UI-initiated value write applies optimistically to the v3
store *before* emitting OSC.** The store is the single source of
truth. There is no parallel optimistic state in components.

Concrete shape: a thin **command layer** in
`$lib/services/trackCommands.ts` (and the existing
`selectedTrackStore.setParamValue` / `setPropertyValue`) that pairs
`applyXxxMetadata(...)` with `send(...)`. Components call commands;
they don't call `send` directly for value writes.

Reconciliation:
- Outside edits (Live → UI) bypass suppression and arrive via the
  standard listener echo, which calls `applyXxxMetadata` — store
  reconciles.
- LOM rejections (out-of-range, invalid-routing) bypass suppression
  too; the surface emits the corrective value. Store reconciles.
- State/full bundles re-hydrate `volume` on the T-record on every
  structural / selection-change emit. Store reconciles.

Components reading from the store get a `$derived` that is always
the freshest value the system knows about — no parallel state to
coordinate, no `Math.abs` matcher, no safety-net timeout.

## Consequences

**Positive:**
- Snap-back is structurally impossible. The store never holds a
  stale value while the UI thinks it's at the new value.
- ~30 lines of optimistic-coordination state delete from every
  component that does this work today (volume, master volume,
  eventually name / mute / arm / pan / send).
- Pattern is uniform across all value-write axes (param/property
  already followed it; track metadata now does).
- Tests can assert "store reflects the dragged value without any
  inbound echo" — see `trackCommands.test.ts` "snap-back regression"
  block.

**Negative:**
- If the LOM rejects the write (rare — out-of-range, invalid
  routing), the store is briefly wrong until the surface emits
  `/looping/v3/error` and the corrective `track/<attr>` echo. This
  was already true for `setParamValue` / `setPropertyValue`. We do
  not yet have a rollback path; if a real reject is observed in the
  wild, build one then.
- Components that wanted to render "in-flight, not yet acknowledged"
  styling have nothing to bind to. None do today; if one ever needs
  it, add a separate `pending` flag at the component level — the
  store stays canonical.

## Scope

**This ADR's PR covers every UI-initiated track-metadata value
write that exists today.** The audit walked
`grep "send.*v3/track\|send.*v3/master"` across the codebase and
classified each hit:

- **Migrated to commands** (apply + send pair):
  - `track/volume` — `TrackVolumeMeter.svelte` (volume sliders).
  - `master/volume` — `MasterTrack.svelte`.
  - `track/name` — `presetLoader.ts`, `trackPreparation.ts`,
    `fxGridStore.svelte.ts` (preset-load rename, guitar/bass label).
  - `track/mute`, `track/solo` — `useTrackData.svelte.ts` (track
    strip toggles). Replaces `useMaxTrackObserver.setProperty` for
    these two attrs; mute/solo had the same `optimisticMute` /
    `optimisticSolo` parallel-state machine that volume had, with
    the same broken reconciliation against suppressed echoes.
- **Not migrated (control wires, no value-write semantics):**
  - `track/select`, `track/delete`, `track/prepare_for_preset`,
    `track/send` (write-only sends fader, no observe path).
- **Not migrated (no UI write site today):**
  - `track/arm` (`armTrackWithRetry` is unreferenced from non-test
    code; arm-follows-selection is owned by Python's
    `ExclusiveArmComponent`).
  - `track/color`, `track/pan`, `track/input_routing_*` (no UI
    sliders / pickers in v6 today).
  - `track/mute_toggle` (no UI site; the toggle UI uses `track/mute`
    set, not the toggle verb).

If a future UI feature adds a write to one of the un-migrated
addresses, add a command to `trackCommands.ts` first — don't call
`send(...)` directly from a component for value writes.

**Components that lost their optimistic-state machine in this PR:**
- `TrackVolumeMeter.svelte`: `optimisticVolume` + 2 `$effect`s + the
  100 ms safety-net + the `Math.abs` matcher → all gone.
- `MasterTrack.svelte`: same pattern, also gone.
- `useTrackData.svelte.ts`: `optimisticMute` + `optimisticSolo` +
  the reconciliation `$effect` → all gone.

Net: ~80 lines of fragile parallel-state coordination deleted from
components, replaced by a single 100-line commands service that's
shared and tested.

## Non-decisions

- **Don't revert `da7f6f4e` (state/full debounce/dedup).** That
  commit's perf win is real and unrelated. State/full was never the
  right hydration path for transient value changes anyway — relying
  on it was a happy accident that masked the actual missing path
  (optimistic apply on UI writes).
- **Don't change echo suppression semantics on the surface side.**
  Wire-quietness during drags is the right default; the bug was the
  UI's missing local apply, not the surface's correct suppression.
- **Don't add a generic rollback / pending-write tracker.** Premature
  until we have a real failing case to study.

## References

- Issue #399 (and follow-up Playwright trace from 2026-04-28
  evening) — concrete reproduction of the snap-back.
- `selectedTrackStore.setParamValue` (2026-04-15) and
  `setPropertyValue` (2026-04-16) — prior art for the same pattern
  on param/property axes.
- ADR-352 (param-display hot path) — companion doc on display-value
  flow that motivated keeping displayValue out of state/full.
- `docs/reference/wire-protocol.md` — wire contract this ADR updates.

## Tags
`v3-store`, `ui-writes`, `optimistic-apply`, `echo-suppression`,
`snap-back`, `issue-399`
