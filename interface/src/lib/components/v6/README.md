# V6 Clean Components

## Overview
These components are clean duplicates of V5 components with Max4Live dependencies stripped and ready for AbletonOSC integration.

## Directory Structure
- `looping/` - Core looping interface components (17 components)
- `layout/` - Panel and layout components (3 components)  
- `devices/` - Device-specific UI components (11 components)

**Total: 31 V6 components ready for Phase 0.5 processing**

## Component Naming Convention
- V5: `TrackVolumeSliderV5.svelte`
- V6: `TrackVolumeSliderV6.svelte`

## Integration Pattern
All V6 components will use typed props instead of direct store access:

```typescript
interface ComponentProps {
    // Data from AbletonOSC stores
    value: number;
    name: string;
    disabled?: boolean;
    
    // Event handlers back to AbletonOSC stores  
    onValueChange: (newValue: number) => void;
    onNameChange?: (newName: string) => void;
}

let { value, name, disabled = false, onValueChange, onNameChange }: ComponentProps = $props();
```

## Phase Status
- ✅ **Phase 0**: Components duplicated (31/31 complete)
- 🔄 **Phase 0.5**: Dependencies stripped (pending)
- ⏳ **Phase 1+**: AbletonOSC integration (pending)

## Components by Category

### Core Looping (17 components)
- `TrackVolumeSliderV6.svelte` - Track volume control
- `TrackSoloButtonV6.svelte` - Track solo control  
- `TrackActivatorButtonV6.svelte` - Track activation control
- `TrackStripV6.svelte` - Complete track strip UI
- `DeviceV6.svelte` - Generic device UI
- `GenericParameterV6.svelte` - Device parameter control
- `AddDeviceButtonV6.svelte` - Device addition control
- `DevicePickerV6.svelte` - Device selection interface
- `AddTrackButtonV6.svelte` - Track addition control
- `ClipLoopRangeV6.svelte` - Clip loop range control
- `ClipGrooveControlsV6.svelte` - Clip groove controls
- `UnifiedSequencerControlsV6.svelte` - Sequencer interface
- `MuteSequencerControlsV6.svelte` - Mute sequencer interface
- `EnhancedRateControlV6.svelte` - Rate control interface

### Layout Panels (3 components)  
- `TracksPanelV6.svelte` - Main tracks panel
- `DevicesPanelV6.svelte` - Devices panel
- `ClipPanelV6.svelte` - Clips panel

### Device UIs (11 components)
- `AutoFilter2UIV6.svelte` - Auto Filter device UI
- `AutoPan2UIV6.svelte` - Auto Pan device UI
- `ChannelEqUIV6.svelte` - Channel EQ device UI
- `Compressor2UIV6.svelte` - Compressor device UI
- `DelayUIV6.svelte` - Delay device UI
- `DrumBussUIV6.svelte` - Drum Buss device UI
- `DrumRackUIV6.svelte` - Drum Rack device UI
- `KompleteKontrolUIV6.svelte` - Komplete Kontrol device UI
- `OmnisphereUIV6.svelte` - Omnisphere device UI
- `PedalUIV6.svelte` - Pedal device UI
- `ReduxUIV6.svelte` - Redux device UI
- `SaturatorUIV6.svelte` - Saturator device UI
- `ShifterUIV6.svelte` - Shifter device UI
- `UtilityUIV6.svelte` - Utility device UI

## Next Steps (Phase 0.5)
1. Remove Max4Live store imports from all 31 components
2. Add clean typed prop interfaces
3. Replace derived state with prop-based state
4. Replace OSC send() calls with prop callbacks
5. Preserve 100% of UI markup, styling, and animations
6. Validate compilation without dependencies

## Quality Assurance
- All UI elements preserved (styling, animations, touch handling)
- iPad optimizations maintained
- Type safety through prop interfaces
- Component isolation for testing
- Clean separation between data and presentation