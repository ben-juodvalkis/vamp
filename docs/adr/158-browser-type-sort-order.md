# ADR-158: Browser Type Sort Order

## Status
Accepted

## Context
The browser sidebar displays instrument types (Drums, Bass, Keys, Synth, etc.) as buttons. Previously, types were sorted alphabetically, placing "Bass" at the top. For workflow reasons, "Drums" is the most frequently accessed type and should appear first.

## Decision
Implement a lightweight sort order system for types, following the existing pattern used for vendor sorting:

1. **Generator-side ordering**: Define `TYPE_SORT_ORDER` in `scripts/generate-type-first-json.ts` to control the order in the generated JSON
2. **Preserve order in UI**: Update `UnifiedGestureBrowser.v6.svelte` to use the order from `metadata.types` array rather than re-sorting alphabetically

### Sort Order Configuration
```typescript
// scripts/generate-type-first-json.ts
const TYPE_SORT_ORDER: Record<string, number> = {
    'Drums': 0,  // First
};
```

Types not in `TYPE_SORT_ORDER` default to priority 999 and sort alphabetically among themselves.

### Result
Sidebar order: **Drums**, Bass, FX, Inst, Keys, Synth (Drums pinned first, rest alphabetical)

## Alternatives Considered

### Runtime sorting in the browser
Could sort in `UnifiedGestureBrowser.v6.svelte` instead of at generation time. Rejected because:
- Sort order is a data concern, not a UI concern
- Generator already has the `VENDOR_SORT_ORDER` pattern to follow
- Keeps UI code simpler (just preserves existing order)

## Files Changed
- `scripts/generate-type-first-json.ts` - Added `TYPE_SORT_ORDER` constant and `getTypeSortOrder()` helper
- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` - Use `metadata.types` array order instead of re-sorting
