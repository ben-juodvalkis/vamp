#ADR-040: Track Pool State Management - M4L Single Source of Truth (Option D)

**Status:** Superseded by ADR-053
**Date:** 2025-10-10
**Context:** Track Pool System - Synchronization Issues
**Related:** ADR-030 (Focused View Tracking), Phase 2 (Track Pool System)

> **⚠️ SUPERSEDED BY ADR-053**
>
> This ADR describes the track pool system which has been **removed** from the codebase.
> The pool was reverted to simple on-demand track creation for reduced complexity.
> See [ADR-053: Revert Track Pool to On-Demand Creation](./053-revert-track-pool-to-on-demand-creation.md) for current implementation.

---

## Context

### Background

In Phase 2, we implemented a track pool system: 16 pre-made MIDI tracks (indices 0-15) ready for instant selection. This eliminated slow on-demand track creation (~500ms → <50ms).

**Initial Architecture:**
- **TypeScript:** Maintained pool state in Map (empty/in-use, muted, timestamps)
- **Max4Live:** Observed clip/mute changes, sent OSC events
- **TypeScript:** Updated local state based on M4L events

**The Problem:** Pool state became stale and disagreed with Ableton Live's actual state.

**Example:**
```
Pool says: Track 10 = 'empty'
Live says: Track 10 slot 0 has audio clip
Result: Paste overwrites existing clip (data loss!)
```

### The Root Cause: Split Responsibility

**Classic Distributed Systems Problem:**
- Two systems tracking the same state (TypeScript Map + Live API)
- No consensus mechanism
- No periodic reconciliation
- Trust-based synchronization fails when observer events are missed

**Observer gaps discovered:**
1. **Audio conversion clip deletion** - M4L observer doesn't fire after programmatic deletion
2. **Track type conversion** - MIDI→Audio track object changes, observers become orphaned
3. **Initialization race** - TypeScript assumes all tracks empty, M4L response never arrives

---

## The Problem (Detailed)

### Band-Aid Solution (Pre-ADR-031)

```typescript
// DEBUG_POOL_VERIFICATION = true
async function findAvailableTrack() {
    for (const track of poolState.values()) {
        if (track.state === 'empty') {
            // Query Live to verify pool state
            const hasClip = await checkSlotHasClip(track.index, 0);
            if (hasClip) {
                track.state = 'in-use'; // Self-heal
                continue;
            }
            return track.index;
        }
    }
}
```

**Cost:** 16 OSC round-trips per track selection (~320ms)
**Problem:** Doesn't fix root cause, just works around it

### Why Synchronization Failed

| Event | TypeScript Behavior | M4L Behavior | Result |
|-------|-------------------|--------------|--------|
| **Paste audio clip** | Assumes track becomes in-use | Observer fires → sends event | ✅ Sync |
| **Delete clip programmatically** | Assumes track becomes empty | Observer **doesn't fire** | ❌ Stale |
| **Track converts MIDI→Audio** | Continues trusting pool | Observer detached from new track object | ❌ Stale |
| **Pool initialization** | Assumes all empty | Sends state **if** query received | ❌ Race condition |

---

## Solutions Evaluated

### Option A: Query-On-Demand with LRU Cache

**Approach:** Always query Live, cache results with TTL.

**Pros:**
- ✅ Always accurate
- ✅ Fast when cached
- ✅ No M4L changes

**Cons:**
- ❌ Still requires OSC queries (20-320ms)
- ❌ Cache invalidation complexity
- ❌ Doesn't fix observer gaps

**Verdict:** Incremental improvement, doesn't solve root cause.

---

### Option B: Enhanced M4L Observers + Verification

**Approach:** More robust observers + verify critical operations.

```typescript
// Verify deletion succeeded
send('/live/clip_slot/delete_clip', [trackIndex, 0]);
await verifyClipDeleted(trackIndex, 0);
```

**Pros:**
- ✅ Waits for M4L state
- ✅ Verifies critical operations
- ✅ Still uses pool for speed

**Cons:**
- ❌ Still split responsibility
- ❌ Verification queries add latency
- ❌ Doesn't solve observer detachment

**Verdict:** Better, but fighting against split architecture.

---

### Option C: Hybrid Trust + Periodic Sync

**Approach:** Trust M4L, reconcile every 5 seconds.

```typescript
setInterval(async () => {
    for (const track of poolState.values()) {
        const actual = await checkSlotHasClip(track.index, 0);
        if (track.state !== actual) {
            track.state = actual; // Self-heal
        }
    }
}, 5000);
```

