# ADR-334: Browser Sidebar Layout and Omnisphere Library Ordering

## Status
**Accepted**

## Context
The browser's left sidebar (`col-0`) previously changed its content when the browser opened: it hid most vendor buttons and replaced the space with first-level subfolder navigation. This made the sidebar feel inconsistent and reduced the touch target area for vendor buttons on iPad.

Separately, Omnisphere library folders (Ambient Dreams, Warm Tones, etc.) sorted alphabetically within each category, with no way to control their display order. A curated ordering groups libraries by character (ambient/organic, analog/retro, electronic/club, scoring/SFX, instruments/collections).

## Decision

### 1. Always-visible vendor buttons
The left sidebar now always shows all vendor buttons in their 3-group layout, regardless of browser state. The `FolderNavigationColumn` (first-level subfolders) moved from `col-0` into the `expanded-area`, appearing as the first column before deeper folder columns.

- `VendorButtonGrid` simplified: removed all conditional `class:hidden` logic, collapsed/expanded CSS variants, and the scale close button
- Removed `preventDefault()` from vendor touch handlers — Svelte 5 registers touch handlers as passive, so scroll prevention is handled by `GestureModeController`'s non-passive window listener
- Updated gesture mode vendor index offset (idx - 3 instead of idx - 1) to account for all Group 1 buttons (Recent, Record, Audio) now always being visible
- `FolderNavigationColumn` restyled as a fixed-width column (130px single-column, 260px two-column) matching `VendorBrowserMode`'s deeper columns
- No column index changes needed: `data-column` values are logical, and `BrowseModeController` already skips `data-nav-column` elements

### 2. Consistent column widths and two-column threshold
All folder columns now use consistent narrow widths (130px single / 260px two-column). The `TWO_COLUMN_THRESHOLD` was extracted from both `FolderNavigationColumn` and `VendorBrowserMode` into `constants.json` at `ui.browser.twoColumnThreshold`.

### 3. Omnisphere library sort order
Added `sortPriority.omniLibraryOrder` to `constants.json` with a curated list of 27 library names. The `sortFolderKeys()` function in `generate-type-first-json.ts` detects all-Omni folder groups (by vendorColor match) and applies this order between `pinnedFirst` and alphabetical fallback. Libraries not in the list sort alphabetically after ordered ones.

Also added "Acoustic" to `pinnedFirst` (before "Electric") so it appears first in any folder list.

## Consequences
- Vendor buttons are always accessible, improving iPad touch navigation
- Folder navigation columns are visually consistent at all depths
- Omnisphere libraries appear in a musically meaningful order
- Sort order and two-column threshold are config-driven via `constants.json`
- JSON files must be regenerated after changing `omniLibraryOrder` or `pinnedFirst`
- Omni detection relies on `VENDOR_COLOR_MAP['Omni']` color string equality — changing the Omni color requires regenerating JSON

## Tags
`browser`, `sidebar`, `omnisphere`, `sorting`, `ui-layout`, `ipad`
