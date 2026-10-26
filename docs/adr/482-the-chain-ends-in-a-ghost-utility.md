# ADR-482: The Chain Ends in a Ghost Utility

## Status
**Accepted** (2026-10-26). Extends ADR-478 (the FX chain overview). No Live
restart: interface only.

## Context
The track strips always end in Main. The user wanted the effect chain to end
the same way, in a Utility that is there to grab whether or not the track has
one: a gain stage at the end of the chain, a drag away.

## Decision
- A chain with no Utility ends in a ghost one, after the last device and
  before the + cell: the FX grid's own Gain tile (`UtilityControl`) in its
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
