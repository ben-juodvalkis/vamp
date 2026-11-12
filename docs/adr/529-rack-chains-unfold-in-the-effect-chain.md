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
  re-sends; a rename, colour, mute or solo re-emits the row. Two writable
  rows per chain, `chain.<i>.mute` and `chain.<i>.solo`.
- **The chain overview unfolds a rack as Live's device view does.** A
  rack's cell carries a fold chevron at the right end of its header bar
  (the bar's tap stays Device On). Unfolded, the rack's cell is followed by
  its **chain list** (a cell of rows in the chains' colours; a tap chooses
  the chain shown, the lamp is its activator) when it has more than one
  chain, then **the chosen chain's devices** as ordinary cells with their
  usual faces, in a panel tinted and banded in the rack's ink; an empty
  chain shows an "Empty" place. A rack among them unfolds the same way.
  Folding a rack folds the racks inside it. Which racks are open and which
  chain each shows is this client's own state, keyed by the rack's path.
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
- The chain list's selection is local, not Live's `selected_chain`: two
  clients cannot fight over it, and Live's own view does not follow it.
- Chain volume, pan and the chain selector's zones are not drawn; solo has
  a write but no control yet.
