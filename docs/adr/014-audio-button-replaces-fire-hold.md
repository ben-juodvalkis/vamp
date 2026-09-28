# ADR 016: Audio Button Replaces Fire Button Long Hold

**Status:** Accepted
**Date:** 2025-10-06
**Deciders:** Ben Juodvalkis
**Related:** ADR-009 (Gesture Browser Architecture)
**Tags:** UX, Audio Tracks, Fire Button, Gesture Browser

---

## Context

### The Problem

Audio track preparation was implemented via a 300ms long hold on the fire button (Phase 6.8):

**Fire Button Behavior (Before):**
- **Short press (<300ms):**
  - Empty slot → fire clip (start recording)
  - Has clip → toggle session record
- **Long hold (≥300ms):** Prepare audio track immediately

### Issues with Long Hold Approach

1. **Unreliable Timer**
   - 300ms threshold felt inconsistent
   - Hard to gauge "long enough" during performance
   - Easy to accidentally trigger

2. **Created Multiple Audio Tracks**
   - Single hold would sometimes create 2-3 audio tracks
   - Timer firing multiple times
   - No debouncing or guard against rapid triggers

3. **Inconsistent with Other Track Types**
   - Drum, Omnisphere, NI tracks: Explicit buttons in browser sidebar
   - Audio: Hidden gesture on fire button
   - Not discoverable

4. **Complex Implementation**
   - Timer management in Max (`fireButtonHoldTask`)
   - Event listener in +layout.svelte
   - Message routing for `/fire/audio_track/prepare`
   - Coordination between Max and client

5. **Conflicts with Fire Button's Primary Purpose**
   - Fire button should be for clip operations
   - Audio track prep is a different domain
   - Overloading the button with two unrelated functions

---

## Decision

**Replace fire button long hold with an explicit "Audio" button in the GestureBrowser sidebar.**

### Rationale

1. **Consistency:** All track types now have dedicated buttons in the same location
2. **Discoverability:** Audio button is visible and self-explanatory
3. **Reliability:** Simple click, no timer, no accidental multiples
4. **Simplicity:** Removes complex timer logic from fire button
5. **Clear Intent:** Fire button = clip operations, Audio button = audio track prep

---

## Implementation

### 1. Simplified Fire Button (Max4Live)

**File:** `ableton/scripts/liveAPI-v6.js`

**Removed:**
```javascript
// Variables
var fireButtonHoldTask = null;
var FIRE_LONG_PRESS_THRESHOLD = 300;

// Long hold logic in handleFireCommand()
fireButtonHoldTask = new Task(function() {
    if (fireButtonIsPressed) {
        prepareAudioTrackViaAbletonOSC();
        fireButtonHoldTask = null;
    }
});
fireButtonHoldTask.schedule(FIRE_LONG_PRESS_THRESHOLD);

// Function
function prepareAudioTrackViaAbletonOSC() {
    outlet(0, ["/fire/audio_track/prepare"]);
}

// Cleanup
if (fireButtonHoldTask) {
    fireButtonHoldTask.cancel();
}
```

**New Behavior (Lines 2535-2563):**
```javascript
/**
 * Handle fire button command (simplified - short press only)
 * Behavior:
 * - Press and release: Fire highlighted clip slot (dual behavior)
 *   - If slot is empty: Fire to start recording
 *   - If slot has clip: Toggle session record
 */
function handleFireCommand(value) {
    if (value === 1) {
        fireButtonIsPressed = true;
    } else if (value === 0 && fireButtonIsPressed) {
        fireButtonIsPressed = false;
        fireHighlightedClipSlot();
    }
}
```

**Changes:**
- Removed: Timer scheduling and management
- Removed: Long press detection
- Removed: Audio track preparation message
- Kept: Dual behavior (fire empty slot OR toggle session record)

### 2. Added Audio Button to Browser

**File:** `interface/src/lib/components/v6/browser/GestureBrowser.svelte`

