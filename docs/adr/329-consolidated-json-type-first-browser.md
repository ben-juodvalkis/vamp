# ADR-329: Consolidated JSON Files for Type-First Browser

**Date**: 2026-02-05
**Status**: Accepted
**Related**: ADR-186 (Consolidated Type-First Browser), ADR-100 (Browser Memory Optimization Split Vendor Files)

---

## Context

The type-first browser stored preset data as separate per-vendor files (`drum-ableton.json`, `drum-ni.json`, `drum-omni.json`) and merged them at runtime in `TypeFirstAdapter`. This meant:

- Every `getFolders()`, `getPresets()`, and `getFolderColors()` call loaded multiple vendor files, walked each tree, and merged results
- LRU cache management for 31+ small files
- Runtime folder deduplication, vendor sorting, and color computation on every navigation
- More network requests on initial browser open

## Decision

Generate **one pre-merged JSON file per type** (e.g., `drum.json`, `synth.json`) at build time instead of separate per-vendor files. ~7 files replace ~31.

### File Structure

```
interface/static/data/
  types-index.json     # Index listing types + root folder metadata (shared singleton)
  drum.json            # Merged Omni + Ableton + NI drum trees
  bass.json            # Merged trees
  fx.json              # Merged trees
  inst.json            # Merged trees
  key.json             # Merged trees
  synth.json           # Merged trees
  ...
```

### Merged JSON Schema

Each type file contains pre-merged folder trees with vendor colors baked into each folder node:

- `vendorColor: string` — single-vendor folder, use this color
- `vendorColor: null` — multi-vendor folder, UI uses type color as fallback

Folders are pre-sorted by vendor priority: Ableton first, Omni second, NI last.

### Generator Changes

The `generate-type-first-json.ts` script gains a merge phase:

1. Scan all vendors and build per-vendor trees (existing)
2. **New**: For each type, merge vendor trees into one consolidated tree
3. **New**: Bake `vendorColor` into each folder node based on vendor composition
4. **New**: Write single `{typeId}.json` instead of multiple `{typeId}-{vendorId}.json`

### Adapter Simplification

`TypeFirstAdapter` was simplified ~40% by removing:

- `sortVendors()` helper — sorting done at build time
- Multi-vendor tree traversal and runtime merging
- LRU cache (`folderAccessOrder`, `evictLruIfNeeded`) — only 7 files, keep all in memory
- `typeVendorFilePromises` map — simplified to single promise per type

Shared singleton for `types-index.json` avoids redundant fetches.

## Files Changed

| File | Change |
|------|--------|
| `scripts/generate-type-first-json.ts` | Added merge phase, output one file per type |
| `interface/src/lib/services/adapters/typeFirstAdapter.ts` | Removed runtime merging, LRU cache, vendor sorting |
| `interface/src/lib/services/adapters/browserAdapter.ts` | Added `vendorColor` to `FolderNode` interface |
| `.gitignore` | Added consolidated JSON files (auto-generated) |

## Consequences

### Positive

- **7 files instead of 31** — simpler to generate, fewer network requests
- **No runtime merging** — adapter just walks a pre-built tree
- **No LRU cache needed** — 7 files (~25MB total) can all stay in memory on iPad
- **Vendor colors baked in** — no runtime computation
- **Faster navigation** — single file load, single tree walk per operation

### Negative

- Larger individual files (~1-3MB each vs ~100-500KB per-vendor files)
- Regeneration required when any vendor's presets change (same as before)
- ~25MB total memory for all type files (acceptable for iPad)

## Tags

`browser`, `preset-management`, `performance`, `build-time-optimization`
