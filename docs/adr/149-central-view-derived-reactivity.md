# ADR-149: Central View $derived Reactivity Pattern

## Status

Accepted

## Date

2025-12-30

## Context

Central views (22 components) that display device parameters were experiencing intermittent reactivity failures. When loading instruments like Komplete Kontrol or Omnisphere, the UI would sometimes show default values (0.5) instead of the actual parameter values from Ableton.

### The Buggy Pattern

All affected central views used this pattern:

```typescript
let paramValue = $state(0.5);

$effect(() => {
  if (device) {
    paramValue = selectedTrackStore.getParameterValue(device.id, 1) ?? 0.5;
  } else {
    paramValue = 0.5;
  }
});
```

### Root Cause

In Svelte 5, `$effect` dependencies are tracked **at execution time**, not declaration time:

1. Component mounts, effect runs
2. If `device` is null → `getParameterValue()` never executes
3. Effect only tracks `device` as a dependency, not the store's internal `version` counter
4. State message arrives, `version` increments
5. Effect doesn't re-run because `version` isn't a tracked dependency
6. UI shows stale default values

### Why Intermittent

- **Works**: State arrives before component mounts → `device` already defined → effect calls `getParameterValue()` → `version` dependency established
- **Fails**: State arrives after initial effect run → effect only depends on `device` → `version` changes ignored

## Decision

Replace all `$state` + `$effect` patterns with `$derived` for parameter and property values:

```typescript
// BEFORE (buggy)
let paramValue = $state(0.5);
$effect(() => {
  if (device) {
    paramValue = selectedTrackStore.getParameterValue(device.id, 1) ?? 0.5;
  } else {
    paramValue = 0.5;
  }
});

// AFTER (correct)
let paramValue = $derived(
  device ? selectedTrackStore.getParameterValue(device.id, 1) ?? 0.5 : 0.5
);
```

### Why This Works

1. `$derived` establishes dependencies at declaration time, not execution time
2. The ternary always evaluates `device`, establishing that dependency
3. When `device` becomes available, `getParameterValue()` is called
4. `getParameterValue()` internally reads the store's `version`, establishing that dependency
5. Future `version` changes trigger re-derivation

### Additional Changes Required

1. **Remove direct assignments in handlers**: Since `$derived` values cannot be assigned to, all optimistic update patterns like `paramValue = newValue` must be removed
2. **Remove view-level isDragging state**: Control components (`DeviceXY`, `DeviceSlider`, etc.) already manage their own dragging state and sync from props
3. **Move value transformations into $derived**: Scaling operations (e.g., ÷127) must be part of the derived expression

## Consequences

### Positive

- Parameters always reactive to store changes
- UI updates immediately when Ableton sends new values
- No more intermittent failures based on timing
- Simpler component code (no isDragging tracking, no timers)
- Handlers reduced to single `setParameter()` call

### Negative

- Cannot do optimistic updates in handlers (must rely on store's optimistic update mechanism)
- Complex transformations require `$derived.by()` for multi-line logic

### Files Changed

**Phase 1 - Instrument Views (6 files):**
- `KompleteKontrolCentralView.svelte` - 8 parameters
- `OmnisphereCentralView.svelte` - 16 parameters
- `InstrumentRackCentralView.svelte` - 16 macro parameters
- `DrumRackCentralView.svelte` - 7 parameters with ÷127 scaling
- `DrumRackKompleteKontrolCentralView.svelte` - same as InstrumentRack
- `SimplerCentralView.svelte` - parameters + 4 properties

**Phase 2 - SimplerCentralView Properties (4 properties):**
- `playback_mode`
- `sample.warp_mode`
- `sample.warping`
- `sample.slicing_sensitivity`

**Phase 3 - FX Views (16 files):**
- `AutoFilterCentralView.svelte` - 9 params
- `BassCentralView.svelte` - 1 param
- `ChorusCentralView.svelte` - 2 params
- `CompressorCentralView.svelte` - 3 properties
- `DelayCentralView.svelte` - 1 param
- `DigitalCentralView.svelte` - 2 params with ÷127 scaling
- `DrumCentralView.svelte` - 3 params
- `EchoCentralView.svelte` - 4 params
- `EQCentralView.svelte` - 5 params
- `GuitarCentralView.svelte` - 7 params
- `PedalCentralView.svelte` - 2 params
- `PitchCentralView.svelte` - 6 params
- `ReverbCentralView.svelte` - 6 params + Map cache
- `TremoloCentralView.svelte` - 3 params
- `UtilityCentralView.svelte` - 4 values

## Related

- ADR-024: Svelte 5 Version Counter Reactivity (original version counter mechanism)
- ADR-050: Component State Management Pattern
- `documentation/current/central-view-reactivity-fix.md` - Detailed implementation plan
