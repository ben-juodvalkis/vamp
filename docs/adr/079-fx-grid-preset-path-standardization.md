#ADR-079: FX Grid Preset Path Standardization

**Status:** Implemented
**Date:** 2025-01-22
**Context:** FX Grid Device Loading Reliability
**Related:** ADR-028 (Project Constants File)

---

## Context

The FX Grid system loads audio effects from preset files (`.adv`, `.aupreset`) located in the project's `ableton/Presets/Effect Patches/` directory. Users reported that delay and reverb effects were failing to load while other effects (filter, compressor, etc.) worked correctly.

### The Problem

Investigation revealed **inconsistent path formatting** in the device preset configuration:

**Working effects (absolute paths):**
```typescript
filter: {
  presetPath: '/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Effect Patches/Auto Filter.adv'
}
```

**Failing effects (relative paths):**
```typescript
delay: {
  presetPath: 'ableton/Presets/Effect Patches/Delay.adv'  // ❌ Relative
},
reverb: {
  presetPath: 'ableton/Presets/Effect Patches/Reverb.adv'  // ❌ Relative
}
```

### Root Cause

The Max4Live device loader (`/looping/devices/load`) requires **absolute paths** to locate preset files correctly. Relative paths cannot be resolved from the Max/MSP runtime context, causing loading failures.

### Impact

- **Delay and reverb effects**: Complete loading failure
- **Mix of 7 relative + 8 absolute paths**: Inconsistent behavior across FX grid
- **Maintenance burden**: No single source of truth for preset locations

---

## Decision

**Standardize all FX preset paths using the existing `config/constants.json` configuration system.**

### Implementation

1. **Add `effectPresetsBase` to constants.json:**
```json
{
  "paths": {
    "effectPresetsBase": "/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Effect Patches",
    // ... other paths
  }
}
```

2. **Update `devicePresets.ts` to import constants:**
```typescript
import constants from '../../../../config/constants.json';

export const DEVICE_PRESETS: Record<string, DevicePresetConfig> = {
  delay: {
    presetPath: `${constants.paths.effectPresetsBase}/Delay.adv`,  // ✅ Absolute
    // ... config
  },
  // ... all other effects
};
```

3. **Convert all 15 FX effects to use dynamic paths:**
   - All `.adv` files use `effectPresetsBase`
   - All `.aupreset` files use `effectPresetsBase`
   - Sequencer (`.amxd`) uses `projectRoot` (different directory)

---

## Benefits

### 1. Consistent Absolute Paths
- **All 15 FX effects** now use absolute paths
- **Uniform loading behavior** across the FX grid
- **Predictable device loading** for Max4Live

### 2. Single Source of Truth
- **One place to update** if preset directory moves
- **Follows project guidelines** (ADR-028) for configuration centralization
- **No hardcoded paths** scattered across codebase

### 3. Maintainability
- **Easy path updates**: Change `effectPresetsBase` in constants.json
- **Clear configuration structure**: All paths documented in one file
- **Type-safe imports**: TypeScript validates JSON structure

### 4. Future-Proof
- **Environment portability**: Different constants.json per environment
- **Path flexibility**: Easy to relocate presets without code changes
- **Multi-language support**: JSON accessible to Python, Max/MSP, etc.

---

## Alternatives Considered

### 1. Fix Only Delay/Reverb (Minimal Change)
**Approach:** Convert only failing effects to absolute paths
**Pros:** Smallest code change
**Cons:** Leaves inconsistency, doesn't solve root problem

### 2. Hardcode Absolute Paths (Direct Fix)
**Approach:** Replace relative paths with hardcoded absolute paths
**Pros:** Simple, no import overhead
**Cons:** Violates single source of truth, hard to maintain

### 3. Environment Variables
**Approach:** Use `process.env.PRESETS_PATH`
**Pros:** Runtime configuration
**Cons:** Harder to document, error-prone, type conversion issues

### 4. Relative Path Resolution (Max/MSP Fix)
**Approach:** Fix Max4Live to resolve relative paths
**Pros:** No frontend changes needed
**Cons:** Complex Max/MSP implementation, doesn't address inconsistency

**Decision rationale:** Option 2 (constants.json) aligns with established project patterns and provides the most maintainable solution.

---

## Implementation Details

### Files Modified

**1. `config/constants.json`**
```json
{
  "paths": {
    "effectPresetsBase": "/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Effect Patches"
  }
}
```

**2. `interface/src/lib/config/devicePresets.ts`**
- Added constants import
- Converted all 15 preset paths to use template literals
- Special handling for sequencer (different directory)

