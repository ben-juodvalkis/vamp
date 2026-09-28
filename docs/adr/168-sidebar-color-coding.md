# ADR-168: Sidebar Button Color Coding

## Status
Accepted

## Context
The gesture browser sidebar buttons (Drum, Bass, FX, Inst, Key, Synth) were all displayed with white text on a dark grey background, making them visually indistinct. Meanwhile, the special buttons (Audio, Scale, Recent) already had color coding with colored text and tinted backgrounds.

## Decision
Add color coding to all sidebar category buttons:

1. **Define type colors in constants.json** - Each instrument type gets a distinct color:
   - Drum: coral red (#e63946)
   - Bass: teal (#2a9d8f)
   - FX: mustard gold (#e9c46a)
   - Inst: forest green (#52b788)
   - Key: mauve/rose (#b56576)
   - Synth: royal blue (#4361ee)

2. **Apply colors dynamically** - UnifiedGestureBrowser loads colors from constants and passes them to vendor objects.

3. **Style with CSS color-mix()** - VendorButtonGrid uses the `--category-color` CSS variable to:
   - Set text color via `.category-name`
   - Create subtle tinted background: `color-mix(in srgb, var(--category-color) 20%, black 60%)`
   - Add colored border: `color-mix(in srgb, var(--category-color) 40%, transparent)`

4. **Reorder top group** - Changed from Audio/Scale/Recent to Recent/Scale/Audio for better ergonomics.

5. **Rename types for consistency** - Changed folder names from plural to singular (Drums→Drum, Keys→Key) for grammatical consistency.

## Consequences

### Positive
- Visual distinction between categories improves scannability
- Color coding provides quick visual identification
- Consistent styling approach across all sidebar buttons
- Colors are configurable in constants.json (single source of truth)

### Negative
- Folder renames require regenerating instrument index files
- Users with custom setups need to update their folder names

## Files Changed
- `config/constants.json` - Added `vendors.types` color definitions
- `interface/src/lib/components/v6/browser/VendorButtonGrid.svelte` - Updated CSS for colored backgrounds, reordered buttons, updated group IDs
- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` - Load type colors from constants

## Migration
After renaming instrument folders (Drums→Drum, Keys→Key), run:
```bash
npm run generate-instruments
```
