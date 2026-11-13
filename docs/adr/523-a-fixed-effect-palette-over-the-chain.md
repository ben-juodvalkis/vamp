# ADR-523: A Fixed Effect Palette Over the Chain

## Status
**Accepted** (2026-11-11). Supersedes ADR-484 (recent effects beside
+ Effect) and its amendment ADR-497 (Live's effects fill the recents).
Amends ADR-485 (the chain's layout) and ADR-518 (the header bar loses its
power button). Interface only; no Live restart. The bar's height and
one-row collapse are amended by ADR-535: the bar is a third of the
section and always two rows.

## Context
ADR-484 put the effects added lately beside + Effect, and ADR-497 filled
the rest with Live's own. Ben found it confusing to play: the list
reordered with every effect added, an effect already on the chain dropped
out and shifted the rest, the names were sorted down columns, and the
section shrank as the chain grew. Nothing stayed where the hand had
learned it. It also offered effects that made no sense for the track
(Drum Buss on a synth, the amps on a Drum Rack).

The FX section's chain gave the ghosts a fixed share of its width, so a
short chain left dead space and a long one squeezed the ghosts.

## Decision
- **A palette bar across the top of the FX section** replaces the Recent
  column. Its chips are a fixed set in fixed places, **the same on every
  track**: Ben chose them in a picker of every effect he has (his
  `+Effect` folder, Vamp's own types, Live 12's devices and packs). Only
  the MIDI block hides on an audio track, and the rest stretch to fill
  the row.
- **Chips are laid out in family blocks** (`services/effectPalette`):
  each family a block of columns, its main effects on the first row and
  its others under them, a 4px seam between blocks, in the order MIDI,
  Guitar, Tone, Dynamics, Distortion, Modulation, Time, Glitch. Whole
  blocks that do not fit the width drop from the end. An effect not on
  this Mac (a file missing from the effects folder) leaves its slot empty
  rather than shifting the others.
- **The bar is two rows while the chain is one, one row once the chain
  splits into two**, so a long chain gets the height and every family
  keeps its main effects.
- **Chips are quiet**: the short name in the family's colour, a hairline
  in it, no fill; the colour fills in under the finger. An effect already
  on the chain keeps its chip.
- **The chain takes the width.** Its cells are no longer held to a ruler:
  they stretch across the row (one row up to twelve units, two past it),
  and the chain always ends in a **+ one unit wide**, a slider's width,
  which opens the browser on Effect. On two rows the + is the second
  row's last cell, half the chain's height. The bar has no + of its own.
- **The ghost Utility** is a column at the right of the chain, as tall as
  the devices, under the bar.
- **A tap on a cell's header bar turns the device on and off**, as a tap
  on a strip's name mutes it; a drag from the header still reorders, and
  a tap on the face opens the device's view. The power button is gone;
  the name is centered on its bar.
- Two new types: **Random Octave** (Ben's Random preset, loaded by name
  from the effects folder, a palette chip; on the chain it is a
  `MidiRandom` and keeps Random's control) and **Grain Delay** (Live's
  device by name, class `GrainDelay`): an XY on its cell, Pitch across and
  Feedback up, and a view of its own with the rest (Grain, Delay, Mix).
- **A control whose type has no view of its own opens none** (`ControlTile`
  passes `disableCentralViewOnTap`): the chain cell around it opens the
  generic view on a tap and a drag alike, where a drag used to swap it for
  an empty placeholder.

## Consequences
- The effect recents are gone: their list, storage, pruning and the
  browser's recording of picks. `services/chainEffects` keeps only the
  load path the chips and the browser share; the chip is
  `chain/PaletteChip`. The browser's own Recent rail (instruments and
  samples) is unchanged.
- The palette's contents are code (`BLOCKS` in `effectPalette.ts`), not
  a setting. The picker Ben used is an artifact outside the repo.
- On an audio track the chips sit one column further left than on a MIDI
  track, since the MIDI block's room goes to the rest. Ben's call: the
  order is the same, so the hand still finds them.
- A one-unit cell (the Drum Rack's Trnsp, a slider) and the + share a
  width; a very short chain gets very wide cells.

## Tags
`fx-chain`, `palette`, `muscle-memory`, `device-on`
