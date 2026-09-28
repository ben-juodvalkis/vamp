# ADR 121: Comprehensive Glassmorphic UI Implementation

**Date:** 2025-01-18
**Status:** Accepted
**Context:** V6 interface-wide glassmorphic design system implementation

## Problem

The V6 interface needed a comprehensive visual overhaul to achieve a modern, cohesive glassmorphic design system. Multiple issues needed to be addressed:

### Initial Browser Issues (PR #172)
1. **Browser Not Opening for Instruments**: When tapping instrument vendor buttons, the browser would open and immediately close due to conflicting event handlers
2. **Ugly Scrollbars**: White scrollbars appeared when there were more vendor categories than fit in the viewport, breaking the clean aesthetic
3. **Text Readability**: Vendor button text and scale root note were too small for quick recognition during live performance
4. **Event Handler Conflicts**: The `onclick` handler on vendor buttons was firing after `onmouseup`/`ontouchend`, causing the browser to toggle closed immediately after opening

### Comprehensive UI System Issues
5. **Inconsistent Visual Language**: Mix of flat backgrounds (`bg-background/50`), rgba colors, and solid panels across 30+ components
6. **Poor Visual Hierarchy**: Lack of depth and transparency effects made it hard to distinguish UI layers
7. **Outdated CSS Patterns**: Using rgba() instead of modern `color-mix()` for transparency
8. **No Blur Effects**: Missing backdrop-filter blur for glassmorphic aesthetic
9. **Z-index Layering Problems**: Control handles being covered by adjacent buttons in loop/quantize controls

## Decision

Implement a comprehensive glassmorphic design system across the entire V6 interface using modern CSS, standardized glass utility classes, and proper z-index layering.

### Phase 1: Initial Browser Fixes (PR #172)

#### 1. Fix Browser Opening Issue

**Root Cause**: In `VendorButtonGrid.svelte:208`, the vendor buttons had both:
- Touch/mouse handlers (`onmousedown`, `onmouseup`, `ontouchstart`, `ontouchend`) that detect tap vs hold gestures
- An `onclick` handler that fired when `shouldShowAsClose` was true

**Fix**: Removed the redundant `onclick` handler entirely. The touch/mouse handlers already handle all gesture detection through `HoldGestureDetector`, including:
- Quick tap → persistent mode (`onVendorTap`)
- Hold → gesture mode (`onVendorHold`)
- Toggle close when tapping the same vendor again

**Result**: Browser now opens reliably for all instrument vendors, matching the audio button behavior.

### 2. Hide Scrollbars Completely

**Implementation**: Added scrollbar hiding CSS across multiple levels:

```css
/* UnifiedGestureBrowser.v6.svelte - Global browser scrollbar hiding */
.browser :global(*) {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.browser :global(*::-webkit-scrollbar) {
  display: none; /* Chrome, Safari, Opera */
}

/* VendorButtonGrid.svelte - Container level */
.vendor-buttons {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.vendor-buttons::-webkit-scrollbar {
  display: none;
}

/* Category section with scrolling enabled */
.category-section {
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.category-section::-webkit-scrollbar {
  display: none;
}
```

**Result**: Scrolling still works perfectly, but scrollbars are invisible across all browsers.

### 3. Increase Text Sizes

**Vendor Button Text**:
```css
.category-name {
  font-size: var(--text-2xl); /* Previously var(--text-xl) */
  font-weight: var(--font-bold);
}
```

**Scale Root Note**:
```css
.root-note-large {
  font-size: var(--text-5xl); /* Previously var(--text-3xl) */
  font-weight: var(--font-bold);
}
```

**Result**: Improved readability for quick recognition during performance.

#### 4. Clean Up Invalid Type Check

**Removed**: Invalid comparison `selectedCategory === 'audio'` in `VendorButtonGrid.svelte:161`
- `selectedCategory` type is `'vendor' | 'scale' | null`
- This check was unreachable and causing TypeScript errors

### Phase 2: Glassmorphic Design System Implementation

#### Design Tokens & Glass Utility Classes

Created standardized glass panel classes in global CSS:

