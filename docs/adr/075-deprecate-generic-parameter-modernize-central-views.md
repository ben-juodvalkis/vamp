#ADR-075: Deprecate GenericParameter and Modernize Central Views

**Date**: October 22, 2025  
**Status**: Completed  
**Context**: V6 architecture standardization and component modernization

## Summary

Successfully migrated all central view components from the deprecated `GenericParameter` component to the modern V6 architecture using direct store access and `DeviceSlider` components. This completes the standardization of parameter handling across the entire interface.

## Background

### Legacy Parameter System Issues

The `GenericParameter` component represented an older architecture pattern with several limitations:

1. **Inconsistent State Management**
   - Mixed reactive patterns across components
   - Complex prop-based configuration
   - Non-standard parameter update flows

2. **Performance Overhead**
   - Extra component layer for simple parameter display
   - Redundant state management between component and stores
   - Complex prop drilling for styling and behavior

3. **Maintenance Burden**
   - Separate component to maintain alongside modern patterns
   - Inconsistent APIs across similar functionality
   - Harder to debug parameter flow issues

### Modern V6 Architecture Benefits

The established pattern from `OmnisphereCentralView` provided:

- **Direct Store Access**: `selectedTrackStore.getParameterValue()` and `selectedTrackStore.setParameter()`
- **Reactive State**: Clean `$effect()` usage for parameter updates
- **Consistent UI**: Standardized `DeviceSlider` components
- **Local State First**: Immediate UI updates before store communication

## Decision

### Complete Migration Strategy

Migrate all remaining central view components to match the modern `OmnisphereCentralView` pattern:

1. **InstrumentRackCentralView** - 8 macro controls (0-127 range)
2. **DrumRackKompleteKontrolCentralView** - 16 macro controls (0-127 range)  
3. **ArpeggiatorCentralView** - Steps parameter (0-2 range)

### Implementation Pattern

**Standard Migration Steps:**
1. Replace `GenericParameter` import with `DeviceSlider`
2. Add reactive parameter values array with `$state()`
3. Add `$effect()` for parameter value updates
4. Add parameter change handler with local-first updates
5. Convert parameter ranges (device range ↔ 0-1 UI range)

## Implementation Details

### 1. InstrumentRackCentralView Migration

**Before:**
```typescript
import GenericParameter from '../../parameters/GenericParameter.svelte';

// Single GenericParameter per macro with full configuration
<GenericParameter
  path="/live/device/get/parameter/value"
  index={[trackIndex, deviceIndex, paramIndex]}
  min={0}
  max={127}
  displayName={...}
  // ... 10+ props
/>
```

**After:**
```typescript
import DeviceSlider from '../../device-panel/DeviceSlider.svelte';

// Reactive parameter values
let parameterValues = $state<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);

// Update values on device change
$effect(() => {
  if (device) {
    MACRO_PARAMS.forEach((paramIndex, i) => {
      parameterValues[i] = selectedTrackStore.getParameterValue(device.id, paramIndex) ?? 0;
    });
  }
});

// Handle parameter changes
function handleParameterChange(paramIndex: number, value: number) {
  if (!device) return;
  const arrayIndex = MACRO_PARAMS.indexOf(paramIndex);
  if (arrayIndex >= 0) {
    parameterValues[arrayIndex] = value; // Update local state FIRST
  }
  selectedTrackStore.setParameter(device.id, paramIndex, value); // THEN send
}

// Clean DeviceSlider usage
<DeviceSlider
  value={parameterValues[i] / 127}  // Convert 0-127 to 0-1
  title={parameterNames[paramIndex] ? cleanParameterName(parameterNames[paramIndex]) : `Macro ${paramIndex}`}
  orientation="vertical"
  color={instrumentRackColor}
  onInteraction={(value) => {
    handleParameterChange(paramIndex, Math.round(value * 127)); // Convert 0-1 to 0-127
  }}
/>
```

### 2. DrumRackKompleteKontrolCentralView Migration

**Changes:**
- **16 macro controls** instead of 8
- **Same 0-127 range** conversion pattern
- **4×4 grid layout** maintained
- **Orange color scheme** preserved

### 3. ArpeggiatorCentralView Migration

**Changes:**
- **Single steps parameter** (params 14, range 0-2)
- **Custom pattern/rate sliders** already used modern approach
- **Simple 0-2 to 0-1 conversion**

```typescript
function handleStepsChange(value: number) {
  if (!device) return;
  const intValue = Math.round(value * 2); // Convert 0-1 to 0-2
  stepsValue = intValue; // Update local state FIRST
  selectedTrackStore.setParameter(device.id, 14, intValue); // THEN send
}
```

## Results Achieved

### ✅ Code Quality Improvements

1. **Eliminated GenericParameter Dependency**
   - Removed from all 3 central view components
   - Consistent architecture across entire interface
   - Simplified import dependencies

2. **Standardized Parameter Handling**
   - All components use `selectedTrackStore` directly
   - Consistent `$effect()` patterns for reactivity
   - Uniform parameter change handlers

3. **Improved Performance**
   - Removed extra component layer overhead
   - Direct store access eliminates prop drilling
   - Faster parameter updates with local-first strategy

### ✅ User Experience Improvements

