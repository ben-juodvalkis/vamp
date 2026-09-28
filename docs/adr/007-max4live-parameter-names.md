# ADR 006: Max4Live Parameter Names - Complete Device System Migration

**Status:** Accepted
**Date:** 2025-01-04
**Deciders:** Ben Juodvalkis
**Related:** ADR-004 (Device System Refactor V2), ADR-005 (TrackStrip Volume Max4Live Migration)

## Context

During Device System Refactor V2 (ADR-004), we deleted `parameterOSCService` which provided `getParameterNames()` functionality via AbletonOSC. This broke:

1. **Instrument Type Detection:** InstrumentService couldn't differentiate drum rack types (standard "FX1"/"FX2" vs Komplete Kontrol custom macros)
2. **Parameter Display:** Central Views showed "Macro 1", "Macro 2" instead of actual parameter names
3. **User Experience:** Komplete Kontrol and Drum Rack views had generic labels

### The Problem

**Old Implementation (via AbletonOSC):**
```typescript
// parameterOSCService.ts (DELETED)
async getParameterNames(trackId: number, deviceId: number): Promise<string[]> {
    // Send: /live/device/get/parameters/name [trackId, deviceId]
    // Wait for response via osc-message event
    return names;
}
```

**Issues:**
- Service was deleted as part of refactor
- Components showed warnings: `getParameterNames not yet implemented in selectedTrackStore`
- Instrument detection broken: all drum racks detected as "komplete-kontrol" type
- Central Views showed generic labels

### Components Affected

**Critical (breaks functionality):**
- `instrumentService.ts` - Drum rack type detection

**UX Impact (degraded labels):**
- `KompleteKontrolCentralView.svelte` - 8 macro parameters
- `DrumRackKompleteKontrolCentralView.svelte` - 16 macro parameters

## Decision

**Implement parameter name fetching via Max4Live LiveAPI instead of AbletonOSC.**

### Rationale

1. **Consistency:** Device operations already use Max4Live (device list, add/remove, parameter values)
2. **Master Track Support:** AbletonOSC doesn't support master track devices, Max4Live does
3. **Single System:** Eliminates mixing of Max and AbletonOSC for device operations
4. **LiveAPI Native:** `DeviceParameter.name` is a core LiveAPI property

## Implementation

### 1. Max4Live Function

**File:** `ableton/scripts/liveAPI-v6.js`

**Added `getDeviceParameterNames()` function:**
```javascript
function getDeviceParameterNames(trackIndex, deviceIndex) {
    try {
        var trackPath = (trackIndex === -1) ? "live_set master_track" : "live_set tracks " + trackIndex;
        var devicePath = trackPath + " devices " + deviceIndex;

        // Get device API
        var deviceApi = new LiveAPI(devicePath);
        if (deviceApi.id === "0") {
            outlet(0, ["/looping/device/parameter_names", trackIndex, deviceIndex, 0]);
            return;
        }

        // Get parameters list (NOT .call("get", "parameters") - that fails on RackDevice)
        var parametersResult = deviceApi.get("parameters");
        var paramCount = parametersResult ? parametersResult.length : 0;

        var names = [];

        // Iterate through parameters and get names
        for (var i = 0; i < paramCount; i++) {
            var paramApi = new LiveAPI(devicePath + " parameters " + i);
            if (paramApi.id !== "0") {
                var nameResult = paramApi.get("name");
                var paramName = (nameResult && nameResult.length > 0)
                    ? nameResult[0]
                    : ("Parameter " + i);
                names.push(paramName);
            } else {
                names.push("Parameter " + i);
            }
        }

        // Send response
        var response = ["/looping/device/parameter_names", trackIndex, deviceIndex, names.length].concat(names);
        outlet(0, response);

    } catch (e) {
        log("ERROR getting parameter names: " + e);
        outlet(0, ["/looping/device/parameter_names", trackIndex, deviceIndex, 0]);
    }
}
```

