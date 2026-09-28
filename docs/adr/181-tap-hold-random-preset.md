# ADR-181: Tap-and-Hold Random Preset Selection in Browse Mode

## Status
Accepted

## Context
The gesture browser already supported random preset selection by releasing on a folder during gesture mode (hold-and-drag). However, in persistent browse mode, users had no quick way to load a random preset from a folder without manually navigating into subfolders and selecting a preset.

Users wanted to quickly audition presets from a category by holding on a folder button, similar to how gesture mode works but without the drag interaction.

## Decision
Add tap-and-hold gesture detection to folder buttons in browse mode:

1. **FolderNavigationColumn** (left-hand column showing categories like "Acoustic", "Chill" under Bass):
   - Tap (< 300ms): Opens folder for browsing (existing behavior)
   - Hold (≥ 300ms): Loads a random preset from that folder and navigates browser to show the preset's location

2. **BrowseModeController** (subfolders in the expanded area):
   - Same behavior - hold loads random preset, tap navigates into folder

3. **Browser navigation update**: When a random preset is loaded via hold, the browser updates to show the full path to that preset, allowing the user to see where it came from and browse nearby presets.

## Implementation Details

### Components Modified

**FolderNavigationColumn.svelte**:
- Added `HoldGestureDetector` with 300ms threshold
- Added `onFolderHold` prop for random preset callback
- Changed from `onclick` to `onmousedown/onmouseup/ontouchstart/ontouchend` handlers
- Added `data-nav-column="true"` attribute to prevent double-handling by BrowseModeController

**BrowseModeController.svelte**:
- Already had hold detection for subfolders
- Added check to skip elements with `data-nav-column="true"` to prevent conflicts

**UnifiedGestureBrowser.v6.svelte**:
- Added `handleFolderHoldInNavigationColumn()` function
- Updated `handleFolderHoldInBrowseMode()` to also navigate browser
- Both handlers:
  1. Get random preset via `adapter.getRandomPreset()`
  2. Extract folder path from preset (stripping vendor/type prefixes for type-first adapters)
  3. Update browser navigation via `loadPathStepByStep()`
  4. Load the preset
  5. Show instrument in central display

### Path Extraction for Type-First Adapters

Preset paths in the JSON data include vendor and type prefixes (e.g., `"Omni/Bass/Chill/PresetName.aupreset"`), but the browser's `currentPath` for type-first adapters is relative to the type root. The handlers detect type-first adapters via `getTypesIndex()` and strip the first two path segments accordingly.

## Consequences

### Positive
- Quick preset discovery without manual navigation
- Browser shows the path to the selected preset for context
- Consistent with gesture mode behavior
- Works for both navigation column and subfolder buttons

### Negative
- Slightly more complex event handling to prevent double-processing between FolderNavigationColumn and BrowseModeController
- Additional async calls to `getTypesIndex()` for path normalization

## Related
- ADR-018: Gesture Browser Architecture
- Issue #299: Tap-and-hold random preset selection