**Pros:**
- ✅ Self-healing
- ✅ Catches all desync types
- ✅ No M4L changes

**Cons:**
- ❌ 5-second window of wrongness
- ❌ Queries 16 tracks every 5 seconds
- ❌ Doesn't prevent desync

**Verdict:** Practical workaround, but wasteful.

---

### Option D: Move Pool Logic to M4L ✅ (CHOSEN)

**Approach:** M4L owns pool state entirely. TypeScript requests tracks via OSC.

**Key Insight:** M4L has **direct Live API access** - no OSC round-trips, instant verification!

---

## The Solution: Option D

### Architecture

**Before (Split Responsibility):**
```
┌─────────────────────────────────────┐
│ TypeScript (trackPoolService.ts)   │
│ Pool State: Map<trackIndex, state> │ ← State tracking
│ findAvailableTrack() - searches Map│ ← Algorithm
│ Observers: M4L events → update Map │ ← Sync layer
└─────────────────────────────────────┘
                ↕ OSC Events
┌─────────────────────────────────────┐
│ Max4Live (liveAPI-v6.js)            │
│ Clip observers → send events        │ ← Just observing
└─────────────────────────────────────┘
```

**After (Single Source of Truth):**
```
┌─────────────────────────────────────┐
│ TypeScript (trackPoolService.ts)    │
│ findAvailableTrack():                │
│   send('/looping/pool/get_empty_track') │
│   wait for response                  │ ← Thin client
└─────────────────────────────────────┘
                ↕ Request/Response
┌─────────────────────────────────────┐
│ Max4Live (liveAPI-v6.js)            │
│ Pool State: {} (single source!)     │ ← State tracking
│ findAvailableTrack() - Live API     │ ← Algorithm + Verification
│ Observers → update local state      │ ← No sync needed!
└─────────────────────────────────────┘
```

---

## Technical Implementation

### M4L Side

**File:** `ableton/scripts/liveAPI-v6.js`

#### 1. Pool State Initialization

```javascript
// Pool state (single source of truth)
var poolState = {}; // trackIndex -> { state, muted, lastUsed }

function initializePoolClipObservers() {
    // Get scene count
    var liveSetApi = new LiveAPI("live_set");
    var sceneCount = liveSetApi.getcount("scenes");

    // Initialize with Live API (instant verification)
    for (var trackIndex = 0; trackIndex < 16; trackIndex++) {
        var hasClips = trackHasClips(trackIndex, sceneCount);
        var trackApi = new LiveAPI("live_set tracks " + trackIndex);
        var isMuted = trackApi.get("mute")[0] === 1;

        poolState[trackIndex] = {
            state: hasClips ? "in-use" : "empty",
            muted: isMuted,
            lastUsed: 0
        };
    }

    // Send initial stats
    sendPoolStats();
}
```

**Key:** Direct Live API access - no OSC, instant results.

---

#### 2. Find Available Track Algorithm

```javascript
function findAvailableTrack() {
    var liveSetApi = new LiveAPI("live_set");
    var sceneCount = liveSetApi.getcount("scenes");

    // Phase 1: Find first empty track with instant verification
    for (var trackIndex = 0; trackIndex < 16; trackIndex++) {
        var track = poolState[trackIndex];

        if (track.state === "empty") {
            // VERIFY with Live API (instant, no OSC!)
            var actuallyEmpty = !trackHasClips(trackIndex, sceneCount);

            if (actuallyEmpty) {
                track.lastUsed = Date.now();
                return trackIndex;
            } else {
                // Self-heal: Pool state was stale
                track.state = "in-use";
                track.lastUsed = Date.now();
            }
        }
    }

    // Phase 2: Find oldest muted track (LRU recycling)
    var oldestMuted = findOldestMutedTrack();
    if (oldestMuted !== -1) {
        return oldestMuted;
    }

    // Phase 3: Pool exhausted
    return -1;
}

// Helper: Check if track has clips (instant Live API)
function trackHasClips(trackIndex, sceneCount) {
    for (var sceneIndex = 0; sceneIndex < sceneCount; sceneIndex++) {
        var clipSlotApi = new LiveAPI(
            "live_set tracks " + trackIndex + " clip_slots " + sceneIndex
        );
        var hasClip = clipSlotApi.get("has_clip")[0];
        if (hasClip === 1 || hasClip === true) {
            return true;
        }
    }
    return false;
}
```

