# ADR-462: Synth Views Flip a Whole Half Behind One Switch and Draw What Live Plays

## Status
**Accepted** (2026-10-22; recorded 2026-10-23). Covers the Analog view
(`2c46fd9`), the filter curves (`443b2e4`), the rendered wavetables
(`1e7afa6`) and the Meld and Wavetable rework (`bdfa5c7` and the
commits after it that day). Protocol: `1e7afa6` added Wavetable
properties to the surface's allowlist (`wire-protocol.md`, same commit).
The surface part needs a full Live restart.

## Context
Analog had no central view. It wasn't even recognized as an instrument,
because `instrumentService` looked for class `Analog` and Live reports
`UltraAnalog`. Meld and Wavetable had views that showed one pad per
oscillator and only a few controls each. Live's devices have two of
everything (two voices, engines, oscillators or filters), and showing
both side by side at a usable size doesn't fit on the iPad.

Each view's filter pad and oscillator pad had a static icon. The icon
said what kind of control the pad was, not what it was doing to the
sound.

## Decision
**1. One switch flips a whole half of the synth.** Drift's view already
did this with OSC 1/2. Analog, Meld and Wavetable now follow it:

- Analog: a Voice 1/2 switch flips the oscillator, the filter and the
  envelopes together.
- Meld: an Engine A/B badge does the same. B's indices are A's plus 60,
  pinned in `meldParams.ts` and its test.
- Wavetable: an OSC 1/2 switch flips the oscillator card, and a separate
  FLT 1/2 badge flips the filter column. Filter 2's indices are Filter
  1's plus 9.

On Analog and Meld the switched half wears Drift's source colours:
orange for the first half, blue for the second. Like Drift, these
colours override the track ink from ADR-402 for the switched controls.
The switch is view state only. It writes nothing to Live.

**2. Touching a half that is off turns it on.** This applies to an
Analog oscillator, a Meld engine, and a Wavetable oscillator's level.
Where a control's level is also its switch (Analog's noise and glide,
Wavetable's Sub), the level writes the on/off with it, as Drift's Noise
already did.

**3. Filter pads draw the filter's response curve, following Live's own
settings.** The FX grid's `FilterCurve` now draws on the filter pad of
Analog, Drift, Meld, Sampler, Operator and Wavetable, following the
filter type, slope, morph and on/off. Operator and Wavetable gained a
filter pad for it. The icon above each pad went.

Every device's cutoff span was read off the running Live with
`str_for_value`, so the curve's peak lands on the frequency Live labels.
The spans differ (for example, Analog 30 Hz–22 kHz, Operator
30 Hz–18.5 kHz, Wavetable and Meld 20 Hz–20.5 kHz). `DeviceXY` takes the
device's own span. On the rig the peak lands within 2 % of Live's label
everywhere except Analog mid-sweep (793 Hz drawn against 834 Hz).

A Meld filter type with no filter shape (Phaser, Comb, Vowel, the
resonators, Filther) draws no curve rather than a made-up one.

**4. Wavetable's oscillator pads draw the table each oscillator plays**,
at its Wave Position, through its effect mode. Live's API names a
Wavetable's tables but never hands over their samples, and the factory
tables sit in Live's encrypted resources, so they are rendered.
`owner/probes/wavetable_render_run.js` plays each of the 194 factory
tables through a neutralised Wavetable on the rig and records it.
`wavetable_render_audio.py` averages one cycle per frame.

The result ships committed as `interface/static/wavetables/factory.json`
(831 KB: 25 frames × 128 points per table). It is fetched once when the
view opens. Ben's call: it is committed because making it takes Live
and a 15-minute run. The surface reads each oscillator's table category,
index and effect mode from `InstrumentVector`.

**5. Parameter indices and labels are measured, not guessed.** Each view
pins its indices in a `*Params.ts` file taken from a device dump on the
rig. Where Live renames a control with its mode, the view carries Live's
own names as a table and a test quotes them. Meld's second filter macro
is one example. Wavetable's Effect 1 is the exception: Live names it the
same in every mode, so its title (Tune, PW, Warp) comes from Live's
panel.

## Consequences
- Each half gets the full width, so controls stay touch-sized. Only one
  half is visible at a time, and the switch's colour is the only cue to
  which one.
- What a pad shows tracks what Live plays, so a type or slope change
  made in Live shows up on the iPad.
- `factory.json` goes stale if Live changes its factory tables. It is
  rebuilt by rerunning the probe on the rig, not by the build.
  User-made wavetables have no picture.
- Simpler's view still has no filter control. Its mode-dependent grid
  needs a layout decision first.
- The Wavetable view lost its pitch and mod wheels to give the pads
  width (Ben's call, `803f826`). Analog and Meld keep theirs.
- Tests: `AnalogCentralView.test.ts` (on the measured 106 Bass patch),
  `meldParams.test.ts` and `wavetableShapes.test.ts`. The shot tour
  gains the `inst-analog*`, `inst-meld*` and `inst-wavetable*` states.

## Tags
`instruments`, `central-views`, `analog`, `meld`, `wavetable`, `drift`,
`filter-curve`, `measured`
