# ADR-524: Device Families Mean What They Say

## Status
**Accepted** (2026-11-11). Amends ADR-400 (device family inks): two new
families and a reassignment. Interface only; no Live restart.

## Context
ADR-400's eight family inks had drifted. Devices were moved for a local
reason (to tell two apart inside a shared view): Chorus was azure, Phaser
and GlitchLoop rose, Comb and Velocity gold, Bass Amp and Pitch Shift
violet. Modulation's magenta held Auto Pan alone, and violet, the MIDI
effects' colour, held two audio effects. With the palette (ADR-523)
showing every family side by side as coloured blocks, the colours had to
say what the devices do.

## Decision
- **Modulation (magenta)**: Chorus, Phaser, Auto Pan.
- **Time and space (teal)**: Echo, Reverb, Delay, Grain Delay, Comb and
  Blur.
- **MIDI (violet)** holds MIDI effects and nothing that processes audio:
  Arpeggiator, Chord, Random, Random Octave, Velocity, Note Chance,
  Permute.
- **Glitch (new, green H135, `#79c24a`)**: GlitchLoop, Stutter (Beat
  Repeat), Pitch Hack, Pitch Shift.
- **Guitar (new, amber H62, `#d38c49`)**: Guitar, Bass Amp, Wah.
- Both new inks are fixed points of the ink chain, which the fixed-point
  test in `trackFormatters.test.ts` checks for every family.
- **The + Effect browser's sections** read the same families from folder
  names (`browser/utils/sectionInks`), which now know Glitch and Guitar.
  Ben's effects folder was rearranged to match: Comb.amxd moved from
  Modulation to Time, Pitch Shift.amxd from Utility to Glitch and
  Blur.amxd from Glitch to Time (each first copied into the projects whose
  sets use it). Every folder now
  wears the colour its devices wear on the chain.

## Consequences
- Guitar and Bass Amp share an ink, so the Guitar view no longer tells
  their controls apart by colour.
- The amber sits near the distortion orange; the palette's seams keep the
  two blocks apart.
- Rose is left to racks the app does not know and the Vocal rack.

## Tags
`color`, `device-families`, `palette`