**Performance:** Verification is instant (Live API, not OSC)

---

#### 3. OSC Request/Response Handlers

```javascript
// In anything() and list() functions:
if (address === "/looping/pool/get_empty_track") {
    var trackIndex = findAvailableTrack();
    outlet(0, ["/looping/pool/empty_track", trackIndex]);
}
```

**Protocol:**
- **Request:** `/looping/pool/get_empty_track` (no args)
- **Response:** `/looping/pool/empty_track [trackIndex]` (-1 if exhausted)

---

#### 4. State Maintenance via Observers

**Clip observers:**
```javascript
function poolClipSlotChanged(args) {
    var trackIndex = extractTrackIndexFromPath(this.path);
    var hasClips = trackHasClips(trackIndex, sceneCount);

    // Update pool state
    var track = poolState[trackIndex];
    if (track.state !== (hasClips ? "in-use" : "empty")) {
        track.state = hasClips ? "in-use" : "empty";
        sendPoolStats(); // Notify TypeScript
    }
}
```

**Mute observers:**
```javascript
// In createPositionPropertyObserver() callback:
if (property === "mute" && position >= 0 && position <= 15) {
    var track = poolState[position];
    track.muted = (value === 1 || value === true);
    sendPoolStats(); // Notify TypeScript
}
```

---

#### 5. Pool Stats Broadcasting

```javascript
function sendPoolStats() {
    var available = 0, inUse = 0, muted = 0;

    for (var i = 0; i < 16; i++) {
        var track = poolState[i];
        if (track.state === "empty") available++;
        else inUse++;
        if (track.muted) muted++;
    }

    var utilizationPercent = Math.round((inUse / 16) * 100);

    outlet(0, ["/looping/pool/stats", 16, available, inUse, muted, utilizationPercent]);
}
```

**Called when:**
- Pool initialization
- Clip state changes
- Mute state changes

---

#### 6. Per-Track State Broadcasting (Enhancement)

**Added to enable UI filtering while maintaining zero-query design:**

```javascript
function checkAndSendPoolTrackClipState(trackIndex, sceneCount) {
    // Check if track has clips
    var hasAnyClips = trackHasClips(trackIndex, sceneCount);

    // Get track type and mute state
    var trackApi = new LiveAPI("live_set tracks " + trackIndex);
    var hasMidiInput = trackApi.get("has_midi_input")[0];
    var hasAudioInput = trackApi.get("has_audio_input")[0];
    var isMuted = poolState[trackIndex].muted;

    // Broadcast complete per-track state
    outlet(0, ["/looping/pool/track/state",
        trackIndex,
        hasAnyClips ? 1 : 0,
        isMuted ? 1 : 0,
        hasMidiInput ? 1 : 0,
        hasAudioInput ? 1 : 0
    ]);
}
```

**Protocol:**
- **Broadcast:** `/looping/pool/track/state [trackIndex, hasClips, isMuted, hasMidiInput, hasAudioInput]`
- **Triggered by:** Clip observers, mute observers, pool initialization
- **Purpose:** Enable TypeScript UI filtering without queries

**Benefits:**
- ✅ UI can show only active tracks
- ✅ TypeScript knows track type for smart workflows
- ✅ Still zero queries (observer-driven)
- ✅ Still single source of truth (M4L owns state)

---

### TypeScript Side

**File:** `interface/src/lib/services/trackPoolService.ts`

#### Simplified findAvailableTrack()

**Before (750 lines):**
```typescript
// Pool state tracking
const poolState = new Map<number, PoolTrack>();

// Validation
async function debugVerifyPoolState() { /* 16 queries */ }

// Listeners
function startMuteListener() { /* update local state */ }
function startClipListener() { /* update local state */ }

// Manual updates
export function markTrackInUse() { /* ... */ }
export function markTrackEmpty() { /* ... */ }

// Search algorithm
export async function findAvailableTrack() {
    await debugVerifyPoolState(); // 16 queries!
    for (const track of poolState.values()) {
        if (track.state === 'empty') {
            const hasClip = await checkSlotHasClip(track.index, 0);
            // ...
        }
    }
}
```

