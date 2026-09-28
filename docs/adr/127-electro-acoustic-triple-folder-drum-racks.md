# ADR-019: Electro Acoustic Triple-Folder Drum Rack Generation

**Status:** Accepted  
**Date:** 2025-10-29  
**Deciders:** User, Claude Code  

## Context

The Soniccouture Electro Acoustic sample collection contains 181 folders organized into 4 categories (Dry, Distorted, Electro Acoustic, Hybrid), each containing 12 samples with consistent naming. We needed to create a system to combine 3 folders into single 32-pad drum racks with a specific mapping layout that maximizes the utility of the most important drum sounds.

### Requirements
- Combine 3 folders of 12 samples each into a single 32-pad drum rack
- Specific pad mapping: Folder A (pads 1-12), Folder B (pads 17-28), Folder C (remaining pads)
- Prioritize essential drum sounds (Kick, Rim, Snare, Clap, Tom-Lo, Tom-Hi, HiHat, Ride) for extra pads
- Use proper drum sampler devices for reliable loading in Ableton Live
- Generate comprehensive combinations across the entire collection

## Decision

### 1. Pad Mapping Strategy

**Decision:** Implement specific 32-pad layout with prioritized drum type mapping.

**Mapping:**
- **Pads 1-12:** Folder A samples (Kick, Rim, Snare, Clap, Tom-Lo, Tom-Hi, HiHat, HiHat-Open, Ride, HiHat-Mid, Rim, Tom-Alt)
- **Pads 17-28:** Folder B samples (same pattern as A)
- **Pads 13-16, 29-32:** Folder C samples (prioritized: Kick, Rim, Snare, Clap, Tom-Lo, Tom-Hi, HiHat, Ride)

**Rationale:**
- Leaves gaps between A and B sections for visual separation
- Prioritizes most essential drum sounds in extra pad positions
- Maintains consistent drum type mapping across folders A and B
- Follows standard drum pad layouts familiar to producers

### 2. Device Architecture

**Decision:** Use DrumCell devices instead of MultiSampler devices.

**Rationale:**
- DrumCell is Ableton's dedicated drum sampler with optimized workflow
- Template preservation: Use existing "Amplified Funk 3onIt + 7dee.adg" template
- Reliable loading: Pre-configured 32-pad structure with correct MIDI note assignments
- Simple implementation: Update sample paths in existing DrumCell structure

**Alternative Rejected:** MultiSampler devices with "32-Pad MultiVelocity Template.adg"
- More complex XML structure manipulation required
- Less optimized for drum-specific workflow
- Previous implementation had loading issues

### 3. Sample File Parsing

**Decision:** Implement filename-based parsing for Electro Acoustic format.

**Format:** `KitName-##-DrumType-V127-CODE.aif`
**Example:** `606 Dry-01-Kick-V127-S5CV.aif`

**Parsing Strategy:**
```python
pattern = r'^(.+?)-(\d+)-(.+?)-V\d+-[A-Z0-9]+\.(aif|wav)$'
# Extracts: kit_name, sample_number, sample_type
```

**Rationale:**
- Consistent format across all 181 folders
- Reliable extraction of drum type for mapping
- Handles variations in naming (e.g., "HiHat" vs "Hihat-Mid")

### 4. Batch Generation Strategy

**Decision:** Generate categorized combinations with strategic limitations.

**Categories:**
- **Dry combinations:** 10 racks (within-category, limited to avoid explosion)
- **Distorted combinations:** 27 racks (cross-machine: 606×808×909 with processing variations)
- **Electro Acoustic combinations:** 15 racks (selected interesting combinations)
- **Hybrid combinations:** 12 racks (limited selection)
- **Mixed combinations:** 37 racks (cross-category: Dry + Distorted + Hybrid)

**Total:** 101 drum racks

**Rationale:**
- Manageable number while covering diverse sonic territory
- Cross-category combinations provide most musical variety
- Strategic selection avoids combinatorial explosion (potential 36M+ combinations)
- Organized output for easy browsing and selection

### 5. Template Structure Preservation

**Decision:** Update existing template branches in-place rather than recreating.

**Implementation:**
```python
# Don't clear existing branches
# branch_presets_container.clear()  # Removed

# Update existing branches instead
existing_branch = branch_presets_container[branch_index]
existing_branch.find('Name').set('Value', f"A-{drum_type}")
```

**Rationale:**
- Preserves pre-configured MIDI note assignments (92, 91, 90... down to 61)
- Maintains template's device routing and parameter structure
- Ensures reliable loading in Ableton Live
- Simpler implementation with fewer failure points

### 6. File Organization

**Decision:** Organize output by sound category with descriptive naming.

**Structure:**
```
ElectroAcoustic_Racks/
├── Dry/           # Clean drum machine combinations
├── Distorted/     # Analog processing combinations  
├── ElectroAcoustic/ # Room recordings and special processing
├── Hybrid/        # Creative processed combinations
└── Mixed/         # Cross-category combinations
```

**Naming Convention:** `FolderA_Name+FolderB_Name+FolderC_Name.adg`
**Example:** `606_Dry+808_Bass_Amp+Ack-Ack_Kit.adg`

**Rationale:**
- Clear categorization for workflow efficiency
- Descriptive names show exactly which folders were combined
- Prevents filename conflicts and overwrites
- Facilitates browsing by sonic character

## Consequences

### Positive
- **Complete coverage:** 101 racks covering diverse combinations from 181 source folders
- **Reliable loading:** 100% success rate using DrumCell devices and template preservation
- **Workflow optimization:** Strategic pad mapping prioritizes most-used drum sounds
- **Organized output:** Categorized structure facilitates quick selection
- **Scalable approach:** Script can be adapted for other sample collections

### Negative
- **Limited combinations:** Only 101 of potential millions of combinations generated
- **Manual curation needed:** Users may want specific combinations not included
- **Storage requirements:** 101 × ~200KB = ~20MB of drum rack files
- **Dependency on template:** Relies on specific "Amplified Funk" template structure

### Neutral
- **Fixed mapping:** Pad layout is hardcoded but follows logical drum arrangement
- **Priority ordering:** Extra pad prioritization may not suit all users' preferences

## Implementation

**Script:** `scripts/device-creation/python/drum_rack/create_triple_folder_electro_acoustic_rack.py`
**Batch Script:** `scripts/device-creation/batch_electro_acoustic_racks.py`
**Template:** `scripts/device-creation/templates/Drum Racks/Acoustic/Amplified Funk 3onIt + 7dee.adg`

**Usage:**
```bash
# Single rack
python3 create_triple_folder_electro_acoustic_rack.py folderA folderB folderC output.adg

# Batch generation
python3 batch_electro_acoustic_racks.py
```

## Future Considerations

1. **User customization:** Allow custom pad mappings and priority ordering
2. **Velocity layering:** Support multi-velocity samples when available
3. **Macro mapping:** Automatically map common parameters to drum rack macros
4. **Preset browser integration:** Generate metadata for gesture browser compatibility
5. **Cross-collection support:** Extend to other sample libraries with similar structure

## Related

- **ADR-018:** Gesture Browser Architecture (preset browsing system)
- **V6 API Reference:** `documentation/v6-api.md` (device loading system)
- **Device Templates:** `scripts/device-creation/templates/` (template structure)