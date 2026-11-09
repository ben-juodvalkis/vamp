# ADR-521: Simpler and Sampler at full screen

## Status
**Accepted** (2026-11-09). Builds on ADR-512 (an instrument's board),
ADR-516 (tiles as panels) and ADR-519 (the icon only where a board is).
Interface only; no Live restart.

## Context

Ben asked for "a fullscreen simpler and sampler view". Under ADR-519 the
two had no full-screen icon: expanded, they were only their band faces
made larger. Their band faces show a handful of controls each (Simpler's
brace, Pitch, Time, Fade, Gain; the Sampler row), so most of either
device was reachable only in Live.

## Decision

- **Both get a board**, drawn by `InstrumentPanelView` from data in
  `views/panel/samplePanels.ts`, bound by Live's parameter names. Their
  band faces stay hand-laid, so the panels carry a `board` and no frame or
  pages; `instrumentPanels.test.ts` checks the board's names, labels and
  switches against the measured dumps directly (Sampler's with every
  section on).
- **Simpler:** Sample (the view's own Classic/Slice, Loop or Poly/Thru,
  the loop brace, Warp, Gain, Rev / ½× / 2×, Sens in Slice and Random
  Start, as one slot; then the loop's length and fade, the fades and
  Trigger/Gate) · Amp (its envelope drawn, the output) | Filter (pad and
  curve, type and circuits, key/vel/LFO) · Filter Env | Pitch Env | LFO
  (its wave drawn, and where it goes) · Global (transpose, detune, glide,
  spread, Snap).
- **Sampler:** Oscillator (wave, frequency, its envelope) | Pitch Env |
  Pitch · Filter | Shaper | Filter Env · Amp (envelope with its levels,
  output) | Aux Env | Global · the three LFOs as one table, a row each,
  LFO 2 and 3's stereo columns beside.
- A switched section ghosts and its tile's bar holds the switch. A
  Sampler lists a section's parameters only while it is on, so touching a
  ghost turns the section on and the next touch moves the value.
- `hasFullScreenBoard` names `simpler` and `sampler`.

## Left in Live

Every envelope's loop settings (Mode, Loop, Retrig, R < Vel) and slopes,
Sample Selector, and Sampler's zone and sample editors (not parameters).

## Consequences

- Simpler and Sampler show the full-screen icon in their corner again.
- The Sampler board has no waveform: Sampler's sample is per zone and the
  surface reports none of it.
- Shot states `inst-board-simpler` and `inst-board-sampler`.

## Tags
`central-view`, `full-screen`, `instruments`
