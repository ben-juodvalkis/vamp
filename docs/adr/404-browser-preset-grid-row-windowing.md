# ADR-404: Browser Preset Grid Row Windowing (DOM Virtualization)

## Status
**Accepted**

## Context

The drill-down browser rendered every tile of the current level. Folder
navigation keeps most screens small, and the depth cap (ADR-392) plus the
audio-vendor nesting exemption keep the *catalog* shaped sensibly — but a
single huge flat leaf (a multi-thousand-file sample folder, or a
depth-cap-flattened preset folder) still produced one DOM node per tile.
Nothing crashed — waveform decodes were already viewport-gated (ADR-401) —
but initial render and scroll got progressively worse with folder size, and
the only guardrail was the preset-library.md *guideline* "avoid 500 presets
in one folder".

ADR-100 explicitly rejected virtual scrolling ("folder navigation already
provides natural chunking"). That reasoning held for the catalog's *tree*,
but not for its *leaves*: leaf size is set by the user's sample library, not
by catalog structure.

A second, worse symptom hid behind the first: the adapters' default
`getPresets` limit of 200 applied to flat audio leaves
(`unifiedAdapter.getPresets` → `node.presets.slice(0, limit)`), so a
1,000-sample folder silently showed only its first 200 files. The instrument
path (`typeFirstAdapter`) returned leaves uncapped — inconsistent in the
other direction.

## Decision

Window the preset grids to the rows intersecting the viewport (± 3 rows of
overscan), and lift the 200-item truncation now that rendering is bounded.

**Why this is cheap here:** the adaptive-grid solvers (`computeGridLayout`,
`computeGroupedGridLayout`) already fix exact, uniform tile geometry before
anything renders — fixed `--tile-h` row height, fixed gap, known column
count. The hard part of general list virtualization (measuring
variable-height items) doesn't exist; the visible window is pure arithmetic.
No library.

Mechanics (all pure math in `drillDownModel.ts`, unit-tested):

- **Plain leaf grid** — `computeVisibleWindow(scrollTop, viewportHeight,
  count, columns, tileHeight, …)` returns the item slice to render plus
  `topPad`/`bottomPad`, applied as inline padding on the grid element so
  scroll height and tile positions are pixel-identical to the full render.
- **Grouped (ADR-403) screen** — `computeGroupedVisibleWindow` windows at two
  levels: whole off-screen sections collapse into scroller-level spacer divs,
  and the row window inside each surviving section becomes grid padding. A
  partially visible section always keeps its header in the DOM, so sticky
  pinning is unaffected. The bottom spacer only renders when sections are
  actually skipped below, preserving the `:last-child` margin reset.
- **Component wiring** (`DrillDownBrowser.v6.svelte`) — `onscroll` handlers
  are rAF-gated and commit new window state only when the window actually
  changes (`windowsEqual`/`groupedWindowsEqual`), so ordinary scrolling
  re-renders nothing until a row boundary is crossed. An `$effect` recomputes
  on level load / resize / scroller mount. `overflow-anchor: none` on both
  scroll containers stops browser scroll anchoring from fighting the padding
  swaps. Degenerate input (unmeasured stage) falls back to render-everything,
  the behavior-preserving default for the pre-measurement frame.
- **Uncapped listings** — `loadCurrentLevel` now passes `limit = Infinity` to
  `getPresets`, ending the silent 200-file truncation of flat audio leaves.
- **Folder grids stay unwindowed** — their counts are bounded by catalog
  structure (depth cap), not library size.

**Generator guardrail** (`scripts/generate-type-first-json.ts`): a new
`warnOversizeLeaves` pass flags any leaf folder over
`catalog.oversizeLeafWarn` (default 500, `0` disables) in the generation log,
for both instrument catalogs and the audio-clips split files. Diagnostic
only — the browser handles the folder fine; the warning marks a curation
smell. Leaves only, because strict one-type-per-screen means loose presets on
a non-leaf level never render as one wall.

## Consequences

- A multi-thousand-tile flat leaf renders ~2 viewports' worth of DOM nodes
  instead of thousands; first paint and scroll cost are now independent of
  folder size. The last "huge folder" defense is enforced by code rather than
  by convention, closing the gap ADR-100 left open (this ADR revisits that
  rejection for leaves specifically; the tree-shaping arguments stand).
- Audio leaves past 200 files are now *visible* — behavior change, strictly
  less surprising than the silent truncation.
- Waveform tiles compose unchanged: windowing mounts/unmounts tiles, and each
  tile's IntersectionObserver gating (ADR-401) still bounds decode work; far
  fewer observers are live at once.
- Fast flings can momentarily outrun the 3-row overscan and show briefly
  empty rows before the rAF catches up — standard windowing trade-off, tiles
  are cheap to fill.
- The window math assumes the CSS geometry it mirrors (`--tile-h` rows, 12px
  gap, section header height / gaps via `--header-h`/`--section-gap` consts).
  Those constants are already shared between solver and stylesheet; the
  windowing reuses the same single source, but a future CSS restructure of
  the grids must keep the pads in the invariant (unit tests pin it:
  windowed DOM height === full-render height at every scroll position).

## Tags
`browser`, `performance`, `virtualization`, `drill-down`, `memory`,
`catalog-generation`
