# ADR-175: Browser Pinned Sort Priority

## Status
Accepted

## Context
The instrument browser displays categories and folders alphabetically. Users wanted certain items (like "Drums" and favorite preset packs like "Nylon Sky") to always appear first in any list, regardless of alphabetical order.

Previously, sort order was hardcoded in `generate-type-first-json.ts` with `TYPE_SORT_ORDER` for types only. This wasn't configurable and didn't apply to nested folders.

## Decision
Implement a centralized `sortPriority.pinnedFirst` configuration in `constants.json` that:
1. Specifies items to pin to the top of any sorted list
2. Applies at all folder levels (types, first-level folders, nested subfolders)
3. Uses case-insensitive matching
4. Is applied at JSON generation time (not runtime)

### Configuration
```json
"sortPriority": {
  "pinnedFirst": ["Drums", "Drum", "Nylon Sky"]
}
```

### Sort Logic
1. Items in `pinnedFirst` sort to top, in the order they appear in the array
2. Everything else sorts alphabetically after pinned items

## Implementation

### Generation Scripts
- `scripts/generate-type-first-json.ts`: Replaced hardcoded `TYPE_SORT_ORDER` with `getPinnedSortOrder()` using constants
- `scripts/generate-instruments-json.ts`: Added same `getPinnedSortOrder()` and `sortFolderKeys()` helpers
- Both scripts recursively sort folders at all tree levels

### Runtime Adapters
Removed alphabetical re-sorting from adapters to preserve JSON order:
- `typeFirstAdapter.ts`: Removed `sortFolders()` method, return `Object.keys()` directly
- `unifiedAdapter.ts`: Same change - preserve JSON order

## Consequences

### Positive
- Single source of truth for sort priority in `constants.json`
- Applies consistently at all folder levels
- Easy to add new pinned items
- No runtime sorting overhead

### Negative
- Requires `npm run generate-instruments` after changing `pinnedFirst`
- JSON files must be regenerated for changes to take effect

## Files Changed
- `config/constants.json` - Added `sortPriority.pinnedFirst`
- `config/constants.json.example` - Documented new option
- `scripts/generate-type-first-json.ts` - Use pinnedFirst for sorting
- `scripts/generate-instruments-json.ts` - Use pinnedFirst for sorting
- `interface/src/lib/services/adapters/typeFirstAdapter.ts` - Remove runtime re-sorting
- `interface/src/lib/services/adapters/unifiedAdapter.ts` - Remove runtime re-sorting
