# ADR 035: Battery Kit Drum Rack Automation System

**Status**: Implemented
**Date**: 2025-10-11
**Context**: Device Creation, Native Instruments Expansions, Performance Optimization

## Context

Native Instruments Expansion libraries contain Battery Kit (.nbkt) files with associated drum samples scattered across folder structures. Creating organized Ableton drum racks from these kits was:

1. **Extremely Manual**: Each kit required finding samples across Drums and One Shots folders
2. **Inconsistent Layout**: Sample placement varied, breaking muscle memory
3. **Time-Consuming**: 64 expansion libraries × 20-60 kits each = thousands of potential racks
4. **No Visual Feedback**: All pads same color, hard to identify sound types quickly
5. **Cluttered**: Long "Lick" samples (melodic phrases) mixed with one-shot drum hits

### Use Cases

1. **Live Performance**: Quick access to organized kits with consistent pad layout
2. **Production**: Muscle memory for finding kicks (pads 1-2), snares (pads 3-5), etc.
3. **Library Management**: Process entire expansion collection automatically
4. **Visual Workflow**: Color-coded pads for instant sound type recognition

### Technical Challenge

**Battery Kit Structure**:
```
Library/
├── Sounds/Battery Kits/
│   ├── 3onIt Kit.nbkt         # Kit definition file
│   ├── BluOut Kit.nbkt
│   └── ...
└── Samples/
    ├── Drums/
    │   ├── Kick/
    │   │   ├── Kick 3onIt 1.wav
    │   │   └── Kick BluOut DS 1.wav
    │   ├── Snare/
    │   └── ...
    └── One Shots/
        ├── Bass/
        ├── Chord/
        └── ...
```

Samples are **identified by kit name embedded in filename**: `Kick 3onIt 1.wav` matches `3onIt Kit.nbkt`.

## Decision

We implemented an **automated Battery Kit drum rack creation system** that:

1. **Extracts kit identifiers** from .nbkt filenames
2. **Searches dual locations** (Drums + One Shots folders) for matching samples
3. **Filters unsuitable samples** (long "Lick" phrases)
4. **Organizes by type** into logical pad positions
5. **Color-codes pads** by instrument category
6. **Packs dual kits** into 32-pad racks (pads 1-16 + 17-32)

### Key Design Decisions

1. **Dual-Kit Architecture**: Two 16-pad kits per rack to maximize 32-pad capacity
2. **Fixed Pad Layout**: Consistent positions across all kits for muscle memory
3. **Color Coding**: Ableton DocumentColorIndex system for visual feedback
4. **Smart Filtering**: Automatic exclusion of long melodic samples
5. **Batch Processing**: Process entire expansion libraries unattended

## Architecture

### System Flow

```
.nbkt File → Extract Identifier → Search Samples → Filter & Categorize
                                                           ↓
Template.adg ← Apply Colors ← Organize by Type ← Match Kit Name
      ↓
 Dual Kit Rack.adg (32 pads, color-coded, organized)
```

### Pad Layout (per 16-pad kit)

| Pads | Type | Color | Index |
|------|------|-------|-------|
| 1-2 | Kick | Red | 60 |
| 3-5 | Snare/Rim/Clap | Yellow | 13 |
| 6 | Tom | Orange | 9 |
| 7 | Shaker | Green | 26 |
| 8 | Percussion | Green | 26 |
| 9 | Closed Hihat | Cyan | 41 |
| 10 | Cymbal | Blue | 45 |
| 11 | Open Hihat | Light Blue | 43 |
| 12-16 | Other samples | Default | 0 |

**Kit 2 uses same layout on pads 17-32**

## Implementation

### Core Components

**1. Kit Identifier Extraction**
```python
def extract_kit_identifier(nbkt_path: Path) -> str:
    filename = nbkt_path.stem
    if filename.endswith(" Kit"):
        return filename[:-4]
    return filename

# "3onIt Kit.nbkt" → "3onIt"
# "BluOut Kit.nbkt" → "BluOut"
```

**2. Sample Matching**
```python
def find_kit_samples(library_root: Path, kit_identifier: str) -> List[str]:
    # Search locations
    - Library/Samples/Drums/[Kick|Snare|Hihat|Clap|Tom|Cymbal|Percussion|Shaker|Combo]
    - Library/Samples/One Shots/[Bass|Synth|Chord|Lick|Vocal|SFX]

    # Word boundary regex to avoid partial matches
    pattern = rf'\b{re.escape(kit_identifier)}\b'

    # Returns samples organized by type, alphabetically sorted
```

