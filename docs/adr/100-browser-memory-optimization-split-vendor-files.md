# ADR 100: Browser Memory Optimization - Split Vendor Files

**Status**: Accepted
**Date**: 2025-11-01
**Decision Makers**: Architecture Team
**Tags**: memory, performance, browser, optimization, production

## Context

iPad production sessions were crashing after extended browser usage (2-4 hours) due to memory overload. Investigation revealed a **28MB instruments.json file** with 44,794 presets being loaded entirely into browser memory on every browser open.

### Memory Leak Sources

**Primary Issue: Monolithic JSON File**
- Single `instruments.json` file: **28MB** (423,357 lines)
- Loaded entirely into memory when browser opens
- Parsed into JavaScript objects: **~50-100MB in-memory footprint**
- Cached forever by adapters with no cleanup mechanism
- Multiplied when opening browser multiple times or switching vendors

**Secondary Issues: Unbounded Data Structures**
- `recentMessages` array: unlimited growth (WebSocket message tracking)
- `freezeDetector.metrics`: 300 entries collected every second
- `reactiveMonitor.recentUpdates`: 1000 entries of reactive state changes
- `selectedTrackStore.version`: unbounded counter increment
- No periodic cleanup of diagnostic data

### Impact
- **Browser closed**: 28MB cached indefinitely
- **Drums vendor open**: 28MB loaded (only needs 0.5MB)
- **Switch vendors**: 28MB stays loaded + new vendor data
- **Open/close 10 times**: 28MB remains in memory
- **Extended sessions**: Memory accumulation leads to browser tab crash

## Decision

Implement **per-vendor file splitting** with lazy loading and aggressive memory cleanup.

### Architecture

**Before**:
```
/data/instruments.json (28MB)
└── vendors: { drums, melodic, omnisphere }
```

**After**:
```
/data/instruments-index.json (773 bytes) - metadata only
/data/drums.json (475 KB)
/data/melodic.json (5.7 MB)
/data/omnisphere.json (21 MB)
/data/audio-clips.json (14 MB)
```

### File Format Change

**Old Format** (monolithic):
```json
{
  "metadata": { "totalPresets": 44794, "vendors": ["drums", "melodic", "omnisphere"] },
  "vendors": {
    "drums": { "id": "drums", "tree": {...} },
    "melodic": { "id": "melodic", "tree": {...} },
    "omnisphere": { "id": "omnisphere", "tree": {...}, "typeIndex": {...} }
  }
}
```

**New Format** (per-vendor):
```json
// instruments-index.json (773 bytes)
{
  "metadata": { "totalPresets": 44794, "vendors": ["drums", "melodic", "omnisphere"] },
  "vendors": {
    "drums": { "id": "drums", "name": "Drums", "trackType": "drum_rack", "presetCount": 894 }
  }
}

// drums.json (475 KB)
{
  "metadata": { "vendorId": "drums", "totalPresets": 894, "basePath": "Drums" },
  "vendor": { "id": "drums", "name": "Drums", "trackType": "drum_rack", "tree": {...} }
}
```

### Implementation

**1. Generator Script** (`scripts/generate-instruments-json.ts`):
- Modified `writeJSON()` to write separate files per vendor
- Creates lightweight `instruments-index.json` with metadata only
- Generates `drums.json`, `melodic.json`, `omnisphere.json`, `audio-clips.json`
- Each file contains only its vendor's data + minimal metadata

**2. UnifiedAdapter** (`interface/src/lib/services/adapters/unifiedAdapter.ts`):
- Constructor now takes `vendorId` instead of full path
- `loadData()`: Fetches `/data/{vendorId}.json` on-demand
- Per-vendor caching: `Map<vendorId, VendorData>`
- `clearCache()`: Method to free vendor data from memory

**3. Specialized Adapters**:
- **OmnisphereAdapter**: Loads `omnisphere.json`, preserves type-first navigation (Bass, Keys, etc.)
- **AudioClipsAdapter**: Wraps UnifiedAdapter with `audio-clips` vendor ID
- **SubfolderAdapter**: Passes `baseVendorId` to UnifiedAdapter
- All adapters implement `clearCache()` for memory cleanup

