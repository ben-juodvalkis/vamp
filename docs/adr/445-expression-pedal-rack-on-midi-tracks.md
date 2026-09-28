# ADR-445: The expression pedal drives the wah on audio tracks and the Expression Pedal rack on MIDI tracks

## Status
**Accepted** (2026-09-19; extends ADR-407 and ADR-422, the pedal on the surface; ADR-437, placement by the load)

## Context

The expression pedal (ADR-407, ADR-422) had one target: the Wah rack.
Its toe switch loaded `Wah.adg` onto the selected track or stepped the
rack's chains, and its sweep wrote the rack's frequency macro — on any
track, a full heel-to-toe rock summoning the rack where there was none.
That workflow is the one the operator wants kept.

The ask (2026-09-19) was a second use for the same pedal: on an
instrument, a mod wheel — CC 1 into the synth. The interface already has an
on-screen Mod wheel that reaches instruments through the Max Utility
patch's OSC→MIDI converter, but that route lands the CC on whichever track
is armed, needs the patch open, and cannot see the pedal at all: since
ADR-422 the pedal's port is the control surface's own input, so only the
surface reads it. Whatever the pedal means, the surface decides.

The operator built the target: **`Expression Pedal.adg`**, a MIDI Effect
Rack with the wah's macro layout — Macro 1 the value, Macro 2 the chain
selector — each chain holding a Max device that sends one controller (mod
wheel, expression, …) to the instrument behind it. Because the layout is
the wah's, the surface can drive it with the code it already has.

## Decision

**1. Two racks, chosen by the kind of track under the selection.**
`WahPedalComponent` reads `track.has_midi_input` and resolves a target: an
audio track gets the Wah (`constants.devices.wah`), a MIDI track the
Expression Pedal rack (`constants.devices.expressionPedal`, the same keys).
Both gestures act on that target — the toe switch loads it or steps Macro 2
through its chains with ADR-407's step table, the sweep writes Macro 1, and
a full heel-to-toe rock on a track without its rack loads it. The wah's
behavior on audio tracks does not change. A rig without the
`expressionPedal` block behaves exactly as before: the wah everywhere.

**2. A wah already on the track wins, on either kind.** That is the one
way a wah goes on a synth track: the pedal never summons one there by
gesture. The Pedal central view gains a **Wah button** — its last column,
lit while the track carries a wah — whose tap loads `Wah.adg` through the
FX tiles' `device/load` and whose hold removes it through `device/delete`
(the verb's first UI sender). While the wah is there the pedal is the wah;
remove it and the pedal is the rack again. The state lives in the set, as a
device on the chain, so it survives a save and a reload and needs no
session toggle.

**3. The wah lands in one place from both doors.** `DeviceLoadComponent`
takes `head_preset_paths` — the wah preset — and a wire-level track load
of it selects the track's first audio effect and sets the device insert
mode "left of the selection" for the call, as the pedal's own load does
(ADR-437). Never a move: undoing the move of a device Live had just loaded
aborts Live. The MIDI rack takes the plain load; Live places a MIDI effect
ahead of the instrument on its own.

**4. The pedal re-resolves on any device-list change.** `LoopingSurface`
fans `LOMListeners`' add/remove callbacks out to
`WahPedalComponent.on_track_devices_changed`, which drops the cached macro,
the load-in-flight guard and any half-sweep. A wah the button just loaded
takes the pedal over on the next frame without a track switch; a rack the
pedal loaded is found the moment Live shows it. Pure Python state inside
the notification, one chain walk per structural change; the selected track
is not told apart by identity because the resolve decides anyway.

**5. The addresses keep their name.** `/looping/v3/wah/engage` and
`/looping/v3/wah/freq` are the pedal's wires, whichever rack they land on.
No new address, no arity change, no protocol bump.

## Consequences

- On a MIDI track the pedal can no longer summon a wah by gesture; a full
  rock there is a full mod-wheel sweep. The button is the deliberate act.
- An Expression Pedal rack on an audio track is not the pedal's: there the
  pedal looks for the wah. A MIDI track cannot hold one of those by
  mistake, so guitar and mic tracks are untouched by construction.
- The rack's chains are the operator's: add a chain in Live and the toe
  switch steps to it, the step table being `len(chains)`. One thing to
  verify on the rig, not in the tree: a rack's chain selector gates a
  chain's *input*, and a Max device that emits on a knob change may still
  send from an unselected chain — if it does, every chain fires on each
  sweep and the device has to check its own chain is selected. Also to
  measure: the latency from the surface's macro write to the CC reaching
  the instrument, expected to be a few milliseconds.
- Undo: a sweep writes a macro through the LOM on either rack, the same
  cost the wah sweep has always had.
- Config: `constants.devices.expressionPedal` (`presetPath`, `className`
  `MidiEffectGroupDevice`, `deviceName` `Expression Pedal`,
  `freqMacroIndex` 1, `toggleMacroIndex` 2, `sweepLoadMargin` 2). Live
  names a loaded `.adg` after its file, which is what the name match
  relies on.
- Tests: the ADR-445 block of `test_wah_pedal_component.py`, the wire-level
  head tests in `test_device_load_component.py`, the Wah button cases in
  `PedalCentralView.test.ts`. Docs: `surface/CLAUDE.md` (the wah section),
  `wire-protocol.md` §2.10.1 and the `device/load` / `device/delete` rows,
  `toggles.md`, `architecture.md` §2.4, `setup.md`, the v6 components
  `CLAUDE.md`.

## Tags
`pedal`, `wah`, `expression`, `mod-wheel`, `midi-effect-rack`, `control-surface`, `pedal-central-view`, `extends-407`, `extends-422`