```css
/* Standard glassmorphic panel - 15% transparency + 12px blur */
.glass-panel {
  background: color-mix(in srgb, var(--background), transparent 15%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* Subtle glassmorphic panel - 50% transparency + 8px blur */
.glass-panel-subtle {
  background: color-mix(in srgb, var(--background), transparent 50%);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Modal/overlay glassmorphic - 20% transparency + 20px blur */
.glass-modal {
  background: color-mix(in srgb, var(--background), transparent 20%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

/* Topbar glassmorphic - 10% transparency + 16px blur */
.glass-topbar {
  background: color-mix(in srgb, var(--background), transparent 10%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
```

**Key Principles:**
- Use modern `color-mix()` instead of rgba() for transparency
- Always include webkit prefix for Safari/iOS support
- Standardize transparency levels: 10-15% (subtle), 50% (prominent), 85% (barely visible)
- Standardize blur amounts: 4px (subtle), 8px (standard), 12px (medium), 16-20px (strong)

#### Component Updates by Category

**Session 2: Central Display Components (8 files)**

1. **CentralDisplay.svelte** - Main container wrapper
   - Added `.glass-panel` class + `color-mix()` for background transparency
   - All 30 central view components now render within glassmorphic container

2. **EchoCentralView.svelte** - Filter curve panel
   - Replaced `bg-slate-900/30` with `.glass-panel-subtle` + transparent border
   - Interactive filter curve now has frosted glass background

3. **ReverbCentralView.svelte** - Button grid backgrounds (10 buttons)
   - Added `.glass-panel` class to inactive buttons
   - Replaced rgba backgrounds with `color-mix()`
   - 5 convolution + 5 algorithmic type buttons

4. **SimplerCentralView.svelte** - Custom sliders + fill indicators
   - Slicing Sensitivity slider: `bg-background/50` → `.glass-panel` + transparent borders
   - Transpose slider: `bg-background/50` → `.glass-panel` + transparent borders
   - Fill indicators: `rgba(16, 185, 129, 0.3)` → `color-mix(in srgb, rgb(16, 185, 129), transparent 70%)`

5. **ArpeggiatorCentralView.svelte** - Custom sliders
   - Pattern slider: `bg-background/50` → `.glass-panel` + transparent borders
   - Rate slider: `bg-background/50` → `.glass-panel` + transparent borders
   - Fill indicators: `opacity: 0.2` → `color-mix(in srgb, {arpColor.primary}, transparent 80%)`

6. **CompressorCentralView.svelte** - Button backgrounds
   - Added `.glass-panel-subtle` class
   - Replaced `rgba(236, 72, 153, 0.1)` with `color-mix()`
   - Sidechain routing buttons have glassmorphic pink backgrounds when enabled

7. **GuitarCentralView.svelte** - AMP button background
   - Added `.glass-panel-subtle` class
   - Replaced `rgba(239, 68, 68, 0.1)` with `color-mix()`
   - AMP button has glassmorphic red background when active

8. **UtilityCentralView.svelte** - Button backgrounds
   - Added `.glass-panel-subtle` class
   - Replaced `rgba(236, 72, 153, 0.1)` with `color-mix()`
   - Sidechain routing buttons have glassmorphic pink backgrounds

**Session 3: Browser & Shared Controls (7 files)**

9. **PresetGrid.svelte** - Preset card backgrounds
   - Before: `background: var(--browser-bg-secondary);`
   - After: `background: color-mix(in srgb, var(--browser-bg-secondary), transparent 15%); backdrop-filter: blur(8px);`
   - All preset cards now have frosted glass effect with subtle shadow

10. **ScaleGrid.svelte** - Scale card backgrounds
    - Same glassmorphic styling as PresetGrid
    - Consistent aesthetic across browser grids

11. **SequencerPatternGrid.svelte** - Pattern sliders and container (3 elements)
    - Length slider: Added `.glass-panel` class + `color-mix()` background
    - Pattern container: Added `.glass-panel` class + `color-mix()` background
    - Rate slider: Added `.glass-panel` class + `color-mix()` background
    - Shared component used in MuteSequencerControl and PitchSequencerControl

12. **RackVariationChooser.svelte** - Variation slider
    - `bg-background/50` → `.glass-panel` + `color-mix(in srgb, var(--background), transparent 50%)`
    - Used in drum rack views for variation selection

13. **VerticalDiscreteSlider.svelte** - Discrete slider background
    - `bg-background/50` → `.glass-panel` + `color-mix()`
    - Reusable discrete value slider component

