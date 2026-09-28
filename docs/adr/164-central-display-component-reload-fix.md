# ADR-164: Central Display Component Reload Fix

## Status
Accepted

## Context

When interacting with XY pad controls (Echo, AutoFilter, etc.), the central view's filter curve would disappear momentarily during drag operations. This created a jarring visual experience where the curve would flicker or vanish entirely while the user's finger was on the control.

### Root Cause

The issue stemmed from how `CentralDisplay.svelte` handled view updates:

1. Device controls call `centralDisplayStore.setView('device', 'delay', { device, color })` on every interaction event (not just on touch start)
2. The `$effect` in CentralDisplay depended on the entire `view` object
3. Each `setView` call replaced the view object, triggering the effect
4. The effect reset `ViewComponent = null` before reloading, causing the component to unmount
5. The component would then remount after the async load completed

```typescript
// Before: Effect ran on ANY view change
$effect(() => {
  isLoadingComponent = true;
  ViewComponent = null;  // Component unmounts here!

  const componentLoader = resolveViewComponent(view.type, view.subType);
  // ... async load
});
```

This meant that during a drag gesture with rapid `setView` calls, the central view component was being destroyed and recreated on every frame.

## Decision

Modify `CentralDisplay.svelte` to only reload the component when `view.type` or `view.subType` changes, not when `view.data` changes.

### Implementation

1. Extract `viewType` and `viewSubType` as separate derived values
2. Make the `$effect` depend only on these values, not the full `view` object
3. `viewProps` continues to be reactive to `view.data` changes, so components receive updated props without being recreated

```typescript
// After: Effect only runs when type/subType changes
let viewType = $derived(view.type);
let viewSubType = $derived(view.subType);

$effect(() => {
  const type = viewType;
  const subType = viewSubType;

  isLoadingComponent = true;
  ViewComponent = null;

  const componentLoader = resolveViewComponent(type, subType);
  // ... async load
});
```

## Consequences

### Positive
- Filter curves and other visualizations remain visible during XY pad interactions
- Smoother user experience with no flickering
- Reduced CPU usage from unnecessary component destruction/creation cycles
- Fix applies globally to all central views, preventing similar issues

### Neutral
- Components must handle prop updates reactively (standard Svelte 5 behavior with `$props()`)
- The `{#key}` block still ensures component recreation when type/subType actually changes

### Negative
- None identified. Components that need to react to data changes can do so via reactive props or effects.

## Files Changed
- `interface/src/lib/components/v6/central/CentralDisplay.svelte`