**3. Sample Categorization**
```python
def categorize_sample(sample_path: str) -> str:
    filename = Path(sample_path).stem.lower()

    if 'kick' in filename: return 'kick'
    elif 'snare' in filename: return 'snare'
    elif 'closedhh' in filename: return 'closed_hihat'
    # ... etc
```

**4. Pad Organization**
```python
def organize_samples_by_pad(samples: List[str]) -> Dict[int, tuple]:
    # Filter out Lick samples
    filtered = [s for s in samples if 'lick' not in Path(s).stem.lower()]

    # Categorize all samples
    categorized = group_by_type(filtered)

    # Fixed pad assignments
    pad_map[0:2] = kicks[:2]           # Pads 1-2
    pad_map[2:5] = snares+rims+claps[:3]  # Pads 3-5
    pad_map[5] = toms[0]               # Pad 6
    pad_map[6] = shakers[0]            # Pad 7
    # ... etc

    # Fill remaining pads (11-15) with leftover samples

    return pad_map  # {pad_index: (sample_path, color_index)}
```

**5. XML Transformation**
```python
def transform_xml(xml_content: str, sample_paths: List[str], start_pad: int = 0):
    # Parse ADG (gzipped XML)
    root = ET.fromstring(xml_content)
    drum_pads = root.findall(".//DrumBranchPreset")

    # CRITICAL: Sort DESCENDING - Ableton uses highest MIDI at pad 1
    drum_pads.sort(key=lambda pad: int(pad.find(".//ReceivingNote").get("Value")),
                   reverse=True)

    # Update sample paths starting at start_pad
    for sample_index, sample_path in enumerate(sample_paths):
        pad_index = start_pad + sample_index
        pad = drum_pads[pad_index]
        # Update FileRef Path and RelativePath elements
```

**6. Color Application**
```python
def apply_colors_to_xml(xml_content: str, pad_colors: Dict[int, int]):
    # Set DocumentColorIndex for each pad
    # Set AutoColored = false
```

### File Structure

```
scripts/device-creation/python/device/drum_rack/
├── main_battery_kit.py                  # Standard dual-kit (no organization)
├── batch_battery_kits.py                # Batch standard
├── main_battery_kit_organized.py        # Organized + color-coded dual-kit
├── batch_battery_kits_organized.py      # Batch organized
├── process_all_expansions.sh            # Process all 64 NI libraries
├── README_BATTERY_KITS.md               # Standard system docs
└── README_ORGANIZED.md                  # Organized system docs

utils/
├── decoder.py                           # Decompress ADG (gzip)
├── encoder.py                           # Compress to ADG
└── transformer.py                       # XML sample path replacement
```

## Workflow

### Batch Processing All Libraries

```bash
./process_all_expansions.sh
```

**Process**:
1. Find all Battery Kits folders in NI Expansions (64 libraries)
2. For each library, find all .nbkt files
3. Process kits in pairs (dual-kit racks)
4. Output to `templates/{Library Name} Battery Kits Organized/`

### Single Dual-Kit Creation

```bash
python3 main_battery_kit_organized.py \
  templates/input_rack.adg \
  "path/to/3onIt Kit.nbkt" \
  "path/to/7dee Kit.nbkt"
```

**Output**: `3onIt + 7dee.adg`
- Pads 1-16: 3onIt kit (14 samples, organized, color-coded)
- Pads 17-32: 7dee kit (16 samples, organized, color-coded)

## Results

### Amplified Funk Library Example

**Input**:
- 57 Battery Kit files
- Samples scattered across 9 Drums folders + 7 One Shots folders

**Output**:
- 19 dual-kit drum racks
- 38 kits loaded (76% of available kits)
- ~540 samples organized
- Consistent layout across all racks
- Color-coded for instant recognition

### Processing Statistics

- **Libraries Processed**: 62/64 (2 missing Battery Kits folders)
- **Total Racks Created**: ~600-800 (estimated)
- **Processing Time**: ~10-15 minutes for all 64 libraries
- **Efficiency**: 2x kits per file vs single-kit approach

## Consequences

### Positive

✅ **Massive Time Savings**: Automates weeks of manual work

