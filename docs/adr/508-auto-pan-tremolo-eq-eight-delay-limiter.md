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
  - Limiter: a slider on Gain, 0 dB at the middle, pictured as a wave held
    under a ceiling.
- **Their views follow Live's panels, left to right**, with value boxes,
  scrub tabs and switches (`views/fx/ParamColumn`, `ParamSwitch`):
  - EQ Eight is a curve with a numbered dot per band (`FilterDotsGraph`,
    the response from `eq8Params.eq8Db`), then band, type and the band's
    Freq / Gain / Q, then Output, Scale and Adaptive Q. A press grabs the
    nearest band and selects it. **Up and down is the gain for a shelf or
    bell, and the Q for the cuts and the notch** (Live's Alt-drag), so a
    finger reaches it; those dots sit at their Q. Only each band's A half
    is edited (Live's Stereo mode).
  - Delay shows L's time, and R's beside it once Link is off, as Live does.
  - Limiter swaps Ceiling for Threshold and Output under Maximize, as
    Live's panel does.
  - Phaser and Chorus show what each Mode uses: Phaser's Notches / Center
    / Spread or the Flanger's or Doubler's Time; Chorus's delay and taps or
    Vibrato's Shape and Offset.
- **The preset reader keys a repeated name's later occurrences
  `<name>#<n>`** (`presetParams.ts`): EQ Eight saves every band under the
  same five names. A rack keeps no repeats; its are its inner devices'.

## Consequences

- No Live restart: the surface is untouched.
- Not drawn yet: Auto Pan-Tremolo's Time and Spin controls, Delay's LFO
  rate and wave and the channels' Offset, the Phaser's LFO 2, sync and
  envelope times, EQ Eight's B halves (L/R, M/S).
- A ghost draws a fresh insert as the rig makes it, which is the User
  Library's default where one exists (Auto Pan-Tremolo, EQ Eight, Delay);
  another Mac's defaults may differ until its device answers.
- No Limiter preset on the rig to measure: its browser tiles draw the rest
  value.

## Tags
`device-controls`, `central-views`, `eq-eight`, `auto-pan-tremolo`, `delay`, `limiter`, `phaser`, `chorus`
