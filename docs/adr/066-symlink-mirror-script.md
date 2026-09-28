#ADR-066: Symlink Mirror Script for Audio Sample Curation

**Date**: 2025-10-17  
**Status**: Accepted  
**Decision**: Implement symlink-based directory mirroring for audio sample curation

## Context

The audio browser implementation (AudioBrowserV2) requires a curated subset of the full sample library for optimal performance. The full sample library contains 109,000+ files, which would result in:

- **70MB+ JSON files** for browser tree data
- **Slow browser performance** due to memory usage
- **Poor iPad experience** with limited memory

The solution needed to:
1. Preserve the complete folder structure for navigation
2. Include only audio files (filter out `.DS_Store`, `.asd` metadata, temp files)
3. Avoid duplicating files to save disk space
4. Allow easy curation by selecting specific categories
5. Maintain file paths that work with existing scanning tools

## Decision

Implement `scripts/mirror-with-symlinks.sh` that creates a mirrored directory structure with symlinks to audio files only.

### Key Features

**Audio File Filtering**:
```bash
find "$SOURCE_DIR" -type f \( -iname "*.wav" -o -iname "*.aif" -o -iname "*.aiff" -o -iname "*.mp3" -o -iname "*.flac" \)
```

**On-Demand Directory Creation**:
- Only creates directories that contain audio files
- Automatically cleans up empty directories
- Preserves complete folder hierarchy

**Error Handling**:
- Skips existing files instead of failing
- No `set -e` to prevent stopping on minor errors
- Progress indicators for large operations

**Performance Optimized**:
- Creates directories as needed (not all upfront)
- Processes 24,000+ files efficiently
- Provides progress feedback every 100 files

## Implementation

### Script Usage
```bash
./scripts/mirror-with-symlinks.sh \
  "/Users/Shared/Music/Samples Organized/Atmospheres" \
  "/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Audio Samples/Atmospheres"
```

### Results Achieved
- **Atmospheres**: 11,872 audio files symlinked
- **NI Organized**: 24,009 audio files symlinked  
- **Zero disk space** used for file duplication
- **Complete folder structure** preserved
- **No empty directories** in final result

### Configuration Integration
Added `audioBrowserBase` path to `config/constants.json`:
```json
{
  "paths": {
    "audioBrowserBase": "/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Audio Samples"
  }
}
```

## Alternatives Considered

**1. Copy Files**
- **Pros**: Simple, works everywhere
- **Cons**: Duplicates 10GB+ of data, waste of disk space
- **Rejected**: Unnecessary disk usage

**2. Hard Links**  
- **Pros**: No disk space, filesystem efficient
- **Cons**: Can't cross filesystem boundaries, limited portability
- **Rejected**: Less flexible than symlinks

**3. Filter During Scanning**
- **Pros**: No preprocessing needed
- **Cons**: Still processes 109k files, slow JSON generation
- **Rejected**: Performance still poor

**4. Database/Index System**
- **Pros**: Fast queries, metadata support
- **Cons**: Complex implementation, additional dependencies
- **Rejected**: Over-engineered for current needs

## Benefits

**Performance**:
- Reduces JSON size from 70MB to 2-5MB per category
- Browser load time < 1 second vs 10+ seconds
- iPad memory usage stays reasonable

**Disk Efficiency**:
- Zero file duplication
- Symlinks are tiny (few bytes each)
- Original files remain in organized structure

**Maintenance**:
- Easy to add/remove categories (run script again)
- Git-friendly (symlinks commit as references)
- Compatible with existing scanning tools

**Flexibility**:
- User can curate their live performance library
- Multiple categories can be mirrored independently
- Original library untouched

## Consequences

**Positive**:
- Audio browser implementation becomes feasible
- Maintains complete folder browsing experience
- No workflow changes for existing tools
- Easy to maintain and update

**Negative**:
- Requires Unix filesystem (macOS/Linux)
- Symlinks may confuse some tools
- Initial setup requires running script
- Windows compatibility may need testing

**Risk Mitigation**:
- Script includes validation and error handling
- Progress indicators for large operations
- Can be re-run safely (skips existing files)
- Documented usage examples

## Implementation Notes

The script is designed to be:
- **Idempotent**: Can be run multiple times safely
- **Incremental**: Only processes new/changed files
- **Validated**: Checks source existence before starting
- **Informative**: Clear progress and completion feedback

This enables the AudioBrowserV2 implementation with curated, performance-optimized sample libraries while preserving the complete organizational structure.

## References

- [AudioBrowserV2 Implementation Plan](../current-project/audioBrowserV2/IMPLEMENTATION_PLAN.md)
- [ADR-028: Project Constants File](./028-project-constants-file.md)
- [Script Implementation](../../scripts/mirror-with-symlinks.sh)