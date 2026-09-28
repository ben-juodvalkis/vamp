# ADR-321: Incremental syncPositionObservers

## Status
Accepted

## Context
`syncPositionObservers()` in `ableton/scripts/liveAPI-v6.js` destroyed ALL observers for ALL tracks and recreated them on every track change. With 7 observers per track (6 properties + mixer volume), a 20-track session created/destroyed 140 LiveAPI objects per change. This was unnecessary because Mode 1 observers follow the **path/position**, not the object — existing observers auto-update when tracks move.

The incorrect design was driven by wrong block comments ("Mode 1 observers follow OBJECTS by ID") while the inline code comment at line 485 correctly said "Follow path, not object."

Additionally, `createMixerVolumeObserver()` never set `observer.mode = 1`, so volume observers defaulted to Mode 0 (follow object by ID) — inconsistent with the property observers that correctly used Mode 1.

On the Svelte side, `TracksPanelV6` used a `trackListVersion` key to force full remount of ALL TrackStrip components on deletion/reorder. Since Mode 1 observers follow positions and the Max side now pushes fresh state on deletion, this remount mechanism was unnecessary.

**Sources**: [Cycling74 LiveAPI docs](https://docs.cycling74.com/legacy/max8/vignettes/jsliveapi), [LiveAPI JS Reference](https://docs.cycling74.com/apiref/js/liveapi/)

## Decision
Replace the full destroy-all/create-all pattern with incremental observer management:
- **Track added**: Create observers only for new positions
- **Track removed**: Destroy observers only for positions beyond the new count, then push fresh state via `queryTrackState()` for all remaining positions (to update shifted tracks)
- **Track reordered**: No action — Mode 1 handles automatically

Remove the `trackListVersion` remount mechanism from the entire Svelte stack since it's no longer needed.

Narrow observer suppression to wrap only the `syncPositionObservers()` call instead of the entire `handleTrackCountChange()`.

## Changes

### Max4Live (`ableton/scripts/liveAPI-v6.js`)
- Fixed block comments on `syncPositionObservers` — Mode 1 follows path/position, not objects by ID
- Added `observer.mode = 1` to `createMixerVolumeObserver` (was missing, defaulted to Mode 0)
- Replaced full teardown with incremental add/remove in `syncPositionObservers`
- Added `queryTrackState()` loop after deletion to push fresh values for shifted positions
- Removed `/looping/tracks/reordered` outlet message
- Narrowed suppression window to wrap only the sync call
- Removed `handleTrackCountChangeWithSuppression` wrapper; `trackChangedCallback` calls `handleTrackCountChange` directly

### Session Store (`interface/src/lib/stores/session.svelte.ts`)
- Removed `_trackListVersion`, `_lastVersionBumpTime`, version bump logic
- Removed `handleTracksReordered()` function
- Removed unused `constants` import
- Kept `track-count-changed` event dispatch for cache pruning

### Handler (`interface/src/lib/api/handlers/maxObserverHandler.ts`)
- Removed `/looping/tracks/reordered` handler block

### Components
- `TracksPanelV6.svelte`: Simplified `{#each}` key from `` `${trackIndex}-${trackListVersion}` `` to `trackIndex`
- `SelectedTrackMeter.svelte`: Removed `trackListVersion` dependency from `$effect`
- `UtilityControl.svelte`: Removed `trackListVersion` dependency from `$effect`

## Consequences

### Positive
- **Performance**: 20-track session goes from 140 observer create/destroy operations to 7 (one track's worth) on add/delete, and 0 on reorder
- **Correctness**: Volume observers now use Mode 1 consistently with property observers
- **Simpler Svelte stack**: No more version-based remount hack; Svelte's natural `{#each}` keying handles array changes
- **Less message traffic**: `/looping/tracks/reordered` message eliminated
- **Narrower suppression**: Less time spent with observer callbacks suppressed

### Negative
- Deletion now calls `queryTrackState()` for all remaining positions — a one-time burst of API reads. This is still far cheaper than destroying/recreating 140 LiveAPI objects.

### Risks
- If Mode 1 has undocumented quirks with structural changes in future Max/Live versions, observers could point to wrong tracks. Mitigation: manual testing checklist covers all scenarios; the full teardown can be restored if needed.
