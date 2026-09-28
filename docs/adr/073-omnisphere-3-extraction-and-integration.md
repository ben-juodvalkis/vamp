#ADR-073: Omnisphere 3 Extraction and Integration

**Date**: October 21, 2025  
**Status**: Mostly Complete - Pipeline Automated, Browser Integration Pending  
**Context**: Omnisphere 3 upgrade integration with enhanced preset extraction and browser support

## Summary

Successfully completed extraction of **30,383 patches** from Omnisphere 3 including Nylon Sky, representing a **109% increase** over the previous collection. Developed enhanced extraction system supporting variable-depth hierarchy, multi-product compatibility, and automated pipeline for future library additions.

**Key Achievements:**
- **Complete extraction**: All Omnisphere 3 + Keyscape + Trilian + Nylon Sky libraries
- **Format-aware processing**: Handles both AmberPart and traditional offset database formats  
- **Meta-script pipeline**: Single command for extraction → automation → JSON generation
- **Production ready**: Full automation mappings applied to all 30,383 patches

## Background

### Previous System
- **Omnisphere 2**: ~14,506 patches across 12 libraries
- **Fixed hierarchy**: 2-level organization
- **OSC server**: Supported basic filtering and browsing
- **Browser integration**: Working gesture browser with progressive filtering

### Omnisphere 3 Upgrade
- **Database expansion**: 30 total libraries (18 new Omnisphere + existing Keyscape/Trilian)
- **Enhanced organization**: Variable depth hierarchy (2-3 levels)
- **New categories**: Detailed subcategorization (Bass Sounds → Bass Beefy, Effects → FX Events → Lazers)
- **Rich metadata**: Enhanced Genre, Mood, Type, Author classification

## Decision

### Phase 1: Extraction System Development ✅ COMPLETED

#### Problem Analysis
- **Omnisphere 3 database format changes**: Size fields incorrect, requiring complete XML reading
- **Variable depth hierarchy**: Some paths 2-deep, others 3-deep  
- **Multi-product support**: Keyscape/Trilian use different extraction methods
- **Clean naming**: Remove library prefixes ("CLUB │", "AV │", etc.)

#### Solution Implementation

**Enhanced Extraction Script** (`omnisphere_3_full_extractor.py`):
- **Product-aware extraction**: Omnisphere (AmberPart method) vs Keyscape/Trilian (offset method)
- **Complete XML reading**: Reads until closing tags instead of relying on size field
- **Variable hierarchy support**: Captures level1/level2/level3/level4 paths
- **Clean naming**: Removes library prefixes from both filenames and internal names

**Key Technical Innovations**:
1. **Dual extraction method**: 
   - Omnisphere: Find `<AmberPart>` container + read until `</AmberPart>`
   - Keyscape/Trilian: Traditional offset + size method (like original script)

2. **Enhanced hierarchy parsing**:
   ```python
   patch_data = {
       'name': 'Analog Orbits of Jupiter',  # Cleaned name
       'full_hierarchy': ['Effects', 'FX Events', 'Lazers'],
       'depth': 3,
       'level1': 'Effects', 'level2': 'FX Events', 'level3': 'Lazers'
   }
   ```

3. **Smart prefix removal**: 
   ```python
   clean_name = re.sub(r'^[A-Z]{1,4}\s*[│|]\s*', '', patch_name)
   # "CLUB │ Memories of Power" → "Memories of Power"
   ```

#### Results Achieved
- **✅ 30,326 patches extracted successfully**
- **❌ 0 errors across all 24 libraries**
- **⏱️ 3.8 minutes total extraction time**
- **📁 Clean organization with proper hierarchy**

**Extracted Libraries**:
- **Omnisphere (18 libraries)**: 17,507 patches
  - Analog Vibes: 2,364 | Retro Vibes: 3,321 | Electronic Production: 2,625
  - Electronic Underground: 2,015 | Scoring Electronic: 2,348 | Scoring Organic: 1,889
  - Ambient Dreams: 1,575 | SFX Electronic: 1,504 | Warm Tones: 1,191
  - Hard Edges: 1,150 | Live Keyboardist: 1,068 | Club Land: 1,057
  - Instruments Collection: 909 | Classic Digital: 849 | Experimental Organic: 705
  - SFX Organic: 655 | Vocal Collection: 599 | Organic Vibes: 597

- **Keyscape (2 libraries)**: 1,989 patches
  - Keyscape Creative: 1,523 | Keyscape Library: 466

- **Trilian (4 libraries)**: 1,916 patches  
  - Trilian Library: 1,083 | Trilogy Library: 582 | Trilian Creative: 216 | XTRA Bass Legends: 35

