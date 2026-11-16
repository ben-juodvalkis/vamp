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
- **Every chip load of an effect type is a record of its own**
  (`stores/v6/landingEffects`), started as the `device/load` leaves: its
  track, its target (the track's chain, a scoped pad's, a held strip's
  track, or a rack chain the chain's own + chose), its type, and the values
  written to it so far. One per load, never per type, so a second Reverb
  beside the first holds its own values. (The first cut, the same day, used
  the FX grid's one slot per type and left a second copy to wait for Live.)
- **The chain draws a ghost cell for each** (`landingEffects.inChain`,
  oldest first), where Live will put it: a MIDI effect after the MIDI
  effects, anything else at the end of its chain. Its key is the one the
  arriving device's cell takes (class, default name, which of those), so
  the cell stays mounted when the device lands and a drag on it carries on
  into the real device.
- **Its control works at once.** `LandingScope` tells the tile which load
  it stands for (`landingScope` context, read by `BaseDeviceControl` and the
  Reverb tile): no device, drawn loading, its writes kept on the record and
  shown from there. It opens no view and loads nothing itself.
- **The new device is found by count, not by path.** Paths are positions,
  and an insert ahead of a device renumbers it. A load records how many of
  its type its target held, plus the loads of that type already on their
  way there (`before`); Live puts the new one after every other of its
  type, so it is the matching device at index `before`. Its held values are
  written to it and the record goes.
- **It is a ghost until Live has it**: a dashed edge, a grey name over no
  wash, the control drawn as a ghost tile's, still showing what was set.
  It cannot be reordered, opened or switched off, and nothing else in the
  chain reorders while it is there: it has no place in Live yet.
- A load Live refuses (`/looping/v3/error` on `device/load`, by its file or
  `native:<class>` and its pad) or never answers within 10 s drops its
  record and the values it held; the later loads of its type there expect
  one fewer. A pad's chain row is held while a load into it is on its way.
- A preset file from the browser with no `DEVICE_PRESETS` type, and
  Permute, load as before, with no ghost cell.

## Consequences
- The chain answers a chip at once, and nothing set during the load is lost.
- Values held for a landing cell are written as separate parameter sets
  after the device lands, as a ghost tile's always were, not as part of
  the load's undo step.
- Not measured on the rig: whether a device Live names other than the
  preset's `defaultName` lands as a new cell (a remount, which would end a
  drag in progress) rather than taking the landing cell's place, and
  whether Live's insert position always puts the new one after every
  other of its type (the count rule's assumption).
- Held values are kept by the parameter index the control resolves with
  no device to read names from; a device whose names put a parameter at
  another index would take the value there, as a ghost tile's always did.

## Tags
`effect-chain`, `optimistic-load`, `palette`, `ghost`
