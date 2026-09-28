# ADR-332: Verify Track Reuse Candidates with Live Clip Checks

**Status**: Accepted
**Date**: 2026-03-20
**Supersedes**: Partially supersedes ADR-314 (Clip State System for Intelligent Track Reuse)

## Context

ADR-314 introduced `clipStateStore` to avoid track accumulation by reusing empty tracks. The store is populated when the browser opens via a Max4Live query, and `shouldCreateTrackWithReuse()` consults it before creating new tracks.

ADR-314 acknowledged a staleness risk: *"Track state may be stale if clips created between browser open and preset load."* This turned out to cause a data-loss bug in persistent browse mode:

1. User opens browser → `clipStateStore` refreshes → Track 2 is empty
2. `prepareTrack` creates/selects Track 2, user loads an instrument
3. User records a clip on Track 2 (browser stays open)
4. User clicks a second instrument → `shouldCreateTrack()` correctly detects Track 2 has clips → `shouldCreate: true`
5. **Bug**: `shouldCreateTrackWithReuse()` checks `clipStateStore.emptyMidiTracks` → still lists Track 2 as empty (stale) → returns `reuseTrackIndex: 2` → instrument replaces the recorded clip

The stale store **overrides** the correct live OSC query from `shouldCreateTrack()`, directing the system back to the track it just determined has clips.

## Decision

Verify each reuse candidate from `clipStateStore` with live OSC clip checks before returning it. Additionally, exclude the current track from candidates since `shouldCreateTrack()` already determined it has clips.

### Changes to `shouldCreateTrackWithReuse()`

```typescript
async function shouldCreateTrackWithReuse(requestedType): Promise<TrackCheckResult> {
    const baseResult = await shouldCreateTrack(requestedType);
    if (!baseResult.shouldCreate) return baseResult;

    const emptyTracks = requestedType === 'midi'
        ? clipStateStore.emptyMidiTracks
        : clipStateStore.emptyAudioTracks;

    // Exclude current track (already known to have clips)
    const candidates = emptyTracks.filter(idx => idx !== baseResult.currentTrackIndex);

    for (const reuseIndex of candidates) {
        // Verify with live OSC check
        const sceneCount = await getSceneCount();
        const hasSession = await trackHasSessionClips(reuseIndex, sceneCount);
        if (hasSession) continue;
        const hasArrangement = await trackHasArrangementClips(reuseIndex);
        if (hasArrangement) continue;

        return { shouldCreate: false, reuseTrackIndex: reuseIndex, ... };
    }

    // All candidates stale → create new track
    return baseResult;
}
```

### Supporting changes

- **Cooldown reduced** from 10s to 1.5s (`TRACK_PREP_COOLDOWN_MS`) — the original 10s cooldown was added for heavy sets but blocked legitimate sequential selections in browse mode.
- **Reset trackPrepManager before each preset load** in `handlePresetClick`, `handleGestureEnd`, and `loadRandomPresetFromFolder` — ensures track state is re-checked on every selection, not cached from browser open.

## Design Choices

1. **Live verification over eager refresh**: Rather than refreshing `clipStateStore` after every recording (which would require knowing when recording stops), we verify candidates on demand. The existing live OSC functions (`trackHasSessionClips`, `trackHasArrangementClips`) already exist and are fast (~500ms parallel).

2. **clipStateStore remains as a hint layer**: The store still narrows the search space. Without it, we'd have to check every track in the session. With it, we only verify the few candidates it suggests, falling back to track creation if all are stale.

3. **Current track excluded upfront**: `shouldCreateTrack()` already did a live check on the current track. Re-checking it via the reuse loop would be redundant and could return a false negative if the live check races with recording.

4. **In-progress lock preserved**: The `isPreparingTrack` lock still prevents concurrent track creation. Only the post-completion cooldown was reduced.

## Consequences

### Positive

- Eliminates the stale-store data-loss bug in persistent browse mode
- Works correctly regardless of how long the browser stays open
- No new infrastructure — reuses existing live clip check functions
- `clipStateStore` still provides value as a pre-filter

### Negative

- Slight latency increase when reusing tracks (~500ms for live verification per candidate)
- If `clipStateStore` has many stale candidates, each gets verified sequentially before falling through to creation

### Trade-offs

The latency cost is acceptable because:
- Track reuse candidates are typically 0–3 tracks
- The alternative (loading on a track with recorded clips) is a data-loss scenario
- Creating a new track (the fallback) takes ~1s anyway

## Files Changed

| File | Change |
|------|--------|
| `interface/src/lib/services/trackPreparation.ts` | Live verification in `shouldCreateTrackWithReuse()`, cooldown 10s → 1.5s |
| `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` | Reset trackPrepManager before each `ensureTrackPrepared()` call |
