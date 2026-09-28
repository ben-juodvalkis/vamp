# ADR 069: Omnisphere Type-First Navigation Architecture

**Date:** 2025-10-23
**Status:** Superseded by ADR-112
**Deciders:** Ben Juodvalkis
**Tags:** UX, Navigation, Omnisphere, Performance

> **Note:** This ADR implemented Type → Style → Category → Library navigation. It was superseded by ADR-112 which implements Type → Category → Library navigation with recursive semantic category detection and enhanced folder grouping. See [ADR-112](112-omnisphere-semantic-category-detection.md) for current implementation including automatic folder grouping, deep-indexing validation, and smart generic category detection (Updated 2025-11-10).

---

## Context

The Omnisphere browser in the unified gesture browser system used style-first navigation (Style → Library → Type → Presets), which created workflow friction for musicians who think functionally ("I need bass") rather than stylistically ("I want something chill").

### Problems with Style-First Navigation

1. **Functional Friction**
   - Musicians think: "I need bass" → forced to guess which style has good bass
   - Required browsing through multiple styles to find all bass sounds
   - Hidden instruments: aggressive bass sounds might be in "Chill" style

2. **Incomplete Discovery** 
   - To find ALL bass sounds, users would need to navigate every style category
   - No cross-style visibility (Synth bass vs Instruments bass vs Chill bass)
   - Missed opportunities to discover sounds outside expected categories

3. **Library Duplication in UI**
   - Libraries like "Keyscape Library" appeared multiple times (10+ duplicates)
   - Happened because one library contains multiple instrument types
   - Created confusing, cluttered navigation experience

---

## Decision

Transform Omnisphere navigation from **Style-First** to **Type-First** with smart library display:

1. **Primary Navigation**: Type → Style → Library+Instrument → Presets
2. **Cross-Style Discovery**: Show ALL sounds of a type across ALL styles
3. **Clear Library Display**: Show "Library → Instrument" instead of duplicate library names
4. **Consolidate Categories**: 34 instrument types → 6 logical top-level categories

---

## Architecture

### Navigation Transformation

**Before (Style-First):**
```
Column 1: [Synth, Chill, Hybrid, Instruments]
Column 2: [Analog Vibes, Classic Digital, Club Land, ...] 
Column 3: [Bass, Strings, Pads, Keyboards, ...]
Column 4: [Individual presets]
```

**After (Type-First):**
```
Column 1: [ARP + BPM, Bass, Drums, Keys, Instruments, Synth]
Column 2: [Synth, Chill, Hybrid, Instruments] (styles that have selected type)
Column 3: [Library → Instrument] combinations
Column 4: [Individual presets]
```

### Type Consolidation Strategy

**34 Raw Types → 6 Logical Categories:**

1. **ARP + BPM** (20 entries) - Arpeggiated and tempo-synced patterns
2. **Bass** (18 entries) - All bass sounds (acoustic, electric, synth, key bass)
3. **Drums** (43 entries) - Drums, hits, percussion, percussive tonal
4. **Keys** (30 entries) - All keyboards, pianos, organs, clavinets, vintage keys
5. **Instruments** (77 entries) - Traditional instruments, vocals, world, retro
6. **Synth** (84 entries) - Synth leads, pads, textures, effects, distortion

### Library → Instrument Display

**Problem:** Libraries appeared as duplicates
```
❌ Confusing: [Keyscape Library, Keyscape Library, Keyscape Library, ...]
```

**Solution:** Show library context + specific instrument type
```
✅ Clear: [Keyscape Library → Acoustic Pianos, Keyscape Library → Electric Pianos, Keyscape Creative → Organs, ...]
```

---

## Implementation

### 1. Enhanced JSON Generation

**File:** `scripts/generate-instruments-json.ts`

**Added Function:**
```typescript
function buildOmnisphereTypeIndex(omnisphereTree, omnisphereGroups) {
  // Type consolidation mapping (34 → 6 categories)
  const typeConsolidation = {
    'Bass Sounds': 'Bass', 'Synth Bass': 'Bass',
    'Drums + Perc': 'Drums', 'Hits + Bits': 'Drums',
    'Keyboards': 'Keys', 'Organs': 'Keys', 'Acoustic Pianos': 'Keys',
    // ... complete mapping
  };
  
  // Build reverse index: type → [{style, library, path}]
  // Result: typeIndex with 6 categories mapping to filesystem locations
}
```

**Generated Data:**
- **typeIndex**: Maps 6 categories to their filesystem locations
- **Cross-referenced**: Each type knows which styles and libraries contain it
- **Path Mapping**: Enables navigation from user path to filesystem path

