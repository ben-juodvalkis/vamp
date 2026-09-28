# ADR-392: Catalog Folder-Depth Cap

## Status
**Accepted**

## Context

The drill-down browser (ADR-391) shows **one folder layer per screen**: tap a
category, tap a folder, tap a deeper folder, … until a leaf level surfaces
presets. This makes each screen a low-parse decision, but it also makes *depth*
the cost. Every extra folder level is a full extra screen and back-trip.

Some vendor libraries nest curated instrument presets several levels past the
point where the nesting stops being useful. The clearest example: in `key.json`,
`Electric → Rhodes Synth` then splits into **8 sub-genre folders** (Ambient
Dreams, Electronic Production, Warm Tones, …), each holding ~10 presets. Those
sub-genre names are marketing collections, not a taxonomy a performer navigates
by — they're just curation noise. Under the drill-down model that's an 8-tile
screen you must cross to reach any Rhodes Synth preset, times every similarly
over-nested folder across the catalog.

The generator already collapses *single-folder chains* (`flattenMergedTree`,
`flattenFolderNode`) so a lone-child wrapper never renders as a one-tile screen.
But it did nothing about a folder that fans out into many shallow leaf folders.

An additional wrinkle: the same sub-genre folders repeat preset *names* across
collections (e.g. `Dreamy Rhodes` appears in both Ambient Dreams and Warm Tones,
as distinct files). Flatten them naively and the folder shows visually identical
duplicate tiles.

Separately, the **Audio-sample vendor** is merged into the same instrument type
files (Drum/FX/Inst/… under `Audio/…`, see the type-first generator). But samples
are the opposite case: their subfolders (`Percussion/NI/Conga`, `…/Djembe`, …)
*are* the useful organization — flattening a level-2 sample folder would bury 27
distinct instrument folders in one wall (e.g. Drumset → ~5,392 tiles) and diverge
from the standalone [Audio] browser, which keeps full nesting.

## Decision

Add a **folder-depth cap** to the catalog generator
(`scripts/generate-type-first-json.ts`), driven by two `constants.json` values
under a new top-level `catalog` block:

```json
"catalog": {
  "maxFolderDepth": 2,
  "flattenAudioVendor": false
}
```

**Cap rule (`capFolderDepth` / `capFolderDepthNode`).** Root folders are depth 1.
A folder at exactly `maxFolderDepth` keeps its own presets, **absorbs every preset
nested below it** (depth-first `collectPresetsDeep`), **drops all its subfolders**,
and the collected list is **de-duped by name** (`dedupePresetsByName`, first
occurrence wins) then re-sorted A→Z. Folders shallower than the cap recurse
normally. With `maxFolderDepth: 2`, `Electric(1) → Rhodes Synth(2) → sub-genre
folders(3+)` collapses to a single flat preset list under Rhodes Synth (106 raw
entries → 53 unique tiles, 0 subfolders).

**Runs after flattening, on the merged tree.** The cap is applied in the per-type
loop *after* `flattenMergedTree`, so single-folder chains are already collapsed and
depth is counted on the tree the browser actually renders. Because it runs on the
post-merge `MergedFolderNode`, per-tile `vendorColor` is preserved.

**Audio vendor exempt by default (`flattenAudioVendor: false`).** Audio-sample
nodes are identified by their `path` (stamped `Audio/<type>/…` during the
audio-vendor scan). `isAudioVendorNode` returns true for those and short-circuits
the cap, leaving sample folders fully nested — matching the [Audio] browser and
avoiding the multi-thousand-tile walls. Set `flattenAudioVendor: true` to apply
the same cap to samples (verified to work; off by default because it destroys the
by-instrument sample organization).

**Scope.** The cap applies only to the instrument type files (`{type}.json`). The
standalone `audio-clips-*.json` split files (dedicated [Audio] browser) go through
a separate `FolderNode` path and are untouched.

**Config plumbing.** `maxFolderDepth` and `flattenAudioVendor` are added to
`constants.schema.json` (validated by `npm run validate:constants`) and
`constants.json.example`. The generator reads them with fallbacks
(`?? 2` / `?? false`), so a missing block degrades to the same behavior.

## Consequences

**Positive.**
- Fewer screens to reach a preset under the one-layer-per-screen model (ADR-391):
  over-nested curated libraries collapse to a single leaf screen.
- Duplicate preset names produced by overlapping curation collections are stripped,
  so a collapsed folder shows each name once.
- Both knobs live in `constants.json` — depth is tunable and the Audio exemption is
  a documented toggle, no code edit.
- Audio-sample browsing keeps its by-instrument nesting; no giant flat sample walls.

**Negative / trade-offs.**
- Dedup-by-name is lossy: two genuinely different presets that happen to share a
  name collapse to one (first wins). Acceptable for these curated libraries where
  same-name entries are re-packaged duplicates; would need revisiting if a library
  used colliding names for distinct sounds.
- The sub-genre grouping (Ambient Dreams / Warm Tones / …) is discarded entirely,
  not surfaced any other way. If that curation ever matters, it's gone from the
  browser.
- `maxFolderDepth` is a single global for all instrument types; a type that
  genuinely wants deeper nesting can't opt out short of raising the global.

## Tags
`browser`, `preset-browser`, `catalog-generation`, `type-first`, `folder-depth`,
`constants`, `audio-samples`, `drill-down`, `related-391`
