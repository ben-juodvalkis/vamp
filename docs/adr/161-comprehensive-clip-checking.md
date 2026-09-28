# ADR 161: Comprehensive Clip Checking for Track Reuse

**Date:** 2026-01-16
**Status:** Accepted
**Context:** Enhance track preparation to check all session scenes and arrangement clips before reusing a track

## Problem

When opening the browser or choosing an instrument, the system checks if the current track can be reused (is empty and matches the requested type). Previously, `shouldCreateTrack()` only checked **scene 0** for clips:

```typescript
// Old implementation - only checked scene 0
send('/live/clip_slot/get/has_clip', [trackIndex, 0]);
```

This caused issues when:
1. A track had clips in scenes 1-7 but scene 0 was empty - track would be reused and clips lost
2. A track had clips in arrangement view but no session clips - track would be reused and arrangement lost

## Decision

### Check All Session View Scenes (Parallel)

Query all scenes in parallel for performance (500ms total vs N × 500ms sequential):

```typescript
async function trackHasSessionClips(trackIndex: number, sceneCount: number): Promise<boolean> {
    // Check all scenes in parallel using Promise.all
    const checks = Array.from({ length: sceneCount }, (_, sceneIndex) =>
        queryClipSlot(trackIndex, sceneIndex)
    );

    const results = await Promise.all(checks);
    return results.some(r => r.hasClip);
}
```

### Check Arrangement View Clips

Use `/live/track/get/arrangement_clips/name` API (available since Live 11.0) to check for arrangement clips:

```typescript
async function trackHasArrangementClips(trackIndex: number): Promise<boolean> {
    // Response format: [track_index, name1, name2, ...]
    // If only track_index is returned (args.length === 1), no clips
    const response = await query('/live/track/get/arrangement_clips/name', [trackIndex]);
    return response.args.length > 1;
}
```

### Updated shouldCreateTrack() Flow

1. Get selected track index
2. Get track type (MIDI/audio)
3. Check for type mismatch → create new track if mismatched
4. Get scene count via `/live/song/get/num_scenes`
5. Check all session scenes for clips → create new track if any clips found
6. Check arrangement clips → create new track if any clips found
7. Only if all checks pass → reuse the empty track

## Rationale

### Why Check All Scenes?

The cleanup feature in `SystemCentralView.svelte` already implemented comprehensive scene checking via `trackHasClips()`. Track preparation should use the same thoroughness to avoid data loss.

### Why Check Arrangement?

Users may:
- Record directly into arrangement view
- Consolidate session clips to arrangement
- Import audio/MIDI directly to arrangement timeline

Without arrangement checking, these clips would be silently lost when loading a new instrument on the track.

### Performance Considerations

- **Parallel scene checking:** All scenes queried simultaneously via Promise.all
- **8 scenes = ~500ms** worst case (single timeout period, not N × timeout)
- **16 scenes = ~500ms** (same - parallel execution)
- **Arrangement check:** Single query, ~500ms

Total worst-case delay for empty track: ~1.5 seconds (scene count + scene check + arrangement check).

### Safer Timeout Defaults

On timeout, assume clips **exist** (resolve `true`) rather than assuming they don't:

```typescript
// Timeout - assume clips exist to prevent data loss
resolve({ sceneIndex, hasClip: true }); // Safer default
```

This conservative approach means network issues or slow Ableton response will create a new track rather than risk overwriting existing clips.

## Consequences

### Positive

1. **Data safety:** Clips in non-zero scenes and arrangement are protected
2. **Consistent behavior:** Track preparation now uses same thoroughness as cleanup
3. **User confidence:** Users can trust that loading instruments won't lose work
4. **Clear logging:** Debug logs show which scene/arrangement triggered new track creation

### Negative

1. **Increased latency:** Empty track detection takes longer (~1.5s vs ~100ms)
2. **More OSC traffic:** Multiple queries per track check (mitigated by parallel execution)
3. **Conservative timeouts:** May create unnecessary new tracks on network issues (acceptable trade-off for data safety)

### Neutral

1. **No API changes:** Uses existing AbletonOSC endpoints
2. **Backward compatible:** Falls back gracefully on timeout (creates new track)

## Files Modified

- `interface/src/lib/services/trackPreparation.ts`
  - Added `getSceneCount()` - queries `/live/song/get/num_scenes`
  - Added `trackHasSessionClips()` - checks all scenes in parallel via Promise.all
  - Added `trackHasArrangementClips()` - queries `/live/track/get/arrangement_clips/name`
  - Refactored `shouldCreateTrack()` to use async/await with comprehensive checks
  - Changed timeout behavior to assume clips exist (safer default)

- `interface/src/__tests__/unit/services/trackPreparation.test.ts`
  - Added unit tests for clip checking behavior
  - Tests for timeout behavior, OSC message routing, performance characteristics

## Related

- `SystemCentralView.svelte` - Has existing `trackHasClips()` function for cleanup feature
- AbletonOSC API: `/live/track/get/arrangement_clips/name` (Live 11.0+)
- AbletonOSC API: `/live/clip_slot/get/has_clip`
- AbletonOSC API: `/live/song/get/num_scenes`
