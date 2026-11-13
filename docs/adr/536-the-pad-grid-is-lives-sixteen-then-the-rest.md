# ADR-536: The Pad Grid Is Live's Sixteen, Then the Rest

## Status
**Accepted** (2026-11-13). Supersedes ADR-475. Needs a Live restart for
the grid to follow Live's scroll; until then it shows Live's default
window, 36..51.

## Context
Since 2026-09-09 the Drum Rack view's pad grid drew the pads in play: the
playing clip's pitches, Live's selected pad and every held pad, stacked
four to a column (ADR-475 added the kit's first eight for an empty clip).
A pad's place on the grid depended on which other pads the clip played,
so it moved whenever the clip changed, and a pad outside that set could
not be reached from the interface. The user asked for the pads where Live
has them, always, and the rest of the kit beside them.

## Decision
**The grid draws the sixteen pads Live's rack shows, where Live shows
them, and every other pad to their right** (`padRackGrid`,
`services/drumVirtualMacros/padGrid.ts`).

- **Live's window.** The surface reports the rack's
  `view.drum_pads_scroll_position` as `vm.padScroll`: the lowest visible
  row of four, so the window is `4·row .. 4·row + 15`. It is read-only
  and re-emitted by the rack view's scroll listener. Measured on the rig
  (Live 12.4.25b1): row 9, and `visible_drum_pads` read notes 36..51; the
  add/remove listener pair exists on `RackDevice.View`. Whether it fires
  on Live's own scroll arrows is not yet measured.
- **Laid out as Live does.** Four rows of four consecutive notes, the
  lowest bottom-left. All sixteen are drawn, an empty pad as a dashed
  tile, so a pad never moves.
- **The rest to the right.** Every pad the kit holds outside the window,
  and a selected or held pad there, sits in columns right of the sixteen,
  in the same reading order, as many columns as four rows need. A 32-pad
  kit at the default window shows Live's next page beside this one.
- **Split the difference.** Live's sixteen are four 68px columns
  (284px). A kit with more pads gets a grid halfway between that and
  every column at 68px, so its tiles shrink but stay a finger's width: a
  32-pad kit is ~50px tiles in 430px, not ~32px in 284px or 68px in
  576px. Labels scale with the tile. The gap between the sixteen and the
  extras is doubled.
- **The clip only flashes.** The playing clip no longer decides which
  tiles exist; its notes still light pads as the playhead crosses them.

## Consequences
- The pad column is 284px on a kit of up to sixteen pads in Live's
  window and wider past that (430px for 32 pads); it was 68 to 212px,
  so the controls beside it are narrower.
- Every pad in the kit can be held from the interface again, without
  the paging arrows the 2026-09-09 change removed.
- Until Live restarts on the new surface, `vm.padScroll` has no answer
  and the grid shows 36..51 whatever Live's rack shows.
- The pads-in-play helpers (`padGridNotes`, `padGridShape`,
  `padGridCell`, `padGridSlots`) and the unused chain-cell layout
  (`padRackShape` / `padRackCell`) are deleted.

## Tags
`drum-rack`, `pad-grid`, `wire`
