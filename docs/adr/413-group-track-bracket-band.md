# ADR-413: Group Track Panhandle (Bracket Arm Over Members)

## Status
**Accepted** (2026-08-08)

## Context

ADR-410 taught the UI what a Group Track is: groups get their own strip
variant (name / inert body / full-size fold chevron) and folding one
hides its children. What it did **not** do is show *membership*. With a
group open, its children sit in the row as ordinary strips — nothing on
screen says which tracks belong to the group, or where the group ends.
The only signal was ordering, and ordering is invisible when six strips
look identical.

Live solves this in its mixer with a group header spanning its member
tracks. The row here is the same shape rotated: columns instead of rows,
so the equivalent is a horizontal arm reaching out over the member
columns — a panhandle.

## Decision

### The arm grows out of the group's strip; members hang below it

Each open group with at least one visible member draws an arm from the
**top-right of its own strip**, reaching right across every visible
member column. Two consequences define the whole layout:

- **The group's strip keeps its full height.** The arm is part of that
  strip's outline, not something sitting on top of it. Together they form
  one ⌐-shaped body — the panhandle, with the group's strip as the body
  and the arm as the handle.
- **Member strips start below the arm, with a gap**, and keep their own
  complete rounded outlines. They read as tracks hanging *under* the
  group, not as cells fused to it.

So a group is legible three ways at once: it's taller than its members,
it has an arm, and the arm's extent is exactly the group's extent.

### The arm is the strip's outline continuing sideways

The arm takes `.glass-card`'s own wash and border values in the group's
ink, because it is not a separate bar. Its left edge is open (no border)
and a negative margin pulls it back across the column gap and **2px into
the group's strip**, covering that strip's right border for the arm's
height at both of that border's widths — 1px at rest, 2px when selection
widens it. That overlap only works if the arm paints **above** the
strips, so it carries `z-index: 1`: the arm elements come before the
columns in the DOM, so without it the card wins the paint order and the
strip's right border draws straight across the join — the arm then reads
as a separate rectangle butted against the strip rather than continuing
its outline. The group's strip squares off only its **top-right** corner
(`--strip-radius`, a custom property the panel sets on the column and
`TrackStrip`'s Card reads; unset elsewhere, so every other strip keeps
the plain all-round radius). The result is one continuous outline: along
the strip's top, out through the arm, around its rounded right end, back
along its underside, and down the strip's right edge.

Matching outlines is not enough — the **fields** must match too. The
strip's visible ground is not the bare `.glass-card` wash: the
full-height meter well (an opaque `--surface-well` layer at
`constants.ui.meters.opacity`) darkens the whole card. The arm has no
meter, so it reproduces that layer **structurally** — a `::before` with
the same color and the same element-opacity compositing
`.meter-background` uses. An earlier pass flattened the stack into one
nested `color-mix()` with a `var()` percentage; it matched in headless
Chromium and rendered **transparent** in a real browser, splitting the
fields at the join. Same primitives, same rendering, everywhere — that's
the rule this leaves behind. (The arm doesn't render the live meter
*fill*; the fill rises bottom-up, so the strip's field beside the join
only lights near peak level.)

### The arm follows the strip through selection

Selecting the group highlights the whole ⌐ perimeter, not just the
strip's rectangle. The panel derives `selected` per band from
`session.selectedTrackIndex`, and `.group-band.is-selected` mirrors
`.track-selected` value for value: 2px full-ink border, 18% wash (under
the same well layer), soft glow.

Two pieces of `.track-selected` cannot be copied literally on a shape
that fuses into another element, and each gets a workaround:

- **The crisp 1px ring** is a spread box-shadow, which an element can
  only draw on all four sides — on the arm its left side would paint a
  vertical seam inside the strip at the overlap. The arm's ring is a
  three-sided `::after` border instead (left edge open, 1px outside the
  border-box, radius bumped to track the outer corner), which meets the
  strip's own ring seamlessly along the shared top edge.
- **The soft glow** is a blurred box-shadow with the same four-sides
  problem. The arm clips its painting at its own left edge
  (`clip-path: inset(-16px -16px -16px 0)`) — the clip line sits inside
  the strip, so the border-cover overlap keeps working, while glow and
  ring stay free on the three perimeter sides.

### Rejected: making the arm flush with the members

Two earlier passes fused the arm to the member strips — squaring their
top corners, removing the gap, and (worse) painting the group's name
third as a solid ink slab continuing the band downward. Both were wrong,
for the same reason: they made the members look like cells *of* the
header rather than tracks hanging *under* it, and the solid slab was
simply loud. The gap is what makes the members read as separate tracks,
and it is the thing that was asked for.

### `offsets` is not "bands covering this column"

An arm pushes its **members** down but not the group it belongs to,
because that arm is beside that column, not above it. So
`groupBandLayout` assigns each band's `start` column an offset of
`band` and its member columns `band + 1`. Get this wrong and the group
strip drops below its own arm, breaking the ⌐ into two disconnected
pieces — there's a test pinning exactly that invariant.

### The row is a grid

`.tracks-row` is CSS grid rather than flex. An arm has to span N columns
*and* the gaps between them, which grid does by line number with no
measurement — no `getBoundingClientRect` per column, no resize observer
that can drift. Column sizing is unchanged in effect:
`minmax(--track-min-w, 1fr)` is the grid spelling of the old
`flex: 1 1 0` + `min-width: 80px`, so share-evenly-then-overflow-to-scroll
behaves identically.

