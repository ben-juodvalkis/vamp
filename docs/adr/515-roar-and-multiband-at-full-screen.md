# ADR-515: Roar, and Roar and Multiband Dynamics at full screen

## Status
**Accepted** (2026-11-07). Builds on ADR-511 (the full-screen icon),
ADR-512/513 (an instrument's board) and ADR-514 (pictures as Live draws
them). Its caption clause ("a knob's caption stands beside it ... or at
most 5.5rem tall") is superseded by ADR-516: beside only in a cell at
least 9rem wide. Interface, plus one surface allowlist row: Roar's routing
mode reaches the rig after a Live restart.

## Context

The full-screen boards covered the seven paged instruments. Ben: "Let's do
the same for the Roar and Multiband Dynamics devices too", with both
loaded in the rig's set to dump and the Live 12 manual to read. Roar was
not a device type in the app at all; Multiband Dynamics (`ott`) had a face
of two value boxes and a chain cell on its Mid band's Below ratio, so at
full screen it drew those two boxes larger.

Measured off the running Live (`device_dump.js`): Roar has 91
parameters, every continuous one a 0..1 rail; its routing mode is not a
parameter but the device property `routing_mode_index`, settable with a
listener, over a fixed list (Single, Serial, Parallel, Multi Band, Mid
Side, Feedback, Delay). Multiband Dynamics has 38, in raw units (dB,
ratio rails, log-time rails).

## Decision

- **Roar is a device type** (`roar`, distortion family): its chain cell is
  an XY, Drive across and Dry/Wet up, over the Saturator's shaper picture;
  a preset tile reads `Input_InputGain` (a gain factor) onto Drive's rail,
  linear in dB from -24 to +24 (`roarParams.ts`), and `Output_DryWet` as
  is. It loads by name ("Roar").
- **Roar's band is one face** (ADR-513): Input's tone and Color, the
  routing with Blend (or Multi Band's two crossovers), the first stage
  (shaper and filter), the feedback's amount and time, the compressor and
  output. Drive and Dry/Wet are the cell's XY and are not repeated.
- **Roar's board** is Live's expanded Roar: Input, Routing, Feedback and
  Global on top; the three stages side by side, each its shaper's half
  (type over Amount, Bias, Level over its switch and the stage's) and its
  filter's (type over Freq, Res and Peak's gain or Morph's shape over its
  switch and Pre); then LFO 1 and LFO 2 as waves (rate across, ADR-514),
  the envelope follower and Noise. The board holds everything, Drive and
  Dry/Wet included.
- **The routing mode decides what is live** (manual 29.33.1): a stage the
  mode does not run ghosts (Single runs one, Multi Band three, the rest
  two), Blend shows where two stages blend, the crossovers only under
  Multi Band, and the stages take the mode's names (Low, Mid, High; Mid,
  Side). The routing is `PropertyComponent`'s `("Roar",
  "routing_mode_index")`.
- **Multiband Dynamics' board** is a row a band, High over Mid over Low as
  Live stacks them: the band's switch (High and Low with their crossover),
  Input, **its display as Live draws it** (`BandDynamicsDisplay`: a dB
  scale across, the Below block up to the Below threshold, the Above block
  from the Above threshold; a block's edge drags its threshold, inside it
  drags its ratio, up louder in both, a line and fill reading it), Output,
  Attack and Release; then the globals (Output, Amount, Time, Soft Knee,
  Peak) and the sidechain (on, Gain, Mix). The band face stays as it was.
- **A fourth knob size, `xl`, 128px** (ADR-509's 48 / 70 / 96 below it),
  for a board's lead controls where a column holds one knob: Roar's
  Drive, Blend and Mod Amt, Multiband's globals and sidechain. A board
  stands controls two to a column wherever they pair (Roar's Feedback
  2 x 2, each stage's shaper and filter two knobs deep, the envelope
  follower's three pairs), so a row needs fewer columns and each is filled
  top to bottom (user, the same day: the first boards left most of each
  tile empty). Multiband's band rows are too short for two knobs stacked,
  so Input, Output, Attack and Release stand side by side there.
- **A board sizes a control by its rank, not by the room left** (user,
  the same day: "the actual primary, secondary, tertiary uses of controls
  to determine size, not just available space"), the rank read off Live's
  own panel: primary large (`l`, `xl` where it stands alone in its
  column), secondary medium, tertiary small; in a column two controls
  share, the higher rank takes the larger share (`.rank-*` flex weights).
  Roar, by Live's panel: Drive, each stage's Amount and Frequency and the
  feedback's Amount primary; Bias, Res, Tone, Blend, the feedback's time,
  the compressor, Output, Dry/Wet and an LFO's rate secondary; Level,
  Tone Freq, Peak and Morph, the feedback filter, Smooth, the follower's
  gain and band, Mod Amt tertiary. Each stage carries Live's two
  pictures: its **shaper curve** (`ShaperCurve`, dragged up for Amount and
  across for Bias; the curves are pictures of each type from the manual,
  not measured) and its **filter's response** as a pad, Freq across and Res
  up. Multiband, by Live's panel, is its display: the gains medium, the
  times small (Live shows them as numbers), Amount the lead global, the
  sidechain small.
- **The instrument boards take the same rule** (user, the same day: "go
  through all the other expanded central views"):
  - Electric: each section's leads (the stiffness and force amounts, the
    tine's color and decay, the damper's amount, the pickup's model and
    distance, the output) a full-height column each, `xl` or `l`, their
    velocity and key amounts stacked small beside them: a board section's
    new `lead` count. Every knob large and a column to itself (ADR-514's)
    had left nothing leading.
  - Drift: the LFO's rate and amount large and its mod amount small (the
    other way round before); the oscillator's shape and detune large, the
    pitch, filter and shape mod amounts and the matrix smaller; Volume the
    one large global.
  - Wavetable: each LFO's rate and amount large, its morph, offset and
    attack small; an oscillator's position effect and gain large, semi and
    pan small; Volume the lead global; the filters' drive and morph medium.
  - Analog: each filter's cutoff large and resonance medium, the oscillator
    and amp levels, detune and the LFO, vibrato and noise rates medium, the
    rest small.
  - Meld: the LFO rates large, offsets and folds small. Its rows are too
    short for a large knob anywhere else: a large knob's caption left the
    knob itself smaller.
  - Operator and Collision: Volume, the LFO rate, the mallet's volume and
    stiffness and the noise volume rank first. Their boards are tables,
    rows too short for sizes to differ much, and stay so.
  - Every envelope's stage knobs under its picture draw at their full small
    size (a 5.875rem row; 4.5rem drew them at about 28px).
  - A knob's caption stands beside it only in a cell at least 9rem wide or
    at most 5.5rem tall; between, beside cut it to "S.." and "Tr...", so
    it stays under the knob.
- Mod matrix assignments, solo buttons, sidechain routing and Roar's
  Envelope Listen are not on the LOM's parameter list and are left out.

## Consequences

- Roar's routing mode needs the surface restarted (Live) before the pick
  reads or writes; until then it shows "—" and the stages read as Serial.
- The two boards are the first effect boards; an effect view opts in the
  way an instrument does (`centralDisplayStore.expanded` →
  `InstrumentBoard`). A ghost slot keeps its face at full screen.
- No Roar preset sits where Live's browser loads from, so the preset
  mapping rests on Live's own Drive labels, not a loaded preset.
- Shot states: `chain-view-roar`, `chain-board-roar`,
  `chain-board-roar-multiband`, `chain-board-multiband`. `setTrackDevices`
  now carries a device's `properties` to the mock.

## Tags
`central-view`, `full-screen`, `effects`, `devices`
