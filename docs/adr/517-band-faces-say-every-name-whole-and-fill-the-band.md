# ADR-517: A band face says every name whole and fills the band

## Status
**Accepted** (2026-11-08). Builds on ADR-510 (one column grid), ADR-513
(the band is one face), ADR-509 (knob sizes) and ADR-516 (the boards'
glow-up). Interface only; no Live restart.

## Context

After the full-screen boards (ADR-516) Ben asked for the same pass over
the regular, band-size central views, "start with the regular sized
synth ones". A screenshot pass over the nine band faces (Wavetable,
Drift, Meld, Analog, Operator, Electric, Collision, Roar, Multiband
Dynamics) found the faults were different from the boards': not too much
on the page, but too little, badly spent.

- **Cut and abbreviated names.** Roar's face stood on fifteen columns of
  57px, so a medium knob's caption read "Am…" and "Amo…". Analog's face
  had medium knobs with no caption and a three-letter mark inside ("Lvl",
  "Syn", "Vol"), the one face that abbreviated, because its ~100px rows
  could not hold a medium knob with its name.
- **Empty bands.** Electric was six large knobs and a tab in a 1002 x 263
  band, a row of knobs floating in a void. Operator's oscillator was three
  knobs in a row with the same void above and below. Drift's Global was
  one medium knob across two columns in Poly, the voice mode itself only
  on a page. Multiband's band was one giant value box and an Output knob.
- **Mixed idioms.** Meld's engine levels were value boxes reading "Engine
  A" / "Engine B" beside Wavetable's and Drift's level knobs marked 1 and
  2, and its header line glued two eyebrows ("Envelopes LFOs").
- **Switches far from what they switch.** Roar's Shaper and Filter
  switches were a row of slabs at the stage's foot, two rows under the
  type picks they belong with.

## Decision

Six rules for a band face, applied to the nine faces.

1. **Every knob carries its whole name.** A mark inside a knob is allowed
   only where the mark *is* the name: a source level's 1 / 2 / A / B and an
   envelope stage's A / D / S / R. Analog's face knobs are small (48px) with
   their names under them, which its rows hold (48 + 44); they were medium
   with marks. Meld's engine levels are knobs marked A and B.
2. **The column count follows the knob.** A face has at most as many
   columns as hold a medium knob and its name: eleven at the band's 1030px
   (ten beside the upright swap pill). Roar's face is eleven columns
   (`[1, 2, 6, 1, 1]`), fifteen before: Input, Feedback and Global stack
   their two knobs in one column each, the stage's six knobs stand one a
   column.
3. **A section fills the band's height.** A section with room for it draws
   two rows of medium knobs, or stacks its knobs with their names beside
   them; never one row in a void. Electric's frame is Live's five sections
   (Hammer, Fork, Damper, Pickup, Global), each two rows of medium knobs
   drawn from its page's parameters (the hammer's force and noise decay,
   the tine's colour and decay, the damper's tone, the pickup's distance,
   Global's voices). Operator's oscillator and LFO groups stand on two
   columns, so their three knobs stack with names beside, as Global's did.
   `faceKnobFit` now breaks a tie between layouts whose knobs draw the same
   size in favour of a grid with no empty cell (three knobs over two
   columns stack three high rather than two and an orphan), after the
   one-row preference and before cell room.
4. **A switch sits on the line of what it switches.** Roar's stage puts
   each half's type pick and its switch on one touch row (Shaper · On,
   Filter · On), the six knobs under them.
5. **A section's picks live on the face.** Drift's Global row is the voice
   mode (Poly · Mono · Stereo · Unison) over the knobs the mode brings:
   Drift alone, large, in Poly; the mode's own knob beside Drift otherwise,
   Glide between them in Mono. Drift's LFO pad has its wave and rate-mode
   picks under it, `ChoicePicker`s with their names inside.
6. **A device's own picture is its band control where it has one.**
   Multiband's band is the Mid band's display (`BandDynamicsDisplay`,
   ADR-515) across six columns, then Amount and Output, large. The Below
   Ratio stays the chain cell's slider (user, 2026-10-26); the display
   moves it only as one of the band's four handles, which is the picture
   Live draws and not a second ratio control.

Wavetable's face already met the rules and is unchanged; Collision's is
left as it was (Live's tab strip over a row of medium knobs).

## Consequences

- No caption on any band face ends in an ellipsis at 1366px.
- Electric's `InstrumentPanelViews` and `panelKnobLayout` tests pin the
  new frame; `DynamicsCentralViews` pins Multiband's display and knobs.
- `scripts/shot/tour.mjs` gained `--expand`, which taps the full-screen
  icon after each state's steps: the way to shoot every board in one run.

## Tags
`central-view`, `band-face`, `face-grid`, `knobs`, `instruments`, `roar`, `multiband`, `ui-design`
