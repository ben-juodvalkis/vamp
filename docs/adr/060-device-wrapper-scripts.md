# ADR 051: Device Wrapper Scripts

**Date**: 2025-01-14
**Status**: Accepted
**Context**: Drum Rack Organization and Performance Setup

## Problem

We needed a reliable way to wrap Ableton devices in Instrument Rack containers for:

1. **Consistency** - All devices should have the same container structure
2. **Layering** - Combine multiple devices (e.g., two drum kits) in dual-chain racks
3. **Future flexibility** - Easy to add macro controls or additional chains later
4. **Organization** - Cleaner device management in Ableton

Manual wrapping in Ableton works but:
- Time-consuming for batch operations
- Not scriptable for automation
- Prone to user error
- Can't be integrated into pipelines

Early attempts at programmatic XML building failed because:
- Missing critical Ableton metadata elements (`MixerPreset`, `ZoneSettings`, etc.)
- Incorrect element ordering or structure
- Racks loaded as empty in Ableton Live

## Decision

Implement **template-based device wrapper scripts** that:

1. Use working racks (manually created in Ableton) as templates
2. Extract complete `GroupDevicePreset` structures from source devices
3. Replace template device content with source device content
4. Preserve all Ableton-required XML elements

### Scripts Created

#### 1. `wrap_device_in_rack_template.py`
Wraps a single device in an Instrument Rack with one chain.

**Usage**:
```bash
python3 wrap_device_in_rack_template.py input.adg output.adg
python3 wrap_device_in_rack_template.py input.adg output.adg --name "My Rack"
```

**Template**: `python/templates/instrument_rack_wrapper_template.xml`

#### 2. `wrap_two_devices_in_rack.py`
Wraps two devices in a dual-chain Instrument Rack.

**Usage**:
```bash
python3 wrap_two_devices_in_rack.py device1.adg device2.adg output.adg
python3 wrap_two_devices_in_rack.py device1.adg device2.adg output.adg \
    --name "Dual Rack" --chain1 "Kit A" --chain2 "Kit B"
```

**Features**:
- Automatic chain naming from device names
- Manual override via `--chain1` and `--chain2` flags
- Searches nested devices for names (handles already-wrapped racks)

**Template**: `python/templates/dual_device_rack_template.xml`

#### 3. `batch_wrap_pairs.py`
Batch process entire directories, pairing devices sequentially.

**Usage**:
```bash
python3 batch_wrap_pairs.py input_dir/ output_dir/
python3 batch_wrap_pairs.py input_dir/ output_dir/ --rack-prefix "Dual "
python3 batch_wrap_pairs.py input_dir/ output_dir/ --dry-run
```

**Features**:
- Sequential pairing (alphabetically sorted)
- Automatic device/chain naming
- Dry-run mode for preview
- Progress tracking and error handling
- Statistics summary

## Technical Approach

### Template-Based Architecture

1. **Template Creation**:
   - Manually wrap device(s) in Ableton Live
   - Export the rack
   - Decode to XML and save as template
   - Template contains all Ableton-required elements

2. **Device Extraction**:
   ```python
   # Extract complete GroupDevicePreset
   group_preset = xml_root.find('.//GroupDevicePreset')
   ```

   The `GroupDevicePreset` contains:
   - `OverwriteProtectionNumber`
   - `Device` (the actual device element)
   - `BranchPresets` (any chains/pads within the device)
   - `PresetRef` (file references)
   - All nested content

3. **Template Population**:
   ```python
   # Remove existing device from template
   template_device_presets.remove(existing_preset)

   # Add source device (with Id="0" for Ableton compatibility)
   source_group_preset.set('Id', '0')
   template_device_presets.append(source_group_preset)
   ```

### Device-Agnostic Design

The scripts work with **any device type**:
- ✅ Simple drum racks
- ✅ Instrument racks
- ✅ Already-wrapped devices (nested racks)
- ✅ Complex nested structures
- ✅ Effect racks
- ✅ Any combination of the above

**Key insight**: Extracting `GroupDevicePreset` captures the entire device regardless of internal complexity.

### Automatic Naming

For dual-chain racks, chain names are automatically detected:

```python
def get_device_name(xml_root: ET.Element) -> str:
    # 1. Try main device UserName
    device = xml_root.find('.//GroupDevicePreset/Device/*')
    if device has name:
        return name

    # 2. Try nested devices (for wrapped racks)
    for nested_device in all GroupDevices:
        if nested_device has name:
            return name

    # 3. Fall back to empty
    return ""
```

Manual names via CLI flags take priority over auto-detected names.

## Consequences

### Positive

✅ **Reliable** - Template approach ensures all required elements present
✅ **Device-agnostic** - Works with any Ableton device type
✅ **Tested** - Successfully wraps complex nested racks with drum racks
✅ **Scriptable** - Can be integrated into batch processing pipelines
✅ **Maintainable** - Templates can be regenerated if Ableton format changes
✅ **User-friendly** - Automatic naming reduces manual input

### Neutral

⚪ **File size** - Output 8-10% smaller than manual wrap due to XML serialization differences (cosmetic only, no content loss)
⚪ **Templates required** - Must maintain template files, but these are stable

### Negative

⚠️ **Template dependency** - Scripts fail if templates are missing or corrupted
⚠️ **Version compatibility** - Templates may need updating for major Ableton version changes

## Alternatives Considered

### 1. Programmatic XML Building
**Rejected**: Too fragile. Missing subtle elements causes Ableton to reject files.

**Attempted in**: `wrap_device_in_rack.py` (still in codebase for reference)

**Issues**:
- Incomplete `MixerPreset` structure
- Missing `BranchSelectorRange`, `ZoneSettings`, etc.
- Racks loaded as empty in Ableton

