# V6 Track Components

> Authoritative layout/interaction notes live in
> `interface/src/lib/components/v6/CLAUDE.md` (the `tracks/` row) and
> ADR-384 (strip-wide volume fader). This file is a quick file map.

## Structure

```
tracks/
├── TrackStrip.svelte              # The strip. Owns ALL pointer gestures
│                                  # (strip-wide volume drag, tap dispatch)
│                                  # on the parent Card.
├── TrackStrip/
│   └── components/                # Presentational section children — no own
│       │                         # pointer handlers; the Card hit-tests them
│       │                         # via data-section.
│       ├── TrackHeader.svelte     # Name / mute display (top third)
│       ├── TrackClipView.svelte   # Playing-clip waveform / MIDI (middle)
│       ├── TrackClipMidiView.svelte
│       └── MiniSequencer.svelte   # Permute thumbnail (bottom third)
├── composables/
│   ├── useTrackData.svelte.ts     # name/color/mute/solo/volume/meterLevel +
│   │                              # select / mute-toggle / solo-toggle
│   └── useTinySequencer.svelte.ts # Permute thumbnail state
└── MasterTrack.svelte             # Master strip (separate component;
                                   # uses the reusable drag action).
                                   # Same 2/3 + 1/3 column a strip has:
                                   # the Card IS the fader, the key band
                                   # is its name band, and TotalMix takes
                                   # the rest of the third when the
                                   # transport header isn't carrying it
```

## The strip reports preset loads

The browser closes the instant a pick commits and does **not** wait for Live
(see `browser/CLAUDE.md`, *Optimistic close*). The strip is therefore where a
load's whole story is told, driven by `presetLandingStore`:

| Phase | Trigger | What the strip does |
|---|---|---|
| pending | `markPending` at commit | Card breathes in the track colour; a scrim sets the content back; a tapered ring spins; the header shows the **incoming preset name**, lifted above the scrim (`.above-veil`) because it is the payload |
| landed | `markLanded` on the prepare ack | One outline flare that decays over `LANDING_PULSE_MS` as Live's real name arrives |

Both states live at **strip** level, not on the name cell: the strip is the unit
the eye tracks across a row of eight on the iPad, and a mark small enough to fit
inside the name is small enough to miss. An earlier pass put a 2px sweep on the
header and it was measurably too quiet — that is why this is a card-wide glow.

Pending only appears when the target track already exists (replace mode's pin,
or the pre-prepped landing pad). A load that creates its own track goes straight
to landed; there is genuinely no strip to mark before the ack.

## The strip is a fader (ADR-384)

The entire `TrackStrip` is a vertical volume fader:

- **Drag anywhere = volume** (relative; `DRAG_GAIN = 1 / VOL_TRAVEL` = **1.5**, so a full-height drag
  covers ~the full 0..1 range; touch-down never jumps).
- **Handle = edge ticks** on the left/right rails at the volume height; the
  center stays clear for the Name / Clip / Permute content.
- **"Anywhere" includes the space beside the Card** (2026-09-25). The gesture
  is bound to `.fader`, a box around the Card whose `::before` takes half of
  each 16px column gutter and the 4px seam above the name. Before it, the
  gutter reached no strip, and the ticks sit flush against it — a finger aimed
  at a tick often did nothing. `TracksPanelV6` sets the widths and zeroes them
  at the row's outer ends, so the slop adds no scrollable overflow.
- **A sideways start only belongs to the row when the row can scroll.** With
  the strips fitting the panel (`rowScrolls` false, ≤13 tracks on the iPad)
  the fader is `touch-action: none` and its horizontal axis is inert
  (`crossAxisLive`): sideways travel rules out a tap, but a drag that set off
  sideways — a thumb's arc — still becomes the fader. It used to be a "row
  scroll" of nothing for its whole life. At 14+ tracks it is `pan-x` and a
  horizontal-dominant start is the row's, as before.
- **Tap the Name = mute** (latching only, does NOT select the track). Tapping
  Clip or Permute selects the track and shows that central view (Clip→Clip
  view, Permute→Permute view).
- **Two fingers on the fader = solo** (2026-10-01; the standalone Solo
  button, ADR-414, is gone). Solo toggles when the second finger lands
  while the first is still a candidate tap, no select; release <300ms
  latches, release ≥300ms restores the pre-press state (momentary). A
  soloed strip wears a blue wash. With the Group button held, two fingers
  add the track to the group instead.
- Gestures use `window` `pointermove`/`pointerup` listeners for the press
  duration — not `setPointerCapture`, which drops `pointerup` on desktop
  Chrome when the reactive subtree re-renders mid-drag.
- The meter (`MeterVisualizationV6`) fills the full strip height behind the
  sections, tinted to the track color via its `color` prop.
