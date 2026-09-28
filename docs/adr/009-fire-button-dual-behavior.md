# ADR 008: Fire Button with Dual Timing-Based Behavior

**Status:** Accepted
**Date:** 2025-01-05
**Deciders:** Ben Juodvalkis
**Related:** ADR-007 (Clip Controls), Phase 6.8 (Performance Workflow)

## Context

Live performance workflows require quick access to two frequently-used operations:

1. **Clip firing** - Triggering clips in the highlighted slot (start/stop/record)
2. **Audio track setup** - Creating and configuring audio tracks for recording

### Current Approach (Before ADR 008)

**Separate Actions:**
- Clip firing: Manual navigation to clip, click/MIDI trigger
- Audio track setup: Click UI button → calls `prepareTrack('audio')`
  - Creates/reuses audio track
  - Sets C-Guitar input routing with Post FX sub-channel
  - Enables monitoring and arms track

**Problems:**
1. Two separate interaction paths for related performance tasks
2. Audio track setup buried in UI
3. No quick access during live performance
4. Multiple clicks required for common workflow

### User Experience Goals

1. **Single button for related actions** - One performance control
2. **Intuitive timing** - Short tap vs long hold feels natural
3. **No mode switching** - Works regardless of current UI state
4. **Minimal latency** - Direct Max4Live implementation
5. **Fail-safe** - Clear feedback on success/error

## Decision

**Implement a `/fire` command in Max4Live with timing-based dual behavior using the highlighted clip slot.**

### Behavior

**Short Press (<300ms) - Context-Aware:**
- **If highlighted slot is empty**:
  - Fire the clip slot to start recording
  - Uses Live API: `live_set view highlighted_clip_slot`
  - Calls `.fire()` method when button is released (within 300ms)
  - Result: Start recording new clip on armed track
- **If highlighted slot has clip**:
  - Toggle session record (Session Overdub button)
  - Gets current state from `live_set.session_record`
  - Toggles to opposite state (on→off, off→on)
  - Result: Enable/disable overdub recording across all clips

**Long Hold (≥300ms):**
- Trigger audio track preparation **immediately at 300ms threshold**
- Does NOT wait for button release
- Uses Max Task scheduled at 300ms
- Sends `/fire/audio_track/prepare` to client at exactly 300ms
- Client calls `prepareTrack('audio')` service immediately
- Subsequent button release is ignored (long press already executed)

### Architecture

**Max4Live Implementation (liveAPI-v6.js):**
```javascript
// State tracking
var fireButtonIsPressed = false;
var fireButtonHoldTask = null;
var FIRE_LONG_PRESS_THRESHOLD = 300; // milliseconds

// OSC: /fire 1 → Schedule Task for 300ms
// OSC: /fire 0 → Cancel Task (short press) or ignore (long press already fired)
```

**Live API Usage:**
```javascript
// Highlighted slot access
var highlightedSlot = new LiveAPI("live_set view highlighted_clip_slot");
highlightedSlot.call("fire");
```

**Client Integration:**
- Listen for `/fire/audio_track/prepare` message
- Call existing `prepareTrack('audio')` service
- No new client-side timing logic needed

### Rationale

**1. Highlighted Slot vs Track/Scene Indices**
- ✅ Always reflects current Session View selection
- ✅ No coordination with UI selection state
- ✅ Follows Live's native interaction model
- ✅ Works with any navigation method (mouse, MIDI controller, Push)

**2. Timing-Based Behavior**
- ✅ Natural interaction pattern (iOS, Android use this)
- ✅ No mode switching required
- ✅ Single button for two related actions
- ✅ 300ms threshold feels instant for taps, deliberate for holds
- ✅ Immediate execution on threshold (no wait for release) feels more responsive

**3. Max4Live Implementation**
- ✅ Lowest latency (direct Live API access)
- ✅ No AbletonOSC roundtrip for clip firing
- ✅ Client-side audio track prep reuses existing service
- ✅ Clean separation: timing logic in Max, track prep in client

