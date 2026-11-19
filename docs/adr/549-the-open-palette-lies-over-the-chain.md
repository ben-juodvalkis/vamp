# ADR-549: The Open Palette Lies Over the Chain

## Status
**Accepted** (2026-11-19). Supersedes ADR-548's layout of the open bar
(the bar the first three sixths, the chain the last three). Interface
only; no Live restart.

## Context
Opened, the palette took three sixths of the FX section and the chain
shrank from five sixths to three to make room. A finger held on a chip
opens the bar for well under a second, so every hold shrank the chain
and grew it back: the jump Ben flagged on 2026-11-18 (203ce4c), which
no animation removes. Splitting the two (overlay for the hold, push for
the latch) was weighed and dropped as two paradigms for one bar (Ben).

## Decision
- **Open, the bar lies over the chain**, held or latched: three rows
  over the section's first three sixths, opaque, with a soft shadow on
  the cells under it. The chain keeps its five sixths and never moves.
  The chain is its own stacking context, so nothing raised in a cell
  draws over the bar.
- **The chain dims under the open bar**, held or latched (opacity 0.6,
  an 80ms fade; Ben, the same day): it is out of play, and the names at
  the cells' feet still read.
- **A latched bar stays open until the chevron or a touch outside it
  closes it** (Ben, 2026-11-19). A pick from it leaves it open. On the
  chain (`.palette-catch`, over its uncovered part) the touch closes the
  bar and presses nothing under it; anywhere else it closes the bar and
  still does its own job, so Record still records.
- **Open, the chevron points up** (Ben, 2026-11-19), down again when it
  closes.
- The phone keeps its 44px bar; open, it is 140px over the chain.

## Consequences
- With the bar latched, the tops of the cells under it are hidden; the
  header bars at their feet (names, Device On) stay in sight, so a new
  effect is seen to land. A cell's control under the bar is reached by
  closing it.
- The chain can't be reordered or tapped while the bar is latched.
- `npm run multitouch -- --fixture-data --scenario palette-latched-chain-tap-closes`
  checks that the chain keeps its box under the open bar and that a tap on
  it closes the bar with nothing sent; `palette-latched-outside-tap-closes`
  that the chevron points up while open and that a tap on a track name
  closes the bar and still mutes. `--fixture-data` (new for
  `multitouch`, as `shot` takes it) keeps a fresh clone off the
  first-run page.
