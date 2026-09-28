#ADR-026: Audio Track Pool Integration via Clipboard Automation

**Status:** Superseded by ADR-053
**Date:** 2025-01-10
**Context:** Phase 3 - Audio Track Pool System
**Related:** ADR-018 (Failed Approach), ADR-019 (Constants), ADR-020 (Clipboard Solution)

> **⚠️ SUPERSEDED BY ADR-053**
>
> This ADR describes the audio track pool integration which has been **removed** from the codebase.
> The pool was reverted to simple on-demand track creation for reduced complexity.
> See [ADR-053: Revert Track Pool to On-Demand Creation](./053-revert-track-pool-to-on-demand-creation.md) for current implementation.

---

## Context

### Background

The Track Pool System (Phase 2) provides instant MIDI track selection by maintaining a pool of 16 pre-made tracks. Audio tracks, however, were still being created on-demand via the legacy flow (~300ms, requires stopping playback).

**Goal:** Extend the pool system to support audio tracks with the same instant performance as MIDI tracks.

**Challenge:** Cannot pre-create audio tracks in the pool because:
- MIDI tracks in the pool must remain MIDI (for instrument loading)
- Need to convert MIDI → Audio on-demand when user requests audio track

### Previous Attempts (ADR-018)

Clipboard-based conversion was attempted and **rejected as unreliable** due to:
- AppleScript clipboard format issues
- 1-step lag (Ableton pasted previous clipboard value)
- Quote escaping through OSC layers
- Menu automation fragility

**Conclusion:** "The clipboard-based MIDI→Audio conversion approach is technically possible but practically unreliable."

### The Breakthrough (ADR-020)

User observation revealed that Ableton reads the clipboard **when gaining focus**, not when processing Cmd+V. Solution: Force focus change (Finder → Ableton) before pasting.

**Result:** 100% reliable clipboard automation using PyObjC + focus changes.

---

## Decision

**Implement audio track pool integration using:**
1. **PyObjC clipboard automation** (ADR-020 solution)
2. **Track type verification polling** (ensure conversion completes)
3. **Automatic audio routing configuration** (B-Guitar + Post FX)
4. **OSC-based orchestration** (TypeScript → Max → Python → Ableton)

---

## Architecture

### Complete System Flow

```
User clicks Audio button (GestureBrowser.svelte)
    ↓
TypeScript: prepareTrack('audio')
    ↓
Get empty MIDI track from pool (instant, <50ms)
    ↓
convertMidiToAudio(trackIndex)
    ├─ Highlight clip slot 0
    ├─ Send OSC: /shell/audio/convert [audioFilePath]
    ↓
Max Shell Helper (shell-helper-audio-conversion.maxpat)
    ├─ Receives on port 11007
    ├─ Executes: python3 audio_clipboard.py copy-and-paste "filepath"
    ├─ Sends response to port 11006
    ↓
Python Script (scripts/audio_clipboard.py)
    ├─ Copy audio file to clipboard (NSPasteboard)
    ├─ Verify clipboard
    ├─ Switch to Finder (force Ableton to lose focus)
    ├─ Switch back to Ableton (force clipboard read)
    ├─ Send Cmd+V (CGEventPost)
    ├─ Output: /shell/audio/convert/success
    ↓
Ableton: Pastes audio into MIDI track → auto-converts to audio
    ↓
TypeScript: Poll /live/track/get/has_audio_input until true
    ├─ 100ms interval, max 20 attempts (2 seconds)
    ├─ Waits for conversion to complete
    ↓
TypeScript: Delete pasted clip from slot 0
    ↓
TypeScript: configureAudioRouting(trackIndex)
    ├─ Set input type: B-Guitar
    ├─ Set input channel: Post FX
    ├─ Enable monitoring
    ├─ Arm track
    ↓
Done! Audio track ready to record (~1.5 seconds total)
```

---

## Implementation Components

### 1. Python Clipboard Script (`scripts/audio_clipboard.py`)

