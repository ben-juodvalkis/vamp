# ADR 096: Sequencer Device v2.0 Architecture

**Date:** 2025-10-30
**Status:** Accepted
**Context:** Refactoring sequencer-device.js for extensibility and maintainability

## Context

The sequencer device (v1.3) had hardcoded mute/pitch sequencers with significant code duplication. Adding new transformations (velocity, ratchet, probability, etc.) would require duplicating the entire sequencer pattern each time. The architecture didn't support composing multiple transformations or future generative effects.

## Decision

Implement a **layered transformation architecture** with distinct separation of concerns:

### Core Architecture Components

#### 1. Value Type System
```javascript
VALUE_TYPES = {
    binary: { validate, default, range, description },
    midi_range: { validate, default, range, description },
    normalized: { validate, default, range, description },
    semitones: { validate, default, range, description }
}
```

- Defines validation, defaults, and ranges for pattern values
- Prevents invalid pattern data
- Extensible for future types (pitch_class, probability, etc.)

#### 2. Sequencer Class (Generic)
```javascript
function Sequencer(name, transformation, valueType, patternLength)
```

**Purpose:** Adds timing and pattern control to ANY transformation

**Responsibilities:**
- Pattern management (with validation via VALUE_TYPES)
- Timing calculations (bar.beat.tick → step number)
- Step progression tracking
- Wraps a Transformation, doesn't implement transformation logic

**Key Methods:**
- `setPattern(pattern)` - Validates and sets pattern
- `setStep(index, value)` - Sets individual step with validation
- `setLength(length)` - Changes pattern length, preserving values
- `setDivision(division)` - Sets timing (bar.beat.tick format)
- `calculateStep(ticks)` - Computes current step from tick position
- `getCurrentValue()` - Returns value at current step
- `reset()` - Resets to initial state

#### 3. Transformation Base Class
```javascript
function Transformation(name, isGenerative)
```

**Purpose:** Defines interface for all clip transformations

**Key Methods:**
- `canApply(trackType, clip)` - Check if transformation applies to this clip
- `apply(track, clip, value, sequencer)` - Apply transformation with value
- `revert(track, clip, sequencer)` - Revert to pristine state
- `initialize(track)` - One-time setup (e.g., detect instruments)
- `onDeviceChanged(track)` - React to device changes
- `createLayerFunction(track, clip, value, sequencer)` - Create layer function for composition

**Lifecycle:**
1. Created independently (no sequencer needed)
2. Initialized when device loads
3. Applied on each step (if sequenced) or on-demand (if not)
4. Reverted when pattern changes or transport stops

#### 4. Two-Phase TransformationLayerManager

**Purpose:** Compose multiple transformations without drift or conflicts

**Architecture:**
```
Original State (pristine)
    ↓
Phase 1: GENERATIVE transformations (create/remove notes)
    - ratchet, arpeggio, euclidean, slice, probability
    - Changes note count
    ↓
Generated State (cached)
    ↓
Phase 2: MODIFICATIVE transformations (modify properties)
    - mute, pitch, velocity, duration, pan
    - Modifies existing notes
    ↓
Final State (cached)
    ↓
Applied to clip
```

**Key Features:**
- Always works from pristine original state (captured once per clip)
- Generative layers run first (change structure)
- Modificative layers run second (change properties)
- Two-tier caching:
  - Generative cache: Invalidated only when generative layers change
  - Composite cache: Invalidated when any layer changes
- Per-clip state management
- Deep copy utilities for immutability

**Key Methods:**
- `captureOriginalState(clipId, clip, trackType)` - Capture pristine state once
- `registerGenerativeLayer(clipId, name, layerFn)` - Register Phase 1 layer
- `registerModificativeLayer(clipId, name, layerFn)` - Register Phase 2 layer
- `composeTransformations(clipId)` - Execute two-phase pipeline
- `applyComposite(clipId, clip, trackType)` - Apply final state to clip
- `restorePristine(clipId, clip, trackType)` - Restore original state
- `clearClipState(clipId)` - Clear all state for clip

#### 5. Concrete Implementations

**MuteTransformation (Modificative)**
- Pattern value: `1 = play, 0 = mute`
- MIDI: Sets `note.mute` property (Live API: 0=unmuted, 1=muted)
- Audio: Sets `clip.gain` (0.0 for muted, original for unmuted)

**PitchTransformation (Modificative)**
- Pattern value: `1 = shift up, 0 = original`
- Encapsulates all instrument detection logic:
  - Drum racks (standard/KK) → device transpose parameter
  - Instrument racks → device transpose parameter
  - Other MIDI → note pitch modification
  - Audio → pitch_coarse parameter
