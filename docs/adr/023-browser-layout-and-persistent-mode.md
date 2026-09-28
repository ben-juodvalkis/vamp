# ADR 011: Browser Layout Restructure and Persistent Mode

**Date:** 2025-10-06
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Layout, Browser

---

## Context

The initial GestureBrowser implementation (ADR 009) used a full-height sidebar layout where the browser occupied the entire left edge of the screen. This created two issues:

1. **Layout Constraints:** The browser sidebar prevented other UI elements (like the devices/FX panel) from utilizing full-width layout at the bottom of the screen.
2. **Workflow Friction:** Every preset selection required a new gesture from the collapsed state, interrupting rapid preset auditioning workflows common in sound design sessions.

### User Workflow Requirements

During sound design and preset exploration sessions, users often need to:
- Rapidly audition multiple presets from the same category
- Compare presets back-to-back without navigation overhead
- Keep the browser visible while tweaking parameters
- Still have quick access to standard "one-shot" preset loading

---

## Decision

Implement two complementary changes:

### 1. Top-Anchored Browser Layout (2/3 Height)

Restructure the main layout to constrain the browser sidebar to the top 2/3 of the screen, allowing full-width UI elements in the bottom 1/3.

**Layout Structure:**
```
┌─────────────────────────────────────┐
│ ┌──────┬──────────────────────────┐ │ Top 2/3 (66.67vh)
│ │Browser│   Main Content Area     │ │
│ │120px │  (Tracks, Middle Panel)  │ │
│ └──────┴──────────────────────────┘ │
├─────────────────────────────────────┤
│    Full-Width Devices Panel (FX)    │  Bottom 1/3
└─────────────────────────────────────┘
```

**Implementation:**
```svelte
<div class="fixed inset-0 flex flex-col">
  <!-- Top 2/3: Browser sidebar + Main content -->
  <div class="h-[66.67vh] flex">
    <div class="w-[120px] flex-shrink-0 border-r">
      <GestureBrowser />
    </div>
    <div class="flex-1 flex flex-col gap-4 p-4">
      <!-- Tracks and Middle panels -->
    </div>
  </div>

  <!-- Bottom 1/3: Full-width devices panel -->
  <div class="flex-1 min-h-0 p-4 pt-0">
    <DevicesPanelV6 />
  </div>
</div>
```

### 2. Persistent Mode Toggle

Add a persistent mode that keeps the browser open after preset selection, with manual close control.

**Interaction Model:**
- **Button:** "Inst" toggle at top of browser sidebar (64px tall)
- **States:**
  - Off (default): Standard gesture-based browsing (auto-close after selection)
  - On (persistent): Browser stays open, manual close via X button or toggle
