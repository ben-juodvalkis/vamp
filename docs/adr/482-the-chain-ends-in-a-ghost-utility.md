# ADR-482: The Chain Ends in a Ghost Utility

## Status
**Accepted** (2026-10-26). Extends ADR-478 (the FX chain overview). Amended by
ADR-483: the ghost sits in its own column, the side bars' width. Then
moved, the same day, at the user's call: the Utility is the right
sidebar's top row (level with the FX section), in the loop brace's place,
ghost or live; the chain no longer draws it. No Live
restart: interface only.

## Context
The track strips always end in Main. The user wanted the effect chain to end
the same way, in a Utility that is there to grab whether or not the track has
one: a gain stage at the end of the chain, a drag away.

## Decision
- A chain with no Utility ends in a ghost one, after the + cell (the user,
  the same day; it sat between the last device and the + at first): the FX
  grid's own Gain tile (`UtilityControl`) in its
  ghost state, in a dashed cell titled Utility. Under a pad scope it is the
  pad's, as the tile is.
- Its first drag frame loads a Utility, as a ghost grid tile does (ADR-167);
  a tap loads nothing. Live inserts a native audio effect at the end of the
  chain, which is where the ghost already sits.
- The ghost stays under the finger until it lifts. Its tile resolves its slot,
  so once the Utility arrives the same drag drives it; the real cell is held
  back until the release and then takes the ghost's place.
- A chain that has a Utility anywhere shows no ghost.

## Consequences
- Every chain without a Utility is one cell longer, and the grid wraps to two
  rows one device sooner.
- The ghost is not a device: it cannot be reordered or dropped on, and a cell
  dragged past the last device stops before it.

## Tags
`fx-chain`, `chain-overview`, `ghost-tile`, `utility`