**After (220 lines, 70% reduction):**
```typescript
// No pool state tracking!
let isInitialized = false;

export async function findAvailableTrack(): Promise<number | null> {
    return new Promise((resolve) => {
        const handler = (event: Event) => {
            const { address, args } = event.detail;

            if (address === '/looping/pool/empty_track') {
                window.removeEventListener('osc-message', handler);
                const trackIndex = args[0];
                resolve(trackIndex === -1 ? null : trackIndex);
            }
        };

        window.addEventListener('osc-message', handler);
        send('/looping/pool/get_empty_track', []);

        setTimeout(() => {
            window.removeEventListener('osc-message', handler);
            resolve(null);
        }, 1000);
    });
}
```

**Key:** Just send request and wait - M4L handles everything.

---

#### Pool Stats Listener

```typescript
function startPoolStatsListener() {
    const handler = (event: Event) => {
        const { address, args } = event.detail;

        // Aggregate stats
        if (address === '/looping/pool/stats') {
            const [total, available, inUse, muted, utilizationPercent] = args;

            const stats: PoolStats = {
                total, available, inUse, muted,
                utilization: `${inUse}/${total}`,
                utilizationPercent
            };

            updatePoolStats(stats); // Update session store
        }
        // Per-track state (enhancement)
        else if (address === '/looping/pool/track/state') {
            const [trackIndex, hasClips, isMuted, hasMidiInput, hasAudioInput] = args;

            handlePoolTrackStateUpdate(
                trackIndex,
                hasClips === 1,
                isMuted === 1,
                hasMidiInput === 1,
                hasAudioInput === 1
            );
        }
    };

    window.addEventListener('osc-message', handler);
}
```

**Key:** Receive both aggregate stats and per-track state from M4L broadcasts.

**Per-Track State Cache (Svelte 5 Array for Reactivity):**
```typescript
// Session store - read-only cache
// IMPORTANT: Use Array, not Map - Svelte 5 reactivity requires array mutations
let _poolTracks = $state<PoolTrack[]>(
  Array(16).fill(null).map((_, i) => ({
    trackIndex: i,
    hasClips: false,
    isMuted: false,
    hasMidiInput: true,  // Pool starts as MIDI tracks
    hasAudioInput: false
  }))
);

interface PoolTrack {
    trackIndex: number;
    hasClips: boolean;
    isMuted: boolean;
    hasMidiInput: boolean;
    hasAudioInput: boolean;
}

// Update handler - array assignment triggers $derived
export function handlePoolTrackStateUpdate(...) {
  _poolTracks[trackIndex] = { trackIndex, hasClips, isMuted, ... };
}

// Derived getter for UI filtering
get poolTracks() { return _poolTracks; }
get activePoolTracks(): number[] {
    return _poolTracks
        .filter(t => t.hasClips)
        .map(t => t.trackIndex);
}
```

**Svelte 5 Reactivity Consideration:**

⚠️ **Critical:** Map.set() does NOT trigger `$derived` updates in Svelte 5. Must use array assignment.

**Cache Corruption Warning:**
If `$derived` stops updating or tracks glitch/flicker, run `npm run cleanup` to clear Svelte/Vite caches.

**Usage in UI:**
```svelte
// TracksPanelV6.svelte - show active tracks + selected track
let visibleTracks = $derived(
  session.poolTracks.filter(t =>
    t.hasClips || t.trackIndex === session.selectedTrackIndex
  )
);

{#each visibleTracks as track}
  <TrackStrip trackIndex={track.trackIndex} />
{/each}
```

---

## Performance Comparison

| Operation | Before (Split) | After (Option D) |
|-----------|---------------|------------------|
| **Find empty track (pool says empty)** | 320ms (16 queries) | 20ms (1 OSC request) |
| **Find empty track (pool exhausted)** | 320ms (16 queries) | 20ms (1 OSC request) |
| **Verification accuracy** | Requires all 16 queries | Instant Live API (0ms) |
| **State synchronization** | Continuous (error-prone) | None needed |
| **Code complexity** | 750 lines TypeScript | 220 lines TypeScript + M4L |

**Result:** 94% faster (320ms → 20ms) with 100% accuracy.

---

## Advantages Over Previous Approach

| Aspect | Before (Split) | After (Option D) |
|--------|---------------|------------------|
| **State ownership** | Split (TypeScript + M4L) | ✅ Single (M4L) |
| **Verification** | OSC queries (slow) | ✅ Live API (instant) |
| **Sync issues** | Constant | ✅ None (no sync needed) |
| **Code complexity** | High | ✅ Low (70% reduction) |
| **Observer gaps** | Cause stale state | ✅ Self-healing via verification |
| **Performance** | 320ms (16 queries) | ✅ 20ms (1 request) |
| **Reliability** | Band-aid validation | ✅ Source of truth |

