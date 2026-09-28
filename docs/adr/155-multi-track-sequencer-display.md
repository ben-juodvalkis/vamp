# ADR-155: Multi-Track Sequencer State Broadcasting

## Status
Accepted

## Context
The sequencer device (M4L) previously only communicated with the central clip view when a track was selected. Users had no visibility into sequencer state across multiple tracks simultaneously. This made it difficult to see at a glance which tracks had active sequencer patterns and their current playback position.

## Decision
Implement per-track sequencer state broadcasting via OSC, with a MiniSequencer display component at the bottom of each TrackStrip.

### Architecture

**Data Flow:**
```
M4L sequencer-device.js
    │ outlet(0, "state_broadcast", trackIndex, ...args)
    ▼
Max Patch (Sequencer.maxpat)
    │ [route state_broadcast] → [prepend /looping/sequencer/state] → [udpsend 11003]
    ▼
Enhanced OSC Bridge (port 11003)
    │ routes to maxObserverHandler
    ▼
maxObserverHandler.ts
    │ window.dispatchEvent(new CustomEvent('sequencer-state', { detail }))
    ▼
useTrackData.svelte.ts (per TrackStrip instance)
    │ window.addEventListener('sequencer-state', handler)
    │ if (e.detail.trackIndex === trackIndex) sequencerState = e.detail.state
    ▼
MiniSequencer.svelte (in TrackStrip)
```

**OSC Message Format (23 args):**
```
/looping/sequencer/state [trackIndex, mutePattern[8], muteLength, mutePos, muteEnabled, pitchPattern[8], pitchLength, pitchPos, pitchEnabled]
```

### Key Decisions

1. **Per-instance state via CustomEvents** - Each TrackStrip filters events by trackIndex rather than using a centralized store. This matches the existing `useTrackData` pattern and provides automatic cleanup on unmount.

2. **Combined message format** - Single 23-arg message per update instead of multiple smaller messages. Reduces OSC traffic and ensures atomic state updates.

3. **Display-only MiniSequencer** - 50px component at bottom of TrackStrip. Tap selects track and shows clip central view (not instrument view).

4. **Dynamic step count** - MiniSequencer renders only `length` active steps (2-8). Steps use `flex: 1` to expand and fill available width, matching SequencerPatternGrid behavior.

5. **Ghost state** - Tracks without sequencer devices show a subtle placeholder with dashed borders (orange for mute row, blue for pitch row).

## Consequences

### Positive
- Users can see sequencer state across all tracks at a glance
- Current playback position visible on all tracks simultaneously
- Pattern length differences visually apparent
- Natural integration with existing TrackStrip layout
- No polling required - real-time updates at musical rate

### Negative
- Increased OSC traffic (one message per track per step change during playback)
- Additional complexity in M4L device and Max patch routing

### Neutral
- Existing `/looping/sequencer/mute/position` flow unchanged for selected track editing
- `sequencerStore` remains the source of truth for the central clip view editor

## Files Modified

1. `ableton/M4L devices/sequencer-device.js` - TrackState.index, broadcastState()
2. `ableton/M4L devices/Sequencer.maxpat` - OSC routing for state_broadcast
3. `interface/src/lib/api/handlers/maxObserverHandler.ts` - CustomEvent dispatch
4. `interface/src/lib/components/v6/tracks/composables/useTrackData.svelte.ts` - Per-instance state
5. `interface/src/lib/components/v6/tracks/TrackStrip/components/MiniSequencer.svelte` (NEW)
6. `interface/src/lib/components/v6/tracks/TrackStrip.svelte` - Layout integration
