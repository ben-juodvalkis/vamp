# ADR-417: Select-Only Cells, the Pedal Owns Firing, and One Visible Cursor

## Status
**Accepted** — revises ADR-415's tap semantics (its clip grid, scene
rail, shared scroll window and `clip/sample` wire are unchanged).

## Context

The session view (ADR-415/416) and the foot pedal were built against
different cursors and neither knew about the other.

The pedal has always acted on `song.view.highlighted_clip_slot` —
Live's own selection, the intersection of the selected track and the
selected scene. `FootTriggerComponent.handle_tap` branches on that one
slot's state and nothing else.

The grid's cursor was `sceneWindowStore.offset`, which is client-side
and never reaches Live. So of the grid's gestures:

- a **scene drag** moved what you saw and not what the pedal would hit
- a **cell tap** launched the clip and selected the track, which moved
  the pedal's *column* but left its *row* wherever Live had it
- a **long press** was the only gesture that re-aimed the pedal, via
  `clip/focus`, which writes `highlighted_clip_slot` outright

Neither cursor was drawn. The failure that motivated this: tap a cell at
scene 5 to launch it, stomp expecting overdub, and the pedal instead
fires the highlighted slot at scene 0 — which, being empty on a track
that auto-arm just armed, **starts a recording nobody asked for**.

Before ADR-415 this could not really happen. There was one clip per
track, and the highlighted slot was effectively the only cursor there
was.

## Decision

**Touching a cell aims the pedal at it. Only the pedal and one small
strip per cell make sound.**

### The cell body selects; a trailing strip acts

A tap on a cell sends `/looping/v3/selected_clip [trackPath,
sceneIndex]`, which writes `highlighted_clip_slot` — the exact property
the pedal reads. Aiming the pedal and touching a cell became the same
gesture, so there is no second cursor to keep in sync and no ack to
wait for before the grid can paint the new target.

