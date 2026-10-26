# ADR-481: The Wheels Belong to the MidiWheels Device

## Status
**Accepted** (2026-10-26). Amends ADR-477 (its "the wheels are
`MidiWheelsPanel`, Pitch over Mod in one column" for the instrument views).
No Live restart: interface only.

## Context
Every instrument central view drew the pitch and mod wheels beside the
device. The FX chain overview (ADR-478) now draws the MidiWheels device's
cell as those same two wheels, so the wheels showed twice, and the views
spent a column on controls that are not the instrument's. The user's call:
the MidiWheels tile in the effects browser should carry the two live
wheels too, and the central views can lose theirs.

## Decision
- No instrument view mounts `MidiWheelsPanel`. Each view's freed column
  goes to its own controls; the Instrument Rack's swap pill lies across the
  top of its macros.
- The MidiWheels tile in the effects browser draws Pitch beside Mod, live
  (`browser/BrowserWheelsFace.svelte`). They send what every wheel sends,
  to the selected MIDI track, and the surface loads the device there on the
  first touch, so playing them is how the device is added; the tile's name
  still loads it as saved.

## Consequences
- A track with no MidiWheels device shows no wheels until one is added
  from the browser, or touched there.
- The expression pedal and the surface's wheel wire are unchanged.

## Tags
`midi-wheels`, `instrument-views`, `browser`, `fx-chain`