- **Visual Feedback:**
  - Gray text when off, cyan (#00c9ff) when on
  - Subtle highlight background when active
  - X close button appears in top-right when persistent mode active

---

## Implementation Details

### Persistent Mode State Management

**State Variables:**
```typescript
let isPersistent = $state(false);  // Persistent mode toggle
```

**Toggle Button:**
```svelte
<button
  class="selection-button persistent-toggle"
  class:selected={isPersistent}
  data-action="toggle-persistent"
  aria-label="Toggle persistent browser mode"
>
  <span class="category-name" style="color: {isPersistent ? '#00c9ff' : '#666'};">
    Inst
  </span>
</button>
```

**Styling:**
```css
.persistent-toggle {
  font-size: 1.5rem;
  height: 64px;
  min-height: 64px;
  max-height: 64px;
  flex: 0 0 64px;
}

.persistent-toggle.selected {
  background: rgba(0, 201, 255, 0.1);
  border-color: #00c9ff;
}
```

### Touch Event Handling

**Toggle Detection (in handleEnd):**
```javascript
// Check if released on persistent toggle FIRST before anything else
const el = document.elementFromPoint(clientX, clientY);
if (el) {
  const action = el.getAttribute('data-action');
  if (action === 'toggle-persistent') {
    isDragging = false;
    isPersistent = !isPersistent;
    if (isPersistent) {
      isExpanded = true;  // Open browser
    } else {
      closeAndReset();    // Close browser
    }
    return;  // Early exit prevents preset loading
  }
}
```

**Conditional Close After Preset Load:**
```javascript
// Only close if not in persistent mode
if (!isPersistent) {
  closeAndReset();
} else {
  // In persistent mode, just reset the drag state
  isDragging = false;
  hasMovedRight = false;
  hoveredCol = -1;
  hoveredIdx = -1;
  hoveredPreset = null;
}
```

**Persistent Mode Protection:**
```javascript
// If in persistent mode and released on column 0, don't close
if (hoveredCol === 0 && isPersistent) {
  console.log('[Browser] Released on column 0 in persistent mode, staying open');
  return;
}
```

### Close Button

**UI Component:**
```svelte
{#if isPersistent}
  <button class="close-button" onclick={handleCloseClick} aria-label="Close browser">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  </button>
{/if}
```

**Styling:**
```css
.close-button {
  position: absolute;
  top: 0.75rem;
  right: 1rem;
  width: 2.5rem;
  height: 2.5rem;
  background: var(--browser-bg-tertiary);
  border: 1px solid var(--browser-border);
  border-radius: 0.5rem;
  color: var(--browser-text-primary);
  cursor: pointer;
  z-index: 20;
  transition: all 0.2s ease;
}

.close-button:hover {
  background: #ff4444;
  border-color: #ff4444;
  color: white;
}
```

**Prep Status Position Adjustment:**
```css
.prep-status {
  position: absolute;
  top: 0.75rem;
  right: 4rem;  /* Moved left to make room for close button */
  /* ... */
}
```

---

## Interaction Flows

### Standard Mode (Default)

```
1. Touch "Ableton" button
   → Browser expands fullscreen
   → Navigate folders/presets
   → Release on preset
   → Preset loads
   → Browser auto-closes ✓

2. Touch "Inst" toggle
   → isPersistent = true
   → Browser expands
   → X button appears
```

### Persistent Mode

```
1. Already in persistent mode
   → Browser is open
   → Navigate and select preset
   → Release on preset
   → Preset loads
   → Browser STAYS OPEN ✓
   → Can immediately select another preset

2. Close browser:
   Option A: Click X button (top-right)
   Option B: Click "Inst" toggle again
   → isPersistent = false
   → Browser closes
```

### Toggle Edge Cases

**Clicking Toggle on Column 0:**
- Touch event detects `data-action="toggle-persistent"` attribute
- Early return prevents preset loading logic from executing
- Toggle state changes immediately
- Browser opens/closes based on new state

**Dragging from Toggle to Vendor Button:**
- Initial touch on toggle is ignored (returns early)
- No vendor selection occurs
- Clean state management

---

## Consequences

### Positive

1. **Full-Width FX Panel**
   - Devices panel can now span entire screen width in bottom third
   - Better space utilization for complex effect chains
   - More room for parameter controls

2. **Rapid Preset Auditioning**
   - Persistent mode eliminates repeated gesture overhead
   - Enables quick A/B comparison of presets
   - Supports iterative sound design workflows
   - Browser state maintained across multiple selections

3. **Flexible Workflows**
   - Quick one-shot loading (standard mode)
   - Extended browsing sessions (persistent mode)
   - User controls transition between modes
   - No workflow disruption from forced behaviors

4. **Visual Clarity**
   - Browser doesn't dominate entire left edge
   - Clearer visual hierarchy (browser vs main content vs FX)
   - Devices panel gets proper dedicated space

5. **Backward Compatible**
   - Standard mode preserves original gesture-based interaction (ADR 009)
   - Users can ignore persistent mode if preferred
   - No breaking changes to existing workflows

### Negative

1. **Reduced Browser Height**
   - Sidebar buttons have less vertical space in minimized state
   - 4 vendor buttons must fit in 66.67vh instead of 100vh
   - Still acceptable with button flex distribution

2. **Added Complexity**
   - Two interaction modes to understand
   - Additional state management (`isPersistent`)
   - More UI elements (toggle button, close button)
   - More touch event edge cases to handle

3. **Cognitive Load**
   - Users must learn about persistent mode existence
   - Need to understand toggle vs X button behavior
   - Additional decision point in workflow

### Mitigations

**For Reduced Height:**
- Buttons auto-distribute when ≤10 items (existing behavior)
- 64px toggle + 4 buttons fits comfortably in 66.67vh
- Can scroll if needed (overflow-y: auto on button-list)

**For Complexity:**
- Default mode preserves familiar behavior
- Persistent toggle is visually distinct (top position, different styling)
- Clear visual feedback (color change, X button appearance)
- Intuitive toggle behavior (click to open/close)

**For Cognitive Load:**
- Discoverable through exploration (prominent toggle button)
- Self-explanatory name ("Inst" = Instruments)
- Visual cues (color, background highlight)
- Can be ignored entirely (optional feature)

---

## Technical Considerations

### Layout Math

**Vertical Split:**
- Top section: `h-[66.67vh]` (2/3 of viewport)
- Bottom section: `flex-1` (remaining 1/3)
- Calculation: 100vh * 0.6667 = 66.67vh

**Browser Expansion:**
- Minimized: Constrained within top 2/3 section
- Expanded: `position: fixed; inset: 0;` (fullscreen override)
- Z-index: 1000 (above all other content)

### State Cleanup

**Reset on Close:**
```javascript
function closeAndReset() {
  if (loadTimeout) clearTimeout(loadTimeout);
  isExpanded = false;
  isDragging = false;
  hasMovedRight = false;
  selectedVendorId = null;
  selectedVendor = null;
  adapter = null;
  currentPath = [];
  columns = [];
  hoveredCol = -1;
  hoveredIdx = -1;
  hoveredPreset = null;
  prepStatus = 'idle';
  lastPath = '';
  isPersistent = false;  // Reset persistent mode
}
```

**Partial Reset (Persistent Mode):**
```javascript
// In persistent mode, only reset drag state
isDragging = false;
hasMovedRight = false;
hoveredCol = -1;
hoveredIdx = -1;
hoveredPreset = null;
// Keep: isExpanded, selectedVendor, adapter, currentPath, columns
```

### Accessibility

**ARIA Labels:**
- Toggle button: `aria-label="Toggle persistent browser mode"`
- Close button: `aria-label="Close browser"`

**Keyboard Support:**
- Not implemented (touch-first design per ADR 009)
- Future enhancement opportunity

---

## Performance Impact

### Minimal Overhead

- **Toggle State:** Single boolean variable
- **Close Button:** Conditionally rendered (only when persistent mode active)
- **Event Handling:** No additional listeners (reuses existing touch events)
- **Layout:** Flexbox-based, no JavaScript layout calculations

### Memory

- No additional data structures required
- Browser state preservation in persistent mode (already in memory)
- Close button DOM element only mounted when needed

---

## Future Considerations

### Potential Enhancements

1. **Persistent Mode Memory**
   - Save persistent mode preference to localStorage
   - Auto-restore on page reload
   - Per-user preference

2. **Keyboard Shortcuts**
   - `Esc` to close browser
   - `P` to toggle persistent mode
   - Arrow keys for navigation

3. **Resizable Browser**
   - User-adjustable height (e.g., 50%, 66%, 100%)
   - Drag handle at bottom edge
   - Save preferred size

4. **Auto-Persistent Mode**
   - Detect rapid consecutive selections
   - Auto-enable persistent mode after 3 quick selections
   - Smart mode switching

5. **Preview Mode**
   - Hold preset to preview without loading
   - Release to cancel
   - Tap to commit load (in persistent mode)

---

## Related Decisions

- **ADR 009:** Gesture-First Browser Architecture (foundation for this enhancement)
- **ADR 006:** Svelte 5 Runes Migration (reactive state management pattern)

---

## References

- Original browser architecture: ADR 009
- Layout component: `/interface/src/routes/+page.svelte`
- Browser component: `/interface/src/lib/components/v6/browser/GestureBrowser.svelte`

---

## Decision Outcome

**Accepted** - Implementation complete and tested.

**Success Criteria Met:**
- ✅ Browser constrained to top 2/3 height
- ✅ Devices panel spans full width in bottom 1/3
- ✅ Persistent mode toggle functional
- ✅ Close button appears/works in persistent mode
- ✅ Standard mode unchanged (backward compatible)
- ✅ Clean state management (no leaked preset loads)
- ✅ Touch event handling robust (early returns prevent conflicts)

**Next Steps:**
- iPad testing to validate touch interactions
- User feedback on persistent mode discoverability
- Monitor usage patterns (standard vs persistent mode adoption)
- Consider localStorage persistence if users frequently toggle
