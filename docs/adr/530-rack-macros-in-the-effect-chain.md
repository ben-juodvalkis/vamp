# ADR-530: A rack's visible macros, played in the effect chain

## Status
**Accepted** (2026-11-12). Needs a Live restart for the macro count (a new
property row); the knobs draw without it, at Live's default of eight.
Replaces ADR-492's macro meters on a rack's cell. Builds on ADR-529.

## Context

A rack's cell in the chain overview drew its mark over a strip of meters,
one per named macro, up to eight: no names, no way to move them, and no
regard for how many macros the rack shows in Live (its macro count
button, 1 to 16). Ben asked for the visible macros, named and playable
in the chain, as many as the cell has room for.

## Decision

- **A rack's cell draws its macros as knobs**, each named, in Live's
  order: the same knob as the central views (`DeviceSlider face="knob"`,
  size s), a vertical drag turning it over 160px. It writes the macro's
  parameter (0..127) as any control does. The mark is gone from a cell
  that has macros; a rack with none keeps it.
- **Which macros:** the first `visible_macro_count` of the rack's
  sixteen, less those Live still names "Macro N" (the rule every rack
  view follows, `isEmptyMacroName`). The count is a new read-only
  property row, `visible_macro_count`, on the three chain-rack classes,
  a plain listened attribute of `RackDevice` (no provider). The chain
  overview holds it for every rack it draws, beside `show_devices`.
- **How many fit:** the cell's size decides (`rackMacroFit`): as many
  columns and rows of 48 x 76px boxes (a 36px knob and its name) as the
  face holds, the first macros in Live's order, the rows as few as hold
  them; a "+N" in the corner counts the rest. On the iPad a one-row
  chain's rack shows up to nine, a two-row chain's three. The cell keeps
  its two units; the macro count does not widen it.
- **Instrument Racks too:** a rack that is the track's instrument draws
  its macros the same way, in the track's colour, unless it has a face of
  its own; a Pattern Rack (macro 1 "Pattern N") keeps its mark, its first macro being a chooser its view draws.
- A touch on a knob is the control's: it never reorders the cell, and a
  drag opens the rack's view as every control's does.

## Consequences

- Until Live restarts with this surface the row is refused and every rack
  reads eight visible.
- A rack's macros beyond what its cell holds are reached in its central
  view, as before.
- `rackMacrosFill` and the meter strip are gone.

## Tags
`chain-overview`, `racks`, `macros`, `wire-protocol`
