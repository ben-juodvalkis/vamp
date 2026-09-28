# ADR 052: Dual-Chain Drum Rack Processing Pipeline

**Date**: 2025-01-14
**Status**: Accepted
**Context**: Performance Drum Rack Organization and Optimization

## Problem

We needed to process hundreds of Ableton drum racks for performance use on a 32-pad controller, requiring:

1. **Dual-chain organization** - Combine two drum kits in a single instrument rack
2. **Standardized layout** - Exactly 16 pads per chain (32 total)
3. **MIDI mapping** - Non-overlapping MIDI ranges for 32-pad controllers
4. **Visual organization** - Color-coded pads by drum type
5. **Performance optimization** - Convert Simplers to lighter DrumCells
6. **Scale** - Process 300+ racks efficiently and reliably

Manual processing in Ableton for this many racks would take weeks and be error-prone.

## Decision

Implement a **multi-stage Python processing pipeline** that transforms drum racks through discrete, testable steps:

### Pipeline Architecture

```
Stage 1: Dual-Chain Wrapping
  Input:  Individual drum racks (.adg)
  Output: Dual-chain instrument racks (2 racks in separate chains)
  Tool:   wrap_two_devices_in_rack.py + batch_wrap_pairs.py

Stage 2: Trim & Shift
  Input:  Dual-chain racks (potentially >16 pads)
  Output: Exactly 16 pads per chain, Chain 2 shifted down 16 MIDI notes
  Tool:   batch_process_dual_racks.py (combines trim + shift)

Stage 3: Color Coding
  Input:  Standardized dual-chain racks
  Output: Color-coded pads by drum type
  Tool:   batch_apply_colors.py

Stage 4: DrumCell Conversion
  Input:  Colored racks with Simplers
  Output: Optimized racks with DrumCells
  Tool:   batch_convert_drum_racks.py
```

### Implementation Details

#### Stage 1: Dual-Chain Wrapping

**Method**: Template-based wrapper (see ADR 051)

**Status**: ⚠️ **CRITICAL LIMITATION DISCOVERED**

**Problem**: ElementTree XML serialization corrupts Live 12 devices
- Works for: Live 9 format racks, simple devices
- Fails for: Live 12.0+ racks with Operator, Wavetable, MultiSampler
- Symptom: Files parse as valid XML but Ableton won't load them
- Root cause: ElementTree changes subtle formatting/encoding that breaks Live 12

**Workaround**: **Manual wrapping in Ableton required** for Live 12.0+ racks
- User must manually wrap devices in Ableton Live
- Scripts can then process the manually-wrapped files
- Stages 2-4 work reliably without re-parsing device internals

**Scripts**:
- `wrap_two_devices_in_rack.py` - Template-based dual-chain wrapper
- `batch_wrap_pairs.py` - Batch process entire directories

#### Stage 2: Trim to 16 Pads

**Purpose**: Ensure exactly 16 pads per chain

**Method**:
- Sort pads by ReceivingNote DESCENDING (highest MIDI = pad 1)
- Keep first 16 pads (bottom pads on controller with essential drums)
- Remove pads 17+ (top pads with auxiliary/melodic elements)

**Why trim from top**:
- Bottom pads (highest MIDI) typically contain: kick, snare, clap, hats
- Top pads (lowest MIDI) typically contain: synth lines, vocal samples, effects
- Preserves core drum sounds for performance

**Scripts**:
- `trim_drum_racks_to_16.py` - Single file trimming
- Part of `batch_process_dual_racks.py`

#### Stage 2b: MIDI Shift Second Chain

**Purpose**: Create non-overlapping MIDI ranges for 32-pad controller

**Method**:
- Chain 1: Keep original MIDI notes (typically 77-92 = pads 1-16)
- Chain 2: Shift down by 16 MIDI notes (77-92 becomes 61-76 = pads 17-32)

**Result**:
- Full 32-pad range: MIDI 61-92
- Chain 2: MIDI 61-76 (controller pads 17-32)
- Chain 1: MIDI 77-92 (controller pads 1-16)

