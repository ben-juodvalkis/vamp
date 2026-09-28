# ADR-384: Strip-Wide Volume Fader

## Status
**Accepted**

## Context

The track strip (`TrackStrip.svelte`) was a flex column of **four** equal-height
sections, each owning its own pointer handler:

- **Name** (`TrackHeader`) — tap = select + show instrument
- **Clip** (`TrackClipView`) — tap = select + Clip view
- **Permute** (`MiniSequencer`) — tap = select + Permute view
- **Meter+Volume** (`TrackVolumeMeter`) — vertical drag = volume, tap = mute

Only the bottom quarter responded to a volume drag. On an iPad that is a small,
fiddly target, and volume is one of the most-used controls during a live set. We
wanted volume to be the dominant, full-height gesture without losing the existing
tap targets on the other three sections.

Each section also called `stopPropagation()` in its `pointerdown` (and
`TrackHeader` set its own pointer capture), so a single drag listener on the
parent could never see those events — the gesture architecture had to change, not
just the hit area.

## Decision

Make the **entire strip a vertical volume fader**, with all gesture handling
moved up to the parent `Card`. The three content children become presentational
(no own pointer handlers, no `stopPropagation`).

**Gesture model (on the Card):**

- **Drag anywhere = volume**, *relative*: `delta = (startY − clientY) / stripHeight
  × DRAG_GAIN`, clamped to 0..1. `DRAG_GAIN = 1.0`, so a full-strip-height drag
  covers ~the full range. Touch-down never jumps the value.
- A gesture commits to a drag only after **6 px** of vertical travel
  (`DRAG_THRESHOLD`); below that it's a tap. `preventDefault` is deferred until
  the drag commits, so horizontal scroll of the tracks panel passes through.
- **Tap** dispatches to the section under the finger via
  `document.elementFromPoint(x, y).closest('[data-section]')` and fires that
  section's action *immediately* (Name→select, Clip→Clip view, Permute→Permute
  view). No tap delay.
- **Double-tap anywhere = mute** (≤250 ms, `DOUBLE_TAP_MS`). Per decision, a
  single tap fires its section action now; a fast second tap *also* toggles mute
  (so a double-tap does the section action and then mutes). A committed drag
  resets the double-tap timer so a drag is never half of a double-tap.
- Optimistic local volume state drives the handle during a drag; store echoes
  sync back only when not dragging. Continuous updates are rate-limited with the
  existing `createSliderThrottle` (frame-synced, 60 Hz).

**Why `window` listeners instead of `setPointerCapture`:** the first
implementation captured the pointer on the `Card`. On **desktop Chrome with a
mouse** this produced two bugs — the value jumped and the drag never released —
because the Card's reactive subtree re-renders mid-drag (volume/meter updates),
and when the captured node's subtree churns Chrome drops the `pointerup`, leaving
`isDragging` stuck true. The same code worked under iPad touch emulation, which is
why it slipped past first testing. The fix: on `pointerdown`, attach
`pointermove`/`pointerup`/`pointercancel` to `window` for the press duration and
remove them on release (and in `onDestroy`). Window listeners always see the
release regardless of cursor position or DOM churn. (The reusable `dragAction`
still uses `setPointerCapture` on a *stable* leaf node and is unaffected.)

**Handle = edge ticks:** instead of one full-width bar, two short ticks pinned to
the left/right rails at the volume height (`bottom` interpolated over an inset
range so they stay visible at both ends), leaving the center clear for content.
They grey out when muted.

**Hit-test requires `pointer-events: auto` on the sections:**
`document.elementFromPoint` ignores elements with `pointer-events: none`, so the
`[data-section]` wrappers must keep pointer events enabled. They have no handlers,
so the `pointerdown` simply bubbles to the Card.

**Layout:** with volume now spanning the whole strip, the dedicated bottom meter
section was removed — the strip is now **three** equal-height sections (Name /
Clip / Permute). `MeterVisualizationV6` fills the **full** strip height behind the
sections. Clip/Permute get horizontal padding to clear the edge ticks, and
Permute gets a small bottom pad.

**Meter color-coded to track color:** `MeterVisualizationV6` gained an optional
`color` prop. When set, the fill is a track-color gradient (dark base → full color
at the level) instead of the fixed green→red ramp, tying the strip to its track
color. The prop is opt-in, so `browser/SelectedTrackMeter` (which doesn't pass it)
keeps the classic ramp.

**Out of scope — master:** the master strip is a separate component
(`MasterTrack.svelte`, mounted in `+page.svelte`), not `TrackStrip`, and keeps its
existing `dragAction`-based fader.

## Consequences

**Positive**
- Volume is a full-height, low-precision gesture — far easier to hit mid-set.
- One gesture state machine, one source of truth for tap-vs-drag-vs-double-tap;
  children are simple presentational components.
- Meters read per-track at a glance via color.

**Negative / trade-offs**
- A double-tap performs the first tap's section action *and* mutes (chosen over
  delaying every single tap by 250 ms). Acceptable: the section action is
  idempotent-ish (re-selecting / re-opening a view).
- `elementFromPoint` hit-testing couples tap routing to DOM/z-index/`pointer-events`
  layering; the sections must stay `pointer-events: auto` and the meter/ticks
  `pointer-events: none`.
- `TrackVolumeMeter.svelte` is now unused by the strip (still used by
  `SelectedTrackMeter`); left in place rather than deleted.

## Tags
`track-strip`, `volume`, `fader`, `pointer-events`, `gesture`, `ui`, `meter`,
`svelte5`, `ipad`
