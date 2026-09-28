# ADR-395: Audio as a source toggle over the type buttons

## Status
**Accepted**

## Context
The drill-down browser's left rail (ADR-391) mixed two unrelated things into one
flat button row. Most buttons are instrument *types* (Drum/Bass/FX/Inst/Key/Synth,
from the types index); "Audio" was a *special* button (alongside Recent/Scale)
that opened its own flat tree of audio samples + `.alc` clips from a single root
(`audioBrowserBase`). `vendorModel.ts` even admits these are "still called
vendors for historical reasons."

That conflation had costs:
- **Wrong mental model.** Audio is not a peer of Drum — it's an orthogonal axis.
  A performer thinks "I want a drum — MIDI kit or a drum *sample*?" Type and
  MIDI-vs-audio are two questions, but the rail forced them into one list.
- **No per-type structure for samples.** The Audio tree was one flat vendor, even
  though the Audio Samples folder on disk is already organised by the *same*
  taxonomy as the type buttons (`Drum/`, `Bass/`, `FX/`, `Inst/`, `Key/`,
  `Synth/`).
- **Load behaviour was fixed.** A picked audio sample always became a clip; there
  was no way to drop it onto a Simpler, even though the surface handler for that
  (`loadCaptureIntoSimpler` → `replace_sample_onto_track`, with `alc_resolver`
  for `.alc`) already existed and was used for samples picked under instrument
  vendors.

## Decision
Make **Audio the source axis, not a category.** The type buttons are one set of
buttons; the Audio slab is a persisted toggle (`browserModeStore.sourceMode`):

- **unlit** → type buttons browse instrument presets (unchanged);
- **lit** → the *same* buttons browse audio *samples* of that type.

`selectCategory` resolves a tapped type against the source axis (`resolveEffective`):
in audio mode it reroutes the type onto the `audio-clips` vendor scoped to that
type's subfolder. Scoping lives in `AudioClipsAdapter.basePath` (set per
selection on the shared instance) so the base path stays **hidden from the
breadcrumb** — the drill starts from a clean type root ("Drum", not "Audio /
Drum"). The rail button id (`selectedVendorId`) and the effective vendorId
(`currentVendorId`, which the adapter/state key on) are now allowed to differ;
the component reads `currentVendorId` for the effective vendor.

A **load-as switch** (`Clip | Simpler`, `browserModeStore.audioLoadTarget`,
persisted) in the top bar decides what a picked sample becomes. `presetLoader`
branches on it: `clip` → `loadAudioClipFromPath` (raw → `clip/load_file`; `.alc`
→ Browser clip load, metadata preserved); `simpler` → `loadCaptureIntoSimpler`
(Empty Simpler on a fresh MIDI track; `.alc` resolves to its underlying sample
server-side). Audio picks now feed **Recent**, which carries a `loadTarget` per
sample entry so re-selection replays clip-vs-Simpler identically.

Type buttons with **no samples** (e.g. Synth) grey out while audio is lit,
driven by per-type counts in `audio-clips-index.json` (folder `id` == type id).

Decisions locked with the user: grey out empty types; `.alc`→Simpler reuses the
existing `alc_resolver` (no fallback needed); persist source + load-as; Recent
tracks both instruments and audio.

## Consequences
**Positive**
- The rail models the real two axes (type × source) instead of a flat list; one
  set of buttons, one lens.
- Reuses existing infrastructure: the Audio Samples folder is already type-first,
  and both load paths (clip / Simpler) already existed. **No Python changes.**
- Removes a special case — the standalone `audioVendor` category + `tapRailAudio`
  are gone, replaced by a toggle.
- Same sample is reachable as either a clip or a Simpler without leaving the
  browser; Recent replays it faithfully.
- Re-wires the **replace-audio-clip** flow (orphaned since the Miller browser was
  deleted): opening from a clip's replace gesture arms audio mode with a target
  pin; the next audio pick routes through `replaceAudioClip` (clip-into-slot, no
  track prep, no load-as branch) and the top bar shows a "Replace clip" pill.
  Verified end-to-end against a live surface (raw sample reaches
  `create_audio_clip` on the target slot).

**Negative / trade-offs**
- All audio types share one `audio-clips` nav state, re-seeded per selection, so
  there's no per-type path memory when switching types in audio mode (parity with
  instrument mode, which also resets the path on reselect).
- `selectedVendorId` ≠ `currentVendorId` in audio mode is a new subtlety to hold
  when reasoning about the browser.
- Greying depends on the generated `audio-clips-index.json` being fresh; a stale
  catalog can mis-grey a type until the next `generate-instruments` run.
- Replace-audio-clip via `clip/load_file` works for **raw** samples but not
  `.alc`: `create_audio_clip` can't resolve/preserve an `.alc` (metadata-losing,
  and it failed to resolve at all in testing), and loading an `.alc` as a clip
  into a *specific existing slot* has no LOM path (the Browser always makes its
  own track — ADR-394). `.alc`-in-replace is a known limitation, not addressed.

## Follow-up
**Audio samples no longer merged into the instrument catalogs.** Before this
toggle, the type-first generator merged the Audio-sample library into each
`{type}.json` as a fourth "vendor", surfacing a top-level **"Audio"** folder
among the instrument presets (ADR-392 describes the merge + its depth-cap
exemption). With Audio now a source toggle browsing the same samples via the
`audio-clips-*.json` split files, that merged-in folder is pure duplication — the
same samples reachable two ways, one of them mixed into the instrument tree.

The Step 2b merge in `scripts/generate-type-first-json.ts` is now gated behind
`catalog.mergeAudioIntoInstruments` (**default `false`**), so instrument catalogs
are instrument-only and audio is reached exclusively through the toggle. The
standalone `audio-clips-*.json` split files (which power the toggle) are produced
regardless of the flag. Set the flag `true` to restore the legacy merged-in
"Audio" folder. Regenerate with `npm run generate-instruments` after flipping it.

## Tags
`browser`, `audio-samples`, `drill-down-browser`, `source-toggle`, `simpler`,
`recent`, `svelte5`, `ui-architecture`
