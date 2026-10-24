# ADR-469: The Master Strip Joins the Strip Row; the Mini Session Takes Its Sidebar Row

## Status
**Accepted** (2026-10-24). Tried on branch `master-in-strips`, merged the
same day. Interface only; no wire change (the global stop uses
`/looping/v3/scene/stop`, which already existed).

## Context
The right sidebar's first row, level with the track strips, held the
master strip. The mini session column (the selected track's clips, shown
while the full clip grid is hidden) led the Clip view's control rail, so
it was on screen only while the Clip view was. Its cells used the full
grid's gestures: a body tap selected, a left strip fired, a hold focused.

## Decision
**The master strip is the last column of the strip row**, after New Audio
/ New MIDI, pinned with them at the row's right end. It shrinks with the
strips and grows no wider than the sidebar; under 110px its key stacks
over its time signature and the block takes two bands so each half keeps
the touch floor. The New column is a strip's width.

**The mini session takes the sidebar's first row** while the full grid is
hidden (`uiPrefsStore.miniSessionActive`); in session mode the row is
empty. The Clip view's rail is seven columns again.

**The mini's own gestures** (SlotGrid `tapFires`):
- A tap anywhere on a cell launches it; a playing clip re-fires.
- A hold past 500 ms fires nothing: it moves the pedal's highlight there
  and, on a clip, opens the Clip view.
- No action strip. Only an empty slot wears a mark, centred: ● on an armed
  track, ■ on an unarmed one, whose tap stops the track (the mini sends
  the stop itself: what `slot.fire()` does on an unarmed empty slot is
  unmeasured).
- The stop button is a strip's name-band height, level with the strips'
  name / mute buttons.

**With Main selected** the mini is the scene rail's mini face: a tap
launches a scene, a hold selects it, and the footer is one global stop.

## Consequences
- Two more columns in the strip row: on the iPad the row scrolls from the
  twelfth track (it held thirteen before). Accepted; the fitting-row touch
  scenarios run on ten tracks.
- The clips are on screen in every central view, not only the Clip view.
- The mini's cells and the full grid's mean different gestures by design;
  the full grid is unchanged (select / strip / focus).
- The UI has a global stop again, on Main's mini face only.

## Tags
`layout`, `tracks`, `master`, `mini-session`, `gestures`, `scenes`
