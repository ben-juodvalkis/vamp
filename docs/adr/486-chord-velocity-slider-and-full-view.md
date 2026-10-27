# ADR-486: The Chord's Velocity Slider and Its Whole View

## Status
**Accepted** (2026-10-27). Replaces the Chord's Shift slider of ADR-479's
control table, and the Chord view's four Oct toggles. No Live restart:
interface only.

## Context
The Chord's chain cell and browser tile were a slider on its first added
note's Shift; its view, four switches setting Shift1..4 to ±1 or ±2 octaves.
The user: "lets instead have it be a slider after all. it will set the
velocity of the first chord knob. then let's set up the central view to
give us more control." (A day's try at +12 / -12 buttons on the tile was
reverted.)

## Decision
- The control (`deviceControls`, ADR-479) is a slider on Velocity1 over
  Live's whole 1 % .. 200 % rail, resting at 100 %. The keyboard picture
  lights the triad brighter as it rises.
- The view is the whole device, measured with `device_dump` (29
  parameters): the six added notes as columns of Shift, Velocity and
  Chance value boxes, then Scale (Use Current Scale) and Strum, Tension and
  Crescendo past a seam. With Scale on a note's shift is its Scale Degrees
  parameter, as Live's panel shows it. A note at 0 adds nothing, so its
  Velocity and Chance dim. Shift sweeps its 72 steps over 480px.
