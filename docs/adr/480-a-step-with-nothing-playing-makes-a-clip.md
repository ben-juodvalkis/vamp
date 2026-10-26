# ADR-480: A Step Added With Nothing Playing Makes a Clip

## Status
**Accepted** (2026-10-26). Partly supersedes ADR-473 (its "No clip
playing" consequence). Needs a Live restart (new surface handler).

## Context
The Drum Rack view's pad strip (ADR-473) edits the scoped pad's row of the
track's playing clip. With nothing playing it said "No clip playing" and
did nothing, so starting a beat from the pads meant leaving for Live to
make a clip first. The user's call: adding a step there should make a
one-bar clip and play it.

## Decision
- **With nothing playing, the strip is one empty bar.** The first step
  added there (a tap or a paint stroke) sends
  `/looping/v3/clip/create [slotPath, lengthBeats]` with a bar's length
  (`barBeats` off the session's time signature), then adds the stroke's
  notes to `slotPath/clip` in the same turn. The surface takes messages in
  order, so the clip exists when the notes arrive.
- **The slot** is the pedal's (the selected scene's) when it is empty on
  this track, else the track's first empty slot (`slotForNewClip`). Every
  slot full: nothing is made, logged.
- **The surface makes it and fires it** (`ClipsComponent.handle_create`:
  `create_clip` in one undo step, then `fire`), so the step is heard at the
  next launch boundary; firing with the transport stopped starts it, as
  Live's own clip launch does. It never replaces a clip: an occupied slot
  is `write-rejected`.
- **While the launch is queued** the strip keeps editing the clip it made
  (the slot pulses as a tap-launched one does). Once the track plays it,
  the playing clip takes over, which is the same clip. A different clip
  playing, or another track, drops the made one.

## Consequences
- The one new wire is `clip/create`; it has no reply. A refusal shows on
  the error channel and the strip's optimistic notes are dropped when
  their add fails.
- If the clip is stopped again, the next step on an idle track makes
  another clip rather than going back to the one it made.
- A track whose slots are all full gets no clip; add a scene in Live.

## Tags
`drum-rack`, `clip-notes`, `wire`, `clip-lifecycle`
