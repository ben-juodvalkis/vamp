# ADR-508: Knobs in central views

## Status
**Accepted** (2026-11-06)

## Context

Every continuous control in a central view is a value box (ADR-477): a
bordered well whose fill rises with the value. A box reads well at a glance
and from across the room, but it wants a long side. Squeezed short or narrow,
as the instrument panels' boxes are (ADR-487), it reads as a fader on its side,
its label sits half on the fill, and a row of them gives no hint which
controls are played and which are set once.

Ben asked whether knobs would be better. A prototype behind a localStorage
switch tried four faces in the real views (a ring with a cap, a flat ring with
a handle dot, a hardware knob, the fill bent round) and two blends. He chose
the flat ring with nothing on it but the arc.

## Decision

- **A knob is a face, not a new control.** `DeviceSlider face="knob"` keeps
  the box's gesture exactly: a relative drag from where the finger lands, over
  the same length (the cell's, or the value-box travel when that is longer),
  with the same throttle, tap, `onRelease` and `readout`. Either axis turns
  it: up or right raises it. The whole cell is the touch target, so a knob is
  as easy to hit as the box it replaces. `KnobFace.svelte` only draws.
- **The face is the arc alone.** 270 degrees in the device ink, filled from
  its start, or from its top for a bipolar control; square ends. A short mark
  outside the ring at the start (or the top) says where zero is, since an arc
  at zero is otherwise an empty ring that reads as unbound. The control's
  glyph sits in the middle at rest, hidden on a knob under 56px across; Live's
  value takes its place while a finger drags. The name sits under the knob,
  `valueText` (the value in Live's words) under the name. A cell wider than
  3:2 puts the caption beside the knob.
- **When a knob, when a box.** A box for a level ridden mid-set (Mix,
  Dry/Wet, Gain, the Drum Rack's Gain and Trnsp), for a control that carries a
  meter, and for an envelope's stages, whose heights draw its shape. A knob
  for tone-shaping and set-and-forget controls (filter, character, mod
  amounts), for bipolar controls, and for dense groups. One kind per group;
  the two mix only across a seam. A knob needs a near-square cell: a view laid
  out for boxes keeps its boxes until it is laid out again.
- **The definition decides, never the cell's shape.** An automatic switch on
  aspect ratio would swap a control under a finger when a layout changes. A
  view passes `face`; an instrument panel names `boxFace` for its value and
  stepping boxes and a group overrides it (`face: 'slider'` on an envelope's
  stages).
- **First: Drift's and Operator's panels, and Reverb.** Both panels draw
  knobs but their envelopes; Reverb draws knobs but Dry/Wet. Drift's own face
  keeps its boxes: its Shape strip and voicing column are too small for a
  knob. Chain cells and browser tiles are unchanged.
- **The shot harness measures a knob by its cell.** The layout check counts
  painted boxes; a knob paints less than the cell it answers to, so its cell
  carries `data-layout-box`.

## Consequences

- Operator's frame gives its knobs columns about 65pt wide, so they draw
  small. Its layout was made for tall boxes; widening those columns is the
  next step there.
- An arc reads less at a distance than a fill. That is why the played
  controls stay boxes.
- Other views move to knobs one at a time, each with its own call on which
  controls stay boxes.

## Tags
`knob`, `value-box`, `central-view`, `instrument-panel`, `touch`
