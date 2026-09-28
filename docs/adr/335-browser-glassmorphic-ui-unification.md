# ADR-335: Browser Glassmorphic UI Unification

## Status
**Accepted**

## Context
ADR-334 made the vendor sidebar (`VendorButtonGrid`) always visible with a glass material style: solid card background, subtle gradient sheen overlay (`::before`), consistent shadows, rounded corners, and hover elevation. The rest of the browser — folder navigation buttons, preset cards, scale cards, and container borders — used a mix of flat backgrounds, semi-transparent `color-mix` with `backdrop-filter: blur()`, and inconsistent shadow/radius/transition values. This created a visual disconnect between the always-visible sidebar and the expanded browser content.

Additionally, `UnifiedGestureBrowser.v6.svelte` hardcoded hex color values (`#1a1a1a`, `#e5e5ec`, etc.) for `--browser-bg-*` variables, overriding the theme-aware definitions in `app.css` that correctly map to `var(--background)`, `var(--card)`, etc.

## Decision

### 1. Remove hardcoded theme overrides
Deleted the `:global(.dark)` and `:global(.light)` blocks in `UnifiedGestureBrowser.v6.svelte` that hardcoded browser color variables. The correct theme-aware mappings in `app.css` now flow through to all browser components.

### 2. Glass material pattern (no backdrop-filter)
Since the browser is a full-screen overlay with nothing visible behind it, `backdrop-filter: blur()` was purely decorative overhead. Removed all `backdrop-filter` from browser components and replaced with the VendorButtonGrid's glass material pattern:

- **Solid background**: `var(--browser-bg-secondary)` instead of semi-transparent `color-mix`
- **Gradient sheen** (`::before`): `linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)` for depth
- **Consistent shadow**: `0 2px 4px -1px rgba(0, 0, 0, 0.2)` base, `0 4px 12px -2px` on hover
- **Design token radius**: `var(--radius-md)` (8px) replacing hardcoded `4px`/`8px`
- **Consistent transition**: `cubic-bezier(0.4, 0, 0.2, 1)` replacing `ease`
- **Hover elevation**: `translateY(-1px)` with shadow lift

### 3. Container border refinement
Container borders (expanded-area, col-0, folder columns) updated to semi-transparent glass-style borders using `color-mix(in srgb, var(--browser-border), transparent 40%)`.

### 4. Browse mode spacing
Added `padding-left: var(--spacing-md)` (12px) to `.expanded-area` in browse mode, creating breathing room between the vendor sidebar and the first subfolder column.

## Components Changed

| Component | Changes |
|-----------|---------|
| `UnifiedGestureBrowser.v6.svelte` | Removed hardcoded theme overrides, added glass borders/shadow to containers, added browse-mode left padding |
| `FolderNavigationColumn.svelte` | Solid bg, gradient sheen, shadow, `var(--radius-md)`, hover elevation, removed `backdrop-filter` |
| `PresetGrid.svelte` | Solid bg, gradient sheen, aligned shadows/transitions, removed `backdrop-filter` |
| `VendorBrowserMode.svelte` | Solid bg, gradient sheen, shadow, `var(--radius-md)`, hover elevation for subfolder buttons |
| `ScaleGrid.svelte` | Solid bg, gradient sheen, aligned shadows/transitions, removed `backdrop-filter` |
| `VendorButtonGrid.svelte` | No changes (reference implementation) |

## Consequences

**Positive:**
- All browser surfaces now share the same glass material language as VendorButtonGrid
- Removing `backdrop-filter` from 4 components reduces GPU compositing overhead on iPad
- Browser colors now inherit from the theme system instead of hardcoded hex values
- Design tokens (`--radius-md`, `--spacing-md`, cubic-bezier) used consistently

**Negative:**
- Loss of the semi-transparent see-through effect on folder buttons (was barely visible anyway since the background behind was opaque)

## Tags
`browser`, `ui`, `glassmorphic`, `design-system`, `performance`
