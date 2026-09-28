#ADR-019: Switch DeviceXY Component to Absolute Positioning

## Status
Accepted

## Context

The DeviceXY component is a core primitive used across all FX grid controls (AutoFilter, Saturator, Delay, Comb, EQ, etc.) for touch-based parameter manipulation on iPad interfaces. Users reported "jumpy" and "flaky" behavior, particularly on the Y-axis, making precise control difficult during live performance.

### Issues with Relative Positioning System

The original implementation used a relative movement system:

```typescript
// Calculate delta from start position
const deltaX = (event.clientX - startPointerX) / rect.width;
const deltaY = -(event.clientY - startPointerY) / rect.height;
const x = Math.max(0, Math.min(1, startValueX + deltaX));
```

This approach had several problems:

1. **Finger/Dot Misalignment**: Touch position and visual dot position became disconnected
2. **No Initial Touch Response**: Dot stayed at previous position when first touched
3. **Cumulative Positioning Errors**: Delta calculations accumulated inaccuracies over time
4. **Performance Issues**: `getBoundingClientRect()` called on every pointer move
5. **Complex State Management**: Required tracking start positions and values

### Parameter Conflicts
Investigation also revealed that Saturator component had parameter conflicts between FX grid and central view components, both controlling the same parameters (Drive, Bass Amount, Hi Amount), which contributed to perceived flakiness.

## Decision

Switch DeviceXY component from relative positioning to absolute positioning system.

### Changes Made

1. **Absolute Coordinate Mapping**:
   ```typescript
   const x = Math.max(0, Math.min(1, (event.clientX - cachedRect.left) / cachedRect.width));
   const y = Math.max(0, Math.min(1, 1 - (event.clientY - cachedRect.top) / cachedRect.height));
   ```

2. **Immediate Touch Response**: Dot moves to touch position on initial contact

3. **Performance Optimization**: Cache `getBoundingClientRect()` on pointer down, clear on pointer up

4. **Simplified State Management**: Removed start position tracking variables

5. **Parameter Conflict Resolution**: Fixed Saturator central view to avoid same-parameter conflicts

## Consequences

### Positive
- **Intuitive Touch Behavior**: Dot follows finger precisely
- **Eliminates Jumpiness**: Direct coordinate mapping prevents positioning errors
- **Better Performance**: Cached bounding rect reduces DOM calls
- **Immediate Response**: Touch registers instantly at correct position
- **System-Wide Fix**: Single component edit improves all FX grid controls
- **Live Performance Ready**: Reliable control for real-time parameter manipulation

### Negative
- **Breaking Change**: Behavior change may require user adjustment
- **Less Precision for Small Movements**: No relative fine-tuning capability

### Neutral
- **Code Simplification**: Reduced complexity in positioning logic
- **Maintained API**: No changes to component interface or usage

## Implementation Notes

The fix was implemented in a single file (`DeviceXY.svelte`) affecting all FX grid components:
- AutoFilterControl
- SaturatorControl  
- DelayControl
- CombControl
- EQControl
- PedalControl
- ReverbControl
- SmudgeControl

No changes were required to individual FX components, demonstrating good component architecture.

## Alternatives Considered

1. **Optimize Relative System**: Cache bounding rect but keep relative movement
2. **Hybrid Approach**: Absolute for initial touch, relative for drag
3. **External UI Library**: Replace with third-party XY pad component

Absolute positioning was chosen for its simplicity and immediate resolution of user experience issues.

## References

- Issue: Jumpy XY controls affecting live performance
- Related: ADR-018 Gesture Browser Architecture (component reusability patterns)
- Files Modified: `interface/src/lib/components/v6/device-panel/DeviceXY.svelte`
- Files Modified: `interface/src/lib/components/v6/central/views/SaturatorCentralView.svelte`