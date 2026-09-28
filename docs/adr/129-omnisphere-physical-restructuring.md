# ADR 020: Omnisphere Physical Restructuring with Symlinks

**Status**: Complete (99.1% Coverage)
**Date**: 2025-01-10 (Updated: 2025-01-14)
**Deciders**: BJ
**Related**: [ADR-018: Gesture Browser Architecture](018-gesture-browser-architecture.md), [Omni Redesign Documentation](451-omni-redesign.md)

**Update 2025-01-14**:
- Completed comprehensive coverage audit and fixes. Achieved 99.1% coverage (33,284 of 33,599 presets). See "Post-Implementation Fixes" section below.
- Keys category refactored to type-first organization (Phase 5): Moved Keyscape Acoustic Pianos, Electric Pianos, and Clavinets into type-based categories for consistent discovery pattern.

## Context

The Omnisphere browser implementation had evolved into a complex system with ~1,200 lines of runtime logic spread across multiple files:
- `hierarchicalOmnisphereAdapter.ts` (~500 lines): Complex type detection and path translation
- `omnisphereAdapter.ts` (~400 lines): Legacy adapter with style-based grouping
- `consolidationTypes.ts` (~100 lines): Dynamic consolidation engine
- `consolidationRules.ts` (~200 lines): Model variant consolidation rules
- `build-hierarchical-index.ts` (~476 lines): Multi-level index builder

This complexity created several problems:
1. **Difficult to verify**: No way to visually inspect the structure before running the app
2. **Hard to debug**: Complex runtime path translation and consolidation logic
3. **Brittle**: Changes required coordinated updates across multiple files
4. **Performance overhead**: Runtime type detection, consolidation, and path translation
5. **Inconsistent**: Different navigation patterns than drums/melodic browsers

## Decision

We will **physically restructure the Omnisphere folder hierarchy using symlinks** during the extraction pipeline, creating a clean producer-friendly structure that can be browsed like any other vendor.

### Approach: Build-Time Restructuring vs Runtime Logic

Instead of complex runtime logic to navigate the original Spectrasonics folder structure, we:
1. **Create symlinks** during extraction to reorganize presets into a new hierarchy
2. **Use declarative rules** to define the desired structure
3. **Leverage the simple UnifiedAdapter** (same as drums/melodic) for runtime navigation

### Restructuring Implementation

**Script**: `scripts/restructure-omnisphere.ts` (~1,630 lines)

**Output**: `omnisphere_restructured/` directory with symlinks

**Structure Created**:
```
omnisphere_restructured/
├── Bass/              (2,830 presets - type-first)
│   ├── Acoustic/
│   ├── Electric/
│   ├── Key Bass/
│   └── Synth Bass/
│
├── Drums/             (2,295 presets - type-first)
│   ├── Kicks/
│   ├── Snares/
│   ├── HiHats/
│   └── [6 more types]
│
├── Keys/              (2,084 presets - type-first)
│   ├── Pianos/        (Type-first: Acoustic Pianos + Omnisphere libraries by style)
│   ├── Electric Pianos/ (Type-first: Keyscape models + Omnisphere categories)
│   ├── Organs/        (Type-first: All organs from all libraries)
│   ├── Plucked/       (Type-first: Clavinets + Acoustic plucked keyboards)
│   ├── Trons/         (Type-first: Mellotron/optical keyboards + Harmochord)
│   ├── Metal/         (Type-first: Belltone, Toy Piano, Synth Celeste)
│   └── Synth Keys/    (Type-first: Keyscape Digital, Specialty Keys, Lo-Fi, Hybrid/Duo, Quirky)
│
├── Instruments/       (~4,500 presets - type-first)
│   ├── Bell Tones/    (17 libraries)
│   ├── Guitars/       (10 libraries)
│   ├── Strings/       (13 libraries)
│   ├── Picked and Plucked/
│   ├── Percussive Tonal/
│   ├── Percussive Organic/
│   ├── Vocals/
│   └── Winds/
│
├── FX/                (~4,000+ presets - type-first)
│   ├── FX Events/
│   ├── FX Sustained/
│   ├── FX Transitions/
│   ├── Distortion/
│   ├── Electronic Mayhem/
│   ├── Noisescapes/
│   └── Soundscapes/
│
├── Synth/             (~12,000+ presets - hybrid)
│   ├── Synths/        (Type-first: Synth Lead, Synth Poly, etc.)
│   ├── Pads/          (Library-first: preserves rich internal structure)
│   └── Textures Playable/ (Library-first)
│
└── ARP + BPM/         (~3,300+ presets - library-first)
    └── [20 libraries with unique internal organization]
```

