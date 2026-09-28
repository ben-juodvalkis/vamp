# ADR-415: Session View in the Track Strips — Clip Grid, Scene Rail, Shared Scroll Window

## Status
**Accepted** (phase 1)

## Context

The performance UI showed one clip per track — whatever was playing,
rendered by `TrackClipView`. Everything else on the track was
invisible: a performer could not see what else was loaded, could not
launch a different clip, and could not record into a specific slot
without leaving the surface for Live itself.

The full slot grid was already on the wire and had been for some time.
`state/full` ships an **S record** per slot (`slotPath`, `state`) and a
**C record** per clip (`clipPath`, `name`, `length`, `color`, `pitch`)
for every slot of every track, `clip/created` / `clip/removed` keep
existence live, and `clip/launch` + `scene/launch` already existed as
control wires with UI senders. `normalized.svelte.ts` was already
parsing S/C records into `track.slots` with identity-preserving
reconciliation. **Almost nothing was missing but the UI** — the grid,
the scene rail and the shared scroll window all ride wires that already
existed.

One field did turn out to be missing, and only one: a **sample path for
a slot that isn't playing**, which no existing address carried. That
cost exactly one new pull endpoint,
`/looping/v3/clip/sample/get` → `/looping/v3/clip/sample`, described
under "The missing field: a sample path per slot" below. Everything
else in this phase is UI.

The constraint that shaped the design: the existing layout is a
performance instrument people rely on mid-set. Adding a mode must not
perturb it when the mode is off.

## Decision

An optional, persisted **session mode** grows the track strips into the
central row's space and gives each a clip-slot grid, with a
scene-launch rail mirroring it in the right sidebar.

### Session mode is off by default and off is byte-identical

`uiPrefsStore.sessionMode` (localStorage, default off). With it off the
UI is pixel-identical to before — verified by screenshotting the page
at HEAD and with these changes at iPad viewport and diffing: 72 of
786,432 pixels differ with a max channel delta of 11, which is *below*
the render noise floor (two captures of identical code differ by 73
pixels at max delta 106, because the meter visualisations animate).

Rows collapse via `flex-grow: 0` + `overflow: hidden` + `min-height: 0`
rather than `display: none`, so the transition animates and the
collapsed panel's component state survives the flip.

### The slot zone lives OUTSIDE the strip's Card

This is the load-bearing structural decision, and it follows ADR-414's
precedent exactly. The grid is a **sibling** of the Card in
`.strip-col`, not a child. Three problems dissolve at once:

- **Gesture isolation is free.** A drag in the grid cannot reach the
  Card's volume fader because there is no bubbling to stop. Had the
  zone been a child, every press would have needed a
  `stopPropagation` — one missed path away from scrolling scenes and
  setting a track's volume simultaneously.
- **The meter wash and volume edge ticks stay confined to the top
  block** with no masking, because they are painted inside the Card and
  the Card is now just the top block.
- **No conditional wrapper.** With session mode off the component is
  simply not rendered, so the strip's DOM is untouched.

### One shared scroll window, in scene rows

`sceneWindowStore` holds a single offset that every strip's grid and the
rail read, which is what makes them scroll as one. The offset is
measured in **scene rows**, floats during a drag and snaps to a whole
row on release, so the grid never rests mid-row.

`sceneCount` is **derived**, not stored: Live's session grid is
rectangular, so it is the widest `track.slots` map in the v3 store.
Scene add/remove restructures every track's `clip_slots` and arrives as
a `state/full` re-ride, so deriving means the count follows scene churn
with no extra wire.

Offsets are clamped on **read** as well as on write. A write can only
clamp against the scene count known at the time; deleting scenes makes a
stored offset stale with nobody writing. Clamping in the getter handles
that without an `$effect` — which matters, because a module-level store
has no component to own an effect's lifetime.

### The main area is always three equal thirds

Session mode does not resize anything. It changes **which panels
occupy** the three thirds:

| mode | third 1 | third 2 | third 3 |
|------|---------|---------|---------|
| off | track strips | central view | FX grid |
| on, `FX` | track strips | **clip grid** | FX grid |
| on, `VIEW` | track strips | **clip grid** | central view |