**4. Client-Side Audio Track Prep**
- ✅ Reuses proven `trackPreparation.ts` service
- ✅ Maintains V6 hybrid architecture (AbletonOSC for track ops)
- ✅ No duplication of track creation/routing logic
- ✅ Consistent with existing "Add Instrument" buttons

**5. Context-Aware Short Press**
- ✅ Check `has_clip` property on highlighted slot
- ✅ Empty slot → Fire to start recording (standard behavior)
- ✅ Slot has clip → Toggle session record (looping workflow enhancement)
- ✅ Session record toggle enables overdub across all clips
- ✅ Reduces need for dedicated session record button

**6. Release After Long Press Protection**
- ✅ Task nullified when long press executes (at 300ms)
- ✅ Release handler checks if task is null
- ✅ Prevents accidental clip fire on newly created/armed track
- ✅ Critical for smooth workflow - user can release whenever after 300ms

## Implementation

### Max4Live (liveAPI-v6.js)

**State Variables:**
```javascript
// Fire button state tracking (Phase 6.8)
var fireButtonPressTime = 0;
var fireButtonIsPressed = false;
var FIRE_LONG_PRESS_THRESHOLD = 300; // milliseconds
```

**Handler Functions:**
```javascript
function handleFireCommand(value) {
    if (value === 1) {
        // Button pressed - schedule long press action
        fireButtonIsPressed = true;

        // Cancel any existing hold task
        if (fireButtonHoldTask) {
            fireButtonHoldTask.cancel();
        }

        // Schedule audio track preparation for 300ms from now
        fireButtonHoldTask = new Task(function() {
            if (fireButtonIsPressed) {
                prepareAudioTrackViaAbletonOSC();
                // Set task to null to indicate long press was executed
                fireButtonHoldTask = null;
            }
        });
        fireButtonHoldTask.schedule(FIRE_LONG_PRESS_THRESHOLD);

    } else if (value === 0 && fireButtonIsPressed) {
        // Button released
        fireButtonIsPressed = false;

        // Check if hold task is still pending (not yet executed)
        if (fireButtonHoldTask) {
            // Task is still scheduled - this is a short press
            fireButtonHoldTask.cancel();
            fireButtonHoldTask = null;

            fireHighlightedClipSlot();
        } else {
            // Hold task is null - long press already happened
            // Skip clip fire to prevent accidental triggering of new track's slot
        }
    }
}

function fireHighlightedClipSlot() {
    var highlightedSlot = new LiveAPI("live_set view highlighted_clip_slot");
    if (highlightedSlot.id === "0") {
        outlet(0, ["/fire/clip/error", "No slot highlighted"]);
        return;
    }

    // Check if slot has a clip
    var hasClip = highlightedSlot.get("has_clip");

    if (!hasClip || !hasClip[0]) {
        // Empty slot - fire to start recording
        highlightedSlot.call("fire");
        outlet(0, ["/fire/clip/success"]);
    } else {
        // Slot has clip - toggle session record instead
        toggleSessionRecord();
    }
}

function toggleSessionRecord() {
    var liveSet = new LiveAPI("live_set");
    var currentState = liveSet.get("session_record");

    if (currentState && currentState.length > 0) {
        var newState = currentState[0] ? 0 : 1;
        liveSet.set("session_record", newState);
        outlet(0, ["/fire/session_record/toggled", newState]);
    }
}

function prepareAudioTrackViaAbletonOSC() {
    outlet(0, ["/fire/audio_track/prepare"]);
}
```

**Message Routing:**
- Added to `anything()` function: handles `/fire [0|1]` with args
- Added to `list()` function: handles OSC list format

### OSC Protocol

**Commands (Client → Max):**
```
/fire 1    # Button pressed
/fire 0    # Button released
```

**Responses (Max → Client):**
```
/fire/clip/success                    # Clip fired (short press, empty slot)
/fire/clip/error [message]            # Clip fire failed
/fire/session_record/toggled [0|1]    # Session record toggled (short press, slot has clip)
/fire/session_record/error [message]  # Session record toggle failed
/fire/audio_track/prepare             # Trigger audio prep (long hold)
```

