# ADR-540: An Effect Is a Cell Before Live Has It

## Status
**Accepted** (2026-11-16). Builds on ADR-167 (a ghost tile loads on its
first drag, its writes held until the device lands) and ADR-523 (the
chain's palette bar). Interface only: no wire change, no Live restart.

## Context
Ben asked for effect loading to be optimistic: "any changes i make while
waiting for it to load will be transmitted to live", and then "maybe the
loaded effect in the chain should be ghost ui until live loads it". A
palette chip sent `device/load` and drew nothing until Live's republish
showed the device, so the chain sat unchanged for the load's round trip
and there was nothing to touch. The FX grid's tiles already had the rest
of it: a slot in `loading` holds a drag's values (`pendingParams`) and
`checkLoadingCompletion` writes them to the device that arrives.

## Decision
- **A chip for an effect the chain does not carry yet loads through that
  type's slot** (`chainEffects.landsAsSlot` → `loadFxGridDevice`), in the
  chain's scope: the track, a scoped pad, or a held strip's track. A type
  the chain already holds, a file from the browser, and a load into a
  rack's chain the chain's own + chose keep the plain `device/load`, with
  no cell before Live answers: the slot is one per type, so a second
  Reverb has no slot of its own to hold values for.
- **The chain draws a landing cell for every type loading in its scope**
  (`fxGrid.loadingTypes`, oldest first), where Live will put it: a MIDI
  effect ahead of the instrument, anything else at the end. Its key is the
  key the arriving device's cell takes (class, default name, which of
  those), so the cell stays mounted when the device lands and a drag on it
  carries on into the real device.
- **Its control works at once.** The tile has no device and resolves the
  loading slot: a drag's values are held as pending and shown from there
  (`BaseDeviceControl`'s `pendingValue`, read by `ControlTile` and the
  Reverb tile), then written to Live when the device lands.
- **It is a ghost until Live has it**: a dashed edge, a grey name over no
  wash, the control drawn as a ghost tile's, still showing what was set.
  It cannot be reordered, opened or switched off, and nothing else in the
  chain reorders while it is there: it has no place in Live yet.
- A load that fails, or that Live never answers within the slot's 10 s,
  puts the slot back to ghost and the cell goes, with its held values.

## Consequences
- The chain answers a chip at once, and nothing set during the load is lost.
- Values held for a landing cell are written as separate parameter sets
  after the device lands, as a ghost tile's always were, not as part of
  the load's undo step.
- Not measured on the rig: whether a device Live names other than the
  preset's `defaultName` lands as a new cell (a remount, which would end a
  drag in progress) rather than taking the landing cell's place.

## Tags
`effect-chain`, `optimistic-load`, `palette`, `ghost`
