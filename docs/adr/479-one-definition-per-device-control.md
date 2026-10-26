# ADR-479: One Definition per Device Control

## Status
**Proposed** (2026-10-26), on the branch `claude/fx-chain-overview-mock`
with ADR-478. Interface only; no Live restart.

## Context
A device's control (which parameters its XY or slider drives, the math
between the finger and Live, the values it rests at) was written by hand
in each of its FX-grid tile components, again in the browser's preset-face
table (ADR-478), and a third time inline in some central views (the
Shifter in the Pedal view, Note Chance in the Arpeggiator view, the
Phaser's pad). The copies had drifted: Reverb's browser face wrote Decay
raw while its tile placed it on the tail's time axis, and the Phaser pad
read Live's 0..1 LFO rail as hertz and wrote hertz back, so the right half
of its sweep clamped to 40 Hz. The chain overview could only draw a device
that had a grid tile, and the browser only a device the face table knew, so
Comb, Blur, GlitchLoop, Redux, Phaser, Shifter, Compressor, Gate and the
Max devices showed nothing in one place or the other.

## Decision
**Every device's control is one entry in
`components/v6/device-panel/deviceControls.ts`**, keyed by its
`devicePresets` key: the control's kind (XY, slider or the EQ's tone pad),
its parameter reads and writes (LOM indices, or a Max device's names with
the measured index as fallback), its rest values, and how a preset file's
saved values read onto it (measured against the running Live, Ben's rule:
the artifact wins).

**One component draws any entry, `ControlTile`** (`BaseDeviceControl` +
`browser/FaceControl`), and every place a control appears is it: a grid
tile (17 tile files are now one-line wrappers), a chain cell for any device
type with an entry, a central view's mount (`tapLoads` where a tap on a
ghost loads it, `disableCentralViewOnTap` inside a view). A browser preset
tile draws the same entry through `presetControl` at the file's saved
values; an `.amxd`, whose values the server cannot read, rests where the
control rests. A tile that draws something of its own (Reverb's portrait,
Utility's meter) takes its parameters and math from its entry.

The `add-looping-device` skill is the procedure: measure, register in
`devicePresets.ts`, define in `deviceControls.ts`, and every surface
follows.

## Consequences
- The FX grid draws pixel-identically to before (diffed, 0 of 5,595,136
  px), and every central view but two: Shifter and Note Chance now wear the
  tile frame Comb and Blur already wore in their views.
- The Phaser pad drives Live's own rail: its sweep reaches every speed.
- A drag on any grid tile opens its view, as all but two already did: the
  Drive (Saturator) and EQ tiles now do too. A tile inside a view only
  appoints its device (`disableCentralViewOnTap`).
- Devices with no control yet show none in the browser or the chain:
  Auto Pan-Tremolo, Delay, EQ Eight, Multiband Dynamics, Reverb (the
  classic), Redux Legacy, Octave Pedal, Pitch Hack, Tone Shaper. Each is
  one entry once Ben names its control.

## Tags
`device-controls`, `fx-grid`, `chain-overview`, `browser`, `presets`
