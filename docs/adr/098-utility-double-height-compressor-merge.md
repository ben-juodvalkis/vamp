# ADR 098: Utility Double-Height with Merged Compressor Controls

**Status**: Accepted
**Date**: 2025-10-31
**Authors**: Claude
**Tags**: `fx-grid`, `ui-optimization`, `virtual-devices`, `central-views`

## Context

The FX Grid had **15 slots** with Utility and Compressor occupying separate single-height grid positions (fx7 and fx14 respectively). This created several issues:

### Problems with Separate Slots

1. **Wasted Vertical Space**: Utility's single slider didn't need a full grid slot, leaving dead space
2. **Fragmented Controls**: Related mixing/dynamics controls (utility width, compression, sidechain) were scattered
3. **Grid Overcrowding**: 15 slots in a 12-column, 2-row grid felt cramped
4. **Poor Ergonomics**: Compressor threshold slider was tiny and hard to adjust in single-height slot

### User Workflow

In typical mixing workflows, utility and compression are often used together:
- Width adjustment for stereo imaging
- Compression for dynamics control
- Sidechain routing for ducking/pumping effects

Having these controls unified in one location improves workflow efficiency.

## Decision

**Make Utility double-height (spanning both rows) and merge Compressor controls into the Utility central view** following the established virtual device pattern (similar to Smudge/Chorus).

### Architecture Changes

#### 1. Grid Layout Modifications

**File**: [fxGridLayout.ts](../../interface/src/lib/config/fxGridLayout.ts)

- Added `rowSpan?: 1 | 2` to `FXGridSlotConfig` interface
- Set Utility (fx7) to `rowSpan: 2` for double-height display
- Removed Compressor from grid entirely (was fx14)
- Moved Arpeggiator from fx15 to fx14
- **Grid reduced from 15 slots to 14 slots**
- Updated `PositionKey` type: `fx1-fx14` (removed fx15)

```typescript
{
  position: 'fx7',
  deviceType: 'utility',
  component: UtilityControl,
  span: 1,
  rowSpan: 2,  // Double-height
  row: 1,
  config: DEVICE_PRESETS.utility
}
```

#### 2. FXGrid Component Updates

**File**: [FXGrid.svelte](../../interface/src/lib/components/v6/device-panel/FXGrid.svelte)

- Added conditional `row-span-2` class for double-height slots
- Reduced slot array from 15 to 14 devices
- Grid properly handles row-spanning with Tailwind's `row-span-2` class

```svelte
<div
  class:col-span-2={span === 2}
  class:col-span-1={span === 1}
  class:row-span-2={rowSpan === 2}
>
  <Component device={devices[i]} {position} />
</div>
```

#### 3. Virtual Device Configuration

**File**: [devicePresets.ts](../../interface/src/lib/config/devicePresets.ts)

Converted Compressor to a **virtual device** following the Smudge/Chorus pattern:

```typescript
compressor: {
  presetPath: `${constants.paths.effectPresetsBase}/Compressor.adv`,
  defaultName: 'Compressor',
  expectedClassName: 'Compressor2',
  gridSlot: false,                    // Virtual device
  centralViewGroup: 'utility',        // Belongs to UtilityCentralView
  color: { /* amber */ }
}
```

#### 4. CompressorControl Component

**File**: [CompressorControl.svelte](../../interface/src/lib/components/v6/device-panel/CompressorControl.svelte)

Created following the **ChorusControl pattern**:

```svelte
<BaseDeviceControl
  slotKey="compressor"              // Uses slotKey, not position
  {device}
  title="Compressor"
  disableCentralViewOnTap={true}    // Already in central view
>
  <!-- Threshold slider -->
</BaseDeviceControl>
```

