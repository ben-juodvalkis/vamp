# ADR-475: An Empty Clip Shows the Kit's First Eight Pads

## Status
**Accepted** (2026-10-24). No Live restart (interface only).

## Context
The Drum Rack view's pad grid draws the pads in play: the playing clip's
pitches, Live's selected pad and every held pad (2026-09-09). With nothing
playing, or a clip with no notes, that left one tile, the selection, so no
other pad could be reached from the interface, and the pad notes strip
(ADR-473) had no pad to start a pattern on.

## Decision
**When the clip gives the grid no pads, the kit's first eight stand in
for it**: its eight lowest notes that hold a pad, Live's bottom two rows
(`EMPTY_CLIP_PADS` in `padGridNotes`, `services/drumVirtualMacros/padGrid.ts`).
The selection and held pads still join them. A playing clip with notes is
the basis exactly as before; the kit is not added to it.

## Consequences
- An idle drum track shows two columns of four, the lowest pad at the foot
  of the first.
- A selected pad outside the first eight makes a third column.
- The pad grid and the pads' Permute presence (`usePadSequencers`) read
  the same rule, so both see the eight.

## Tags
`drum-rack`, `pad-grid`
