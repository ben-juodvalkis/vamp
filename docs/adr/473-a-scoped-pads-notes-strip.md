# ADR-473: A Scoped Pad's Notes Strip in the Drum Rack View

## Status
**Accepted** (2026-10-24). No Live restart (interface only).

## Context
Holding or latching a pad in the Drum Rack view scopes the controls to
that pad, but its part in the clip could only be seen and edited in the
clip editor, a different view showing every pad at once.

## Decision
**While a pad is scoped, its row of the clip sits under the controls**
(`views/drum/PadNotesStrip.svelte`). It spans the track's playing MIDI
clip's window (`useClipPads`, which already follows that clip, now hands
over its path and `clipViewWindow`) over steps: 16ths up to 2 bars, 8ths
up to 4, beats past that. Each of the pad's notes is a full-height block
as long as the note, inked by velocity as the clip editor inks a pad's
notes (`noteColor`). On a note, a drag sets off one way or the other: up
or down moves its velocity (relative, so a touch never jumps it), sideways
moves it step to step with the clip editor's quantizing drag
(`dragSnapStart`, ADR-472), kept inside the window; the release writes it
(`sendModifyNotes`). A quick tap deletes it (`sendRemoveNotes`), as a tap
on a note in the clip editor does (ADR-471); a press held past
MOMENTARY_HOLD_MS that lets go in place does nothing. A touch hits a note
only by landing on it, so the empty step beside a note is its own target.

On an empty step (the user's call, the same day): a tap adds a note there;
a press that swipes paints a note on every step it crosses, filling any a
fast swipe skips and leaving a step that already holds a note alone; and
travel up or down in the same gesture, before or after painting, sets the
velocity of every note the stroke made, once it is past a 12px deadband
(so a sideways swipe's wobble moves nothing). New notes are a step long at
velocity 100, written on release in one add (`sendAddNotes`), on screen at
once under temp ids that Live's ids replace. The geometry and
both drags are pure functions in `drum/padNotesStrip.ts`. **Q**, a
button at the strip's right end, quantizes the pad's notes to the strip's
steps, 100%, in one write (`quantizedNotes` in `clipGesture.ts`, which the
clip editor's Quantize now calls too); it is disabled while every note is
on a step.

(First drawn the same day as velocity bars, a mini fader per note; the
user's call made it the row itself.)

The notes are read and written by clip path (`requestRichNotes`), which
the surface serves for any clip, so the strip needs no clip focus in Live.
They are re-read on the clip's `notes/changed`.

On the DrumCell, Sampler and Simpler kits the strip is a third row of the
lead grid, from Gain to the right edge, with the pads running down beside
it; on the other kits it is the foot of the controls column. Either way
it is one pad row tall, a quarter of the pads' height, its top level with
the fourth pad's, and the controls give that up. An effect's pane on the
scoped pad hides it.

## Consequences
- With nothing playing on the track the strip says "No clip playing" and
  edits nothing; the clip Live has focused is not used.
- A note's length is not changed here: that is still the clip editor's.
- An edit made in Live itself shows once the clip next reports
  `notes/changed`.

## Tags
`drum-rack`, `clip-notes`, `velocity`, `gesture`
