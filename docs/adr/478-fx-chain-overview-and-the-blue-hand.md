# ADR-478: The FX Chain Overview, Type-First Tiles and the Blue Hand

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

**In the overview a device is switched and moved where it sits.** A
power button in each cell's corner writes Device On (parameter 0). A cell
dragged sideways moves the device in Live's chain: `device/move
[devicePath, index]`, the index where it ends up, which the surface clamps
and turns into `move_device`'s count-before-removal index. The instrument
stays put and nothing is dropped across it (Live keeps MIDI effects
before the instrument, audio effects after).

**A drum pad scoped in the Drum Rack view scopes the overview and the
hand.** While a pad is held or latched, the overview is that pad's chain
(its instrument from `vm.padFx`, its effects with the records its
`vm.padChain` row brings), in the pad's frame and chip as the scoped grid
is, and a tap opens an effect in the Drum Rack view's pane. Scoping a pad
appoints its instrument; letting the scope go appoints the rack.

**The chain is as wide as its length allows.** Up to five devices share
one row with the + cell, wide as the track strips get; past five, two rows
split evenly (`chainGrid`). One row keeps the controls full height; the
second row halves them, so it waits until six devices.

**A cell carries its tile's control**, and Permute its steps, MidiWheels
its wheels, the instrument its signature control (Omnisphere's ORB,
Drift's filter so far).

**A cell carries its tile's control.** A device the grid has a tile for
shows that tile inside its cell (the grid's own component, handed the
cell's device), so the chain can do whatever the grid can, on each device
of a type separately. A touch there picks the device and never reorders.

**Effects come from the browser, and the chain ends in a door to them.**
The browser's switch gains a fourth segment, Effect, listing a Place's
audio and MIDI effect presets (Instrument keeps instruments and kits). A
tap adds the preset to the selected track's chain, or the scoped pad's,
through `device/load` with no track prep; before, effect tiles were
greyed. The overview's last cell is a dashed + Effect that opens the
browser on Effect, on the Mac's effects Place (`catalog.effectsPlace`), a
Place cataloged for this whether or not it is ticked and kept off the rail
unless it is. The grid/chain switch is one button over the
section's top-left corner, where it no longer takes the Glue tile's taps.

**An effect preset tile is the preset's own control.** In the browser a
preset of any class a grid tile drives (and any effect rack, by its first
macro) draws that tile's control at the values its file saves; an Auto
Filter, for one, draws its curve (read from
the `.adv` on the Mac, mapped through Live's own units, measured: Frequency
is `20 · 1000^v` Hz). A tap loads it as saved; a drag loads it and sets the
values under the finger on the device that load lands, never on another of
its type.

**Vamp Devices holds the devices the app loads; a Sidebar Place is the
shelf** (2026-10-26). `catalog.effectsPlace` defaults to "Vamp Devices"; the
rig names its own shelf, "Audio-Midi Effects" (a Sidebar folder, in
`constants.local.json`), where the owner adds presets, and its Audio Effects
and MIDI Effects folders hold hard links to the Vamp Devices effects, so +
Effect shows the Wah and the amps beside the presets with one file behind
each. The tiles, the pedal and the surface load from Vamp Devices. The amp
racks (Guitar, Bass
Amp) and Note Chance joined it from the User Library's Effect Patches, so
every file tile names that Place and `paths.effectPresetsBase` is gone. The
browser draws it as Audio Effects and MIDI Effects by each item's kind and
leaves the plumbing out (`catalog.effectsHidden`); the files stay one folder
per device at the top, because 886 saved sets point at them by absolute
path (Permute 2,896 times), and moving them would break those sets.

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
- Moving a device the browser loaded this session has the `move_to_*`
  undo hazard: Edit → Undo that reaches the move can abort Live.
- A pad's instrument shows no power button: its parameters are the
  virtual-macro layer's and never reach the wire.
- `device/move` is a new address with no protocol bump: an older surface
  ignores it, so a drag on it does nothing until Live restarts.
- Effects appear only from ticked Places and the effects Place. Live's
  factory effect presets are not offered; a preset reaches + Effect once
  it is copied into Vamp Devices (under `Audio Effects/<device>/` merges
  into the browser's group of that name).
- The amp racks and Note Chance are on the owner's Mac only (gitignored:
  TONE3000 captures, a downloaded device). A general install has no Guitar
  or Bass Amp to load, as it had none before.
- Permute's header says Max audio effect (`aaaa`), so the browser files it
  under Audio Effects, as Live does.
- The Auto Filter tile's and view's type tables were wrong from 6 on (Live:
  Comb, Resampling, Notch+LP, Vowel); both read `autoFilterParams` now. The
  view also said Random for the LFO's Wander and SV2 for the MS2 circuit.
- The Places index's ETag was the service's version alone, which restarts
  at the same numbers, so a browser could keep an older server's index
  through a 304; it carries the server's start too now.
- `npm run shot:tour -- chain` shoots the overview on a demo chain, with
  a power toggle, a drag and a scoped pad.

## Tags
`fx-grid`, `chain-overview`, `blue-hand`, `appointed-device`, `racks`