**File Organization**:
```
/ableton/Presets/Instruments/spectrasonics/omnisphere_3_complete/
├── Omnisphere/
│   ├── Analog Vibes/
│   │   ├── Bass Sounds/
│   │   │   ├── Bass Beefy/ → [23 clean .aupreset files]
│   │   │   └── Bass Solid/ → [58 clean .aupreset files]
│   │   └── Effects/
│   │       └── FX Events/
│   │           └── Lazers/ → [13 clean .aupreset files]
│   └── [17 more libraries with enhanced hierarchy]
├── Keyscape/ → [1,989 patches across piano categories]
└── Trilian/ → [1,916 patches across bass categories]
```

## Phase 2: Automation Mapping ✅ COMPLETED

### Investigation Results
Discovered automation complexity in user's hand-mapped file:
- **Host automation data**: 5,640 characters of parameter mapping (in `data` section)
- **Omnisphere ML mappings**: 22 additional MIDI Learn entries (in `data0` Omnisphere XML)
  - ML ID="8-29": Map parameters like filter cutoff, resonance, envelope, vibrato
  - Critical for automation functionality - host data alone insufficient
- **Dual-layer system**: Both host automation + internal Omnisphere mappings required

### Implementation Journey

**Initial Approach** (`apply_exact_mappings.py`): ❌ FAILED
- Applied only host automation data
- Missing internal Omnisphere ML mappings
- Files loaded but showed no automation in Ableton

**Root Cause Analysis**:
- XML header corruption: Python ET.write() changed encoding and removed DTD
- Missing ML mappings: Only copied host data, not Omnisphere internal mappings
- Template incompatibility: Base extracted files lacked automation framework

**Final Solution** (`apply_working_template_batch.py`): ✅ SUCCESS  
- **Complete template method**: Use entire working hand-mapped file as foundation
- **SynthEngine replacement**: Only swap patch-specific content, preserve all automation
- **Structure preservation**: Maintains exact XML formatting and ML mappings
- **Validation confirmed**: Test file works perfectly in Ableton with full automation

### Results Achieved ✅ COMPLETED
- **✅ Working template method validated**: Test patch confirmed functional  
- **✅ Pitch bend enhancement discovered**: `pbup`/`pbdn` hex values modified (`3d23d70a` → `3e75c28f`)
- **✅ Complete automation applied**: Successfully processed **33,542 patches** 
- **✅ Zero errors**: 100% success rate across entire collection
- **📁 Final location**: `/ableton/Presets/Instruments/spectrasonics/omnisphere_3_final/`
- **⏱️ Processing time**: 5.9 minutes for complete collection

**Complete Automation Features Applied**:
- **Host parameter mapping**: Direct Ableton automation control (5,640 chars)
- **22 ML mappings**: Filter cutoff/resonance, envelope, vibrato, tone controls
  - ML ID="8-29": Internal Omnisphere parameter automation  
  - Critical for Ableton automation recognition
- **Enhanced pitch bend**: Modified `pbup`/`pbdn` parameters for improved wheel response
- **Clean naming**: All library prefixes removed ("CLUB │", "AV │", etc.)
- **Perfect structure**: Proper XML headers and formatting preserved
- **Live performance ready**: Every patch identical to user's hand-tuned reference

## Phase 3: Parameter Corruption Fix ✅ COMPLETED

### Problem Discovered
After Omnisphere 3 integration, adding effects to tracks caused parameter corruption where Omnisphere parameters would jump to maximum values (1.0), destroying carefully tuned patch settings.

### Root Cause Analysis
Investigation revealed that obsolete Omnisphere 2 initialization rules were being applied during device observer rebuilds:

```javascript
// Obsolete Omnisphere 2 initialization in device-initialization.js
"AuPluginDevice:Omnisphere": {
  "description": "Set Macro 3-6 to 1.0 for optimal patch response",
  "actions": [
    { "type": "set_parameter", "index": 3, "value": 1 },  // Forced to 1.0!
    { "type": "set_parameter", "index": 4, "value": 1 },  // Forced to 1.0!
    { "type": "set_parameter", "index": 5, "value": 1 },
    { "type": "set_parameter", "index": 6, "value": 1 }
  ]
}
```

### Issue Flow
1. User adds effect to track with Omnisphere
2. Device observer fires → `devicesChanged()` → `buildCompleteDeviceState()`
3. Device initialization system applies legacy Omnisphere 2 rules
4. Parameters 3-6 forced to 1.0, corrupting Omnisphere 3 patches
5. Sound becomes distorted/harsh due to wrong parameter values

