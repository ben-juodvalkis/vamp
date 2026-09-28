# ADR-118: Recent Instruments Browser

**Status:** Accepted
**Date:** 2025-11-17
**Context:** #169 Recent instruments tracking and quick access

## Context

Users frequently reload the same instruments during a live looping session but must navigate through the full vendor browser hierarchy each time. This workflow inefficiency breaks creative flow and increases cognitive load during performance.

### Problems Identified
- **Repetitive navigation** - Users must traverse 3-4 levels (vendor → library → category → preset) to reload familiar instruments
- **Context switching** - Remembering which vendor/library contains a previously used instrument
- **Performance friction** - No quick access to frequently used instruments
- **Lost momentum** - Time spent navigating detracts from creative flow

## Decision

Implement a **Recent Instruments** browser vendor that automatically tracks and provides quick access to recently loaded instruments.

### Architecture

**1. Recent Instruments Store (`recentInstrumentsStore.svelte.ts`)**
```typescript
interface RecentInstrument {
  name: string;
  fullPath: string;
  vendorId: string;
  library?: string;
  timestamp: number;
}

class RecentInstrumentsStore {
  private _items = $state<RecentInstrument[]>([]);

  addInstrument(preset: Preset, vendorId: string) {
    // Deduplicate by path (moves to front if exists)
    // Limit to 20 items
    // Persist to localStorage
  }
}
```

**2. Recent Instruments Adapter (`recentInstrumentsAdapter.ts`)**
- Implements standard `BrowserAdapter` interface
- Serves recent instruments as flat preset list
- Supports random selection for gesture mode
- No hierarchical navigation (single level)

**3. Integration Points**
- **Automatic Tracking**: Modified `loadPresetWithVariant()` in `presetLoader.ts` to track all instrument loads
- **Browser UI**: "Recent" vendor button appears at bottom of sidebar when items exist
- **Color Coding**: Purple (#9d4edd) for easy visual identification
- **Track Preparation**: Uses standard instrument track preparation

### Implementation Details

**Tracking Logic**
```typescript
// presetLoader.ts
export async function loadPresetWithVariant(preset: Preset, vendorId?: string) {
  // ... load preset logic ...

  // Track in recent instruments (excludes audio clips)
  if (vendorId && vendorId !== 'audio-clips' && vendorId !== 'recent-instruments') {
    recentInstrumentsStore.addInstrument(preset, vendorId);
  }
}
```

**Browser Integration**
```typescript
// UnifiedGestureBrowser.v6.svelte
const recentVendor = {
  id: 'recent',
  name: 'Recent',
  color: '#9d4edd',
  vendorId: 'recent-instruments',
  trackType: 'instrument'
};

const vendors = $derived.by(() => {
  const list = [...baseVendors];
  // Add recent at the bottom if there are recent instruments
  if (recentInstrumentsStore.hasItems) {
    list.push(recentVendor);
  }
  return list;
});
```

**Storage Strategy**
- **localStorage** for cross-session persistence
- **Deduplication** - Same preset moved to front when reselected
- **Limit of 20 items** - Keeps list manageable and relevant
- **Most recent first** - Chronological ordering

## Consequences

### Positive
✅ **Faster workflow** - One-tap access to recently used instruments
✅ **Reduced cognitive load** - No need to remember vendor/library locations
✅ **Maintains context** - Session history preserved across browser reloads
✅ **Non-intrusive** - Only appears when items exist
✅ **Consistent UX** - Uses same browser interface as other vendors
✅ **Automatic** - Zero configuration, tracks usage transparently

### Neutral
⚙️ **localStorage dependency** - Requires browser localStorage support (standard in all modern browsers)
⚙️ **Client-side only** - Recent list not synced across devices (acceptable for live performance use case)
⚙️ **No manual management** - Users cannot pin, remove, or reorder items (keeps interface simple)

### Negative
⚠️ **Privacy consideration** - Recent history stored in browser (can be cleared via browser settings)
⚠️ **No search** - Large recent lists may still require scrolling (mitigated by 20-item limit)

## Alternatives Considered

### 1. Favorites/Bookmarks System
**Pros:** User control, persistent across sessions, can organize by category
**Cons:** Requires manual curation, adds UI complexity, interrupts flow
**Rejected:** Auto-tracking provides better UX with zero user effort

### 2. Server-Side History
**Pros:** Cross-device sync, analytics potential
**Cons:** Requires backend, network dependency, privacy concerns
**Rejected:** Overkill for live performance tool, localStorage sufficient

### 3. MRU (Most Recently Used) vs Frequency-Based
**Pros (Frequency):** Surfaces truly "favorite" instruments
**Cons (Frequency):** Doesn't reflect current session context
**Chosen (MRU):** Better for live performance where recent context matters most

## Implementation Notes

**Files Modified:**
- `interface/src/lib/stores/v6/recentInstrumentsStore.svelte.ts` (new)
- `interface/src/lib/services/adapters/recentInstrumentsAdapter.ts` (new)
- `interface/src/lib/components/v6/browser/utils/presetLoader.ts` (tracking hook)
- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` (UI integration)

**Future Enhancements:**
- Manual clear button in browser settings
- Configurable limit (10/20/50 items)
- Export/import recent list
- Category filtering within recent view
