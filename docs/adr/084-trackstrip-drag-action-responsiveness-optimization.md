# ADR 072: TrackStrip Drag Action Responsiveness Optimization

**Status**: Accepted and Implemented
**Date**: 2025-10-25
**Deciders**: Development Team
**Related**: dragAction.ts, TrackVolumeMeter.svelte

---

## Context

The TrackStrip volume control had two significant responsiveness issues affecting the user experience on touch devices:

### 1. Tap/Drag Event Conflict
- **Problem**: Volume dragging incorrectly triggered track selection on release
- **Root Cause**: Overlapping event handlers on nested elements:
  - Outer div: `onclick={handleTrackSelect}` (always fired)
  - Inner div: `use:drag={dragOptions}` (attempted to prevent bubbling)
- **Impact**: Users couldn't drag volume without accidentally selecting tracks

### 2. Poor Drag Responsiveness
- **Problem**: Volume dragging felt laggy and jittery
- **Root Causes**:
  - Debouncing not applied (dragAction created debounced function but didn't use it)
  - Observer updates conflicting with optimistic values during drag
  - Excessive OSC message rate (60-120/second instead of intended ~15/second)
  - Async blocking in drag loop
- **Impact**: Volume control felt unresponsive and unpredictable

## Decision

Implement a comprehensive drag action enhancement with observer suppression during active dragging.

### 1. Enhanced dragAction.ts Interface

Add drag state callbacks to the dragAction interface:

```typescript
export interface DragActionOptions {
    // ... existing options
    onTap?: () => void;           // For tap events (non-drag)
    onDragStart?: () => void;     // Called when drag begins
    onDragEnd?: () => void;       // Called when drag ends
}
```

### 2. Observer Suppression Strategy

Use drag state tracking to suppress conflicting observer updates:

```typescript
// TrackVolumeMeter.svelte
let isDragging = $state(false);

// Only clear optimistic values when NOT dragging
$effect(() => {
    if (!isDragging && optimisticVolume !== null && track && 
        Math.abs(optimisticVolume - track.volume) < 0.01) {
        optimisticVolume = null;
    }
});
```

### 3. Performance Optimizations

- **Fix debouncing**: Use `debouncedOnChange` instead of `opts.onChange` in drag handler
- **Remove async blocking**: Change `await send()` to fire-and-forget `send()`
- **Reduce timeout**: 100ms instead of 200ms for quicker optimistic value cleanup
- **Eliminate duplicate handlers**: Remove outer `onclick`, use `onTap` callback instead

## Implementation Details

### dragAction.ts Changes
1. Added `onDragStart`/`onDragEnd` callbacks to interface
2. Call `onDragStart()` in `handlePointerDown` after setting `isDragging = true`
3. Call `onDragEnd()` in `handlePointerUp` before releasing pointer capture
4. Fixed debouncing bug: `opts.onChange` → `debouncedOnChange`
5. Enhanced `onTap` handling for clean tap detection

### TrackVolumeMeter.svelte Changes
1. Added `isDragging` state with `handleDragStart`/`handleDragEnd` handlers
2. Modified observer effects to respect drag state
3. Removed outer `onclick` handler to eliminate event conflicts
4. Converted `handleVolumeChange` to fire-and-forget for better responsiveness
5. Connected drag callbacks to dragOptions

## Consequences

### ✅ Positive
- **Eliminated tap/drag conflicts**: Volume drag no longer triggers track selection
- **Smooth dragging**: Observer updates suppressed during active drag
- **Better responsiveness**: Proper debouncing limits OSC messages to ~15/second
- **Reduced blocking**: Fire-and-forget OSC calls prevent UI lag
- **Reusable pattern**: Enhanced dragAction can be used by other components

### ⚠️ Considerations
- **Drag state reliability**: Must ensure `isDragging` resets on all edge cases (pointer cancel, page blur)
- **Observer timing**: 100ms timeout might miss some legitimate updates
- **Component coupling**: TrackVolumeMeter now depends on dragAction's drag state callbacks

### 🔄 Future Opportunities
- Apply same pattern to other draggable parameters (device controls, clip loops)
- Consider extending to other touch gestures (pinch, rotate)
- Investigate if debounceMs can be reduced further for even better responsiveness

## Alternatives Considered

### Option A: Time-based Observer Suppression (Rejected)
- Suppress observers for X milliseconds after user interaction
- **Problem**: Unreliable timing, could miss legitimate updates

### Option B: Global Drag State Manager (Deferred)
- Central service to track all active drags
- **Decision**: YAGNI - start with component-level solution

### Option C: Complete Observer Replacement (Rejected)
- Replace Max observers with polling during drag
- **Problem**: Too complex, loses real-time updates from other sources

## Verification

The implementation successfully resolves both issues:
1. **Tap/drag separation**: Volume dragging no longer triggers track selection
2. **Smooth responsiveness**: Volume control feels immediate and smooth
3. **Reduced network overhead**: OSC message rate properly limited by debouncing
4. **No observer conflicts**: Optimistic values remain stable during drag

This establishes a robust pattern for touch-responsive parameter controls across the application.