14. **FolderNavigationColumn.svelte** - Navigation button backgrounds
    - Before: `background: transparent;`
    - After: `background: color-mix(in srgb, var(--browser-bg-secondary), transparent 85%); backdrop-filter: blur(4px);`
    - Subtle glass background for better visibility

15. **UnifiedGestureBrowser.v6.svelte** - Browser panel backgrounds
    - `.col-0` (sidebar): Added glassmorphic background with 10% transparency + 4px blur
    - `.expanded-area` (main content): Made opaque per user request (solid `var(--browser-bg-secondary)`)
    - Prevents seeing components behind browser when expanded

**Session 4: Additional Refinements**

16. **FilterCurve.svelte** - Visual cleanup
    - Removed vertical indicator lines (filter dot lines and cutoff frequency line)
    - Cleaner filter visualization in AutoFilter XY device

17. **QuantizeGrooveControl.svelte** - Button styling and z-index fixes
    - Removed up/down arrows (↑ ↓) from transpose buttons, now shows just "+12" and "-12"
    - Added `z-index: 10` + `overflow: visible` to track container
    - Added `z-index: 100` to quantize handle
    - Added `z-index: 0` to right button for proper layering

18. **ClipLoopControlV6.svelte** - Z-index layering fixes
    - Added `z-index: 10` + `overflow: visible` to track container
    - Added `z-index: 50` to loop range (middle brace)
    - Added `z-index: 100` to start handle
    - Added `z-index: 100` to end handle
    - Added `z-index: 0` to right button
    - Handles now properly render above adjacent buttons

## Files Changed (Complete List)

