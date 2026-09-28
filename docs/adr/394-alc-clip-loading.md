# ADR-394: Loading `.alc` (Ableton Live Clip) files with metadata preserved

## Status
**Accepted**

## Context

The Audio vendor browser surfaces `.alc` (Ableton Live Clip) files — most
of them factory-pack clips (e.g. *The Forge by Hecq*) reached via symlink
under the User Library. Before this change, tapping an `.alc` in the browser
did nothing useful: `.alc` was not recognized as a loadable audio file, so
the tap fell through to the instrument-preset code path and silently
no-op'd.

An `.alc` is **not audio** — it is a gzipped XML file that wraps a
*reference* to an underlying `.wav`/`.aif` plus clip metadata: warp markers,
loop start/end, gain, pitch. Making `.alc` "work" splits into distinct
problems, each with its own gotcha:

1. **Resolving the underlying sample.** Factory `.alc` files carry **no
   absolute sample path** — only a leaf `Name` and a `RelativePath` whose
   leading run is the real relative path and whose tail is a dead authoring
   path (`private/tmp/trunk/...`). The sample often lives in a *sibling*
   `Samples/` folder, not beside the `.alc`.

2. **Loading as a clip vs. as raw audio.** `ClipSlot.create_audio_clip()`
   only accepts a raw audio file — it discards all the metadata that made
   the `.alc` worth loading. Live's **Browser** (`browser.load_item`) loads
   an `.alc` *as a clip*, preserving warp/loop/gain — but only through the
   Browser, and only into a track **the Browser itself creates**.

3. **Waveform rendering.** `/api/sample-peaks` (Node) can't decode `.alc`
   XML; it needs the resolved sample path.

Two behaviors were discovered empirically (via the `AlcClipProbe` diagnostic
driving `browser.load_item` against live Ableton 12.4):

- **`browser.load_item` for an `.alc` preserves all clip metadata**
  (`warping`, `warp_markers`, `loop_start`/`loop_end`, `gain`, `pitch`).
- **`browser.load_item` for an `.alc` ALWAYS creates its own new track.**
  It ignores `highlighted_clip_slot`; you cannot force the clip into an
  existing track's slot.

That second fact is the crux. An early implementation pre-prepared an empty
audio track (mirroring the instrument flow) and tried to load the clip into
it — which produced **two tracks**: the pre-prepped empty one plus the
Browser-created clip track.

## Decision

**Resolution (shared primitive).** Add a pure `.alc` → sample resolver in
both Python (`components/alc_resolver.py`) and Node
(`routes/api/sample-peaks/alcResolver.ts`): gunzip → parse `<SampleRef>
<FileRef>` → read `Name` + leading `RelativePath` (dropping the
`private/tmp/trunk` fallback run) → **upward-walk** from the `.alc`'s
directory trying `<ancestor>/<relpath>/<name>` until it resolves. Trust an
absolute `<Path Value>` if present and real. Deterministic, no fuzzy
filename matching.

**Clip load (metadata-preserving).** Route an `.alc` tap through the atomic
`prepare_for_preset` endpoint with `track_type='audio'` and the `.alc` path.
`TrackPrepareComponent` detects the `.alc` and, instead of
create-track-then-load, lets **Live's Browser create the track**
(`DeviceLoadComponent.load_clip_new_track`: snapshot tracks →
`browser.load_item` → return the newly-appeared track), then preps *that*
track (input routing / arm / Permute) and acks with its path. Pack clips
that miss the User-Library `BrowserCache` are resolved by a bounded walk of
the real `browser.packs` / `clips` roots.

**No pre-prep for the Audio vendor.** Because the Browser owns track
creation for `.alc`, the up-front `prepareTrack('audio')` on vendor tap is
**skipped** for the Audio vendor — otherwise it would leave an orphan empty
track. Both audio file types now create their track at load time: `.alc` via
the Browser, raw audio via `prepareForPreset('audio', '')` + `clip/load_file`.

**Fallback.** If the `.alc`'s `BrowserItem` can't be resolved, the load
falls back to creating an audio track and loading the resolved raw sample via
`create_audio_clip` (metadata lost, but the clip still lands) — graceful
degradation over a dead tap.

**Waveform.** `/api/sample-peaks` resolves an `.alc` to its sample (Node
mirror of the resolver) before decoding, so `.alc` clips render a waveform.

## Consequences

**Positive**
- Tapping an `.alc` loads it as a real clip with warp/loop/gain intact, on a
  single new audio track.
- The resolver handles the factory-pack `Clips/`-vs-`Samples/` sibling
  layout with no per-pack configuration.
- Waveforms render for `.alc` clips.
- Raw audio still works (now create-on-load rather than pre-prepped).

**Negative / trade-offs**
- The resolver logic is duplicated across Python (load) and Node (waveform).
  Kept in sync deliberately; both are pure + unit-tested.
- Live's Browser always creating a track for `.alc` is a hard constraint we
  accommodate rather than override.
- The Audio vendor no longer pre-preps, so the very first `.alc`/audio load
  after opening the browser pays track creation at tap time (previously
  front-loaded). Negligible in practice.

**Diagnostic left in place.** `AlcClipProbe` + `owner/probes/alc_clip_probe_run.js`
(operator-driven, not in `backendScope`) verify browser-load metadata
survival against live Ableton — kept as a regression catch for future Live
upgrades, mirroring the Gate 4 probe pattern.

## Tags
`alc`, `live-clip`, `audio-clips`, `browser-load`, `track-prepare`,
`waveform`, `sample-peaks`
