# ADR-150: Sequencer Pending Parameter Race Condition Fix

## Status

Accepted. Sequencer drain mechanism survived the v3 migration intact;
this ADR remains current. See ADR-351 for the parallel FX-grid case
(which did need re-implementation post-v3).

## Date

2026-01-04

## Context

When the user interacts with the sequencer UI while the device is in "ghost" state (device not yet loaded), changes are queued as `pendingParams`. Once the device loads, these pending parameters should be applied. However, there was a race condition where the UI state would snap back to default values after the device loaded.

### The Race Condition

```
Timeline:
─────────────────────────────────────────────────────────────────────
t=0    User toggles step in ghost mode
       → UI updates locally (muteSteps[i] = newValue)
       → pendingParams.set(paramIndex, value)
       → triggerLoad() starts device loading

t=50   User toggles another step while loading
       → UI updates locally again
       → pendingParams adds more entries

t=100  Complete state arrives from Ableton
       → handleCompleteDeviceState() runs
       → checkSequencerLoadingCompletion() → onDeviceLoaded(device)
       → pendingParams sent to Ableton ✓
       → pendingParams.clear()
       → isLoading = false
       → justLoaded = true  ← flag set but never checked!

t=101  $effect in MuteSequencerControl reacts to device change
       → isLoading is now FALSE
       → calls loadFromMap(device)  ← THIS WAS THE BUG
       → loadFromMap reads from parameter cache (default values)
       → UI snaps back to defaults! ✗
```

### Root Cause

The `justLoaded` flag was intended to prevent `loadFromMap()` from overwriting UI state after a fresh device load (as noted in the comment: "Track if we just finished loading to prevent Map overwrite"). However, `loadFromMap()` never actually checked this flag - it just unconditionally loaded all parameters from the cache.

```typescript
// The bug: justLoaded was set but never checked
function loadFromMap(activeDevice: Device) {
  // ❌ No check for justLoaded!
  for (let i = 0; i < 8; i++) {
    muteSteps[i] = (selectedTrackStore.getParameterValue(activeDevice.id, i + 1) ?? 1) > 0.5;
    // ...
  }
  // ...
  justLoaded = false; // Only cleared it, never checked it
}
```

## Decision

Add an early-return check in `loadFromMap()` to respect the `justLoaded` flag:

```typescript
function loadFromMap(activeDevice: Device) {
  // Skip if we just loaded via onDeviceLoaded - pending params were already applied
  // and the cache may not yet reflect them (race condition fix for issue #206)
  if (justLoaded) {
    justLoaded = false;
    return;
  }

  // Read all 21 parameters from Map
  // ...
}
```

This ensures that when the device has just loaded (and pending params have been applied), we don't immediately overwrite the UI state with potentially stale cache values.

## Consequences

### Positive

- UI state is preserved during ghost → active transition
- Pending parameter values are correctly reflected in the UI
- No flickering or reverting of step states during load
- Simple fix with minimal code changes
- Follows the same pattern as ADR-087 (pending parameter race condition fix for FX grid)

### Negative

- None identified

### Files Changed

- `interface/src/lib/stores/v6/sequencerStore.svelte.ts` - Added justLoaded check in loadFromMap()
- `interface/src/lib/components/v6/clips/MuteSequencerControl.svelte` - Updated comments
- `interface/src/lib/components/v6/clips/PitchSequencerControl.svelte` - Updated comments

### Cleanup

Removed unused `lastDeviceId` state variable that was being set but never read.

## Related

- Issue #206: Sequencer UI doesn't always update to correct state after device loads with pending changes
- ADR-087: Pending Parameter Race Condition Fix (similar fix for FX grid)
- ADR-149: Central View $derived Reactivity Pattern (related reactivity patterns)
