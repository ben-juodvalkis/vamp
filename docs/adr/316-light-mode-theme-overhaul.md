# ADR-316: Light Mode Theme Overhaul

**Status**: Accepted
**Date**: 2026-02-13

## Context

The application was developed primarily in dark mode. Light mode had accumulated numerous visual issues:

1. **Warm beige palette**: The `.light` CSS variables used OKLCH hue 55-65 (warm cream/beige), which clashed with the dark mode's cool blue-slate family (hue ~265)
2. **Hardcoded dark-only colors**: ~38 component files used colors like `text-slate-300`, `text-cyan-300`, `bg-*-900/30`, and inline `color: white` that were invisible or jarring in light mode
3. **Browser preset tiles**: `color-mix(in srgb, var(--browser-bg-secondary), black 60%)` produced near-black tiles regardless of theme
4. **EQ curve**: Hardcoded `#00bcd4` cyan with glow effects was barely visible on white backgrounds

## Decision

### Phase 1: Clean neutral white palette

Replace the warm beige `.light` CSS variables with a clean neutral white palette using hue 265 (matching the dark mode's blue-slate family but at high lightness):

- `--background: oklch(0.985 0.002 265)` (near-white)
- `--foreground: oklch(0.145 0.04 265)` (near-black)
- `--card: oklch(0.97 0.003 265)` (slightly off-white)
- All other variables shifted to hue 265

### Phase 2: Component-level fixes

Used three patterns to fix hardcoded colors:

1. **Theme-aware CSS classes**: Replace `text-slate-300` with `text-muted-foreground` (design token)
2. **Dark/light variant pairs**: Replace `text-cyan-300` with `dark:text-cyan-300 light:text-cyan-700` (keeps color identity, adjusts lightness for contrast)
3. **CSS custom properties with `:global(.light)` overrides**: For complex components like FilterCurve, PresetGrid, and VerticalQuantizeControl where inline styles or SVG attributes need theme-awareness

### Phase 3: Component-specific overrides

- **PresetGrid**: Light mode uses `var(--browser-bg-secondary)` directly instead of mixing with black
- **FilterCurve**: CSS custom properties (`--curve-color`, `--curve-glow`) with darker values in light mode (`#0891b2` vs `#00bcd4`)
- **DeviceSlider**: Handle color moved from inline `background-color: white` to CSS class with light mode override using `var(--foreground)`
- **MeterVisualization**: Replaced hardcoded hex colors with `var(--card)` and `var(--border)`

## Consequences

### Positive
- Light mode is now visually clean and professional
- Dark mode is completely unchanged (all fixes use `light:` or `:global(.light)` scoping)
- Color identity is preserved (cyan buttons stay cyan, orange stays orange) with appropriate lightness adjustments
- Uses existing Tailwind 4 `@custom-variant` infrastructure (`light:`, `dark:`)

### Negative
- Some button class strings are now verbose with dual `dark:`/`light:` prefixes
- 38 files modified — broad surface area for potential regressions (mitigated by build verification)

## Files Modified

38 files across: `app.css`, 25 central views, 5 device-panel components, 3 browser components, 2 clip controls, 2 track components, 1 debug component
