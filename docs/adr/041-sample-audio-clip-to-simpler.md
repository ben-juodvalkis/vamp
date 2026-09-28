# ADR 032: Sample Audio Clip to Simpler

**Status**: Implemented
**Date**: 2025-10-10
**Context**: V6 Live API Integration, Simpler Device Control

## Context

Live looping workflows often involve sampling audio clips for melodic manipulation. Users need a quick way to take an existing audio clip and load it into a Simpler device on a MIDI track, enabling them to play the audio sample chromatically via MIDI.

### Use Cases

1. **Melodic Sampling**: Convert a recorded audio loop into a playable instrument
2. **Harmonic Layering**: Play an audio clip at different pitches simultaneously
3. **Performance Workflow**: Quick conversion from audio to MIDI-controlled playback
4. **Creative Resampling**: Transform rhythmic material into melodic content

### Requirements

- Load currently selected audio clip's file into Simpler
- Automatically find or use an empty MIDI track
- Preserve original audio file (non-destructive)
- Provide visual feedback in ClipCentralView
- Handle errors gracefully (no clip selected, no empty tracks, etc.)

## Decision

We implemented a one-click workflow that extracts the audio clip's `file_path` property and loads it via Ableton's `addfile` command, which automatically creates a Simpler device with the sample loaded.

### Key Design Decisions

1. **Use `detail_clip`**: Work with the currently focused clip in Ableton's detail view
2. **Use `file_path` property**: Get the actual audio file path from the clip
3. **Use `addfile` command**: Leverage Ableton's built-in device creation (no manual Simpler instantiation needed)
4. **Find empty MIDI track**: Search tracks 0-15 for first track with MIDI input and no devices
5. **UI placement**: Add button to ClipCentralView (audio clips only)

## Implementation

### OSC API

**Command** (Interface → Max):
```
/cmd/sample_clip_to_simpler [trackIndex]
```
- `trackIndex`: Target track from pool (provided by TypeScript)

**Success Response** (Max → Interface):
```
/looping/clip/sampled [targetTrackIndex]
```
- Returns the track index where Simpler was loaded

**Error Response** (Max → Interface):
```
/looping/clip/sample_error [errorMessage]
```
- Error messages: "No clip selected", "Clip has no audio file", "Invalid track index", "Pool exhausted"

### Max/MSP Implementation

**Handler Function** (`liveAPI-v6.js:handleSampleClipToSimpler`):

```javascript
function handleSampleClipToSimpler(targetTrack) {
    // 1. Validate track index (provided by TypeScript pool)
    if (targetTrack === undefined || targetTrack < 0 || targetTrack >= 16) {
        outlet(0, ["/looping/clip/sample_error", "Invalid track index"]);
        return;
    }

    // 2. Get current detail clip
    var detailClipApi = new LiveAPI("live_set view detail_clip");

    if (detailClipApi.id === "0") {
        outlet(0, ["/looping/clip/sample_error", "No clip selected"]);
        return;
    }

    // 3. Get clip's file_path property
    var filePath = detailClipApi.get("file_path");
    if (!filePath || filePath.length === 0 || filePath[0] === "") {
        outlet(0, ["/looping/clip/sample_error", "Clip has no audio file"]);
        return;
    }

    var filePathStr = filePath[0];
    log("Using pool track at index: " + targetTrack);

    // 4. Select target track (provided by TypeScript pool)
    var trackApi = new LiveAPI("live_set tracks " + targetTrack);
    var viewApi = new LiveAPI("live_set view");
    viewApi.set("selected_track", "id", trackApi.id);

    // 5. Load audio file - Ableton auto-creates Simpler with sample
    outlet(1, "/looping/devices/addfile", filePathStr);

    outlet(0, ["/looping/clip/sampled", targetTrack]);
}
```

**Note:** Track finding is now handled by TypeScript pool manager (`findAvailableTrack()`), unifying track allocation across all operations (browser, audio prep, Simpler).

**Routing** (`enhanced-osc-bridge.js:getRoutingTarget`):

