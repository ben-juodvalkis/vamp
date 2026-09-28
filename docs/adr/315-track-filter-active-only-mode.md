# ADR-315: Track Filter - Active Only Mode

**Status**: Accepted
**Date**: 2026-02-09
**Related**: ADR-314 (Clip State System for Intelligent Track Reuse)

## Context

With the clip state system (ADR-314) already tracking which tracks have clips, users requested a way to reduce visual clutter in the track panel by hiding empty tracks they're not actively working with.

Sessions can accumulate many tracks over time, making navigation and selection cumbersome. Most of the time, users only care about:
1. The track they're currently working on
2. Tracks that have recorded content

## Decision

Add a track filter mode to the clip state store with a toggle in SystemCentralView:

### Filter Modes

1. **'all'** - Show all tracks (original behavior)
2. **'active'** - Show only:
   - Track 0 (always visible - "scratch track" convention)
   - Currently selected track
   - Tracks with clips (session or arrangement)

### Default Mode

The default is **'active'** mode, as it provides immediate value for the common use case of working in sessions with many accumulated tracks.

### Architecture

```
User toggles filter mode
    ↓
clipStateStore.filterMode = 'active' | 'all'
    ↓
TracksPanelV6.svelte reacts via $derived
    ↓
visibleTracks = clipStateStore.getVisibleTracks(numTracks, selectedTrackIndex)
    ↓
Only visible tracks are rendered
```

### Implementation

**clipStateStore additions:**
```typescript
let _filterMode = $state<'all' | 'active'>('active');

get filterMode() { return _filterMode; }
set filterMode(value) { _filterMode = value; }

getVisibleTracks(totalTracks: number, selectedTrackIndex: number): number[] {
  if (_filterMode === 'all') {
    return Array.from({ length: totalTracks }, (_, i) => i);
  }

  const visible = new Set<number>();
  visible.add(0);  // Track 0 always visible
  visible.add(selectedTrackIndex);  // Selected track always visible

  for (const [index, summary] of _trackSummaries) {
    if (summary.hasSessionClips || summary.hasArrangementClips) {
      visible.add(index);
    }
  }

  return Array.from(visible).sort((a, b) => a - b);
}
```

### Refresh Strategy

**Automatic on track change**: When the user selects a different track, the previous track's clip state is queried. This ensures tracks with newly recorded clips remain visible in 'active' filter mode.

```
User on Track 3 → records clip → selects Track 5
    ↓
handleTrackSelectionUpdate() detects oldTrack = 3
    ↓
clipStateStore.requestSingleTrackRefresh(3)
    ↓
/looping/session/query_single_track [3]
    ↓
Max4Live queries track 3's clip state
    ↓
/looping/session/single_track_summary [3, type, hasSession, hasArrangement]
    ↓
clipStateStore updates _trackSummaries for track 3
    ↓
Track 3 remains visible (now has clips)
```

Additionally:
- Full refresh when browser opens
- Toggle to 'all' mode to see everything

## Consequences

### Positive

- Reduces visual clutter in sessions with many tracks
- Track 0 always visible preserves "scratch track" workflow
- Selected track always visible ensures user context is maintained
- Leverages existing clipStateStore infrastructure
- Reactive filtering via Svelte 5 runes - immediate UI response
- **Tracks with newly recorded clips stay visible** after switching away

### Negative

- Stale state possible if clips are added outside the interface (e.g., directly in Ableton)
- Users must toggle to 'all' to see all tracks

### Trade-offs

- Default to 'active' mode: Provides immediate value but may initially confuse users expecting all tracks
- Manual refresh only: Simpler implementation, acceptable given clip editing happens on visible tracks

## Files Changed

| File | Change |
|------|--------|
| `interface/src/lib/stores/v6/clipStateStore.svelte.ts` | Added `filterMode`, `getVisibleTracks()`, `requestSingleTrackRefresh()`, `handleSingleTrackSummary()` |
| `interface/src/lib/components/v6/layout/TracksPanelV6.svelte` | Use `getVisibleTracks()` instead of showing all tracks |
| `interface/src/lib/components/v6/central/views/SystemCentralView.svelte` | Added "Active Only" toggle button |
| `interface/src/lib/stores/session.svelte.ts` | Trigger single track refresh when leaving a track |
| `interface/src/lib/api/handlers/maxObserverHandler.ts` | Handler for `/looping/session/single_track_summary` |
| `ableton/scripts/liveAPI-v6.js` | Added `querySingleTrackSummary()` function + OSC handler |