---

## Integration with Track Preparation

**Files:**
- `interface/src/lib/services/trackPreparation.ts`
- `interface/src/lib/services/clipOperations.ts`

**Unified Track Finding:** ALL operations now use `findAvailableTrack()`:

```typescript
// MIDI tracks (browser)
const poolTrack = await findAvailableTrack();
if (poolTrack === null) {
    await handlePoolExhausted(trackType);
    return;
}
trackIndex = poolTrack;

// Audio tracks (conversion)
const poolTrack = await findAvailableTrack();
trackIndex = poolTrack;
await convertMidiToAudio(trackIndex);
await configureAudioRouting(trackIndex);

// Sample to Simpler (unified - removed duplicate logic)
const trackIndex = await findAvailableTrack();
send('/cmd/sample_clip_to_simpler', [trackIndex]);
```

**Result:**
- ✅ Browser instrument loading → uses pool
- ✅ Audio track preparation → uses pool
- ✅ Sample to Simpler → uses pool (removed `findEmptyMidiTrack()`)
- ✅ Single track-finding method everywhere
- ✅ No duplicate logic

---

## Consequences

### Positive

✅ **No Synchronization Issues**
M4L is single source of truth - no sync needed!

✅ **Instant Verification**
Live API access means 0ms verification (not 20ms per OSC query).

✅ **Self-Healing**
Pool state corrects itself automatically when mismatches found.

✅ **Simpler Code**
TypeScript reduced from 750 → 220 lines (70% reduction).

✅ **Better Performance**
1 OSC request (20ms) instead of 16 queries (320ms).

✅ **No Observer Gaps**
Even if M4L observers miss events, Live API verification catches issues.

✅ **Proven Pattern**
Similar to Option D in trackpool-sync-issues.md document.

### Negative

⚠️ **OSC Round-Trip Per Request**
Every track selection requires 1 OSC request (~20ms vs 0ms Map lookup).

**Mitigation:** 20ms is acceptable for user-initiated actions.

⚠️ **M4L Complexity**
More logic in Max/JavaScript (harder to debug than TypeScript).

**Mitigation:** Comprehensive logging, similar patterns to existing M4L code.

✅ **Per-Track State Available (Enhancement)**
M4L broadcasts per-track state updates, enabling UI filtering for active tracks.

**Implementation:** TypeScript caches per-track state (read-only) from M4L observers. UI can filter to show only tracks with clips via `session.activePoolTracks`.

---

## Alternatives Considered

### Option A: Query-On-Demand with LRU Cache
**Why not:** Still requires OSC queries, doesn't fix observer gaps.

### Option B: Enhanced M4L Observers + Verification
**Why not:** Still split responsibility, doesn't eliminate sync.

### Option C: Hybrid Trust + Periodic Sync
**Why not:** Wasteful (16 queries every 5s), doesn't prevent desync.

### Keep Band-Aid Validation
**Why not:** Slow (320ms), doesn't fix root cause.

---

## Migration Path

### Phase 1: M4L Pool Manager ✅
1. Add pool state to liveAPI-v6.js
2. Implement `findAvailableTrack()` with Live API
3. Add OSC request/response handlers
4. Add pool stats broadcasting

### Phase 2: TypeScript Thin Client ✅
1. Remove pool state tracking
2. Simplify `findAvailableTrack()` to request/response
3. Add pool stats listener
4. Remove unused functions (getAllPoolTracks, etc.)

### Phase 3: Remove Old Code ✅
1. Remove validation logic
2. Remove observer listeners for state sync
3. Remove manual state update functions
4. Clean up imports in dependent files

**Total effort:** ~4 hours
**Result:** Production-ready Option D implementation

---

## Testing Strategy

### Unit Tests

```javascript
// M4L side
function testFindAvailableTrack() {
    // Setup: All tracks empty
    for (var i = 0; i < 16; i++) {
        poolState[i] = { state: "empty", muted: false, lastUsed: 0 };
    }

    var track = findAvailableTrack();
    assert(track === 0); // Should return first empty track
}
```

```typescript
// TypeScript side
test('findAvailableTrack requests from M4L', async () => {
    const promise = findAvailableTrack();

    // Simulate M4L response
    window.dispatchEvent(new CustomEvent('osc-message', {
        detail: { address: '/looping/pool/empty_track', args: [5] }
    }));

    const result = await promise;
    expect(result).toBe(5);
});
```

