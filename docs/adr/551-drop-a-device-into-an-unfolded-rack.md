# ADR-551: Drop a Device Into an Unfolded Rack

## Status
**Accepted** (2026-11-20). Amends [ADR-529](529-rack-chains-unfold-in-the-effect-chain.md),
whose last decision had a drop onto a rack's inner cells land at the rack's
place. The interface takes it on its next load; the surface half needs a full
Live restart.

## Context
With the chain's + gone (ADR-548) and the off-rail effects screen with it
(ADR-550), the way to put an effect inside a rack was a rack chain's own +,
through the browser. A device already on the track could not be moved into a
rack at all from the iPad: dragging it over an unfolded rack's devices only
reordered it beside the rack.

## Decision
- **A top-level device dragged over a cell inside an unfolded rack, or over
  that chain's +, goes into that chain.** The cell under the finger lights (an
  outline in the on colour; the + fills in the rack's ink) and the chain holds
  still while it does, so the lit cell is the one under the finger. Let go and
  the device lands in that chain in front of the lit device, or at the chain's
  end on the +. Off those cells the drag reorders the top level as before.
- **New wire, `/looping/v3/device/move_into [devicePath, chainPath, index]`**
  (`DeviceCommandsComponent.handle_move_into`): `Song.move_device(device,
  chain, index)`, `-1` appending. A rack is never moved into a chain of its
  own: the interface offers no target there and the surface refuses it before
  asking Live. Live's own refusals come back as `write-rejected`.
- Not covered: dragging a device out of a rack, between racks, or into a
  folded rack. Cells inside a rack still do not drag.

## Consequences
- Moving a device the browser loaded this session and then undoing in Live
  carries the same hazard as every `move_device` (ADR-437).
- The drop sends no optimistic reorder: the chain redraws when Live's
  republish shows the device in its new place.
- Checked: the surface handler against the LOM fakes (5 tests), the drop
  target rule (`dropIntoTarget`, 3 tests), and a screenshot of the drag in
  flight (`shot:tour -- chain --only chain-drop-into`). Not yet seen in Live.

## Tags
`chain`, `racks`, `drag`, `wire`
