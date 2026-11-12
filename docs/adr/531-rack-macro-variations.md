# ADR-531: A rack's macro variations, in its central view

## Status
**Accepted** (2026-11-12). Needs a Live restart (new surface rows). Builds
on ADR-529 and ADR-530.

## Context

Live's racks keep macro variations: snapshots of the macros, recalled from
the rack's variation panel. Nothing in Vamp reached them ("Variation" in
the code is the Stutter tile, Beat Repeat). Ben asked for them in the rack's
central view.

Measured on 12.4.25b1, on the Core Library's Drums Boombox (four
variations): Python has `variation_count` (listenable),
`selected_variation_index` (settable, not listenable, and refusing -1 once
set: "Variation index out of range"), `recall_selected_variation`,
`recall_last_used_variation`, `store_variation`,
`delete_selected_variation` and `randomize_macros`. Recalling the second
moved five of the eight macros at once. **No variation has a name in the
API.** The names are in the preset file, `<MacroSnapshot>`'s
`<SnapshotName>` ("Boombox", "Cheap Unit", "Push To Punch", "Hifi Pumper").

## Decision

- **The surface serves the variations** on the three chain-rack classes,
  through `RackChainDevicesComponent`: a read-only `variations` row
  (`{"count", "selected"}`, re-emitted by the count's listener and after
  every variation write, since the selection has no listener), and four
  writes, `variation.recall` and `variation.delete` (an index), and
  `variation.store` and `variation.randomize`.
- **The names come from the preset file the rack is named after.** Live
  names a loaded preset's device after its file, so the interface server
  (`GET /api/rack-variations?name=&count=`, `$lib/server/rackVariations`)
  finds `<rack name>.adg` in Live's own browser index (the Core Library,
  the Packs, every Place) and reads its snapshot names. A file is believed
  only when it holds exactly as many variations as Live reports; otherwise
  the variations are numbered. A renamed rack, one dragged from a file
  named otherwise, or a variation stored or deleted since the file was
  saved reads as numbers, never as wrong names.
- **The rack's central view draws them** (`central/RackVariations`) under
  the macros, in both the Audio Effect Rack and the Instrument Rack views:
  one button per variation, the selected one lit in the rack's ink; a tap
  recalls it, a hold of 800 ms deletes it; Store keeps the macros as a new
  variation; Rand randomizes them.

## Consequences

- A variation chosen in Live's own panel does not light here until Vamp
  writes a variation itself; the macros themselves follow at once.
- Once one is recalled, a rack always has a selected variation: Live has
  no way back to none.
- Storing or deleting a variation numbers them all: the count no longer
  matches the file, and Live gives a new variation no name Python can read.
- Not on the chain cell yet; the Drum Rack and the Pattern Rack views
  draw no variations.

## Tags
`racks`, `macros`, `variations`, `wire-protocol`, `central-view`
