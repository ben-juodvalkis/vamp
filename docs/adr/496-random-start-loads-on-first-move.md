# ADR-496: Random Start Loads on the Random Slider's First Move

## Status
**Accepted** (2026-11-01). Supersedes [ADR-378](378-random-start-device-observer.md).
The interface takes it when the page next loads; the surface after a full
Live restart.

## Context
ADR-378 had the surface prepend `random-start.amxd` ahead of every Simpler
the moment one appeared (`DeviceInitComponent`'s pass 2 on
`on_device_added`), by any path: a capture, audio clip to Simpler, a browser
load, a Simpler kit's pads. Most Simplers never use it, so most tracks
carried a device that did nothing, shown in the effect chain, and every
capture waited for the prepend before acknowledging (`_ACK_SETTLE_TICKS`).
Ben, 2026-11-01: load it only when the Random slider in the Simpler view
moves, and never show it in the effect chain.

## Decision
- **The surface no longer prepends it.** `DeviceInitComponent` keeps only
  its init rules and the AU-plugin retry; `SimplerLoadComponent` loses
  `ensure_random_start`, the Random Amount zeroing, and the ack's wait for
  the prepend (the ack goes out at once, naming the Simpler where it sits);
  `live_library.RANDOM_START_REL` goes.
- **The Simpler view loads it.** The Random slider is always drawn, a ghost
  while the track has no Random Start. Its first drag sends `device/load`
  for the track with `place:Vamp Devices` and `random-start/random-start.amxd`
  (`constants.devices.randomStart`); Live puts a MIDI effect at the head of
  the chain, ahead of the Simpler. The value the drag reached is written as
  soon as the device shows up (it arrives at its default, 50 %). One load
  per track until it lands or 5 s pass; another track forgets the wait.
- **It is never drawn as a device:** it is an entry of
  `constants.devices.hiddenFromChain` (with REC's recorder, ADR-495), so the
  chain overview gives it no cell and the strip's band never shows it, and a
  chain drag moves by Live's own index, so the hidden head device cannot
  shift where a dragged device lands.

## Consequences
- A Simpler arrives alone; captures and audio-to-Simpler acknowledge a tick
  sooner.
- Tracks that already carry Random Start keep it; the slider drives it as
  before.
- A Simpler kit's pads no longer get one; nothing in the interface used a
  pad's Random Start.
- The first move of the slider waits for a load (about 0.1 s for
  `load_item`) before it changes anything; the value is not lost.

## Tags
`random-start`, `simpler`, `device-chain`, `hidden-devices`, `surface`