### Integration Tests

1. **Empty pool:** Click MIDI button → should get track 0
2. **Partial pool:** Fill tracks 0-5 → should get track 6
3. **Full pool:** Fill all 16 → should show "pool exhausted"
4. **Muted tracks:** Mute track with clips → should become recyclable
5. **Audio conversion:** Click Audio button → should get empty track, convert, and configure

### Manual Testing

```bash
npm run dev
```

**Test scenarios:**
1. Click "MIDI" button → M4L provides track
2. Click "Audio" button → M4L provides track, converts to audio
3. Add clips to tracks → Pool stats update automatically
4. Mute tracks → Pool stats show muted count
5. Fill all 16 tracks → Pool exhausted message

**Expected logs:**
```
[TrackPool] Requesting empty track from M4L pool manager...
LiveAPI-V6: Finding available track...
LiveAPI-V6: Found empty track: 0 (verified with Live API)
[TrackPool] ✓ M4L provided track 0
```

---

## Success Metrics

**Before (Band-Aid Validation):**
- ❌ 320ms per track selection (16 queries)
- ❌ Still had sync issues
- ❌ Required DEBUG_POOL_VERIFICATION = true
- ❌ 750 lines TypeScript

**After (Option D):**
- ✅ 20ms per track selection (1 request)
- ✅ No sync issues (single source of truth)
- ✅ No validation needed (instant verification)
- ✅ 220 lines TypeScript (70% reduction)

---

## Monitoring & Debugging

### M4L Logs

Enable debug mode:
```
send('/looping/debug', [1]);
```

**Expected output:**
```
LiveAPI-V6: Finding available track...
LiveAPI-V6: Current pool state: 2/16 in-use, 14 available, 1 muted
LiveAPI-V6: Found empty track: 2 (verified with Live API)
```

### TypeScript Logs

**Normal operation:**
```
[TrackPool] Requesting empty track from M4L pool manager...
[TrackPool] ✓ M4L provided track 3
[TrackPool] Stats updated from M4L: 4/16 (25%)
```

**Pool exhausted:**
```
[TrackPool] Requesting empty track from M4L pool manager...
[TrackPool] Pool exhausted - M4L reports no tracks available
```

### Troubleshooting

**Problem:** Pool request timeout

**Solution:** Check M4L device is loaded in Live, verify OSC ports.

**Problem:** Wrong track returned

**Solution:** Check M4L log to see verification results, may need to reload Live.

**Problem:** Stats not updating

**Solution:** Check pool stats listener is active, verify M4L is sending `/looping/pool/stats`.

---

## References

- **Document:** `documentation/current-project/trackpool-sync-issues.md`
- **Code (M4L):** `ableton/scripts/liveAPI-v6.js` (lines 62-67, 2542-2839)
- **Code (TypeScript):** `interface/src/lib/services/trackPoolService.ts`
- **Code (Track Prep):** `interface/src/lib/services/trackPreparation.ts`
- **Related:** ADR-030 (Focused View Tracking)
- **Related:** Phase 2 (Track Pool System)

---

## Lessons Learned

### 1. Single Source of Truth Eliminates Entire Class of Bugs

**Problem:** Split state + sync = constant debugging

**Solution:** Move state to component with direct API access

**Lesson:** Don't distribute state unless absolutely necessary.

---

### 2. Direct API Access > OSC Queries

**M4L has Live API:** Instant, no network overhead

**TypeScript via OSC:** 20ms per query, network-dependent

**Lesson:** Put logic close to the data source.

---

### 3. Verification > Synchronization

**Old approach:** Keep two copies in sync (hard)

**New approach:** One copy + instant verification (easy)

**Lesson:** Self-healing systems are more robust than synchronized systems.

---

### 4. Thin Clients Are Simpler

**Before:** 750 lines of state management

**After:** 220 lines of request/response

**Lesson:** Dumb clients + smart servers = simpler architecture.

---

**Status:** Accepted and Implemented (Enhanced)
**Performance:** 20ms per track selection (94% faster)
**Reliability:** 100% (no sync issues)
**Code Reduction:** 70% (750 → 220 lines)
**UI Filtering:** Enabled via per-track state broadcasts
**Unified Track Finding:** All operations use pool (removed duplicate logic)
**Next Review:** After 100+ uses in production

---

**Last Updated:** 2025-10-10 (Enhanced with per-track state broadcasting)
