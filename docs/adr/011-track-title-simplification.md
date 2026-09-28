# ADR 012: Track Title Display Simplification

**Status:** Accepted
**Date:** 2025-10-06
**Deciders:** Ben Juodvalkis
**Related:** TrackHeader component, TrackStrip UI

## Context

The track strip header displayed the track name as a styled button with borders, backgrounds, and limited character abbreviation. This created visual clutter and reduced readability in the performance interface.

### Current Approach (Before ADR 012)

**Track Title Display:**
- Styled as a button with borders (`border-2`)
- Background colors for active/muted states
- Text abbreviated to 8 characters max via `abbreviateTrackName()`
- Truncated with ellipsis when too long
- Fixed height of `h-12`
- Significant padding (`px-2`, `gap-2`, `p-2`)
- Border and background styling creating button appearance

**Problems:**
1. Track names abbreviated/truncated made identification difficult
2. Button styling (borders, backgrounds) created unnecessary visual noise
3. Limited height prevented multi-line wrapping
4. Full track names not visible
5. Quotation marks from Ableton displayed in UI
6. Solo button at bottom taking valuable vertical space
7. Selection ring border clipped by parent overflow constraints

### User Experience Goals

1. **Maximum readability** - Full track names visible without abbreviation
2. **Minimal visual clutter** - Remove unnecessary button styling
3. **Multi-line support** - Allow longer names to wrap naturally
4. **Clean text presentation** - Remove quotation marks from display
5. **Tap-to-mute functionality** - Maintain interactive behavior
6. **Color-coded status** - Preserve visual mute state indication
7. **Full selection highlight visibility** - Show complete ring border

## Decision

**Simplify track title to plain text with color-based mute indication, remove abbreviation, support multi-line wrapping, and fix selection ring clipping.**

### Visual Changes

**Track Title Styling:**
- Remove button borders and backgrounds
- Display full track name without abbreviation
- Text size increased from `text-xs` to `text-md`
- Height doubled from `h-12` to `h-24` to accommodate wrapping
- Multi-line text wrapping enabled
- Reduced padding throughout (`gap-1`, `p-1`, `px-1 py-1`)
- Active tracks show track color
- Muted tracks show as `text-muted-foreground`

**Text Processing:**
- Remove `abbreviateTrackName()` function call
- Strip quotation marks (single and double) from display
- Full track name visible with word wrapping via `break-words`

**Layout Optimization:**
- Solo button commented out to provide more vertical space
- Container padding reduced from `gap-2 p-2` to `gap-1 p-1`

**Selection Ring Fix:**
- Changed parent container from `overflow-hidden` to `overflow-visible` in `+page.svelte`
- Changed tracks container from `overflow-y-hidden` to `overflow-y-visible` in `TracksPanelV6.svelte`
- Added `py-1` vertical padding to tracks container for ring spacing

### Implementation Details

**TrackHeader.svelte:**
```svelte
<!-- Before -->
let displayName = $derived(isMaster ? 'Master' : abbreviateTrackName(name));

<button class="w-full h-12 text-xs ... border-2 bg-background/80 border-current ...">
    {displayName}
</button>

<!-- After -->
let displayName = $derived(isMaster ? 'Master' : name.replace(/["']/g, ''));

<button class="w-full h-24 text-md ... flex items-center justify-center {isActive ? '' : 'text-muted-foreground'}">
    <span class="break-words">{displayName}</span>
</button>
```

**TrackStrip.svelte:**
```svelte
<!-- Before -->
<div class="w-full h-full flex flex-col gap-2 p-2">
    <TrackHeader ... />
    <div class="flex-1 w-full"><TrackVolumeMeter ... /></div>
    <TrackFooter ... />  <!-- Solo button -->
</div>

<!-- After -->
<div class="w-full h-full flex flex-col gap-1 p-1">
    <TrackHeader ... />
    <div class="flex-1 w-full"><TrackVolumeMeter ... /></div>
    <!-- <TrackFooter ... /> -->  <!-- Solo button commented out -->
</div>
```

**+page.svelte (Selection Ring Fix):**
```svelte
<!-- Before -->
<div class="flex-1 min-h-0 overflow-hidden">
    <TracksPanelV6 ... />
</div>

<!-- After -->
<div class="flex-1 min-h-0 overflow-visible">
    <TracksPanelV6 ... />
</div>
```

**TracksPanelV6.svelte (Selection Ring Fix):**
```svelte
<!-- Before -->
<div class="flex-1 overflow-x-auto overflow-y-hidden" bind:this={tracksContainerEl}>

<!-- After -->
<div class="flex-1 overflow-x-auto overflow-y-visible py-1" bind:this={tracksContainerEl}>
```

