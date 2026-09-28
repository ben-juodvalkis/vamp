# ADR-133: Scale Browser Click Detection Fix

**Date:** 2025-01-12
**Status:** Implemented
**Related:** ADR-058 (Scale Gesture Browser), ADR-025 (Tap-Hold Gesture Mode), ADR-029 (Persistent Browser Implementation)

## Context

The key signature browser (root note and scale selection) was completely broken in both gesture mode and persistent (browse) mode. Users could not change the root note or scale name, which is a critical feature for the scale-aware looping system.

### Problem Statement

**Symptom:** Clicking or tapping on root notes or scales in the browser did not apply the selection to Ableton Live's key signature.

**Root Causes:**

1. **Persistent Mode (Browse Mode):**
   - User taps scale → `onclick` handler fires
   - `GestureModeController` intercepts `touchend` event
   - Calls `handleGestureEnd()`
   - Function checks `if (!browserGestureStore.isDragging)` and returns early
   - In persistent mode, `isDragging` is never set to `true`
   - Scale selection code never executes → **No OSC message sent**

2. **Gesture Mode (Hold-and-Release):**
   - User holds scale button → `isDragging` set to `true`
   - User releases WITHOUT dragging across scales → `hoveredScale` remains `null`
   - `handleGestureEnd()` checks `if (selectedCategory === 'scale' && hoveredScale)`
   - Condition fails because `hoveredScale === null`
   - Scale selection code never executes → **No OSC message sent**

**The ONLY scenario that worked:**
- User holds scale button → drags finger across scale grid → `hoveredScale` gets set → releases → Scale applied ✅

This required users to perform a dragging motion even when they wanted to select the scale directly under their finger.

## Decision

Implement a **two-pronged fix** that handles both interaction modes independently:

### Fix 1: Persistent Mode - Event Propagation Control

**Files Modified:**
- `interface/src/lib/components/v6/browser/ScaleGrid.svelte`
- `interface/src/lib/components/v6/browser/FolderNavigationColumn.svelte`

**Change:** Add `e.stopPropagation()` to `onclick` handlers to prevent `GestureModeController` from intercepting the events.

```typescript
// Before
onclick={() => onScaleClick(scaleName)}

// After
onclick={(e) => {
    e.stopPropagation();
    onScaleClick(scaleName);
}}
```

**Rationale:** In persistent mode, the `onclick` handler should be the primary interaction mechanism. By stopping event propagation, we prevent the gesture controller from interfering with direct clicks.

### Fix 2: Gesture Mode - Release Position Detection

**Files Modified:**
- `interface/src/lib/components/v6/browser/GestureModeController.svelte`
- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte`

**Changes:**

1. **Pass release coordinates from GestureModeController:**
   ```typescript
   // Update onEnd callback signature
   onEnd: (position?: { x: number; y: number }) => void

   // In handleEnd, capture final touch position
   const coords = getEventCoordinates(event);
   onEnd(coords || undefined);
   ```

2. **Detect element at release position in handleGestureEnd:**
   ```typescript
   async function handleGestureEnd(releasePosition?: { x: number; y: number }) {
       // Handle scale selection BEFORE checking isDragging
       if (selectedCategory === 'scale') {
           let scaleToSelect = hoveredScale;

           // If no hoveredScale (didn't drag), check release position
           if (!scaleToSelect && releasePosition) {
               const elementData = getElementData(releasePosition.x, releasePosition.y);
               scaleToSelect = elementData?.scaleName || null;
           }

           if (scaleToSelect) {
               handleScaleNameClick(scaleToSelect);
           }

           browserGestureStore.isDragging = false;
           if (!browserModeStore.isScalePersistent) {
               closeButPreserveState();
           }
           return;
       }

       // For preset/vendor selection, require dragging
       if (!browserGestureStore.isDragging) {
           return;
       }
       // ... rest of preset handling
   }
   ```

**Rationale:** By processing scale selection BEFORE the `isDragging` check and using the release position to detect the element under the user's finger, we support both drag-to-select and hold-and-release gestures.

### Key Architectural Decisions

1. **Scale selection bypasses drag requirement:** Unlike preset selection (which requires intentional dragging), scale selection is treated as a simpler interaction that can work via direct touch.

2. **Release position as fallback:** The system tries `hoveredScale` first (set during dragging), then falls back to detecting the element at the release position. This handles all interaction scenarios.

3. **Mode-specific handling:** Persistent mode uses `stopPropagation()` while gesture mode uses position detection. Each mode has an independent code path, making the system more robust.

## Implementation Details

### Files Changed

1. **ScaleGrid.svelte** - Added `stopPropagation()` to scale card clicks
2. **FolderNavigationColumn.svelte** - Added `stopPropagation()` to root note clicks
3. **GestureModeController.svelte** - Pass release position via `onEnd()` callback
4. **UnifiedGestureBrowser.v6.svelte** - Handle scale selection before `isDragging` check, use release position detection

### Interaction Flow After Fix

**Persistent Mode:**
```
User taps scale
  → onclick fires with stopPropagation()
  → handleScaleNameClick() called
  → OSC message sent: /looping/song/set/scale_name
  → touchend event doesn't bubble to GestureModeController
  ✅ Scale applied
