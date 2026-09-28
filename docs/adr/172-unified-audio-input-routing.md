# ADR-172: Unified Audio Input Routing

**Status**: Accepted
**Date**: 2026-01-24
**Updated**: 2026-02-02

## Context

Audio tracks were created with inconsistent input routing depending on how they were created:

| Creation Method | Track Type | Previous Routing |
|-----------------|------------|------------------|
| Pedal 1 Hold | Guitar | Channel `3` |
| Pedal 2 Hold | Mic | Channel `1` |
| Pedal 3 Hold | Bass | Channel `3` |
| Audio Sidebar Button | Audio | `"No Input"` |

This inconsistency meant users had to manually configure input routing after creating audio tracks, depending on which method they used.

## Decision

Standardize all audio track creation to use `"11/12 Guitar Mic"` as the input routing channel. This matches the user's hardware configuration where guitar and microphone inputs are routed through channels 11/12.

### Changes Made

1. **Track Types Configuration** (`config/trackTypes.json`):
   - All audio track types now specify `"11/12 Guitar Mic"` as the `subChannel`
   - Guitar, Bass, Mic, Keys, and Audio all use identical routing
   - The distinction between track types is now purely cosmetic (name, color) and effects-based

2. **TypeScript Track Preparation** (`interface/src/lib/services/trackPreparation.ts`):
   - `prepareAudioTrackWithRouting(trackName?)` - simplified signature, no longer accepts subChannel parameter
   - `prepareTrackByType()` - hardcodes `"11/12 Guitar Mic"` instead of reading from config
   - `prepareTrack('audio')` - uses `"11/12 Guitar Mic"` routing

### Track Type Differences (Post-Simplification)

| Track Type | Name | Color | Effects | Routing |
|------------|------|-------|---------|---------|
| audio | Audio | Green | None | 11/12 Guitar Mic |
| guitar | Guitar | Orange | None | 11/12 Guitar Mic |
| bass | Bass | Purple | Bass.adg | 11/12 Guitar Mic |
| mic | Mic | Red | Vocal.adg | 11/12 Guitar Mic |
| keys | Keys | Yellow | Piano Reverb.adv | 11/12 Guitar Mic |

### Implementation Details

The routing channel is set via OSC message:
```
/live/track/set/input_routing_channel [trackIndex, "11/12 Guitar Mic"]
```

Note: Channel values must be strings (not integers) as they represent Ableton's named routing options.

## Consequences

### Positive
- Consistent behavior across all audio track creation methods
- No manual routing configuration needed after creating tracks
- Ready to record immediately after track creation
- Simplified codebase - routing is hardcoded rather than configured per-track-type
- Track types still provide value through automatic effects loading

### Negative
- Hardcoded to specific hardware configuration ("11/12 Guitar Mic")
- Users with different audio interface setups would need to modify code

## Future Considerations

Consider moving the routing channel to `config/constants.json` to make it user-configurable without code changes.
