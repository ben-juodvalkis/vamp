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
- **Done for Wavetable, Drift, Meld and Analog.** Operator, Electric and
  Collision (drawn from panel data, `InstrumentPanelView`) follow: Operator's
  face shows the oscillator whose pad was touched last on its chain cell,
  and what ADR-512 left only on their pages (Operator's envelope loop
  settings, Collision's MIDI destinations) moves onto their boards first.

## Consequences

- About 700 lines of band page layouts are gone, with the tests and shot
  states that opened them; the tests that checked a page's writes now run
  against its board tile (`centralDisplayStore.setExpanded(true)`).
- A control on no face is now two touches away (the icon, then the
  control), never three (eyebrow, page, back).
- The `board` flag on the hand-laid pages is now always set; it stays
  until the panel instruments are done, then goes.

## Tags
`central-view`, `instruments`, `full-screen`, `layout`