**Key Features:**
- **PyObjC NSPasteboard** - Native macOS clipboard with NSURL format
- **Quartz CGEvent** - Keyboard event simulation (Cmd+V)
- **Focus change automation** - Finder ↔ Ableton switching
- **OSC output format** - Clean messages for Max routing
- **Constants integration** - Loads from `config/constants.json`

**Usage:**
```bash
python3 audio_clipboard.py copy-and-paste "/path/to/audio.wav"
```

**Output:**
```
/shell/audio/convert/success
```
or
```
/shell/audio/convert/error "error message"
```

**Timing (from constants.json):**
```json
{
  "timing": {
    "clipboardWriteDelay": 30,
    "clipboardPropagationDelay": 200,
    "finderFocusDelay": 100,
    "abletonFocusDelay": 100,
    "postFocusWait": 50
  }
}
```

**Total Python execution time:** ~670ms (optimized from 3+ seconds)

---

### 2. TypeScript Services

#### **trackPoolService.ts**

**New function:** `convertMidiToAudio(trackIndex)`

**Flow:**
1. Highlight clip slot 0 on MIDI track
2. Send `/shell/audio/convert [audioFilePath]` to Max
3. Wait for `/shell/audio/convert/success` from Max
4. **Poll track type verification** (new addition)
5. Delete pasted clip
6. Resolve promise

**Key improvement:** Added `pollForAudioTrack()` to verify conversion completes before proceeding.

```typescript
async function pollForAudioTrack(trackIndex: number): Promise<void> {
    // Poll /live/track/get/has_audio_input every 100ms
    // Max 20 attempts (2 second timeout)
    // Ensures track is actually audio before deleting clip
}
```

#### **trackPreparation.ts**

**Updated:** `prepareTrack('audio')` now uses pool + conversion

**Flow:**
1. Get MIDI track from pool
2. Convert to audio (via `convertMidiToAudio()`)
3. Select converted track
4. **Configure audio routing** (B-Guitar + Post FX)
5. Send success notification

**Audio routing:**
```typescript
async function configureAudioRouting(trackIndex: number) {
    send('/live/track/set/input_routing_type', [trackIndex, 'B-Guitar']);
    // Wait 150ms for Live to process
    send('/live/track/set/input_routing_channel', [trackIndex, 'Post FX']);
    send('/live/track/set/current_monitoring_state', [trackIndex, 1]);
    send('/live/track/set/arm', [trackIndex, 1]);
}
```

---

### 3. Max/MSP Shell Helper

**File:** `ableton/shell-helper-audio-conversion.maxpat` (user-created)

**Routing:**
```
[udpreceive 11007]  ← Listen for conversion commands
|
[route /shell/audio/convert]
|
[prepend python3 /path/to/audio_clipboard.py copy-and-paste]
|
[shell]  ← Execute Python script
|
[udpsend 127.0.0.1 11006]  ← Forward output to interface
```

**Simple routing:** Shell output goes directly to udpsend (no parsing needed).

---

### 4. Configuration (`config/constants.json`)

**Centralized configuration** for cross-language consistency:

```json
{
  "ableton": {
    "appName": "Ableton Live 12 Beta",
    "conversionAudioFile": "/Users/Shared/Music/.../sample.wav"
  },
  "timing": {
    "clipboardWriteDelay": 30,
    "clipboardPropagationDelay": 200,
    "finderFocusDelay": 100,
    "abletonFocusDelay": 100,
    "postFocusWait": 50
  },
  "osc": {
    "shellHelper": {
      "receive": 11007,
      "send": 11006
    }
  }
}
```

**Used by:**
- Python: Loads timing and app name
- TypeScript: Loads audio file path and OSC ports
- Max/MSP: Can reference for port configuration

---

## Performance

### Timing Breakdown