✅ **Consistent Muscle Memory**: Same layout for every kit
- Kicks ALWAYS on pads 1-2
- Snares ALWAYS on pads 3-5
- Hihats ALWAYS on pads 9 & 11

✅ **Visual Organization**: Color-coded pads for instant recognition
- Red = Kicks (low-end power)
- Yellow = Snares/Claps (backbeat)
- Green = Shakers/Percussion (organic rhythm)
- Cyan/Blue = Hihats/Cymbals (crisp/airy)

✅ **Intelligent Filtering**: Removes unsuitable long samples automatically

✅ **Optimized Capacity**: Dual-kit packing uses full 32-pad rack

✅ **Batch Scalability**: Process entire library collection unattended

✅ **Template Preservation**: Unused pads keep useful template sounds

### Negative

⚠️ **Fixed Layout Limitations**: Can only assign one sample per pad position (except kicks get 2)

⚠️ **Pairing Requirement**: Odd-numbered kit collections skip the last kit

⚠️ **Generic Kit Names**: Kits like "Amplified Funk Kicks Kit 1" skip (no unique sample identifiers)

⚠️ **No Manual Override**: Can't customize pad assignments per kit

### Trade-offs

- **Automatic vs Manual**: Chose automatic organization, sacrificing per-kit customization
- **Dual-Kit vs Single-Kit**: Chose dual-kit for efficiency, sacrificing single-kit simplicity
- **16 Pads vs 32 Pads**: Chose 16-pad layout per kit for consistency, sacrificing some sample capacity
- **Color Consistency vs Variety**: Chose fixed color scheme, sacrificing visual variety

## Sample Categorization Rules

**Filtering (excluded)**:
- `'lick'` in filename → Too long for one-shot triggering

**Primary Assignments** (pads 1-11):
- `'kick'` → Pads 1-2 (first 2 kicks)
- `'snare'|'rim'|'sidestick'|'clap'|'snap'` → Pads 3-5 (first 3 combined)
- `'tom'` → Pad 6 (first tom)
- `'shaker'|'cabasa'` → Pad 7 (first shaker)
- `'perc'|'cowbell'|'bell'|'cuica'|'flexitone'|'conga'` → Pad 8 (first percussion)
- `'closedhh'|'closed'|'pedalhh'` → Pad 9 (first closed hihat)
- `'cymbal'|'crash'|'ride'` → Pad 10 (first cymbal)
- `'openhh'|'open'` → Pad 11 (first open hihat)

**Secondary Assignments** (pads 12-16):
- All remaining samples in order found

## Technical Details

### Ableton ADG Format

- **Format**: Gzipped XML
- **Decode**: `gzip.open()` → XML string
- **Modify**: `xml.etree.ElementTree` manipulation
- **Encode**: `gzip.GzipFile(mtime=0, filename='')` → ADG file

### Critical Implementation Detail

**Pad Order**: Ableton drum racks use **DESCENDING MIDI note order**:
- Pad 1 = MIDI 64 (highest)
- Pad 32 = MIDI 33 (lowest)

**Must sort with `reverse=True`**:
```python
drum_pads.sort(key=lambda pad: int(pad.find(".//ReceivingNote").get("Value")),
               reverse=True)
```

Without this, all pads are reversed!

### Color System

Uses Ableton's `DocumentColorIndex` (0-69 palette):
```xml
<DocumentColorIndex Value="60"/>  <!-- Red for kicks -->
<AutoColored Value="false"/>       <!-- Manual color, not auto -->
```

## Future Enhancements

Possible improvements for future iterations:

1. **Smart Pairing**: Algorithmically match complementary kits instead of alphabetical pairing
2. **Variable Kit Size**: Support 8-pad, 16-pad, or 32-pad layouts based on sample count
3. **Custom Pad Mapping**: Per-kit override configuration
4. **Velocity Layer Detection**: Automatically map velocity layers to single pads
5. **Round-Robin Support**: Detect and configure round-robin sample chains
6. **Metadata Preservation**: Extract and preserve Battery Kit metadata (tempo, key, etc.)
7. **MIDI Note Mapping**: Custom MIDI note assignments beyond default 33-64 range
8. **Macro Pre-Configuration**: Auto-map common controls to drum rack macros

## Related Systems

