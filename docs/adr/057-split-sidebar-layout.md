# ADR 048: Split Sidebar Layout Restructure

**Date:** 2025-10-13
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Layout, Architecture

---

## Context

The original V6 interface used a full-height 120px sidebar containing the GestureBrowser with all vendor buttons (Ableton, NI Drums, Omni, NI Melodic, Audio, Inst toggle, and track meter). The main content area was divided into three equal horizontal panels: Tracks, Middle (with clip controls + central display), and FX.

### Problem

The Middle Panel needed more horizontal space for the Central Display, but the full-height sidebar constrained it. The left column of clip controls (Quantize, Loop, Mute Sequencer, Pitch Sequencer) took up valuable width that could be better used by the Central Display.

---

## Decision

Split the single full-height sidebar into **two separate 120px sidebars** positioned in rows 1 and 3, leaving row 2 (Middle Panel) with full width.

### New Layout Structure

```
┌────────────┬─────────────────────────────┐
│ TOP        │ TRACKS PANEL                │
│ GESTURE    │ (horizontal scroll)         │
│ BROWSER    │ + Master Track (pinned)     │
│ [Ableton]  │                             │
│ [Omni]     │                             │
│ [NI]       │                             │
│ [Inst]*    │ (*when expanded)            │
├────────────┴─────────────────────────────┤
│ MIDDLE PANEL (FULL WIDTH)                │
│ Clip Controls + Central Display          │
│ (50/50 split, dynamic based on view)     │
├────────────┬─────────────────────────────┤
│ BOTTOM     │ FX/DEVICES PANEL            │
│ CONTROLS   │                             │
│ [Inst]     │                             │
│ [Audio]    │                             │
│ [Meter]    │                             │
└────────────┴─────────────────────────────┘
```

### Key Changes

1. **TopGestureBrowser** (120px, row 1)
   - Unified NI button (combines NI Drums + NI Melodic)
   - Uses `vendorId: 'ni-melodic'` pointing to `/native-instruments` folder
   - Removed: Audio button, SelectedTrackMeter, separate Inst toggle
   - Added: Inst button at bottom of vendor list (only visible when expanded)

2. **BottomControls** (120px, row 3)
   - Inst button (persistent mode toggle)
   - Audio button (audio track preparation)
   - SelectedTrackMeter component

3. **MiddlePanelV6** (full width, row 2)
   - No changes to functionality
   - Now spans entire width without left sidebar constraint
   - Clip controls + Central Display maintain 50/50 or dynamic split

4. **+page.svelte** Layout
   - Changed from horizontal flex (sidebar + main) to vertical flex (3 rows)
   - Each row is `flex-1` (equal height: 1/3 each)
   - Rows 1 and 3: horizontal flex (120px sidebar + flex-1 panel)
   - Row 2: full width panel

---

## Implementation Details

### Shared State Management (Svelte 5 Runes)

**Challenge:** BottomControls Inst button needs to control TopGestureBrowser expansion state.

**Solution:** Shared reactive store using Svelte 5 runes pattern:

```typescript
// browserModeStore.svelte.ts
function createBrowserModeStore() {
  let isPersistent = $state(false);

  return {
    get isPersistent() {
      return isPersistent;
    },
    set isPersistent(value: boolean) {
      isPersistent = value;
    }
  };
}

export const browserModeStore = createBrowserModeStore();
```

**Usage:**
```typescript
// BottomControls
function handleTogglePersistent() {
  browserModeStore.isPersistent = !browserModeStore.isPersistent;
}

// TopGestureBrowser
let wasPersistent = false;
$effect(() => {
  const nowPersistent = browserModeStore.isPersistent;

  if (nowPersistent !== wasPersistent) {
    if (nowPersistent) {
      // Open browser in browse mode
      isExpanded = true;
      // ... restore state
    } else {
      // Close browser
      isExpanded = false;
    }
    wasPersistent = nowPersistent;
  }
});
```

### DOM Timing Challenge

