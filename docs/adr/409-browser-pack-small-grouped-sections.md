# ADR-409: Browser Packs Small Grouped Sections Into Shared Row-Bands

## Status
**Accepted** (2026-07-23)

## Context

ADR-403 re-groups depth-cap-flattened presets into headed sections (one per
recovered origin folder), each rendered as its own full-width grid block stacked
vertically. That reads well when sections are substantial, but a flattened
folder often contains many *tiny* sections — the `Perc/Damage` screen has
Combo (1), Damaged Elements (1), Hybrid Elements (1), Metal (2), Random (1),
Tranrasition (1), … Each 1–2-tile section reserved a whole full-width row, so
most of the screen was dead space and everything below the fold needed extra
scrolling.

The fix has to hold three constraints ADR-403/404 established:

1. **Tile-size parity.** Tiles inside sections must be pixel-identical to the
   plain (ungrouped) grid — an ADR-403 invariant, unit-tested. So we cannot
   resize tiles to make packing fit.
2. **Per-parent grouping stays.** Each group must keep its folder-name + count
   label; the whole point of ADR-403 is knowing which parent a tile came from.
3. **ADR-404 row windowing must keep working** for the big flattened folders
   (700+ tiles) whose virtualization depends on a stack of known-height rows.

A free-flowing CSS masonry/`flex-wrap` of sections was rejected: side-by-side
sections of differing heights break the windowing model's vertical
y-arithmetic (a section's top edge is no longer a simple running sum), which
would have meant rewriting the ADR-404 layer — exactly the risk it was built to
avoid.

## Decision

Add a **model-level bin-packing pre-pass**, `packGroupedSections(groups, cols)`
(`browser/utils/drillDownModel.ts`), that partitions the ADR-403 sections into
**row-bands** before render:

- A section is **big** when its tile count `> cols` (needs more than one tile
  row). Big sections become their own `kind:'full'` band and flow through the
  **identical** single-section ADR-404 windowing path they used before.
- A section is **small** when it fits in one row (`≤ cols`). Small sections pack
  **greedily left-to-right** into a `kind:'packed'` band, accumulating until the
  next section would push the band's total tile count over `cols`, at which point
  a new packed band starts.

The load-bearing property: **a packed band is exactly one tile row tall by
construction** (`ceil(totalTiles / cols) === 1`), so it maps 1:1 onto a single
windowing section — **ADR-404's math needed zero changes**. Only the
*partitioning* of sections into bands is new; big sections still window
per-row, packed bands render whole (one row never needs virtualization).

Render (`DrillDownBrowser.v6.svelte`): a `full` band renders as the existing
windowed section; a `packed` band is a `.band-row` flex row of `.band-cell`s,
each carrying its own header (name + count) above a fixed-`--tile-w`-px-column
mini-grid of its tiles. Two details make it read correctly:

- **Cell gap = the tile gap (12px), not the section gap (24px).** Every tile
  across every row then lands on the same column pitch, so columns line up
  between a full row and the packed rows below it (verified: tile left-edges
  identical across rows — `187, 366, 544, 723, 901, …`).
- **Packed-cell headers wrap to two lines** (`-webkit-line-clamp: 2`) instead of
  truncating, since a packed cell is only as wide as its tiles (often one). The
  full-width (non-packed) header keeps its single-line + hairline treatment.

Tile size is never touched — packed cells use fixed `--tile-w` columns equal to
the solver's `tileWidth`, so tile parity holds.

## Consequences

- Small-section screens fill horizontally instead of stranding lonely rows; the
  dead space is gone and less scrolling is needed. Big sections are unchanged.
- **ADR-404 windowing verified intact** on a scrolling grouped screen (NI
  Expansions): scroll height stayed pixel-identical, off-screen sections
  collapsed to spacers, in-section row windows still engaged. No tradeoff.
- **Tile parity verified live** — packed-cell tiles and full-band tiles both
  measure identically (167×110 at the test viewport).
- `computeGroupedGridLayout` still receives per-section accounting (not bands) to
  choose columns/tile height — deliberately, so the ADR-403 tile-parity invariant
  the tests lock still governs the column choice; packing then consumes the
  resulting `cols`.
- Packing is **greedy, not balanced** — a packed row can end before it visually
  fills (e.g. 5 tiles across sections when `cols` is 6) because the next section
  wouldn't fit. Balancing rows was considered and deferred; greedy is predictable
  and reads fine. The threshold ("big" = more than one row) is the other tunable
  left as-is until real use argues otherwise.
- The rule packs by tile count, but each packed cell also carries a header, so a
  cell with N tiles is wider than a 1-tile cell — accepted; cells still fit
  because the packed total never exceeds `cols` tiles.

## Tags
`browser`, `drill-down`, `preset-grouping`, `grid-layout`, `section-packing`,
`ipad`, `adr-403`, `adr-404`, `adr-409`
