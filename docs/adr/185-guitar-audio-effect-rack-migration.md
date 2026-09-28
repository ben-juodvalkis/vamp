# ADR-185: Guitar Audio Effect Rack Migration

## Status
Accepted

## Context
The Guitar FX Grid slot previously used Guitar Rig 7 MFX (an AU plugin with class `AuPluginDevice`). This created a dependency on third-party software and made the Guitar effect non-portable across systems.

Additionally, the generic AudioEffectRackCentralView displayed a static 4x4 grid of 16 macro sliders, regardless of how the macros were actually named or configured.

## Decision

### 1. Migrate Guitar to Audio Effect Rack
Replace Guitar Rig 7 MFX with an Ableton Audio Effect Rack named "Guitar" (class `AudioEffectGroupDevice`). This allows:
- Full control over the effect chain within Ableton
- Portable preset that works on any system
- Macro mappings that integrate with the intelligent UI

### 2. Intelligent Macro Layout for All Audio Effect Racks
Both GuitarCentralView and AudioEffectRackCentralView now use dynamic layout based on macro naming conventions:

**Grouping Logic:**
- Macros with the same first word are grouped together
- Groups of 2+ macros: First two become an XY pad, rest become sliders
- Single macros: Become individual sliders
- Empty/unnamed macros (`.`, `-`, `Macro N`): Skipped

**Examples:**
- "Filter Cut" + "Filter Res" → **FILTER** XY pad
- "Delay Time" + "Delay Fb" + "Delay Mix" → **DELAY** XY pad + **Delay Mix** slider
- "Drive" → **Drive** slider (single macro)

### 3. FX Grid Slider Range
GuitarControl.svelte updated to use 0-127 range (matching Audio Effect Rack macros) instead of the previous 0-1 float range.

### 4. Reserved Macro for FX Grid
GuitarCentralView shows macros 2-8; Macro 1 is reserved for the FX Grid slider to avoid duplication.

## Files Changed

### Detection & Loading
- `interface/src/lib/config/devicePresets.ts` - Updated guitar config:
  - `presetPath`: Points to Guitar.adg
  - `defaultName`: "Guitar"
  - `expectedClassName`: "AudioEffectGroupDevice"

- `ableton/scripts/liveAPI-v6.js`:
  - Detection: `deviceName === "Guitar" && deviceClass === "AudioEffectGroupDevice"`
  - Load functions: Updated preset paths to Guitar.adg

### UI Components
- `interface/src/lib/components/v6/device-panel/GuitarControl.svelte` - Range changed to 0-127
- `interface/src/lib/components/v6/central/views/GuitarCentralView.svelte` - Dynamic layout, macros 2-8
- `interface/src/lib/components/v6/central/views/AudioEffectRackCentralView.svelte` - Dynamic layout, all 16 macros

## Macro Naming Convention for XY Pads

To get XY pads in your Audio Effect Racks, name macros with a shared first word:

| Macro | Name | Result |
|-------|------|--------|
| 2 | Filter Cut | XY Pad X axis |
| 3 | Filter Res | XY Pad Y axis |
| 4 | Drive | Slider |
| 5 | Reverb Mix | Slider |
| 6 | Tremolo Rate | XY Pad X axis |
| 7 | Tremolo Depth | XY Pad Y axis |

## Reverting to Guitar Rig 7 MFX

If you need to revert to the AU plugin approach:

### 1. devicePresets.ts
```typescript
guitar: {
  presetPath: `${constants.paths.effectPresetsBase}/audio-browser/Guitar.aupreset`,
  defaultName: 'Guitar Rig 7 MFX',
  expectedClassName: 'AuPluginDevice',
  color: {
    primary: 'rgb(239, 68, 68)',
    secondary: 'rgba(239, 68, 68, 0.1)',
    accent: 'rgb(252, 165, 165)'
  }
},
```

### 2. liveAPI-v6.js - Detection (~line 2110)
```javascript
if (deviceName === "Guitar Rig 7 MFX" && deviceClass === "AuPluginDevice") {
    guitarDeviceCache[selectedTrackIndex] = "live_set " + trackPath + " devices " + i;
    log("Cached Guitar device at: " + guitarDeviceCache[selectedTrackIndex]);
}
```

### 3. liveAPI-v6.js - Load Function (~line 2435)
```javascript
var guitarPresetPath = "/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Looping Presets/Effect Patches/audio-browser/Guitar.aupreset";
```

### 4. liveAPI-v6.js - Track Creation (~line 3872)
```javascript
var guitarPresetPath = "/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Looping Presets/Effect Patches/audio-browser/Guitar.aupreset";
```

### 5. GuitarControl.svelte - Range
```typescript
const PARAM_CONFIG = {
  drive: {
    index: 1,
    min: 0,
    max: 1,
    type: 'float' as const
  }
};
```

### 6. GuitarCentralView.svelte
Restore the original component with hardcoded controls for Guitar Rig 7 parameters (AMP, TONE, FUZZ, GAIN, TREMOLO XY, COMP). See git history for the original implementation.

## Consequences

### Positive
- Guitar effect is now portable (no third-party plugin dependency)
- Intelligent macro layout makes all Audio Effect Racks more useful
- Consistent naming convention creates automatic XY pads
- FX Grid slider range matches rack macro range (0-127)

### Negative
- Guitar.adg preset must be created and configured with appropriate macros
- Existing Guitar Rig presets/sessions need updating

### Neutral
- Detection logic unchanged in structure (class + name matching)
- AudioEffectRackCentralView improvements benefit all racks, not just Guitar
