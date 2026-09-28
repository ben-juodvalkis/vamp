# ADR-434: Central Views Space by Role, Not by Size

## Status
**Accepted** (2026-09-14). Follows ADR-433 (section dividers), whose third
pass measured every divider and turned up the problem this settles.

## Context

ADR-433's third pass measured the gap on each side of all 55 section
dividers. Five sat off-centre, each because its two sides were spaced by
different boxes. The same numbers showed a wider problem: **the same
boundary was a different size in every view.** The space between two
controls was 8px in the Drum Rack, the racks, Omnisphere and the Sampler
view; 12px in Clip, System, Drift, Guitar, Auto Filter, Permute, Delay and
Simpler; 16px in most effects, Operator, Wavetable, Electric and Meld; 24px
in Collision.

Nobody chose those differences. Each view wrote a raw size — `gap-2`,
`gap-3`, `p-6`, `var(--spacing-md)` — when it was built, and a view that
picks a size can pick a different one by accident. There was no answer to
"which is right" to check against.

## Decision

**Two roles, two densities** (`interface/src/app.css`):

| Role | Standard | Compact |
|---|---|---|
| `--central-inset` — the view's padding against the central frame | 16px | 8px |
| `--central-gap` — between any two controls, or two groups | 16px | 8px |

A central view never writes a size for either role: markup uses
`p-(--central-inset)` and `gap-(--central-gap)`, a style block uses
`var()`. They are plain custom properties rather than `@theme` tokens,
because `@theme inline` writes the literal value into every utility and a
density has to be able to override it.

**Compact is a property of the content, not of taste.** A view is compact
when the NUMBER of controls it draws comes from what is loaded — a kit's
pads, a rack author's macros — so it cannot be laid out for a known count:
the Drum Rack, Instrument Rack, Pattern Rack, Audio Effect Rack and the
Komplete Kontrol grid. It sets `data-density="compact"` on its root, and
anything mounted inside inherits it (an effect view opened on a drum pad,
through `PadFxPane`). Every other view is standard, the crowded fixed ones
included: a fixed layout can be designed for its count.

**Spacing inside one control is not a role** and stays the control's own:
the options of a single choice (Reverb's types, Variation's divisions, the
Filter shapes, Drift's waveforms, the pad grid's tiles), a group's title
over its body (`EnvelopeGroup`, Drift's groups, Squash's panels), the
contents of a button, badge, chip or modal, the System view's setting lists
(rows pitched for the touch floor), and the clip editor. The line: two
things a finger reaches separately, and that are not options of one choice,
are two controls.

**Row components carry no outer spacing.** `SamplerControlsRow`,
`SimplerControlsRow`, `DrumCellControlsRow`, `RackMacrosRow` and
`DrumRackMacroGrid` sit in their host's inset; the host owns it.

**The check.** `npm run shot:tour -- central` measures every state before
its picture (`scripts/shot/layout.mjs`): each divider must have the view's
`--central-gap` on both sides, and the content must sit `--central-inset`
from the frame on all four sides. Overlays don't count; a view centred on
one axis on purpose declares it (Utility). A violation names the element at
fault and fails the run. The tour now reaches every instrument view — the
eight the default scene has no track for are swapped onto the FM track in
Operator's place (`scene.mjs` `swapDevice`) — 35 states in all.

### What moved

| Was | Now | Where |
|---|---|---|
| 12px | 16px | Clip, System, Drift, Guitar, Auto Filter, Permute, Delay, Simpler, Reverb's controls, Squash's control groups, Tremolo's groups |
| 8px | 16px | Sampler and Omnisphere views; the wheel pairs in Wavetable, Electric, Meld and Drift; the envelope stages; Drift's level and voicing sliders; stacked controls in Arpeggiator, Clip, Pedal, Drum Buss, Guitar and Squash |
| 24px | 16px | Collision; the EQ and Digital insets |
| 12–16px | 8px | Audio Effect Rack |
| 8px | 8px | Drum Rack, Instrument Rack, Pattern Rack — same size, now by role |

**Found by the check on its first run**, both older than this ADR:

- Auto Filter's LFO Time/Sync toggle was drawn in flow, under the pad and
  20px past the frame's bottom edge, clipped. `.physical-button { position:
  relative }` in app.css is unlayered and beat Tailwind's `absolute`
  utility. A scoped `position: absolute` puts it back on the pad's corner.
- Drift's OSC badge was sized to its row's height, which on the iPad band
  is wider than its cell, so it overhung the card toward the frame (6.8px
  from the edge against the 16px inset once the card narrowed). Its cell is
  now a size container and the circle is `100cqmin`.

## Consequences

**Positive.**

- One size per boundary, in every view, chosen once. A new view gets it by
  using the two roles.
- The tour fails when a divider or an inset drifts, with the element named.
- Eight views that were checked by build only are now photographed and
  measured on every tour.

**Negative / accepted.**

- **Fixed, crowded views pay in width.** Drift's Time and Filter pads went
  from ~116px to 98px wide; the envelope stages in Operator, Wavetable and
  the Sampler view are a few px narrower each. If Drift needs width back,
  the fix is Drift's own column shares, not a third density.
- **The check covers dividers and insets only.** The gap between two
  controls with no divider between them, and spacing inside a control, are
  still held by review: a measurement cannot know which boxes are one
  control.
- **Swapped states render with Operator's parameters** (the racks get macro
  names), so they verify layout, not values.
- **Density inherits.** A standard view mounted inside a compact one is
  compact. That is the point for `PadFxPane`; there is no `standard`
  override rule, so a view that ever needs to opt back out adds one.

## Tags
`ui`, `central-views`, `layout`, `design-system`, `spacing`, `density`,
`shot-harness`
