# ADR 047: Rack Variation Chooser Component

**Date:** 2025-10-13
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Controls, Rack Devices, OSC API

---

## Context

Ableton Live 11+ supports **macro variations** for Rack devices (Drum Rack, Instrument Rack). These are stored configurations of macro values that users can switch between during performance.

Currently, the looping system has no way to:
1. Detect if a rack has variations stored
2. Display which variation is active
3. Switch between variations during performance

This is a missing performance feature for racks that have multiple macro configurations saved.

### Live Object Model (LOM) Properties

From Live 11.0+, RackDevice provides:
- `variation_count` (read-only) - Number of stored macro variations
- `selected_variation_index` (get/set) - Currently selected variation (0-based index)

Reference: https://docs.cycling74.com/apiref/lom/rackdevice/

### Affected Instruments

**Drum Rack (`DrumGroupDevice`)**
- Standard Ableton drum racks (FX1/FX2 macros)
- Komplete Kontrol drum racks (16 custom macros)

**Instrument Rack (`InstrumentGroupDevice`)**
- 8 macro controls

### Current Architecture Gap

The system can detect instrument types and display appropriate controls, but:
- No OSC endpoints for `variation_count` or `selected_variation_index`
- No UI component for variation switching
- No integration with existing central views

---

## Decision

Implement a **RackVariationChooser** component that:
1. Queries variation count on instrument detection
2. Conditionally appears only when variations exist (count > 0)
3. Uses vertical slider interaction (like DeviceVerticalSlider)
4. Displays variation index (1-based for users: "1/3", "2/3", etc.)
5. Integrates seamlessly into rack central views

### Key Design Principles

1. **Conditional Rendering**
   - Only shows when `variation_count > 0`
   - No visual clutter for racks without variations
   - Seamless integration when variations exist

2. **Vertical Slider Pattern**
   - Consistent with DeviceVerticalSlider (ADR 038)
   - Drag up = next variation
   - Drag down = previous variation
   - Discrete steps (no smooth interpolation)

3. **Non-Parameter Control**
   - Not a device parameter (no `/live/device/get/parameter/value`)
   - Custom OSC endpoints for rack variations
   - Separate from macro parameter subscriptions

4. **Reactive Architecture**
   - Fetches count on instrument detection
   - Subscribes to `selected_variation_index` changes
   - Updates when user changes variation in Live

---

## Architecture

### Complete State Integration (No Round Trips!)

**Variation info is included in the complete device state message** - no separate queries needed.

#### Data Flow

1. **Max4Live** (`buildCompleteDeviceState`):
   - Queries `variation_count` and `selected_variation_index` for racks
   - Includes in complete state message with parameters and names

2. **Complete State Message** format (per device):
   ```
   [id, index, name, className, paramCount, param1Idx, param1Val, ...,
    nameCount, name1, name2, ...,
    hasVariations (0/1), variationCount, selectedVariationIndex]
   ```

3. **Interface** (`simpleClient.ts`):
   - Parses variation info from complete state
   - Passes to `selectedTrackStore`

4. **Store** (`selectedTrackStore.svelte.ts`):
   - Broadcasts variation info as `osc-message` events
   - Components listen for `/live/rack/variation_count` and `/live/rack/selected_variation_index`

### OSC Endpoint (Max4Live)

Only one endpoint needed for setting variations:

```javascript
// Client → Max: Set selected variation index (0-based, supports -1 for OFF)
/looping/rack/set/selected_variation_index [track_index] [device_index] [index]
```

**Implementation:**
```javascript
// Step 1: Set the index
deviceApi.set("selected_variation_index", index);

// Step 2: Recall (apply) the variation
deviceApi.call("recall_selected_variation");
```

### Component Interface

**RackVariationChooser.svelte**

```typescript
interface Props {
  trackIndex: number;
  deviceIndex: number;
  deviceId: number;      // For subscription lookup
  color?: string;        // Optional accent color
  readonly?: boolean;    // Disable interaction
}
```

**Features:**
- Reads variation info from `selectedTrackStore.getVariationInfo(deviceId)`
- Only renders if count > 0
- Displays "OFF" or "1/8", "2/8", etc. (1-based for users)
- Vertical slider interaction (drag up/down, -1 to N-1 range)
- Listens for Live-side variation changes
- Sends OSC command on value change

### Integration Points

1. **DrumRackCentralView** - Right column, above Transpose slider
2. **DrumRackKompleteKontrolCentralView** - Dedicated column or row
3. **InstrumentRackCentralView** - Right column with other controls

### Store Enhancement

