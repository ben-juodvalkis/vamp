# ADR-342: Close-First Policy on Gesture-Browser Release

## Status
**Accepted**

## Context

After ADR-341 unified the browser into a single press-then-hold-to-drag model, dismissing the browser on gesture release still felt inconsistent depending on *what* was under the finger at release time. A user could drag across the three kinds of targets the gesture browser exposes — patch cards, leaf folders, and high-level folders — and observe three noticeably different dismiss latencies.

The release path lived in `handleGestureEnd` inside `UnifiedGestureBrowser.v6.svelte`. An earlier fix (f6599e07, "improve background preset loading and close UI immediately") had moved the `loadPresetWithVariant(...)` call into a background `.then()` chain so the 500 ms post-load settle would not block the UI. But two awaits remained *before* the close:

```ts
// Resolve preset (blocks on high-level folder)
if (hoveredPreset) {
  preset = hoveredPreset;
} else if (currentVendorState.currentPath.length > 0) {
  preset = await currentVendorState.adapter.getRandomPreset(
    selectedVendor,
    currentVendorState.currentPath
  );
}

// Track prep re-check (blocks on every release)
trackPrepManager.reset();
await ensureTrackPrepared();

// Only now does the UI dismiss
browserModeStore.isPersistent = false;
closeButPreserveState();
```

The three symptoms this produced:

| Release target | `hoveredPreset` at release | Blocking awaits before close |
|---|---|---|
| Patch card | set (finger was over the card) | `ensureTrackPrepared()` — usually a no-op, but `trackPrepManager.reset()` cleared the `trackPreparedForCurrentVendor` flag, so `prepareTrack` ran every time, making this an OSC round-trip |
| Leaf folder | usually set — the finger naturally hovered a preset card in the adjacent column — same as patch card, and `ensureTrackPrepared` was often cached ready → *fast* |
| High-level folder | null — no preset under the finger | `getRandomPreset()` + `ensureTrackPrepared()` — worst case, ~hundreds of ms |

The inconsistency was user-visible: "browser stays open when I let go on a patch card or high-level folder, but closes immediately on a leaf folder." The root cause was that `handleGestureEnd` mixed two responsibilities — *dismissing the UI* and *resolving + loading the preset* — and let the second block the first.

## Decision

Adopt a **close-first policy** for gesture-browser release: the browser UI dismisses synchronously before any work begins. Preset resolution, track-prep re-check, and preset load all run in a background task afterwards.

### Implementation

`handleGestureEnd` is no longer `async`. It:

1. Handles trivial cases (scale mode, column-0 release, no vendor context) inline as before.
2. **Captures** everything the background task will need into locals — `hoveredPreset`, `selectedVendor`, `currentVendorState.adapter`, and a copy of `currentVendorState.currentPath`. This is necessary because the reactive state is allowed to change after the close, and the background task must not depend on `$derived` values that may have moved on.
3. Calls `closeButPreserveState()` (and clears `browserModeStore.isPersistent`) **before any awaits**.
4. Fires an IIFE that resolves the preset, re-checks track prep, loads the preset, and runs `handlePostLoad`. Errors are logged but never surface to the UI.

```ts
function handleGestureEnd(releasePosition?: { x: number; y: number }) {
  // ... scale / column-0 / no-vendor early returns ...

  // Capture before close wipes reactive state.
  const presetAtRelease = hoveredPreset;
  const vendorAtRelease = selectedVendor;
  const adapterAtRelease = currentVendorState.adapter;
  const pathAtRelease = [...currentVendorState.currentPath];

  if (!presetAtRelease && pathAtRelease.length === 0) {
    closeAndReset();
    return;
  }

  // Close the browser UI immediately — before any awaits.
  browserModeStore.isPersistent = false;
  closeButPreserveState();

  // Resolve and load in the background.
  (async () => {
    try {
      const preset =
        presetAtRelease ??
        (await adapterAtRelease.getRandomPreset(vendorAtRelease, pathAtRelease));
      if (!preset) return;

      trackPrepManager.reset();
      await ensureTrackPrepared();

      await loadPresetWithVariant(preset, vendorAtRelease);
      trackPrepManager.markAsUsed();
      handlePostLoad();
    } catch (err) {
      logger.error('Background preset load failed:', {
        component: 'UnifiedGestureBrowser.v6',
        err
      });
    }
  })();
}
```

### Why capture locals instead of reading `$derived` values inside the IIFE

`closeButPreserveState()` does not touch `browserNavigationStore.selectedVendorId` or `currentVendorId`, so `selectedVendor` and `currentVendorState` would in practice still resolve correctly immediately after the close. But relying on that coupling is fragile: a future change to `closeButPreserveState` or the `$effect` that watches persistent mode could reset vendor state and silently break the background load. Snapshotting the four values up front makes the background task self-contained and decouples it from whatever reactive cleanup runs after the close.

### Why `handleGestureEnd` is no longer `async`

`BrowserInteractionController` calls `onEnd(coords)` and does not await the return value. Making the function synchronous documents the contract: the handler's job is to dismiss the UI and schedule work, not to represent the lifetime of that work. The background IIFE is deliberately un-awaited and un-tracked.

## Consequences

**Positive**

- All three gesture-release targets (patch card, leaf folder, high-level folder) now dismiss with identical, zero-latency behavior.
- `handleGestureEnd` has a single centralized responsibility: close + schedule. The close logic is no longer scattered across conditional branches (previously `closeAndReset` ran in some paths, `closeButPreserveState` in others, each at a different point in the function).
- Background load failures no longer have any path to the UI — they can only be surfaced through the logger. This is consistent with the rest of the gesture-browser error handling.

**Negative / tradeoffs**

- The preset load is now truly "fire and forget" from the perspective of the release handler. If `loadPresetWithVariant` throws, the UI is already gone — the only feedback is a log line. This is acceptable because preset loading failures are rare and the user's next action (picking another preset, or recording into the track) will surface any broken state naturally.
- Snapshotting `currentPath` with `[...currentVendorState.currentPath]` is slightly defensive — the reactive value is unlikely to mutate during the micro-task gap — but the clone is cheap and the safety guarantee is worth it.
- If a user releases and then immediately re-opens the browser and presses another preset before the background load's 500 ms settle completes, two loads will be in flight. The existing `trackPrepManager` and the 500 ms wait inside `loadPresetWithVariant` already handle this correctly (the second load replaces the first), but it's worth noting as a behavioral change — previously the first load's await chain would have forced serialization.

## Tags
`browser`, `gestures`, `ui-responsiveness`, `svelte`, `async`
