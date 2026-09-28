# ADR 105: Echo Device with Dual Interactive Filter Visualization

**Status:** Accepted
**Date:** 2025-01-04
**Context:** V6 Device Integration

## Context

The Delay device was replaced with Ableton's Echo device to provide more flexible delay options. Echo includes sophisticated filtering capabilities with separate highpass and lowpass filters, each with independent frequency and resonance controls. We needed an intuitive way to visualize and control these dual filters in the central display.

## Decision

Replace Delay with Echo device and implement a dual-filter interactive visualization in the Echo Central View:

### 1. Device Configuration

**Echo Device Parameters:**
- **Param 4**: Time (integer 1-4, inverted: X=0 sends 4, X=1 sends 1)
- **Param 16**: Feedback (0-0.67)
- **Param 52**: Mix (0-0.5)
- **Param 29**: Highpass Frequency (0-1, normalized)
- **Param 30**: Highpass Resonance (0-1, mapped to Q 0.5-10)
- **Param 31**: Lowpass Frequency (0-1, normalized)
- **Param 32**: Lowpass Resonance (0-1, mapped to Q 0.5-10)

**Default Values:**
- Time: 2 (mid-range)
- Feedback/Mix: 0 (no echo on load)
- Filters: HP at minimum (0), LP at maximum (1), both with zero resonance

### 2. Dual Filter Visualization

**Interactive Filter Curve:**
- Single large view showing combined frequency response of both filters
- Two independently draggable colored dots:
  - **Red dot (#ff6b6b)**: Highpass filter position
  - **Blue dot (#4dabf7)**: Lowpass filter position
- Dots positioned in normalized frequency/resonance space (not on the curve)
- Grid with logarithmic frequency scale (20Hz-20kHz) and dB markings

**Interaction Model:**
- Click anywhere grabs the nearest dot
- Drag horizontally to adjust filter frequency (logarithmic)
- Drag vertically to adjust filter resonance (Q factor)
- Visual feedback via vertical lines at filter frequencies
- Combined curve updates in real-time showing cumulative effect

### 3. Enhanced FilterCurve Component

Added `filterDots` prop to support multiple interactive filter positions:

```typescript
interface FilterDot {
  freq: number;      // 0-1 normalized frequency
  resonance: number; // 0-1 Q factor
  type: 'lowpass' | 'highpass';
  color?: string;
}
```

**Rendering:**
- Dots positioned by normalized frequency (X) and resonance (Y)
- Larger, more visible dots (10px radius) with white stroke
- Vertical indicator lines at each filter frequency
- Overflow clipping prevents dots from escaping bounds

### 4. FX Grid Integration

**EchoControl Component:**
- XY pad controls Time (X-axis) and Feedback/Mix (Y-axis)
- Time inverted: left=4 sixteenths, right=1 sixteenth
- Y-axis simultaneously controls feedback (0-0.67) and mix (0-0.5)
- Tapping switches to Echo Central View for filter control

## Rationale

### Why Echo over Delay?
- More flexible time divisions
- Integrated highpass and lowpass filters
- Better suited for rhythmic echo effects
- Native Ableton device (no custom Max patches needed)

### Why Dual Interactive Dots?
1. **Direct Manipulation**: Unlike separate XY pads, users can see and manipulate filter positions directly on the frequency response curve
2. **Visual Feedback**: Combined curve immediately shows how filters interact (bandpass when HP < LP, band-reject when they cross)
3. **Consistent with AutoFilter**: Extends familiar single-dot paradigm to dual filters
4. **Efficient Use of Space**: Single large view instead of multiple small controls

### Why Separate Central View?
- FX Grid pad focuses on echo timing (primary use case)
- Filter adjustments are secondary, more detailed work
- Central view provides larger workspace for precise filter positioning
- Keeps grid interface clean and focused

## Implementation Details

**Files Modified:**
- `interface/src/lib/config/devicePresets.ts` - Echo preset path/config
- `interface/src/lib/config/fxGridLayout.ts` - Swap DelayControl → EchoControl
- `data/device-configs.json` - 7 Echo parameters for state messages
- `interface/src/lib/components/v6/device-panel/EchoControl.svelte` - XY pad for time/feedback
- `interface/src/lib/components/v6/central/views/EchoCentralView.svelte` - Dual filter visualization
- `interface/src/lib/components/v6/device-panel/FilterCurve.svelte` - Added `filterDots` prop
- `interface/src/lib/components/v6/central/CentralDisplay.svelte` - Route to EchoCentralView

**Max4Live Configuration:**
- Generated `device-configs.js` includes all 7 Echo parameters
- State messages now query filter parameters (29, 30, 31, 32)

## Consequences

### Positive
- Intuitive dual-filter control with direct visual feedback
- Reusable `filterDots` pattern for future multi-filter devices
- Consistent interaction model across filter devices
- Clean separation of echo timing (grid) vs filtering (central)
- Combined curve visualization shows filter interaction

### Negative
- Requires Max4Live device reload to pick up new parameters
- Filter control separated from main grid (requires tap to access)
- Users unfamiliar with frequency response curves may need learning

### Neutral
- Breaks compatibility with existing Delay presets (different device class)
- Filter parameters not exposed in grid view (by design)

## Notes

**Frequency/Resonance Mapping:**
- Frequency: Logarithmic scale (20Hz-20kHz) via `normalizedToFrequency()`
- Resonance: Exponential Q scale (0.5-10) via `normalizedToQ()`
- Both filters always active (no threshold-based enabling)

**Future Enhancements:**
- Keyboard shortcuts for precise filter adjustments
- Filter preset system
- Link/unlink filter resonances for parallel control
- Optional numeric readouts for exact frequency/Q values

## References

- ADR 049: Complete State Architecture
- ADR 018: Gesture Browser Architecture
- `documentation/v6-api.md` - Device parameter system
- `documentation/adding-device-guide.md` - Device integration patterns
