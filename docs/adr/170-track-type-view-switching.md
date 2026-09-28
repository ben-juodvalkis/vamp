# ADR-170: Track Type View Switching

**Status**: Accepted
**Date**: 2026-01-23
**Issue**: [#270](https://github.com/ben-juodvalkis/Looping/issues/270)

## Context

When switching tracks, the UI showed the wrong central view due to a race condition:

1. User taps track → `showCurrentInstrument()` called immediately
2. Shows previous track's instrument (stale cache)
3. Device list arrives ~30-80ms later
4. Track type info (`has_midi_input`/`has_audio_input`) arrives ~100-200ms later via separate query
5. View decision was already made with stale/missing data

The coordinator had no concept of track type, and track type was queried separately from the device list.

## Decision

### Include Track Type in Complete State Message

Modify the `/looping/devices/complete_state` message to include track type atomically with the device list:

**Message format change:**
```
Before: [address, trackIndex, deviceCount, ...devices]
After:  [address, trackIndex, hasMidiInput, hasAudioInput, deviceCount, ...devices]
```

### Track-Type-Aware View Logic

The coordinator now uses track type to determine the appropriate view:

- **Audio track**: Always show clip view (audio tracks can't have instruments)
- **MIDI track with instrument**: Show instrument view
- **MIDI track without instrument**: Show clip view

### One-Shot View Suppression

When users explicitly choose a view (e.g., tapping mini sequencer), the coordinator respects that choice by suppressing auto-switching for the next `complete_state` message.

```typescript
private skipNextAutoViewSwitch: boolean = false;

suppressAutoViewSwitch() {
  this.skipNextAutoViewSwitch = true;
}

handleTrackChange(...) {
  const isViewOverrideActive = this.skipNextAutoViewSwitch;
  if (isViewOverrideActive) {
    this.skipNextAutoViewSwitch = false; // Consume (one-shot)
  }
  // Skip auto view switch if flag was set
}
```

This is cleaner than a timeout-based approach because:
- No magic timeout numbers
- Override applies exactly once
- Clearer intent ("skip next" vs "skip for N ms")
- No timing race conditions

## Consequences

### Positive
- View switching is now deterministic and correct
- No flash of wrong view when switching tracks
- User explicit choices are respected
- Removed redundant track type queries from session store

### Negative
- Breaking change to OSC message format (internal only)

## Files Modified

| File | Changes |
|------|---------|
| `ableton/scripts/liveAPI-v6.js` | Query track type, include in message |
| `interface/src/lib/api/handlers/oscTypeHelpers.ts` | Parse new fields |
| `interface/src/lib/api/handlers/maxObserverHandler.ts` | Pass new fields to store |
| `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` | Store track type, add getters |
| `interface/src/lib/services/instrumentDisplayCoordinator.svelte.ts` | Track-type-aware view logic, one-shot suppression |
| `interface/src/lib/components/v6/tracks/composables/useTrackData.svelte.ts` | Call suppressAutoViewSwitch on explicit view choice |
| `interface/src/lib/stores/session.svelte.ts` | Remove redundant track type code |
| `interface/src/lib/api/handlers/abletonOSCHandler.ts` | Remove individual track type handlers |