### 2. Binary Manipulation
**Rejected**: Ableton files are gzipped XML, but binary approach is unnecessarily complex.

### 3. Ableton Python API (if it existed)
**Not available**: Ableton has Max for Live and Control Surface APIs, but no direct Python device creation API.

## Implementation Details

### File Structure
```
scripts/device-creation/python/
├── drum_rack/
│   ├── wrap_device_in_rack_template.py      # Single device wrapper
│   ├── wrap_two_devices_in_rack.py          # Dual device wrapper
│   ├── batch_wrap_pairs.py                  # Batch processing script
│   ├── wrap_device_in_rack.py               # Legacy (programmatic)
│   ├── README_WRAPPER.md                    # Single device docs
│   └── README_DUAL_WRAPPER.md               # Dual device docs
└── templates/
    ├── instrument_rack_wrapper_template.xml  # Single device template
    └── dual_device_rack_template.xml         # Dual device template
```

### Dependencies
- Python 3.6+
- Standard library: `xml.etree.ElementTree`, `gzip`, `pathlib`, `argparse`
- Project utilities: `decoder.py`, `encoder.py`

### Template Maintenance

To regenerate templates if needed:

```bash
# 1. Manually wrap device(s) in Ableton Live
# 2. Save the rack as template.adg
# 3. Extract:
python3 -c "
from utils.decoder import decode_adg
xml = decode_adg('template.adg')
with open('templates/template.xml', 'w') as f:
    f.write(xml)
"
```

## Testing

### Test Coverage
- ✅ Single drum rack wrapping
- ✅ Instrument rack wrapping
- ✅ Already-wrapped rack wrapping (nested)
- ✅ Dual-chain with two drum kits
- ✅ Automatic chain naming
- ✅ Manual chain name override
- ✅ Batch processing at scale

### Batch Processing Results

**Production scale validation**: Successfully processed **12 collections** with **155 dual-chain racks** created:

| Collection | Racks | Source Kits | Notes |
|------------|-------|-------------|-------|
| Drum Booth Basic | 8 | 16 | ✅ |
| Drum Essentials Acoustic | 5 | 11 | 1 skipped |
| Drum Essentials Drum Machines | 11 | 23 | 1 skipped |
| Drum Essentials Hybrid | 28 | 56 | ✅ |
| Drum Essentials Synthesized | 8 | 17 | 1 skipped |
| Core Library Electronic | 17 | 35 | 1 skipped |
| Core Library Sampled | 17 | 34 | ✅ |
| Core Library Sampled (to stack) | 17 | 34 | ✅ |
| Glitch and Wash | 12 | 25 | 1 skipped |
| Mood Reel | 10 | 20 | ✅ |
| Punch and Tilt | 9 | 19 | 1 skipped |
| Skitter and Step | 13 | 26 | ✅ |
| **TOTAL** | **155** | **316** | **6 skipped** |

**Success rate**: 98.1% (6 files skipped due to odd counts, 0 errors)

### Verification Process
1. Run wrapper script
2. Open output `.adg` in Ableton Live
3. Verify rack loads with correct number of chains
4. Verify all devices are accessible inside
5. Verify all parameters and samples work
6. Test switching between chains (dual-chain only)

**Result**: All 155 racks verified to load correctly in Ableton Live 12.3

## Related Work

- **ADR 050**: Simpler to DrumCell Conversion - Provides device conversion for wrapped racks
- **Merge Drum Racks** (`merge_drum_racks.py`) - Pad-level merging approach for 32-pad racks
- **Drum Rack Processing Pipeline** (`process_drum_rack_pipeline.py`) - Integrates with wrapper scripts

## Production Results

### Scale Achievement
- **155 dual-chain racks** created from 316 source devices
- **0 errors** during processing
- **98.1% success rate** (only odd-count skips)
- All racks tested and working in Ableton Live 12.3

### Collections Processed
Successfully wrapped drum kits from:
- Ableton Core Library (Electronic, Sampled, Drum Machines)
- Drum Booth (Basic series)
- Drum Essentials (Acoustic, Drum Machines, Hybrid, Synthesized)
- Glitch and Wash
- Mood Reel (Live 12 MultiSampler devices - works with wrapper approach!)
- Punch and Tilt
- Skitter and Step

### Performance Characteristics
- **Processing speed**: ~2-3 seconds per dual-chain rack
- **File size**: Output racks ≈ Device1 + Device2 + 4KB overhead
- **Memory efficient**: Streams XML through ElementTree parser
- **Reliability**: 100% success rate on valid input files

## Future Enhancements

### Possible Extensions
1. **N-chain wrapper** - Generalize to arbitrary number of chains
2. **Macro mapping** - Auto-map device parameters to rack macros
3. **Zone configuration** - Set key/velocity ranges programmatically
4. **Chain selector automation** - Add automation lanes for live switching
5. **Effect rack wrapping** - Dedicated templates for audio effects
6. **Smart pairing** - Pair by similarity (genre, style) instead of alphabetical

### Integration Opportunities
- ✅ **Batch processing** - Completed and validated at scale
- Pipeline integration: wrap → convert → color → configure
- Template library for different use cases (performance, production, etc.)
- Integration with preset browser system

## References

- Implementation: `scripts/device-creation/python/drum_rack/wrap_*_in_rack*.py`
- Documentation: `scripts/device-creation/python/drum_rack/README_*.md`
- Templates: `scripts/device-creation/python/templates/*.xml`
- Related: Documentation on drum rack processing in `documentation/current-project/process-factory-drums/`

---

**Decision made by**: Development team
**Implemented**: 2025-01-14
**Batch processing completed**: 2025-01-14 (155 racks created)
**Last updated**: 2025-01-14