### 2. OmnisphereAdapter Rewrite

**File:** `interface/src/lib/services/adapters/omnisphereAdapter.ts`

**New Navigation Logic:**
```typescript
// Level 0: Show 6 instrument types
if (path.length === 0) {
  return Object.keys(this.typeIndex).sort(); // [ARP + BPM, Bass, Drums, Keys, ...]
}

// Level 1: Show styles that contain selected instrument type  
if (path.length === 1) {
  const availableStyles = [...new Set(typeEntries.map(entry => entry.style))];
  return availableStyles; // [Chill, Synth, Instruments, Hybrid]
}

// Level 2: Show library → instrument combinations
if (path.length === 2) {
  return styleEntries.map(entry => {
    const instrumentName = entry.path.split('/').pop();
    return `${entry.library} → ${instrumentName}`;
  }); // [Keyscape Library → Acoustic Pianos, ...]
}

// Level 3+: Parse format and use tree navigation
const [libraryName, instrumentName] = libraryInstrumentCombo.split(' → ');
// Maps back to filesystem paths for preset loading
```

### 3. Path Parsing System

**Challenge:** Navigate from user-friendly display back to filesystem structure

**Solution:** Bidirectional mapping
- **Display → Internal**: Parse "Keyscape Library → Acoustic Pianos" → find tree path
- **Internal → Filesystem**: Map logical path to actual preset locations
- **Maintains Performance**: All existing tree navigation and caching preserved

---

## Key Design Decisions

### 1. Type-First vs Style-First

**Decision:** Prioritize functional intent over stylistic browsing.

**Rationale:**
- Musicians think instrumentally first: "I need bass for this track"
- Style is secondary: "Maybe something chill" 
- Cross-style discovery more valuable than style silos
- Faster workflow for live performance

### 2. Six-Category Consolidation

**Decision:** Reduce 34 raw types to 6 logical groupings.

**Consolidation Logic:**
- **Functional Grouping**: Bass sounds regardless of source (acoustic/electric/synth)
- **Instrument Families**: All keyboards under "Keys" (pianos, organs, clavinets)
- **Performance Context**: "Drums" includes hits and percussion for rhythm section
- **User Mental Models**: Categories match how musicians think about instruments

### 3. Library → Instrument Display Format

**Decision:** Show both library context AND specific instrument type.

**Format Choice:** `"Library → Instrument"` with arrow separator

**Benefits:**
- **Clear Hierarchy**: Visual indication of library → instrument relationship
- **No Confusion**: Each button obviously represents different content
- **Maintained Context**: Library information preserved for user understanding
- **Elegant Parsing**: Easy to split back to components for navigation

### 4. Backward Navigation Compatibility

**Decision:** Preserve all existing tree navigation and preset loading.

**Implementation:**
- **Path Translation**: User paths mapped to filesystem paths transparently
- **Performance Maintained**: No additional filesystem queries required
- **Caching Preserved**: All existing adapter optimizations retained

---

## Consequences

### Positive

1. **Improved Workflow Efficiency**
   - Direct path from "I need bass" to bass sounds across entire collection
   - Cross-style discovery reveals unexpected sound combinations
   - Faster navigation for live performance (functional vs exploratory browsing)

2. **Enhanced Discoverability**
   - See ALL bass sounds in one navigation flow (Synth + Chill + Instruments styles)
   - Discover relationships between libraries and instrument types
   - Clear categorization reduces cognitive load

3. **Cleaner UI/UX**
   - Eliminated duplicate library names (Keyscape Library x10 → Keyscape Library → Piano Types)
   - Each navigation button has clear, distinct purpose
   - Better use of vertical space in browser columns

4. **Maintained Performance**
   - Same underlying tree navigation and caching
   - No additional filesystem queries or API calls
   - Hot-swappable between navigation approaches if needed

### Negative

1. **Different Mental Model**
   - Users familiar with style-first browsing need to adapt
   - Less obvious how to browse "all chill sounds" across instrument types
   - Category consolidation might hide some nuanced instrument distinctions

2. **Longer Button Text**
   - "Library → Instrument" format takes more screen space
   - Potential text wrapping on smaller screens
   - More complex button content to parse visually

3. **Path Complexity**
   - More sophisticated path parsing required in adapter
   - String manipulation for "Library → Instrument" format
   - Debugging paths requires understanding format translation

### Mitigations

**For Mental Model Adaptation:**
- Logical type categories match musician thinking patterns
- Cross-style discovery actually improves style-based browsing
- Could add style-first toggle in future if needed

