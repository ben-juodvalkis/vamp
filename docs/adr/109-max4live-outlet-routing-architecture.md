# ADR-109: Max4Live Outlet Routing Architecture for Direct AbletonOSC Communication

**Date**: 2025-11-07
**Status**: Accepted
**Related**: [ADR-096 Abstracted Pedalboard Button Protocol](096-abstracted-pedalboard-button-protocol.md)

## Context

When implementing pedalboard hold actions to create audio tracks with input routing (ADR-096), we discovered that `/live/track/set/input_routing_channel` commands were not being executed by AbletonOSC, despite messages flowing through the system correctly.

### Original Architecture Problem

**Initial routing flow**:
```
Max4Live outlet(0) → udpsend 11003 → Bridge → Should route to AbletonOSC
                                     ↓
                                 Actually: Broadcast to UI clients only
```

**Root cause**: The Bridge's `maxObserverPort` (port 11003) handler treats ALL incoming messages as **status updates** to broadcast to WebSocket clients, not as **commands** to execute. This is by design - port 11003 is intended for Max Observer to send track/device events TO the UI.

### Why Bridge Routing Failed

Looking at `enhanced-osc-bridge.js:527-531`:

```javascript
// Max Observer → WebSocket (track change notifications)
maxObserverPort.on("message", (oscMessage) => {
    console.log('🎯 Track event from Max observer:', oscMessage);
    processIncomingMessage(oscMessage, 'maxObserver');
});
```

The `processIncomingMessage()` function only broadcasts to clients - it doesn't check if messages should be re-routed to AbletonOSC. This is correct behavior for status updates, but wrong for commands.

### Type Mismatch Discovery

Additionally discovered that AbletonOSC requires `input_routing_channel` values as **strings** (e.g., `"3"`), not integers (e.g., `3`). The channel values must match the format returned by `/live/track/get/available_input_routing_channels` which returns string values like `"1"`, `"2"`, `"3"`, `"1/2"`, etc.

## Decision

**Add a dedicated outlet for direct AbletonOSC command communication**, bypassing the Bridge routing layer entirely.

### New Outlet Architecture

**Before** (3 outlets):
- **Outlet 0**: OSC messages to client (via udpsend 11003 → Bridge → UI)
- **Outlet 1**: Internal Max messages (device loading, etc.)
- **Outlet 2**: Pedalboard LED state (via udpsend 11012 → Utility Max)

**After** (4 outlets):
- **Outlet 0**: OSC messages to client (via udpsend 11003 → Bridge → UI)
- **Outlet 1**: Internal Max messages (device loading, etc.)
- **Outlet 2**: Pedalboard LED state (via udpsend 11012 → Utility Max)
- **Outlet 3**: AbletonOSC commands (via udpsend 11000 → AbletonOSC **direct**) ✨ **NEW**

### Port Configuration

| Port  | Direction | Purpose | Connected To |
|-------|-----------|---------|--------------|
| 11000 | Send      | AbletonOSC commands (direct) | AbletonOSC listener |
| 11001 | Receive   | AbletonOSC responses | Bridge listener |
| 11002 | Receive   | Max queries from Bridge | Max4Live listener |
| 11003 | Send      | Track/device events to Bridge | Bridge maxObserver port |
| 11012 | Send      | Pedalboard LED state | Utility Max listener |

### UDP Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Max4Live (liveAPI-v6.js)                  │
│                                                              │
│  Outlet 0 → udpsend 11003 (Bridge - status updates)         │
│  Outlet 1 → Internal Max (device loading)                   │
│  Outlet 2 → udpsend 11012 (Utility Max - LED state)         │
│  Outlet 3 → udpsend 11000 (AbletonOSC - commands) ✨ NEW    │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ outlet(3)
                       ↓
              ┌─────────────────┐
              │   AbletonOSC    │  ← LISTENS on port 11000
              │   (port 11000)  │     (receives from Bridge AND Max4Live)
              └─────────────────┘
                       ↑
                       │
              ┌────────┴─────────┐
              │                  │
        ┌─────┴─────┐      ┌────┴──────┐
        │  Bridge   │      │  Max4Live │
        │  (sends)  │      │  (sends)  │
        └───────────┘      └───────────┘