So the clip grid is exactly as tall as a track strip, the central view
or the FX grid — never a fraction of a row, never a second size class.
Three of the four panels show at a time; the fourth is hidden with
`display: none`, **not** collapsed to zero height. That distinction is
load-bearing: a zero-height flex item still contributes its gap, which
would make the middle column one 16px gap taller than the sidebars and
throw every row edge out. Removing the item keeps the gap count equal
across all three columns. The subtree stays mounted either way, so the
hidden panel's component state survives the flip.

One third is defined once, in `+page.svelte`:

```css
.third { flex: 0 0 calc((100% - 2 * var(--spacing-lg)) / 3); }
```

Every row in the middle column and the right sidebar resolves to that,
and the browser rail's three button groups (`flex: 1`, two gaps) land on
the same edges. The tracks panel is the single exception — `flex: 1`,
taking the leftover — which is one third when three rows show and two
thirds plus a gap when session mode hides one of them.

Measured at 1366×1024 with the transport header on (the case that used
to break): tracks row 72–379, clip grid 395–701, FX grid 717–1024; scene
rail 395–701; browser rail groups 72–379 / 395–701 / 717–1024. Every
third is 307px and all three columns agree exactly. With session mode
off: 0–331 / 347–677 / 693–1024 across all columns.

### Alignment is guaranteed by construction, not by tuning

The grid and the rail no longer share an absolute length — they share a
**third**. The grid occupies the main area's middle third and the rail
occupies the right sidebar's middle third, which the thirds rule above
makes the same height. Each then divides its own box by the number of
rows it draws, so both arrive at the same pitch with nothing to keep in
sync. Each publishes that pitch as `--session-row-h` in px (measured via
`ResizeObserver`) because the zones read it back through
`getComputedStyle().getPropertyValue()` to convert a pixel drag into a
row drag.

**Fewer scenes than the window fill the third.** The divisor is
`sceneWindowStore.renderedRows` — `min(sceneCount, 4)` — so a two-scene
set draws two tall rows rather than four short ones over dead space.

Nothing here knows about the Solo band any more: that band lives inside
the strips' third and no longer moves the grid.

### The sidebar's middle third is split, not handed over

The scene rail has to live in the sidebar's middle third — that is the
third the clip grid occupies, and being level with it is what makes the
rows line up. That third already belonged to `VerticalQuantizeControl`,
the **clip groove quantization amount** slider
(`clip/groove/set_quantization_amount`), for which the sidebar is the
only surface.

So the third is **split in half**: scene rail on the left, groove
quantize on the right, ~56px each. Both are vertical controls that only
ever needed height, and half of 120px still clears the 44px touch
floor — the rail costs width, not a control. The rail goes on the left
so it sits directly against the grid it scrolls with.

Each side renders a `compact` variant, because the full-width forms
don't fit ~56px: the quantize glyph drops from `text-6xl` to `text-3xl`,
and the rail's scene buttons drop the `SC` prefix (the ▶ glyph plus the
number still reads as "launch scene N").

An earlier draft of this ADR claimed the quantize control was "still in
the System view per ADR-411". That was wrong and worth recording:
ADR-411 moved *launch* quantization, a different control. The groove
slider was never part of it, and before this split, session mode did
genuinely remove the only way to reach it.

### One scroller, so a clip column cannot leave its track

The clip grid is **the second row of `TracksPanelV6`**, not a separate
panel. Both rows sit in that panel's single `overflow-x` box, so there
is one `scrollLeft`: panning either row pans both, and a clip column
physically cannot drift out from under the strip it belongs to. They
also share `grid-template-columns` verbatim, so column N is the same
column in both rows by construction rather than by measurement — no
scroll syncing, no drift to reconcile.

This is why the grid lives in the panel rather than in each strip. The
earlier design hung it off each `TrackStrip` as a Card sibling, which
gave gesture isolation for free but made the grid a fraction of the
strips' third instead of a third of its own.

### Two instances of one gesture machine

The ADR-384 machine moved out of `TrackStrip.svelte` into
`useStripGestures`, parameterised by drag/tap actions. The strip runs
one instance (vertical = volume, tap = section dispatch); the slot zone
runs a second (vertical = scene scroll, tap = launch). Both keep
horizontal = row scroll, so a sideways drag started anywhere on a strip
feels the same.

Two semantics are preserved verbatim because they are bug fixes, not
style: listeners bind to `window` rather than using
`setPointerCapture` (capturing on a re-rendering subtree drops
`pointerup` on desktop Chrome), and **a scroll-mode release or any
`pointercancel` never dispatches a tap** — scrolling must never launch
a clip.