**Total: ~31,000+ presets across 7 top-level categories**

### Key Implementation Patterns

**1. Declarative Restructuring Rules**:
```typescript
interface RestructuringRule {
    sourcePaths: string[];      // Source in omnisphere_3_final/
    targetPath: string;         // Target in omnisphere_restructured/
    action: 'symlink' | 'flatten-and-symlink';
    description?: string;
}
```

**2. Reusable Helpers**:
- `buildHierarchicalRulesWithFlattening<T>()`: Generic type-first organization with auto-flattening
- `symlinkByPrefix()`: Split mixed-content folders by filename prefix
- `scanLibraryForInstruments()`: Dynamic discovery of instrument folders

**3. Organization Strategy - Type-First**:
Keys category now uses **type-first organization** throughout:
- **Pianos**: `Keys/Pianos/Acoustic Pianos` + `Keys/Pianos/[Style]/[Library]` - Keyscape Acoustic Pianos at top level, Omnisphere libraries grouped by style
- **Electric Pianos**: `Keys/Electric Pianos/[models]` - All electric pianos with Keyscape models (Pianet, Rhodes, Wurlitzer, DUO, Electric Grand) at top level alongside Omnisphere categories (Analog EPs, Digital EPs, Rhodes Synth)
- **Plucked**: `Keys/Plucked/Clavinets` + `Keys/Plucked/[Library]` + `Keys/Plucked/Acoustic/` - All clavinets and plucked keyboards consolidated
- **Organs**: `Keys/Organs/[Style]/[Library]` - All organs grouped by style
- **Trons**: `Keys/Trons/[Library]` + `Keys/Trons/Harmochord` - All Mellotron/optical keyboards including Harmochord
- **Metal**: `Keys/Metal/[Category]` - All metallic keyboard sounds (Belltone, Toy Piano, Synth Celeste)
- **Synth Keys**: `Keys/Synth Keys/[Type]/[Library]` - Specialty synth keyboards (includes Keyscape Digital, Hybrid/Duo)

**Note**: Keyscape Library presets are fully integrated into type-first categories. The Keyscape folder no longer exists - all presets distributed to their respective type categories. Electric Piano models from Keyscape are at the top level alongside Omnisphere categories for flat, easy browsing.

This matches the Drums pattern: "I need a clavinet" → `Keys/Plucked/Clavinets`

**4. Intelligent Flattening**:
- Single library? → Show presets directly (e.g., Noisescapes)
- Multiple libraries? → Keep library folders (e.g., Synth Poly/[14 libraries])

### Integration Points

**1. Extraction Pipeline** (`omnisphere_complete_pipeline.py`):
```python
# Step 1: Extract from DBs → omnisphere_3_complete/
# Step 2: Apply automation → omnisphere_3_final/
# Step 3: Restructure → omnisphere_restructured/  ← NEW
# Step 4: Generate JSON
# Step 5: Cleanup
```

**2. JSON Generator** (`generate-instruments-json.ts`):
```typescript
// Changed from: omnisphere_3_final
const omnispherePath = path.join(folderPath, 'omnisphere_restructured');
```

**3. Browser Adapter** (`adapters/index.ts`):
```typescript
// Before: HierarchicalOmnisphereAdapter (~500 lines)
// After:  UnifiedAdapter (same as drums/melodic!)
if (vendorId === 'omnisphere') {
    return new UnifiedAdapter(vendorId);
}
```

## Consequences

### Positive

