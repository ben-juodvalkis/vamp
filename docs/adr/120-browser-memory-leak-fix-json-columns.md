# 120. Browser Memory Leak Fix (JSON Columns)

Date: 2025-11-18

## Status

Accepted

## Context

The application was experiencing crashes after long periods of use, particularly when browsing through multiple instrument vendors. Investigation revealed that memory usage was steadily increasing and not being reclaimed.

The root cause was identified as the retention of large JSON data structures in memory. The application loads vendor data (e.g., `omnisphere.json` ~22MB, `audio-clips.json` ~14MB) into the `UnifiedAdapter`. While the adapter had a mechanism to clear its internal cache (`clearCache`), the `browserNavigationStore` was retaining references to this data in its `columns` array within the `VendorState`.

Specifically, the `columns` array holds references to `folders` and `presets` objects that are part of the larger JSON structure. Because these references were held in the store (which is a global singleton), the JavaScript Garbage Collector could not reclaim the memory occupied by the large JSON objects, even after the adapter cleared its reference.

## Decision

We decided to modify the `browserNavigationStore` to explicitly clear the `columns` array whenever the vendor cache is cleared.

This involves updating two methods in `interface/src/lib/stores/v6/browserNavigationStore.svelte.ts`:
1. `clearVendorCache(vendorId)`: Now sets `state.columns = []` before calling the adapter's `clearCache`.
2. `clearAllCaches()`: Now iterates through all vendors and sets `state.columns = []` for each.

## Consequences

### Positive
- **Memory Reclamation**: Releasing the references in `columns` allows the Garbage Collector to free the memory used by the large JSON data. This prevents memory exhaustion and crashes during long sessions.
- **Stability**: The application is more stable and robust against memory leaks.

### Negative
- **Re-fetching Required**: When a user navigates back to a vendor they previously visited, the data must be re-fetched (re-parsed from JSON) and the columns rebuilt. This introduces a slight delay compared to keeping everything in memory. However, this is a necessary trade-off for stability.

### Neutral
- **State Restoration**: The `currentPath` is preserved in the `VendorState`. The existing `loadPathStepByStep` logic uses this path to automatically rebuild the columns when the user returns to the vendor. Therefore, the user does not lose their navigation context, even though the underlying data was temporarily cleared.
- **Recent Instruments**: The "Recent Instruments" feature is unaffected because it uses a separate store (`recentInstrumentsStore`) backed by `localStorage` and does not rely on the `columns` array in `browserNavigationStore`.