The zone sets `touch-action: none` because it needs both axes on touch,
which means the browser will not pan it natively; the machine therefore
drives the row scroller itself there (`scrollOnTouch`), unlike the strip
where `pan-x` leaves the pan to the browser.

### Cells draw real clip content, through ONE renderer

A cell draws the same waveform / MIDI note lanes the track strip draws,
because it is literally the same component. `ClipPreview` was extracted
out of `TrackClipView` and is now the single implementation of "draw a
clip"; `TrackClipView` became a thin adapter over `playingClipsStore`,
and `SlotCell` is a second adapter over the slot's own data.

The extraction is what made this possible at all. `TrackClipView` took
a `PlayingClipEntry` and read everything off it, and a grid cell for a
slot that has never played has no such entry. `ClipPreview` takes plain
primitives instead (`isAudio`, `filePath`, `clipPath`, window bounds,
`status`, `fraction`), which is also what keeps its canvas effect off
the 30 Hz path: an entry *reference* changes every playhead tick,
whereas those fields change only on slot/loop edits, so Svelte's `===`
memoization has something stable to hold. `fraction` is the one prop
that moves at 30 Hz, and it drives a single `left:` write.

`TrackClipMidiView` was decoupled the same way — window primitives and
`clipPath` as props rather than an entry.

**Cells are typeset for their size.** The grid owns a whole third now,
so a cell is a full row tall and wide rather than a chip: the name is
centred on both axes at 0.9375rem and **wraps to up to 3 lines**
(`-webkit-line-clamp`, `overflow-wrap: anywhere`) instead of ellipsing
at the first overflow — clip names are exactly the kind of string where
the tail distinguishes two of them ("3 OP Boom groove 01_101 bpm").
The state glyph is pulled **out of flow into the top-left corner**:
inline, it sat inside the centred group and pushed the name off-centre
by half its own width. The 3-line clamp is not cosmetic — row height is
load-bearing for rail alignment, so a very long name must not be able
to grow the row.

**The playhead runs in the grid too**, on the one cell that is playing
(`slotIdx === playingSlotIdx`), read from the same position channel the
strip uses. One source, so the two cannot drift.

**The strip drops its own preview while session mode is on.** The grid
a third below already draws every clip on that track including the
playing one, so the strip's Clip section would be the same content
twice. The section itself stays — it is the select-and-show-Clip-view
tap target either way.

### The missing field: a sample path per slot

MIDI needed no protocol work at all: `clip/notes/get` is path-keyed and
already resolves any clip, so `ClipPreview` pulls notes straight from
`clipPath`.

Audio did. A waveform needs a sample path, and nothing on the wire
carried one for a non-playing slot:

- `track/playing_slot` carries `filePath`, but PlayheadComponent emits
  it from ONE `playing_slot_index` listener per track — the playing
  slot only.
- `clip/property` fires only for the focused clip.
- `state/full`'s `C` record is `clipPath, name, length, color, pitch`.

So ADR-415 adds `/looping/v3/clip/sample/get` → `/looping/v3/clip/sample`
(`requestId, clipPath, isAudioClip, filePath`), handled by
**`ClipsComponent`** — not a component of its own. It is a read on a
`tracks/N/slots/M` path, and that component already owns that scope and
its resolution; a separate component was surface area for nothing.

**A pull endpoint, not a field on the C record.** Putting `file_path`
on every clip record was the obvious move and the wrong one:
`state/full` is a bundled ride under a UDP datagram cap, sample paths
run 80–150 characters, and a modest 8×8 grid would add 5–10 KB of
strings to a bundle that already chunks. A pull costs nothing for sets
nobody is looking at, and the UI asks only about cells on screen, so
traffic scales with the viewport rather than the set. `clipSampleService`
caches answers by `clipPath` (cleared on `bridge-resync`), so scrolling
the scene window back and forth re-queries nothing.

**Two non-errors, deliberately.** A MIDI clip replies `isAudioClip=0`
rather than erroring — the UI branches on that bit to draw note lanes,
so the error channel would cost it the one thing it needs. An audio
clip with an empty `file_path` also replies: Live reports one while a
recording is still flushing to disk, and a fresh recording must not
look broken in the grid. Only an unresolvable path errors.