**Scripts**:
- `shift_second_chain_midi.py` - Single file MIDI shifting
- Part of `batch_process_dual_racks.py`

#### Stage 3: Color Coding

**Purpose**: Visual organization by drum type

**Color Scheme** (from `main_battery_kit_organized.py`):
```python
DRUM_COLORS = {
    'kick': 60,           # Red
    'snare': 13,          # Yellow
    'rim': 13,            # Yellow
    'clap': 13,           # Yellow
    'tom': 9,             # Orange
    'shaker': 26,         # Green
    'percussion': 26,     # Green
    'closed_hihat': 41,   # Cyan
    'cymbal': 45,         # Blue
    'open_hihat': 43,     # Light Blue
    'default': 0          # Default/Orange
}
```

**Detection Method**:
- Extract sample name from `MultiSamplePart/Name` (Simplers)
- Or from `FileRef/Path` or `FileRef/Name` (DrumCells)
- Categorize based on keywords (kick, snare, hat, etc.)
- Set `AutoColored="false"` to enable manual coloring
- Set `DocumentColorIndex` to appropriate color

**Device Agnostic**: Works with OriginalSimpler, DrumCell, MultiSampler

**Scripts**:
- `apply_color_coding.py` - Single file coloring
- `batch_apply_colors.py` - Batch processing

#### Stage 4: Simpler to DrumCell Conversion

**Purpose**: Optimize performance (see ADR 050)

**Key Fix Applied**: Handle both Path formats
- Absolute path: `<Path Value="/full/path.wav" />`
- Relative path: `<RelativePath>...</RelativePath><Name Value="file.wav" />`

**Protection**:
- Skips multi-sample Simplers (velocity layers)
- Skips empty pads (no sample loaded)
- Preserves DrumCells (already converted)

**Scripts**:
- `simpler_to_drumcell.py` - Single device conversion
- `drum_rack_simpler_to_drumcell.py` - Full rack conversion
- `batch_convert_drum_racks.py` - Batch processing

### File Structure

```
scripts/device-creation/python/drum_rack/
├── wrap_two_devices_in_rack.py          # Stage 1 (template-based - BROKEN for Live 12)
├── batch_wrap_pairs.py                  # Stage 1 batch
├── trim_drum_racks_to_16.py             # Stage 2a
├── shift_second_chain_midi.py           # Stage 2b
├── batch_process_dual_racks.py          # Stage 2 combined
├── apply_color_coding.py                # Stage 3
├── batch_apply_colors.py                # Stage 3 batch
└── README_DUAL_WRAPPER.md

scripts/device-creation/python/conversion/
├── simpler_to_drumcell.py               # Stage 4
├── drum_rack_simpler_to_drumcell.py     # Stage 4
└── batch_convert_drum_racks.py          # Stage 4 batch

scripts/device-creation/python/templates/
├── dual_device_rack_template.xml        # Wrapping template
└── instrument_rack_wrapper_template.xml # Single device template
```

## Production Results

### Successful Workflow (Manual Wrapping)

**Source**: `/Users/Music/Desktop/aTo Stack` (manually-wrapped dual-chain racks)

**Processing**: 93 dual-chain racks

| Stage | Operation | Results |
|-------|-----------|---------|
| 1 (Manual) | Wrap in dual chains | 93 racks (manual in Ableton) |
| 2 | Trim to 16 + Shift chain 2 | 21 trimmed (199 pads removed), 93 shifted (1,486 pads) |
| 3 | Color code by type | 2,974 pads colored |
| 4 | Convert to DrumCells | 85 converted (2,589 Simplers), 8 skipped |

**Output**: `/Users/Music/Desktop/aTo Stack Step 3 - Converted` (93 complete racks)

**Success Rate**: 100% - All files load correctly in Ableton Live 12.3

### Failed Workflow (Script Wrapping)

**Attempted**: Automatic wrapping via `wrap_two_devices_in_rack.py`

**Collections Tested**:
- Drum Essentials (Acoustic, Drum Machines, Hybrid, Synthesized)
- Various Live 12.0+ format racks with complex devices

**Result**: ⚠️ **Files generate but won't load in Ableton**

