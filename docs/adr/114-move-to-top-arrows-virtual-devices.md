# ADR 114: Move-to-Top Arrows for Device Controls

**Status**: Accepted (Updated 2025-01-18)
**Date**: 2025-01-12
**Authors**: Claude
**Tags**: `ui-components`, `virtual-devices`, `device-management`, `fx-grid`

## Context

Devices lacked a quick way to reorder them in Ableton's device chain from the touch interface. Users had to switch to Ableton to manually drag devices to reorder them, breaking the touch-first workflow.

### Original Implementation

Initially, the main central display views had "move to top" arrows in the top-left corner of [CentralDisplay.svelte](../../interface/src/lib/components/v6/central/CentralDisplay.svelte). This was later **removed** in favor of placing arrows directly on device controls.

### Devices Affected

**FX Grid Devices** (14 slots in main grid):
- AutoFilter, Echo, Pedal, Pitch-Helix, Reverb, Arpeggiator, Drum, AutoPan, Bass, Chorus, Utility, EQ, Guitar, Variation

**Virtual Devices** (accessible through central views):
- **Compressor** (UtilityCentralView)
- **Gate** (UtilityCentralView)
- **Saturator** (PedalCentralView)
- **Digital** (PedalCentralView)
- **Smudge** (SmudgeCentralView)
- **Comb** (SmudgeCentralView)
- **Random** (ArpeggiatorCentralView)

**Note**: Digital LFO does **not** have an arrow since it controls the same device as Digital.

### User Need

Musicians wanted to quickly reorder devices in the FX chain without:
- Leaving the touch interface
- Switching to Ableton Live
- Navigating away from the current view
- Losing context of their current workflow

## Decision

Add "move to top" arrow buttons directly to **all device controls** (both FX grid and virtual devices) by extending [BaseDeviceControl.svelte](../../interface/src/lib/components/v6/device-panel/BaseDeviceControl.svelte) with a `showMoveToTop` prop. **Remove** the arrow from CentralDisplay.

### Implementation Strategy

1. **Centralize Logic in BaseDeviceControl**
   - Add `showMoveToTop?: boolean` prop (default: `false`)
   - Import move functionality from existing `deviceMoveService.ts`
   - Add visual states: idle, moving, success, error
   - Render small arrow button in top-left corner when enabled

2. **Enable for All Device Controls**
   - **All 14 FX grid device controls** enable via `showMoveToTop={true}`
   - **Virtual device controls** enable via `showMoveToTop={true}`
   - **Exception**: Digital LFO does not enable (same device as Digital)
   - Non-breaking change - disabled by default

3. **Remove from CentralDisplay**
   - Arrow removed from [CentralDisplay.svelte](../../interface/src/lib/components/v6/central/CentralDisplay.svelte)
   - Arrow now appears on individual device controls only
   - Consistent location: always in top-left of the device control

4. **Reuse Existing Architecture**
   - Uses same OSC command: `/looping/device/move_appointed_to_top`
   - Uses same appointed device system (blue hand)
   - Same visual feedback pattern as original CentralDisplay arrows

### Code Examples

**Virtual Device (slotKey):**
```svelte
<!-- GateControl.svelte -->
<BaseDeviceControl
  slotKey="gate"
  {device}
  title="Gate"
  disableCentralViewOnTap={true}
  showMoveToTop={true}
>
  {#snippet children({ ... })}
    <DeviceXY ... />
  {/snippet}
</BaseDeviceControl>
```

**FX Grid Device (position):**
```svelte
<!-- AutoFilterControl.svelte -->
<BaseDeviceControl
  {position}
  {device}
  title="AutoFilter"
  showMoveToTop={true}
>
  {#snippet children({ ... })}
    <DeviceXY ... />
  {/snippet}
</BaseDeviceControl>
```

### Visual Design

**Arrow Button:**
- **Size**: 16×16px icon with 1.5rem padding
- **Position**: Absolute, top-left (top: 0.5rem, left: 0.5rem)
- **z-index**: 10 (above device content, below loading overlay)
- **Background**: Semi-transparent slate (`bg-slate-700/50`)

**States:**
- **Idle**: Gray arrow (`ArrowLeft` icon) with hover effect
- **Moving**: Spinning circle animation
- **Success**: Green checkmark (`Check` icon) - 1 second
- **Error**: Red X (`X` icon) - 1 second