### Launches render no optimistic state

Clip and scene launches are fire-and-forget control wires (wire-protocol
§4.4). Cells paint only from store data. The live overlay resolves the
S-record snapshot against `playingClipsStore`: the live channel wins for
the one slot it is about, and a `playing`/`recording` state from an
older snapshot is demoted to `has_clip`, because the S record is not
re-emitted when a clip stops and would otherwise stay lit forever.

### Both switches live under the loop brace

`SessionLayoutToggles` puts two small buttons at the foot of the right
sidebar, under the clip loop brace: **CLIPS** (session mode on/off) and
**FX / VIEW** (which panel gets the bottom third).

They are layout controls, so they belong in the sidebar's own chrome
rather than overlaid on the panels they control: the FX grid's twelve
slots leave no free corner (its top-right is Utility, a full-height
two-row slot), and the strips are wall-to-wall gesture surface. Under
the loop brace is the one spot that is neither.

Putting the session switch here rather than inside a central view is
what makes it reachable at all times — turning session mode ON no longer
requires first navigating to a view. Both buttons stay mounted in every
mode so the loop brace above never resizes when the layout flips;
FX/VIEW is inert (not absent) with session mode off, where both panels
are visible and there is nothing to choose between. The cost is ~48px
off the loop brace in every mode.

Opening the clip editor auto-flips the row to the central view —
edge-triggered on the open, so a manual flip back to FX stands and
closing the editor never flips anything back.

### No new central view

An earlier draft gave the master strip its own `MasterCentralView` to
hold these toggles. That was dropped: it created a second settings
surface alongside `SystemCentralView`, which already owns the Appearance
card. The transport-header toggle now sits beside **Solo** in that card —
same kind of thing, one place — and the master strip's tap is back to a
no-op. One settings view, not two.

## Consequences

- Session mode off costs nothing: no new DOM in the strips, no new
  listeners, no layout change.
- Only the rows on screen plus one are mounted, so a set with many
  scenes does not mount scenes × tracks cells.
- **The transport header's tempo address was audited and kept.**
  `/live/song/set/tempo` is not stale — Python's `SessionComponent`
  implements it with 20–999 validate-and-reject and `SystemCentralView`
  writes tempo the same way. Keeping both on one address is the point.
- The header's debug chrome (OSC-tester button, error-count badge, "V6"
  badge) was stripped; those jobs stay in the System view.
- **STOP ALL guards on the set having a scene.** `scene/stop` resolves
  its `scenePath` purely to validate it before stopping every track, so
  an out-of-range index returns `scene-not-found` and stops nothing.

## Notes for later phases

Two findings change what phases 2–4 need to do:

- **`/looping/v3/clip/stop [trackPath]` already exists** —
  implemented in `ClipsComponent` (calling `track.stop_all_clips()`),
  documented in wire-protocol.md, with a `sendClipStop` sender already
  in `simpleClient`. Phase 2 planned to add
  `/looping/v3/track/stop_clips` for exactly this; that address is
  unnecessary, and the per-track stop cell needs **no protocol work at
  all** — only the cell. It was left out of phase 1 solely to keep to
  the agreed phase boundary.
- **Group-slot behaviour is still unprobed.** Whether `slot.fire()` on
  a group slot launches the scene-section within the group needs a live
  Live instance (`owner/probes/lom_introspect_probe.js`). Phase 1 ships the
  safe fallback the spec specified: group strips render an inert body
  with no launchable affordance.

Also still open from the spec: `--act-play` was added as a new token
(there was no "playing" ink; it shares the green family with
`--act-loop-handle` but sits deeper so a playing cell reads against the
loop chrome), and the Quantize row collapses in session mode rather
than restacking — revisit in phase 4 per ADR-411.

## Related

- ADR-384 — strip gesture machine (extracted here)
- ADR-414 — Solo band, the precedent for a region outside the Card
- ADR-410 / 413 — Group Track strips and bracket bands
- ADR-411 — launch quantization in the System view (why Quantize is the
  row that gives up its space)
- ADR-360 — `playingClipsStore`, the live overlay's source
- ADR-402 — a view wears its subject's ink

## Tags
`session-view`, `clip-grid`, `scene-rail`, `track-strip`, `gestures`, `ui-prefs`, `wire-protocol`
