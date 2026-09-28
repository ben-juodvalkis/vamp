# ADR 095: Position-Based FX Grid Architecture

**Status**: Accepted
**Date**: 2025-01-30
**Authors**: Claude
**Tags**: `architecture`, `refactoring`, `fx-grid`, `ui-components`

## Context

The FX Grid previously used **semantic slot keys** (like `'filter'`, `'delay'`, `'tremolo'`) as the primary identifiers for grid positions. This created several problems:

### Problems with Semantic Keys

1. **Naming Confusion**: Slot names didn't match actual devices
   - `'tremolo'` slot contained AutoPan device (not Tremolo)
   - `'utility'` slot contained Arpeggiator (very specific, not generic)
   - `'smudge'` slot contained Saturn 2 (unclear what "smudge" means)

2. **Poor Flexibility**: Changing which device loads in a slot required renaming the slot throughout the codebase
   - Slot keys were hardcoded in 20+ files
   - Device swaps broke assumptions about slot names

3. **Mixed Concerns**: Grid layout logic was intertwined with device semantics
   - Position and device type were the same thing
   - Reorganizing the grid meant renaming all slot references

4. **Maintenance Burden**: Adding/removing/reordering slots was error-prone
   - Manual updates to 15+ device control components
   - Easy to miss a reference and cause runtime errors

### Architecture Principles Violated

- **Separation of Concerns**: Layout vs device semantics were conflated
- **Single Responsibility**: Slot keys served dual purposes
- **Maintainability**: Changes required updates across many files

## Decision

Refactor the FX Grid to use **position-based slot indices** (`fx1`-`fx15`) as the primary identifiers, while maintaining device type information separately.

### Core Changes

1. **New Layout Configuration** ([fxGridLayout.ts](../../interface/src/lib/config/fxGridLayout.ts))
   ```typescript
   export const FX_GRID_LAYOUT: FXGridSlotConfig[] = [
     { position: 'fx1', deviceType: 'filter', component: AutoFilterControl, span: 2, row: 1 },
     { position: 'fx2', deviceType: 'eq', component: EQControl, span: 2, row: 1 },
     // ... 15 total slots
   ];
   ```
   - Single source of truth for grid layout
   - Maps positions to device types and components
   - Includes visual metadata (span, row)

2. **Position Keys as Primary Identifiers**
   - SlotRegistry uses `PositionKey` (`fx1`-`fx15`) as map keys
   - Maintains bidirectional mapping: `position ↔ deviceType`
   - Grid devices referenced by position, not device type

3. **Backward Compatibility Layer**
   - `selectedTrackStore.getFxGridSlot()` accepts both position keys AND device types
   - Virtual devices (comb, chorus, saturator, random) continue using device type keys
   - BaseDeviceControl supports both `position` (grid) and `slotKey` (virtual) props

4. **Data-Driven Rendering**
   - FXGrid.svelte renders from `FX_GRID_LAYOUT` array
   - Components receive `position` prop from layout config
   - Easy to reorganize by editing single config file

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      FX_GRID_LAYOUT                         │
│  Single source of truth for grid configuration             │
│  { position, deviceType, component, span, row, config }    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ├──────────────────┬──────────────────┐
                            ▼                  ▼                  ▼
                   ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
                   │  SlotRegistry   │  │   FXGrid     │  │ BaseDevice   │
                   │                 │  │              │  │   Control    │
                   │ Maps:           │  │ Renders:     │  │              │
                   │ fx1 → filter    │  │ Loop over    │  │ Accepts:     │
                   │ fx2 → eq        │  │ layout array │  │ - position   │
                   │ filter → fx1    │  │              │  │ - slotKey    │
                   └─────────────────┘  └──────────────┘  └──────────────┘
