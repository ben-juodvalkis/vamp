# ADR 033: Track Pool System (Phase 2)

**Date:** 2025-01-08
**Status:** Superseded by ADR-053
**Deciders:** Ben Juodvalkis
**Tags:** Performance, Track Management, Live Looping, Max4Live

> **⚠️ SUPERSEDED BY ADR-053**
>
> This ADR describes the track pool system which has been **removed** from the codebase.
> The pool was reverted to simple on-demand track creation for reduced complexity.
> See [ADR-053: Revert Track Pool to On-Demand Creation](./053-revert-track-pool-to-on-demand-creation.md) for current implementation.

**Historical Note:** This ADR was originally superseded by ADR-031 (M4L Single Source of Truth), which itself has been superseded by ADR-053.

---

## Context

Track creation in Ableton Live becomes increasingly slow as session size grows (100ms → 1000ms+), causing visible lag during live performance. This breaks the flow of live looping and creates an unpredictable user experience.

### Problems with On-Demand Track Creation

1. **Performance Degradation**
   - Fresh session: ~100ms per track
   - Large session (50+ tracks): ~1000ms+ per track
   - Unpredictable timing (varies by session complexity)
   - User-visible lag during performance

2. **Poor Live Performance UX**
   - Lag when loading new instruments
   - Breaks performance flow
   - User must wait for track creation
   - Unpredictable response time

3. **Scalability Issues**
   - Performance degrades with session size
   - No upper bound on latency
   - Cannot guarantee responsive UX

---

## Decision

Replace on-demand track creation with a **pool of 16 pre-made MIDI tracks** that are selected and reused instantly.

### Core Principles

1. **Instant Selection** (<50ms)
   - No track creation during performance
   - Simple array lookup and selection
   - Predictable, constant-time performance

2. **Smart Recycling**
   - Empty tracks (no clips) reused automatically
   - Muted tracks recycled when pool fills
   - LRU-style selection (oldest muted track first)

3. **Real-Time State Tracking**
   - Pool state reflects actual Ableton clip state
   - M4L observers monitor clip changes
   - Automatic sync on startup

4. **Graceful Degradation**
   - Pool exhaustion handled with user guidance
   - Fallback to legacy flow if pool unavailable
   - Audio tracks use old flow (Phase 3 will integrate)

---

## Architecture

### Two-Layer System: Max4Live Observers + TypeScript Pool Logic

**Max4Live (Observer Layer):**
- Monitors `has_clip` property on all clip slots (tracks 0-15)
- Monitors `mute` property on all pool tracks
- Sends aggregate clip state: `/looping/pool/track/clips [trackIndex, hasAnyClips]`
- Sends mute changes: `/looping/track/property [trackIndex, 'mute', value]`
- Handles sync requests: `/looping/pool/query`

**TypeScript (Logic Layer):**
- Pool service maintains track state (empty vs in-use)
- Smart selection algorithm (empty → muted → exhausted)
- Pool statistics (utilization, available slots)
- Integration with session store (reactive stats)
- Track preparation uses pool instead of creation

### Why This Split?

- **M4L is good at:** Observing Live state, real-time updates
- **TypeScript is good at:** Logic, algorithms, UI integration, testing
- **Separation of concerns:** Observation vs business logic
- **Consistent with V6 philosophy:** Minimal Max4Live, maximum TypeScript

---

## Pool State Management

### State Definition

```typescript
interface PoolTrack {
  index: number;              // 0-15
  state: 'empty' | 'in-use';  // Based on clip presence
  isMuted: boolean;           // Real-time mute tracking
  lastUsedTimestamp: number;  // For LRU recycling
  trackType?: string;         // For statistics
}
```

### State Updates (Event-Driven)

**Clip State:**
- M4L observes `has_clip` → Sends event → Pool updates `empty`/`in-use`
- Automatic, real-time, no manual tracking needed

**Mute State:**
- M4L observes `mute` → Sends event → Pool updates `isMuted`
- Enables smart recycling of muted tracks

**Key Insight:** Pool state is **not manually managed** - it reflects actual Live state via observers.

---

## Smart Selection Algorithm

```
1. Search pool tracks 0-15 for first 'empty' track
   → If found: Return index (<50ms)

2. If all tracks 'in-use', search for muted tracks
   → If found: Reset oldest muted track, return index (<600ms)

3. If no empty or muted tracks
   → Return null (pool exhausted)
```

**Performance:**
- Empty track: <50ms (simple array search)
- Muted track recycling: <600ms (includes Phase 1 reset)
- Predictable: No variance based on session size

---

## Track Preparation Integration

### Before (On-Demand Creation)

```typescript
const check = await shouldCreateTrack('midi');
if (check.shouldCreate) {
  await createTrack('midi');  // 100-1000ms+
}
// Load device
```

### After (Pool Selection)

```typescript
const trackIndex = await findAvailableTrack();
if (trackIndex === null) {
  handlePoolExhausted();
  return;
}
// Use track instantly (<50ms)
// Load device
```

**Result:** 70-90% performance improvement

---

## Consequences

### Positive

1. **Massive Performance Improvement**
   - Track selection: 100-1000ms+ → <50ms
   - 70-90% faster overall
   - Predictable, constant-time performance
   - No degradation as session grows

2. **Better Live Performance UX**
   - Instant response to user actions
   - No visible lag
   - Smooth performance flow
   - Predictable behavior

3. **Smart Resource Management**
   - Automatic track reuse (no clips = empty)
   - Muted tracks recycled automatically
   - Visual feedback via track colors
   - Clean UI (hide empty tracks)

4. **Foundation for Future Features**
   - Phase 3: Audio track conversion
   - Pool size configuration
   - Visual pool status indicators
   - Advanced recycling strategies

### Negative

