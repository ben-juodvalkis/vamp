# ADR-112: Omnisphere Semantic Category Detection and Category-First Navigation

**Date:** 2025-11-09 (Updated: 2025-11-10)
**Status:** Implemented + Enhanced
**Relates to:** #153, ADR-080, ADR-111

## Context

The Omnisphere browser implemented type-first navigation (Type → Style → Category → Library) in ADR-080. However, this created discoverability issues:

1. **Category Fragmentation**: Same category appeared in multiple navigation paths
   - Example: "Organs" in `Keys → Instruments → Organs` AND `Keys → Chill → Organic Vibes → Keyboards → Organs`
   - Users had to navigate multiple style paths to find all instances of a category

2. **Inconsistent Library Structure**: Older libraries (Keyscape, Trilian) used flat structure while newer libraries (Club Land, Live Keyboardist, Organic Vibes) used nested structure:
   - Old: `Keyscape Creative/Organs` (2 levels deep)
   - New: `Organic Vibes/Keyboards/Organs` (3 levels deep)
   - The original typeIndex scanner only went 3 levels deep from library root, missing nested categories

3. **Context-Dependent Categorization**: Some folder names like "Electric" and "Acoustic" needed different treatment:
   - In bass libraries: Should appear under Bass type
   - In guitar libraries: Should remain under Instruments type

## Decision

Implement **category-first navigation** with **recursive semantic category detection**:

### 1. Category-First Navigation

Replace Type → Style → Category → Library with:
- **Type → Category → Library → Presets**

Example paths:
- Before: `Keys → Instruments → Organs → Keyscape Creative`
- After: `Keys → Organs → Keyscape Creative`

Style information is retained in the typeIndex for potential future grouping but is not part of the navigation hierarchy.

### 2. Recursive Semantic Category Detection

Scan folder trees recursively to find "leaf" categories at any depth:

```typescript
// Semantic category set - categories we want to expose in navigation
const semanticCategories = new Set([
    'Keys', 'Organs', 'Pianos',  // Keyboard subcategories
    'Acoustic', 'Electric',  // Context-aware
    'Guitars', 'Strings', 'Winds', 'Bells', 'Bell Tones',
    'Synths', 'Pads', 'Textures',
    'ARP + BPM'
]);

function scanForCategories(node, pathParts, product, library, style) {
    const currentFolderName = pathParts[pathParts.length - 1];

    // Check if this folder is a semantic category
    let isSemanticCategory = semanticCategories.has(currentFolderName);

    // Context-aware detection for Electric/Acoustic
    if (currentFolderName === 'Electric' || currentFolderName === 'Acoustic') {
        const isBassLibrary = library.toLowerCase().includes('bass');
        if (!isBassLibrary) {
            isSemanticCategory = false;
        }
    }

    if (isSemanticCategory) {
        // Index this category
        typeIndex[consolidatedType].push({
            style: style,
            library: library,
            category: consolidatedCategory,
            path: `${product}/${library}/${pathParts.join('/')}`
        });
        return; // Don't recurse deeper
    }

    // Check if children are semantic categories
    const hasSemanticChildren = subfolderNames.some(name =>
        semanticCategories.has(name)
    );

    if (hasSemanticChildren) {
        // Recurse to find semantic categories
        for (const [childName, childNode] of Object.entries(node.folders)) {
            scanForCategories(childNode, [...pathParts, childName], ...);
        }
    } else {
        // No semantic children - this folder itself is the category
        typeIndex[consolidatedType].push({...});
    }
}
```

### 3. Category Consolidation

Merge similar category names for better UX:

```typescript
const categoryConsolidation: Record<string, string> = {
    'Keyboards': 'Keys',
    'Mini Pianos': 'Belltone Keyboards',
    'Toy Pianos': 'Belltone Keyboards',
    'Vox Humana': 'Vocals',
    'Human Voices': 'Vocals',
    'String Machines': 'Strings',
    'Bowed Colors': 'Strings',
    'Bells and Vibes': 'Bell Tones'
};
```

### 4. TypeIndex Structure

Updated typeIndex format:

```typescript
typeIndex: Record<string, Array<{
    style: string,      // Retained for grouping (not navigation)
    library: string,    // Library name
    category: string,   // Semantic category name
    path: string        // Full tree path to category
}>>
```

