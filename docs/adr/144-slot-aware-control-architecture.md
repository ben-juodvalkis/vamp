# ADR-144: Slot-Aware Control Architecture for Central Views

**Status:** Accepted
**Date:** 2025-12-13
**Related PR:** [#197 - feat: Slot-aware controls with ghost/loading states for central views](https://github.com/ben-juodvalkis/louisville/pull/197)
**Related ADRs:** [ADR-140 XY Control Position Ownership](./140-xy-control-position-ownership.md)

## Context

Central views (like `ArpeggiatorCentralView`) were gated with `{#if device}` blocks, preventing any UI from rendering until the device loaded. This caused several UX problems:

1. **Delayed feedback** - Users saw placeholders instead of controls when tapping FX grid items
2. **Virtual device blocking** - Random/Velocity controls in ArpeggiatorCentralView couldn't render independently, even when loaded
3. **Wasted pending parameter system** - The infrastructure for queuing parameters during loading existed but wasn't used by central view controls

### Before: Inconsistent Control Patterns

**FX Grid Controls** (RandomControl, DelayControl, etc.)
- Used `BaseDeviceControl` wrapper
- Queried slot state from `selectedTrackStore.getFxGridSlot()`
- Supported ghost/loading/active states
- Always rendered UI

**Central View Controls** (sliders in ArpeggiatorCentralView, etc.)
- Received `device` prop from parent
- Gated with `{#if device}` - no rendering until loaded
- No ghost state handling
- No pending parameter support

## Decision

### Slot-Aware Controls Render Immediately

Every parameter control in central views:
1. Queries its own slot state (not passed via props)
2. Renders immediately in ghost state when device not loaded
3. Handles ghost/loading/active states internally
4. Uses pending parameters automatically

### Central Views Become Pure Layout

Central views no longer gate rendering - they're layout components only:

```svelte
<!-- NO {#if device} gate - always render -->
<div class="h-full w-full flex p-4 gap-4">
  <SlotAwareDiscreteSlider slotKey="arpeggiator" paramName="Pattern" />
  <SlotAwareSlider slotKey="arpeggiator" paramName="Gate" />
  <RandomControl />  <!-- Queries slot internally -->
</div>
```

### New Component Family

| Component | Purpose |
|-----------|---------|
| `SlotAwareSlider` | Continuous parameters (0-1 float) |
| `SlotAwareDiscreteSlider` | Enum parameters with labels from device-configs.json |

Both components:
- Look up parameter metadata from `data/device-configs.json` by name
- Display `default` values in ghost state
- Queue pending parameters during loading
- Apply pending params when device becomes active

### Parameter Lookup from device-configs.json

Instead of hardcoding parameter indices:

```svelte
<!-- Before: Magic numbers -->
<Slider paramIndex={5} min={0} max={13} />

<!-- After: Declarative -->
<SlotAwareDiscreteSlider slotKey="arpeggiator" paramName="Rate" />
```

The `parameterLookup.ts` utility resolves parameter configs:

```typescript
// deviceType → className → parameters → find by name
getParameterConfig('arpeggiator', 'Rate')
// Returns: { index: 5, min: 0, max: 13, labels: [...], default: 6 }
```

### Virtual Device Controls Self-Contained

`RandomControl` and `VelocityControl` no longer require a `device` prop. `BaseDeviceControl.device` was made optional - it derives from the slot when not provided:

```svelte
<!-- Parent no longer needs to look up device -->
<RandomControl />
<VelocityControl />
```

### ADR-140 Pattern Applied Universally

All 15 XY-based device controls now use `untrack()` to prevent position jumping during ghost/loading state. This ensures the component owns its visual position, updated only by:
1. User finger (drag interaction)
2. State messages (track change, device load)
3. Defaults (ghost state)

NOT by optimistic cache updates.

## Implementation

### Files Created
- `interface/src/lib/components/v6/controls/SlotAwareSlider.svelte`
- `interface/src/lib/components/v6/controls/SlotAwareDiscreteSlider.svelte`
- `interface/src/lib/utils/parameterLookup.ts`

### Central Views Migrated (12 total)
- ArpeggiatorCentralView, EchoCentralView, AutoFilterCentralView
- ReverbCentralView, CompressorCentralView, PedalCentralView
- TremoloCentralView, DrumCentralView, EQCentralView
- PitchCentralView, ReduxCentralView, ChorusCentralView, UtilityCentralView

### XY Controls Fixed (ADR-140 pattern)
ChorusControl, CombControl, SmudgeControl, DelayControl, AutoFilterControl, ReverbControl, DrumControl, PitchControl, GateControl, SaturatorControl, PedalControl, DigitalControl, DigitalLFOControl, PitchHelixControl, EQControl

### CSS Variables Required

Ghost state styling uses CSS variables in `app.css`:

```css
.slot-ghost { opacity: 0.75; }
.slot-ghost-bg { background: color-mix(in srgb, rgb(107, 114, 128), transparent 90%); }
.slot-loading-pulse { animation: slot-undulate 2s ease-in-out infinite; }
```

### device-configs.json Requirements

Every parameter used by SlotAware components must have:
- `name` or `displayName` for lookup
- `default` for ghost state display
- `labels` array for discrete sliders

## Consequences

### Positive
- **Instant UI** - Central views render immediately, no waiting for devices
- **Virtual device independence** - Random/Velocity work even if arpeggiator hasn't loaded
- **Simpler views** - Central views are ~50 lines of layout, not 300+ lines of parameter logic
- **Consistent ghost styling** - Same visual pattern across FX grid and central views
- **Single source of truth** - Parameter metadata lives in device-configs.json
- **Pending params by default** - User interactions during loading are captured automatically

### Trade-offs
- **device-configs.json maintenance** - Must add `default` values for all displayed parameters
- **Component<any> in viewRegistry** - Type system limitation due to heterogeneous component props (documented in codebase)
- **Instrument views not migrated** - Different pattern (preset browsing vs parameter control)

### Technical Notes
- `viewRegistry.ts` uses `Component<any>` because central views have different prop shapes
- The slot system already handled device matching by `className + name` (not position)
- Pending params are cleared on track change (correct behavior preserved)

## Verification

Tested scenarios:
1. Central views render immediately when tapped (no placeholder)
2. Ghost state shows default values from device-configs.json
3. Interacting with ghost control triggers device load + stores pending params
4. Pending params apply when device loads
5. XY controls preserve position on release during ghost/loading state
6. Virtual devices work independently in ArpeggiatorCentralView
7. Track change resets controls to ghost state