**Added 5th vendor (Line 13):**
```typescript
const vendors = [
    { id: 'ableton', name: 'Ableton', color: '#ff6b6b', vendorId: 'ableton', trackType: 'drum_rack' },
    { id: 'ni-drums', name: 'NI Drums', color: '#ff9500', vendorId: 'ni-drums', trackType: 'ni_drum' },
    { id: 'omnisphere', name: 'Omni', color: '#4ecdc4', vendorId: 'omnisphere', trackType: 'omnisphere' },
    { id: 'ni-melodic', name: 'NI Melodic', color: '#9c27b0', vendorId: 'ni-melodic', trackType: 'ni' },
    { id: 'audio', name: 'Audio', color: '#00ff00', vendorId: 'audio', trackType: 'audio' }
];
```

**Special handling in handleVendorClick() (Lines 61-68):**
```typescript
function handleVendorClick(vendor, event?) {
    // Special handling for audio button - no browser expansion
    if (vendor.id === 'audio') {
        console.log('[Browser] Audio button clicked - preparing audio track');
        prepareTrack('audio')
            .then(() => console.log('[Browser] Audio track ready'))
            .catch(console.error);
        return; // Don't expand browser
    }

    // ... rest of vendor logic for other types
}
```

**Fixed multiple event handlers (Lines 95-99):**
```typescript
function handleVendorDragStart(vendor, event) {
    // Audio button doesn't need drag - skip
    if (vendor.id === 'audio') {
        return; // Let onclick handle it
    }

    event.preventDefault();
    event.stopPropagation();
    // ... drag gesture logic
}
```

**Why the early return is necessary:**

Vendor buttons have 3 event handlers:
- `onclick` - Standard click
- `ontouchstart` - Touch gesture start
- `onmousedown` - Mouse gesture start

Without the early return, all 3 would fire for audio button → 3 tracks created!

### 3. Removed Fire Button Event Listener

**File:** `interface/src/routes/+layout.svelte`

**Removed (Lines 37-48):**
```typescript
// Setup fire button listener for audio track preparation
const handleFireCommand = (event: Event) => {
    const customEvent = event as CustomEvent;
    const { address } = customEvent.detail;

    if (address === '/fire/audio_track/prepare') {
        console.log('[Fire Button] Long hold detected - preparing audio track');
        prepareTrack('audio');
    }
};

window.addEventListener('osc-message', handleFireCommand as EventListener);
```

**Replaced with:**
```typescript
// Removed: Fire button long hold audio track prep
// Audio track preparation now handled by Audio button in GestureBrowser sidebar
```

**Also removed import (Line 12-13):**
```typescript
// Import track preparation for fire button
import { prepareTrack } from '$lib/services/trackPreparation';
```

No longer needed since audio prep happens in GestureBrowser.

---

## Architecture

### Before (Fire Button Long Hold):

```
User Flow:
1. Hold fire button for 300ms
2. Max timer fires → sends /fire/audio_track/prepare
3. +layout.svelte event listener catches message
4. Calls prepareTrack('audio')
5. Audio track created and configured

Issues:
- Hidden functionality (not discoverable)
- Unreliable (timer issues)
- Created multiple tracks (no guard)
- Complex (Max timer + client listener + message routing)
```

### After (Audio Button in Browser):

```
User Flow:
1. Tap "Audio" button in sidebar
2. handleVendorClick() detects audio button
3. Calls prepareTrack('audio') immediately
4. Audio track created and configured

Benefits:
- Explicit button (discoverable)
- Reliable (simple click)
- Single track (event handler fixed)
- Simple (direct function call, no message routing)
```

---

## User Experience

### Fire Button (Simplified):

**Now:**
- **Tap (short press):** Context-aware clip operation
  - Empty slot → fire clip (start recording)
  - Slot has clip → toggle session record
- **No long hold:** Removed

**Benefits:**
- ✅ Simpler mental model
- ✅ Predictable behavior
- ✅ Focused on clip operations (primary purpose)

