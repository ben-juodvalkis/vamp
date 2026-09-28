# ADR 139: DeviceXY Smooth Drag Performance Optimization

**Date**: 2025-12-01
**Status**: Implemented
**Related**: ADR-081 (DeviceXY Relative Mode), ADR-019 (DeviceXY Absolute Positioning)

## Context

The DeviceXY component felt jumpy and unresponsive during drag interactions on iPad. The visual handle lagged behind touch position, creating a poor UX despite the OSC message throttling working correctly at 60 FPS.

### Problem

The `.xy-handle` CSS had `transition: all 0.15s ease` which applied to ALL properties including `left` and `bottom` positions. This created a 150ms animation delay on every position update during drag, making the handle lag significantly behind the user's finger/pointer.

```css
/* BEFORE - Laggy */
.xy-handle {
  transition: all 0.15s ease;  /* ❌ Animates position changes */
}

.xy-handle.dragging {
  transform: translate(-50%, 50%) scale(1.1);  /* No transition override */
}
```

**Impact:**
- All 57 DeviceXY usages across device controls and central views felt unresponsive
- Drag operations had visible lag between touch and visual feedback
- Professional UX quality degraded

## Decision

Remove CSS transitions on position-related properties during drag while preserving scale animation for tactile feedback.

### Implementation

```css
/* AFTER - Smooth */
.xy-handle {
  /* Only transition scale for smooth drag feedback, not position */
  transition: transform 0.15s ease;
  /* Optimize for frequent position updates */
  will-change: left, bottom;
}

.xy-handle.dragging {
  transform: translate(-50%, 50%) scale(1.1);
  /* Disable all transitions during drag for instant position updates */
  transition: none;
}
```

**Key Changes:**
1. Changed `transition: all` → `transition: transform` (only animates scale)
2. Added `will-change: left, bottom` for GPU optimization
3. Added `transition: none` when `.dragging` class is active

## Technical Details

### How It Works

1. **At Rest**: Handle can transition transform (scale) smoothly
2. **On Drag Start**: `isDragging = true` adds `.dragging` class
3. **During Drag**: `transition: none` disables all transitions → instant position updates
4. **On Release**: `.dragging` removed → scale animation works again

### Position Updates Flow

```javascript
// DeviceXY.svelte
function updatePositionRelative(event: PointerEvent) {
  // Calculate new position
  localX = newX;  // Instant update
  localY = newY;  // No CSS transition fights this

  // Throttle OSC messages (unchanged)
  if (!throttleTimer) {
    throttleTimer = setTimeout(sendThrottledUpdate, 16);  // 60 FPS
  }
}
```

**Result**: Visual feedback is instant, OSC throttling prevents network flooding.

## Consequences

### Positive

- ✅ Instant visual feedback during drag (zero perceived lag)
- ✅ Smooth, professional UX matching native controls
- ✅ Automatic fix for all 57 XY component usages
- ✅ OSC throttling unchanged (still 60 FPS)
- ✅ Maintains scale animation for tactile feedback
- ✅ GPU optimization via `will-change`

### Neutral

- Minimal CSS changes only
- No JavaScript logic changes
- No breaking changes

### Negative

- None identified

## Alternatives Considered

### 1. Remove All Transitions
**Rejected**: Loses tactile feedback (scale animation on drag start)

### 2. Lower Transition Duration
**Rejected**: Still creates lag, just less noticeable

### 3. Use `transform: translate()` for Position
**Rejected**: Would require refactoring position calculation logic

## References

- Component: `interface/src/lib/components/v6/device-panel/DeviceXY.svelte`
- Used by: 20+ device controls, 16+ central views
- Related: ADR-081 (Relative mode implementation)
