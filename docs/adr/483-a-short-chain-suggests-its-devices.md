# ADR-483: A Short Chain Suggests Its Devices

## Status
**Accepted** (2026-10-26). Extends ADR-482 (the ghost Utility), and moves
that ghost into a column of its own. No Live restart: interface only.

## Context
The ghost Utility made one device a drag away on every chain. The user
wanted the same for the devices a track most often starts with, but only
while the chain is short: a drum track wants a Drum Buss, a melodic one an
Echo and an Auto Filter. Once real devices fill the chain, the suggestions
should go so it doesn't get crowded. The user also wanted the ghost
Utility no wider than the side bars.

## Decision
- While a track's chain holds fewer than three effects (the instrument not
  counted), ghost cells stand between the last device and the + cell:
  a Drum Buss on a drum track (`isDrumTrack`, the rule the FX grid's Drum
  cell uses), an Echo and an Auto Filter on any other. A type the chain
  already has is not suggested. Not on a pad's chain.
- A ghost cell is the FX grid's own tile in its ghost state, in a dashed
  cell named for the device; its first drag frame loads the device
  (ADR-167), as the ghost Utility does. While a finger holds a ghost, the
  set of suggestions stays as it was and the loaded device's cell waits
  behind it, so nothing slides under the finger as the load lands.
- The ghost Utility leaves the grid for a column of its own after the
  + cell, full height, the side bars' width (`--sidebar-width`), the way
  the strips end in Main.

## Consequences
- A short chain is one or two cells longer, so it reaches the
  two-row wrap one device sooner; at three effects the suggestions go.
- The suggestions are fixed lists in `ChainOverview.svelte`
  (`DRUM_SUGGESTIONS`, `MELODIC_SUGGESTIONS`, `SUGGEST_BELOW`).

## Tags
`fx-chain`, `chain-overview`, `ghost-tile`, `suggestions`
