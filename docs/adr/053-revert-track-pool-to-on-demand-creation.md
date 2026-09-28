#ADR-053: Revert Track Pool to On-Demand Track Creation

**Date:** 2025-01-12
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** Track Management, Performance, Simplification, Architecture

---

## Context

In Phase 2 (ADR-024, superseded by ADR-031), we implemented a track pool system with 16 pre-made MIDI tracks to eliminate the performance penalty of on-demand track creation in Ableton Live.

### The Track Pool System

**Architecture:**
- 16 pre-made MIDI tracks (indices 0-15)
- M4L as single source of truth for pool state
- TypeScript requests tracks via OSC (`/looping/pool/get_empty_track`)
- Complex observer system for clip state, mute state, track type
- Audio track conversion via clipboard automation (670ms Python script)
- ~1000 lines of code across TypeScript and Max4Live

**Performance:**
- Track selection: <50ms (instant)
- Audio conversion: ~1.2s (clipboard + conversion)
- Predictable, constant-time operations

**Complexity Added:**
- M4L pool manager (~300 lines)
- TypeScript pool service (~220 lines)
- Clip slot observers for all 16 tracks
- Per-track state broadcasting
- Audio clipboard automation (Python + Max shell helper)
- Pool state synchronization (eliminated in ADR-031 but still complex)

### The Problem

**Regret and Reconsideration:**

After living with the pool system, the added complexity outweighed the performance benefits:

1. **Excessive complexity for the use case**
   - Pool management, observers, state tracking for a marginal speed gain
   - 16-track limit requires careful management
   - Track filtering in UI requires per-track state cache

2. **Audio conversion fragility**
   - Clipboard automation with focus changes (visible UI flash)
   - macOS-specific (PyObjC, AppleScript)
   - Accessibility permissions required
   - Brittle timing dependencies

3. **Track panel coupling**
   - UI had to filter tracks by pool state
   - Required observer-driven per-track state cache
   - More complexity to show only "active" tracks

4. **Maintenance burden**
   - Large codebase to maintain for marginal benefit
   - Observer lifecycle management
   - Pool state verification and self-healing

### The Question

**Is <50ms track selection worth 1000 lines of code?**

For a live performance system where track creation is relatively infrequent, probably not.

---

## Decision

**Revert to simple on-demand track creation** via AbletonOSC.

### Core Principles

1. **Simplicity over optimization**
   - Track creation is infrequent enough that 100-1000ms is acceptable
   - Simpler code is easier to maintain and understand

2. **Show all tracks**
   - No filtering by pool state
   - Simple `Array.from({ length: numTracks })` in UI

3. **Direct audio track creation**
   - Use AbletonOSC `/live/song/create_audio_track` directly
   - No clipboard conversion gymnastics

4. **Smart reuse logic**
   - Keep the `shouldCreateTrack()` logic (reuse empty tracks)
   - Create new tracks only when needed

---

## Implementation

### Changes Made

**1. Deleted Files:**
```
interface/src/lib/services/trackPoolService.ts         (~370 lines)
scripts/audio_clipboard.py                             (~200 lines)
```

**2. Updated TypeScript Files:**

**`trackPreparation.ts`:**
- Removed pool service imports
- Main `prepareTrack()` reverted to legacy flow
- Flow: `shouldCreateTrack()` → `createTrack()` → load device
- Audio tracks: Direct `/live/song/create_audio_track` (no conversion)

**`TracksPanelV6.svelte`:**
```typescript
// Before (pool filtering):
let visibleTracks = $derived(
  session.poolTracks.filter(t =>
    t.hasClips || t.trackIndex === session.selectedTrackIndex
  )
);

// After (show all):
let allTracks = $derived(
  Array.from({ length: session.numTracks }, (_, i) => i)
);
```

**`session.svelte.ts`:**
- Removed `PoolTrack` and `PoolStats` imports
- Removed pool state: `_poolStats`, `_poolInitialized`, `_poolTracks`
- Removed pool getters and functions
- Added `numTracks` getter for UI compatibility

