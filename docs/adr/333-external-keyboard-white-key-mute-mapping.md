# ADR-333: External Keyboard White Key Mute Mapping

**Status**: Accepted
**Date**: 2026-03-30
**Supersedes**: ADR-325

## Context

ADR-325 mapped chromatic MIDI notes 48–59 to track mutes and 60–72 to solos. This required remembering specific note numbers and was limited to one octave. During live performance, a more intuitive mapping is preferable — one where any C on the keyboard mutes track 0, any D mutes track 1, etc., regardless of octave.

## Decision

Replace the chromatic range mapping with a white-key pitch-class mapping. Solo control is removed. The system now:

1. Converts the incoming MIDI note to a pitch class: `pitchClass = midiNote % 12`
2. Looks up the pitch class in a white-key map:

| Pitch Class | Note | Track |
|-------------|------|-------|
| 0 | C | 0 |
| 2 | D | 1 |
| 4 | E | 2 |
| 5 | F | 3 |
| 7 | G | 4 |
| 9 | A | 5 |
| 11 | B | 6 |

3. Black keys (pitch classes 1, 3, 6, 8, 10) are silently ignored with a log message.

## Implementation

**File modified**: `ableton/scripts/liveAPI-v6.js` — `handleExternalKeyboardMod()`

```javascript
var WHITE_KEY_MAP = {0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6};
var pitchClass = midiNote % 12;
if (WHITE_KEY_MAP.hasOwnProperty(pitchClass)) {
    trackIndex = WHITE_KEY_MAP[pitchClass];
} else {
    // black key — ignored
    return;
}
```

The dispatcher route (`/looping/learnexternal_keyboard_mod`) and all supporting infrastructure are unchanged.

## Consequences

### Positive
- Octave-agnostic: same key works anywhere on the keyboard
- Musically intuitive — no note numbers to memorize
- Simpler code: single pitch-class lookup replaces two range checks

### Negative
- Reduced to 7 mutable tracks (one per white key in an octave)
- Solo control removed entirely