1. **Massive Simplification**: Eliminated ~1,200 lines of complex runtime logic
2. **Visual Verification**: Can inspect structure in Finder with `open omnisphere_restructured/`
3. **Zero Disk Space**: Symlinks add negligible overhead
4. **Consistent UX**: Same navigation pattern as drums/melodic browsers
5. **Better Performance**: No runtime consolidation, type detection, or path translation
6. **Maintainable**: Declarative rules easier to understand and modify
7. **Producer-Friendly**: Type-first organization matches workflow ("I need synth leads" vs "I want Electronic Production sounds")
8. **Automated**: Runs as part of extraction pipeline

### Negative

1. **Build-Time Requirement**: Must run restructuring script to create tree
   - *Mitigated*: Integrated into extraction pipeline, runs automatically
2. **Larger Restructuring Script**: 1,630 lines vs runtime logic
   - *Acceptable*: Runs once during extraction, not every app launch
3. **Symlink Limitations**: Could break if files moved
   - *Mitigated*: Source files (omnisphere_3_final) are stable
4. **Learning Curve**: New contributors need to understand restructuring approach
   - *Mitigated*: Well-documented with clear examples

### Migration Path

**Immediate** (Completed):
- ✅ Run `restructure-omnisphere.ts` to create `omnisphere_restructured/`
- ✅ Update `generate-instruments-json.ts` to scan restructured tree
- ✅ Change adapter from HierarchicalOmnisphereAdapter to UnifiedAdapter
- ✅ Integrate into extraction pipeline

**Future** (Optional):
- Clean up old adapter files (hierarchicalOmnisphereAdapter.ts, consolidationTypes.ts, etc.)
- Remove style-based grouping logic from JSON generator
- Add remaining niche categories (Retro Land, Hits + Bits) if desired

## Examples

### Before (Complex Runtime Logic):
```typescript
// Complex path translation
if (path[0] === 'Keys') {
    const category = this.detectCategory(path[1]);
    const consolidatedType = this.consolidateModel(path[2]);
    const library = this.findLibrary(path[3]);
    // ... more complexity
}
```

### After (Simple Tree Navigation):
```typescript
// Just navigate the tree!
let node = vendor.tree;
for (const folderName of path) {
    node = node.folders[folderName];
}
return Object.keys(node.folders);
```

### Restructuring Rule Example:
```typescript
// Consolidate Keyscape Electric Pianos
{
    sourcePaths: [
        'Keyscape/Keyscape Library/Keyboards/Electric Pianos/DUO - Dyno-My Rhodes',
        'Keyscape/Keyscape Library/Keyboards/Electric Pianos/DUO - Sparkle Tines',
        // ... 8 more DUO variants
    ],
    targetPath: 'Keys/Keyscape/Electric Pianos/DUO Sounds',
    action: 'flatten-and-symlink',
    description: 'Keyscape Electric Pianos - DUO Sounds (consolidated 10 variants)'
}
```

## References

- [Omni Redesign Documentation](451-omni-redesign.md): Complete Phase 2 implementation details
- [ADR-018: Gesture Browser Architecture](018-gesture-browser-architecture.md): Original unified browser design
- `scripts/restructure-omnisphere.ts`: Implementation (~1,630 lines)
- `scripts/preset-extraction/spectrasonics/omnisphere/omnisphere_complete_pipeline.py`: Extraction pipeline

## Post-Implementation Fixes (2025-01-14)

After initial implementation, a comprehensive preset-level audit revealed missing categories. Three phases of fixes brought coverage from initial ~95% to 99.1%.

### Phase 1: FX Category Expansion (366 presets)

**Issue**: FX Natural and FX Animals subfolders were not included in restructuring.

**Fix**: Added to `fxTypeNormalization` and `styleGroupedFXTypes`:
```typescript
'FX Natural': 'FX Natural',
'FX Animals': 'FX Animals'
```

**Result**:
- FX/FX Natural/ → SFX Organic (Wind, Water, Fire, etc.) - 238 presets
- FX/FX Animals/ → SFX Organic (Birds, Whales, Crickets, etc.) - 128 presets

