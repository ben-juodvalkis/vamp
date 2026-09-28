# ADR 042: Device Configuration Completeness Requirement

**Date:** 2025-10-12
**Status:** Implemented
**Context:** Complete State Architecture dependency

## Problem

The complete state architecture requires Max to know which parameters to query for each device. Without complete configurations:
- Max queries no parameters (missing config)
- Frontend Map is empty for that device
- Components show default values
- UI doesn't update on track switch
- User interaction sends to Ableton but UI never reflects stored state

## Decision

**ALL devices used in the system MUST have complete configurations** in `data/device-configs.json`.

## Configuration Requirements

### Every Device Must Define:

1. **Device identification**
   - Exact className (e.g., "AutoFilter2", "AuPluginDevice")
   - For plugins: className:deviceName format (e.g., "AuPluginDevice:Zebrify")

2. **All UI-controlled parameters**
   - Parameter index
   - Display name
   - Min/max range
   - Data type (int/float)

3. **Metadata**
   - UI component reference
   - Colors
   - Insertion info (preset path, category, description)

### Current Coverage

**23 Device Types, 115 Parameters:**

**FX Grid Devices (14):**
- Delay (4 params)
- AutoFilter2 (9 params)
- Saturator (4 params)
- StereoGain (1 param)
- Pedal (4 params)
- AutoPan2 (4 params)
- Compressor2 (1 param)
- DrumBuss (7 params)
- ChannelEq (4 params)
- Redux (1 param)
- AuPluginDevice:Zebrify (3 params)
- AuPluginDevice:Saturn 2 (2 params)
- AutoPan (legacy, 3 params)
- BeatRepeat (1 param)
- Hybrid Reverb (2 params)
- MidiArpeggiator (2 params)

**Instruments (5):**
- DrumGroupDevice (16 params)
- AuPluginDevice:Omnisphere (5 params)
- AuPluginDevice:Komplete Kontrol (4 params)
- OriginalSimpler (8 params)

**Middle Panel (1):**
- MxDeviceAudioEffect:Sequencer (22 params)

**Deprecated:**
- Shifter (5 params) - kept for reference
- Comb (3 params) - alias, covered by Zebrify

## Max Lookup Logic

**Device config lookup in liveAPI-v6.js:**

```javascript
// Try className:deviceName first (for plugins)
var lookupKey = deviceClass + ":" + deviceName;
var paramIndices = getDeviceParameters(lookupKey);

// Fallback to className only
if (paramIndices.length === 0) {
    paramIndices = getDeviceParameters(deviceClass);
}
```

**Examples:**
- "AuPluginDevice:Zebrify" → finds Zebrify config ✓
- "AutoFilter2:Auto Filter" → falls back to "AutoFilter2" ✓
- "Delay:Delay" → falls back to "Delay" ✓

## Config Generation

**Automated process:**
```bash
npm run generate:max-config
```

**Generates:** `ableton/scripts/device-configs.js` (Max-compatible JavaScript)

**From:** `data/device-configs.json` (single source of truth)

## Validation

**On startup, Max logs:**
```
✅ Device config loaded: 23 device types
```

**On track switch with unconfigured device:**
- Max queries 0 parameters
- Frontend logs: "0 parameters" in complete state
- UI shows defaults only

## Adding New Devices

### Process:

1. **Add to device-configs.json:**
```json
"DeviceClassName": {
  "parameters": {
    "1": {
      "index": 1,
      "name": "Parameter Name",
      "displayName": "Display",
      "min": 0,
      "max": 1,
      "dataType": "float"
    }
  },
  "enhanced": true,
  "ui": { "component": "DeviceUI", "layout": "compact" },
  "insertion": {
    "displayName": "Device Name",
    "category": "Audio Effects",
    "description": "What it does",
    "recommended": true,
    "presetPath": "/path/to/preset.adv"
  },
  "colors": { "primary": "#color", "secondary": "#color" }
}
```

2. **Regenerate:** `npm run generate:max-config`

3. **Reload Max device** in Ableton (or restart Ableton)

4. **Test:** Track switch should show correct parameter values

### Finding Parameter Indices

**In Ableton Live:**
1. Add device to track
2. Open Max console
3. Query: `live_set tracks 0 devices 0 parameters`
4. Note which indices control which UI elements
5. Add to config

## Lessons Learned

### Discovery During Phase 5

Initially had only **4 devices partially configured** (Delay, AutoFilter2, etc. with minimal params).

**Missing:**
- AutoFilter: Filter type, slope, LFO shape, morph (5 params missing!)
- Comb/Zebrify: All params (device not configured)
- Saturn 2: All params
- Reverb/Hybrid: All params
- BeatRepeat, AutoPan, MidiArpeggiator: All params
- Sequencer: All 22 params

**Impact:** Spent hours debugging "why doesn't UI update" before realizing params weren't in complete state because configs were incomplete!

## Requirements Going Forward

**Before adding device to FX Grid:**
1. ✅ Add complete config to device-configs.json
2. ✅ Regenerate max-config
3. ✅ Test in Ableton with complete state
4. ✅ Verify UI updates on track switch

**No shortcuts.** Incomplete configs = broken UI.

## Future: Unified Configuration

**Current duplication:**
- `devicePresets.ts` - UI config (slots, colors, preset paths)
- `device-configs.json` - Parameter config

**Should be:** Single source defining everything

**Deferred:** Larger refactor, out of scope for Phase 5

## Related

- ADR-040: Complete State Architecture
- ADR-041: Component State Management Pattern
- ADR-028: Project Constants File (single source of truth principle)
