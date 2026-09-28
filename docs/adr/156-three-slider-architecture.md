# ADR-156: Two-Slider Architecture

## Status
Accepted (Revised)

## Context
The codebase had accumulated 9 different slider components with overlapping concerns:

- `VerticalSlider` - General vertical slider with optional absolute mode
- `DeviceVerticalSlider` - Vertical slider for device parameters (relative only)
- `HorizontalSlider` - Horizontal orientation
- `VerticalDiscreteSlider` - Step-based slider (unused)
- `SlotAwareSlider` - FX grid with ghost/loading states
- `SlotAwareDiscreteSlider` - FX grid discrete values
- `DeviceSlider` - Track faders with meter visualization
- `TouchSlider` - Legacy component (unused)

Issue #238 reported the START slider in DrumRackCentralView felt "wonky" because it used `DeviceVerticalSlider` which only supported relative mode (drag delta). Users expected smooth, responsive touch interaction on iPad.

## Decision

### Initial Approach (Rejected)
Initially, we planned to create a third component `UnifiedSlider` for central views. However, testing revealed that `DeviceSlider` already had superior touch behavior due to:
- **Local state management** (`localValue`) for immediate visual feedback
- **Throttling** at 16ms (~60fps) for smooth OSC message delivery
- **Relative dragging** with proper delta calculations

### Final Decision
Consolidate to **2 slider components** with clear separation of concerns:

| Component | Purpose | Features |
|-----------|---------|----------|
| **DeviceSlider** | All sliders (central views, track faders) | Relative dragging, throttling, local state, meter visualization, both orientations |
| **SlotAwareSlider(s)** | FX grid with ghost/loading states | Ghost state handling, device loading, pending parameter storage |

### DeviceSlider Props
```typescript
interface Props {
  value?: number;                              // Current value (0-1 normalized)
  title?: string;                              // Display label
  onInteraction?: (value: number) => void;     // Value change callback
  onTap?: () => void;                          // Tap callback (optional)
  isGhost?: boolean;                           // Ghost state styling
  orientation?: 'vertical' | 'horizontal';     // Default: 'vertical'
  color?: DeviceColorScheme;                   // { primary, secondary, accent }
  min?: number;                                // Default: 0
  max?: number;                                // Default: 1
  track?: MeterTrack | null;                   // Optional meter visualization
  trackIndex?: number;                         // Track index for meter
}
```

### Key Decisions

1. **Use DeviceSlider everywhere** - Its throttling and local state management provide smooth touch response on iPad. No need for a separate "general purpose" slider.

2. **Relative mode only** - All sliders use relative dragging. This provides consistent, predictable behavior and works better for parameter control than absolute tap-to-position.

3. **DeviceColorScheme for colors** - All sliders accept a color object `{ primary, secondary, accent }` for consistent theming.

4. **Keep SlotAwareSlider separate** - FX grid sliders need ghost state handling, device loading, and pending parameter storage. These concerns are orthogonal to basic slider behavior.

## Files Changed

### Deleted (6 files)
- `VerticalSlider.svelte`
- `DeviceVerticalSlider.svelte`
- `HorizontalSlider.svelte`
- `VerticalDiscreteSlider.svelte`
- `TouchSlider.svelte`
- `UnifiedSlider.svelte` (created then deleted during this work)

### Modified (10 files to use DeviceSlider)
- `DrumRackCentralView.svelte` - Issue #238 fix
- `DelayCentralView.svelte`
- `BassCentralView.svelte`
- `PedalCentralView.svelte`
- `AudioEffectRackCentralView.svelte`
- `KompleteKontrolCentralView.svelte`
- `GuitarCentralView.svelte`
- `ClipCentralView.svelte`
- `EQCentralView.svelte`
- `InstrumentRackCentralView.svelte` (already used DeviceSlider)

## Consequences

### Positive
- Issue #238 resolved - START slider now responds smoothly to touch
- Reduced component count (9 → 2)
- Simple mental model: DeviceSlider for everything, SlotAwareSlider for FX grid
- Consistent throttling and local state across all sliders
- Better iPad touch experience

### Negative
- Migration required for all central view files
- API change: `onChange` → `onInteraction`, `label` → `title`, `color` string → DeviceColorScheme object

## Usage Guidelines

**Use DeviceSlider when:**
- Building central view controls
- Building track faders
- Any general purpose slider need
- Need meter visualization overlay

**Use SlotAwareSlider when:**
- Control is in FX grid
- Need ghost/loading state handling
- Device loading on interaction
