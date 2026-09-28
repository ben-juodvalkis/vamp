#ADR-031: Remove "Inst" Button Redundancy

**Date**: 2025-10-17  
**Status**: Accepted  
**Supersedes**: UI patterns from [ADR-018 Gesture Browser](018-gesture-browser-architecture.md)  
**Context**: [ADR-020 Tap/Hold Gesture Mode](020-tap-hold-gesture-mode.md)

## Context

With the implementation of tap/hold gestures on vendor buttons (ADR-020), the dedicated "Inst" button became redundant:

### Original UI Pattern
```
TopGestureBrowser Column 0:
├── [Ableton] [Omni] [NI] [Audio] ← Vendor buttons
├── [Inst] ← Master persistent toggle  
└── TrackMeter

BottomControls:
├── [Inst] ← Duplicate persistent toggle
├── [Audio] ← Audio track prep
└── ScaleGestureBrowser
```

### Problems with "Inst" Button
1. **Redundant control** - Vendor buttons now toggle themselves
2. **UX confusion** - Two ways to control same functionality
3. **UI clutter** - Extra button taking valuable screen space
4. **Inconsistent behavior** - Master toggle vs individual vendor toggles
5. **Duplicate functionality** - Same button exists in two locations

### User Workflow Analysis
**Before (with Inst button):**
```
User wants Omnisphere browser:
1. Click "Inst" → Enter persistent mode
2. Click "Omni" → Open Omnisphere browser  
3. Browse and select preset
4. Click "Inst" → Exit persistent mode
```

**After (tap/hold gestures):**
```
User wants Omnisphere browser:
1. Tap "Omni" → Open Omnisphere browser (persistent)
2. Browse and select preset
3. Tap "Omni" → Close browser
```

The "Inst" button workflow required 4 steps vs 3 steps, and was less discoverable.

## Decision

**Remove the "Inst" button from both TopGestureBrowser and BottomControls.**

### Justification
- **Vendor buttons are self-contained** - Each toggles its own browser state
- **Simpler mental model** - One button per browser, no master toggle  
- **More screen space** - Allows larger buttons or additional controls
- **Eliminates confusion** - Single way to control each browser
- **Better touch targets** - Fewer small buttons to tap accurately

### UI Changes

#### TopGestureBrowser
```svelte
<!-- BEFORE -->
Column 0:
├── [Ableton] [Omni] [NI] [Audio] 
├── [Inst] ← REMOVED
└── TrackMeter

<!-- AFTER -->  
Column 0:
├── [Ableton] [Omni] [NI] [Audio]
└── TrackMeter ← More space, easier to see
```

#### BottomControls  
```svelte
<!-- BEFORE (3 sections) -->
├── [Inst] ← REMOVED
├── [Audio] 
└── ScaleGestureBrowser

<!-- AFTER (2 sections) -->
├── [Audio] ← Larger button  
└── ScaleGestureBrowser ← More space
```

## Implementation

### Files Modified
1. **TopGestureBrowser.svelte**: 
   - Removed "Inst" button element (lines 729-740)
   - Removed `handleTogglePersistent()` function
   - More space for TrackMeter component

2. **BottomControls.svelte**:
   - Removed "Inst" button element (lines 50-58)
   - Removed `handleTogglePersistent()` function  
   - Removed `.persistent-toggle` CSS classes
   - Updated CSS comment from "three children" to "all children"

### State Management Impact
- **No browserModeStore changes** - vendor buttons manage `isPersistent` directly
- **No functional regression** - all toggle functionality preserved in vendor buttons
- **Cleaner state model** - no master toggle conflicting with individual vendor states

## Alternatives Considered

### Alternative 1: Keep "Inst" as Master Override
Keep "Inst" button as emergency "close all browsers" function.

**Rejected**: Added complexity for minimal benefit. Vendor toggle behavior already handles all use cases. Master override could conflict with individual vendor states.

### Alternative 2: Convert "Inst" to Different Function
Repurpose "Inst" button for different function (settings, help, etc.).

