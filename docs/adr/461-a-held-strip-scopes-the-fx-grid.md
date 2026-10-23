# ADR-461: A Strip Held Past 500 ms Scopes the FX Grid to Its Track

## Status
**Accepted** (2026-10-13, revised 2026-10-19; recorded 2026-10-23).
Commits `389fc6e` and `e6d4d7d`. Interface only: no wire change, no
protocol bump. Borrows the pin rule from the pad hold (ADR-432, ADR-436).

## Context
The FX grid only showed the selected track. To edit another track's
effects you had to select it, which also moves Live's selection, the
clip view and the device band. Changing a guitar's reverb while the
synth stayed in focus took two selects, one to get there and one to get
back.

A drum pad already worked this way. A finger held on a pad scopes the
grid to that pad, and lifting it returns the grid to the kit (ADR-432).
A strip had no hold: a press was either a tap that selects or the
volume fader.

## Decision
**A press still down at the long-press threshold (500 ms) holds its
track.** While the hold lasts, the FX grid shows that track's devices
and Live's selection does not change. Tiles read the held track's
devices, a drag moves them, and a ghost tile loads onto that track. The
strip wears a ring in its ink. The grid gets a frame and a chip that
names the track.

**The hold is a matter of time alone.** The first version (`389fc6e`)
held only a resting finger and parked it, so a held finger moved
nothing. `e6d4d7d` changed that the same week. A press holds at 500 ms
whether it rested or is already riding the fader, and a held finger
keeps moving the volume. `dragMachine` gained `holdWhileDragging` so the
hold survives a drag-axis commit. A tap (release before 500 ms) still
selects. A release after the hold taps nothing. A row scroll never
holds.

**Lift and the grid is the selected track's again**, unless another
finger is mid-edit on the grid. That edit pins the scope until it lifts,
the same rule `drumPadScope` follows.

**Several strips held at once edit together.** The first strip pressed
is primary. A control writes the primary absolutely and moves every
other held track's copy of the same device by the same fraction of its
range, starting from that copy's own value, clamped. A held track
without the device is skipped. A ghost tile loads onto every held track
that lacks the effect.

**Under a hold, a tile tap doesn't select its device**, because
selecting a device in Live selects its track. The move-to-top and
move-to-end buttons hide.

The state lives in `stores/v6/trackHoldScope.svelte.ts`. The gesture
lives in `useStripGestures`.

## Consequences
- Any track's effects are one hold away, and a fader ride and an effect
  change can happen in one press.
- Holding several strips gives a relative group edit across tracks with
  no group set up first.
- It needed no surface change: the surface already keeps every track's
  parameters live, and `device/load` is track-addressed.
- The hold is invisible until it fires. A slow fader press that was
  meant only to change the volume also scopes the grid until the finger
  lifts. That is harmless, because nothing selects, but it is visible.
- Two fingers on a strip still solo it (ADR-455). That chord is claimed
  while the first finger is still a candidate tap, so it is decided
  before the hold's 500 ms.
- Tests: `trackHoldScope.test.ts` and `dragMachine.test.ts`'s
  hold-while-dragging cases.

## Tags
`tracks`, `track-strip`, `gestures`, `fx-grid`, `scope`, `multitouch`