1. **Consistent UI Behavior**
   - All sliders use standardized `DeviceSlider` component
   - Uniform color schemes and interactions
   - Consistent touch responsiveness across components

2. **Reliable Parameter Updates**
   - Local state updates provide immediate visual feedback
   - Proper range conversion between UI (0-1) and device ranges
   - Error-free parameter handling

### ✅ Maintenance Benefits

1. **Single Source of Truth**
   - `DeviceSlider` component handles all parameter UI
   - Centralized styling and behavior management
   - Easier to maintain and update

2. **Simplified Debugging**
   - Direct parameter flow from UI → store → Max4Live
   - Clear state management with `$effect()` patterns
   - Consistent error handling across components

## Technical Details

### Parameter Range Conversions

**0-127 Range (Instrument/Drum Racks):**
```typescript
// UI to Device: value * 127
handleParameterChange(paramIndex, Math.round(value * 127));

// Device to UI: value / 127  
value={parameterValues[i] / 127}
```

**0-2 Range (Arpeggiator Steps):**
```typescript
// UI to Device: value * 2
const intValue = Math.round(value * 2);

// Device to UI: value / 2
value={stepsValue / 2}
```

### Reactive State Pattern

**Standard $effect() Usage:**
```typescript
$effect(() => {
  if (device) {
    MACRO_PARAMS.forEach((paramIndex, i) => {
      parameterValues[i] = selectedTrackStore.getParameterValue(device.id, paramIndex) ?? 0;
    });
  } else {
    parameterValues = [/* default values */];
  }
});
```

### Local-First Update Pattern

**Consistent Handler Structure:**
```typescript
function handleParameterChange(paramIndex: number, value: number) {
  if (!device) return;
  
  // 1. Update local state FIRST for immediate UI feedback
  const arrayIndex = MACRO_PARAMS.indexOf(paramIndex);
  if (arrayIndex >= 0) {
    parameterValues[arrayIndex] = value;
  }
  
  // 2. THEN send to store/Max4Live
  selectedTrackStore.setParameter(device.id, paramIndex, value);
}
```

## Syntax Error Fixes

During implementation, resolved Svelte template syntax errors:

**Issue:** JavaScript-style comments in template expressions
```typescript
// ❌ Wrong: Svelte template
value={parameterValues[i] / 127} // Convert 0-127 to 0-1

// ✅ Correct: Remove inline comments from templates  
value={parameterValues[i] / 127}
```

**Files Fixed:**
- `ArpeggiatorCentralView.svelte:244`
- `DrumRackKompleteKontrolCentralView.svelte:119` 
- `InstrumentRackCentralView.svelte:107`

## Impact Assessment

### Positive Outcomes

1. **Architecture Consistency**
   - 100% of central views now use modern V6 patterns
   - Eliminated legacy component dependencies
   - Simplified codebase maintenance

2. **Performance Gains**
   - Reduced component overhead
   - Faster parameter updates
   - Improved responsiveness

3. **Developer Experience**
   - Consistent patterns across all components
   - Easier debugging and troubleshooting
   - Simplified component architecture

### No Breaking Changes

- **UI Behavior**: Identical user experience maintained
- **Parameter Ranges**: Exact same device parameter mappings
- **Visual Design**: All color schemes and layouts preserved
- **Functionality**: Complete feature parity with previous implementation

## Future Considerations

### Component Standardization Complete

With this migration, the V6 interface now has complete architectural consistency:

- **Modern Components**: All use direct store access patterns
- **Reactive State**: Standardized `$effect()` usage throughout
- **UI Components**: Unified `DeviceSlider` for all parameter controls
- **State Management**: Consistent local-first update patterns

### Deprecated Component Cleanup

`GenericParameter` component can now be considered for removal:

- **No Usage**: Zero references in active codebase
- **Legacy Code**: Can be moved to archive or deleted
- **Import Cleanup**: Remove from component dependencies

### Maintenance Simplification

Future parameter-based components should follow established patterns:

1. Use `DeviceSlider` for parameter UI
2. Implement reactive state with `$effect()`
3. Use local-first update handlers
4. Convert ranges between UI (0-1) and device values

## Files Modified

### Central View Components
- `interface/src/lib/components/v6/central/views/InstrumentRackCentralView.svelte`
- `interface/src/lib/components/v6/central/views/DrumRackKompleteKontrolCentralView.svelte`
- `interface/src/lib/components/v6/central/views/ArpeggiatorCentralView.svelte`

### Related Updates
- Removed `GenericParameter` imports
- Added `DeviceSlider` imports
- Updated component logic and state management

## Validation Completed

- ✅ **Syntax Errors**: All template syntax issues resolved
- ✅ **Import Dependencies**: Clean component imports
- ✅ **Type Safety**: Proper TypeScript patterns maintained
- ✅ **Functionality**: Parameter control behavior preserved
- ✅ **Performance**: Improved component efficiency

---

## Decision Outcome

**Completed Successfully** - All central view components migrated to modern V6 architecture.

**Architecture Achievement**: The Looping interface now has complete consistency in parameter handling, with all components using the standardized `selectedTrackStore` + `DeviceSlider` + `$effect()` pattern established by `OmnisphereCentralView`.

**Next Steps**: Consider removing the deprecated `GenericParameter` component from the codebase entirely, as it no longer has any active usage.