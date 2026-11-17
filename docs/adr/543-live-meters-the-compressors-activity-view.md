# ADR-543: Live Meters: the Compressor's Activity View

## Status
**Accepted** (2026-11-16). Extends ADR-541 and ADR-542. The page and the
bridge take it on their next start; Vamp for Mac once rebuilt (ADR-490). No
Live restart.

## Context
Ben, after the Glue's needle and the spectra worked: "let's do compressor",
then "i like the time-domain ui like the current compressor has". Live's
Compressor (`Compressor2`) draws, in its activity view, the input level over
time as a grey fill rising from the floor, the gain reduction as an orange
line over it, and the threshold as a cyan line across, all scrolling right to
left. The LOM carries none of it.

Measured on Live 13.0b25 at 100% zoom in a dark theme (2026-11-16): the
display is 262 pt of ground (23) inside a 61 frame, with two rules (54)
around a 128 pt graph. Moving the threshold put its line at +6 dB on the top
row, 0 dB 19 pt down, −6 at 39, −24 at 90, −41 at 110 and −∞ on the floor:
Live's scale is not linear in dB. The fill is 73, the orange line ≈ 243 152 75,
the zero line's dots 54–62.

## Decision
- **A third kind, `activity`**, read as heights rather than dB: per column,
  the fill's top and the line's row, 0 at the floor and 1 at the top, plus
  the threshold's. Kept on Live's own scale, a drawing of them is Live's
  picture; converting to dB would need the scale's curve and would gain the
  page nothing it draws.
- **The graph is found, not placed**: the longest gap between two rules (a
  row of one neutral grey straight across, unlike the rows on either side of
  it, since a loud stretch fills whole rows too). The fill counts only where
  fill continues below it, so the zero line's dots are not signal.
- **On the wire**: `/meter/activity <path> <status> <threshold> <fill × 128>
  <line × 128>`, sent when any height moves by 0.004 (a pixel's worth); it
  scrolls, so about 30 a second while sound plays.
- **On the page**: `ActivityTrace` draws it over the Compressor's threshold
  slider, on its chain cell and in its view: the fill faint in the
  foreground ink, the threshold dashed, the line in the device's ink. While
  a reading stands, the device's sketch (the transfer curve) gives way to it.

## Consequences
- Not measured in a light theme; the reader keys on the rules and the line's
  orange, not the face, so it should hold, but it has not been seen.
- Live 13 can show the clip editor and the device chain stacked. In that
  layout its Accessibility tree lists only the clip editor
  (`ClipDetailView`), so every live meter reads `not-shown` until the clip
  editor is closed. Live's `hide_view('Detail/Clip')` does not close it.
