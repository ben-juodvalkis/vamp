# ADR-433: Central Views Group by Hairline, Not by Card

## Status
**Accepted** (2026-09-13). Supersedes the per-view card idioms introduced
piecemeal — Squash's two `.dyn-panel`s (2026-09-11), Drift's three
`.drift-card`s (2026-09-12), `EnvelopeCard` (2026-09-12), the Guitar
view's Bass panel and the System view's five `.glass-panel-subtle`
blocks. Those decisions are not wrong about *what* needed saying; this
one changes *how* it is said.

## Context

A central view is a 1366 × ~660 band (a third of the iPad's screen with
four sections up) holding one device's controls, or several devices'.
Almost every one of them has more than one logical part, and the views
had arrived at two different ways of saying so.

**A card.** A bordered, titled box around the group. Five views had one
by September 2026, each invented locally:

| View | Card | What it cost |
|---|---|---|
| Squash | `.dyn-panel` ×2 | 1px ink border, `--card` fill, 12px padding |
| Drift | `.drift-card` ×3 | 1px ink border, 12% ink wash, 8px padding |
| System | `.glass-panel-subtle` ×5 | 1px border, fill, 12px padding |
| Guitar | `.bass-panel` | 8px padding, radius |
| Sampler / Operator / Wavetable | `EnvelopeCard` | 1px border, fill, 8px padding |

The cost is the problem. **Every control in this interface is already a
bordered box** — `DeviceSlider`, `DeviceXY`, `.physical-button`,
`.device-segmented` — and the central view itself sits inside
`.central-frame`, which is another. A card between them is a third
border in a row of three, and its padding comes straight off the
controls: measured, roughly 20px of a 660px band per card, plus the
title's line. On the Squash view that was two cards' worth, and the
sliders inside them were visibly shorter than the same sliders in any
view without one.

**Nothing.** The other half of the views simply butted their groups
together. Reverb's ten preset buttons ran into its five sliders at the
grid's own 16px gap — the *same* gap that separates two of those
sliders from each other. Same for the Drum Rack's pad grid against its
controls, the Arpeggiator's four devices against each other, the Clip
view's ten-column rail. There was no signal at all: the eye had to read
the labels to find the seam, which on a performance surface means
looking rather than glancing.

## Decision

**One shared hairline: `interface/src/lib/components/v6/central/SectionDivider.svelte`.**

```svelte
<SectionDivider orientation="vertical" ink={device.color.primary} />
```

- A 1px rule, `vertical` (between columns, the common case in a wide
  short band) or `horizontal` (between stacked rows).
- **It fades at both ends** — a gradient, not a flat line — so it reads
  as a seam between groups rather than as another box edge. At full
  strength against the control borders either side it just looks like a
  third column of frames.
