# ADR-336: Folder Display Abbreviations

## Status
**Accepted**

## Context
Omnisphere library folder names (e.g., "Electronic Production", "Experimental Organic", "XTRA - Bass Legends") are long and consume excessive space in browser buttons, especially in the `FolderNavigationColumn` single-column layout on iPad. Shorter labels improve readability and touch target clarity without changing the underlying data.

## Decision

### Display-only abbreviation map
Added a `folderAbbreviations` map to `constants.json` under `sortPriority`. This is a `Record<string, string>` mapping original folder names to shortened display labels. Original names are preserved in `data-folder-name` attributes and all navigation/color lookup logic.

A new `abbreviateFolder()` function in `vendorStateManager.ts` performs the lookup at render time, falling back to the original name if no abbreviation exists. It wraps `decodeHtmlEntities()` at all three render sites:

- `FolderNavigationColumn.svelte` — grouped folders (line 184) and simple folders (line 214)
- `VendorBrowserMode.svelte` — deeper subfolder columns (line 82)

### Abbreviations (24 entries)

| Original | Display |
|---|---|
| Ambient Dreams | Ambient |
| Analog Vibes | Analog |
| Classic Digital | Digital |
| Club Land | Club |
| Electronic Production | Production |
| Electronic Underground | Underground |
| Experimental Electronic | Exp Elec |
| Experimental Organic | Exp Org |
| Hard Edges | Hard |
| Instruments Collection | Inst |
| Keyscape Creative | KS Creative |
| Keyscape Library | KS Library |
| Live Keyboardist | Live Keys |
| Organic Vibes | Org Vibes |
| Retro Vibes | Retro |
| Scoring Electronic | Scoring Elec |
| Scoring Organic | Scoring Org |
| SFX Electronic | SFX Elec |
| SFX Organic | SFX Org |
| Trilian Creative | Tril Creative |
| Trilian Library | Tril Library |
| Trilogy Library | Trilogy Lib |
| Vocal Collection | Vocal |
| XTRA - Bass Legends | Bass Legends |

## Consequences
- Folder buttons display shorter, more readable labels on iPad
- Navigation, color lookups, and path traversal unaffected — original names preserved in data attributes
- New abbreviations can be added to `constants.json` without code changes
- The map applies globally to all folder displays, not just Omnisphere — any folder name matching an entry will be abbreviated

## Tags
`browser`, `ui`, `omnisphere`, `display`, `config`
