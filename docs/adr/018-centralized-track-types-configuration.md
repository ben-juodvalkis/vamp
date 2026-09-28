#ADR-018: Centralized Track Types Configuration System

## Status
Accepted

## Context

The live looping interface requires support for multiple specialized audio track types (Guitar, Mic, Bass, Keys, etc.), each with specific routing, effects, and UI properties. Previously, this was handled through hardcoded functions and scattered configuration across multiple files.

### Problems with Previous Approach
1. **Code Duplication**: Each track type required separate hardcoded functions
2. **Maintenance Overhead**: Adding new track types required changes across multiple files
3. **Inconsistent Patterns**: Different track types used different preparation logic
4. **Configuration Scattered**: Routing, effects, and UI properties spread across codebase
5. **Limited Extensibility**: No easy way to add new track types without code changes

### Requirements
- Support for specialized audio track types with custom routing and effects
- Easy addition of new track types without code modifications
- Consistent track preparation logic across all types
- Automatic effect loading based on track type
- Smart track reuse when switching between compatible types
- Integration with existing build process and static asset management

## Decision

We will implement a **Centralized Track Types Configuration System** with the following architecture:

### 1. Configuration-Driven Approach
- Single JSON configuration file defining all track types
- Each track type specifies routing, effects, UI properties, and behavior
- Runtime loading using fetch API (matching existing instruments.json pattern)

### 2. Configuration Structure
```json
{
  "trackTypes": {
    "guitar": {
      "name": "Guitar",
      "type": "audio",
      "color": "#ff6b35",
      "routing": { "subChannel": 3 },
      "effects": [{ "path": "Guitar.adg", "required": false }],
      "ui": { "showInSidebar": true, "behavior": "prepare-track" }
    }
  }
}
```

### 3. Generic Track Preparation Function
- Single `prepareTrackByType(trackTypeId)` function
- Loads configuration and applies settings dynamically
- Replaces multiple hardcoded preparation functions
- Supports smart track reuse and effect loading

### 4. Build Process Integration
- Configuration copied from `/config/trackTypes.json` to `/interface/static/data/`
- Automatic copying in all build scripts (`npm run dev`, `npm run ipad`, etc.)
- Same pattern as existing `constants.json` and `instruments.json`

## Implementation

### Core Components

1. **Configuration File**: `/config/trackTypes.json`
   - Source of truth for all track type definitions
   - Human-readable and version-controlled

2. **Service Layer**: `/interface/src/lib/services/trackTypeConfig.ts`
   - Runtime configuration loading with caching
   - Type-safe interfaces and helper functions
   - Async API matching other adapter patterns

3. **Track Preparation**: Enhanced `/interface/src/lib/services/trackPreparation.ts`
   - Generic `prepareTrackByType()` function
   - Effect loading capability
   - Smart track reuse logic

4. **Build Integration**: `/scripts/copy-track-types.js`
   - Automated copying during build process
   - Added to all relevant npm scripts

### Current Track Types

| Type | Channel | Effects | Sidebar | Description |
|------|---------|---------|---------|-------------|
| Guitar | 3 | Guitar.adg | ✅ | Guitar input with amp simulation |
| Mic | 1 | Vocal.adg | ✅ | Microphone with vocal processing |
| Bass | 3 | Bass.adg | ✅ | Bass guitar processing |
| Keys | 4 | Piano Reverb.adv | ❌ | Keyboard/piano effects |

## Consequences

### Positive
- **Easy Extensibility**: New track types added via JSON configuration only
- **Consistent Behavior**: All track types use same preparation logic
- **Maintainable**: Single source of truth for track configurations
- **Type Safety**: Full TypeScript interfaces and validation
- **Performance**: Cached configuration loading, smart track reuse
- **Build Integration**: Automatic copying maintains development workflow

### Negative
- **Runtime Loading**: Configuration loaded asynchronously (all functions now async)
- **Build Dependency**: Must remember to update both source and static copies
- **Component Proliferation**: Multiple deprecated browser components need cleanup

### Neutral
- **Pattern Consistency**: Matches existing instruments.json loading pattern
- **File Structure**: Follows established config → static copying approach
- **Component Deprecation**: Old browser components marked as DEPRECATED for future removal

## Alternatives Considered

### 1. Hardcoded Configurations
**Rejected**: Does not solve extensibility and maintenance issues

### 2. TypeScript Configuration Files
**Rejected**: Would require build-time compilation and lose runtime flexibility

### 3. Database/API Configuration
**Rejected**: Adds unnecessary complexity for relatively static data

### 4. Environment Variables
**Rejected**: Poor fit for complex nested configuration data

## Future Considerations

1. **UI Generation**: Could auto-generate sidebar buttons from configuration
2. **Validation**: Runtime configuration validation and error handling
3. **Hot Reload**: Development-time configuration reloading
4. **Preset Management**: Integration with preset browser for track-specific presets
5. **MIDI Tracks**: Extend system to support MIDI track types with instruments

## Migration Strategy

1. ✅ **Phase 1**: Implement configuration system and generic preparation function
2. ✅ **Phase 2**: Update existing Guitar and Mic buttons to use new system
3. ✅ **Phase 3**: Add Bass button with configuration-driven approach
4. ✅ **Phase 4**: Deprecate unused browser components (`BottomControls.DEPRECATED.svelte`, `TopGestureBrowser.DEPRECATED.svelte`, `ScaleGestureBrowser.DEPRECATED.svelte`)
5. **Phase 5**: Remove deprecated preparation functions and components
6. **Phase 6**: Consider auto-generated UI components from configuration

## Related Documents
- [V6 Architecture Overview](v6-architecture-overview.md)
- [V6 UI Architecture](v6-ui-architecture.md)
- [ADR-018: Gesture Browser Architecture](018-gesture-browser-architecture.md)

---
**Date**: 2024-10-24  
**Authors**: Claude Code Assistant  
**Reviewers**: TBD  
**Status**: Implemented