Example:
```json
{
  "Keys": [
    {
      "style": "Instruments",
      "library": "Keyscape Creative",
      "category": "Organs",
      "path": "Keyscape/Keyscape Creative/Organs"
    },
    {
      "style": "Chill",
      "library": "Organic Vibes",
      "category": "Organs",
      "path": "Omnisphere/Organic Vibes/Keyboards/Organs"
    }
  ]
}
```

### 5. OmnisphereAdapter Implementation

Updated navigation levels:

```typescript
// Level 0: Show instrument types
if (path.length === 0) {
    return Object.keys(typeIndex).sort();
}

// Level 1: Show categories for selected type
if (path.length === 1) {
    const [instrumentType] = path;
    const typeEntries = typeIndex[instrumentType] || [];
    const categories = [...new Set(typeEntries.map(e => e.category))];
    return categories.sort();
}

// Level 2: Show libraries offering this type+category
if (path.length === 2) {
    const [instrumentType, category] = path;
    const typeEntries = typeIndex[instrumentType] || [];
    const categoryEntries = typeEntries.filter(e => e.category === category);
    const libraries = [...new Set(categoryEntries.map(e => e.library))];
    return libraries.sort();
}

// Level 3+: Map to tree path and use base tree navigation
if (path.length >= 3) {
    const [instrumentType, category, library, ...subPath] = path;
    const entry = typeEntries.find(e =>
        e.category === category && e.library === library
    );
    const treePath = entry.path.split('/').concat(subPath);
    return super.getFolders(vendorId, treePath);
}
```

### 6. Tree Path Detection

Distinguish between internal tree paths and external category paths:

```typescript
private isTreePath(path: string[]): boolean {
    if (path.length === 0) return false;
    const productNames = ['Keyscape', 'Omnisphere', 'Trilian'];
    return productNames.includes(path[0]);
}
```

## Implementation Details

### Files Modified

1. **scripts/generate-instruments-json.ts** (+173 lines)
   - Added `semanticCategories` set
   - Added `categoryConsolidation` mapping
   - Implemented `scanForCategories()` recursive function
   - Updated typeIndex structure to include `category` field
   - Added context-aware Electric/Acoustic detection

2. **interface/src/lib/services/adapters/omnisphereAdapter.ts** (-189, +189 lines)
   - Removed style from navigation hierarchy
   - Implemented 3-level navigation (Type → Category → Library)
   - Added `isTreePath()` helper
   - Updated `getFolders()` to use category-first paths
   - Updated `getPresets()` for category aggregation
   - Simplified `getGroupedFolders()` (no grouping needed)

3. **interface/src/lib/components/v6/browser/UnifiedGestureBrowser.svelte** (-55 lines)
   - Simplified folder rendering (removed grouped folder UI)
   - Simplified hover handler (removed group tracking)

4. **interface/src/lib/services/adapters/unifiedAdapter.ts** (+10 lines)
   - Added `getGroupedFolders()` stub returning null

## Results

### Before (Type-First Navigation)
```
Keys → Instruments → Organs → Keyscape Creative
Keys → Chill → Organic Vibes → Keyboards → Organs (hidden - too deep)
```

### After (Category-First Navigation)
```
Keys → Organs → [All libraries with organs]
  - Keyscape Creative
  - Organic Vibes
  - Live Keyboardist
  - Club Land
```

### Benefits

1. **Single Discovery Path**: All instances of a category appear in one place
2. **Depth-Agnostic**: Finds categories at any nesting level (2, 3, or more levels deep)
3. **Context-Aware**: Electric/Acoustic properly categorized based on library context
4. **Consolidated Categories**: Similar categories merged (Vox Humana + Human Voices → Vocals)
5. **Cleaner Navigation**: 3 levels instead of 4 (Type → Category → Library vs Type → Style → Category → Library)

### Type Index Statistics

Generated index contains:
- **6 instrument types**: Keys, Bass, Instruments, Drums, Synth, ARP + BPM
- **30+ semantic categories**: Organs, Pianos, Electric, Acoustic, Guitars, Strings, etc.
- **15+ libraries**: Keyscape Creative, Trilian Creative, Organic Vibes, Club Land, etc.

