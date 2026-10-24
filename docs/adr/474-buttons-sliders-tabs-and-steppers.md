# ADR-474: Buttons, Sliders, Tabs and Steppers Look Different

## Status
**Accepted** (2026-10-24). No Live restart (interface only).

## Context
Every control in the central views was a rectangle in the same dark 1px
frame, so a button, a slider at its floor or ceiling, and a set of choices
looked alike: the user could not tell what a tile was without touching it.
A full slider (Chance) read as a lit button; an empty one as an unlit
button; a row of choices as that many unrelated switches.

Tried and dropped the same day, on the user's calls: a groove down the
middle of every slider, then a rail along its edge, then a bright line at
the fill's leading edge (kept off the FX grid, which holds no buttons).
Each marked the slider; none was as clear as marking the button instead.

## Decision
Four shapes, one rule each, in the flat grammar:

- **A button is framed bright in its own glyph colour**: `--button-frame`
  (`currentColor` at 70%, `app.css`), so a red Record or Delete has a red
  frame, a grey one a grey frame. ON keeps its solid fill; disabled dims
  the frame with the glyph. On `.physical-button`, the `.device-segmented`
  frame and every view's own button classes.
- **A slider has no bright frame**: it keeps the dark `--line-strong` well.
- **A pick-one set is one segmented tab**: one frame, hairlines between the
  options, the chosen one filled (the tab's `--btn-tint`, else
  `--phosphor`). `.seg-grid` on a `.device-segmented` frame lays it out in
  any shape — a column, a row, a grid, a grid with empty cells — each
  option drawing a 1px outline that fills the 1px gap around it. Applied
  to every set that lights one choice of several: the Glitch presets, the
  Drum Rack's FX type, Auto Filter's shapes, filter types and circuits,
  Drift's waveforms and voice mode, Analog's shapes and Mono|Poly, Echo's
  LFO waves, Meld's type pickers, the Variation's Interval, Grid and
  Length, the Pedal types, the clip view's warp modes, the launch
  quantization picker, Reverb's types and its picture tabs. A switch that
  turns something on or off on its own stays a separate framed button
  (Analog's Uni and Vib, the Variation's Mode, Auto Filter's slope).
- **A stepper — ‹ name › — is one control**: `.stepper`, a single frame in
  the control's colour with the arrows and the name inside and no
  dividers, as the swap pill is (Meld's type choosers, Wavetable's filter
  type).

## Consequences
- What a tile does reads before it is touched: framed bright is a press,
  a tab is a choice, a dark well is a drag.
- A lit tab option fills in the device's ink where its buttons used the
  house orange (Reverb's types keep orange, as their buttons did).
- New controls follow the rule through the shared classes; a view's own
  button class takes `var(--button-frame, var(--line-strong))`.
- The rules are in `docs/reference/ui-architecture.md` §8.1.

## Tags
`design-language`, `flat-grammar`, `buttons`, `sliders`, `segmented`
