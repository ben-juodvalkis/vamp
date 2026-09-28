#ADR-028: loadPreset() Audio File Unification

**Date**: 2025-10-17  
**Status**: Accepted  
**Context**: [ADR-019 Audio Browser V2](019-audio-browser-v2-implementation.md)

## Context

During audio browser implementation, we discovered that `loadPreset()` function had a **safety block** preventing audio files from being loaded:

```typescript
// Original problematic code
if (AUDIO_FILE_EXTENSIONS.includes(extension)) {
    console.error('❌ BLOCKED: Audio file detected');
    console.error('Audio files should use sampleClipToSimpler(), not loadPreset()');
    return; // Block the load
}
```

This created architectural confusion because:

1. **MIDI presets** (.adg/.aupreset) used `loadPreset()`
2. **Audio files** (.wav/.aiff) were blocked from `loadPreset()`
3. **Simpler conversion** used `sampleClipToSimpler()` (different workflow entirely)

The block was based on incorrect assumption that audio files and presets require different handling.

## Analysis

### Investigation Findings

Both MIDI presets and audio files use **the same underlying OSC command**:
```typescript
send('/looping/devices/load', [filePath]);
```

**Max4Live's `/looping/devices/load` automatically handles**:
- `.adg/.aupreset files` → Loads as device/preset
- `.wav/.aiff files` → Loads as audio clip
- File type detection based on extension internally

### Three Distinct Workflows

1. **MIDI Preset Loading** (Browser → Track)
   ```
   User browses presets → clicks .adg file → loadPreset() → Device loaded
   ```

2. **Audio File Loading** (Browser → Track)  
   ```
   User browses audio → clicks .wav file → loadPreset() → Audio clip loaded
   ```

3. **Simpler Creation** (Existing Clip → New MIDI Track)
   ```
   User has audio clip → clicks LOAD SIMPLER → sampleClipToSimpler() → Creates Simpler on new MIDI track
   ```

**Key insight**: Workflows #1 and #2 are identical except for file type. Workflow #3 is completely different (clip conversion, not file loading).

## Decision

**Unify audio file and MIDI preset loading in `loadPreset()` function** by removing the audio file safety block.

### Rationale
- Both use identical OSC command (`/looping/devices/load`)
- Max4Live handles file type differentiation automatically
- Safety block created false architectural separation
- Simpler conversion is separate workflow entirely (`sampleClipToSimpler()`)

### Implementation
```typescript
// NEW: Unified loadPreset() function
export function loadPreset(filePath: string, fileName?: string): void {
    const extension = path.extname(filePath).toLowerCase();
    
    const isAudioFile = AUDIO_FILE_EXTENSIONS.includes(extension);
    const isPresetFile = VALID_PRESET_EXTENSIONS.includes(extension);
    
    // Validate but don't block
    if (!isAudioFile && !isPresetFile) {
        console.warn(`Unexpected file extension: ${extension}`);
        console.warn(`Expected audio: ${AUDIO_FILE_EXTENSIONS.join(', ')}`);
        console.warn(`Expected presets: ${VALID_PRESET_EXTENSIONS.join(', ')}`);
    }
    
    // Log detected type for debugging
    if (isAudioFile) {
        console.log(`✓ Audio file detected: ${extension}`);
    } else {
        console.log(`✓ Preset file detected: ${extension}`);
    }
    
    // Same loading command for both
    send('/looping/devices/load', [filePath]);
}
```

## Alternatives Considered

### Alternative 1: Separate Functions
```typescript
loadMidiPreset(presetPath: string)   // For .adg/.aupreset
loadAudioFile(audioPath: string)     // For .wav/.aiff  
convertClipToSimpler()               // For existing clips
```

**Rejected**: Creates unnecessary code duplication since both use identical OSC command. Would require updating all call sites.

### Alternative 2: File Type Parameter
```typescript
loadPreset(filePath: string, type: 'audio' | 'preset')
```

**Rejected**: File extension already indicates type. Adding redundant parameter increases API complexity.

### Alternative 3: Keep Safety Block, Use Direct send()
In TopGestureBrowser:
```typescript
if (isAudioFile) {
    send('/looping/devices/load', [finalPath]); 
} else {
    loadPreset(finalPath, preset.name);
}
```

**Rejected**: Duplicates loading logic. Better to centralize file loading in one function.

## Benefits

### Simplified Architecture
- **Single loading function** for both content types
- **Consistent API** - same function signature for browser
- **Centralized validation** - file extension checking in one place
- **Clear logging** - shows detected file type for debugging

### Reduced Complexity
- **Fewer functions** to maintain and test
- **Single import** for browser components
- **Unified error handling** for file loading
- **Consistent track naming** logic for both types

### Better Error Messages
- **Type detection logging** - clear feedback about what was detected
- **Comprehensive validation** - shows expected extensions for both types
- **Path information** - full file path in warnings

## Consequences

### Positive
- Audio browser integration simplified
- Consistent loading behavior across file types
- Better debugging information
- Reduced code duplication

### Negative
- Function name `loadPreset()` now misleading (loads presets AND audio)
- Safety block removal requires trust in Max4Live file type handling
- Loss of explicit audio/preset separation in function signatures

### Risks
- Future developers might be confused by function name
- Unexpected file types now proceed with warning rather than blocking
- Potential for incorrect file loading if Max4Live behavior changes

### Mitigations
- Updated function documentation clearly explains dual purpose
- Comprehensive logging shows detected file type
- Validation still warns about unexpected extensions
- Original constants preserved for future use if needed

## Migration

### Backward Compatibility
- ✅ **Existing calls work unchanged** - same function signature
- ✅ **MIDI preset loading unchanged** - same code path
- ✅ **Track naming unchanged** - same parameter handling
- ✅ **Error handling unchanged** - same OSC error propagation

### New Capability
- ✅ **Audio file loading enabled** - no longer blocked
- ✅ **Audio browser functional** - direct integration
- ✅ **Unified logging** - clear type detection

## Monitoring

### Success Metrics
- Zero audio file loading failures
- No regressions in MIDI preset loading  
- Clear log messages showing file type detection
- Consistent behavior across all file extensions

### Warning Indicators
- Unknown file extensions attempting to load
- OSC errors from Max4Live file loading
- Performance issues with large audio files

## Future Considerations

### Function Naming
Consider renaming `loadPreset()` to `loadFile()` or `loadContent()` in future refactor to better reflect dual purpose.

### Specialized Loading
Future audio-specific features could be added:
- Waveform analysis before loading
- BPM/key detection and logging  
- Audio file validation (corruption, format support)
- Track configuration based on audio properties

### Error Recovery
Enhanced error handling for file loading failures:
- Retry logic for network-stored samples
- User feedback for unsupported formats
- Graceful degradation for corrupted files

## References

- [trackPreparation.ts](../../interface/src/lib/services/trackPreparation.ts) - Implementation
- [ADR-019: Audio Browser V2](019-audio-browser-v2-implementation.md) - Audio browser context
- [V6 API Reference](../v6-api.md) - OSC command documentation
- [Max4Live liveAPI-v6.js](../../ableton/devices/liveAPI-v6/liveAPI-v6.js) - Device loading implementation

---

*This ADR documents the unification of file loading for both MIDI presets and audio files, eliminating artificial architectural barriers while maintaining clear type validation and logging.*