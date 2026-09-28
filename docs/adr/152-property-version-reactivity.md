# ADR-152: Property Version Reactivity Fix

**Date:** 2025-01-06
**Status:** Implemented
**Participants:** System Architecture

## Summary

Fixed property reactivity in `selectedTrackStore` by adding a version counter pattern, matching the existing parameter reactivity implementation.

## Context

### Problem

After adding `voice_mode_index` property support for Drift, clicking UI buttons would:
1. Send the property change to Ableton (working)
2. **Not update the UI** (broken)

The `setProperty` method was calling `this._version++` but:
1. `_version` was never declared in `SelectedTrackStore`
2. `getPropertyValue` didn't read any version counter

This meant `$derived` expressions using `getPropertyValue` never re-evaluated.

### Root Cause

Svelte 5's fine-grained reactivity doesn't automatically track mutations inside nested Maps. The parameter system solved this with a version counter in `DeviceParameterStorage`, but properties used a different code path without this pattern.

## Decision

**Add dedicated property version counter** following the established parameter pattern.

### Implementation

```typescript
class SelectedTrackStore {
  private _properties = $state<Map<number, Map<string, any>>>(new Map());
  private _propertyVersion = $state(0); // NEW: Version counter

  getPropertyValue(deviceId: number, propertyPath: string): any | undefined {
    // Access version to establish reactive dependency
    const _ = this._propertyVersion;
    return this._properties.get(deviceId)?.get(propertyPath);
  }

  setProperty<T>(deviceId: number, path: string, value: T): Promise<void> {
    // Update local store optimistically
    let deviceProps = this._properties.get(deviceId);
    if (!deviceProps) {
      deviceProps = new Map();
      this._properties.set(deviceId, deviceProps);
    }
    deviceProps.set(path, value);

    // Bump version to trigger reactivity (with overflow protection)
    this._propertyVersion = (this._propertyVersion + 1) % 10000;

    return liveObjectAPI.setProperty(deviceId, path, value);
  }
}
```

## Consequences

### Benefits

- **Immediate UI feedback** on property changes
- **Consistent pattern** with parameter reactivity
- **Simple fix** - minimal code change
- **Works for all devices** - Simpler, Drift, Hybrid, etc.

### Pattern Consistency

Both parameters and properties now use the same reactivity pattern:

| System | Version Field | Getter Reads | Setter Bumps |
|--------|--------------|--------------|--------------|
| Parameters | `DeviceParameterStorage.version` | Yes | Yes |
| Properties | `SelectedTrackStore._propertyVersion` | Yes | Yes |

## Alternative Considered

### Svelte 5 `$state.raw` + Manual Triggers

Could restructure to use `$state.raw` with explicit reactivity signals. However:
- More invasive change
- Breaks established patterns
- No clear benefit over version counter

The version counter is a known pattern for Map reactivity in Svelte 5 and is already proven in the parameter system.

## Related

- [ADR-088: Simpler Property Cache Migration](088-simpler-property-cache-migration.md) - Original property cache architecture
- [ADR-149: Central View Derived Reactivity](149-central-view-derived-reactivity.md) - `$derived` pattern for components
- [Adding Device Properties Guide](../guides/adding-device-properties.md) - How to add new properties
- GitHub Issue #220 - Original bug report (now closed)
