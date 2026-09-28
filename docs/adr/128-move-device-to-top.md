# ADR 019: Move Device to Top

**Date**: October 29, 2025
**Status**: Accepted
**Authors**: Claude Code
**Related**: [V6 Architecture](../v6-architecture-overview.md)

---

## Context

Users needed a quick way to reorder devices in their FX chain without manually dragging in Ableton Live's interface. The most common use case is moving a device to the first position (index 0) in the device chain, particularly useful when experimenting with effect order and wanting to quickly test a device at the beginning of the signal flow.

### Requirements
- Move any FX device to position 0 in its chain
- One-click operation from the interface
- Visual feedback for success/failure
- Work with devices on tracks and in racks
- Integrate with existing device interaction patterns

---

## Decision

We implemented a "Move to First Position" feature using Ableton Live's native `appointed_device` system (blue hand) combined with the Song API's `move_device` method. The feature has two modes of operation:

1. **Manual Mode**: User clicks button in UI to move currently selected device
2. **Automatic Mode**: Device automatically moves to top after loading (configurable per device)

### Architecture

#### 1. Device Selection System
Every device interaction automatically appoints the device:

```typescript
// BaseDeviceControl.svelte - handleTap()
if (device) {
  await selectDevice(device.id);  // Appoints device (blue hand)
}
```

**OSC**: `/looping/device/select [deviceId]`
**Max**: `live_set view.select_device(id deviceId)`

#### 2. Move Operation
When user clicks the move button:

```typescript
// CentralDisplay.svelte
await moveAppointedDeviceToTop();
```

**OSC**: `/looping/device/move_appointed_to_top`
**Max**: `live_set.move_device(device, target, 0)`

#### 3. UI Integration (Manual Mode)
48x48px icon button positioned at top-left of FX device central views:

```svelte
{#if view.type === 'device'}
  <button class="absolute top-2 left-2 w-12 h-12">
    <ArrowLeft />  <!-- Lucide icon -->
  </button>
{/if}
```

**Visual States**:
- **Idle**: Arrow left icon, semi-transparent background
- **Moving**: Spinner animation
- **Success**: Checkmark icon, green background (1 second)
- **Error**: X icon, red background (1 second)

#### 4. Automatic Move on Load (NEW)
Devices can be configured to automatically move to position 0 after loading:

```typescript
// selectedTrackStore.svelte.ts - handleCompleteDeviceState()
devices.forEach(device => {
  this.checkAutoMoveToTop(device);  // Check if device should auto-move
});
```

**Configuration** in `device-configs.json`:
```json
{
  "Wah": {
    "insertion": {
      "moveToTopOnLoad": true
    }
  }
}
```

**Detection Logic**:
- Matches both `className` and device `name`
- Only triggers if device is at end of chain (newly loaded)
- Skips if device already at position 0
- Uses same move service as manual mode

---

## Implementation Details

### Frontend (TypeScript/Svelte)

**deviceMoveService.ts**:
```typescript
export async function selectDevice(deviceId: number): Promise<void>
export async function moveAppointedDeviceToTop(): Promise<void>
```

**BaseDeviceControl.svelte**:
- Enhanced `handleTap()` to call `selectDevice(device.id)`
- Auto-appoints device on every interaction

**CentralDisplay.svelte**:
- 48x48px button positioned `absolute top-2 left-2`
- State management: `idle | success | error`
- Auto-resets to idle after 1 second

**selectedTrackStore.svelte.ts** (NEW):
```typescript
private async checkAutoMoveToTop(device: Device) {
  // Find config for this device (match by device name)
  const deviceConfig = UNIFIED_DEVICE_CONFIGS[device.name];

  // Check if device is configured for auto-move
  if (!deviceConfig?.insertion?.moveToTopOnLoad) {
    return; // Not configured for auto-move
  }

  // Verify className matches expected value for safety
  if (device.className !== 'AudioEffectGroupDevice') {
    console.warn(
      `Device "${device.name}" has moveToTopOnLoad but unexpected className: ${device.className}`
    );
    return;
  }

  // Check if device is newly loaded (at end of chain) and not already at position 0
  const isAtEnd = device.index === this._devices.length - 1;
  const isNotAtTop = device.index !== 0;

  if (isAtEnd && isNotAtTop) {
    console.log(`Auto-moving "${device.name}" to top (configured with moveToTopOnLoad)`);

    // Import and use the existing move service
    const { selectDevice, moveAppointedDeviceToTop } = await import('$lib/services/deviceMoveService');
    await selectDevice(device.id);
    await moveAppointedDeviceToTop();
  }
}
```

