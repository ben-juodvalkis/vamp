# ADR-338: Browser Scroll Performance Optimization

## Status
**Accepted**

## Context
The browser (preset grid, scale grid, folder navigation) suffered from slow, choppy, laggy scrolling — especially noticeable on iPad Safari. Profiling identified several compounding causes:

1. **`transition: all`** on every card and button forced the browser to calculate transition states for all CSS properties during scroll, even properties that never change.
2. **`container-type: size`** on every preset card created a container query context per card, forcing the browser to re-evaluate container queries during layout. With 50+ cards visible this was expensive.
3. **No CSS containment** on scroll containers, so the browser couldn't skip unnecessary layout/paint work during scroll.
4. **Unthrottled gesture move handlers** fired on every touch/mouse event, each performing DOM queries (`elementFromPoint`, `getAttribute`) and store updates — often 3-4x per frame.
5. **Debug `$effect`** in FolderNavigationColumn called `getBoundingClientRect()` on multiple elements via `setTimeout` on every folder change, causing layout thrashing.
6. **Undebounced `bind:clientWidth/Height`** in PresetGrid triggered an expensive column layout scoring algorithm on every pixel of resize.

## Decision

### CSS optimizations (PresetGrid, ScaleGrid, FolderNavigationColumn)
- Replace `transition: all` with explicit property list: `transform, box-shadow, background-color, border-color`. This prevents the browser from animating irrelevant properties during scroll repaints.
- Add `contain: layout style paint` and `will-change: scroll-position` to scrollable grid containers to enable compositor-thread scrolling and skip unnecessary paint calculations.
- Remove `container-type: size` from preset cards. Replace the five `@container` queries with a single `clamp()` font-size driven by a `--columns` CSS custom property already available from the JS column count. This eliminates per-card container query evaluation entirely.

### JavaScript optimizations (GestureModeController, PresetGrid, FolderNavigationColumn)
- RAF-gate the gesture `handleMove` handler: queue the latest event and process at most once per `requestAnimationFrame`. Intermediate events are dropped. `preventDefault()` still fires synchronously to suppress native scroll during drag gestures.
- Debounce `bind:clientWidth/Height` values feeding the `columnLayout` `$derived` computation (150ms). The raw bind values update immediately but the expensive scoring loop only re-runs after resize settles.
- Remove the debug `$effect` and `logHeightDebug()` function (~40 lines) that ran `getBoundingClientRect()` on mount and every folder change. This was development scaffolding that caused layout thrashing in production.

## Consequences

**Positive:**
- Significantly smoother scrolling in preset and scale grids, especially on iPad Safari
- Reduced paint and layout work during scroll (CSS containment, no container queries)
- Gesture drag interactions process at screen refresh rate instead of input event rate
- Resize-triggered recomputation is batched, preventing jank during window/orientation changes
- Removed dead debug code that served no production purpose

**Negative:**
- Font sizing in preset cards is now a continuous `clamp()` scale rather than discrete breakpoints. The visual result is similar but not pixel-identical to the container query approach.
- 150ms debounce on grid dimensions means column layout may briefly show the previous layout during fast resizes. This is imperceptible in practice since the grid content also takes time to reflow.

## Tags
`performance`, `scrolling`, `css`, `browser`, `ipad`, `containment`, `raf`, `debounce`