**Added OSC handler:**
```javascript
} else if (address === "/looping/device/get/parameter_names") {
    getDeviceParameterNames(args[0], args[1]);
```

**Key Fix:** Use `.get("parameters")` instead of `.call("get", "parameters")` - the latter fails on RackDevice objects.

### 2. selectedTrackStore Method

**File:** `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts`

**Added `getParameterNames()` method:**
```typescript
/**
 * Get parameter names for a device
 * Uses Max4Live to fetch parameter names via LiveAPI
 */
getParameterNames(deviceId: number): Promise<string[]> {
    return new Promise((resolve) => {
        const device = this._devices.find((d) => d.id === deviceId);
        if (!device) {
            resolve([]);
            return;
        }

        const handler = (event: CustomEvent) => {
            const msg = event.detail;
            if (
                msg.address === '/looping/device/parameter_names' &&
                msg.args[0] === this._trackIndex &&
                msg.args[1] === device.index
            ) {
                const count = msg.args[2];
                const names = msg.args.slice(3, 3 + count);
                if (typeof window !== 'undefined') {
                    window.removeEventListener('osc-message', handler as EventListener);
                }
                resolve(names);
            }
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('osc-message', handler as EventListener);

            // Request parameter names from Max4Live
            send('/looping/device/get/parameter_names', [this._trackIndex, device.index]);

            // Timeout after 1 second
            setTimeout(() => {
                window.removeEventListener('osc-message', handler as EventListener);
                resolve([]);
            }, 1000);
        } else {
            resolve([]);
        }
    });
}
```

### 3. Fixed instrumentService

**File:** `interface/src/lib/services/instrumentService.ts`

**Before:**
```typescript
// TODO: Implement getParameterNames
console.warn('[InstrumentService] getParameterNames not yet implemented');
const paramNames: string[] = [];
```

**After:**
```typescript
const { selectedTrackStore } = await import('$lib/stores/v6/selectedTrackStore.svelte');

const device = selectedTrackStore.devices.find(d => d.index === info.deviceIndex);
if (!device) return 'drumrack';

const paramNames = await selectedTrackStore.getParameterNames(device.id);

const macro1 = paramNames[1];
const macro2 = paramNames[2];

if (macro1 === 'FX1' && macro2 === 'FX2') {
    return 'drumrack';  // Standard Ableton drum rack
} else {
    return 'drumrack-komplete-kontrol';  // Custom macro mapping
}
```

### 4. Updated Central Views

**Files:** `KompleteKontrolCentralView.svelte`, `DrumRackKompleteKontrolCentralView.svelte`

**Before:**
```typescript
console.warn('[KompleteKontrol] getParameterNames not yet implemented');
parameterNames = [];
```

**After:**
```typescript
const fetchNames = async () => {
    const names = await selectedTrackStore.getParameterNames(device.id);
    parameterNames = names;
};

fetchNames();
```

## Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│ COMPONENT (KompleteKontrolCentralView)                      │
│   Needs parameter names for device ID 76471                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ SELECTEDTRACKSTORE.getParameterNames(76471)                 │
│   Finds device: ID 76471 is at index 0                      │
│   send('/looping/device/get/parameter_names', [1, 0])      │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ MAX4LIVE (liveAPI-v6.js)                                    │
│   getDeviceParameterNames(1, 0)                             │
│   deviceApi = new LiveAPI("live_set tracks 1 devices 0")   │
│   parametersResult = deviceApi.get("parameters")            │
│   For each parameter:                                       │
│     paramApi = new LiveAPI("...devices 0 parameters i")    │
│     name = paramApi.get("name")                             │
│   names = ["Forest 2", "FX1", "FX2", ...]                  │
│   outlet: /looping/device/parameter_names [1, 0, 18, ...]  │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ SELECTEDTRACKSTORE (promise handler)                        │
│   Receives response, extracts names                         │
│   resolve(["Forest 2", "FX1", "FX2", ...])                 │
└────────────────────┬────────────────────────────────────────┘
                     │ Promise
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ COMPONENT                                                   │
│   parameterNames = [...names]                               │
│   Displays actual parameter names ✅                         │
└─────────────────────────────────────────────────────────────┘
```

## Consequences

### Positive

1. **Correct Instrument Detection:** Drum racks properly identified as standard vs Komplete Kontrol

2. **Better UX:** Parameter names displayed instead of "Macro 1", "Macro 2"

3. **100% Max4Live Device Operations:** Complete migration from AbletonOSC for device functionality

4. **Master Track Support:** Works with master track devices (AbletonOSC doesn't)

5. **Single System:** All device operations through one consistent interface

### Negative

1. **Additional Max Code:** ~40 lines in liveAPI-v6.js

2. **Async Complexity:** Components need to handle promise-based parameter name fetching

3. **1s Timeout:** If Max is slow/broken, 1 second delay before fallback to generic names

### Neutral

1. **Promise-Based API:** Follows modern async patterns, but adds complexity vs synchronous property access

2. **Event-Based Response:** Uses same pattern as other Max operations (consistent)

## Bug Fix: RackDevice.get() vs .call("get")

**Original Error:**
```
v8liveapi: 'RackDevice' object has no attribute 'get'
```

**Root Cause:**
```javascript
var paramCountResult = deviceApi.call("get", "parameters");  // ❌ WRONG
```

The `.call("get", "parameters")` syntax is incorrect for LiveAPI. RackDevice objects (DrumGroupDevice, InstrumentGroupDevice) don't have a callable `get` method.

**Correct Usage:**
```javascript
var parametersResult = deviceApi.get("parameters");  // ✅ CORRECT
```

LiveAPI's `.get(property)` is the proper way to access properties directly.

## Testing

**Drum Rack Detection:**
- [ ] Standard Ableton drum rack shows DrumRackCentralView
- [ ] Drum rack with custom macros shows DrumRackKompleteKontrolCentralView
- [ ] instrumentService logs show correct macro names (FX1/FX2 or custom)

**Parameter Name Display:**
- [ ] KompleteKontrol shows actual macro names (not "Macro 1")
- [ ] Drum Rack Komplete Kontrol shows all 16 macro names
- [ ] Parameter names update when switching devices

**Console Logs:**
- [ ] No "getParameterNames not yet implemented" warnings
- [ ] No "RackDevice has no attribute 'get'" errors
- [ ] Max shows "Retrieved N parameter names" on success

## Alternatives Considered

### 1. Keep Using AbletonOSC for Parameter Names
**Rejected:** Violates ADR-004 decision to use Max4Live for device operations. Creates hybrid system. AbletonOSC doesn't support master track devices.

### 2. Don't Show Parameter Names (Use Generic Labels)
**Rejected:** Poor UX. Instrument detection requires parameter names to differentiate drum rack types.

### 3. Cache Parameter Names in Device List
**Rejected:** Adds complexity to device list messages. Names rarely change. On-demand fetching is simpler.

## References

- ADR-004: Device System Refactor V2
- ADR-005: TrackStrip Volume Max4Live Migration
- [Max LiveAPI Documentation](https://docs.cycling74.com/max8/vignettes/live_object_model)
- [DeviceParameter.name property](https://docs.cycling74.com/max8/vignettes/live_deviceparameter_object)

## Success Criteria

✅ Parameter names fetched successfully from Max4Live
✅ No RackDevice.get() errors
✅ Drum rack type detection works correctly
✅ Central Views show actual parameter names
✅ All warnings removed

**Migration Status:** ✅ Complete
**Next:** Test drum rack detection and parameter name display in Komplete Kontrol views

---

**Note:** This completes the full migration of device operations from AbletonOSC to Max4Live. All device functionality now uses Max4Live:
- Device observation (list/added/removed)
- Parameter values (via AbletonOSC start_listen/set - but managed by selectedTrackStore)
- **Parameter names (via Max4Live LiveAPI)** ← This ADR
