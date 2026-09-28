# ADR-360 — All-tracks clip observability and TrackClipView

**Status:** Accepted (2026-04-29)
**Supersedes:** the per-track `MiniSequencer` thumbnail (Phase 10 PR-10c)
**Related:** ADR-350 (LOM identity is `_live_ptr`-based), ADR-357
(track-listener detach-all rebind), ADR-358 (optimistic store apply)

## Context

The Python surface previously pushed clip lifecycle (add/remove via
`has_clip`) but not playing-clip *content*. Per-clip content (notes,
playing position, waveform peaks) was touched only on the focused clip
and only for transposition / Simpler. The track strip's `MiniSequencer`
showed Permute step state — meaningless on tracks without a Permute
device, where it ghosted out.

We needed every track strip to render its currently-playing clip with a
live playhead, sliced to the active loop window. Audio clips show their
waveform; MIDI clips show their note pattern. Both share a single rAF-
driven playhead.

## Decision

Three coordinated additions:

1. **`PlayheadComponent` (Python).** One `playing_slot_index` listener
   per regular track; on slot change, attach a `playing_position`
   listener (and, for MIDI, a `notes` listener) to the playing clip.
   Emits `/looping/v3/track/playing_slot` on slot change (full render
   payload, no throttle) and `/looping/v3/track/playhead` at 30 Hz
   per playing track (drift correction). Loop bounds flow through the
   existing `/looping/v3/clip/property` channel; no new `clip/loop`
   address. Modeled directly on `MetersComponent`'s
   per-track-throttle / structural-rebind / init-emit pattern.

2. **`/looping/v3/clip/notes/get` request/reply (Python +
   `ClipNotesComponent`).** Pull endpoint for MIDI clip notes,
   replying with a packed float32 blob
   `[pitch, startBeats, durationBeats, velocity] × n`. Bounded
   request-LRU (32 entries / 30 s) makes retransmits idempotent.
   Companion `notes/changed` poke fires from the per-track notes
   listener so the UI can re-pull when notes change live.

3. **`TrackClipView` + `TrackClipMidiView` (UI).** Replaces the
   `MiniSequencer` track-strip thumbnail wholesale. Subscribes to a
   new `playingClipsStore` (keyed by `trackPath`) and paints the
   live position the surface ships at 30 Hz. Audio path uses
   `clipWaveformService` (now also serving Simpler's loop-brace
   render — single audit point for the Vite prod-path trap on
   `/api/sample-peaks`). MIDI path uses `clipNotesService` for the
   request/reply notes pull plus the `notes/changed` subscription.

Track-color fills: notes and audio peaks both render in the Live
track color (`useTrackData.trackColor`), velocity becomes alpha for
MIDI, recording overrides to red, Permute current-step muting
overrides to neutral grey (per-track, not just the focused track —
see "Dim on Permute mute" below).

Permute step state moved exclusively to `ClipCentralView` (which
already hosted the mute/pitch sequencer); Permute users keep at-a-
glance step visibility on Central View when a track is selected.

## Direct-position playhead (no client-side extrapolation)

The wire ships `(track_path, slot_idx, position_beats, status)` on
every `playhead` emit, straight from `Clip.playing_position` at
30 Hz. The UI paints the value it receives — no rAF interpolator,
no anchor/rate scheme.

This was a deliberate simplification. An earlier draft used an
anchor + rate triple so the UI could rAF-extrapolate sub-frame
playhead motion, with `playhead` emits acting as drift correction.
That model collapsed two whole classes of bugs into a single rule
the moment we switched: when transport stops, `playing_position`
listeners stop firing, so emits stop, so the playhead freezes.
Tempo changes are absorbed transparently — Live slows
`playing_position` itself, the wire just carries fewer beats per
window. ~33 ms-quantized motion is acceptable on the small
track-strip render (each step is ~2 px on a 50 px-wide strip).

## Display-slot fallback (populate on handshake / when stopped)

