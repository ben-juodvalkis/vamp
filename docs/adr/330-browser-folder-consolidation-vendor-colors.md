# ADR-330: Browser Folder Consolidation with Vendor Colors

**Date**: 2026-02-05
**Status**: Accepted
**Related**: ADR-329 (Consolidated JSON Files), ADR-186 (Consolidated Type-First Browser)

---

## Context

When browsing presets by type, same-named folders from different vendors appeared as separate entries. For example, "Strings" might appear three times — once each for Ableton, Omni, and NI. This made navigation confusing and cluttered, especially for categories common across vendors.

Additionally, when folders were merged, there was no visual indicator of which vendor(s) contributed to a folder.

## Decision

### 1. Consolidate same-named folders across vendors

At every navigation depth, `getFolders()` merges folders with the same name from different vendors into a single entry. Drilling into a consolidated folder shows merged content from all contributing vendors.

### 2. Vendor color coding for folders

Each folder tile is colored based on its vendor composition:

| Condition | Color |
|-----------|-------|
| Single vendor | That vendor's color (e.g., Ableton yellow, NI teal, Omni purple) |
| Multiple vendors | Type/category color as fallback |

This is implemented via per-folder `--vendor-color` CSS variables applied to each folder button, with fallback to the type color.

### 3. Vendor priority sorting

Folders within a level are sorted by vendor priority:
1. **Ableton** folders first
2. **Omni** folders second
3. **NI** folders last

Within each vendor group, folders are sorted alphabetically.

### Adapter Interface

Added `getFolderColors?(): Record<string, string>` optional method to `browserAdapter.ts`. Returns a mapping of folder name to vendor color for single-vendor folders. Multi-vendor folders are omitted (UI uses type color fallback).

### Data Flow

```
TypeFirstAdapter.getFolders()     → merged folder list (deduplicated)
TypeFirstAdapter.getFolderColors() → { "Acoustic": "hsl(50,90%,50%)", ... }
    ↓
vendorStateManager.loadNextColumn() → passes folderColors into column data
    ↓
FolderNavigationColumn.svelte → applies --vendor-color per folder button
```

## Files Changed

| File | Change |
|------|--------|
| `interface/src/lib/services/adapters/typeFirstAdapter.ts` | `getFolders` merges across vendors, `getFolderColors` returns per-folder colors, `sortVendors()` helper, `getGroupedFolders` returns null |
| `interface/src/lib/services/adapters/browserAdapter.ts` | Added optional `getFolderColors?()` to adapter interface |
| `interface/src/lib/stores/v6/browserNavigationStore.svelte.ts` | Added `folderColors` to column data type |
| `interface/src/lib/components/v6/browser/utils/vendorStateManager.ts` | Calls `getFolderColors()` in `loadNextColumn` and `loadPathStepByStep` |
| `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` | Passes `folderColors` to columns, sets vendor color immediately on type selection |
| `interface/src/lib/components/v6/browser/FolderNavigationColumn.svelte` | Accepts `folderColors` prop, applies per-folder `--vendor-color` CSS |
| `interface/src/lib/components/v6/browser/VendorBrowserMode.svelte` | Deeper folder columns also use per-folder vendor colors |

## Consequences

### Positive

- Cleaner navigation — no duplicate folder names across vendors
- Visual vendor attribution through color coding without cluttering the UI
- Vendor priority sorting puts most-used libraries first
- Hold-to-random works correctly on consolidated folders (picks from all vendors)

### Negative

- Loss of explicit vendor separation — user can't browse only one vendor's folders within a type
- Multi-vendor folders lose vendor color identity (fall back to type color)

## Tags

`browser`, `preset-management`, `ui`, `vendor-colors`
