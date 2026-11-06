# ADR-510: A central view's face is laid on one column grid

## Status
**Accepted** (2026-11-06)

## Context

Each central view sized its sections one by one: a flex share here, a fixed
width there, a column widened until a knob fit. Measured on Drift's face at
1366 x 1024 (the iPad Pro 12.9", the effects chain above the view, so the
view is ~1000 x 327), its narrow columns were 88, 88, 88, 88, 64, 88 and 144px
wide with a 164px pad: four widths where Ben expected one, and the envelope
and filter columns, side by side in role, did not match. Every fix to one
column moved the others.

## Decision

- **A face is one grid of equal columns.** `central/FaceGrid.svelte` takes
  `sections`, each section's column count left to right, and lays them on
  one grid: every column the same width, every gutter inside a section
  `--face-gutter` (8px), every seam between sections the same distance (a
  central gap, the 1px hairline, a central gap). `FaceSection` is a section
  `span` columns wide; `FaceSeam` is the hairline between two.
- **Two rows.** A header line every section shares (its `PanelEyebrow`,
  sometimes with a small switch beside it) and the controls under it, all
  starting and ending on the same pixel.
- **Controls sit on the columns.** Sections are CSS subgrids, so a control
  is one column wide unless it spans more (`face-span-2`, `face-span-all`).
  A pad is two columns; a stack of knobs is one.
- **Sections follow Live's signal order** where the device has one (Drift:
  Oscillators, Filter, Envelopes, LFO/Mod, Global).
- **The column count is the design.** Pick the counts so a column holds the
  view's knobs at their ADR-509 size: at 1000px with four seams, ten
  columns are ~80px, which holds a 70px medium knob. A view with more
  sections or columns uses smaller knobs or fewer columns, not a column of
  its own width.

Drift is the first face on the grid: `[4, 1, 1, 2, 2]`, columns 80px, every
medium knob 70px and every small one 48px, measured.

## Consequences

- One number per face (its section list) replaces a pile of widths, so a
  face stays in proportion on a smaller iPad, where the central gap is 8px.
- A one-column section's name can be wider than its column; the header line
  lets it run into the seams either side, and short names ("Env", "HP") are
  preferred.
- Sections that need an exception (a pad that must be wider than two
  columns) take more columns; nothing on a face sets its own pixel width.

## Addendum (2026-11-06): pages, the chain cell, and pickers

- **An instrument's section pages are on the grid too.** Drift, Wavetable,
  Meld and Analog draw their own pages (`views/drift/DriftPages.svelte`,
  `views/wavetable/`, `views/meld/`, `views/analog/`): the face's eyebrows
  open them through the view's own page state, not InstrumentPanelView's.
  Each page is a FaceGrid, equal columns within the page, the first
  section's header line carrying "‹ Name" back. Operator, Electric and
  Collision keep InstrumentPanelView's rule-laid pages, now on the grid:
  a page of ten cells or fewer lies in one row, one full-height column a
  cell, so its knobs are as large as the column holds; more cells stack
  two high at medium.
- **A central view does not repeat its chain cell's pad.** The chain cell
  (ADR-485) already moves its device's XY (`deviceControls.ts`); the same
  two parameters on the central view were removed (Chorus, Redux, Drum
  Buss's Transients, Phaser, Auto Pan-Tremolo, Comb, Sampler's filter,
  Drift's low-pass, Wavetable's Osc 1, Meld's oscillator and macro pads,
  Operator's filter), and Pedal's Drive, which its cell's slider sets.
  A pad on a different pair stays, and so does a view
  that is nothing but its pad (Gate). Where a page needs the pad (Wavetable's
  Osc page, Operator's Filter page) it is drawn there.
- **The chain cell follows the view where the view picks a half.** Meld's
  chain pad moves the engine the Meld view shows, A or B
  (`stores/v6/meldEngineStore.svelte.ts`, `instrumentControlFor` in
  `deviceControls.ts`), and names it ("Osc A" / "Osc B").
- **Long lists are a `ChoicePicker`** (`central/ChoicePicker.svelte`): a
  button naming the choice that opens a grid of options over the central
  view. Drift's modulation sources, matrix targets and voice count (device
  properties, allowlisted on the surface 2026-11-06), Meld's 25 oscillator
  and 17 filter types, Collision's resonator types. Short lists stay tabs;
  shapes are glyph tabs.
- **Switches are one 44px touch row**, centred in their cell, never
  stretched to fill a column; a row of knobs sits on one line (a column's
  foot is the same height across a row whatever it holds).

## Tags