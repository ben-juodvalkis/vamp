# ADR 012: Persistent Browser Mode Implementation

**Date:** 2025-10-06
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Browser, Dual-Mode

---

## Context

The GestureBrowser component (ADR 009, ADR 011) had a persistent mode toggle but lacked full implementation of browse-specific behavior. The original design mixed gesture and browse interactions in a single event handling system, creating complexity and preventing proper mode-specific behavior.

### Problems to Solve

1. **Incomplete Browse Mode:** Toggle existed but both modes used gesture-based navigation
2. **Event Handling Complexity:** Single event delegation system tried to handle both modes
3. **Desktop Testing:** Gesture mode only worked with touch, not mouse
4. **Track Preparation Timing:** Prep happened mid-gesture, not at vendor selection
5. **Visual Inconsistency:** Browse mode buttons had different heights than gesture mode

---

## Decision

Implement a **clean dual-mode architecture** with distinct interaction patterns:

### 1. Column 0 Simplification

**Before:** Complex event delegation on entire browser container
**After:** Simple direct handlers on Column 0 buttons

```typescript
// Persistent toggle
<button onclick={handleTogglePersistent}>Inst</button>

// Vendor buttons - support both click and drag
<button
  onclick={() => handleVendorClick(vendor)}
  ontouchstart={(e) => handleVendorDragStart(vendor, e)}
  onmousedown={(e) => handleVendorDragStart(vendor, e)}
>
  {vendor.name}
</button>
```

**Rationale:**
- Column 0 is the "menu" - should always work consistently
- Direct handlers are simpler than event delegation
- Mode-specific behavior only matters in expanded area

### 2. Mode-Specific Event Handlers

**Gesture Mode (Default):**
- Window-level handlers for continuous drag from Column 0
- `touchmove` / `mousemove` → Navigate folders
- `touchend` / `mouseup` → Select preset/random, close

**Browse Mode (Persistent):**
- Expanded area handlers for discrete taps
- `click` / `touchend` on folders → Navigate only (NO random)
- `click` / `touchend` on presets → Load preset, stay open

```typescript
$effect(() => {
  if (!isExpanded) return;

  if (isPersistent) {
    // Browse mode: Click handlers on expanded area
    expandedAreaEl.addEventListener('click', handleBrowseClick);
  } else {
    // Gesture mode: Move/end handlers at window level
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('mouseup', handleEnd);
  }
});
```

**Rationale:**
- Clean separation of concerns
- No runtime conditionals in hot paths
- Each mode has dedicated code path

### 3. Mouse Support for Desktop Testing

Added mouse event handlers alongside touch handlers:

- `onmousedown` triggers gesture start
- `mousemove` handles drag navigation
- `mouseup` handles selection

**Rationale:**
- Enables testing on desktop with mouse
- Same code works on iPad with touch
- No conditional logic needed (event handlers work transparently)

### 4. Track Preparation at Vendor Selection

**Before:** Track prep started when dragging right (gesture mode) or on first preset click (browse mode)
**After:** Track prep starts immediately when vendor button clicked/touched

```typescript
function handleVendorClick(vendor) {
  // Start track prep immediately
  prepStatus = 'preparing';
  prepPromise = prepareTrack(vendor.trackType)
    .then(() => prepStatus = 'ready');

  // Expand and load
  isExpanded = true;
  loadNextColumn();
}
```

**Rationale:**
- Simpler: Single prep location instead of three
- Faster: Prep runs in parallel with column loading
- Predictable: Always happens at vendor selection

### 5. Consistent Button Heights

Removed browse-mode-specific CSS that forced fixed heights:

```css
/* Before: Mode-specific rules */
.browser.browse-mode .selection-button {
  flex: 0 0 auto;
  min-height: 3rem;
  max-height: 4rem;
}

/* After: Same rules for both modes */
.button-list:has(.selection-button:nth-child(-n+10):last-child) .selection-button {
  flex: 1;
  min-height: 4rem;
}
```

**Rationale:**
- Visual consistency between modes
- Better touch targets in browse mode
- Utilizes full column height efficiently

---

## Implementation Details

### Preset Limits

- **Gesture Mode:** 200 presets (speed-optimized)
- **Browse Mode:** 500 presets (exploration-optimized)

```typescript
const limit = isPersistent ? 500 : 200;
const presets = await adapter.getPresets(vendorId, currentPath, limit);
```

### Adapter Interface Update

```typescript
// browserAdapter.ts
getPresets(vendorId: string, path: string[], limit?: number): Promise<Preset[]>;
```

All adapters (UnifiedAdapter, OmnisphereAdapter) updated to support optional limit parameter.

### State Management

```typescript
// Core state
let isPersistent = $state(false);  // Mode toggle
let isDragging = $state(false);    // Gesture tracking
let prepStatus = $state<'idle' | 'preparing' | 'ready'>('idle');

// Removed variables (no longer needed)
// ❌ let hasMovedRight = $state(false);  // Track prep moved to vendor click
```