### Phase 2: Hits + Bits Category (675 presets)

**Issue**: One-shot hits and impacts category completely missing.

**Fix**: Added Hits + Bits as FX category with style grouping:
```typescript
// In fxTypeNormalization
'Hits + Bits': 'Hits and Bits',
'Hits and Bits': 'Hits and Bits'

// Added direct folder scanning in Omnisphere libraries
// Added to styleGroupedFXTypes for style organization
```

**Result**:
```
FX/Hits and Bits/
  ├── Synth/ (5 libraries, 349 presets)
  ├── Chill/ (2 libraries, 93 presets)
  ├── Hybrid/ (6 libraries, 220 presets)
  └── Organic/ (1 library, 13 presets)
```

### Phase 3: Trilian/Trilogy Library Synth Scanning (147 presets)

**Issue**: Script scanned Omnisphere + Creative libraries for synth categories but not Trilian/Trilogy Library folders.

**Fix**: Added scanning for Trilian Library and Trilogy Library in `addSynthRules()`:
```typescript
// Scan Trilian Library
const trilianLibraryPath = path.join(OMNISPHERE_BASE, 'Trilian/Trilian Library');
// [scanning logic for Synth Mono, etc.]

// Scan Trilogy Library
const trilogyLibraryPath = path.join(OMNISPHERE_BASE, 'Trilian/Trilogy Library');
// [scanning logic]
```

**Result**:
- Synth Mono → Lead category (139 + 8 = 147 presets)
- Mapped to Synth/Synths/Lead/Organic/

### Phase 4: Retro Land Category (76 presets)

**Issue**: Keyscape/Trilian Creative "Retro Land" folders not mapped.

**Fix**: Added Retro Land to Keys restructuring:
```typescript
// Keyscape Creative Retro Land → Keys/Pianos
keysTypeMap['Pianos'].push({...});

// Trilian Creative Retro Land → Keys/Synth Keys
synthKeysTypeMap['Hybrid'].push({...});
```

**Result**:
- Keys/Pianos/Hybrid/Keyscape Creative/Retro Land (76 presets)
- Keys/Synth Keys/Hybrid/Trilian Creative/Retro Land (5 presets, but subfolder structure caused 5 to remain unmapped)

### Final Coverage Statistics

| Metric | Value |
|--------|-------|
| **Total Presets** | 33,599 |
| **Covered** | 33,284 (99.1%) |
| **Missing** | 315 (0.9%) |
| **Presets Fixed** | 1,211 |

**Remaining Missing (315 presets)**:
- Trilian/Trilogy Library Bass Instruments (296 presets) - Intentionally not critical
- Omnisphere misc Synths categories (13 presets) - Edge cases
- Trilian Creative Retro Land subfolder (5 presets) - Nested folder structure
- Misc drum preset (1 preset)

### Tools Created

**Preset-Level Audit Script** (`scripts/audit-omnisphere-presets.ts`):
- Checks every individual `.aupreset` file
- Builds index of restructured folder following symlinks
- Reports missing presets by product/library/category
- Identifies duplicate presets (6,945 found - intentional due to cross-library sharing)
- Ground truth for coverage verification

This replaces the category-based audit which had false positives due to normalization/consolidation.

### Phase 5: Keys Category Type-First Consolidation (2025-01-14)

**Issue**: Keys category had inconsistent organization - Keyscape was library-first while other sources needed type-first discovery.

**Changes Made**:

1. **Acoustic Pianos** moved to type-first:
   - Before: `Keys/Keyscape/Acoustic Pianos`
   - After: `Keys/Pianos/Acoustic Pianos`
   - Keyscape Acoustic Pianos at top level alongside Omnisphere style-grouped libraries

2. **Electric Pianos** moved to type-first and flattened:
   - Before: `Keys/Keyscape/Electric Pianos/[models]`
   - After: `Keys/Electric Pianos/[models]`
   - Keyscape models flattened to top level: Pianet (consolidated Hohner Pianet + Weltmeister Claviset), Rhodes, Wurlitzer, DUO, Electric Grand
   - Omnisphere categories: Analog EPs, Digital EPs, Rhodes Synth (renamed from "Rhodes" for clarity)

