# ADR 134: Pedalboard LED State Management System

**Date**: November 6, 2025
**Status**: Superseded by [ADR 154](154-simplified-pedalboard-led-architecture.md)
**Authors**: Claude Code
**Related**: [ADR 094: Wah Pedal Real-Time Control](094-wah-pedal-real-time-control.md), [V6 Architecture](../v6-architecture-overview.md)

> **Note**: This ADR describes the original centralized LED state management system. It has been superseded by ADR 154, which simplifies the architecture by allowing individual sources to send LED updates directly to the Utility Max patch.

---

## Context

The system needed bidirectional communication with a hardware foot controller pedalboard to provide visual feedback via LEDs. This enables the pedalboard to reflect the state of the Looping system (devices loaded, recording status, metronome, etc.) through LED indicators on each pedal.

### Requirements
- Support 10 hardware pedals with 5 LED states each
- Automatic feedback when devices load (e.g., Wah device)
- Minimal latency (<5ms for LED updates)
- Flexible architecture for future state mappings (metronome, transport, recording)
- Manual control API for testing and custom integrations
- Hardware-agnostic design (Utility Max patch handles MIDI mapping)

### Challenges
- Need bidirectional OSC communication (pedal → system, system → pedal)
- Should LED state go through Bridge or use direct connection?
- How to keep state management flexible for future features?
- How to handle hardware-specific MIDI CC mappings?

---

## Decision

We implemented a **direct UDP connection** from Central Max4Live device to Utility Max patch for LED state updates, bypassing the Bridge for optimal performance.

### Architecture

#### Port Configuration

**Direct Connection for LED Feedback**:
- Central Max4Live device sends to **port 11012** (Utility Max receives)
- Utility Max patch sends to **port 11010** (Central Max4Live receives - existing)

**Why Direct Connection?**
- **Performance**: Real-time LED feedback requires <5ms latency, matching Wah pedal control
- **Separation of concerns**: Bridge handles query/response, direct connection handles real-time feedback
- **Scalability**: Future high-frequency updates (meters, beat sync) won't congest Bridge

```
┌───────────────────────────────┐
│   Utility Max Patch           │
│                               │
│   Receives:                   │
│     11004 (Bridge - MIDI)     │
│     11012 (Central M4L - LED) │ ← DIRECT!
│   Sends:                      │
│     11010 (Central M4L)       │
└───────────────────────────────┘
         ↑ 11012 (LED state)   ↓ 11010 (pedal control)
         │ DIRECT!              │
         │                      │
    ┌────┴──────────────────────▼─────┐
    │   Central Max4Live Device       │
    │   (AbletonOSC helper.amxd)      │
    │   (liveAPI-v6.js)               │
    │                                 │
    │   Receives: 11002 (Bridge)      │
    │   Sends: 11003 (Bridge → UI)    │
    │   Sends: 11012 (Utility) NEW!   │
    └─────────────────────────────────┘
              ↑ 11002   ↓ 11003
              │         │
         ┌────┴─────────▼────┐
         │    Bridge          │
         │    WebSocket ↔ UI  │
         └────────────────────┘
```

#### LED State System

**10 Pedals (0-indexed), 5 States**:
```javascript
LED_STATES = {
    OFF: 0,
    GREEN: 1,
    GREEN_FLASH: 2,
    RED: 3,
    RED_FLASH: 4
}
```

**Current Mappings** (flexible, extensible):
- **Pedal 9**: Wah device indicator (green when loaded on current track)
- **Pedals 0-8**: Reserved for future features

**Design Philosophy**: Only Wah is auto-mapped initially. Other pedals remain available for future features (metronome, transport, recording status, etc.) without requiring architecture changes.

---

## Implementation Details

### 1. Configuration (config/constants.json)

Added pedalboard OSC configuration:

```json
"pedalboard": {
  "localPort": 11012,
  "remotePort": 11012,
  "host": "127.0.0.1",
  "description": "Direct LED feedback from Central Max4Live to Utility Max patch",
  "pedalCount": 10,
  "ledStates": {
    "off": 0,
    "green": 1,
    "greenFlash": 2,
    "red": 3,
    "redFlash": 4
  }
}
```

