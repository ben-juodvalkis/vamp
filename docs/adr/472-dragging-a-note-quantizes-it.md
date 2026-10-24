# ADR-472: Dragging a Note Quantizes It

## Status
**Accepted** (2026-10-24). No Live restart (interface only).

## Context
In the clip editor a note dragged sideways moved by whole grid steps from
where it started. An off-grid note kept its offset from the grid and only
moved once the pull reached half a cell, so a small pull did nothing and
no drag ever put the note on the grid.

## Decision
**A drag sideways puts the note on the grid** (`dragSnapStart` in
`utils/clip/clipGesture.ts`). Off the grid, it goes first to the grid line
on the side it is pulled toward, however small the pull; pulled further,
it lands on whichever line is nearest where the finger has taken it. A
note already on the grid moves line to line. The grid is the editor's own
(1/4 to 1/32, triplet or not).

A drag that has not gone sideways past the 8px tap slop leaves the timing
alone, so moving a note only up or down keeps an off-grid note where it
was.

## Consequences
- Every sideways drag quantizes the note it moves; the only way to keep a
  note off the grid is to leave it where it is.
- The first few pixels of pull on an off-grid note jump it to the next
  line, up to a cell away.
- Resizing is unchanged (it already snapped the length).

## Tags
`clip-editor`, `gesture`, `quantize`
