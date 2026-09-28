# ADR 154: Simplified Pedalboard LED Architecture

**Date**: January 10, 2026
**Status**: Accepted
**Authors**: Claude Code
**Supersedes**: [ADR 134: Pedalboard LED State Management](134-pedalboard-led-state-management.md)
**Related**: [ADR 135: Abstracted Pedalboard Button Protocol](135-abstracted-pedalboard-button-protocol.md), [Audio Capture Implementation](./452-audio-capture-implementation.md)

---

## Context

The previous LED state management system (ADR 134) centralized all LED state in `liveAPI-v6.js`. This required:
- Central Max4Live to track device states (Guitar, Vocal, Bass, Wah)
- Building a 10-element state array on every device change
- Sending bulk state updates via `/looping/pedalboard/state`

This architecture had issues:
1. **Over-engineering**: Only Wah LED was actually useful; Guitar/Vocal/Bass indicators were rarely needed
2. **Tight coupling**: Adding new LED sources (like audio capture) required modifying liveAPI-v6.js
3. **Complexity**: Central Max owned state that other devices needed to update

### Trigger

Adding footswitch control for audio capture (CC 54 → pedal 6) required LED feedback for recording state. Rather than add more complexity to the centralized system, we decided to simplify.

---

## Decision

Move LED state ownership to **Utility Max patch** and allow individual sources to send **single-pedal LED updates** directly.

### New Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Individual sources send LED updates directly                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  capture-engine.js ──► /looping/capture/led 6 1 ──┐                 │
│                        (pedal 6, green=recording)  │                 │
│                                                    │                 │
│  (future sources) ──► /looping/XXX/led [p] [s] ───┤                 │
│                                                    │                 │
│  (bulk reset) ──► /looping/pedalboard/state [...] ┤                 │
│                                                    │                 │
└────────────────────────────────────────────────────┼─────────────────┘
                                                     │
                                                     │ UDP port 11012
                                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Utility Max Patch (LED State Owner)                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [udpreceive 11012]                                                  │
│       │                                                              │
│       ▼                                                              │
│  [route /looping/capture/led /looping/pedalboard/state]             │
│       │                              │                               │
│       ▼                              ▼                               │
│  [unpack i i]               [unpack i i i i i i i i i i]            │
│  (pedal, state)             (bulk: all 10 states)                   │
│       │                              │                               │
│       ▼                              ▼                               │
│  Route to pedal N           Set all pedals                          │
│       │                                                              │
│       ▼                                                              │
│  [ctlout] → SoftStep MIDI                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Changes

1. **Removed from liveAPI-v6.js**:
   - `pedalboardState` variable
   - `buildPedalboardState()` function
   - `sendPedalboardState()` function
   - OSC handlers: `/looping/pedalboard/led`, `/looping/pedalboard/leds`, `/looping/pedalboard/refresh`
   - Automatic LED updates for Guitar/Vocal/Bass/Wah devices

2. **Kept in liveAPI-v6.js**:
   - Device caches (`wahDeviceCache`, `guitarDeviceCache`, etc.) - still needed for Wah real-time control

3. **Added to capture-engine.js**:
   - `sendLedState(state)` function
   - LED updates on recording state changes

4. **Utility Max patch**:
   - Receives single-pedal messages: `/looping/capture/led [pedal] [state]`
   - Still supports bulk messages: `/looping/pedalboard/state [s0] ... [s9]`
   - Owns internal LED state array

---

## Implementation

### capture-engine.js

```javascript
// LED state constants
var LED_OFF = 0;
var LED_GREEN = 1;
var LED_GREEN_FLASH = 2;
var LED_RED = 3;
var LED_RED_FLASH = 4;
var RECORD_PEDAL = 6;  // Pedal 6 for recording

function sendLedState(state) {
    outlet(0, "/looping/capture/led", RECORD_PEDAL, state);
    post("[led] Pedal " + RECORD_PEDAL + " → state " + state + "\n");
}
```

LED states sent:
- **Armed (waiting for beat)**: Red flashing (state 4)
- **Recording**: Green (state 1)
- **Stopped**: Off (state 0)

### simpler-recorder.amxd Routing

Outlet 0 from `[js capture-engine.js]` carries two message types:
- `/looping/capture/led [pedal] [state]` → route to `[udpsend 11012]`
- `/looping/capture/create_simpler [path]` → route to `[udpsend 11002]`

