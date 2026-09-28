# ADR-145: Gesture Mode Folder Data Attributes

## Status
Accepted

## Date
2025-12-19

## Context

The gesture browser supports two interaction modes:
- **Browse mode**: Click/tap to navigate folders and select presets
- **Gesture mode**: Hold vendor button, drag across folders/presets, release to select

With the type-first navigation system (ADR-142), folders are displayed using grouped folders where multiple vendors (Omnisphere, NI, Ableton) each contribute folders under a single type (Keys, Bass, Drums). The `FolderNavigationColumn` component renders these with a flat index for hover detection.

### The Problem

When hovering over folder buttons in gesture mode, the gesture handler was looking up folder names by index:

```typescript
const col = currentVendorState.columns[data.col - 1];
const folderName = col?.folders[data.idx];  // Wrong for grouped folders!
```

This caused a mismatch because:
1. The `folders` array in column state contains regular (non-grouped) folders
2. When `groupedFolders` is used, the visual display comes from `groupedFolders.groups[X].items[Y]`
3. The flat index used for hover detection doesn't map correctly to `folders[idx]`

**Symptom**: User hovers over "Mallets" button but sees "Pump Organ" presets, because index lookup returned the wrong folder name.

## Decision

Pass folder metadata directly via HTML data attributes rather than looking up by index.

### Data Attributes Added

**VendorButtonGrid** (column 0 buttons):
- `data-column="0"` - Identifies as column 0
- `data-index={idx}` - Button index for hover detection
- `data-button-type="vendor|scale|audio|recent"` - Button type for special handling

**FolderNavigationColumn** (column 1 grouped/regular folders):
- `data-column={1}` - Identifies as column 1
- `data-index={flatIdx}` - Flat index for hover detection
- `data-folder-name={folder}` - **Actual folder name** (key addition)
- `data-folder-color={group.color}` - Vendor color for grouped folders

**VendorBrowserMode** (column 2+ deeper folders):
- `data-column={colIdx + 2}` - Column number
- `data-index={i}` - Index for hover detection
- `data-folder-name={folder}` - **Actual folder name**

### Gesture Handler Update

The `handleGestureMove` function now uses the folder name directly:

```typescript
// Before: Index lookup (broken for grouped folders)
const folderName = col?.folders[data.idx];

// After: Direct from data attribute (always correct)
const folderName = data.folderName;
```

## Consequences

### Positive
- Gesture mode correctly identifies hovered folders regardless of grouping
- No mismatch between visual hover state and loaded content
- Vendor color properly propagates through gesture navigation
- More robust: folder identification doesn't depend on array structure

### Negative
- Slightly more data in DOM (additional data attributes)
- Must maintain data attributes when adding new button types

### Neutral
- Browse mode (click handlers) already used folder names directly, so no change needed there
- Index is still used for hover highlight CSS classes (visual feedback)

## Files Changed

1. `VendorButtonGrid.svelte` - Added data attributes to all buttons
2. `FolderNavigationColumn.svelte` - Added `data-folder-name` and `data-folder-color`
3. `VendorBrowserMode.svelte` - Added `data-folder-name` to deeper folders
4. `touchHandlers.ts` - Extended `getElementData()` to read new attributes
5. `GestureModeController.svelte` - Pass folder data through `onMove` callback
6. `UnifiedGestureBrowser.v6.svelte` - Use `data.folderName` instead of index lookup

## Related

- ADR-142: Type-First Browser Navigation (introduced grouped folders)
- ADR-018: Gesture Browser Architecture (original gesture mode design)
