# ADR 186: Consolidated Type-First Browser Architecture

**Status**: Accepted
**Date**: 2026-02-05
**Decision Makers**: Architecture Team
**Tags**: browser, performance, type-first, json, optimization

## Context

The type-first browser navigates instruments by TYPE (Drums, Keys, Synth, etc.) rather than vendor (Ableton, Omni, NI). The previous implementation stored data as separate per-vendor files (`drum-ableton.json`, `drum-ni.json`, `drum-omni.json`) and merged them at runtime.

### Previous Architecture Problems

**Runtime Merging Overhead**:
- Every `getFolders()`, `getPresets()`, and `getFolderColors()` call loaded multiple vendor files
- Complex LRU cache management for ~31 type-vendor JSON files
- Runtime folder deduplication, vendor sorting, and color computation on every navigation
- Multi-vendor folder detection computed on each request

**Code Complexity**:
- `TypeFirstAdapter` was 359 lines with LRU cache, multi-vendor iteration, and vendor sorting
- `loadedTypeVendorFiles` and `typeVendorFilePromises` maps for request deduplication
- `VendorContribution` type traversal for computing folder colors
- `sortVendors()` method for ordering vendors at runtime

## Decision

Generate **one pre-merged JSON file per type** (e.g., `drum.json`, `synth.json`) with all vendors merged and `vendorColor` baked into each folder node at build time.

### New File Structure

```
interface/static/data/
  types-index.json     # 6KB - metadata + root folder colors per type
  bass.json            # 1.3MB - Omni only
  drum.json            # 1.8MB - Omni + Ableton + NI merged
  drums.json           # 0.8MB - Omni only (synth drums)
  fx.json              # 3.8MB - Omni + Ableton merged
  inst.json            # 5.5MB - Omni + Ableton + NI merged
  key.json             # 2.3MB - Omni + Ableton + NI merged
  synth.json           # 9.9MB - Omni + Ableton + NI merged
```

### Data Schema

**types-index.json**:
```json
{
  "metadata": {
    "generatedAt": "...",
    "totalPresets": 44217,
    "totalTypes": 7,
    "types": ["drum", "synth", "key", ...]
  },
  "types": {
    "drum": {
      "id": "drum",
      "name": "Drum",
      "file": "drum.json",
      "totalPresets": 3168,
      "vendors": {
        "Ableton": { "color": "hsl(50, 90%, 50%)", "presetCount": 467 },
        "Omni": { "color": "hsl(300, 70%, 55%)", "presetCount": 2267 },
        "NI": { "color": "hsl(180, 80%, 45%)", "presetCount": 434 }
      },
      "rootFolders": [
        { "name": "Kit", "vendorColor": "hsl(300, 70%, 55%)" },
        { "name": "Drumset", "vendorColor": null },
        { "name": "Perc", "vendorColor": null }
      ]
    }
  }
}
```

**Per-type file (e.g., drum.json)**:
```json
{
  "metadata": {
    "typeId": "drum",
    "typeName": "Drum",
    "generatedAt": "...",
    "totalPresets": 3168,
    "vendors": { ... }
  },
  "tree": {
    "folders": {
      "Drumset": {
        "vendorColor": null,
        "folders": {
          "Acoustic": { "vendorColor": "hsl(50, 90%, 50%)", ... },
          "Abbey Road": { "vendorColor": "hsl(180, 80%, 45%)", ... }
        },
        "presets": []
      }
    },
    "presets": []
  }
}
```

### Folder Sorting

Folders are sorted at build time in this order:
1. **By vendor group**: Ableton → Omni → NI → multi-vendor
2. **Within vendor group**: Pinned items from `constants.json` first
3. **Then alphabetically**

This preserves vendor grouping when browsing - Ableton folders appear first, then Omni, then NI, with multi-vendor folders last.

### vendorColor Field

Each `FolderNode` has `vendorColor: string | null`:
- `string` = folder belongs to single vendor, use that vendor's color
- `null` = folder contains content from multiple vendors, UI uses type color as fallback

## Implementation

### Generator Script (`scripts/generate-type-first-json.ts`)

1. Scans all vendors and builds `typeMap[typeName][vendorName]`
2. For each type, merges all vendor trees with `mergeVendorTrees()`:
   - Same-named folder from 1 vendor → `vendorColor = vendor's color`
   - Same-named folder from 2+ vendors → `vendorColor = null`
   - Presets concatenated (they have unique fullPaths)
