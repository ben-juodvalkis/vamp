# ADR-443: Permute runs sixteen steps

## Status
**Accepted** (extends ADR-429, the thin Permute; ADR-435, a pad's Permute)

## Context

Permute's two lanes — mute and pitch — stopped at eight steps. The cap was
the device's, not the engine's: the thin device (ADR-429) held eight
`live.text` cells per lane and both Length controls ran 1..8, while the
surface's step math had tolerated 64 since the fat device. The interface
mirrored the eight in its role table and in two `MAX_LENGTH = 8`s.

Two calls came with the ask (2026-09-18):

- **The default length stays 8.** A freshly loaded Permute plays exactly as
  before; sixteen is something you drag up to.
- **Every iPad component keeps its size.** The step block does not grow or
  wrap into a second row; it just holds more cells. Two-rows-of-8 and a
  1–8 / 9–16 page switch were considered and passed over for the iPad —
  the device's own 101 px face in Live is another matter (below).

## Decision

**1. The device grows by sixteen cells, appended.** `Mute 9 … 16` and
`Pitch 9 … 16` are parameter orders 23–38, after `Temperature`, so every
existing order and LOM index holds (`Device On` is still 0, `Mute 1` 1,
`Temperature` 22). Both Lengths run 1..16, default 8. The device's own
hide-past-length chain counts to sixteen (`route 1 … 16`, `!- 16`,
`!- 17`), so cells 9–16 are hidden at the default. The parameters and the
wiring were added on the JSON inside the `.amxd` by a script that first
proved it re-serializes the unmodified file byte-for-byte (Max 9's own
formatting); that pass laid the new cells out as a longer row on a device
twice as wide. The user then re-arranged the presentation in Max: the
device keeps its old ~101 px width, each lane's cells sit in **two rows of
eight** (1–8 over 9–16), and Steps and Rate share one row under them. That
Max save changed presentation only — the same 38 parameters and orders, no
patch cord added or removed. `Permute.maxpat`, the readable copy, had
drifted since the 2026-09-11 Max save; it is rewritten from the final
`.amxd`'s JSON.

**2. The engine reads sixteen roles per lane.** `SequencerComponent` builds
its role tables off `DEVICE_STEPS = 16`. The step math was already
length-agnostic; a pre-ADR-443 device (22 controls) still runs, its missing
steps reading as the defaults that its 1..8 length never reaches.

**3. The interface.** `permuteLayout.ts` carries the 16 new roles in device
order (positional fallback 23–38) and exports `PERMUTE_MAX_STEPS`, which
`PermuteCentralView` and `SequencerPatternGrid` use as the length cap. The
step grid already drew `length` cells across a fixed box, so at 16 each
cell is half its width at 8 — the ask, with no layout change. Two
consequences, both chosen:

- **The length cell's fill is honest:** `length / 16`, so the default 8
  reads half full. It shows the headroom rather than hiding it.
- **A length drag keeps its distance per step** (20 px). Reaching 16 takes
  a longer drag rather than making each step twitchier.

`muteEnabled` / `pitchEnabled` (the store) and the tiny sequencer's
`enabled` now look only at the steps inside the length. With sixteen
cells and a default of eight, a muted step 12 under length 8 is the normal
case, and it plays nothing, so it must not wake the row.

## Consequences

- **Saved sets load the new device.** A set stores a Permute as a file
  reference plus each parameter's value by index and name, in real units
  (`Mute Length` = 8 at index 8); the patcher is not embedded. Measured on
  the rig 2026-09-18 (Live 12.4.15b3, fresh launch): the user's default
  template, saved with the 22-control device, came up as 38-control
  Permutes; on the one the user had not touched, the engine read the saved
  lengths, rates, Chance and Temperature back as saved (the step cells
  were not read).
  **Not yet measured:** a set whose saved pattern is *not* all defaults.
  The template's values are the defaults, so it cannot tell "carried over"
  from "reset". Open one such set and compare before relying on it in a
  session.
- **A transient startup warning.** On that launch the engine logged
  `device lacks 16 control(s)` for both devices: it indexes at surface
  init, when Live has built the parameter list from the set's stored 22
  and Max has not yet instantiated the new patch. The next rescan found
  all 38 (`/looping/probe/sequencer_stats`: `missing` = 0). It recurs once
  per device per load until the set is re-saved with the new device.
- **A set with a pre-ADR-443 device and a UI reset.** The duplicate-track
  reset writes all 38 roles, so on a device that still has 22 the last 16
  go to positional paths that do not exist. This only happens if the UI is
  newer than what Live has loaded, i.e. before Live has reloaded the set.
- The screenshot mock's `permuteParams()` emits the 38-control device, and
  the Bass track's Permute runs a 16-step mute row beside an 8-step pitch
  row, so the `permute` tour state shows both lengths.

## Tags
`permute`, `sequencer`, `max-for-live`, `amxd`, `step-length`
