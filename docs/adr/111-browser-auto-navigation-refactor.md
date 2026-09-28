# ADR 111: Browser Auto-Navigation and Single-Choice Column Hiding

**Status**: Implemented
**Date**: 2025-11-09
**Related**: ADR-080 (Omnisphere Type-First Navigation), ADR-016 (Gesture Browser Architecture)

## Context

The unified browser had complex, brittle logic for handling single-choice navigation columns:

1. **Recursive auto-skip during data loading** - `loadNextColumn()` would recursively call itself when finding single-choice columns, making debugging difficult and state unpredictable
2. **Conflicting goals** - Logic tried to both "show presets immediately" AND "hide single-choice columns" which fought each other
3. **Path/column mismatch** - Hidden columns weren't added to the array, breaking 1:1 mapping between path and columns
4. **Mode-specific complexity** - Different behavior for browse vs gesture mode scattered throughout the code
5. **Poor separation of concerns** - Data loading and UI rendering logic were tangled together

### Example Issues

**Bass → Synth** navigation would:
- Load "Bass Sounds" category (1 choice)
- Show presets BUT no library column
- Libraries only appeared if user manually clicked the hidden "Bass Sounds" button
- User had no way to know there were library choices available

**Bass → Hybrid** navigation would:
- Sometimes show single-choice columns, sometimes hide them
- Behavior was unpredictable depending on preset loading state
- Clicking repeatedly would create duplicate columns

## Decision

### Architecture: Separate Data Loading from UI Rendering

**Data Layer** (`loadNextColumn()`):
- Honest, simple data loading - no recursion tricks
- Always loads folders + presets for current path
- Always adds column to the array (1:1 path/column mapping)
- After loading, checks if column will be hidden (single choice)
- If hidden, automatically adds that folder to path and loads next level
- Stops when reaching a multi-choice column or max depth (10 levels)

**UI Layer** (Svelte template):
- Receives honest data in columns array
- Decides what to render based on simple rule: `shouldShowColumn = totalFolderCount !== 1`
- Hides single-choice columns (1 folder)
- Shows leaf nodes (0 folders, presets only)
- Shows multi-choice columns (2+ folders)

### Simplified Logic

**Before** (complex, brittle):
```typescript
// Recursive auto-skip with depth tracking, mode checks, preset conditions
const shouldAutoSkip = totalFolderCount === 1 &&
  presets.length === 0 &&
  (browserModeStore.isPersistent || currentVendorState.currentPath.length >= 2);

if (shouldAutoSkip) {
  // Don't add column, navigate recursively
  currentVendorState.currentPath.push(singleFolder);
  await loadNextColumn(depth + 1);
} else {
  // Add column
  columns.push(...);
}
```

**After** (simple, robust):
```typescript
// Always load and add column
columns.push({ folders, presets, groupedFolders, shouldExpandGroups });

// Then check if we should auto-navigate
if (totalFolderCount === 1) {
  currentVendorState.currentPath.push(singleFolder);
  await loadNextColumn(depth + 1); // Load next level
}

// UI filters with: shouldShowColumn = totalFolderCount !== 1
```

### Key Changes

1. **Removed mode-specific logic** - Both browse and gesture mode behave identically
2. **Always include nested presets** - `includeNested = path.length > 0` (simple!)
3. **Same preset limit** - 500 for both modes (no more 200 vs 500 split)
4. **1:1 path/column mapping** - Every path element has a column (even if hidden by UI)
5. **Post-load auto-navigation** - Navigation happens AFTER column is added to array
6. **UI-layer hiding** - Template decides what to render, not data layer

## Implementation

### UnifiedGestureBrowser.svelte

**loadNextColumn() refactor**:
```typescript
async function loadNextColumn(depth: number = 0) {
  // Prevent infinite recursion
  if (depth > 10) return;

  // Load data honestly
  const folders = await adapter.getFolders(path);
  const presets = await adapter.getPresets(path, 500, includeNested: path.length > 0);
  const groupedFolders = await adapter.getGroupedFolders(path);

  // Add to columns array (always!)
  columns.push({ folders, presets, groupedFolders, shouldExpandGroups });

  // Auto-navigate through single-choice columns
  if (totalFolderCount === 1) {
    currentPath.push(singleFolder);
    await loadNextColumn(depth + 1); // Recursively load next level
  }
}
```

**Template filtering**:
```svelte
{#each columns.slice(1) as col}
  {@const totalFolderCount = /* calculate from folders or groups */}
  {@const shouldShowColumn = totalFolderCount !== 1}

  {#if shouldShowColumn}
    <!-- Render column -->
  {/if}
{/each}
```

### Category-First Navigation Enhancement

Also implemented category-first navigation for Omnisphere (from ADR-080):
- **Level 2**: Show instrument categories (Keyboards, Organs, etc.)
- **Level 3**: Show libraries offering that category
- **Level 4+**: Tree navigation within selected library

This works seamlessly with auto-navigation since categories are often single-choice.

### Gesture Mode Gaps

Enhanced gesture mode with 1.2rem gaps (vs 0.4rem in browse mode) to create "safe corridors" for finger navigation between folders.

## Consequences

### Positive

✅ **Robust and predictable** - No brittle recursion, state is always clear
✅ **Debuggable** - Clean separation between data loading and UI rendering
✅ **Consistent behavior** - Works the same regardless of navigation path
✅ **Better UX** - Users always see meaningful choices (multi-choice columns or presets)
✅ **Simpler code** - Removed 100+ lines of complex conditional logic
✅ **Mode-agnostic** - Browse and gesture mode use same core logic
✅ **Flexible** - Easy to change hiding rules without touching data layer

### Trade-offs

⚠️ **More columns in memory** - Hidden columns still exist in array (minimal impact)
⚠️ **Slightly more complex template** - Filtering logic in UI layer instead of data layer
⚠️ **Auto-navigation can be surprising** - User might not realize intermediate levels were skipped

### Examples

**Bass → Synth**:
1. Load "Bass Sounds" (1 category) → Auto-navigate
2. Load 6 libraries → Show column ✓
3. User sees library choices immediately

**Bass → Hybrid**:
1. Load "Bass Sounds" (1 category) → Auto-navigate
2. Load "Scoring Electronic" (1 library) → Auto-navigate
3. Load 4 subfolders → Show column ✓
4. User sees meaningful choices without clutter

**Bass → Instruments**:
1. Load 4 categories → Show column ✓
2. No auto-navigation needed

## Alternatives Considered

### 1. Show single-choice columns with visual indicator
**Rejected**: Takes up screen space for no user benefit. If there's only one choice, just navigate through it automatically.

### 2. Different behavior for browse vs gesture mode
**Rejected**: Adds complexity for no clear benefit. Users expect consistent behavior.

### 3. Auto-skip during data loading (original approach)
**Rejected**: Too brittle, breaks path/column mapping, hard to debug.

### 4. Never hide single-choice columns
**Rejected**: Clutters UI with non-decisions. Wastes precious screen real estate on iPad.

## Notes

- All single-choice columns are hidden via UI filtering, but data is still loaded and in the columns array
- Gesture mode gaps (1.2rem) create "safe corridors" to slide between folders without triggering navigation
- The 10-level recursion limit prevents infinite loops in case of circular data
- Console logging includes `willBeHidden` flag to help debug auto-navigation
- Works with both regular folders and grouped library folders

## Related Changes

- Removed complex `isDeepEnough` logic for preset loading
- Unified preset limit (500) across both modes
- Simplified `includeNested` to always true when path exists
- Enhanced logging for debugging navigation flows
