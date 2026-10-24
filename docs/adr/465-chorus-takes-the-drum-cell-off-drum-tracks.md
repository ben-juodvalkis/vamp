# ADR-465: The Chorus Takes the Drum Cell Off Drum Tracks, With a View of Its Own

## Status
**Accepted** (2026-10-23). Commits `ed9c4e2`, `dd2276b` and the one that
records this ADR. Interface only: no wire change, no protocol bump.
Partly reverses 2026-10-15, when the Chorus tile left the grid and its
family joined the Auto Pan view.

## Context
The grid's Drum cell is the Drum Buss (ADR-431), which earns its place on
a drum track and sits unused on a synth, a keys track or a guitar. The
Chorus family (the Chorus XY, Blur, Comb, Phaser) had no tile since
2026-10-15 and lived as two columns of the Auto Pan view.

## Decision
**The Drum cell holds the Chorus XY on any track that is not a drum
track.** A drum track is one whose instrument came from the Drum or Perc
category (the recorded preset's category folder, else the recorded role).
With no category recorded (a track made in Live, loaded before the app
recorded one, an xFull kit), a Drum Rack on the track makes it one.
The category answers first because the class alone is wrong both ways:
45% of Drum/Perc presets are not Drum Racks, and 592 Drum Racks are filed
under Inst, Synth or FX. **An audio track always holds the Chorus**,
whatever category its clips were loaded from (a drum loop included; added
the same day, the user's call). Under a track hold the held track decides.

**In that mode the Chorus tile opens a Chorus view**: Blur's dry/wet,
Comb and Phaser, one ruler, a slider one share and a pad two. The Auto
Pan view drops its Chorus group there and is Auto Pan | the Octave |
Pitch Hack.

**On a drum track nothing changes**: the Drum tile stays, and the Chorus
family stays in the Auto Pan view. A touch on that view's Chorus XY opens
the `chorus` view type, which on a drum track draws the Auto Pan view, so
the touch never swaps the view out from under the finger.

One rule decides all three places: `isDrumTrack` in
`services/trackCategory.ts`, read through `drumCellHoldsChorus()`
(`device-panel/drumCell.svelte.ts`) by the grid, the Chorus view and the
Auto Pan view, so they cannot disagree.

## Consequences
- The Chorus XY is a grid tile again everywhere but a drum track, and a
  drum track keeps the Drum Buss where it was.
- A drum preset filed outside Drum and Perc (a Drum Rack under Inst)
  shows the Chorus; a Perc one-shot in a Simpler shows the Drum. That is
  the category's call, the same one the strip's device band makes.
- The Phaser pad is one component (`views/chorus/PhaserPad.svelte`)
  drawn by both views.

## Tags
`fx-grid`, `chorus`, `drum-buss`, `central-view`, `track-category`