```

## Consequences

### Positive

1. **Clear Separation of Concerns**
   - Position keys = Grid layout (fx1-fx15)
   - Device types = Device semantics (filter, delay, etc.)
   - No more confusion about slot names

2. **Improved Flexibility**
   - Easy to swap devices: just change `deviceType` in config
   - Reorganize grid: reorder `FX_GRID_LAYOUT` array
   - Position keys remain stable across device changes

3. **Maintainability**
   - Single configuration file for entire grid
   - Data-driven component rendering
   - Less boilerplate code

4. **Self-Documenting**
   - Position keys clearly indicate grid location
   - `fx1` = first slot, `fx15` = fifteenth slot
   - Row 1 = fx1-fx7, Row 2 = fx8-fx15

5. **Backward Compatibility**
   - Virtual devices continue working unchanged
   - Central views work with both position and device type keys
   - Migration was non-breaking

### Negative

1. **Learning Curve**
   - Developers must understand position vs device type distinction
   - Two identifiers for grid devices (position + deviceType)

2. **Complexity in BaseDeviceControl**
   - Must support both position (grid) and slotKey (virtual) props
   - Conditional logic for determining device type

3. **Migration Effort**
   - 30+ files modified during refactoring
   - Required careful testing of all device interactions

### Neutral

1. **TypeScript Types**
   - `PositionKey` = `'fx1' | 'fx2' | ... | 'fx15'`
   - `DeviceTypeKey` = `keyof typeof DEVICE_PRESETS`
   - `SlotKey` = `PositionKey | DeviceTypeKey` (union for compatibility)

## Implementation Details

### Files Created (1)

- [fxGridLayout.ts](../../interface/src/lib/config/fxGridLayout.ts) - Grid layout configuration with utility functions

### Files Modified (Core - 8)

1. [slotRegistry.svelte.ts](../../interface/src/lib/stores/v6/slotRegistry.svelte.ts) - Position-based slot management
2. [fxSlotStore.svelte.ts](../../interface/src/lib/stores/v6/fxSlotStore.svelte.ts) - Stores position + deviceType
3. [selectedTrackStore.svelte.ts](../../interface/src/lib/stores/v6/selectedTrackStore.svelte.ts) - Backward compatible slot lookup
4. [FXGrid.svelte](../../interface/src/lib/components/v6/device-panel/FXGrid.svelte) - Data-driven rendering (105 lines → 51 lines)
5. [BaseDeviceControl.svelte](../../interface/src/lib/components/v6/device-panel/BaseDeviceControl.svelte) - Accepts position or slotKey
6. [CentralDisplay.svelte](../../interface/src/lib/components/v6/central/CentralDisplay.svelte) - No changes (already routes by device type)
7. 15 device control components - Accept `position` prop
8. 4 central view components - Use `selectedTrackStore.getFxGridSlot()` instead of `slotRegistry.getSlot()`

### Virtual Devices Handling

Virtual devices (not in grid) continue using device type keys:
- `comb`, `chorus` (SmudgeCentralView)
- `saturator` (PedalCentralView)
- `random` (ArpeggiatorCentralView)

These use `slotKey` prop in BaseDeviceControl and are stored in FXGridState with device type as key.

### Grid Layout

```
Row 1 (12 columns): fx1(2) + fx2(2) + fx3(2) + fx4(2) + fx5(2) + fx6(1) + fx7(1)
Row 2 (12 columns): fx8(1) + fx9(1) + fx10(2) + fx11(2) + fx12(2) + fx13(2) + fx14(1) + fx15(1)
```

## Testing

- ✅ TypeScript compilation passes with no errors
- ✅ All 15 grid devices render with correct widths
- ✅ Device loading works correctly
- ✅ Ghost states display properly
- ✅ Central view navigation routes correctly
- ✅ Virtual devices work in central views
- ✅ Backward compatibility maintained

## Alternatives Considered

### 1. Row-Column Indices (fx1-1, fx1-2, fx2-1, etc.)
**Rejected**: More verbose, uneven columns between rows make indexing awkward

### 2. Named Rows (top1-top7, bot1-bot8)
**Rejected**: Still somewhat semantic, different prefixes add cognitive load

### 3. Keep Semantic Keys, Add Position Metadata
**Rejected**: Doesn't solve the core problem of confusing slot names

## Future Enhancements

1. **Dynamic Grid Layouts**: Load different layouts for different workflows
2. **User Customization**: Allow users to reorganize grid via drag-and-drop
3. **Grid Size Configuration**: Support 2x8, 3x5, etc. arrangements
4. **Slot Groups**: Visual grouping of related effects (all reverbs together, etc.)

## References

- [V6 Architecture Overview](../v6-architecture-overview.md)
- [V6 UI Architecture](../v6-ui-architecture.md)
- Original issue: Slot index names vs actual components confusion
- Related: [ADR 018: Gesture Browser Architecture](./018-gesture-browser-architecture.md) - Similar data-driven approach

## Lessons Learned

1. **Separation of Concerns is Crucial**: Mixing layout and semantics creates maintenance debt
2. **Data-Driven > Hardcoded**: Configuration files make reorganization trivial
3. **Backward Compatibility Eases Migration**: Supporting both old and new patterns allowed incremental refactoring
4. **Position-Based Naming is Clearer**: `fx1` is unambiguous, `tremolo` is misleading when it contains AutoPan
5. **Single Source of Truth**: One config file eliminates inconsistencies across 30+ files