3. **Plucked** consolidated as new top-level category:
   - Created: `Keys/Plucked/`
   - Moved: `Keys/Keyscape/Clavinets` → `Keys/Plucked/Clavinets`
   - Moved: `Keys/Keyscape/Plucked Keyboards/` → `Keys/Plucked/Acoustic/` (Clavichord, Dolceola, Electric Harpsichord)
   - Extracted: Omnisphere "Clavs" from Synth Keys → `Keys/Plucked/[Library]`
   - **Total**: 5 libraries consolidated (Clavinets, Analog Vibes, Electronic Production, Live Keyboardist, Retro Vibes)

4. **Metal** consolidated as new top-level category:
   - Created: `Keys/Metal/`
   - Moved: `Keys/Keyscape/Belltone Keyboards` → `Keys/Metal/` (flattened - Celeste, Chimeatron, Dulcitone, Belltone DUO)
   - Moved: `Keys/Keyscape/Toy Pianos` + `Mini Pianos` → `Keys/Metal/Toy Piano` (flattened all models)
   - Extracted: Omnisphere "Celeste" from Synth Keys → `Keys/Metal/Synth Celeste`
   - **Contents**: All metallic keyboards in one flat structure for easy browsing

5. **Trons** enhanced with Harmochord:
   - Moved: `Keys/Keyscape/Wind Keyboards/Harmochord` → `Keys/Trons/Harmochord`
   - Harmochord grouped with Mellotron/optical keyboards

6. **Vintage Digital Keys** moved to Synth Keys:
   - Before: `Keys/Keyscape/Vintage Digital Keys`
   - After: `Keys/Synth Keys/Keyscape Digital`
   - Groups vintage digital synth keyboards with other synth keyboards

7. **Hybrid Pianos** moved to Synth Keys:
   - Before: `Keys/Keyscape/Hybrid Pianos`
   - After: `Keys/Synth Keys/Hybrid/Duo`
   - Flattened all "Duo - X" hybrid piano variants into Synth Keys/Hybrid category

**Result**: Keys category now follows consistent type-first organization matching Drums/Bass patterns. Producers can find all instruments of a type in one place regardless of source library. **The Keyscape folder no longer exists** - all presets have been fully distributed to their respective type categories.

**Naming Convention**: Electric Piano models from Keyscape are placed directly at the top level of the Electric Pianos folder for easy discovery. Omnisphere Rhodes sounds are renamed to "Rhodes Synth" to distinguish from Keyscape's authentic sampled Rhodes. Pianet consolidates all pianet-style instruments (Hohner Pianet variants + Weltmeister Claviset).

**Updated Files**:
- `scripts/restructure-omnisphere.ts` - Added Plucked and Metal type maps, extraction logic, integrated all Keyscape Library presets
- `documentation/adr/020-omnisphere-physical-restructuring.md` - Updated structure documentation

## Notes

This approach represents a paradigm shift from "clever runtime logic" to "simple build-time preparation." The restructured tree can be inspected, verified, and modified without touching any code. The runtime system is now trivially simple - just like browsing any folder structure.

The success of this approach suggests similar patterns could be applied to other complex preset libraries in the future.

**Key Learning**: Preset-level auditing (checking actual files) is essential for verifying coverage. Category-based auditing produced false positives because categories get normalized and consolidated during restructuring (e.g., "Synth Mono" + "Synth Lead" → "Lead").

**Type-First Consistency**: The Keys category refactor (Phase 5) demonstrates the value of consistent type-first organization. By fully integrating all Keyscape Library presets into their respective type categories (Pianos, EPs, Plucked, Trons, Metal, Synth Keys), we eliminated the need for users to remember which library contains which instrument type. This matches how producers think: "I need a clavinet" → navigate directly to `Keys/Plucked/Clavinets`, rather than "I need to check Keyscape and then check Omnisphere libraries."
