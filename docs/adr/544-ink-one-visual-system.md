# ADR-544: Ink — one visual system for the iPad layout

## Status
**Accepted** (2026-11-17). Interface only; no Live restart.

Supersedes [ADR-400](400-device-family-inks.md) §1 and §3 (a device family
has no colour of its own any more; `deviceInk` and the fixed-point table
stay as code) and the last line of [ADR-402](402-instrument-views-wear-track-ink.md)
("insert-FX family inks are unchanged": every view wears the track's ink
now). Amends [ADR-509](509-knobs-in-central-views.md) (what a knob says
under its name, its caption's height, and a new face among round buttons)
and [ADR-477](477-value-boxes.md) (where a box's label sits). The flat
grammar, the section seams (ADR-433), the spacing roles (ADR-434), the face
grid (ADR-510) and the full-screen boards (ADR-511 to 517) stand.

## Context

Ben asked for one design system across the iPad layout and the browser,
judged from screenshots and from playing it. Four faults, his words
shortened:

1. The Clip view and the Drum Rack were built from different parts than the
   effect and instrument views.
2. No view said which track or device it belonged to.
3. Space was spent unevenly.
4. Family colour painted everything in a view, so "this is on" and "this
   is a filter" were the same colour.

Three directions were pitched from the real app behind a switch (Session:
Live's own colour code; Ink: the track's colour for amounts, no hue for on;
Dye: the whole view dyed in the track's colour). He chose Ink, then walked
it one image at a time. What follows is what he decided in that walk; where
a rule is his, it says so.

## Decision

### What colour is for

- **Colour is whose it is.** Every amount a view or a chain cell draws (a
  knob's arc, a box's fill, a picture's line) is in the **selected track's
  ink**. A device family has no colour of its own.
- **On has no hue.** A lit switch and the chosen one of a set are a solid
  block: paper white on the dark theme, ink black on the light one, with
  the opposite text.
- **A name is plain ink.** A control's name, a section's name and a pad's
  mark are the foreground colour, never the amount's.
- **State colours are kept and are the only other hues**: record red, play
  and group green, solo blue.
- **Permute keeps two colours** (Ben: "I like the blue"): its mute row is
  the track's, its pitch row pitch blue.

How it is built:

- `app.css` holds the tokens. The neutral ladder has no colour cast, so a
  track colour reads as itself; panels are slabs with no drawn edge. The
  role tokens say the rules above once: `--amount`, `--on-bg` / `--on-fg`,
  `--label`, `--value`, `--sel-track` / `--sel-track-fg`, `--sel-shade`.
  The skin attributes on `<html>` keep their names (`data-skin="hybrid"`,
  `data-grammar="flat"`); the skin they name is Ink.
- The layout writes the selected track's four colours on the root
  (`layouts/default/Layout.svelte`), computed in JS (`inkShade`, `amountInk`
  in `trackFormatters.ts`) so nothing depends on CSS relative colour and a
  canvas can take the same hex. On the light theme an amount's ink is the
  track's hue at lightness 0.5: the name-block envelope is too pale for a
  line on paper.
- `devicePresets.ts`: a scheme from `familyScheme()`, the macro wheel or
  `CHARTREUSE_SCHEME` answers with the amount ink when it is read
  (`setAmountInkSource`, registered by `selectedTrackInk.ts`). The ~50
  call sites that hold a scheme were not rewritten. A scheme must not be
  spread or copied at module scope: the copy keeps the ink of that moment.
- With the master selected an amount is in the master's own Live colour
  (Ben, 2026-11-23; it was a mid grey). The mid grey, clear of on's white
  and black, is left for a cold start with no track record yet.
- **Two laws in `app.css` win over a view's own rule**, with `!important`
  and nowhere else: a lit `.physical-button` or `.device-segment` is on's
  block, and an unlit one's word is a label. Until the rollout has been
  through every view, a view may still pass its own tint to a switch; the
  laws make that dead code, not a second look.
- `paintTokens.ts` (the canvas's copy of the tokens) is in step with them.

### How the selected track is marked

- **The central view has a title band**: the track, then the device, in the
  track's own name-block colour, 40px. The view sits in a body under it.
- **The chain cell whose view is open wears the same band.** Other cells'
  heads are plain.
- **The selected strip is filled** with a shade of its track's colour
  inside its frame (Ben: shaded, not only outlined; the track's colour, not
  a neutral).
- **Recording is the frame, in red**, and nothing in the fill (Ben: he
  usually records on the selected track, so the two must show at once).
  While it records, a selected strip's frame is red in place of the white.

### The control types

One set, meaning the same in every view:

| Type | Is | Looks |
|---|---|---|
| Action | does something once | round; its mark over its word |
| Switch | stays on or off | a rectangle with a lamp; a solid block when on |
| Knob | an amount set and left | an arc; its name under it |
| Box | an amount ridden while playing | a fill; its name at its head |
| Pad | two amounts on one surface | its dot alone |
| Tab | one of a few named settings | a segmented set; the chosen one a solid block |
| Step, pad tile | a cell in time or in a kit | as they were |

- **Round is kept for one-shots** (Ben liked the circles; the pitch had
  squared them). The rule of 2026-11-07 stands and is now general.
- **A control carries its mark over its word.** The Clip view's one-shots
  were unlabelled.
- **A continuous control shows no number at rest** (Ben, as a general
  rule): its arc, fill or dot is the reading. It shows its name, and its
  mark where the knob is large enough. The number shows only while a finger
  moves it. Its accessible name still carries the value.
- **A discrete control keeps its value under its name.** `DeviceSlider`
  decides: discrete when it has `steps`, when it is whole numbers about a
  centre (semitones), or when Live's word for its value has no number in it
  ("Off").
- **A tab is preferred to a stepped knob where there is room** (Ben); often
  there is not, and then the stepped knob stays. Reverb's Vintage is a tab.
- **Knobs that sit together are one size** (Ben). A knob reserves one
  caption line, the name's, whether or not it carries a value; the fit that
  picks a knob's size (`knobLayout`) reserves the same.
- **A set-and-forget amount is a knob, a ridden one a box** (ADR-509's
  rule, applied to the Clip view: Temp and Chance are knobs).
- **A knob among round buttons is their size** (`KnobFace inside`,
  `DeviceSlider knobInside`): its ring is the circle a button beside it
  draws, its mark over its name inside it.
- **A pad is its dot alone.** A hairline to each axis was tried and
  rejected.

### The pilot views

Clip, Permute, the Drum Rack (DrumCell kit) and Reverb are converted. The
remaining central views take the tokens, the shared controls and the two
laws, and are re-laid in the rollout. Three were touched now because the
title band's 40px put them past their inset: Utility's switches are three
rows of two (five rows before), Collision's resonator list is three rows
(`maxRows` on a panel's choice), and Delay's Offset stopped showing a
value once a 0..1 amount about a centre counted as continuous.

## Consequences

- A view tells two things apart by words or marks, not by two family
  colours. Permute's knobs name their row (Mute length, Pitch rate).
- The palette's effect names carry no colour: a chip is found by its place
  and its name. (Amended by ADR-547: a chip wears a faint wash of its
  family's colour.)
- A view that still passes its own colour to a switch or a tab is the
  rollout's to fix; its amounts already follow the track.
- The title band takes 40px from every central view. A knob's one-line
  caption gives most of it back to the knob.
- Vintage's five options are about 33pt tall in the band, under the 44pt
  floor. Ben has seen it; more height is the re-layout's to find.
- The tour's layout check measures a view's inset from the body under the
  band (`data-central-body`). Of the three states that failed on main,
  `permute` passes now (its knob cells are its touch targets and are
  measured as such); the two Instrument Rack states still fail on "None
  stored", as they did. Nothing else fails.
- In the Clip view a one-shot draws a circle and answers to its whole
  cell, as the pill it was did: the circle is the button's `::before`.
- `npm run shot:tour -- ipad --full` shoots the whole iPad layout on the
  four pilot views, a recording strip against a selected one, and the
  master.
- Not measured: frames. Nothing here runs per frame; the root's colours
  are written when the selection or the theme changes.

## Addendum (2026-11-17): the rollout

Ben, after stop 2: "More than just dealing with obvious bugs and overflows,
we want to make sure each of these central views looks beautiful and as
ideal layout." Every remaining central view, the full-screen boards and
the note editor were then looked at and laid out again, in seven groups
worked side by side and reviewed in both themes. Each view's header comment
says what it is now; the commits name what moved and why.

Rules the rollout added or settled:

- **A switch sits with what it switches**, over or under it in the same
  column (Ben, for Auto Filter's Time/Sync over Morph).
- **Discrete is said, not guessed.** `DeviceSlider` takes `discrete`; a
  range of whole numbers is not a sign of it (a gain of +-15 dB is
  continuous). A transpose says `discrete`; a panel's data marks a knob
  Live counts in semitones `whole`.
- ~~**A box's label is always at its head**~~. Reversed the same day (Ben):
  a box's mark and name are a column **centred in the box**, however wide
  it is.
- **Beside a knob, its name starts at one x**, so knobs stacked in a column
  line up whatever their names' lengths. A knob with a value under its name
  sits level with one without.
- **An amount ink is finished**: `trackInk` and `deviceInk` hand it back
  untouched, so a view that still re-inks a scheme cannot pale it on light.
- **One ink a view.** The second hues inside Wavetable, Drift, Meld, Analog
  and Auto Filter are gone; a half (osc 1/2, engine A/B) is told by the
  number or letter in its knob, on on's block for the one shown.
- **A picture is not a control.** Channel EQ's view is its curve, drawn
  from its parameters and taking no pointer: the gesture is its chain
  cell's (ADR-510).
- **The title band names the device the chain picked**, by Live's name.

Left open, for Ben:

- **The full-screen boards are still under the touch floor in places**
  (Analog's, Meld's, Operator's and Collision's tables: rows about 27px,
  knobs about 40px). Every control is on screen at once (ADR-512, 513);
  making them hittable means showing fewer.
- **An effect opened for one drum pad** is drawn in about half the width
  its view was laid out for.
- **A rack's own colour** on its chain cell's macro knobs and its unfolded
  devices is kept.
- Collision's band gained Structure (it was on the board only), and Drift's
  board moved Shape Mod into an "Osc Mod" tile.

`SHOT_PARALLEL=1` lets several tours run at once on one dev server.

## Tags
`visual-system`, `colour`, `tokens`, `central-view`, `controls`, `track-strip`, `chain`

## Addendum (2026-11-17, later): the title band is hidden

Ben, trying the views without it: the central view's title band is hidden
(`CentralDisplay`, the markup kept with `hidden`), its 40px back to the
view. The selected strip and the open device's chain cell (which still
wears the band) say whose view it is. The full-screen icon sits in the
view's top-right corner in plain ink.