### Client Integration

**Listen for audio track prep trigger:**
```typescript
window.addEventListener('osc-message', (event) => {
  const { address } = event.detail;
  if (address === '/fire/audio_track/prepare') {
    prepareTrack('audio');
  }
});
```

## Consequences

### Positive

✅ **Unified Performance Control**
- One button for three common operations:
  - Start recording (empty slot)
  - Toggle session overdub (slot has clip)
  - Prepare audio track (long hold)
- Natural timing-based distinction
- Context-aware behavior based on clip slot state
- Works from any UI state

✅ **Zero Additional Latency**
- Direct Live API access for clip firing
- No AbletonOSC roundtrip for short press
- Max4Live timing measurement is instant

✅ **Clean Architecture**
- Timing logic isolated in Max4Live
- Reuses existing track preparation service
- No duplication of complex logic

✅ **Discoverable & Intelligent Behavior**
- Short press on empty slot: Standard clip trigger/record
- Short press on existing clip: Session overdub toggle (advanced looping workflow)
- Long hold: Audio track prep (advanced setup)
- Context-aware actions reduce need for multiple buttons
- Follows iOS/Android UX patterns (short vs long press)

✅ **Robust Error Handling**
- Clear success/error messages
- Falls back gracefully if no slot highlighted
- Duration tracking prevents false triggers
- Long press nullifies task to prevent accidental clip fire after audio track creation

### Negative

⚠️ **Learning Curve**
- Users must discover long-hold behavior
- No visual indicator of hold threshold
- **Mitigation**: Document in UI, provide visual feedback on press

⚠️ **Fixed Threshold**
- 300ms may feel too short or long for some users
- No user customization
- **Mitigation**: 300ms is industry standard, can adjust if needed

⚠️ **Button State Tracking**
- Press without release leaves state dangling
- **Mitigation**: State reset on next press, timeout could be added

### Neutral

- Highlighted clip slot may not match UI selection visually
- Requires client-side listener for audio track prep
- Uses Max4Live Date.now() for timing (sufficient for 300ms threshold)

## Alternatives Considered

### A. Two Separate Buttons
- **Rejected**: Takes up more UI space, less unified workflow

### B. Mode Switching (Toggle)
- **Rejected**: Requires mode awareness, easy to forget current mode

### C. Double-Tap for Audio Track
- **Rejected**: Less reliable, harder to implement, feels janky

### D. Hold Modifier Key
- **Rejected**: Requires two-handed operation on iPad

### E. Use Track/Scene Indices Instead of Highlighted Slot
- **Rejected**: Requires UI selection sync, breaks with external MIDI control

### F. Implement Timing in Client (WebSocket)
- **Rejected**: Adds latency, requires browser timing, complicates architecture

## Related Decisions

- **ADR-007**: Clip controls architecture (related clip operations)
- **V6 Hybrid Architecture**: Max4Live for Live API, AbletonOSC for track ops
- **trackPreparation.ts**: Audio track setup service (reused here)

## Follow-Up Tasks

- [ ] Add visual feedback for button press duration (progress indicator)
- [ ] Consider making threshold user-configurable (advanced settings)
- [ ] Add timeout to reset button state if release not received
- [ ] Document usage in UI help/tooltips
- [ ] Add haptic feedback on iPad for press/threshold reached

## References

- Cycling '74 ClipSlot: https://docs.cycling74.com/apiref/lom/clipslot/#fire
- Cycling '74 Song View: https://docs.cycling74.com/apiref/lom/song_view/#highlighted_clip_slot
- Live API Implementation: `ableton/scripts/liveAPI-v6.js`
- Track Preparation Service: `interface/src/lib/services/trackPreparation.ts`
- V6 API Documentation: `documentation/v6-api.md` (Phase 6.8)

---

**Decision made:** 2025-01-05
**Implemented:** 2025-01-05
**Phase:** 6.8 (Performance Workflow Enhancements)
