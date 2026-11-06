# ADR-509: Knobs in central views

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
  with the same throttle, tap, `onRelease` and `readout`. A vertical drag
  turns it, up raising it (either axis until 2026-11-06; see the last
  addendum). The whole cell is the touch target, so a knob is
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
- **Few values are a tab, many are a knob.** A stepped control with up to
  `TAB_MAX_OPTIONS` (8) named values is a tab of them, scrubbed like
  Echo's LFO wave (`ScrubTabs`); a panel's chooser is the same tab. One with
  more values (Operator's 23 waves, Collision's destinations) or none named
  (Voices) stays a knob with a detent a value. A tab of names takes more
  width than one of numbers.
- **The played control stands apart.** Reverb's Dry/Wet is a full-height
  box at the right edge, past a seam, where it was one cell among the knobs.
- **A page can hold a picture beside its knobs.** A page's `aside` is a
  device's own control drawn full height left of its rows; Drift's Filter
  page shows the face's filter pad there, its knobs in two rows beside it,
  where a single row of knobs left the page's height empty.
- **Where (2026-11-06, every central view).**
  - Instrument panels (Drift, Operator, Electric, Collision, Analog,
    Wavetable, Meld): `boxFace: 'knob'`, every envelope's stages
    `face: 'slider'` (a group with an Attack and a Release;
    `panelKnobLayout.test.ts` checks every panel).
  - Rack and plug-in macros (Instrument Rack, Pattern Rack, Audio Effect
    Rack, Komplete Kontrol, the Drum Rack's macro grid and nested-rack
    kits, the generic plug-in view): knobs, as Live draws a rack's macros,
    in `KnobGrid` where the view has no grid of its own.
  - Effects: Echo (Feedback and Mix stay boxes), Reverb (Dry/Wet), Auto
    Filter (Mix), Saturator (Mix), Redux (Dry/Wet), Pitch Hack (Reverse and
    Mix), Glue and Multiband (Threshold), Variation (Stutter); Drum Buss,
    Chorus, Glitch, Utility, the Channel EQ's Output, Compressor's Cutoff
    and Output and the Pitch view's Tone are all knobs.
  - MIDI effects: Chord, Arpeggiator, Random's Choices and Interval.
  - Simpler's Sens, Fade and Random.
  - The hand-laid faces, re-laid for knobs (second pass, the same day):
    Drift's Shape, voicing knob, Glide and Drift (the voicing column two
    slider widths, Shape's row taller); Wavetable's Time and Mod Amt and
    Meld's Drive and Spread (their Global columns two slider widths);
    Omnisphere's filter-envelope Amount (wider, past the stages); Shifter's
    Drive and Tone, its LFO's Morph, Width and Offset in a `KnobGrid`, and
    Spin/Phase, with Dry/Wet a box of its own.
  - ADR-508's Live-panel views (Auto Pan-Tremolo, EQ Eight, Delay, Limiter,
    Phaser, Chorus): `ParamColumn face="knob"` for their tone and motion
    columns, Live's order kept; their levels (Feedback, Dry/Wet, Output,
    Ceiling, Scale) stay boxes.
  - **Boxes kept on purpose:** a lone control filling its view (Bass, Blur,
    Gate, Velocity, Chance, Phaser's pad, Wah, Pedal's Drive, Random's Rand
    Oct, Auto Pan's rate); the Drum Rack's Gain and Trnsp and Simpler's and
    Sampler's Pitch and Gain (placed for muscle memory); the clip, groove
    and system views, which are not devices; envelopes and mixer levels
    everywhere; and Analog's face, whose voice card has no room a knob can
    use (tried: the Sub knob came out under 30px).
  - Chain cells and browser tiles are unchanged.
- **The shot harness measures a knob by its cell.** The layout check counts
  painted boxes; a knob paints less than the cell it answers to, so its cell
  carries `data-layout-box`.

## Consequences

- A new panel or view decides the same way: which groups keep boxes, and
  whether a group's share needs `units`.
- Analog's face and Collision's tabbed middle (its knobs small under the
  tab strip) are still to lay out for knobs.
- A panel's knobs show their value at rest only where the view knows it:
  Live sends a parameter's display text only while the UI writes it, so the
  panels show a name alone until the surface sends it at rest too.
- An arc reads less at a distance than a fill. That is why the played
  controls stay boxes.

## Addendum (2026-11-06): three sizes, sized by the column

Ben asked for standard knob sizes in place of each knob filling its cell.

- **Three sizes.** `KnobFace`'s `size` (`DeviceSlider`'s `knobSize`): 's'
  48px across, 'm' 70px, 'l' 96px. These are what fits the rig's central
  view (about 327px tall at 1366 x 1024): 72/120/152 were tried the same
  day and every Drift knob came out clamped, three "medium" knobs at 64,
  70 and 80px. Medium is the size of Drift's level knobs, which Ben
  picked. A knob is that size, centred in its
  cell; it shrinks (to the 28px floor) only where the cell cannot hold it
  with its caption, so it never overflows. The caption's type is
  fixed by the size (titles 12, 15 and 17px), not by the cell.
