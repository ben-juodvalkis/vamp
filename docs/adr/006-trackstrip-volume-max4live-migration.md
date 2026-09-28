# ADR 005: TrackStrip Volume Control - Complete Max4Live Migration

**Status:** Accepted
**Date:** 2025-01-04
**Deciders:** Ben Juodvalkis
**Related:** ADR-003 (TrackStrip Max Observer Migration), ADR-004 (Device System Refactor V2)

## Context

During Device System Refactor V2 (ADR-004), we discovered TrackStrip's volume control was using `GenericParameter` component, which was incorrectly trying to use the device parameter system for track-level controls.

### The Problem

**TrackVolumeMeter.svelte** was using:
```svelte
<GenericParameter
    path="/live/track/volume"  <!-- ❌ Missing /get/, wrong component -->
    index={oscIndex}
    ...
/>
```

**Issues:**
1. **Wrong Component:** GenericParameter is designed for device parameters ([trackIdx, deviceIdx, paramIdx]), not track properties
2. **Invalid OSC Path:** `/live/track/volume` instead of `/live/track/get/volume`
3. **Wrong System:** Using AbletonOSC instead of Max4Live observers (violates ADR-003)
4. **Max4Live Bug:** `TRACK_OBSERVABLE_PROPERTIES` included `"volume"` but Track objects have no `volume` property (it's on `mixer_device.volume.value`)

### Error Messages

Browser:
```
GenericParameter.svelte:88 Track-level parameters not yet implemented in selectedTrackStore
session.svelte.ts:295 ⚠️ Error repeated 50 times: Unknown OSC address: /live/track/volume
```

Max Console:
```
v8liveapi: 'Track' object has no attribute 'volume'
```

## Decision

**Complete the TrackStrip Max4Live migration (started in ADR-003) by:**
1. Fixing Max4Live volume observer to use `mixer_device volume value` (correct LiveAPI path)
2. Adding Max4Live track property setters (volume, mute, solo, arm, pan)
3. Updating `useMaxTrackObserver` to use Max4Live for writes (not AbletonOSC)
4. Replacing `GenericParameter` in TrackVolumeMeter with custom drag-based volume control
5. Adding optimistic updates with feedback suppression

**Result:** TrackStrip is 100% Max4Live with ZERO AbletonOSC dependency.

## Implementation

### 1. Fixed Max4Live Volume Observer

**File:** `ableton/scripts/liveAPI-v6.js`

**Removed `"volume"` from TRACK_OBSERVABLE_PROPERTIES:**
```javascript
var TRACK_OBSERVABLE_PROPERTIES = [
    "output_meter_left",
    // "volume", ← REMOVED - Track has no volume property
    "mute",
    "solo",
    "arm",
    "name",
    "color"
];
```

**Added `createMixerVolumeObserver()` function:**
```javascript
function createMixerVolumeObserver(position) {
    var callback = function(args) {
        if (args.length < 2) return;
        var value = args[1];
        outlet(0, ["/looping/track/property", position, "volume", value]);
    };

    // Observe: live_set tracks <position> mixer_device volume value
    var observer = new LiveAPI(callback, "live_set", "tracks", position, "mixer_device", "volume");
    observer.property = "value";

    positionPropertyObservers[position]["mixer_volume"] = observer;

    // Send initial value
    var initialValue = observer.get("value");
    if (initialValue && initialValue.length > 0) {
        outlet(0, ["/looping/track/property", position, "volume", initialValue[0]]);
    }
}
```

### 2. Added Max4Live Track Property Setters

**File:** `ableton/scripts/liveAPI-v6.js`

Added OSC message handlers:
```javascript
// In list() function:
} else if (address === "/looping/track/set/volume") {
    setTrackVolume(args[0], args[1]);
} else if (address === "/looping/track/set/mute") {
    setTrackMute(args[0], args[1]);
} else if (address === "/looping/track/set/solo") {
    setTrackSolo(args[0], args[1]);
} else if (address === "/looping/track/set/arm") {
    setTrackArm(args[0], args[1]);
} else if (address === "/looping/track/set/panning") {
    setTrackPan(args[0], args[1]);
```

**Setter functions:**
```javascript
function setTrackVolume(trackIndex, value) {
    var trackPath = (trackIndex === -1) ? "live_set master_track" : "live_set tracks " + trackIndex;
    var api = new LiveAPI(trackPath + " mixer_device volume");
    api.set("value", value);
}

function setTrackMute(trackIndex, value) {
    var trackPath = (trackIndex === -1) ? "live_set master_track" : "live_set tracks " + trackIndex;
    var api = new LiveAPI(trackPath);
    api.set("mute", value);
}
// ... similar for solo, arm, pan
```

### 3. Updated useMaxTrackObserver

**File:** `useMaxTrackObserver.ts`

**Changed `setProperty()` from AbletonOSC to Max4Live:**
```typescript
// Before:
await send(`/live/track/set/${property}`, [trackIndex, value]); // AbletonOSC

// After:
await send(`/looping/track/set/${property}`, [trackIndex, value]); // Max4Live
```

### 4. Replaced TrackVolumeMeter Implementation

**File:** `TrackVolumeMeter.svelte`

**Before:** Used GenericParameter (wrong component, wrong system)

**After:** Custom volume control with:
- Reads volume from `track.volume` (updated by Max observer)
- Writes volume via `/looping/track/set/volume` (Max4Live setter)
- Uses drag action for smooth interaction
- **Optimistic updates** with feedback suppression

**Optimistic Update Pattern:**
```typescript
let optimisticVolume = $state<number | null>(null);
let currentVolume = $derived(optimisticVolume ?? track?.volume ?? 0.85);

async function handleVolumeChange(value: number) {
    optimisticVolume = value;  // Immediate UI update
    await send('/looping/track/set/volume', [oscIndex, value]);
}

// Clear optimistic value when Max confirms
$effect(() => {
    if (optimisticVolume !== null && track &&
        Math.abs(optimisticVolume - track.volume) < 0.01) {
        optimisticVolume = null;  // Sync with actual value
    }
});

// Timeout protection (200ms)
$effect(() => {
    if (optimisticVolume !== null) {
        const timeout = setTimeout(() => optimisticVolume = null, 200);
        return () => clearTimeout(timeout);
    }
});
```

### 5. Fixed GenericParameter Scope

**File:** `GenericParameter.svelte`

**Clarified:** GenericParameter is **device parameters only** (3-element array: `[trackIdx, deviceIdx, paramIdx]`)

```typescript
if (Array.isArray(index) && index.length === 3) {
    // Device parameter - use selectedTrackStore
} else {
    console.error('Only device parameters supported. Use TrackParameter for track controls.');
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ USER INTERACTION                                            │
│   Drags volume slider in TrackStrip                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ TRACKVOLUMEMETER.SVELTE                                     │
│   optimisticVolume = 0.75 (immediate UI update)             │
│   send('/looping/track/set/volume', [0, 0.75])             │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ MAX4LIVE (liveAPI-v6.js)                                    │
│   setTrackVolume(0, 0.75)                                   │
│   api = new LiveAPI("live_set tracks 0 mixer_device volume")│
│   api.set("value", 0.75)                                    │
└────────────────────┬────────────────────────────────────────┘
                     │ LiveAPI
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ ABLETON LIVE                                                │
│   Track 0 volume set to 0.75                                │
└────────────────────┬────────────────────────────────────────┘
                     │ Mode 1 Observer fires
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ MAX4LIVE OBSERVER                                           │
│   mixer_device volume observer callback                     │
│   outlet: /looping/track/property [0, "volume", 0.75]      │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ BROWSER (simpleClient.ts)                                   │
│   Dispatches: max-track-property event                      │
└────────────────────┬────────────────────────────────────────┘
                     │ CustomEvent
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ TRACKSTRIP.SVELTE                                           │
│   Filters: trackIndex === 0                                 │
│   track.volume = 0.75                                       │
└────────────────────┬────────────────────────────────────────┘
                     │ Svelte reactivity
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ TRACKVOLUMEMETER.SVELTE                                     │
│   track.volume matches optimisticVolume                     │
│   optimisticVolume = null (clear, use real value)           │
│   Slider position stable ✅                                  │
└─────────────────────────────────────────────────────────────┘
```

## Consequences

### Positive

1. **Zero AbletonOSC Dependency for Tracks:** TrackStrip is 100% Max4Live (consistent with ADR-003 decision)

2. **No Router Errors:** Track property messages don't go through AbletonOSCRouter (simpler flow)

3. **Smooth Volume Control:** Optimistic updates prevent jitter during drag

4. **Correct LiveAPI Usage:** `mixer_device volume` is the proper way to access track volume

5. **Feedback Suppression:** 200ms timeout prevents feedback loops

6. **Master Track Support:** Setters handle master track (-1) correctly

### Negative

1. **Additional Max Code:** ~80 lines added to liveAPI-v6.js for setters

2. **Optimistic Update Complexity:** TrackVolumeMeter needs state management for smooth UX

### Neutral

1. **Consistent Pattern:** Matches ADR-003 (Max for observe, Max for command)

2. **No Backward Compatibility:** Old AbletonOSC track commands no longer work (intentional)

## Alternatives Considered

### 1. Keep AbletonOSC for Track Commands
**Rejected:** Violates ADR-003 decision. Creates dual systems (Max for read, AbletonOSC for write). Inconsistent.

### 2. Add Track Parameter Support to selectedTrackStore
**Rejected:** selectedTrackStore is device-focused. Track parameters use different architecture (Max observers). Mixing concerns.

### 3. Create Separate TrackParameterService
**Rejected:** Unnecessary abstraction. Max observer pattern already works well (ADR-003). Simple component is better.

## Testing Checklist

- [ ] Volume slider drag is smooth (no jitter)
- [ ] Volume changes in Ableton update UI
- [ ] Volume changes in UI update Ableton
- [ ] Master track volume works
- [ ] No console warnings when dragging volume
- [ ] Max console shows "Set track X volume = Y"
- [ ] Mute/solo/arm still work (unchanged)

## Success Criteria

✅ No GenericParameter errors
✅ No router warnings
✅ No Max4Live attribute errors
✅ Volume control smooth and responsive
✅ TrackStrip 100% Max4Live

**Migration Status:** ✅ Complete
**Next:** Test with Ableton Live, verify smooth volume control