**For UI Space Concerns:**
- Moved track meter to bottom-right to free vertical space
- Arrow separator (→) creates clear visual hierarchy
- Button auto-sizing handles text length gracefully

**For Technical Complexity:**
- Comprehensive logging for debugging path translation
- Error handling for malformed library → instrument strings
- Clear separation between user paths and filesystem paths

---

## Implementation Notes

### File Changes

**JSON Generation:**
- `scripts/generate-instruments-json.ts` - Added `buildOmnisphereTypeIndex()` function
- Type consolidation mapping: 34 raw types → 6 logical categories  
- Generated typeIndex stored in omnisphere vendor data

**Adapter Logic:**
- `interface/src/lib/services/adapters/omnisphereAdapter.ts` - Complete rewrite
- Type-first navigation logic at all path levels
- Library → Instrument format generation and parsing

**UI Layout:**
- `interface/src/lib/components/v6/browser/TopGestureBrowser.svelte` - Moved track meter to bottom-right
- Freed vertical space for type category navigation

### Data Structure

**Type Index Format:**
```json
{
  "typeIndex": {
    "Bass": [
      {"style": "Synth", "library": "Analog Vibes", "path": "Omnisphere/Analog Vibes/Bass Sounds"},
      {"style": "Chill", "library": "Warm Tones", "path": "Omnisphere/Warm Tones/Bass Sounds"},
      {"style": "Instruments", "library": "Trilian Library", "path": "Trilian/Trilian Library/Bass"}
    ],
    "Keys": [...],
    // ... other categories
  }
}
```

**Navigation Path Examples:**
- User Path: `['Keys', 'Instruments', 'Keyscape Library → Acoustic Pianos']`
- Filesystem Path: `['Keyscape', 'Keyscape Library', 'Acoustic Pianos']`

### Testing Strategy

- **Cross-style verification**: Bass category shows bass from all 4 style groups
- **Library parsing**: "Library → Instrument" strings correctly map to filesystem
- **Random selection**: Works from any navigation level (type, style, or specific instrument)
- **Performance validation**: No regression in navigation or loading speed

---

## Metrics

### Navigation Efficiency

| Workflow | Before | After | Improvement |
|----------|--------|-------|-------------|
| Find ALL bass sounds | Navigate 4 styles | Navigate 1 category | 75% reduction |
| Specific instrument | Style → Library → Type | Type → Style → Library | Direct intent |
| Cross-style discovery | Manual style browsing | Automatic aggregation | Complete coverage |

### UI Clarity

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Duplicate entries | 10x "Keyscape Library" | 10x distinct buttons | 100% clarity |
| Button specificity | Ambiguous library names | "Library → Instrument" | Clear purpose |
| Category count | 34 scattered types | 6 logical categories | 83% simplification |

### Data Organization

| Aspect | Count | Structure |
|--------|-------|-----------|
| Top-level categories | 6 | ARP + BPM, Bass, Drums, Keys, Instruments, Synth |
| Type index entries | 272 | All library+type combinations mapped |
| Preset coverage | 32,904 | Complete Omnisphere collection |

---

## Future Considerations

### Potential Enhancements

1. **Dual Navigation Mode**
   - Toggle between type-first and style-first approaches
   - User preference persistence
   - Different workflows for different use cases

2. **Smart Filtering**
   - Filter libraries by instrument type availability
   - Hide empty categories dynamically
   - Search within type categories

3. **Visual Hierarchy**
   - Color-coded library sources in "Library → Instrument" display
   - Visual grouping of related instrument types
   - Breadcrumb navigation for complex paths

4. **Performance Optimization**
   - Preload popular type+style combinations
   - Cache library → instrument mappings
   - Virtual scrolling for large type categories

### Success Criteria

✅ **Workflow Improvement**: Musicians can find specific instrument types efficiently  
✅ **Cross-Style Discovery**: Users discover sounds across style boundaries  
✅ **UI Clarity**: No duplicate library names, clear button purposes  
✅ **Technical Quality**: No performance regression, robust error handling  
✅ **Maintainability**: Clean adapter architecture, comprehensive logging  

---

## Related Decisions

- **ADR 018:** Gesture Browser Architecture - Established unified browser foundation
- **ADR 009:** Gesture-First Browser - Original gesture interaction model
- **ADR 063:** Omnisphere 3 Extraction - Extraction of Omnisphere preset data

---

## Decision Outcome

**Accepted** - Type-first navigation with library → instrument display successfully implemented and validated.

**Next Steps:**
- User testing and feedback collection
- Monitor navigation patterns and usage analytics  
- Consider dual-mode toggle based on user preferences
- Potential expansion to other vendor browsers (NI, Ableton)