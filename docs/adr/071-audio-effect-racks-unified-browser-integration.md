# ADR 062: Audio Effect Racks Unified Browser Integration

**Date:** 2025-10-21
**Status:** Accepted  
**Deciders:** Ben Juodvalkis
**Tags:** Audio Effects, Browser, Device Support, Central Views
**Related:** ADR-018 (Gesture Browser), ADR-038 (VerticalSlider Components)

---

## Context

The unified gesture browser supported instrument browsing (Ableton, NI, Omnisphere) and audio clip browsing, but lacked support for Audio Effect Racks. Users needed a way to:

1. **Browse and load Audio Effect Racks** organized by category (Guitar, Vocal, Bus effects)
2. **Control Effect Rack macro parameters** through the central panel system
3. **Access Effect Rack controls** without disrupting the existing gesture-first workflow

### Problems with Existing System

1. **No Effect Rack Browsing**
   - Audio browser only showed audio clips (.wav, .aiff, etc.)
   - Effect Racks had to be loaded manually outside the touch interface
   - No organized categorization of effect presets

2. **Missing Device Support**
   - `AudioEffectGroupDevice` not detected by device classification system
   - No central view component for Audio Effect Rack macro controls
   - No parameter observation in Max4Live complete state system

3. **Inconsistent Audio Functionality**
   - Audio button redundancy (top + bottom browsers)
   - Effect Racks treated as separate workflow from audio clips

---

## Decision

**Integrate Audio Effect Racks into the unified browser system** with full device support, parameter control, and organized browsing alongside audio clips.

### Implementation Approach

1. **Extend audio browser** to show Effect Racks as third section below audio clips
2. **Add complete AudioEffectGroupDevice support** across device classification, central views, and parameter observation
3. **Maintain unified loading mechanism** using existing `loadPreset()` system
4. **Optimize audio button behavior** to eliminate redundancy

---

## Implementation

### 1. Device Classification Enhancement
**File**: `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts`

**Added AudioEffectGroupDevice support**:
```typescript
export type DeviceType =
  | { kind: 'fx-grid'; slotKey: SlotKey }
  | { kind: 'instrument'; instrumentType: InstrumentType }
  | { kind: 'audio-effect-rack' }  // NEW
  | { kind: 'sequencer' }
  | { kind: 'unknown' };

// Added to classifyDevice()
if (device.className === 'AudioEffectGroupDevice') {
  return { kind: 'audio-effect-rack' };
}

// Added getters
get audioEffectRack(): ClassifiedDevice | undefined
get audioEffectRackDevice(): ClassifiedDevice | undefined
```

### 2. Central View Component
**File**: `interface/src/lib/components/v6/central/views/AudioEffectRackCentralView.svelte`

**Created comprehensive central view**:
- **16 macro controls** using `DeviceVerticalSlider` (parameters 1-16, range 0-127)
- **Dynamic parameter names** from Max4Live (`cleanParameterName()` for display)
- **Reactive parameter binding** via `$effect()` blocks reading `selectedTrackStore.getParameterValue()`
- **Bidirectional control** via `selectedTrackStore.setParameter()` onChange handlers
- **Responsive grid layout** (4×4 → 3×6 → 2×8 on smaller screens)
- **Full-height sliders** with `grid-template-rows: repeat(4, 1fr)` for maximum control precision

### 3. Device Configuration
**File**: `data/device-configs.json`

**Added AudioEffectGroupDevice configuration**:
```json
"AudioEffectGroupDevice": {
  "parameters": {
    "1": { "index": 1, "name": "Macro 1", "min": 0, "max": 127, "dataType": "int" },
    // ... parameters 2-16
  },
  "enhanced": true,
  "expectedClassName": "AudioEffectGroupDevice",
  "ui": { "component": "AudioEffectRackUI", "layout": "rack" },
  "colors": { "primary": "#00c9ff", "secondary": "#0891b2" }
}
```

**Key Design Decision**: Use actual Ableton class name `AudioEffectGroupDevice` (not `AudioEffectRack`) to match Live's internal naming.