Example output:
```
[Type Index] Built index for 6 instrument types
[Type Index] Types: ARP + BPM, Bass, Drums, Instruments, Keys, Synth
[Type Index] Keys has 8 categories: Bell Tones, Belltone Keyboards, Keys, Organs, Pianos, Strings, Vocals, Winds
[Type Index] Organs found in 4 libraries: Club Land, Keyscape Creative, Live Keyboardist, Organic Vibes
```

## Trade-offs

### Advantages
- ✅ Eliminates category fragmentation across styles
- ✅ Works with both flat and nested library structures
- ✅ Context-aware categorization
- ✅ Simpler navigation hierarchy (3 levels vs 4)
- ✅ All instances of a category discoverable in one place

### Disadvantages
- ❌ Style information no longer part of navigation (though retained in index)
- ❌ Slightly more complex typeIndex generation (recursive scanning)
- ❌ Requires comprehensive semantic category list maintenance

## Alternatives Considered

### 1. Keep Type → Style Navigation
Add "All Categories" option at style level to aggregate categories.

**Rejected**: Would preserve the fragmentation problem and add UI complexity.

### 2. Deep Static Scanning
Increase scan depth from 3 to 5 levels without semantic detection.

**Rejected**: Brittle solution that doesn't address the core issue of semantic category identification.

### 3. Dual Navigation Modes
Offer both style-first and category-first navigation as user preference.

**Rejected**: Adds complexity and most users prefer category-based discovery.

## Future Enhancements

1. **Style Filtering**: Add optional style filter within category results
2. **Library Metadata**: Enhance typeIndex with library descriptions and colors
3. **Preset Count**: Include preset counts at each navigation level
4. **Search Integration**: Use semantic categories for search autocomplete

## Related

- **Issue #153**: Categories scattered across multiple style paths
- **ADR-080**: Original type-first navigation implementation
- **ADR-111**: Browser auto-navigation refactor (single-folder skip)
- **ADR-074**: Omnisphere auto-skip single folders

## Notes

The recursive scanning approach is robust to future library additions with varying folder structures. New libraries are automatically indexed regardless of nesting depth as long as their folder names match semantic categories.

Context-aware detection for Electric/Acoustic is currently implemented with simple string matching (`library.toLowerCase().includes('bass')`). This could be enhanced with a more explicit library metadata system if needed.

---

## Updates (2025-11-10): Enhanced Navigation and Folder Grouping

### New Features Implemented

#### 1. Generic Category Detection with Deep-Indexing Validation

**Problem:** Categories like "Bass Sounds" were incorrectly treated as "generic" (showing sub-types first) when they weren't actually deep-indexed, breaking navigation.

**Solution:** Enhanced `isGenericCategory()` to validate BOTH:
- Category name matches type pattern (e.g., "Bass Sounds" contains "bass")
- **AND** category is actually deep-indexed (at least one library has multiple entries)

```typescript
private isGenericCategory(instrumentType: string, category: string): boolean {
    // Check name pattern match
    const nameMatches = (
        normalizedCategory === normalizedType ||
        normalizedCategory === normalizedType + 's' ||
        normalizedCategory.includes(normalizedType)
    );

    if (!nameMatches) return false;

    // Verify deep-indexing: check if any library has multiple entries
    const libraryGroups = new Map<string, number>();
    for (const entry of categoryEntries) {
        libraryGroups.set(entry.library, (libraryGroups.get(entry.library) || 0) + 1);
    }

    const isDeepIndexed = Array.from(libraryGroups.values()).some(count => count > 1);
    return isDeepIndexed;
}
```

**Result:**
- ✅ `Synth → Synths` (deep-indexed) → Shows sub-types first (Synth Poly, Synth Mono, etc.)
- ✅ `Keys → Keys` (deep-indexed) → Shows sub-types first (Trons, Clavs, etc.)
- ✅ `Bass → Bass Sounds` (NOT deep-indexed) → Shows libraries first (Ambient Dreams, Analog Vibes, etc.)

#### 2. Automatic Folder Grouping by Prefix Pattern

**Problem:** Navigating to `Keys → Electric Pianos → Keyscape Creative` showed 12 separate "DUO" buttons (DUO 1, DUO 2, DUO 3, etc.) instead of grouping them.

**Solution:** Implemented automatic prefix-based folder grouping in `OmnisphereAdapter`:

