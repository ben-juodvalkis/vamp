# ADR-422: Pedal MIDI Direct to the Control Surface (USB, no Max)

## Status
**Accepted** (2026-08-27)

## Context

The foot switch and the wah pedal reached the Python surface through
two Max ctlin→OSC bridges: `owner/Max Patches/foot-trigger.js` (inside the
Utility patch — CC 67 edge → 500ms tap/hold timer → `/looping/v3/foot/*`)
and the operator's personal wah patch (CC 82 toe / CC 11 expression →
`/looping/v3/wah/*`), both `udpsend 127.0.0.1 11020`. The pedal is
moving from Bluetooth MIDI to USB, which makes its port assignable as
the Looping control surface's own MIDI **Input** in Live's preferences
— so Max-as-transport is no longer needed for it.

The gesture *semantics* already live surface-side
(`FootTriggerComponent`, `WahPedalComponent`, ADR-326/ADR-407); the Max
layer carried only transport plus the foot pedal's tap/hold timing —
the one piece of logic Max still owned, hardcoded and untestable in
ES5.

## Decision

Receive the pedal CCs in the surface itself; keep the OSC wires as the
fallback path.

- **`components/midi_pedal_input.py` (`MidiPedalInput`)** — plain
  Python (no LOM, no framework; injected callbacks/scheduler/clock,
  pytest-covered): CC parsing scoped to the pedal's channel
  (`midiPedals.channel`; `0` restores the omni parsing the Max `ctlin`
  did), edge detection (both switches press at value≥64 and release
  below it — the standard MIDI switch convention; the foot switch
  originally mirrored the Utility patch's literal `> 0` edge, which
  latched down on a pedal whose "off" is a low non-zero value, amended
  2026-08-27), and a faithful port of foot-trigger.js's tap/hold
  state machine — press debounce, hold-suppresses-tap, plus a press-
  sequence guard (`schedule_message` can't be cancelled) and a
  release-time clock check that keeps the tap/hold boundary exact at
  the threshold despite the scheduler's ~100ms tick granularity.
- **`LoopingSurface`** overrides `build_midi_map` (forward the owned
  CCs on the pedal's channel via `Live.MidiMap.forward_midi_cc`, the
  adapter naming both the CCs and the channels — with the empty
  element tree the base class claims no MIDI at all) and
  `receive_midi` / `receive_midi_chunk` (owned CCs → adapter inside
  `component_guard`; everything else → base class). All failure paths
  log and fall through — a pedal bug can't take down the surface.
- **Gestures call the existing OSC handlers**
  (`handle_tap` / `handle_hold` / `handle_engage` / `handle_freq`,
  `source_addr="midi:pedal-input"`), so `/looping/v3/foot/*` and
  `/looping/v3/wah/*` stay live and the semantics keep one owner.
- **Config**: channel + CC map in `constants.midiPedals`. The USB
  pedal transmits everything on **channel 10** — trigger switch
  **CC 23**, wah toe switch **CC 21**, expression **CC 20** (amended
  2026-08-27, measured off the pedal itself; the 67 / 82 / 11 above are
  what the retired Bluetooth rig sent into the Max patches, and
  `owner/Max Patches/foot-trigger.js` still hardcodes 67 for that fallback).
  The hold boundary reuses `osc.footTrigger.holdThresholdMs` (ADR-326's
  home for it — foot-trigger.js mirrors it hardcoded because Max ES5
  can't read JSON).
- **Live prefs** (documented in setup.md): Looping surface Input = the
  pedal's USB port, Output None, the port's Track/Remote switches off.

`midi-remap.js` is out of scope and stays in Max: it re-injects MIDI
into Live's track routing (passthrough), which a control surface
script cannot do.

## Consequences

- One less process in the signal path for pedal gestures (and no BLE
  radio latency): pedal → Live → surface, no Max, no UDP hop.
- The tap/hold timing is unit-tested for the first time
  (`tests/test_midi_pedal_input.py`); Max's ms-accurate `Task` timing
  is replaced by scheduler-tick + clock-check timing with an exact
  boundary at the threshold. Hold can fire up to ~100ms late
  (tick granularity) when the pedal is still down — imperceptible for
  a create-track gesture.
- Both delivery paths must not listen to the same pedal at once
  (double-fire); the Max patches remain on disk as the
  wireless/legacy fallback. Since the USB pedal moved to channel 10 /
  CC 23-21-20 and the Max chains still watch CC 67 / 82 / 11, the two
  no longer collide by accident — but re-pointing either side at the
  other's CCs brings the double-fire back.
- Channel scoping (added with the CC remap) means the surface claims
  only what it acts on, so the pedal's port can carry other controller
  traffic without it being read as a gesture. The pre-existing omni
  behavior is still reachable via `midiPedals.channel: 0`.
- The surface is no longer a "no MIDI I/O" script: `build_midi_map` /
  `receive_midi` are now load-bearing. The framework halves are thin
  and defensive because they can't run under pytest.

## Addendum (2026-09-25): CC 67 is the piano-pedal looper, and it stays

The Utility patch's CC 67 chain was described above as the "wireless/legacy
fallback" for the retired Bluetooth rig. It is not dead: at the home studio
the owner loops with the piano's own pedal, which reaches the chain because
its `ctlin` hears every input on every channel. It stays, as that.

- The chain edges at `> 64` (the owner's Max save, 462821d), not the `> 0`
  that latched on a pedal whose "off" is a low non-zero value.
- A number box in the patch window feeds `route 67`'s right inlet, so the CC
  can be moved (say, to sustain, 64) without editing the patch.
- It never double-fires against the USB pedal: channel 10 / CC 23 goes to
  the surface, CC 67 to Max.
- The omni `ctlin` is the hazard on anyone else's Mac (a digital piano's soft
  pedal fires looper taps), so the patch is owner-only: it opens only while
  `features.maxUtilityPatch` is on (general-release audit §7b), and the
  general edition's example config has it off.

## Tags
`pedal`, `foot-trigger`, `wah`, `midi`, `control-surface`, `max-removal`
