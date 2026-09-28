# ADR 055: Centralize Transpose Configuration in constants.json

**Status**: Accepted
**Date**: 2025-10-16
**Deciders**: System Architecture

## Context

The octave/transpose system handles different instrument types with varying parameter mappings and shift amounts:

- **Standard drum racks**: Parameter 4, ±16 units per octave
- **Komplete Kontrol drum racks**: Parameter 16, ±21 units per octave
- **Instrument racks**: Parameter 8, ±12 semitones per octave

These configuration values were **hardcoded in multiple locations**:

1. TypeScript service layer ([clipOperations.ts](../../interface/src/lib/services/clipOperations.ts))
2. Max4Live sequencer device ([sequencer-device.js](../../Vamp Devices/sequencer-device.js))
3. Documentation ([sequencer-device-README.md](../../Vamp Devices/sequencer-device-README.md))

This violated the project's architectural principle stated in CLAUDE.md:

> **IMPORTANT:** Use `config/constants.json` for all project-wide configuration values (paths, timing, OSC ports). This is the single source of truth used by Python, TypeScript, and Max/MSP. Never hardcode these values - always import from constants.json.

## Problem

**Duplication Issues**:
- Changes required updates in 2+ files
- Risk of inconsistency between TypeScript and Max4Live
- No single source of truth
- Difficult to maintain and understand

**Scaling Issues**:
- Manual transpose buttons were passing semitones directly instead of using device-specific shift amounts
- Standard drum rack: +12 button moved parameter by 12 instead of 16
- KK drum rack: +12 button moved parameter by 12 instead of 21

## Decision

**Centralize all transpose configuration in `config/constants.json`**:

```json
{
  "instruments": {
    "description": "Instrument-specific configuration for transpose/octave operations",
    "transpose": {
      "instrumentRack": {
        "parameterIndex": 15,
        "shiftAmount": 12,
        "description": "Instrument rack transpose: parameter 15 (macro 15), ±12 semitones per octave"
      },
      "drumRackStandard": {
        "parameterIndex": 4,
        "shiftAmount": 16,
        "description": "Standard drum rack transpose: parameter 4 (macro 4), ±16 units per octave. Detected by macro names 'FX1' and 'FX2'."
      },
      "drumRackKompleteKontrol": {
        "parameterIndex": 16,
        "shiftAmount": 21,
        "description": "Komplete Kontrol drum rack transpose: parameter 16 (macro 16), ±21 units per octave. Uses absolute positioning."
      }
    }
  }
}
```

## Implementation

### 1. TypeScript ([clipOperations.ts](../../interface/src/lib/services/clipOperations.ts))

**Import config**:
```typescript
import constants from '../../../../config/constants.json';
const TRANSPOSE_CONFIG = constants.instruments.transpose;
```

**Scale semitones to device-specific units**:
```typescript
async function transposeMIDIClip(ctx: ClipContext, semitones: number): Promise<void> {
  // Standard drum rack: scale semitones to device units
  if (ctx.instrumentType === 'drumrack' && ctx.deviceIndex !== null) {
    const shiftAmount = (semitones / 12) * TRANSPOSE_CONFIG.drumRackStandard.shiftAmount;
    await adjustDrumRackTranspose(ctx.trackIndex, ctx.deviceIndex, shiftAmount);
    return;
  }

  // KK drum rack: scale semitones to device units
  if (ctx.instrumentType === 'drumrack-komplete-kontrol' && ctx.deviceIndex !== null) {
    const shiftAmount = (semitones / 12) * TRANSPOSE_CONFIG.drumRackKompleteKontrol.shiftAmount;
    await adjustDeviceParameter(
      ctx.trackIndex,
      ctx.deviceIndex,
      TRANSPOSE_CONFIG.drumRackKompleteKontrol.parameterIndex,
      shiftAmount
    );
    return;
  }
}
```

**Use config in parameter access**:
```typescript
async function adjustDrumRackTranspose(trackIndex, deviceIndex, amount) {
  const paramIndex = TRANSPOSE_CONFIG.drumRackStandard.parameterIndex;
  // Query and set parameter using paramIndex
}

async function adjustInstrumentRackTranspose(trackIndex, deviceIndex, semitones) {
  const paramIndex = TRANSPOSE_CONFIG.instrumentRack.parameterIndex;
  // Query and set parameter using paramIndex
}
```

### 2. Max4Live JavaScript ([sequencer-device.js](../../Vamp Devices/sequencer-device.js))

