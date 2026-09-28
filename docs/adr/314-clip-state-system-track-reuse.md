# ADR-314: Clip State System for Intelligent Track Reuse

**Status**: Accepted
**Date**: 2026-02-09
**Supersedes**: N/A
**Related**: ADR-053 (Revert Track Pool to On-Demand Creation), ADR-076 (Track Creation Migration to Max4Live)

## Context

When loading an instrument from the browser, the system checks if the **selected track** can be reused (correct type, no clips). If not, it creates a new track. This leads to track accumulation even when empty tracks of the correct type exist elsewhere in the session.

For example:
- User is on Track 5 (has clips)
- Track 3 is empty MIDI track
- User loads a synth preset
- **Before**: Creates new Track 6
- **After**: Reuses Track 3

## Decision

Implement a "clip state system" that provides global awareness of track emptiness:

1. **New Store**: `clipStateStore.svelte.ts` - Maintains track summaries (type + has clips)
2. **Max4Live Query**: `queryTrackSummaries()` - Scans all tracks on demand
3. **Lazy Refresh**: Query triggered when browser opens (not continuous observers)
4. **Track Reuse Logic**: `shouldCreateTrackWithReuse()` checks store before creating

### Architecture

```
Browser Opens
    ↓
clipStateStore.requestRefresh()
    ↓
Send: /looping/session/query_track_summaries
    ↓
Max4Live queries all tracks (type, clips)
    ↓
Receive: /looping/session/track_summaries [trackCount, sceneCount, t0Type, t0HasSession, t0HasArr, ...]
    ↓
clipStateStore.handleTrackSummaries() populates emptyMidiTracks/emptyAudioTracks
    ↓
User selects preset
    ↓
shouldCreateTrackWithReuse() checks clipStateStore
    ↓
If empty track found → select it instead of creating new
```

### Message Format

```
/looping/session/track_summaries [
  trackCount,           // number of tracks
  sceneCount,           // number of scenes
  track0Type,           // 0 = MIDI, 1 = Audio
  track0HasSessionClips,    // 0 or 1
  track0HasArrangementClips, // 0 or 1
  track1Type,
  track1HasSessionClips,
  track1HasArrangementClips,
  ...
]
```

### Design Choices

1. **Query-on-open, not continuous observers**: Avoids overhead for rarely-needed data. Clip state only matters when making track decisions.

2. **Track 0 protected**: Excluded from reuse candidates to preserve "scratch track" convention.

3. **Pure `shouldCreateTrack()`**: Returns `reuseTrackIndex` in result object rather than mutating track selection internally. Caller handles selection, maintaining separation of concerns.

4. **Wrapper function pattern**: `shouldCreateTrackWithReuse()` wraps existing `shouldCreateTrack()` to add store lookup without modifying the original clip-checking logic.

5. **Sequencer ensured on reused tracks**: Since Permute auto-loads only on new track creation, we send `/looping/devices/ensure_sequencer` when reusing a track. Max4Live checks if Permute exists and loads it if missing.

## Consequences

### Positive

- Reduces track accumulation in sessions
- No continuous observer overhead
- Minimal changes to existing track preparation logic
- Foundation for future session grid view (Phase 2+)

### Negative

- Adds ~50ms latency when browser opens (query round-trip)
- Track state may be stale if clips created between browser open and preset load (acceptable for this use case)

### Risks

- Race condition if user opens/closes browser rapidly (mitigated by existing track prep cooldown)
- Max4Live query could be slow with 50+ tracks (breaks early on first clip found per track)

## Files Changed

| File | Change |
|------|--------|
| `interface/src/lib/stores/v6/clipStateStore.svelte.ts` | Created |
| `ableton/scripts/liveAPI-v6.js` | Added `queryTrackSummaries()`, `ensureSequencerOnTrack()` + handlers |
| `interface/src/lib/api/handlers/maxObserverHandler.ts` | Added message handler |
| `interface/src/lib/services/trackPreparation.ts` | Added `shouldCreateTrackWithReuse()`, ensure sequencer on reuse |
| `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` | Trigger refresh on open |

## Future Phases

- **Phase 2**: Full clip grid state (per-scene data) for session grid view
- **Phase 3**: Selected track observers for live updates during recording
- **Phase 4**: Session grid UI with clip launching

These phases can be added incrementally without breaking Phase 1 consumers.