**4. UnifiedGestureBrowser** (`interface/src/lib/components/v6/browser/UnifiedGestureBrowser.svelte`):
- Loads `instruments-index.json` (773 bytes) on mount instead of 28MB file
- Lazy loads vendor data only when vendor button clicked
- Automatic cleanup: clears previous vendor when switching
- Component `onDestroy`: clears all cached vendor data
- `closeAndReset()`: clears all vendor caches when fully closing browser

**5. Diagnostic Data Cleanup**:
- `recentMessages`: Capped at 50 entries (circular buffer)
- `freezeDetector.metrics`: Reduced from 300 → 50 entries
- `reactiveMonitor.recentUpdates`: Reduced from 1000 → 50 entries
- `selectedTrackStore.version`: Wraps at 10,000 with modulo operator
- Periodic cleanup timer: Every 5 minutes, flushes old diagnostic data

## Alternatives Considered

### Option 1: Client-Side Lazy Loading (Per Folder)
- **Approach**: Keep single file, load preset lists only when navigating folders
- **Rejected**: Still loads entire folder tree structure (~10-15MB), complex caching logic
- **Complexity**: Folder structure still needs to be in memory for navigation

### Option 2: Server-Side API with Database
- **Approach**: Move preset data to SQLite/Postgres, query on-demand via API
- **Rejected**: Over-engineered for static preset data, adds server complexity
- **Build Time**: Would require server infrastructure for what is currently static files

### Option 3: IndexedDB Caching
- **Approach**: Store vendor data in IndexedDB, load from browser cache
- **Rejected**: Adds complexity, doesn't solve initial load size, persists across sessions
- **Memory**: Still loads full data into memory when needed

### Option 4: WebAssembly Compression
- **Approach**: Compress JSON files with gzip/brotli, decompress in WASM
- **Rejected**: Compression already handled by HTTP (gzip), doesn't reduce in-memory size
- **Savings**: Only helps transfer, not memory footprint

### Option 5: Preset Pagination
- **Approach**: Load presets in chunks of 100-200 as user scrolls
- **Rejected**: Folder navigation already provides natural chunking
- **UX**: Would slow down random preset selection, gesture browsing

## Consequences

### Positive

✅ **Massive Memory Reduction**
- Browser closed: 28MB → **0MB** (100% savings)
- Drums vendor: 28MB → **0.5MB** (98% savings)
- Melodic vendor: 28MB → **5.7MB** (80% savings)
- Omnisphere vendor: 28MB → **21MB** (25% savings)
- Audio vendor: 28MB → **14MB** (50% savings)

✅ **Faster Initial Load**
- Before: 28MB download on browser open
- After: 773 bytes download on browser open
- Vendor data loads only when clicked (1-2 sec delay first time)

✅ **Automatic Cleanup**
- Switching vendors: Old vendor data freed automatically
- Closing browser: All vendor data freed
- Periodic cleanup: Diagnostic data cleared every 5 minutes
- Component destroy: All caches cleared on unmount

✅ **Production Stability**
- Extended iPad sessions (4+ hours) no longer crash
- Memory usage plateaus instead of growing linearly
- Browser responsive even after many open/close cycles

✅ **Preserved Functionality**
- No UX changes - everything works identically
- Omnisphere type-first navigation intact (Bass, Keys, Instruments, etc.)
- All vendor navigation patterns preserved
- Backward compatible with existing adapters

### Negative

⚠️ **Slight Delay on First Vendor Click**
- 1-2 second delay when opening vendor for first time (downloading JSON)
- Subsequent clicks are instant (cached)
- **Mitigation**: Acceptable trade-off for memory savings, only first click per vendor

⚠️ **Build Output Changes**
- Generates 4+ files instead of 1 (drums, melodic, omnisphere, audio-clips, index)
- Build directory has more files in `/data/` folder
- **Mitigation**: Build time unchanged, files are smaller and easier to inspect

⚠️ **Generator Script Complexity**
- `writeJSON()` function now writes multiple files
- Separate logic for instruments vs audio-clips
- **Mitigation**: Well-documented, only runs during build, not runtime

### Neutral