**Load config on initialization** (no ES6 import support):
```javascript
let TRANSPOSE_CONFIG = null;

const loadConfig = () => {
  try {
    const configPath = "/Users/Shared/DevWork/GitHub/Looping/config/constants.json";
    const f = new File(configPath, "read");
    if (f.isopen) {
      let configText = "";
      while (f.position < f.eof) {
        configText += f.readline();
      }
      f.close();
      const config = JSON.parse(configText);
      TRANSPOSE_CONFIG = config.instruments.transpose;
      post("[Sequencer] ✓ Loaded transpose config from constants.json\n");
    } else {
      // Fallback to hardcoded values
      TRANSPOSE_CONFIG = {
        instrumentRack: { parameterIndex: 15, shiftAmount: 12 },
        drumRackStandard: { parameterIndex: 4, shiftAmount: 16 },
        drumRackKompleteKontrol: { parameterIndex: 16, shiftAmount: 21 }
      };
    }
  } catch (e) {
    // Same fallback on error
  }
};

loadConfig();
```

**Use config in instrument detection**:
```javascript
SequencerDevice.prototype.detectInstrumentType = function() {
  // ...
  if (isInstrumentRack) {
    this.drumRackTransposeParam = TRANSPOSE_CONFIG.instrumentRack.parameterIndex;
    this.drumRackTransposeShift = TRANSPOSE_CONFIG.instrumentRack.shiftAmount;
  }

  if (isDrumRack) {
    if (macro1Name === "FX1" && macro2Name === "FX2") {
      this.drumRackTransposeParam = TRANSPOSE_CONFIG.drumRackStandard.parameterIndex;
      this.drumRackTransposeShift = TRANSPOSE_CONFIG.drumRackStandard.shiftAmount;
    } else {
      this.drumRackTransposeParam = TRANSPOSE_CONFIG.drumRackKompleteKontrol.parameterIndex;
      this.drumRackTransposeShift = TRANSPOSE_CONFIG.drumRackKompleteKontrol.shiftAmount;
    }
  }
};
```

### 3. Documentation ([sequencer-device-README.md](../../Vamp Devices/sequencer-device-README.md))

Updated to reference config file:

```markdown
**Configuration**: All parameter indices and shift amounts are loaded from
`/config/constants.json` (single source of truth). The device falls back to
safe defaults if the config file cannot be read.
```

## Consequences

### Positive

✅ **Single source of truth** - All transpose parameters defined in one location
✅ **Correct scaling** - Manual transpose buttons now use proper device-specific shift amounts:
  - Standard drum rack: +12 → +16 units
  - KK drum rack: +12 → +21 units
  - Instrument rack: +12 → +12 semitones (direct)
✅ **Follows project architecture** - Adheres to CLAUDE.md rule about using constants.json
✅ **Self-documenting** - Config includes descriptions for each instrument type
✅ **Safe fallbacks** - Max4Live device works even if config unavailable
✅ **Easy maintenance** - Change once, applies everywhere
✅ **Type safety** - TypeScript validates config structure at compile time

### Negative

⚠️ **Runtime dependency** - Max4Live device reads file at initialization (but has fallback)
⚠️ **Absolute path** - Config path is hardcoded to `/Users/Shared/DevWork/GitHub/Looping/config/constants.json`
⚠️ **No hot reload** - Changes require reloading Max4Live device

### Neutral

ℹ️ **ES6 limitation** - Max4Live v8 supports ES6 syntax but NOT ES6 modules (import/export)
ℹ️ **File I/O** - Must use Max's `File` API to read JSON
ℹ️ **Scaling logic** - TypeScript must convert semitones to device-specific units:
  ```typescript
  shiftAmount = (semitones / 12) * config.shiftAmount
  ```

## Notes

### Why Different Shift Amounts?

Different Ableton Live devices map their transpose macros differently:

- **Instrument Rack**: Direct semitone mapping (parameter 15, 0-127 range, 64=center)
- **Standard Drum Rack**: Custom unit scaling (parameter 4, ±16 units ≈ octave shift)
- **KK Drum Rack**: Different custom scaling (parameter 16, ±21 units ≈ octave shift)

The shift amounts were empirically determined to produce musically correct octave transposition for each device type.

### Detection Method

Drum rack type detection uses macro name inspection (ADR 006):
- **Standard**: `macro1 === "FX1" && macro2 === "FX2"`
- **Komplete Kontrol**: Custom-mapped macro names

### Future Considerations

If more instrument types are added, extend the config:
```json
{
  "instruments": {
    "transpose": {
      "newInstrumentType": {
        "parameterIndex": N,
        "shiftAmount": M,
        "description": "..."
      }
    }
  }
}
```

## Related ADRs

- **ADR 006**: Max4Live Parameter Names - Establishes macro name detection pattern
- **ADR 037**: Constants Centralization Hybrid - Project-wide config strategy

## References

- [config/constants.json](../../config/constants.json)
- [clipOperations.ts](../../interface/src/lib/services/clipOperations.ts)
- [sequencer-device.js](../../Vamp Devices/sequencer-device.js)
- [sequencer-device-README.md](../../Vamp Devices/sequencer-device-README.md)
