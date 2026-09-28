# ADR 448: Name-Based Transpose Parameter Detection

**Status:** Implemented (Updated 2025-11-27)
**Date:** 2025-11-24
**Author:** Claude + User
**Related:** ADR 110 (Sequencer v3.0 Refactor), ADR 064 (Centralize Transpose Configuration)

**Update 2025-11-27:** UI transpose buttons now also use name-based detection (V5.0)

## Context

The sequencer device v3.0 used hardcoded parameter indices to control pitch transposition on drum/instrument racks:

```javascript
// v3.0 approach
"drumRackStandard": { "parameterIndex": 4, "shiftAmount": 16 },
"drumRackKompleteKontrol": { "parameterIndex": 16, "shiftAmount": 21 }
```

This created several problems:

1. **Fragility**: Reordering macros in a rack would break the pitch sequencer
2. **Indirect detection**: Had to check macro names ("FX1", "FX2") to determine rack type
3. **Maintenance overhead**: Different rack templates required separate config entries
4. **Coupling**: Type detection logic was tightly coupled to specific rack layouts

### The Insight

The macro **name already encodes the behavior needed**:

| Knob Name | Instrument Type | Shift Amount |
|-----------|-----------------|--------------|
| `Custom E` | Komplete Kontrol | 21 units |
| `Pitch` | Standard racks | 16 units |
| `Transpose` | Standard racks | 16 units |
| `Octave` | Standard racks | 16 units |
| `Tune` | Standard racks | 16 units |

Users naturally name their transpose macros with recognizable terms. We can leverage this convention instead of fighting it with hardcoded indices.

## Decision

**Scan device parameters by name instead of index.** The parameter name determines both:
1. Which parameter to control
2. What shift amount to use

### Implementation Details

#### 1. Configuration (constants.json)

Replace index-based config with priority-ordered name array:

```json
{
  "instruments": {
    "transpose": {
      "parameterNames": [
        { "name": "custom e", "shiftAmount": 21 },
        { "name": "pitch", "shiftAmount": 16 },
        { "name": "transpose", "shiftAmount": 16 },
        { "name": "octave", "shiftAmount": 16 },
        { "name": "tune", "shiftAmount": 16 }
      ],
      "defaultShiftAmount": 12
    }
  }
}
```

Array order = priority order (Custom E checked first).

#### 2. Name-Based Scanner

New function `findTransposeParameterByName()`:

```javascript
// Scan all device parameters for known names
for (var i = 0; i < paramCount; i++) {
    var param = getDeviceParameter(device, i);
    var name = param.get("name")[0].toLowerCase();
    if (nameLookup[name]) {
        matches[name] = { index: i, param: param };
    }
}

// Return highest priority match
for (var name in priorityOrder) {
    if (matches[name]) {
        return {
            param: matches[name].param,
            shiftAmount: config.shiftAmount,
            name: name
        };
    }
}
```

**Properties:**
- Case-insensitive: "Custom E" = "custom e"
- Exact match only: "Pitch Shift" won't match "Pitch"
- Priority-based: Returns first match from config array
- Caching: Scans once on device load, not per-step

#### 3. Unified Strategy Pattern

Collapsed three nearly-identical classes into one:

**Before:**
- `DrumRackStandardStrategy`
- `DrumRackKKStrategy`
- `InstrumentRackStrategy`

**After:**
- `TransposeStrategy` (unified)
- `DefaultInstrumentStrategy` (note-based fallback)

The strategy constructor now accepts the parameter API object and shift amount directly:

```javascript
function TransposeStrategy(device, transposeParam, shiftAmount, paramName) {
    this.transposeParam = transposeParam;  // API object, not index
    this.shiftAmount = shiftAmount;        // from name lookup
    this.paramName = paramName;            // for debug logging
}
```

#### 4. Simplified Detection

**Before (v3.0):**
```javascript
// Detect type (drum_rack_standard/KK/instrument_rack)
var result = InstrumentDetector.detectInstrumentType(track);
var config = InstrumentDetector.configureTranspose(result.type);
// Create type-specific strategy
if (result.type === 'drum_rack_standard') {
    strategy = new DrumRackStandardStrategy(...);
} else if (result.type === 'drum_rack_komplete_kontrol') {
    strategy = new DrumRackKKStrategy(...);
}
```