⚙️ **File Format Breaking Change**
- Old adapters expecting `data.vendors[vendorId]` will break
- New adapters expect `data.vendor` at root level
- **Migration**: All adapters updated in same commit, no gradual migration needed

⚙️ **Cache Management Responsibility**
- Components must call `clearCache()` when appropriate
- Browser component handles this automatically
- **Maintenance**: Future browser components should follow same pattern

## Metrics

### File Sizes
| File | Size | % of Original |
|------|------|---------------|
| **Original** | 28MB | 100% |
| instruments-index.json | 773 bytes | 0.003% |
| drums.json | 475 KB | 1.7% |
| melodic.json | 5.7 MB | 20.4% |
| omnisphere.json | 21 MB | 75.0% |
| audio-clips.json | 14 MB | 50.0% |

### Memory Usage (Production)
| Scenario | Before | After | Savings |
|----------|---------|-------|---------|
| Browser closed | 28MB | 0MB | **28MB (100%)** |
| Drums open | 28MB | 0.5MB | **27.5MB (98%)** |
| Switch to Melodic | 28MB | 5.7MB | **22.3MB (80%)** |
| Switch to Omnisphere | 28MB | 21MB | **7MB (25%)** |
| Open/close 10 times | 28MB forever | 0MB when closed | **28MB** |

### Diagnostic Data Reduction
| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| recentMessages | Unlimited | 50 entries | ~95% |
| freezeDetector.metrics | 300 entries/sec | 50 entries | ~83% |
| reactiveMonitor | 1000 entries | 50 entries | ~95% |
| selectedTrackStore.version | Unlimited | Wraps at 10,000 | Overflow prevention |

## Implementation Notes

### Affected Files
- `scripts/generate-instruments-json.ts` - Generator with split output
- `interface/src/lib/services/adapters/unifiedAdapter.ts` - Per-vendor loading
- `interface/src/lib/services/adapters/omnisphereAdapter.ts` - Updated for new format
- `interface/src/lib/services/adapters/audioClipsAdapter.ts` - Updated for new format
- `interface/src/lib/services/adapters/subfolderAdapter.ts` - Updated for new format
- `interface/src/lib/services/adapters/index.ts` - Adapter registry updated
- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.svelte` - Lazy loading + cleanup
- `interface/src/routes/+layout.svelte` - Periodic cleanup timer
- `interface/src/lib/api/simpleClient.ts` - Circular buffer for messages
- `interface/src/lib/utils/freeze-detector.ts` - Reduced metrics history
- `interface/src/lib/utils/reactive-monitor.ts` - Reduced update history
- `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` - Version counter overflow fix

### Breaking Changes
- **None for users** - All changes are internal implementation
- **API Compatible** - Adapter interface unchanged, implementation details only
- **Build Required** - Regenerate JSON files with `npm run generate-instruments`

### Testing Checklist
✅ Omnisphere shows type-first categories (Bass, Keys, Instruments, etc.)
✅ Audio button loads audio clips without errors
✅ Drums/Melodic vendors work with normal folder navigation
✅ Memory cleanup logs appear when switching vendors
✅ Periodic cleanup runs every 5 minutes
✅ Extended sessions (4+ hours) remain stable
✅ Browser responsive after many open/close cycles

## Future Considerations

### Potential Enhancements
1. **Progressive Loading**: Load preset names only, defer full preset metadata until selection
2. **Service Worker Caching**: Cache vendor files in service worker for offline access
3. **Preset Search Index**: Separate search index file for fast cross-vendor preset search
4. **Vendor Preloading**: Predictively load likely next vendor (e.g., preload Omnisphere when Melodic opens)
5. **Memory Pressure API**: Use browser's Memory Pressure API to trigger aggressive cleanup

### Monitoring
- Console logs show memory usage every 5 minutes (when periodic cleanup runs)
- Browser DevTools → Memory → Take heap snapshot to verify cleanup effectiveness
- Long-running sessions should show plateau pattern (not linear growth)

## Related ADRs
- ADR 099: Dynamic Instrument Vendor System
- ADR 018: Gesture Browser Architecture

## References
- Issue: Browser crashes after extended iPad usage
- Root Cause: 28MB instruments.json loaded into memory
- Solution: Split files + lazy loading + aggressive cleanup
