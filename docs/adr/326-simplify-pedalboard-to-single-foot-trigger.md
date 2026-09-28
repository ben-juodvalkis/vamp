# ADR 326: Simplify Pedalboard to Single Foot Trigger

**Date**: March 17, 2026
**Status**: Accepted
**Supersedes**: [ADR 135: Abstracted Pedalboard Button Protocol](135-abstracted-pedalboard-button-protocol.md), [ADR 154: Simplified Pedalboard LED Architecture](154-simplified-pedalboard-led-architecture.md), [ADR 094: Wah Pedal Real-Time Control](094-wah-pedal-real-time-control.md)

---

## Context

The 10-pedal MIDI foot controller (SoftStep) has been removed from the live performance rig. Only a single foot trigger remains, used for two actions:

- **Tap**: Fire highlighted clip slot (session recording)
- **Hold (500ms)**: Create audio track with input routing

The previous system included:
- 10-pedal abstracted protocol (`/pedalboard/[0-9]/[on|off]`)
- Bidirectional LED feedback on port 11012
- Device-specific loading (Guitar Rig, Helix Native, Vocal, Wah)
- Device caches for real-time Wah control
- Double-tap detection for device loading
- Hold detection for track creation with per-pedal routing

This was ~250 lines of complexity serving hardware that no longer exists.

## Decision

Replace the entire pedalboard system with a single foot trigger using `/foottrigger/on` and `/foottrigger/off` messages on port 11010.

### What was removed

- **Global state**: `wahDeviceCache`, `guitarDeviceCache`, `bassDeviceCache`, `vocalDeviceCache`, pedal hold timers, double-tap detection
- **Functions**: `loadWahDevice()`, `loadGuitarDevice()`, `loadBassDevice()`, `loadVocalDevice()`, `handlePedalboardButton()`, `handlePedalWithHoldAndDoubleTap()`, `handleWahPedal()`
- **OSC routes**: `/pedalboard/[0-9]/[on|off]`, `/looping/wah/load`, `/looping/wah`
- **Device cache management** in `buildCompleteDeviceState`
- **Pedal-specific device loading** in `createAudioTrack` (Guitar, Vocal, Bass branches)
- **LED feedback**: Port 11012 pedalboard config removed from `constants.json`

### What was kept

- `handleFootTrigger()` (renamed from `handleFireCommand`) — tap/hold detection
- `/fire` OSC route — browser UI still uses this, calls same handler
- `pendingFootTriggerTrackRequest` — track creation with routing on hold
- Outlet 3 for AbletonOSC direct commands (routing, naming, arming)
- Outlet 2 kept as unused (`.amxd` wiring is external)

### Signal path

```
Utility Max Patch ── /foottrigger/on|off ── port 11010 ──► Central Max4Live (liveAPI-v6.js)
```

No return path (LED feedback removed).

## Files Changed

- `ableton/scripts/liveAPI-v6.js` — Core simplification (~250 lines removed)
- `config/constants.json` — Replaced `pedalboard` with `footTrigger`
- `config/constants.schema.json` — Updated schema
- `Max Patches/Max Utility 1.0.maxpat` — Simplified to single trigger (manual patching)