### 4. Max4Live Parameter Observation
**Files**: `ableton/scripts/liveAPI-v6.js` + generated `device-configs.js`

**Extended complete state system**:
- **Added AudioEffectGroupDevice** to parameter names querying logic
- **Parameter observation**: 16 parameters (1-16) automatically monitored
- **Parameter names**: 17 names (0-16) queried for custom macro labels
- **Auto-generated config**: `"AudioEffectGroupDevice": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]`

**Complete state message format**:
```
/looping/devices/complete_state trackIdx deviceCount deviceId deviceIndex deviceName AudioEffectGroupDevice paramCount param1Idx param1Val param2Idx param2Val ... nameCount name0 name1 ...
```

### 5. Data Generation Extension
**File**: `scripts/generate-instruments-json.ts`

**Enhanced audio-clips.json generation**:
- **Dual directory scanning**: Audio Samples + Effect Patches/audio-browser
- **Combined tree structure**: Effect Racks appear as top-level folder
- **File extension support**: Audio files (.wav, .aiff, etc.) + Effect files (.adg, .adv)
- **Automatic folder discovery**: No hardcoded categories, scans actual directory structure

**Example directory structure**:
```
/ableton/Presets/Effect Patches/audio-browser/
├── Guitar Effects/
│   ├── Pedal.adv
│   └── Saturator.adv  
└── Vocal Effects/
    ├── Compressor.adv
    └── Reverb.adv
```

### 6. Adapter Enhancement  
**File**: `interface/src/lib/services/adapters/audioClipsAdapter.ts`

**Extended file support**:
```typescript
// Supported effect extensions
private static readonly EFFECT_EXTENSIONS = ['.adg', '.adv'];

// All supported extensions (audio + effects)  
private static readonly ALL_EXTENSIONS = [
  ...AUDIO_EXTENSIONS, 
  ...EFFECT_EXTENSIONS
];
```

**Result**: Audio browser seamlessly handles both audio clips and effect files with identical interaction patterns.

### 7. Central Panel Access System
**Files**: `instrumentDisplayCoordinator.svelte.ts` + `BottomControls.svelte`

**Dual access method**:

**Automatic Detection** (instrumentDisplayCoordinator):
```typescript
// Check for Audio Effect Rack first (takes priority over instruments)
const audioEffectRack = devices.find(device => device.className === 'AudioEffectGroupDevice');
if (audioEffectRack) {
  centralDisplayStore.setView('device', 'audio-effect-rack', { device: audioEffectRack });
  this.refreshEffectRackParameters(audioEffectRack);
  return;
}
```

**Manual Access** (BottomControls):
```typescript
// Conditional "Effects" button between Audio and Scale browsers
{#if audioEffectRack}
  <button onclick={handleEffectRackClick}>
    <span style="--button-color: #00c9ff;">Effects</span>
  </button>
{/if}
```

### 8. UI Optimization
**File**: `interface/src/lib/components/v6/browser/TopGestureBrowser.svelte`

**Audio button visibility optimization**:
```typescript
// Audio vendor only appears when browser is expanded
const vendors = $derived(
  isExpanded ? [...baseVendors, audioVendor] : baseVendors
);
```

**Eliminates redundancy**: Audio button in top browser only visible when needed for closing.

---

## Architecture

### User Workflow

```
1. Load Effect Rack:
   Bottom Audio Button → Audio Browser → Effect Racks → Guitar Effects → Load

2. Auto Display:
   Effect Rack loads → Auto-shows central view with 16 macros

3. Manual Access:
   "Effects" button appears in bottom sidebar → Tap to return to central view

4. Parameter Control:
   Drag sliders → Real-time macro control in Ableton Live
```

### Data Flow

```
Effect Rack Selection:
  Browser → loadPreset() → /looping/devices/load → Max4Live → Device loaded

Parameter Observation:
  Max4Live → buildCompleteDeviceState() → AudioEffectGroupDevice detected
  → Query 16 parameters + names → Complete state OSC message

Parameter Control:
  Slider drag → selectedTrackStore.setParameter() → OSC message → Ableton Live
```

