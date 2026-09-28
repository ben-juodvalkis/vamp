# ADR 157: Sequencer State Persistence with pattr

**Date:** 2026-01-12
**Status:** Accepted
**Context:** Enabling sequencer patterns to save/restore with Ableton Live Sets

## Context

The sequencer device (v2.0) manages mute and pitch patterns, lengths, rates, and temperature. When users save a Live Set, they expect their carefully crafted patterns to persist. Without explicit state persistence, patterns revert to defaults on reload.

### Initial Approach (Failed)

Attempted to use Max for Live's standard `getvalueof()`/`setvalueof()` mechanism via the v8 JavaScript object:

```javascript
// Doesn't work with v8 objects
function getvalueof() {
    return JSON.stringify(state);
}

function setvalueof(data) {
    state = JSON.parse(data);
}
```

**Why it failed:**
- v8 objects don't support `getvalueof()`/`setvalueof()` binding with pattr
- Even with `@parameter_enable 1`, the functions are never called
- Cycling '74 forums confirm this is a known limitation
- Freezing the device works but is undesirable during development

## Decision

Implement explicit message-based state persistence using the **existing 30-arg broadcast format**:

### Architecture

```
                    ┌─────────────────────────────────────┐
                    │           Max Patch                  │
                    │                                      │
 v8 outlet 0        │  [route state_broadcast pattr_state] │
      │             │         │                │           │
      └─────────────┼─────────┘                │           │
                    │         │                │           │
                    │         v                v           │
                    │    (to OSC)    [pattr seq_state]     │
                    │                 @parameter_enable 1  │
                    │                         │            │
                    │                  (left outlet)       │
                    │                   on Live Set load   │
                    │                         │            │
                    │                         v            │
                    │              [prepend restoreState]  │
                    │                         │            │
                    │                         v            │
                    │                   v8 inlet           │
                    └─────────────────────────────────────┘
```

### State Format

Reuse the existing 30-arg broadcast format (no JSON serialization):

```
[trackIndex, mutePattern[8], muteLength, muteBars, muteBeats, muteTicks,
 mutePosition, muteEnabled, pitchPattern[8], pitchLength, pitchBars,
 pitchBeats, pitchTicks, pitchPosition, pitchEnabled, temperature]
```

### Implementation

**1. Output state to pattr on every broadcast:**

```javascript
// In broadcastState()
function broadcastState() {
    var args = ["state_broadcast", trackIndex, /* ... 29 more args */];
    outlet.apply(null, [0].concat(args));

    // Also output for pattr storage (same format, different prefix)
    var pattrArgs = ["pattr_state"].concat(args.slice(1));
    outlet.apply(null, [0].concat(pattrArgs));
}
```

**2. Restore state on Live Set load:**

```javascript
function restoreState() {
    var args = arrayfromargs(arguments);
    if (args.length < 30) return;

    var idx = 1;  // Skip trackIndex

    // Restore mute pattern (8 steps)
    for (var i = 0; i < 8; i++) {
        sequencer.sequencers.muteSequencer.pattern[i] = parseInt(args[idx++]);
    }
    // Restore mute length and division
    sequencer.sequencers.muteSequencer.patternLength = parseInt(args[idx++]);
    sequencer.sequencers.muteSequencer.division = [
        parseInt(args[idx++]), parseInt(args[idx++]), parseInt(args[idx++])
    ];
    idx += 2;  // Skip position and enabled

    // Restore pitch pattern (8 steps)
    for (var i = 0; i < 8; i++) {
        sequencer.sequencers.pitchSequencer.pattern[i] = parseInt(args[idx++]);
    }
    // Restore pitch length and division
    sequencer.sequencers.pitchSequencer.patternLength = parseInt(args[idx++]);
    sequencer.sequencers.pitchSequencer.division = [
        parseInt(args[idx++]), parseInt(args[idx++]), parseInt(args[idx++])
    ];
    idx += 2;  // Skip position and enabled

    // Restore temperature
    sequencer.temperatureValue = parseFloat(args[idx++]);

    // Broadcast to sync UI
    sequencer.broadcastState();
}
```

**3. Max patch routing:**

```
[v8 sequencer-device.js]
        │
[route state_broadcast pattr_state]
        │                │
        v                v
   (to OSC)      [pattr seq_state @parameter_enable 1]
                         │
                  (left outlet - on load)
                         │
                 [prepend restoreState]
                         │
                         v
                 [v8 inlet]
```

## Consequences

### Positive

1. **Works without freezing:** Development workflow preserved
2. **Reuses existing format:** No new serialization logic needed
3. **Always current:** State updates on every change, not just on save
4. **Simple implementation:** ~30 lines of JS, minimal Max patching
5. **UI sync on load:** Broadcast after restore syncs frontend state

### Trade-offs

1. **Extra messages:** Every broadcast sends both `state_broadcast` and `pattr_state`
2. **Parse overhead:** `restoreState()` must parse the 30-arg list

### Why Not JSON?

User asked: "why do we need json and all that. isn't the broadcast state just a simple list?"

Correct. The existing broadcast format is a flat list of numbers:
- No serialization overhead
- No parsing errors
- pattr handles lists natively
- Same format used everywhere (OSC, pattr, restore)

## Alternatives Considered

1. **`getvalueof()`/`setvalueof()`** - Doesn't work with v8 objects
2. **Freeze device** - Breaks development workflow
3. **JSON serialization** - Unnecessary complexity
4. **Separate pattr per value** - 30+ pattr objects vs 1

## Files Modified

- `ableton/M4L devices/sequencer-device.js` - Added `pattr_state` output, `restoreState()` function
- `ableton/M4L devices/Sequencer.maxpat` - Added route and pattr wiring

## Related ADRs

- ADR 096: Sequencer Device v2.0 Architecture
- ADR 062: Sequencer Position OSC Messages
