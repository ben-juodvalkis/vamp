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

## Addendum (2026-11-20): no + in a rack chain, and a smoother landing
- **The rack chain's + is gone**, and with it the last way to open the
  browser on Effect from outside the rail (`chainAddTarget`,
  `openEffectsBrowser`). A drop now picks its side: over a device's left
  half it goes in front, over its right half behind, shown by a bar on that
  side of the lit cell. Over the rack's chain list it goes to the end of
  the chosen chain. An empty rack with one chain has no cell to drop on.
- **The landing no longer jumps.** The let-go cell used to glide back to
  its old slot, then vanish, and the chain redrew in one step when Live
  answered. Now it stays hidden where it was let go; when Live shows the
  device in its chain, the cells that stay slide to their new places and
  the device's new cell flies in from the drop. Live refusing the move
  (nothing after 2 s) brings the cell back.
- **A rack chain's cells are keyed by the chain row's names**, not the
  device records', which can lag the row by a message: a move into a chain
  gave two cells one key for that moment (`each_key_duplicate` in the
  console).
- Checked: the end state on the screenshot mock (which now plays out
  `device/move_into`), with no duplicate-key error. The motion itself was
  not captured: the harness's screenshot lands after the 220 ms animation.

## Tags
`chain`, `racks`, `drag`, `wire`
