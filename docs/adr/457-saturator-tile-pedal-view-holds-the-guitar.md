# ADR-457: The Saturator Is the Grid Tile Again; Its View Is the Pedal View, Which Takes In the Guitar Rack

## Status
**Accepted** (2026-10-05; recorded 2026-10-13). Supersedes the second
half of ADR-431, "the Saturator goes back into the Pedal view". ADR-431's
Drum Buss tile and view stand. Commits `77ad1b5`, `230a731`, `0fef5a9`,
`5b8b624`, `6fa7488` and `3fe8866`, with later view tuning through
2026-10-12.

## Context
ADR-431 put the Drum Buss on the Saturator's tile and moved the Saturator
into the Pedal view, as an XY plus four faders. The Pedal's own XY was
the grid tile (fx5). The Guitar rack had a view of its own
(GuitarCentralView), reached from the Gtr tile on audio tracks and from a
drive slider mounted in the Pedal view on MIDI tracks. That view also
held the Octave pitch shifter's panel.

So the guitar chain's controls were split across three places: the
Pedal tile, the Pedal view and the Guitar view.

## Decision
**The Saturator and the Pedal trade places.** The fx5 tile is the
Saturator's XY again: Drive and Color Hi are its two axes. A tap opens
`PedalCentralView`, registered under `saturator` too. There the Pedal's
XY sits with its Drive/Distort/Fuzz switch under the pad. Of the
Saturator's faders only Output and Mix stay; the tile already holds the
other two.

**GuitarCentralView is gone, folded into the Pedal view.** The view
carries the Guitar rack's six visible macros as `Guitar.adg` saves them:
Gain (MIDI tracks only; on audio the grid's Gtr column draws it), Spring,
a Tremolo pad (Trem Rate × Trem Amount), Room, and the Amp Switch as
Dirty/Clean. The `guitar` and `bass` view requests route here.

**The Wah becomes a slider** on `Wah.adg`'s Macro 1, the macro the
expression pedal sweeps (ADR-445), under the Gain. Tapping a ghost slider
still loads the Wah at the head of the chain. Hold-to-remove went with
the old button.

**The Shifter replaces the Digital rack's XY**: one fader on Live's
Shifter in Ring mode.

**The Octave panel moves to the Chorus view**, next to Pitch Hack, so the
pitch devices sit together. An `octave` view request routes there.

The view's order, left to right: the Pedal pad and its switch, then the
Guitar group (Gain over Wah, Spring/Room over Tremolo), Output and Mix,
the Shifter, then Redux. `PedalCentralView.svelte`'s header comment
keeps each step's measurements and dates.

## Consequences
- The guitar chain's controls are on one screen. Every route to them
  (the Saturator tile, Gtr, Bass) opens the same view.
- The Saturator's tile and the Pedal view no longer show the same
  device's controls twice.
- The Pedal has no grid tile. It's reached only through the Saturator's
  tile and the Gtr/Bass taps.

## Tags
`fx-grid`, `saturator`, `pedal`, `guitar`, `wah`, `octave`, `central-view`