### Browser Integration

```
Audio Browser Structure:
├── [Audio Clips folders...]
├── Effect Racks/
│   ├── Guitar Effects/
│   │   ├── Pedal.adv (loads individual effect)
│   │   └── Guitar Rig.adg (loads effect rack)
│   └── Vocal Effects/
│       ├── Vocal Chain.adg (loads effect rack)
│       └── Compressor.adv (loads individual effect)
```

---

## Benefits

### 1. **Unified Audio Workflow**
- **Single browser** for audio clips + effect racks
- **Consistent interaction** patterns across all content types
- **Same loading mechanism** for seamless integration

### 2. **Professional Effect Control**
- **16 macro controls** with full-height sliders for precision
- **Custom parameter names** from Effect Rack configuration
- **Real-time bidirectional** parameter synchronization

### 3. **Discoverable Organization**
- **Categorized effect browsing** (Guitar, Vocal, Bus effects)
- **Touch-optimized interface** following gesture-first principles
- **Automatic central view** display for immediate control access

### 4. **Complete Device Support**
- **Full AudioEffectGroupDevice** detection and classification
- **Max4Live integration** with automatic parameter observation
- **Central panel system** integration with existing device architecture

### 5. **Clean UI/UX**
- **Eliminated audio button redundancy** (contextual visibility)
- **Logical control placement** (Effects button in audio section)
- **Responsive design** for iPad and desktop use

---

## Technical Considerations

### Parameter Range Design
**Decision**: Use 0-127 range for Effect Rack macros (matching MIDI/Live conventions)
**Alternative**: 0-1 normalized range  
**Rationale**: 
- Consistency with drum rack and instrument rack macros
- Matches Ableton Live's internal macro range
- More intuitive for users familiar with MIDI controllers

### Device Priority Logic
**Decision**: Audio Effect Racks take priority over instruments in auto-detection
**Rationale**:
- Effect Racks are typically loaded intentionally for immediate control
- Instruments can be accessed via existing instrument browser buttons
- Effect control is often more time-sensitive in live performance

### Data Organization
**Decision**: Effect Racks appear as folder within audio browser (not separate browser)
**Alternative**: Dedicated Effect Racks browser
**Rationale**:
- Maintains unified audio workflow
- Reduces UI complexity 
- Leverages existing gesture-first browser architecture
- Audio tracks commonly use both clips and effects together

---

## Consequences

### Positive

1. **Complete Effect Rack Workflow**
   - Browse → Load → Control in single unified interface
   - Professional macro control with custom parameter names
   - Immediate access via automatic detection + manual button

2. **Enhanced Audio Capabilities**
   - Audio tracks now support rich effect browsing
   - Effect categorization improves organization
   - Seamless integration with existing audio clip workflow

3. **Architectural Consistency**
   - Effect Racks treated as first-class devices like instruments
   - Reuses existing parameter observation and control patterns
   - Maintains gesture-first browser design principles

4. **Performance Optimized**
   - Reuses existing data scanning and adapter infrastructure
   - Minimal additional data size (only effect files added to existing JSON)
   - No new OSC protocols or communication patterns

### Negative

1. **Increased UI Complexity**
   - Additional button in bottom sidebar (conditional)
   - Effect Racks section adds to browser content
   - 16-macro central view more complex than individual effects

2. **Memory Usage**
   - Larger audio-clips.json file (includes effect files)
   - Additional parameter observation for AudioEffectGroupDevice
   - More component instances in central view (16 sliders vs 8)

### Mitigations

**For UI Complexity**:
- Effects button only appears when relevant (conditional rendering)
- Maintains familiar interaction patterns from existing components
- Responsive grid layout adapts to screen size

**For Memory Usage**:
- Effect files are small compared to audio clips (negligible impact)
- Parameter observation reuses existing infrastructure
- Component instances are virtualized (only render when visible)

