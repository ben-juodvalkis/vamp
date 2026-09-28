# ADR-337: Unify Folder Navigation Columns

## Status
**Accepted**

## Context
The browser's folder navigation was split across two components. `FolderNavigationColumn` rendered the first-level folder column with full interactivity (tap/hold handlers, hover detection), while `VendorBrowserMode` rendered deeper columns (depth 2+) with completely duplicated button markup, ~130 lines of duplicated CSS, and no event handlers — making sub-subfolder buttons inert and un-tappable.

This split originated from an earlier architecture where first-level folders lived in a sidebar and deeper levels were handled separately. That distinction no longer exists, but the code duplication remained.

Adding a new "dim non-selected folders" feature made the duplication worse, requiring the same logic in both components.

## Decision
Consolidate all folder column rendering into `FolderNavigationColumn` by adding a `depth` prop:

- **`FolderNavigationColumn`** gained a `depth` prop (default `0`) that parameterizes selection checks (`currentPath[depth]`), hover column mapping (`depth + 1`), dimming logic, and callback depth arguments.
- **`UnifiedGestureBrowser`** now loops over all columns and renders a `FolderNavigationColumn` for each depth, with the single-folder-skip logic preserved from VendorBrowserMode.
- **`VendorBrowserMode`** was reduced from ~240 lines to ~60, retaining only the `PresetGrid` rendering and the `presetVendorColor` derivation.

## Consequences
**Positive:**
- Eliminated ~180 lines of duplicated markup and CSS
- Deeper folder columns now have tap and hold interactivity (previously a bug — buttons were inert)
- Dimming behavior works consistently at all navigation depths
- Single place to modify folder button styling and behavior

**Negative:**
- `FolderNavigationColumn` is slightly more complex with the `depth` prop, but the parameterization is straightforward

## Tags
`browser`, `refactor`, `folder-navigation`, `deduplication`
