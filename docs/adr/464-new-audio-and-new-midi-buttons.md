# ADR-464: New Audio and New MIDI Are a Column After the Last Strip

## Status
**Accepted** (2026-10-23). Branch `foot-hold-next-take`: `c98fdfd`,
`0d061c0`, and the sizing and ghost pass after them. Interface only: no
wire change, no Live restart.

## Context
ADR-461 takes track creation off the foot pedal's hold. Making a track
still needs a door, and the choice it asks for (audio or MIDI) is one
the pedal never offered: the hold only made audio tracks. The browser
makes a track as a side effect of loading a preset, but an empty track
to record into had no control of its own.

## Decision
**Two buttons, New Audio over New MIDI, in one column after the last
track strip.** Each sends one `prepare_for_preset` with an empty preset
(`trackPreparation.prepareForPreset(kind, '')`). The surface reuses an
empty track of that kind (the selected one first) or creates one; arms
and routes an audio track; appends Permute; and Live selects the track,
so the pedal's next tap records there. A second press of the same kind
is ignored while the first is in flight, and the button pulses until it
lands.

**The column is one more track column.** It shares the strips' grid
template (`minmax(--track-min-w, 1fr)`), so it is exactly a strip's
width at any track count. The clip grid and the stop row carry the
column empty, so their track columns stay under the strips. Once the
row scrolls the column is pinned to the panel's right edge, so it is
always within reach. The row's scroll padding keeps a followed strip
clear of it. Each strip column is its own stacking context, so a strip
scrolling under the pinned column can't draw its volume ticks over the
buttons.

**They read as empty slots, not tracks.** Each button has a dashed edge
and no fill. The icon (a microphone for audio, a piano for MIDI) and the
label sit at the ghost weight an unloaded FX tile wears
(`--opacity-ghost`) and come up to full under the finger. Each button is
a size container: the marks scale with its narrower side, clamped so
they stay legible on a crowded row and don't balloon on a sparse one.

## Consequences
- A new track is one tap, of a chosen kind, from the strips row.
- The column costs one strip's width. On a set that already fills the
  panel it is the column the row scrolls to reveal, so it is pinned.
- Track creation has no hardware path any more. Ben's rig drives it from
  the iPad.

## Tags
`tracks-panel`, `track-creation`, `new-track`, `prepare-for-preset`, `layout`