```typescript
private groupFoldersByPrefix(folders: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const folder of folders) {
        let prefix = folder;

        // Pattern 1: "Duo - Classic" → "Duo"
        if (folder.includes(' - ')) {
            prefix = folder.split(' - ')[0];
        }
        // Pattern 2: "Wurlitzer 140B" → "Wurlitzer"
        else {
            prefix = prefix.replace(/ \d+[A-Z]?$/i, '');
        }
        // Pattern 3: "Pianet M" → "Pianet"
        prefix = prefix.replace(/ [A-Z]$/, '');

        if (!groups.has(prefix)) {
            groups.set(prefix, []);
        }
        groups.get(prefix)!.push(folder);
    }
    return groups;
}
```

**Patterns Detected:**
1. Dash delimiter: `"DUO - Classic"`, `"DUO - Enhanced"` → `"DUO"`
2. Model numbers: `"Wurlitzer 140B"`, `"Wurlitzer 200A"` → `"Wurlitzer"`
3. Single capital letters: `"Pianet M"`, `"Pianet N"` → `"Pianet"`

**Result:**
- `Keys → Electric Pianos → Keyscape Creative → DUO` → Shows all 12 DUO variants aggregated
- `Keys → Electric Pianos → Keyscape Library → Wurlitzer` → Shows all Wurlitzer models aggregated

#### 3. Deep-Indexed Normal Category Support

**Problem:** `ARP + BPM` was deep-indexed (multiple entries per library) but needed libraries-first navigation due to inconsistent sub-folder naming (mix of "Rhythmic Arpeggio" and hardware model names like "Moog Minimoog").

**Solution:**
- Excluded `ARP + BPM` from generic category treatment
- Enhanced `getFolders()` and `getPresets()` to detect when normal categories have multiple entries per library
- Automatically extract and display sub-folders from deep-indexed normal categories

```typescript
// In getFolders() for normal categories:
if (matchingEntries.length > 1 && subPath.length === 0) {
    // Deep-indexed normal category - extract sub-folder names
    const subFolders = matchingEntries.map(e => {
        const pathParts = e.path.split('/');
        return pathParts[pathParts.length - 1];
    }).sort();
    return subFolders;
}
```

**Result:**
- `ARP + BPM → Analog Vibes` → Shows [Rhythmic Arpeggio, Rhythmic Bass, Rhythmic Effects, Rhythmic Monophonic, Rhythmic Polyphonic, Rhythmic Riffs]
- Clicking any sub-folder shows all presets in that rhythmic category

#### 4. Enhanced Category Consolidation

**Added Consolidations:**
```typescript
const categoryConsolidation: Record<string, string> = {
    // ... existing consolidations ...

    // Synth sub-types
    'Synth Poly': 'Synths',
    'Synth Mono': 'Synths',
    'Synth Long': 'Synths',
    'Synth Short': 'Synths',

    // Pad variations
    'Pads + Strings': 'Pads',

    // Effect variations
    'Transition Effects': 'Effects'
};
```

**Result:** Cleaner category lists with merged duplicate/similar categories.

#### 5. Deep Indexing for Sub-Folder Discovery

**Problem:** Categories like `Synth → Synths` only showed 4 presets at `Synth → Synth Poly` instead of all presets across libraries.

**Solution:** Enhanced typeIndex generator to scan one level deeper when semantic categories have sub-folders:

```typescript
if (isSemanticCategory) {
    const subfolderNames = Object.keys(node.folders);
    if (subfolderNames.length > 0) {
        // Index each sub-folder separately (deep indexing)
        for (const [subFolderName, subFolderNode] of Object.entries(node.folders)) {
            typeIndex[consolidatedType].push({
                style: style,
                library: library,
                category: consolidatedCategory,
                path: `${product}/${library}/${pathParts.join('/')}/${subFolderName}`
            });
        }
    } else {
        // No sub-folders, index category itself
        typeIndex[consolidatedType].push({...});
    }
}
```

**Result:**
- Paths now point directly to sub-types: `Omnisphere/Retro Vibes/Synths/Synth Poly`
- Generic categories can aggregate presets across all libraries for a specific sub-type

### Navigation Flow Examples

**Generic Category (Deep-Indexed):**
```
Synth → Synths → Synth Poly → [All presets from all libraries]
Synth → Synths → Synth Poly → Retro Vibes → [Retro Vibes Synth Poly presets]
```