---

## Testing Strategy

### Manual Testing
- [x] Load Audio Effect Rack via audio browser
- [x] Verify automatic central view display
- [x] Test all 16 macro controls (values + interaction)
- [x] Verify parameter names display correctly
- [x] Test Effects button in bottom sidebar
- [x] Confirm audio clip functionality unchanged

### Integration Testing
- [x] Max4Live parameter observation working
- [x] Complete state includes all parameters and names
- [x] Device classification detects AudioEffectGroupDevice
- [x] Browser data generation includes effect files
- [x] Loading mechanism works for both audio and effect files

### Performance Testing
- [x] Audio browser performance with additional content
- [x] Parameter response latency (slider → Ableton)
- [x] Memory usage impact
- [x] Responsive layout on different screen sizes

---

## Future Considerations

### Potential Enhancements

1. **Effect Rack Templates**
   - Preset effect chain configurations
   - Genre-specific effect combinations
   - Quick-load common setups

2. **Advanced Parameter Control**
   - XY pads for paired macro control
   - Parameter automation visualization
   - Macro assignment interface

3. **Integration Expansions**
   - MIDI Effect Racks support (`MidiEffectGroupDevice`)
   - Return track effect browsing
   - Master track effect integration

4. **Organization Features**
   - User favorites/tags for effect racks
   - Search/filter functionality
   - Recent effects quick access

### Known Limitations

1. **Touch Responsiveness**
   - 16 sliders may be challenging on smaller iPad screens
   - Responsive grid helps but dense layout remains
   - Consider tabbed view for mobile if needed

2. **Effect Rack Complexity**
   - Limited to macro controls (no internal device access)
   - No visualization of effect chain structure
   - Advanced effect rack features require Ableton Live interface

---

## Migration Guide

### For Users
**No breaking changes** - all existing functionality preserved:
- Audio clips browser works identically  
- All instrument browsing unchanged
- New Effect Racks section appears automatically after regenerating data

### For Developers
**Configuration Updates Required**:
1. **Regenerate data**: `npm run generate:instruments -- --audio` (includes effect files)
2. **Max4Live config**: Automatically updated via `npm run generate:max-config`
3. **No API changes**: Uses existing `loadPreset()` and parameter systems

**File Organization**:
- **Populate effect directory**: `/ableton/Presets/Effect Patches/audio-browser/`
- **Create categories**: Guitar Effects/, Vocal Effects/, etc.
- **Copy effect files**: .adg/.adv files from main Effect Patches directory

---

## Success Criteria

All criteria met:

✅ **Effect Rack Browsing**: Browse and load effect racks via audio browser
✅ **Parameter Control**: 16 macro controls with custom names and full-height sliders  
✅ **Device Detection**: AudioEffectGroupDevice properly classified and managed
✅ **Max4Live Integration**: Complete state includes all parameters and names
✅ **Automatic Display**: Effect racks auto-show in central panel when loaded
✅ **Manual Access**: Effects button provides quick access when effect rack present
✅ **UI Optimization**: Audio button redundancy eliminated with contextual visibility
✅ **Data Integration**: Effect files seamlessly integrated with audio clips data
✅ **Loading Compatibility**: Uses existing preset loading infrastructure

---

## Metrics

### Implementation Scope
- **Files Modified**: 8 core files + 2 generated configs
- **Components Created**: 1 central view component  
- **Parameter Support**: 16 macro parameters (1-16, range 0-127)
- **Device Types**: Added 1 new device classification
- **Browser Content**: Added Effect Racks section to audio browser

### Performance Impact
- **Data Size**: +4 effect files to 26,891 audio clips (negligible)
- **Memory Usage**: +16 parameter observations per effect rack
- **UI Complexity**: +1 conditional button, +16 slider components
- **Loading Time**: No change (reuses existing loading mechanism)

