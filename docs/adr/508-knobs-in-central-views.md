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
  6:5 puts the caption beside the knob. A stepped control (`steps`, up to 24
  values) wears a detent for each value in place of the zero mark, the one it
  rests on in the ink.
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
- **Knobs change the layout around them.** A knob wants a near-square
  cell, where a box is happy tall and thin, so on an instrument panel:
  - a group of knobs wraps into the grid that gives each knob the most room
    (`knobGridRows`, measured off the group's own box, counting the caption
    under each knob): three knobs side by side in a wide group, two to a row
    in a square one, stacked in a tall one;
  - on a full-height band a group of knobs stacks them two high, so it
    takes half as many columns as it has knobs (`groupUnits`), and the boxes
    beside it (an envelope's stages) keep their full width; on a two-row
    page there is no height to stack in, and its knobs stand in a row;
  - a group can name its share of the row in `units` where that rule
    mis-states it, and Operator's filter pad takes two boxes rather than 2.5.
- **Switches and choosers among knobs are one touch row high.** A
  full-height switch outweighed the knobs beside it. In a knob group a
  switch is a pill one touch row tall, and a chooser a touch row an option,
  centred in their cells. A switch that belongs to a knob is drawn under it:
  a panel's box names it as `toggle` (Drift's Osc Mix: each source's On under
  its level; Operator's Fixed under its Freq), and Reverb gives Sync and Mono
  the cell under Predelay and Stereo, a knob with a switch always starting a
  column.
- **The played control stands apart.** Reverb's Dry/Wet is a full-height
  box at the right edge, past a seam, where it was one cell among the knobs.
- **A page can hold a picture beside its knobs.** A page's `aside` is a
  device's own control drawn full height left of its rows; Drift's Filter
  page shows the face's filter pad there, its knobs in two rows beside it,
  where a single row of knobs left the page's height empty.
- **First: Drift's and Operator's panels, and Reverb.** Both panels draw
  knobs but their envelopes; Reverb draws knobs but Dry/Wet. Drift's own face
  keeps its boxes: its Shape strip and voicing column are too small for a
  knob. Chain cells and browser tiles are unchanged.
- **The shot harness measures a knob by its cell.** The layout check counts
  painted boxes; a knob paints less than the cell it answers to, so its cell
  carries `data-layout-box`.

## Consequences

- Other panels adopting knobs need the same pass: which groups keep boxes,
  and whether a group's share needs `units`.
- A panel's knobs show their value at rest only where the view knows it:
  Live sends a parameter's display text only while the UI writes it, so the
  panels show a name alone until the surface sends it at rest too.
- An arc reads less at a distance than a fill. That is why the played
  controls stay boxes.
- Other views move to knobs one at a time, each with its own call on which
  controls stay boxes.

## Tags
`knob`, `value-box`, `central-view`, `instrument-panel`, `touch`
