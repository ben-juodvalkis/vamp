# ADR-537: The Bridge Reads the MIDI Controllers; Max Never Opens

## Status
**Accepted** (2026-11-13). Replaces the standalone Max Utility patch
(`owner/Max Patches/Max Utility 1.0.maxpat`, kept as history) and the
`features.maxUtilityPatch` switch, now `features.midiControllers`. Ends the
Max device leg of ADR-423 (ports 11018/11019, `/totalmix/hello`,
`/totalmix/<channel>`). Moves where ADR-432's pad hold is timed. No Live
restart: the surface is untouched. Its piano pedal is superseded by
ADR-538, which moved every pedal into the bridge as one Pedals card.

## Context
`npm run ipad` and `npm run dev` opened standalone Max on the rig only to
run one patch: MIDI in from the Move, a piano and the SoftStep/EV-1, OSC out
to the surface and the bridge. Ben asked to stop running Max, and on
2026-11-13 marked each of the patch's jobs keep or cut:

| Job | Decision |
|---|---|
| Find and listen to MIDI devices | Keep |
| Move pad hold (ADR-432) | Keep |
| Move CC 71 → selected track volume | Keep |
| Move CC 75–78 → TotalMix room, playback, click, phones | Keep |
| Piano pedal, CC 67 from any input → foot tap/hold | Keep, CC settable in Settings |
| Move CC 72 → drum chain volume (ADR-412) | Cut |
| Startup sysex to the Move | Cut |
| MIDI out to the SoftStep and Move | Cut (unused) |
| SoftStep/EV-1/keyboard passthrough into Live | Cut |
| Scale mode on CC 51 | Cut (no longer used) |
| Max's level sliders and audio-on | Cut |
| Opening Max at startup | Cut |

## Decision
**The bridge opens every MIDI input on the Mac itself**
(`transport/MidiInputs.js`, `@julusian/midi`, the RtMidi binding the
patch's Node for Max hub already used) and runs the kept jobs as plain
JavaScript (`handlers/midiControllers.js`), only while
`features.midiControllers` is on. Off, the library is never loaded, so the
bundled general edition carries no native binary in practice; it is an
optional dependency.

- **Inputs.** All of them, re-listed every `midiControllers.pollMs` and
  reopened when the list changes (RtMidi reports no hot-plug). CoreMIDI
  lets several clients read one source, so Live's Move script keeps the
  Move Live Port while the bridge reads it too.
- **Move** (`midiControllers.move`): only `Ableton Move Live Port`. Pad
  hold as ADR-432, with the hold time now read from
  `ui.gestures.momentaryHoldMs` instead of a hand-copied 300. CC 71's raw
  value to `/looping/v3/selected_track/volume_relative`, as before. CC
  75–78 nudge their TotalMix channel 0.1 dB per click straight through the
  bridge's TotalMix link, from its cached level; a channel with no level
  yet is left alone (Max's slider started at 0 dB).
- **Piano pedal** (`midiControllers.pianoPedal`): any input but the Move,
  any channel, pressed above 64, tap or hold at
  `osc.footTrigger.holdThresholdMs`. A user setting like the foot switch:
  on/off and Learn on the Settings page's new **Piano pedal** card, saved by
  the bridge to `logs/piano-pedal.json`, CC 67 until one is saved. Wire:
  `/bridge/piano_pedal [json]` out (on change and with the 5 s ping),
  `/bridge/piano_pedal/enabled` and `/bridge/piano_pedal/learn` in.

## Consequences
- Max no longer opens with Vamp. Live's MIDI preferences need one change on
  the rig: the SoftStep, EV-1 and keyboard reach Live directly as inputs,
  not through Max's `to Max` port.
- The Move's CC 72 knob does nothing. The surface's drum-chain handler
  stays; nothing sends to it.
- The Move no longer gets the patch's startup sysex. If the Move stops
  sending its Live Port messages without it, that sysex comes back.
- Not measured yet: the Move pads, knobs and piano pedal on the rig. The
  logic is covered by `midiControllers.test.ts`, and the inputs were opened
  and closed on the rig with no Max patch involved.

## Tags
`midi`, `move`, `piano-pedal`, `totalmix`, `max`, `bridge`, `feature-switch`
