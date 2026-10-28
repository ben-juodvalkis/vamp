# ADR-492: Chain Faces Pick Their Layout by Cell Size

## Status
**Accepted** (2026-10-28). No Live restart: interface only.

## Context
The chain overview (ADR-485) gives each device a cell as wide as the chain
leaves it: a three-device chain gives broad cells, a long or two-row chain
narrow ones. Each face drew one way regardless. The Drum Rack's pads, laid
out as Live lays them (rows, lowest along the bottom), wanted four across
where there is room and two where there is not, and its first cut measured
its own width. Ben asked for the general case: any device's layout and
controls in the chain may vary with the cell's width, and its height too,
since a long chain splits into two rows of half-height cells.

## Decision
- **The chain measures, the face chooses.** `chain/CellSize.svelte` wraps
  every face in the chain, measures the room it leaves, and provides it
  through context (`chain/cellSize.ts`): the width and height in CSS px and
  the width in three steps, `narrow` (under 120), `medium` and `wide`
  (236 and up, four 56px tiles side by side), and the height in two,
  `short` and `tall` (180 and up; on the iPad a one-row chain leaves a
  face about 260, a two-row chain about 115).
- A face reads it with `useCellSize()` and picks its layout. Outside the
  chain (a browser tile, a central view) there is no context and the face
  draws its default, so nothing changes there.
- `data-cell-width` and `data-cell-height` on the wrapper carry the steps,
  for CSS and tests.
- The Drum Rack is the first to use the width: four pads across when
  `wide`, two otherwise. The pitch and mod wheels are side by side unless
  the cell is `narrow`, where Pitch stacks over Mod (Ben, 2026-10-28: they
  stacked in a one-row chain before, by the chain's row count).
- **The faces audit (2026-10-28).** Every face was shot narrow, medium
  and wide, in one-row (tall) and two-row (short) chains (the `faces`
  shot tour). On the iPad the cells are medium nearly always (about 200px;
  wide only in the shortest chains, narrow only in very long ones),
  so most faces already fit. What changed:
  - **The device's name.** The head is measured too (it sits outside the
    face, in its own `CellSize`). In a one-row chain the band has room for
    two lines, so a long name wraps ("Multiband Dynamics", "Ben's
    Adaptive Tone Shaper") instead of ending in an ellipsis; a two-row
    chain's half band keeps one line. A narrow cell's name is a size
    smaller (13px), where the power button left it three letters.
  - **The XY dot** travels inset by its radius, so at a rail (a Drum Buss
    or Phaser at rest, a filter shut) it is whole rather than half off the
    pad's edge. This is `DeviceXY`, so the grid's tiles and the central
    views' pads get it too.
  - **A rack's macros** (`chain/RackFace`) rise to fill a tall cell under
    the mark, where they were a 22px strip under a mostly empty cell; a
    short cell keeps the strip. The first face to read the height.
  - Left as they were: the tiles and `deviceControls` faces (an XY or a
    slider fills any of the sizes, and stays one: at the narrowest a cell
    is still about 100×80), Permute's steps (eight across a narrow cell
    are thin, but a drag paints them), the instrument faces, the plug-in
    and Max marks.

## Consequences
- A face that should change with width no longer measures itself, and all
  of them step at the same bounds, so a narrowing chain changes its faces
  together.
- The steps are a guess from the Drum Rack and the iPad's chain; a face
  whose controls need a different bound should move a step, not add a
  private one. The audit found no reason to move one.
- A word too long for a narrow two-line band breaks where it must; Safari
  hyphenates it, headless Chromium does not ("Permut / e" in a shot).
- In a narrow two-row cell a Drum Rack's two-word pad names ("Bongo
  Lo") clip; the pads stay two across.
