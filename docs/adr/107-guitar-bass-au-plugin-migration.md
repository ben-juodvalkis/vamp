# ADR 107: Guitar and Bass AU Plugin Migration

**Status:** Accepted
**Date:** 2025-11-05
**Deciders:** Ben, Claude
**Related:** ADR 052 (FX Grid Device Reorganization), ADR 095 (Position-Based FX Grid Architecture)

## Context

The Guitar (fx8) and Bass (fx9) slots in the FX Grid were initially implemented using Audio Effect Rack devices (`.adg` files) with macro controls. However, using dedicated AU plugin presets provides:

1. **Professional Sound Quality:** Native Instruments Guitar Rig 7 and Line 6 Helix Native are industry-standard amp modeling plugins with superior tone and processing
2. **Preset Integration:** Direct loading of specific amp/cab presets optimized for the live looping workflow
3. **Consistent Architecture:** Aligns with existing AU plugin integrations (Saturn 2, Zebrify, Omnisphere, Komplete Kontrol)
4. **Simplified Control:** Single drive parameter on the main slider with room for extended controls in central views

### Requirements

1. **Device Loading:** Load AU plugin presets via `.aupreset` files
2. **Device Matching:** Correctly identify plugins by both `className` and `name` (dual matching)
3. **Parameter Control:** Simple drive/gain control on main FX Grid sliders
4. **State Synchronization:** Include plugin parameters in Max4Live complete state messages
5. **Central Views:** Provide placeholder views for future extended controls
6. **Minimal Disruption:** Maintain existing grid positions and color schemes

## Decision

We migrated both guitar and bass device slots from Audio Effect Racks to AU plugin presets with the following configurations:

### Bass Slot (fx9) - Helix Native

**Device Configuration:**
- **Preset Path:** `/audio-browser/Bass.aupreset`
- **Expected Class:** `AuPluginDevice`
- **Device Name:** `Helix Native` (matches plugin name, not preset filename)
- **Color:** Purple (`rgb(168, 85, 247)`)

**Control Configuration:**
- **Main Slider:** Parameter 1 (Drive)
- **Type:** Float (0-1)
- **Default Value:** 1.0 (maximum drive)
- **Central View:** Empty placeholder with Helix Native branding

**State Message Configuration:**
```json
"AuPluginDevice:Helix Native": {
  "parameters": {
    "1": {
      "index": 1,
      "name": "Drive",
      "dataType": "float",
      "min": 0,
      "max": 1
    }
  }
}
```

### Guitar Slot (fx8) - Guitar Rig 7

**Device Configuration:**
- **Preset Path:** `/audio-browser/Guitar.aupreset`
- **Expected Class:** `AuPluginDevice`
- **Device Name:** `Guitar Rig 7 MFX` (matches plugin name)
- **Color:** Red (`rgb(239, 68, 68)`)

**Control Configuration:**
- **Main Slider:** Parameter 1 (Drive)
- **Type:** Float (0-1)
- **Default Value:** 0 (clean tone)
- **Central View:** Empty placeholder with Guitar Rig 7 branding

**State Message Configuration:**
```json
"AuPluginDevice:Guitar Rig 7 MFX": {
  "parameters": {
    "1": {
      "index": 1,
      "name": "Drive",
      "dataType": "float",
      "min": 0,
      "max": 1
    }
  }
}
```

### Implementation Details

#### Device Preset Configuration

Updated `interface/src/lib/config/devicePresets.ts`:

```typescript
guitar: {
  presetPath: `${constants.paths.effectPresetsBase}/audio-browser/Guitar.aupreset`,
  defaultName: 'Guitar Rig 7 MFX',  // Must match plugin name exactly
  expectedClassName: 'AuPluginDevice',
  color: {
    primary: 'rgb(239, 68, 68)',
    secondary: 'rgba(239, 68, 68, 0.1)',
    accent: 'rgb(252, 165, 165)'
  }
},
bass: {
  presetPath: `${constants.paths.effectPresetsBase}/audio-browser/Bass.aupreset`,
  defaultName: 'Helix Native',  // Must match plugin name exactly
  expectedClassName: 'AuPluginDevice',
  color: {
    primary: 'rgb(168, 85, 247)',
    secondary: 'rgba(168, 85, 247, 0.1)',
    accent: 'rgb(196, 167, 231)'
  }
}
```

#### Control Components

Updated `GuitarControl.svelte` and `BassControl.svelte`:

**Key Changes:**
1. **Parameter Type:** Changed from `integer` (0-127) to `float` (0-1) for AU plugin compatibility
2. **Parameter Name:** Changed from `macroValue` to `driveValue` for semantic clarity
3. **Default Values:** Guitar = 0 (clean), Bass = 1.0 (maximum drive)

