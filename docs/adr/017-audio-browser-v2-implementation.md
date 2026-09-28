#ADR-017: Audio Browser V2 Implementation

**Date**: 2025-10-17  
**Status**: Accepted  
**Supersedes**: [ADR-018 Gesture Browser Architecture](018-gesture-browser-architecture.md)

## Context

The live looping system had comprehensive MIDI instrument browsing via TopGestureBrowser but no audio sample browsing capability. Users needed to load audio clips for live performance from their sample library without leaving the touch interface.

### Requirements
- Browse 27,000+ audio files from curated sample library
- Unified browser experience (reuse TopGestureBrowser, not separate component)
- Replace functionality for existing audio clips (feature parity with MIDI)
- Performance constraints (iPad Safari memory limits)
- Fix existing audio track preparation bug

### Constraints
- Must work with existing symlink-based sample organization
- JSON loading architecture (static files, not API endpoints)
- Touch-optimized for iPad Safari interface
- Live performance context (sub-second response times)

## Decision

**Extend TopGestureBrowser with 4th "Audio" vendor** using filtered adapter pattern:

### Architecture
```
TopGestureBrowser (existing)
├── Ableton vendor → UnifiedAdapter 
├── Omnisphere vendor → OmnisphereAdapter
├── Native Instruments vendor → SubfolderAdapter  
└── Audio vendor → AudioClipsAdapter (NEW)
```

### Data Flow
```
User taps Audio vendor
    ↓
AudioClipsAdapter filters UnifiedAdapter results to audio files only
    ↓ 
audio-clips.json (27k files, 14MB)
    ↓
Same navigation/grid UI as instruments
    ↓
loadPreset() updated to handle both presets and audio files
    ↓
send('/looping/devices/load', [audioPath])
```

### Key Components

#### AudioClipsAdapter
- **Wraps UnifiedAdapter** with audio-only filter
- **Reuses navigation logic** (getFolders, getPresets, getRandomPreset)
- **Filter by extension** (.wav, .aif, .aiff, .mp3, .flac, .m4a, .ogg)
- **Points to curated subset** at `paths.audioBrowserBase`

#### Generator Enhancement  
- **Symlink support** fixed in Node.js scanner (handle file symlinks separately from directory symlinks)
- **Extension filtering** for audio-only JSON generation
- **CLI modes** (--audio, --instruments, --all)

#### Curated Sample Library
- **Separate path**: `/ableton/Presets/Audio Samples/` (vs full 109k library)
- **Unix symlinks** to selected folders from main library  
- **Target size**: 5-15k files for reasonable JSON size (2-15MB)

## Implementation

### Files Changed (8)
1. `config/constants.json` - Added `paths.audioBrowserBase`
2. `interface/src/lib/services/adapters/audioClipsAdapter.ts` - NEW (70 lines)
3. `interface/src/lib/services/adapters/index.ts` - Register AudioClipsAdapter
4. `scripts/generate-instruments-json.ts` - Add audio scanning + symlink support (80 lines)  
5. `interface/src/lib/components/v6/browser/TopGestureBrowser.svelte` - Add audio vendor (10 lines)
6. `interface/src/lib/stores/v6/browserModeStore.svelte.ts` - Add audio clip replacement state (50 lines)
7. `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` - Add Replace Audio + restore Load Simpler (30 lines)
8. `interface/src/lib/services/trackPreparation.ts` - Remove audio file block from loadPreset() (15 lines)

### Files Generated (1)
- `interface/static/data/audio-clips.json` - 27k files, 14MB

### Total: ~255 lines of code changes

## Alternatives Considered

### Alternative 1: Separate Audio Browser Component
**Rejected**: Would duplicate navigation logic, create inconsistent UX, more complex state management.

### Alternative 2: Full Sample Library JSON (109k files)
**Rejected**: 70MB JSON causes iPad Safari memory issues and slow initial load.

### Alternative 3: API-based Lazy Loading  
**Rejected**: Requires SvelteKit server, increases complexity, network round-trips affect live performance.

### Alternative 4: IndexedDB + Web Worker
**Rejected**: Over-engineering for current needs, IndexedDB reliability issues on Safari.

## Benefits

### User Experience
- **Unified navigation** - Same gestures/patterns as instrument browser
- **Feature parity** - Audio gets replace functionality like MIDI instruments  
- **Performance optimized** - 14MB JSON loads quickly, navigates smoothly
- **Live performance ready** - Sub-second response times maintained

### Technical  
- **Minimal code changes** - Reuses existing browser infrastructure
- **Symlink flexibility** - Easy to curate sample library for live sets
- **Future extensible** - Framework ready for audio preview, metadata, waveforms
- **Memory efficient** - Reasonable JSON size for iPad Safari

### Architecture
- **Single source of truth** - One browser for all content types
- **Adapter pattern** - Clean separation between data source and UI
- **Consistent state management** - Uses existing browserModeStore patterns

## Consequences

### Positive
- Audio samples now browsable in unified interface
- Fixed audio track preparation bug (reuses empty tracks)
- Replace functionality maintains clip positioning
- Gesture patterns consistent across vendors
- Curated library improves live performance focus

### Negative  
- Additional JSON file increases bundle size (+14MB)
- Symlink setup required for curation
- Audio metadata not extracted (BPM, key, duration)

### Risks
- Large sample libraries still require manual curation
- JSON regeneration needed when adding samples
- Memory usage scales with JSON size

## Monitoring

### Success Metrics
- Audio browser response time < 1 second
- JSON initial load < 2 seconds on iPad
- No memory pressure warnings during extended use
- Zero failed audio file loads

### Performance Thresholds  
- JSON size: < 20MB (warning if exceeded)
- File count: < 50k (warning if exceeded)
- Initial load: < 3 seconds (degraded UX beyond this)

## References

- [ADR-018: Gesture Browser Architecture](018-gesture-browser-architecture.md) - Original browser design
- [V6 API Reference](../v6-api.md) - OSC loading commands
- [Implementation Plan](../current-project/audioBrowserV2/IMPLEMENTATION_PLAN.md) - Detailed implementation steps
- [Config Constants](../../config/constants.json) - Path configuration

---

*This ADR documents the addition of audio browsing capability to the existing gesture browser system, maintaining architectural consistency while enabling new workflows for live audio performance.*