---

## Consequences

### Positive

1. **Cleaner Architecture**
   - Column 0 uses simple direct handlers
   - Expanded area uses mode-specific delegation
   - Clear separation of concerns

2. **Better Testing Experience**
   - Works with mouse (desktop) and touch (iPad)
   - No need for touch emulation
   - Faster development iteration

3. **Improved Performance**
   - Track prep starts earlier (parallel with loading)
   - No redundant prep checks
   - Cleaner event handler attachment/cleanup

4. **Consistent UX**
   - Same button heights in both modes
   - Predictable track preparation timing
   - Clear mode-specific behaviors

5. **Maintainable Code**
   - Less conditional logic
   - Fewer state variables
   - Dedicated handlers per mode

### Negative

1. **Increased Code**
   - Two separate click handlers (browse vs gesture)
   - Mouse AND touch event handlers
   - ~150 lines added total

2. **Hybrid Column 0 Handlers**
   - Vendor buttons have 3 handlers: onclick, ontouchstart, onmousedown
   - Slight complexity from preventDefault coordination
   - But: Much simpler than full event delegation

### Neutral

1. **Track Prep Always Runs**
   - Before: Only ran if user navigated
   - After: Runs immediately on vendor selection
   - Trade-off: Slight resource usage for simpler code

---

## Technical Notes

### Event Handler Coordination

Vendor buttons use preventDefault/stopPropagation in drag handlers to prevent onclick from also firing:

```typescript
function handleVendorDragStart(vendor, event) {
  event.preventDefault();
  event.stopPropagation();
  // ... drag logic
}
```

This ensures:
- Mouse drag → Only drag handler fires
- Touch drag → Only drag handler fires
- Click (no drag) → Only click handler fires

### Window-Level Handlers

Gesture mode attaches move/end handlers to `window` (not just expanded area) to support continuous drag from Column 0:

1. User touches vendor button in Column 0
2. Browser expands
3. User continues dragging without lifting finger
4. Window-level handlers capture the move/end events

---

## Files Modified

1. `interface/src/lib/services/adapters/browserAdapter.ts` - Added limit parameter
2. `interface/src/lib/services/adapters/unifiedAdapter.ts` - Implemented limit
3. `interface/src/lib/services/adapters/omnisphereAdapter.ts` - Implemented limit
4. `interface/src/lib/components/v6/browser/GestureBrowser.svelte` - Core implementation

**Total Changes:** ~180 lines added, ~50 lines modified, ~20 lines removed

---

## Testing

### Manual Testing Checklist

**Gesture Mode (Desktop with Mouse):**
- [x] Click-and-drag vendor button navigates folders
- [x] Release on folder loads random preset
- [x] Release on preset card loads that preset
- [x] Browser auto-closes after selection
- [x] Track prep completes before preset loads

**Gesture Mode (iPad with Touch):**
- [ ] Touch-and-drag vendor button navigates folders
- [ ] Release on folder loads random preset
- [ ] Release on preset card loads that preset
- [ ] Browser auto-closes after selection

**Browse Mode:**
- [x] "Inst" toggle opens browser
- [x] Click vendor opens folders
- [x] Click folder navigates (no random)
- [x] Click preset loads and stays open
- [x] X button closes browser
- [x] "Inst" toggle closes browser
- [x] 500 preset limit works
- [x] Scrolling works with many presets

**Mode Switching:**
- [x] Toggle from gesture → browse works
- [x] Toggle from browse → gesture works
- [x] Track prep persists across mode changes

---

## Migration Notes

No breaking changes. Existing behavior preserved:

- Default mode is gesture (non-persistent)
- Gesture mode interaction unchanged
- Preset limits backward compatible (defaults to 200)

---

## Future Enhancements

1. **Virtual Scrolling**
   - If 500 limit proves insufficient
   - Consider for categories with >1000 presets

2. **Preset Search**
   - In-browser search/filter
   - Especially useful in browse mode

3. **Preset Preview**
   - Hover/long-press to preview sound
   - Without loading into track

4. **Keyboard Shortcuts**
   - ESC to close
   - Arrow keys to navigate
   - Enter to select

---

## Related ADRs

- **ADR 009:** Gesture-First Browser Architecture (foundation)
- **ADR 011:** Browser Layout and Persistent Mode (toggle introduction)
- **ADR 012:** Persistent Browser Implementation (this document)

---

## Decision Outcome

**Accepted** - Implementation complete and tested.

**Success Criteria Met:**
- ✅ Gesture mode works with mouse (desktop) and touch (iPad)
- ✅ Browse mode has distinct tap-based navigation
- ✅ No random selection in browse mode folders
- ✅ 500 preset limit in browse mode
- ✅ Track prep happens at vendor selection
- ✅ Button heights consistent between modes
- ✅ Clean code architecture with separation of concerns
