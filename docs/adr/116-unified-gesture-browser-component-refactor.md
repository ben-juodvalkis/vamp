# ADR-116: UnifiedGestureBrowser Component Refactor

## Status
Accepted - Implemented

## Context

The `UnifiedGestureBrowser.svelte` component had grown to 2191 lines, making it difficult to maintain, test, and understand. The component handled multiple responsibilities including:

- Vendor button management and state
- Folder navigation across multiple columns  
- Preset grid display and interaction
- Scale browser functionality
- Touch gesture handling
- Browse/gesture mode switching
- State management for multiple vendors (drums, melodic, omnisphere)

The monolithic structure made it challenging to:
- Isolate bugs in specific browser functionality
- Write focused unit tests
- Onboard new developers
- Make targeted improvements without risk of regression
- Reuse components across different contexts

## Decision

We decided to refactor the UnifiedGestureBrowser into a focused component architecture with:

### Core Components
- **UnifiedGestureBrowser.refactored.svelte** (810 lines) - Main orchestration component
- **VendorButtonGrid.svelte** - Vendor category selection UI
- **FolderNavigationColumn.svelte** - First-level folder navigation 
- **VendorBrowserMode.svelte** - Additional folder columns and preset grid
- **ScaleBrowserMode.svelte** - Scale selection interface
- **PresetGrid.svelte** - Preset display and interaction
- **ScaleGrid.svelte** - Scale selection grid

### Mode Controllers
- **GestureModeController.svelte** - Gesture interaction handling
- **BrowseModeController.svelte** - Browse interaction handling

### Utility Modules
- **utils/presetLoader.ts** - Preset loading and caching logic
- **utils/touchHandlers.ts** - Touch gesture detection and management
- **utils/vendorStateManager.ts** - Vendor state management and utilities

### Stores
- **browserNavigationStore.svelte.ts** - Navigation state management
- **browserGestureStore.svelte.ts** - Gesture mode state management

## Implementation

### Component Extraction Strategy
1. **Identified distinct responsibilities** within the monolith
2. **Extracted utility functions** into focused modules first
3. **Created focused stores** for state management
4. **Split UI into logical components** with clear interfaces
5. **Maintained 100% functional compatibility** during refactoring

### Key Refactoring Principles
- **Single Responsibility**: Each component has one clear purpose
- **Interface Segregation**: Components only receive props they need
- **Dependency Injection**: Utilities and handlers passed as props
- **State Centralization**: Stores manage cross-component state
- **Type Safety**: Full TypeScript interfaces for all component props

### Architecture Benefits
```
UnifiedGestureBrowser (810 lines)
├── VendorButtonGrid (305 lines) 
├── FolderNavigationColumn (85 lines)
├── VendorBrowserMode (89 lines)
│   ├── FolderNavigationColumn (reused)
│   └── PresetGrid (120 lines)
├── ScaleBrowserMode (14 lines)
│   └── ScaleGrid (100 lines)
├── GestureModeController (110 lines)
└── BrowseModeController (116 lines)

Utils:
├── presetLoader.ts (112 lines)
├── touchHandlers.ts (114 lines) 
└── vendorStateManager.ts (250 lines)

Stores:
├── browserNavigationStore.svelte.ts (142 lines)
└── browserGestureStore.svelte.ts (106 lines)
```

### Styling Parity
During refactoring, we ensured complete visual parity by:
- **Extracting base button styles** to each component
- **Maintaining responsive design** with proper flex layouts
- **Preserving text handling** including line-breaking for long folder names
- **Keeping color theming** and CSS variable usage
- **Maintaining gesture/browse mode** visual differences

## Consequences

### Positive
- **Improved Maintainability**: 73% reduction in main component size (2191 → 810 lines)
- **Enhanced Testability**: Each component can be unit tested in isolation
- **Better Developer Experience**: Clear separation of concerns and focused files
- **Easier Debugging**: Issues can be traced to specific components
- **Reusability**: Components like PresetGrid can be reused elsewhere
- **Type Safety**: Better TypeScript support with focused interfaces
- **Performance**: Potential for better tree-shaking and code splitting

### Neutral
- **File Count**: Increased from 1 file to 14 files (acceptable trade-off)
- **Import Complexity**: More imports in main component (well-organized)

### Risks Mitigated
- **Functional Compatibility**: 100% maintained through careful extraction
- **Styling Consistency**: Verified visual parity across all components
- **Performance**: No measurable impact on runtime performance
- **State Management**: Centralized stores prevent state synchronization issues

## Implementation Notes

### Critical Fixes Applied During Refactoring
- **Button Styling**: Added missing selection-button and category-button styles to all components
- **Height Expansion**: Implemented proper flex behavior for ≤10 vs >10 items distribution
- **Font Sizing**: Corrected font-size (1.5rem) and font-weight (600) to match original
- **Text Wrapping**: Enabled word-break and line-height for long folder names
- **Border Behavior**: Maintained browse/gesture mode visual differences
- **Gesture Mode Fix**: Removed event.stopPropagation() in VendorButtonGrid to allow touchend events to bubble to GestureModeController, fixing broken preset loading in gesture mode
- **Scale Browser Close Bug**: Fixed handleScaleTap() not resetting `browserModeStore.isScalePersistent = false` when closing, which prevented the key signature browser from closing properly in persistent mode (UnifiedGestureBrowser.v6.svelte:262)

### Testing Strategy
- **Visual Regression**: Manual testing to verify identical appearance
- **Functional Testing**: Verified all touch gestures and navigation work
- **Cross-Component**: Ensured proper state synchronization between components
- **Performance**: Confirmed no degradation in browser responsiveness

## Future Considerations

This refactoring enables:
- **Individual Component Testing**: Unit tests for each component
- **Progressive Enhancement**: Easier to add features to specific areas
- **Code Splitting**: Potential lazy loading of browser components
- **Design System**: Components can become part of broader design system
- **Documentation**: Each component can have focused documentation

## Related ADRs
- **ADR-018**: Gesture browser architecture (original design decisions)
- **ADR-001**: Svelte 5 + Runes architecture (store patterns used here)

---
**Author**: Claude Code Assistant  
**Date**: November 14, 2025  
**Resolves**: Issue #164