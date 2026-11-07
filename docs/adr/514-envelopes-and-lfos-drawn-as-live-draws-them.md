# ADR-514: Envelopes and LFOs drawn as Live draws them

## Status
**Accepted** (2026-11-07). Builds on ADR-512 and ADR-513 (the full-screen
boards). Interface only; no Live restart.

## Context

A layout audit of the seven full-screen boards against Live's own panels
(Ben's screenshots of Analog, Drift, Meld, Operator and Wavetable) found
the one thing every Live instrument shows and no board did: the envelope
and the LFO as pictures. Every envelope was a row of knobs (Wavetable's
three were 22 knobs, Operator's seven a table of 49 bar boxes) and every
LFO a list of shape glyphs beside its knobs. Ben: "Don't be afraid to make
bold choices ... it is nice to have coherence between Ableton and Vamp."

The same audit found Electric's 29 knobs scattered small across empty
space, Collision's bottom row cutting every caption since its MIDI
destinations joined it (ADR-513), and Operator's tables repeating "On" in
fifteen switches.

## Decision

- **`central/EnvelopeGraph.svelte`**: an envelope's line on a dark
  display, its breakpoints squares a finger drags. The attack's square
  moves Attack across and Peak up, the decay's Decay across and Sustain
  up, the release's Release across and Final up, the start's Initial up.
  The width is four slots, Live's reading: attack and decay up to one
  each, the sustain held to the third, release in the last. A drag is
  relative and takes the square nearest the finger however far off, so no
  one aims at a 10px mark; the moving square's values read in Live's
  words. Parameters by name through `PanelParams`, so it serves the
  hand-laid pages and the panel instruments alike; a section that is off
  ghosts it and turns on at the first drag.
- **`central/LfoGraph.svelte`**: the LFO's wave, as many cycles as its
  rate and as tall as its amount; across sets the rate, up the amount. A
  shape's name is read loosely, since each instrument spells its list its
  own way.
- **Where they are**:
  - Wavetable: Amp, Env 2 and Env 3 are a graph over their slopes and loop
    mode (the levels are on the graph); the LFOs a wave over one touch row
    of shapes, sync and Retrig, then five knobs.
  - Drift: both envelopes a graph over their four knobs (Env 2's Cyc mode
    trades it for the rate mode); the LFO a wave over its controls.
  - Meld: each engine's Amp and Mod envelopes a graph over slopes and loop;
    each LFO a wave.
  - Analog: each voice's Amp and Filter envelopes a graph beside S-Time;
    each LFO a wave.
  - Operator: **one** large envelope, picked by a tab row (A, B, C, D, LFO,
    Pitch, Filter) that follows the face's oscillator until another is
    picked, as Live's display shows the shown tab's; the loop table beside
    it keeps a row per envelope. Seven strips, the first try, came out
    30px tall and read as nothing.
  - Collision: the noise envelope (a board `slot`, `noiseEnvelope`).
- **A switch in a table is a lamp**: no word, its column's name over it
  (`PanelControlView`'s caption-less switch).
- **Electric is a knob a column**: three rows in the signal's order
  (hammer; fork and damper; pickup and Global), every knob large.
- **Collision's MIDI amounts and Global are a row of their own**, the
  mallet and the noise above them two knobs to a column.

## Consequences

- A board's ADSR knobs are gone where the graph carries every stage
  (Wavetable, Meld); Drift keeps its four knobs under the graph, where the
  tile had the room, as Live prints the numbers under its own.
- Operator's envelopes are one at a time again on the board, but one tap
  away, and the loop settings of all seven stay in view.
- The graphs are the first central controls that move two parameters per
  point across a picture; they are not `use:press`/`use:drag` (central
  views are out of that rule's scope) but own their pointer by id.
- `instrumentPanels.test.ts` still pins that every board reaches what its
  panel binds: a slot's `params` list the graph's names.

## Tags
`central-view`, `instruments`, `full-screen`, `layout`, `envelopes`
