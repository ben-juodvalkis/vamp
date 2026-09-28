#ADR-055: Temporarily Disable Empty Instrument Loading

**Date:** 2025-01-13
**Status:** Temporary / Experimental
**Deciders:** Ben Juodvalkis
**Tags:** Track Preparation, Instruments, Performance, Testing

---

## Context

In the current track preparation workflow (`trackPreparation.ts`), when creating MIDI tracks for instruments (drum_rack, omnisphere, ni, ni_drum), we:

1. Create or reuse an empty MIDI track
2. Load an empty instrument preset onto the track
3. Then the user loads their desired preset/patch

### Current Empty Preset Loading

The system loads these empty instruments:

```typescript
const EMPTY_PRESET_PATHS = {
    drum_rack: '/Users/.../Empty Drum Rack.adg',
    omnisphere: '/Users/.../Omnisphere.aupreset',
    ni: '/Users/.../Komplete Kontrol.aupreset',
    ni_drum: '/Users/.../NI Drum.adg'
};
```

**Purpose of empty presets:**
- Provides a consistent starting point
- Ensures the correct instrument type is loaded before browsing
- Pre-configures device chains for specific instrument types

**Cost of empty presets:**
- Adds ~200-500ms to track preparation time
- Requires Max4Live device loading (`/looping/devices/load`)
- Additional step before user can load their actual preset

### The Question

**Do we actually need to load empty instruments, or can we just create empty MIDI tracks?**

Some considerations:
- For browsing presets, do we need the instrument pre-loaded?
- Does the gesture browser require a specific instrument to be present?
- Would loading presets onto truly empty MIDI tracks work just as well?
- Could skipping empty instruments make the workflow faster and simpler?

---

## Decision

**Temporarily disable empty instrument loading** to test if it's actually necessary.

### Implementation

Comment out the empty preset loading section in `trackPreparation.ts:277-294`:

```typescript
// 4. Load empty preset/device if needed (via Max4Live)
// TEMPORARILY DISABLED: Just create empty MIDI tracks without loading instruments
/*
if (trackType in EMPTY_PRESET_PATHS) {
    const presetTrackType = trackType as PresetTrackType;

    // Check if matching instrument already exists on track
    if (hasMatchingInstrument(presetTrackType)) {
        console.log(`[TrackPrep] ✓ Matching instrument already loaded, skipping empty preset`);
    } else {
        const presetPath = EMPTY_PRESET_PATHS[presetTrackType];
        console.log(`[TrackPrep] Loading empty preset: ${presetPath}`);

        // Use the same working path as ghost device loading
        send('/looping/devices/load', [presetPath]);
    }
}
*/
```

**Result:** Track preparation now creates empty MIDI tracks without loading any instruments.

---

## Consequences

### Potential Benefits

✅ **Faster track preparation**
- Save ~200-500ms per track (no device loading)
- Simpler code path

✅ **Simpler workflow**
- One less step in track creation
- Fewer dependencies on Max4Live

✅ **Still supports preset loading**
- Users can still load presets onto empty MIDI tracks
- Gesture browser can still be used (if it works without pre-loaded instruments)

### Potential Issues

⚠️ **Preset loading may require specific instrument types**
- Some presets might not load correctly onto empty MIDI tracks
- Gesture browser might require instruments to be present first

⚠️ **Loss of device chain configuration**
- Empty presets may have configured additional devices (effects, routing)
- Would lose this pre-configuration

⚠️ **TypeScript warnings**
- `EMPTY_PRESET_PATHS` is now unused
- `hasMatchingInstrument()` is now unused

---

## Testing Plan

### Test Cases

1. **Create MIDI tracks** (drum_rack, omnisphere, ni, ni_drum)
   - Verify empty MIDI tracks are created successfully
   - Check console for errors

2. **Load presets onto empty MIDI tracks**
   - Use gesture browser to load presets
   - Verify presets load correctly without pre-loaded instruments

3. **Compare preparation speed**
   - Time track preparation with/without empty instruments
   - Measure perceived performance improvement

4. **Check preset compatibility**
   - Test various preset types (Drum Rack, Omnisphere, Komplete Kontrol)
   - Verify all preset types work on empty MIDI tracks

### Success Criteria

**Keep disabled if:**
- ✅ Presets load correctly onto empty MIDI tracks
- ✅ Gesture browser works without pre-loaded instruments
- ✅ Noticeable speed improvement
- ✅ No compatibility issues

**Re-enable if:**
- ❌ Presets fail to load on empty tracks
- ❌ Gesture browser requires specific instruments
- ❌ User workflow is negatively impacted

---

## Future Decisions

### Option A: Keep Disabled Permanently
If testing is successful, remove empty preset loading entirely:
- Delete `EMPTY_PRESET_PATHS` constant
- Delete `hasMatchingInstrument()` function
- Update track type logic to reflect simpler workflow

### Option B: Re-enable
If issues are found, uncomment the section and document why empty instruments are necessary.

### Option C: Lazy Loading
Load empty instruments only when needed:
- Check if user is browsing presets
- Load empty instrument on-demand before browsing
- Skip for direct MIDI input or audio sampling

---

## Related Documents

- **Track Preparation:** `interface/src/lib/services/trackPreparation.ts`
- **On-Demand Creation:** [ADR-044: Revert Track Pool to On-Demand Creation](./044-revert-track-pool-to-on-demand-creation.md)
- **Gesture Browser:** [ADR-018: Gesture Browser Architecture](./018-gesture-browser-architecture.md)

---

**Status:** 🧪 Experimental (Temporarily Disabled for Testing)
**Code Changed:** `trackPreparation.ts:277-294` (commented out)
**TypeScript Warnings:** 2 unused declarations (acceptable for temporary change)
**Next Review:** After production testing with various preset types

---

**Last Updated:** 2025-01-13