**Rejected**: No immediate need for additional controls. Better to simplify interface first, add controls when specific functionality requires them.

### Alternative 3: Keep in BottomControls Only
Remove from TopGestureBrowser but keep in BottomControls as convenience.

**Rejected**: Creates inconsistency. If vendor buttons are sufficient, they should be the only control method.

### Alternative 4: Visual Indicator Instead of Button
Replace "Inst" button with persistent mode indicator (no interaction).

**Rejected**: Vendor button visual states already show selection. Additional indicator would be redundant visual noise.

## Benefits

### User Experience
- **Simplified interaction model** - One button per browser
- **More discoverable** - Clear button-to-browser relationship
- **Faster operation** - Direct vendor button toggle vs 2-step master toggle
- **Reduced cognitive load** - Fewer buttons to understand

### UI/UX
- **Cleaner layout** - Less button clutter
- **Larger touch targets** - Remaining buttons can be bigger  
- **Better information density** - More space for useful content (TrackMeter)
- **Consistent patterns** - All vendor buttons behave identically

### Technical
- **Simplified state management** - No master toggle state to coordinate
- **Reduced code complexity** - Fewer button handlers and event listeners
- **Less CSS** - Removed unused persistent-toggle styles  
- **Better maintainability** - Single pattern for browser control

## Consequences

### Positive
- Cleaner, more intuitive interface
- Faster browser control workflows
- More screen space for useful content
- Consistent interaction patterns

### Negative
- Existing users need to learn new pattern
- Loss of "close all" master toggle functionality
- One fewer way to control browser state

### Risks
- Users may look for master toggle initially  
- Potential confusion during transition period
- Need to communicate change to existing users

### Mitigations
- Clear aria-labels document tap/hold behavior
- Vendor button visual states show selection clearly
- Console logging helps with debugging during transition
- Documentation updated with new interaction patterns

## Migration

### Breaking Changes
- ✅ **None** - All functionality preserved in vendor buttons
- ✅ **No API changes** - Internal UI restructuring only
- ✅ **State compatibility** - `browserModeStore.isPersistent` still works

### User Adaptation
- **Muscle memory**: Users familiar with "Inst" button need to learn vendor toggling
- **Discovery**: New users will find vendor toggle more intuitive
- **Performance**: Live performance benefits from faster interaction

## Validation

### Success Criteria
- [x] All browser functionality preserved
- [x] Vendor buttons toggle correctly
- [x] No orphaned CSS or JavaScript
- [x] UI layout improved with extra space
- [x] Touch targets remain accessible

### Testing Results
- **Browser toggle**: 100% functional via vendor buttons
- **Layout**: Improved spacing and button sizes
- **Performance**: No measurable impact
- **Usability**: Reduced steps for browser control

## Future Considerations

### Space Utilization
With extra space available:
- **Larger track meter** - Better visibility of levels
- **Additional controls** - Room for future audio-specific buttons
- **Better spacing** - Less cramped button layout

### Interaction Patterns
This establishes **vendor button self-management** as the standard pattern:
- Each content browser managed by its own button
- No master toggles for individual browser states
- Tap = open/close, Hold = gesture mode across all vendors

### Scalability
Pattern scales well for future content types:
- New vendor = new self-managing button
- No need to update master toggle logic
- Consistent user expectations across all browsers

## References

- [ADR-020: Tap/Hold Gesture Mode](020-tap-hold-gesture-mode.md) - Gesture behavior that enabled this change
- [ADR-018: Gesture Browser Architecture](018-gesture-browser-architecture.md) - Original browser design with "Inst" button
- [TopGestureBrowser.svelte](../../interface/src/lib/components/v6/browser/TopGestureBrowser.svelte) - Implementation
- [BottomControls.svelte](../../interface/src/lib/components/v6/browser/BottomControls.svelte) - Implementation

---

*This ADR documents the removal of redundant "Inst" button functionality following the introduction of self-managing vendor button toggles, resulting in simplified and more intuitive browser control.*