# ADR-101: Gesture Mode Refinements and Consistency

**Date**: 2025-01-14
**Status**: Accepted
**Extends**: [ADR-025 Tap/Hold Gesture Mode](025-tap-hold-gesture-mode.md), [ADR-029 Persistent Browser](029-persistent-browser-implementation.md), [ADR-072 Vendor State Persistence](072-vendor-state-persistence.md)

## Context

The gesture browser had several inconsistencies in how tap/hold gestures worked across different button types:

### Problems Identified

1. **Vendor buttons kept button in DOM during gesture** - Morphed in place allowing continuous drag
2. **Audio button gesture mode missing** - Only prepared empty track on hold, no gesture browser support
3. **Scale browser missing gesture support** - No hold gesture or drag-to-select functionality
4. **Close button click-through** - Clicking close in browse mode would trigger underlying Scale button
5. **Scale browser showing all vendor buttons** - When scale expanded, all vendors still visible in column 0

These inconsistencies created a confusing UX where similar buttons behaved differently.

## Decision

**Standardize tap/hold gesture pattern across ALL browser buttons** with consistent behavior:

### Unified Interaction Pattern

All browser buttons (Omni, Ableton, NI, Melodic, Audio, Scale) now follow identical pattern:

| Gesture | Duration | Behavior | Mode |
|---------|----------|----------|------|
| **Tap** | < 500ms | Open in browse mode (persistent), shows close button | Browse |
| **Hold** | ≥ 500ms | Open in gesture mode, enable continuous drag | Gesture |
| **Close** | Tap close button | Closes browser, prevents click-through | N/A |

### Implementation Changes

#### 1. Audio Button Gesture Mode

**Before**: Hold = Prepare empty audio track only
**After**: Hold = Prepare track + open browser in gesture mode

```typescript
audioHoldTimer = window.setTimeout(() => {
    audioHoldTriggered = true;
    browserModeStore.isPersistent = false; // Gesture mode

    // Prepare track immediately
    prepareTrack('audio');
    handleVendorClick(audioVendor, event);

    // Enable dragging
    isDragging = true;
    gestureStartedInColumn0 = true;
}, 500);
```

#### 2. Scale Browser Gesture Support

**Added scale hover detection in `handleMove()`**:
```typescript
const scaleName = el.getAttribute('data-scale-name');
if (scaleName && selectedCategory === 'scale') {
    hoveredScale = scaleName;
    return;
}
```

**Added scale selection in `handleEnd()`**:
```typescript
if (selectedCategory === 'scale' && hoveredScale) {
    handleScaleNameClick(hoveredScale);
    if (!browserModeStore.isScalePersistent) {
        closeButPreserveState();
    }
}
```

**Updated scale cards with data attributes**:
```svelte
<div class="patch-card scale-card"
     data-scale-name={scaleName}
     ...>
```

#### 3. Close Button Click-Through Prevention

**Added event stopPropagation to `handleCloseClick()`**:
```typescript
function handleCloseClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation(); // Prevents triggering underlying buttons
    // ... close logic
}
```

#### 4. Scale Browser Column 0 Cleanup

**Template structure now hides vendors when scale browser is open**:
```svelte
{#if isExpanded && selectedCategory === 'scale'}
    <!-- ONLY show scale close button -->
    <button>Close Scale</button>
{:else}
    <!-- Show scale + all vendors when collapsed or vendor browser open -->
    <button>Scale</button>
    {#each vendors as vendor}...{/each}
{/if}
```

#### 5. Button Morphing Pattern (All Buttons)

Buttons stay in DOM but morph appearance and handlers:
- **Collapsed**: Show all buttons with tap/hold handlers
- **Expanded (browse mode)**: Selected button becomes close button
- **Expanded (gesture mode)**: Same as browse, but `isDragging = true`

## Files Modified

- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.svelte` (~150 lines changed)
  - Audio button gesture mode implementation
  - Scale browser gesture mode implementation
  - Close button click-through fix
  - Scale browser template cleanup
  - Hover tracking for scales

## Benefits

### User Experience
- **Predictable**: All browser buttons work identically
- **Consistent**: Same muscle memory for all vendors
- **Discoverable**: Hold gesture works everywhere
- **Clean UI**: Scale browser only shows relevant close button

### Technical
- **Unified codebase**: Same pattern reduces maintenance
- **Better separation**: Clear distinction between categories (vendor/scale/audio)
- **Event handling**: Proper propagation prevention eliminates click-through bugs

## Consequences

### Positive
- ✅ All browsers now support gesture mode
- ✅ No unexpected buttons appearing/disappearing
- ✅ Click-through bugs eliminated
- ✅ Consistent UX across all browser types
- ✅ Audio button now supports both browse and gesture modes

### Neutral
- Scale browser shares same gesture infrastructure as vendor browsers
- Additional hover state tracking (`hoveredScale`)

### Risks Mitigated
- Click-through prevented via `event.stopPropagation()`
- Vendor buttons hidden when scale browser open (prevents confusion)

## Testing Validation

### Vendor Browsers (Omni, Ableton, NI, Melodic)
- [x] Tap opens browse mode with close button
- [x] Hold 500ms opens gesture mode
- [x] Gesture mode allows continuous drag
- [x] Close button works without click-through
- [x] Only selected vendor button shows when expanded

### Audio Browser
- [x] Tap prepares track + opens browse mode
- [x] Hold prepares track + opens gesture mode
- [x] Gesture drag works through audio clips
- [x] Close button works without click-through

### Scale Browser
- [x] Tap opens browse mode with close button
- [x] Hold 500ms opens gesture mode
- [x] Gesture drag works through scales
- [x] Close button works without click-through
- [x] Only scale close button shows when expanded (no vendors)

## Future Enhancements

- Visual hold progress indicator (500ms countdown)
- Haptic feedback on iPad when hold triggers
- Customizable hold threshold in settings
- Unified gesture mode visual feedback

## References

- [ADR-025: Tap/Hold Gesture Mode](025-tap-hold-gesture-mode.md) - Original gesture pattern
- [ADR-029: Persistent Browser](029-persistent-browser-implementation.md) - Browse vs gesture modes
- [ADR-072: Vendor State Persistence](072-vendor-state-persistence.md) - Per-vendor navigation state
- [UnifiedGestureBrowser Component](../../interface/src/lib/components/v6/browser/UnifiedGestureBrowser.svelte)

---

*This ADR establishes complete consistency in tap/hold gesture behavior across all browser types, eliminating UX confusion and technical debt from inconsistent implementations.*