**Root Cause**: ElementTree XML serialization incompatible with Live 12.0+ schema
- `SchemaChangeCount` differences (6 vs 1)
- `MinorVersion` differences (12.0_12049 vs 12.0_12300)
- Subtle XML formatting changes break device loading
- Same issue as documented in drum rack merging attempts (ADR summary)

## Critical Lessons Learned

### What Works

✅ **Stages 2-4 are production-ready** when starting with properly-wrapped racks
- Trim/shift operations safe (modify MIDI notes only)
- Color coding safe (modify pad attributes only)
- DrumCell conversion safe (validated at scale - ADR 050)

✅ **Template-based wrapping works for**:
- Live 9 format racks (OriginalSimpler)
- Simple Live 12 racks (basic DrumCell/Simpler)
- Successfully tested: Beat Tools, Altered Kits

### What Doesn't Work

❌ **Template-based wrapping fails for**:
- Live 12.0+ racks with Operator, Wavetable, MultiSampler
- Racks with schema changes (SchemaChangeCount > 1)
- Complex nested device structures from newer Ableton versions

❌ **ElementTree serialization issues**:
- Corrupts Live 12 device internals
- Changes encoding (UTF-8 → utf-8)
- Loses subtle formatting Ableton requires
- No error during generation - files simply won't load

### Technical Root Cause

**XML Serialization Corruption**:
```python
# This breaks Live 12 complex devices:
root = ET.fromstring(xml)
template.append(root)
output = ET.tostring(template)  # ← Corrupts device XML
```

**Why it fails**:
- ElementTree normalizes/reformats XML during parse
- Live 12.0+ devices have strict formatting requirements
- Ableton's schema validation rejects reformatted XML
- No Python XML library preserves byte-perfect output

## Alternatives Considered

### 1. String-Based Manipulation
**Status**: Not implemented
**Approach**: Use regex to extract/inject XML blocks without parsing

**Pros**:
- Preserves exact XML formatting
- No ElementTree corruption

**Cons**:
- Complex nested XML hard to match with regex
- Risk of unbalanced tags
- Previously attempted, had extraction issues

### 2. Binary/Raw Copy
**Status**: Not feasible
**Reason**: Files are gzip-compressed, must decode to manipulate

### 3. Ableton Python API
**Status**: Doesn't exist
**Note**: Ableton has Max/Control Surface APIs, but no device creation API

### 4. Manual Wrapping + Automated Processing
**Status**: ✅ **ACCEPTED - This is the solution**

**Workflow**:
1. User manually wraps devices in Ableton (Stage 1)
2. Scripts process the wrapped files (Stages 2-4)
3. Stages 2-4 don't re-parse device internals, only modify metadata

**Rationale**:
- Manual wrapping: ~2 minutes per rack
- Script processing: <1 second per rack for stages 2-4
- For 93 racks: ~3 hours manual + 2 minutes script vs weeks of debugging

## Consequences

### Positive

✅ **Stages 2-4 validated at production scale**
- 93 racks processed successfully
- 0 errors when starting from manual wraps
- Fast processing (30-60 seconds for all stages)

✅ **Color coding breakthrough**
- Works with any device type (Simpler, DrumCell, Operator, etc.)
- Intelligent categorization from sample names
- 2,974 pads correctly colored

✅ **DrumCell conversion fixed**
- Now handles relative path format (Live Pack references)
- Gracefully skips empty pads
- 2,589 conversions successful

### Negative

❌ **Stage 1 (wrapping) requires manual work**
- Cannot automate wrapping for Live 12.0+ racks
- ElementTree corruption unfixable without major refactoring
- Time investment: ~2 min/rack manual wrapping

⚠️ **Version compatibility issues**
- Scripts tied to Ableton Live 12.3 schema
- May break with future Ableton updates
- Template files need maintenance

### Neutral

⚪ **Workflow split**:
- Manual: Wrapping (Stage 1)
- Automated: Processing (Stages 2-4)
- Clear division of responsibilities

## Recommendations

### For Future Work