| Operation | Time | Notes |
|-----------|------|-------|
| Get track from pool | <50ms | Instant (Phase 2) |
| Highlight clip slot | ~10ms | AbletonOSC command |
| Python clipboard automation | ~670ms | Focus changes + paste |
| Poll track conversion | 100-200ms | Usually 1-2 attempts |
| Delete clip | ~50ms | AbletonOSC command |
| Configure audio routing | ~200ms | 4 sequential commands |
| **Total** | **~1.1-1.3 seconds** | vs 300ms+ legacy creation |

**Performance vs Legacy:**
- **Speed:** Comparable (~1.2s vs 0.3s, but works while playing)
- **Reliability:** 100% (no track creation failures)
- **Key advantage:** Works while Live is playing (legacy required stop)

---

## Key Technical Solutions

### 1. Focus-Change Pattern (ADR-020)

**Problem:** Ableton caches clipboard when gaining focus, ignores programmatic updates.

**Solution:** Force focus change to trigger clipboard refresh.

```python
# Switch to Finder (Ableton loses focus)
subprocess.run(['osascript', '-e', 'tell application "Finder" to activate'])
time.sleep(0.1)

# Switch back (Ableton gains focus + reads clipboard)
subprocess.run(['osascript', '-e', f'tell application "{ABLETON_APP_NAME}" to activate'])
time.sleep(0.1)

# Now Cmd+V uses fresh clipboard!
send_cmd_v()
```

---

### 2. Track Conversion Verification

**Problem:** Ableton's MIDI→Audio conversion takes variable time (50ms-500ms).

**Solution:** Poll track type until conversion completes.

```typescript
// Before (assumed instant):
await convertMidiToAudio(trackIndex);
await configureAudioRouting(trackIndex);  // Might fail if still MIDI!

// After (verified):
await convertMidiToAudio(trackIndex);
    ↓ includes pollForAudioTrack()
    ↓ waits until has_audio_input === true
await configureAudioRouting(trackIndex);  // ✅ Guaranteed to be audio
```

**Why necessary:** Audio routing commands only work on audio tracks. Attempting to set input routing on a MIDI track fails silently.

---

### 3. Timeout Management

**Problem:** Promise timeout firing even after successful conversion.

**Solution:** Clear timeout when success/error received.

```typescript
let timeoutId: number;

// Set timeout
timeoutId = window.setTimeout(() => {
    reject(new Error('Timeout'));
}, 5000);

// Clear on success
if (address === '/shell/audio/convert/success') {
    clearTimeout(timeoutId);  // ← Critical!
    // Continue processing...
}
```

**Before fix:** Timeout always fired, rejected promise, prevented audio routing.
**After fix:** Timeout cleared, promise resolves, audio routing succeeds.

---

### 4. OSC Message Simplification

**Problem:** trackIndex verification added complexity (Max unpacking/repacking).

**Solution:** Remove trackIndex from OSC flow - not needed for single-threaded conversion.

```typescript
// Before (complex):
send('/shell/audio/convert', [trackIndex, audioFilePath]);
// Max must unpack, track trackIndex, repack response

// After (simple):
send('/shell/audio/convert', [audioFilePath]);
// Max just forwards shell output directly to udpsend
```

**Why safe:** Only one conversion happens at a time. Clip slot is pre-highlighted. No ambiguity about which track is being converted.

---

## Dependencies

### System Requirements

**macOS:**
- PyObjC (NSPasteboard, Quartz, ApplicationServices)
- Python 3.9+ (system Python `/usr/bin/python3`)
- Accessibility permissions for keyboard automation

**Installation:**
```bash
/usr/bin/python3 -m pip install --user pyobjc-framework-Cocoa
/usr/bin/python3 -m pip install --user pyobjc-framework-Quartz
```

**Ableton:**
- Ableton Live 11+ (tested on Live 12 Beta)
- AbletonOSC installed and configured

**Project:**
- Max/MSP shell helper patch
- Track Pool System (Phase 2) initialized
- OSC Bridge routing configured

---

## Benefits

### 1. Works While Playing ✅
Unlike legacy audio track creation, this works without stopping Live playback.

### 2. Pool Integration ✅
Audio tracks now use the same instant selection algorithm as MIDI tracks.