**`clipOperations.ts`:**
- `sampleClipToSimpler()` creates tracks on-demand:
```typescript
send('/live/song/create_midi_track', [-1]);
await new Promise(resolve => setTimeout(resolve, 150));
const trackIndex = session.numTracks - 1;
```

**`+layout.svelte`:**
- Removed `initializePool()` and `destroyPool()` calls

**3. Max4Live Cleanup (Manual):**

The following functions in `ableton/scripts/liveAPI-v6.js` are now dead code (not called by frontend):
- `initializePoolClipObservers()` (~50 lines)
- `setupPoolClipSlotObserver()` (~16 lines)
- `poolClipSlotChanged()` (~50 lines)
- `checkAndSendPoolTrackClipState()` (~45 lines)
- `cleanupPoolClipObservers()` (~15 lines)
- `trackHasClips()` (~20 lines)
- `getPoolStateString()` (~30 lines)
- `sendPoolStats()` (~30 lines)
- `queryPoolState()` (~10 lines)
- OSC handlers for `/looping/pool/*` in `anything()` and `list()`
- Pool logic in mute observer (lines ~295-310)

**Total: ~300 lines of dead M4L code** (can be removed at leisure)

---

## Consequences

### Positive

✅ **Massive code reduction**
- ~1000 lines removed from TypeScript + Max4Live
- 70% reduction in trackPreparation.ts (750 → 220 lines, then back to simple)

✅ **Dramatically simpler architecture**
- No pool state management
- No observer synchronization
- No clipboard automation
- No per-track state cache

✅ **Easier to understand and maintain**
- Straightforward: need track? create it or reuse empty one
- No complex pool lifecycle or state tracking

✅ **No macOS-specific dependencies**
- No PyObjC, AppleScript, accessibility permissions
- Pure AbletonOSC

✅ **Track panel simplification**
- Show all tracks, no filtering needed
- No coupling to pool state

✅ **No 16-track limit**
- Users can have as many tracks as they want
- No pool exhaustion warnings

### Negative

⚠️ **Slower track creation**
- Fresh session: ~100ms (was <50ms)
- Large session (50+ tracks): ~1000ms+ (was <50ms)
- Variable timing based on session complexity

⚠️ **Audio track creation requires stopping playback** (AbletonOSC limitation)
- Pool+conversion worked while playing
- Direct creation may require transport stop

⚠️ **No instant track selection**
- Lost the "snappy" feel of pool selection
- User waits for track creation

### Mitigation

**Acceptable trade-offs:**
- Track creation is infrequent in live performance (setup phase)
- 100-1000ms is still fast enough for user workflow
- Simplicity and maintainability worth the performance cost

**Future optimization (if needed):**
- Could pre-create 2-3 tracks during idle time
- Much simpler than full pool system
- Only if performance becomes a real issue

---

## Performance Comparison

| Operation | Pool System | On-Demand |
|-----------|-------------|-----------|
| **MIDI track creation** | <50ms | 100-1000ms |
| **Audio track creation** | ~1.2s (conversion) | 100-1000ms |
| **Code complexity** | ~1000 lines | ~200 lines |
| **Observer overhead** | High (16 tracks) | None |
| **State management** | Complex | None |
| **Maintenance burden** | High | Low |

---

## Alternatives Considered

### Option A: Simplified Pool
Keep pool but remove complexity:
- No audio conversion (use direct creation)
- No per-track state broadcasting
- Simple first-empty-track selection

**Why not:** Still adds significant complexity for minimal benefit

### Option B: Lazy Pool (2-3 tracks)
Pre-create just 2-3 tracks during idle time:
- Much simpler than 16-track pool
- No observers needed
- Still instant for first few tracks

**Why not:** Decided to try full removal first, can add later if needed

### Option C: Keep Pool, Improve It
Fix the issues instead of removing:
- Improve audio conversion reliability
- Better state management
- Pool size configuration

