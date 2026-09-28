# ADR 050: Simpler to DrumCell Programmatic Conversion

**Status:** Accepted
**Date:** 2025-01-13
**Decision Makers:** System Architecture
**Tags:** #automation #ableton #drum-rack #xml-processing

## Context

Ableton Live provides a built-in "Convert Simpler to Drum Rack" function that transforms OriginalSimpler devices into DrumCell devices. This conversion is useful for:

1. **Performance optimization** - DrumCells are lighter-weight than Simplers
2. **Workflow consistency** - Standardizing drum rack devices
3. **Automation** - Batch processing multiple drum racks

However, there was no programmatic way to perform this conversion outside of manually using Ableton's GUI, which is time-consuming for large-scale operations.

### Technical Background

**Ableton Device Files (.adg/.adv):**
- Gzip-compressed XML files
- `.adg` = Device Group (Drum Rack)
- `.adv` = Individual Device (Simpler, DrumCell)

**Key Structural Differences:**

| Aspect | OriginalSimpler | DrumCell |
|--------|----------------|----------|
| **Complexity** | Multi-layer sampler with zones, velocity layers, round-robin | Single-sample drum pad |
| **Sample Structure** | `MultiSampleMap/MultiSamplePart/SampleRef` | `UserSample/Value/SampleRef` |
| **Envelope** | 7-stage ADSR (Attack, Decay, Sustain, Release + slopes/loops) | 4-stage AHDM (Attack, Hold, Decay, Mode) |
| **Playback Modes** | Classic (0), One-Shot (1), Slicing (2) | Trigger (0), Gate (1) |
| **Modulation** | Advanced matrix (6 MIDI CC slots, multiple connections) | Simple (single source/target/amount) |
| **Effects** | Modular slots (Filter, Shaper, Aux envelopes, LFOs) | Built-in effects (8 types via Effect_Type) |
| **XML Lines** | ~1,049 | ~590 |

## Decision

Implement a Python-based conversion system that replicates Ableton's native Simpler → DrumCell conversion with ~92% parameter accuracy.

### Implementation

**Created Three Scripts:**

1. **`simpler_to_drumcell.py`** - Convert individual Simpler devices
   - Input: Single `.adv` Simpler file
   - Output: `.adv` DrumCell file

2. **`drum_rack_simpler_to_drumcell.py`** - Batch convert all Simplers in a Drum Rack
   - Input: `.adg` Drum Rack file
   - Output: `.adg` Drum Rack with DrumCells
   - Automatically skips multi-sample Simplers (velocity layers)

3. **`batch_convert_drum_racks.py`** - Batch convert entire directories
   - Input: Directory containing `.adg` files
   - Output: Directory with converted files
   - Preserves folder structure
   - Options: dry-run, in-place, custom suffix

**Location:**
```
scripts/device-creation/python/conversion/
├── simpler_to_drumcell.py
├── drum_rack_simpler_to_drumcell.py
└── batch_convert_drum_racks.py
```

### Conversion Mapping

#### 1. Multi-Sample Detection (Critical!)
```python
# Check if Simpler has multiple zones/velocity layers
sample_parts = simpler.findall('.//MultiSamplePart')

if len(sample_parts) > 1:
    # SKIP: Multi-sample Simpler should NOT be converted
    # DrumCell only supports single samples
    # Example: Jazz kits with 8-16 velocity layers
    print(f"Skipping multi-sample Simpler ({len(sample_parts)} zones)")
    continue
```

**Why This Matters:**
- Multi-sample Simplers use velocity layers for realistic acoustic instruments
- Converting would lose all velocity layers except the first sample
- Examples: "32 Pad Kit Jazz" (8-16 zones per pad), Studio kits (12 zones)
- These MUST remain as Simplers to preserve their expressive capabilities

#### 2. Sample Reference Extraction
```python
# Simpler: Extract from first MultiSamplePart (or selected)
simpler: MultiSampleMap/SampleParts/MultiSamplePart[Selection=true]/SampleRef

# DrumCell: Map to UserSample
drumcell: UserSample/Value/SampleRef
```

#### 3. Basic Parameters
| Simpler Parameter | DrumCell Parameter | Scaling |
|-------------------|-------------------|---------|
| `Pitch/TransposeKey` | `Voice_Transpose` | Direct |
| `Pitch/TransposeFine` | `Voice_Detune` | Cents → Semitones (÷100) |
| `VolumeAndPan/Volume` | `Volume` | Direct |
| `VolumeAndPan/Panorama` | `Pan` | Direct |
| `VolumeAndPan/VolumeVelScale` | `Voice_VelocityToVolume` | Direct |
| `LoopModulators/SampleStart` | `Voice_PlaybackStart` | Direct |
| `LoopModulators/SampleLength` | `Voice_PlaybackLength` | Direct |

#### 4. Envelope Conversion
```python
# Attack: Convert milliseconds → seconds
attack_sec = simpler.AttackTime / 1000.0
attack_sec = clamp(0.0001, 20.0, attack_sec)

# Decay: Depends on PlaybackMode
if PlaybackMode == 1:  # One-Shot
    decay_sec = 1.0  # Ableton's default
elif SustainLevel >= 0.99:
    decay_sec = simpler.ReleaseTime / 1000.0
else:
    decay_sec = simpler.DecayTime / 1000.0

# Hold: Ableton's default
hold_sec = 0.3000001013

# Mode: Always Trigger (0) for drum samples
mode = 0
```

#### 5. Critical Attributes

**DrumCell `Id` Attribute:**
```python
# REQUIRED: Ableton won't load without Id attribute
drumcell.set('Id', simpler.get('Id', '0'))
```

