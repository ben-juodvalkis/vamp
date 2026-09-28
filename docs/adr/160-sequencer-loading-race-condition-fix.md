# ADR 160: Sequencer Loading Race Condition Fix

**Date:** 2026-01-15
**Status:** Superseded by ADR-163
**Context:** Fix intermittent state loss during sequencer device loading (Issue #248)

> **Note:** This ADR has been superseded by [ADR-163: Sequencer Origin-Tagged Broadcasts](./163-sequencer-origin-tagged-broadcasts.md), which provides a simpler solution using origin tags instead of grace periods.

## Problem

When users make changes to sequencer UI controls while a device is loading, the changes are intermittently lost. The UI appears to accept input, but once the device finishes loading, values revert to the device's default state. This is especially noticeable under heavy CPU load.

## Root Cause Analysis

### Race Condition 1: Broadcast Arrives Before onDeviceLoaded()

The existing grace period logic checked `lastLoadedTimestamp`, which is only set when `onDeviceLoaded()` executes. However, due to the async dynamic import in `selectedTrackStore`, Max's broadcast can arrive *before* `onDeviceLoaded()` runs:

```
Timeline (failure case under heavy CPU load):

t=0     User edits ghost state (muteSteps updated locally)
t=1     triggerLoad() → isLoading=true, loadingInitiated=true
t=2     OSC sent: /looping/devices/load

... CPU busy, event loop delayed ...

t=100   Max loads device, broadcasts state_broadcast
t=101   applyStateFromBroadcast() runs
        → lastLoadedTimestamp is still 0 (onDeviceLoaded hasn't run!)
        → timeSinceLoad = Date.now() - 0 = huge number
        → Grace period check FAILS
        → restoredFromMax = true  ← WRONG
        → UI state OVERWRITTEN with Max defaults ← BUG

... dynamic import delay ...

t=150   Dynamic import resolves
t=151   onDeviceLoaded() runs
        → sees restoredFromMax = true
        → thinks "Max restored from Live Set"
        → Skips pushing UI state ← STATE LOST
```

### Race Condition 2: Duplicate onDeviceLoaded Calls

`checkSequencerLoadingCompletion()` can be called from both:
- `handleDeviceAdded()` - when a new device appears
- `applyCompleteState()` - during complete state sync

This can trigger duplicate state pushes if both code paths fire.

## Decision

### Fix 1: Block Broadcasts During Loading Phase

Add an early check in `applyStateFromBroadcast()` to ignore broadcasts while loading is in progress:

```typescript
function applyStateFromBroadcast(state: SequencerBroadcastState) {
  // Skip if we're currently loading a device - UI state is authoritative
  if (isLoading || loadingInitiated) {
    logger.debug('Ignoring broadcast during device loading phase');
    return;
  }

  // Existing grace period check (for post-load window)
  const timeSinceLoad = Date.now() - lastLoadedTimestamp;
  if (lastLoadedTimestamp > 0 && timeSinceLoad < LOAD_GRACE_PERIOD_MS) {
    return;
  }
  // ...
}
```

This extends the "UI is authoritative" window to cover the entire loading process, not just the 500ms after `onDeviceLoaded()`.

### Fix 2: Idempotency Check in onDeviceLoaded

Prevent duplicate handling of the same device:

```typescript
let lastHandledDeviceId = $state<number | null>(null);

function onDeviceLoaded(loadedDevice: Device) {
  // Skip if we already handled this exact device
  if (loadedDevice.id === lastHandledDeviceId) {
    logger.debug('onDeviceLoaded called again for same device, skipping');
    return;
  }
  lastHandledDeviceId = loadedDevice.id;
  // ...
}
```

## Consequences

### Positive

1. **Deterministic behavior:** State synchronization no longer depends on timing/CPU load
2. **Simple fix:** Minimal code changes (~15 lines added)
3. **Preserves existing logic:** Grace period and Live Set restore logic unchanged
4. **Better logging:** Debug logs help diagnose future timing issues

### Negative

1. **Broadcast delay:** Broadcasts during loading are dropped (but we immediately push UI state after load anyway)

### Neutral

1. **No protocol changes:** OSC message format unchanged
2. **Backward compatible:** No changes to Max device

## Files Modified

- `interface/src/lib/stores/v6/sequencerStore.svelte.ts`
  - Added `lastHandledDeviceId` state variable
  - Added loading phase check in `applyStateFromBroadcast()`
  - Added idempotency check in `onDeviceLoaded()`
  - Reset `lastHandledDeviceId` in `resetToGhost()`

## Related

- Issue #248: Sequencer UI changes not persisting when made during device loading
- ADR-150: Sequencer Pending Parameter Race Condition Fix (similar pattern)
- ADR-157: Sequencer State Persistence with pattr
