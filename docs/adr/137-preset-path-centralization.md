# ADR 137: Preset Path Centralization and Migration

**Status:** Implemented
**Date:** 2025-11-28
**Context:** Presets folder moved to Ableton User Library location

## Problem

The project's preset files were scattered across different locations with hardcoded paths throughout the codebase:

1. **Old location:** `/Users/Shared/DevWork/GitHub/Looping/ableton/Presets`
2. **Hardcoded paths** in multiple files:
   - `data/device-configs.json` (25+ device preset paths)
   - Various scripts and adapters
3. **No centralized configuration** for MIDI effect presets
4. **Mixed use** of `constants.json` - some files used it, others had hardcoded paths

This made it:
- Difficult to reorganize preset folders
- Error-prone when paths needed updating
- Hard to share project across different systems

## Decision

### 1. Migrate Presets to Ableton User Library

**New base location:**
```
/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Looping Presets
```

This follows Ableton's standard User Library convention and makes presets:
- Discoverable in Ableton's browser
- Properly organized alongside other Ableton content
- Easier to backup with standard Ableton workflows

### 2. Add New Configuration Constants

Updated `config/constants.json` with:

```json
{
  "paths": {
    "loopingPresetsBase": "/Users/Shared/.../Looping Presets",
    "audioBrowserBase": ".../Looping Presets/Audio Samples",
    "instrumentsBase": ".../Looping Presets/Instruments",
    "omnisphereSource": ".../Looping Presets/Omnisphere Source",
    "effectPresetsBase": ".../Looping Presets/Effect Patches",
    "midiEffectPresetsBase": ".../Looping Presets/MIDI Effect Patches",
    "emptyPresets": {
      "drumRack": ".../Empty Patches/Empty Drum Rack.adg",
      "omnisphere": ".../Empty Patches/Omnisphere.aupreset",
      "kompleteKontrol": ".../Empty Patches/Komplete Kontrol.aupreset",
      "niDrum": ".../Empty Patches/NI Drum.adg"
    }
  }
}
```

### 3. Update All Device Preset Paths

Updated `data/device-configs.json` with new absolute paths for all 25+ devices:
- Echo, Auto Filter, Compressor, etc.
- Guitar Rig, Helix Native (audio browser presets)
- Drum Rack, Wah, Pitch-Helix
- Arpeggiator (moved from MIDI Effect Patches to Effect Patches)

### 4. Maintain Dual constants.json Files

Both files updated identically:
- `config/constants.json` (primary)
- `interface/static/config/constants.json` (static copy for frontend)

## Files Updated

### Configuration Files
1. **`config/constants.json`** - Added `loopingPresetsBase`, `midiEffectPresetsBase`, updated all preset paths
2. **`interface/static/config/constants.json`** - Mirrored changes

### Device Configurations
3. **`data/device-configs.json`** - Updated 25+ `presetPath` entries

### Max4Live Scripts (Hardcoded Paths Required)
4. **`ableton/scripts/liveAPI-v6.js`** - Updated 7 hardcoded preset paths:
   - Wah device (line 1934)
   - Guitar device (lines 1957, 3439)
   - Bass device (lines 1979, 3444)
   - Vocal device (lines 2001, 3449)

   *Note: Max4Live JavaScript cannot easily import JSON files, so paths must be hardcoded.*

### Track Type Configurations
5. **`config/trackTypes.json`** - Updated 3 effect preset paths:
   - Vocal.adg effect (mic track type)
   - Bass.adg effect (bass track type)
   - Piano Reverb.adv effect (keys track type)

   *Note: JSON data files cannot reference constants.json, so paths must be hardcoded.*

### Already Using Constants (No Changes Needed)
- `scripts/generate-instruments-json.ts` - Uses `constants.paths.instrumentsBase`
- `interface/src/lib/config/devicePresets.ts` - Uses `constants.paths.effectPresetsBase`

## Implementation Details

### Path Structure

```
Looping Presets/
├── Audio Samples/          # Audio browser clips
├── Effect Patches/         # All effect and MIDI effect presets
├── Empty Patches/          # Empty device templates
├── Instruments/           # Instrument presets (Drums, Omni, Samples, Tonal)
└── Omnisphere Source/     # Omnisphere category organization
```

### Why Effect Patches Contains MIDI Effects

The Arpeggiator MIDI effect preset was found in `Effect Patches/` rather than a separate `MIDI Effect Patches/` folder. We preserved this organization rather than restructuring, as:
- The preset already exists at this location
- Ableton doesn't strictly enforce separation of MIDI vs Audio effect presets
- The `midiEffectPresetsBase` constant is available for future use if needed

### Why Some Files Must Use Hardcoded Paths

**Max4Live Scripts (`liveAPI-v6.js`):**
- Max's JavaScript environment lacks Node.js-style module loading (`require()`, `import`)
- Cannot easily read/parse external JSON files
- Workarounds (Dict objects, shell commands) add complexity and failure points
- Paths rarely change after migration, so hardcoding is pragmatic

**JSON Data Files (`trackTypes.json`):**
- JSON format cannot reference or import other JSON files
- File is copied to `interface/static/data/` for SvelteKit build
- Must contain complete, self-contained data

**TypeScript/JavaScript Build Scripts:**
- These CAN and DO use `constants.json` via standard imports
- Examples: `generate-instruments-json.ts`, `devicePresets.ts`
- Automatically pick up path changes when constants are updated

## Consequences

### Positive
✅ **Single source of truth** for all preset paths via `constants.json`
✅ **Presets in standard Ableton location** - discoverable in Ableton browser
✅ **Easy reorganization** - update constants.json, regenerate JSON
✅ **Better shareability** - can use relative paths from User Library
✅ **Automatic updates** - scripts that already used constants.json work immediately

### Neutral
- Requires `npm run dev` to regenerate instrument JSON after path changes
- Must keep both `constants.json` files in sync

### Negative
- Some files require hardcoded paths (Max4Live scripts, JSON data files)
- Breaking change for anyone with custom preset locations
- Must update paths in multiple files if location changes again (though this is rare)

## Migration Steps

1. ✅ Move presets from `ableton/Presets` to User Library location
2. ✅ Update `config/constants.json` with new base paths
3. ✅ Update `interface/static/config/constants.json` to match
4. ✅ Update all device preset paths in `data/device-configs.json`
5. ✅ Run `npm run dev` to regenerate instrument JSON files
6. ✅ Verify browser shows correct paths in console

## Future Improvements

1. **Relative paths in device-configs.json** - Would require changes to how Max/MSP loads the config
2. **Path validation script** - Verify all configured paths exist
3. **Symlink support** - Allow symlinking preset folders for easier development

## Related

- **ADR 136:** Unified Preset Browser Architecture
- **ADR 103:** Configuration Management and Shareability
- **`scripts/generate-instruments-json.ts`** - Uses instrumentsBase constant
- **`interface/src/lib/config/devicePresets.ts`** - Uses effectPresetsBase constant
