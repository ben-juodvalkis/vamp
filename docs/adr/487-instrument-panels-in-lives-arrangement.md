# ADR-487: Instrument Panels in Live's Arrangement

## Status
**Accepted** (2026-10-27). Replaces the Electric view's two XY pads, the
Collision view's resonator pads and the Operator view's layout of
2026-10-27 (its Filter pad stays). No Live restart: interface only.

## Context
The instrument views each draw a hand-picked handful of their device:
Operator about 10 of its 195 parameters, Collision 2 of 140, Electric 4 of
34 (`docs/plans/device-complexity/README.md`, counted against the measured
reference in `docs/reference/instruments/`). Ben asked for a system that
reaches the rest in the central band (about 1062 x 330 on the 12.9-inch
iPad), and then to "lean towards how Ableton arranges the devices when that
makes sense for touch controls, to make it more intuitive and easy to find
my way around." Read against the Live 12 manual's device screenshots, Live
already solves it: a fixed panel in signal order with Global at the right,
its own section names, a horizontal tab strip over the one region it swaps
(Collision's Resonator 1 · Resonator 2 · LFO · MIDI/MPE), a dot on a tab for
a section switched on or off, and a detail area following the section
clicked (Electric, Operator).

The views also bound their parameters by index, and two were wrong: the
Electric view's comments named its Fork pad's parameters wrongly, and the
Collision view's Resonator 2 pad wrote Material from its Decay axis and
the reverse.

## Decision
- **An instrument panel is data** (`central/views/panel/`): a frame of
  regions, each a named group of controls or Live's tab strip over groups,
  and pages, each a section's detail in one or two rows of groups. Every
  control names its parameter as Live lists it; nothing in a panel is an
  index, range or conversion. `usePanelParams` resolves a name to its path
  at the moment it reads or writes, so a list that changes shape cannot
  move a control onto another parameter.
- **Laid out by rule** (`InstrumentPanelView`): value boxes over the
  parameter's own range (centre-origin when it spans 0), a quantized
  parameter with few values a column of cells, with many a stepping box
  naming its value, an on/off parameter a switch; groups seamed (ADR-433)
  and spaced by role (ADR-434). A chooser spreads into more columns so its
  cells stay on the touch floor: five cells stand in a full-height row, two
  in a two-row page's.
- **Live's arrangement**: the frame reads in Live's order and names; Live's
  tabs, horizontal, over the region Live swaps; a tab's dot filled while its
  section is on, hollow while off; a section's eyebrow ("Hammer ›") opens
  its page, whose left column leads back. The page or tab shown is view
  state: it writes nothing, and a view arrives on its frame.
- **A switched-off section** draws its controls ghosted; touching one
  turns the section on before writing it.
- **Labels at the top of a panel's boxes** (`DeviceSlider labelAt="top"`,
  opt-in): Live's defaults rest many parameters at 50 %, where a centred
  label is cut in half by the fill.
- **Checked against the reference**: `instrumentPanels.test.ts` reads the
  dumps and fails on a name Live does not list, a chooser or stepper whose
  labels miscount the parameter's values, a switch on a non-on/off
  parameter, or an eyebrow naming a missing page.
- **Slots**: a device's own control the rule cannot draw (Operator's
  filter pad with its response curve) is a `slot` region the view fills
  with a snippet, bound by name through the same `usePanelParams`.
- **First instruments**: Operator (Live's tabs Osc A–D · LFO · Pitch over
  the middle, each its main boxes and its envelope; the Filter pad; Time ·
  Tone · Volume; pages for each oscillator and its envelope, the LFO and its
  envelope, the pitch envelope, the filter, its envelope and the shaper, and
  Global), Electric (Hammer · Fork · Damper/Pickup ·
  Global, a page each) and Collision (Mallet · Noise · tabs Res 1 / Res 2 /
  LFO / MIDI · Global; pages for Mallet, Noise, each resonator and its
  velocity and key amounts, each LFO, MIDI and Global). A page can open a
  page of its own, whose way back returns to it. The swap pill keeps its
  column (the views host none).
- **A hand-laid face**: a view whose own layout already reads in Live's
  order and carries widgets a rule would flatten keeps it as the panel's
  `face` and wears `PanelEyebrow` links over its columns instead of a
  frame. Drift is the first: its oscillator card, source-coloured mixer,
  Time and Filter pads and voice mode stay, and "Oscillators ›",
  "Envelopes ›", "LFO / Mod ›", "Filter ›" and "Global ›" open Live's
  sections as pages (`driftPanel.ts`).

## Consequences
- Operator, Electric, Collision and Drift reach every parameter but Device
  On (194 of 195, 33 of 34, 139 of 140, 65 of 66), each at most three taps
  from the frame. Operator's view drew about 10, Drift's about 20.
- The panels show Live's values only while a box is dragged, as every
  value box in the app does (the audit's open question on readouts at rest).
- The other instruments keep their hand-laid views until moved onto
  panels.
- The shot tour's Electric and Collision states now load the measured
  parameter lists, and reach each tab and page (`inst-electric-*`,
  `inst-collision-*`).