- **`ink` is optional.** Pass the device's scheme primary where the seam
  divides one device from another (the Arpeggiator's four, the pad grid
  from the kit's controls); leave it neutral where it divides two parts
  of the *same* device (Squash from its Compressor, Reverb's types from
  its sliders).
- **It carries no text.** See below.
- No background, no radius, no padding: the divider *is* the gap, and
  the container's own flex/grid gap supplies the air. It groups by
  SEPARATION rather than by enclosure, so the controls keep the band's
  full height.

**Where a group needs a name, the name is a centred, upright eyebrow at
the top of the group** — 0.75rem, weight 700, `text-align: center`, in
the group's ink. Not on the divider.

The first cut ran the name up the rule in 10px rotated caps. The user's
call, on seeing it: *"I like the dividers, but I don't like the tiny text
in the divider line. The text should have normal orientation and probably
just be at the top of that section if it's needed at all"*, and *"I like
the labels being centered instead of justified to the left."* Both halves
matter. A vertical divider spends the band's **height** on a rotated
label, and 10px rotated caps at that size are fine print you have to turn
your head for. And **most groups turned out not to need a name at all**:
the seam plus the device's own ink already says where the boundary is,
which is why the Guitar, Pedal, AutoFilter and Arpeggiator seams shipped
bare after the labels came off.

Titles that survive (Squash's two, Drift's three, the System view's five,
the Bass panel's, the envelope's) are centred over the group they name.
Left-aligned they sat over the group's *first control* rather than over
the group — readable when a card's frame told you how far the group
reached, meaningless once the frame was gone.

### What changed, view by view

**Frames off, seams in:**

| View | Before | After |
|---|---|---|
| Squash | 2 bordered panels | 2 named groups, 1 neutral seam |
| Drift | 3 tinted cards | 3 groups, 4 ink seams |
| System | 5 cards | 5 groups, 3 vertical + 1 horizontal seam |
| Guitar | Bass panel frame | Bass group + 1 ink seam |
| Sampler / Operator / Wavetable | `EnvelopeCard` | `EnvelopeGroup`: 2 hairlines bracketing the stages, "Amp Envelope" upright above them |

**Seams where there were none:** Reverb (types \| sliders), Drum Rack
(pads \| controls), Arpeggiator (arp \| velocity \| chord \| chance),
Pedal (Digital + Redux \| Saturator pad + faders \| pedal types — the
Saturator seam the user's call once the first cut left its pad reading as a
third sibling of Digital and Redux), Permute (mute sequencer \|
pitch sequencer, horizontal), Clip (mini session \| actions — Replace
over Dup Trk, REC/Delete, the loop arrows \| what the clip plays — Loop
X2 or Reverse, ±12 or Pitch, Temp, Chance \| timing — Shuffle and the
grid picker it swings against; regrouped on the user's call after the
first cut), Chorus (smudge \| comb + comb LFO \|
phaser — on device boundaries, not between every pad).

**Second pass (2026-09-13, after a screenshot audit of every reachable
view — `npm run shot:tour -- central`):** Tremolo's Random box, the one card
the first pass missed, became a seam. Every instrument view now seams its
pitch/mod wheels off from the device (Operator, Sampler, Meld, Collision,
Electric, Omnisphere and both Instrument Rack views joined Drift and
Wavetable). Drum Buss seams Boom; Pedal seams every device (Digital \| Redux
\| Saturator \| pedal); the Pattern rack seams its picker from its macros;
Variation seams its three division pickers from Pitch Decay and Mode; Meld
seams its Macro pad from the filter group; a nested-rack kit seams its named
macros from Filter and Gain; Simpler seams Random Start, and the grid
placement that shifted its bottom row one cell left whenever that device was
loaded is fixed. `EnvelopeGroup` takes `edges="trailing"` where it opens the
band (Operator), so it no longer draws a hairline against the view's edge.

**Third pass (2026-09-14): every seam centred.** The user saw Operator's
envelope seam sitting off-centre. Measuring the gap on each side of all 55
seams across the 27 tour states, plus 8 more with the FM track's Operator
swapped for each instrument the scene has no track for, found four seams
that were 8px on one side and 16px on the other, and one at 28 | 12. All
had the same kind of cause: a seam whose two sides were spaced by
**different boxes**.

| View | Was | Cause | Now |
|---|---|---|---|
| Operator, Wavetable | 8 \| 16 | `EnvelopeGroup`'s hairlines sit in a `gap-2` wrapper inside a `gap-4` grid | wrapper `gap-4`: 16 \| 16 |
| Drum Rack, Simpler + Sampler kits | 8 \| 16 | `SimplerControlsRow` / `SamplerControlsRow` carried their own `p-2`; the DrumCell and rack-macros rows never did | rows unpadded: 8 \| 8 |
| Sampler (single) | 16 \| 8 | the same `p-2`, against the wheels | host `p-4`, wheels lose `py-2`: 8 \| 8, same outer inset |
| Drift, Levels | 28 \| 12 | column sized `3 sliders + 4 gaps`, the padded card's formula; two gaps are real | `+ 2 gaps`: 12 \| 12 |

The rule, now under *Layout mechanics*: **a seam is centred only when the
same gap sits on both sides of it.** Simpler's Random Start seam (only drawn
with that device loaded, which no fixture has) was checked by reading: it is
its own `auto` grid track, so the grid's one gap is on both sides.

