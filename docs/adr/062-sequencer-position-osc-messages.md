# ADR 053: Sequencer Position Updates via Direct OSC Messages

**Date:** 2025-10-15
**Status:** Implemented
**Context:** Sequencer current step indicator updates

## Problem

The sequencer device has two independent 8-step sequencers (mute and pitch) that run at different rates. The current step position needs to update in real-time during playback to provide visual feedback.

Under the complete state architecture (ADR-040), device parameters are only queried once per track switch. However, sequencer position changes continuously during playback and cannot use the query-based approach.

### Initial Approach (Failed)

Parameters 9 and 20 in the Max device stored `muteCurrentStep` and `pitchCurrentStep`:
- ❌ Required parameter observers for real-time updates
- ❌ Violated complete state architecture
- ❌ Added unnecessary overhead (2 parameters × continuous updates)
- ❌ Created confusion between "queried state" and "live state"

## Decision

**Remove position parameters from the Max device** and send position updates as **direct OSC messages** from the sequencer's internal clock logic.

### Architecture

```
Max Sequencer (bang-driven clock)
  ↓ Step advances
Check if track is selected
  ↓ Yes
Send /looping/sequencer/mute/position [step]
Send /looping/sequencer/pitch/position [step]
  ↓ UDP port 11003
Enhanced OSC Bridge
  ↓ WebSocket
simpleClient.ts
  ↓ Route /looping/sequencer/*
sequencerStore.handleMutePositionUpdate(step)
sequencerStore.handlePitchPositionUpdate(step)
  ↓ Update $state
SequencerPatternGrid (reactive)
  ↓ Highlight current step
```

## Implementation

### Max Device Changes

**Removed:**
- Parameter 9: `muteCurrentStep`
- Parameter 20: `pitchCurrentStep`

**Added:**
```max
[bang from mute clock]
|
[int muteStep]
|
[prepend /looping/sequencer/mute/position]
|
[udpsend 127.0.0.1 11003]

[bang from pitch clock]
|
[int pitchStep]
|
[prepend /looping/sequencer/pitch/position]
|
[udpsend 127.0.0.1 11003]
```

**Track selection check:** Only send when device is on currently selected track (reduces OSC traffic).

### Parameter Index Updates

**Before (22 params):**
- 1-8: Mute steps
- 9: Mute currentStep ❌ DELETED
- 10: Mute length
- 11: Mute rate
- 12-19: Pitch steps
- 20: Pitch currentStep ❌ DELETED
- 21: Pitch length
- 22: Pitch rate

**After (20 params):**
- 1-8: Mute steps
- 9: Mute length (was 10)
- 10: Mute rate (was 11)
- 11-18: Pitch steps (was 12-19)
- 19: Pitch length (was 21)
- 20: Pitch rate (was 22)

### Frontend Changes

**simpleClient.ts** (`interface/src/lib/api/simpleClient.ts:397-413`):
```typescript
else if (address === '/looping/sequencer/mute/position') {
    console.log('[Sequencer] 🎵 Mute position update:', args[0]);
    if (args.length >= 1) {
        import('../stores/v6/sequencerStore.svelte').then(({ sequencerStore }) => {
            sequencerStore.handleMutePositionUpdate(args[0]);
        });
    }
}
else if (address === '/looping/sequencer/pitch/position') {
    console.log('[Sequencer] 🎹 Pitch position update:', args[0]);
    if (args.length >= 1) {
        import('../stores/v6/sequencerStore.svelte').then(({ sequencerStore }) => {
            sequencerStore.handlePitchPositionUpdate(args[0]);
        });
    }
}
```

**sequencerStore.svelte.ts** (`interface/src/lib/stores/v6/sequencerStore.svelte.ts:271-298`):
```typescript
// Real-time position updates from Max sequencer
handleMutePositionUpdate(step: number) {
    if (!device) return; // Only update if sequencer is active
    if (step < 0 || step > 7) {
        console.warn('[SequencerStore] Invalid mute step:', step);
        return;
    }
    muteCurrentStep = step;
},

handlePitchPositionUpdate(step: number) {
    if (!device) return;
    if (step < 0 || step > 7) {
        console.warn('[SequencerStore] Invalid pitch step:', step);
        return;
    }
    pitchCurrentStep = step;
}
```

**Updated parameter indices:**
```typescript
export const SEQUENCER_PARAMS = {
  muteSteps: Array.from({ length: 8 }, (_, i) => ({ index: i + 1, type: 'bool' })),
  muteLength: { index: 9, type: 'int', min: 1, max: 8 },      // was 10
  muteRate: { index: 10, type: 'int', min: 0, max: 7 },       // was 11
  pitchSteps: Array.from({ length: 8 }, (_, i) => ({ index: i + 11, type: 'bool' })),
  pitchLength: { index: 19, type: 'int', min: 1, max: 8 },    // was 21
  pitchRate: { index: 20, type: 'int', min: 0, max: 7 }       // was 22
};
```

## Trade-offs

### What We Gained
- ✅ **Cleaner architecture** - Separate concerns: parameters (queried) vs live updates (streamed)
- ✅ **Reduced parameter count** - 22 params → 20 params
- ✅ **Independent update rates** - Mute and pitch send at their own rates
- ✅ **Selected-track optimization** - Only sends when visible
- ✅ **No parameter observers needed** - Direct message flow
- ✅ **Explicit semantics** - `/looping/sequencer/mute/position` is clearer than "param 9"

### What We Lost
- Nothing significant - Position was never meant to be a "set" parameter anyway

## Pattern: Live State vs Queried State

This establishes a pattern for other similar cases:

**Use Complete State (query-based):**
- User-settable parameters (length, rate, steps on/off)
- Device settings (filter freq, reverb size, etc.)
- State that persists in Ableton project

**Use Direct OSC Messages (event-based):**
- Continuously changing values (position, time, meters)
- Read-only indicators
- High-frequency updates during playback
- State that doesn't persist

## Performance

**Message Frequency:**
- Mute: 1/16 to 8 bars (depends on rate setting)
- Pitch: 1/16 to 8 bars (depends on rate setting)
- Only when track is selected
- Total: ~2-120 messages/minute (negligible)

**Impact:** Minimal - UDP messages are cheap, and frequency is controlled by musical timing.

## OSC Port Reference

```
Max Sequencer → UDP 127.0.0.1:11003 (Max Observer input)
  ↓
Enhanced OSC Bridge (maxObserverPort)
  ↓
WebSocket 8080
  ↓
Interface (simpleClient.ts)
```

**Port 11003** is the correct port for Max devices sending to the bridge. Port 11002 is for the opposite direction (bridge → Max).

## Future Enhancements

Other potential live-update candidates:
- Clip playback position (for waveform scrubbing)
- LFO position visualization
- Envelope follower displays
- Step sequencer note velocity editing (if implemented)

## References

- Related: ADR-040 (Complete State Architecture)
- Bridge routing: `interface/bridge/enhanced-osc-bridge.js:521-525`
- OSC config: `config/constants.json` (maxObserver section)