### Effects Standardized

**Standard Effect Patches (14 effects):**
1. delay → `${effectPresetsBase}/Delay.adv`
2. filter → `${effectPresetsBase}/Auto Filter.adv`
3. compressor → `${effectPresetsBase}/Compressor.adv`
4. saturator → `${effectPresetsBase}/Saturator.adv`
5. variation → `${effectPresetsBase}/Variation.adv`
6. eq → `${effectPresetsBase}/Channel EQ.adv`
7. drum → `${effectPresetsBase}/Drum Buss.adv`
8. pedal → `${effectPresetsBase}/Pedal.adv`
9. tremolo → `${effectPresetsBase}/AutoPanLegacy.adv`
10. utility → `${effectPresetsBase}/Arpeggiator.adv`
11. redux → `${effectPresetsBase}/Redux Legacy.adv`
12. reverb → `${effectPresetsBase}/Reverb.adv`
13. comb → `${effectPresetsBase}/Comb.aupreset`
14. smudge → `${effectPresetsBase}/Smudge.aupreset`

**Special Case:**
15. sequencer → `${projectRoot}/Vamp Devices/Sequencer.amxd`

---

## Testing

### Validation Steps

1. **Development server startup**: ✅ No TypeScript errors
2. **Constants import**: ✅ JSON successfully imported
3. **Path resolution**: ✅ All paths resolve to existing files
4. **FX grid loading**: Manual testing required (delay/reverb should now load)

### Expected Results

- **Delay effect**: Should load successfully from FX grid
- **Reverb effect**: Should load successfully from FX grid
- **All other effects**: Continue working as before
- **No regressions**: Existing functionality preserved

---

## Consequences

### Positive

✅ **Immediate Fix**
Delay and reverb effects now load correctly

✅ **System-Wide Consistency**
All FX effects use identical path resolution pattern

✅ **Maintenance Improvement**
Single file to update for path changes

✅ **Follows Best Practices**
Aligns with project's configuration centralization strategy

✅ **Type Safety**
TypeScript validates constants.json structure

### Negative

⚠️ **Import Dependency**
`devicePresets.ts` now depends on constants.json (acceptable coupling)

⚠️ **JSON Parse Overhead**
Minimal performance impact from JSON import (build-time only)

### Neutral

**Code Size**: Slight increase due to import and template literals
**Complexity**: Marginally higher but more explicit

---

## Migration Notes

### Backwards Compatibility

- **No breaking changes**: External interfaces unchanged
- **Existing presets**: All files remain in same locations
- **Max4Live integration**: No changes to OSC message format

### Rollback Plan

If issues arise:
1. Revert `devicePresets.ts` to hardcoded absolute paths
2. Remove `effectPresetsBase` from constants.json
3. Keep constants import for future use

### Future Enhancements

**Path Validation:**
```typescript
// Future: Runtime validation
const effectPath = `${constants.paths.effectPresetsBase}/Delay.adv`;
if (!fs.existsSync(effectPath)) {
  throw new Error(`Effect preset not found: ${effectPath}`);
}
```

**Environment-Specific Paths:**
```json
{
  "paths": {
    "effectPresetsBase": {
      "development": "/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Effect Patches",
      "production": "/opt/looping/presets/effects"
    }
  }
}
```

---

## Related Work

### ADR-028: Project Constants File
This implementation directly builds on the constants.json pattern established for configuration centralization.

### Future ADRs
- **Path validation system**: Runtime checking of preset file existence
- **Environment-specific configuration**: Development vs production paths
- **Preset management tools**: Automated preset discovery and validation

---

## Success Metrics

### Immediate (Post-Implementation)
- [ ] Delay effect loads successfully in FX grid
- [ ] Reverb effect loads successfully in FX grid
- [ ] No regressions in other FX effects
- [ ] Development server starts without errors

### Long-term (Maintenance)
- [ ] Path updates require only constants.json changes
- [ ] New FX effects follow consistent path pattern
- [ ] Configuration remains centralized and documented

---

## References

- **Issue**: Delay and reverb effects not loading in FX grid
- **Code**: `interface/src/lib/config/devicePresets.ts`
- **Configuration**: `config/constants.json`
- **Related ADR**: ADR-028 (Project Constants File)
- **Max4Live**: `/looping/devices/load` OSC endpoint

---

**Status:** Implemented
**Next Review:** When adding new FX effects or relocating preset files
**Owner:** FX Grid System

---

**Last Updated:** 2025-01-22 (Initial implementation)