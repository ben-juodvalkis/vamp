# ADR 162: Master Track FX Panel

**Date**: 2025-01-16
**Status**: Implemented
**Issue**: [#249](https://github.com/ben-juodvalkis/Looping/issues/249)

## Context

When the master track is selected (`trackIndex === -1`), the FX grid displayed the same 13 slots designed for regular tracks (Arpeggiator, Pitch, Filter, Delay, etc.). This was inappropriate because:

1. **MIDI effects are irrelevant** - Master track is audio-only; Arpeggiator makes no sense
2. **Different workflow** - Master typically has an Audio Effect Rack for mastering chain control
3. **No visibility** - Users couldn't see or control master track Audio Effect Rack macros from the main UI

## Decision

Replace the FX grid with a dedicated **MasterPanel** component when the master track is selected. The panel displays Audio Effect Rack macro sliders in a single horizontal row, showing only macros with custom names.

### Key Design Choices

1. **Single row layout** - All macro sliders in one horizontal row (not a grid) for quick access
2. **Filter unnamed macros** - Only show macros with custom names, hiding blank or generic "Macro X" names
3. **Orange theme** - Matches existing master track styling throughout the UI
4. **Standalone component** - Completely independent from FXGrid, allowing future customization

## Implementation

### Files Created

- `interface/src/lib/components/v6/device-panel/MasterPanel.svelte` - New master panel component

### Files Modified

- `interface/src/lib/components/v6/layout/DevicesPanelV6.svelte` - Conditional rendering based on track selection

### Architecture

```
DevicesPanelV6.svelte
  │
  ├─ session.selectedTrackIndex === -1?
  │   └─ Yes → <MasterPanel />
  │   └─ No  → <FXGrid />
  │
MasterPanel.svelte
  │
  ├─ selectedTrackStore.audioEffectRack
  │   └─ Finds AudioEffectGroupDevice on master
  │
  ├─ selectedTrackStore.getParameterNames(deviceId)
  │   └─ Fetches macro names from Ableton
  │
  ├─ visibleMacros (derived)
  │   └─ Filters to only custom-named macros
  │
  └─ DeviceSlider × N (horizontal row)
      └─ selectedTrackStore.setParameter() on change
```

### Macro Filtering Logic

```typescript
function hasCustomName(paramIndex: number): boolean {
  const rawName = parameterNames[paramIndex];
  if (!rawName) return false;

  const cleanName = cleanParameterName(rawName);
  if (!cleanName || cleanName.trim() === '') return false;

  // Filter out generic names like "Macro 1", "Macro 2", etc.
  if (/^Macro\s*\d+$/i.test(cleanName)) return false;

  return true;
}
```

## Consequences

### Positive

- Master track now has dedicated, appropriate controls
- Only relevant macros are shown (named ones)
- Clean horizontal layout optimized for quick adjustments
- Independent component allows future master-specific features

### Negative

- Users must name their macros in Ableton for them to appear
- Shows empty state if no Audio Effect Rack on master

### Mitigations

- Clear messaging when no macros are named: "Name your macros in Ableton to show them here"
- Clear messaging when no Audio Effect Rack: "Add an Audio Effect Rack to the master track to control macros here"

## Related

- [ADR-036: Master Track Device Parameter Support](./036-master-track-device-parameter-support.md)
- [ADR-071: Audio Effect Racks Unified Browser Integration](./071-audio-effect-racks-unified-browser-integration.md)
