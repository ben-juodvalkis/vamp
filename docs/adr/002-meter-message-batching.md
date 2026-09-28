# ADR 002: Meter Message Batching

**Status**: Superseded by ADR-004
**Superseded Date**: 2025-10-04
**Original Date**: 2025-10-04
**Decision Makers**: Architecture Team
**Tags**: performance, websocket, meters, optimization

> **Note**: This ADR has been superseded. The meter batching implementation was removed when the system migrated from AbletonOSC listeners to Max4Live LiveAPI Mode 1 observers (ADR-004). Meters now flow through `/looping/track/property` messages from Max4Live, eliminating the need for bridge-level batching. See [Cleanup PR #213](https://github.com/ben-juodvalkis/Looping/pull/213) for the removal.

## Context

Track meters update at ~60 FPS (every 16ms) to provide real-time visual feedback. With multiple tracks, this creates a WebSocket message flood:

- **Per Track**: 60 messages/second from AbletonOSC
- **20 Tracks**: 1,200 individual WebSocket messages/second
- **Each Message**: Bridge → WebSocket → Client → CustomEvent → Handler → State Update → UI Render

This high-frequency messaging was causing:
1. **Bandwidth waste**: Each meter sends individual JSON message (~80 bytes × 1,200 = ~100KB/sec)
2. **Event handler overhead**: Every TrackStrip processes all 1,200 events, filtering for its own trackIndex
3. **Unnecessary serialization**: 1,200 JSON.stringify() and JSON.parse() operations per second

## Decision

Implement **bridge-level batching** with 16ms time windows to collect meter updates and send as single batch message.

### Architecture

```
Individual Meters → Bridge Queue (16ms window) → Single Batch Message → All Tracks Update
```

### Implementation

**1. Bridge Batching Queue** (`enhanced-osc-bridge.js`):
- Intercept `/live/track/get/output_meter_left [trackIndex, level]` messages
- Queue in Map: `trackIndex → level` (overwrites duplicate updates in same window)
- Flush every 16ms as `/live/meters/batch [track0, level0, track1, level1, ...]`

**2. Client Batch Parser** (`simpleClient.ts`):
- Detect `/live/meters/batch` address
- Parse flat array into `Map<trackIndex, level>`
- Dispatch `osc-meters-batch` custom event (single event for all meters)

**3. Component Batch Listener** (`useTrackOSC.ts`):
- Listen to `osc-meters-batch` events
- Extract own meter value: `meters.get(oscIndex)`
- Keep individual listener as fallback for backwards compatibility

## Alternatives Considered

### Option 1: Client-Side RAF Throttling
- **Approach**: Use `requestAnimationFrame` to throttle UI updates
- **Rejected**: Still sends 1,200 messages over WebSocket, only delays rendering
- **Bandwidth**: No savings (100KB/sec unchanged)

### Option 2: Dedicated Meter WebSocket Channel
- **Approach**: Separate WebSocket port for high-frequency meter traffic
- **Rejected**: Over-engineered for current scale, maintenance overhead
- **Complexity**: Two WebSocket connections, routing logic

### Option 3: Reduce Listener Frequency
- **Approach**: Only subscribe meters for visible tracks, reduce update rate
- **Rejected**: All tracks always visible in this app
- **Deferred**: Could combine with batching for future optimization

### Option 4: Include Master Track in Batch
- **Approach**: Batch Max4Live master meter with AbletonOSC regular track meters
- **Rejected**:
  - Requires mixing two different message sources (AbletonOSC + Max4Live)
  - Different formats: `/tracks/master/meter` vs `/live/track/get/output_meter_left`
  - Master is only 1 track (60 msg/sec) - negligible performance impact
  - AbletonOSC doesn't support master track (uses index -1 but not implemented)

## Consequences

### Positive

✅ **95% Message Reduction**
- Before: 1,200 WebSocket messages/sec (20 tracks)
- After: 60 batched messages/sec
- Result: 20× fewer messages

✅ **95% Bandwidth Reduction**
- Before: ~100KB/sec (individual JSON messages)
- After: ~5KB/sec (batched arrays)
- Result: 20× less network traffic

✅ **95% Event Handler Reduction**
- Before: Each TrackStrip processes 1,200 events, filters 1,140
- After: Each TrackStrip processes 60 batch events, extracts 1
- Result: Minimal filtering overhead

✅ **Maintained Visual Quality**
- Still 60 FPS update rate (16ms batching window)
- No perceived latency increase
- Smooth meter animations preserved

✅ **Clean Separation**
- Regular tracks: Batched via AbletonOSC
- Master track: Individual via Max4Live (legacy, minimal impact)
- Migration path preserved for future AbletonOSC master support

### Negative

⚠️ **Complexity Increase**
- New batching queue in bridge with timer management
- New custom event type `osc-meters-batch`
- Dual listeners in TrackStrip (batch + individual fallback)

⚠️ **Minimal Latency**
- Up to 16ms batching delay (one frame @ 60 FPS)
- Imperceptible to users, acceptable trade-off

⚠️ **Master Track Not Batched**
- Still sends 60 individual messages/sec
- Acceptable since it's only 1 track vs 20
- Avoids mixing Max4Live + AbletonOSC in same batch

### Risks

🔍 **Timer Accuracy**
- JavaScript `setTimeout` not guaranteed precise timing
- Mitigation: 16ms is a guideline, slight variance acceptable

🔍 **Queue Memory**
- Map grows with track count, cleared every 16ms
- Mitigation: Negligible memory (<1KB for 100 tracks)

## Performance Validation

### Metrics (20 Tracks)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| WebSocket Messages/sec | 1,200 | 60 | 95% ↓ |
| Custom Events/sec | 1,200 | 60 | 95% ↓ |
| Bandwidth | ~100KB/sec | ~5KB/sec | 95% ↓ |
| Event Handler Calls/Track | 1,200 (filter 1,140) | 60 (extract 1) | 95% ↓ |
| Visual Update Rate | 60 FPS | 60 FPS | Same |
| Perceived Latency | ~5ms | ~10ms | +5ms (imperceptible) |

### Master Track Impact

- **Messages**: 60/sec (unchanged)
- **Percentage of Total**: 5% of original traffic
- **Decision**: Not worth complexity of batching

## References

- [Bridge Implementation](../../interface/bridge/enhanced-osc-bridge.js#L337-L376)
- [Client Parser](../../interface/src/lib/api/simpleClient.ts#L544-L561)
- [TrackStrip Listener](../../interface/src/lib/components/v6/tracks/TrackStrip/hooks/useTrackOSC.ts#L21-L34)
- [Phase 3 Track System Spec](../docs-archive/v6-abletonOSC/phase-3/SPEC.md)

## Notes

- Implementation completed in single session (2025-10-04)
- No breaking changes - backward compatible with individual meter messages
- Future: Could extend batching to other high-frequency messages (device parameters)