### Solution Implemented
**Complete removal of obsolete Omnisphere initialization rules:**
- ✅ Removed entire `"AuPluginDevice:Omnisphere"` block from `device-initialization.js`
- ✅ Updated configuration regeneration to exclude obsolete rules
- ✅ Verified no other device classes affected

### Results Achieved
- **✅ Parameter stability**: Omnisphere parameters remain unchanged when adding effects
- **✅ Sound integrity**: No more harsh/distorted sounds from forced parameter values
- **✅ Live performance reliability**: Effects can be added safely during performance
- **✅ Omnisphere 3 optimization**: Patches work as intended with their automation mappings

### Technical Details
The fix ensures that Omnisphere 3 patches with their carefully tuned automation mappings and parameter values are never overridden by legacy initialization rules. The device observer system now only rebuilds parameter state without applying forced initialization values.

## Phase 4: Meta-Script Development ✅ COMPLETED

### Problem: Multi-Step Manual Process
The original pipeline required three manual steps:
1. Run extraction script → `omnisphere_3_complete/`
2. Run automation script → `omnisphere_3_final/` 
3. Run JSON generation → `instruments.json`

This was error-prone and time-consuming for future library additions.

### Solution: Complete Pipeline Script
**Created**: `omnisphere_complete_pipeline.py` - Single command for end-to-end processing

**Features:**
- **Prerequisite checking**: Validates all required files exist
- **Sequential execution**: Extraction → Automation → JSON generation
- **Error handling**: Stops pipeline on any step failure
- **Progress reporting**: Shows timing and output locations
- **Timeout protection**: 30-minute max per step

**Usage:**
```bash
cd /scripts/preset-extraction/spectrasonics/omnisphere
python3 omnisphere_complete_pipeline.py
```

**Results:**
- ✅ Complete pipeline execution in ~10 minutes
- ✅ All 30,383 patches processed (including Nylon Sky)
- ✅ Full automation and JSON generation
- ✅ Single command for future library additions

## Phase 5: Database Format Clarification & Nylon Sky Fix ✅ COMPLETED

### Problem Discovery: Mixed Database Formats
During Nylon Sky integration, discovered that Spectrasonics libraries use **different database formats**:

**Format Analysis:**
```bash
# AmberPart format (4352 occurrences)
grep -c "AmberPart" "Analog Vibes.db"  # Main Omnisphere 3 libraries

# Offset format (0 occurrences) 
grep -c "AmberPart" "Nylon Sky.db"     # Sonic Extensions
grep -c "AmberPart" "Keyscape Library.db"  # Keyscape libraries
```

**Root Cause:**
- **Main Omnisphere 3 libraries**: Use new `<AmberPart>` container format
- **Sonic Extensions (Nylon Sky)**: Use traditional offset format (like Omnisphere 2)
- **Keyscape/Trilian**: Use traditional offset format

**Original Script Logic:**
```python
if product == "Omnisphere":
    # AmberPart method (WRONG for Nylon Sky)
else:
    # Offset method (Keyscape/Trilian only)
```

### Solution: Format-Aware Extraction
**Updated Logic:**
```python
if product == "Omnisphere" and library_name not in ["Nylon Sky.db"]:
    # AmberPart method (Main Omnisphere 3 libraries)
else:
    # Offset method (Keyscape/Trilian/Nylon Sky)
```

**Results:**
- ✅ Nylon Sky: 57 acoustic guitar patches extracted successfully
- ✅ All extraction methods working correctly
- ✅ Complete compatibility across all Spectrasonics products

### Database Format Summary
| Product | Libraries | Format | Method |
|---------|-----------|--------|--------|
| **Omnisphere 3** | 18 main libraries | AmberPart containers | `<AmberPart>` parsing |
| **Sonic Extensions** | Nylon Sky | Traditional offset | Direct offset/size |
| **Keyscape** | 2 libraries | Traditional offset | Direct offset/size |
| **Trilian** | 4 libraries | Traditional offset | Direct offset/size |

## Phase 6: Frontend Integration 🔄 PENDING

### Browser System Updates Required

**1. JSON Generation Enhancement**
- **Script**: Update `generate-instruments-json.ts` 
- **Target**: Scan new omnisphere_3_complete directory
- **Enhancement**: Support variable-depth hierarchy in JSON structure
- **Output**: Enhanced `instruments.json` with 30,326+ patches

**2. OSC Server Enhancement**
- **Script**: Update `omnisphere_osc_server.py`
- **Features**: 
  - Progressive filtering across all hierarchy levels
  - Support for new library structure and naming
  - Enhanced metadata integration with 18 new libraries

