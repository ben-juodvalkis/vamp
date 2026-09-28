# ADR-177: Scale Learn Mode

**Status**: Accepted
**Date**: 2026-01-26
**PR**: #292
**Issue**: #287

## Context

When jamming or improvising, manually selecting a key signature from a menu is slow and breaks the creative flow. Users want to simply play a chord on their MIDI controller and have the system automatically detect and set the key signature.

## Decision

Implement Scale Learn Mode entirely in Max/MSP (Max Utility 1.0 + liveAPI-v6.js) with real-time feedback:

1. **Trigger**: Note 0 (C-1) acts as learn mode toggle
   - Note ON: Enter learn mode, enable scale mode, mute track
   - Note OFF: Exit learn mode, unmute track

2. **Real-time Updates**:
   - First note sets root note immediately (preserves current scale type)
   - Each subsequent note recalculates and updates scale in real-time
   - No waiting for note-off to see results

3. **Scale Detection Algorithm**:
   - 29 scale definitions with interval patterns
   - Priority-based matching (Major > Minor > modes > exotic)
   - Score = matched intervals - (mismatched × 2)
   - Ties broken by priority order

## Architecture

```
Max Utility 1.0                    liveAPI-v6.js                  Ableton Live
────────────────                   ─────────────                  ────────────
Note 0 ON ──────────────────────► /looping/learn/start
                                   ├─ mute track
                                   ├─ enable scale mode
                                   └─ ready for notes

Notes 1-127 ────────────────────► /looping/learn/note [pitch]
                                   ├─ 1st note: set root ─────────► root_note
                                   └─ 2nd+ note: detect ──────────► scale_name

Note 0 OFF ─────────────────────► /looping/learn/end
                                   └─ unmute track
```

## OSC Protocol

| Address | Direction | Description |
|---------|-----------|-------------|
| `/looping/learn/start` | To Max | Enter learn mode |
| `/looping/learn/note` | To Max | Add note (0-127) |
| `/looping/learn/end` | To Max | Exit learn mode |
| `/looping/learn/started` | From Max | Confirmation |
| `/looping/learn/result` | From Max | `[rootNote, scaleName]` |
| `/looping/learn/ended` | From Max | Exited without notes |
| `/looping/learn/error` | From Max | Error message |

## Scale Detection

**Supported Scales** (29 total):
- Common: Major, Minor, Dorian, Mixolydian, Minor/Major Pentatonic
- Modes: Lydian, Phrygian, Locrian
- Extended: Harmonic Minor/Major, Melodic Minor
- Blues: Minor Blues
- Diminished: Half-whole Dim., Whole-half Dim.
- Exotic: Whole Tone, 8-Tone Spanish, Bhairav, Hungarian Minor, Hirajoshi, In-Sen, Iwato, Kumoi, Pelog Selisir, Pelog Tembung
- Altered: Dorian #4, Phrygian Dominant, Lydian Augmented, Lydian Dominant, Super Locrian

**Detection Examples**:
- C-E-G → C Major
- C-Eb-G → C Minor
- C-E-G-Bb → C Mixolydian
- C-E-G-B → C Major (not Lydian without F#)

## Alternatives Considered

### 1. Interface-side Detection
**Rejected**: Would require routing MIDI through the bridge, adding latency and complexity.

### 2. Wait for Note-off to Detect
**Rejected**: Less immediate feedback. Users prefer seeing the scale update as they play each note.

### 3. Confirmation Dialog
**Rejected**: Breaks creative flow. Auto-apply is faster and can always be corrected.

## Consequences

### Positive
- Zero interface changes required (existing observers handle updates)
- Real-time feedback enhances creative flow
- Simple trigger mechanism (note 0)
- Comprehensive scale coverage

### Negative
- Requires Max Utility 1.0 patch configuration
- Note 0 (C-1) is reserved for learn mode trigger
- Track is muted during learn (notes not heard)

## Implementation

**Files Modified**:
- `ableton/scripts/liveAPI-v6.js`: State, handlers, detection algorithm, OSC routing
- `Max Patches/Max Utility 1.0.maxpat`: Note 0 trigger, note forwarding
- `documentation/v6-api.md`: OSC protocol documentation

**Key Functions**:
- `startLearnMode()`: Mute track, enable scale mode, reset state
- `addLearnedNote(midiNote)`: Validate, set root or recalculate scale
- `endLearnMode()`: Unmute track, cleanup state
- `detectScale(pitchClasses)`: Match intervals to scale definitions
- `calculateMatchScore(played, scale)`: Score matching algorithm