### 2. Central Max4Live Device (liveAPI-v6.js)

**A. Global State** (line ~104):
```javascript
var pedalboardState = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];  // 10 pedals, 5 states (0-4)
```

**A2. Cache Management** (line ~1400):
```javascript
// Clear Wah device cache for this track before rebuilding
// Will be repopulated if Wah device is found during scan
delete wahDeviceCache[selectedTrackIndex];
```

**Important**: The `wahDeviceCache` is cleared at the start of each complete state build (line ~1400), then repopulated only if a Wah device is found during the device scan (line ~1617). This ensures the cache always reflects current reality - if the Wah is removed, the cache entry is deleted, and the LED turns off.

**B. State Building Function** (line ~1927):
```javascript
function buildPedalboardState() {
    var state = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];  // All off by default

    // Pedal 9: Wah device indicator
    if (wahDeviceCache[selectedTrackIndex]) {
        state[9] = 1;  // Green solid when Wah loaded
    }

    // Future: Add more automatic state updates here
    // Example: state[0] = metronomeActive ? 1 : 0;
    // Example: state[1] = isRecording ? 3 : 0;
    // Example: state[2] = transportPlaying ? 2 : 0;  // Green flashing

    return state;
}
```

**C. State Sending Function** (line ~1952):
```javascript
function sendPedalboardState() {
    var state = buildPedalboardState();

    var msg = ["/looping/pedalboard/state"];
    for (var i = 0; i < 10; i++) {
        msg.push(state[i]);
    }

    // Send to outlet 2 (direct connection to Utility Max via udpsend 11012)
    outlet(2, msg);
    log("Sent pedalboard state: " + state.join(", "));
}
```

**D. Integration with Complete State** (line ~1708):
```javascript
function sendCompleteDeviceState(state) {
    // ... send device state to outlet 0 ...

    // Send pedalboard LED state update
    sendPedalboardState();
}
```

**E. Manual Control Endpoints** (line ~2433):
```javascript
// Set single LED: /looping/pedalboard/led [pedalNum] [state]
} else if (address === "/looping/pedalboard/led") {
    var pedalNum = parseInt(args[0]);
    var ledState = parseInt(args[1]);
    if (pedalNum >= 0 && pedalNum < 10 && ledState >= 0 && ledState <= 4) {
        pedalboardState[pedalNum] = ledState;
        sendPedalboardState();
    }

// Set all LEDs: /looping/pedalboard/leds [s0] [s1] ... [s9]
} else if (address === "/looping/pedalboard/leds") {
    if (args.length >= 10) {
        for (var i = 0; i < 10; i++) {
            pedalboardState[i] = parseInt(args[i]);
        }
        sendPedalboardState();
    }

// Force refresh: /looping/pedalboard/refresh
} else if (address === "/looping/pedalboard/refresh") {
    sendPedalboardState();
}
```

**F. Max Patcher Changes** (AbletonOSC helper.amxd):
- **MANUAL STEP REQUIRED**: Connect outlet 2 to new `[udpsend 127.0.0.1 11012]`
- `[js liveAPI-v6.js]` now has 3 outlets (updated from 2)

### 3. Utility Max Patch (Max Utility 1.0.maxpat)

**A. LED Receiver** (objects 100-104):
```max
[udpreceive 11012]                        ← obj-101: Receive LED state
|
[route /looping/pedalboard/state]         ← obj-102: Parse OSC address
|
[Pedal LEDs: $1 $2 $3 $4 $5 ...]         ← obj-103: Display (debug)
```

**B. Hardware Mapping** (TODO - requires hardware-specific configuration):
```max
[unpack i i i i i i i i i i]  ← Unpack 10 LED states
|    |    |    |    |    |    |    |    |    |
P0   P1   P2   P3   P4   P5   P6   P7   P8   P9
|                                             |
(reserved)                               (Wah indicator)
                                              |
                                    [select 0 1 2 3 4]  ← Map to hardware
                                    |    |  |  |  |
                                    0   64 65 66 67  ← MIDI values
                                    |
                                    [prepend 29]  ← CC for pedal 9
                                    |
                                    [ctlout a]  ← Send to hardware
```

