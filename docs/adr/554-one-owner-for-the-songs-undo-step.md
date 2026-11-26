# ADR-554: One owner for the song's undo step

## Status
**Accepted** (2026-11-25; issue #14, item 2)

## Context

Several components group their writes into one Live undo step with
`song.begin_undo_step()` / `end_undo_step()`. DrumSwapComponent holds one open
for a whole similar-sound swap, up to 60 s (ADR-439). DrumVirtualMacroComponent
and MidiWheels open and close one around each gesture. Devices, Clips,
DeviceLoad, SimplerLoad and KeyDetect do the same around their writes.

Live's undo steps are not reference-counted. An inner `end` closes the step an
outer `begin` opened. This was measured on Live 12.4.15b2 on 2026-09-16, and
again on Live 13.0b26 on 2026-11-25.

On the rig (2026-11-25) a pad's Decay moved through `vm.pad.36.decay` while a
swap's step was open. In three runs of four, one Undo reverted the decay
together with the swap's later changes, and a second Undo reverted the swap's
earlier ones. A Drum Rack macro or a wheel moved mid-swap split the swap in
two. The measurements are in `docs/reference/live-api-measurements.md` under
"Song".

## Decision

- **Every component goes through `component_util.begin_undo_step` /
  `end_undo_step`.** None calls `song.begin_undo_step()` itself.
- **They count per song.** A begin while a step is open joins that step, and
  only the outermost end calls Live. The count is keyed by the song's
  `_live_ptr`, because each component may hold its own wrapper of the song.
- **Callers close in any order.** A swap that finishes mid-gesture leaves the
  step open until the gesture's idle close.
- **A new surface instance starts at zero** (`reset_undo_steps` in
  `LoopingSurface.__init__`). An instance torn down mid-gesture therefore
  cannot leave a level behind that would keep every later begin from
  reaching Live.

## Consequences

- A gesture made during a swap is now part of the swap's single undo step:
  one Undo reverts both. Before, the steps crossed and split the swap.
- A long-held step now holds everything written while it is open. For the
  swap, that is at most the 60 s `SWAP_UNDO_MAX_MS`, the bound it already had.
- An owner that begins and never ends keeps Live's step open until the
  surface restarts, as a bare `begin_undo_step()` would.
- Tests: `surface/tests/test_undo_owner.py`.

## Tags
`undo`, `drum-swap`, `drum-virtual-macros`, `surface`, `live-api`
