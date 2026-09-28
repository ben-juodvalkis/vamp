# ADR-377: Gesture Pass-Through Gap in Browser Folder Columns

## Status
**Accepted**

## Context

During a hold-to-drag gesture in the preset browser, the user's finger moves
rightward from the vendor button column through one or more folder navigation
columns toward the preset grid. The previous gesture-active state applied a
uniform `gap: 3rem` between every button in every folder column, giving more
space to tap individual folders but providing no clear lane to slide through to
presets without accidentally triggering a folder change.

The first subfolder level (Acc, Perc, Prod, Synth, etc.) is a deliberate
drill-down target — the user is navigating into a type, not trying to bypass it.
Deeper subfolder columns are pass-through candidates; the user often wants to
slide rightward through them to reach the preset grid.

## Decision

Replace the uniform gesture-active gap expansion with a single **pass-through
gap slot** — a ghost row the same height as one button — that appears in the
column immediately to the right of the finger's current position during a drag.

### Gap rules

1. **Which column shows the gap**: `FolderNavigationColumn` with
   `columnIndex === hoveredCol + 1` (the component immediately to the right of
   the hovering finger in browser-column space).

2. **First subfolder column suppressed**: when `depth === 0` and `hoveredCol === 0`
   (finger on a vendor/type button, adjacent column is the first subfolder level),
   no gap is shown. That column is a navigation target, not a pass-through.

3. **Multi-sub-column right-side gap**: when the finger is inside a
   `FolderNavigationColumn` that renders 2 or 3 CSS sub-columns
   (`columnIndex === hoveredCol`), the sub-columns to the right of the finger's
   sub-column also show a gap row at the same row index so the finger can slide
   rightward through them. The gap spans `grid-column: {fingerSubCol + 2} / -1`.
   No gap if the finger is already in the rightmost sub-column.

4. **Gap size**: `flex: 1` (single-col) / `grid-auto-rows: 1fr` (multi-col),
   giving the gap exactly one button-slot's height. Buttons above and below
   shrink proportionally.

5. **Gap position**: computed from `hoveredY` (client Y, RAF-throttled from
   `processMoveEvent`) against the outer `.folder-navigation` wrapper rect —
   not the inner `.button-list` rect — so measurement is stable regardless of
   whether the gap slot is already in the DOM.

6. **No uniform spacing**: the `gap: 3rem` gesture-active rule is removed.
   Buttons stay at their normal compact spacing; only the one gap slot appears.

### Data flow

```
BrowserInteractionController.processMoveEvent
  → onMove({ col, idx, y: coords.y, ... })
  → UnifiedGestureBrowser.handleGestureMove
  → browserGestureStore.setFolderHover(col, idx, y)   // stores hoveredY
  → FolderNavigationColumn [hoveredCol, hoveredIdx, hoveredY props]
  → gapRowIndex / gapGridColumnStart ($derived)
  → ghost slot rendered at that position
```

### Multi-column grid restructure

The original grid used `grid-auto-flow: column`, which cannot cleanly accept a
mid-flow spanning row. The template was restructured to:

- Precompute `flatItems` (all folder items with metadata, regardless of grouped/simple source).
- Precompute `gridRows: FlatItem[][]` — a 2-D array in column-major order, so
  visual folder positions are preserved.
- Render row-by-row in the template; inject `.gap-row` at `gapRowIndex` with
  the appropriate `grid-column` span.
- Use `grid-auto-rows: 1fr` so all rows (including the gap row) share height equally.

## Consequences

**Positive**
- The pass-through gesture is now ergonomic: one clear lane per column, positioned
  where the finger actually is, rather than generic extra spacing everywhere.
- No navigation side-effects: the gap is purely visual; `hoveredCol`/`hoveredIdx`
  continue to drive folder selection as before.
- Multi-sub-column layouts handled correctly: gap spans only the sub-columns to
  the right of the finger within the same component.

**Negative / watch-outs**
- `gapRowIndex` calls `getBoundingClientRect()` on every reactive update of
  `hoveredY`. This is in a `$derived.by`, so it runs on the Svelte microtask
  queue — not on every rAF, but close. Cost is low (one rect read per move
  frame), but if profiling shows jank this could be cached.
- The `gridRows` restructure changes render from source-order iteration
  (grouped → flat) to unified `flatItems`. The `isFolderSelected` and hover
  checks are unchanged; but any future code that adds drag-reorder within the
  grid will need to account for the row-first rendering order.

## Follow-up: hover oscillation in multi-column levels

The "no navigation side-effects… the gap is purely visual" claim above held only
for single-column columns. In a **multi-sub-column** level, Case-B grows the
shared grid by a row, which (with `grid-auto-rows: 1fr`) shifts a sibling folder
under a still finger and drives a per-frame hover-flip / reflow oscillation. The
gap is visual, but the *hit-test it drives* is the hidden side-effect. Fixed in
**ADR-380** (hover re-targeting gate) — the gap itself is unchanged.

## Follow-up: discrete-row gap placement (supersedes rule 5)

Rule 5 placed the gap by measuring raw `hoveredY` against the wrapper rect and
bucketing it into a row (`floor((hoveredY - rect.top) / rowH)`). Because the
same-folder move path propagated `hoveredY` every frame
(`UnifiedGestureBrowser.handleGestureMove`), the gap re-bucketed on *any* vertical
drag — so it slid up/down even while the finger stayed on one folder. Case B
(multi-sub-column) never had this problem: it already keyed off the discrete
`hoveredIdx % numRows`.

The two cases are now unified on a **discrete row**:

