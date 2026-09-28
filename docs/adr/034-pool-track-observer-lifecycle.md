# ADR 016: Pool Track Observer Lifecycle Management

**Date:** 2025-01-08
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** Track Pool, Max4Live, Observers, Performance

---

## Context

With the introduction of the 16-track pool system (Phase 2), we have MIDI tracks that start empty (no instruments) and later have instruments loaded onto them. This creates a lifecycle problem with Max4Live observers.

### The Problem

**Empty MIDI tracks don't have certain properties until an instrument is loaded:**

1. **`output_meter_left`** - Doesn't exist on MIDI tracks without instruments
2. **Volume observer issues** - Observer returns object IDs instead of values in certain states

**Symptoms:**
- Error on startup: `v8liveapi: Tracks with MIDI output have no 'output_meter_left' property!`
- Volume slider maxed out in UI (receiving ID like `76614` instead of `0.55`)
- Observers fail to create on empty pool tracks

**Root Cause:**
The existing observer system assumed tracks always had instruments loaded. With the pool system, tracks transition from empty → with instrument → empty (after reset) → with instrument again.

---

## Decision

Implement **lazy observer creation** for pool tracks (0-15):

1. **On initialization:** Try to create observers, silently skip if properties don't exist
2. **After device load:** Create/recreate observers once instrument exists
3. **Filter invalid values:** Reject volume values >1.0 (likely IDs)

---

## Architecture

### Observer Lifecycle for Pool Tracks

```
Empty MIDI Track (no instrument)
  ↓
[Try create observers on init]
  ├─ mute, solo, arm → ✅ Success (always exist)
  └─ output_meter_left → ❌ Skip silently (doesn't exist yet)

[User loads instrument via /looping/devices/load]
  ↓
[Device loads, Task scheduled 500ms]
  ↓
[Create observers after device exists]
  ├─ output_meter_left → ✅ Success (now exists)
  ├─ mixer_volume → ✅ Success (recreated)
  └─ Send initial volume value

[Observers now active]
  └─ Volume changes → Filtered (ignore if >1.0) → Sent to client
```

### Three-Part Solution

**Part 1: Graceful Failure on Init**
```javascript
try {
    var observer = new LiveAPI(callback, "live_set", "tracks", position);
    observer.property = property;
    // ...
} catch (e) {
    // Silently skip meter on pool tracks without instruments
    if (property === "output_meter_left" && position >= 0 && position < 16) {
        return false; // Expected, will be created when instrument loads
    }
    log("Error creating observer: " + e);
    return false;
}
```

**Part 2: Observer Creation After Device Load**
```javascript
// In loadDevice() after successful device load:
if (selectedTrackIndex >= 0 && selectedTrackIndex < 16) {
    log("Creating meter and volume observers after instrument load");

    // Create meter observer (now property exists)
    createPositionPropertyObserver(selectedTrackIndex, "output_meter_left");

    // Recreate volume observer
    createMixerVolumeObserver(selectedTrackIndex);

    // Send initial volume value
    api.path = ["live_set", "tracks", selectedTrackIndex, "mixer_device", "volume"];
    var volumeValue = api.get("value");
    outlet(0, ["/looping/track/property", selectedTrackIndex, "volume", volumeValue[0]]);
}
```

**Part 3: Volume Value Validation**
```javascript
// In createMixerVolumeObserver() callback:
var value = args[1];

// Filter out invalid values (IDs instead of volume values)
if (value > 1.0) {
    log("INVALID volume value: " + value + " (ignoring, likely an ID)");
    return;
}

outlet(0, ["/looping/track/property", position, "volume", value]);
```

---

## Consequences

### Positive

1. **No Errors on Startup**
   - Empty pool tracks don't cause observer errors
   - Clean Max console output
   - Professional experience

2. **Meters Work When Needed**
   - Observers created exactly when they become available
   - Works for both fresh sets and existing sets with instruments
   - Proper lifecycle management

3. **Correct Volume Display**
   - Filters out invalid ID values
   - Only sends valid volume values (0.0-1.0)
   - UI slider shows correct position

4. **Handles Pool Lifecycle**
   - Empty → Instrument → Reset → Instrument again
   - Observers recreated as needed
   - No manual cleanup required

### Negative

1. **Duplicate Observer Creation**
   - Observers may be created twice (init + after device load)
   - Small overhead, but harmless (old observer replaced)

2. **Magic Number**
   - Hardcoded `> 1.0` check for filtering
   - Could theoretically filter valid values if Ableton changes behavior
   - Unlikely but worth noting

