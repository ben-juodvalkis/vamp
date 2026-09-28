# ADR 021: File Path Space Handling and Deduplication Fix

## Status
Accepted

## Context
The preset browser was failing to load certain files from the Ableton library, specifically files from NI (Native Instruments) directories like `NI-Acoustic`, `NI-Analog`, etc. Investigation revealed two interconnected issues:

1. **Original filenames contained leading spaces**: Files like ` Amplified Funk Greasy + Grits.adg` had actual leading spaces in their filenames on disk.

2. **Deduplication logic corrupted file paths**: The JSON generation script's deduplication process was grouping variant files together but creating invalid file paths in the process.

### The Root Problems

#### Problem 1: Leading Spaces in Filenames
Files on disk actually had leading spaces:
```
 Amplified Funk Aquarius + BluOut.adg  (note leading space)
 Amplified Funk Boog + Cachophony.adg
```

#### Problem 2: Broken Deduplication Logic
The deduplication process was grouping files like:
- "Amplified Funk Aquarius + BluOut.adg"
- "Amplified Funk Boog + Cachophony.adg"

Into a single "Amplified Funk" entry, but with corrupted paths:
```javascript
// BROKEN: Generated invalid paths
path: firstVariant.path.replace(/\.adg|\.aupreset/, ''),  // Removed extension
fullPath: path.dirname(firstVariant.fullPath),           // Changed to directory only
```

This resulted in paths like `/Users/.../Drums/` instead of `/Users/.../Drums/filename.adg`.

## Decision

### Phase 1: Manual Filename Cleanup (Completed)
- Manually removed leading spaces from all affected filenames on disk
- This eliminated the root cause of the space issue

### Phase 2: Fix Deduplication Logic (Implemented)
- Preserve the deduplication grouping logic (important for UX organization)
- Fix the path corruption by using the first variant's complete file path:

```javascript
// FIXED: Preserve valid file paths
path: firstVariant.path,      // Keep complete relative path with extension
fullPath: firstVariant.fullPath,  // Keep complete absolute file path
```

### Phase 3: Maintain JSON Generation Integrity
- Keep the existing deduplication patterns for grouping variants
- Ensure `variants` array contains all filenames for random selection
- Generate valid file paths that point to actual loadable files

## Implementation Details

### Deduplication Logic (Preserved)
```javascript
// Groups files like "Amplified Funk Aquarius + BluOut" under "Amplified Funk"
if (preset.name.includes(' + ')) {
    const leftSide = preset.name.split(' + ')[0];
    const words = leftSide.trim().split(' ');
    if (words.length >= 3) {
        baseName = words.slice(0, 2).join(' '); // "Amplified Funk"
    }
    // ... additional logic
}
```

### Path Preservation (Fixed)
```javascript
// Multiple variants - create deduplicated entry using first variant's paths
const firstVariant = variants[0];
deduplicated.push({
    name: baseName,                    // "Amplified Funk"
    path: firstVariant.path,           // "Ableton/Drums/NI-Acoustic/Amplified Funk Aquarius + BluOut.adg"
    fullPath: firstVariant.fullPath,   // "/Users/.../Amplified Funk Aquarius + BluOut.adg"
    type: firstVariant.type,           // ".adg"
    variants: variants.map(v => v.variants![0]),  // All variant filenames
    variantCount: variants.length      // Number of variants
});
```

## Consequences

### Positive
- **Fixed file loading**: All preset files now load correctly from the browser
- **Preserved organization**: Deduplication still groups related variants for better UX
- **Valid random selection**: The `variants` array enables proper random selection when loading
- **Scalable solution**: Works for all file types and naming patterns

### Negative
- **Manual cleanup required**: Required one-time manual removal of spaces from filenames
- **Dependency on first variant**: The displayed path always uses the first variant's filename

### Neutral
- **Maintained existing UX**: Browser behavior and organization remains the same
- **Backward compatible**: No breaking changes to the browser interface

## Testing
- Verified correct JSON generation with 407 deduplicated Ableton presets
- Confirmed valid file paths pointing to actual files on disk
- Debug logging added to track loading process through the entire pipeline

## Related Issues
- Resolves file loading failures for NI preset directories
- Addresses path corruption in JSON generation
- Maintains preset variant grouping functionality

## Notes
This ADR documents both the problem discovery process and the solution. The debug logging remains in place to validate the fix before being removed in a future commit.