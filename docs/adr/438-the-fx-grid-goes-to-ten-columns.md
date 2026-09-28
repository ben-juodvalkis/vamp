# ADR-438: The FX Grid Goes to Ten Columns

## Status
**Accepted** — 2026-09-15. Supersedes [ADR-383](383-instrument-slider-fx-grid.md).

## Context

The FX grid had been eleven columns × two rows since ADR-431. Two of those
columns row-spanned and were split in half by `FXGrid.svelte` rather than in
the layout table:

| column | top half | bottom half |
|---|---|---|
| `fx1` | instrument slider — clip pitch on audio, OTT full-height on master | Rand Oct — Bass on audio |
| `fx7` | Squash | Gain |

The instrument slider (ADR-383) did two jobs: drive one expressive parameter
of the selected track's instrument, and **open that instrument's central
view on tap**. PR #496 gave the track strip a **device band** — one wordless
picture of what makes each track's sound, whose tap selects the track and
opens the same view. That made the slider's second job redundant on every
track at once, and the user asked what removing it would buy.

On its own: almost nothing. The slider is one half-column — measured at
iPad Pro landscape (1366×1024), 89 × 246 CSS px against a 1060 × 500 grid,
or **4.1%**. Deleting it just makes Rand Oct twice as tall, which Rand Oct
does not need.

The interesting move was the column, and the arithmetic says exactly what
that costs. With Gain's cell spanning both rows, each row has nine columns
left and the four XY pairs (EQ, Filter, Pedal, Drum / Chorus, Tremolo, Echo,
Reverb) take eight of them. **A ten-column grid therefore has exactly one
single-column slot per row, and no more.** Eleven columns had three, which
is why `fx1` had to be split to hold a fourth thing.

## Decision

**1. Ten columns. `fx1` stops row-spanning; only the Gain column does.**

`grid-cols-11` → `grid-cols-10`, and `fx1` loses `rowSpan: 2`. The row-1
single slot is `fx1` and the row-2 single slot is Variation.

**2. `fx1` is the one tile that varies by track type, and it is one control deep.**

| track type | `fx1` | why |
|---|---|---|
| MIDI | Rand Oct | a MIDI effect; the layout entry's own component |
| audio | Bass | the one grid device that is *only* useful on audio |
| master | OTT | no MIDI for Rand Oct, no clip of its own |

`BassControl` and `OttControl` have no layout entry — they resolve their own
slot through `BaseDeviceControl`'s `slotKey` path, as `SquashControl` does.
The branch in `FXGrid.svelte` collapses from three split-column cases to
three single mounts.

**3. Three tiles leave the grid.**

- **The instrument slider** (`InstrumentControl.svelte`,
  `instrumentSliderMap.ts`) — deleted. Its navigation job is the strip's
  device band; its parameter is in the instrument's own view.
- **Clip pitch** (`ClipPitchControl.svelte`) — deleted. Its own docstring
  said it shared "the same source of truth and the same setter as the PITCH
  column in ClipCentralView"; that column is still there, and the strip's
  Clip band opens it in one tap. It was the only audio candidate with a
  *literal* duplicate, which is why it was the one to cut rather than the
  Bass or Variation (see Alternatives).
- **The Guitar tile** (`fx2`) — **moved**, not deleted, see below.

**4. The Guitar tile becomes the Pedal view's last column.**

`GuitarControl` is mounted standalone inside `PedalCentralView`, the way the
Saturator's XY has been since ADR-431. Same family (distortion), and the
Pedal view is where a hand already goes for drive. It keeps `slotKey:
'guitar'` and therefore keeps its ghost state and its drag-to-load — which
is why it is the tile and not a bare fader.

Its tap is **not** disabled, and that is the load-bearing difference from
the Saturator beside it: the Saturator is home in the Pedal view, the Guitar
is not. After `fx2` left the grid this mount is the **only** door to
`GuitarCentralView` on a MIDI track — the audio track's device band opens
its chain *head's* view (an Auto Filter on the guitar track), and the Bass
tile answers only on audio.

**5. `GuitarCentralView` draws Macro 1.**

It had skipped it since ADR-383 with the comment "Macro 1 is reserved for
the FX Grid slider". With that slider gone, the rack's own view would
otherwise have been the one surface that could not move the rack's first
macro. It is rendered by a dedicated `drivePanel` snippet ahead of the
dynamic layout, and deliberately kept **out** of `buildMacroLayout`: macro 1
sharing a first word with macro 2 would silently fold the two into an XY pad
and reshuffle a layout that works.

**6. The TotalMix status strip follows, and loses its regularity.**

`+page.svelte`'s ruler is hard-coupled to the grid's column count (no shared
constant, deliberately — its own comment says a token would hide the
coupling rather than document it). `repeat(11, …)` → `repeat(10, …)`, and
the five monitor bars re-point:

