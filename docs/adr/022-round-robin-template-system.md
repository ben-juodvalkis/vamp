#ADR-022: Round Robin Template System for Sample-Based Device Creation

## Status
Accepted

## Context
The project needed a system to automatically generate Ableton Live devices from sample folders with varying numbers of samples, particularly for the 8Dio Mini library. The existing device creation toolkit focused on drum racks with fixed sample assignments, but didn't support round robin sampling where multiple samples cycle for realistic variation.

### Requirements
- Generate devices from any sample folder with 2+ samples
- Adapt automatically to varying sample counts (2-400+ samples)
- Maintain round robin behavior where each trigger cycles through samples
- Use existing Mini Template.adg as the foundation
- Support both single folder and batch library processing
- Integrate cleanly with existing device creation scripts

### Challenges
- Ableton .adg files are gzipped XML requiring custom encoding/decoding
- Round robin requires all samples mapped to full key/velocity range
- Template must be modified to accommodate different sample counts
- Need proper sample path handling and relative path generation
- Device naming should reflect source folder hierarchy

## Decision
Implemented a template-based round robin system with two main components:

### 1. Template Integration
- Store user-customized Mini Template.adg in `scripts/device-creation/templates/`
- Use as default template with option to override
- Template contains pre-configured drum rack with single sampler device
- Maintains all macro assignments, effects, and routing from original

### 2. Adaptive Sample Processing
- **round_robin_creator.py**: Single folder processing
- **batch_round_robin_8dio.py**: Batch processing for entire libraries
- Both scripts automatically detect repo template location
- XML transformation preserves template structure while replacing sample content

### Technical Implementation
```python
# Core transformation process:
1. decode_adg() - Decompress .adg to XML
2. create_round_robin_xml() - Replace MultiSamplePart elements
3. encode_adg() - Compress back to .adg format

# Sample part creation:
- All samples mapped to full key range (0-127)
- Full velocity range (1-127) 
- Proper file path and relative path generation
- Preserved sample metadata and naming
```

### Naming Convention
- Extracts instrument name from parent folder
- Handles nested structures: `air_hammer/bang/Samples` → "Air Hammer Bang"
- Sanitizes names for filesystem compatibility
- Appends "Round Robin" suffix for clarity

## Consequences

### Positive
- **Scalable**: Handles 2-400+ samples automatically
- **Consistent**: All devices use same template foundation
- **Flexible**: Easy to update template for all future devices
- **Integrated**: Works with existing device creation infrastructure
- **User-friendly**: Simple command-line interface for both single/batch use

### Negative
- **Template Dependency**: Requires specific XML structure in template
- **Format Locked**: Only supports Ableton's .adg format
- **Sample Limitation**: Requires minimum 2 samples for round robin
- **File Size**: Large sample counts create proportionally large .adg files

### Maintenance
- Template changes require regeneration of devices
- XML structure changes in future Ableton versions may require updates
- Sample path handling assumes specific directory structures

## Usage Examples

```bash
# Single folder processing
python3 scripts/device-creation/python/round_robin_creator.py "/path/to/samples"

# Batch process entire library
python3 scripts/device-creation/python/batch_round_robin_8dio.py "/path/to/8Dio_Mini/1_Click_Core_Library"

# Custom template
python3 scripts/device-creation/python/round_robin_creator.py "/path/to/samples" --template "/custom/template.adg"
```

## Related
- ADR-018: Gesture Browser Architecture (device discovery integration)
- Existing device creation toolkit in `scripts/device-creation/`
- V6 API documentation for device loading workflow

## Implementation Date
October 2024