**trackFormatters.ts:**
```typescript
// Quote removal added to abbreviateTrackName (though no longer used in header)
export const abbreviateTrackName = memoize((name: string, maxLength: number = 8): string => {
    name = name.replace(/["']/g, '');  // Remove quotes
    // ... rest of function
});
```

### Rationale

**1. Remove Button Styling**
- ✅ Reduces visual clutter in performance interface
- ✅ Track name is primary information, not a button aesthetic
- ✅ Mute toggle still functions via click/tap
- ✅ Color coding clearly indicates muted state

**2. Full Track Names**
- ✅ Improved track identification
- ✅ No mental mapping from abbreviations
- ✅ Professional appearance with complete names
- ✅ Better UX for tracks with descriptive names

**3. Multi-Line Wrapping**
- ✅ Accommodates longer track names
- ✅ Better use of vertical space with solo button removed
- ✅ Increased text size improves readability
- ✅ Natural text flow with `break-words`

**4. Quote Removal**
- ✅ Cleaner text presentation
- ✅ Removes Ableton's internal quote formatting
- ✅ More polished user-facing display

**5. Solo Button Removal**
- ✅ Freed vertical space for track name
- ✅ Simplified interface (solo less commonly used in live looping)
- ✅ Can be restored if needed in future iteration

**6. Selection Ring Visibility**
- ✅ Full ring border now visible without clipping
- ✅ Clear visual feedback for selected track
- ✅ `overflow-visible` allows ring to extend beyond container bounds
- ✅ `py-1` padding provides necessary spacing

## Consequences

### Positive

✅ **Improved Readability**
- Full track names visible
- Larger text size (`text-md` vs `text-xs`)
- Multi-line support for long names
- No abbreviations or truncation

✅ **Cleaner Interface**
- Minimal visual styling
- Color-based state indication only
- Reduced padding and spacing
- No unnecessary borders or backgrounds

✅ **Better Space Utilization**
- Solo button removed from bottom
- Doubled header height for text wrapping
- More room for track name display

✅ **Text Quality**
- Quotation marks removed
- Professional presentation
- Full word wrapping support

✅ **Visual Feedback**
- Complete selection ring visible
- No border clipping at top/bottom
- Clear highlight when track selected

✅ **Maintained Functionality**
- Tap-to-mute still works
- Color coding preserved
- Interactive behavior unchanged

### Negative

⚠️ **Solo Control Removed**
- Solo button no longer accessible from track strip
- Users must use alternative solo method
- **Mitigation**: Can be restored if workflow requires it, or moved to alternate location

⚠️ **Potential Text Overflow**
- Very long track names may wrap to 3+ lines
- Could affect visual consistency across tracks
- **Mitigation**: Reasonable track name lengths expected in practice

### Neutral

- Text wrapping behavior depends on track strip width
- Font size increase may require future adjustment
- Overflow visible may affect adjacent UI elements (monitor if issues arise)

## Alternatives Considered

### A. Keep Abbreviation with Tooltip
- **Rejected**: Tooltips require hover, not suitable for touch interface

### B. Scrolling Text Marquee
- **Rejected**: Distracting animation, harder to read

### C. Fixed Height with Ellipsis
- **Rejected**: Defeats purpose of showing full track names

### D. Adjustable Text Size Setting
- **Rejected**: Over-engineering for current need, can add later if requested

### E. Keep Solo Button, Reduce Title Height
- **Rejected**: Solo rarely used in live looping workflow, title more important

### F. Inset Shadow for Selection Instead of Ring
- **Rejected**: Ring is more visible and conventional UI pattern

## Related Decisions

- **V6 UI Architecture**: Component-based track strip design
- **TrackStrip Component**: Parent container for track UI
- **Color Coding System**: Track color usage for visual feedback

## Follow-Up Tasks

- [x] Remove button styling from track header
- [x] Display full track names without abbreviation
- [x] Implement multi-line text wrapping
- [x] Remove quotation marks from display
- [x] Comment out solo button
- [x] Reduce container padding
- [x] Fix selection ring clipping with overflow-visible
- [x] Add vertical padding for ring spacing
- [ ] Monitor for any layout issues with overflow-visible
- [ ] Consider alternative solo control location if needed
- [ ] Evaluate text size on actual iPad display
- [ ] Add max-height constraint if excessive wrapping becomes issue

## References

- Component: `interface/src/lib/components/v6/tracks/TrackStrip/components/TrackHeader.svelte`
- Parent Component: `interface/src/lib/components/v6/tracks/TrackStrip.svelte`
- Layout: `interface/src/lib/components/v6/layout/TracksPanelV6.svelte`
- Page: `interface/src/routes/+page.svelte`
- Formatter: `interface/src/lib/utils/formatters/trackFormatters.ts`

---

**Decision made:** 2025-10-06
**Implemented:** 2025-10-06
**Phase:** V6 UI Refinement
