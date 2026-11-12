# ADR-533: Setlist octave buttons step the Octave rack

## Status
**Accepted** (2026-11-12), on the `cyborg` branch only. Extends ADR-519.
Needs a Live restart for the surface part.

## Context

Ben added a MIDI Effect Rack named `Octave` in front of the instrument rack on
the `Keys` track. Its macro 1 picks one of five chains, named `-2` to `2`, over
0..127. He wants buttons on the setlist page to step it up and down, back to 0
on every song or sound change.

Measured on the rig (2026-11-12): the rack is `MidiEffectGroupDevice` at device
0. Its macro 1 is named `Chain Selector`, and Live labels 0, 31.75, 63.5, 95.25
and 127 as chains 0 to 4. The set held 62, which Live shows as chain 2.

## Decision

The rack is found by class and name (`Octave`), and the control is its macro 1,
whatever that macro is called. Octave n is written as the macro value at chain
n + 2, so each step lands in the middle of its chain's range. A value moved in
Live reads as its nearest chain.

The page sends `+1` or `-1`, not a target. The surface steps from what Live
holds and clamps at ±2, so a stale page cannot jump two octaves. The page shows
only Live's answer, as it does for sounds.

A song or sound change sets it to 0 in the same undo step as the switch.
Tapping the sound already on changes nothing, so the octave stays.

The control is − value + at the bottom of the left column, under the sounds.
The pads extend down beside it. A set with no Octave rack shows it dimmed.
