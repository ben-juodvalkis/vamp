# ADR-516: A board's tiles are panels with header bars

## Status
**Accepted** (2026-11-08). Builds on ADR-511 (the full-screen icon),
ADR-512/513 (an instrument's board) and ADR-514/515 (pictures and ranks).
Supersedes ADR-512's seam rule and ADR-515's 5.5rem caption clause.
Interface only; no Live restart.

## Context

Ben asked for "a full UI glow up and rearrange" of the full-screen
boards, "what a high-quality UI/UX designer would create", for touch. A
screenshot pass over all nine boards (the seven instruments, Roar,
Multiband Dynamics) found the same faults on every one:

- **No section hierarchy.** Tiles met with a hairline (ADR-512) that on
  the dark skin is `#0f1013` on `#30343b`: invisible. A board of a hundred
  knobs read as one field. Tile names were 12px labels on the face's
  header line, glued to the first section's name ("Oscillators Osc 1",
  "LFO / Mod LFO", "Envelopes A Amp").
- **The orange owned the page.** Every section's On, Key, Scale, Reset,
  Osc 1, Osc 2 and Noise switch was a full-fill touch slab among the
  knobs, so a board of thirty sections was thirty orange rectangles, and
  the device's ink and its lead knobs came second.
- **Captions cut.** Meld's rows stacked two knobs to a column in rows too
  short for either, and ADR-515's rule put a caption beside the knob in
  any short cell, so Meld read "S...", "T...", "D...", "Sust...", "Rele...".
- **Picks under the floor, and mute.** A `ChoicePicker` was 36px tall,
  looked like an OFF switch, and named only its value ("None ▾", "— ▾").
- **Layout slips.** Wavetable drew the Sub on both oscillator tiles and
  had no filter routing on the board; Drift's Level, On and To Filter were
  three columns of lamps where a mixer table belongs; Drift's Pitch Mod
  and Matrix were stacked under other sections.

## Decision

- **A board's tile is a panel** (`InstrumentBoard`): a surface a shade
  off the frame's (`--board-panel-bg`, the well mixed into the frame's
  ground), a hairline frame, 6px corners, a `--board-gap` (8px) between
  two tiles and around the board. The hairline seams are gone.
- **Every tile has a header bar** (`central/BoardTile.svelte`, 2.25rem):
  the section's name in its own ink (Osc 1 in Osc 1's orange, Engine B in
  its blue, a filter in its voice's) over a wash of that ink, with **the
  section's switch at its right** where the section has one (Osc, Sub,
  Filter, Amp, LFO, Vibrato, Noise, Engine, Stage, Band, Sidechain,
  Operator's Filter and LFO, Collision's Mallet and Noise), lit while on
  as every switch is, and room between for a pick or two that belong to
  the whole section (Wavetable's category and table). The switch is
  3.25rem wide and the bar's height: one step under the 44px floor,
  bought back in width. A panel instrument names its tile's switch in its
  board data (`PanelBoardTile.switchParam`, counted by `boardSwitches` so
  the reference test still sees it); the duplicated On controls left the
  groups.
- **The face's header line is for section names, or nothing.** A tile of
  one section drops the line (`FaceGrid heads={false}`) so its controls
  take the height; a tile of several keeps it for their names, or for
  column names over a run of columns (`heads`), set small (11px) under
  the bar's 13px title.
- **A pick is a field** (`ChoicePicker`): a touch row on a board
  (`--picker-h`), its own name small over its value ("Wave" over "Sine",
  "Loop" over "None"), its padding small in a board's narrow columns.
  A panel's picks carry their name inside the field the same way.
- **A knob's caption stands beside it only in a cell at least 9rem wide**
  (`KnobFace`, `knobDiameter`); in any narrower cell it stays under the
  knob, which shrinks to make room, so the word is whole. Beside, the
  knob takes 45% of the cell and the caption the rest. `EnvelopeGraph
  knobs="short"` letters the stage knobs under a picture too narrow for
  the words (Meld). The knob's side padding is 2px.
- **A selector row over a knob row** is the tile grammar where a section
  mixes picks, switches and knobs (Meld's engines, LFOs and filters;
  Roar's stages): the picks and switches one touch row across the top,
  the knobs under them at their rank, as Live's own panels stand.
- **Lamps in a table**: Drift's mixer is a row a source (its level, its
  switch, its route), the switches touch squares with no word under the
  columns' names.
- **The pictures** (`EnvelopeGraph`, `LfoGraph`) have 4px corners, the
  envelope's body a gradient of its ink fading to the floor, faint slot
  lines at the quarters, and 12px handles.
- **Re-laid boards:**
  - Wavetable: Osc 1 | Osc 2 | Sub (once); Filter 1 | Routing | Filter 2
    (Serial, Parallel, Split: `filter_routing`, which the board lacked);
    the three envelopes, each its slopes two to a column; LFO 1 | LFO 2 |
    Global.
  - Drift: Oscillators (Osc 1, Osc 2, the Mixer) | Pitch Mod; Filter |
    Envelopes; LFO | Matrix | Global.
  - Meld: a row a section, Engine A's tile beside Engine B's (the twins
    side by side, as Wavetable's oscillators): Engine A | Engine B;
    Filter A | Filter B | Global; Envelopes A | Envelopes B; LFOs A |
    LFOs B. Four rows hold what five rows of two-high columns (Engine A
    over Engine B, Ben's order of 2026-11-07) could not without cutting
    every caption; Ben should say if the stacked order mattered more.
  - Multiband: a band's switch on its bar; the crossovers on the Global
    tile beside Amount, so the three displays stand on the same columns.
  - Analog, Operator, Electric, Collision, Roar: the same tiles, with
    bars and the section switches on them.
- **The layout check** (`scripts/shot/layout.mjs`) measures a board's
  content against the board and its `--board-gap`, since the panels are
  the content; the swap pill beside the board stays the frame's.

## Consequences

- Every board loses about 12px of control height per row to the bar and
  gains it back where the bar replaced a switch row or the header line.
- `InstrumentBoard`'s `ink` tints nothing now (the bars tint themselves);
  it stays for the board's `--board-ink`.
- `WavetablePages`, `DriftPages`, `MeldPages` and `AnalogPages` draw the
  board only: their `board`, `onBack` / `onNavigate` / `onOpen` props and
  the band page layouts that ADR-513 left behind are gone.
- The Wavetable test pins the new tile order (`sub`, `routing` added) and
  the Sub drawn once; the InstrumentBoard test pins gaps, no seams.
- Shot states are unchanged: `inst-board-*` and `chain-board-*`.

## Tags
`central-view`, `full-screen`, `layout`, `instruments`
