# ADR-453: Simpler-Record UI Integration

**Status**: Planning
**Date**: 2025-01-24
**Related**: [Simpler-Record repo](https://github.com/ben-juodvalkis/Simpler-Record)

---

## Problem Statement

The Simpler-Record Max for Live device captures audio and loads it into a Simpler instrument. Currently it's controlled only via:
1. UI toggle in the Max device itself
2. Footswitch (pedal 5) via `/pedalboard/5/on|off` on port 11010

**Limitations:**
- No way to trigger recording from the iPad interface
- No visibility into recording state (armed, recording, etc.) from UI
- Can't easily route audio from the current track to the recorder

## Solution Overview

Add UI controls in the Svelte interface to:
1. **Global Record Button** (top-right, above Master track) - record external audio
2. **ClipCentralView Button** (audio tracks) - route current track's send to recorder + record

Enable bidirectional communication with comprehensive state feedback.

---

## Architecture

### Dedicated OSC Port Pair: 11008/11009

New port pair for Simpler-Record ↔ Bridge communication:
- **11008**: Bridge → Simpler-Record (commands)
- **11009**: Simpler-Record → Bridge (state updates)

**Why a dedicated port?**
- Keeps protocol separate from pedalboard (11010) and maxObserver (11002)
- Enables comprehensive state feedback without polluting other channels
- Room to grow the protocol (waveform preview, meters, etc.)

**Port Map Reference:**
| Port | Direction | Purpose |
|------|-----------|---------|
| 11000/11001 | AbletonOSC | Primary Live communication |
| 11002/11003 | maxObserver | Device loading, clip ops |
| 11004/11005 | midiConverter | Pitch/mod wheel |
| 11006/11007 | shellHelper | Audio clipboard |
| **11008/11009** | **simplerRecord** | **Audio capture (NEW)** |
| 11010 | pedalboard | Footswitch → Central M4L |
| 11012 | LED feedback | Central M4L → Utility |

### Recording State Machine

```
┌─────────┐  arm()   ┌─────────┐  beat    ┌───────────┐
│  IDLE   │ ───────► │ PENDING │ ───────► │ RECORDING │
└─────────┘          └─────────┘          └───────────┘
     ▲                    │                     │
     │    disarm()        │      disarm()       │
     └────────────────────┴─────────────────────┘
                                │
                          (via STOPPING if quantized)
```

**States:**
- **idle**: Not recording, not armed
- **pending**: Armed, waiting for quantization boundary to start
- **recording**: Actively recording audio
- **stopping**: Recording, waiting for quantization boundary to stop

### OSC Protocol

**Commands (UI → Device, port 11008)**

| Message | Args | Purpose |
|---------|------|---------|
| `/capture/arm` | none | Arm for quantized recording |
| `/capture/disarm` | none | Disarm/stop (quantized) |
| `/capture/start` | none | Immediate start (bypass quant) |
| `/capture/stop` | none | Immediate stop (bypass quant) |
| `/capture/query` | none | Request current state |

**State Updates (Device → UI, port 11009)**

| Message | Args | Purpose |
|---------|------|---------|
| `/capture/state` | `[state]` | Current state: "idle", "pending", "recording", "stopping" |
| `/capture/quantization` | `[name]` | Current quantization setting (e.g., "1 Bar", "1/4") |
| `/capture/file` | `[path]` | Path of recorded file (sent after stop) |

---

## UI Interaction Design

### RecordButton (Global)

**Location**: Top-right corner, above Master track (Master track shortened to make room)

**Interactions:**
- **Short tap**: Arm/disarm (respects Ableton's global quantization)
- **Long hold (300ms)**: Immediate start/stop (bypasses quantization)

**Visual States:**

| State | Appearance |
|-------|------------|
| idle | Dark/muted "REC" |
| pending | Red pulsing "ARM" (CSS animate-pulse) |
| recording | Red solid "●" |
| stopping | Orange pulsing "STOP" |

### ClipCentralView Button (Audio Tracks)

**Location**: Audio track row alongside existing buttons (exact placement TBD)

**Behavior:**
- Tapping "REC TO SIMPLER" when idle:
  1. Sets send 0 to 1.0 for current track (routes audio to return track with recorder)
  2. Arms recording
- Tapping when active:
  1. Disarms recording
  2. Optionally restores original send level

**Note**: This is **separate from** the existing "LOAD SIMPLER" button which loads an already-recorded audio clip file into Simpler.

---

## Implementation Phases

### Phase 1: Simpler-Record Device Updates

**Files in Simpler-Record repo:**
- `code/capture-engine.js`
- `simpler-recorder-1.1.amxd` (Max patch)

**JavaScript Changes (capture-engine.js):**

1. Add `captureState` variable tracking "idle" | "pending" | "recording" | "stopping"
2. Add new message handlers: `arm()`, `disarm()`, `start()`, `stop()`, `query()`
3. Add `broadcastState()` and `broadcastQuantization()` functions
4. Update `startRecording()` and `stopRecording()` to set captureState and broadcast
5. Increase outlets to 2 (outlet 1 for UI state)

```javascript
// Key additions to capture-engine.js
var captureState = "idle";
outlets = 2;  // 0: existing (create_simpler, LED), 1: UI state

function arm() {
    if (captureState !== "idle") return;
    refreshProjectPath();
    var transportPlaying = (Date.now() - lastTimeUpdate) < 500;

    if (transportPlaying && quantizationBeats > 0) {
        captureState = "pending";
        isArmed = true;
        sendLedState(LED_RED_FLASH);
    } else {
        startRecording();  // Immediate if transport stopped
    }
    broadcastState();
}

function disarm() {
    if (captureState === "idle") return;
    isArmed = false;

    if (captureState === "recording") {
        var transportPlaying = (Date.now() - lastTimeUpdate) < 500;
        if (transportPlaying && quantizationBeats > 0) {
            captureState = "stopping";  // Wait for beat
        } else {
            stopRecording();  // Immediate
        }
    } else {
        captureState = "idle";  // Was pending, just cancel
        sendLedState(LED_OFF);
    }
    broadcastState();
}

function start() {
    if (captureState === "recording") return;
    refreshProjectPath();
    startRecording();
}

function stop() {
    if (captureState !== "recording" && captureState !== "stopping") return;
    isArmed = false;
    stopRecording();
}

function query() {
    broadcastState();
    broadcastQuantization();
}

function broadcastState() {
    outlet(1, "/capture/state", captureState);
}

function broadcastQuantization() {
    outlet(1, "/capture/quantization", QUANT_NAMES[quantizationValue] || "1/4");
}

// Update existing functions to broadcast:
// In startRecording(): captureState = "recording"; broadcastState();
// In stopRecording(): captureState = "idle"; broadcastState(); outlet(1, "/capture/file", lastFilePath);
```

**Max Patch Changes:**
1. Add `udpreceive 11008` object
2. Add `route /capture/arm /capture/disarm /capture/start /capture/stop /capture/query`
3. Wire each route outlet → `prepend [funcname]` → JS inlet
4. Add `udpsend 127.0.0.1 11009` object
5. Wire JS outlet 1 → udpsend 11009

### Phase 2: Bridge Routing

**File**: `interface/bridge/routing/messageRouter.js`

Add routing for `/capture/*` messages to port 11008:

```javascript
// Add to port configuration
simplerRecord: {
    localPort: 11009,
    remotePort: 11008,
    host: '127.0.0.1',
    description: 'Simpler-Record audio capture device'
}

// Add routing rule for /capture/* → 11008
```

**File**: `config/constants.json.example`

```json
"simplerRecord": {
    "localPort": 11009,
    "remotePort": 11008,
    "host": "127.0.0.1",
    "description": "Simpler-Record audio capture device"
}
```

### Phase 3: Capture Store

**New file**: `interface/src/lib/stores/v6/captureStore.svelte.ts`

```typescript
import { send } from '$lib/api/simpleClient';

export type CaptureState = 'idle' | 'pending' | 'recording' | 'stopping';

class CaptureStore {
    state = $state<CaptureState>('idle');
    quantization = $state<string>('1/4');
    lastFile = $state<string | null>(null);

    constructor() {
        if (typeof window !== 'undefined') {
            window.addEventListener('osc-message', this.handleMessage.bind(this));
        }
    }

    private handleMessage = (event: CustomEvent) => {
        const { address, args } = event.detail;
        if (address === '/capture/state') {
            this.state = args[0] as CaptureState;
        } else if (address === '/capture/quantization') {
            this.quantization = args[0];
        } else if (address === '/capture/file') {
            this.lastFile = args[0];
        }
    };

    arm() { send('/capture/arm', []); }
    disarm() { send('/capture/disarm', []); }
    start() { send('/capture/start', []); }
    stop() { send('/capture/stop', []); }
    query() { send('/capture/query', []); }

    get isActive() {
        return this.state !== 'idle';
    }
}

export const captureStore = new CaptureStore();
```

### Phase 4: RecordButton Component

**New file**: `interface/src/lib/components/v6/controls/RecordButton.svelte`

```svelte
<script lang="ts">
    import { captureStore } from '$lib/stores/v6/captureStore.svelte';
    import { onMount } from 'svelte';

    const HOLD_DURATION = 300;
    let holdTimeout: ReturnType<typeof setTimeout> | null = null;
    let isHolding = $state(false);
    let holdTriggered = $state(false);

    onMount(() => {
        captureStore.query();
    });

    function handlePointerDown() {
        isHolding = true;
        holdTriggered = false;

        holdTimeout = setTimeout(() => {
            holdTriggered = true;
            if (captureStore.state === 'recording' || captureStore.state === 'stopping') {
                captureStore.stop();
            } else {
                captureStore.start();
            }
        }, HOLD_DURATION);
    }

    function handlePointerUp() {
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = null;
        }

        if (isHolding && !holdTriggered) {
            if (captureStore.state === 'idle') {
                captureStore.arm();
            } else {
                captureStore.disarm();
            }
        }
        isHolding = false;
    }

    let stateClass = $derived({
        idle: 'bg-muted text-muted-foreground',
        pending: 'bg-red-600 text-white animate-pulse',
        recording: 'bg-red-600 text-white',
        stopping: 'bg-orange-600 text-white animate-pulse'
    }[captureStore.state]);
</script>

<button
    class="w-full h-full rounded-lg font-bold text-lg transition-all {stateClass}"
    style="border-radius: var(--radius-sm);"
    onpointerdown={handlePointerDown}
    onpointerup={handlePointerUp}
    onpointerleave={handlePointerUp}
    onpointercancel={handlePointerUp}
>
    {#if captureStore.state === 'idle'}
        REC
    {:else if captureStore.state === 'pending'}
        ARM
    {:else if captureStore.state === 'recording'}
        ●
    {:else}
        STOP
    {/if}
</button>
```

### Phase 5: Layout Changes

**File**: `interface/src/routes/+page.svelte`

Add RecordButton above Master track in right sidebar:

```svelte
<script>
    import RecordButton from '$lib/components/v6/controls/RecordButton.svelte';
</script>

<!-- Right sidebar modification -->
<div class="w-[120px] flex-shrink-0 flex flex-col" style="gap: var(--spacing-lg);">
    <!-- Top Row: Record + Master (stacked) -->
    <div class="flex-1 min-h-0 flex flex-col" style="gap: var(--spacing-sm);">
        <div style="height: 64px; flex-shrink: 0;">
            <RecordButton />
        </div>
        <div class="flex-1 min-h-0">
            <MasterTrack width={120} />
        </div>
    </div>
    <!-- Rest unchanged -->
</div>
```

### Phase 6: ClipCentralView Integration

**File**: `interface/src/lib/components/v6/central/views/ClipCentralView.svelte`

Add "REC TO SIMPLER" button to audio track section (alongside existing buttons):

```svelte
<script>
    import { captureStore } from '$lib/stores/v6/captureStore.svelte';

    async function handleRecordToSimpler() {
        const trackIndex = session.selectedTrackIndex;
        if (trackIndex < 0) return;

        if (captureStore.state === 'idle') {
            send('/live/track/set/send', [trackIndex, 0, 1.0]);
            captureStore.arm();
        } else {
            captureStore.disarm();
            // TODO: restore original send level
        }
    }

    let recordButtonClass = $derived(
        captureStore.isActive
            ? 'bg-red-600 text-white'
            : 'bg-purple-600 hover:bg-purple-500 text-white'
    );
</script>

<!-- Add button in audio track row 3 -->
<button
    onclick={handleRecordToSimpler}
    disabled={!hasClip}
    class="flex-1 h-full rounded-lg font-bold text-sm transition-all {recordButtonClass}"
    style="border-radius: var(--radius-sm);"
>
    {captureStore.isActive ? 'STOP REC' : 'REC TO SIMPLER'}
</button>
```

---

## Files Summary

### Simpler-Record repo (external)
| File | Changes |
|------|---------|
| `code/capture-engine.js` | State machine, arm/disarm/start/stop/query handlers, broadcastState |
| `simpler-recorder-1.1.amxd` | Add udpreceive 11008, udpsend 11009, routing, second outlet |

### Looping repo
| File | Changes |
|------|---------|
| `config/constants.json.example` | Add simplerRecord port config |
| `interface/bridge/routing/messageRouter.js` | Route `/capture/*` to 11008 |
| `interface/src/lib/stores/v6/captureStore.svelte.ts` | **New** - state management |
| `interface/src/lib/components/v6/controls/RecordButton.svelte` | **New** - global button |
| `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` | Add REC TO SIMPLER button |
| `interface/src/routes/+page.svelte` | Add RecordButton to layout |
| `documentation/adr/XXX-simpler-record-ui.md` | **New** - document feature |

---

## Testing Checklist

### Phase 1: Device Communication
- [ ] Simpler-Record receives `/capture/arm` on port 11008
- [ ] Simpler-Record sends `/capture/state` on port 11009
- [ ] State transitions work: idle → pending → recording → idle
- [ ] Quantization sync works (pending state waits for beat)

### Phase 2: RecordButton
- [ ] Button appears in top-right corner
- [ ] Short tap arms/disarms recording
- [ ] Long hold (300ms) immediately starts/stops
- [ ] Visual states update correctly (idle/pending/recording/stopping)
- [ ] State syncs on page load (query)

### Phase 3: ClipCentralView
- [ ] "REC TO SIMPLER" button appears for audio tracks
- [ ] Tapping sets send 0 to 1.0 and arms recording
- [ ] Tapping again disarms and stops
- [ ] Button is separate from existing "LOAD SIMPLER"

### Phase 4: Integration
- [ ] Footswitch (pedal 5) still works
- [ ] LED feedback still works
- [ ] UI and footswitch can interoperate
- [ ] Recorded file loads into Simpler correctly

---

## Future Enhancements (Not in Scope)

- Waveform preview during recording
- Recording duration display
- Multiple recorder instances
- Save/restore send levels

---

## Implementation Log

### 2025-01-24: Deep Dive Analysis

**Status**: Codebase exploration complete, ready for implementation

#### Key Findings

**1. Bridge Routing Architecture**

The bridge uses a pattern-based routing system in `messageRouter.js`:
- `/capture/*` messages need to be routed to a dedicated port
- The `sequencer` port pair (11008/11009) already exists - we can either:
  - **Option A**: Reuse it for capture (address prefix differentiates)
  - **Option B**: Create a new `simplerRecord` port pair (cleaner separation)

**Decision**: Use **Option A** - reuse existing 11008/11009 since the sequencer is a different Max device. Add `/capture/*` routing alongside `/looping/sequencer/*`.

**Files to modify:**
- [messageRouter.js](interface/bridge/routing/messageRouter.js#L91) - Add `/capture/*` routing (after sequencer check)
- [enhanced-osc-bridge.js](interface/bridge/enhanced-osc-bridge.js#L218) - Add sequencer port listener (currently missing!)

**2. Store Pattern**

The codebase uses two store patterns:
- **Class-based** (complex stores like `selectedTrackStore.svelte.ts`)
- **Module-level with event listeners** (simpler stores like `sequencerStore.svelte.ts`)

**Recommendation**: Use the module-level pattern with window events for `captureStore.svelte.ts` - it's simpler and matches the spec's design.

**Event flow:**
```
Max Device → UDP 11009 → Bridge → WebSocket → simpleClient → window event → captureStore
UI Action → captureStore → send() → WebSocket → Bridge → UDP 11008 → Max Device
```

**3. Message Handler Location**

The spec assumes `/capture/*` messages would flow through maxObserverHandler.ts, but they should have their own handler since they're a separate device:

**New file needed**: `interface/src/lib/api/handlers/captureHandler.ts`

Or extend the existing pattern in `simpleClient.ts` line 65 to add:
```typescript
if (address.startsWith('/capture/')) {
    handleCaptureMessage(address, args);
    return;
}
```

**4. ClipCentralView Button Placement**

The audio track controls are in Row 3 ([ClipCentralView.svelte:453-532](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L453)):
- Current buttons: WARP TABS | +12/-12 | REPLACE AUDIO | LOAD SIMPLER | DELETE CLIP
- **Add "REC TO SIMPLER" after "LOAD SIMPLER"** (before DELETE CLIP)

Color scheme:
- LOAD SIMPLER: `emerald-600` (green) - sampling from existing clip
- REC TO SIMPLER: `rose-600` (red/pink) - live recording

**5. Page Layout for RecordButton**

The right sidebar ([+page.svelte:59-73](interface/src/routes/+page.svelte#L59)) has 3 flex rows:
- Top: MasterTrack (flex-1)
- Middle: QuantizeControl (flex-1)
- Bottom: LoopControl (flex-1)

**Add RecordButton above MasterTrack:**
- Fixed height (`h-16` = 64px)
- MasterTrack stays `flex-1` to fill remaining space

**6. Missing Bridge Listener**

**Critical finding**: The sequencer port (11009) has no incoming message handler in `enhanced-osc-bridge.js`. This needs to be added:

```javascript
// Sequencer → WebSocket (line ~224, after shellHelper)
udpPorts.sequencer.on("message", (oscMessage) => {
    logger.debug('Sequencer/capture message', { address: oscMessage.address, args: oscMessage.args });
    handleIncomingOSC(oscMessage, 'sequencer');
});
```

#### Implementation Order

1. **Phase 2: Bridge Routing** (5 min)
   - Add `/capture/*` to messageRouter.js
   - Add sequencer port listener in enhanced-osc-bridge.js

2. **Phase 3: captureStore** (15 min)
   - Create `captureStore.svelte.ts`
   - Add message handler in simpleClient.ts or new captureHandler.ts

3. **Phase 4: RecordButton** (20 min)
   - Create `RecordButton.svelte`
   - Add to +page.svelte layout

4. **Phase 5: ClipCentralView** (10 min)
   - Add "REC TO SIMPLER" button
   - Wire to captureStore

5. **Phase 1: Simpler-Record Device** (external repo)
   - Update capture-engine.js
   - Update Max patch

#### Questions Before Implementation

1. Should `/capture/*` share port 11008 with sequencer or get its own port?
   - **Answer**: Share - address prefix is sufficient distinction

2. Does the spec's captureStore need to listen for track changes?
   - **Answer**: No - Simpler-Record is a global device on a return track, not per-track

3. Should REC TO SIMPLER button be disabled when no clip is selected?
   - **Answer**: No - it records external audio, doesn't need a clip. Only relevant for audio tracks though.

#### Files Summary (Looping Repo)

| File | Action | Notes |
|------|--------|-------|
| `config/constants.json.example` | No change | sequencer port already configured |
| `interface/bridge/routing/messageRouter.js` | Edit | Add `/capture/*` routing |
| `interface/bridge/enhanced-osc-bridge.js` | Edit | Add sequencer port listener |
| `interface/src/lib/api/simpleClient.ts` | Edit | Add capture message routing |
| `interface/src/lib/stores/v6/captureStore.svelte.ts` | **Create** | State management |
| `interface/src/lib/components/v6/controls/RecordButton.svelte` | **Create** | Global button |
| `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` | Edit | Add REC TO SIMPLER |
| `interface/src/routes/+page.svelte` | Edit | Add RecordButton to layout |

---

### 2025-01-24: Implementation Complete (Looping Repo)

**Status**: All UI components implemented, awaiting Simpler-Record device updates

#### Completed Changes

**1. Bridge Routing** ([messageRouter.js:93-94](interface/bridge/routing/messageRouter.js#L93))
```javascript
// Simpler-Record capture commands to same port (11008)
if (address.startsWith('/capture/')) return 'sequencer';
```

**2. Bridge Listener** ([enhanced-osc-bridge.js:228-231](interface/bridge/enhanced-osc-bridge.js#L228))
```javascript
// Sequencer/Capture → WebSocket
udpPorts.sequencer.on("message", (oscMessage) => {
    logger.debug('Sequencer/capture message', { address: oscMessage.address, args: oscMessage.args });
    handleIncomingOSC(oscMessage, 'sequencer');
});
```

**3. Capture Store** ([captureStore.svelte.ts](interface/src/lib/stores/v6/captureStore.svelte.ts))
- State machine: `idle | pending | recording | stopping`
- OSC senders: `arm()`, `disarm()`, `start()`, `stop()`, `query()`
- Message handler for `/capture/state`, `/capture/quantization`, `/capture/file`

**4. Message Routing** ([simpleClient.ts:72-76](interface/src/lib/api/simpleClient.ts#L72))
```typescript
// Priority 2.5: Capture Messages (/capture/*)
if (address.startsWith('/capture/')) {
    captureStore.handleMessage(address, args);
    return;
}
```

**5. RecordButton Component** ([RecordButton.svelte](interface/src/lib/components/v6/controls/RecordButton.svelte))
- Short tap: arm/disarm (quantized)
- Long hold (300ms): immediate start/stop
- Visual states: idle (dark), pending (red pulse), recording (red solid), stopping (orange pulse)

**6. Page Layout** ([+page.svelte:62-69](interface/src/routes/+page.svelte#L62))
- RecordButton added above MasterTrack in right sidebar
- Fixed height (64px), MasterTrack fills remaining space

**7. ClipCentralView Button** ([ClipCentralView.svelte:510-525](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L510))
- "REC TO SIMPLER" button added after "LOAD SIMPLER"
- Rose/red color scheme to differentiate from green "LOAD SIMPLER"
- Shows state feedback: REC... (recording), ARM (pending), STOP (stopping)

#### TypeScript Check
All changes pass `npm run check` with no errors.

#### Next Steps (Simpler-Record Repo)

1. Update `capture-engine.js`:
   - Add `captureState` variable
   - Add `arm()`, `disarm()`, `start()`, `stop()`, `query()` handlers
   - Add `broadcastState()` and `broadcastQuantization()` functions
   - Add second outlet for UI state

2. Update Max patch:
   - Add `udpreceive 11008`
   - Add `route /capture/*` → JS inlet
   - Add `udpsend 127.0.0.1 11009`
   - Wire JS outlet 1 → udpsend

#### Testing Notes

Without the Simpler-Record device updates:
- RecordButton will appear but state won't change (no responses)
- REC TO SIMPLER button will toggle but no actual recording

To test bridge routing:
```bash
# Terminal 1: Start the bridge
npm run dev

# Terminal 2: Send test message (requires oscsend)
oscsend localhost 11008 /capture/arm
```

---

### 2025-01-24: Simpler-Record Device Updates

**Status**: JavaScript complete, Max patch needs manual wiring

#### capture-engine.js Changes

All changes made to `/Users/Shared/DevWork/GitHub/Simpler-Record/code/capture-engine.js`:

1. **Outlets increased** (line 3): `outlets = 2` (outlet 1 for UI state)
2. **State variable added** (line 20): `var captureState = "idle";`
3. **Broadcast functions added** (lines 212-226):
   - `broadcastState()` → `/capture/state`
   - `broadcastQuantization()` → `/capture/quantization`
   - `broadcastFile()` → `/capture/file`
4. **OSC handlers added** (lines 232-300):
   - `arm()` - quantized recording start
   - `disarm()` - quantized recording stop
   - `start()` - immediate start (bypass quant)
   - `stop()` - immediate stop (bypass quant)
   - `query()` - send current state to UI
5. **State transitions updated**:
   - `startRecording()` sets `captureState = "recording"` and broadcasts
   - `stopRecording()` sets `captureState = "idle"` and broadcasts file
   - `onQuantBoundary()` uses captureState instead of isArmed/isRecording
   - `quantizationChanged()` broadcasts to UI

#### Max Patch Changes Required

Open `simpler-recorder-looping.amxd` in Max and make these changes:

**1. Update v8 object outlets**

The v8 object currently has 1 outlet. Since `capture-engine.js` now has `outlets = 2`:
- Delete the v8 object and recreate it, or
- The outlet count should update automatically when you reload the JS

**2. Add UDP receive for capture commands**

Create these objects:
```
[udpreceive 11008]
        |
[route /capture/arm /capture/disarm /capture/start /capture/stop /capture/query]
   |        |           |          |          |
[t b]   [t b]       [t b]      [t b]      [t b]
   |        |           |          |          |
[prepend arm] [prepend disarm] [prepend start] [prepend stop] [prepend query]
   \        \           |          /          /
    \________\__________|_________/__________/
                        |
                   [v8 capture-engine.js]
```

**3. Add UDP send for UI state**

```
[v8 capture-engine.js]
    |            |
    |        [udpsend 127.0.0.1 11009]
    |
(existing routing to udpsend 11002 and 11012)
```

Connect the **right outlet (outlet 1)** of v8 to `udpsend 127.0.0.1 11009`.

**4. Simplified wiring diagram**

```
                    ┌──────────────────┐
                    │ udpreceive 11008 │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │ route /capture/arm ...query │
              └──┬────┬────┬────┬────┬──────┘
                 │    │    │    │    │
            [prepend arm/disarm/start/stop/query]
                 │    │    │    │    │
                 └────┴────┴────┴────┘
                          │
    ┌─────────────────────┴─────────────────────┐
    │            v8 capture-engine.js           │
    │  (inlet 0)                                │
    └────────────┬─────────────────┬────────────┘
                 │ outlet 0        │ outlet 1
                 │                 │
    ┌────────────┴────┐    ┌──────┴──────┐
    │ routepass ...   │    │ udpsend     │
    │ create_simpler  │    │ 127.0.0.1   │
    │ /looping/led    │    │ 11009       │
    └────────┬────────┘    └─────────────┘
             │
    (existing routing to 11002/11012)
```

#### Testing

After Max patch changes:

1. Start Looping: `npm run dev`
2. Load `simpler-recorder-looping.amxd` in Ableton on a return track
3. Open browser to `localhost:3000`
4. RecordButton should show "REC" (idle state)
5. Tap RecordButton → should show "ARM" (pending state)
6. When beat boundary hits → should show "●" (recording state)
7. Tap again → should stop and return to "REC"

Check Max console for `[ui]` log messages confirming broadcasts.

---

### 2025-01-24: REC TO SIMPLER on All Track Types

**Status**: Implemented

#### User Clarification

The user clarified that there should be TWO buttons:
1. **RecordButton** (global, top-right) - records external audio input only
2. **REC TO SIMPLER** (ClipCentralView, ALL track types) - routes track audio via send 0, then toggles arm/disarm

The REC TO SIMPLER button was initially only added to audio tracks, but it should be on ALL tracks since it captures the track's output audio regardless of whether it's MIDI or audio.

#### Changes Made

**1. Added `handleRecToSimpler` function** ([ClipCentralView.svelte:169-186](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L169))

```typescript
function handleRecToSimpler() {
    const trackIndex = session.selectedTrackIndex;
    if (trackIndex === null || trackIndex < 0) {
        logger.warn('No track selected for REC TO SIMPLER', { component: 'ClipCentralView' });
        return;
    }

    if (captureStore.isActive) {
        // Already recording/pending - disarm
        captureStore.disarm();
    } else {
        // Set send 0 to 1.0 to route track output to recorder return
        logger.info('Routing track audio via send 0', { trackIndex });
        send('/live/track/set/send', [trackIndex, 0, 1.0]);
        // Then arm capture
        captureStore.arm();
    }
}
```

**2. Moved button to consistent location** ([ClipCentralView.svelte:557-576](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L557))

After user feedback, moved button to top-right of ClipCentralView (above groove controls):
- Same position for ALL track types (MIDI and audio)
- Fixed height (`h-16` = 64px)
- Groove controls (SHUFFLE + BASE GRID) fill remaining space below

#### Behavior Summary

| Button | Location | What it does |
|--------|----------|--------------|
| RecordButton | Top-right sidebar (global) | Records external audio input (mic/guitar) directly |
| REC TO SIMPLER | ClipCentralView top-right (all tracks) | Sets send 0 to 1.0 (routes track output to recorder return), then arms capture |

#### Testing

1. Select any track (MIDI or audio)
2. REC TO SIMPLER button should appear at top-right of ClipCentralView
3. Tapping should:
   - Send `/live/track/set/send` [trackIndex, 0, 1.0] to route audio
   - Send `/capture/arm` to arm recording
4. When recording starts, track output flows through send 0 to recorder return
5. Tapping again:
   - Send `/live/track/set/send` [trackIndex, 0, 0.0] to turn off routing
   - Send `/capture/disarm` to stop recording

---

### 2025-01-24: Max Patch Wiring & Debugging

**Status**: Working

#### Max Patch OSC Routing

The capture commands come in on UDP port 11008 as OSC messages like `/capture/arm`. To route them to the v8 object:

```
[udpreceive 11008]
        |
[osc-route /capture]
        |
    (outputs /arm, /disarm, /start, /stop, /query)
        |
[route /arm /disarm /start /stop /query]
  |     |      |      |      |
 arm  disarm start  stop  query   <- message boxes
  |     |      |      |      |
  └─────┴──────┴──────┴──────┘
              |
        [v8 capture-engine.js]
```

Each outlet of `route` outputs a bang when matched. Connect message boxes containing the function names (`arm`, `disarm`, etc.) to convert bangs to the message the v8 expects.

#### v8 State Broadcast Routing

The v8 object has 2 outlets:
- **Outlet 0**: Existing messages (`/looping/capture/create_simpler`, LED updates)
- **Outlet 1**: UI state broadcasts (`/capture/state`, `/capture/quantization`, `/capture/file`)

Wire outlet 1 to `udpsend 127.0.0.1 11009` to send state back to the bridge.

#### Learnings: v8 Object Quirks

1. **Function name conflicts**: The `time` function seemed to conflict with something in v8. Added early stub definition and alias pattern:
   ```javascript
   // Early stub (line ~71)
   function time(value) { /* ignore */ }

   // Actual handler renamed to songtime (line ~368)
   function songtime(value) { ... }

   // Alias at end of file (line ~474)
   function time(value) { songtime(value); }
   ```

2. **LiveAPI not ready at load**: The LiveAPI returns invalid values (`id: 0`, values as `0` instead of arrays) when queried too early. Use `Task` to defer initialization:
   ```javascript
   var initTask = new Task(deferredInit);
   // In loadbang():
   initTask.schedule(100);  // 100ms delay
   ```

3. **autowatch**: Set `autowatch = 1;` at top of file to auto-reload when JS file changes. But sometimes Max caches old versions - send `reload` message to v8 or re-save the patch.

4. **live.observer "none" values**: When a `live.observer` can't read its property, it outputs `none` as a symbol. Guard against this:
   ```javascript
   if (typeof value !== 'number' || isNaN(value)) {
       return;
   }
   ```

#### Send Routing Fix

Updated `handleRecToSimpler` to reset send 0 to 0.0 when disarming:
```typescript
if (captureStore.isActive) {
    // Disarm and turn off send routing
    send('/live/track/set/send', [trackIndex, 0, 0.0]);
    captureStore.disarm();
} else {
    // Set send 0 to 1.0 to route track output
    send('/live/track/set/send', [trackIndex, 0, 1.0]);
    captureStore.arm();
}
```

---

### 2025-01-24: Hold Gesture for REC TO SIMPLER

**Status**: Implemented

#### Feature

Added tap vs hold gesture to REC TO SIMPLER button, matching the RecordButton behavior:
- **Short tap**: arm/disarm (respects global quantization)
- **Long hold (300ms)**: immediate start/stop (bypasses quantization)

#### Changes Made

**1. Added state variables** ([ClipCentralView.svelte:240-244](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L240))
```typescript
// Hold gesture for REC TO SIMPLER (tap = arm/disarm, hold = immediate start/stop)
let recToSimplerHolding = $state(false);
let recToSimplerHoldTimeout: ReturnType<typeof setTimeout> | null = null;
let recToSimplerHoldTriggered = $state(false);
const REC_HOLD_DURATION = 300; // ms for immediate start/stop
```

**2. Replaced onclick with pointer event handlers** ([ClipCentralView.svelte:171-228](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L171))

`handleRecToSimplerPointerDown`:
- Sets holding state and starts 300ms timeout
- On timeout: calls `start()` or `stop()` (bypass quantization), sets send routing

`handleRecToSimplerPointerUp`:
- Clears timeout
- If short tap (holding but not triggered): calls `arm()` or `disarm()` (quantized), sets send routing
- Resets holding state

**3. Updated button template** ([ClipCentralView.svelte:596-618](interface/src/lib/components/v6/central/views/ClipCentralView.svelte#L596))
- Changed from `onclick` to pointer events
- Added `select-none touch-manipulation` for better touch handling
- Same visual states as before

#### Behavior Matrix

| Gesture | Capture State | Action |
|---------|---------------|--------|
| Tap | idle | Set send 0 → 1.0, `arm()` (wait for beat) |
| Tap | pending | Set send 0 → 0.0, `disarm()` (cancel) |
| Tap | recording | Set send 0 → 0.0, `disarm()` (wait for beat to stop) |
| Hold 300ms | idle | Set send 0 → 1.0, `start()` (record immediately) |
| Hold 300ms | recording/stopping | Set send 0 → 0.0, `stop()` (stop immediately) |

#### Testing

1. Select any track
2. **Tap** REC TO SIMPLER → should show "ARM" (pending, waits for beat)
3. **Tap** again → should cancel and return to "REC TO SIMPLER"
4. **Hold** for 300ms → should show "REC..." immediately (no waiting for beat)
5. **Hold** again → should stop immediately