**After (v4.0):**
```javascript
// Just find instrument device
var result = InstrumentDetector.findInstrumentDevice(track);
// Scan for transpose parameter by name
var transposeResult = findTransposeParameterByName(result.device);
if (transposeResult) {
    strategy = new TransposeStrategy(
        result.device,
        transposeResult.param,
        transposeResult.shiftAmount,
        transposeResult.name
    );
}
```

#### 5. New Instrument Types

**v3.0 types (removed):**
- `'drum_rack_standard'`
- `'drum_rack_komplete_kontrol'`
- `'instrument_rack'`

**v4.0 types (simplified):**
- `'parameter_transpose'` - device has named transpose parameter
- `'note_transpose'` - no parameter found, use MIDI note modification
- `'unknown'` - no instrument device on track

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Case sensitivity | Case-insensitive | "Custom E" = "custom e" (user friendly) |
| Partial matching | No | Exact match only (avoid false positives) |
| Priority order | Custom E first | KK needs 21-unit shift, check first |
| When to scan | Device load | Cache result, don't re-scan per-step |

## Consequences

### Positive

1. **Flexibility**: Users can reorder rack macros freely
2. **Self-documenting**: Macro name defines behavior (no hidden coupling)
3. **Extensibility**: Add new parameter names by editing config
4. **Simplicity**:
   - Removed ~70 lines (InstrumentDetector methods)
   - Removed ~70 lines (duplicate strategy classes)
   - Single unified strategy for all devices
5. **Maintainability**: No type-specific code branches

### Negative

1. **Naming convention required**: Racks must use recognized parameter names
2. **Scan overhead**: Must read all parameter names on device load (one-time cost)
3. **Breaking change for non-standard racks**: If a rack has transpose at index 4 but named "MyCustomKnob", pitch sequencer won't find it

### Neutral

1. **Two transpose paths still exist**:
   - Parameter-based (drum/instrument racks with named macro)
   - Note-based (synths without transpose macro)
2. **State format unchanged**: Backward compatible with v3.0 saved state
3. **~~UI still uses hardcoded indices~~** (DEPRECATED as of V5.0 - see update below)
4. **Track type query dependency**: UI transpose functions depend on `trackType` being populated by AbletonOSC queries (`/live/track/get/has_midi_input`, `/live/track/get/has_audio_input`). These queries are sent automatically when tracks are selected, with typical response time <100ms. The `trackType` check is essential for preventing incorrect transpose operations on audio tracks.

## Migration Path

### For Users

**Existing racks with correct naming:** Work automatically

**Racks with non-standard names:** Rename the transpose macro to:
- "Custom E" (for Komplete Kontrol - 21-unit shift)
- "Pitch", "Transpose", "Octave", or "Tune" (standard - 16-unit shift)

### For Developers

1. Rebuild Max device (sequencer-device.js → Sequencer.amxd)
2. Test with various rack types
3. Update any documentation referencing macro positions

## V5.0 Update: UI Transpose Buttons (2025-11-27)

The original V4.0 implementation left the UI transpose buttons (+12/-12) using hardcoded indices in `UI_TRANSPOSE_CONFIG`. This was deemed a temporary solution due to perceived limitations of the AbletonOSC protocol.

### The Problem

Section 6 "UI Transpose Buttons" documented this as necessary:

> The UI layer cannot use name-based scanning because AbletonOSC queries require parameter indices upfront (unlike the Max device which can scan at runtime).

However, this was **incorrect**. The UI layer **does have access to parameter names** through `selectedTrackStore.getParameterNames()`, which caches parameter names from the complete state message.

### V5.0 Solution

Refactored `clipOperations.ts` to use **the same name-based approach as the sequencer device**:

#### 1. New `findTransposeParameter()` Function

TypeScript equivalent of the Max device's scanner:

```typescript
async function findTransposeParameter(deviceId: number): Promise<TransposeParamInfo | null> {
    // Check cache first - cache is valid only for the same device ID
    if (cachedDeviceId === deviceId && cachedTransposeParam) {
        return cachedTransposeParam;
    }

    // Get parameter names from selectedTrackStore (already cached from complete state)
    const paramNames = await selectedTrackStore.getParameterNames(deviceId);

    // Build lookup map and scan for matches (same algorithm as Max device)
    // ... returns first match based on priority order from config
}
```

#### 2. Unified `adjustDeviceParameterRelative()` Function

Replaced three type-specific functions with one unified function:

**Before V5.0:**
- `adjustDrumRackTranspose()` - hardcoded index 4
- `adjustKKDrumRackTranspose()` - hardcoded index 16
- `adjustInstrumentRackTranspose()` - hardcoded index 16

**After V5.0:**
- `adjustDeviceParameterRelative()` - uses index from name-based scanning

#### 3. Updated `transposeDevice()` and `transposeMIDIClip()`

Both functions now:
1. Get device ID from `selectedTrackStore.devices`
2. Call `findTransposeParameter(deviceId)` to scan for transpose macro
3. Use the returned index and shift amount
4. Call unified `adjustDeviceParameterRelative()`

#### 4. Cache Strategy

- Cache keyed by `deviceId`
- Automatically invalidates when device changes (different `deviceId`)
- No reactive watchers needed (can't use `$effect` in `.ts` files)
- Cache populated on first transpose operation per device

### Code Impact

**Removed:**
- `UI_TRANSPOSE_CONFIG` (hardcoded indices)
- `getShiftAmountForInstrument()` (type-based lookup)
- ~200 lines of type-specific functions

**Added:**
- `findTransposeParameter()` (~60 lines)
- `adjustDeviceParameterRelative()` (~50 lines)
- Caching system (~20 lines)

**Net:** ~70 lines removed, cleaner architecture

### Benefits of V5.0

1. ✅ **Single source of truth** - Both Max and UI use same config
2. ✅ **Flexible macro positioning** - Works regardless of macro order
3. ✅ **Easy to extend** - Adding "Tune" required only config change
4. ✅ **Self-documenting** - Macro name defines behavior
5. ✅ **Cached for performance** - Scans once per device
6. ✅ **Automatic cleanup** - Cache invalidates on device change

### Testing V5.0

All UI transpose operations now use name-based detection:
- [x] Drum rack with "Pitch" at any index → works
- [x] Drum rack with "Tune" at any index → works ✨ NEW
- [x] KK drum rack with "Custom E" at any index → works
- [x] Instrument rack with "Transpose" at any index → works
- [x] Rack without recognized name → shows helpful error

## Alternatives Considered

### 1. Keep Index-Based, Add Name Fallback

**Pros:** Backward compatible, works with both approaches
**Cons:** Maintains complexity, doesn't solve fragility

### 2. User Configuration (UI for mapping)

**Pros:** Maximum flexibility
**Cons:** Added UI complexity, most users want "it just works"

### 3. Scan for Any Transpose-Related Name

**Pros:** More forgiving
**Cons:** False positives ("Pitch Decay", "Transpose Mode")

#### 6. UI Transpose Buttons

The config structure change broke the UI transpose buttons (+12/-12 in the middle panel). The UI layer cannot use name-based scanning because AbletonOSC queries require parameter indices upfront (unlike the Max device which can scan at runtime).

**Solution:** Created `UI_TRANSPOSE_CONFIG` with hardcoded indices:

```typescript
const UI_TRANSPOSE_CONFIG = {
    drumRackStandard: {
        parameterIndex: 4,  // Standard Ableton drum rack transpose macro
        shiftAmount: 16     // 16 units = 1 octave
    },
    drumRackKK: {
        parameterIndex: 16, // Komplete Kontrol custom macro position
        shiftAmount: 21     // 21 units = 1 octave (KK scaling)
    },
    instrumentRack: {
        parameterIndex: 16, // Instrument rack transpose macro
        shiftAmount: 16     // 16 units = 1 octave
    }
};
```

This maintains the UI's ability to directly control transpose parameters while the backend uses flexible name-based detection.

**Track Type Query Dependency:**

The UI transpose functions require `trackType` to be set by AbletonOSC queries. When a track is selected, the session store automatically sends:
- `/live/track/get/has_midi_input [trackIndex]`
- `/live/track/get/has_audio_input [trackIndex]`

The responses populate `session.selectedTrackType`, which is used by `transposeDevice()` to verify it's operating on a MIDI track. This check is essential for correctness - audio tracks and MIDI tracks have fundamentally different transpose mechanisms.

**Why the check matters:**
- Audio clips: Use `pitch_coarse` parameter (±48 semitones)
- MIDI tracks: Adjust device parameters or modify note data
- The `trackType !== 'midi'` check prevents attempting device parameter operations on audio tracks

The system works as designed once track selection triggers the queries (typically <100ms delay).

## Implementation

- **Files Changed:**
  - `config/constants.json` - New parameter name config
  - `ableton/M4L devices/sequencer-device.js` - Core logic (name-based scanning)
  - `interface/src/lib/services/clipOperations.ts` - UI transpose buttons (index-based)
  - `interface/static/config/constants.json` - Interface copy (kept in sync)

- **Functions Added:**
  - V4.0: `findTransposeParameterByName()` - Parameter scanner (Max device)
  - V4.0: `TransposeStrategy()` - Unified strategy class (Max device)
  - V4.0: `adjustKKDrumRackTranspose()` - KK drum rack transpose (UI) **[DEPRECATED in V5.0]**
  - V4.0: `getShiftAmountForInstrument()` - Helper for shift amount lookup (UI) **[REMOVED in V5.0]**
  - V5.0: `findTransposeParameter()` - Name-based scanner (UI TypeScript)
  - V5.0: `adjustDeviceParameterRelative()` - Unified parameter adjuster (UI)

- **Functions Removed:**
  - V4.0: `InstrumentDetector.detectInstrumentType()`
  - V4.0: `InstrumentDetector.checkDrumRackType()`
  - V4.0: `InstrumentDetector.configureTranspose()`
  - V4.0: `DrumRackStandardStrategy`
  - V4.0: `DrumRackKKStrategy`
  - V4.0: `InstrumentRackStrategy`
  - V5.0: `adjustDrumRackTranspose()` (replaced by unified function)
  - V5.0: `adjustKKDrumRackTranspose()` (replaced by unified function)
  - V5.0: `adjustInstrumentRackTranspose()` (replaced by unified function)
  - V5.0: `getShiftAmountForInstrument()` (no longer needed)
  - V5.0: `UI_TRANSPOSE_CONFIG` (hardcoded indices removed)

- **Line Count:**
  - v3.0: 2048 lines (Max device)
  - v4.0: 2336 lines (Max device, +288 but -140 in detection/strategy code)
  - V4.0 clipOperations.ts: +104 lines (new functions with hardcoded indices)
  - V5.0 clipOperations.ts: -70 lines net (removed hardcoded config, unified functions)

## Testing Checklist

### Sequencer Device (Pitch Sequencer)
- [ ] Standard drum rack with "Pitch" macro (16-unit shift)
- [ ] Komplete Kontrol drum rack with "Custom E" macro (21-unit shift)
- [ ] Instrument rack with "Transpose" macro (16-unit shift)
- [ ] Synth without transpose macro (note-based fallback)
- [ ] Rack with transpose macro in non-standard position (should work)
- [ ] Rack without recognized name (should fall back to note-based)
- [ ] Temperature transformation interaction
- [ ] Transport stop cleanup

### UI Transpose Buttons (+12/-12 in Middle Panel)
- [ ] Standard drum rack: +12/-12 buttons shift by 1 octave
- [ ] Komplete Kontrol drum rack: +12/-12 buttons shift by 1 octave (21 units)
- [ ] Instrument rack: +12/-12 buttons shift by 1 octave (16 units)
- [ ] Audio clip: +12/-12 buttons adjust pitch_coarse parameter
- [ ] MIDI clip (melodic): +12/-12 buttons move notes in piano roll

## Future Enhancements

1. **~~Add more recognized names~~:** ✅ DONE - "Tune" added in V5.0
2. **Add even more names:** "Semitones", "Note", etc.
3. **User-configurable names:** Allow custom name → shift mappings
4. **Multi-parameter support:** Chain multiple transpose parameters
5. **Temperature parameter:** Apply same name-based detection to temperature

## References

- **Implementation Plan:** [documentation/current/name-based-transpose-detection.md](../current-project/name-based-transpose-detection.md)
- **v3.0 Architecture:** [ADR 110](110-sequencer-device-v3-refactor.md)
- **Config Centralization:** [ADR 064](064-centralize-transpose-configuration.md)
- **Device Code:** [sequencer-device.js](../../ableton/M4L%20devices/sequencer-device.js)
- **Configuration:** [constants.json](../../config/constants.json)

## Decision Rationale

Name-based detection aligns with user expectations (name = purpose) and eliminates fragile position-based coupling. The slight overhead of scanning parameter names is justified by:

1. Happens once per device load (not per-step)
2. Dramatically simplifies code architecture
3. Makes the system self-documenting
4. Enables flexible rack design

This represents a fundamental shift from "implicit detection via position" to "explicit declaration via naming", which is more maintainable and user-friendly.