**Phase 1: Browser Fixes (PR #172)**
```
interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte
  - Added global scrollbar hiding rules

interface/src/lib/components/v6/browser/VendorButtonGrid.svelte
  - Removed conflicting onclick handler
  - Added scrollbar hiding to vendor-buttons and category-section
  - Increased vendor text size to var(--text-2xl)
  - Increased scale root note to var(--text-5xl)
  - Removed invalid selectedCategory === 'audio' check
```

**Phase 2: Glassmorphic System (18 components)**
```
# Central Display Components (8 files)
interface/src/lib/components/v6/central/CentralDisplay.svelte
interface/src/lib/components/v6/central/views/EchoCentralView.svelte
interface/src/lib/components/v6/central/views/ReverbCentralView.svelte
interface/src/lib/components/v6/central/views/SimplerCentralView.svelte
interface/src/lib/components/v6/central/views/ArpeggiatorCentralView.svelte
interface/src/lib/components/v6/central/views/CompressorCentralView.svelte
interface/src/lib/components/v6/central/views/GuitarCentralView.svelte
interface/src/lib/components/v6/central/views/UtilityCentralView.svelte

# Browser & Shared Controls (7 files)
interface/src/lib/components/v6/browser/PresetGrid.svelte
interface/src/lib/components/v6/browser/ScaleGrid.svelte
interface/src/lib/components/v6/browser/FolderNavigationColumn.svelte
interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte (glassmorphic panels)
interface/src/lib/components/v6/clips/SequencerPatternGrid.svelte
interface/src/lib/components/v6/controls/RackVariationChooser.svelte
interface/src/lib/components/v6/controls/VerticalDiscreteSlider.svelte

# Visual Refinements (3 files)
interface/src/lib/components/v6/device-panel/FilterCurve.svelte
interface/src/lib/components/v6/clips/QuantizeGrooveControl.svelte
interface/src/lib/components/v6/clips/ClipLoopControlV6.svelte

# Documentation
documentation/current/glassmorphic-ui-implementation-log.md (created)
documentation/current/central-views-glassmorphic-guide.md (created)
```

**Total: 20 files modified/created**

## Consequences

### Positive

**Phase 1 Benefits:**
- Browser opens reliably for all instrument vendors
- Clean, modern UI without visible scrollbars
- Better text readability for live performance
- Simpler event handling (removed redundant onclick)
- Fixed TypeScript type errors

**Phase 2 Benefits:**
- **Visual Consistency**: Unified glassmorphic aesthetic across entire V6 interface
- **Modern CSS**: Leverages `color-mix()` for better color manipulation and theme support
- **Performance**: Backdrop-filter blur is hardware-accelerated on modern browsers
- **Maintainability**: Standardized glass utility classes reduce code duplication
- **Depth Perception**: Transparency and blur create clear visual hierarchy
- **iPad Optimization**: Blur effects work perfectly on Safari/iOS
- **Theme Support**: `color-mix()` works with both light and dark modes
- **Accessibility**: Maintains WCAG contrast ratios with proper transparency levels
- **Developer Experience**: Clear design tokens make future updates easier
- **Z-index Fixes**: Control handles properly layer above adjacent buttons

### Neutral
- Scrollbar visibility is a UX preference, but invisible scrollbars with functional scrolling is a common modern pattern
- Glassmorphic design is a contemporary aesthetic choice that may evolve
- Browser transparency made opaque per user preference (prevents see-through to underlying components)

### Negative
- **Browser Support**: backdrop-filter requires modern browsers (works on all target platforms: Safari iOS, Chrome, Edge)
- **Performance Consideration**: Heavy blur effects could impact performance on older devices (mitigated by using moderate blur amounts: 4-12px)
- **Transparency Complexity**: Some components required trial and error to find optimal transparency levels

## Related ADRs

**Browser & Gesture System:**
- ADR 025: Tap/Hold Gesture Mode
- ADR 023: Browser Layout and Persistent Mode
- ADR 029: Persistent Browser Implementation
- ADR 120: Browser Memory Leak Fix (JSON Columns)

**Component Architecture:**
- ADR 049: Complete State Architecture
- ADR 050: Component State Management Pattern
- ADR 075: Deprecate Generic Parameter, Modernize Central Views

## Implementation Notes

### Event Propagation (Phase 1)
The browser fix demonstrates the importance of understanding event propagation in Svelte:
- Touch/mouse events fire in order: `down` → `up` → `click`
- When using custom gesture detection (like `HoldGestureDetector`), avoid mixing with `onclick` handlers
- The `onclick` was attempting to handle the "close when selected vendor tapped again" logic, but this was already handled in `handleVendorTap` via `onmouseup`/`ontouchend`

### Cross-Browser Scrollbar Hiding (Phase 1)
Requires targeting all three rendering engines:
- **Firefox**: `scrollbar-width: none`
- **IE/Edge**: `-ms-overflow-style: none`
- **Webkit (Chrome/Safari/Opera)**: `::-webkit-scrollbar { display: none }`

### Glassmorphic Design Patterns (Phase 2)

**Color Mixing Strategy:**
```css
/* Component-specific colored backgrounds */
background: color-mix(in srgb, ${color.secondary}, transparent 10%);

/* Theme-aware backgrounds (light/dark mode) */
background: color-mix(in srgb, var(--background), transparent 15%);

/* Border transparency for subtle depth */
border-color: color-mix(in srgb, var(--border), transparent 60%);
```

**Z-Index Layering Solution:**
When elements with negative margins extend beyond container bounds:
1. Add `overflow: visible` to parent container
2. Give parent container higher z-index than siblings
3. Give child elements even higher z-index values
4. Example: Container (z-index: 10) → Range (z-index: 50) → Handles (z-index: 100) → Adjacent buttons (z-index: 0)

**Performance Optimization:**
- Moderate blur values (4-12px) for 60fps on iPad
- Hardware-accelerated via `-webkit-backdrop-filter`
- Avoid blur on rapidly animating elements
- Use opacity transitions, not blur transitions

**Accessibility Considerations:**
- Maintain sufficient contrast ratios with transparency
- Test in both light and dark modes
- Ensure interactive elements remain clearly visible
- Use `pointer-events: none` on decorative blur layers

## Future Improvements

- [ ] Extract shared glassmorphic button grid pattern
- [ ] Consider glassmorphic styling for DeviceXY/DeviceSlider components (15 components inherit this)
- [ ] Performance profiling on older iPad models
- [ ] Visual regression testing suite
- [ ] Automated accessibility contrast checking
- [ ] Document glass panel usage guidelines for new components

## Documentation

Comprehensive implementation documentation available in:
- `documentation/current/glassmorphic-ui-implementation-log.md` - Detailed session logs
- `documentation/current/central-views-glassmorphic-guide.md` - Component-by-component analysis
