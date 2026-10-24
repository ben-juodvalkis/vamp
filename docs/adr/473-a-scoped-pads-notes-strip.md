# ADR-473: A Scoped Pad's Notes Strip in the Drum Rack View

## Status
**Accepted** (2026-10-24). No Live restart (interface only).

## Context
Holding or latching a pad in the Drum Rack view scopes the controls to
that pad, but its part in the clip could only be seen and edited in the
clip editor, a different view showing every pad at once.

## Decision
**While a pad is scoped, a strip of its notes sits under the controls**
(`views/drum/PadNotesStrip.svelte`). It spans the track's playing MIDI
clip's window (`useClipPads`, which already follows that clip, now hands
over its path and `clipViewWindow`) in steps: 16ths up to 2 bars, 8ths up
to 4, beats past that. Each of the pad's notes is a bar at its own start,
a step wide, as tall as its velocity, in the pad's colour. A vertical drag
on a step moves that note's velocity, relative to where it was so a touch
never jumps it, and the release writes it (`sendModifyNotes`). The step
geometry and the drag are pure functions in `drum/padNotesStrip.ts`.

The notes are read and written by clip path (`requestRichNotes`), which
the surface serves for any clip, so the strip needs no clip focus in Live.
They are re-read on the clip's `notes/changed`.

On the DrumCell, Sampler and Simpler kits the strip is a third row of the
lead grid, from Gain to the right edge, with the pads running down beside
it; on the other kits it is the foot of the controls column. Either way
the controls give up about a third of their height. An effect's pane on
the scoped pad hides it.

## Consequences
- With nothing playing on the track the strip says "No clip playing" and
  edits nothing; the clip Live has focused is not used.
- Only velocity is edited here; adding, moving or deleting a pad's notes
  is still the clip editor's.
- An edit made in Live itself shows once the clip next reports
  `notes/changed`.

## Tags
`drum-rack`, `clip-notes`, `velocity`, `gesture`