```
room     → fx1        (1)      ← one column now, not two
playback → EQ         (2–3)
click    → Filter     (4–5)
phones   → Pedal      (6–7)
main     → Drum       (8–9)
                      (10)  Squash / Gain, left clear as ever
```

Room is half the width of the other four. That is the "runt bar at the left
end" the old mapping explicitly avoided, and it is a real cost of this
change: room covered *both* single-column slider tiles when there were two
of them (Rand Oct + Guitar, together one XY wide). Tile alignment had to
win — a two-column room bar would now straddle the seam between `fx1` and
the EQ, which is the one thing that ruler exists to prevent.

## Consequences

**Positive**

- Every remaining tile is wider. Columns 89 → **99 px**; the eight XY tiles
  186 × 246 → **206 × 246** (+10.8% area each). Nothing shrank, and the grid
  keeps its 1060 × 500 footprint.
- One fewer thing on the busiest surface in the app, and the two layouts
  (MIDI / audio) now differ in exactly **one tile** instead of a whole split
  column.
- The split-column special case is down from two columns to one.
- Three components and a config module deleted, not relocated:
  `InstrumentControl.svelte`, `ClipPitchControl.svelte`,
  `instrumentSliderMap.ts` (and its test).

**Negative / to verify on the rig**

- **The expressive instrument parameter is off the FX page.** Drift's OSC,
  Wavetable's Osc 1 Position, Simpler's Sample Start, Operator's A/R pair,
  Omnisphere's Orb Radius and the Komplete mod wheel are now only reachable
  inside each instrument's view. The strip's device band shows those
  controls but is explicitly a *reading*, not a control.
- **Drum Rack pitch is the sharpest case.** The slider was the kit's
  `vm.pitch` and obeyed the pad hold, so it was per-pad pitch under a
  finger, from the FX page. Trnsp in the Drum Rack view covers the kit (it
  has been drawn unconditionally since 2026-09-12) and
  `DrumCellControlsRow` covers the pad — but neither is on the FX page.
  **This is the one to try in a real set before calling the change good.**
- The runt room bar, above.
- Someone adding a tile back has no column for it. Pinned by tests in
  `FXGrid.scope.test.ts` so it fails loudly instead of drifting against the
  status strip.

## Alternatives considered

**Which tile audio loses.** Ten columns leaves two single slots and audio
had three candidates:

| candidate | verdict |
|---|---|
| **Clip pitch** | **cut.** A literal second copy of ClipCentralView's PITCH column — same store, same setter — one tap away via the strip's Clip band. |
| Bass | kept. Also duplicated (the Bass panel in `GuitarCentralView`), but cutting it costs the *door*: with `fx2` gone it is the only remaining way into that view from an audio track. |
| Variation | kept. Beat Repeat is an audio effect; present on MIDI and missing on audio would be backwards. |

**Per-track-type column counts** (MIDI at ten, audio at eleven). Rejected:
the status strip's ruler would have to reflow every time the selected track
changed kind, which is motion in the safe-area band for no gain.

**Delete the slider and stop there**, letting Rand Oct take the whole
column. Mocked up and rejected by inspection — it buys nothing, and leaves a
tall thin tile with a two-word label in it.

## Addendum (2026-09-15, later): twelve columns, full-height singles

Tried the same day at the user's request. The single-column tiles become
full-height columns instead of sharing one:

| column | MIDI / master | audio |
|---|---|---|
| 1 | Rand Oct (OTT on master), full height | **Guitar**, full height |
| 2 | Variation, full height | Bass over Variation |
| 3–10 | the four XY pairs over the other four | same |
| 11 | Squash, full height | same |
| 12 | Gain, full height | same |

- Every cell is placed explicitly: `col` / `row` / `span` / `rowSpan` in
  `fxGridLayout.ts`, `cellFor(slot, kind)` for the two audio moves, and
  `SQUASH_CELL` / `AUDIO_GUITAR_CELL` for the tiles with no entry.
  Auto-placement cannot put Variation in column 2 on both kinds from one DOM
  order.
- Both kinds are twelve columns, so the objection to per-kind column counts
  above is still met: the XY tiles and the status strip never move when the
  selected track changes kind.
- The status strip goes to `repeat(12, …)` and every bar is two columns
  again: room covers columns 1–2, so the runt bar is gone.
- The Guitar is back on the grid on **audio only**. It stays the Pedal
  view's last column, still the only door to `GuitarCentralView` on MIDI.
- Cost: every column narrows (measured in the commit that landed this).

## Tags
`ui`, `fx-grid`, `layout`, `central-view`, `guitar`, `totalmix`, `instrument`