**selectedTrackStore.svelte.ts** - New storage and method:

```typescript
// Storage (Layer 1)
private _variations = $state<Map<number, { count: number; selectedIndex: number }>>(new Map());

// Public API
getVariationInfo(deviceId: number): { count: number; selectedIndex: number } | null {
  return this._variations.get(deviceId) || null;
}
```

Populated from complete state message, no queries needed.

---

## Implementation Details

### Component Behavior

**State Management:**
```typescript
let variationCount = $state(0);
let selectedIndex = $state(-1); // -1 = OFF (no variation selected)

// Read from store (reactive to deviceId changes)
$effect(() => {
  const varInfo = selectedTrackStore.getVariationInfo(deviceId);

  if (varInfo) {
    variationCount = varInfo.count;
    selectedIndex = varInfo.selectedIndex;
  } else {
    variationCount = 0;
    selectedIndex = -1;
  }
});

// Listen for Live-side changes (user changing variation in Live's UI)
$effect(() => {
  const handler = (evt: CustomEvent) => {
    if (evt.detail.address === '/live/rack/selected_variation_index' &&
        evt.detail.args[0] === trackIndex &&
        evt.detail.args[1] === deviceIndex &&
        !isDragging) {
      selectedIndex = evt.detail.args[2];
    }
  };

  window.addEventListener('osc-message', handler);
  return () => window.removeEventListener('osc-message', handler);
});
```

**Drag Interaction:**
```typescript
// Discrete steps: 1 step per 30 pixels of vertical drag
const sensitivity = 30;

function handlePointerMove(event: PointerEvent) {
  const deltaY = startY - event.clientY;
  const stepsChanged = Math.round(deltaY / sensitivity);

  // Allow -1 (OFF) to variationCount-1 range
  let newIndex = startIndex + stepsChanged;
  newIndex = clamp(newIndex, -1, variationCount - 1);

  if (newIndex !== selectedIndex) {
    selectedIndex = newIndex;
    send('/looping/rack/set/selected_variation_index', [trackIndex, deviceIndex, newIndex]);
  }
}
```

**Display Format:**
```typescript
// User-facing: "OFF" for -1, or "1/8", "2/8", etc. (1-based)
let displayText = $derived(
  variationCount > 0
    ? selectedIndex === -1
      ? 'OFF'
      : `${selectedIndex + 1}/${variationCount}`
    : ''
);
```

### Visual Design

**Container:**
- Width: 60px (narrower than parameter sliders)
- Height: Match parent container
- Background: Muted with border
- Hover: Accent background (20% opacity)

**Fill Indicator:**
- Bottom to top based on `selectedIndex / (variationCount - 1)`
- Accent color (inherit from parent view)
- Smooth transition (150ms)

**Label:**
- Display: "VAR" or variation icon
- Position: Above slider or integrated

**Value Display:**
- Format: "1/3", "2/5", etc.
- Centered, bold text
- Z-index above fill

### Max4Live Implementation

**Complete State Integration** (liveAPI-v6.js:1156-1177)

```javascript
// In buildCompleteDeviceState() - query variations for racks
if (deviceClass === "DrumGroupDevice" || deviceClass === "InstrumentGroupDevice") {
    var countResult = api.get("variation_count");
    var count = countResult && countResult.length > 0 ? countResult[0] : 0;

    if (count > 0) {
        var indexResult = api.get("selected_variation_index");
        var selectedIdx = indexResult && indexResult.length > 0 ? indexResult[0] : -1;

        variationInfo = { count: count, selectedIndex: selectedIdx };
        log("Rack has " + count + " variations, selected: " + selectedIdx);
    }
}

devices.push({
    id, index, name, className,
    parameters, parameterNames,
    variations: variationInfo  // Added to device object
});
```

**Send in Complete State Message** (liveAPI-v6.js:1258-1265)

```javascript
// After parameter names, add variation info
if (device.variations) {
    msg.push(1);  // Has variations
    msg.push(device.variations.count);
    msg.push(device.variations.selectedIndex);
} else {
    msg.push(0);  // No variations
}
```

**Set Variation Endpoint** (liveAPI-v6.js:2485-2524)

```javascript
function setRackSelectedVariationIndex(trackIndex, deviceIndex, index) {
    var deviceApi = new LiveAPI(trackPath + " devices " + deviceIndex);

    // Step 1: Set selected_variation_index (-1 for OFF, 0-7 for variations)
    deviceApi.set("selected_variation_index", index);

    // Step 2: Call recall_selected_variation() to apply
    deviceApi.call("recall_selected_variation");

    // Verify and echo back
    var actualIndex = deviceApi.get("selected_variation_index")[0];
    outlet(0, ["/live/rack/selected_variation_index", trackIndex, deviceIndex, actualIndex]);
}
```

