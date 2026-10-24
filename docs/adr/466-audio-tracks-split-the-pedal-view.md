# ADR-466: On an Audio Track the Gtr Tile Opens a Guitar View, and the Saturator's View Takes the Drum Buss

## Status
**Accepted** (2026-10-23). Interface only: no wire change, no protocol
bump. Builds on ADR-465 (the Chorus takes the Drum cell off drum tracks).

## Context
One view, `PedalCentralView`, held the Pedal, the Guitar rack with the
Wah, the Shifter, and the Saturator's Output and Mix over Redux. The
Saturator, Gtr and Bass tiles all opened it. On an audio track the grid
has its own Gtr column, so the guitar controls had a door of their own
that opened a view mostly about other things. And since ADR-465 an audio
track's Drum cell holds the Chorus, which left the Drum Buss with no
tile there.

## Decision
**On an audio track the view splits in two.**
- The Gtr and Bass tiles (and the `pedal` view type) open
  `GuitarCentralView`: the Pedal (tone pad, Drive, type), then the Guitar
  rack with the Wah (Spring/Room over Tremolo). The Gain stays the grid's.
- The Saturator tile opens the rest: the Shifter, Output and Mix over
  Redux, then the **Drum Buss**, its Drum XY first and then the Drum Buss
  view's own controls (Trim over Comp, Soft/Medium/Hard, Drive, Crunch,
  Damp, Boom), embedded (`DrumBussCentralView embedded`).

**Amended the same day (the user's call): MIDI tracks get the Gtr slider
too**, under Rand Oct in column 1, and so the same split. The Drum Buss
joins the Saturator's view wherever the Drum cell holds the Chorus (every
audio track, every track that is not a drum track; ADR-465). Only master,
which has no Gtr, keeps one whole Pedal view, Gain included, whichever tile
opened it, so a touch inside it never swaps the view out from under the
finger.

`PedalCentralView` takes a `part` (`all` · `guitar` · `effects`) and,
left out, follows the track: split wherever `gridHasGuitar()`
(`device-panel/drumCell.svelte.ts`; the held strip's track while one is
held, else the selected one). The view carries the Gain only whole: split,
the Gtr slider is the Gain.

## Consequences
- The guitar controls are one tap from the Gtr column on an audio track,
  in a view that is only theirs.
- The Drum Buss is reachable on an audio track again, now that its cell
  holds the Chorus.
- The Drum XY embedded in the Saturator's view keeps the view up when
  touched (`disableCentralViewOnTap`).

## Tags
`fx-grid`, `central-view`, `guitar`, `pedal`, `drum-buss`, `audio-track`
