# ADR 115: Delayed Track Arm to Fix Input Routing Race Condition

**Status**: Accepted
**Date**: 2025-01-13
**Authors**: Claude
**Tags**: `pedalboard`, `track-creation`, `race-condition`, `audio-routing`, `max4live`

## Context

When creating new audio tracks via pedalboard long-hold gestures (Guitar/Bass/Vocal pedals), tracks were sometimes failing to arm for recording. This was caused by a race condition where the track arm command was executed before the input routing configuration had been applied by AbletonOSC.

### Pedalboard Hold Behavior

The pedalboard system uses tap/hold detection (500ms threshold) to differentiate between device loading and track creation:

- **Pedal 1 (Guitar)**:
  - TAP: Load Guitar Rig 7 MFX device
  - HOLD: Create "Guitar" track with input routing channel 3
- **Pedal 2 (Vocal)**:
  - TAP: Load Vocal.adg device
  - HOLD: Create "Mic" track with input routing channel 1
- **Pedal 3 (Bass)**:
  - TAP: Load Helix Native device
  - HOLD: Create "Bass" track with input routing channel 3

### The Race Condition

In `createAudioTrack()` ([liveAPI-v6.js:3386-3460](../../ableton/scripts/liveAPI-v6.js#L3386-L3460)), the sequence was:

1. Create audio track via Max4Live LiveAPI
2. Send input routing configuration to AbletonOSC (outlet 3 → port 11000)
3. Send track name to AbletonOSC
4. Load device (if applicable)
5. ❌ **No arm command was sent**

**Problem**: Users expected newly created audio tracks to be automatically armed for recording, but:
- Ableton's auto-arm behavior is controlled by user preferences ("Exclusive Arm" setting)
- Even if auto-arm was enabled, it could fail if the input routing wasn't valid yet
- There was no explicit arm command in the code

### Why Auto-Arm Failed

When a track is created with invalid or unset input routing:
1. Track is created successfully
2. Track attempts to arm (via Ableton preference or explicit command)
3. **Arm fails silently** because routing is invalid
4. AbletonOSC applies routing configuration (~50-100ms later)
5. Track now has valid routing, but arm state was already rejected

## Decision

Add an explicit delayed arm command after setting the input routing configuration, ensuring the routing is applied before attempting to arm the track.

### Implementation

In `createAudioTrack()` ([liveAPI-v6.js:3430-3437](../../ableton/scripts/liveAPI-v6.js#L3430-L3437)), after setting routing and name:

```javascript
// Arm the track after a delay to ensure routing is applied first
// This prevents race condition where arm fails due to invalid routing
var armTrackIndex = trackIndex;  // Capture in closure
var armTask = new Task(function() {
    outlet(3, ["/live/track/set/arm", armTrackIndex, 1]);
    log('[M4L] Pedalboard: Armed track ' + armTrackIndex + ' after routing setup');
}, this);
armTask.schedule(100);  // 100ms delay
```

### Why 100ms Delay?

- **Too short (0-50ms)**: OSC messages may not have been processed by AbletonOSC yet
- **100ms**: Safe buffer for OSC message transmission and processing
- **Too long (500ms+)**: Noticeable delay in user experience

### Alternative Approaches Considered

1. **No delay, immediate arm**: ❌ Fails due to race condition
2. **Wait for routing confirmation**: ❌ AbletonOSC doesn't send confirmation responses for setters
3. **Use LiveAPI to set routing**: ❌ Input routing requires AbletonOSC; not available in LiveAPI easily
4. **Retry mechanism**: ⚠️ More complex; overkill for predictable timing issue
5. **Longer delay (200-500ms)**: ⚠️ Works but creates noticeable UX lag

## Consequences

### Positive

- ✅ **Tracks reliably arm** after creation via pedalboard hold gestures
- ✅ **Minimal delay** (100ms is barely perceptible to users)
- ✅ **Simple implementation** using existing Task timer system
- ✅ **Consistent with existing patterns** (same Task approach used for hold detection)
- ✅ **Uses correct API pathway** (AbletonOSC via outlet 3 → port 11000)

### Negative

- ⚠️ **Timing-based solution**: Assumes 100ms is sufficient for all systems
- ⚠️ **No feedback mechanism**: Can't detect if arm actually succeeded
- ⚠️ **Potential edge case**: If AbletonOSC is heavily loaded, 100ms might not be enough

### Risk Mitigation

- The 100ms delay is conservative; most OSC messages process in <10ms
- If arm still fails occasionally, increase to 150-200ms
- Future enhancement: Add listener for arm state change to verify success

## Related

- **ADR-025**: Tap/hold gesture mode (500ms threshold)
- **ADR-076**: Track creation migration to Max4Live
- **Track Creation Flow**: [liveAPI-v6.js:3386-3460](../../ableton/scripts/liveAPI-v6.js#L3386-L3460)
- **Pedalboard Handler**: [liveAPI-v6.js:2015-2234](../../ableton/scripts/liveAPI-v6.js#L2015-L2234)
- **AbletonOSC Track API**: [documentation/AbletonOSC-API.md](../AbletonOSC-API.md#track-api)

## Notes

### AbletonOSC Arm API

From [AbletonOSC-API.md](../AbletonOSC-API.md#L280):
```
/live/track/set/arm track_id, armed
```
- `armed`: 1=on, 0=off
- Sent to port 11000 (AbletonOSC listener)

### Input Routing API

From [AbletonOSC-API.md](../AbletonOSC-API.md#L285):
```
/live/track/set/input_routing_channel track_id, channel
```
- `channel`: Must be STRING (e.g., "3") not integer
- Available channels: "1", "2", "1/2", etc.

### Future Enhancement

If 100ms proves unreliable, consider implementing:
```javascript
// Retry arm command if it fails
var retryCount = 0;
var maxRetries = 3;
var armTask = new Task(function() {
    outlet(3, ["/live/track/set/arm", armTrackIndex, 1]);
    retryCount++;
    if (retryCount < maxRetries) {
        armTask.schedule(100);  // Retry after 100ms
    }
}, this);
armTask.schedule(100);
```
