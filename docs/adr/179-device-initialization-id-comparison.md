# ADR 179: Device Initialization ID Comparison Fix

**Date:** 2026-01-27
**Status:** Implemented
**Context:** Device Initialization System (ADR-052)

## Problem

When loading FX devices via the FX grid, the device initialization system was incorrectly re-initializing device 0 (typically Simpler), resetting user settings like Slice mode back to Classic mode.

### Root Cause

The original implementation checked `deviceCountBeforeLoad === 0` to determine if initialization should run. This broke in two ways:

1. **Permute auto-loads first**: When creating a new track, Permute (MIDI FX) auto-loads at device 0, so `deviceCountBeforeLoad` is always >= 1 when the user's instrument loads
2. **Always checked device 0**: The initialization always targeted device 0, regardless of which device was actually added

### Affected Scenarios

| Scenario | Expected | Actual (Bug) |
|----------|----------|--------------|
| Load Simpler on new track with Permute | Initialize Simpler | Never initialized (count > 0) |
| Load FX on track with Simpler in Slice mode | Don't touch Simpler | Reset to Classic mode |

## Decision

Use **device ID comparison** to detect which device was newly added, then only initialize that specific device if it matches the initialization config.

### Why Device IDs?

- We already track `currentDevices` array with device IDs for change detection
- Device IDs are unique and stable within a session
- Works regardless of device position (MIDI FX at 0, instrument at 1, audio FX at 2+)
- Handles Ableton's automatic device ordering

## Implementation

### Before Load Command

Capture existing device IDs into a lookup object:

```javascript
// Capture device IDs BEFORE loading to detect which device is new
var deviceIdsBefore = {};
for (var d = 0; d < currentDevices.length; d++) {
    deviceIdsBefore[currentDevices[d].id] = true;
}
log("Device IDs before load: " + Object.keys(deviceIdsBefore).length + " devices tracked");
```

### After Load (in checkTask)

Compare device IDs to find the newly added device:

```javascript
var checkTask = new Task(function() {
    var state = buildCompleteDeviceState(trackPath);

    if (state) {
        // Find the NEW device by comparing IDs
        for (var i = 0; i < state.devices.length; i++) {
            var device = state.devices[i];
            if (!deviceIdsBefore[device.id]) {
                // This is the newly added device
                log("New device detected: " + device.className + " (" + device.name + ")");

                // Check if it needs initialization
                var initConfig = getDeviceInitialization(device.className, device.name);
                if (initConfig && initConfig.actions) {
                    applyDeviceInitialization(trackPath, device.index, device.id, initConfig);
                }
                break; // Only one new device per load
            }
        }

        sendCompleteDeviceState(state);
        currentDevices = state.devices.slice();
    }
});
checkTask.schedule(500);
```

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Load Simpler on track with Permute | New device ID found → className is OriginalSimpler → initialize |
| Load FX on track with Simpler | New device ID found → className is e.g. Delay → no init config → skip |
| Load preset into existing device | No new device ID → skip initialization |
| Load audio file (creates Simpler) | New device ID found → className is OriginalSimpler → initialize |
| MIDI FX at device 0, instrument at device 1 | Finds new device by ID regardless of position |

## Benefits

- **Correct initialization**: Only initializes newly loaded devices
- **Preserves user settings**: Existing devices (Simpler in Slice mode) remain untouched
- **Position-agnostic**: Works regardless of device order in chain
- **Uses existing infrastructure**: Leverages `currentDevices` and `buildCompleteDeviceState()`

## Files Modified

- `ableton/scripts/liveAPI-v6.js` - Updated `loadDevice()` function

## Related

- ADR-052: Device Initialization in Max (original implementation)
- ADR-166: Sequencer Auto-Load Simplification (Permute auto-loading)
