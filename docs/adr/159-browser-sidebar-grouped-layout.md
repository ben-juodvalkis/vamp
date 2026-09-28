# ADR 159: Browser Sidebar Grouped Layout

**Date**: 2026-01-16
**Status**: Accepted

## Context

The browser sidebar displays 9 buttons for navigating instrument types and special functions (Audio, Scale, Recent). Previously, these buttons had varying heights (Scale and Recent were half-height) and were arranged in a single continuous column.

The main content area has 3 rows (Tracks Panel, Central Display, FX Grid) with consistent `--spacing-lg` gaps between them. The sidebar buttons did not visually align with these rows.

## Decision

Reorganize the sidebar into 3 groups of 3 equal-height buttons, with gaps matching the main content rows:

```
┌──────────────┐  ← Group 1 (aligns with Tracks Panel)
│    Audio     │
│  Key Sig     │
│    Recent    │
├──────────────┤  ← gap (--spacing-lg)
│    Drums     │  ← Group 2 (aligns with Central Display)
│    Bass      │
│    FX        │
├──────────────┤  ← gap (--spacing-lg)
│    Inst      │  ← Group 3 (aligns with FX Grid)
│    Keys      │
│    Synth     │
└──────────────┘
```

### Implementation Details

1. **Button Grouping**: Buttons are wrapped in `.button-group` divs with `flex: 1` for equal group heights
2. **Equal Button Heights**: All buttons within a group use `flex: 1` (removed half-height logic)
3. **Group Gaps**: `gap: var(--spacing-lg)` between groups matches main content row gaps
4. **Internal Gaps**: `gap: var(--spacing-xs)` between buttons within each group
5. **Expanded State Fix**: When a vendor is selected and browser expands, hide entire groups that don't contain the selected vendor (prevents empty groups from taking flex space)

### Vendor Grouping Logic

```typescript
const group2Ids = ['drums', 'bass', 'fx'];
const group3Ids = ['inst', 'keys', 'synth'];
const vendorsGroup2 = $derived(group2Ids.map(id => mainVendors.find(v => v.id === id)).filter(Boolean));
const vendorsGroup3 = $derived(group3Ids.map(id => mainVendors.find(v => v.id === id)).filter(Boolean));
```

## Consequences

### Positive
- Visual alignment between sidebar and main content creates cohesive layout
- Equal-height buttons provide consistent touch targets
- Logical grouping: utility functions (Audio/Scale/Recent), rhythm section (Drums/Bass/FX), melodic instruments (Inst/Keys/Synth)
- Gesture mode continues to work unchanged (relies on data attributes, not DOM structure)

### Negative
- Slightly more complex template structure with nested `.button-group` divs
- Group visibility logic required for expanded state

## Files Changed
- `interface/src/lib/components/v6/browser/VendorButtonGrid.svelte`
