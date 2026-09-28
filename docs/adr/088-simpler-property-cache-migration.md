# ADR-088: Simpler Property Cache Migration

**Date:** 2025-10-26  
**Status:** Implemented  
**Participants:** System Architecture

## Summary

Migrated Simpler device properties from observer-based pattern to cache-based pattern, eliminating 4 property observers per device while maintaining full functionality and improving performance.

## Context

### Problem

SimplerCentralView used **two different patterns** for device state:

1. **Parameters** (Attack, Release, Transpose, Fade): Complete state cache ✅
2. **Properties** (playback_mode, warp_mode, warping): Live observers ❌

This created:
- **Architectural inconsistency** (dual patterns in one component)
- **Observer overhead** (4 subscriptions per Simpler device)
- **Complex lifecycle** (subscription setup/cleanup)
- **Slower track switching** (observer creation/destruction)

### Previous Implementation

```typescript
// Mixed patterns in SimplerCentralView:
attackValue = selectedTrackStore.getParameterValue(device.id, 26) ?? 0.5;  // Cache

const unsubMode = selectedTrackStore.subscribeToProperty(
  device.id, 'playback_mode', (mode) => { playbackMode = mode; }
);  // Observer
```

## Decision

**Migrate Simpler properties to unified cache-based architecture** matching the existing parameter pattern.

### Architecture Pattern

**Cache-Based Reading:**
```typescript
$effect(() => {
  if (device) {
    warpMode = selectedTrackStore.getPropertyValue(device.id, 'sample.warp_mode') ?? 0;
  }
});
```

**Optimistic Updates:**
```typescript
function handleWarpModeChange(value: string) {
  const modeNumber = WARP_MODE_MAP[value];
  warpMode = modeNumber; // Immediate UI update
  selectedTrackStore.setProperty(device.id, 'sample.warp_mode', modeNumber); // Backend sync
}
```

## Implementation

### Backend Changes

#### 1. Device Configuration System
**Extended configuration generation** to support properties alongside parameters:

```json
// data/device-configs.json
"OriginalSimpler": {
  "parameters": { /* existing parameters */ },
  "properties": {
    "playback_mode": { "type": "int", "description": "0=Classic, 2=Slicing" },
    "sample.warp_mode": { "type": "int", "description": "0=Beats, 4=Complex, 6=Pro" },
    "sample.warping": { "type": "boolean", "description": "Enable/disable warping" },
    "sample.slicing_sensitivity": { "type": "float", "description": "0-1 sensitivity" }
  }
}
```

#### 2. Complete State Enhancement
**Enhanced `buildCompleteDeviceState()`** to query properties:

```javascript
// liveAPI-v6.js - Property path handling
var pathParts = propPath.split(".");
if (pathParts.length > 1) {
  // "sample.warp_mode" → path: "live_set tracks 3 devices 0 sample", prop: "warp_mode"
  parentPath = devicePath + " " + pathParts.slice(0, -1).join(" ");
  propertyName = pathParts[pathParts.length - 1];
}
```

**Enhanced message format** (backward compatible):
```
[...existing..., hasVariations, variationCount, selectedIndex, propCount, propPath1, propValue1, ...]
```

### Frontend Changes

#### 3. Message Parsing
**Enhanced `parseCompleteDeviceState()`** to handle properties:

```typescript
// Parse properties after variations
const propertyCount = args[argIdx++];
if (propertyCount > 0) {
  const deviceProperties = new Map<string, any>();
  for (let p = 0; p < propertyCount; p++) {
    const propPath = args[argIdx++] as string;
    const propValue = args[argIdx++];
    deviceProperties.set(propPath, propValue);
  }
  properties.set(deviceId, deviceProperties);
}
```

#### 4. Cache-Based Component Pattern
**Replaced 4 property observers** with cache-based reading:

```typescript
// BEFORE: Observer pattern
const unsubMode = selectedTrackStore.subscribeToProperty(device.id, 'playback_mode', callback);

// AFTER: Cache pattern  
$effect(() => {
  if (device) {
    playbackMode = selectedTrackStore.getPropertyValue(device.id, 'playback_mode') ?? 0;
  }
});
```

### Critical Bug Fixes

#### 5. Parameter Configuration Correction
**Fixed critical parameter mapping**:

```javascript
// BEFORE (wrong):
"OriginalSimpler": [1,2,3,4,5,6,7,8]

// AFTER (correct):
"OriginalSimpler": [3,4,7,11,26,29,33,35]
```

**Impact:**
- Parameters now match actual UI usage
- SimplerLoopControl restored (parameters 3,4 for sample start/length)
- Eliminated unused parameters (1,2,5,6,8)

## Consequences

### Performance Benefits ✅

- **4 fewer observers** per Simpler device
- **Faster track switching** (no observer setup/teardown)
- **Lower memory usage** (no subscription management)
- **Consistent architecture** (unified cache pattern)

### Functionality Improvements ✅

- **Immediate UI feedback** (optimistic updates)
- **Correct parameter values** (fixed configuration mapping)
- **Complete control coverage** (all Simpler features work)
- **Reliable state sync** (complete truth from backend)

### Code Simplification ✅

- **Single pattern** for all device state (cache-based)
- **No subscription lifecycle** management needed
- **Simplified component code** (no observer cleanup)
- **Unified error handling** (all device data in one message)

## Trade-offs

### Hybrid Approach

**Property Reading:** Cache-based (performance)  
**Property Writing:** Existing liveObjectAPI system (reliability)

This hybrid maintains the working property setter infrastructure while gaining the performance benefits of cache-based reading.

## Testing

### Verified Functionality ✅

- **Warp Mode Buttons:** Immediate visual feedback (0=Beats, 4=Complex, 6=Pro)
- **Playback Mode Toggle:** Classic ↔ Slicing mode switching
- **Warping Toggle:** On/Off state with immediate UI update
- **Slicing Sensitivity:** Smooth slider interaction
- **Sample Loop Control:** Start/Length parameters restored (3,4)
- **Track Switching:** Properties load correctly from cache

### Performance Validation ✅

- **Observer Elimination:** 4 fewer `subscribeToProperty()` calls per device
- **Message Efficiency:** Properties included in complete state (no separate queries)
- **UI Responsiveness:** Optimistic updates provide instant feedback

## Implementation Notes

### Property Path Handling

Critical discovery: Sample properties require correct LiveAPI path resolution:
- `"sample.warp_mode"` → Query path: `"live_set tracks X devices Y sample"`, property: `"warp_mode"`
- `"playback_mode"` → Query path: `"live_set tracks X devices Y"`, property: `"playback_mode"`

### Optimistic Updates Pattern

Essential for cache-based systems with user interaction:
```typescript
function setValue(newValue) {
  localState = newValue;  // Immediate UI update
  sendToBackend(newValue); // Backend sync
  // Cache will be refreshed on next complete state
}
```

## Future Applications

This pattern can be extended to:
- **Reverb properties** (room_type, high_quality, chorus_enabled)
- **Sampler properties** (filter envelope, modulation settings)
- **Other device properties** requiring state optimization

## References

- **Implementation Log:** `documentation/current/simpler-property-migration-log.md`
- **Cycling74 Docs:** [Sample](https://docs.cycling74.com/apiref/lom/sample/), [SimplerDevice](https://docs.cycling74.com/apiref/lom/simplerdevice/)
- **Component:** `interface/src/lib/components/v6/central/views/SimplerCentralView.svelte`
- **Backend:** `ableton/scripts/liveAPI-v6.js` (`buildCompleteDeviceState`)
- **Config:** `data/device-configs.json` (OriginalSimpler)