**PresetRef DeviceId:**
```python
# Update PresetRef metadata
preset_ref.find('.//DeviceId').set('Name', 'DrumCell')
# (was 'OriginalSimpler')
```

### Multi-Sample Protection

**Automatic Detection:**
Simplers with multiple `MultiSamplePart` elements are automatically skipped to preserve:
- **Velocity layers** - Different samples triggered by velocity ranges
- **Key zones** - Different samples across keyboard ranges
- **Round-robin** - Sample rotation for natural variation

**Examples of Protected Multi-Samples:**
- "32 Pad Kit Jazz" - 8-16 velocity layers per pad
- "Studio Kits" - 12-16 velocity layers for realistic drums
- Any Simpler with 2+ MultiSamplePart zones

### Known Limitations

**Not Converted:**
- Simpler's modulation matrix → DrumCell has simpler modulation
- Effects in device slots → DrumCell uses built-in effects
- Warp/slice data → DrumCell doesn't support warping
- **Multi-sample Simplers** → Automatically skipped (preserved as-is)

**Minor Differences:**
- `VelocityToVolume`: Uses DrumCell default (0.35) instead of Simpler value
  - This matches Ableton's native conversion behavior

## Consequences

### Positive

✅ **Automation at scale** - Batch convert drum racks programmatically
✅ **High accuracy** - 12/13 parameters match Ableton's native conversion (92%)
✅ **Validated approach** - Tested against Ableton's manual conversion
✅ **Reusable components** - XML encode/decode utilities
✅ **Production ready** - Successfully loads in Ableton Live 12.3
✅ **Multi-sample protection** - Automatically preserves velocity-layered instruments
✅ **Batch processing** - 234 racks (2,948 Simplers) converted in 32.6 seconds

### Negative

⚠️ **XML format dependency** - Ableton could change format in future versions
⚠️ **No complex feature conversion** - Modulation matrix, warping, slicing lost
⚠️ **Manual testing required** - Each Ableton version should be validated

### Neutral

- Requires Python 3.x with `xml.etree.ElementTree` and `gzip` modules
- Uses existing `utils/decoder.py` and `utils/encoder.py`
- Compatible with Ableton Live 12.3 schema (may need updates for future versions)

## Validation

### Test Case 1: Single Drum Rack
**Input:** `donor simpler rack.adg` (4 single-sample Simplers)
**Output:** `converted drum rack FINAL.adg` (4 DrumCells)
**Result:** ✅ Successfully loads in Ableton Live 12.3b12

**Parameter Accuracy:**
- ✅ Sample paths (4/4)
- ✅ Transpose, Detune (4/4)
- ✅ Volume, Pan (4/4)
- ✅ Envelope (Attack, Hold, Decay, Mode) (4/4)
- ✅ Playback Start/Length (4/4)
- ✅ Filter On state (4/4)
- ⚠️ VelocityToVolume: Uses default (matches Ableton behavior)

### Test Case 2: Multi-Sample Protection
**Input:** `32 Pad Kit Jazz.adg` (31 Simplers, many with 8-16 velocity layers)
**Output:** Multi-sample Simplers preserved, only single-sample Simplers converted
**Result:** ✅ Velocity-layered instruments remain as Simplers

### Test Case 3: Large-Scale Batch Processing
**Input:** 234 drum rack files (3,353 total Simplers)
**Output:** 184 racks converted to `/Users/Music/Desktop/drumracks-converted`
**Results:**
- ✅ **Converted:** 2,948 single-sample Simplers → DrumCells
- ✅ **Preserved:** 405 multi-sample Simplers (velocity layers intact)
- ✅ **Skipped:** 50 racks (no Simplers)
- ✅ **Performance:** 32.6 seconds total (7.2 racks/second)
- ✅ **Success rate:** 100% (all converted files load in Ableton)

## Related Decisions

- **ADR 045:** Sample to Simpler conversion (inverse operation)
- **ADR 018:** Gesture Browser Architecture (preset loading system)

## Usage

### Single Device Conversion
```bash
python3 scripts/device-creation/python/conversion/simpler_to_drumcell.py \
  input_simpler.adv \
  output_drumcell.adv
```

### Batch Drum Rack Conversion
```bash
python3 scripts/device-creation/python/conversion/drum_rack_simpler_to_drumcell.py \
  input_rack.adg \
  output_rack.adg
```

### Batch Directory Conversion
```bash
# Dry run (see what would be converted)
python3 scripts/device-creation/python/conversion/batch_convert_drum_racks.py \
  /path/to/drumracks \
  --dry-run

# Convert to output directory
python3 scripts/device-creation/python/conversion/batch_convert_drum_racks.py \
  /path/to/drumracks \
  --output-dir /path/to/output

# Convert with suffix (default: " (converted)")
python3 scripts/device-creation/python/conversion/batch_convert_drum_racks.py \
  /path/to/drumracks \
  --suffix " (drumcells)"

# Quiet mode (suppress per-file output)
python3 scripts/device-creation/python/conversion/batch_convert_drum_racks.py \
  /path/to/drumracks \
  --output-dir /path/to/output \
  --quiet
```

## Future Considerations

1. **Version Detection** - Add schema version detection/warnings
2. **Parameter Mapping Options** - Allow custom envelope/filter mappings
3. **Modulation Conversion** - Attempt simple modulation matrix conversion
4. **Validation Tool** - Compare converted vs manual conversions automatically
5. **Reverse Conversion** - DrumCell → Simpler (if needed)

## References

- Ableton Live 12.3b12 Schema (`SchemaChangeCount="1"`)
- Test files: `/Users/Music/Desktop/donor simpler rack.adg`
- Manual conversion: `/Users/Music/Desktop/manual drum rack convert.adg`
- Implementation: `scripts/device-creation/python/conversion/`