### Audio Button (New):

**Location:** GestureBrowser sidebar (below NI Melodic)

**Behavior:**
- **Single tap:** Prepare audio track immediately
- **No browser expansion:** No presets to browse for audio
- **Visual feedback:** Green color (#00ff00)

**Track Preparation Flow:**
1. Check if current track can be reused (empty + audio type)
2. Create new track if needed
3. Configure audio routing (C-Guitar, Post FX, monitoring, arm)
4. Total time: ~250-400ms (includes 150ms delay for Live to process routing)

---

## Consequences

### Positive

1. **Discoverable UX**
   - Audio button visible in sidebar
   - Consistent with other track types
   - No hidden gestures

2. **Reliable Behavior**
   - No timer issues
   - Single track creation (event handler fixed)
   - Predictable every time

3. **Simpler Codebase**
   - Removed timer logic from Max
   - Removed event listener from +layout
   - Removed message routing for `/fire/audio_track/prepare`
   - Net: ~50 lines of code removed

4. **Better Fire Button**
   - Focused on clip operations only
   - Simpler implementation
   - No conflicting behaviors

5. **Consistent Architecture**
   - All track types: Browser sidebar buttons
   - All use `prepareTrack()` function
   - Unified approach

### Negative

1. **One More Button**
   - Sidebar now has 5 buttons instead of 4
   - Slightly more crowded
   - **Acceptable:** Clear labeling, good color coding

2. **Different Interaction Pattern**
   - Audio button: Single tap, no gesture
   - Other vendors: Can drag to browse presets
   - **Acceptable:** Audio has no presets to browse

### Neutral

1. **Fire Button Behavior Changed**
   - Users who learned the long hold gesture need to learn new pattern
   - **Minor:** Long hold was unreliable anyway

2. **Audio Track Prep Time Unchanged**
   - Still takes ~250-400ms (AbletonOSC routing delays)
   - Not faster, but more reliable

---

## Technical Details

### Event Handler Fix

**Problem:** Vendor buttons have 3 event handlers:
```svelte
<button
    onclick={() => handleVendorClick(vendor)}
    ontouchstart={(e) => handleVendorDragStart(vendor, e)}
    onmousedown={(e) => handleVendorDragStart(vendor, e)}
>
```

Both `ontouchstart` and `onmousedown` call `handleVendorDragStart()`, which calls `handleVendorClick()`.
Then `onclick` also fires and calls `handleVendorClick()` again.

**Result:** 3 calls to `handleVendorClick()` → 3 audio tracks!

**Solution:** Early return in `handleVendorDragStart()` for audio button:
```typescript
function handleVendorDragStart(vendor, event) {
    // Audio button doesn't need drag - skip
    if (vendor.id === 'audio') {
        return; // Let onclick handle it
    }

    event.preventDefault();
    event.stopPropagation();
    // ... drag gesture logic for other vendors
}
```

**Why this works:**
- `ontouchstart` → returns early (no-op)
- `onmousedown` → returns early (no-op)
- `onclick` → executes normally → 1 track created ✅

### Audio Button Implementation

**No adapter needed:**
```typescript
if (vendor.id === 'audio') {
    prepareTrack('audio'); // Direct call, no browser expansion
    return;
}
```

Audio tracks don't have preset files to browse, so no need to:
- Load adapter
- Expand browser
- Show columns
- Navigate folders

Simple, direct action.

---

## Alternatives Considered

### Alternative 1: Keep Fire Button Long Hold, Fix Timer

**Considered:** Add debouncing and guard flags to prevent multiple tracks

**Rejected:**
- Doesn't solve discoverability issue
- Still overloading fire button with unrelated function
- Adds complexity instead of removing it

### Alternative 2: Keyboard Shortcut for Audio Track

**Considered:** Use keyboard shortcut (e.g., Cmd+A) for audio track prep

**Rejected:**
- Not touch-friendly (iPad primary interface)
- Inconsistent with other track types (all via browser)
- Requires hand off touchscreen

### Alternative 3: Context Menu on Fire Button

**Considered:** Long press shows menu with options (fire clip, prepare audio, etc.)

**Rejected:**
- Too complex for live performance
- Slows down workflow
- Not gesture-friendly

### Alternative 4: Separate Audio Panel

**Considered:** Dedicated panel or modal for audio track management

**Rejected:**
- Over-engineering
- Browser sidebar is perfect location
- Consistent with existing pattern

---

## Migration Guide

### For Users

**Old workflow:**
1. Hold fire button for 300ms
2. Wait for audio track to prepare
3. Release button

**New workflow:**
1. Tap "Audio" button in sidebar (below NI Melodic)
2. Wait for audio track to prepare
3. Done!

**Fire button now:**
- **Tap on empty slot:** Fires clip (starts recording)
- **Tap on slot with clip:** Toggles session record
- **No long hold:** Removed

### For Developers

**Code changes:**
- Max: Simplified `handleFireCommand()` - no timer logic
- Svelte: Audio button in vendors array with special handling
- Removed: `/fire/audio_track/prepare` message and event listener

**No API changes:** `prepareTrack('audio')` still works the same way

---

## Testing Checklist

- [x] Audio button appears in sidebar (below NI Melodic)
- [x] Audio button creates exactly 1 audio track (not 3)
- [x] Audio button configures routing (C-Guitar, Post FX, monitoring, arm)
- [x] Audio button doesn't expand browser
- [x] Fire button short press on empty slot fires clip
- [x] Fire button short press on slot with clip toggles session record
- [x] Fire button no longer has long hold behavior
- [x] Other vendor buttons still work (Ableton, NI, Omni)
- [x] Other vendor buttons still use drag gesture for browsing

---

## Success Criteria

All met:

✅ **Explicit audio button** in sidebar
✅ **Single track creation** (no multiples)
✅ **Consistent UX** with other track types
✅ **Simpler fire button** (focused on clip operations)
✅ **Removed timer complexity** from Max and client
✅ **Discoverable** (visible button vs hidden gesture)

---

## Future Considerations

### Potential Enhancements

1. **Audio Input Selection**
   - Expand Audio button to show input options (C-Guitar, Line In, etc.)
   - Similar to preset browser for other types
   - Would require adapter for audio routing presets

2. **Audio Track Templates**
   - Preset routing configurations
   - Different input sources with FX chains
   - Browseable like instrument presets

3. **Visual Feedback**
   - Loading indicator while track prepares (~250-400ms)
   - Success confirmation
   - Error handling for failed prep

4. **Fire Button Evolution**
   - Could add other short-press contexts
   - Or keep simple (current dual behavior works well)

### Known Limitations

1. **Audio Button Doesn't Use Drag Gesture**
   - Other vendors: Drag to browse presets
   - Audio: Simple tap (no presets to browse)
   - Slightly inconsistent interaction, but acceptable

2. **No Visual Prep Status**
   - Other vendors show "preparing..." status
   - Audio button has no feedback during ~250-400ms prep time
   - Could add loading state in future

---

## References

- **ADR-009:** Gesture Browser Architecture (vendor button pattern)
- **Phase 6.8 Implementation:** Original fire button long hold (now deprecated)
- **trackPreparation.ts:** Audio track prep logic (unchanged)

---

## Decision Outcome

**Accepted** - Audio button implemented, fire button simplified.

**User feedback needed:**
- Does audio button placement feel natural?
- Is green color (#00ff00) appropriate or too bright?
- Should audio button show prep status indicator?

**Next Steps:**
- Monitor for accidental fire button usage (expecting long hold)
- Consider visual feedback for audio button prep status
- Potentially add audio routing options in future

---

**Status:** ✅ Complete - Production Ready
**Migration:** Immediate (no breaking changes)
**User Impact:** Positive (more reliable, discoverable)