3. Applies `sortFolderKeys()` at all levels for vendor grouping
4. Writes single `{typeId}.json` per type
5. Cleans up old per-vendor files automatically

### TypeFirstAdapter (`interface/src/lib/services/adapters/typeFirstAdapter.ts`)

Simplified from 359 → 241 lines (~40% reduction):

**Removed**:
- LRU cache (`folderAccessOrder`, `evictLruIfNeeded`, `updateLruOrder`)
- Multi-vendor iteration and merging
- `sortVendors()` runtime sorting
- `typeVendorFilePromises` map
- Per-instance `typesIndex` state

**Simplified**:
- Uses shared `getTypesIndex()` singleton for index
- Single `typeFileData` cache per adapter
- `getFolders()` → direct tree navigation
- `getPresets()` → direct tree navigation
- `getFolderColors()` → reads `vendorColor` from each folder node

### Shared Singleton

`getTypesIndex()` function provides module-level caching of `types-index.json`:
```typescript
let typesIndexCache: TypesIndex | null = null;
let typesIndexPromise: Promise<TypesIndex> | null = null;

export async function getTypesIndex(): Promise<TypesIndex> {
  if (typesIndexCache) return typesIndexCache;
  if (!typesIndexPromise) {
    typesIndexPromise = fetch('/data/types-index.json')
      .then(res => res.json())
      .then(data => { typesIndexCache = data; return data; });
  }
  return typesIndexPromise;
}
```

All 7 `TypeFirstAdapter` instances share this singleton instead of each fetching their own copy.

## Alternatives Considered

### Option 1: Keep Per-Vendor Files with LRU
- **Approach**: Maintain current 31 files, optimize LRU cache
- **Rejected**: Still requires runtime merging, complex cache management
- **Complexity**: Diminishing returns on optimization

### Option 2: Single Monolithic File
- **Approach**: One giant `types.json` with all 7 types
- **Rejected**: Would be ~25MB, negates lazy loading benefits
- **Memory**: Loads everything even when browsing single type

### Option 3: Per-Subfolder Files
- **Approach**: `drum-drumset.json`, `drum-kit.json`, etc.
- **Rejected**: Over-fragmented, adds file management complexity
- **Files**: Would result in 50+ files instead of 7

## Consequences

### Positive

**Simpler Architecture**:
- 7 files instead of 31
- No runtime merging logic
- No LRU cache needed (all 7 files fit in memory at ~25MB)
- Vendor colors pre-computed, no runtime detection

**Better Performance**:
- Single file load per type instead of 3+ vendor files
- Direct tree walk instead of multi-tree merge
- ~40% less adapter code to execute

**Cleaner Code**:
- TypeFirstAdapter reduced from 359 → 241 lines
- No `VendorContribution` type traversal
- No `sortVendors()` runtime sorting
- Shared singleton for index (no per-adapter duplication)

**Preserved UX**:
- Browser navigation identical
- Folder colors work the same
- Vendor grouping preserved via build-time sorting

### Negative

**Slightly Larger Individual Files**:
- `synth.json` is 9.9MB (combines 3 vendors)
- Total ~25MB for all types vs ~31 files before

**Build-Time Sorting**:
- Folder order is fixed at generation time
- Runtime sort customization not possible (acceptable trade-off)

### Neutral

**Memory Usage**:
- All 7 type files can stay in memory (~25MB total)
- iPad handles this fine (3-4GB available for Safari)
- No eviction strategy needed; files are manageable size

**Gitignored Files**:
- Consolidated JSON files are auto-generated from user's preset library
- Added to `.gitignore`: `types-index.json`, `bass.json`, `drum.json`, etc.

## Files Changed

| File | Change |
|------|--------|
| `scripts/generate-type-first-json.ts` | Merge phase + single file output |
| `interface/src/lib/services/adapters/typeFirstAdapter.ts` | Simplified, uses singleton |
| `interface/src/lib/services/adapters/browserAdapter.ts` | Added `vendorColor` to `FolderNode` |
| `.gitignore` | Added consolidated JSON files |

## Related ADRs

- ADR 100: Browser Memory Optimization - Split Vendor Files
- ADR 099: Dynamic Instrument Vendor System
- ADR 018: Gesture Browser Architecture
