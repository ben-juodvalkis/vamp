#ADR-078: Track Preparation Double Creation Fix

**Date:** 2024-10-24  
**Status:** Accepted  
**Deciders:** Development Team  

## Context

The gesture browser track preparation system was creating duplicate tracks when users followed this workflow:

1. Click vendor button (Ableton, Omnisphere, etc.) → **Track preparation runs**
2. Select preset from browser → **Track preparation runs AGAIN**

This resulted in two tracks being created instead of one, causing confusion and cluttering the session.

### Root Cause

Track preparation was running in multiple locations without coordination:

- **Vendor selection** (`UnifiedGestureBrowser.svelte:150, 226`): Immediate preparation when clicking vendor
- **Preset loading** (`UnifiedGestureBrowser.svelte:700, 784`): Re-preparation before each preset load

Both calls were necessary for different scenarios:
- Vendor preparation ensures track is ready for immediate preset loading
- Preset preparation ensures fresh tracks for additional preset loads

## Decision

Implement a **preparation flag system** to coordinate track preparation between vendor selection and preset loading:

### Flag Logic

```typescript
let trackPreparedForCurrentVendor = $state(false);
```

**Workflow:**
1. **Vendor Click:** Reset flag → Run preparation → Set flag `true`
2. **First Preset Load:** Check flag → Skip preparation → Set flag `false` 
3. **Additional Preset Loads:** Flag is `false` → Run normal preparation

### Implementation Details

**Flag Management:**
- Set `true` after successful vendor preparation
- Set `false` after first preset load (enables subsequent preparations)
- Reset on vendor switches and browser resets

**Key Locations Updated:**
- `trackPreparation.ts:77` - Added flag declaration
- `UnifiedGestureBrowser.svelte:154,232` - Set flag after vendor prep
- `UnifiedGestureBrowser.svelte:700,791` - Check flag before preset prep
- Reset logic in vendor switching and browser close functions

## Consequences

### Positive
- ✅ **Single track creation** for vendor → preset workflow
- ✅ **Normal behavior preserved** for additional preset loads
- ✅ **No breaking changes** to existing API
- ✅ **Maintains all safety checks** (cooldowns, locking, error handling)

### Negative
- ➕ **Additional state complexity** (one boolean flag)
- ➕ **Flag coordination required** across multiple functions

### Behavior Changes

| Scenario | Before | After |
|----------|--------|-------|
| Click vendor → Load preset | 2 tracks | 1 track ✅ |
| Load additional presets | 1 track each | 1 track each ✅ |
| Switch vendors | Normal | Normal ✅ |
| Replace mode | Skip prep | Skip prep ✅ |

## Implementation

### Core Flag Logic
```typescript
// Vendor selection
trackPreparedForCurrentVendor = false; // Reset
prepareTrack(vendor.trackType)
  .then(() => trackPreparedForCurrentVendor = true); // Set flag

// Preset loading
if (trackPreparedForCurrentVendor) {
  console.log('Track already prepared - skipping preparation');
  trackPreparedForCurrentVendor = false; // Enable next prep
} else {
  await prepareTrack(vendor.trackType); // Normal prep
}
```

### Reset Conditions
- Vendor switching (`handleMove` vendor change)
- Browser close (`closeAndReset`)
- Browser state reset

## Alternatives Considered

1. **Remove vendor preparation entirely**
   - ❌ Would slow down first preset load
   - ❌ Breaks immediate readiness expectation

2. **Remove preset preparation entirely** 
   - ❌ Would prevent new track creation for additional presets
   - ❌ Core workflow requirement

3. **Debounce/timing solutions**
   - ❌ Unreliable due to variable user interaction timing
   - ❌ Could miss legitimate preparation needs

4. **Track state checking before preparation**
   - ❌ Already implemented but insufficient for this race condition
   - ❌ Doesn't address the double-call issue

## Notes

- Flag approach is simple and deterministic
- Preserves all existing error handling and safety mechanisms  
- Minimal impact on codebase complexity
- Easily reversible if issues arise

## Related

- **ADR-061:** Track Preparation Global Lock (locking mechanism)
- **ADR-044:** Revert Track Pool to On-Demand Creation (current architecture)
- **Track preparation service:** `interface/src/lib/services/trackPreparation.ts`
- **Browser implementation:** `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.svelte`