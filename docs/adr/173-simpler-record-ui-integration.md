# ADR-173: Simpler-Record UI Integration

## Status
Accepted

## Context

The Simpler-Record Max for Live device captures audio and loads it into a Simpler instrument. Previously, it was only controllable via:
1. Toggle button in the device UI
2. Footswitch (external pedal)

Users needed a way to control recording from the Looping iPad interface, with two distinct use cases:
1. **External audio capture** - Recording from mic/guitar input directly
2. **Track audio capture** - Recording a track's output (e.g., capture a synth performance)

## Decision

### Two UI Buttons

1. **RecordButton** (global, top-right sidebar)
   - Records from external audio input routed to the capture device
   - Always visible regardless of track selection

2. **REC TO SIMPLER** (ClipCentralView, all track types)
   - Routes track audio via send 0 to the capture return track
   - Available on both MIDI and audio tracks

### Gesture Interaction

Both buttons use the same tap/hold gesture pattern:

| Gesture | Action |
|---------|--------|
| **Tap** | Arm/disarm (respects global quantization) |
| **Hold 300ms** | Start recording immediately |
| **Release after hold** | Stop recording immediately |

This provides:
- Quick quantized recording via tap (syncs to beat boundaries)
- Immediate "punch" recording via hold (bypass quantization, record while held)

### OSC Protocol

**Incoming commands (port 11008):**
- `/capture/arm` - Arm (quantized start)
- `/capture/disarm` - Disarm (quantized stop)
- `/capture/start` - Start immediately
- `/capture/stop` - Stop immediately
- `/capture/query` - Request current state

**Outgoing state (port 11009):**
- `/capture/state [idle|pending|recording|stopping]`
- `/capture/quantization [name]` (e.g., "1/4", "1 Bar")
- `/capture/file [path]` - Last recorded file path

### State Machine

```
idle ──tap──> pending ──beat──> recording ──tap──> stopping ──beat──> idle
  │                                  │
  └──hold──> recording ──release──> idle
```

## Implementation

### Looping Repo

| File | Changes |
|------|---------|
| `interface/bridge/routing/messageRouter.js` | Route `/capture/*` to port 11008 |
| `interface/bridge/enhanced-osc-bridge.js` | Add sequencer port listener for 11009 |
| `interface/src/lib/stores/v6/captureStore.svelte.ts` | State management |
| `interface/src/lib/api/simpleClient.ts` | Message routing |
| `interface/src/lib/components/v6/controls/RecordButton.svelte` | Global button |
| `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` | Per-track button |
| `interface/src/routes/+page.svelte` | Layout |

### Simpler-Record Repo

| File | Changes |
|------|---------|
| `code/capture-engine.js` | State machine, OSC handlers, UI broadcast |
| `.amxd` patch | Add udpreceive 11008, udpsend 11009, routing |

## Consequences

### Positive
- Recording controllable from iPad without switching to Ableton
- Hold gesture provides immediate recording without quantization delay
- State synchronization keeps UI in sync with device state
- Works with both external input and track audio routing

### Negative
- Requires Max patch modifications (manual wiring)
- Adds OSC protocol dependency between UI and device

## References

- Implementation log: [ADR-453](453-simpler-record-ui.md)
- Simpler-Record repo: `https://github.com/ben-juodvalkis/Simpler-Record`