**Key Differences from Grid Devices**:
- Uses `slotKey="compressor"` instead of `position`
- Uses `disableCentralViewOnTap={true}` (it's rendered inside UtilityCentralView)
- Self-contained with own parameter management
- Loads independently when triggered

#### 5. UtilityCentralView Refactor

**File**: [UtilityCentralView.svelte](../../interface/src/lib/components/v6/central/views/UtilityCentralView.svelte)

Refactored to follow **SmudgeCentralView pattern**:

```svelte
<script>
  import { getCentralViewDevices } from '$lib/config/devicePresets';
  import CompressorControl from '../../device-panel/CompressorControl.svelte';

  // Get virtual devices in the utility group
  const virtualUtilityDevices = getCentralViewDevices('utility');

  function getDevice(deviceType: string) {
    return selectedTrackStore.getFxGridSlot(deviceType).device;
  }
</script>

<div class="utility-central-layout">
  <!-- Compressor Control (virtual device) -->
  {#each virtualUtilityDevices as slotKey}
    {#if slotKey === 'compressor'}
      <CompressorControl device={getDevice(slotKey)} />
    {/if}
  {/each}

  <!-- Sidechain Routing (custom functionality) -->
  <div class="sidechain-section">
    <!-- Track selection buttons -->
  </div>
</div>
```

**Layout**: 2-column grid (200px + 1fr)
- Left: CompressorControl component (threshold slider)
- Right: Sidechain routing (custom UI for compressor properties)

#### 6. UtilityControl Updates

**File**: [UtilityControl.svelte](../../interface/src/lib/components/v6/device-panel/UtilityControl.svelte)

- Simplified to standard pattern (removed compressor fetching logic)
- Changed slider title from "WIDTH" to "GAIN"
- Changed color from slate to green (matching EQ)
- Standard `centralDisplayStore.setView()` call with `device` and `color`

```svelte
{@const greenColor = {
  primary: 'rgb(34, 197, 94)',      // Green
  secondary: 'rgba(34, 197, 94, 0.1)',
  accent: 'rgb(134, 239, 172)'
}}
<DeviceSlider
  title="GAIN"
  color={greenColor}
  ...
/>
```

## Virtual Device Pattern

This implementation follows the **established virtual device pattern** from Smudge/Chorus:

### Pattern Structure

```
Grid Slot (double-height)
  ↓ Opens Central View
Central View Component
  ├── Virtual Device Control(s) (uses slotKey, disableCentralViewOnTap)
  └── Custom UI (additional functionality)
```

### Comparison to Smudge Pattern

**Smudge/Chorus** (existing):
```
Smudge Grid Slot (fx12)
  ↓
SmudgeCentralView
  ├── ChorusControl (virtual, slotKey="chorus")
  ├── CombControl
  └── Comb LFO XY
```

**Utility/Compressor** (new):
```
Utility Grid Slot (fx7, double-height)
  ↓
UtilityCentralView
  ├── CompressorControl (virtual, slotKey="compressor")
  └── Sidechain Routing
```

### Key Pattern Elements

1. **Grid slot** uses `position` prop (e.g., `position="fx7"`)
2. **Virtual device controls** use `slotKey` prop (e.g., `slotKey="compressor"`)
3. **Central view** fetches virtual devices via `getCentralViewDevices(groupName)`
4. **Virtual devices** set `disableCentralViewOnTap={true}` (already in central view)
5. **Device presets** configured with `gridSlot: false` and `centralViewGroup: 'utility'`

## Track Meter Integration

**Added 2025-10-31**: The Utility slider now includes live track metering for enhanced visual feedback.

### Visual Design

The double-height Utility slider displays:
- **Background**: Live track meter (green→yellow→orange→red gradient) animating with audio level
- **White handle**: Shows the gain/width parameter value position
- **"GAIN" label**: Centered text overlay
- **No colored fill**: Removed to avoid visual clutter with meter background

### Implementation

**DeviceSlider.svelte**:
- Added optional `track` and `trackIndex` props
- Conditionally renders `MeterVisualization` component as background layer
- Hides parameter fill when meter is present (keeps only white handle)
- Background becomes transparent when meter is active

**UtilityControl.svelte**:
- Added `useMaxTrackObserver` hook to track selected track
- Manages track state with meter data (~60fps updates)
- Passes `track` and `trackIndex` to DeviceSlider
- Observer auto-cleans up on track changes

### Architecture Reuse

This implementation reuses the exact same pattern as the browser's `SelectedTrackMeter`:
- Same `MeterVisualization` component (green→red gradient with clip-path)
- Same `useMaxTrackObserver` hook for track data
- Same track state management
- No performance impact (meter already running for selected track)

### Benefits

- **Visual Feedback**: See audio levels while adjusting gain/width
- **Mixing Context**: Understand track dynamics before applying utility processing
- **No Extra Controls**: Meter is passive - doesn't add UI complexity
- **Familiar Pattern**: Consistent with browser meter visualization

## Consequences

### Positive

✅ **Better Space Utilization**: Double-height Utility makes efficient use of vertical space
✅ **Unified Mixing Controls**: All utility/compression controls in one central view location
✅ **Improved Ergonomics**: Compressor threshold slider is now full-size and easier to adjust
✅ **Reduced Grid Clutter**: 14 slots instead of 15, less cramped
✅ **Follows Established Pattern**: Uses same architecture as Smudge/Chorus (maintainable)
✅ **Future Extensibility**: Can add more virtual devices to utility group if needed
✅ **Visual Prominence**: Green double-height Utility slot is easy to locate
✅ **Live Metering**: Track audio level visualization provides instant visual feedback

### Neutral

➖ **Compressor no longer in grid**: Some users might expect to see it as a grid slot
➖ **Learning curve**: Users need to understand that tapping Utility opens compression controls

### Negative

❌ **One fewer grid slot**: Lost one slot (but grid was overcrowded anyway)
❌ **More complex central view**: UtilityCentralView now manages multiple concerns

## Alternatives Considered

### 1. Keep Separate Slots
**Rejected**: Wasted space, poor ergonomics for compression control

### 2. Make Utility 2-column instead of double-height
**Rejected**: Doesn't save any slots, harder to implement row-spanning logic

### 3. Put Compressor in a different central view group
**Rejected**: Utility and compression are logically related for mixing workflows

### 4. Remove Utility slider entirely, only have central view
**Rejected**: Useful to have quick width adjustment in grid without opening central view

## Implementation Notes

### Row-Spanning in Tailwind

The grid uses standard Tailwind classes:
```svelte
<div class:row-span-2={rowSpan === 2}>
```

This requires the parent grid to use `grid-rows-2` explicitly.

### Color Consistency

Utility changed to green (`rgb(34, 197, 94)`) to match EQ, providing visual consistency for frequency/spectral tools.

### Device Loading

Both Utility and Compressor load independently:
- Tapping Utility slider loads Utility device
- Tapping Compressor threshold in central view loads Compressor device
- Both can exist simultaneously on the track

### Sidechain Functionality

Sidechain routing UI remains in UtilityCentralView (not in CompressorControl) because:
- It's track-level routing logic, not parameter control
- Requires extensive UI space (multi-column button grid)
- Benefits from separation of concerns

## Related ADRs

- [ADR 088: Virtual Device Slots for Central Views](./088-virtual-device-slots-for-central-views.md) - Established virtual device pattern
- [ADR 095: Position-Based FX Grid Architecture](./095-position-based-fx-grid-architecture.md) - Position keys vs device types
- [ADR 097: Compressor Sidechain Central View](./097-compressor-sidechain-central-view.md) - Original sidechain implementation

## Documentation

See architecture docs:
- [V6 UI Architecture](../v6-ui-architecture.md) - Central view system
- [Device Presets Config](../../interface/src/lib/config/devicePresets.ts) - Virtual device configuration
- [FX Grid Layout](../../interface/src/lib/config/fxGridLayout.ts) - Position-based grid config

## Migration Path

This was a breaking change implemented in one step:

1. ✅ Add `rowSpan` support to grid layout system
2. ✅ Remove Compressor from grid, adjust numbering (fx15 → fx14)
3. ✅ Configure Compressor as virtual device with `centralViewGroup: 'utility'`
4. ✅ Create CompressorControl following ChorusControl pattern
5. ✅ Refactor UtilityCentralView to follow SmudgeCentralView pattern
6. ✅ Update UtilityControl styling (green, "GAIN" label)

No backward compatibility needed - this is a UI-only change with no API impact.

## Future Enhancements

Possible improvements:
- Add **Saturator** as another virtual device in utility group (drive control)
- Add **Limiter** for final stage dynamics
- Add **Stereo Imager** for advanced width control
- Consider **EQ** integration for full channel strip experience

## Conclusion

This refactor successfully consolidates mixing/dynamics controls into a unified, ergonomic interface while reducing grid clutter and following established architectural patterns. The double-height Utility with merged Compressor controls provides a more efficient and professional mixing workflow.
