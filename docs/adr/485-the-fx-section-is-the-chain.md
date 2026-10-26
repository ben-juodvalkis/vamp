# ADR-485: The FX Section Is the Chain

## Status
**Accepted** (2026-10-26). Supersedes the FX grid's layout decisions
(ADR-438 and its addendum, ADR-465's Drum-cell Chorus, ADR-467) and
ADR-478's switch between the grid and the chain overview. No Live restart:
interface only.

## Context
Since ADR-478 the FX section had two faces behind a switch: the FX grid (a
fixed ten-column board of one tile per device type, a ghost where the track
had none) and the chain overview (the track's own devices, in order). The
chain grew everything the grid gave: each device's own control, pictures, a
Recent section and + Effect to add devices, and the Utility in the right
sidebar. The user committed to the chain: "remove all the old fx grid stuff".

## Decision
- The FX section is `ChainOverview` alone. `FXGrid.svelte`, the switch
  (`FxPanelSwitch`) and `fxChainStore.mode` are gone.
- `fxGridLayout.ts` loses the grid's placement: `col` / `row` / `span` /
  `rowSpan` / `hidden`, `cellFor`, the `*_CELL`s, `FX_GRID_COLUMNS`. It stays
  as the slot table (a position per device type and its tile), which tiles,
  chain cells and central views resolve their device through. A position is
  a name, not a place.
- The Drum cell's Chorus rule (`drumCell.svelte.ts`) is gone; the Drum Buss
  view always leads with its Drum XY.
- The device tiles stay: they are the chain cells' faces.
- The status strip and the transport header keep their ten-column ruler,
  which no longer lines up with tiles.

## Consequences
- A device's view opens from its chain cell. A view for a device the track
  does not hold is reached by loading one (Recent, the browser).
- The grid followed a held track strip (a hold scoped the grid to that
  track); the chain shows the selected track's chain only.
- Shot states open views from chain cells (`openCell`), putting the device
  on the Lead track's chain first.

## Tags
`fx-chain`, `fx-grid`, `chain-overview`, `removal`