When `playing_slot_index` reads `-1`, the surface doesn't emit an
empty frame straight away. It resolves a *display slot* —
`song.view.highlighted_clip_slot` if it sits on this track, else
the first non-empty slot — and emits that slot's content with
`status = STATUS_STOPPED`. Truly empty tracks (no clips on any
slot) fall back to `slot_idx = -1` (the UI's ghost outline).

A `highlighted_clip_slot` listener on `song.view` keeps the strip
in sync when Live's selection moves. Playing tracks ignore the
listener (their own `playing_slot_index` listener owns their
emit).

## Loop-window normalization

When `looping=true`, the visible window is `[loop_start, loop_end]`
and the playhead is mapped into that window. When `looping=false`,
the visible window is `[0, length]`. UI never thinks in clip-relative
coordinates after layout — all rendering shares the same
`windowStart` / `windowEnd` derivation (`visibleWindow(entry)` in
`playingClipsStore`).

## Lane-fill for sparse MIDI clips

`TrackClipMidiView` lays notes by *distinct pitch lanes* with a
4-lane minimum, not by raw semitone span. A clip with two pitches
fills two lanes at 25 % strip height each (rather than two thin
floating lines in a 5-semitone padded band). Beyond 4 distinct
pitches the lane height shrinks proportionally.

## Dim on Permute mute (per track, all tracks)

`useTrackData.permuteMutedNow` re-derives the same per-moment Permute
state the retired `useTinySequencer` exposed: walk the track's devices
for `class_name = MxDeviceAudioEffect, name = Permute`, read
`Mute Current` (param 23, 1-indexed → step idx) × `Mute 1..8` (params
1..8, where `1 = step plays`, anything else = muted). Returns a
boolean per track, refreshed reactively from `v3Store.paramByPath` —
no extra wire traffic, no listener fan-out beyond what the param
broadcast already provides. `TrackClipView` and `TrackClipMidiView`
swap their fill to neutral grey when `dimmed=true`.

Loop-bound *changes* mid-playback flow through the existing
`/looping/v3/clip/property` channel. `playingClipsStore` cross-
subscribes from `v3Clip.ts` and patches matching entries by
`clip_path`. This works for the focused-clip case (the common one);
for a non-focused playing clip the property listener detaches, so a
brace drag on a non-focused clip won't update the strip until focus
returns. That's an acceptable corner — flagged for a follow-up if a
real complaint emerges.

## OSC blob support + UDP cap

The in-house `osc_codec.py` was extended to support the OSC `b`
(blob) typetag — the plan's note payload uses it. `4096` notes (the
plan's cap) would have produced a 64 KB blob, well over the
9216 B darwin UDP MTU. The cap is **512 notes** in this
implementation: 8192-byte blob + envelope ~8.3 KB total, safely under
the kernel limit. 512 covers a 32-bar 16-step grid exactly; busier
clips reject with `clip-too-many-notes` rather than silently truncate.

## Bridge JSON quirk for `b` blobs

Node's `osc` library hands back a plain `Uint8Array` for blob args.
The bridge's broadcast path is a plain `JSON.stringify(message)`, and
a raw `Uint8Array` round-trips as `{"0":byte0,"1":byte1,...}` — an
integer-keyed object, not the `{type:"Buffer", data:[...]}` shape a
real Node `Buffer` produces. `clipNotesService.toUint8Array` accepts
all three shapes (real `Uint8Array`, `Buffer`-tagged object,
integer-keyed object) with a regression test for each. Without this,
the UI silently sees zero-note replies on every notes/get.

## Consequences

- **MiniSequencer + useTinySequencer retired.** Both files deleted.
  `useTrackData`'s `sequencerState` getter dropped. Comments in
  `SequencerPatternGrid.svelte` updated to reference the standalone
  Central-View grid rather than the retired strip thumbnail.
- **Per-track listener cost.** +1 `playing_slot_index` listener per
  regular track (cheap; rate is gestural). +1 `playing_position` and
  +1 (MIDI only) `notes` listener per *playing* track. Fan-out is
  bounded by track count, never O(tracks × clips).
- **Bandwidth.** `playhead` is 30 Hz × N playing tracks × ~40 B per
  emit (4 args after dropping the anchor tail). N=8 worst case →
  ~10 KB/s. Comparable to meters' steady-state.
- **Notes blob cap deviation from plan.** Documented above; the
  plan's 4096 was a UDP-fit miscount. 512 is a more honest ceiling.
- **Plan deviations beyond the cap.** The plan called for an anchor
  triple + UI rAF interpolator and a multi-PR rollout; both were
  reversed during validation. Direct-position emits won on simplicity
  (transport-stop and tempo-change handling become free); a single
  branch carried the whole feature.

## Test coverage

- `tests/test_playhead_component.py` (28 tests) — listener
  attach/detach, slot transitions, throttle, position passthrough,
  status precedence, display-slot fallback (highlight, first-non-empty,
  truly-empty), MIDI notes-changed wiring, structural rebind, LOM
  exception swallowing, disconnect.
- `tests/test_clip_notes_component.py` (+12 tests for `notes/get`)
  — happy path, audio rejection, missing-clip, too-many-notes,
  malformed args, retransmit replay, cached-error replay, disconnect.
- `tests/test_osc_codec.py` (+7 tests for blob round-trip).
- `playingClipsStore.test.ts`, `clipNotesService.test.ts`
  (+integer-keyed-object decoder regression),
  `clipWaveformService.test.ts`, `v3PlayingClips.test.ts`.

Manual validation lives in `documentation/manual-test-checklist.md`'s
TrackClipView section.
