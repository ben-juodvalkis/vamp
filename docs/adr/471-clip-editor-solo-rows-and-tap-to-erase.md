# ADR-471: Clip Editor — Solo Rows on the Note Names, a Tap Erases a Note

## Status
**Accepted** (2026-10-24). No Live restart (interface only). Amends the
note-editing gestures of ADR-382.

## Context
Editing one drum or one pitch in a busy clip meant aiming between its
neighbors: Fold already gives each played pitch an equal lane, but on a
kit or a dense part those lanes are thin. The Drum Rack view answers the
same need with its pads: touch one and the controls are that pad's.

Erasing a note took a double-tap, chosen so a near miss could not delete.
In practice it read as a tap that did nothing.

## Decision
**A note name solos its row, latched by a tap and momentary under a
hold** (the user's call), on Mute's and Solo's rule (`momentaryPress`,
ADR-427 addendum 3) and the Drum Rack pads' (one at a time). At
finger-down the roll's lanes become that pitch alone, the way Fold makes
them the played pitches, so the row takes the full height; notes on
other pitches are hidden and out of reach of a draw, a drag, the
velocity lane and Quantize. Let go under `MOMENTARY_HOLD_MS` and it
latches; at or over it, or if the browser cancels the press, the rows
from before the press come back. A press on the soloed row toggles back
to every row by the same rule, so holding it peeks at the whole clip and
letting go returns to the row. A press that turns into a pan before the
hold puts the rows back. A new clip starts with none. The soloed key
wears the ON ink at a wash.

**A tap on a note erases it.** A press is a drag only past 8 px (a
fingertip rolls on a tap; it was 2 px), and inside that slop the note no
longer moves. A note held past `MOMENTARY_HOLD_MS` and let go without
moving is left alone, so a grab abandoned mid-thought deletes nothing.

## Consequences
- **Double-tap on a note name no longer deletes every note on that
  pitch**: a tap means solo now. Clearing a pitch is a tap per note, or
  Live.
- A stray tap on a note deletes it. Whether Live's undo restores a note
  removed this way was not measured.
- A note dragged up or down while soloed steps only between the soloed
  rows; with one row soloed its pitch cannot change, which is the point.
- Hold-then-drag on a note name still scales that pitch's velocities;
  the row is soloed while the finger is down and the hold restores it.
- One row at a time: the first press hides every other name, so a
  second finger has nothing to land on. A first cut soloed several rows
  pressed together; the latch/momentary rule replaced it the same day.

## Tags
`clip-view`, `gesture`, `notes`