```javascript
// Sample audio clip to Simpler (requires Max4Live - no AbletonOSC equivalent)
if (address === '/cmd/sample_clip_to_simpler') return 'maxObserver';
```

### TypeScript Service

**Service Method** (`clipOperations.ts:sampleClipToSimpler`):

```typescript
export async function sampleClipToSimpler(): Promise<void> {
    const ctx = getClipContext();

    if (!ctx.hasDetailClip) {
        return Promise.reject(new Error('No clip selected'));
    }

    if (ctx.trackType !== 'audio') {
        return Promise.reject(new Error('Not an audio clip'));
    }

    // Get empty track from pool (unified with browser/audio prep)
    console.log('[ClipOps] Requesting empty track from pool for Simpler...');
    const trackIndex = await findAvailableTrack();

    if (trackIndex === null) {
        console.error('[ClipOps] Pool exhausted - no tracks available for Simpler');
        return Promise.reject(new Error('Pool exhausted - no empty tracks'));
    }

    console.log(`[ClipOps] ✓ Pool provided track ${trackIndex} for Simpler`);

    // Send command to Max4Live with track index
    send('/cmd/sample_clip_to_simpler', [trackIndex]);

    // Wait for response or timeout (3 seconds)
    return new Promise((resolve, reject) => {
        const handler = (event: CustomEvent) => {
            const { address, args } = event.detail;

            if (address === '/looping/clip/sampled') {
                window.removeEventListener('osc-message', handler as EventListener);
                resolve();
            }

            if (address === '/looping/clip/sample_error') {
                window.removeEventListener('osc-message', handler as EventListener);
                reject(new Error(args[0]));
            }
        };

        window.addEventListener('osc-message', handler as EventListener);

        setTimeout(() => {
            window.removeEventListener('osc-message', handler as EventListener);
            reject(new Error('Timeout waiting for sample operation'));
        }, 3000);
    });
}
```

**Key Change:** Now uses unified pool manager (`findAvailableTrack()`) instead of custom `findEmptyMidiTrack()` logic in Max. This simplifies track allocation and removes duplicate code.

### UI Component

**Button** (`ClipCentralView.svelte`, audio clips only):

```svelte
{#if trackType === 'audio'}
  <div class="bg-emerald-900/20 rounded-lg p-4 border border-emerald-700/30">
    <div class="text-xs text-emerald-400 font-medium mb-2">SAMPLE TO SIMPLER</div>
    <button
      onclick={handleSampleToSimpler}
      disabled={!hasClip || isSampling}
      class="w-full h-14 rounded-lg font-bold text-sm transition-all
        bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95"
    >
      {isSampling ? 'Loading...' : 'Load in Simpler'}
    </button>
    <div class="text-xs text-emerald-400/60 mt-2">
      Loads clip audio file into next empty MIDI track
    </div>
  </div>
{/if}
```

## Workflow

1. User selects an audio clip in Ableton (it becomes `detail_clip`)
2. User clicks "Load in Simpler" button in ClipCentralView
3. TypeScript requests empty track from pool via `findAvailableTrack()`
4. M4L pool manager provides track index (unified track allocation)
5. TypeScript sends `/cmd/sample_clip_to_simpler [trackIndex]` to bridge
6. Bridge routes message to Max (port 11002)
7. Max validates track index
8. Max gets clip's `file_path` property from detail_clip
9. Max selects target track
10. Max sends `addfile` command with audio path
11. Ableton automatically creates Simpler with sample loaded
12. Max sends success response with target track index
13. UI shows success and clears loading state

**Key Improvement:** Now uses unified pool manager (same as browser/audio prep), eliminating duplicate track-finding logic.

## Consequences

### Positive

1. **One-Click Workflow**: Extremely fast sampling workflow for live performance
2. **Non-Destructive**: Original audio clip remains unchanged
3. **Automatic Track Management**: No manual track creation or device loading
4. **Visual Feedback**: Button shows loading state and errors
5. **Pool-Aware**: Searches pool tracks (0-15) for empty slots
6. **Type-Safe**: Promise-based API with TypeScript error handling