**UnifiedDeviceConfigs.ts** (NEW):
```typescript
export interface InsertionConfig {
  displayName: string;
  insertName?: string;
  category: string;
  description: string;
  recommended?: boolean;
  icon?: string;
  insertable?: boolean;
  presetPath?: string;
  moveToTopOnLoad?: boolean; // Auto-move device to position 0 after loading
}
```

### Backend (Max4Live)

**liveAPI-v6.js** - Two OSC handlers:

#### `/looping/device/select`
```javascript
var devicePath = devicePaths[deviceId];
var deviceApi = new LiveAPI(devicePath);
var viewApi = new LiveAPI("live_set view");
viewApi.call("select_device", "id", deviceApi.id);
```

#### `/looping/device/move_appointed_to_top`
```javascript
var liveSetApi = new LiveAPI("live_set");
var appointedDeviceResult = liveSetApi.get("appointed_device");
// Result: ["id", "76786"]
var deviceId = appointedDeviceResult[1];
var appointedDevice = new LiveAPI(null);
appointedDevice.id = deviceId;

var currentIndex = appointedDevice.get("device_index");
var parentResult = appointedDevice.get("canonical_parent");
var parentDeviceId = parentResult[1];

// Call move_device on Song, not on parent!
liveSetApi.call("move_device", "id", deviceId, "id", parentDeviceId, 0);
```

**Key Insight**: `move_device` must be called on the **Song object** (`live_set`), not on Track or Chain. This was discovered through careful reading of the Live Object Model documentation.

---

## Rationale

### Why Appointed Device System?

**Alternatives Considered**:
1. **Pass device ID directly to move command**
   - Simpler implementation
   - Less state management
   - ❌ Doesn't leverage Live's native selection system
   - ❌ Misses opportunity for future features (keyboard shortcuts, etc.)

2. **Track last-touched device in frontend state**
   - No Live API calls for selection
   - ❌ State can get out of sync
   - ❌ Requires complex state management

3. **Use appointed_device system** ✅ **CHOSEN**
   - Leverages Live's native blue hand indicator
   - State is managed by Live itself
   - Extensible for future features
   - Users get visual feedback in Live (blue hand)
   - Matches Live's UX patterns

### Why Icon-Only Button?

**Text-based alternatives**:
- "⬆️ First" (initial implementation) - Too wide, cluttered
- "Move to Top" - Too wordy
- "First" - Unclear meaning

**Icon advantages** ✅:
- 48x48px = perfect touch target
- Arrow left metaphor = "move to beginning"
- Minimal visual intrusion
- Language-agnostic
- Consistent with modern UI patterns

### Why Top-Left Positioning?

- **Top-right**: Conflicts with potential future controls
- **Bottom**: Too far from device controls
- **Top-left** ✅:
  - Near title/header area (standard location for primary actions)
  - Doesn't interfere with device-specific controls
  - Easy thumb reach on iPad
  - Arrow points toward first position conceptually

---

## Consequences

### Positive
- ✅ **One-click device reordering** - Fast workflow improvement
- ✅ **Automatic positioning** - Devices can self-position after loading (e.g., Wah always goes first)
- ✅ **Clean state management** - Live's appointed_device is source of truth
- ✅ **Visual feedback** - Button flashes green on success
- ✅ **Extensible** - Foundation for more device operations (move up/down, swap, etc.)
- ✅ **Low coupling** - Uses existing OSC infrastructure
- ✅ **Non-intrusive UI** - Icon button doesn't clutter interface
- ✅ **Declarative config** - Auto-move behavior defined in device config JSON
- ✅ **Reusable** - Any device can opt into auto-move with one config field

### Negative
- ⚠️ **Only moves to position 0** - Can't move to arbitrary positions (future enhancement)
- ⚠️ **Device view only** - Manual button doesn't appear in grid view (intentional)
- ⚠️ **Requires appointment** - Manual mode must touch device first (acceptable UX trade-off)
- ⚠️ **Auto-move detection** - Only works for devices at end of chain (by design)

### Neutral
- 📝 **New OSC endpoints** - Two new commands in API surface
- 📝 **Dependency on Live API** - Uses `move_device`, `appointed_device`, `canonical_parent`
- 📝 **State transitions** - Manual button has 4 states (idle, moving, success, error)
- 📝 **Config field** - New `moveToTopOnLoad` field in InsertionConfig interface

---

## Edge Cases Handled