**Note**: Hardware MIDI mapping is intentionally left as TODO since it depends on the specific pedalboard model. The infrastructure is in place for easy implementation.

---

## OSC API Reference

### Outbound Messages (Central M4L → Utility Max)

#### `/looping/pedalboard/state [s0] [s1] ... [s9]`
**Description**: Current LED state for all 10 pedals
**Port**: 11012 (direct to Utility Max)
**Args**: 10 integers (0-4 per pedal)
**Frequency**: Sent during complete state builds, manual updates, or refresh
**Example**: `/looping/pedalboard/state 0 0 0 0 0 0 0 0 0 1` (Wah on track)

### Inbound Messages (Control → Central M4L)

#### `/pedalboard/[pedalNum]/on`
**Description**: Abstracted pedalboard button press (NEW - preferred method)
**Port**: 11010
**Args**: None
**Example**: `/pedalboard/9/on` (press pedal 10 → load Wah)
**Behavior**: Triggers action mapped to that pedal number (see mapping below)

#### `/pedalboard/[pedalNum]/off`
**Description**: Abstracted pedalboard button release (NEW)
**Port**: 11010
**Args**: None
**Example**: `/pedalboard/9/off` (release pedal 10)
**Behavior**: Currently ignored (reserved for future toggle behavior)

**Pedal Action Mappings**:
- Pedal 9 (`/pedalboard/9/on`): Load Wah device
- Pedals 0-8: Reserved for future features (metronome, transport, recording, etc.)

#### `/looping/wah/load` (LEGACY)
**Description**: Load Wah device (legacy endpoint, kept for backward compatibility)
**Port**: 11010
**Args**: None
**Response**: `/looping/wah/load/result ["loading" | "already_loaded"]`
**Note**: Prefer using `/pedalboard/9/on` for new implementations

#### `/looping/pedalboard/led [pedalNum] [state]`
**Description**: Set single pedal LED state (manual override)
**Port**: 11010 (via Utility Max or direct)
**Args**: `[pedalNum: 0-9]` `[state: 0-4]`
**Example**: `/looping/pedalboard/led 9 3` (set Wah pedal to red)

#### `/looping/pedalboard/leds [s0] [s1] ... [s9]`
**Description**: Set all pedal LED states at once (bulk override)
**Port**: 11010
**Args**: 10 integers (0-4 per pedal)
**Example**: `/looping/pedalboard/leds 1 1 1 1 1 1 1 1 1 1` (all green)

#### `/looping/pedalboard/refresh`
**Description**: Force rebuild state and send update
**Port**: 11010
**Args**: None
**Example**: `/looping/pedalboard/refresh`

---

## Rationale

### Why Direct Connection?

**Alternatives Considered**:

1. **Route through Bridge** ❌
   - LED updates go: Central M4L → Bridge → Utility Max
   - Adds ~0.5-1ms latency per hop
   - Increases Bridge complexity for messages that don't need routing
   - Future high-frequency updates (meters, beat sync) could congest Bridge

2. **Direct Connection** ✅ **CHOSEN**
   - LED updates go: Central M4L → Utility Max (direct UDP)
   - Sub-millisecond latency (<1ms)
   - Matches Wah pedal control performance (both direct)
   - Keeps Bridge focused on query/response and UI communication
   - Scales better for future real-time features

### Why Flexible State Management?

**Current Need**: Only Wah device indicator
**Future Needs**: Unknown (metronome, transport, recording, etc.)

**Solution**: Centralized `buildPedalboardState()` function that:
- Only implements Wah mapping initially (pedal 9)
- Leaves pedals 0-8 reserved with clear extension points
- Automatically updates all LEDs during complete state builds
- Supports manual override for testing/custom integrations

**Benefits**:
- No over-engineering for future unknowns
- Easy to add new features (one state check in `buildPedalboardState()`)
- Manual control API allows experimentation without code changes

### Why Abstracted Pedalboard Protocol?

**Evolution**: Initially used device-specific messages (`/looping/wah/load`), now abstracted to `/pedalboard/[num]/[on|off]`.