- **The caption is under the knob unless the cell is short and wide.** In a
  cell wider than 6:5 it sits beside the knob, left-aligned, and the knob
  takes the cell's height and up to half its width. Measured at 1366 x 1024
  with the effects chain above it, the central view is about 327px tall: a
  column of three knobs gets cells about 128 x 80, where a caption under
  the knob left it 28-32px across. Beside it, the knob has the cell's
  height.
- **The size follows how many knobs the column stacks**
  (`knobSizeFor`): one or two 'l', three 'm', four or more 's'. Count the
  most the column can ever show: a column whose knobs come and go with a
  mode keeps the size of its fullest state (`KnobGrid`'s and
  `ParamColumn`'s `fullest`), so a mode switch never resizes a knob. In a
  grid whose rows come from its box (a panel's knob group, `KnobGrid`), its
  row count is the count. A panel group or control can still name its own
  `knobSize`.
- **A column too small for its size is a layout to fix, not a size to
  change.** Where a cell clamps a knob below its size, the column is to be
  widened or heightened; the rule's size stays.

## Addendum (2026-11-06): a grid lays out for its size, and the audit

Every central view was measured at 1366 x 1024 with the chain above the
central view (329px tall) after the three sizes landed: about 80 of 138
tour states had knobs off their size, nearly all clamped by width or
height. What changed:

- **A grid whose rows come from its box picks the rows that hold its size**
  (`knobGridFit`, in `KnobGrid` and a panel's knob group): of the row
  counts, the one whose cells draw the largest size at its full diameter,
  a row count's size being at most what its columns stack. Where no row
  count holds the rule's size it steps down rather than clamp.
  `knobDiameter` is KnobFace's sizing rule in TypeScript, for checking a
  layout without rendering it.
- **An instrument panel's knob is a ceiling, fitted to its cell**
  (`DeviceSlider`'s `knobFit`, KnobFace `fit`): its cells come from data,
  not a hand layout, so a knob draws the largest size its cell holds. A box
  or stepper can take more than one box's width (`units`) where a row of
  tabs would leave it too narrow (Drift's Oscillators page).
- **Two captioned large knobs do not stack in the band.** They need 316px
  (2 x (96 + 54) + a gap) and a column under an inset has about 300, so a
  hand-laid column of two goes medium (Wavetable's and Meld's Global,
  Glitch's Duck / Glue, Shifter's Drive / Tone, Echo's two pairs). Nine
  knobs abreast (Chord) and Reverb's six columns of two are medium too, as
  are Reverb's knobs on the EQ tab small, where the curve keeps the width.
  These are the rule's size stepped down, named in each view.

## Addendum (2026-11-06): vertical only, marks, and knobs for levels

- **A knob turns on a vertical drag alone** (Ben, 2026-11-06), over its
  height or the value-box travel: a sideways slip of the finger leaves it
  where it was. Either axis turned it until then.
- **A knob can drop its caption and carry a mark** (`DeviceSlider`'s
  `knobCaption={false}`, `knobMark`): a letter or number in its middle at
  rest, where the name is obvious from its neighbours — Drift's and
  Wavetable's "1" / "2" levels, A D S R, a mod amount whose source chooser
  (`central/ChoicePicker.svelte`) sits under it as its caption. The
  aria-label keeps the name. A caption-less knob is centred in its cell.
- **Levels and envelope stages may be knobs** where a hand-laid face or
  page puts them in a knob column (Drift, Wavetable): the "played controls
  stay boxes" line above holds for the rule-laid panels and the effects,
  not for those.

## Addendum (2026-11-06): the Drum Rack's kits

- **Trnsp stays a slider, full height, the first column on every kit**: it
  is played, under a held pad as on the kit. **Gain is a knob** at the top
  of the next column on every kit, with the kit's set-once controls as
  knobs under it — DrumCell's Start, the Sampler's Spread and Select (all
  three in one column) — and the single Sampler likewise. They carry their
  icon and no caption, so three hold 70px in one column and nothing clamps
  under a scoped pad's notes strip. Gain and Trnsp keep one position across
  kits (the 2026-09-27 muscle-memory rule), now Trnsp first.

## Tags