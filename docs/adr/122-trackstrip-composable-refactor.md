# ADR-122: TrackStrip Composable Refactor

**Status:** Implemented
**Date:** 2025-11-18
**Related Issue:** #166

## Context

The TrackStrip component mixed presentation and business logic within a single component, making it difficult to test and maintain. The component directly implemented the observer pattern, managed lifecycle events, and handled track state mutations alongside UI rendering.

### Issues with Previous Implementation

1. **Mixed Concerns**: Business logic (observer setup, state management) intertwined with presentation code
2. **Difficult to Test**: No way to test track data logic without rendering the full component
3. **Tight Coupling**: Max4Live integration directly embedded in component lifecycle
4. **Code Duplication Risk**: Track data handling logic couldn't be reused across components
5. **Svelte 5 Runes Issue**: Initial implementation used `.ts` file extension which doesn't support Svelte 5 runes

## Decision

Extract all business logic into a reusable `useTrackData` composable function following Svelte 5 best practices.

### Architecture

**New Structure:**
```
tracks/
├── TrackStrip.svelte          # Pure presentation component (32 lines)
├── composables/
│   └── useTrackData.svelte.ts # Business logic & state (150 lines)
└── TrackStrip/                # Sub-components
    ├── components/
    │   ├── TrackHeader.svelte
    │   └── TrackFooter.svelte
    └── hooks/
        └── useMaxTrackObserver.ts
```

### Composable API

```typescript
export function useTrackData(options: UseTrackDataOptions): UseTrackDataReturn {
  // Returns reactive getters for state
  return {
    // State (getters for reactivity)
    get track() { return track; },
    get isSelected() { return isSelected; },
    get trackColor() { return trackColor; },
    get borderStyle() { return borderStyle; },

    // Actions
    handleSelect,
    handleMuteToggle,
    handleSoloToggle
  };
}
```

### Key Implementation Details

1. **File Extension**: Uses `.svelte.ts` to enable Svelte 5 runes (`$state`, `$derived`)
2. **Import Path**: Imported as `.svelte.js` (compiled output extension)
3. **Reactive Getters**: Returns getters for derived values to maintain reactivity chain
4. **Session Integration**: Derives selection state from session store: `$derived(session.selectedTrackIndex === trackIndex)`

## Consequences

### Positive

✅ **Separation of Concerns**
- Business logic cleanly separated from presentation
- Component focused solely on UI rendering (90 lines → 32 lines in script)

✅ **Testability**
- Composable can be unit tested independently
- No Max4Live coupling required for tests
- Mock-friendly interfaces

✅ **Reusability**
- Track data logic can be reused in other components
- Consistent behavior across the application

✅ **Maintainability**
- Clear, well-documented code
- Type-safe interfaces
- Easier to understand and modify

✅ **Svelte 5 Best Practices**
- Proper use of runes in `.svelte.ts` files
- Reactive getters maintain reactivity chain
- Follows official Svelte 5 patterns

### Negative

⚠️ **Learning Curve**
- Developers need to understand `.svelte.ts` vs `.ts` distinction
- Getter pattern for returned values may be unfamiliar

⚠️ **File Extension Quirk**
- Must use `.svelte.ts` extension for runes support
- Must import as `.svelte.js` (compiled output)
- Easy to get wrong initially

## Implementation Notes

### Critical Fix: Reactive Getters

Initial implementation returned derived values directly, breaking reactivity:

```typescript
// ❌ WRONG - breaks reactivity
return {
  isSelected,
  trackColor,
  borderStyle
};
```

Fixed by returning getters:

```typescript
// ✅ CORRECT - maintains reactivity
return {
  get isSelected() { return isSelected; },
  get trackColor() { return trackColor; },
  get borderStyle() { return borderStyle; }
};
```

This ensures that when `session.selectedTrackIndex` changes, the UI updates correctly.

### File Naming Convention

- **Extension**: `.svelte.ts` (enables runes in TypeScript files)
- **Import**: `.svelte.js` (import from compiled output)
- **Location**: `composables/` directory alongside components

### Integration Pattern

```svelte
<script lang="ts">
  import { useTrackData } from './composables/useTrackData.svelte.js';

  const trackData = useTrackData({
    trackIndex,
    isMaster,
    onTrackSelect
  });
</script>

<!-- Access via getters -->
<div class:selected={trackData.isSelected}>
  {trackData.track.name}
</div>
```

## Benefits Achieved

- **64% Code Reduction**: Script section reduced from 90 lines to 32 lines
- **Zero Breaking Changes**: All existing functionality preserved
- **Type Safety**: Comprehensive TypeScript interfaces throughout
- **Documentation**: Extensive JSDoc with usage examples
- **Proper Reactivity**: Selection highlight updates correctly when tracks change

## Related

- Issue #166: TrackStrip Component Structure Refactor
- Issue #162: Refactor Audit (parent issue)
- [Svelte 5 Runes Documentation](https://svelte.dev/docs/svelte/$state)
- TrackStrip.svelte (interface/src/lib/components/v6/tracks/)
