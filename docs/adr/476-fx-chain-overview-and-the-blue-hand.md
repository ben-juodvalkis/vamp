# ADR-476: The FX Chain Overview, Type-First Tiles and the Blue Hand

## Status
**Proposed** (2026-10-25), on the branch `claude/fx-chain-overview-mock`
for Ben to try on the rig. The surface half needs a Live restart.

## Context
Each FX-grid tile took the first device on the track with its Live class
**and** its exact name, the name the tile itself gives a device it
inserts. So a preset dragged in from Live's browser (which keeps the
preset's name) was invisible to its tile, and touching the tile inserted
a second copy. A second Auto Filter was unreachable. The performer's own
racks had no door at all: the Audio Effect Rack view existed, showed the
first rack on the track (often one of the app's own) and nothing opened
it. And a controller following Live's blue hand followed the iPad only on
a tile tap.

## Decision
**Tiles match a device by type first.** Every native class the grid
drives belongs to one tile (measured across `devicePresets.ts`), so any
Auto Filter is the Filter tile's whatever its name. The classes several
tiles share (racks, Max devices, plug-ins) still match on the tile's name
(`utils/deviceSlotMatch`). With several of one type the tile controls the
performer's **pick**, else the first in chain order, and wears "1/2".

**The FX section has a second face, the chain overview**, behind a tiny
two-segment switch in its top-right corner (out of flow, so neither face
gives up a cell). It lists the selected track's devices in chain order on
the grid's ten-column ruler: name, real type when the name differs, the
tile that controls it, a rack's named macros as small meters, a
switched-off device dimmed. A tap opens the device's controls in the
central view, which stays up beside the list, and makes it the pick: the
tile's own view, the rack view on that rack (now naming it), or a generic
view of one slider per parameter for a device the app has no view for.

**The blue hand follows the iPad, and the iPad shows the hand.** A tap in
the overview and every gesture on a tile appoints the device
(`device/select`). The surface puts `song.appointed_device` on it when
selecting left it elsewhere, and reports wherever the hand goes —
`/looping/v3/device/appointed [devicePath]`, from its listener, after a
structural change that moves it, and on every accept. The overview marks
that device; a tile re-sends only when the hand is somewhere else. No
protocol bump: an older surface never sends the report.

## Consequences
- A renamed native device lights its tile, and the tile no longer loads a
  duplicate beside it.
- Picks last until the app reloads. Live's own selection does not move a
  pick: clicking the second Auto Filter in Live moves the hand, not the
  tile.
- A device inside a non-drum rack's chain reports its rack's path, the
  nearest holder the wire can name (`chains/` is still reserved).
- A held strip's fan-out finds a follower's device by the same rule.
- Not yet measured on the rig: whether a select ever leaves the hand
  behind (the write covers it either way), and whether the appointed
  listener fires for a hand moved by another control surface.
- `npm run shot:tour -- chain` shoots the overview on a demo chain.

## Tags
`fx-grid`, `chain-overview`, `blue-hand`, `appointed-device`, `racks`