```

**No port conflict** because:
- Multiple UDP clients can **send** to the same destination port
- Only AbletonOSC **listens** on port 11000
- Bridge and Max4Live are both senders, not listeners

## Implementation

### 1. JavaScript Changes (`ableton/scripts/liveAPI-v6.js`)

**Updated outlet count**:
```javascript
outlets = 4;  // Added outlet 3 for AbletonOSC
```

**Updated documentation**:
```javascript
/**
 * Outlets:
 * - Outlet 0: OSC messages to client (via udpsend 11003 -> Bridge)
 * - Outlet 1: Internal Max messages (device loading, etc.)
 * - Outlet 2: Pedalboard LED state (via udpsend 11012 -> Utility Max)
 * - Outlet 3: AbletonOSC commands (via udpsend 11000 -> AbletonOSC direct)
 */
```

**Routing commands through outlet 3**:
```javascript
// OLD: outlet(0) sent to Bridge port 11003
outlet(0, ["/live/track/set/input_routing_channel", trackIndex, request.routingChannel]);

// NEW: outlet(3) sends directly to AbletonOSC port 11000
outlet(3, ["/live/track/set/input_routing_channel", trackIndex, String(request.routingChannel)]);
```

**Added string type conversion**:
```javascript
String(request.routingChannel)  // Converts 3 → "3" for AbletonOSC
```

### 2. Max Patcher Changes (`ableton/M4L devices/AbletonOSC helper.amxd`)

**Added new outlet connection**:
```
[js liveAPI-v6.js] outlet 4 → [udpsend 127.0.0.1 11000]
```

Note: Max displays outlets as 1-indexed in the UI, so outlet 3 in code = outlet 4 in patcher.

### 3. Message Flow After Fix

**Pedalboard hold action** (Guitar/Bass track creation):
```
1. User holds pedal for 500ms
2. Max4Live: createAudioTrack(-1) via Live API
3. Max4Live: outlet(3, ["/live/track/set/input_routing_channel", trackIndex, "3"])
4. udpsend 11000 → AbletonOSC port 11000 (direct, no bridge routing)
5. AbletonOSC: Executes command, sets input routing channel to "3"
6. AbletonOSC: outlet(3, ["/live/track/set/name", trackIndex, "Guitar"])
7. AbletonOSC: Executes command, sets track name
```

**Result**: Track created with correct input routing channel! ✅

## Alternatives Considered

### Alternative 1: Fix Bridge Routing Logic

**Approach**: Modify `maxObserverPort.on("message")` to check if messages starting with `/live/` should be re-routed to AbletonOSC instead of just broadcasting.

**Rejected because**:
- Adds complexity to bridge routing logic
- Blurs the distinction between "status updates" and "commands"
- Port 11003 is semantically for Max→Bridge→UI, not Max→Bridge→AbletonOSC
- Creates bidirectional routing confusion (messages from Max could go either to UI or AbletonOSC)
- Direct connection is simpler and more explicit

### Alternative 2: Use Outlet 0 with Different Port

**Approach**: Change outlet 0's udpsend target to port 11000 instead of 11003.

**Rejected because**:
- Breaks all existing Max→Bridge→UI communication
- Would need to find another outlet for status updates
- Doesn't solve the semantic confusion

### Alternative 3: Route Through Bridge with Special Flag

**Approach**: Add a message flag like `{"route_to": "abletonOSC"}` to indicate re-routing.

**Rejected because**:
- Adds unnecessary complexity
- Requires OSC message format changes
- Still requires bridge code changes
- Direct connection is more efficient

## Benefits

### Architecture
- **Clear separation of concerns**: Each outlet has a single, well-defined purpose
- **No routing ambiguity**: Commands go directly where they need to go
- **Simpler bridge logic**: Bridge doesn't need to handle command re-routing
- **Explicit communication paths**: Code clearly shows where messages are sent

### Performance
- **Lower latency**: Commands bypass bridge processing entirely
- **Reduced message hops**: Max4Live → AbletonOSC (1 hop) instead of Max4Live → Bridge → AbletonOSC (2 hops)
- **No bridge processing overhead**: Bridge doesn't need to parse and re-route commands

### Reliability
- **No UDP port conflicts**: Multiple senders to one listener is standard UDP usage
- **Independent failure modes**: If bridge fails, Max4Live can still send AbletonOSC commands
- **Type safety**: String conversion happens at source (Max4Live) rather than in bridge

### Debugging
- **Easy to trace**: `outlet(3)` in code → `v8-outlet-4` in Max console → port 11000
- **Clear message flow**: Each outlet has distinct purpose and destination
- **No routing confusion**: Commands don't get misinterpreted as status updates

## Consequences

### Positive
- ✅ Pedalboard track creation with routing now works correctly
- ✅ Direct AbletonOSC communication is faster and more reliable
- ✅ Bridge routing logic remains simple and focused
- ✅ Clear architectural separation between status updates and commands
- ✅ Easy to add more AbletonOSC commands in the future (just use outlet 3)

### Negative
- ⚠️ Adds complexity to Max patcher (4 outlets instead of 3)
- ⚠️ Need to know which outlet to use for different message types
- ⚠️ Max patcher must be updated manually when changing outlet connections

### Neutral
- 📝 Developers need to understand outlet routing architecture
- 📝 Documentation must clearly specify outlet usage patterns
- 📝 Any future AbletonOSC commands from Max4Live should use outlet 3

## Usage Guidelines

### When to Use Each Outlet

| Outlet | Use Case | Examples |
|--------|----------|----------|
| **0** | Status updates for UI | Track created, device loaded, clip detected |
| **1** | Internal Max commands | Device loading, Live API queries |
| **2** | Pedalboard LED feedback | LED state changes for Utility Max |
| **3** | AbletonOSC commands | Track properties, device parameters, routing |

### Outlet 3 Usage Pattern

```javascript
// ✅ CORRECT: Use outlet(3) for AbletonOSC commands
outlet(3, ["/live/track/set/input_routing_channel", trackIndex, "3"]);
outlet(3, ["/live/track/set/name", trackIndex, "Guitar"]);
outlet(3, ["/live/track/set/color", trackIndex, 0xff6b35]);

