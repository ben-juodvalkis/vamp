# ADR-403: Browser Re-Groups Depth-Cap-Flattened Presets by Origin Folder

## Status
**Accepted** (2026-07-15)

## Context

The catalog generator caps instrument folder nesting at
`catalog.maxFolderDepth` (currently 2; `capFolderDepthNode` in
`scripts/generate-type-first-json.ts`). A folder at the cap absorbs every
preset nested below it, de-dupes by name, and drops the subfolder nodes. The
cap itself is good — it keeps the drill shallow — but the result is a single
flat, alphabetical wall of tiles (e.g. Inst → Wind → Winds: 716 tiles where
flutes, clarinets, ethnic instruments and 593 synth patches interleave with no
context; Key → Bells → Synth: 595 tiles spanning 32 sub-genre folders).

Each absorbed preset keeps its full physical `path` (relative to the
instruments base), so the lost structure is recoverable.

A first attempt (PR #455, scrapped) proved the *section* concept but broke the
*tile geometry*: it reused the whole-list column count and forced an arbitrary
fixed tile height per section, so grouped tiles came out mis-proportioned next
to the plain grid, which sizes tiles with the adaptive solver
(`computeGridLayout`). It was also designed blind — never rendered on real
data before review.

Two constraints shaped the redo:

1. **Tile parity.** Tiles inside sections must be indistinguishable from
   plain-grid tiles — same solver-driven size, proportion, fills, badges,
   waveform behavior.
2. **Path matching must survive the generator's tree edits.**
   `flattenMergedFolders` (runs before the cap) elides single-child wrapper
   directories from the *browsable* tree while `preset.path` keeps the full
   physical chain, so the navigated `currentPath` can be a non-contiguous
   subsequence of a preset's real path. Separately, vendor/type prefix
   segments can repeat a navigated folder's name (`Ableton/Bass/Bass/…`).

## Decision

Group at **render time in the browser's pure view-model layer** — no catalog
format change, no adapter interface change.

- `groupPresetsByOrigin(presets, currentPath)`
  (`browser/utils/drillDownModel.ts`): recovers each preset's origin folder as
  the path segment immediately after `currentPath`, matched inside
  `preset.path` as an ordered **non-contiguous subsequence anchored from the
  right** (nearest the filename). Right-anchoring keys the split off the
  navigated folder, not a same-named prefix; non-contiguity survives elided
  wrappers. Unmatchable paths fail **soft** into the loose bucket — a preset
  can be mis-grouped in pathological trees, never lost. Output: loose bucket
  (presets directly in the folder) first, then named groups alphabetical,
  preset order within a group untouched (baked-alphabetical, ADR-391).
- `computeGroupedGridLayout(...)`: sectioned variant of `computeGridLayout`
  with **identical scoring and weights**; only the row accounting differs
  (each section rounds up to whole rows; headers and section gaps consume
  fixed vertical chrome; columns never exceed what the largest section can
  fill). Once content scrolls — every realistically flattened folder — it
  converges to exactly the plain solver's column count and tile height, which
  is the tile-parity guarantee, unit-tested as an invariant.
- `DrillDownBrowser.v6.svelte` renders sections only when grouping recovers
  ≥ 2 buckets: one scroll surface, each section an `adaptive-grid` at the
  shared `--cols`/`--tile-h`, under a calm **sticky** header (folder name +
  count + hairline; opaque, no color wash — tiles carry the color). The tile
  markup is a shared snippet with the plain grid. A leaf with nothing to
  recover renders the plain fill-the-stage grid, byte-for-byte unchanged; this
  also neutralizes the lone-elided-wrapper case (single named bucket → plain).
  The scroller is keyed on vendor + path so a fresh folder opens at the top.

Rejected alternatives:

- **Bake groups into the generated catalog.** Freezes a presentation decision
  into a format bump + regen; the generator would still need the same
  subsequence matching (merged multi-vendor folders make node-path prefixes
  untrustworthy for presets contributed by other vendors).
- **Expose grouped presets via `BrowserAdapter`.** Spreads a view concern
  across four adapters for no gain — the component already holds both inputs
  (`presets`, `currentPath`), and the pure-helper-beside-the-component pattern
  is the established one (`screenKind`, `computeGridLayout`).

## Consequences

- Flattened walls become scannable, labeled sections; the depth cap keeps its
  benefits. No data migration, fully reversible, works for every adapter.
- Grouped tiles are pixel-identical to plain tiles (invariant test:
  `grouped ≡ plain` at 716 presets / 10 sections; single-headerless-section
  reduces to `computeGridLayout` exactly).
- Sections inherit the cap's `dedupePresetsByName`, so a group can be one tile
  short of its on-disk folder — accepted, matches the pre-grouping behavior.
- Path logic lives in the view layer; if a future generator change stops
  preserving physical paths, grouping degrades to the plain grid (soft
  failure), and the unit tests around elided wrappers / repeated prefixes
  document the contract.
- Alphabetical group order puts the big "Synth" bucket mid-list in some
  folders; ordering by size was considered and deferred — predictability wins
  until real use says otherwise.

## Tags
`browser`, `drill-down`, `preset-grouping`, `depth-cap`, `grid-layout`,
`ipad`, `adr-391`, `adr-403`
