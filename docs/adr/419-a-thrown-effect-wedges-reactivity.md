# ADR-419: A thrown effect wedges reactivity, so previews are contained

## Status
**Accepted** (2026-08-25)

## Context

The UI froze mid-session in Chrome: meters dead, playheads parked,
every panel stale — while moving a fader still moved Ableton. ADR-418
added the instrumentation that finally named it, and this is the first
real capture:

```
uncaught-error   Svelte error: each_key_duplicate
                 Keyed each block has duplicate key `36:0.000000:0.000000`
                 at indexes 0 and 1
                   in TrackClipMidiView.svelte
                   in ClipPreview.svelte / TrackClipView / TrackStrip / TracksPanelV6
reactivity-stall missedTicks 3, schedulerSeq 315 vs reactiveSeq 312
```

Three seconds separate the throw from the stall. That gap is the whole
bug.

### Why one bad key kills the entire app

`TrackClipMidiView` keyed its note loop on
`pitch:xStart.toFixed(6):xEnd.toFixed(6)`. Two things combine:

1. The visibility guard is `noteEnd <= windowStart`, so a note ending a
   *hair* past the window start survives it.
2. It then clips to a width around 1e-10, and `.toFixed(6)` **quantizes
   that to `"0.000000"`** — indistinguishable from a note that starts
   exactly at the window edge.

Two such notes on one pitch (36 — a kick) produced identical keys.
Svelte 5 **throws** on a duplicate key rather than warning.

The throw lands inside `_Batch.process` → `flush_effects`. That path
restores `is_flushing` but *not* `queued_root_effects`, `current_batch`,
or the root effect's `CLEAN` bit. Every subsequent `schedule_effect()`
then sees an already-scheduled root and bails — against a queue nothing
will ever drain. Reactivity is dead app-wide from that moment, while
DOM event handlers keep firing normally.

Hence the signature that made this so hard to place: **the display is
frozen but the faders still work.** Outbound writes are plain event
handlers and need no effect flush; everything you *look at* needs one.
It is the same observable failure as ADR-418's lost handshake, reached
by a completely different route — which is precisely why that ADR's
triage table exists.

The blast radius is the real finding. The defect was one arithmetic
edge in one clip preview, and the cost was the entire instrument.

## Decision

**1. The note loop is unkeyed.** `visibleNotes` is rebuilt wholesale on
every fetch and the note elements are stateless divs with no
transition or animation, so a key preserved no identity worth having —
it only supplied a way to crash. Removing it is not a workaround for
the rounding; it removes the requirement that a render-derived string
be unique, which is not a property this data can promise. A comment at
the site says so, because re-keying it would look like an improvement.

Deliberately *not* done: widening the guard to drop degenerate notes,
or lengthening `toFixed`. Both narrow the window without closing it —
a duplicate note is legal MIDI and Live will happily record two, so
any key built from note geometry can collide.

**2. Clip previews render inside a `<svelte:boundary>`.** A throw
anywhere in a preview now degrades that one strip to a blank graphic
instead of stopping the application. This is the structural half, and
it matters more than the specific fix: any future error in preview
rendering — a bad peak blob, an unexpected clip shape — would otherwise
carry the same total cost.

The boundary sits at `ClipPreview`, not at the app root. A root
boundary would blank the whole instrument on any error, which for a
live-performance tool trades one catastrophe for another. Per-preview
containment means a failure costs a picture, never the transport.

**3. Contained errors still report.** A boundary-caught error never
reaches `window.onerror`, so it would vanish from `bridge.log` exactly
when the app keeps running and nobody files a bug.
`reportBoundaryError()` sends `boundary-error` with the boundary's
name, message and stack.

## Consequences

**Positive.**
- The freeze is fixed at its cause, and its *class* is contained.
- A failing preview is now visible in the log as `boundary-error`
  rather than being inferred from a frozen screen.
- ADR-418's instrumentation is validated end to end: it turned an
  unreproducible "it froze again" into a component name and a stack on
  the first capture.

**Negative / accepted.**
- Unkeyed means Svelte reconciles notes positionally. For stateless
  divs whose every attribute is derived, the rendered output is
  identical; there is no transition or animation to disturb.
- `<svelte:boundary>` catches render and effect errors only — not
  errors thrown in event handlers or async callbacks. Those still reach
  `window.onerror` and the ADR-418 watchdog, and an async throw cannot
  wedge the scheduler the way a render throw does.
- One boundary per visible clip preview. The cost is a wrapper effect
  per strip, not per note.

**Follow-on worth considering.** `ClipPreview` is the only boundary in
the tree. Other subtrees that render surface-driven data on every
update — the device panel and the session grid — carry the same
structural risk and no containment. Adding boundaries there is cheap;
it was left out here to keep this change to the failure actually
observed.

## Tags
`svelte-reactivity`, `svelte-boundary`, `each-key`, `freeze`,
`error-containment`, `midi`, `clip-preview`, `watchdog`
