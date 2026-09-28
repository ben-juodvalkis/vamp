# ADR-408: Per-Folder Flatten Override in Catalog Generation

## Status
**Accepted** (2026-07-23)

## Context

The catalog generator caps instrument folder nesting globally at
`catalog.maxFolderDepth` (currently 2; `capFolderDepthNode` in
`scripts/generate-type-first-json.ts`). Root folders are depth 1; a folder at
the cap absorbs every preset nested below it, de-dupes by name, and drops its
subfolder nodes. ADR-403 then re-groups that flat list back into per-parent
sections at render time, so a capped folder still reads as labeled sections
rather than one anonymous wall.

The cap is a single global number, which is the wrong granularity for some
branches. A deep, over-nested branch like `Omni/Bass/Acoustic` (Acoustic at
depth 3, below the effective cap for its type) keeps drilling one level too far
for how few presets it holds — Acoustic → Upright/Fretless → a handful of
presets each. The user wants *that specific folder* to flatten (its descendants
roll up onto Acoustic, still grouped by parent), without lowering the global
cap and collapsing every other type's structure.

The existing `isAudioVendorNode` exemption already established the pattern: a
path predicate that overrides the global depth for specific subtrees (there, to
*keep* audio nesting). The generalization is a configurable list of paths that
force the opposite — flatten regardless of depth.

Two shapes were considered for authoring the rule:

1. **Path + explicit depth** (`{"Omni/Bass/Acoustic": 2}`) — "cap this subtree
   at N levels." Flexible but forces the author to reason about depth
   arithmetic per folder.
2. **Path only** (`["Omni/Bass/Acoustic"]`) — "flatten everything under this
   folder onto it." Matches how the branch is actually described ("flatten
   Acoustic"); no number to get wrong.

## Decision

Add `catalog.flattenFolders`: a list of merged-tree paths. A node whose `path`
is a listed folder — or sits under one — collapses **on that folder**
regardless of depth, using the same roll-up as a depth-cap hit
(`collectPresetsDeep` + `dedupePresetsByName`, sorted). The listed folder
becomes the flat, grouped screen; everything below it short-circuits (a
descendant of a listed folder is itself a match, so the recursion never
re-expands it).

- `FLATTEN_FOLDERS` + `isForcedFlattenNode(path, list)` in
  `generate-type-first-json.ts`. Match is **exact-or-prefix on `/`
  boundaries**: `Omni/Bass/Acoustic` matches that folder and its descendants,
  not `Omni/Bass/AcousticX`.
- The force-flatten check runs in `capFolderDepthNode` **before** the depth
  check and after the audio-vendor exemption, and logs `[FlattenFolder]`
  (distinct from `[DepthCap]`) so overrides are visible in the generation log.
- **No browser change.** ADR-403's `groupPresetsByOrigin` recovers per-parent
  sections from each preset's physical `path` and is origin-driven, not
  cap-driven — it doesn't care *why* the list is flat, so a folder flattened
  by an override groups identically to one flattened by the global cap.
- `capFolderDepth` / `capFolderDepthNode` / `isForcedFlattenNode` are now
  exported and the generator's `main()` is guarded to run only under direct
  invocation, so the pure tree helpers are unit-testable via relative import
  (the `typeFirstSort.ts` precedent).

**Path-only over path+depth.** The user's intent is "flatten this folder," not
"cap this subtree at N." Path-only removes per-folder depth arithmetic; to
flatten a shallower or deeper point, list that folder instead. Nothing is lost
— the global `maxFolderDepth` still governs everything unlisted.

Rejected alternatives:

- **Lower the global `maxFolderDepth`.** Collapses every type's structure to
  fix one branch; the whole point is per-folder granularity.
- **Marker file on disk** (`.flatten` sentinel in the preset folder). Keeps the
  rule with the content, but pollutes the Ableton library with dot-files and
  scatters the rules where no single place lists them. Config keeps every
  override auditable in one spot.
- **Runtime "flatten this folder" toggle in the browser.** The nicest UX, but a
  real feature in the store/component layer for a rule that is stable per
  library. Deferred; the baked override is the small, consistent change (it
  generalizes the existing audio exemption).

## Consequences

- A deep branch can be flattened in isolation by adding one path to
  `catalog.flattenFolders`; removing it and regenerating fully reverts.
  Seeded with `Omni/Bass/Acoustic`.
- Overrides reuse the depth-cap roll-up verbatim, so they inherit
  `dedupePresetsByName` (a group can be one tile short of its on-disk folder)
  and the ADR-403 grouping — consistent with existing cap behavior, nothing new
  to reason about downstream.
- The force-flatten check is path-scoped, not name-scoped: only
  `Omni/Bass/Acoustic` flattens; the other `Acoustic` folders (Guitar, String,
  Vocal, Wind) still hit the ordinary depth cap. Verified in a generation run
  (`[FlattenFolder] Collapsing "Acoustic" (41 presets) at path:
  Omni/Bass/Acoustic`).
- Config surface grows by one key (`flattenFolders` + `_note` in
  `constants.json`, schema entry in `constants.schema.json`). The mirrored
  static/build copies refresh via `copy-constants.js` on the next build.
- `main()` now runs only on direct invocation. The guard compares
  `import.meta.url` against `argv[1]`'s basename (tsx may resolve `argv[1]`
  through symlinks), so generation still fires under `npm run
  generate-instruments` / `dev` / `ipad` while a test import stays
  side-effect-free.

## Tags
`catalog`, `generation`, `depth-cap`, `preset-grouping`, `browser`,
`config`, `adr-403`, `adr-408`