### 3. Automatic Configuration ✅
Audio routing (B-Guitar + Post FX) configured automatically - no manual setup.

### 4. Reliable ✅
100% success rate in testing - no more clipboard lag issues.

### 5. Configurable ✅
All timing values in `constants.json` - can tune for different hardware.

### 6. Clean Architecture ✅
- Python handles clipboard
- TypeScript orchestrates flow
- Max provides OSC bridge
- Clear separation of concerns

---

## Consequences

### Positive

✅ **Audio tracks use pool** - Same instant performance as MIDI (selection)
✅ **Fully automated** - No manual steps required
✅ **Works while playing** - No playback interruption
✅ **Verified conversion** - Polling ensures track is ready before routing
✅ **Centralized config** - Single source of truth in constants.json
✅ **Comprehensive logging** - Easy to debug issues

### Negative

⚠️ **Focus changes visible** - Brief flash to Finder and back (~200ms visible)
⚠️ **macOS only** - Uses macOS-specific APIs (PyObjC, AppleScript)
⚠️ **Accessibility permissions** - Required for keyboard automation
⚠️ **Slower than MIDI** - ~1.2s vs <50ms for MIDI pool (due to conversion)
⚠️ **Requires shell helper** - Additional Max patch to maintain

---

## Alternatives Considered

### 1. Pre-Create Audio Track Pool
**Approach:** Session reset creates 12 MIDI + 4 audio tracks

**Pros:**
- ✅ Instant (<50ms like MIDI)
- ✅ No clipboard complexity

**Cons:**
- ⚠️ More tracks in session (20 instead of 16)
- ⚠️ Audio tracks can't be converted to MIDI (fixed pool)

**Why not chosen:** User wanted ability to convert MIDI→Audio on-demand.

---

### 2. AbletonOSC Bounce API
**Approach:** Check if AbletonOSC has native bounce/conversion

**Result:** No such API exists in AbletonOSC V6.

**Why not chosen:** API doesn't exist.

---

### 3. Semi-Automated (Manual Cmd+V)
**Approach:** Python copies to clipboard, user presses Cmd+V manually

**Pros:**
- ✅ Simpler (no focus changes)
- ✅ No accessibility permissions

**Cons:**
- ⚠️ Not fully automated
- ⚠️ Requires user action

**Why not chosen:** User wanted full automation.

---

## Implementation Details

### Python Script Actions

**Three modes:**

1. **`copy`** - Copy to clipboard only (for manual paste)
   ```bash
   python3 audio_clipboard.py copy "/path/to/file.wav"
   → SUCCESS: Copied to clipboard: /path/to/file.wav
   ```

2. **`paste`** - Read from clipboard
   ```bash
   python3 audio_clipboard.py paste
   → /path/to/file.wav
   ```

3. **`copy-and-paste`** - Full automation (used by track pool)
   ```bash
   python3 audio_clipboard.py copy-and-paste "/path/to/file.wav"
   → /shell/audio/convert/success
   ```

### OSC Message Flow

**Interface → Max:**
```
/shell/audio/convert "/Users/Shared/Music/.../sample.wav"
Port: 11007
```

**Max → Interface:**
```
/shell/audio/convert/success
or
/shell/audio/convert/error "error message"
Port: 11006
```

**No trackIndex:** Simplified routing - clip slot is pre-highlighted, only one conversion at a time.

---

## Error Handling

### Python Script Errors

**File not found:**
```
/shell/audio/convert/error "Failed to copy file to clipboard"
```

**Accessibility permissions:**
```
ERROR: Accessibility permissions required for keyboard automation
(Prints instructions to stderr)
```

**Clipboard verification failed:**
```
/shell/audio/convert/error "Clipboard verification failed"
```

### TypeScript Errors

**Conversion timeout (5 seconds):**
```typescript
reject(new Error('Audio conversion timeout (no response after 5 seconds)'))
```

