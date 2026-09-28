# ADR-140: XY Control Position Ownership (Echo/AutoPan Jump Fix)

**Status:** Superseded by [ADR-359](./359-unified-param-position-ownership.md) (2026-04-29)
**Date:** 2025-12-01
**Related:** [DeviceXY.svelte](../../interface/src/lib/components/v6/device-panel/DeviceXY.svelte), [EchoControl.svelte](../../interface/src/lib/components/v6/device-panel/EchoControl.svelte), [AutoPanLegacyControl.svelte](../../interface/src/lib/components/v6/device-panel/AutoPanLegacyControl.svelte)

> **Superseded note (2026-04-29):** This ADR's component-local `$state` shadow with `untrack`'d initialization is no longer the pattern. ADR-359 moves the lossy-round-trip suppression into the v3 store via UI-armed paths, collapsing the three concurrent representations of "where is the dot" (component-local, `slot.pendingParams`, `paramByPath`) into one. FX components now read `selectedTrackStore.paramValueArmed(...)` via `$derived` with no shadow state. The visual snap that ADR-140 hid (e.g. Echo's continuous X=0.7 → quantized 0.667) is now exposed honestly — see ADR-359 §"Lossy controls".

## Context

Echo and AutoPan XY controls exhibited a visual "jump" when the user released the pointer after dragging. The visual dot would snap to a different position instead of staying exactly where the user dragged it. Other XY controls (AutoFilter, Reverb) did not have this issue.

### Root Cause Analysis

**The Problem: Bidirectional Coordinate Conversion with Optimistic Updates**

Echo and AutoPan have **lossy bidirectional coordinate conversion** between visual position and Ableton parameter values:

```typescript
// Echo: Visual X (0-1) ↔ Ableton time parameter (4-1, discrete steps)
// User drags to X=0.7
const timeActual = Math.round(4 - (0.7 * 3));  // → 2
sendParam(4, timeActual);  // Optimistic cache update: param[4] = 2
// $effect re-runs, reconstructs position:
timeValue = (4 - 2) / 3;  // → 0.667 ← JUMP from 0.7!
```

**Why AutoFilter/Reverb worked:** They have **1:1 mapping** (visual 0-1 = parameter 0-1), so round-tripping through the cache preserves the exact value.

### Data Flow That Caused Jumps

1. User drags XY to position (0.7, 0.5)
2. `onInteraction` quantizes to Ableton values and calls `sendParam()`
3. `sendParam()` does **optimistic cache update** (line 136 in selectedTrackStore)
4. Version counter increments → triggers Svelte reactivity (line 121)
5. Component's `$effect` re-runs
6. Reconstructs visual position from quantized cache values → **different value**
7. DeviceXY receives updated prop → visual jumps

## Decision

**Components own their visual position.** Position is set ONLY by:

1. **Finger** - User drag updates visual values directly in `onInteraction`
2. **State message** - Track change or device load triggers `$effect` to read from store
3. **Default** - Ghost devices show default position

**NOT** set by optimistic cache updates.

### Implementation

```typescript
// Component owns visual state
let timeValue = $state(0.667);
let feedbackValue = $state(0);

$effect(() => {
  // ONLY sync on device object reference change (state messages)
  if (device) {
    // untrack() prevents reactive dependencies on parameter reads
    timeValue = untrack(() => {
      const raw = selectedTrackStore.getParameterValue(device.id, 4) ?? 2;
      return (4 - Math.min(Math.max(raw, 1), 4)) / 3;
    });
    feedbackValue = untrack(() =>
      selectedTrackStore.getParameterValue(device.id, 16) ?? 0
    );
  } else {
    // Default on ghost
    timeValue = 0.667;
    feedbackValue = 0;
  }
});

onInteraction={(x, y) => {
  // FINGER sets position - update visual values immediately
  timeValue = x;
  feedbackValue = y;

  // Send quantized values to Ableton
  const timeActual = Math.round(4 - (x * 3));
  sendParam(4, timeActual);
  sendParam(16, y * 0.67);
  // Visual stays at (x, y) - ignores optimistic cache updates
}}
```

### Key Techniques

1. **Track device object reference only** - `$effect(() => { if (device) { ... } })` only re-runs when the `device` prop object reference changes (state messages), NOT on optimistic updates
2. **untrack() all parameter reads** - Prevents reactive dependencies on `getParameterValue()` which is backed by a reactive Map
3. **Direct visual updates in onInteraction** - `timeValue = x; feedbackValue = y;` before sending to Ableton

## Consequences

### Positive

- ✅ **No visual jumps** - Position stays exactly where user dragged
- ✅ **Correct state sync** - Still syncs on track change, device load
- ✅ **Simpler mental model** - Component owns visual, store owns Ableton state
- ✅ **Consistent pattern** - Matches AutoFilter/Reverb (they already owned their values)

### Trade-offs

- ⚠️ **External parameter changes not reflected** - If user tweaks Echo time via hardware MIDI controller or automation, visual won't update until next interaction
  - **Acceptable** because these controls have lossy conversion - visual represents "last user XY interaction" not "live Ableton parameter"
  - Alternative would reintroduce the jump problem

### Technical Notes

- The `device` prop comes from `selectedTrackStore._devices` array
- This array is only recreated on complete state messages (line 604), not individual parameter updates
- Optimistic updates only mutate the parameter Map (lines 105-122), device object stays same
- Therefore `$effect(() => { if (device) {...} })` only runs on state messages ✓

## Files Modified

- [EchoControl.svelte:38-109](../../interface/src/lib/components/v6/device-panel/EchoControl.svelte#L38-L109)
- [AutoPanLegacyControl.svelte:60-172](../../interface/src/lib/components/v6/device-panel/AutoPanLegacyControl.svelte#L60-L172)

## Verification

Tested scenarios:
1. ✅ Echo X-axis: Drag to X=0.7 → stays at 0.7 (not 0.667)
2. ✅ AutoPan Y-axis: Drag to Y=0.8 → stays at 0.8 (no reconstruction errors)
3. ✅ Track switching: Switches to new track → reads correct device params
4. ✅ Device loading: Ghost interaction → triggers load → syncs to loaded params
5. ✅ Rapid drags: Multiple successive drags → each position preserved
