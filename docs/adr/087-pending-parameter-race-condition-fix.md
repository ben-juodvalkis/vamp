# ADR-087: Pending Parameter Race Condition Fix

**Status**: Superseded by ADR-351 (FX grid case) for the v3 backend.
**Date**: 2025-10-25
**Deciders**: Development Team
**Related**: ADR-049 (Complete State Architecture), ADR-081 (DeviceXY Relative Mode), ADR-351 (v3 re-implementation)

> **2026-04-26 supersession note.** The drain trigger described below
> hooked into `handleCompleteDeviceState`, which the v3 Python control
> surface migration removed. ADR-351 re-implements the same drain at
> the v3 layer via an `$effect.root` watcher on `devicesByPath`.
> Sequencer drain (ADR-150) is unaffected by the migration.

---

## Context

During device loading, users can interact with XY gesture controls to set parameter values optimistically while the device is still loading. However, a race condition existed where:

1. **User touches XY pad** → Triggers device loading + stores pending parameters
2. **User drags XY immediately** → Updates local UI state + stores more pending parameters  
3. **Device loads in Max4Live** → Sends complete state with default parameter values
4. **Complete state overwrites cache** → XY snaps back to device defaults
5. **Pending parameters never applied** → Ableton device has defaults, UI shows defaults

This created a frustrating user experience where optimistic gestures were lost during device loading.

## Problem Analysis

**Root Cause**: The `checkLoadingCompletion()` method was only called from `handleDeviceAdded()`, but the system had migrated to the complete state architecture where individual device add/remove events were replaced with batch complete state messages.

**Investigation Process**:
- Added comprehensive debug logging to trace parameter flow
- Discovered complete state messages contained the loaded device
- Found that `handleCompleteDeviceState()` never called `checkLoadingCompletion()`
- Confirmed pending parameters were stored but never applied

**Specific Failure**:
```typescript
// This was never called in complete state flow:
this.fxGrid.checkLoadingCompletion(device);
```

## Decision

**Add `checkLoadingCompletion()` calls to `handleCompleteDeviceState()`** to ensure pending parameters are applied when devices appear in complete state messages.

**Implementation**:
```typescript
// Check for loading completion (apply pending parameters)
devices.forEach(device => {
    this.fxGrid.checkLoadingCompletion(device);
    this.checkSequencerLoadingCompletion(device);
});
```

**Placement**: After parameter cache population but before final logging, ensuring the cache reflects both default values and applied pending parameters.

## Implementation Details

**Performance Considerations**:
- **Client-side only**: Runs in browser, zero Max4Live impact
- **Frequency**: Only when complete state changes (not continuous)
- **Cost**: ~98 string comparisons (14 slots × 7 devices) taking ~0.1ms
- **Optimization opportunity**: Could add early exit for loading slots only

**Debug Logging Added**:
- Pending parameter storage tracking
- Device loading completion detection  
- OSC message transmission confirmation
- Parameter application verification

## Consequences

**Positive**:
- ✅ **Fixed race condition**: XY gestures and sequencer interactions during loading now persist correctly
- ✅ **Maintained optimistic UI**: Users see immediate visual feedback
- ✅ **Synchronized state**: Cache matches what's sent to Ableton
- ✅ **Architecture consistency**: Works with complete state system for all device types
- ✅ **Zero Max4Live overhead**: Pure client-side solution
- ✅ **Comprehensive coverage**: FX grid, sequencer, and central view devices all protected

**Negative**:
- ❌ **Slightly increased client CPU**: Extra device iteration per complete state
- ❌ **Debug logging noise**: Temporary verbose console output (removable)

**Neutral**:
- 🔄 **Alternative approach considered**: Could optimize with loading slot filtering
- 🔄 **Future improvement**: Device change detection for minimal checking

## Update History

**2025-10-27**: Extended fix to include sequencer device loading completion. Added `checkSequencerLoadingCompletion()` call to ensure sequencer step interactions during loading persist correctly, providing comprehensive race condition protection for all device types.

## Tags

`device-loading`, `xy-gestures`, `sequencer-interactions`, `race-condition`, `pending-parameters`, `complete-state-architecture`, `performance-optimization`