**Problem:** When BottomControls toggles `isPersistent`, TopGestureBrowser's `$effect` runs immediately, but `expandedAreaEl` isn't bound yet (DOM hasn't updated).

**Solution:** Use `tick()` to wait for DOM updates before attaching event listeners:

```typescript
$effect(() => {
  if (!isExpanded) return;

  const persistent = browserModeStore.isPersistent;

  (async () => {
    await tick(); // Wait for DOM
    const el = expandedAreaEl;

    if (persistent && el) {
      el.addEventListener('click', handleBrowseClick);
    }
  })();

  return () => {
    // Cleanup
  };
});
```

**Rationale:**
- `tick()` is the Svelte-native way to wait for DOM updates
- Avoids `setTimeout(..., 0)` hacks
- Eliminates visual flash
- Ensures event listeners attach correctly

### Component Relationships

```
BottomControls ←→ browserModeStore ←→ TopGestureBrowser
                   (shared state)
```

- BottomControls: Toggles `browserModeStore.isPersistent`
- TopGestureBrowser: Watches store, opens/closes accordingly
- Both components can independently toggle persistent mode
- No direct component communication needed

---

## Consequences

### Positive

1. **More Space for Central Display**
   - Middle Panel gains full width
   - No left sidebar constraint
   - Better visibility for complex views

2. **Cleaner Organization**
   - Browser controls grouped in top row (near tracks)
   - Utility controls grouped in bottom row (near FX)
   - Logical separation of concerns

3. **Unified NI Button**
   - Single button for all Native Instruments
   - Simpler mental model
   - One less button to choose from

4. **Modern Svelte 5 Pattern**
   - Uses runes for shared state
   - Reactive with `$state`, `$derived`, `$effect`
   - Proper use of `tick()` for DOM timing
   - Clean separation of concerns

### Negative

1. **Increased Complexity**
   - Shared state management between components
   - DOM timing considerations (need `tick()`)
   - More files (TopGestureBrowser, BottomControls, browserModeStore)

2. **Gesture Browser Split**
   - Original single component is now split across two locations
   - Inst button exists in two places (bottom sidebar + expanded browser)
   - Could be confusing for maintenance

### Mitigations

- **Documentation:** This ADR explains the architecture
- **Comments:** Code includes clear comments about shared state
- **Naming:** `browserModeStore` clearly indicates purpose
- **Logging:** Debug logs show state transitions

---

## Testing Considerations

### Manual Testing

- [ ] Gesture mode: Press/hold Ableton/Omni/NI → drag → release works
- [ ] Browse mode: Click Inst (bottom) → browser opens → click folders/presets works
- [ ] Inst toggle: Click Inst in expanded browser → closes correctly
- [ ] Middle Panel: Full width utilized, clip controls + display work
- [ ] Bottom Controls: Inst and Audio buttons styled correctly
- [ ] Track meter: Displays in bottom sidebar

### Edge Cases

- [ ] Toggle persistent mode while gesture is active
- [ ] Rapid clicking of Inst button
- [ ] Browser state preserved when toggling modes
- [ ] Event listeners properly cleaned up on unmount

---

## Files Modified

- `interface/src/routes/+page.svelte` - Layout restructure (3 rows)
- `interface/src/lib/components/v6/layout/MiddlePanelV6.svelte` - No changes (kept as-is)

## Files Created

- `interface/src/lib/components/v6/browser/TopGestureBrowser.svelte` - Copied from GestureBrowser, pruned
- `interface/src/lib/components/v6/browser/BottomControls.svelte` - New utility controls component
- `interface/src/lib/stores/v6/browserModeStore.svelte.ts` - Shared persistent mode state

---

## Future Considerations

### Potential Improvements

1. **Simplify State Management**
   - Consider making TopGestureBrowser fully independent (no shared state)
   - BottomControls Inst could just be a visual indicator, not functional

2. **Unified Component**
   - Merge TopGestureBrowser and BottomControls back into single component
   - Could simplify state management

3. **Better Visual Feedback**
   - Synchronize Inst button states more obviously
   - Add transition animations for mode changes

---

## Related Decisions

- **ADR 018:** Gesture Browser Architecture - Original design
- **ADR 021:** Persistent Browser Implementation - Browse mode addition
- **ADR 034:** Dynamic Middle Panel Layout - Previous middle panel changes

---

## Decision Outcome

**Accepted** - Implementation complete and functional.

### Results

- Middle Panel now has full width
- TopGestureBrowser works in both gesture and browse modes
- BottomControls Inst button successfully opens browser
- Event handlers attach correctly using `tick()`
- Layout is cleaner with logical grouping

### Known Issues

- Minor flash when opening browser from BottomControls (mitigated with `tick()`)
- Complexity increased due to shared state management
- Two Inst buttons could be confusing (bottom sidebar + expanded browser)
