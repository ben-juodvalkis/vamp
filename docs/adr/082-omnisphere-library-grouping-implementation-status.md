# ADR 070: Omnisphere Library Grouping Implementation Status

**Date:** 2025-10-24
**Status:** Deprecated
**Deciders:** Ben Juodvalkis
**Tags:** UX, Omnisphere, CSS, Flex Layout

> **Note:** This ADR described library grouping UI that was removed in ADR-112. The current implementation uses flat library lists without visual grouping. See [ADR-112](112-omnisphere-semantic-category-detection.md) for current approach.

---

## Context

Implementation of library grouping for Omnisphere browser to replace individual "Library → Instrument" buttons with grouped sections containing library headers and individual instrument buttons.

## Progress Completed ✅

### 1. Backend Data Structure
- **OmnisphereAdapter**: Extended with `getGroupedFolders()` method
- **Library Color Mapping**: 25+ libraries with consistent colors
- **Path Parsing**: Handles both old "Library → Instrument" and new grouped formats
- **Type System**: Added `LibraryGroup` and `GroupedFolders` interfaces

### 2. UI Implementation
- **Grouped Rendering**: Library sections with tinted backgrounds
- **Library Headers**: Centered, uppercase library names
- **Button Interaction**: Updated hover/click logic for grouped navigation
- **Visual Styling**: Color-coordinated groups with proper borders and spacing

### 3. Data Flow
- **Column Loading**: Fetches both regular folders and grouped folders
- **Navigation Logic**: Maps global button indices back to library groups
- **State Management**: Preserves grouped navigation paths

## Current Problems ❌

### **Core Issue: Flex Layout Logic**

**Problem**: The CSS expansion logic is fundamentally flawed and causes overlapping.

**Current Implementation**:
```css
/* Counts library containers, not buttons */
.button-list.grouped:has(.library-group:nth-child(-n+3):last-child) {
    justify-content: space-evenly;
}

.button-list.grouped:has(.library-group:nth-child(-n+3):last-child) .library-group {
    flex: 1;
    min-height: 15vh;
}
```

**Issues**:
1. **Wrong Counting Logic**: Counts library groups (containers) instead of total buttons
2. **Forced Flex**: All library groups have `display: flex; flex-direction: column` always
3. **Overlapping**: When many buttons exist across few groups, CSS forces expansion causing overlap

### **Attempted Solutions That Failed**:

1. **Conditional Flex Container**: Made `.button-list.grouped` conditionally flex
   - **Problem**: Complex CSS with multiple conditional states
   
2. **Button-Based Counting**: Changed to count `.selection-button:nth-child(-n+10)`
   - **Problem**: Buttons are nested inside library groups, so CSS selector doesn't work across group boundaries

3. **Group Count Variations**: Tried 3, 6, 10 group limits
   - **Problem**: Still counting containers, not actual content density

## Technical Analysis

### **Root Cause**
The CSS `:has()` selector can't count across nested structures. When buttons are inside `.library-group > .library-items`, the selector `.button-list.grouped:has(.selection-button:nth-child(-n+10))` doesn't work because buttons aren't direct children of `.button-list.grouped`.

### **CSS Hierarchy**:
```
.button-list.grouped
├── .library-group (Group 1)
│   ├── .library-header
│   └── .library-items
│       ├── .selection-button (Button 1)
│       ├── .selection-button (Button 2)
│       └── .selection-button (Button 3)
├── .library-group (Group 2)
│   ├── .library-header  
│   └── .library-items
│       ├── .selection-button (Button 4)
│       └── .selection-button (Button 5)
```

**CSS Can't Count**: Total buttons across all groups (5 buttons)  
**CSS Can Count**: Number of library groups (2 groups)

## Potential Solutions

### **Option 1: JavaScript-Based Logic** ⭐ **RECOMMENDED**
- Calculate total button count in JavaScript during column loading
- Add CSS class like `.has-few-buttons` or `.has-many-buttons` 
- Use simple CSS rules based on class presence

