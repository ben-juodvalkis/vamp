# ADR 125: Reversible Temperature Transformation via Note ID Tracking

## Status
Accepted

## Date
2025-11-21

## Context

The temperature transformation feature shuffles MIDI note pitches within a clip to create variations. Previously, this was a destructive operation - once notes were shuffled, there was no way to restore the original pitches without stopping transport.

Users wanted the ability to:
1. **Instantly restore** original pitches by setting temperature to 0
2. **Control distance from original** - low temp should mean "close to original", high temp should mean "far from original"
3. **Handle overdubbing gracefully** - new notes added during temperature should be preserved

## Decision

Implement reversible temperature transformation using Live API's native `note_id` field for tracking.

### Key Design Choices

#### 1. Note ID-Based Tracking (vs. Permutation Math)

**Chosen:** Store original pitches by note ID
```javascript
temperatureState[clipId] = {
    originalPitches: { [noteId]: pitch },
    capturedWithPitchOn: boolean
}
```

**Rejected:** Permutation tracking (Issue #176)
- Complex inverse permutation math
- Breaks when notes added/deleted
- Harder to reason about

Note IDs are stable, persistent identifiers that Live assigns to each note. They survive transformations and provide a direct mapping.

#### 2. Value-Based Enable/Disable

**Behavior:**
- `temperature > 0` → Capture original pitches (if not captured), start shuffling
- `temperature = 0` → Restore original pitches, stop shuffling
- No separate toggle needed

**Rationale:** Simpler UX - the slider does double duty. Setting to 0 is intuitively "off".

#### 3. Shuffle-from-Original Each Loop

**Chosen:** Each loop jump restores to original, then applies fresh random shuffle

**Rejected:** Cumulative shuffling on current state

**Rationale:** Temperature value now directly controls "distance from original":
- `temp = 0.1` → Slightly varied from original each loop
- `temp = 0.9` → Wildly varied from original each loop

With cumulative shuffling, lowering temperature only slowed the drift into chaos rather than bringing notes back closer to original.

#### 4. Guaranteed Minimum Swap

When `temperature > 0`, at least one pair of notes is always swapped. This prevents the confusing case where very low temperatures (e.g., 0.01) might result in no audible change.

## Implementation

### New State
```javascript
this.temperatureState = {};  // clipId -> { originalPitches, capturedWithPitchOn }
```

### New Functions
- `captureTemperatureState(clipId)` - Called on 0 → >0 transition
- `restoreTemperatureState(clipId)` - Called on >0 → 0 transition

### Modified Functions
- `temperature()` - Detects transitions, calls capture/restore
- `onTemperatureLoopJump()` - Restores before shuffle
- `onTransportStop()` - Restores temperature state if exists
- `onTransportStart()` - Captures if temp > 0 and no state
- `generateSwapPattern()` - Guarantees min 1 swap

### Pitch Sequencer Interaction

Temperature must account for the pitch sequencer's +12 semitone shift:
- **Capture:** If pitch is on, subtract 12 to get TRUE base pitch
- **Restore:** If pitch is currently on, add 12 to restored pitch
- **Exception:** Drum racks and instrument racks use device parameters, not note modification

## Consequences

### Positive
- Instant restore by setting temp to 0
- Temperature value intuitively controls "distance from original"
- Overdubbed notes preserved (not in map = keep current pitch)
- Deleted notes gracefully skipped
- No complex permutation math
- Works correctly with pitch sequencer

### Negative
- Additional memory for storing original pitches per note
- Slightly more complex loop jump logic (restore before shuffle)

### Neutral
- Temperature state is per-clip (matches existing `lastValues` pattern)
- State cleared on transport stop (fresh capture on next start)

## References

- Issue #177: Reversible Temperature Transformation via Note ID Tracking
- Issue #176: Original permutation approach (superseded)
- ADR 106: Temperature Transformation Architecture
- ADR 110: Sequencer Device v3 Refactor
- [Live API - get_all_notes_extended](https://docs.cycling74.com/apiref/lom/clip/#get_all_notes_extended)
