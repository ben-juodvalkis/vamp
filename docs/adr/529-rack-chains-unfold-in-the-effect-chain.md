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
- **The chain overview unfolds a rack the way the strips row unfolds a
  Group Track (ADR-410, ADR-413), nested.** A rack's cell carries a chevron
  at the right end of its header bar, right while folded and down while
  open, as a group strip's is (the rest of the bar's tap stays Device On).
  Unfolded, **every chain** follows the rack, in order: a **chain cell**,
  then that chain's devices as ordinary cells with their usual faces. The
  rack's outline grows an **arm** — the group panhandle's material in the
  rack's ink — over all its chains, and each chain cell grows its own arm,
  in the chain's colour, over its devices; what an arm covers hangs below it
  with a gap and keeps its own outline, so the nesting reads as the strips
  row's groups do. A rack among the devices unfolds the same way, a level
  lower, its arms stacked under its parents'; where the unfold wraps to the
  chain's second row the arms continue there. A tap on a rack's arm folds
  it; folding a rack folds the racks inside it. Which racks are open is
  this client's own state, keyed by the rack's path.
- **A chain cell is a small track strip.** Its header is the chain's name
  in its colour; a tap there is the chain's activator (Live's chain mute),
  as a tap on a strip's name mutes the track, and a switched-off chain wears
  the bypassed look. Its body draws the chain's volume as a strip draws its
  fader — a wash from the foot, edge ticks at the level, a hairline at 0 dB
  — and a **vertical drag anywhere on the cell, the name included**, sets
  the volume: relative, one cell height for the whole range, never a jump on
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
- A rack of many chains takes the room of all of them: the chain wraps to
  its second row sooner and every cell narrows. Fold what is not in use.
- An earlier cut the same day showed one chain at a time beside a chain
  list (Live's own device view); Ben asked for every chain's devices and the
  group grammar, and the list went.
- Chain pan and the chain selector's zones are not drawn; solo has a write
  but no control yet. Each volume frame is its own `property/set`, and Live
  takes each as an undo step, as it does a parameter drag.
- Works for Audio Effect, Instrument and MIDI Effect Racks alike. A device
  inside a rack opens its own registered view when it has one; an
  instrument inside an Instrument Rack opens the generic view, not its
  instrument page, and a nested Instrument or MIDI Effect Rack opens the
  generic view (the rack view reads Audio Effect Racks).
