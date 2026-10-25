# ADR-477: Value Boxes — Sliders That Sweep a Fixed Distance

## Status
**Proposed** (2026-10-25), a prototype on the Analog view, on the
`smaller-ipads` branch, for the user to try on the iPad. No Live restart
(interface only).

## Context
A `DeviceSlider` sweeps its whole range over its own length, so its
precision is its size: a tall central fader is fine, a short one coarse.
Central views have spent their height on tall, skinny faders for that
reason, and a smaller iPad (ADR-476) shrinks them and coarsens them with
the screen.

The Permute view's Length and Rate boxes do it the other way (user,
2026-10-25): a step every 20–25px of finger travel whatever the box's
size, so a short box is still fine. The user asked whether central views
should move from skinny, tall faders to boxes like those.

## Decision
**A value box is a slider that sweeps its range over a fixed finger
travel**: `DeviceSlider`'s `travel` prop, set to
`constants.ui.gestures.valueBoxTravelPx` (240px). That is about a full
central fader on the 12.9-inch (Analog's envelope faders were 213px,
its Glide 295px), so a box feels like the faders it replaces at any size.
Its label stands upright, and while it is dragged its `readout` (Live's
own value, `param/display`, sent only while the UI writes) replaces its
name. Unset, `travel` leaves every other slider as it was.

**Boxes for what is set, faders and pads for what is ridden.** Envelope
times, levels and glide become boxes; the filter's XY pad and the
pitch/mod wheels keep their size.

**The Analog view is the prototype:**
- Both envelopes are in view, Amp over Filter, five boxes each, 44×109px on
  the 12.9-inch (each fader was 44×213). The Amp/Filter switch is gone.
- Glide is a box under Noise; its full-height column went to the filter.
- Every slider in the view sweeps over 240px, the voice card's Sub/Sync,
  PW and Level included.
- The Filter pad is 249px wide on the 12.9-inch (it was 160). On a smaller
  iPad the voice card and the filter share the squeeze from 196 and 249px
  (ADR-476): the 11-inch draws ~193 / 246, the mini 171 / 217, the
  10.2-inch 152 / 193.

## Consequences
- Precision no longer follows size: the envelope stages are a little finer
  than before (240 against 213px), Glide a little coarser (240 against
  295), the voice card's Sub much finer (240 against 92px sideways).
- A full sweep takes 240px of travel even from a small box; near a screen
  edge, lift and drag again (a touch never jumps the value).
- At rest a box shows its name and its fill, not a number: Live sends the
  value only while the UI is writing it.
- Tried and not taken: 60px boxes, more box-like, but they gave the filter
  back (152px) and cramped its type strip.
- Every other view is unchanged. If the user keeps this, the same `travel`
  goes on other views' set-and-forget sliders, view by view.
- The central tour's `inst-analog-voice2` no longer clicks the envelope
  switch: both envelopes are always drawn.

## Tags
`ui`, `central-views`, `sliders`, `value-box`, `analog`, `gestures`
