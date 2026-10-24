# ADR-467: The Saturator and Glitch Become Sliders, in a Slider Column Inside Each Outer One

## Status
**Accepted** (2026-10-24). Tried on branch `fx-grid-sliders`, merged the
same day. Interface only: no wire change, no protocol bump.

## Context
The grid's two middle rows held four XYs each: EQ, Filter, Saturator,
Drum over Tremolo, Glitch, Echo, Reverb, between the slider columns at
the edges. The Saturator's and Glitch's X axes (Color Hi, Clock) were
set-and-leave controls, and the Octave (Pitch) and the Variation had no
tile at all: Pitch lived in the Tremolo view, the Variation in the
Glitch view.

## Decision
**Three XYs a row, and a slider column inside each outer column.**

| col | 1 | 2 | 3–4 | 5–6 | 7–8 | 9 | 10 |
|---|---|---|---|---|---|---|---|
| top | Rand Oct / Bass | Pitch | EQ | Filter | Drum / Chorus | Glitch | Glue |
| bottom | Gtr | Saturator | Tremolo | Echo | Reverb | Variation | Gain |

- **Pitch** (`PitchControl`) is the Octave's Mix and opens a Pitch view:
  the Octave's interval and Pitch Hack (Reverse), out of the Tremolo view.
- **Saturator** is the old XY's Y (Drive up, Output down to match,
  Dry/Wet up) and opens the view it opened; its Color Hi, the old X, is
  a fader there beside Output and Mix.
- **Glitch** is GlitchLoop's Dry/Wet and opens the Glitch view, which
  gains Clock, the old X, on a slider of its eleven detents.
- **Variation** (the Var slider, back from `hidden`) opens its own view,
  out of the Glitch view.

The TotalMix status strip and the transport header follow the columns:
Room 1–2, Track 3–4, Click 5–6, Phones 7–8, Main 9–10; tempo 1–4, time
5–6, position 7–9, Click 10.

## Amendments (2026-10-24, the same day, the user's calls)
- **Labels:** the Saturator slider reads **Drive**, the Variation slider
  **Stutter** (on the grid and in its view).
- **Reverse moves to the Glitch view:** Pitch Hack's Rate column and Mix
  sit beside GlitchLoop past a seam; the Pitch view is the Octave's
  interval column alone (its Mix is the Pitch slider).
- **Main is an audio track to the grid:** column 1 is the Bass over the
  Gtr there too (it was one empty cell), so every track has the Gtr and
  every track splits the Pedal view (ADR-466).

## Consequences
- Every effect on the grid now has one control on the grid and one view
  of its own.
- The XYs are wider (two of six columns a row rather than two of eight).
- The Tremolo view off a drum track is the Auto Pan alone.

## Tags
`fx-grid`, `central-view`, `layout`, `pitch`, `glitch`, `saturator`, `variation`
