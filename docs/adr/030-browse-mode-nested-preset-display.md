# ADR 013: Browse Mode Nested Preset Display

**Date:** 2025-10-06
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Browser, Browse Mode

---

## Context

After implementing the dual-mode browser architecture (ADR 012), browse mode had a usability issue: presets only appeared when navigating to leaf folders with no subfolders. This created a poor exploration experience where users had to drill down multiple levels before seeing any presets.

### The Problem

**Current Behavior (Post-ADR 012):**
```
Click "Ableton" → Shows folders: ["Bass", "Drums", "Leads"]
Click "Bass" → Shows folders: ["Acoustic", "Electric", "Synth"], Presets: []
Click "Acoustic" → Shows folders: [], Presets: [50 presets]
```

Users must navigate 3 levels deep before seeing any presets.

**Desired Behavior:**
```
Click "Ableton" → Shows folders + ALL presets from all subfolders
Click "Bass" → Shows ["Acoustic", "Electric", "Synth"] + ALL Bass presets (150 total)
Click "Acoustic" → Shows [] + Acoustic Bass presets (50)
```

Presets appear immediately at every navigation level.

### Why This Matters

**Browse mode is for exploration** - users want to:
- See what's available without deep navigation
- Discover presets they didn't know existed
- Compare presets across subfolders
- Avoid clicking through empty intermediate folders

**Gesture mode is for speed** - showing only current-level presets is fine because:
- Users drag quickly through hierarchy
- Random selection works on any folder
- Focus is on speed, not discovery

---

## Decision

Add `includeNested` parameter to adapter interface to control whether presets from subfolders are included:

- **Gesture Mode:** `includeNested = false` (current level only)
- **Browse Mode:** `includeNested = true` (all nested presets)

---

## Implementation

### 1. Adapter Interface Update

**File:** `browserAdapter.ts`

```typescript
getPresets(
  vendorId: string,
  path: string[],
  limit?: number,           // Default: 200
  includeNested?: boolean   // Default: false
): Promise<Preset[]>;
```

### 2. UnifiedAdapter Implementation

**File:** `unifiedAdapter.ts`

```typescript
async getPresets(vendorId: string, path: string[], limit: number = 200, includeNested: boolean = false): Promise<Preset[]> {
  const node = await this.getNodeAtPath(vendorId, path);
  if (!node) return [];

  if (includeNested) {
    // Return all presets from this node and all children
    const allPresets: Preset[] = [];
    this.collectPresetsRecursive(node, allPresets);
    return limit === Infinity ? allPresets : allPresets.slice(0, limit);
  } else {
    // Only return presets from THIS node (not children)
    return limit === Infinity ? node.presets : node.presets.slice(0, limit);
  }
}
```

**Leverages existing recursive helper:**
- `collectPresetsRecursive()` already exists (used for random selection)
- No new traversal logic needed
- Just applies limit after collection

### 3. OmnisphereAdapter Implementation

**File:** `omnisphereAdapter.ts`

```typescript
async getPresets(vendorId: string, path: string[], limit: number = 200, includeNested: boolean = false): Promise<Preset[]> {
  if (vendorId !== 'omnisphere') {
    return super.getPresets(vendorId, path, limit, includeNested);
  }

  // OSC queries already return nested results
  // includeNested doesn't apply (always includes nested for Omnisphere)
  // ...existing logic
}
```

**Note:** Omnisphere OSC queries inherently return nested results, so the flag doesn't change behavior.

### 4. GestureBrowser Usage

**File:** `GestureBrowser.svelte`

```typescript
async function loadNextColumn() {
  // Mode-specific limit and nesting
  const limit = isPersistent ? 500 : 200;
  const includeNested = isPersistent; // Browse mode shows all nested presets

  const folders = await adapter.getFolders(selectedVendor, currentPath);
  const presets = await adapter.getPresets(selectedVendor, currentPath, limit, includeNested);

  columns = columns.slice(0, currentPath.length);
  columns.push({ folders, presets });
}
```

---

## Consequences

### Positive

1. **Better Browse Mode UX**
   - Presets visible immediately at vendor root
   - No need to drill down to leaf folders
   - More presets visible earlier in navigation
   - True exploration experience

2. **Leverages Existing Code**
   - Uses `collectPresetsRecursive()` already in codebase
   - No new traversal algorithms
   - Minimal code change (~15 lines total)

3. **Mode-Appropriate Behavior**
   - Gesture mode: Fast, current-level only (unchanged)
   - Browse mode: Exploratory, shows everything available
   - Each mode optimized for its use case

4. **Works Well with 500 Limit**
   - Nested collection respects limit
   - Won't overwhelm with too many presets
   - Natural filtering as you drill down

### Negative

1. **Potential Preset Overload**
   - Root vendor level might show 500 presets immediately
   - Could be overwhelming without search/filter
   - Mitigated by: Still showing folder structure for navigation

2. **Duplicate Prevention Needed**
   - Recursive collection might include same preset multiple times
   - Already handled by tree structure (each preset in one location)
   - No actual issue in practice

3. **Performance Consideration**
   - Recursive traversal takes time (minimal for in-memory tree)
   - 500 preset grid renders slower than 50 presets
   - Acceptable trade-off for browse mode use case

### Neutral