### Utility Max Patch

```max
[udpreceive 11012]
    │
[route /looping/capture/led /looping/pedalboard/state]
    │                              │
    ▼                              ▼
[unpack i i]               [unpack i i i i i i i i i i]
(pedal, state)             (bulk: all 10 states)
    │
    ▼
[route to correct pedal LED output]
```

---

## LED State Values

| Value | Name | Use Case |
|-------|------|----------|
| 0 | Off | Not active |
| 1 | Green | Active/recording |
| 2 | Green Flash | (reserved) |
| 3 | Red | (reserved) |
| 4 | Red Flash | Armed/waiting |

---

## OSC Messages

### Single-Pedal Update (NEW - preferred)

**Address**: `/looping/capture/led` (or `/looping/XXX/led` for other sources)
**Port**: 11012
**Args**: `[pedalNum: 0-9] [state: 0-4]`
**Example**: `/looping/capture/led 6 1` (pedal 6 green)

### Bulk State Update (kept for compatibility)

**Address**: `/looping/pedalboard/state`
**Port**: 11012
**Args**: 10 integers (state for each pedal)
**Example**: `/looping/pedalboard/state 0 0 0 0 0 0 1 0 0 0` (pedal 6 green)

---

## Rationale

### Why Decentralize?

1. **Simpler**: Each source manages its own LED state
2. **Extensible**: Adding new LED sources doesn't require central changes
3. **Cleaner**: No unused device-detection LED logic
4. **Direct**: Sources send directly to Utility Max, no intermediary

### Why Keep Device Caches?

The `wahDeviceCache` (and others) are still needed for Wah real-time control fast path. Removing LED logic doesn't affect this - the caches serve a different purpose.

### Why Utility Max Owns State?

- Single point of truth for hardware output
- Can merge updates from multiple sources
- Handles hardware-specific MIDI mapping
- Supports both single-pedal and bulk updates

---

## Consequences

### Positive
- ✅ Simpler liveAPI-v6.js (removed ~100 lines)
- ✅ Easy to add new LED sources
- ✅ Recording LED works without Central Max changes
- ✅ No unused device-detection LED code

### Negative
- ⚠️ No automatic LED feedback for Guitar/Vocal/Bass/Wah devices (removed)
- ⚠️ Each source must implement its own LED logic

### Neutral
- 📝 Utility Max patch needs updating for new message format
- 📝 Future sources need to follow the pattern

---

## Files Modified

**Removed LED code from**:
- `ableton/scripts/liveAPI-v6.js`
  - Removed `pedalboardState` variable
  - Removed `buildPedalboardState()` function
  - Removed `sendPedalboardState()` function
  - Removed OSC handlers for LED commands
  - Removed call to `sendPedalboardState()` in `sendCompleteDeviceState()`

**Added LED code to**:
- `ableton/M4L devices/simpler-recorder/capture-engine.js`
  - Added LED constants
  - Added `sendLedState()` function
  - Added LED updates in `record()`, `startRecording()`, `stopRecording()`

**Manual updates needed**:
- `ableton/M4L devices/simpler-recorder/simpler-recorder-1.0.amxd`
  - Route `/looping/capture/led` messages to port 11012
  - Route `/looping/capture/create_simpler` messages to port 11002
- `Max Patches/Max Utility 1.0.maxpat`
  - Add routing for `/looping/capture/led` messages
  - Update LED output logic for pedal 6

---

## Pedal Mapping (Current)

| Pedal | CC | Function | LED States |
|-------|-----|----------|------------|
| 0 | - | Reserved | - |
| 1 | - | Guitar (button only, no LED) | - |
| 2 | - | Vocal (button only, no LED) | - |
| 3 | - | Bass (button only, no LED) | - |
| 4 | - | Fire | - |
| 5 | 54 | Recording toggle | `/pedalboard/5/on\|off` |
| 6 | - | Recording LED | Green=recording, Red flash=armed |
| 7 | - | Reserved | - |
| 8 | - | Reserved | - |
| 9 | - | Wah (button only, no LED) | - |

---

## References

- [ADR 134: Pedalboard LED State Management](134-pedalboard-led-state-management.md) (superseded)
- [ADR 135: Abstracted Pedalboard Button Protocol](135-abstracted-pedalboard-button-protocol.md)
- [Audio Capture Implementation](./452-audio-capture-implementation.md)
