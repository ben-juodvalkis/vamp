# ADR-119: Replace Instrument Mode

**Status:** Accepted
**Date:** 2025-11-17
**Context:** Replace instrument on existing MIDI track without creating new track

## Context

The default browser workflow always prepares a new track when loading an instrument. This is optimal for building arrangements but problematic when users want to swap instruments on an existing track with recorded MIDI clips.

### Problems Identified
- **Destructive workflow** - No way to change instrument without losing existing MIDI clips
- **Track proliferation** - Users accumulate duplicate tracks when experimenting with different instruments
- **Session management overhead** - Requires manual track deletion and clip moving
- **Breaks creative flow** - Multi-step workaround interrupts performance momentum

### Use Cases
1. **Instrument experimentation** - Try different instruments on same MIDI performance
2. **Sound design iteration** - Refine instrument choice after recording clips
3. **Performance adaptation** - Quickly swap instruments mid-set without disrupting arrangement
4. **Track cleanup** - Avoid creating unnecessary duplicate tracks

## Decision

Implement a **Replace Instrument Mode** that allows users to swap instruments on the current track without track preparation or clip disruption.

### Architecture

**1. Browser Mode Store Flag (`browserModeStore.svelte.ts`)**
```typescript
let isReplacingInstrument = $state(false);

// Helper to open browser in replace mode
openForReplace() {
  isReplacingInstrument = true;
  isInstrumentPersistent = true; // Uses persistent browse mode
}

exitReplaceMode() {
  isReplacingInstrument = false;
}
```

**2. Track Preparation Skip Logic**

**Vendor Selection** (`UnifiedGestureBrowser.v6.svelte:218-225`):
```typescript
function handleVendorClick(vendor) {
  const isReplaceMode = browserModeStore.isReplacingInstrument;
  trackPrepManager.reset();

  if (!isReplaceMode) {
    trackPrepManager.prepareTrack(vendor.trackType).catch(console.error);
  } else {
    trackPrepManager.skipPrepAndMarkReady(); // Skip track creation
  }
}
```

**Preset Loading** (`UnifiedGestureBrowser.v6.svelte:451-459`):
```typescript
async function handlePresetClick(preset) {
  const isReplaceMode = browserModeStore.isReplacingInstrument;

  // Prepare track if needed (skip in replace mode)
  if (!isReplaceMode) {
    if (!trackPrepManager.isPrepared()) {
      await trackPrepManager.prepareTrack(vendor.trackType);
    }
  }

  await loadPresetWithVariant(preset, selectedVendor);

  if (isReplaceMode) {
    browserModeStore.exitReplaceMode();
  }
}
```

**3. UI Entry Point (`ClipCentralView.svelte`)**

**REPLACE INST Button** - Positioned in MIDI clip view controls
```typescript
function handleReplaceInstrument() {
  // Reset browser to show vendor grid (not last selected vendor)
  browserNavigationStore.selectedVendorId = null;
  browserNavigationStore.selectedCategory = null;

  // Open in replace mode
  browserModeStore.openForReplace();
}
```

**Long Press Protection** (800ms hold required):
- Prevents accidental activation
- Matches DELETE CLIP button pattern
- Visual progress indicator during hold
- Cyan color coding (#00c9ff family)

### Implementation Details

**Browser Reset Logic**
- Clears `selectedVendorId` to show full vendor grid
- Clears `selectedCategory` to prevent showing last browsed path
- Ensures user sees all available vendors for choice

**Vendor Button Stretch Behavior**
```css
/* When showing all vendors in replace mode, stretch to fill height */
.vendor-buttons.showing-all-vendors {
  height: 100%;
}

.vendor-buttons.showing-all-vendors .category-button {
  min-height: 0;
  flex: 1;
}
```
Makes all vendor buttons evenly distributed and easily tappable when opened in replace mode.

**Auto-Exit After Selection**
- Replace mode automatically exits after instrument loads
- Returns browser to normal behavior for subsequent operations
- No manual mode toggle required

## Consequences

### Positive
✅ **Non-destructive workflow** - Preserves MIDI clips while changing instruments
✅ **Cleaner session management** - Reduces unnecessary track creation
✅ **Faster iteration** - Quick instrument swapping without track overhead
✅ **Intuitive UX** - Located in clip view where users work with existing material
✅ **Safe operation** - Long press requirement prevents accidental activation
✅ **Consistent patterns** - Reuses existing browser infrastructure and interaction patterns

### Neutral
⚙️ **MIDI-specific** - Only applicable to MIDI/instrument tracks (audio clips have separate "REPLACE AUDIO" feature)
⚙️ **Current track assumption** - Always targets currently selected track
⚙️ **Manual invocation** - Requires explicit user action (can't auto-detect intent)

### Negative
⚠️ **Discovery challenge** - Users must know feature exists (mitigated by visual similarity to REPLACE AUDIO)
⚠️ **Long press friction** - 800ms hold adds slight delay (necessary for safety)

## Alternatives Considered

### 1. Right-Click Context Menu
**Pros:** Standard desktop pattern, discoverable
**Cons:** Breaks touch-first iPad UX, adds modal UI complexity
**Rejected:** Inconsistent with iPad-optimized touch interface

### 2. Toggle Mode Button
**Pros:** Clear visual state, no hold gesture
**Cons:** Requires manual mode switching, easy to forget mode state
**Rejected:** Mode confusion risk, cognitive overhead

### 3. Drag-and-Drop Instrument Replacement
**Pros:** Direct manipulation, intuitive
**Cons:** Complex gesture detection, conflicts with existing drag behaviors
**Rejected:** Technical complexity, gesture conflict risks

### 4. Smart Detection (Auto-Replace vs New Track)
**Pros:** Zero UI, automatic behavior
**Cons:** Unpredictable, can't satisfy all use cases, no user control
**Rejected:** Lack of explicit control unacceptable for critical operation

## Comparison with Audio Clip Replacement

**Similar Patterns:**
- Both use replace mode flag pattern
- Both located in clip view controls
- Both skip track preparation
- Both use cyan color coding

**Key Differences:**
- **Audio clips**: Targets specific clip slot (trackIndex, clipIndex)
- **Instruments**: Replaces entire track's instrument device
- **Audio clips**: Opens directly to audio browser
- **Instruments**: Shows vendor selection grid first

## Implementation Notes

**Files Modified:**
- `interface/src/lib/stores/v6/browserModeStore.svelte.ts` (flag and helpers)
- `interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` (skip logic)
- `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` (UI entry point)
- `interface/src/lib/components/v6/browser/VendorButtonGrid.svelte` (stretch styling)

**Related Features:**
- Track Preparation System (ADR-xxx)
- Browser Mode Management (ADR-116)
- Audio Clip Replacement (similar pattern)

**Future Enhancements:**
- Keyboard shortcut for replace mode
- Preference to remember last used vendor in replace mode
- Undo/redo support for instrument swaps
- Preview mode (audition before committing)
