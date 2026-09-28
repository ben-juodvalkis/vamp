# ADR-327: Device State Caching for Instant Track Switching

**Date**: 2026-03-20
**Status**: Accepted
**Related**: ADR-049 (Complete State Architecture), ADR-048 (Device Subscription Optimization)

---

## Context

When the user switches tracks during a live performance, the UI must display the full device state (devices, parameter values, names, variations, properties). Without caching, every track switch triggers a round-trip through Max4Live to the Live API — introducing latency that is unacceptable during performance.

The previous flow was:

```
User taps track → /live/view/set/selected_track → observer fires
    → buildCompleteDeviceState() queries Live API for every device
    → sendCompleteDeviceState() → UDP → Bridge → WebSocket → Frontend
    → UI renders
```

For tracks with 5+ devices, this round-trip caused a visible blank flash before devices appeared.

## Decision

Implement a **two-tier device state cache** — one in Max4Live and one on the frontend — to eliminate query latency for previously visited tracks.

### Tier 1: Max4Live Cache (`trackDeviceStateCache`)

- Object keyed by track index, values are complete state objects
- **Proactive population**: On project load (`loadbang()`), `populateCacheForAllTracks()` pre-caches all tracks after a 500ms delay
- **Cache-first serving**: `setupDeviceObserver()` checks cache before querying — cache hits skip Live API entirely
- **Incremental updates**: `devicesChanged()` uses `detectNewDevices()` to identify only newly added devices by ID comparison, querying only those instead of rebuilding the entire state
- **New track caching**: When tracks are added, a 200ms delayed Task caches the new tracks
- **Invalidation**: Track deletion clears all regular entries (indices shift), master track preserved at index -1

### Tier 2: Frontend Cache (`allTracksDeviceCache.svelte.ts`)

- Svelte 5 singleton class with `Map<number, CachedTrackDeviceState>`
- Populated every time `handleCompleteDeviceState()` receives a `complete_state` message
- On track switch, `loadFromCache()` applies cached state instantly before Max responds
- Provides `addDevice()`, `removeDevice()`, and `updateParameter()` for incremental updates
- Conservative invalidation on track deletion: all regular entries cleared

### Combined Flow

```
User taps track
    ├── Frontend: loadFromCache() → instant UI render from Tier 2
    └── Max: setupDeviceObserver()
            ├── Cache HIT: sendCompleteDeviceState(cached) → fast (~10ms Task delay)
            └── Cache MISS: buildCompleteDeviceState() → send → cache (both tiers)
```

On project load:
```
loadbang() → 500ms delay → populateCacheForAllTracks()
    ├── Suppress device observer callbacks
    ├── For each track: buildCompleteDeviceState() → store in Max cache
    ├── Master track → store in Max cache at index -1
    └── End suppression
```

### Design Choices

1. **Two tiers rather than one**: The frontend cache provides instant rendering even before Max's 10ms Task fires. Max's cache prevents redundant Live API queries. Either tier alone would still improve performance, but together they eliminate perceptible latency.

2. **Proactive population on load**: Rather than lazy caching (populate on first visit), we pre-cache all tracks during `loadbang()`. This means the very first track switch after project load is also instant.

3. **Incremental device detection**: `detectNewDevices()` compares device IDs between cached and current state. Only new devices are queried via `buildSingleDeviceState()`, avoiding full rebuilds when a single device is added.

4. **Conservative deletion invalidation**: When tracks are deleted, all regular cache entries are cleared because indices shift. The cache repopulates as the user visits each track. This is correct and simple.

5. **Parameter storage retained across switches**: `deviceParameterStorage` no longer clears on track change, since device IDs are globally unique in Ableton.

## Files Changed

| File | Change |
|------|--------|
| `ableton/scripts/liveAPI-v6.js` | `trackDeviceStateCache`, `populateCacheForAllTracks()`, `detectNewDevices()`, `buildSingleDeviceState()`, cache-first in `setupDeviceObserver()`, cache invalidation in `handleTrackCountChange()` |
| `interface/src/lib/stores/v6/allTracksDeviceCache.svelte.ts` | New global frontend cache store |
| `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` | `loadFromCache()`, `applyDeviceState()` helper, populate cache in `handleCompleteDeviceState()` |
| `interface/src/lib/stores/v6/deviceParameterStorage.svelte.ts` | Retain parameters across track switches |
| `interface/src/lib/api/handlers/maxObserverHandler.ts` | Cache invalidation on track count change |

## Consequences

### Positive

- Track switching feels instant — no blank flash between device states
- Proactive caching means first visit to any track is also fast
- Incremental device detection avoids redundant queries for device additions
- Minimal change to existing `complete_state` architecture

### Negative

- Memory usage increases (caching state for all tracks in both Max and frontend)
- Device changes on non-selected tracks stale the cache until that track is visited
- AU plugin retry doesn't cover cached tracks — plugins that haven't initialized during `populateCacheForAllTracks()` will have 0 parameters until visited
- Frontend cache may eventually be removable if Max-side latency is measured to be consistently <50ms

## Tags

`performance`, `caching`, `max4live`, `device-state`, `track-switching`
