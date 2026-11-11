# ADR-526: Clip controls and editor together at full screen

## Status
**Accepted** (2026-11-11). Interface only; no Live restart. Builds on ADR-525.

## Context

In the stack the clip view shows either its controls (Rec, Group, Delete,
Duplicate, Loop, x2, ±12, Temp and Chance, or the audio row) or the note
editor, switched by the pencil chip, because the band is too short for
both. ADR-525 gave it the full-screen icon, where it only grew. Ben asked
for the full screen to combine the two (2026-11-11).

## Decision

- **Expanded, the clip view shows both:** the controls in a band across
  the top, the note editor (or the audio clip's waveform) filling the rest
  below.
- **The controls go to one row** (`clamp(96px, 13%, 136px)` tall, about
  130px on the 12.9" iPad): each column's stacked pair sits side by side,
  in the stack's left-to-right order, a pair twice a slider's width and
  the audio clip's three warp modes three. The notes get the rest, about
  85% of the height. (A first cut kept the controls' two rows, at about
  380px; Ben wanted the notes to have most of the space.)
- **The pencil chip hides while expanded**: there is nothing to switch.
  It comes back with the stack, on whichever half it was on before.

## Consequences

- At full screen the editor is nearly three times its stack height with
  every control still in reach. The sliders (Temp, Chance, Pitch, Gain)
  are only the strip's height, so their throw is short there.
- The controls and editor are the same components as in the stack, so a
  change to either shows in both places.

## Tags
`central-view`, `layout`, `clip-editor`
