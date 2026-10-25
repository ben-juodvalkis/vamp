# ADR-476: Smaller iPads Take the Compact Spacing

## Status
**Proposed** (2026-10-25), on the `smaller-ipads` branch. Amends ADR-434:
compact density is also a property of the screen. No Live restart
(interface only).

## Context
The interface was laid out on one screen, the 12.9-inch iPad Pro, at
1366×1024 points landscape. The general release will reach the smaller
iPads, so every view was photographed at their sizes with
`npm run shot:tour -- central --viewport <WxH>`:

| iPad | Landscape | Central frame |
|---|---|---|
| 12.9-inch Pro, 13-inch Air | 1366×1024 | 1062×330 |
| 11-inch Pro | 1194×834 | ~920 wide |
| 11-inch Air, 10.9-inch, base | 1180×820 | ~908 wide |
| mini | 1133×744 | 871×236 |
| 10.2-inch | 1080×810 | 826×258 |

The page itself scales: the section stack divides the height, the side
rails narrow to 8.8% of the width, the strips scroll sideways sooner and
the browser's grid re-lays itself. Most central views did too. Three did
not, and all for the same reason: their 44–56px sliders and their 16px
gaps keep their size, so the whole shortfall (191px on the mini, 236px on
the 10.2-inch) came out of the one or two columns that flex.

- **Analog**: the Filter pad, 160px on the 12.9-inch, was a sliver on the
  mini and gone on the 10.2-inch; Mono / Poly / Vib ran past the frame's
  right edge.
- **Meld**: the engine and filter columns (215 / 165px on the 12.9-inch)
  shrank until their type choosers read "‹ as ap ›"; on the 10.2-inch the
  tour could not tap them at all.
- **The note editor**: the Fold · grid · Triplet · Quantize column needs
  ~242px at its 44px floor. Every smaller iPad's editor is shorter, and so
  is the 12.9-inch's with CLIPS on, and Quantize was cut off.

## Decision
**Below 1366px wide, every central view takes the compact sizes**: 8px
for `--central-inset` and `--central-gap` (`@media (max-width: 1365.98px)`
in `app.css`). That hands back 8px per gap, 100px and more across a view
of ten controls, through the roles every view already uses, so no view
changes its markup. The layout check reads the roles off the page, so it
holds the views to the compact sizes there.

Two views also change their own columns under the same query. **Analog**:
Glide and the wheels come down to the 44px touch floor (Noise keeps 56px
for its "→F1+F2" chip), and the voice card and the filter share what is
left from their 12.9-inch widths, 196 and 160px, the voice card stopping
at 152px. **Meld**: the wheels come down to 44px.

**The note editor's chips have no floor.** They share the column's height
up to 72px each, so the floor only ever acted when the column was short,
and then it pushed Quantize out of it. A short chip beats a missing one.

The width is the test, not the height: the central frame is 1062px wide on
the 12.9-inch whatever the section count, so nothing under the query can
reach it.

## Consequences
- **The 12.9-inch is unchanged.** Shot back to back at 1366×1024, before
  and after: all five main layouts (`--reduced-motion`) and 72 of the 73
  central-tour states are pixel-identical. The one that differs is the note
  editor with CLIPS on, where Quantize now shows: four chips 35px tall.
  With three sections they are 57px, as before.
- On every smaller iPad the central views are tighter: half the space
  between controls and against the frame.
- Measured widths, voice card / filter for Analog, engine / filter for
  Meld:

  | | 12.9-inch | 11-inch Pro | 11-inch Air | mini | 10.2-inch |
  |---|---|---|---|---|---|
  | Analog | 196 / 160 | 196 / 182 | 196 / 170 | 180 / 147 | 156 / 128 |
  | Meld | 215 / 165 | 220 / 170 | 214 / 165 | 192 / 148 | 167 / 129 |

- The note editor's chips are 37–45px tall on a smaller iPad with three
  sections, shorter with CLIPS on.
- The breakpoint is the 12.9-inch's own width, so a Mac browser window
  narrower than 1366px gets the compact spacing too.
- Not addressed: Analog's filter-type strip on the 10.2-inch (128px for
  five labels, which run together); the main layout's 16px gutters; small
  label clips at the mini (the Guitar view's amp tiles, the Glue view's
  Threshold); the FX grid in the four-section layout on the mini, where
  Tremolo's name meets its rate; and portrait, which nothing here is laid
  out for.

## Tags
`ui`, `central-views`, `layout`, `spacing`, `density`, `ipad`,
`general-release`