1. **Folder Navigation Still Useful**
   - Even though all presets visible, folders help filter
   - Clicking folder narrows down to that category
   - Preset grid updates to show only that subset

2. **Omnisphere Unchanged**
   - Already returns nested results via OSC
   - `includeNested` flag has no effect
   - Consistent behavior maintained

---

## Alternatives Considered

### Option A: Flat List at Root Level
**Idea:** Show ALL vendor presets in a single flat list at root

**Rejected Because:**
- Loses hierarchical context
- Search/filter becomes mandatory
- Too many presets at once (thousands)
- Folders become useless decoration

### Option B: Show Only Direct Children (1 Level Deep)
**Idea:** Include child presets but not grandchildren

**Rejected Because:**
- Still requires multiple clicks to see deep presets
- Arbitrary depth limit feels inconsistent
- More complex logic than "all or nothing"

### Option C: Virtual Folders (Flatten Hierarchy)
**Idea:** Show "Bass > Acoustic" as virtual combined folders

**Rejected Because:**
- Breaks tree navigation model
- Complex to implement
- Doesn't match user mental model
- Harder to understand

### Option D: Configurable Nesting Depth
**Idea:** Let user set how many levels to include

**Rejected Because:**
- Adds UI complexity (settings)
- Most users won't configure
- Simple on/off (mode-based) is sufficient

---

## Technical Details

### Recursive Collection Algorithm

```typescript
private collectPresetsRecursive(node: FolderNode, accumulator: Preset[]): void {
  // Add presets from current node
  accumulator.push(...node.presets);

  // Recursively add from children
  for (const child of Object.values(node.folders)) {
    this.collectPresetsRecursive(child, accumulator);
  }
}
```

**Characteristics:**
- Depth-first traversal
- In-order accumulation
- Works with tree structure from `instruments.json`
- Already tested (used for random selection)

### Performance Profile

**Estimated Times (M1 MacBook Pro):**
- Small vendor (500 total presets): ~5ms traversal
- Large vendor (5000 total presets, 500 limit): ~15ms traversal + slice
- Render 500 preset cards: ~120ms

**Total latency for browse mode root:** ~135ms (acceptable)

---

## Testing

### Functional Testing

**Browse Mode:**
- [x] Click vendor → Shows all vendor presets (up to 500)
- [x] Click folder → Shows all presets in that folder + subfolders
- [x] Drill down → Preset count decreases (filtered subset)
- [x] Click preset → Loads correctly
- [x] 500 limit respected

**Gesture Mode (Regression):**
- [x] Drag navigation shows current-level presets only
- [x] Release on folder → Random from nested (uses getRandomPreset)
- [x] Behavior unchanged from ADR 012

**Edge Cases:**
- [x] Empty folder (no presets at any level)
- [x] Folder with only nested presets (none at current level)
- [x] Deep hierarchy (5+ levels)
- [x] Vendor with >500 total presets (shows first 500)

---

## User Experience Impact

### Before (ADR 012)

**Browse Mode Navigation:**
1. Click "NI Melodic" → See folders, no presets
2. Click "Leads" → See folders, no presets
3. Click "Analog" → See folders, no presets
4. Click "Monosynth" → See 15 presets

**User frustration:** "Where are all the presets?"

### After (ADR 013)

**Browse Mode Navigation:**
1. Click "NI Melodic" → See folders + 500 presets from everywhere
2. Click "Leads" → See folders + 200 presets from Leads category
3. Click "Analog" → See folders + 80 presets from Analog Leads
4. Click "Monosynth" → See 15 Monosynth presets

**User delight:** "I can see everything and drill down to filter!"

---

## Related Decisions

- **ADR 009:** Gesture-First Browser Architecture (original design)
- **ADR 011:** Browser Layout and Persistent Mode (toggle introduction)
- **ADR 012:** Persistent Browser Implementation (dual-mode architecture)
- **ADR 013:** Browse Mode Nested Preset Display (this document)

---

## Future Enhancements

### Search/Filter (High Priority)
With nested presets visible, search becomes more valuable:
- Text search across visible presets
- Filter by tags/type
- Sort options (alphabetical, recent)

### Breadcrumb Navigation
Show current path and allow jumping back:
```
Ableton > Bass > Acoustic > [50 presets]
```

### Preset Count Indicators
Show how many presets in each folder:
```
Bass (150)
  Acoustic (50)
  Electric (60)
  Synth (40)
```

### Virtual Scrolling
If 500 limit proves too restrictive with nested display:
- Implement windowing for 1000+ presets
- Load visible range only
- Maintain scroll performance

---

## Decision Outcome

**Accepted** - Implementation complete and tested.

**Success Criteria Met:**
- ✅ Browse mode shows nested presets at all navigation levels
- ✅ Gesture mode unchanged (current-level only)
- ✅ 500 preset limit respected in browse mode
- ✅ Performance acceptable (<200ms load time)
- ✅ Backward compatible (gesture mode behavior preserved)

**User Feedback:**
- Significantly improved browse mode discoverability
- Presets visible earlier in navigation flow
- Folder navigation still useful for filtering
- No reported performance issues with 500 nested presets

---

## Notes

This change makes browse mode feel like a proper **preset browser** rather than a folder navigator. The combination of:
- Immediate nested preset visibility
- Folder-based filtering via clicks
- 500 preset limit
- Scrollable grid

Creates an exploration experience optimized for sound design workflows.
