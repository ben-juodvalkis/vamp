# ADR-507: Wavetable's two filters on one pad, with its routing

## Status
**Accepted** (2026-11-05)

## Context

The Wavetable view showed one filter at a time: a filter XY pad, an FLT 1/2
badge flipping it between Filter 1 and Filter 2, then that filter's type and
slope. Live's own panel draws both filters on one graph, a numbered dot each,
and names how they combine: Serial, Parallel or Split. Ben asked for the same.

Live exposes the routing as the device property `filter_routing`, settable
with a listener (device dump). Its values were read off the running Live
12.4.25b1 with the `py_introspect` probe (`Live.WavetableDevice.FilterRouting`):
serial 0, parallel 1, split 2.

## Decision

- **One pad, two dots** (`wavetable/WavetableFilterGraph.svelte`). Cutoff
  across on Live's 20 Hz to 20.48 kHz log sweep, resonance up. A press grabs
  the nearer dot and the drag moves only that filter, switching it on if it
  was off. Filter 1 wears Osc 1's orange and Filter 2 Osc 2's blue, so Split
  reads oscillator to filter. The touched filter's dot is filled and the other
  is a ring. A filter that is off is a dashed ring and draws no curve.
- **Curves by routing** (`utils/wavetableFilterGraph.ts`, pure): Serial is one
  curve, the two responses multiplied (dB summed); Parallel and Split are each
  filter's own curve.
- **A Serial | Parallel | Split row** under the pad writes `filter_routing`
  through the property channel. The surface allowlists it
  (`InstrumentVector`, writable int).
- **The rows below edit the filter last touched**: type and slope share one
  row, in that filter's ink. The FLT 1/2 badge is gone.

## Consequences

- The routing needs a surface that allowlists `filter_routing`: a full Live
  restart. Until then the row's writes are refused and it reads Serial.
- A filter's dot sits at its resonance, not on its curve, so the dot stays
  under the finger.

## Tags
`wavetable`, `filter`, `filter-routing`, `central-view`, `property-channel`
