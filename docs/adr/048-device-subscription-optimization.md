# ADR 039: Device Subscription Optimization

**Status:** Accepted
**Date:** 2025-10-11
**Deciders:** System Architecture Team
**Tags:** performance, frontend, max4live, optimization

## Context

When devices were added, deleted, or reordered on a track, the frontend was sending 80+ redundant OSC messages (`stop_listen/parameter` + `start_listen/parameter`) to recreate subscriptions, even though the subscriptions were already ID-based and stable. This caused:

1. **Performance lag** in Ableton when client was connected
2. **Message spam** in Max console (same subscriptions recreated 3-4x)
3. **Unnecessary OSC traffic** blocking Max device processing

### Root Cause Analysis

Through systematic testing with debug controls, we discovered:

**Frontend Issue (Fixable):**
- `handleDeviceList()` called `updateDeviceIndices()` on EVERY device list change
- `updateDeviceIndices()` recreated subscriptions for devices with shifted indices
- Subscriptions were already ID-based (`${deviceId}-${paramIndex}`), so recreation was unnecessary

**Max/LiveAPI Issue (Unfixable):**
- Testing revealed lag persists even with ALL observers disabled and NO client connected
- The **Max device's presence itself** interferes with Ableton's device chain updates
- Suggests LiveAPI overhead or Max scheduler interference with Ableton's audio thread
- Cannot be fixed without removing the Max device entirely

## Decision

### 1. Frontend Optimization ✅ Implemented

**Remove unconditional `updateDeviceIndices()` call**

File: `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts:534`

**Before:**
```typescript
handleDeviceList(trackIndex: number, devices: Device[]) {
    this._trackIndex = trackIndex;
    this._devices = devices;

    // Sends 80+ OSC messages on every device change
    this.parameters.updateDeviceIndices(devices);
}
```

**After:**
```typescript
handleDeviceList(trackIndex: number, devices: Device[]) {
    this._trackIndex = trackIndex;
    this._devices = devices;

    // OPTIMIZATION: Don't call updateDeviceIndices() on every device list change!
    // Subscriptions are ID-based (stable), so they don't need updating when devices reorder.
    // Device removal is handled by handleDeviceRemoved() → cleanupDevice()
    // Track changes are handled above → cleanupForTrackChange()
    // this.parameters.updateDeviceIndices(devices);
}
```

**Rationale:**
- Subscriptions use device IDs (stable) not indices (mutable)
- Device removal: Already handled by `handleDeviceRemoved()` → `cleanupDevice()`
- Device reorder: No action needed (IDs unchanged, subscriptions still valid!)
- Track change: Already handled by `cleanupForTrackChange()`

### 2. Max Debounce Removal ✅ Implemented

**Remove 150ms artificial delay from device change processing**

File: `ableton/scripts/liveAPI-v6.js:971-978`

**Before:**
```javascript
function devicesChanged(args) {
    // ... setup code ...
    deviceChangeTimer.schedule(150);  // 150ms artificial delay
}
```

**After:**
```javascript
function devicesChanged(args) {
    // Call checkDevices immediately (no debounce)
    if (selectedTrackIndex === -1) {
        checkDevices("master_track");
    } else if (selectedTrackIndex >= 0) {
        checkDevices("tracks " + selectedTrackIndex);
    }
}
```

**Rationale:**
- Removes 150ms artificial delay
- Device updates now instant (19 queries still run fast)
- No benefit to debouncing when queries are quick

### 3. Max Observer Optimization ❌ Abandoned

**Attempted to use observer callback data to eliminate LiveAPI queries**

**What Was Tried:**
- Observer provides device IDs in callback: `["devices", "id", ID1, "id", ID2, ...]`
- Attempted to use IDs directly instead of querying LiveAPI

**Why It Failed:**
1. Observer data is **STALE** - includes IDs being deleted before Ableton removes them
2. Querying stale IDs causes LiveAPI errors: "invalid path", "no valid object"
3. Multiple observer firings with garbage/incomplete data
4. Device list corrupted (showed "Device 0 Unknown")
5. **Lag persisted** even with 0 queries

**Critical Finding:**
Testing with debug controls (ability to disable device discovery, position observers, observer recreation) revealed:
- Lag occurs even with **ALL observers disabled**
- Lag occurs even with **NO client connected**
- Deleting the Max device makes Ableton **snappy again**

**Conclusion:**
The lag is caused by **the Max device's LiveAPI connection itself**, not the observer logic or query count. This is a fundamental limitation of the Max4Live architecture.

## Consequences

### Positive

1. **100% reduction in subscription message spam**
   - Device delete: 80+ messages → 0 messages
   - Device reorder: 80+ messages → 0 messages
   - Client no longer adds lag to device operations

2. **Removed artificial delay**
   - 150ms debounce → 0ms (immediate response)

3. **Cleaner codebase**
   - Removed unnecessary subscription recreation logic
   - Simplified device change handling

### Negative

1. **Max device lag cannot be fixed**
   - LiveAPI/Max device interference with Ableton is fundamental
   - Only solution would be to remove Max device entirely
   - Would require migrating ALL functionality to AbletonOSC (Python)

2. **Observer data cannot be trusted**
   - Cannot optimize query count using observer callback data
   - Stuck with 19 queries per device change (though fast)

### Neutral

1. **Acceptable performance with improvements**
   - Max device lag reduced (no 150ms delay)
   - Client no longer amplifies the lag (no subscription spam)
   - Underlying LiveAPI lag may be acceptable for live performance

## Implementation Notes

### What Was Kept
- Frontend subscription optimization (safe, measurable improvement)
- Debounce removal (safe, removes artificial delay)
- ID-based subscription architecture (already in place, just removed recreation)

### What Was Removed
- Debug control flags (`DEVICE_DISCOVERY_ENABLED`, etc.)
- Debug OSC handlers (`/looping/debug/device_discovery`, etc.)
- Debug status reporting function
- Observer-based optimization attempt (failed, reverted)

### Performance Measurements

**Before:**
- Frontend: 80+ subscription messages on device change
- Max: 150ms debounce delay + 19 queries
- Client connection: Amplified lag significantly

**After:**
- Frontend: 0 subscription messages on device change
- Max: 0ms delay + 19 queries (instant)
- Client connection: No additional lag

**Baseline Lag (Cannot Fix):**
- Max device present: Some lag during device operations
- Max device absent: Snappy (but no device tracking)

## Related Documentation

- [Implementation Log](../current-project/id-based-devices/IMPLEMENTATION-LOG.md)
- [Current Architecture Analysis](../current-project/id-based-devices/01-current-architecture.md)
- [Proposed Architecture](../current-project/id-based-devices/02-proposed-architecture.md)

## Future Considerations

If Max device lag becomes unacceptable:

1. **Option A: Accept the limitation**
   - Current improvements make it tolerable
   - Focus on other optimizations

2. **Option B: Migrate to pure AbletonOSC**
   - Remove Max device entirely
   - Implement ALL device tracking in Python
   - Would eliminate LiveAPI overhead but require significant refactoring

3. **Option C: Hybrid approach**
   - Use AbletonOSC for device tracking (Python)
   - Keep Max only for LiveAPI property access (Simpler, Sampler, etc.)
   - Reduce Max device's scope to minimize interference