**Triggered On:**
- Rack device loaded via `/looping/devices/load`
- Track switch (complete state includes all racks)
- Device list change (any device add/remove rebuilds complete state)

---

## Usage Examples

### DrumRackCentralView

```svelte
<script lang="ts">
  import RackVariationChooser from '../../controls/RackVariationChooser.svelte';

  let trackIndex = $derived(session.selectedTrackIndex);
  let deviceIndex = $derived(instrument?.deviceIndex ?? 0);
  let device = $derived(selectedTrackStore.devices.find(d => d.index === deviceIndex));
</script>

<div class="flex gap-2 w-32">
  <!-- Conditionally show variation chooser -->
  {#if device}
    <RackVariationChooser
      trackIndex={trackIndex}
      deviceIndex={deviceIndex}
      deviceId={device.id}
      color={drumRackColor.primary}
    />
  {/if}

  <!-- Transpose Control -->
  <div class="flex-1">
    <DeviceVerticalSlider ... />
  </div>

  <!-- Start Control -->
  <div class="flex-1">
    <DeviceVerticalSlider ... />
  </div>
</div>
```

### DrumRackKompleteKontrolCentralView

```svelte
<!-- Variation chooser in header row or dedicated column -->
<div class="p-2 flex items-center gap-2">
  <h3>Komplete Kontrol Drums</h3>

  {#if device}
    <RackVariationChooser
      trackIndex={trackIndex}
      deviceIndex={deviceIndex}
      deviceId={device.id}
      color={drumRackKKColor.primary}
    />
  {/if}
</div>

<!-- 4x4 macro grid below -->
<div class="grid grid-cols-4 grid-rows-4 gap-2">
  ...
</div>
```

---

## Comparison with Existing Components

| Feature | RackVariationChooser | DeviceVerticalSlider | VerticalDiscreteSlider |
|---------|---------------------|---------------------|----------------------|
| **Purpose** | Rack variations | Device parameters | Discrete options |
| **Data Source** | Custom OSC API | Parameter cache | Parent state |
| **Interaction** | Discrete steps | Continuous drag | Discrete steps |
| **Subscriptions** | Custom observer | Parameter observer | None |
| **Conditional Render** | ✅ Yes (count > 0) | ❌ No | ❌ No |
| **1-based Display** | ✅ Yes | ❌ No | ❌ No |
| **Auto-fetch Count** | ✅ Yes | ❌ No | ❌ No |

---

## Consequences

### Positive

✅ **Performance Feature Parity**
- Matches Live's built-in variation switching
- No need to manually adjust macros
- Fast preset recall during performance

✅ **Conditional Rendering**
- No visual clutter for racks without variations
- Seamless integration when variations exist
- Automatic detection

✅ **Consistent Interaction**
- Matches vertical slider pattern (ADR 038)
- Familiar drag behavior
- Touch-optimized for iPad

✅ **Reactive Updates**
- Syncs when variation changed in Live
- Observer-based architecture
- Consistent with device parameter pattern

✅ **Reusable Across Racks**
- Works for Drum Rack, Instrument Rack
- Single component for all rack types
- Minimal integration code

### Negative

⚠️ **New OSC Endpoints**
- Requires Max4Live updates
- Another API surface to maintain
- Potential for observer overhead

⚠️ **Non-Standard Parameter**
- Not part of device parameter array
- Custom subscription logic needed
- Different from other device controls

⚠️ **Limited Documentation**
- RackDevice variation API introduced in Live 11.0
- May have undocumented edge cases
- Needs thorough testing

### Neutral

- Only affects rack devices (drum rack, instrument rack)
- Most presets don't use variations (optional feature)
- Component is small and focused (~150 lines)

---

## Design Rationale

### Why Not Use VerticalDiscreteSlider?

**Considered:** Using VerticalDiscreteSlider with dynamic options.

**Rejected Because:**
1. Need to fetch variation count dynamically
2. Need custom OSC endpoints (not parameters)
3. Need conditional rendering based on count
4. Need subscription to variation index changes
5. Different data flow than simple discrete options

### Why Vertical Slider Pattern?

**Accepted Because:**
1. Consistent with DeviceVerticalSlider (ADR 038)
2. Familiar drag interaction
3. Space-efficient for narrow columns
4. Touch-optimized for iPad
5. Discrete steps work well for indexed variations

### Why 1-Based Display?