```typescript
const PARAM_CONFIG = {
  drive: {
    index: 1,
    min: 0,
    max: 1,
    type: 'float' as const
  }
};

let driveValue = $state(0);  // or 1.0 for bass

$effect(() => {
  if (device) {
    driveValue = selectedTrackStore.getParameterValue(device.id, 1) ?? 0;
  }
});
```

#### Central Display Views

Created minimal placeholder views for future expansion:

**BassCentralView.svelte:**
```svelte
<div class="text-center">
  <div class="text-6xl">🎸</div>
  <h2 style="color: {color?.primary}">Helix Native</h2>
  <p>Bass amp loaded</p>
  <p class="text-xs">Extended controls coming soon</p>
</div>
```

**GuitarCentralView.svelte:**
```svelte
<div class="text-center">
  <div class="text-6xl">🎸</div>
  <h2 style="color: {color?.primary}">Guitar Rig 7</h2>
  <p>Guitar amp loaded</p>
  <p class="text-xs">Extended controls coming soon</p>
</div>
```

#### Max4Live State Configuration

Added to `data/device-configs.json` and regenerated Max configuration:

```bash
npm run generate:max-config
```

Generated configuration includes:
- `AuPluginDevice:Helix Native → 1 parameters: [1]`
- `AuPluginDevice:Guitar Rig 7 MFX → 1 parameters: [1]`

## Consequences

### Positive

1. **Professional Sound Quality:** Industry-standard amp modeling provides superior tone
2. **Preset Management:** Curated presets optimized for live performance
3. **Architectural Consistency:** Follows established AU plugin patterns (Saturn 2, Zebrify, Komplete Kontrol)
4. **Type Safety:** Float parameters (0-1) match AU plugin standards
5. **Extensibility:** Placeholder central views ready for additional parameter controls
6. **State Synchronization:** Proper Max4Live configuration ensures parameter values persist across track switches

### Neutral

1. **Device Name Matching:** Must use actual plugin name (e.g., "Helix Native") not preset filename ("Bass")
2. **Parameter Discovery:** Additional plugin parameters can be mapped in the future by updating device-configs.json
3. **Central View Implementation:** Extended controls (EQ, cab selection, effects) deferred to future work

### Negative

1. **Plugin Dependency:** Requires Native Instruments Guitar Rig 7 and Line 6 Helix Native licenses
2. **Migration Path:** Existing sessions using Audio Effect Racks will need to reload devices
3. **Configuration Complexity:** Dual matching (className + name) required for AU plugins with generic class names

## Implementation Notes

### Device Name Matching

AU plugin devices require **dual matching** because:
- `className`: Always `AuPluginDevice` (generic for all AU plugins)
- `name`: Actual plugin name (e.g., "Guitar Rig 7 MFX", "Helix Native")

This prevents false positives when multiple AU plugins exist on the same track.

### Parameter Indexing

- **Parameter 1:** Always used for main drive/gain control
- **Parameters 2+:** Available for future extended controls in central views
- **Index 0:** Typically device bypass (not exposed in UI)

### State Message Flow

1. User switches to track with guitar/bass device
2. Max4Live queries parameter 1 from device-configs.json
3. Complete state message includes: `[trackIndex, deviceCount, deviceId, deviceIndex, "Guitar Rig 7 MFX", "AuPluginDevice", paramIndex, paramValue, ...]`
4. Frontend parses and caches parameter values
5. UI controls display correct initial values

### Future Enhancements

**Guitar Rig 7 Extended Controls (future):**
- EQ controls (bass, mid, treble)
- Cabinet selection
- Effects chain toggles (comp, delay, reverb)
- Presence and resonance

**Helix Native Extended Controls (future):**
- Amp model selection
- Cabinet IR selection
- Effects chain (gate, comp, drive, EQ)
- Output level and tone shaping

**Implementation Path:**
1. Add parameters 2-N to device-configs.json
2. Update central views with DeviceVerticalSlider components
3. Regenerate Max configuration
4. Test parameter synchronization

## References

- **FX Grid Layout:** `interface/src/lib/config/fxGridLayout.ts`
- **Device Presets:** `interface/src/lib/config/devicePresets.ts`
- **Device Configs:** `data/device-configs.json`
- **Guitar Control:** `interface/src/lib/components/v6/device-panel/GuitarControl.svelte`
- **Bass Control:** `interface/src/lib/components/v6/device-panel/BassControl.svelte`
- **Guitar Central View:** `interface/src/lib/components/v6/central/views/GuitarCentralView.svelte`
- **Bass Central View:** `interface/src/lib/components/v6/central/views/BassCentralView.svelte`
- **Adding Device Guide:** `documentation/adding-device-guide.md`

## Related Work

- **ADR 052:** FX Grid Device Reorganization - Established guitar/bass slots
- **ADR 095:** Position-Based FX Grid Architecture - Decoupled grid positions from device types
- **ADR 088:** Virtual Device Slots for Central Views - Pattern for extended device controls