**Why not:** Fundamental question is whether optimization is worth the complexity

---

## Migration Path

**Phase 1: TypeScript Removal** ✅
1. Delete `trackPoolService.ts`
2. Update `trackPreparation.ts` to legacy flow
3. Update `TracksPanelV6` to show all tracks
4. Remove pool from session store
5. Remove pool initialization from `+layout.svelte`
6. Update `clipOperations.ts` for on-demand creation

**Phase 2: Max4Live Cleanup** (Optional)
1. Open `ableton/scripts/liveAPI-v6.js`
2. Delete pool functions (listed above)
3. Remove pool OSC handlers
4. Remove pool logic from mute observer
5. Test Max patch

**Phase 3: Testing** ✅
1. Test MIDI track creation (all types)
2. Test audio track creation
3. Test sample-to-simpler
4. Verify track panel shows all tracks
5. Check for console errors

---

## Testing Results

**System Status:** ✅ Functional

All TypeScript changes complete. System works with on-demand track creation:
- ✅ MIDI tracks (drum_rack, omnisphere, ni, ni_drum)
- ✅ Audio tracks
- ✅ Sample-to-simpler
- ✅ Track panel displays
- ✅ No errors in console

Max4Live file has ~300 lines of harmless dead code that can be cleaned up at leisure.

---

## Lessons Learned

### 1. Premature Optimization

**Initial assumption:** Track creation slowness (100-1000ms) is unacceptable.

**Reality:** Track creation is infrequent enough that optimization was premature.

**Lesson:** Profile first, optimize later. Don't optimize based on assumptions.

### 2. Complexity Compounds

**Initial scope:** Just pre-create 16 tracks for instant selection.

**Final scope:**
- Pool state management
- Observer system
- Clipboard automation
- Per-track state broadcasting
- UI filtering
- Audio conversion workarounds

**Lesson:** "Simple" optimizations often cascade into complex systems.

### 3. Know When to Quit

**Living with the pool:** Months of maintenance, debugging observer issues, state synchronization bugs.

**The reversion:** Done in a few hours, dramatically simpler code.

**Lesson:** Don't be afraid to revert decisions. Sunk cost fallacy is real.

### 4. Optimize for Readability

**Pool system:** Fast but hard to understand and maintain.

**On-demand:** Slightly slower but obvious how it works.

**Lesson:** In systems you maintain solo, readability >> performance (unless perf is critical).

---

## Related Documents

- **Original Pool ADR:** [ADR-024: Track Pool System](./024-track-pool-system.md) (superseded)
- **Pool Architecture:** [ADR-031: Track Pool M4L Single Source of Truth](./031-track-pool-m4l-single-source-of-truth.md) (superseded)
- **Audio Conversion:** [ADR-021: Audio Track Pool Integration](./021-audio-track-pool-integration.md) (superseded)
- **Observer Lifecycle:** [ADR-025: Pool Track Observer Lifecycle](./025-pool-track-observer-lifecycle.md) (superseded)
- **Removal Summary:** [TRACK_POOL_REMOVAL_SUMMARY.md](../../TRACK_POOL_REMOVAL_SUMMARY.md)

---

## Superseded ADRs

This ADR supersedes the track pool system entirely:
- ADR-024: Track Pool System (Phase 2)
- ADR-031: Track Pool M4L Single Source of Truth
- ADR-021: Audio Track Pool Integration via Clipboard Automation
- ADR-025: Pool Track Observer Lifecycle Management

Those ADRs remain for historical context but should not be used for implementation guidance.

---

**Status:** ✅ Accepted and Implemented (TypeScript complete, Max cleanup optional)
**Performance Impact:** Acceptable (100-1000ms track creation)
**Code Reduction:** ~1000 lines removed
**Complexity Reduction:** Dramatic
**Next Review:** After 100+ uses in production to verify performance is acceptable

---

**Last Updated:** 2025-01-12