Measured in the built CSS during that audit: under the flat grammar — the
only skin — every seam draws the solid `--line-strong` rule, so `ink` and
the fade have no visible effect in the shipped interface.

**Consolidated:** `AutoFilterCentralView`'s hand-rolled
`<div class="self-stretch w-px bg-border/60">` — the interface's first
seam, and the prior art for all of this — is now the shared component.

### Layout mechanics

A seam in a **flex** row is just another child: `flex: 0 0 auto`,
`align-self: stretch`.

A seam in a **grid** needs a track. Add an `auto` column (or row) and
renumber: `repeat(9, 1fr)` becomes
`repeat(5, 1fr) auto repeat(3, 1fr) auto 1fr`. An `auto` track is the
hairline's own width, so the content columns still divide the rest
evenly. `ClipCentralView` and `SystemCentralView` both carry literal
`grid-column` tables (a `calc()` on a grid line is not reliable in iPad
Safari) — **the seams are numbered in those tables like any other
column**, including in the `.outer.has-mini` fork.

`PermuteCentralView` went `1fr 1fr` → `1fr auto 1fr`, and its pitch row
moved from `grid-row: 2` to `grid-row: 3`.

**A seam is centred only when the same gap sits on both sides of it.** A
seam that is a direct child of one flex or grid container gets that for
free. Anything else has to be matched on purpose: a seam inside a wrapper
(`EnvelopeGroup`'s hairlines inside their host cell) needs the wrapper's gap
to equal the container's, a row component beside a seam must not add
padding of its own, and a fixed-width column must be exactly as wide as
what it holds, or its slack piles up on one side. All four broke once
(third pass, above).

### Flat grammar

`SectionDivider` carries its own `[data-grammar="flat"]` fork (§8.1): a
solid `--line-strong` hairline rather than a fading one, because the flat
grammar draws lines and not washes. Removing the cards also removed three
flat-fork rules that existed only to re-skin them
(`.light[data-grammar="flat"] .glass-panel-subtle` in the System view,
`[data-grammar="flat"] .drift-card`, `[data-skin="hybrid"] .drift-card`).

## Consequences

**Positive.**

- Every control in a divided view is taller and wider by the card's
  padding and border — most visibly the Squash view's Output slider and
  stepped rows, and the Guitar view's Bass fader, which now runs the
  band's full height like the macros beside it.
- One implementation of "seam" instead of six local card idioms plus one
  hand-rolled rule. A new central view gets grouping for an import.
- Groups that read as groups where there was previously no signal at all
  — the Reverb, Drum Rack, Arpeggiator, Permute and Clip views.
- Three dead flat-fork rules removed with the cards they skinned.

**Negative / accepted.**

- **A seam is weaker than a frame**, deliberately. A group that genuinely
  needs to read as an *object* (something you act on as a whole) is not
  served by this and should keep its frame. The Drum Rack's kit-class
  card (`.vm-kit-card`) did, for that reason: it is a readout, not a
  group of controls.
- **A named group costs its title's line.** `EnvelopeGroup`'s stages are
  ~14px shorter than the Spread and Trnsp sliders beside them. That was
  true of the card too (title *plus* frame); it is simply no longer
  hidden by a border.
- **Grid views now carry seam tracks in their `grid-column` tables.**
  Anyone renumbering `ClipCentralView`'s columns has two more literals
  to keep in step, in both the plain and `has-mini` forks.
- The 10px rotated-label idiom is gone and should not come back; if a
  seam ever needs to speak, it speaks upright, above the group.

## Tags
`ui`, `central-views`, `layout`, `design-system`, `dividers`, `cards`,
`flat-grammar`
