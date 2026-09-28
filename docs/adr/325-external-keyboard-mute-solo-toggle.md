# ADR-325: External Keyboard Mute/Solo Toggle

**Status**: Accepted
**Date**: 2026-03-16

## Context

The Max Utility 1.0 patch already routes MIDI from the external keyboard to port 11002 via `/looping/learnexternal_keyboard_mod` with an integer argument (MIDI note number). However, no handler existed in `liveAPI-v6.js` to process these messages. During live performance, being able to quickly mute/solo tracks from the external keyboard without touching the iPad interface is valuable.

## Decision

Add a handler in `liveAPI-v6.js` that maps MIDI note ranges to track mute/solo toggles:

| MIDI Notes | Action | Tracks |
|------------|--------|--------|
| 48-59 | Toggle mute | Tracks 0-11 |
| 60-72 | Toggle solo | Tracks 0-12 |

Toggle reads the current state from Ableton's LiveAPI, inverts it, and writes it back.

**Superseded by ADR-333**: Replaced with white-key pitch-class mapping (octave-agnostic, mute only, 7 tracks).

## Architecture

```
External Keyboard → Max Utility 1.0 → udpsend 127.0.0.1 11002
                                        │
                                        ▼
                                   [udpreceive 11002]
                                        │
                                        ▼
                                   liveAPI-v6.js
                                        │
                    /looping/learnexternal_keyboard_mod [note]
                                        │
                            ┌───────────┴───────────┐
                            │                       │
                     48-59: mute              60-72: solo
                            │                       │
                    get("mute") → invert    get("solo") → invert
                    set("mute", new)        set("solo", new)
                            │                       │
                            ▼                       ▼
                    outlet: toggled          outlet: toggled
```

Direct Max-to-Max communication on port 11002 — no bridge involved.

## Implementation

**File modified**: `ableton/scripts/liveAPI-v6.js`

1. **Message route** added to the dispatcher (after learn mode routes):
   ```javascript
   else if (address === "/looping/learnexternal_keyboard_mod") {
       if (args.length >= 1) {
           handleExternalKeyboardMod(parseInt(args[0]));
       }
   }
   ```

2. **Handler function** `handleExternalKeyboardMod(midiNote)`:
   - Uses existing `getTrackPath()` and global `queryApi`
   - Follows the `toggleSessionRecord()` pattern: `get()` → invert → `set()`
   - Sends outlet confirmations: `/looping/track/mute/toggled` and `/looping/track/solo/toggled`

## Reused Patterns

- `getTrackPath(trackIndex)` — existing helper for track path resolution
- `queryApi.get()`/`queryApi.set()` — standard LiveAPI property access
- `toggleSessionRecord()` toggle pattern — get current, invert, set back
- `setTrackMute()`/`setTrackSolo()` — existing setters for reference

## OSC Protocol

| Address | Direction | Args | Description |
|---------|-----------|------|-------------|
| `/looping/learnexternal_keyboard_mod` | To Max | `[int]` | MIDI note (48-72) |
| `/looping/track/mute/toggled` | From Max | `[trackIndex, 0\|1]` | Mute toggle confirmation |
| `/looping/track/solo/toggled` | From Max | `[trackIndex, 0\|1]` | Solo toggle confirmation |

## Consequences

### Positive
- No interface changes required — existing track observers handle UI updates
- Direct port 11002 communication keeps latency minimal
- Reuses all existing infrastructure
- Simple MIDI note mapping is easy to remember during performance

### Negative
- MIDI notes 48-72 are reserved for mute/solo when external keyboard is active
- Track count is fixed (12 mute, 13 solo) — sufficient for current setup
