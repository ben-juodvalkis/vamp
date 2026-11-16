# ADR-542: Live Meters: Spectra, and One Reader for Any Device

## Status
**Accepted** (2026-11-16). Extends ADR-541. The page and the bridge take it
on their next start; Vamp for Mac once rebuilt (ADR-490). No Live restart.
Renames ADR-541's switch `reductionMeter` to `liveMeters`.

## Context
Ben, after the Glue's gain reduction worked: "let's explore the spectrum on
autofilter", then "this will apply to other things like eq etc so make it
modular", "and channel eq". Live's Auto Filter and Channel EQ draw a live
spectrum of their input behind their curve; the LOM carries neither.
Measured on Live 13.0b25 with 1 kHz tones at −6 … −48 dBFS, read live:

- **Auto Filter** (`AutoFilter2`): a 296 × 95 pt display, 20 Hz at the left
  edge, 98 pt a decade (the grid lines are 100 Hz, 1 kHz, 10 kHz), 13 pt per
  12 dB with +1.4 dB at the top; a grey fill (≈ 72–97) on a ground of 33 with
  grid lines at 60. The tones read −6.0, −12.4, −18.0, −24.4, −30.0, −36.4.
- **Channel EQ** (`ChannelEq`): a 239 × 81 pt display, the same axis at 79.5
  pt a decade, 1 pt per dB from +9 dB at the top, dB labels over the left
  22 pt and frequency labels from row 66 down. The tones read −6, −12, −18,
  −24, −33, −36: a pure tone's spike is a pixel or two wide there, ± 3 dB.
- Both change about 22 times a second.

Lessons that cost readings on the way: a PNG decode lifts dark greys (grid
60 → 68, 80 → 88), so thresholds are measured on live captures; a curve's
blended edge where it fades into a grey line can pass as fill, so a fill
pixel must have fill under it (a fill is solid to the floor, a line is not).

## Decision
- **One reader, kinds as data.** `LiveMeter.swift` maps a device class to a
  kind with its measured geometry: `needle` (the Glue) or `spectrum` (the
  Auto Filter, Channel EQ). `LiveMeterReader` finds any of them the same
  way (Accessibility, then the panel found in the picture) and reads it by
  kind. A new device is a measured entry, not code.
- **One spectrum grid on the wire**: 64 bands, log-spaced 20 Hz–20 kHz, in
  dB, whatever the device draws, so the page never knows a device's layout.
  A band is its loudest column; a column is its fill's top edge; label
  columns borrow the nearest clean one; a silent band reads the device's
  floor.
- **One wire**: `/meter/watch` for every kind; `/meter/reduction` (one dB)
  and `/meter/spectrum` (64 dB) for the readings (wire-protocol §2.15b),
  behind one switch, `liveMeters`.
- **Drawn by Vamp, under its own curves**: `SpectrumFill` draws the bands on
  any graph's own log frequency axis. The Auto Filter's chain cell (its XY
  pad, whose X is Live's 20 Hz × 1000^x cutoff) and the Channel EQ's tone pad
  (`FilterCurve`, 20 Hz–20 kHz) draw it as a backdrop
  (`FaceControl`/`ToneCurvePad` `backdrop`, filled by `ControlTile` for any
  device whose class meters a spectrum).
- **Moving like a meter** (Ben: "any kind of smoothing or anything that
  might look nice?"): readings arrive as ~22 steps a second; the page eases
  every band every frame, rising at once (10 ms) and falling back over
  ~180 ms, draws one rounded outline through the bands (Catmull-Rom, its
  handles kept inside the box), fills it with the device's ink brighter at
  the top and edges it with a thin line (`spectrumDraw.ts`, measured 60
  redraws a second). The frame loop stops once nothing moves.
- **Every device on screen at once**: the page asks for each held device
  every round, and Vamp for Mac reads each on its own capture stream
  (`LiveMeterHub`, a `LiveMeterReader` per device path), so the Auto
  Filter's and Channel EQ's cells both draw (Ben: "filter and eq should
  both draw").
- **The right Live**: with Live 12 and 13 open (one bundle identifier), the
  reader reads the one listening on `osc.pythonSurface.tcpPort`.

## Consequences
- EQ Eight, Spectrum and others are a measurement each (the display's box,
  axis, dB scale, label areas) and a `METERED_CLASSES` entry; EQ Eight's view
  (`FilterDotsGraph`) can take `SpectrumFill` as its backdrop.
- Each device read costs its own capture stream (measured for one: 2.4% of
  a core and about 7% more in the window server at 60 fps; these run at 30).
- Everything ADR-541 says about Spaces, Live's selection and zoom holds.

## Tags
ui, wire, vamp-for-mac, devices, measured
