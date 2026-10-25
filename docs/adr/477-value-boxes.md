# ADR-477: Value Boxes — Sliders That Sweep a Fixed Distance

## Status
**Accepted** (2026-10-25) for every central view, on the `smaller-ipads`
branch. The Analog view was the prototype the same day; the user liked it
and asked for the wheels at half height and the full set. No Live restart
(interface only).

## Context
A `DeviceSlider` sweeps its whole range over its own length, so its
precision is its size: a tall central fader is fine, a short one coarse.
Central views have spent their height on tall, skinny faders for that
reason, and a smaller iPad (ADR-476) shrinks them and coarsens them with
the screen.

The Permute view's Length and Rate boxes do it the other way (user,
2026-10-25): a step every 20–25px of finger travel whatever the box's
size, so a short box is still fine. The user asked whether central views
should move from skinny, tall faders to boxes like those.

## Decision
**A value box is a slider that sweeps its range over its own length or a
fixed finger travel, whichever is longer**: `DeviceSlider`'s `travel`,
`constants.ui.gestures.valueBoxTravelPx` (240px). That is about a full
central fader on the 12.9-inch (Analog's envelope faders were 213px), so a
box feels like the faders it replaces at any size, and a slider longer
than 240px keeps its own length.

**Every slider in a central view is one, with no prop.** `CentralDisplay`
provides a context (`central/valueBox.ts`); a `DeviceSlider` inside it
takes the travel and an upright label unless the view passes its own.
Sliders outside, the FX grid's tiles included, are unchanged. While a box
is dragged its `readout` (Live's own value, `param/display`, sent only while
the UI writes) replaces its name; the views pass it wherever Live has one.

**The wheels are half height.** `MidiWheelsPanel` stacks Pitch over Mod in
one column, and `MidiWheel` sweeps over the same travel, so each is as fine
as a full-height wheel was. Every instrument view mounts the panel, which
frees one wheel column per view.

**Boxes for what is set, pads and wheels for what is ridden.** The layout
rule applied view by view:
- Two faders side by side become a column of two half-height boxes; left to
  right reads top to bottom. A pair never crosses a seam: a fader alone in
  its group stays full height.
- An envelope with a switch between two of them becomes two rows, both in
  view (`EnvelopeGroup edges="none"` over a horizontal seam).
- The width that frees goes to the view's XY pad or graph.

**Per view:**
- **Analog** (the prototype): Amp over Filter, five boxes each; Glide under
  Noise; the Filter pad takes Glide's column and the wheels' second one; the
  wheels stacked under the voicing switches.
- **Meld**: both envelopes as rows; Drive over Spread; wheels stacked.
- **Operator**: the left half is the amp envelope over Feedback · Time ·
  Tone, with the swap pill above it; the Filter pad takes the right half.
- **Wavetable**: both envelopes as rows (the Env 2 switch is gone); Time
  over Mod Amt.
- **Omnisphere**: Amp and Filter envelopes both drawn, stacked (the
  Amp | Filter switch is gone).
- **Drift**: the mixer and the voicing sliders stack in their cards; wheels
  stacked in the mode column.
- **Collision, Electric, Sampler**: the wheels stack, one narrow column.
- **Instrument Rack**: the macros fill two rows column by column; an XY pad
  takes a 2×2 cell. **Komplete Kontrol**: its eight parameters a 2×4 grid.
  **Pattern Rack** and **Audio Effect Rack**: macros in two rows.
- **Echo**: LFO Time over LFO Filter, Input over Output, Feedback over Mix;
  the filter graph 168 → 443px.
- **Pedal**: Color, Output and Mix one column of three; the Redux pad
  332 → 657px.
- **Drum Buss**: Drive, Crunch and Damp stacked; Boom 278 → 571px.
- **Glue / Utility**: Squash's Threshold over Output, Multiband's three
  stacked; the Gate pad 157 → 274px.
- **Auto Filter**: Drive over Mix after the circuits; the LFO pad 183 →
  278px.
- **Glitch**: Duck over Glue; the four pads 175 → 217px each.
- **Groove**: Random over Velocity, with a whole-percent readout computed on
  the iPad (clip properties have no `param/display`).
- **EQ**: the Channel EQ is one column, a Low Cut switch over an Output box;
  the Tone Shaper graph 741 → 899px.
- **Clip view**: Temp over Chance on a MIDI clip, Gain over the warp tab on
  an audio clip; the rail is six columns, REC and Delete on the same pixels
  for both.
- **Left as they were**, apart from the travel and upright labels: Reverb
  (already rows of boxes), the Arpeggiator, Variation, Tremolo, Chorus and
  Pitch views (each fader alone in its group), the Guitar's Drive and Wah
  (alone in their groups), the Shifter, Auto Filter's Morph, Glitch's
  Clock, Groove's Amount, and the Drum Rack and Sampler/Simpler kits' lead
  grid (ADR-428's one ruler, the user's muscle-memory rule).

## Consequences
- Precision no longer follows size. Most stages are a little finer than
  before (240 against ~210px); a box that stood for a longer fader is a
  little coarser (Analog's Glide was 295px).
- A full sweep takes 240px of travel even from a small box; near a screen
  edge, lift and drag again (a touch never jumps the value).
- At rest a box shows its name and its fill, not a number: Live sends the
  value only while the UI is writing it.
- Echo's Input and Output keep their half-speed sensitivity, so a full rail
  is now 480px of travel.
- On the iPad mini and in the session layout, an audio clip's warp tab is
  about 35px an option, under the 44px floor (it is half a column now).
- On the 10.2-inch the Pattern Rack's macro boxes are small.
- The central tour lost `omnisphere-filter` (both envelopes are always
  drawn), clicks the oscillator badge for `wavetable-osc2` and
  `meld-engine-b`, and gained `komplete-kontrol`.
- Tried and not taken: 60px boxes on Analog, more box-like, but they gave
  the filter back and cramped its type strip.

## Tags
`ui`, `central-views`, `sliders`, `value-box`, `midi-wheels`, `gestures`