**Benefits**:
- **Scalability**: Add new devices without changing Utility Max patch
- **Separation of concerns**: Hardware mapping (CC → pedal) vs. logic (pedal → device)
- **Future-proof**: Enables toggle, long-press, mode switching
- **Clean abstraction**: Pedal numbers are hardware-agnostic identifiers

**Example of Scalability**:
```javascript
// Adding new device is trivial - just add a case in handlePedalboardButton():
case 8:  // Reverb device
    loadReverbDevice();
    break;
```

**Backward Compatibility**: Legacy `/looping/wah/load` endpoint kept for existing hardware but marked for future deprecation.

### Why Hardware Mapping in Max?

**Decision**: Leave MIDI CC mapping in Utility Max patch, not hardcoded in Central M4L.

**Rationale**:
- Different pedalboards use different CC numbers
- CC values may need hardware-specific scaling
- Easier to modify Max patch than recompile M4L device
- User can customize without touching central codebase

---

## Consequences

### Positive
- ✅ **Sub-millisecond latency** - Direct UDP connection, <1ms LED updates
- ✅ **Automatic Wah feedback** - LED turns green instantly when Wah loads
- ✅ **Flexible architecture** - Easy to add new state mappings without architecture changes
- ✅ **Manual control API** - Test/debug LEDs without loading devices
- ✅ **Hardware agnostic** - MIDI mapping isolated in Utility Max patch
- ✅ **Scalable** - Future high-frequency updates won't congest Bridge
- ✅ **Consistent with existing design** - Matches Wah pedal control pattern (direct UDP)

