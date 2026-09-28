#ADR-077: Browser Column Consolidation

## Status
Accepted

## Context
The TopGestureBrowser component had a multi-column layout where:
- Column 0: Vendor buttons (Ableton, Omni, NI, Audio) + Meter
- Column 1+: Separate navigation columns for folder hierarchy  
- Final column: Presets grid

This created excessive horizontal space usage and required users to scan across multiple columns for navigation. The interface felt unnecessarily wide and the navigation flow was not optimal.

## Decision
Consolidate the first navigation column into the leftmost vendor column to create a more compact and efficient layout:

### Layout Changes
- **Left Column (120px)**: 
  - Top: Vendor buttons (Ableton, Omni, NI, Audio)
  - Middle: First-level folder navigation (scrollable)
  - Bottom: Selected track meter (reduced from 200px to 150px height)
- **Expanded Area**: 
  - Deeper navigation levels (columns.slice(1))
  - Presets grid

### Visual Design
- **Vendor button height**: Reduced to 8vh to make room for folders
- **Folder button height**: 6vh with smaller font (0.9rem)
- **Folder text color**: Inherits selected vendor color with 80% opacity
- **Selected folder styling**: Outline with vendor color (consistent with deeper levels)

### Technical Implementation
- Added `.vendor-buttons`, `.folder-navigation` containers with flex layout
- Created `handleFolderClick()` function for left panel navigation
- Updated CSS variables to propagate vendor colors to folder buttons
- Preserved existing gesture and browse mode functionality

## Consequences

### Positive
- **Reduced horizontal space**: Eliminated one full column layer
- **Improved navigation flow**: Vendor → folders → presets in logical sequence
- **Better visual hierarchy**: Folder colors match parent vendor for clear association
- **Maintained width**: Kept 120px constraint as requested
- **Preserved functionality**: All existing features (gesture/browse modes) work unchanged

### Negative
- **Less folder space**: Folder names must fit in 120px width (may truncate long names)
- **Scrolling required**: More folders require vertical scrolling in left panel

### Neutral
- **Code complexity**: Similar complexity, just reorganized layout
- **Performance**: No significant impact on performance

## Implementation Notes
- Used CSS `!important` to ensure vendor colors override default text styling
- Maintained existing column indexing logic with minimal adjustments
- Added proper event handlers for left panel folder navigation
- Preserved all touch/gesture interaction patterns

## Alternatives Considered
1. **Increase left column width**: Rejected to maintain compact design
2. **Remove folder navigation entirely**: Rejected as it's essential for browsing
3. **Horizontal folder tabs**: Rejected due to limited space and poor UX

## References
- Related to ADR-018 (Gesture Browser Architecture)
- Related to ADR-020 (Browser Layout and Persistent Mode)