### Negative

1. **Track Pool Limitation**: Only searches tracks 0-15 (by design)
2. **No Track Creation**: Returns error if pool is exhausted
3. **File Path Dependency**: Requires clip to have a file path (recorded/imported clips only)
4. **No Manual Track Selection**: Relies on pool manager to select track

### Trade-offs

- **Automatic vs Manual Track Selection**: We chose automatic for speed, sacrificing user control
- **Empty Track Requirement**: Ensures clean state but limits flexibility when all tracks are in use
- **addfile Simplicity**: Leverages Ableton's device creation but limits customization

## Implementation Notes

### Common Mistakes

1. ❌ Using `live_set view.selected_track` instead of `live_set view` → `selected_track`
   - Correct: Create `live_set view` API, then set `selected_track` property
2. ❌ Forgetting to add bridge routing rule
   - Must add `/cmd/sample_clip_to_simpler` to `getRoutingTarget()` in bridge
3. ❌ Not checking for empty `file_path`
   - Clips can exist without files (MIDI clips, generated clips)
4. ❌ Using wrong outlet for `addfile`
   - Use `outlet(1)` for internal Max routing, `outlet(0)` for responses to browser

### Debugging

**Browser Console**:
```
[ClipOps] 🎤 SENDING TO MAX: /cmd/sample_clip_to_simpler []
[ClipOps] ✅ Message sent via WebSocket
```

**Bridge Console**:
```
🎯 Routing query to Max observer: /cmd/sample_clip_to_simpler
```

**Max Console**:
```
🎯 ROUTING (anything): /cmd/sample_clip_to_simpler -> handleSampleClipToSimpler()
=============================================
🎤 RECEIVED: /cmd/sample_clip_to_simpler
=============================================
Audio clip path: /Users/.../sample.wav
Found empty MIDI track at index: 3
Selected track 3, loading audio file...
Loaded audio clip into Simpler on track 3
```

### Testing

To test the feature:
1. Record or import an audio clip on an audio track
2. Select the clip (click on it in Session or Arranger view)
3. Open ClipCentralView (should show "Load in Simpler" button)
4. Ensure at least one MIDI track in pool (0-15) has no devices
5. Click "Load in Simpler"
6. Verify Simpler appears on empty MIDI track with sample loaded
7. Play MIDI notes to test sample playback

**Error Cases to Test**:
- No clip selected → Should show error message
- MIDI clip selected → Button should be disabled (audio only)
- All MIDI tracks occupied → Should show "No empty MIDI tracks" error
- Clip without file path → Should show "Clip has no audio file" error

## References

- **Implementation Files**:
  - Max: `ableton/scripts/liveAPI-v6.js` (lines 3422-3487, 1590-1593, 1737-1739)
  - Bridge: `interface/bridge/enhanced-osc-bridge.js` (line 739)
  - Service: `interface/src/lib/services/clipOperations.ts` (lines 477-524)
  - UI: `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` (lines 127-143, 191-209)
- **Live API Documentation**: https://docs.cycling74.com/apiref/lom/clip/#file_path
- **Related Features**: Simpler LiveAPI integration (ADR 033)

## Related ADRs

- **ADR 031**: Track Pool M4L Single Source of Truth (unified track allocation)
- ADR 033: Simpler LiveAPI Property and Function Access (Simpler device control)
- ADR 003: TrackStrip Max Observer Migration (established Max observer pattern)
- ADR 023: Device Loading Architecture (device creation patterns)

**Note:** This ADR was updated post-implementation to use unified pool manager from ADR-031, removing duplicate `findEmptyMidiTrack()` logic.

## Future Enhancements

Possible improvements for future iterations:

1. **Manual Track Selection**: Allow user to pick target track via UI
2. **Track Creation**: Auto-create new MIDI track if pool is full
3. **Multi-Sample Loading**: Load multiple clips to different notes
4. **Sample Processing**: Pre-process audio (normalize, trim, etc.) before loading
5. **Preset Application**: Apply specific Simpler preset after loading
6. **Undo Support**: Track operations for undo functionality
