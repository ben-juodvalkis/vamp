# ADR 124: Omnisphere Split by Type

## Status

Accepted

## Date

2025-11-20

## Context

The Omnisphere preset browser was experiencing crashes and performance issues when loading the monolithic `omnisphere.json` file (21MB, ~32,597 presets). This large file was:

1. Causing browser memory crashes on iPad
2. Creating long initial load times when selecting Omnisphere
3. Loading all preset data even when user only needed one instrument type

The Omnisphere folder structure is already organized by top-level type folders:
- ARP + BPM (4,240 presets)
- Bass (2,502 presets)
- Drums (2,242 presets)
- FX (7,480 presets)
- Inst (4,384 presets)
- Keys (2,004 presets)
- Synth (9,745 presets)

## Decision

Split the monolithic `omnisphere.json` into separate files per top-level type folder, loaded on-demand when the user navigates to that type.

### File Structure

```
/static/data/
├── omnisphere-index.json     (2 KB)   - Metadata + type list only
├── omnisphere-keys.json      (1.2 MB) - Keys presets
├── omnisphere-bass.json      (1.6 MB) - Bass presets
├── omnisphere-drums.json     (1.2 MB) - Drums presets
├── omnisphere-inst.json      (2.9 MB) - Instruments presets
├── omnisphere-fx.json        (4.9 MB) - FX presets
├── omnisphere-synth.json     (6.0 MB) - Synth presets
└── omnisphere-arp-bpm.json   (2.5 MB) - ARP + BPM presets
```

### Loading Strategy

1. **Initial load**: Only `omnisphere-index.json` (2KB) is loaded
2. **Level 0 (Type selection)**: Shows 7 type folders from index - no large JSON loaded yet
3. **Level 1+ (Navigation into type)**: Loads the corresponding type file (1-6MB)
4. **Cache management**: Type files are cached per-session, cleared when browser closes

### Implementation

1. **Generator script** (`generate-instruments-json.ts`):
   - Added `writeOmnisphereSplitFiles()` function
   - Creates index file with type metadata
   - Creates individual type files with tree and presets

2. **OmnisphereAdapter** (`omnisphereAdapter.ts`):
   - Loads `omnisphere-index.json` on initialization
   - `loadTypeFile()` loads type-specific files on-demand
   - Direct tree navigation for split files (simpler than typeIndex-based navigation)

3. **Adapter Registry** (`adapters/index.ts`):
   - `getAdapter('omnisphere')` returns `OmnisphereAdapter` (not `UnifiedAdapter`)
   - This is critical: `UnifiedAdapter` doesn't support split files

## Consequences

### Positive

- **Initial load reduced from 21MB to 2KB** (99.99% reduction)
- **Per-type load is manageable** (1-6MB per type)
- **Only loads what user actually browses**
- **Eliminates browser crashes** from full file load

### Negative

- **Multiple network requests** instead of one (but smaller, on-demand)
- **Slightly more complex adapter logic** for handling split files
- **Type files still include full preset data** - further splitting would require server-side queries

### Neutral

- **Navigation changes**: Split files use direct tree navigation instead of typeIndex-based category-first navigation. This is actually simpler and matches the folder structure.

## Alternatives Considered

1. **Server-side database with API queries**: Rejected - would require significant infrastructure changes and add latency
2. **Pagination/infinite scroll**: Rejected - folder navigation already provides natural chunking
3. **Progressive loading (names only, then full data)**: Noted as future enhancement if needed

## Related

- ADR 100: Browser Memory Optimization - Split Vendor Files
- ADR 120: Browser Memory Leak Fix - JSON Columns
