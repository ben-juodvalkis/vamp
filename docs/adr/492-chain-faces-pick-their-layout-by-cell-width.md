# ADR-492: Chain Faces Pick Their Layout by Cell Width

## Status
**Accepted** (2026-10-28). No Live restart: interface only.

## Context
The chain overview (ADR-485) gives each device a cell as wide as the chain
leaves it: a three-device chain gives broad cells, a long or two-row chain
narrow ones. Each face drew one way regardless. The Drum Rack's pads, laid
out as Live lays them (rows, lowest along the bottom), wanted four across
where there is room and two where there is not, and its first cut measured
its own width. Ben asked for the general case: any device's layout and
controls in the chain may vary with the cell's width.

## Decision
- **The chain measures, the face chooses.** `chain/CellSize.svelte` wraps
  every face in the chain, measures the room it leaves, and provides it
  through context (`chain/cellSize.ts`): the width and height in CSS px and
  the width in three steps, `narrow` (under 120), `medium` and `wide`
  (236 and up, four 56px tiles side by side).
- A face reads it with `useCellSize()` and picks its layout. Outside the
  chain (a browser tile, a central view) there is no context and the face
  draws its default, so nothing changes there.
- `data-cell-width` on the wrapper carries the step, for CSS and tests.
- The Drum Rack is the first to use it: four pads across when `wide`, two
  otherwise.

## Consequences
- A face that should change with width no longer measures itself, and all
  of them step at the same bounds, so a narrowing chain changes its faces
  together.
- The steps are a guess from the Drum Rack and the iPad's chain; a face
  whose controls need a different bound should move a step, not add a
  private one.
- MidiWheels still chooses side-by-side from the chain's row count, not
  its cell. It could move onto the cell's height later.
