# ADR-320: Ableton Move OSC Volume Control

## Status
**Superseded** (2026-04-21, ROW 5 of the m4l-to-python-v3 cleanup plan)

The original Max4Live handler has been replaced by
`SelectedTrackComponent.handle_relative_volume` in the Python
Control Surface. Wire address moved from
`/move/selected_track/volume` (port 11002, M4L) to
`/looping/v3/selected_track/volume_relative` (port 11020, Python
surface). Behavior preserved: `1` = +0.005, `127` = −0.005, clamp
to `[0.0, 1.0]`, master-track supported via the selected-track
observer. Move hardware must be reconfigured to send to
`127.0.0.1:11020` and use the new address. The rest of this ADR is
kept for historical context on the M4L-era design.

## Context
Ableton Move is a standalone hardware instrument that can send MIDI/OSC messages. We want to use Move's encoder to control the volume of the currently selected track in Live, providing hands-on mixing without touching the computer.

Move's encoder sends simple MIDI-style values over OSC: `1` for right turn (up), `127` for left turn (down) — one message per tick, no velocity scaling.

## Decision
Add a relative volume control handler in `liveAPI-v6.js` that receives OSC directly from Move on port 11002 (the existing Max observer UDP receive port). The handler reads the current volume via LiveAPI, applies a fixed step delta, and writes the new value back.

### OSC Message Format

| Field | Value |
|-------|-------|
| Address | `/move/selected_track/volume` |
| Arg 1 | `int` — `1` (volume up) or `127` (volume down) |
| Transport | UDP to `127.0.0.1:11002` |

### Step Size
`0.005` per tick (0.5% of fader range) — 200 ticks from silence to unity. Tuned for smooth control without overshooting.

## Changes

### Modified Files
- `ableton/scripts/liveAPI-v6.js`
  - Added `/move/selected_track/volume` handler in `anything()` dispatch
  - Added `adjustTrackVolumeRelative()` function — reads current volume, applies ±0.005 delta, clamps to 0.0–1.0

### Architecture Notes
- Move sends UDP directly to port 11002 — bypasses the OSC bridge entirely
- Uses existing `selectedTrackIndex` variable to target whichever track is selected in Live
- Master track supported (selectedTrackIndex = -1)
- No bridge routing changes needed since Move → Max is a direct UDP connection

## Consequences

### Positive
- Hands-on volume control from Move hardware during performance
- Zero latency path (direct UDP, no bridge hop)
- Reuses existing infrastructure (port 11002, selectedTrackIndex, LiveAPI volume path)

### Negative
- Move must be configured to send OSC to `127.0.0.1:11002`
- Fixed step size — no acceleration for fast turns (Move only sends 1/127)
- Additional `/move/` namespace in the OSC address space
