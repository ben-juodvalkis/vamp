# ADR-381: Editable Clip-View Mirror — M1 (read-only canvas) + M2 (braces + audio params)

## Status
**Accepted** (M1 + M2 shipped). M3–M5 still pending — this ADR is the
on-ramp for them. Supersedes nothing; extends the clip-mirror read path
from ADR-360.

## Context

ADR-360 delivered the **read** path for clip content in the small track
strip (`TrackClipView` / `TrackClipMidiView`, cheap `clip/notes/get`
blob, 30 Hz playhead, loop bounds via `clip/property`). The
clip-view-mirror effort grows that into a full, editable Detail/Clip
view in `CentralDisplay`. Plan + decision table:
`documentation/clip-view-mirror.plan.md`.

Five milestones, ascending risk. M1 (read-only central canvas) and M2
(draggable braces + audio pitch/gain) are done; this ADR records what
was built and the non-obvious facts the next dev needs for M3 (rich
note channel) and M4 (note editing).

## Decision

### M1 — central read-only canvas

- **New view** `interface/src/lib/components/v6/central/views/ClipEditorView.svelte`:
  piano-roll grid + axes, DOM-per-note rendering (cheap blob via
  `clipNotesService`), audio waveform (`clipWaveformService`, 1024 bins),
  30 Hz playhead, read-only loop/marker overlays, pinch + drag + wheel
  zoom on both axes.
- **Activation = manual toggle only** (plan decision 8). A new
  `clipEditorStore.svelte.ts` holds one boolean; `ClipCentralView`
  renders *either* the editor canvas *or* the existing button rail (a
  pencil/sliders chip flips it). Focusing a clip never auto-switches —
  rejected the auto-default-on-focus heuristic as a mid-performance
  surprise. Keeping it inside the existing `'clip'` central view type
  meant zero changes to `clipDisplayCoordinator` (which keys on
  `view.type === 'clip'`).
- **Coordinate math** is a pure, unit-tested module
  `lib/utils/clip/clipEditorGeometry.ts` (beats↔px, pitch↔px, zoom/pan/
  clamp, default windows). No Svelte/DOM, so the zoom/scroll arithmetic
  is testable in isolation.

### M2 — editable braces + audio params

- **`clip/set/pitch_fine` + `clip/set/gain`** added to the
  focus-scoped `ClipPropertiesComponent` (Python). The component is
  attribute-table driven (`_ATTRS`), so adding a row wires listener +
  property echo + `_encode_wire` automatically. `pitch_fine` is int
  cents `[-50, 49]`, reject-not-clamp like `pitch_coarse`. `gain` is
  normalized `[0, 1]`, **clamped** (continuous fader → pin to the rail,
  not reject) and only valid on warped audio clips (LOM raises on
  MIDI/unwarped; the write guard swallows it). Mirrored on the TS side:
  addresses in `v3Clip.ts`, `pitchFine`/`gain` fields +
  `handlePitchFine`/`handleGain` in `clipPropertiesStore`, routing in the
  `clip/property` switch. Documented in wire-protocol §2.7 (where
  `pitch_coarse` was previously undocumented).
- **Draggable loop braces** in `ClipEditorView`: dedicated handle
  elements (start / end / move-region) positioned at the brace pixel
  coords, each with its own `onpointerdown` → document-level
  `pointermove`/`pointerup` listeners. This mirrors
  `ClipLoopControlV6`'s proven pattern and is deliberately **off** the
  canvas pan/zoom pointer surface (see Consequences — the first attempt
  shared it and broke). Pixels→beats maps through the zoomable
  `beatWindow` (not `0..endMarker`), so handles track zoom/scroll. Drags
  snap to bars, clamp via `clipGesture.applyLoopDrag`, stream
  `loop_start`/`loop_end` during the gesture (de-duped against last-sent),
  and optimistic-apply + reconcile on the `clip/property` echo (ADR-358).
- **Audio pitch/gain controls**: continuous `DeviceSlider`s (PITCH
  coarse, GAIN) shown only for audio clips, optimistic-apply via
  `clipPropertiesStore` then send the matching `clip/set/*`.
- **Shared gesture util** `lib/utils/clip/clipGesture.ts` (pure,
  unit-tested): `hitTestRange`, `snapToGrid`, `clamp`, `applyLoopDrag`,
  `pxDeltaToBeats`. **This is the muscle M4 reuses for note drag/resize**
  — extend it there rather than re-implementing.

## Consequences

### Non-obvious facts the next dev MUST know (M3/M4)

1. **Clip type ≠ `clipPropertiesStore.clipType`.** That getter is
   driven by `is_audio_clip`, which is *not emitted on the v3 focus
   channel* — it reads `null` for the focused clip. `ClipEditorView`
   derives type from `selectedTrackStore.trackType` (then the playing
   entry's `isAudioClip`, then the store). This bit M1 hard (grid +
   playhead rendered, but no notes/waveform) and was only caught with
   live Playwright. Any M3/M4 code that branches MIDI-vs-audio must use
   the same source.

2. **Brace dragging must stay off the canvas pointer surface.** The
   first M2 attempt hit-tested braces inside the canvas's shared
   `activePointers` map; it tangled with pan/zoom and the gutter-offset
   coordinate space. The fix was dedicated handle elements with their
   own listeners. M4 note drag will face the same choice — prefer
   per-note pointer handling (or a dedicated capture layer) over
   threading note hits through the pan/zoom handler.

3. **The cheap blob is still the editor's note source until M3.**
   `ClipEditorView` reads `clipNotesService.requestNotes` (the
   identity-blind `[pitch,start,dur,vel]` blob, 512-cap). M3 swaps the
   editor (only) to the rich, ID-carrying `focusedNotesStore`. The strip
   thumbnails keep the cheap blob untouched (plan decision 1).

4. **Live LOM write contract for M4 is verified** (probe `ok=1`, Live
   12.4) — see the "Verified LOM contract" block in the plan. Modify is
   read-mutate-writeback over `MidiNoteVector` (not `MidiNoteSpecification`);
   add uses id-less `MidiNoteSpecification` and `add_new_notes` returns
   the new ids; remove is `remove_notes_by_id`. `apply_note_modifications`
   *can* change pitch by id (the `ClipNotesComponent.handle_transpose`
   docstring claiming otherwise is wrong — migrate it in M4).

5. **Own-write echo loop (M4).** Extending `notes/changed` to the
   focused clip (M3 decision 5) means our own note writes will poke us
   back. The initiating client must origin-tag/suppress its own re-pull
   (plan decision 4). Permute avoids this by not observing `clip.notes`
   at all — we can't, because cross-client sync needs the poke.

### Testing
- `clipEditorGeometry.test.ts` (24) + `clipGesture.test.ts` (20) — pure
  math. `test_clip_properties_component.py` +7 for pitch_fine/gain.
- M1/M2 verified live via Playwright against a running surface: MIDI
  notes + audio waveform render, wheel-zoom narrows the window, end-brace
  drag emits `clip/set/loop_end` snapped to a bar and the strip mirror
  follows.

### Open / deferred
- Hard note ceiling for the rich channel (keep 512 vs. raise) — decide
  with a `dense-clip-load` perf run at M3 (plan "Open questions").
- Pinch-zoom touch feel + pitch/gain audibility were not machine-
  verifiable (synthetic events on desktop); flagged for on-device
  validation.

## Tags
`clip-view-mirror`, `clip-editor`, `central-display`, `loop-braces`,
`pitch-fine`, `gain`, `gesture`, `adr-360-followup`, `m3-prerequisite`
