# ADR-513: An instrument's band is one face; its pages are the full screen

## Status
**Accepted** (2026-11-07). Supersedes the band half of ADR-487 (a face's
eyebrow opens its section's page) and of ADR-512 ("the half switch and the
pages stay the band's"). Interface only; no Live restart.

## Context

The paged instruments drew two ways to reach a section: its page, opened
from the face's eyebrow at band height, and since ADR-512 the full-screen
board, every page on screen at once. Ben, after using both: "let's move
away from the tabbed regular-sized central views. Instead, for these
instruments, we have a single main page that fits a killer-sized central
view, and then if I want to access other things, I can blow up to full
screen."

## Decision

- **The band draws the face and nothing else.** A section's eyebrow is its
  name, not a link; there is no page to open from it and no "‹" way back.
  The full-screen icon (ADR-511) is the way to everything else.
- **The pages are the board's tiles only.** Each `*Pages.svelte` keeps the
  page layouts the board draws and loses the band's; a page that had one
  layout for both (Drift's Oscillators and Envelopes) stays as it is.
  Wavetable's Mod Sources page, which only the band drew, is gone: its five
  sources are each a tile.
- **The half switch stays the face's** (Osc 1/2, Voice 1/2, Engine A/B):
  it picks what the one face shows, and the chain cell follows it.
- **Operator's face shows the oscillator touched last on its chain cell**
  (`operatorOscStore`, as Meld's view and cell share `meldEngineStore`):
  a touch on one of the cell's four pads puts that oscillator's controls
  on the face, where Live's Osc A to D, LFO and Pitch tab strip was
  (`InstrumentPanelView`'s `tabOf`: a region its view picks draws no
  strip). The LFO and the pitch envelope are on the board. Collision's and
  Electric's tab strips stay: they swap sections in place and open no page.
- **Nothing is left to a page.** What ADR-512 kept on the band's pages is
  on the boards: Operator's envelope loop settings (Mode, Loop, Retrig,
  R Vel, a table beside its envelopes, which now take the board's width on
  a row of their own) and Collision's MIDI destinations (beside their
  amounts). `instrumentPanels.test.ts` pins that every panel's board
  reaches all its frame and pages bind. The panels' `pages` stay as that
  list.
- **Operator's board filter** is a pad across eleven columns with its type,
  circuit and shaper in one row under it (a board slot's `below`, user,
  2026-11-07).

## Consequences

- About 700 lines of band page layouts are gone, with the tests and shot
  states that opened them; the tests that checked a page's writes now run
  against its board tile (`centralDisplayStore.setExpanded(true)`).
- A control on no face is now two touches away (the icon, then the
  control), never three (eyebrow, page, back).
- The `board` flag on the hand-laid pages is now always set, and
  `PanelGroupView`'s page layout (`onPage`) is drawn by nothing: both can
  go in a cleanup.

## Tags
`central-view`, `instruments`, `full-screen`, `layout`
