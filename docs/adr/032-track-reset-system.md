# ADR 014: Track Reset System (Phase 1)

**Date:** 2025-01-08
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** Performance, Track Management, Max4Live

---

## Context

The track pool system (Phase 2) requires the ability to reset tracks to a clean "Empty Slot N" state for recycling. No existing functionality could efficiently clear all clips, devices, and properties from a track.

### Problems to Solve

1. **No Unified Reset Mechanism**
   - Clips could be deleted individually via AbletonOSC
   - Devices had no deletion API in AbletonOSC
   - Track properties required multiple OSC calls
   - No batch operations for efficiency

2. **Manual Track Cleanup**
   - Users had to manually delete clips and devices
   - Time-consuming and error-prone
   - No way to reset multiple tracks efficiently

3. **Foundation for Track Pool**
   - Phase 2 pool system needs track recycling
   - Muted tracks need to be cleared and reused
   - Must handle both MIDI and Audio tracks

---

## Decision

Implement a comprehensive track reset service that can:
1. Reset individual tracks to clean state (<500ms)
2. Handle batch operations (all tracks, muted tracks only)
3. Properly manage MIDI vs Audio track differences
4. Use AbletonOSC for most operations, Max4Live only for device deletion

---

## Architecture

### Hybrid Approach: AbletonOSC (80%) + Max4Live (20%)

**AbletonOSC Handles:**
- Clip deletion (`/live/clip_slot/delete_clip`)
- Track property reset (name, color, mute)
- Track type queries (`has_midi_input`)
- Track creation/deletion (for audio track replacement)

**Max4Live Handles:**
- Device deletion (no AbletonOSC API available)
- Command: `/looping/track/delete_devices [track_index]`
- Mirrors existing `deleteMasterDevices()` pattern

### Track Reset Process

**For MIDI Tracks (in-place reset):**
1. Query scene count
2. Delete all clips from all scenes
3. Delete all devices (via Max4Live)
4. Reset name to "Empty Slot N"
5. Reset color to gray (0x808080)
6. Unmute track

**For Audio Tracks (delete and replace):**
1. Delete audio track
2. Create MIDI track at same position
3. Name and color as "Empty Slot N"

**Why delete audio tracks?** Cannot reset audio tracks in-place. Creating new MIDI track is cleaner and ensures consistent pool state.

### Batch Operations

**`resetAllTracks(poolSize)`:**
- Query all track types (MIDI vs Audio)
- Reset MIDI tracks in-place
- Delete audio tracks (highest to lowest index)
- Create replacement MIDI tracks
- Ensures all pool tracks are MIDI and clean

**`resetAllMutedTracks(poolSize)`:**
- Query mute state for all tracks
- Reset only muted tracks
- Returns success/failure counts

---

## Implementation

### Files Created
- `interface/src/lib/services/trackResetService.ts` (376 lines)

### Files Modified
- `ableton/scripts/liveAPI-v6.js` (added device deletion)

### Key Functions

```typescript
// Single track reset
await resetTrack(trackIndex);

// Batch reset all pool tracks
await resetAllTracks(16, (current, total) => {
  console.log(`Progress: ${current}/${total}`);
});

// Batch reset muted tracks only
const result = await resetAllMutedTracks(16);
console.log(`Reset ${result.success}/${result.total} tracks`);
```

---

## Consequences

### Positive

1. **Foundation for Pool System**
   - Phase 2 can now recycle tracks efficiently
   - Muted tracks can be cleared and reused
   - Batch operations support pool initialization

2. **Reusable Utility**
   - Standalone service useful beyond pool system
   - Manual track cleanup for users
   - Testing utilities for track state

3. **Performance**
   - Single track reset: ~200-400ms
   - Batch reset 16 tracks: ~4-8s
   - Predictable timing with fixed delays

4. **Type Safety**
   - Full TypeScript implementation
   - Comprehensive error handling
   - Event-based query system with timeouts

### Negative

1. **Max4Live Dependency**
   - Still requires Max4Live for device deletion
   - AbletonOSC lacks device deletion API
   - Cannot be pure AbletonOSC solution

2. **Timing Sensitivity**
   - Uses fixed delays between operations
   - May need tuning for different systems
   - No listener-based confirmation (relies on delays)

3. **Index Shifting Complexity**
   - Audio track deletion requires reverse iteration
   - Careful index management needed
   - Potential for bugs if not handled correctly

### Risks Mitigated

- **Testing:** Comprehensive testing guide created
- **Documentation:** Complete API reference in v6-api.md
- **Patterns:** Mirrors existing proven patterns (deleteMasterDevices)
- **Error Handling:** Try/catch blocks, timeout fallbacks

---

## Testing

**Manual Testing:**
- UI button in Clip Central View: "Clear Current Track"
- Browser console functions for batch operations
- 10 comprehensive test scenarios documented

**Performance Targets:**
- ✅ Single track reset: <500ms (actual: ~200-400ms)
- ✅ Batch reset 16 tracks: <8s (actual: ~4-8s)
- ✅ Device deletion: <100ms (actual: instant)

---

## Alternatives Considered

### 1. Pure AbletonOSC (No Max4Live)
**Rejected:** No API for device deletion in AbletonOSC

### 2. Pure Max4Live (No AbletonOSC)
**Rejected:** AbletonOSC is faster and more reliable for most operations. Max4Live should be minimized.

### 3. No Audio Track Handling
**Rejected:** Pool needs to guarantee all-MIDI state. Must handle audio track conversion.

---

## Related Documents

- **Implementation Log:** `phase-1-implementation-log.md`
- **Testing Guide:** `phase-1-testing-guide.md`
- **API Reference:** `documentation/v6-api.md` (Track Reset Messages)
- **Completion Summary:** `PHASE-1-COMPLETE.md`

---

## Notes

Phase 1 is independently useful and mergeable. It provides standalone track cleanup functionality while serving as the foundation for Phase 2's pool recycling system.

**Phase 1 → Phase 2 dependency:** Phase 2 uses `resetTrack()` for muted track recycling.

---

**Last Updated:** 2025-01-08
