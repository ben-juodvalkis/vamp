# ADR 020: Version Counter Pattern for Svelte 5 Nested Map Reactivity

**Status**: Accepted and Implemented
**Date**: 2025-10-15
**Deciders**: Development Team
**Related**: selectedTrackStore, AutoFilterControl, DeviceParameterStorage

---

## Context

The application uses a nested Map structure to store device parameters:
```typescript
Map<deviceId, Map<paramIndex, value>>
```

When implementing real-time filter curve updates in the AutoFilter component, we discovered that **Svelte 5's fine-grained reactivity does not track mutations to nested Maps**. Specifically:

1. **AutoFilterCentralView** updates a filter type parameter via `setParameter()`
2. **DeviceParameterStorage** updates the nested Map using `map.get(deviceId).set(paramIndex, value)`
3. **AutoFilterControl** reads the value via `getParameterValue()` in a `$effect`
4. The `$effect` **does not re-run** because Svelte doesn't track the nested Map mutation

This caused the filter curve visualization in the FX grid to not update when changing filter types in the central panel, requiring a track switch to see the change.

### Failed Approaches

1. **Re-setting the outer Map**: We tried re-setting `this.parameters.set(deviceId, deviceParams)` after mutation, but Svelte still didn't detect the change
2. **Separate $effect**: Creating a dedicated `$effect` to watch the parameter didn't help
3. **Optimistic updates**: Adding optimistic updates in `sendParameter()` worked for the store but didn't trigger component reactivity

## Decision

Implement a **version counter pattern** to force reactive updates when nested structures change:

```typescript
class DeviceParameterStorage {
  private parameters = $state(new Map<number, Map<number, number>>());
  private version = $state(0);  // Version counter

  getParameterValue(deviceId: number, paramIndex: number): number | undefined {
    const _ = this.version;  // Read version to establish reactive dependency
    return this.parameters.get(deviceId)?.get(paramIndex);
  }

  setParameterValue(deviceId: number, paramIndex: number, value: number) {
    // ... update nested Map ...
    this.version++;  // Increment to trigger reactive updates
  }
}
```

## How It Works

1. **Establishing Dependency**: Every call to `getParameterValue()` reads the `version` counter, establishing a reactive dependency
2. **Triggering Updates**: Every call to `setParameterValue()` increments `version`, invalidating all dependent `$effect` blocks
3. **Cascade Effect**: When `version` changes, any component with a `$effect` that reads a parameter value will re-run
4. **Granular Updates**: The actual parameter value is still read from the Map, so only changed values propagate

## Implementation Details

### Store Changes (selectedTrackStore.svelte.ts)

```typescript
// Added version counter
private version = $state(0);

// Modified getParameterValue to read version
getParameterValue(deviceId: number, paramIndex: number): number | undefined {
  const _ = this.version;  // Establish reactive dependency
  return this.parameters.get(deviceId)?.get(paramIndex);
}

// Modified setParameterValue to increment version
setParameterValue(deviceId: number, paramIndex: number, value: number) {
  // ... update Map ...
  this.version++;  // Force reactive updates
}

// Added optimistic update to sendParameter
sendParameter(deviceId: number, paramIndex: number, value: number): Promise<void> {
  // Optimistically update local Map before sending to Ableton
  this.setParameterValue(deviceId, paramIndex, value);
  send('/looping/device/set/parameter', [...]);
}
```

### Component Pattern (AutoFilterControl.svelte)

```typescript
// Separate $effect to track filter type reactively
$effect(() => {
  if (device) {
    const f = selectedTrackStore.getParameterValue(device.id, 4) ?? 0;
    filterType = f;  // Update triggers curve re-render via $derived
  }
});

// Curve type derives from filter type
let curveType = $derived(FILTER_TYPE_CURVES[filterType] || 'lowpass');
```

## Benefits

1. **Immediate UI Updates**: Filter curve updates instantly when changing filter type in central panel
2. **Optimistic Updates**: UI responds immediately, confirmed by Ableton's complete state later
3. **Clean Pattern**: Simple version counter is easier to understand than complex Map tracking
4. **Performance**: Only increments a number, minimal overhead
5. **Reusable**: Can apply this pattern to other nested structures if needed

## Consequences

### Positive

- ✅ Real-time visual feedback across all device parameter changes
- ✅ Works with Svelte 5's fine-grained reactivity model
- ✅ Simple to implement and maintain
- ✅ No performance impact (single number increment)
- ✅ Compatible with existing complete state architecture

### Negative

- ⚠️ Slightly more verbose: must remember to read version in getters
- ⚠️ All parameter reads re-trigger when ANY parameter changes (acceptable for our use case)
- ⚠️ Unused variable warning (`const _ = this.version`) requires comment

### Trade-offs

- **Global vs Per-Device**: We use a single global version counter rather than per-device counters. This means changing any parameter triggers all `$effect` blocks, but they still only update if the actual value changed. This is acceptable because:
  - Parameter changes are relatively infrequent
  - The actual Map reads are cheap
  - Components typically only watch their own device's parameters
  - Simplicity outweighs micro-optimization

## Alternative Considered

**Deep Cloning Maps**: Could create new Map instances on every change:
```typescript
this.parameters = new Map(this.parameters);
```

**Rejected because**:
- Much more expensive (copies entire Map structure)
- Loses object identity, could break other references
- Version counter is simpler and more explicit

## Related Patterns

This is a well-known pattern in reactive programming:
- React's `key` prop forces re-renders
- MobX's `@observable` uses similar tracking
- Signals-based frameworks use version/revision counters

## Testing

Manual testing confirmed:
1. ✅ Filter type changes in central panel immediately update curve in FX grid
2. ✅ Works across track switches
3. ✅ Works with ghost device loading
4. ✅ No console errors or warnings
5. ✅ Performance is unchanged

## Future Considerations

If we need finer-grained reactivity in the future:
- Could add per-device version counters
- Could add per-parameter version counters
- Could switch to a different data structure (e.g., flat Map with composite keys)

For now, the global version counter is the right balance of simplicity and functionality.
