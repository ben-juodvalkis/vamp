#ADR-054: Simplify Sample-to-Simpler to Standard Device Loading

**Date:** 2025-01-12
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** Device Loading, Simplification, Architecture, Bug Fix

---

## Context

After removing the track pool system (ADR-044), the "Load Simpler" button stopped working. It would create a MIDI track but fail to load the Simpler device with the audio sample.

### The Problem

The original implementation (ADR-032) was designed around the track pool system:

```typescript
// TypeScript: Calculate track index from session store
const trackIndex = session.numTracks - 1;
send('/cmd/sample_clip_to_simpler', [trackIndex]);

// Max: Complex handler with track validation and file loading
function handleSampleClipToSimpler(targetTrack) {
    // Validate track index
    // Get file_path from detail_clip
    // Select target track
    // Load via addfile
    // Initialize device
}
```

**Why it broke:**
1. TypeScript created track via AbletonOSC: `/live/song/create_midi_track [-1]`
2. TypeScript read `session.numTracks - 1` to get new track index
3. **Problem:** `session.numTracks` is updated by Max observer, not AbletonOSC
4. The 150ms delay wasn't enough for: AbletonOSC → Ableton → Max observer → TypeScript store update
5. **Result:** Wrong track index sent to Max, Simpler loaded on wrong track (or nowhere)

### The Realization

During debugging, we realized: **Why does sample-to-Simpler need special handling at all?**

Every other instrument loading follows this simple pattern:
```typescript
send('/looping/devices/load', [presetPath]);
```

Max's `loadDevice()` function:
- Loads onto the currently selected track
- Handles device initialization automatically
- Works for `.adg`, `.aupreset`, and **audio files**
- No track index needed

Sample-to-Simpler should be no different!

---

## Decision

**Eliminate the special `/cmd/sample_clip_to_simpler` command and use standard device loading.**

### New Flow

**TypeScript** (`clipOperations.ts:sampleClipToSimpler`):
```typescript
// 1. Get file path via AbletonOSC
const filePath = await new Promise<string>((resolve, reject) => {
    const handler = (event: CustomEvent) => {
        if (address === '/live/clip/get/file_path' &&
            args[0] === trackIndex && args[1] === sceneIndex) {
            resolve(args[2]);
        }
    };
    window.addEventListener('osc-message', handler);
    send('/live/clip/get/file_path', [trackIndex, sceneIndex]);
});

// 2. Create MIDI track via AbletonOSC (auto-selected)
send('/live/song/create_midi_track', [-1]);
await new Promise(resolve => setTimeout(resolve, 150));

// 3. Load via standard device loading (same as all other instruments)
send('/looping/devices/load', [filePath]);
```

**Max** (no changes needed):
- Standard `loadDevice()` handles audio files
- Device initialization happens automatically
- Simpler loads onto currently selected track

---

## Implementation

### Changes Made

**1. TypeScript: `clipOperations.ts:sampleClipToSimpler`**

Before:
```typescript
// Create track
send('/live/song/create_midi_track', [-1]);
await delay(150);

// Calculate track index from store (BROKEN after pool removal)
const trackIndex = session.numTracks - 1;

// Send to special Max handler
send('/cmd/sample_clip_to_simpler', [trackIndex]);
```

After:
```typescript
// Get file path from audio clip
const filePath = await getClipFilePath(trackIndex, sceneIndex);

// Create track (auto-selected)
send('/live/song/create_midi_track', [-1]);
await delay(150);

// Load via standard path
send('/looping/devices/load', [filePath]);
```

**2. Max: `liveAPI-v6.js`**

Removed:
- `handleSampleClipToSimpler()` function (~90 lines)
- OSC routing for `/cmd/sample_clip_to_simpler` in `anything()` handler
- OSC routing for `/cmd/sample_clip_to_simpler` in `list()` handler
- Comment references to special Simpler handling

Total: **~100 lines removed from Max**

---

## Consequences

### Positive

✅ **Fixes the bug**: Sample-to-Simpler works again after track pool removal

✅ **Massive simplification**: Removed ~100 lines of special-case Max code

✅ **Consistent architecture**: Same loading path as all other devices

✅ **More reliable**: Uses AbletonOSC for queries instead of relying on store timing

✅ **No track index calculation**: Relies on Ableton's auto-selection of new track

✅ **Automatic device initialization**: Uses standard `loadDevice()` flow

✅ **Easier to maintain**: One device loading path instead of two

### Negative

⚠️ **Requires AbletonOSC support**: Needs `/live/clip/get/file_path` command

⚠️ **Relies on auto-selection**: Assumes new track is selected after creation