**Track verification timeout (2 seconds):**
```typescript
reject(new Error('Track conversion timeout - still MIDI after 2000ms'))
```

**Shell helper unreachable:**
- Falls back to legacy audio track creation
- User sees warning in console

---

## Testing

### Manual Test Procedure

1. **Initialize pool:**
   - Session reset (16 empty MIDI tracks)
   - Interface connected to AbletonOSC

2. **Test audio track creation:**
   - Click Audio button
   - Observe console logs
   - Verify track is audio with B-Guitar input
   - Verify track is armed and monitoring

3. **Test multiple conversions:**
   - Create 5+ audio tracks in sequence
   - Verify pool statistics update correctly
   - Verify no lag or wrong files pasted

4. **Test error handling:**
   - Test with invalid audio file path
   - Test without accessibility permissions
   - Test with Max shell helper offline

### Expected Console Output

**Success:**
```
[Browser] Audio button clicked - preparing audio track
[TrackPrep] Preparing audio track (Phase 2: Pool Integration)
[TrackPool] ✓ Found empty track: 0 (fast path)
[TrackPool] Converting MIDI track 0 to audio...
[TrackPool] Highlighted clip slot 0 on track 0
[TrackPool] Sending conversion command to shell helper...
[TrackPool] ✓ Audio pasted, waiting for track conversion...
[TrackPool] Polling track 0 for audio conversion (attempt 1/20)...
[TrackPool] ✓ Track 0 is now audio track (verified after 1 attempts)
[TrackPool] ✓ Track 0 confirmed as audio track
[TrackPool] Deleted conversion clip from track 0, slot 0
[TrackPrep] Configuring audio routing for track 0...
[Track Prep] Setting input type to B-Guitar for track 0
[Track Prep] Setting input channel to 'Post FX' for track 0
[Track Prep] Enabling monitoring for track 0
[Track Prep] Arming track 0
[TrackPrep] ✓ Audio routing configured
[TrackPrep] ✅ Successfully prepared audio track via pool + conversion
```

---

## Future Enhancements

### 1. Faster Clipboard Automation

Explore if focus changes can be eliminated:
- Research Ableton's pasteboard read triggers
- Try alternative clipboard APIs
- Investigate if Ableton can be notified of clipboard changes

**Potential:** Reduce from ~670ms to <100ms if focus changes unnecessary.

---

### 2. Batch Audio Track Creation

Pre-convert multiple MIDI tracks to audio in parallel:
```typescript
async function prepareAudioTrackBatch(count: number) {
    const tracks = await Promise.all(
        Array(count).fill(null).map(() => findAvailableTrack())
    );
    await Promise.all(tracks.map(t => convertMidiToAudio(t)));
}
```

**Use case:** Session setup - convert 4 MIDI tracks to audio upfront.

---

### 3. Track Type Change Detection

Use AbletonOSC listeners instead of polling:
```typescript
send('/live/track/start_listen/has_audio_input', [trackIndex]);
// Wait for callback instead of polling
```

**Potential:** Reduce latency by ~50-100ms (eliminate polling interval).

---

### 4. Configurable Audio Routing

Move B-Guitar configuration to constants.json:
```json
{
  "ableton": {
    "audioInput": {
      "type": "B-Guitar",
      "channel": "Post FX"
    }
  }
}
```

**Benefit:** Easy to change input source without code changes.

---

## Migration Notes

### From Legacy Audio Creation

**Before (legacy):**
```typescript
// Created new audio track on-demand
await createTrack('audio');  // ~300ms, requires stop
await configureAudioRouting(trackIndex);
```

**After (pool):**
```typescript
// Gets MIDI from pool, converts to audio
const poolTrack = await findAvailableTrack();  // <50ms
await convertMidiToAudio(poolTrack);  // ~1.2s, works while playing
await configureAudioRouting(trackIndex);
```

**Trade-off:** Slightly slower, but works while playing and uses pool.

---

### Updating Constants

**When Ableton Live 12 releases:**
```json
{
  "ableton": {
    "appName": "Ableton Live 12"  ← Remove "Beta"
  }
}
```

