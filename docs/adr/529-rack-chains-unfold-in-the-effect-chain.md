# ADR-529: Rack chains unfold in the effect chain

## Status
**Accepted** (2026-11-12). Protocol 3.13.0; needs a Live restart (surface
change). Extends issue #491's pad chains (ADR-430) to every rack whose
chains the user orders. Builds on ADR-485 (the FX section is the chain
overview).

## Context

The effect chain stopped at a rack's own cell. Its macros showed, and a tap
opened the rack view, but nothing inside an Audio Effect Rack — its chains,
the devices on them — could be seen or played from the iPad: the wire's
path grammar had kept `chains/<index>` reserved since protocol 3.0, and the
surface's walk and listeners stopped at a track's device list. Ben asked to
reach chains and devices inside racks, folding and unfolding them as in
Live.

## Decision

- **The path grammar takes `…/devices/<N>/chains/<i>/devices/<j>`** for an
  Audio Effect, Instrument or MIDI Effect Rack, by chain index, recursive.
  A Drum Rack's chains stay reachable by pad note only (its `chains/<i>`
  is `path-not-found`). Every device command, `param/*` and `property/*`
  resolve through it unchanged, and `compose_device_path_for` names a
  device on a rack's chain by it, so Live's blue hand on such a device is
  framed on its cell.
- **The surface serves a rack's chains on demand**, the pad-chain pattern
  applied to racks (`RackChainDevicesComponent`): a `chain_devices` row
  (the chains, their colour, activator and solo, and each device's class,
  name and type) whose every cold read also sends a `rack-chain` scoped
  tree — the D/P records of every device on every chain, one level deep —
  and, while subscribed, value listeners on all of their parameters. A
  chain or device added, removed or moved advances the generation and
  re-sends; a rename, colour, mute, solo or volume change re-emits the row.
  Three writable rows per chain: `chain.<i>.mute`, `chain.<i>.solo` and
  `chain.<i>.volume` (the chain's mixer volume, 0..1, 0.85 = 0 dB).
- **The chain overview unfolds a rack as Live's device view does.** A
  rack's cell carries a chevron at the right end of its header bar, right
  while folded and down while open (the rest of the bar's tap stays Device
  On). Unfolded, the rack's cell is followed by its **chain list** — one
  cell, "Chains", a row per chain in its colour — when the rack has two or
  more chains, one unit wide (a slider's width), and then **the chosen
  chain's devices** as ordinary cells with their usual faces (nothing for a
  chain with none: its row in the list says it is chosen). A tap on a row
  chooses the chain shown, and **the chosen chain is Live's selected chain**
  (`RackDevice.View.selected_chain`, the rack's writable `selected_chain`
  row, an index, held while the rack is open): a tap selects it in Live and
  selecting one in Live shows it here. Measured on 12.4.25b1: settable from
  Python, with a `selected_chain` listener; inserting a chain selects it. The rack's outline grows an **arm** — the
  Group Track panhandle (ADR-410, ADR-413) in the rack's ink — over the
  list and the devices, which hang below it with a gap and keep their own
  outlines; a tap on the arm folds the rack. There is one arm per rack,
  none per chain. A rack among the chosen chain's devices unfolds the same
  way, a step lower, its arm stacked under its parent's.
- **The fold mirrors Live's own, both ways.** A rack is open exactly while
  Live shows its chain devices — the rack's Show Devices toggle,
  `RackDevice.View.is_showing_chain_devices`, carried as the rack's
  writable `show_devices` row, which the chain overview holds for every rack
  it draws. Unfolding in Vamp turns Show Devices on in Live, and Live's
  chain list (`is_showing_chains`) with it where the rack allows one;
  folding turns both off; toggling Show Devices in Live folds or unfolds
  the rack here through its listener. Each rack keeps its own state, nested
  ones included, as in Live. Measured on 12.4.25b1: both properties are
  settable from Python; `is_showing_chains` refuses on a one-chain rack
  ("Rack needs at least 2 chains to show in-line mixer", `can_show_chains`
  False); `view.is_collapsed` (the device's own fold triangle) is not
  mirrored.
- **A chain row is a small fader.** The lamp at its left is the chain's
  activator (Live's chain mute), a tap there switching it; the row shows
  the chain's volume as a fill in its colour from the left edge, with a
  tick at 0 dB, and a **drag up or down anywhere on the row** sets it:
  relative, 160 px of travel for the whole range, never a jump on
  touch-down.
- **A device inside a rack is itself everywhere it is drawn.** Its cell's
  control writes its own parameters (a device handed to a tile is never a
  ghost, so a drag can never load a second copy onto the track), and a tap
  opens its own central view: the tap makes it its type's pick, and the
  slot resolution admits a picked rack-chain device beside the track's own
  devices. The rack view and the generic view find a picked nested device
  by path.
- Cells inside a rack are not dragged; a drop of a top-level cell onto
  them lands at their rack's place.

## Consequences

- Protocol 3.13.0: six version literals move together; a 3.12.0 surface
  answers the new paths `path-not-supported`, and the UI refuses it by
  version.
- A rack's devices never enter the whole-song tree: an unfolded rack costs
  one row and one bundle, and its listeners exist only while it is open.
  Up to 512 parameter listeners per rack.
- Because the fold is Live's, a rack Live shows unfolded (the default for
  many saved racks) arrives unfolded here, and folding it on the iPad folds
  it in Live, for every client and in the saved set.
- A rack of many chains takes the room of all of them: the chain wraps to
  its second row sooner and every cell narrows. Fold what is not in use.
- A cut the same day drew every chain at once in the Group Track grammar
  (ADR-410, ADR-413): a strip-like cell per chain followed by its devices,
  under nested arms. An empty chain read as one more device after the last,
  and Ben wanted the chain selector back: the list returned, its sideways
  fader becoming the row's vertical drag, and the chains' own arms went
  (the rack's stays).
- Chain pan and the chain selector's zones are not drawn; solo has a write
  but no control yet. Each volume frame is its own `property/set`, and Live
  takes each as an undo step, as it does a parameter drag.
- Works for Audio Effect, Instrument and MIDI Effect Racks alike. A device
  inside a rack opens its own registered view when it has one; an
  instrument inside an Instrument Rack opens the generic view, not its
  instrument page, and a nested Instrument or MIDI Effect Rack opens the
  generic view (the rack view reads Audio Effect Racks).
