# ADR-183: Session State via Max4Live

## Status
Accepted

## Context

Session state (tempo, time signature, transport, metronome, loop, groove) was previously queried and observed via AbletonOSC. However, AbletonOSC's `get` queries are unreliable - they don't always return values, especially after a page refresh. The `start_listen` commands work for real-time updates, but initial state queries fail silently.

This caused issues where:
- Time signature showed default 4/4 after refresh instead of actual value
- Loop brace snapped incorrectly because `beatsPerBar` was wrong
- Tempo and other session values were stale until user changed them in Ableton

## Decision

Move all session state management from AbletonOSC to Max4Live:

1. **Max4Live observers** for real-time updates (tempo, time sig, transport, metronome, loop, groove, session record)
2. **`/looping/query/session`** handler for initial state query
3. **`/looping/session/state`** batch message with all session properties
4. **Individual `/looping/session/*` messages** for real-time changes

AbletonOSC is now only used for:
- **Commands** (`/live/song/set/*`) to change Live's state
- **Selected scene listener** (Max doesn't observe this)

## Implementation

### Max4Live (liveAPI-v6.js)

Added `sessionObservers` object with LiveAPI observers for:
- `tempo`
- `is_playing`
- `signature_numerator`
- `signature_denominator`
- `metronome`
- `loop`
- `loop_start`
- `loop_length`
- `groove_amount`
- `session_record`

Added functions:
- `initializeSessionObservers()` - Creates observers on init
- `querySessionState()` - Sends batch state message
- `cleanupSessionObservers()` - Cleanup on exit

### UI (interface)

**maxObserverHandler.ts:**
- Added `handleSessionStateBatch()` for `/looping/session/state`
- Added handlers for individual `/looping/session/*` messages

**simpleClient.ts:**
- `requestSessionData()` now queries Max (`/looping/query/session`) instead of AbletonOSC
- `startSessionListeners()` reduced to only `/live/view/start_listen/selected_scene`
- `stopSessionListeners()` correspondingly reduced

## Message Format

### Batch message (`/looping/session/state`)
```
tempo, 120.0,
is_playing, 1,
signature_numerator, 4,
signature_denominator, 4,
metronome, 0,
loop, 1,
loop_start, 0,
loop_length, 16,
groove_amount, 0,
session_record, 0
```

### Individual update messages
- `/looping/session/tempo [float]`
- `/looping/session/is_playing [0|1]`
- `/looping/session/signature_numerator [int]`
- `/looping/session/signature_denominator [int]`
- `/looping/session/metronome [0|1]`
- `/looping/session/loop [0|1]`
- `/looping/session/loop_start [float]`
- `/looping/session/loop_length [float]`
- `/looping/session/groove_amount [float]`
- `/looping/session/session_record [0|1]`

## Consequences

### Positive
- Reliable initial state on page refresh
- Single source of truth for Live state (Max4Live)
- Consistent with existing track/device state architecture
- No more silent failures from AbletonOSC get queries

### Negative
- More code in Max4Live script
- Slightly more bridge traffic (minimal impact)

## Files Changed
- `ableton/scripts/liveAPI-v6.js` - Added session observers and query handler
- `interface/src/lib/api/handlers/maxObserverHandler.ts` - Added session message handlers
- `interface/src/lib/api/simpleClient.ts` - Query Max instead of AbletonOSC
- `interface/src/lib/stores/session.svelte.ts` - Simplified time signature handler (from ADR-182)
