# ADR-167: FX Grid Tap-to-Preview, Drag-to-Create

**Date:** 2026-01-22
**Status:** Implemented
**Updated:** 2026-01-23 (RAF race condition fix)

## Context

Previously, tapping an FX grid cell with a ghost device would immediately create (load) that device in Ableton. This meant users couldn't preview the central view controls without committing to device creation.

## Decision

Change FX grid interaction model:

- **Tap on ghost device** → Shows central view only (preview mode), does NOT create device
- **Tap on active device** → Shows central view + selects device (unchanged)
- **Drag on ghost device** → Creates device AND sends parameters (unchanged)

This provides a cleaner mental model: tap to preview, drag to commit.

## Implementation

### Phase 1: Remove load from handleTap

Single change in `BaseDeviceControl.svelte` - removed device loading logic from `handleTap()`:

```typescript
// REMOVED from handleTap():
if (isGhost && !loadingInitiated) {
  loadingInitiated = true;
  selectedTrackStore.loadFxGridDevice(key);
}
```

The `triggerLoad()` function called by individual control components during drag interaction continues to handle device creation.

### Phase 2: Fix RAF Race Condition (Issue #271)

The initial implementation had a race condition where the RAF throttle fired `onInteraction` before `pointerup` could detect the tap:

1. `handlePointerDown` called `startXYThrottle()` and `updatePositionRelative(event)`
2. RAF fired `sendXYFrame()` which called `onInteraction(x, y)`
3. Control components called `triggerLoad()` in their `onInteraction` handlers
4. Device loaded immediately - before `pointerup` could detect it was a tap

**Fix:** Defer RAF throttle start until intentional movement is detected in `pointermove`:

```typescript
let hasMoved = $state(false);

function handlePointerDown(event: PointerEvent) {
  // ... setup code ...
  hasMoved = false;
  // DON'T call startXYThrottle() or updatePositionRelative() here
}

function handlePointerMove(event: PointerEvent) {
  if (!isDragging) return;

  // Only treat as intentional drag if movement exceeds tap threshold
  if (!hasMoved) {
    const moveX = Math.abs(event.clientX - tapStartX);
    const moveY = Math.abs(event.clientY - tapStartY);
    if (moveX < TAP_MOVEMENT_THRESHOLD && moveY < TAP_MOVEMENT_THRESHOLD) {
      return; // Ignore micro-movements (finger wobble)
    }
    hasMoved = true;
    startXYThrottle();
  }

  updatePositionRelative(event);
}
```

This ensures:
- **Taps** (pointerdown → pointerup with no/minimal move) only fire `onTap`, never `onInteraction`
- **Drags** (pointerdown → pointermove beyond threshold → pointerup) fire `onInteraction` normally
- Finger wobble during taps is ignored using the existing `TAP_MOVEMENT_THRESHOLD` (5px)

### Phase 3: Fix EQControl Special Case

EQControl doesn't use DeviceXY for its bass/treble sliders, so it needed separate fixes:

1. **Container onclick** - Removed `triggerLoad()` call, now only sets central view
2. **Bass/Treble sliders** - Added `hasMoved` tracking to defer `triggerLoad()` until intentional movement

```typescript
// Slider drag state now includes movement tracking
let lowDragState = $state({ dragging: false, startY: 0, startValue: 0, hasMoved: false });

onpointerdown={(e) => {
  lowDragState.hasMoved = false;
  // DON'T triggerLoad here - wait for intentional movement
}}

onpointermove={(e) => {
  if (!lowDragState.hasMoved) {
    if (Math.abs(deltaY) < TAP_MOVEMENT_THRESHOLD) {
      return; // Ignore micro-movements
    }
    lowDragState.hasMoved = true;
    if (isGhost && !isLoading) {
      triggerLoad();
    }
  }
  // ... update value
}}
```

The mid XY pad already uses DeviceXY, so it was fixed by Phase 2.

## Files Changed

- `interface/src/lib/components/v6/device-panel/BaseDeviceControl.svelte` - Removed ~5 lines from `handleTap()`
- `interface/src/lib/components/v6/device-panel/DeviceXY.svelte` - Deferred RAF start to `pointermove`
- `interface/src/lib/components/v6/device-panel/EQControl.svelte` - Fixed container onclick and slider drag handlers
