# ADR-508: Auto Pan-Tremolo, EQ Eight, Delay and Limiter as device types, laid out as Live's panels

## Status
**Accepted** (2026-11-06)

## Context

The app knew 32 effect types. Four of Live's own that Ben reaches for had
none: Live 12's Auto Pan-Tremolo (the Tremolo slot drives the Legacy Auto
Pan), EQ Eight, Delay and Limiter. On a chain they drew the generic cell
and opened the generic view. The Phaser-Flanger's view was its pad alone,
and the Chorus view lacked the delay, taps, Vibrato's shape, the high-pass
and the output. Ben asked for these, with the views matching Live's own
device layout where touch allows.

Every index, range and label was read off the running Live (12.4.25b1,
`device_dump`); every preset mapping was measured by loading the preset
and reading it back (`preset_measure.js`), the Delay's time curve sampled
(`preset_rail_sample.js`). The numbers are in `live-api-measurements.md`.

## Decision

- **Four `DEVICE_PRESETS` keys**: `autoPanTremolo` (AutoPan2), `eq8` (Eq8),
  `delay` (Delay), `limiter` (Limiter), each inserted by Live's own display
  name, which Live accepts, so the surface is unchanged.
- **Their controls** (`deviceControls.ts`), drawn on the chain cell, the
  browser tile and the view:
  - Auto Pan-Tremolo: an XY, the rate whichever parameter LFO Mode picks
    (slow to fast) across, and the Tremolo tile's depth up (Invert below
    the middle). Pictured as the Tremolo's wave, in its LFO's shape.
  - EQ Eight: an XY on band 3, frequency across and gain up, pictured as
    a bell.
  - Delay: an XY, L's time (its 16th step when synced) across and the
    feedback up, pictured as decaying taps.
  - Limiter: a slider on Input Gain, 0 dB at the middle, and on Output
    under Maximize as Live's knob is; pictured as a wave held under a
    ceiling.
- **Their views follow Live's panels, left to right**, checked against the
  Live 12 manual's screenshots and text (§29.3, 29.8, 29.11, 29.15,
  29.24, 29.29), with value boxes, scrub tabs and switches
  (`views/fx/ParamColumn`, `ParamSwitch`), and Live's names (Shape,
  Att | Mod, Low Cut / Peak / High Cut, Duty Cyc, Env Fol):
  - Auto Pan-Tremolo shows the waveform and the Phase | Spin stereo row in
    Panning mode and Harmonic and Vintage in their place in Tremolo, as
    Live does.
  - EQ Eight is the band's Freq / Gain / Q left of a curve with a numbered
    dot per band (`FilterDotsGraph`, the response from `eq8Params.eq8Db`),
    as in Live, then a band picker with its On switch and a type tab (Live's
    eight choosers in one, each a touch target), then Output, Scale and
    Adaptive Q. A press grabs the
    nearest band and selects it. **Up and down is the gain for a shelf or
    bell, and the Q for the cuts and the notch** (Live's Alt-drag), so a
    finger reaches it; those dots sit at their Q. Only each band's A half
    is edited (Live's Stereo mode).
  - Delay is Live's panel: Left and Right columns of Sync, the 2 x 4
    sixteenths and Offset, Feedback with Link and Freeze (beside the
    channels here, under them in Live: the band is short), the band-pass
    display as its pad (Freq across, Width up), the LFO's amounts and
    rate, then Smoothing, Ping Pong and Dry/Wet. It mounts no time x
    feedback pad: Live's display is the filter's, so that pad is the
    chain cell's and the browser tile's alone. The band-pass is drawn
    reading Width as octaves, which neither Live nor the manual states.
  - Limiter swaps Ceiling for Threshold under Maximize and its level knob
    for Output, as Live's panel does; the gain reduction meter is not drawn.
  - Phaser and Chorus show what each Mode uses: Phaser's Notches / Center
    / Spread / Blend or the Flanger's or Doubler's Time; Chorus's Time and
    Taps 1 | 2, or Vibrato's Shape and Offset (without Width and Feedback,
    which Live disables there).
- **The preset reader keys a repeated name's later occurrences
  `<name>#<n>`** (`presetParams.ts`): EQ Eight saves every band under the
  same five names. A rack keeps no repeats; its are its inner devices'.

## Consequences

- No Live restart: the surface is untouched.
- Not drawn yet: Delay's LFO rate mode, wave and Morph; the Phaser's LFO
  2, sync, Phase / Spin, envelope times and Safe Bass; Limiter's M/S Link
  and meter; EQ Eight's B halves (L/R, M/S) and its spectrum.
- A ghost draws a fresh insert as the rig makes it, which is the User
  Library's default where one exists (Auto Pan-Tremolo, EQ Eight, Delay);
  another Mac's defaults may differ until its device answers.
- No Limiter preset on the rig to measure: its browser tiles draw the rest
  value.

## Tags
`device-controls`, `central-views`, `eq-eight`, `auto-pan-tremolo`, `delay`, `limiter`, `phaser`, `chorus`