Rows are `repeat(bandCount, --group-band-h) 1fr` with a 6px `row-gap` —
that gap is the clear space under each arm. A column with offset *d* is
placed `grid-row: d + 1 / -1`, which is "starts below *d* arms" with no
height arithmetic, and a strip spanning several rows covers the row gaps,
so the group's full-height strip stays continuous through them.

### Nesting stacks, and stops stacking at four

A nested group's arm sits one band below its parent's, and the nested
group's own strip sits level with its arm (offset from the *outer* arm
only). Depth beyond `MAX_GROUP_BANDS` (4) flattens onto the innermost
band rather than stacking further — arms consume height from the member
strips, so an uncapped stack would shrink them without limit.

### Offsets derive from drawn brackets, not from ancestor depth

`trackGroupDepth` would be the obvious source and it is wrong here. In
`active` filter mode a group track can be filtered out while its children
survive; counting ancestors would push those children under an arm
nothing was ever drawn in. `groupBandLayout` computes spans first, then
derives each column's offset from the brackets that actually cover it, so
the layout cannot disagree with what's on screen.

Span detection is a forward scan, which is sound because **members are
contiguous in LOM order and stay contiguous after filtering**: any
visible track between two members is itself a member.

A **folded** group draws no arm — its members aren't in the row, and an
arm over nothing is noise. Same for an open group whose members were all
filtered out.

### The arm opts out of the 44px touch floor

`app.css` gives every `button` a `min-height: 44px` floor under
`@media (max-width: 1024px)` — the iPad touch-target rule. The arm is a
14px band by design, and left at 44px it overflows its grid row and
swallows the strips below it. So `.group-band` sets `min-height: 0` /
`min-width: 0` explicitly.

This is a trap worth naming: the media query is **inactive at desktop
widths**, so the arm measures a correct 14px in a browser at 1180px and
breaks only on the actual target device. Any future control deliberately
smaller than 44px needs the same opt-out, and needs verifying below the
breakpoint.

Folding has a full-section chevron on the group strip; the arm is the
secondary path, and it is wide even when thin.

### The arm folds the group

The arm's one action is fold — it only exists while the group is open, so
that's the only state change it can express. Unfolding stays on the
strip's full-size chevron, the only control a folded group still shows.
No new wire: it calls the same `setTrackFoldState` the chevron does.

## Consequences

- Group membership is legible at a glance without opening Live, and a
  group strip is distinguishable from its members by height alone.
- Member strips lose `--group-band-h` + `row-gap` (20px) per enclosing
  group. The group's own strip loses nothing. On an iPad the strip is the
  full panel height, so one or two levels is a rounding error against the
  volume-fader travel; the four-band cap bounds the worst case.
- The row is a grid, so future work assuming flex children
  (`flex-basis`, `order`) needs the grid spelling instead.
- The arm is chrome, not a strip: it reads `v3Store` directly rather than
  spinning up a `useTrackData` (which would mount per-track observers for
  a decorative element).
- Fold is reachable from two places on an open group. Deliberate — the
  arm is where the eye already is when reading membership.
- A folded group has no arm, so it loses the height distinction and reads
  as an ordinary strip again (its chevron is the remaining signal).

## Files

- `interface/src/lib/utils/trackGroups.ts` — `groupBandLayout` (pure)
- `interface/src/lib/stores/v6/clipStateStore.svelte.ts` — `groupBands`
- `interface/src/lib/components/v6/layout/TracksPanelV6.svelte` — grid row,
  arm rendering, fold tap, `--strip-radius` on group columns
- `interface/src/lib/components/v6/tracks/TrackStrip.svelte` — Card radius
  reads `--strip-radius`

## Verification

Rendered against a synthetic set (a group holding two tracks plus a
nested group holding two more, two ungrouped tracks, one folded group)
through the real `TracksPanelV6`, measured from the DOM **at a 1024px
viewport** — below the touch-target breakpoint, i.e. under the same
conditions as the iPad. Verifying only at desktop width is what let the
44px arm bug through the first time.

At 1024px, `grid-template-rows` computes to `14px 14px 609px`, gap 6px:

- Group column `top=28.0` — identical to the ungrouped columns, i.e.
  full height.
- Its arm `top=28.0` (level with the strip's own top edge, so it grows
  out of it) and `x=107.9` against the strip's right edge of `108.9` —
  the overlap that covers the border at the join (1px at the time of
  this measurement; since widened to 2px for selection's border width,
  re-verified live: arm `x=630` against strip `right=632`).
- Arm `right=673.3` equals the last member column's right edge: the arm
  covers exactly the members, to the pixel.
- Members `top=48.0` against arm `bottom=42.0` — the 6px `row-gap`.
- Nested arm at `48.0 → 62.0`, level with the nested group's own column
  (`top=48.0`), overlapping it by 1px (`x=446.5` vs `right=447.5`), and
  its members at `top=68.0`.
- Both arms measure exactly 14px tall, confirming the touch-floor
  opt-out holds where the media query is live.

The field and selection work was verified by pixel-sampling live
renders: strip interior and arm interior both `(31, 32, 24)` selected
and `(24, 26, 22)` at rest, and the strip interior beside the join
uniform up to the perimeter border (no glow bleed) after the clip.

## Tags
`group-tracks`, `track-strip`, `layout`, `ui`, `grid`
