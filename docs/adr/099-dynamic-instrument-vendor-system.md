# ADR 099: Dynamic Instrument Vendor System

**Status:** Accepted
**Date:** 2025-10-31
**Authors:** Claude Code
**Context:** Instrument browser vendor configuration and UI sidebar updates

## Context

The instrument browser previously used hardcoded vendor configurations in two places:
1. Generation script had hardcoded paths for `Ableton`, `native-instruments`, and `spectrasonics`
2. Browser UI component had hardcoded vendor buttons and state initialization

This created maintenance overhead when:
- Adding new instrument libraries required code changes in multiple files
- Reorganizing the folder structure required updating TypeScript code
- Vendor IDs needed to be kept in sync between script and UI

Additionally, sidebar buttons (Bass, Guitar) were loading unwanted presets when users only wanted to prepare empty audio tracks.

## Decision

### 1. Fully Dynamic Instrument Vendor System

**Generation Script Changes:**
- Removed `VENDOR_CONFIG` mapping
- Script now automatically scans all folders in `/Instruments/`
- Each folder (except `spectrasonics`) becomes a vendor automatically
- Folder name is used as display name
- Special case: `spectrasonics` → "Omni" with nested `omnisphere_3_final` handling

**Browser UI Changes:**
- Vendors are loaded dynamically from `/data/instruments.json` on component mount
- Vendor buttons created from JSON data automatically
- Color palette assigns colors to vendors based on index
- Vendor states initialized dynamically based on loaded vendors

### 2. Removed Bass Button, Fixed Guitar Button

**Sidebar Changes:**
- Removed Bass button entirely from UI
- Removed Bass track type configuration
- Guitar button now creates empty audio track (removed effects loading)

**Track Type Configuration:**
- Updated `config/trackTypes.json` to remove Guitar effects preset
- Guitar now only sets sub-routing channel 3 without loading any effects

### 3. Hidden Effect Racks from Audio Browser

**Audio Browser Changes:**
- Modified `generate-instruments-json.ts` to comment out Effect Racks folder inclusion
- Effect files still exist on disk but aren't visible in browser
- Easy to re-enable by uncommenting lines 540-546

## Implementation Details

### File Structure
```
Instruments/
├── Drums/          → Auto-generated "Drums" button
├── Melodic/        → Auto-generated "Melodic" button
└── spectrasonics/  → Special handling → "Omni" button
    └── omnisphere_3_final/
```

### Code Changes

1. **scripts/generate-instruments-json.ts** (lines 385-461)
   - Removed vendor configuration mapping
   - Added dynamic folder scanning
   - Special case logic for `spectrasonics`

2. **UnifiedGestureBrowser.svelte** (lines 13-50, 62-63)
   - Added `onMount` to fetch vendors from JSON
   - Dynamic vendor state initialization
   - Color palette assignment

3. **config/trackTypes.json**
   - Guitar: `effects: []` (was loading Guitar.adg)
   - Bass: Removed entirely

4. **generate-instruments-json.ts** (lines 539-547)
   - Commented out Effect Racks folder inclusion

## Consequences

### Positive

1. **Zero-Configuration Vendor Addition**
   - Drop a folder in `/Instruments/`, run generation, done
   - No TypeScript code changes needed
   - No manual UI configuration required

2. **Single Source of Truth**
   - `instruments.json` is the only place vendor data exists
   - UI automatically reflects generation output
   - No sync issues between script and UI

3. **Cleaner Sidebar**
   - Removed unused Bass button
   - Guitar button does what users expect (empty track)
   - Audio browser shows only relevant content

4. **Maintainable**
   - Easy to add/remove/reorganize instruments
   - Clear special-case handling for Omnisphere
   - Self-documenting folder structure

### Negative

1. **Initial Load**
   - Slight delay fetching `instruments.json` on browser mount
   - Mitigated: JSON is cached after first fetch

2. **Vendor Order**
   - Vendors appear in filesystem order (may vary by OS)
   - Could add explicit ordering config if needed

3. **Track Type Inference**
   - All auto-generated vendors default to `drum_rack` track type
   - May need per-folder track type config in future

### Neutral

1. **Omnisphere Still Special**
   - Nested path handling still required
   - OSC groups and type index still hardcoded
   - This is appropriate given Omnisphere's unique structure

## Alternatives Considered

### 1. Keep VENDOR_CONFIG with Defaults
- Rejected: Still requires maintaining configuration
- Dynamic approach is simpler and more flexible

### 2. Metadata Files Per Folder
- Considered: Each folder could have a `vendor.json` config
- Rejected: Unnecessary complexity for current needs
- Could be added later if per-folder customization is needed

### 3. Keep Bass Button
- Rejected: User feedback indicated it wasn't needed
- Guitar and Mic buttons provide sufficient audio track creation

## Related ADRs

- ADR 018: Centralized Track Types Configuration
- ADR 017: Audio Browser V2 Implementation
- ADR 018: Gesture Browser Architecture

## Migration Notes

**For Existing Setups:**
1. Run `npm run generate-instruments` to regenerate JSON with new structure
2. No manual browser configuration needed - vendors load automatically
3. If Bass track type was used, replace with Guitar or custom configuration

**Future Additions:**
To add a new instrument library:
```bash
# 1. Add folder to Instruments directory
mkdir /path/to/Instruments/MyNewLibrary

# 2. Add presets (.adg/.aupreset files) in any subfolder structure
cp -r /path/to/presets/* /path/to/Instruments/MyNewLibrary/

# 3. Regenerate JSON
npm run generate-instruments

# 4. Reload browser - new "MyNewLibrary" button appears automatically
```

## Notes

- Effect Racks can be re-enabled by uncommenting lines 540-546 in generation script
- Color palette has 8 colors; cycles if more vendors exist
- Omnisphere special handling preserved due to its unique nested structure and OSC integration
- Track type defaults to `drum_rack` for auto-generated vendors (appropriate for most Ableton device groups)