**Rationale:**
- Live's UI shows variations as 1-based ("Variation 1", "Variation 2")
- User expectation: "1/3" not "0/2"
- Internal: Still use 0-based indexing for OSC API
- Display transformation: `selectedIndex + 1`

### Why Conditional Rendering?

**Rationale:**
- Most racks don't have variations saved
- Avoid visual clutter for empty variation lists
- Only show when feature is actually available
- Better user experience (no disabled empty controls)

---

## Testing Strategy

### Manual Testing

1. **Drum Rack with Variations**
   - Create drum rack with 3 macro variations
   - Load rack on track
   - Verify variation chooser appears
   - Drag up/down to switch variations
   - Verify macros update in Live

2. **Drum Rack without Variations**
   - Load standard drum rack (no variations)
   - Verify variation chooser does NOT appear
   - Verify layout adjusts correctly

3. **Instrument Rack with Variations**
   - Create instrument rack with variations
   - Verify chooser appears
   - Test interaction and macro updates

4. **Live-Side Changes**
   - Change variation in Live's UI
   - Verify interface updates reactively
   - Verify display shows correct index

5. **Touch Optimization (iPad)**
   - Test drag sensitivity on touch screen
   - Verify discrete steps feel responsive
   - Verify no scroll interference

### Edge Cases

- **Empty rack** (variation_count = 0) → No render
- **No variation selected** (selectedIndex = -1) → Shows "OFF", 0% fill
- **Single variation** (variation_count = 1) → Show "1/1" (can drag to OFF)
- **Track switch** → Variation info in complete state (automatic)
- **Rack deleted** → Component unmounts, cleanup automatic

---

## Future Considerations

### Potential Enhancements

1. **Variation Names**
   - Live doesn't expose variation names via LOM
   - Would need to show "Var 1" instead of actual name
   - Could be enhanced if Live API adds this

2. **Tap to Create Variation**
   - Long-press to save current macros as new variation
   - Would need `/live/rack/create_variation` endpoint
   - Advanced feature for future consideration

3. **Variation Presets**
   - Show variation count in GestureBrowser
   - Filter racks by "has variations"
   - Enhanced preset discovery

4. **Variation Recall Buttons**
   - Alternative UI: Grid of buttons (1, 2, 3, ...)
   - Trade-off: Takes more space
   - Slider is more space-efficient

---

## Related Decisions

- **ADR 038:** VerticalSlider and VerticalDiscreteSlider Components (interaction pattern)
- **ADR 036:** DeviceSlider Component for FX Grid (controlled pattern)
- **ADR 001:** Svelte 5 Runes Stores Architecture (reactive patterns)

---

## References

- Live Object Model: https://docs.cycling74.com/apiref/lom/rackdevice/
- Component implementation: `interface/src/lib/components/v6/controls/RackVariationChooser.svelte`
- OSC API: `ableton/scripts/liveAPI-v6.js`
- Integration: `interface/src/lib/components/v6/central/views/DrumRackCentralView.svelte`

---

## Decision Outcome

**Accepted** - Implementation complete.

**Success Criteria:**
- ✅ Complete state integration (no separate OSC queries)
- ✅ Variation info sent on rack load AND track switch
- ✅ Two-step variation recall: `set()` then `call("recall_selected_variation")`
- ✅ RackVariationChooser component with vertical slider interaction
- ✅ Conditional rendering (only when variations exist)
- ✅ Supports -1 index (OFF state) with "OFF" display
- ✅ Integration with drum rack and instrument rack central views
- ✅ 1-based display for user-facing index (OFF, 1/8, 2/8, etc.)
- ✅ Touch-optimized for iPad performance

**Implementation Highlights:**
- Variation data flows through complete state architecture (no round trips)
- Component listens for broadcasts from `selectedTrackStore`
- Max4Live endpoint: `/looping/rack/set/selected_variation_index`
- Requires `recall_selected_variation()` call to apply variation
- Supports -1 (OFF) state where no variation is active

**Files Modified:**
- `ableton/scripts/liveAPI-v6.js` (lines 1156-1177, 1258-1265, 1786-1798, 2485-2524)
- `interface/src/lib/api/simpleClient.ts` (complete state parser)
- `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` (broadcast variation events)
- `interface/src/lib/components/v6/controls/RackVariationChooser.svelte` (new)
- `interface/src/lib/components/v6/central/views/DrumRackCentralView.svelte`
- `interface/src/lib/components/v6/central/views/DrumRackKompleteKontrolCentralView.svelte`
- `interface/src/lib/components/v6/central/views/InstrumentRackCentralView.svelte`