- **Preset Extraction** (`scripts/preset-extraction/`): Extract NI/Omnisphere presets
- **Generic Device Creation** (`scripts/device-creation/python/device/`): Sampler, Simpler
- **Device Tree Generation** (`scripts/generate-ableton-devices.js`): UI integration
- **Unified Device Configs** (ADR 033): Automatic parameter initialization

## Files Created

### Core Scripts

- **`main_battery_kit_organized.py`**: Single organized dual-kit processor (280 lines)
- **`batch_battery_kits_organized.py`**: Batch organized processor (140 lines)
- **`process_all_expansions.sh`**: Shell script to process all 64 NI libraries
- **`main_battery_kit.py`**: Standard dual-kit processor (no organization)
- **`batch_battery_kits.py`**: Standard batch processor

### Utilities (Modified)

- **`utils/transformer.py`**: Added `start_pad` parameter for partial replacement
  - Updated sorting to `reverse=True` for correct Ableton pad order

### Documentation

- **`README_BATTERY_KITS.md`**: Standard system documentation
- **`README_ORGANIZED.md`**: Organized system documentation
- **`documentation/adr/035-battery-kit-drum-rack-automation.md`**: This file

## Output Structure

```
scripts/device-creation/templates/
├── Amplified Funk Library Battery Kits Organized/
│   ├── 3onIt + 7dee.adg
│   ├── BluOut + Boog.adg
│   └── ... (19 racks total)
├── Sierra Grove Library Battery Kits Organized/
│   └── ... (8 racks)
└── ... (62 libraries total)
```

## Performance Metrics

**Processing Speed**:
- Single kit: ~0.5 seconds
- Dual kit: ~1 second
- Full library (57 kits): ~30 seconds
- All 64 libraries: ~10-15 minutes

**Efficiency Gains**:
- Manual time estimate: 100+ hours (create + organize + color-code)
- Automated time: 15 minutes
- Speedup: ~400x

## Example Output

**3onIt + 7dee.adg**:

```
Kit 1 (3onIt) - 14 samples, Lick filtered:
  Pad  1: Kick 3onIt 1.wav         [Red]
  Pad  2: Kick 3onIt 2.wav         [Red]
  Pad  3: Snare 3onIt 1.wav        [Yellow]
  Pad  4: Snare 3onIt 2.wav        [Yellow]
  Pad  5: Snap 3onIt.wav           [Yellow]
  Pad  6: Tom 3onIt 1.wav          [Orange]
  Pad  7: Shaker 3onIt.wav         [Green]
  Pad  9: ClosedHH 3onIt.wav       [Cyan]
  Pad 11: OpenHH 3onIt.wav         [Light Blue]
  Pads 12-15: Other samples        [Default]

Kit 2 (7dee) - 16 samples, Lick filtered:
  Pads 17-32: Same organized layout
```

## Validation

**Test Cases**:
1. ✓ Single kit with <16 samples (3onIt: 14 samples)
2. ✓ Single kit with 16 samples (7dee: 16 samples)
3. ✓ Single kit with >16 samples (BluOut: 19 → 16 used)
4. ✓ Dual kit combination
5. ✓ Lick sample filtering (3 samples removed from test)
6. ✓ Color coding verified in Ableton Live
7. ✓ Pad positions verified in Ableton Live
8. ✓ Batch processing 62 libraries

## Known Limitations

1. **Generic Kit Collections**: Kits without unique sample identifiers are skipped
   - Example: "Amplified Funk Kicks Kit 1" (samples don't contain "Amplified Funk Kicks 1")

2. **Odd Kit Counts**: Last kit skipped if library has odd number of kits
   - Workaround: Process remaining kit with single-kit script

3. **Sample Type Ambiguity**: Edge cases in categorization
   - "Pedal HH" categorized as Closed Hihat (could be debated)
   - "Sidestick" categorized as Rim (could be grouped with Snare)

4. **MIDI Note Order Discovery**: Required trial-and-error to discover Ableton uses descending order
   - Fixed with `reverse=True` in sorting

## References

- **Implementation**: `scripts/device-creation/python/device/drum_rack/`
- **Templates**: `scripts/device-creation/templates/input_rack.adg`
- **Output**: `scripts/device-creation/templates/*Organized/`
- **Related ADR 033**: Device Initialization System
- **Native Instruments**: Expansion library structure

---

**Last Updated**: 2025-10-11
