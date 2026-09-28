# ADR 126: Build Issues Cleanup

## Status
**Accepted** - 2025-11-23

## Context

The codebase had accumulated 55 TypeScript errors and 13+ Svelte warnings that needed to be addressed to maintain code quality and enable proper type checking. These issues had built up over time during rapid development and needed systematic cleanup.

### Categories of Issues

1. **TypeScript Errors (55 total)**
   - Theme store variable initialization (11 errors)
   - Vendor state manager null safety (8 errors)
   - UI component export issues (6 errors)
   - Session store null types (5 errors)
   - useTrackData read-only violations (6 errors)
   - Store type annotations (8 errors)
   - API and domain type mismatches (11 errors)

2. **Svelte Warnings (13+ total)**
   - Deprecated `<svelte:component>` usage
   - Missing ARIA attributes for accessibility
   - Self-closing HTML tags on non-void elements
   - Unused CSS selectors
   - Non-reactive state warnings (some false positives)

3. **Dead Code**
   - `ni.ts` and `omnisphere.ts` stores superseded by ADR 125's unified browser architecture

## Decision

Systematically fix all issues in priority order:

### High Priority (TypeScript Errors)
1. Fix theme store variable initialization using non-null assertions after synchronous subscribe
2. Add null guards to vendor state manager
3. Create separate TypeScript files for UI component exports (badge-variants.ts, button-variants.ts)
4. Add non-null assertions to session store after null checks
5. Make TrackState mutable using `-readonly` mapped type modifier
6. Add proper type annotations to stores
7. Fix API method names and domain types

### Medium Priority (Svelte Warnings)
1. Replace `<svelte:component this={X}>` with direct `<X>` syntax (Svelte 5 runes mode)
2. Add ARIA roles, tabindex, and aria-valuenow to slider components
3. Add keyboard event handlers alongside click handlers
4. Fix self-closing `<div />` to `<div></div>`
5. Remove unused CSS selectors

### Cleanup
1. Remove dead `ni.ts` and `omnisphere.ts` stores
2. Remove initialization calls from +page.svelte and cleanup from +layout.svelte
3. Fix orphaned event listener references

## Implementation

### TypeScript Fixes

**Theme Store Pattern:**
```typescript
// Before
let currentTheme = 'dark';
theme.subscribe(t => currentTheme = t)();
if (currentTheme === 'system') { ... }  // Error: used before assigned

// After
let currentTheme: Theme;
theme.subscribe(t => currentTheme = t)();
if (currentTheme! === 'system') { ... }  // Non-null assertion after sync subscribe
```

**Mutable Track State:**
```typescript
// Make LiveTrack properties mutable for state updates
type TrackState = {
    -readonly [K in keyof LiveTrack]: LiveTrack[K]
};
```

**UI Component Exports:**
Created separate `.ts` files for variant exports since Svelte 5 module-level exports from `.svelte` files aren't resolvable by TypeScript:
- `badge-variants.ts` - exports `badgeVariants`, `BadgeVariant`
- `button-variants.ts` - exports `buttonVariants`, `ButtonProps`, `ButtonSize`, `ButtonVariant`

### Svelte 5 Fixes

**Dynamic Components:**
```svelte
<!-- Before (deprecated) -->
<svelte:component this={ViewComponent} {...props} />

<!-- After (Svelte 5 runes mode) -->
<ViewComponent {...props} />
```

**Accessibility:**
```svelte
<!-- Added to slider controls -->
<div
    role="slider"
    tabindex={0}
    aria-label="Master volume"
    aria-valuemin={0}
    aria-valuemax={1}
    aria-valuenow={volume}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(e); }}
>
```

### Dead Code Removal

Removed files:
- `interface/src/lib/stores/ni.ts`
- `interface/src/lib/stores/omnisphere.ts`

These stores managed OSC connections to external preset servers but were superseded by ADR 125's static JSON file approach via `UnifiedAdapter`.

## Consequences

### Positive
- **0 TypeScript errors** - Full type checking now passes
- **Improved accessibility** - Slider components now keyboard-navigable with proper ARIA
- **Cleaner codebase** - Removed ~300 lines of dead code
- **Better Svelte 5 compliance** - Using modern patterns instead of deprecated syntax
- **Maintainability** - Easier to add new features without type errors accumulating

### Negative
- Some Svelte warnings remain as false positives (DOM refs don't need `$state()`)
- Non-null assertions add minor runtime risk (mitigated by synchronous patterns)

### Neutral
- Build output still shows some informational warnings (Vite dynamic imports)
- Additional a11y warnings in other components not in original scope

## Files Modified

### TypeScript Fixes
- `interface/src/lib/stores/theme.ts`
- `interface/src/lib/stores/session.svelte.ts`
- `interface/src/lib/components/v6/tracks/composables/useTrackData.svelte.ts`
- `interface/src/lib/components/v6/browser/utils/vendorStateManager.ts`
- `interface/src/lib/api/simpleClient.ts`
- `interface/src/lib/domain/updates.ts`
- `interface/src/lib/abletonosc/parsers.ts`
- `interface/src/lib/configs/UnifiedDeviceConfigs.ts`
- `interface/src/lib/utils/performance/memoize.ts`

### UI Component Exports
- `interface/src/lib/components/ui/badge/badge-variants.ts` (new)
- `interface/src/lib/components/ui/button/button-variants.ts` (new)
- `interface/src/lib/components/ui/badge/index.ts`
- `interface/src/lib/components/ui/button/index.ts`

### Svelte Fixes
- `interface/src/lib/components/v6/central/CentralDisplay.svelte`
- `interface/src/lib/components/v6/tracks/MasterTrack.svelte`
- `interface/src/lib/components/v6/clips/ClipLoopControlV6.svelte`
- `interface/src/lib/components/v6/tracks/TrackVolumeMeter.svelte`
- `interface/src/lib/components/v6/browser/VendorButtonGrid.svelte`

### Dead Code Removal
- `interface/src/lib/stores/ni.ts` (deleted)
- `interface/src/lib/stores/omnisphere.ts` (deleted)
- `interface/src/routes/+page.svelte`
- `interface/src/routes/+layout.svelte`

## Related

- ADR 125: Unified Preset Browser Architecture (supersedes NI/Omnisphere stores)
- `documentation/current/build-issues-report.md` - Full issue tracking
