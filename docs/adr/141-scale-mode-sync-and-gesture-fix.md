# ADR 141: Scale Mode Sync and Gesture Browser Fix

## Status
Accepted

## Date
2025-12-02

## Context

Two issues were identified with the scale/key signature functionality:

### Issue 1: Flaky Root Note Button Clicks
Root note buttons in the scale browser were extremely unreliable - only about 1 in 5 clicks would register. This made the scale browser frustrating to use in persistent/browse mode.

### Issue 2: No Scale Mode Sync from Live
When scale highlighting was toggled on/off directly in Ableton Live, the interface had no way to know about this change. The interface could set scale mode (auto-enabled when selecting a scale), but couldn't receive updates when the user disabled it in Live.

## Analysis

### Root Cause of Flaky Clicks
The `GestureModeController` component attaches window-level event handlers for `touchend` and `mouseup` that call `event.preventDefault()`. This is correct for gesture mode (drag-to-browse), but the controller was incorrectly active during scale browser persistent mode.

The condition was:
```svelte
{#if isExpanded && !isPersistent}
    <GestureModeController ... />
{/if}
```

This only checked the vendor browser's `isPersistent` flag, not `isScalePersistent`. When:
- Scale browser was open in persistent mode (`isScalePersistent = true`)
- Vendor browser persistent mode was off (`isPersistent = false`)

The GestureModeController remained active and swallowed click events.

### Missing Scale Mode Observer
The Max4Live script had observers for `root_note` and `scale_name` properties but not for `scale_mode`. This meant changes to scale mode in Live (enabling/disabling scale highlighting) were never communicated to the interface.

## Decision

### Fix 1: Update GestureModeController Condition
Changed the condition to also check `isScalePersistent`:
```svelte
{#if isExpanded && !isPersistent && !isScalePersistent}
    <GestureModeController
        isActive={!isPersistent && !isScalePersistent}
        ...
    />
{/if}
```

### Fix 2: Add Scale Mode Observer and State
Added full bidirectional sync for scale mode:

1. **Max4Live (`liveAPI-v6.js`)**:
   - Added `scaleModeObserver` variable
   - Added `scaleModeChanged()` callback function
   - Updated `setupScaleObservers()` to include scale mode observer
   - Sends initial `scale_mode` value on connection

2. **Session Store (`session.svelte.ts`)**:
   - Added `_scaleMode` state variable
   - Added `scaleMode` getter
   - Added `handleScaleModeUpdate()` handler function

3. **Message Router (`simpleClient.ts`)**:
   - Added routing for `/looping/song/scale_mode` messages

### Fix 3: Visual Feedback for Scale Mode State
Added dim styling to the scale button when scale mode is off in Live:

1. **VendorButtonGrid.svelte**:
   - Added `scaleMode` prop
   - Added `class:scale-mode-off={!scaleMode}` to scale button
   - Added CSS for dimmed appearance (50% opacity, desaturated)

2. **UnifiedGestureBrowser.v6.svelte**:
   - Added `scaleMode` derived state from session
   - Passed `scaleMode` prop to VendorButtonGrid

## OSC Messages

### New Message
| Address | Direction | Args | Description |
|---------|-----------|------|-------------|
| `/looping/song/scale_mode` | Live → Interface | `[0\|1]` | Scale highlighting enabled/disabled |

## Files Changed

| File | Change |
|------|--------|
| `ableton/scripts/liveAPI-v6.js` | Added `scaleModeObserver`, callback, and setup |
| `interface/src/lib/stores/session.svelte.ts` | Added `_scaleMode` state and handler |
| `interface/src/lib/api/simpleClient.ts` | Added message routing for scale_mode |
| `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` | Fixed GestureModeController condition, added scaleMode prop |
| `interface/src/lib/components/v6/browser/VendorButtonGrid.svelte` | Added scaleMode prop and dim styling |

## Consequences

### Positive
- Root note buttons now respond reliably to clicks in persistent mode
- Interface now syncs with Live's scale mode state bidirectionally
- Visual feedback shows users when scale highlighting is active
- Selecting a scale still auto-enables scale mode (existing behavior preserved)

### Neutral
- Scale button appears dimmer when scale mode is off, which may initially confuse users who haven't used scale highlighting before

### Negative
- None identified

## Related
- ADR 058: Scale Gesture Browser architecture
- ADR 064: Centralize Transpose Configuration
