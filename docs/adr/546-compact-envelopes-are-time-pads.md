# ADR-546: A compact instrument view's envelopes are Time pads

## Status
**Accepted** (2026-11-18). Interface only; no Live restart.

Reverses, on the compact face only, the 2026-09-12 call that replaced the
Time XY with four ADSR sliders (`EnvelopeGroup`, `SamplerControlsRow`) and
ADR-477's envelope rows of value boxes. The full-screen board
([ADR-512](512-instruments-at-full-screen.md)) and the section pages keep
every stage.

## Context

Every synth with a full-screen board drew each envelope's four stages on
its compact face as well: knobs on Wavetable and Drift, value boxes on
Analog, Meld and Operator, knobs on Omnisphere. That spent a quarter to a
third of the band on controls that are set and left, while the stages are
all a tap away on the board. Ben: on the smaller view, a Time XY with
Attack and Release for the amp, Attack and Decay for the filter, and the
full controls in the expanded view; the same for Omnisphere, which needed
an expanded view to put them in.

## Decision

- **On the compact face an envelope is one XY pad:** Attack across; up is
  Release on the amp envelope and Decay on a modulation envelope (the
  filter's, or whatever second envelope the device has). One finger sets
  the two stages that shape a sound most; Sustain and the other Decay /
  Release are on the board.
  - Wavetable: Amp (A × R) over Env 2 (A × D).
  - Analog: Amp (A × R) beside Filter (A × D), under the swap pill.
  - Drift: Env 1, the amp's (A × R), over Env 2 (A × D), ghosted while
    Env 2 cycles.
  - Meld: Amp (A × R) beside Mod (A × D), then the Mod envelope's Peak.
  - Operator: each oscillator tab's envelope (A × R), the LFO's and the
    pitch envelope's (A × D), drawn by a panel group's new `time` field
    (`PanelGroup.time`), which only the frame reads.
  - Omnisphere: Amp (A × R) and Filter Env (A × D) as a third column of
    pads beside its four macros, FX level with Amp and Env Amt level with
    the Filter envelope it scales.
- **Omnisphere has a full-screen view:** its compact layout of 2026-10-12
  (the four macros, both envelopes' four stages, FX over Env Amt), now
  behind the corner icon (`FULL_SCREEN_BOARDS`).
- A pad's axes are each parameter's own range, linear, exactly as the
  knobs and boxes they replace read it.

The same day, Operator's compact Filter section shows **Cutoff and Res**
knobs in place of Env and Drive (Ben's call); Env and Drive stay on the
Filter page. The filter PAD is still only the page's: the chain cell's XY
moves the same two.

## Consequences

- A drag sets two stages at once; Sustain is no longer on any compact face.
- Wavetable's amp times are seconds on a 0..20 rail read linearly, so the
  first second of Attack is the first twentieth of the pad. The knobs had
  the same mapping; a curved axis is a separate change.
- `npm run shot:tour -- central --only inst-board-omnisphere` shoots the
  new full-screen view.

## Tags
`instrument-views`, `envelopes`, `xy-pad`, `full-screen-board`, `omnisphere`, `operator`
