# ADR-512: An instrument at full screen is every page on one board

## Status
**Accepted** (2026-11-07). Builds on ADR-511 (the full-screen icon). Its
band half ("the half switch and the pages stay the band's") is superseded
by ADR-513: the band is one face, and the pages are this board's only.
Interface only; no Live restart.

## Context

ADR-511 lifts the central view over the whole screen, but a face laid on
ADR-510's grid sizes its columns by width, so the room went mostly to
height. The instruments that need a half switch (Osc 1/2, Voice 1/2,
Engine A/B, Operator's four oscillators) or section pages to show what
they hold still needed them at full screen. Ben: "Do proper full screen
versions of all of those instruments that usually require multiple tabs."

## Decision

- **At full screen an instrument draws a board** (`central/InstrumentBoard.svelte`):
  rows of tiles, each tile one of its sections, all on screen at once.
  Both halves stand side by side (Osc 1 beside Osc 2, Voice 1 beside
  Voice 2, Engine A beside Engine B, Operator's A to D in one table). There
  is no half switch, no tab strip and no page to open; a long pick is a
  `ChoicePicker`, whose popup is the one thing that opens.
- **A tile is the instrument's own page.** The hand-laid instruments
  (Wavetable, Drift, Meld, Analog) draw their pages with `board` set: the
  page's "‹" way back is its plain name, and where a page is too wide for a
  board row a board-only variant stacks its knobs two to a column, turns a
  tab too narrow for the 44px floor into a picker, or (Analog's filter)
  turns a pad into its two knobs. The band never draws these variants.
- **The panel instruments (Operator, Electric, Collision) carry a `board`
  in their panel data**, drawn by `InstrumentPanelView` with `board` set: a
  tile's sections are groups stacked `stack` high, slots (Operator's filter
  pad), or a **matrix**, one row per copy of a section (an oscillator, a
  resonator, an LFO, an envelope) and one column per control, named once on
  the header line, the row's name its On switch.
- **Tiles meet with a hairline between and no gap**, so two tiles'
  controls are an inset, the hairline and an inset apart: a page's own
  seam (ADR-510). A tile takes its row's width by its face columns, a row
  the height by its weight.
- **Row budget:** about 16 face columns a row, three or four rows, knobs no
  smaller than 48px where they can be and no caption truncated. Analog,
  the densest, runs about 20 columns a row: its board is compact density
  (ADR-434's 8px) and its Global tile hosts the swap pill, so every row has
  the frame's width.

### What each board holds

| Instrument | Rows |
|---|---|
| Wavetable | Osc 1, Osc 2 · Filter 1, Filter 2 · Amp, Env 2, Env 3 · LFO 1, LFO 2, Global |
| Drift | Oscillators · Filter, Envelopes · LFO / Mod, Global |
| Meld | Osc A, Osc B · Filter A, Filter B, Global · Env A, Env B · LFO A, LFO B |
| Analog | Osc 1, Osc 2, Vibrato · Filter and Amp 1, 2, Noise · Envelopes 1, 2, MPE · LFO 1, LFO 2, Global |
| Operator | the oscillators table · the envelopes table, Filter, Shaper, LFO, Pan · the LFO/Pitch/Filter envelope modulation table, Global, Output |
| Electric | Hammer, Fork · Damper and Pickup, Global |
| Collision | the resonators table (twice: tone, then mix/velocity/key/listening) · the LFO table · Mallet, Noise, MIDI amounts, Global |

### Left on the band's pages

- Operator: every envelope's loop settings (Mode, Loop, Retrig, R < Vel for
  A to D, LFO, Pitch and Filter: 28 parameters). Four more columns would
  push the board's knobs under 48px.
- Collision: the MIDI page's seven destinations; their amounts are on the
  board.

`instrumentPanels.test.ts` pins both lists: a board binds nothing its
panel does not, and leaves out exactly these.

## Consequences

- The half switch and the pages stay the band's; full screen is where an
  instrument is designed sound by sound.
- Knobs on the dense boards (Meld, Analog, Operator) draw small, 40 to 48px;
  Drift's oscillators, Wavetable's and Electric's draw larger.
- A few board captions are shortened where the band's would not fit ("A
  Vol", Operator's algorithms as 1 to 11, Collision's "Press"), and
  Collision's noise envelope is knobs on the board, not boxes, which there
  would fall under the touch floor.
- A new instrument with pages needs its own board; until it has one, full
  screen draws its band face larger (ADR-511).
- Every board has a tour state, `inst-board-<instrument>`
  (`npm run shot:tour -- central --only inst-board`).

## Tags
`central-view`, `layout`, `instruments`, `full-screen`
