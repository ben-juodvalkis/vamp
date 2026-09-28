# ADR-340: Browser Cross-Folder Preset Deduplication

## Status
**Accepted**

## Context
Some presets are copied into multiple folders within the same vendor or type hierarchy (e.g., the same patch appears in both "Analog" and "Synth Bass" subfolders). When browsing at a parent level with `includeNested=true`, all presets from all subfolders are collected and displayed. This caused duplicate entries in the preset grid — the same patch name appearing multiple times, creating visual clutter and making browsing harder.

## Decision
Deduplicate presets by name at the adapter level when aggregating across multiple folders (`includeNested=true`). The first occurrence of each name is kept, and later duplicates are filtered out.

When the user drills into a specific subfolder (`includeNested=false`), no deduplication is applied — all presets belonging to that folder are shown. This means duplicates "come back" naturally at the leaf level, which is correct behavior since the user chose that specific folder.

The deduplication logic (`deduplicatePresetsByName`) and the recursive collection helper (`collectPresetsRecursive`) were extracted into a shared `adapterUtils.ts` module used by both `TypeFirstAdapter` and `UnifiedAdapter`.

### Key design choices:
- **Name-based dedup**: Uses `preset.name` as the dedup key (not `path` or `fullPath`), since patches with the same display name in different folders are the duplicates we want to collapse
- **First-wins**: Keeps the first occurrence encountered during recursive tree traversal
- **Adapter-level**: Applied in `getPresets()` rather than in the UI layer, keeping the grid component simple

## Consequences
- **Positive**: Cleaner preset grids at parent/aggregated levels with no visual duplicates
- **Positive**: DRY — shared logic in `adapterUtils.ts` eliminates duplication between adapters
- **Positive**: Drilling into a subfolder still shows all its presets, so nothing is lost
- **Negative**: If two genuinely different presets share the same name but live in different folders, only one will appear at the parent level (user can still find both by drilling into the specific subfolders)

## Tags
`browser`, `presets`, `deduplication`, `adapters`
