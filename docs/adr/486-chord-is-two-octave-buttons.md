# ADR-486: Chord Is Two Octave Buttons

## Status
**Accepted** (2026-10-27). Replaces the Chord's Shift slider of ADR-479's
control table. No Live restart: interface only.

## Context
The Chord's chain cell and browser tile were a slider on its first added
note (Shift1, ±24 semitones). What gets played is an octave above or below;
the user: "rather than that slider i'd like just buttons for +12 and -12 to
load the device and set the value of the first knob".

## Decision
- `deviceControls.ts` gains a fourth control kind, `buttons`: a list of
  buttons, each lit while its value is the device's and writing its own
  values on a press. `FaceControl` draws it (`DeviceButtons`), so the chain
  cell and the browser tile get it from the one entry.
- The Chord is two buttons, +12 over -12 (left to right on a horizontal
  tile): each sets Shift1 to its octave, or back to 0 when it is already
  there.
- A press fires at finger-down. On a ghost cell it loads the Chord with
  that value held until it lands, as a ghost slider's first drag does; on a
  browser tile it loads the preset and sets the value on the device that
  load lands, as a drag on a face does.
- The Chord's central view (four Oct toggles) is unchanged.
