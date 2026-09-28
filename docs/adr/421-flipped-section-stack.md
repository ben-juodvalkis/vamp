# ADR-421: The Section Stack Reads Bottom-Up by Default

## Status
**Accepted** — refines ADR-416's stack (its section list, flex shares,
gap arithmetic and sidebar mirroring are all unchanged) and ADR-414's
Solo band. Reversible per-install: the `FLIP` switch in
`SystemCentralView`'s Sections card.

## Context

ADR-416 fixed the main area as a stack of up to four equal sections in a
fixed **top-down** order: track strips first, then the clip grid, the
central view, and the FX grid. The order was chosen for reading — the
thing you touch most is the thing you see first.

On the machine this interface actually runs on, reading order and
reaching order are opposites. It is a 12.9" iPad flat on a stand beside
a piano, and the hands come in from below. The track strips are the
surface's one continuous-gesture control — every strip is a full-height
volume fader, and the names double as mute buttons — so they are where a
hand rests between cues. Putting them at the top of a 1024px-tall screen
puts them at the far end of every reach, behind the FX grid, which is
mostly set once and left.

The strips' own internal order had the same problem one scale down. Each
strip is Name / Clip / Permute from the top, so the track's identity —
and its mute button — sits at the top of a ~330px card, while the Solo
button (ADR-414) hangs below the card at the very bottom. The two
controls that answer "which track is this, and is it sounding?" were at
opposite ends of the strip.

## Decision

**The stack reads bottom-up by default.** `uiPrefsStore.flipLayout`
(default **on**) mirrors the section order, so the FX grid is on top and
the track strips sit against the bottom edge of the screen, and moves
each track's name band to the foot of its own card, directly above that
track's Solo button.

Both halves are order-only changes:

| container | flipped how |
|---|---|
| `+page.svelte` middle column | `flex-direction: column-reverse` |
| `+page.svelte` right sidebar | `flex-direction: column-reverse` |
| `TracksPanelV6` `.tracks-panel` | `flex-direction: column-reverse` |
| `TrackStrip` name section | `order: 1` |
| `MasterTrack` card body | `flex-direction: column-reverse` |
| `+page.svelte` master sidebar row | `flex-direction: column-reverse` |

### What deliberately does NOT flip

- **Clip above Permute inside a strip.** That pair is a reading order,
  not a stack: you look at what the clip is doing, then at what Permute
  is doing to it. `column-reverse` on the card put Permute on top, which
  reads backwards — hence `order` on the one section that moves rather
  than a wholesale mirror.
- **The Solo button**, which is outside the Card. It stays at the foot of
  the column, so the flip lands the name directly on top of it and the
  two read as one block.
- **Scene rows and clip-grid rows.** Scene order is music, not chrome.
- **The clip grid's stop row and the scene rail's footer**, which stay at
  the foot of their own sections. Under the flip that puts the per-track
  stop cell directly above the strip it stops, and it keeps both columns
  dividing by the same `renderedRows + 1` — the whole ADR-415 alignment
  argument — untouched.
- **The transport header**, which is a fixed band above the stack, not a
  section of it.
- **Card top-edge treatments** — the glass highlight, the REC label —
  which belong to the card as an object rather than to the running order
  of its sections.

### Consequences that needed real work

**The TotalMix strip reverses with its row.** The five monitor cells are
a read-only mirror of what the room is hearing, so they belong at the
*outside* edge of the sidebar column in either order — furthest from the
controls, nearest the frame. Flipped that puts them under the master
card, on the very bottom edge of the screen, with the master's key
readout landing level with the track names beside it. (With the transport
header on they ride there instead and this row has no strip at all.)

**One bottom band, one height.** Three controls end up shoulder to
shoulder along the bottom edge: each track's name/mute band, its Solo
button, and the TotalMix monitor strip under the master. They were 56px
(flat) or a proportional third (GRATICULE), 44px, and 36px — a ragged
line. They now all read `--strip-band-h` (56px, `app.css`), which is a
named contract rather than three coincidental `--height-comfortable`s:
change it once and all three follow.

That also **fixes the name band in GRATICULE**, which had been a
proportional third. Clip and Permute split what is left, so they stay
equal to each other, and the change pays for itself: the fader travel is
"the strip minus the name", so a band that is fixed in both skins
collapses `--vol-travel` from a two-thirds formula *plus* a flat-grammar
override of it down to one rule, `calc(100% - var(--strip-band-h))`.
One fewer pair of numbers to keep in agreement by hand.

**The volume fader's travel band.** The edge ticks stop at the name
section's edge so the handle never rides over a control that is a mute
button rather than a fader. With the name at the foot, that band is now
the strip *above* it. `--vol-base` is the new starting offset on the
`bottom` axis: `0px` unflipped, `var(--strip-band-h)` flipped. The drag
itself is relative (`startValue + dy/height`), so the gesture needed no
change at all.

**The group bracket arm (ADR-413).** The arm is the group strip's title
block continuing sideways, and the title band moved — so the arm moves
with it, growing out of the strip's **bottom**-right. `TracksPanelV6`
mirrors the band rows to the end of `grid-template-rows` and places both
arms and strips by **negative** line numbers, which makes the placement
independent of the band count: band level `b` spans lines
`(-2 - b, -1 - b)`, and a strip enclosed by `k` open groups runs
`1 / -(k + 1)`. The group's own strip squares its bottom-right corner
instead of its top-right (`--strip-radius`).

**The Sections card outgrew one column.** Adding `FLIP` made seven
switches sharing ~256px, at 33px a row. The 44px touch floor would
*not* have caught that: `app.css` only applies it below the 1024px
breakpoint, so at the iPad's 1366px landscape width a 33px row renders
happily — and looks fine in a desktop browser too. The card is two
columns of four now (`grid-auto-flow: column`, so it still reads down
the left then down the right), which buys ~76 x 61px per switch. Same
trade the scene rail's footer makes with its two arrows, for the same
reason.

## Why a switch and not just a new order

The flip is a claim about one performer's stand, not about layout in
general. It ships **on** because that is the machine this interface is
built for, and `FLIP` sits last in the Sections card — after the switches
whose order it inverts, since it cannot be read before them.

## Verification

- `unflipped` / `unflipped-full` shot views pin the pre-flip order, so
  both orders stay under the golden guard rather than only the default.
- A capture with `flipLayout` off is **bit-identical** to the pre-ADR-421
  build (verified by `--diff` against a stashed-tree capture): everything
  here is gated, nothing changed the un-flipped path.
- `visibleSectionCount` deliberately ignores `flipLayout` — the count
  sizes the scene window, and turning the screen over adds no room for
  scenes. Pinned by a test.