## Consequences

### Positive

1. **Unified Workflow** - Virtual devices have same reordering capability as grid devices
2. **No Context Switching** - Users stay in the touch interface
3. **Consistent UX** - Same visual language as existing central view arrows
4. **Centralized Logic** - DRY principle via BaseDeviceControl
5. **Non-Breaking** - Opt-in via prop, doesn't affect existing components
6. **Accessible** - Touch-optimized button size with clear visual feedback

### Negative

1. **Visual Clutter** - Adds another UI element to small device controls
2. **Learning Curve** - Users must discover the arrow exists
3. **Potential Confusion** - Arrow position might interfere with device visuals (mitigated by z-index)

### Neutral

1. **Not for Grid Devices** - Grid devices continue using central view arrows
2. **Requires Device to be Loaded** - Only shows when `device !== null`
3. **Same Limitations** - Uses appointed device system (one device at a time)

## Implementation Details

### BaseDeviceControl Changes

**New Imports:**
```typescript
import { selectDevice, moveAppointedDeviceToTop } from '$lib/services/deviceMoveService';
import { ArrowLeft, Check, X } from 'lucide-svelte';
```

**New State:**
```typescript
let isMoving = $state(false);
let moveResult = $state<'idle' | 'success' | 'error'>('idle');
```

**Button Logic:**
```typescript
async function handleMoveToTop() {
  if (isMoving || !device) return;

  isMoving = true;
  moveResult = 'idle';

  try {
    await selectDevice(device.id);  // Appoint device
    await moveAppointedDeviceToTop();  // Move to position 0
    moveResult = 'success';
    setTimeout(() => { moveResult = 'idle'; }, 1000);
  } catch (error) {
    console.error('Failed to move device:', error);
    moveResult = 'error';
    setTimeout(() => { moveResult = 'idle'; }, 1000);
  } finally {
    isMoving = false;
  }
}
```

### Files Modified (26)

**Core:**
1. [BaseDeviceControl.svelte](../../interface/src/lib/components/v6/device-panel/BaseDeviceControl.svelte) - Add arrow button logic
2. [CentralDisplay.svelte](../../interface/src/lib/components/v6/central/CentralDisplay.svelte) - Remove arrow button

**FX Grid Device Controls (14):**
3. [AutoFilterControl.svelte](../../interface/src/lib/components/v6/device-panel/AutoFilterControl.svelte)
4. [EchoControl.svelte](../../interface/src/lib/components/v6/device-panel/EchoControl.svelte)
5. [PedalControl.svelte](../../interface/src/lib/components/v6/device-panel/PedalControl.svelte)
6. [PitchHelixControl.svelte](../../interface/src/lib/components/v6/device-panel/PitchHelixControl.svelte)
7. [ReverbControl.svelte](../../interface/src/lib/components/v6/device-panel/ReverbControl.svelte)
8. [ArpeggiatorControl.svelte](../../interface/src/lib/components/v6/device-panel/ArpeggiatorControl.svelte)
9. [DrumControl.svelte](../../interface/src/lib/components/v6/device-panel/DrumControl.svelte)
10. [AutoPanLegacyControl.svelte](../../interface/src/lib/components/v6/device-panel/AutoPanLegacyControl.svelte)
11. [BassControl.svelte](../../interface/src/lib/components/v6/device-panel/BassControl.svelte)
12. [ChorusControl.svelte](../../interface/src/lib/components/v6/device-panel/ChorusControl.svelte)
13. [UtilityControl.svelte](../../interface/src/lib/components/v6/device-panel/UtilityControl.svelte)
14. [EQControl.svelte](../../interface/src/lib/components/v6/device-panel/EQControl.svelte)
15. [GuitarControl.svelte](../../interface/src/lib/components/v6/device-panel/GuitarControl.svelte)
16. [VariationControl.svelte](../../interface/src/lib/components/v6/device-panel/VariationControl.svelte)

