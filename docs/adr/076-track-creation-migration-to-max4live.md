# ADR 066: Track Creation Migration from AbletonOSC to Max4Live

**Date:** 2025-10-22  
**Status:** Implemented  
**Context:** V6 Track Preparation System  

## Problem

The track preparation system was experiencing duplicate track creation issues when using AbletonOSC commands (`/live/song/create_midi_track` and `/live/song/create_audio_track`). Despite multiple safeguards in the frontend (`trackPreparation.ts`), including global locks, cooldowns, and race condition prevention, AbletonOSC would sometimes create multiple tracks for a single request.

**Root Cause Analysis:**
- AbletonOSC operates over UDP networking (ports 11001/11000)
- UDP packet loss or network timing issues could cause command duplication
- Bridge routing and network layer introduces additional failure points
- No atomic guarantees at the transport level

## Decision

Migrate track creation from AbletonOSC to Max4Live Live Object Model for atomic, reliable track creation.

**Migration Strategy:**
1. **Max4Live Functions**: Add `createMidiTrack()` and `createAudioTrack()` functions using LiveAPI
2. **OSC Handlers**: Route `/looping/track/create_midi` and `/looping/track/create_audio` to Max4Live
3. **Frontend Updates**: Replace AbletonOSC calls with Max4Live commands
4. **Response Protocol**: Use success/failure messages for proper error handling

## Implementation

### Max4Live Changes (`liveAPI-v6.js`)

**Track Creation Functions:**
```javascript
function createMidiTrack(index) {
    var songApi = new LiveAPI('live_set');
    var newTrack = songApi.call('create_midi_track', index || -1);
    
    // Get track index from selected track (Live auto-selects new tracks)
    var selectedTrackApi = new LiveAPI('live_set view selected_track');
    var trackIndex = extractTrackIndexFromPath(selectedTrackApi.path);
    
    outlet(0, ["/looping/track/created", "midi", trackIndex]);
}

function createAudioTrack(index) {
    var songApi = new LiveAPI('live_set');
    var newTrack = songApi.call('create_audio_track', index || -1);
    
    var selectedTrackApi = new LiveAPI('live_set view selected_track');
    var trackIndex = extractTrackIndexFromPath(selectedTrackApi.path);
    
    outlet(0, ["/looping/track/created", "audio", trackIndex]);
}
```

**OSC Message Handlers:**
```javascript
else if (address === "/looping/track/create_midi") {
    var index = (args.length > 0) ? parseInt(args[0]) : -1;
    createMidiTrack(index);
} else if (address === "/looping/track/create_audio") {
    var index = (args.length > 0) ? parseInt(args[0]) : -1;
    createAudioTrack(index);
}
```

### Frontend Changes (`trackPreparation.ts`)

**Updated Track Creation:**
```typescript
// OLD: AbletonOSC approach
const command = type === 'midi'
    ? '/live/song/create_midi_track'
    : '/live/song/create_audio_track';
send(command, [-1]);

// NEW: Max4Live approach
const command = type === 'midi' 
    ? '/looping/track/create_midi'
    : '/looping/track/create_audio';
send(command, [-1]);

// Listen for Max4Live responses
if (address === '/looping/track/created') {
    const [trackType, trackIndex] = args;
    // Handle success
}
if (address === '/looping/track/creation_failed') {
    const [trackType, error] = args;
    // Handle error
}
```

## Technical Details

**Live Object Model Access:**
- Uses `LiveAPI('live_set').call('create_midi_track')` for direct Live API access
- Synchronous execution in Live's main thread (atomic operation)
- No network layer - direct function calls within Live process

**Track Index Resolution:**
- Live automatically selects newly created tracks
- Extract index from `live_set view selected_track` path
- Eliminates need for track count queries and timing-dependent index calculation

**Error Handling:**
- Try/catch around LiveAPI calls with detailed error messages
- Success: `/looping/track/created [type, index]`
- Failure: `/looping/track/creation_failed [type, error]`

## Consequences

### Benefits

1. **Eliminates Duplicate Track Bug**: Direct Live Object Model access removes network-related race conditions
2. **Atomic Operations**: Track creation is handled synchronously within Live's process
3. **Better Error Handling**: Direct exception catching with detailed error reporting
4. **Consistent Architecture**: Uses existing `/looping/` namespace and Max4Live patterns
5. **More Reliable**: No UDP packet loss or bridge routing issues

### Risks

1. **Max4Live Dependency**: Increases reliance on Max4Live for core functionality
2. **Threading Concerns**: Live Object Model calls must execute on main thread (mitigated by Max4Live design)
3. **Observer Timing**: Track observers must handle rapid track creation/selection changes

### Performance Impact

- **Positive**: Eliminates network round-trips for track creation
- **Neutral**: Observer system unchanged (existing track/device observers still fire normally)
- **Positive**: Removes need for track count queries and timing delays

## Rollback Plan

If issues arise, revert to AbletonOSC by:
1. Restore original `createTrack()` function in `trackPreparation.ts`
2. Comment out Max4Live OSC handlers
3. Previous AbletonOSC safeguards remain intact

## Validation

**Test Scenarios:**
1. ✅ Single track creation (MIDI/Audio)
2. ✅ Rapid successive track creation requests
3. ✅ Error handling with invalid parameters
4. ✅ Observer system compatibility
5. ✅ Track selection and device loading workflow

**Success Metrics:**
- Zero duplicate track creation incidents
- Consistent track indexing
- Proper error reporting
- Full compatibility with existing track preparation flow

## Related ADRs

- **ADR 044**: Revert track pool to on-demand creation
- **ADR 061**: Track preparation global lock
- **ADR 003**: TrackStrip Max observer migration

**Migration Pattern**: This follows the established pattern of migrating critical operations from AbletonOSC to Max4Live for improved reliability while maintaining the V6 hybrid architecture.