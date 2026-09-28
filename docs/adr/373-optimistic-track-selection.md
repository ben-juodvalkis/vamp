# ADR-373: Optimistic Track Selection

## Status
**Accepted**

## Context

Clicking a track in the strip produced a ~300ms lag before the highlight and
central view updated. The root cause was the "trust-the-echo" pattern: the UI
sent `/looping/v3/track/select` to Ableton, waited for the Python surface to
write `song.view.selected_track`, waited for Live's own observer to fire,
waited through a 50 ms coalesce window in `SelectedTrackComponent`, and only
then updated `session.selectedTrackIndex` and `selectedTrackStore._trackIndex`
when the `/looping/v3/selected_track` echo arrived.

The v3 `state/full` accept bundle (sent on every handshake) covers all tracks
with their full device + param trees. Per-selection scoped `state/full` merges
into the existing tree without replacing siblings. This means the v3 store
already has device data for every track from the moment the app connects, so
the central view and FX grid can re-derive immediately without waiting for
fresh data from Ableton.

## Decision

Apply the track selection to both `session.selectedTrackIndex` and
`selectedTrackStore._trackIndex` **synchronously on click**, before the OSC
round-trip, via a new `session.selectTrackOptimistically(trackIndex)` method.
`selectedTrackStore.handleTrackSelected()` is also called optimistically so the
FX grid clears ghost state immediately rather than showing stale data from the
previous track.

The OSC send still fires right after, and the Ableton echo still arrives and
calls the same handlers. `handleTrackSelected` has an idempotency guard
(`if (trackIndex === this._trackIndex) return`) so the FX grid reset is
skipped on the confirming echo. `handleTrackSelectionUpdate` uses a
`_pendingTrackIndex` sentinel: optimistic writes record the pending index;
the echo handler drops any arrival that doesn't match (stale echo from a
previous tap), and clears the pending index on match. Side effects such as
logging and `setView('system')` still execute on the confirming echo.

A `_pendingTrackIndex` sentinel in the session store makes rapid A→B tap
sequences safe: A's echo arrives after B's optimistic write, is detected as
stale, and is dropped — the highlight stays on B.

If Ableton echoes back a *different* index (invalid path, Live overriding the
selection) there is no pending write matching it, so it falls through as an
Ableton-initiated selection and the correction is applied normally.

Changed files:
- `interface/src/lib/stores/session.svelte.ts` — `selectTrackOptimistically()`
- `interface/src/lib/components/v6/tracks/composables/useTrackData.svelte.ts` — calls optimistic update before `observer.selectTrack()`

## Consequences

**Positive**
- Track highlight, central view, and FX grid all update instantly on tap with
  no perceptible lag.
- Rapid tap sequences (A→B) are safe: A's stale echo is dropped via
  `_pendingTrackIndex`; the highlight stays on B without any flash.
- Correction path is safe: a mismatched Ableton-initiated echo (no pending
  write) still snaps the UI to the right track.

**Negative / watch-outs**
- **Return tracks**: `SelectedTrackComponent` suppresses the echo for return
  track selections (design §4.2). If a return track is ever clickable in the
  UI, the optimistic update would persist indefinitely with no echo to correct
  it. This is a pre-existing gap in the surface protocol, not introduced here.
- A very brief (~50–300 ms) flash of the "wrong" track highlighted is
  theoretically possible if Ableton overrides the selection, but this scenario
  does not arise in normal use.

## Tags
`ui`, `performance`, `track-selection`, `optimistic-update`, `session-store`