**Normal Category (Single Entry Per Library):**
```
Bass → Synth Bass → Trilian Creative → [Sub-folders or grouped folders]
Keys → Pianos → Keyscape Library → Grand → [Grouped: Steinway, Yamaha, etc.]
```

**Normal Category (Deep-Indexed):**
```
ARP + BPM → Analog Vibes → Rhythmic Arpeggio → [Presets]
ARP + BPM → Analog Vibes → Rhythmic Bass → [Presets]
```

**Grouped Folders:**
```
Keys → Electric Pianos → Keyscape Creative → DUO → [All 12 DUO variants aggregated]
Keys → Electric Pianos → Keyscape Library → Wurlitzer → [All Wurlitzer models aggregated]
```

### Technical Implementation

**Files Modified:**
1. `omnisphereAdapter.ts:103-146` - Enhanced `isGenericCategory()` with deep-indexing validation
2. `omnisphereAdapter.ts:148-175` - Added `groupFoldersByPrefix()` helper
3. `omnisphereAdapter.ts:276-339` - Updated `getFolders()` to handle deep-indexed normal categories
4. `omnisphereAdapter.ts:470-577` - Updated `getPresets()` to handle deep-indexed normal categories
5. `omnisphereAdapter.ts:630-656` - Updated `getRandomPreset()` to handle deep-indexed paths
6. `generate-instruments-json.ts:408-449` - Added deep indexing for semantic categories with sub-folders
7. `generate-instruments-json.ts:368-372` - Added Pads/Effects consolidation

### Benefits

1. **Smarter Generic Detection**: No false positives causing broken navigation
2. **Cleaner UI**: 12 DUO buttons → 1 DUO button with aggregated presets
3. **Flexible Navigation**: Supports both deep-indexed and non-deep-indexed categories
4. **Better Discovery**: Sub-folders automatically detected and displayed
5. **Robust Architecture**: Works with any folder structure and indexing depth

### Future Considerations

- Consider making folder grouping patterns configurable
- Add UI indicators for grouped vs non-grouped folders
- Potential to add "expand group" option to show individual variants

---

## Updates (2025-11-10 PM): Bass Instruments Consolidation

### Problem

The Bass section had a "Bass Instruments" category appearing alongside Acoustic, Electric, Key Bass, and Synth Bass. This category contained 30+ sub-folders (bass model names like "Retro 60's", "Rock 'n Roll Overdrive", "Chapman Stick", etc.) that needed to be distributed into the existing Acoustic and Electric categories.

**Desired Navigation:**
```
Bass → Acoustic → [4 acoustic bass models]
Bass → Electric → [26 electric bass models]
Bass → Key Bass → [keyboard bass presets]
Bass → Synth Bass → [synthesized bass presets]
```

### Solution

**1. Made "Bass Instruments" Semantic**

Added "Bass Instruments" to the `semanticCategories` set, causing it to recurse into children instead of being indexed as a category itself.

```typescript
const semanticCategories = new Set([
    'Keys', 'Organs', 'Pianos',
    'Acoustic', 'Electric',
    'Bass Instruments',  // Semantic - recurses into children
    'Key Bass',
    // ... other categories
]);
```

**2. Category Consolidation with HTML Encoding**

Mapped each bass model folder name to either "Acoustic" or "Electric" in `categoryConsolidation`. Critical discovery: folder names with apostrophes are HTML-encoded by the flattener (`&#39;` instead of `'`).

```typescript
const categoryConsolidation: Record<string, string> = {
    // Acoustic bass models (4 total)
    'Trilian Acoustic 1': 'Acoustic',
    'Trilian Acoustic 2': 'Acoustic',
    'Martin Ac Bass Guitar': 'Acoustic',
    'Trilogy Acoustic': 'Acoustic',

    // Electric bass models (26 total)
    // IMPORTANT: Apostrophes are HTML-encoded by flattener
    '1.5': 'Electric',
    'Chapman Stick': 'Electric',
    'Retro 60&#39;s': 'Electric',  // HTML-encoded apostrophe
    'Rock &#39;n Roll Overdrive': 'Electric',  // HTML-encoded apostrophe
    'Jaco Fretless': 'Electric',
    // ... 21 more electric models
};
```

**3. Type Inheritance from Semantic Parents**

When a folder isn't explicitly mapped to a type in `typeConsolidation`, it now inherits the type from its semantic parent:

