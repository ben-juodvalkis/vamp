# ADR-087: Tap-to-Load and Central View Navigation

## Status
Accepted

## Context
Previously, FX devices in ghost state could only be loaded by dragging/moving controls. Additionally, tapping a device (even when loaded) didn't navigate to its central view, creating an inconsistent user experience where users had to drag to access device controls.

## Decision
Implement comprehensive tap-to-load and central view navigation for all FX device controls:

### Technical Implementation
- Added `onTap` prop to `DeviceXY` and `DeviceSlider` components
- Tap detection: < 200ms duration, < 5px movement threshold  
- Created modular `handleTap()` function in `BaseDeviceControl`
- Preserves existing drag behavior for parameter control
- Works for both main FX grid devices and virtual devices in central views

### Architecture
**Modular Design in BaseDeviceControl:**
```svelte
function handleTap() {
  // Always switch to central view on tap (regardless of device state)
  centralDisplayStore.setView('device', slotKey, { device, color });
  
  // Only load device if it's ghost
  if (isGhost && !loadingInitiated) {
    loadingInitiated = true;
    selectedTrackStore.loadFxGridDevice(slotKey);
  }
}
```

### Components Updated
- **Core**: DeviceXY, DeviceSlider (tap detection logic)
- **Base**: BaseDeviceControl (centralized tap handling logic)
- **XY Controls**: 11 components (Delay, Reverb, AutoFilter, Tremolo, Comb, Saturator, Chorus, AutoPan, Smudge, Pedal, Drum)
- **Slider Controls**: 6 components (Variation, Redux, Compressor, Guitar, Bass, Arpeggiator)
- **Central Views**: All embedded device controls automatically inherit functionality

### User Experience
- **Tap ghost device** → Load device + switch to central view
- **Tap active device** → Switch to central view  
- **Drag ghost device** → Load device + switch to central view + control parameters
- **Drag active device** → Switch to central view + control parameters
- **Visual**: Ghost devices show reduced opacity, loading shows pulse animation

## Consequences

### Positive
- Intuitive device loading and navigation workflow
- Consistent behavior across all device states and types
- Modular implementation - single point of change for all components
- Better accessibility for users who prefer tap interactions
- Preserves all existing drag behavior
- Easy maintenance and future enhancements

### Negative
- Minimal: Small increase in component complexity
- Risk: Potential for accidental device loading, but 200ms threshold mitigates this

## Implementation Notes
- Uses pointer events for cross-platform compatibility
- Backwards compatible - no breaking changes to existing behavior
- Modular design in BaseDeviceControl reduces code duplication
- Documentation updated in `adding-device-guide.md` and component-level `CLAUDE.md`

## Lessons Learned
Initial implementation only loaded devices on tap but didn't switch views. User feedback revealed the need for consistent central view navigation regardless of device state, leading to the more comprehensive solution.

## Date
2025-10-28