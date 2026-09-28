# ADR 125: Unified Preset Browser Architecture

## Status
**Accepted** - 2024-11-23 (Updated 2025-11-23)

## Context

The preset browser system had grown complex with Omnisphere-specific handling scattered throughout the codebase:

- `OmnisphereAdapter` (1,135 lines) with custom `typeIndex`, `libraryColors`, `isGenericCategory()`, `groupFoldersByPrefix()` logic
- Special case routing in adapter registry: `if (vendorId === 'omnisphere')`
- Hardcoded Omnisphere library colors in `vendorStateManager.ts`
- Separate navigation patterns for Omnisphere vs other vendors
- Monolithic JSON files (20MB+ for Omnisphere) loaded entirely at startup

This complexity made the system hard to maintain and extend. Adding a new vendor required code changes in multiple places.

## Decision

Implement a **unified approach** where:

1. **Folders are the source of truth** - Vendor names, IDs, and structure come directly from the `Instruments/` directory
2. **All vendors use the same adapter** - `UnifiedAdapter` handles split file loading for everyone
3. **No special-case code** - Same navigation pattern for all vendors
4. **Split JSON files** - Memory-efficient lazy loading by subfolder

### Key Design Principles

1. **Convention over configuration**: Folder structure defines everything
2. **Lazy loading**: Load only what's needed (index file first, subfolder files on-demand)
3. **LRU cache**: Limit memory usage by caching only 3 subfolder files at a time
4. **Zero code changes to add vendors**: Just create a folder and run the generator

## Implementation

### Files Deleted (1,185+ lines removed)
- `omnisphereAdapter.ts` - 1,135 lines of Omnisphere-specific logic
- `subfolderAdapter.ts` - 50 lines (obsolete)
- `interface/static/data/instruments-old.json` - 420KB legacy file
- `interface/static/data/ni-presets.json` - 14.5MB legacy file

### Legacy OSC Servers Removed (2025-11-23)

With the unified browser loading JSON files directly, the legacy Python OSC servers for Max MSP integration became obsolete:

**Deleted directories:**
- `preset-browsers/omnisphere/` - Python OSC server (ports 7400/7401) for Max MSP Omnisphere browsing
- `preset-browsers/native-instruments/` - Python OSC server (ports 7500/7501) for Max MSP NI browsing

**Removed npm scripts:**
- `dev:omnisphere` - Started Omnisphere OSC server
- `omnisphere` - Alias for dev:omnisphere
- `dev:ni` - Started NI OSC server
- `ni` - Alias for dev:ni

**Updated files:**
- `package.json` - Removed server scripts, cleaned up `dev` and `setup-ipad-core` concurrently commands
- `scripts/setup-ipad.js` - Removed misleading console messages about Omnisphere/NI servers

### Files Modified

#### UnifiedAdapter (`unifiedAdapter.ts`)
- Added automatic split/monolithic detection
- Implemented LRU cache for subfolder files (max 3 cached)
- Added `initialize()` to detect file format
- Added `loadFolderFile()` with promise deduplication and race-condition-safe slot reservation
- Added `getNodeAtPath()` handling both modes
- `getVendors()` loads dynamically from `instruments-index.json` (no hardcoding)

#### Adapter Registry (`index.ts`)
```typescript
// Before (with special cases)
if (vendorId === 'omnisphere') return new OmnisphereAdapter();
return new UnifiedAdapter(vendorId);

// After (no special cases)
return new UnifiedAdapter(vendorId);
```

#### JSON Generator (`generate-instruments-json.ts`)
- All vendors now use `writeVendorSplitFiles()` function
- Generates `{vendor}-index.json` + `{vendor}-{subfolder}.json`
- Audio clips also use split pattern
- Per-vendor error handling - failures don't stop entire generation

#### AudioClipsAdapter (`audioClipsAdapter.ts`)
- Simplified to delegate directly to `UnifiedAdapter`
- Removed redundant audio extension filtering (already done at generation time)

#### Browser Components
- `PresetGrid.svelte` - Removed `isOmnisphere` check and library colors
- `vendorStateManager.ts` - Removed `getLibraryColor()` function
- `browserAdapter.ts` - Removed `library` field from `Preset` interface
- `recentInstrumentsStore.svelte.ts` - Removed `library` field

### Generated Files Structure

```
instruments-index.json          0.8 KB   (master index)

ableton-index.json              0.8 KB
ableton-{subfolder}.json        ~300 KB  (4 files, 544 presets)

ni-index.json                   1.2 KB
ni-{subfolder}.json             ~5.4 MB  (8 files, 11,373 presets)

omni-index.json                 1.1 KB
omni-{subfolder}.json           ~18 MB   (7 files, 32,597 presets)

audio-clips-index.json          1.3 KB
audio-clips-{subfolder}.json    ~13 MB   (8 files, 27,382 files)
```

**Total: 31 JSON files, ~37 MB** (split for lazy loading)

## Memory Optimization

| Metric | Before | After |
|--------|--------|-------|
| Initial load | ~20 MB (full Omni vendor) | ~3 KB (indexes only) |
| Per-folder navigation | N/A (all loaded) | 1-5 MB on-demand |
| Max memory (LRU) | ~50 MB (all vendors) | ~10-15 MB (3 cached) |

## Important Distinction

**Browser vendor ID** (`omni`) and **Instrument type** (`omnisphere`) are separate:

| Aspect | Browser Vendor | Instrument Type |
|--------|---------------|-----------------|
| Source | Folder name (`Omni/`) | Plugin name from Ableton |
| ID | `omni` | `omnisphere` |
| Used for | Preset browsing | Central view selection |

The `OmnisphereCentralView.svelte` remains because it's a legitimate control surface for Omnisphere's macros, triggered by plugin detection—not browser selection.

## How to Add a New Vendor

1. Create folder: `ableton/Presets/Instruments/NewVendor/`
2. Add subfolders with presets
3. Run: `npm run generate-instruments`
4. **Done!** No code changes needed.

## Consequences

### Positive
- **~1,200 lines of code removed**
- **Zero special-case routing** for any vendor
- **Memory usage reduced** by 70%+ at startup
- **Easy extensibility** - add vendors without code changes
- **Consistent behavior** across all vendors
- **Simpler mental model** - folders = truth

### Negative
- Lost per-library color coding in preset grid (minor UX change)
- Lost folder prefix grouping (e.g., "Rhodes 1", "Rhodes 2" → "Rhodes")

### Neutral
- Requires regenerating JSON when folder structure changes
- `restructure-omnisphere.ts` still needed to create symlinked folder structure

## Related

- ADR 124: Omnisphere Split-by-Type (superseded by this ADR)
- ADR 020: Omnisphere Physical Restructuring (still applies)
- `browser-simplification-plan.md` - Full implementation details