⚠️ **Slightly more network calls**: Get file path + create track + load device (vs. single Max call)

### Trade-offs

**Simplicity vs. Efficiency:**
- Old: 1 OSC call to Max (but complex Max code)
- New: 3 OSC calls (but standard device loading)
- **Winner:** Simplicity - the code reduction and consistency are worth the extra calls

**TypeScript vs. Max Logic:**
- Old: Max handles everything (file path, track selection, loading)
- New: TypeScript orchestrates, Max just loads
- **Winner:** TypeScript - better for debugging and maintenance

---

## Comparison

| Aspect | Old (ADR-032) | New (This ADR) |
|--------|---------------|----------------|
| **OSC Commands** | Custom `/cmd/sample_clip_to_simpler` | Standard `/looping/devices/load` |
| **Max Code** | ~100 lines (special handler) | 0 lines (uses existing) |
| **TS Code** | ~40 lines (complex logic) | ~50 lines (clear flow) |
| **Track Index** | Calculate from store ❌ | Auto-selected ✅ |
| **File Path** | Max gets from detail_clip | TS gets via AbletonOSC ✅ |
| **Device Init** | Special case in handler | Standard loadDevice() ✅ |
| **Consistency** | Unique flow ❌ | Same as other devices ✅ |

---

## Why This Matters

### Architectural Principle

**Use standard paths wherever possible.**

When we implemented sample-to-Simpler (ADR-032), we created a special Max handler because we thought we needed to:
- Find an empty track from the pool
- Get the file path from detail_clip
- Handle track selection
- Initialize the device

After removing the track pool (ADR-044), we realized:
- TypeScript creates the track (not pool lookup)
- AbletonOSC can get the file path
- New track is auto-selected
- Standard device loading handles everything else

**Lesson:** Don't create special cases prematurely. Try the standard path first.

### Code Reduction

This is the second major simplification after removing the track pool:
- **ADR-044:** Removed ~1000 lines of pool management code
- **This ADR:** Removed ~100 lines of special Simpler handling

**Total:** ~1100 lines removed by questioning "Do we really need this complexity?"

---

## Testing

### Manual Testing Steps

1. Record or import an audio clip on an audio track
2. Select the audio clip (it becomes `detail_clip`)
3. Click "Load Simpler" button in ClipCentralView
4. **Expected:**
   - New MIDI track created at end of track list
   - Simpler device loaded with audio sample
   - Device initialized (if initialization config exists)
5. Play MIDI notes to verify sample loaded correctly

### Test Cases

- ✅ Audio clip with file path → Simpler loads
- ✅ Multiple tracks in session → Works regardless of track count
- ✅ No track pool → Not needed anymore
- ❌ Clip without file path → Should show error (no file path)
- ❌ MIDI clip selected → Button disabled (audio only)

### Regression Testing

All other device loading should work identically:
- Loading Omnisphere via gesture browser
- Loading Drum Rack via preset browser
- Loading Komplete Kontrol instruments
- Loading effects onto master track

---

## Migration Notes

### Breaking Changes

None - this is an internal implementation change. The UI and user experience remain identical.

### Deprecations

- OSC Command: `/cmd/sample_clip_to_simpler` - **REMOVED**
- OSC Response: `/looping/clip/sampled` - **REMOVED**
- OSC Response: `/looping/clip/sample_error` - **REMOVED**

### Bridge Routing

The enhanced OSC bridge no longer needs to route `/cmd/sample_clip_to_simpler` to Max. However, since the handler is removed from Max, sending it will just be a no-op (no harm).

---

## Related ADRs

- **ADR-044**: Revert Track Pool to On-Demand Track Creation (triggered this bug)
- **ADR-032**: Sample Audio Clip to Simpler (original implementation - superseded)
- **ADR-043**: Device Initialization in Max (initialization flow)
- **ADR-023**: Device Loading Architecture (standard loading pattern)

---

## Future Considerations

### Potential Enhancements

1. **Error Handling**: Currently fires and forgets - could listen for device load confirmation
2. **Track Naming**: Could auto-rename track based on sample name
3. **Clip Selection**: Could auto-create a clip on the new track
4. **Multi-Sample**: Load multiple clips to different Simpler instances

### Questions for Later

- Should we query device state to confirm Simpler loaded?
- Should we auto-focus the new track in the UI?
- Should we select the Simpler in device view?

---

**Status:** ✅ Implemented and Tested
**Code Reduction:** ~100 lines of Max code removed
**Complexity Reduction:** Unified device loading path
**Bug Status:** Fixed - sample-to-Simpler works with on-demand track creation

---

**Last Updated:** 2025-01-12