1. **Accept manual wrapping for Stage 1**
   - Focus on making it fast/easy in Ableton
   - Document best practices
   - Consider keyboard shortcuts/macros

2. **Maintain and improve Stages 2-4**
   - These are reliable and production-ready
   - Continue to optimize and add features

3. **Do not pursue ElementTree-based wrapping**
   - Already attempted multiple approaches
   - Fundamental incompatibility with Live 12
   - Not worth further development time

4. **Alternative for future Ableton versions**
   - Monitor for official Ableton API
   - Consider Max for Live device creation
   - String-based manipulation (if desperate)

### For Users

**Recommended Workflow**:

1. **Manual wrapping** in Ableton Live:
   - Create Instrument Rack
   - Drag two drum kits into separate chains
   - Save rack
   - Repeat for all pairs

2. **Run automated pipeline**:
   ```bash
   # Trim to 16 pads + shift second chain
   python3 batch_process_dual_racks.py wrapped_dir/ processed_dir/

   # Apply color coding
   python3 batch_apply_colors.py processed_dir/ colored_dir/

   # Convert to DrumCells
   python3 batch_convert_drum_racks.py colored_dir/ --output-dir final_dir/
   ```

3. **Result**: Production-ready 32-pad racks

## Validation

### Test Case: Drum Essentials (Manual Wrap)

**Input**: 107 individual drum racks (Acoustic, Drum Machines, Hybrid, Synthesized)

**Stage 1 (Manual)**: Created 93 dual-chain racks in Ableton
- Time: ~3 hours manual work
- Result: All load correctly

**Stages 2-4 (Automated)**:
- ✅ 21 racks trimmed (199 pads removed)
- ✅ 93 racks shifted (1,486 pads)
- ✅ 2,974 pads colored
- ✅ 85 racks converted (2,589 Simplers → DrumCells)
- ✅ 0 errors
- ✅ All files load in Ableton Live 12.3

**Processing Time**: <2 minutes for stages 2-4

### Test Case: Script Wrapping Failures

**Attempted**: Drum Essentials with `wrap_two_devices_in_rack.py`

**Result**: ❌ Files won't load in Ableton
- XML is structurally valid
- Parsing succeeds
- Ableton rejects on load
- Error: "Unable to load preset"

**Diagnosis**: Live 12.0 schema corruption during ElementTree serialization

## Technical Specifications

### MIDI Note Layout

**Standard Ableton 32-pad rack**: MIDI 64-33 (pad 1 = 64, pad 32 = 33)

**Our dual-chain racks**:
- Chain 1 (pads 1-16): MIDI 77-92 (higher notes)
- Chain 2 (pads 17-32): MIDI 61-76 (lower notes, shifted down 16)

**Controller mapping**: Pads 1-32 map directly to MIDI 77→61

### Pad Trimming Strategy

**Keep**: Pads 1-16 (highest MIDI notes)
- Typical contents: Kick, Snare, Clap, Hats, Toms, Cymbals

**Remove**: Pads 17+ (lowest MIDI notes)
- Typical contents: Synth lines, vocal samples, melodic elements

**Example** (Azimuth Kit, 19 pads):
- Keep pads 1-16: Core drums
- Remove pads 17-19: "Vox Oh Long", "Vox Oh Short", "Synth Line Azimuth"

### Color Detection Logic

**Sample name extraction** (in priority order):
1. `MultiSamplePart/Name` (OriginalSimpler/MultiSampler)
2. `DrumCell/UserName` (DrumCell)
3. `FileRef/Path` (fallback for any device)
4. `FileRef/Name` (Live Pack references)
5. `DeviceName` (last resort)

**Categorization keywords**:
- Kick: "kick", "bd"
- Snare: "snare", "sd"
- Hihat: "hat", "hh", "closed", "open", "pedal"
- Clap: "clap", "snap", "cp"
- Tom: "tom", "lt", "mt", "ht"
- Cymbal: "cymbal", "crash", "ride", "cy"
- Shaker: "shaker", "cabasa", "maraca"
- Percussion: "perc", "cowbell", "conga", "bongo"

### DrumCell Conversion

