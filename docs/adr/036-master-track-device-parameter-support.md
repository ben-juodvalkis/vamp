# ADR 019: Master Track Device Parameter Support

**Date**: 2025-10-09
**Status**: Implemented
**Context**: FX Grid and Sequencer Device Loading

## Problem

Device parameters on the master track were not functional:

1. **Setting parameters failed** - Interface sent `/live/device/set/parameter/value` with `trackIndex = -1`, which AbletonOSC doesn't support for master track
2. **Parameter listeners failed** - Interface sent `/live/device/start_listen/parameter/value` with `trackIndex = -1`, which AbletonOSC doesn't support
3. **Sequencer load detection missing** - Unlike FX Grid devices, sequencer had no completion detection when device loaded
4. **Optimistic FX loading broken** - Single-parameter controls (Variation, Compressor, Redux, Utility) couldn't load from ghost state

## Root Cause Analysis

### Master Track Parameter Issue

AbletonOSC's device parameter endpoints expect `trackIndex >= 0`:
- `/live/device/set/parameter/value [trackIndex, deviceIndex, paramIndex, value]` ❌ Rejects trackIndex = -1
- `/live/device/start_listen/parameter/value [trackIndex, deviceIndex, paramIndex]` ❌ Rejects trackIndex = -1

However, LiveAPI in Max4Live fully supports master track using path `"live_set master_track"`.

### Sequencer Load Detection Issue

FX Grid devices had `checkLoadingCompletion()` triggered by `handleDeviceAdded()`, but sequencer had no equivalent:
- FX Grid: `fxGrid.checkLoadingCompletion(device)` ✅
- Sequencer: No detection ❌
- Result: Loading state never cleared, pending parameters never applied, retries blocked

### Optimistic Loading UX Issue

Single-parameter FX controls wrapped GenericParameter in conditional rendering:
```svelte
{#if device}
  <GenericParameter ... />
{:else}
  <div onclick={triggerLoad}>Ghost state</div>
{/if}
```