1. **Requires M4L Observers**
   - Cannot use AbletonOSC listeners (no `has_clip` listener support)
   - Observer overhead (minimal, but present)
   - More complex than pure query-based approach

2. **Assumptions About Set**
   - Assumes default set has 16 MIDI tracks
   - No validation or auto-creation
   - Pool state inconsistent if tracks deleted manually

3. **MIDI Only (Phase 2)**
   - Audio tracks still use old flow
   - Phase 3 needed for complete solution
   - Dual code paths during transition

4. **No Persistence**
   - Pool state lost on app reload
   - Not saved with Live set
   - Must resync on startup

### Risks Mitigated

1. **Sync on Startup**
   - M4L sends initial state on load
   - Svelte queries via `/looping/pool/query`
   - Works regardless of load order

2. **Clip Observer Verification**
   - Tested AbletonOSC listener support (confirmed doesn't work)
   - M4L observers proven to work
   - Follows existing mute tracking pattern

3. **Graceful Pool Exhaustion**
   - Warning messages with guidance
   - Falls back to muted track recycling
   - Can still create tracks if needed (legacy flow)

---

## Implementation Details

### Files Created
- `interface/src/lib/services/trackPoolService.ts` (500+ lines)

### Files Modified
- `interface/src/lib/stores/session.svelte.ts` (pool state + getters)
- `interface/src/lib/services/trackPreparation.ts` (pool integration)
- `interface/src/routes/+layout.svelte` (pool initialization)
- `interface/src/lib/components/v6/layout/TracksPanelV6.svelte` (visibility filter)
- `ableton/scripts/liveAPI-v6.js` (clip slot observers)

### Key APIs

**M4L Messages:**
```
/looping/pool/track/clips [trackIndex, hasAnyClips]  # Clip state change
/looping/pool/query []                                # Sync request
```

**Pool Service:**
```typescript
initializePool()                    // On app startup
findAvailableTrack() → trackIndex   // Smart selection
getPoolStats() → PoolStats          // Utilization data
resetAllMutedPoolTracks()           // Batch cleanup
```

**Session Store:**
```typescript
session.poolUtilization         // "4/16"
session.availablePoolSlots      // 12
session.poolTracksInUse         // 4
session.poolMutedTracks         // 1
```

---

## Design Decisions

### 1. M4L Clip Observers vs Query-Based

**Decision:** M4L observers

**Rationale:**
- Real-time pool statistics
- No query latency during selection
- Consistent with mute tracking pattern
- Automatic state sync

**Alternative Considered:** Query `has_clip` on-demand
- **Rejected:** Adds latency, not real-time, requires polling for stats

### 2. Pool State Reflects Clips, Not Devices

**Decision:** `empty`/`in-use` tracks clip presence, not device loading

**Rationale:**
- Tracks with instruments but no clips are reusable
- User's requirement: "Consider track eligible if no clips"
- More accurate representation of track availability

**Alternative Considered:** Track device loading
- **Rejected:** Doesn't match user workflow, less accurate

### 3. Empty/In-Use State via Observers, Not Manual

**Decision:** Pool state updated automatically via M4L observers

**Rationale:**
- Always accurate (reflects Live state)
- No manual state management needed
- Reduces bugs from forgotten updates
- Automatic sync on startup

**Alternative Considered:** Manual `markTrackInUse()` calls
- **Rejected:** Error-prone, can get out of sync, requires careful tracking

### 4. Track Colors by Type

**Decision:** Set track color when loading preset

**Rationale:**
- Visual feedback in Ableton
- Easy to identify track types
- Professional appearance

**Colors:**
- drum_rack: Orange (0xFF6B35)
- omnisphere: Blue (0x00B4D8)
- ni: Purple (0x9B59B6)
- ni_drum: Red (0xE74C3C)

### 5. Hide Empty Tracks from UI

**Decision:** Filter track panel to show only in-use tracks + selected track

**Rationale:**
- Clean UI (no clutter)
- Focus on active tracks
- Selected track always visible (even if empty)

**Implementation:** Svelte $derived filter in TracksPanelV6

---

## Performance Comparison

| Operation | Before (Phase 1) | After (Phase 2) | Improvement |
|-----------|------------------|-----------------|-------------|
| Track selection | 100-1000ms+ | <50ms | 70-90% |
| With mute recycle | N/A | <600ms | New feature |
| Predictability | Poor (varies) | Excellent (constant) | Major |
| Session scaling | Degrades badly | No degradation | Critical |

---

## Future Enhancements

### Phase 3
- Audio track conversion via clipboard
- Complete pool system (all track types)
- ~500ms audio conversion time

### Future Improvements
- Pool size configuration
- Visual pool status UI
- Advanced recycling strategies
- Pool state persistence
- Track existence validation

---

## Related Documents

- **Phase 1 ADR:** `014-track-reset-system.md`
- **Implementation Log:** `phase-2-implementation-log.md`
- **Specification:** `phase-2-track-pool.md`
- **Completion Summary:** `PHASE-2-IMPLEMENTATION-COMPLETE.md`
- **API Reference:** `documentation/v6-api.md`

---

## Lessons Learned

1. **AbletonOSC Limitations**
   - No `start_listen` for clip slot `has_clip` property
   - Must use M4L observers for clip state tracking
   - Test assumptions about listener support early

2. **State Management**
   - Event-driven state sync is more reliable than manual tracking
   - M4L observers + TypeScript logic is a proven pattern
   - Always sync on startup (handles load order issues)

3. **Performance Optimization**
   - Pre-allocation eliminates variable latency
   - Pool system provides constant-time operations
   - User experience is drastically improved

---

**Status:** Implemented and ready for testing
**Next Phase:** Phase 3 (Audio Conversion)

---

**Last Updated:** 2025-01-08