- Folder buttons carry `data-row` (`flatIdx` single-col, `flatIdx % numRows`
  multi-col). The hit-test reads it; the store keeps `hoveredRow` in place of
  `hoveredY`.
- Case A returns `Math.min(hoveredRow, numRows)` — no `getBoundingClientRect`,
  no raw-Y. This also retires negative watch-out #1 (per-frame rect read).
- The same-folder move path no longer mutates any hover field, so vertical drag
  within one folder leaves the gap fixed. The gap snaps only when the finger
  reaches a different folder.

`hoveredY` is removed entirely (it had no other consumers).

### Correction: cross-column row mismatch (fraction, not index)

The first discrete-row version stored a raw **row index** (`hoveredRow`) and reused it
verbatim in the neighbour column. That broke whenever the finger's column and the gap's
column had **different row counts** — e.g. a 5-row single-column type list (Acc/Perc/
Prod/Synth/Loops) beside a 6-row two-column subfolder grid. Hovering Synth (index 3 of 5,
~70% down) placed the gap at row 3 of 6 (~50% down), so the lane sat well above the finger
and you couldn't slide across.

Fix: carry a **normalized vertical fraction** instead of an index. The controller computes
`rowFraction = (row + 0.5) / rows` from the hovered button's `data-row` / `data-rows`
(its row and its column's row count). Each column maps that fraction into its own grid:
`gapRow = floor(rowFraction * numRows)`. Still discrete per-folder (the button's own row
center), so within-folder drag doesn't move it; now also correct across columns of
differing height. Case B is unchanged — finger and gap share one grid there, so the exact
`hoveredIdx % numRows` still applies.

Updated data flow:

```
processMoveEvent  // reads data-row + data-rows → rowFraction = (row+0.5)/rows
  → onMove({ col, idx, rowFraction, ... })
  → handleGestureMove → setFolderHover(col, idx, rowFraction)   // stores hoveredRowFraction
  → FolderNavigationColumn [hoveredCol, hoveredIdx, hoveredRowFraction]
  → gapRowIndex: floor(hoveredRowFraction * numRows)  (Case A) / hoveredIdx % numRows (Case B)
```

### Residual reflow jitter (two further fixes)

After the discrete-row fix, columns still visibly "breathed" under the finger as
deeper subfolder columns loaded mid-drag. Two sources, neither a debounce candidate
(debouncing the gap would just lag the lane behind the finger):

1. **Layout transitions animating the reflow.** `.button-list` (`gap`/`padding`
   180ms) and `.selection-button` (`padding` 180ms) ease their spacing changes.
   When a column rebuilds or the gap slot opens, those transitions animate the
   grid sliding into place — read as jitter. Fix: `transition: none` on both
   under `:global(.browser.dragging)`. The one-time ease into gesture spacing
   still plays on drag-start (before `.dragging` is set), and drag-hover ink was
   already instant.
2. **Index-keyed column list.** `{#each columns}` was keyed by index, so loading a
   deeper column re-patched the DOM of columns to its left, re-triggering their
   reflow. Fix: key by `col.parentPath.join('/') + '@' + colIdx` — a column whose
   path is unchanged keeps its node; only a genuinely-changed level gets a fresh
   one.

### Multi-column order scrambling (explicit grid placement)

Rule 4's restructure left the multi-col buttons on **grid-auto-flow** with no explicit
placement — visual column-major order held only because each button landed in the next
auto-flow cell in DOM emission order. The interleaved gap div is itself an auto-placed
cell, so as soon as a full-width Case-A gap opened, every following button shifted by a
cell and the alphabetical column-major order scrambled (column 1 stopped reading straight
down). Case B was safe only because it already pinned `grid-row` explicitly.

Fix: pin **every** multi-col button to its true column-major cell via a `cellPlacement()`
helper — `grid-row = (flatIdx % numRows) + 1`, `grid-column = floor(flatIdx / numRows) + 1`
— making layout independent of DOM order and the gap. To still open the lane, rows at/below
`gapRowIndex` shift down by one, but **only in the columns the gap spans** (Case A: all
columns; Case B: columns `>= gapGridColumnStart`). Both gap divs now always carry an
explicit `grid-row` too. `grid-auto-rows: 1fr` absorbs the one extra row.

This supersedes rule 4's reliance on auto-flow; the `gridRows` column-major array is still
used to drive emission, but correctness now comes from the explicit per-cell placement.

### Gap one row too high (map fraction into the grown grid)

Once the explicit-placement fix shipped, a full-width Case-A gap opened one row **too high**
when the finger's and target's row counts differed — e.g. finger on Toms (row 4 of a 6-row
column, `fraction ≈ 0.75`) beside a 5-folder target column: the gap landed at row 4, a row
above the finger, so you couldn't slide straight across into the presets.

Cause: opening the gap **grows the target column by one row** — `cellPlacement` shifts every
button at `row >= gapRowIndex` down one, and `grid-auto-rows: 1fr` adds the slot, so the
rendered column is `numRows + 1` tall. But `gapRowIndex` mapped the fraction into the
**pre-gap** count: `floor(fraction * numRows)`. Mapping a fraction from the finger's column
into too short a space rounds the gap up a row.

Fix: divide into the **with-gap** height — `floor(fraction * (numRows + 1))`, clamped to
`numRows`. Toms: `floor(0.75 * 6) = 4` (was `floor(0.75 * 5) = 3`), aligning the gap with
the finger. The finger's own column needs no correction here: when the finger is in the
rightmost sub-column no Case-B gap opens inside its column, so `data-rows` already reflects
its true height and the fraction is accurate.

## Tags
`browser`, `gesture`, `ui`, `touch`, `folder-navigation`
