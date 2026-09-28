#ADR-067: Auto Sampled Drum Rack Generation

## Status
Accepted

## Context
The project needed a way to automatically generate Ableton Live drum racks from the Auto Sampled folder structure. The Auto Sampled folders contain chromatically organized samples with a specific naming convention: `KitName-Note-V127-ID.aif` (e.g., `100-C1-V127-HRGW.aif`).

### Requirements
- Convert folders of chromatically named samples into Ableton drum racks
- Map samples to correct MIDI notes based on filename note names
- Preserve existing drum rack template structure (macros, effects, device chains)
- Support note range from C1 to G3 (32 chromatic pads)
- Only update sample file references, leaving all other template elements intact

### Challenges
- Initial approach used sampler templates instead of drum rack templates
- Early implementation cleared existing drum branches and created simplified structures
- File reference updates targeted all FileRef elements instead of just sample references
- Sample mapping logic initially created 44 slots (C1-G3 full range) with gaps instead of filling all 32 drum pads sequentially

## Decision
Created `auto_sampled_drum_racks.py` script with the following approach:

### Architecture
1. **Template Preservation**: Use existing drum rack templates as base, preserving all macro controls, effects, and device structures
2. **Targeted Updates**: Only modify `SampleRef/FileRef` elements, leaving preset references and device configuration intact
3. **Sequential Mapping**: Fill all 32 drum pads chromatically from C1 to G3 based on sample note names
4. **Note Parsing**: Extract note names from filename pattern using regex: `^[^-]+-([A-G]#?\d+)-V127-[A-Z0-9]+\.(aif|wav)$`

### Implementation Details
```python
# Key functions:
- parse_sample_filename(): Extract note from filename
- note_name_to_midi(): Convert note name to MIDI number
- get_samples_by_note(): Organize samples by note name
- create_drum_rack_samples(): Map samples to 32 sequential pads
- transform_drum_rack_xml(): Update only sample file references
```

### Template Usage
Uses existing drum rack templates (e.g., `Amplified Funk Aquarius + BluOut.adg`) to ensure:
- Proper Live device structure
- Macro control mappings
- Effect chain configurations
- Device parameter settings

## Consequences

### Positive
- **Batch Processing**: Can process entire Auto Sampled folder automatically
- **Template Fidelity**: Generated racks work identically to manually created ones
- **Correct Mapping**: All 32 pads filled with appropriate samples based on note names
- **Macro Preservation**: Template macros and effects remain functional
- **File Organization**: Excludes problematic folders (Abbey Road) automatically

### Negative
- **Template Dependency**: Requires existing drum rack template as input
- **Fixed Range**: Limited to C1-G3 range (32 pads)
- **Naming Convention**: Dependent on specific Auto Sampled filename format

### Usage
```bash
python3 scripts/device-creation/python/device/sampler/auto_sampled_drum_racks.py \
  "/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Instruments/Ableton/Drums NI/Acoustic/ Amplified Funk Aquarius + BluOut.adg" \
  "/Users/Music/Music/Audio Music Apps/Samples/Auto Sampled" \
  --output-folder "/Users/Music/Desktop/auto-sampled-drums"
```

### Performance
- Processes 20+ kits successfully
- Maintains original template file size (~55KB)
- Updates only necessary FileRef elements (32 sample references out of 194 total)

## Notes
- Script specifically targets `SampleRef/FileRef` elements to avoid updating device presets or configuration files
- Sequential pad filling ensures all 32 drum pads are utilized
- Template structure preservation was critical for Ableton Live compatibility

## Related
- Original `main_drumstyle_sampler.py` (drum library organization by type)
- Drum rack template creation workflows
- Auto Sampled folder organization standards