### Feature Completeness
- **Browse**: ✅ Organized by category with folder navigation
- **Load**: ✅ Seamless integration with existing loading system  
- **Control**: ✅ Full 16-macro parameter control with custom names
- **Display**: ✅ Automatic and manual central view access
- **Integration**: ✅ Complete Max4Live and OSC communication

---

## Related Decisions

- **ADR-018**: Gesture Browser Architecture (browser expansion pattern)
- **ADR-038**: VerticalSlider Components (slider component choice)
- **ADR-016**: Audio Button Replaces Fire Hold (audio button placement)

---

## Implementation Files

### Core Implementation
- `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` - Device classification
- `interface/src/lib/components/v6/central/views/AudioEffectRackCentralView.svelte` - Central view
- `interface/src/lib/components/v6/central/CentralDisplay.svelte` - View routing
- `interface/src/lib/components/v6/browser/BottomControls.svelte` - Manual access button

### Data and Configuration  
- `data/device-configs.json` - AudioEffectGroupDevice configuration
- `scripts/generate-instruments-json.ts` - Extended data generation
- `interface/src/lib/services/adapters/audioClipsAdapter.ts` - Effect file support
- `interface/src/lib/services/instrumentDisplayCoordinator.svelte.ts` - Auto-detection

### Max4Live Integration
- `ableton/scripts/liveAPI-v6.js` - Parameter names and observation
- `ableton/scripts/device-configs.js` - Generated parameter mapping
- `ableton/scripts/device-initialization.js` - Generated initialization rules

### Browser Integration
- `interface/src/lib/components/v6/browser/TopGestureBrowser.svelte` - Audio button optimization
- `interface/static/data/audio-clips.json` - Generated data with effect files

---

## Decision Outcome

**Accepted** - Full implementation complete, tested, and ready for production use.

**Success Metrics Achieved**:
- ✅ Complete end-to-end Audio Effect Rack workflow
- ✅ Professional macro control interface
- ✅ Seamless integration with existing systems
- ✅ No breaking changes to existing functionality  
- ✅ Performance requirements maintained

**User Impact**: Positive - adds significant functionality while maintaining familiar interaction patterns.

**Next Steps**: 
- Monitor real-world usage patterns
- Consider additional effect categorization as library grows
- Potential expansion to MIDI Effect Racks if needed

### Subsequent Refinement: Audio Routing Simplification

**Issue**: Audio track preparation was forcing B-Guitar input routing, reducing flexibility
**Solution**: Commented out `configureAudioRouting()` call in `trackPreparation.ts:329-331`
**Result**: Audio tracks now use default Ableton Live input routing settings
**Benefit**: Users maintain control over their preferred audio input configuration

### Subsequent Refinement: Central View Navigation Fix

**Issue**: Audio Effect Rack central view was "sticky" and difficult to dismiss due to aggressive auto-detection
**Problems**:
- Auto-detection immediately re-showed rack view when user tried to close it
- Individual FX grid interactions competed with rack view
- Inconsistent behavior compared to instrument views

**Solution**: Simplified central view display to only show in explicit cases
1. **Removed aggressive auto-detection**: Deleted lines 50-58 from `instrumentDisplayCoordinator.svelte.ts`
2. **Added browser loading trigger**: Enhanced `loadPreset()` in `trackPreparation.ts` to show rack view when loading presets that affect Audio Effect Racks
3. **Maintained manual access**: "Effects" button in `BottomControls.svelte` continues to work

**Implementation**:
```typescript
// trackPreparation.ts - Added after loadPreset() send
setTimeout(() => {
    const audioEffectRack = selectedTrackStore.audioEffectRack;
    if (audioEffectRack) {
        console.log(`Audio Effect Rack detected after preset load, showing central view`);
        centralDisplayStore.setView('device', 'audio-effect-rack', { device: audioEffectRack });
    }
}, 100);
```

**Result**: Clean navigation experience - rack view only appears when explicitly requested via:
- Effects button (manual access)
- Loading presets from browser (automatic for relevant loads)

**Benefit**: Users can now dismiss the Audio Effect Rack view and access FX grid/clip controls without unwanted view changes