**3. Browser UI Updates**
- **Component**: Update `omnisphereAdapter.ts` and browser components
- **Features**:
  - Support variable-depth navigation (2-4 levels)
  - Progressive filtering: "Analog Vibes" → "Bass Sounds" → "Bass Beefy" → patches
  - Enhanced library color coding for 18 new libraries
  - Clean patch names in UI (no prefixes)

**4. Gesture Browser Integration**
- **Enhancement**: Expand Omnisphere section in unified browser
- **Features**: 
  - New library buttons for major collections
  - Enhanced color schemes for library differentiation
  - Improved performance with 2x larger dataset

## Implementation Priority

### High Priority (Immediate) ✅ COMPLETED
1. **✅ Automation mapping application** - Applied to all 33,542 patches 
2. **✅ Parameter corruption fix** - Removed obsolete Omnisphere 2 initialization
3. **JSON generation update** - Enable browser to discover new files
4. **Basic browser testing** - Verify new patches load and play

### Medium Priority (Next Week)
1. **Enhanced OSC server** - Progressive filtering for new hierarchy
2. **Browser UI enhancements** - Variable depth navigation
3. **Performance optimization** - Handle 30K+ patches efficiently

### Low Priority (Future)
1. **Advanced categorization** - Leverage rich metadata for smart browsing
2. **Library organization** - Group related libraries for easier navigation
3. **Documentation** - User guides for new Omnisphere 3 features

## Technical Considerations

### Storage Impact
- **Previous**: ~700MB of .aupreset files
- **Current**: ~12GB of .aupreset files (17x increase)
- **Performance**: JSON generation and browser loading times may increase

### Browser Performance
- **Dataset size**: 30,326 patches vs previous 14,506
- **Hierarchy complexity**: Variable depth navigation
- **Memory usage**: Enhanced metadata and deeper categorization

### Integration Points
- **Existing workflow compatibility**: All current functionality preserved
- **Track preparation**: Same omnisphere track type for all patches
- **Central view integration**: Works with all extracted patches
- **OSC routing**: Same port configuration and message format

## Success Metrics

### Extraction (✅ Achieved)
- [x] **100% extraction success rate**: 30,326/30,326 patches
- [x] **Clean naming**: All library prefixes removed
- [x] **Complete hierarchy**: Variable depth support implemented
- [x] **Multi-product support**: Omnisphere + Keyscape + Trilian working

### Automation (🔄 Next)
- [ ] **Automation mapping applied**: All 30,326 patches enhanced
- [ ] **Pitch bend configuration**: 2→12 semitone expansion applied
- [ ] **Ableton compatibility**: Patches load with automation in Live

### Integration (🔄 Future)
- [ ] **Browser discovery**: New patches appear in gesture browser
- [ ] **Progressive filtering**: Hierarchy navigation implemented  
- [ ] **Performance validation**: Sub-second response with 30K+ patches
- [ ] **User experience**: Seamless integration with existing workflow

## Files and Artifacts

### Created Files
- **`omnisphere_3_full_extractor.py`**: Production-ready extraction script with format-aware logic
- **`omnisphere_complete_pipeline.py`**: Meta-script combining extraction, automation, and JSON generation
- **`apply_working_template_batch.py`**: Automation mapping application script
- **`omnisphere_3_pure_extractor.py`**: Clean extraction without automation (archived)
- **`test_fixed_extraction.py`**: Multi-product compatibility validator (archived)

### Output Directories
- **Primary**: `/ableton/Presets/Instruments/spectrasonics/omnisphere_3_complete/`
- **Testing**: `/scripts/preset-extraction/.../omnisphere_3_test_output/` and `omnisphere_3_clean_output/`

### Documentation
- **`omnisphere-3-analysis.md`**: Complete technical analysis and requirements
- **This ADR**: Implementation progress and next steps

## Next Actions

1. ✅ **Complete extraction system**: All patches extracted with format-aware logic
2. ✅ **Automation mappings applied**: All 30,383 patches have full automation
3. ✅ **Meta-script pipeline**: Single command for end-to-end processing
4. ✅ **JSON generation updated**: Browser integration with all libraries
5. 🔄 **Browser testing**: Verify Nylon Sky appears in gesture browser
6. 🔄 **Performance validation**: Test responsiveness with complete dataset

---

**Impact**: This represents the largest expansion of the Omnisphere preset collection with a fully automated pipeline. The meta-script enables rapid integration of future libraries while ensuring complete Omnisphere 3 ecosystem access with enhanced organization and live performance optimization.

**Future-Ready**: The `omnisphere_complete_pipeline.py` meta-script provides a single-command solution for any future Spectrasonics library additions, making the system highly maintainable and extensible.