```typescript
// If this folder is not explicitly mapped to a type, check if parent is semantic
// and use parent's type instead (e.g., "Retro 60's" under "Bass Instruments" → Bass)
if (consolidatedType === currentFolderName && parentFolderName) {
    const parentType = typeConsolidation[parentFolderName];
    if (parentType && semanticCategories.has(parentFolderName)) {
        consolidatedType = parentType;
    }
}
```

This prevents folders like "Retro 60's" from creating unwanted top-level types.

**4. Deep-Indexing with Subcategory Preservation**

When "Bass Instruments" is processed as a semantic category, the deep-indexing logic creates separate entries for each sub-folder, using the sub-folder name for category consolidation:

```typescript
if (subfolderNames.length > 0) {
    for (const [subFolderName, subFolderNode] of Object.entries(node.folders)) {
        // Use sub-folder name for category consolidation
        const subFolderConsolidatedCategory = categoryConsolidation[subFolderName] || consolidatedCategory;
        const subFolderWasConsolidated = subFolderConsolidatedCategory !== subFolderName;

        const entry: any = {
            style: style,
            library: library,
            category: subFolderConsolidatedCategory,  // "Electric" or "Acoustic"
            path: `${product}/${library}/${pathParts.join('/')}/${subFolderName}`
        };
        // Preserve original bass model name as subcategory
        if (subFolderWasConsolidated) {
            entry.subcategory = subFolderName;  // e.g., "Retro 60's"
        }
        typeIndex[consolidatedType].push(entry);
    }
}
```

### Result

**Generated Index Structure:**
```json
{
  "Bass": [
    {
      "style": "Instruments",
      "library": "Trilian Library",
      "category": "Electric",
      "subcategory": "Retro 60's",
      "path": "Trilian/Trilian Library/Bass Instruments/Retro 60's"
    },
    {
      "style": "Instruments",
      "library": "Trilogy Library",
      "category": "Electric",
      "subcategory": "Rock 'n Roll Overdrive",
      "path": "Trilian/Trilogy Library/Bass Instruments/Rock 'n Roll Overdrive"
    }
    // ... 27 more electric + 5 acoustic entries
  ]
}
```

**Navigation Flow:**
```
Bass → Electric → [Shows 29 bass models as subcategories]
  - 1.5
  - Chapman Stick
  - Retro 60's
  - Rock 'n Roll Overdrive
  - Jaco Fretless
  - ... 24 more

Bass → Acoustic → [Shows 5 bass models as subcategories]
  - Trilian Acoustic 1
  - Trilian Acoustic 2
  - Martin Ac Bass Guitar
  - Trilogy Acoustic
  - Acoustic (from XTRA)
```

The `OmnisphereAdapter`'s existing `isGenericCategory()` logic automatically detects that Electric and Acoustic have subcategories and displays them as navigation options.

### Key Learnings

1. **HTML Encoding Issue**: Folder names are HTML-encoded during tree flattening, so consolidation maps must use encoded characters (`&#39;` for apostrophes)

2. **Semantic Recursion**: Making a folder semantic causes it to recurse into children without being indexed itself - perfect for "container" categories like "Bass Instruments"

3. **Subcategory Preservation**: The consolidation system automatically preserves original folder names as subcategories when consolidation occurs, enabling the bass model names to appear in navigation

4. **Type Inheritance**: Folders without explicit type mapping inherit from semantic parents, preventing unwanted top-level type creation

### Files Modified

1. **scripts/generate-instruments-json.ts**
   - Added "Bass Instruments" to `semanticCategories` (line 377)
   - Added 30 bass model consolidations to `categoryConsolidation` (lines 372-398)
   - Enhanced type inheritance logic (lines 568-575)
   - Added inline documentation explaining HTML encoding (lines 366-380)

2. **interface/src/lib/services/adapters/omnisphereAdapter.ts**
   - No changes needed - existing subcategory detection handles consolidated bass models automatically

### Benefits

1. **Streamlined Navigation**: "Bass Instruments" eliminated as visible category
2. **Logical Grouping**: Bass models grouped by Acoustic vs Electric
3. **Model Preservation**: All 30 bass model names preserved and discoverable
4. **Scalable Approach**: Pattern works for any semantic category with heterogeneous children
5. **Zero UI Changes**: Existing adapter logic handles consolidated subcategories automatically