3. **Pool Track Range Hardcoded**
   - Checks `position >= 0 && position < 16`
   - If pool size changes, needs code update
   - Acceptable tradeoff for Phase 2

---

## Implementation Details

### Files Modified

**`ableton/scripts/liveAPI-v6.js`:**

1. **createPositionPropertyObserver()** (line ~279-283)
   - Added conditional in catch block
   - Silently skip `output_meter_left` on pool tracks

2. **createMixerVolumeObserver()** (line ~306-311)
   - Added validation filter: `if (value > 1.0) return;`
   - Prevents invalid IDs from being sent

3. **loadDevice()** (line ~1076-1096)
   - Create meter observer after device loads
   - Create/recreate volume observer
   - Query and send initial volume value

### Testing

**Test Case 1: Fresh Set (Empty MIDI Tracks)**
- ✅ No errors on startup
- ✅ Meters appear after loading instrument
- ✅ Volume shows correct value

**Test Case 2: Existing Set (Tracks with Instruments)**
- ✅ Meters work immediately
- ✅ Volume shows correct value
- ✅ No errors

**Test Case 3: Load Instrument on Empty Track**
- ✅ No error before instrument loads
- ✅ Meter observer created after load
- ✅ Volume syncs correctly

---

## Alternatives Considered

### 1. Query has_audio_output Before Creating Observer

```javascript
var trackApi = new LiveAPI("live_set tracks " + position);
var hasAudioOutput = trackApi.get("has_audio_output");
if (hasAudioOutput[0] === 1) {
    createMeterObserver();
}
```

**Rejected:**
- Adds extra query overhead
- Try/catch is simpler and more efficient
- Works for both cases (empty and with instruments)

### 2. Skip All Pool Track Observers on Init

```javascript
if (position >= 0 && position < 16) {
    return; // Skip all observers for pool tracks
}
```

**Rejected:**
- Loses observers for existing sets with instruments
- Requires full observer recreation
- Loses mute, name, etc. observers that DO work

### 3. Don't Filter Invalid Values, Fix Root Cause

**Rejected:**
- Root cause unclear (LiveAPI sometimes returns IDs)
- Filtering is defensive and safe
- Works immediately without deep debugging

---

## Performance Impact

**Observer Creation Overhead:**
- Minimal: <10ms per observer
- Only happens on device load (rare)
- Worth it for correct behavior

**Volume Validation:**
- Negligible: Simple comparison (`> 1.0`)
- Runs on every volume change (~60 FPS)
- No measurable performance impact

---

## Future Considerations

### If Pool Size Becomes Configurable

Update hardcoded range checks:
```javascript
// Replace: position >= 0 && position < 16
// With: position >= POOL_START && position < POOL_START + POOL_SIZE
```

### If Volume ID Issue Persists

Investigate why LiveAPI sometimes returns IDs instead of values:
- Timing issue?
- Observer state issue?
- Max version specific?

For now, filtering works fine.

### If More Properties Need Lazy Creation

Create a list of "lazy properties" that only exist with instruments:
```javascript
var LAZY_PROPERTIES = ["output_meter_left", "output_meter_right"];
```

---

## Related Documents

- **Phase 2 ADR:** `024-track-pool-system.md` (superseded by ADR-031)
- **Current Pool Architecture:** `031-track-pool-m4l-single-source-of-truth.md`
- **Implementation Log:** `phase-2-implementation-log.md`
- **Max4Live Integration:** `documentation/v6-hybrid-integrations.md`

**Note:** This ADR remains valid for observer lifecycle management, which is still part of the current pool system (ADR-031).

---

## Lessons Learned

1. **Property Availability is Context-Dependent**
   - MIDI tracks have different properties than tracks with instruments
   - Can't assume all track properties always exist
   - Need graceful degradation for missing properties

2. **Observer Lifecycle Matters**
   - Creating observers too early causes errors
   - Creating too late misses state changes
   - Lazy creation is the sweet spot

3. **Defensive Programming is Essential**
   - Filter invalid values at source
   - Don't assume API returns will always be correct
   - Simple validation prevents UI bugs

4. **Try/Catch for Observer Creation**
   - Property existence isn't guaranteed
   - Silent failure is sometimes appropriate
   - Log only unexpected errors

---

**Status:** Implemented and working
**Impact:** Clean observer lifecycle for pool tracks

---

**Last Updated:** 2025-01-08
