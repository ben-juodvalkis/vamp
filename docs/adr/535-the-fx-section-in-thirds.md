# ADR-535: The FX Section in Thirds

## Status
**Accepted** (2026-11-13). Amends ADR-523 (the palette bar's height and
row count). Interface only; no Live restart.

## Context
ADR-523 put the palette bar over the chain at a fixed height: two rows of
chips (94px) while the chain was one row, one row (44px) once the chain
split into two. Neither height matched anything beside it. The browser
rail to the left divides the same section into three tiles (Record,
Recent, the first Place), and Ben wanted the FX section to read on the
same lines. A long chain also lost half its chips, so the palette changed
shape under the hand as devices were added.

Measured on the way: the rail's own tiles were not equal either. Record
was 95px beside two 113px Place buttons, because a button's padding and
border (18px) came off the band before flexbox split it and the Record
slot has none.

## Decision
- **The FX section is three equal rows** on the rail's 4px pitch: the
  palette bar is the first, level with the Record tile; the chain (and the
  ghost Utility) the other two, level with the two tiles under it. A
  two-row chain's rows sit on those two tiles.
- **The palette is always two rows of chips**, however long the chain.
- **The rail's tiles are equal**: every tile in a band, Record included,
  starts from the 44px touch floor and shares the rest. Measured at
  1366x1024: 107.1px each, the chips' row and the chain within 0.3px of
  the rail's seams (the FX panel's transparent 1px border sets its outer
  edges 1px inside the rail's).
- **The phone keeps a fixed bar** (two rows, 94px): its Track tab has no
  rail to line up with and a whole screen of height.

## Consequences
- A one-row chain is a little shorter than before (217px against 231px
  at 1366x1024); the chips are taller (two rows in 106px).
- A long chain keeps every family's second-row effects.
- The rail's Record tile grew 12px and the first band's two Place buttons
  shrank 6px each; the other bands are unchanged.

## Tags
`fx-chain`, `palette`, `layout`, `browser-rail`