That wire already existed (`SelectedTrackComponent.handle_select_clip`,
the v3 replacement for AbletonOSC's `/live/view/set/selected_clip`) with
**zero UI senders** — the only reference in `interface/src` was a bridge
scope-partition test. No protocol work was needed for any of this.

It writes the highlight *and* selects the track. Both halves are load
bearing: the highlight is an intersection, so moving only the row would
leave the pedal pointed at some other track's slot in that row.

Firing stays reachable through a full-height **action strip** on each
cell's trailing edge, which branches on what is in the slot:

| cell state | strip | wire |
|---|---|---|
| empty | ● record | `clip/launch` |
| clip, stopped | ▶ play | `clip/launch` |
| clip recording | ▶ end take, loop it | `clip/launch` |
| clip playing | ■ stop | `clip/stop` |

The recording case is ▶ and not ■ deliberately: firing a recording
session clip is how a looper *closes* a take and keeps what was played,
where stopping would end it without ever looping it.

**The UI decides that branch itself.** The cell is already painting
that state (`deriveSlotCellState`), and both wires already exist — so
there is no per-slot action address, and nothing on the surface to keep
in step with the pedal's own branch.

The strip is **not** a pedal equivalent, and that division is the point:
the pedal runs the looping *cycle* (record → close → overdub) because
that is the performance gesture; the strip is the explicit transport
action for setup and correction.

### The strip is geometry, not a `<button>`

The grid does not hit-test the DOM. `slotIndexAt` floors `offset +
localY / pitch` precisely so the gaps between cells belong to a row
instead of swallowing taps (ADR-415), and the gesture machine owns the
pointer for the whole column.

A real `<button>` inside a cell would undo both: its `pointerdown`
bubbles to the zone, so every path would need a `stopPropagation` — the
thing ADR-415 removed by putting the zone outside the Card — and a drag
started on it would stop scrolling scenes.

So the strip is a **known rect tested in the same arithmetic**: press X
against `actionStripWidth(cellWidth)`, everything else selects. Drag
from anywhere, strip included, still scrolls. `slotActionZone.ts` is
that formula, pure and shared by the paint and the hit test — if the two
could disagree, a press landing on the button you can see would do the
other thing, on the iPad, mid-set.

**A full-height tab rather than a corner button**, because the row pitch
is only 48–56px: a square target big enough to hit would eat half of a
minimum-width (80px) cell. Taking the full height buys the same area off
the axis with room to spare and leaves the cell's middle — what you aim
at to select — the largest thing in the box. `clamp(36px, 32%, 48px)`,
so it stays thumb-sized without eating narrow columns. On its narrow
axis it is under the 44px touch floor; that is an accepted trade for an
aimed secondary action, and it is why the primary action is the rest of
the cell.

### The cursor is drawn, in two parts

Both halves already ride the wire (`selected_track`, `selected_scene`),
so the target needs no channel of its own:

- the **selected scene row** takes a master-ink wash across every column
- the **pedal target** — one cell in the whole grid — takes a crisp
  neutral ring

The ring is neutral on purpose. Every ink in the cell is already spoken
for by a transport state, and the one thing this marker must never do is
read as "playing" or "armed". It is an `outline` rather than a
`box-shadow` because the queued-launch blink owns `box-shadow`, and the
scene wash is a pseudo-element for the same reason.

### The scene rail mirrors the grid, and its footer steps the selection

Scene buttons get the identical split: tap selects the row, a trailing
strip launches it. The rail's tap dispatch moved from `elementFromPoint`
+ `data-scene-index` to the geometric `sceneIndexAt` it already had, so
the gaps between buttons stop being a dead band.

**STOP ALL is replaced by ▲/▼ scene-step buttons**, side by side. Side
by side is a constraint, not a preference: this row is one pitch tall,
which falls to ~48px as the window scales to 8 rows, so stacking would
leave each arrow ~24px — under the touch floor, and invisibly so, since
that floor only applies below the 1024px breakpoint and a desktop
browser looks fine. Splitting the 120px sidebar width instead gives each
~56px across the full pitch.

The footer stays **exactly one row**. The rail divides its section by
`renderedRows + 1` and the grid divides its own by the same, and that
matched +1 is the entire reason their rows line up.

Global STOP ALL now lives only in `SessionHeaderV6` (the optional
transport header). Per-track stop cells under the grid are unchanged,
and a playing cell's ■ strip is a second way to reach the same wire.

### The window follows the selection

`sceneWindowStore.ensureRowVisible` scrolls the minimum distance to
bring the selected row on screen, and nothing if it is already there.
The arrows can walk the selection past the window's edge, and a cursor
you cannot see is exactly the problem the highlight exists to fix.

Minimal rather than centring: a performer's eye is already on the grid,
and re-centring on every arrow press would move every other row under
their hand. It yields entirely while a drag is in flight — the finger
owns the window then.

### The pedal learned to close a take

`handle_tap` gained one branch, and the order is the whole fix:

```
empty      → fire   (records on the armed track)
recording  → fire   (ends the take, launches it as a loop)
playing    → toggle session_record  (overdub)
stopped    → fire   (play)
```

A clip Live is recording into **also reports `is_playing`**, so the
previous code — which checked `is_playing` second and had no
`is_recording` check at all — collapsed the take-ending press into the
overdub branch. The looper cycle stalled at one press: you could start a
recording and never close it from the pedal.

A raising `is_recording` degrades to `False` rather than aborting the
tap. Losing the flag costs one press its correct branch; aborting would
cost the gesture entirely.

### The cell's state glyph is gone

ADR-415 put a state mark in each cell's top-left corner. Next to an
action strip it became a trap: the corner said what the clip **is** and
the strip says what a press **does**, which are inverses — a stopped
clip showed ■ in the corner and ▶ in the strip, a playing one the
reverse. Two opposed glyphs 40px apart is a coin toss under a finger
mid-set.

It was also redundant. A cell's fill already carries state: dashed for
empty, track ink for a clip, `--act-play` for playing, `--act-rec` for
recording. Dropping the glyph removes the ambiguity and hands its
corner back to the name, which is the thing actually being read at that
size.

## Consequences

- **Nothing in the UI fires a clip by accident.** Every launch is either
  a deliberate strip press or a pedal stomp.
- **`ExclusiveArmComponent` makes tap → stomp → record work with no
  extra step**: selecting a track arms it. With the `auto_arm` toggle
  **off**, the pedal's record branch is a silent no-op on a disarmed
  track — `slot.fire()` on an empty slot of an unarmed track does
  nothing at all, and now that the pedal can be aimed anywhere that is
  easier to hit than it used to be.
- The overdub branch toggles the **global** `session_record`, so it is
  the one step that isn't slot-scoped. Exclusive arm means one armed
  track in practice, so it behaves as though it were.
- Long press still focuses (`clip/focus`), which also writes the
  highlight — so it both aims the pedal and opens the clip editor.
- Group columns and the master strip stay inert; a scene selection
  anchors to the lowest real track when the selected one cannot resolve
  to a slot.
- **Unverified against a live Live**: whether writing
  `highlighted_clip_slot` moves `selected_scene` (and so echoes back on
  the existing listener to repaint the highlight). If it does not, the
  highlight will need `selected_clip` to emit its own echo. Everything
  else here is exercised by tests.

## Related

- ADR-415 — the session view; this revises its tap semantics only
- ADR-416 — the section stack the rail's row arithmetic rides on
- ADR-384 — the strip gesture machine both zones instantiate
- ADR-009 / 010 — the original fire-button dual behaviour the pedal's
  branch descends from

## Tags
`session-view`, `foot-pedal`, `clip-grid`, `scene-rail`, `selection`,
`gestures`, `looper-cycle`