```

**Gesture Mode (Drag):**
```
User holds scale button
  → isDragging = true
  → User drags over scale grid
  → hoveredScale set via handleMove()
  → User releases
  → handleGestureEnd() called
  → Scale detected via hoveredScale
  ✅ Scale applied
```

**Gesture Mode (Hold-Release):**
```
User holds scale button
  → isDragging = true
  → User releases WITHOUT moving
  → hoveredScale is still null
  → handleGestureEnd(releasePosition) called
  → Scale detected via getElementData(releasePosition)
  ✅ Scale applied
```

## Consequences

### Positive

- ✅ **Both modes work reliably:** Persistent and gesture modes both support root note and scale selection
- ✅ **More intuitive UX:** Users can hold-and-release on a scale without needing to drag
- ✅ **Robust fallback:** If dragging doesn't set `hoveredScale`, release position detection ensures the selection still works
- ✅ **No breaking changes:** Existing drag-to-select behavior preserved
- ✅ **Better separation of concerns:** Each mode has its own handling path

### Negative

- ⚠️ **Slight complexity increase:** Two different code paths for scale selection (persistent vs gesture)
- ⚠️ **Order dependency:** Scale handling must come before `isDragging` check, which is subtle

### Neutral

- Release position detection uses `document.elementFromPoint()`, which is well-supported and performant
- `stopPropagation()` is a standard pattern for preventing event bubbling

## Testing

**Test Scenarios:**

1. ✅ **Persistent Mode Root Note:** Tap root note → Changes immediately
2. ✅ **Persistent Mode Scale:** Tap scale → Changes immediately
3. ✅ **Gesture Mode Drag:** Hold scale button → Drag across scales → Release → Applies selection
4. ✅ **Gesture Mode Hold-Release:** Hold scale button → Release on scale → Applies selection
5. ✅ **Sequential Changes:** Change root, then scale in quick succession → Both apply

## Future Considerations

### Potential Improvements (Not Implemented)

1. **Debouncing:** Add 150ms debounce to `handleScaleNameClick()` to prevent rapid-fire OSC messages
   - Currently not needed as flakiness was due to detection, not timing
   - Can be added if users report issues with rapid clicking

2. **Optimistic Updates:** Immediately update UI state before OSC round-trip
   - Would require adding pending state to session store
   - Would provide instant visual feedback

3. **Visual Feedback:** Add pending/error states to scale cards
   - Dim opacity during update
   - Flash red on timeout
   - Brief green highlight on success

4. **Root Note Selection in Gesture Mode:** Currently root notes are only in persistent mode
   - Could add gesture support if needed
   - Release position detection would work the same way

## Related Issues

- Fixes: Key signature browser completely non-functional
- Improves: ADR-058 scale gesture browser implementation
- Builds on: ADR-025 tap-hold gesture mode architecture

## References

- [UnifiedGestureBrowser.v6.svelte:381-418](../interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte)
- [GestureModeController.svelte:79-95](../interface/src/lib/components/v6/browser/GestureModeController.svelte)
- [ScaleGrid.svelte:23-26](../interface/src/lib/components/v6/browser/ScaleGrid.svelte)
- [FolderNavigationColumn.svelte:52-55](../interface/src/lib/components/v6/browser/FolderNavigationColumn.svelte)
- [touchHandlers.ts:82-95](../interface/src/lib/components/v6/browser/utils/touchHandlers.ts)
