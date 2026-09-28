# ADR-349: Central-view scaffolding consolidated under useFxGridSlot

## Status
**Accepted**

## Context

The v3 wire migration (PR-3.5.1, 2026-04-15) replaced the v2 ID-keyed
`getParameterValue` / `setParameter` store API with a v3 path-keyed
one. The migration left every FX device central view in
[interface/src/lib/components/v6/central/views/](../../interface/src/lib/components/v6/central/views/)
re-implementing the same ~30 lines of slot-aware glue: derive the slot,
derive `device`/`isGhost`/`isLoading`/`color`, ratchet `loadingInitiated`
across ghost sessions, and dispatch param writes through the
ghost → loading → active state machine.

The drift this duplication creates is invisible until something
breaks. AutoFilter's view was deleted in commit `77708cbb` and
recovered later — it compiled clean against the v3 codebase but
silently called the deleted v2 API. With ~15 views all writing the
same boilerplate, the next deprecation would have the same problem at
20× the surface area.

A first pass landed [useFxGridSlot.svelte.ts](../../interface/src/lib/components/v6/central/useFxGridSlot.svelte.ts)
earlier on 2026-04-25 and ported AutoFilter and Reverb. This ADR
covers the full sweep across the remaining live views, plus the
dead-code triage and bug fixes uncovered along the way.

## Decision

**One helper, every FX central view.** All FX device central views
get their slot scaffolding from `useFxGridSlot(slotKey, fallbackColor?)`.
The helper returns a handle with `$derived` getters
(`slot`, `device`, `devicePath`, `isGhost`, `isLoading`, `color`)
plus three methods: `paramValue(idx)`, `sendParam(idx, val)`, and
`loadIfGhost()`.

`loadIfGhost()` was added during the sweep for the Redux-style
tap-to-load case where the view has no parameter to piggy-back the
load on. The once-per-ghost-session ratchet now lives inside the
helper instead of in every consumer.

**Property subscriptions stay inline.** Hybrid Reverb's `ir_*` props,
Compressor's sidechain routing pair, etc. need a single multi-property
`$effect` so the teardown can release them as a batch when devicePath
changes. Per-property helpers either lose reactivity or proliferate
effects. The helper exposes `devicePath` so consumers can mount their
own subscription effects without re-deriving the slot.

**Three orphan views deleted.** `PitchCentralView`, `MovementFilterCentralView`,
and `QuartzCentralView` had no live registry references — `'pitch'`,
`'filter'`, and `'reverb'` slots all route to the
PitchHelix / AutoFilter / Hybrid views respectively. Recoverable from
git if any get reactivated.

**AudioEffectRackCentralView left as-is.** It detects its device by
*presence* (`audioEffectRackByPath`) rather than by FX grid slot key,
and has no ghost/loading state machine to gate against. Forcing the
helper here would be a square peg in a round hole.

## Bugs fixed during the sweep

- **PedalCentralView**: `drumTransients` was a function-shaped
  `$derived(() => {...})` whose body re-ran on every render outside
  the reactive graph (callsite was `drumTransients()`). Switched to
  `$derived.by(() => {...})` and dropped the call parens.
- **DigitalCentralView**: param writes used bare `setParamValue`,
  which silently dropped while the slot was ghost or loading. Now
  routed through `fx.sendParam` so taps queue pending params and
  trigger load on first ghost write — matching every other view.

## Consequences

**Positive:**
- ~450 lines of identical boilerplate removed across 13 views.
- Future store-API changes (the next v3 deprecation) land in one
  place rather than fifteen.
- The view-shaped bugs above were caught only because every consumer
  was being re-read; future audits surface drift faster.
- The "view recovered from git silently broke" failure mode that
  triggered this ADR is now much less likely — there's nothing to
  silently regress against, since every view goes through one helper.

**Negative:**
- Multi-slot views (Pedal, Utility, Arpeggiator, Guitar) declare 3-5
  helper handles. Less DRY than a single big consolidated lookup, but
  matches the pattern Reverb already used and keeps each handle
  self-contained.
- The `Device | null` vs `DeviceRecord` type-debt on `*Control`
  components (CompressorControl, GateControl, SaturatorControl,
  DigitalControl, ReduxControl, WahControl, VelocityRangeBrace,
  CombControl) shows up more visibly now that views are the only
  callers passing slot devices through. Cleanup deferred to a
  separate PR — the current diagnostics match the baseline before
  this sweep.

## Tags

`refactor`, `central-view`, `svelte-runes`, `v3-wire`, `fx-grid-slot`
