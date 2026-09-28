# ADR 043: Device Initialization in Max

**Date:** 2025-10-12
**Status:** Implemented
**Context:** Complete State Architecture (ADR-040, ADR-041, ADR-042)

## Problem

Device initialization (setting default parameters and properties for Omnisphere and Simpler) was originally handled in the frontend via `selectedTrackStore.checkDeviceInitialization()`. This created several issues:

1. **Observer Context Errors**: When called from `buildCompleteDeviceState()` (observer callback), Max throws "Changes cannot be triggered by notifications" errors
2. **Inconsistent Application**: Only ran on device **add** events, not track switches to existing devices
3. **Network Overhead**: Frontend → Bridge → Max round-trips for each initialization action
4. **Architecture Mismatch**: Frontend shouldn't handle device setup - Max is the source of truth
5. **Property Access Issues**: Complex LiveAPI property paths (e.g., `sample.warping`) require special handling

## Decision

Move device initialization to **Max**, applying defaults when devices are loaded via explicit commands (`/looping/devices/load` and `/cmd/sample_clip_to_simpler`), not from observer callbacks.

## Architecture

### Unified Configuration Source

Single source of truth in `data/device-configs.json`:

```json
{
  "OriginalSimpler": {
    "parameters": { ... },
    "initialization": {
      "trigger": "device_loaded",
      "delay": 500,
      "description": "Enable Loop, Gate mode, disable Retrigger and Warping...",
      "actions": [
        { "type": "set_parameter", "index": 5, "value": 1.0, "description": "Enable Loop mode" },
        { "type": "set_property", "path": "playback_mode", "value": 0, "description": "Classic mode" },
        { "type": "set_property", "path": "sample.warping", "value": 0, "description": "Disable warping" }
      ]
    }
  }
}
```

### Generation Script

Enhanced `scripts/generate-max-device-config.ts` generates **two** outputs from one source:

1. **`device-configs.js`** - Parameter indices (for complete state queries)
2. **`device-initialization.js`** - Initialization rules (for device setup)

```javascript
// device-initialization.js (generated)
var DEVICE_INITIALIZATIONS = {
  "OriginalSimpler": {
    "description": "Enable Loop, Gate mode...",
    "actions": [...]
  },
  "AuPluginDevice:Omnisphere": {
    "description": "Set Macro 3-6 to 1.0...",
    "actions": [...]
  }
};

function getDeviceInitialization(className, deviceName) {
  // Try className:deviceName, fallback to className
  var key = className + ":" + deviceName;
  return DEVICE_INITIALIZATIONS[key] || DEVICE_INITIALIZATIONS[className] || null;
}
```

### Max Implementation

**Load includes:**
```javascript
include("device-configs.js");
include("device-initialization.js");
```

**Apply initialization after device loads:**

1. **Omnisphere** (via `/looping/devices/load`):
```javascript
function loadDevice(presetPath) {
    outlet(1, "/looping/devices/addfile", presetPath);

    var checkTask = new Task(function() {
        // Check device 0 for initialization config
        var initConfig = getDeviceInitialization(deviceClass, deviceName);
        if (initConfig) {
            applyDeviceInitialization(trackPath, 0, deviceId, initConfig);
        }
    });
    checkTask.schedule(500); // Wait for device to load
}
```

2. **Simpler** (via `/cmd/sample_clip_to_simpler`):
```javascript
function handleSampleClipToSimpler(targetTrack) {
    outlet(1, "/looping/devices/addfile", filePathStr);

    var simplerInitTask = new Task(function() {
        // Check device 0 for Simpler, apply initialization
        if (deviceClass === "OriginalSimpler") {
            var initConfig = getDeviceInitialization("OriginalSimpler", deviceName);
            if (initConfig) {
                applyDeviceInitialization(trackPath, 0, deviceId, initConfig);
            }
        }
    });
    simplerInitTask.schedule(800); // Wait longer for sample to load
}
```

**Initialization function handles nested properties:**
```javascript
function applyDeviceInitialization(trackPath, deviceIndex, deviceId, config) {
    for (var a = 0; a < config.actions.length; a++) {
        var action = config.actions[a];

        if (action.type === "set_parameter") {
            api.path = "live_set " + trackPath + " devices " + deviceIndex + " parameters " + action.index;
            api.set("value", action.value);
        }
        else if (action.type === "set_property") {
            // Split path for nested properties (e.g., "sample.warping")
            var pathParts = action.path.split(".");
            if (pathParts.length > 1) {
                // Navigate to child object first
                api.path = devicePath + " " + pathParts.slice(0, -1).join(" ");
            } else {
                api.path = devicePath;
            }
            api.set(pathParts[pathParts.length - 1], action.value);
        }
    }
}
```

### Frontend Cleanup

Removed `checkDeviceInitialization()` from `selectedTrackStore.svelte.ts` (~30 lines). Frontend no longer handles initialization.

## Key Insights

### Why Observer Context Failed

Max's LiveAPI cannot make changes from within observer callbacks. The error "Changes cannot be triggered by notifications" occurs when trying to set parameters from `devicesChanged()` callback. Solution: Apply initialization via Task scheduled from explicit commands, not observers.

### Property Path Navigation

LiveAPI requires splitting nested property paths:
- `"sample.warping"` → navigate to `devices 0 sample`, set `warping`
- `"playback_mode"` → set directly on `devices 0`

This matches the pattern used in `handleLiveAPISetProperty()`.

### Timing Considerations

- **Omnisphere**: 500ms delay (enough for preset to load)
- **Simpler**: 800ms delay (sample loading takes longer)

Both use Task scheduling to ensure device is fully loaded before initialization.

## Benefits

✅ **No Observer Context Issues**: Runs from explicit commands, not callbacks
✅ **Consistent Defaults**: Works on device load AND track switches (via complete state rebuild)
✅ **Zero Network Overhead**: All happens in Max before querying
✅ **Correct Architecture**: Max owns device initialization
✅ **Simpler Frontend**: ~30 lines removed, no initialization logic
✅ **Unified Config**: Single source of truth in `device-configs.json`
✅ **Proper Property Handling**: Correctly navigates nested LiveAPI objects

## Currently Configured

**Omnisphere**: Set Macros 3-6 to 1.0 (4 parameter actions)
**Simpler**: Enable Loop, Gate mode, Classic playback, disable Retrigger/Warping, Thru slicing (6 actions: 2 parameters + 4 properties)

## Trade-offs

### What We Lost
- Frontend control over initialization timing
  - **Acceptable**: Max timing is more reliable

### What We Gained
- Bulletproof initialization (no observer errors)
- Consistent behavior across all device load scenarios
- Proper LiveAPI property handling
- ~30 lines less frontend code

## Related

- ADR-040: Complete State Architecture (parent)
- ADR-041: Component State Management Pattern
- ADR-042: Device Configuration Completeness
- Config: `data/device-configs.json`
- Generated: `ableton/scripts/device-initialization.js`
- Script: `scripts/generate-max-device-config.ts`