**Python automatically picks up change** on next run (no code changes needed).

---

## Success Metrics

**Before Integration:**
- ❌ Audio tracks created on-demand (legacy)
- ❌ ~300ms creation time
- ❌ Requires stopping playback
- ❌ Not integrated with pool

**After Integration:**
- ✅ Audio tracks use pool system
- ✅ ~1.2s total time (conversion + routing)
- ✅ Works while playing
- ✅ 100% reliable (no clipboard lag)
- ✅ Automatic routing configuration
- ✅ Verified conversion (polling)

---

## Lessons Learned

### 1. User Testing Reveals Hidden Issues

**Initial implementation:** Assumed instant conversion, configured routing immediately.

**User testing:** Routing commands failed silently.

**Root cause:** Track still MIDI when routing attempted.

**Solution:** Add polling to verify conversion completes.

**Lesson:** Always verify asynchronous operations complete before proceeding.

---

### 2. Timeouts Must Be Cleared

**Bug:** Success occurred, but timeout still fired, rejected promise.

**Impact:** Prevented subsequent steps (audio routing) from running.

**Fix:** Store timeout ID, clear on success/error.

**Lesson:** Every setTimeout needs a corresponding clearTimeout on all exit paths.

---

### 3. Test in Isolation

**Problem:** Audio routing not working in full flow.

**Solution:** Created TEST button to isolate routing logic.

**Result:** Confirmed routing commands work, identified timing issue in flow.

**Lesson:** When debugging complex flows, test each component in isolation.

---

### 4. Simplify OSC Messages

**Initial:** Included trackIndex in all messages for verification.

**Reality:** Only one conversion at a time, trackIndex unnecessary.

**Change:** Removed trackIndex from OSC flow.

**Benefit:** Simpler Max routing (no unpacking/repacking).

**Lesson:** Don't add complexity for edge cases that don't exist.

---

## Troubleshooting

### Audio Routing Not Applied

**Symptoms:**
- Track converted to audio successfully
- Input still on default (Ext. In)
- Not armed or monitoring

**Cause:** Track conversion not verified before routing.

**Solution:** Polling added - waits for `has_audio_input === true`.

---

### Clipboard Automation Fails

**Symptoms:**
- Python script succeeds but wrong file pasted
- Or no file pasted

**Cause:** Focus change timing too aggressive.

**Solution:** Increase delays in `config/constants.json`:
```json
{
  "timing": {
    "finderFocusDelay": 200,  ← Was 100
    "abletonFocusDelay": 200   ← Was 100
  }
}
```

---

### Accessibility Permission Denied

**Symptoms:**
```
ERROR: Accessibility permissions required for keyboard automation
```

**Solution:**
1. System Preferences → Security & Privacy → Privacy
2. Select "Accessibility"
3. Add "Terminal" (or Python)
4. Re-run script

---

## References

- **ADR-018:** Failed AppleScript clipboard approach
- **ADR-019:** Project constants file
- **ADR-020:** Clipboard automation via focus changes
- **ADR-024:** Track Pool System (Phase 2) - superseded by ADR-031
- **ADR-031:** Track Pool M4L Single Source of Truth (current pool architecture)
- **Code:** `scripts/audio_clipboard.py`
- **Code:** `config/constants.json`
- **Code:** `interface/src/lib/services/trackPoolService.ts`
- **Code:** `interface/src/lib/services/trackPreparation.ts`
- **Code:** `ableton/shell-helper-audio-conversion.maxpat`

**Note:** This ADR describes audio track conversion via clipboard automation, which remains valid under ADR-031's pool architecture. The track selection (`findAvailableTrack()`) now comes from M4L pool manager instead of TypeScript logic.

---

**Status:** Accepted and Implemented
**Performance:** ~1.2 seconds per audio track conversion
**Reliability:** 100% in testing
**Next Review:** After 50+ uses in production

---

**Last Updated:** 2025-01-10
