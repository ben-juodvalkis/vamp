# ADR 097: Compressor Sidechain Central View

**Status:** Implemented
**Date:** 2025-10-31
**Context:** V6 Architecture - Central Panel Enhancement

## Context

The Compressor device in the FX grid had a placeholder central view with no functionality. Compressor sidechain routing is essential for performance workflows (ducking, pumping effects), but required manual configuration in Ableton's UI.

## Decision

Implement a dedicated CompressorCentralView that provides one-touch sidechain configuration with automatic filter and routing setup.

### Architecture

**Property-Based Control Pattern**
- Follows the established pattern from ReverbCentralView (ADR 089)
- Uses LiveAPI properties for complex dict-based routing configuration
- Properties included in complete state message alongside parameters
- Optimistic UI updates with backend sync

**LiveAPI Dict Property Handling**
- CompressorDevice exposes `input_routing_type` as a dict property
- JavaScript objects serialized to JSON strings for OSC transmission
- Max parses JSON back to objects before passing to LiveAPI
- New `dict` type hint added to LiveObjectAPI service

### UI Design

**Track Selection Grid**
- Auto-flowing vertical columns (fill down, then add columns)
- 120px × 48px minimum button size, expanding to fill height
- Buttons filtered to exclude "No Input" and internal helper tracks
- Active track highlighted in pink (#ec4899)
- Text truncation for long track names

**One-Touch Configuration**
Each button click triggers:
1. Set `input_routing_type` property (sidechain source)
2. Enable sidechain filter (parameter 15 = 1)
3. Enable sidechain (parameter 20 = 1)

### Implementation Details

**Device Configuration**
```json
{
  "parameters": {
    "15": { "index": 15, "name": "Sidechain Filter On" },
    "20": { "index": 20, "name": "Sidechain On" }
  },
  "properties": {
    "available_input_routing_types": { "type": "object" },
    "input_routing_type": { "type": "object" }
  }
}
```

**OSC Dict Serialization**
- Client: Detect object values, set typeHint to `dict`, serialize to JSON string
- Max: Parse `dict` typeHint, deserialize JSON string back to object
- LiveAPI receives properly formatted dict object

**Reactive State Pattern**
- Uses `$state` variables (not `$derived` - must be writable)
- `$effect` blocks sync from store to local state
- Optimistic updates: set local state first, then send to backend
- Immediate UI feedback without waiting for backend confirmation

## Consequences

### Positive
- ✅ One-touch sidechain setup (previously 3-4 manual steps)
- ✅ Grid layout adapts to available tracks and panel size
- ✅ Establishes dict property pattern for future device views
- ✅ Automatic filter enabling improves default sound quality
- ✅ Filtered track list removes clutter (no helper tracks)

### Negative
- ⚠️ No manual control over filter/sidechain enable state (always on when source selected)
- ⚠️ Dict property pattern adds JSON serialization overhead
- ⚠️ Requires Max4Live script reload to pick up new property definitions

### Technical Debt
- Consider adding sidechain disable/off button if needed
- Could expose filter frequency controls in future iteration
- Dict serialization could be optimized with binary encoding

## Related
- [ADR 089: Hybrid Reverb Central View](089-hybrid-reverb-central-view-enhancement.md) - Property-based control pattern
- [ADR 049: Complete State Architecture](049-complete-state-architecture.md) - Property inclusion in state messages
- [LiveObjectAPI Service](../../interface/src/lib/services/liveObjectAPI.ts) - Dict serialization implementation

## Files Modified
- `data/device-configs.json` - Added Compressor2 properties and parameters
- `interface/src/lib/components/v6/central/views/CompressorCentralView.svelte` - Main UI implementation
- `interface/src/lib/services/liveObjectAPI.ts` - Added dict type handling and JSON serialization
- `ableton/scripts/liveAPI-v6.js` - Added dict type coercion with JSON parsing
- `ableton/scripts/device-configs.js` - Auto-generated with new property definitions
