# ADR-406: Permute Step Position Is Telemetry, Not Parameter State

## Status
**Accepted**

## Context

Permute (the external M4L sequencer, github.com/ben-juodvalkis/permute)
exposes its current sequencer step as two `live.numbox` parameters —
"Mute Current" / "Pitch Current", `Device.parameters` indices 23/24. Its
own [ADR-010](https://github.com/ben-juodvalkis/permute) states why they
are parameters at all: so external tools can read step position. They use
Live 12.3's "Visible (Not Stored)" mode (`parameter_invisible: 3`),
explicitly to stay out of automation and undo while remaining readable.

On this Live install they are **not** readable that way. Live fires no
`value-changed` notification for them, so the generic per-parameter
listener in `LOMListeners` never observes a change and the value reaches
the UI frozen. Verified live 2026-07-16: 15+ seconds of running transport
produced zero `param/value` fires for either index while the on-device
numbox display advanced normally. Permute's ADR-010 anticipated exactly
this ("on stable Live it falls back to Hidden — display-only, not
externally readable").

Permute was therefore given a small, additive, one-way OSC push: on every
step change it sends `/looping/permute/step [kind, step, trackIndex,
deviceIndex]` straight to the surface's UDP port, the same way
`owner/Max Patches/foot-trigger.js` already does. That part was never in
question. The question this ADR settles is **what the surface does with
it**.

The first implementation re-derived the parameter index (by name, with a
hardcoded 23/24 fallback) and republished the value on the existing
`/looping/v3/param/value` wire, so the UI needed no changes and kept
reading `paramByPath.get(devicePath + '/params/23')`.

That produced a bug in every direction the parameter layout could bend:

- **Index shift.** Permute's LOM enumeration doesn't match its patcher
  declaration order; a verified off-by-two had already burned this
  project once (project memory `project_permute_param_indices`).
- **Name collision.** Permute's "Pitch Current" numbox was copy-pasted
  from "Mute Current" and its long/short name were never changed — the
  LOM reports **both** params as `"Mute Current"`. Name-matching resolved
  mute *and* pitch to the same index, so mute and pitch broadcasts —
  running at genuinely different rates — collided onto one wire path and
  the other path went silent. This presented as "crosstalk between
  tracks" and cost a full debugging cycle.
- **Phantom offset.** The on-device numbox is 1-indexed because a `+1`
  box sits in the Max display chain. The OSC path doesn't go through that
  box, so the surface had to re-add a `+1` purely to imitate a convention
  that only existed by accident.
- **Frozen overwrite.** `V3StateFullComponent` walks every
  `device.parameters` entry, so each `state/full` republishes the frozen
  23/24 values — which would clobber live telemetry in `paramByPath` on
  every resync.

Each of these is a symptom of one root cause: the data was being laundered
back through a parameter-shaped hole it doesn't fit.

## Decision

**Step position is telemetry, and rides a telemetry wire.**

Permute's data splits cleanly into two categories that were being
conflated:

- **Real parameters** — `Mute 1..8`, `Pitch 1..8`, Lengths, Rates,
  Chance, Temperature. User-settable, automatable, persisted, undoable,
  Push-mappable. Live notifies on them correctly. **Unchanged** — they
  keep riding `param/value` + `paramByPath` via the generic listener.
- **Telemetry** — the two step positions. Read-only, ephemeral, ~10 Hz,
  meaningless when stopped, never persisted, never automated, never
  written by the UI.

The second category already has an established lane in this surface:
`PlayheadComponent` and `MetersComponent` are both high-rate ephemeral
telemetry, and neither goes near `paramByPath` — each owns a dedicated
address consumed by a dedicated store. Permute step position *is* a
playhead. It follows that precedent rather than inventing a third pattern.

- New wire: `/looping/v3/permute/step [devicePath, kind, step]`
  (wire-protocol §2). `step` carried **verbatim** — 0..7 running, `-1`
  idle. No offset anywhere.
- `PermuteStepComponent` reads **no LOM state at all**. It composes
  `devicePath` from the ingest wire's indices and emits. No
  `resolve_device`, no parameter walk, no name matching, no fallback
  indices, no `+1`.
- New `permuteStepStore` (`stores/v3/permuteSteps.svelte.ts`), keyed by
  `devicePath`, `SvelteMap` for fine-grained reactivity, cleared on
  `bridge-resync` — modeled directly on `meters.svelte.ts`.
- Three consumers (`useTinySequencer`, `useTrackData`, `sequencerStore`)
  read step position from the store; their pattern/length/rate reads stay
  on `paramByPath` untouched.
- `V3StateFullComponent` is **left alone**. It still emits frozen P
  records for 23/24. Filtering specific params by name inside a generic
  walker would push device-specific knowledge into shared code; the
  records are harmless dead weight because nothing reads them.

## Consequences

**Gains**

- Permute's parameter layout is now irrelevant to this feature. Reorder
  it, rename it, insert params — nothing here breaks. The entire bug class
  above is structurally gone, not worked around.
- The naming bug stops being load-bearing. It's still worth fixing
  upstream (index 24 should say "Pitch Current"), but nothing depends on
  it now.
- `kind` rides the wire as data, so mute and pitch cannot collide by
  construction.
- No `+1`/`-1` transform survives anywhere in the path — one domain
  (0-indexed, `-1` idle) from the Max device to the rendered light.
- `PermuteStepComponent` needs no `song` and holds no cache, so its unit
  tests need no stub LOM at all. That absence is the design working.

**Losses / accepted boundaries**

- A device-specific address in the v3 namespace. Precedent exists
  (`/looping/v3/foot/*` is hardware-specific), and honesty beats a
  speculative "generic device telemetry" channel.
- Permute on a **return or master track** doesn't report. Its Max-side
  path regex matches regular tracks only and sends `-1`, which the surface
  drops. Permute lands on instrument tracks via the track-prepare
  pipeline, so this is theoretical; fixing it means another external-repo
  round-trip and isn't worth it until someone actually hits it.
- **Track reorder** self-corrects on the next step change (the Max side
  re-resolves `LiveAPI` per emit) but leaves an orphaned store entry for
  the old path until resync. Harmless — a stale key nothing reads.
- If Live ever starts firing notifications for these params, both paths
  would carry the same data. Harmless: nothing reads the parameter one.

## Related

- Wire protocol §2 — the two addresses.
- Permute's own ADR-010 (external repo) — removed OSC from that device in
  favor of the UI-native `live.*` objects, accepting "external Svelte UI
  speaking OSC to this device is broken." This ADR does **not** reopen
  that: the channel is one-way, read-only, and carries two telemetry
  values, not the command registry ADR-010 deleted.
- Project memory `project_permute_param_indices` — the original
  index-shift burn that first warned against positional coupling here.
- ADR-360 / `PlayheadComponent` — the telemetry-lane precedent followed.

## Tags

`permute`, `sequencer`, `telemetry`, `wire-protocol`, `osc`, `m4l`,
`lom`, `device-parameters`, `step-position`, `python-surface`