### **Option 2: Flatten Button Structure**
- Render all buttons as direct children of `.button-list.grouped`
- Use CSS grid or flexbox with visual grouping via borders/backgrounds
- Loses semantic grouping but enables proper CSS counting

### **Option 3: Abandon Expansion Logic**
- Use fixed-height library groups with internal scrolling
- Simpler but loses the space-filling UX when few items

### **Option 4: CSS Custom Properties**
- Set CSS custom property `--total-buttons` via JavaScript
- Use CSS `@property` and comparison logic (limited browser support)

## Recommended Implementation Plan

### **Phase 1: JavaScript-Based Expansion Logic**

1. **Update Column Loading Logic**:
   ```typescript
   // In loadNextColumn()
   const totalButtons = groupedFolders?.groups.reduce((sum, group) => sum + group.items.length, 0) || 0;
   const shouldExpand = totalButtons <= 10;
   
   // Add CSS class to column element
   if (shouldExpand) {
       columnElement.classList.add('expand-groups');
   }
   ```

2. **Simplified CSS**:
   ```css
   .button-list.grouped.expand-groups {
       justify-content: space-evenly;
   }
   
   .button-list.grouped.expand-groups .library-group {
       flex: 1;
       min-height: 15vh;
   }
   ```

3. **Benefits**:
   - ✅ Accurate button counting
   - ✅ Simple CSS logic  
   - ✅ Maintainable code
   - ✅ No overlapping issues

### **Phase 2: Refinement**
- Fine-tune expansion thresholds
- Optimize visual spacing
- Add smooth transitions

## Decision Outcome

**Next Steps**: Implement JavaScript-based expansion logic to replace the flawed CSS-only approach.

**Key Insight**: CSS `:has()` selectors cannot count across nested hierarchies. JavaScript calculation is the most reliable approach for complex layout decisions.

---

## Related ADRs
- **ADR 069**: Omnisphere Type-First Navigation Architecture
- **ADR 018**: Gesture Browser Architecture

---

## Status Summary

✅ **Complete**: All functionality implemented and tested successfully.

---

## Implementation Completed (2025-10-24)

### **JavaScript-Based Expansion Logic** ⭐ **IMPLEMENTED**

Replaced the flawed CSS `:has()` approach with reliable JavaScript calculation:

1. **Updated loadNextColumn() Function**:
   ```typescript
   // Calculate if grouped folders should expand (≤10 total buttons AND ≤3 groups)
   const totalButtons = groupedFolders.groups.reduce((sum, group) => sum + group.items.length, 0);
   const groupCount = groupedFolders.groups.length;
   const shouldExpandGroups = totalButtons <= 10 && groupCount <= 3;
   ```

2. **Enhanced CSS Logic**:
   ```css
   /* Replaced CSS :has() selectors with class-based approach */
   .button-list.grouped.expand-groups {
       justify-content: space-evenly;
   }
   .button-list.grouped.expand-groups .library-group {
       flex: 1;
       min-height: 15vh;
   }
   ```

3. **Fixed Grouped Button Selection**:
   - Added library context to button data attributes
   - Updated path construction to use "Library → Item" format
   - Fixed highlighting logic to be library-aware

### **Results** ✅

- **No more overlapping**: Complex scenarios (6 groups, 8 buttons) stay compact
- **Proper expansion**: Simple scenarios (≤3 groups, ≤10 buttons) expand to fill space
- **Unique selection**: Each library's buttons work independently
- **Clean UI maintained**: Buttons still display just the item name

### **Test Cases Verified**

1. **Bass → Instruments**: 6 groups, 8 buttons → Compact (no expansion)
2. **Keys → Hybrid → Keyboards**: Multiple libraries → Unique selection per library
3. **Simple scenarios**: Few groups/buttons → Proper expansion

### **Key Insight Confirmed**

CSS `:has()` selectors cannot count across nested hierarchies. JavaScript calculation provides reliable, maintainable logic for complex layout decisions involving grouped content.