| Case | Behavior | Implementation |
|------|----------|----------------|
| **Device already at position 0** | Returns `already_at_top` result | No visual change (success state not shown) |
| **No appointed device** | Returns `no_appointed_device` result | Error state, red X icon |
| **Single device on track** | Move succeeds (no-op) | Success state, green checkmark |
| **Device in rack** | Moves within rack chain | Uses `canonical_parent` |
| **Rapid clicking** | Debounced with `isMoving` state | Button disabled during operation |
| **Max API errors** | Caught and logged | Error state, red X icon |
| **Auto-move: Device in middle of chain** | No auto-move triggered | Only moves if `index === devices.length - 1` |
| **Auto-move: Wrong className** | Logged warning, skipped | Safety check prevents unexpected moves |
| **Auto-move: Multiple devices loaded** | Only last device auto-moves | Detection checks for end-of-chain position |
| **External Max patch loads device** | Auto-move triggers on state update | Works seamlessly with external loading |

---

## API Documentation

### OSC Endpoints

#### `/looping/device/select`
**Args**: `[deviceId: number]`
**Description**: Selects device in Live, making it the appointed device (blue hand)
**Response**: None (fire-and-forget)

#### `/looping/device/move_appointed_to_top`
**Args**: `[]` (no arguments)
**Description**: Moves currently appointed device to position 0 in its chain
**Response**:
- `/looping/device/move_appointed_to_top/result ["success" | "already_at_top" | "no_appointed_device"]`
- `/looping/device/move_appointed_to_top/error [error_code]`

### Frontend API

```typescript
// Service functions
function selectDevice(deviceId: number): Promise<void>
function moveAppointedDeviceToTop(): Promise<void>
```

---

## Testing

### Manual Mode Test Scenarios
1. ✅ Load track with 3+ FX devices
2. ✅ Touch device in middle of chain
3. ✅ Verify device becomes appointed (blue hand in Live)
4. ✅ Click arrow button
5. ✅ Verify device moves to position 0
6. ✅ Verify button flashes green
7. ✅ Verify device chain updates in interface

### Automatic Mode Test Scenarios (NEW)
1. ✅ Load Wah device via external Max patch
2. ✅ Verify device appears at end of chain initially
3. ✅ Verify device automatically moves to position 0
4. ✅ Verify console log: `Auto-moving "Wah" to top`
5. ✅ Verify no auto-move if device manually placed at position 0
6. ✅ Verify className safety check (warns if className doesn't match)
7. ✅ Verify no auto-move for devices without `moveToTopOnLoad: true`

### Edge Case Testing
1. ✅ Device already at position 0
2. ✅ Single device on track
3. ✅ Device in Audio Effect Rack
4. ✅ Rapid button clicking
5. ✅ No device selected (shouldn't happen due to auto-appointment)
6. ✅ Auto-move: Device loaded in middle of chain (no auto-move)
7. ✅ Auto-move: Multiple Wah devices loaded sequentially

---

## Future Enhancements

### Potential Extensions
1. **Move to specific position** - Not just position 0
2. **Move up/down** - Relative positioning (+1/-1)
3. **Keyboard shortcuts** - Power user efficiency
4. **Drag to reorder** - Visual drag preview
5. **Swap devices** - Exchange positions with another device
6. **Undo/redo integration** - With Live's undo system
7. **Multi-device selection** - Move multiple devices at once

### UI Improvements
1. **Visual feedback in device grid** - Show device position changing
2. **Animation** - Smooth transition effect
3. **Long-press menu** - Multiple move options (top, bottom, up, down)
4. **Device chain visualization** - Mini chain view in central display

---

## References

- [Cycling74 Live Object Model - Song.move_device](https://docs.cycling74.com/apiref/lom/song/#move_device)
- [Cycling74 Live Object Model - Song.appointed_device](https://docs.cycling74.com/apiref/lom/song/#appointed_device)
- [Cycling74 Live Object Model - Song.View.select_device](https://docs.cycling74.com/apiref/lom/song_view/#select_device)
- [V6 Architecture Overview](../v6-architecture-overview.md)
- [Implementation Log](../current/move-device-to-top-implementation-log.md)

---

## Files Modified

**New**:
- `interface/src/lib/services/deviceMoveService.ts`
- `documentation/adr/019-move-device-to-top.md`
- `documentation/current/move-device-to-top-implementation-log.md`

**Modified**:
- `interface/src/lib/components/v6/device-panel/BaseDeviceControl.svelte`
- `interface/src/lib/components/v6/central/CentralDisplay.svelte`
- `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` (NEW: auto-move logic)
- `interface/src/lib/configs/UnifiedDeviceConfigs.ts` (NEW: moveToTopOnLoad field)
- `data/device-configs.json` (NEW: Wah device config)
- `ableton/scripts/liveAPI-v6.js`

**Total Changes**:
- ~300 lines added
- 1 new service module (deviceMoveService)
- 1 new store method (checkAutoMoveToTop)
- 2 new OSC endpoints
- 1 new UI component (button)
- 1 new config field (moveToTopOnLoad)
- 1 new device config (Wah)
