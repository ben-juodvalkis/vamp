# ADR 050: Component State Management - $state + $effect Pattern

**Date:** 2025-10-12
**Status:** Partially Superseded by ADR-149
**Context:** Complete State Architecture component integration
**Supersedes:** Initial $derived approach (abandoned during implementation)

> **⚠️ PARTIALLY SUPERSEDED BY ADR-149**
>
> The `$state + $effect` pattern documented here has edge cases with Svelte 5's
> execution-time dependency tracking. For **central view components**, use the
> `$derived` pattern instead. See [ADR-149](./149-central-view-derived-reactivity.md).
>
> The `$state + $effect` pattern remains valid for:
> - Sequencer components (with `justLoaded` guard per ADR-150)
> - Components that need mutable local state during drag operations

## Problem

With no real-time observers for device parameters, components needed a way to:
1. Initialize from Map when device loads/changes
2. Manage their own state during user interaction
3. Not fight with reactive prop updates during drag
4. Handle both device parameters (no observers) and observed properties (clip/groove with observers)

## Decision

Use **$state + $effect pattern** for device parameter components, with clear separation between device parameters and observed properties.

## Pattern for Device Parameters

### Parent Components (Device Controls, Central Views)

**Read once when device changes, then own the value:**

```typescript
let paramValue = $state(defaultValue);

$effect(() => {
  if (device) {
    paramValue = store.getParameterValue(device.id, paramIdx) ?? defaultValue;
  } else {
    paramValue = defaultValue;
  }
});
```

**Why $effect not $derived:**
- `$derived` creates continuous reactive dependency on Map
- Would re-evaluate whenever Map changes (never, except track switch)
- `$effect` reads once when device changes, then stops tracking
- Component owns value, no reactive interference

### Slider Components (DeviceXY, DeviceSlider, DeviceVerticalSlider)

**Local state with prop sync:**

```typescript
let localValue = $state(value); // Initialize from prop

$effect(() => {
  localValue = value; // Sync from prop
});

// User interaction
onDrag={(newValue) => {
  localValue = newValue; // Update local immediately
  onChange(newValue); // Send to Ableton
}}
```

**Why sync is safe:**
- Props only change on track switch (no observers updating Map)
- Never changes during drag
- No fighting between user input and prop updates

### User Interaction Handlers

**All interaction handlers MUST update local state before sending:**

```typescript
function handleFilterTypeChange(newType: number) {
  filterType = newType; // Update local state FIRST
  store.setParameter(device.id, 4, newType); // THEN send
}
```

**Why:** Immediate visual feedback. User sees change instantly, send happens in background.

## Separation of Concerns

### Device Parameters (Complete State - No Observers)

**Components:**
- DeviceXY
- DeviceSlider
- DeviceVerticalSlider
- OrbControl
- All *Control.svelte (FX Grid)
- All *CentralView.svelte device param sections

**Pattern:** $state + $effect, read once on device change

### Observed Properties (Real-Time Observers)

**Components:**
- VerticalSlider (for clip/groove controls)
- VerticalDiscreteSlider (already correct, no local state)

**Pattern:** Can use $derived or sync more frequently (observers update store values)

**Used by:**
- ClipCentralView (groove controls: shuffle, random)
- SimplerCentralView (LiveAPI properties: playback_mode, warp_mode, etc.)

## Why Not $derived Everywhere?

**We tried:** Using `$derived` to read from Map created reactive dependencies.

**Problem:**
1. Map updates on track switch
2. Component `$derived` re-evaluates
3. Prop to slider component changes
4. Slider has local state for drag
5. **Conflict:** Reactive prop vs stateful drag
6. Result: Jumpback, complexity, fighting

**Solution:** $effect reads once, breaks reactive chain, component owns state.

## Special Cases

### Sequencer

**22 parameters, special loading UX:**

```typescript
$effect(() => {
  if (device) {
    if (sequencerStore.isLoading) {
      // Fresh load - apply pending params, don't load from Map
      sequencerStore.onDeviceLoaded(device);
    } else if (!sequencerStore.justLoaded) {
      // Track switch - load from Map
      sequencerStore.loadFromMap(device);
    }
  } else {
    sequencerStore.resetToGhost();
  }
});
```

**Handles:** Pending params on ghost load + track switch updates

## Key Insights

1. **No observers = props only change on track switch**
   - Makes $effect sync in sliders safe
   - No prop updates during drag

2. **Component lifecycle matches data lifecycle**
   - Device changes → component $effect runs once
   - Component owns state until next device change
   - Clean, predictable

3. **Local state for interactions**
   - Immediate visual feedback
   - No waiting for network round-trip
   - User experience is smooth

## Code Removed

- ~250 lines of DeviceParameterCache complexity
- All subscription Maps and tracking
- Debounce timers in cache
- Optimistic cache updates (tried, abandoned)
- LRU eviction
- Complex key management

## Code Added

- ~50 lines DeviceParameterStorage (simple Map)
- $effect blocks in 30 component files
- DeviceVerticalSlider component (separation from observed properties)

**Net:** Simpler, less code, more maintainable

## Testing Criteria

- ✅ Track switch updates all device parameter UI
- ✅ Drag sliders smooth, no jumpback
- ✅ Click buttons updates immediately
- ✅ Sequencer loads with pending params
- ✅ Clip/groove controls still work (observed properties)
- ✅ No console errors or warnings

## Related

- ADR-040: Complete State Architecture (parent decision)
- ADR-039: Device Subscription Optimization (superseded)