- Responds to device changes (onDeviceChanged)

### SequencerDevice Refactoring

**Constructor:**
```javascript
function SequencerDevice() {
    // Create transformations (independent)
    var muteTransform = new MuteTransformation();
    var pitchTransform = new PitchTransformation();

    // Create sequencers (wrap transformations)
    this.sequencers = {
        mute: new Sequencer('mute', muteTransform, 'binary', 8),
        pitch: new Sequencer('pitch', pitchTransform, 'binary', 8)
    };

    // Unified transformation registry
    this.transformations = {
        mute: muteTransform,
        pitch: pitchTransform
        // Future: velocity, ratchet, probability, etc.
    };

    // Layer manager for composition
    this.layerManager = new TransformationLayerManager();

    // Set device references
    for (var name in this.sequencers) {
        this.sequencers[name].device = this;
        this.sequencers[name].transformation.device = this;
    }
}
```

**Generic Methods:**
- `processSequencerTick(seqName, ticks)` - Generic tick processor
- `sendSequencerFeedback(seqName)` - Generic UI feedback
- `init()` - Calls `initialize()` on all transformations
- `setupDeviceObserver()` - Notifies all transformations of device changes
- `resetToDefaults()` - Iterates over all sequencers/transformations

**State Management:**
- v2.0 format with `version` field
- Backward compatible with v1.x format
- Saves/restores all sequencers dynamically

### Debug Mode

Enable comprehensive logging:

```javascript
// In sequencer-device.js, line ~113
var DEBUG_MODE = false; // Set to true for development
```

**Debug Output:**
- Initialization logs (track type, instruments detected)
- Step processing logs (step number, value, ticks)
- Transformation application logs
- Layer composition logs
- Format: `[Sequencer DEBUG:context] message | Data: {...}`

**To Enable:**
1. Edit `sequencer-device.js`
2. Change line ~113: `var DEBUG_MODE = true;`
3. Reload device in Ableton
4. Check Max console for detailed logs

## Consequences

### Positive

1. **Extensibility**: Adding new transformations requires ~40 lines (class definition)
2. **Composability**: Multiple transformations work together via layer system
3. **Type Safety**: VALUE_TYPES prevents invalid pattern values
4. **Performance**: Two-tier caching minimizes Live API calls
5. **Maintainability**: Each transformation is self-contained and testable
6. **Future-Ready**: Architecture supports:
   - Generative transformations (ratchet, arpeggio, euclidean)
   - Additional modificative transformations (velocity, duration, pan)
   - Non-sequenced transformations (one-shot effects)
   - Undo/redo system (future v2.1)

### Trade-offs

1. **Code Size**: ~1000 lines added for architecture (but eliminates future duplication)
2. **Complexity**: More classes to understand (but better separation of concerns)
3. **Testing**: Requires comprehensive testing of layer composition
4. **Migration**: v2.0 message format (but backward compatible state loading)

### Technical Debt Resolved

- ✅ Eliminated hardcoded sequencer duplication
- ✅ Removed magic numbers (all in VALUE_TYPES)
- ✅ Centralized instrument detection (now in PitchTransformation)
- ✅ Fixed state drift issues (pristine state management)
- ✅ Proper error handling throughout

### Future Enhancements Enabled

**v2.1 Candidates:**
- Velocity sequencer (modificative)
- Duration sequencer (modificative)
- Pan sequencer (modificative)
- Ratchet transformation (generative)
- Arpeggio transformation (generative)
- Probability transformation (generative)
- Clip manipulators (reverse, quantize, humanize)
- Undo/redo history system

## Implementation

**Files Modified:**
- `ableton/M4L devices/sequencer-device.js` - v1.3 → v2.0 (~1400 → ~2400 lines)

**Documentation:**
- `documentation/current/sequencer-refactoring-plan.md`
- `documentation/current/sequencer-refactoring-log.md`
- `ableton/M4L devices/sequencer-device-README.md` (updated)

**Testing:**
- Comprehensive testing checklist in refactoring log
- All v1.3 functionality preserved
- New architecture validated

## References

- Refactoring Plan: `documentation/current/sequencer-refactoring-plan.md`
- Implementation Log: `documentation/current/sequencer-refactoring-log.md`
- Original Device: v1.3 (git history)
- Config File: `config/constants.json` (transpose parameters)

## Related ADRs

- ADR 064: Centralize Transpose Configuration
- ADR 062: Sequencer Position OSC Messages