// ❌ WRONG: Don't use outlet(0) for AbletonOSC commands
outlet(0, ["/live/track/set/input_routing_channel", trackIndex, 3]);
// This goes to Bridge port 11003, which just broadcasts to UI

// ✅ CORRECT: Use outlet(0) for status updates
outlet(0, ["/looping/track/created", "audio", trackIndex]);
outlet(0, ["/looping/device/loaded", trackIndex, deviceName]);

// ✅ CORRECT: Always convert numbers to strings for AbletonOSC
outlet(3, ["/live/track/set/input_routing_channel", trackIndex, String(channelNum)]);
```

## Validation

### Success Criteria
- [x] Outlet 3 sends to port 11000 correctly
- [x] Messages print as `v8-outlet-4` in Max console
- [x] Input routing channel is set correctly in Ableton Live
- [x] Track name is set correctly
- [x] No UDP port conflicts between Bridge and Max4Live
- [x] No Bridge routing errors in logs

### Testing Results
**Before fix**:
```
[BRIDGE] 🎯 Track event from Max observer: { address: '/live/track/set/input_routing_channel', args: [ 1, '3' ] }
[BRIDGE] 📤 Broadcasting to 1/1 clients: /live/track/set/input_routing_channel
```
❌ Message broadcast to UI, not sent to AbletonOSC

**After fix**:
```
Max console: v8-outlet-4: /live/track/set/input_routing_channel 1 3
Ableton Live: Track "Guitar" created with input routing channel 3
```
✅ Command sent directly to AbletonOSC port 11000, routing configured correctly

## Future Enhancements

### Potential Improvements
1. **Outlet wrapper functions**: Create helper functions like `sendToAbletonOSC()` to abstract outlet choice
2. **Type validation**: Add runtime checks to ensure correct argument types before sending
3. **Response handling**: Add outlet for AbletonOSC responses (if bidirectional communication needed)
4. **Error recovery**: Add timeout/retry logic for critical AbletonOSC commands

### Not Recommended
- ❌ Don't add more outlets unless absolutely necessary (complexity increases)
- ❌ Don't route everything through outlet 3 (maintain separation of concerns)
- ❌ Don't add bridge routing for outlet 3 messages (defeats the purpose)

## References

- [ADR-096: Abstracted Pedalboard Button Protocol](096-abstracted-pedalboard-button-protocol.md) - Original pedalboard implementation
- [AbletonOSC API Documentation](../AbletonOSC-API.md) - Line 285: `/live/track/set/input_routing_channel` specification
- [liveAPI-v6.js](../../ableton/scripts/liveAPI-v6.js) - Lines 12-34: Outlet configuration
- [enhanced-osc-bridge.js](../../interface/bridge/enhanced-osc-bridge.js) - Lines 527-531: maxObserver message handling
- [constants.json](../../config/constants.json) - Lines 69-74: OSC port configuration

## Related Decisions

- **ADR-096**: Pedalboard hold actions create tracks with routing (implementation that needed this fix)
- **ADR-107**: Guitar and Bass AU Plugin Migration (uses same routing channel 3)
- **ADR-095**: Pedalboard LED State Management (uses outlet 2 for LED feedback)

---

*This ADR establishes direct Max4Live → AbletonOSC communication via outlet 3, resolving command routing issues and improving system architecture clarity.*
