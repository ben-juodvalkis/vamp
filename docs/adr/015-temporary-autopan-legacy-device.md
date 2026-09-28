# ADR 007: Temporary AutoPan Legacy Device Replacement

**Status:** Accepted (Temporary)
**Date:** 2025-01-06
**Deciders:** Ben Juodvalkis
**Related:** Device System (selectedTrackStore)

## Context

The current Auto Pan-Tremolo device (AutoPan2) in Ableton Live has a bug that affects its functionality. Until Ableton releases a fix, we need to use the legacy AutoPan device instead.

### Requirements

The legacy AutoPan device (AutoPanLegacy.adv) has different parameter mappings:
- **X-axis (Rate):** Parameter 4 with discrete steps [13, 12, 10, 9, 8, 6, 4], default at x=0.5
- **Y-axis (Amount):** Parameter 2, mirrored around 0.5
- **Y-axis (Invert):** Parameter 12, flips when Y < 0.5
- **Shape:** Parameter 10, default value 0, controlled from central display

### Constraint

This replacement is **temporary** - when Ableton fixes the AutoPan2 bug, we need to easily revert to the original implementation. Therefore, **no modifications to existing TremoloControl components** are allowed.

## Decision

Create a parallel implementation for AutoPanLegacy while preserving all original TremoloControl code.

### Implementation

**1. New Component Created:**
- `AutoPanLegacyControl.svelte` - XY control with new parameter mappings
  - Uses `selectedTrackStore.subscribeToParameter()` pattern (ADR-004)
  - X-axis: Discrete steps for rate parameter
  - Y-axis: Amount with mirrored invert behavior
  - Triggers central display on interaction

**2. Configuration Changes:**
```typescript
// devicePresets.ts
tremolo: {
  presetPath: '/Users/.../AutoPanLegacy.adv',
  defaultName: 'AutoPanLegacy',     // Must match device name
  expectedClassName: 'AutoPan',      // Must match class name
  color: { ... }                     // Unchanged
}
```

**3. FX Grid Update:**
```svelte
// FXGrid.svelte
- import TremoloControl from './TremoloControl.svelte';
+ import AutoPanLegacyControl from './AutoPanLegacyControl.svelte';

- <TremoloControl device={...} />
+ <AutoPanLegacyControl device={...} />
```

**4. Central Display Update:**
```svelte
// TremoloCentralView.svelte
- index={[trackIndex, deviceIndex, 15]}  // AutoPan2 shape param
+ index={[trackIndex, deviceIndex, 10]}  // AutoPan legacy shape param
```

### Files Preserved (Untouched)

- `TremoloControl.svelte` - Original implementation for AutoPan2
- All other tremolo-related code

## Consequences

### Positive

1. **Easy Reversion:** When Ableton fixes the bug:
   - Revert `devicePresets.ts` to use Auto Pan-Tremolo.adv
   - Swap import in `FXGrid.svelte` back to `TremoloControl`
   - Update parameter index in `TremoloCentralView.svelte`
   - Delete `AutoPanLegacyControl.svelte`

2. **No Risk to Working Code:** Original TremoloControl remains functional and tested

3. **Clear Documentation:** This ADR documents the temporary nature and reversion process

4. **Consistent Architecture:** Follows selectedTrackStore patterns from ADR-004

### Negative

1. **Code Duplication:** AutoPanLegacyControl duplicates much of TremoloControl logic

2. **Maintenance Burden:** Two components doing similar things (but temporary)

3. **Parameter Index Changes:** Central display temporarily uses different parameter index

### Neutral

1. **Device Detection:** Relies on matching both `defaultName` and `expectedClassName` (standard pattern)

2. **Slot Key:** Still uses `slotKey="tremolo"` to maintain FX Grid slot consistency

## Reversion Checklist

When Ableton fixes the AutoPan2 bug:

- [ ] Update `devicePresets.ts` tremolo config:
  - [ ] `presetPath: 'ableton/Presets/Effect Patches/Auto Pan-Tremolo.adv'`
  - [ ] `defaultName: 'Auto Pan-Tremolo'`
  - [ ] `expectedClassName: 'AutoPan2'`
- [ ] Update `FXGrid.svelte`:
  - [ ] Import `TremoloControl` instead of `AutoPanLegacyControl`
  - [ ] Use `<TremoloControl>` component
- [ ] Update `TremoloCentralView.svelte`:
  - [ ] Change parameter index from 10 to 15
  - [ ] Update comment to reflect AutoPan2 shape param
- [ ] Delete `AutoPanLegacyControl.svelte`
- [ ] Test FX Grid with Auto Pan-Tremolo device

## Technical Details

### Parameter Mappings

**AutoPan Legacy (Current):**
- Param 4: Rate (discrete: 13, 12, 10, 9, 8, 6, 4)
- Param 2: Amount (0-1)
- Param 12: Invert (bool)
- Param 10: Shape (0-1)

**AutoPan2 (Original - for reference):**
- Param 9: Rate (1-8)
- Param 2: Amount (0-1)
- Param 4: Invert (bool)
- Param 15: Shape (0-1)

### Device Detection

The system matches devices using both:
- `expectedClassName: 'AutoPan'` - Ableton's internal class name
- `defaultName: 'AutoPanLegacy'` - Device name as reported by Live

This dual-matching prevents false positives (see ADR-004 and adding-device-guide.md).

## References

- [ADR-004: Device System Refactor V2](./004-device-system-refactor-v2.md)
- [Adding Device Guide](../adding-device-guide.md)
- Original bug report: Ableton AutoPan2 device malfunction

## Status

✅ **Temporary Implementation Active**
⏳ **Awaiting:** Ableton bug fix for AutoPan2 device
📋 **Next:** Monitor Ableton release notes for fix, then revert using checklist above
