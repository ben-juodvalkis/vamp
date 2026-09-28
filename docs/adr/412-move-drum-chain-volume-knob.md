# ADR-412: Move Drum-Chain Volume Knob

## Status
**Accepted** (2026-08-02)

## Context
The Ableton Move's first encoder (CC 71 ch 1) already nudges the
selected track's volume: `Max Utility 1.0.maxpat` converts the CC to
`/looping/v3/selected_track/volume_relative [1|127]` fired straight at
the Python surface's UDP port (11020), and
`SelectedTrackComponent.handle_relative_volume` applies
±`MOVE_VOLUME_STEP` (ADR-320, superseded to the Python surface in
ROW 5).

We want the same hands-on gesture one level deeper: while playing a
drum rack, turn a knob to balance the **individual drum sound you last
touched** — the selected drum pad's chain — without reaching for Live
or the iPad. Live already tracks that context for us:
`RackDevice.View.selected_drum_pad` follows pad taps (from Live's UI or
a pad controller), and each pad's chain carries its own
`ChainMixerDevice.volume`.

## Decision
Clone the track-volume knob lane end to end, one knob over (CC 72 ch 1
— Move encoders send CC 71–78; 75–78 are taken by TotalMix controls,
leaving 72/73/74 free).

### Wire

| Field | Value |
|-------|-------|
| Address | `/looping/v3/selected_track/drum_chain/volume_relative` |
| Arg 1 | `int` — `1` (up) or `127` (down), one message per encoder tick |
| Transport | Max → UDP `127.0.0.1:11020`, no bridge, no `trackPath` |

Max side: a `route 72` cluster in `Max Utility 1.0.maxpat` mirroring
the CC-71 cluster (`r midi_from_move` → `route cc` → `route 1` →
`route 72` → `prepend <address>` → `udpsend 127.0.0.1 11020`).

### Surface

`SelectedTrackComponent.handle_drum_chain_relative_volume` — the
surface owns all context (same doctrine as the wah pedal, ADR-407):

1. `song.view.selected_track` — the knob follows the track in view.
2. First device with `class_name == "DrumGroupDevice"` (top-level scan,
   the same depth/match `instrumentService` and `WahPedalComponent`
   use). None → **silent drop** with a one-shot INFO line.
3. Chain resolution from the rack's view state:
   - `selected_drum_pad` → `pad.chains[0]` when the pad has content.
   - An **empty** selected pad drops the message — deliberately no
     fallback, because `selected_chain` still points at the
     *previously* selected pad's chain in that state, and nudging a
     pad the user didn't select is worse than doing nothing.
   - `selected_chain` is consulted only when `selected_drum_pad` is
     `None` (general-rack safety; drum racks essentially always have a
     selected pad).
4. `chain.mixer_device.volume` ± `MOVE_VOLUME_STEP` (0.002 — same feel
   as the track knob), clamped `[0.0, 1.0]`, written directly (OSC
   handlers run on the surface tick, not inside an LOM notification,
   so no deferred write needed).

Gated by the existing `move_volume_knob` session toggle — one switch
parks both Move encoders. Malformed args reject on
`/looping/v3/error`; context misses (wrong track type in view, empty
pad) stay silent because they're normal performance states and the
encoder fires at tick rate — error-emitting would spam Log.txt.

No echo on success: chains aren't modeled in the v3 tree, so no UI
consumer exists; Live's own chain mixer UI reflects the write.

## Consequences

### Positive
- Per-drum-sound balancing from hardware mid-performance: tap a pad,
  turn the knob.
- Zero new state: Live's own pad-selection tracking is the targeting
  mechanism; the surface stays stateless (re-resolves per tick, no
  cache to invalidate on selection change).
- Same wire shape, gate, step, and error posture as the sibling knob —
  one mental model for both encoders.

### Negative
- Another Move-side CC pinned (72), leaving 73/74 as the last free
  encoders on ch 1.
- Top-level `DrumGroupDevice` scan only — a drum rack nested inside an
  Instrument Rack isn't found. Acceptable: this system loads drum racks
  as top-level track instruments (same assumption the UI's
  `instrumentService` makes).
- Per-tick device walk (no caching). Fine at encoder rate (~10s of
  msgs/sec against a handful of devices); revisit with the wah-style
  cached-ref pattern only if profiling ever says so.

## Tags
`ableton-move`, `drum-rack`, `chain-volume`, `hardware`, `osc`,
`selected-track`