**Enhancements** (beyond ADR 050):
- ✅ Fixed: Now handles relative path format
- ✅ Fixed: Gracefully skips empty pads
- ✅ Works with Live Pack references (Digicussion, Bomblastic, etc.)

**Path format support**:
```python
# Absolute path (common)
<Path Value="/Users/.../sample.wav" />

# Relative path (Live Packs)
<HasRelativePath Value="true" />
<RelativePath>
  <RelativePathElement Dir="Samples" />
  <RelativePathElement Dir="Drums" />
  <RelativePathElement Dir="Kick" />
</RelativePath>
<Name Value="Kick Sample.aif" />
```

## Production Statistics

### Successful Processing (Manual Wrap + Automated Pipeline)

**Collection**: Drum Essentials
- Input: 107 individual racks
- Manual wrap: 93 dual-chain racks
- Automated processing: 100% success
- Output: 93 complete 32-pad performance racks

**Processing Breakdown**:
- Trimmed: 199 pads removed from 21 racks
- Shifted: 1,486 pads (93 racks × 16 pads)
- Colored: 2,974 pads
- Converted: 2,589 Simplers → DrumCells

**Time**:
- Manual wrapping: ~3 hours
- Automated pipeline: <2 minutes
- Total: ~3 hours for 93 complete racks

### Failed Processing (Automated Wrap)

**Attempted**: Script-based wrapping of Live 12.0+ racks

**Result**: 0% usable output
- Files generate successfully
- XML structure valid
- Ableton rejects on load
- Unusable in production

## Related Work

- **ADR 050**: Simpler to DrumCell Conversion - Foundation for Stage 4
- **ADR 051**: Device Wrapper Scripts - Stage 1 implementation (limited success)
- **Drum Rack Merging Documentation**: `documentation/current-project/process-factory-drums/` - Previous pad-level merging attempts, same ElementTree issues

## Future Considerations

### If String-Based Manipulation Is Pursued

**Approach**:
- Extract device XML as raw strings (regex)
- Inject into template without parsing
- Preserve byte-perfect device content

**Challenges**:
- Balanced tag matching for nested structures
- ID attribute management
- Complex regex patterns
- Higher risk of corruption

**Recommendation**: Only pursue if Ableton provides no alternative and manual wrapping becomes untenable

### Alternative: Max for Live Device Builder

**Possibility**: Create Max for Live device that:
- Loads two racks
- Creates dual-chain structure
- Saves as .adg file

**Viability**: Unknown - needs research

## Usage

### Complete Pipeline (Manual Wrap + Scripts)

```bash
# Stage 1: MANUAL - Wrap devices in Ableton Live
# - Create Instrument Rack
# - Add two drum racks to separate chains
# - Save

# Stage 2: Trim to 16 pads and shift second chain
python3 batch_process_dual_racks.py \
  "/path/to/wrapped" \
  "/path/to/trimmed-shifted"

# Stage 3: Apply color coding
python3 batch_apply_colors.py \
  "/path/to/trimmed-shifted" \
  "/path/to/colored"

# Stage 4: Convert Simplers to DrumCells
# Copy files first, then convert in-place to avoid missing skipped files
cp -r "/path/to/colored" "/path/to/final"
echo "yes" | python3 batch_convert_drum_racks.py \
  "/path/to/final" \
  --in-place \
  --quiet
```

### Individual Operations

```bash
# Just trim and shift
python3 batch_process_dual_racks.py input/ output/

# Just color
python3 batch_apply_colors.py input/ output/

# Just convert
python3 batch_convert_drum_racks.py input/ --output-dir output/
```

## References

- Implementation: `scripts/device-creation/python/drum_rack/`
- Conversion: `scripts/device-creation/python/conversion/`
- Templates: `scripts/device-creation/python/templates/`
- Related: ADR 050 (Simpler conversion), ADR 051 (Device wrappers)

---

**Decision made by**: Development team
**Implemented**: 2025-01-14
**Stage 1 limitation discovered**: 2025-01-14
**Workaround established**: 2025-01-14 (manual wrapping)
**Last updated**: 2025-01-14
