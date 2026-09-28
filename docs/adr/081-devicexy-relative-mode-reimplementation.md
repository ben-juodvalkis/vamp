#ADR-081: DeviceXY Relative Mode Re-implementation

## Status
Accepted

## Context

Following ADR-019 which switched DeviceXY components from relative to absolute positioning due to user complaints about "jumpy" and "flaky" behavior, we have re-implemented relative mode with significant improvements to address the original issues while providing superior touch control for live performance.

### Issues with Original Relative Implementation (Pre-ADR-019)

The previous relative positioning system had fundamental problems:

1. **Performance Issues**: `getBoundingClientRect()` called on every pointer move
2. **Finger/Dot Misalignment**: Touch position and visual dot became disconnected
3. **No Initial Touch Response**: Dot stayed at previous position when first touched
4. **Cumulative Positioning Errors**: Delta calculations accumulated inaccuracies
5. **Complex State Management**: Required tracking start positions inconsistently

### User Feedback on Absolute Mode

While absolute positioning (ADR-019) resolved the technical issues, users reported:

- **Lack of Precision**: Difficulty making fine adjustments without jumping
- **Professional Audio Interface Expectations**: Hardware audio gear uses relative control
- **Performance Disruption**: Unexpected jumps during live performances

## Decision

Re-implement relative mode as the default behavior for DeviceXY components using a fundamentally improved approach that eliminates all issues from the original implementation.

### New Implementation Design

1. **Performance Optimization**: 
   - Cache `getBoundingClientRect()` on pointer down (same as absolute mode)
   - Use same throttling system (16ms/60fps) as absolute mode
   - No additional DOM queries during drag operations

2. **Precise State Tracking**:
   ```typescript
   // Store initial positions on touch start
   initialTouchX = event.clientX;       // Where finger touched
   initialTouchY = event.clientY;
   initialDotX = localX;               // Where dot was positioned
   initialDotY = localY;
   
   // Calculate movement delta
   const deltaX = (event.clientX - initialTouchX) / cachedRect.width;
   const deltaY = -(event.clientY - initialTouchY) / cachedRect.height;
   
   // Apply to initial dot position
   const x = Math.max(0, Math.min(1, initialDotX + deltaX));
   const y = Math.max(0, Math.min(1, initialDotY + deltaY));
   ```

3. **Immediate Visual Response**: Dot moves immediately when touched (no delay)

4. **Boundary Handling**: Proper clamping prevents dot from leaving valid range

5. **Clean Architecture**: Minimal state variables, no complex tracking

## Implementation Details

### Files Modified
- `interface/src/lib/components/v6/device-panel/DeviceXY.svelte`

### Key Changes
- **Added State Variables**: `initialTouchX/Y`, `initialDotX/Y` (4 simple numbers)
- **Replaced Function**: `updatePositionAbsolute()` → `updatePositionRelative()`
- **Enhanced Touch Handling**: Store initial positions on pointer down
- **Maintained Performance**: Same caching and throttling as absolute mode

### Affected Components
All XY device controls automatically benefit:
- SaturatorControl
- AutoFilterControl  
- DelayControl
- CombControl
- EQControl
- PedalControl
- ReverbControl
- SmudgeControl
- TremoloControl

## Consequences

### Positive
- **Professional Touch Control**: Matches hardware audio interface behavior
- **Precision**: Fine adjustments without unwanted jumps
- **Live Performance Ready**: Predictable, smooth parameter control
- **Zero Breaking Changes**: All device components work unchanged
- **Better UX**: Eliminates biggest source of visual discontinuity (initial jump)
- **Performance Maintained**: Same speed as absolute mode

### Negative
- **User Adjustment**: Users familiar with absolute mode may need brief adaptation
- **Behavior Change**: Different from standard web UI patterns

### Technical Benefits Over Original Implementation
- **✅ No Performance Issues**: Uses optimized caching approach
- **✅ No Finger/Dot Misalignment**: Proper coordinate tracking
- **✅ Immediate Response**: Dot moves on first touch
- **✅ No Cumulative Errors**: Direct delta calculations
- **✅ Simple State**: Clean, minimal tracking variables

## Rationale

Relative mode is the standard in professional audio software and hardware for good reason:

1. **Muscle Memory**: Users can make consistent adjustments without looking
2. **Precision**: Small movements = small changes (vs. large jumps)
3. **Workflow Integration**: Fits natural performance gestures
4. **Safety**: No accidental large parameter changes from mis-touches

Our improved implementation eliminates all technical issues that caused ADR-019 while providing superior user experience for live performance contexts.

## Alternatives Considered

1. **Keep Absolute Mode**: Simpler but less professional control
2. **Hybrid Mode Toggle**: Added UI complexity without clear benefit  
3. **Per-Component Setting**: Over-engineering for consistent behavior need

## Future Considerations

- Monitor user feedback during live performance sessions
- Consider documenting relative mode behavior in user guides
- Potential for preset-specific control mode preferences (future enhancement)

## References

- Previous: ADR-019 DeviceXY Absolute Positioning
- Related: TouchOSC relative mode behavior patterns
- Issue: Need for professional-grade touch control in live performance