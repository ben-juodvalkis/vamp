# ADR-146: Browser Vendor Color Persistence

## Status
Accepted

## Date
2025-12-20

## Context

The gesture browser uses a "type-first" navigation where users select an instrument type (Keys, Drums, Bass, etc.) and then navigate through vendor folders (Keyscape Creative, Trilian, NI expansions, etc.). Each vendor folder has a distinct color for visual identification.

### The Problem

When users closed the browser and reopened it, or switched between types and returned, the navigation state was not being properly restored. Specifically:

1. **vendorColor was not passed during restoration** - The `loadPathStepByStep()` function, which rebuilds the column hierarchy when reopening a vendor, was not receiving the `vendorColor` parameter needed to disambiguate duplicate folder names across different vendor libraries.

2. **vendorColor was stored globally, not per-vendor** - A single `selectedVendorColor` variable was shared across all vendors. When switching from Keys (color A) to Drums (color B) and back to Keys, the color was wrong.

3. **Dual state created drift risk** - Both `browserNavigationStore.selectedVendorColor` and `vendorState.vendorColor` were being set independently, creating the risk of them getting out of sync.

### User Impact

- Reopening a type showed the wrong folder selected or wrong presets
- Colors were incorrect after switching between types
- The folder disambiguation logic failed, potentially loading the wrong folder's data

## Decision

### 1. Add vendorColor to VendorState (Per-Vendor Persistence)

Store the selected folder's color in the vendor-specific state so it persists across browser close/open and vendor switching:

```typescript
export type VendorState = {
  currentPath: string[];
  columns: Array<{...}>;
  adapter: any;
  lastPath: string;
  vendorColor: string | null;  // NEW: Color of the selected first-level folder
};
```

### 2. Pass vendorColor Through Restoration Flow

Update `loadPathStepByStep()` to accept and use the vendorColor parameter:

```typescript
export async function loadPathStepByStep(
  vendorState: VendorState,
  selectedVendor: string,
  isPersistent: boolean,
  depth: number,
  vendorColor?: string | null  // NEW
): Promise<void>
```

### 3. Eliminate Dual State with Derived Getter

Replace the separate `selectedVendorColor` state variable with a derived getter that reads from the current vendor's state:

```typescript
// Before: Dual state (source of bugs)
let selectedVendorColor = $state<string | null>(null);
// Had to keep this in sync with vendorState.vendorColor

// After: Single source of truth
get selectedVendorColor(): string | null {
  if (!currentVendorId) return null;
  return vendorStates[currentVendorId]?.vendorColor ?? null;
}
```

This required adding `currentVendorId` to track which vendor is active for the lookup.

### 4. Update Adapter Signatures

Ensure all adapter implementations match the interface signature for `getGroupedFolders`:

```typescript
// Interface
getGroupedFolders?(vendorId: string, path: string[], vendorColor?: string): Promise<GroupedFolders | null>;

// All implementations now match
async getGroupedFolders(vendorId: string, path: string[], vendorColor?: string): Promise<GroupedFolders | null>
```

## Consequences

### Positive

- **Reliable state restoration** - Vendor navigation is correctly restored when reopening or switching back
- **Single source of truth** - `vendorState.vendorColor` is the only place color is stored; `selectedVendorColor` is derived
- **No state drift** - Impossible for global and per-vendor color to get out of sync
- **Consistent API** - All adapters now have matching signatures

### Negative

- **Added complexity** - `currentVendorId` must be set alongside `selectedVendorId` when changing vendors
- **Memory usage** - Each vendor state now includes a color field (negligible impact)

### Neutral

- **Session-only persistence** - Per ADR-072, this persists during the browser session but not across page reloads (intentional)

## Files Changed

- `browserNavigationStore.svelte.ts` - Added `vendorColor` to VendorState, derived getter, `currentVendorId`
- `vendorStateManager.ts` - Added `vendorColor` parameter to `loadPathStepByStep()`
- `UnifiedGestureBrowser.v6.svelte` - Set `currentVendorId`, removed redundant setter calls
- `typeFirstAdapter.ts`, `unifiedAdapter.ts`, `audioClipsAdapter.ts`, `recentInstrumentsAdapter.ts` - Updated `getGroupedFolders` signatures

## Related ADRs

- ADR-072: Vendor State Persistence - Original per-vendor state architecture
- ADR-120: Browser Memory Leak Fix - Introduced `clearVendorCache()` which preserves `currentPath` and now also preserves `vendorColor`
