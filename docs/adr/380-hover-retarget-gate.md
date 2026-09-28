# ADR-380: Hover Re-targeting Gate for Multi-Column Gesture Browsing

## Status
**Accepted**

## Context

ADR-377 introduced a **pass-through gap** during hold-to-drag browsing: a ghost
row, one button tall, that opens to give the finger a clear lane toward the
preset grid. Its Case B opens that gap *inside the column the finger is on* when
that folder level renders as 2–3 CSS sub-columns, so the finger can slide
rightward through the sibling sub-columns.

ADR-377 assumed the gap had "no navigation side-effects… the gap is purely
visual." That held for single-column levels but broke for **multi-sub-column**
levels, producing a high-frequency UI meltdown — the column flashing back and
forth between two folders, re-rendering and re-fetching every frame.

### Failure mode

All sub-columns of one folder level share a single CSS grid with
`grid-auto-rows: 1fr`. The Case-B gap is an explicitly-placed grid item; it
collides with the auto-placed folder buttons and forces an **extra grid row**.
With `1fr` rows, adding a row resizes and shifts *every* row vertically. The
result is a positive feedback loop:

1. Finger holds folder A → gap opens in A's column.
2. The grid grows a row; all rows shrink and shift, sliding sibling folder B
   under the (near-stationary) finger.
3. Natural finger jitter fires a `touchmove`; `document.elementFromPoint`
   now returns B.
4. Hover flips to B → `handleGestureMove` calls `loadNextColumn` (an async
   folder fetch + column rebuild) and the gap recomputes.
5. The grid reflows back, sliding A under the finger again → goto 3.

The key insight: the gap moves *content*, not the finger. The finger's screen
coordinates barely change; only the layout underneath does. So the "hover
change" at each step is layout noise, not user intent — yet the code acted on
it, and each flip kicked off an async load.

### Options considered

- **A — Remove Case B.** Never open the gap in the finger's own column. Directly
  removes the reflow-under-finger, but deletes the slide-through-sub-columns
  affordance ADR-377 added.
- **B — Movement-gated hover (chosen).** Keep the gap; only let the hovered
  folder change when the finger has physically travelled past a threshold.
  Layout-induced flips (≈0 finger travel) are rejected; deliberate slides pass.
- **C — Independent sub-column layout.** Re-lay-out so a gap in the right
  sub-column doesn't resize the finger's sub-column. Preserves everything
  including the visual, but a larger, riskier change to the ADR-377 grid.
- **D — Debounce navigation.** Rate-limit `loadNextColumn`. Treats the cost
  symptom, not the visual oscillation; adds latency to real navigation.

## Decision

Adopt **Option B**: gate folder re-targeting on real finger displacement.

`UnifiedGestureBrowser.handleGestureMove` only switches the hovered folder
(`col >= 1`) once the finger has moved at least
`ui.browser.hoverRetargetThresholdPx` (16px) from `hoverAnchor` — the finger
position recorded when the hover last changed. The anchor is seeded from
`pressOrigin` for the first move after the hold timer, updated on every accepted
re-target, and cleared by a `$effect` whenever `interactionState !== 'dragging'`
so it can't leak across gestures.

Distance is compared via a pure helper, `movedBeyond(anchor, point, threshold)`
in `utils/touchHandlers.ts` (squared distance, inclusive boundary, `null` anchor
passes), kept side-effect-free for unit testing.

Because reflow doesn't move the finger, reflow-induced flips fall under the
threshold and are rejected; a deliberate slide moves well past 16px (one button
step is ~40px+) and is accepted, re-anchoring as it goes. Updating the anchor
*before* `setFolderHover` is deliberate: if accepting the change triggers a
reflow, the next hit-test already measures against the advanced anchor, so the
immediate reflow flip is rejected.

The threshold lives in `config/constants.json` (`ui.browser`); 16px is sized to
comfortably exceed a typical reflow shift while staying under one button step —
its equality with `threeColumnThreshold` is coincidental.

## Consequences

**Positive**
- The oscillation is gone: a still finger can't be flipped by content moving
  under it, so no per-frame re-render or `loadNextColumn` storm.
- The pass-through gap and slide-through affordance from ADR-377 are unchanged —
  this gates the *hit-test the gap drives*, not the gap itself.
- Tunable via `constants.json`; pure helper is unit-tested.

**Negative / watch-outs**
- Re-targeting is now stepwise (~16px granularity), so a very slow deliberate
  drag registers a new folder only after clearing the threshold. Imperceptible
  in practice given button size, but the value is the knob if it ever feels
  sticky (lower it) or if any flicker survives (raise it).
- The gate requires both `x` and `y`. The only `col >= 1` mover without them is
  the hold-timer seed move, which bypasses the gate intentionally so the initial
  hover is always set. A future caller emitting a folder move without coords
  would silently skip the gate — flagged in an inline comment.
- This addresses the oscillation, not the one-time visual "jump" when the gap
  first grows the grid. Removing that jump is the Option C polish pass, left for
  later.

## Tags
`browser`, `gesture`, `ui`, `touch`, `folder-navigation`, `performance`
