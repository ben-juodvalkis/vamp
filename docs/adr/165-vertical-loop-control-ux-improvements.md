# ADR-165: Vertical Loop Control UX Improvements

## Status
Accepted

## Context

The `VerticalLoopControl` component provides a visual representation of the clip loop region with draggable handles to adjust loop start/end points. Two UX issues were identified:

### Problem 1: Cramped Handles on Long Clips

When a long clip (e.g., 40 bars) has a small loop region (e.g., 1 bar at the end), the top and bottom handles are positioned very close together. This makes it difficult to grab the correct handle, especially on touch devices like iPad.

### Problem 2: Fixed Text Color

The loop length display (showing number of bars) was positioned inside the active loop region with a fixed dark color. When the loop region was small or positioned away from the center, the number could be hard to read or feel disconnected from the overall component.

## Decision

### Dead Zone Drag Interaction

Add the ability to drag handles by pressing anywhere in the "dead zone" (the area outside the active loop region):

1. **Press below the loop region** → Controls the start (bottom) handle
2. **Press above the loop region** → Controls the end (top) handle
3. **Movement is relative** → The handle moves by the drag distance, not jumping to the tap position

This allows users to adjust handles without needing to precisely tap the small handle targets.

### Centered Adaptive Display

Move the loop length display to be centered on the entire component (not just inside the loop region), with color that adapts based on background:

1. **Center inside loop region** → Dark text (`var(--background)`) on green
2. **Center outside loop region** → Green text (`hsl(120 60% 50%)`) on dark background with subtle glow

The determination is based on whether the 50% vertical center point falls within the loop region's start/end percentages.

## Implementation

### Dead Zone Handler

```typescript
function handleDeadZoneInteraction(event: MouseEvent | TouchEvent) {
  // Convert tap Y position to beat value
  const tapBeat = (relativeY / height) * totalRange;

  // Determine which handle based on position relative to loop
  let handleToMove: 'start' | 'end';
  if (tapBeat < loopStart) {
    handleToMove = 'start';  // Below loop → start handle
  } else if (tapBeat > loopEnd) {
    handleToMove = 'end';    // Above loop → end handle
  }

  // Start drag from HANDLE's position (not tap position) for relative movement
  isDragging = handleToMove;
  dragStartY = clientY;
  dragStartValues = { start: loopStart, end: loopEnd };
}
```

### Adaptive Text Color

```typescript
// Check if center (50%) falls within loop region
let centerIsInsideLoop = $derived(startPercentage <= 50 && endPercentage >= 50);
```

```css
.loop-length-display.inside-loop {
  color: var(--background);
  text-shadow: none;
}

.loop-length-display.outside-loop {
  color: hsl(120 60% 50%);
  text-shadow: /* dark outline + glow */;
}
```

## Consequences

### Positive
- Easier to adjust loop handles on long clips with small loop regions
- No need to precisely tap small handle targets
- Loop length always visible and readable regardless of loop position
- Smooth color transition when dragging loop across center point
- Works consistently with both mouse and touch input

### Neutral
- Tap without drag in dead zone does nothing (previously showed clip controls)
- Users need to discover the dead zone drag feature

### Negative
- None identified

## Files Changed
- `interface/src/lib/components/v6/clips/VerticalLoopControl.svelte`