Problems:
- Ghost state required click to load (drag didn't work)
- Inconsistent with XY devices which support drag-to-load
- GenericParameter couldn't handle ghost state or pending parameters

## Solution

### 1. Custom Parameter Handlers in Max4Live

Added custom handlers in `liveAPI-v6.js` that explicitly support master track:

**New OSC Endpoints**:
- `/looping/device/start_listen/parameter [trackIndex, deviceIndex, paramIndex]`
- `/looping/device/stop_listen/parameter [trackIndex, deviceIndex, paramIndex]`
- `/looping/device/set/parameter [trackIndex, deviceIndex, paramIndex, value]` (already existed)

**Implementation** (lines 1268-1820):
```javascript
function startParameterObserver(trackIndex, deviceIndex, paramIndex) {
    var trackPath = (trackIndex === -1)
        ? "live_set master_track"
        : "live_set tracks " + trackIndex;

    var observer = new LiveAPI(parameterValueChanged,
        trackPath + " devices " + deviceIndex + " parameters " + paramIndex);
    observer.property = "value";

    // Store observer and send initial value
    parameterObservers[observerKey] = { observer, trackIndex, deviceIndex, paramIndex };
}
```

### 2. Updated Interface OSC Paths

Changed `selectedTrackStore.svelte.ts` to use custom paths:

**Before**:
```typescript
send('/live/device/set/parameter/value', [...])
send('/live/device/start_listen/parameter/value', [...])
send('/live/device/stop_listen/parameter/value', [...])
```

**After**:
```typescript
send('/looping/device/set/parameter', [...])
send('/looping/device/start_listen/parameter', [...])
send('/looping/device/stop_listen/parameter', [...])
```

### 3. Sequencer Load Completion Detection

Added detection in `selectedTrackStore.svelte.ts`:

```typescript
handleDeviceAdded(device: Device) {
    this._devices = [...this._devices, device].sort((a, b) => a.index - b.index);
    this.fxGrid.checkLoadingCompletion(device);
    this.checkSequencerLoadingCompletion(device); // NEW
}

private checkSequencerLoadingCompletion(device: Device) {
    if (device.className === 'MxDeviceAudioEffect' && device.name === 'Sequencer') {
        import('./sequencerStore.svelte').then(({ sequencerStore }) => {
            sequencerStore.onDeviceLoaded(device);
        });
    }
}
```

Added `onDeviceLoaded()` method in `sequencerStore.svelte.ts`:
- Clears timeout
- Resets loading flags (allows retry)
- Applies pending parameters automatically
- Logs success

### 4. Optimistic FX Loading

Enhanced `GenericParameter.svelte` with ghost state support:

```typescript
interface Props {
    // ... existing props
    isGhost?: boolean;
    triggerLoad?: () => void;
    storePendingParam?: (paramIndex: number, value: number) => void;
}

function handleChange(value: number) {
    currentValue = value; // Optimistic UI update

    if (isGhost) {
        triggerLoad?.();
        storePendingParam?.(paramIdx, value);
    } else {
        selectedTrackStore.setParameter(device.id, paramIdx, value);
    }
}
```

Updated single-parameter controls to always render GenericParameter:

**Before**:
```svelte
{#if device}
  <GenericParameter ... />
{:else}
  <div onclick={triggerLoad}>Ghost</div>
{/if}
```

**After**:
```svelte
<GenericParameter
    ...
    {isGhost}
    {triggerLoad}
    {storePendingParam}
/>
```

## Benefits

1. **Master track fully functional** - All FX devices work on master track
2. **Consistent UX** - All devices (XY and single-parameter) support tap/drag to load
3. **Optimistic updates** - Immediate visual feedback when adjusting ghost devices
4. **Reliable sequencer loading** - Proper completion detection and retry support
5. **Clean architecture** - Custom Max handlers centralize master track support

## Trade-offs

### Bypassing AbletonOSC

We now use custom Max4Live handlers instead of native AbletonOSC paths for device parameters.

**Pros**:
- Full master track support (trackIndex = -1)
- Consistent API across all track types
- Fine-grained control over parameter observation

**Cons**:
- Adds Max4Live dependency for parameter control
- Slightly more complex message routing
- Need to maintain custom handlers

**Decision**: Acceptable trade-off - master track is a first-class citizen, and the custom handlers are well-isolated and maintainable.

## Implementation Files

**Max4Live**:
- `ableton/scripts/liveAPI-v6.js` - Parameter observer system (+114 lines)

**Interface**:
- `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` - Updated OSC paths, sequencer detection
- `interface/src/lib/stores/v6/sequencerStore.svelte.ts` - Load completion handling
- `interface/src/lib/components/v6/parameters/GenericParameter.svelte` - Ghost state support
- `interface/src/lib/components/v6/device-panel/VariationControl.svelte` - Simplified rendering
- `interface/src/lib/components/v6/device-panel/CompressorControl.svelte` - Simplified rendering
- `interface/src/lib/components/v6/device-panel/ReduxControl.svelte` - Simplified rendering
- `interface/src/lib/components/v6/device-panel/UtilityControl.svelte` - Simplified rendering
- `interface/src/lib/components/v6/clips/MuteSequencerControl.svelte` - Removed redundant effect

## Testing

**Master Track**:
- ✅ Load FX devices from ghost state (tap or drag)
- ✅ Adjust parameters and see changes in Ableton
- ✅ Switch to/from master track - parameters update correctly
- ✅ Load sequencer device - completes and accepts parameter changes

**Regular Tracks**:
- ✅ All existing functionality maintained
- ✅ Optimistic loading works for single-parameter devices
- ✅ Track switching updates FX Grid correctly

## Future Considerations

- Consider extending custom parameter handlers to regular tracks for consistency
- Monitor performance impact of Max-based parameter observation
- May want to add batch parameter update support for efficiency
