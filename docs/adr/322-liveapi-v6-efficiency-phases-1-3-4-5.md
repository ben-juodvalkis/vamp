# ADR-322: LiveAPI V6 Efficiency — Phases 1, 3, 4, 5

## Status
Accepted

## Context
Following ADR-321 (incremental sync observers, Phase 2), four remaining efficiency phases were identified for `ableton/scripts/liveAPI-v6.js` (~5600 lines). See `documentation/current-project/liveapi-v6-efficiency.md` for the full plan.

**Phase 1 — Dead code and duplicated routing**: The `anything()` and `list()` message handlers duplicated ~17 routes across ~566 combined lines. They had drifted out of sync: `list()` still referenced the deleted `currentTracks` variable and removed `checkTracks()` function, which would throw runtime errors if triggered via `/looping/query/count` or `/looping/refresh`.

**Phase 3 — Temporary LiveAPI allocation**: Despite 4 global reusable objects (`api`, `queryApi`, `tempApi`, `clipApi`), ~81 functions created temporary `new LiveAPI()` objects for stateless get/set operations. In Max's JavaScript runtime, each allocation creates a Live Object Model reference requiring garbage collection. The worst case was `queryTrackSummaries()`: ~181 objects for a 20-track session with 8 scenes.

**Phase 4 — Pedalboard duplication**: Pedals 1, 2, and 3 had identical 53-line hold/double-tap logic copy-pasted three times (~159 lines total), differing only in pedal number, track name, routing channel, and device load function.

**Phase 5 — O(n²) track removal**: `detectTrackRemovals()` used nested loops to find removed tracks. Max JS (ES3/ES5) doesn't have `Set`, but a plain object as a hash map achieves O(n).

## Decision

### Phase 1: Consolidate message routing
Extract a shared `handleMessage(address, args)` function. `anything()` extracts the address from the `messagename` global; `list()` extracts it from `args[0]` and slices remaining args. Both delegate to `handleMessage()`. Merge list-only routes into the shared handler.

### Phase 3: Reuse global LiveAPI objects
Refactor stateless get/set operations to reuse `queryApi`, `tempApi`, `clipApi` via `.path =` instead of `new LiveAPI()`. Observer construction (with callbacks) must remain `new LiveAPI()`.

### Phase 4: Extract shared pedal handler
Create a `PEDAL_CONFIGS` table and `handlePedalWithHoldAndDoubleTap()` function. The three case blocks delegate to it.

### Phase 5: Hash-set lookup
Build `newIdSet` object from new track IDs, then check each old ID with `newIdSet[id]` in O(1).

## Changes

### `ableton/scripts/liveAPI-v6.js`

**Phase 1:**
- Fixed `currentTracks.length` → `currentTrackIds.length` in `/looping/query/count` handler
- Fixed `checkTracks()` → `handleTrackCountChange()` in `/looping/refresh` handler
- Extracted `handleMessage(address, args)` shared router
- `anything()` delegates to `handleMessage()` after extracting address from `messagename`
- `list()` delegates to `handleMessage()` after extracting address from `args[0]` and slicing args
- Removed ~140 lines of duplicated routing from old `list()`
- Merged list-only routes: `/cmd/sample_clip_to_simpler`, `/cmd/rename_selected_track`, legacy prep/load commands

**Phase 3 — functions refactored to reuse globals:**
- `setTrackVolume()`, `adjustTrackVolumeRelative()`, `setTrackMute()`, `setTrackSolo()`, `setTrackArm()`, `setTrackPan()` — use `queryApi`
- Added `getTrackPath(trackIndex)` helper
- `setSelectedTrack()` — `tempApi` for view, `queryApi` for track/master
- `setupDeviceObserver()` — replaced 3 temp query objects with `queryApi`/`tempApi`
- `handleLiveAPIGetProperty()`, `handleLiveAPISetProperty()` — use `queryApi`
- `queryTrackSummaries()` — `queryApi`/`tempApi`/`clipApi` (eliminated ~181 allocations)
- `querySingleTrackSummary()` — same pattern
- `handleCaptureCreateSimpler()`, `createMidiTrack()`, `createAudioTrack()`, `renameCurrentTrack()` — use `queryApi`
- View commands, device parameter/select/move, pedal 9 capture — use `queryApi`/`tempApi`

**Phase 4:**
- Added `PEDAL_CONFIGS` table: `{ 1: {name:"Guitar",...}, 2: {name:"Mic",...}, 3: {name:"Bass",...} }`
- Extracted `handlePedalWithHoldAndDoubleTap(pedalNum, action)` (~55 lines)
- Replaced 3 copy-pasted case blocks with 3-line delegation

**Phase 5:**
- Replaced nested O(n²) loop with hash-set lookup in `detectTrackRemovals()`

### `documentation/current-project/liveapi-v6-efficiency.md`
- Added completion log for Phases 1, 3, 4, 5

## Consequences

### Positive
- **Bug fix**: `/looping/query/count` and `/looping/refresh` no longer throw runtime errors
- **No route drift**: Single routing function eliminates the risk of `list()` and `anything()` diverging again
- **Less GC pressure**: Stateless operations reuse 4 global objects instead of allocating temporary ones. `queryTrackSummaries()` alone saves ~181 allocations per call in a 20-track session.
- **Maintainability**: Pedalboard behavior changes apply to all 3 pedals automatically via config table; ~250 fewer lines of code overall
- **Performance at scale**: Track removal detection is O(n) instead of O(n²)

### Negative
- Global `queryApi`/`tempApi` reuse means these objects are not safe for concurrent use. In Max's single-threaded JS runtime this is fine, but functions using them should not be called from within each other. All refactored functions are leaf-level setters/getters, so this is not a concern in practice.

### Risks
- If a future change nests a function that uses `queryApi` inside another that also uses `queryApi`, the inner call would clobber the path. Mitigation: the comment at the global declaration documents this constraint, and the existing codebase already follows this pattern for the `api` global.