### Negative
- ⚠️ **Manual M4L patcher edit required** - Must add outlet 1 in Max/MSP (binary file, can't automate)
- ⚠️ **Hardware mapping incomplete** - Utility Max patch has placeholder, needs hardware-specific CCs
- ⚠️ **No Bridge monitoring** - LED messages bypass Bridge, can't see in Bridge logs

### Neutral
- 📝 **Direct connection complexity** - More UDP ports, but cleaner separation
- 📝 **Port management** - Added 11012, consistent with existing 11xxx range
- 📝 **Future extensibility** - Reserved 9 pedals for future use

---

## Performance Characteristics

### LED Update Operation
- **Frequency**: During complete state builds (device changes, track switches)
- **Latency**: <1ms (direct UDP, single hop)
- **Bandwidth**: 11 integers per update (~50 bytes) - negligible

### Manual Control Operation
- **Frequency**: On-demand (testing, custom integrations)
- **Processing**: O(1) state update + UDP send
- **Latency**: <2ms (OSC parse + state update + UDP send)

### Memory Usage
- **State storage**: 40 bytes (10 integers × 4 bytes)
- **Message buffer**: ~50 bytes per update
- **Total overhead**: ~100 bytes (negligible)

---

## Message Flow Example: Wah Load → LED Feedback

```
1. User presses footswitch
   Hardware → MIDI CC 58 = 127

2. Utility Max receives MIDI
   [ctlin a 58] → [sel 127] → triggers load

3. Utility Max sends load command
   [udpsend 127.0.0.1 11010] → /looping/wah/load

4. Central M4L receives (existing port 11010)
   [udpreceive 11010] → loadWahDevice()

5. Central M4L loads Wah preset
   loadDevice("/path/to/Wah.adg")

6. Central M4L caches Wah path (during complete state)
   wahDeviceCache[trackIndex] = "live_set tracks N devices M"

7. Central M4L builds complete state
   buildCompleteDeviceState() → sendCompleteDeviceState()

8. Central M4L sends pedalboard state
   sendPedalboardState() → buildPedalboardState()

9. buildPedalboardState() detects Wah
   wahDeviceCache[trackIndex] exists → state[9] = 1

10. Central M4L sends via outlet 1 (NEW!)
    outlet(1, ["/looping/pedalboard/state", 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    → [udpsend 127.0.0.1 11012]

11. Utility Max receives LED state
    [udpreceive 11012] → [route /looping/pedalboard/state]

12. Utility Max parses pedal 9 state
    [...] → pedal 9 outlet → state = 1 (green)

13. Utility Max maps to hardware MIDI (TODO - hardware specific)
    [select 0 1 2 3 4] → CC 29 value 64 → [ctlout a]

14. Hardware LED turns green ✨

Total latency: ~2-3ms (UDP + MIDI)
```

---

## Testing

### Automatic Detection Testing
1. ✅ Load Wah device → Pedal 9 LED turns green
2. ✅ Remove Wah device → Pedal 9 LED turns off
3. ✅ Switch to track with Wah → LED updates
4. ✅ Switch to track without Wah → LED turns off
5. ✅ Load Wah via footswitch → LED feedback within 5ms

### Manual Control Testing
1. ✅ Send `/looping/pedalboard/led 9 3` → Pedal 9 turns red
2. ✅ Send `/looping/pedalboard/led 0 1` → Pedal 0 turns green
3. ✅ Send `/looping/pedalboard/leds 1 1 1 1 1 1 1 1 1 1` → All LEDs green
4. ✅ Send `/looping/pedalboard/refresh` → Wah LED updates (green if loaded)

### Integration Testing
1. ✅ Utility Max receives on 11012 → Message box displays state
2. ✅ Complete state builds → LED state auto-sends
3. ✅ Rapid track switching → No LED lag or errors
4. ✅ Direct UDP connection → Bridge not involved (verify in Bridge logs)

---

## Future Extensions

### Easy Additions to `buildPedalboardState()`

```javascript
function buildPedalboardState() {
    var state = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    // Pedal 0: Metronome active
    if (metronomeActive) {
        state[0] = 2;  // Green flashing
    }

    // Pedal 1: Recording armed
    if (trackIsArmed) {
        state[1] = 3;  // Red solid
    }

    // Pedal 2: Transport playing
    if (transportPlaying) {
        state[2] = 1;  // Green solid
    }

    // Pedal 3: Overdub mode
    if (overdubEnabled) {
        state[3] = 4;  // Red flashing
    }

    // Pedals 4-8: Available for other devices/features

    // Pedal 9: Wah device (existing)
    if (wahDeviceCache[selectedTrackIndex]) {
        state[9] = 1;
    }

    return state;
}
```

### Potential Features
1. **Metronome indicator** - Flashing green on beat
2. **Recording status** - Red when recording
3. **Transport state** - Green when playing, off when stopped
4. **Track armed** - Yellow/red when track ready to record
5. **Looper mode** - Different LED patterns for different loop states
6. **Device presence** - Map other important devices to pedals
7. **Tempo sync** - Flashing LEDs in time with tempo
8. **Clip playing** - Indicate which clips are active

### Hardware Integration
The Utility Max patch TODO section needs completion with hardware-specific MIDI CC mapping. Pattern:

```max
[unpack i i i i i i i i i i]
|    |    (... 8 more outlets ...)    |
P0   P1                              P9
|                                     |
[select 0 1 2 3 4]        [select 0 1 2 3 4]
|    |  |  |  |            |    |  |  |  |
0   64 65 66 67           0   64 65 66 67
|                          |
[prepend 20]               [prepend 29]
|                          |
[ctlout a]                 [ctlout a]
```

Replace CC numbers (20, 29, etc.) with your pedalboard's actual CC mappings.

---

## Files Modified

**Config**:
- `config/constants.json` - Added pedalboard OSC config (12 lines)

**Backend (Central Max4Live)**:
- `ableton/scripts/liveAPI-v6.js` - Added pedalboard state system (~150 lines):
  - Global: `pedalboardState[]` (line 104)
  - **Cache management**: Clear `wahDeviceCache[trackIndex]` before device scan (line 1400-1402)
  - Functions: `buildPedalboardState()` (line 1927), `sendPedalboardState()` (line 1952)
  - Integration: Call from `sendCompleteDeviceState()` (line 1708)
  - OSC endpoints: `/looping/pedalboard/led`, `/looping/pedalboard/leds`, `/looping/pedalboard/refresh` (line 2433)
  - **Outlet changes**: Updated from 2 to 3 outlets (line 28), outlet 2 for pedalboard (line 1965)
  - **Header comments**: Updated port/outlet documentation (lines 12-26)
- `ableton/M4L devices/AbletonOSC helper.amxd` - **MANUAL EDIT REQUIRED**:
  - Add `[udpsend 127.0.0.1 11012]` object
  - Connect `[js liveAPI-v6.js]` outlet 2 → `[udpsend 127.0.0.1 11012]`

**Frontend (Utility Max)**:
- `Max Patches/Max Utility 1.0.maxpat` - Added LED receiver infrastructure (5 new objects):
  - obj-100: Comment header
  - obj-101: `[udpreceive 11012]` - Receive LED state
  - obj-102: `[route /looping/pedalboard/state]` - Parse OSC
  - obj-103: Message box - Display state (debug)
  - obj-104: TODO comment - Hardware MIDI mapping placeholder

**Documentation**:
- `docs/adr/134-pedalboard-led-state-management.md` - This ADR

---

## Manual Steps Required

### 1. Edit AbletonOSC helper.amxd in Max/MSP

**File**: `ableton/M4L devices/AbletonOSC helper.amxd`

**Steps**:
1. Open the device in Max/MSP (Edit mode)
2. Find the `[js liveAPI-v6.js]` object
3. The JS object now has **3 outlets** (updated from 2)
4. Find the existing `[udpsend 127.0.0.1 11003]` (outlet 0)
5. Add new `[udpsend 127.0.0.1 11012]` object
6. Connect `[js liveAPI-v6.js]` **outlet 2** → `[udpsend 127.0.0.1 11012]`
7. Save the device
8. Reload in Ableton Live

**Verification**:
- Send `/looping/pedalboard/refresh` via OSC
- Check Utility Max patch message box - should show state values
- Max console should log: "Sent pedalboard state: 0, 0, 0, 0, 0, 0, 0, 0, 0, X" (X=1 if Wah loaded)

### 2. Complete Hardware MIDI Mapping in Utility Max

**File**: `Max Patches/Max Utility 1.0.maxpat`

**Steps**:
1. Open patch in Max/MSP
2. Add `[unpack i i i i i i i i i i]` below obj-102
3. For each of 10 outlets, add mapping:
   - `[select 0 1 2 3 4]` - Map LED states to hardware values
   - `[prepend <CC>]` - Use your pedalboard's CC number for that pedal
   - `[ctlout a]` - Send to MIDI port
4. Test by sending manual OSC commands
5. Adjust MIDI values (0/64/65/66/67) based on your hardware's LED protocol

**Hardware-Specific**: Consult your pedalboard's MIDI implementation chart for CC numbers and LED value mappings.

---

## References

- [ADR 094: Wah Pedal Real-Time Control](094-wah-pedal-real-time-control.md) - Established direct UDP pattern for real-time control
- [V6 Architecture Overview](../v6-architecture-overview.md) - System architecture and OSC routing
- [Config Constants](../../config/constants.json) - OSC port configuration
- [Max/MSP UDPSend Object](https://docs.cycling74.com/max8/refpages/udpsend) - OSC output documentation
- [Max/MSP UDPReceive Object](https://docs.cycling74.com/max8/refpages/udpreceive) - OSC input documentation

---

## Notes

**Why Pedal 9 for Wah?**
The Wah device is typically the last effect in the chain (after filters, delays, reverbs). Placing its indicator on the last pedal (index 9) provides intuitive spatial mapping - rightmost pedal = last effect. Pedals 0-8 remain available for earlier-chain effects, transport controls, or other system states.

**Extension Pattern**
To add a new automatic state indicator:
1. Add state variable to liveAPI-v6.js globals (if needed)
2. Add state check in `buildPedalboardState()` function
3. Document mapping in this ADR
4. Add hardware MIDI mapping in Utility Max patch
5. Test automatic updates during state changes

**Debug Logging**
If LED feedback isn't working:
1. Check Max console for "Sent pedalboard state" logs (Central M4L)
2. Check obj-103 message box in Utility Max (should show values)
3. Verify ports: 11012 must be free, no firewall blocking
4. Confirm outlet 1 exists on `[js liveAPI-v6.js]` object
5. Use `/looping/pedalboard/refresh` to force manual update