**Virtual Device Controls (8):**
17. [GateControl.svelte](../../interface/src/lib/components/v6/device-panel/GateControl.svelte)
18. [CompressorControl.svelte](../../interface/src/lib/components/v6/device-panel/CompressorControl.svelte)
19. [SaturatorControl.svelte](../../interface/src/lib/components/v6/device-panel/SaturatorControl.svelte)
20. [DigitalControl.svelte](../../interface/src/lib/components/v6/device-panel/DigitalControl.svelte)
21. [SmudgeControl.svelte](../../interface/src/lib/components/v6/device-panel/SmudgeControl.svelte)
22. [CombControl.svelte](../../interface/src/lib/components/v6/device-panel/CombControl.svelte)
23. [RandomControl.svelte](../../interface/src/lib/components/v6/device-panel/RandomControl.svelte)

**Not Modified:**
- [DigitalLFOControl.svelte](../../interface/src/lib/components/v6/device-panel/DigitalLFOControl.svelte) - Intentionally excluded (controls same device as Digital)

**Documentation:**
24. [adding-device-guide.md](../adding-device-guide.md) - Document `showMoveToTop` prop
25. [ADR-114](./114-move-to-top-arrows-virtual-devices.md) - This document

## Behavior Flow

1. **User Action**: Taps arrow icon on Gate XY pad
2. **Device Selection**: System calls `selectDevice(gateDevice.id)` to appoint the device
3. **Move Operation**: System calls `moveAppointedDeviceToTop()` OSC command
4. **Visual Feedback**:
   - Shows spinning circle during operation
   - Shows green checkmark on success (1s)
   - Shows red X on error (1s)
   - Returns to arrow icon
5. **Result**: Gate device moves to position 0 in Ableton's device chain

## Testing

### Manual Testing Checklist

- ✅ Arrow appears on all virtual device controls with `showMoveToTop={true}`
- ✅ Arrow does not appear on grid devices or virtual devices without the prop
- ✅ Clicking arrow moves device to position 0 in Ableton
- ✅ Visual feedback shows all states correctly (idle, moving, success, error)
- ✅ Arrow is touchable and doesn't interfere with device control interaction
- ✅ Works for ghost devices (loads then moves)
- ✅ Works for active devices (moves immediately)
- ✅ Error state shows when operation fails
- ✅ Success state shows when operation succeeds
- ✅ Arrow returns to idle after 1 second

## Alternatives Considered

### 1. Long-Press to Move
**Rejected**: Conflicts with parameter control gestures, adds complexity

### 2. Swipe Gesture
**Rejected**: Not discoverable, conflicts with XY pad interactions

### 3. Dedicated Menu Button
**Rejected**: Requires additional UI layer, breaks immediate feedback principle

### 4. Context Menu
**Rejected**: Not touch-optimized, requires additional tap to open menu

### 5. Only Use Central View Arrows
**Rejected**: Requires creating full central views for each virtual device, navigation overhead

## Future Enhancements

1. **Move to Other Positions** - Dropdown menu to move to specific positions (not just top)
2. **Move Up/Down** - Arrows to shift device by ±1 position
3. **Visual Position Indicator** - Show current position in chain (e.g., "3/8")
4. **Batch Operations** - Select multiple devices to move together
5. **Keyboard Shortcuts** - For desktop users (Cmd+Up to move to top)

## Related ADRs

- **ADR-088**: Virtual Device Slots for Central Views - Foundation for virtual devices
- **ADR-095**: Position-Based FX Grid Architecture - Grid vs virtual device distinction
- **ADR-050**: Component State Management Pattern - BaseDeviceControl architecture

## Lessons Learned

1. **Centralization is Key** - Adding logic to BaseDeviceControl made implementation trivial
2. **Opt-In Patterns Work** - Default `false` prevented breaking changes
3. **Reuse Existing Services** - `deviceMoveService` worked perfectly for virtual devices
4. **Visual Feedback Matters** - Success/error states improve user confidence
5. **Size Matters** - 16×16px icon is large enough for touch but small enough to not obstruct
6. **z-index is Critical** - Proper layering prevents arrow from being covered by device content

## References

- [V6 Architecture Overview](../v6-architecture-overview.md)
- [Adding Device Guide](../adding-device-guide.md)
- [deviceMoveService.ts](../../interface/src/lib/services/deviceMoveService.ts)
- [CentralDisplay.svelte](../../interface/src/lib/components/v6/central/CentralDisplay.svelte) - Original arrow implementation
