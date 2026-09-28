# ADR-401: Waveform thumbnails on audio browser tiles

## Status
**Accepted** (builds on ADR-398 — Path C `.asd` overview)

> **Revised (2026-07-11) — thumbnail-quality pass.** The original format shipped
> at 64 bins with min/max peaks (`THUMB_VERSION` 1). On a wide browser tile that
> undersampled busy loops into a spiky picket fence. Revised to **256 bins**, a
> gentler **0.85** render curve, and **symmetric RMS pairs for decoded-PCM (Path B)
> bins** (`.asd`/PCM-stream bins stay min/max — those sources expose no raw audio).
> `THUMB_VERSION` → 2, which forced a **one-time full re-bake** of the sample
> library (`npm run generate-instruments`). The `[lo,hi]` byte layout and the live
> `/api/sample-peaks` endpoint are unchanged. The pixel-snap seam fix (no 1px
> background gaps between bars) was also propagated to `TrackClipView` and
> `SimplerLoopControl`; those stay bipolar min/max with a live playhead by design.

## Context
The app already renders sample waveforms in three places — the track strip
(`TrackClipView`, bins=256), the Simpler view (`SimplerLoopControl`, bins=1024),
and the central clip editor (`ClipEditorView`, bins=1024) — all through one
service (`clipWaveformService.getPeaks`) backed by one endpoint
(`/api/sample-peaks`, ADR-360/362). Each of those surfaces renders **exactly one**
waveform: the current/focused clip.

The audio browser (`DrillDownBrowser`, ADR-391/395/396) showed sample tiles as
plain text-on-colour cards. Every tile already carries `preset.fullPath` — the
absolute path the peaks endpoint wants — so a waveform per tile was tantalisingly
close. The catch is that the browser is the first surface that would render
*many* waveforms at once and re-render them on every scroll/drill. Decoding a
sample to peaks is the expensive part, and doing it live for a whole folder of
tiles on every browse (the endpoint's LRU is only 32 entries) would thrash.

The decision was therefore less about *rendering* (the draw loop is trivial and
already exists) and more about **when the peaks get computed** so we pay for each
sample's decode roughly once.

A large slice of the sample library is also Ableton **protected-pack AIFC** (the
`able` codec) that no decoder — PCM probe, `audio-decode`, CoreAudio, ffmpeg —
can read. ADR-398 added a **Path C** to `/api/sample-peaks` that reads the min/max
overview Live already stored in the `<sample>.asd` sidecar; the bake reuses it so
those samples get a real waveform instead of a blank tile.

## Decision

**1. Bake a low-resolution thumbnail into the audio-clips catalogs at generation
time.** `scripts/generate-type-first-json.ts` already scans every sample to build
`audio-clips-*.json`. It now also stamps a `peaks` thumbnail onto each audio
preset, so a browser tile paints its waveform from catalog data with **zero**
network round trips. The full-resolution render stays live (strip/Simpler/editor
still fetch 256/1024-bin peaks on demand) — the thumbnail is deliberately the
coarse tier.

**2. The catalog build is the reconciliation moment, not a full recompute.** A
gitignored sidecar cache (`scripts/.cache/audio-peaks-cache.json`) records, per
absolute path, the `(mtimeMs, size, formatVersion)` each thumbnail was computed
at. Every build `stat`s each sample — microseconds, no decode — and:
- unchanged + same version → reuse the cached thumbnail,
- new / changed / version bump → decode now, store the result,
- deleted → drops out (only scanned paths are written back).
So a warm build decodes only the handful of samples that actually changed; the
first (cold) build pays the full decode once. Non-decodable samples get a
**tombstone** (cached "no thumbnail") so they aren't re-attempted every build.
This is the same pattern Ableton's own `.asd` analysis files use.

**3. Decode reuses the endpoint's own modules — `.asd` first, then PCM.**
`bakeThumbnails` (`scripts/audioThumbnailCache.ts`) lazily dynamic-imports the
peaks modules from the `/api/sample-peaks` route tree (`asdOverview`, `formatProbe`,
`streamPcmPeaks`), so a baked thumbnail and the live render come from identical
math. `computeThumbnail` privileges **Path C** — Live's `.asd` overview
(`readAsdOverview`, ADR-398) — then falls back to **Path A** streaming PCM, then
tombstones. This **inverts the endpoint's Path A→C→B order on purpose:** the bake
produces 256-bin thumbnails over tens of thousands of read-only pack samples
with no auto-trim dependency, so the cheap ~20 KB `.asd` sidecar read beats
streaming/decoding a multi-MB file — and it's the only way to render protected pack
AIFC. The endpoint keeps decode-first because *its* consumers (Simpler/editor @1024
bins; auto-trim's `firstTransientFrame`) need real-audio precision when the file is
decodable; the `.asd` overview is coarser and carries no transient data. The import
is lazy + guarded: any failure degrades to "no thumbnails" and the catalog still
builds. Files with neither a usable `.asd` nor readable PCM (compressed mp3/flac/ogg
without a sidecar) tombstone → the tile live-fetches instead.

Because pack AIFC now routes through `.asd` on **both** sides — the bake (Path C
first) and the live endpoint (Path A rejects the codec, Path C reads the sidecar) —
the baked thumbnail and the focused-surface render agree for those samples,
preserving the decode-consistency invariant.

**4. One isomorphic codec.** `interface/src/lib/utils/waveformThumbnail.ts`
encodes/decodes the thumbnail: `THUMB_BINS` (256) `[lo,hi]` pairs quantised to
signed int8 and base64-packed — 512 bytes → ~684 chars per sample. The generator
(Node) encodes; the tile (browser) decodes; both share the one file so the byte
layout can't drift. `THUMB_VERSION` bumps invalidate the whole cache. Each pair is
`[lo,hi]`: `.asd`/PCM-stream bins store true `[min,max]` peaks; **decoded-PCM bins
(Path B) store a symmetric RMS pair `[-rms,+rms]`** so busy loops read as energy
density, not spiky per-bin peaks. The tile collapses either to `max(|lo|,|hi|)`,
so the split is invisible downstream. (See the "Revised" note below.)

**5. The tile renderer is lazy and gated.** `BrowserPresetWaveform.svelte` sits
behind the tile label (`z-index:0`, `pointer-events:none`). It decodes the baked
thumbnail when present, else live-fetches full peaks — both **behind an
IntersectionObserver**, so a folder of hundreds of tiles only decodes/fetches the
handful on screen. It renders **unipolar** (bars grow up from the bottom edge from
`max(|lo|,|hi|)`) with a 20× gain cap and a gentler **0.85** power curve — flatter
than the strip's 0.6 so 256 dense bins don't flatten a loop into a picket fence;
column edges are pixel-snapped so adjacent bars leave no 1px seams. Rendering is
gated per-tile on an audio file extension, so instrument tiles never draw. (The
strip/Simpler stay **bipolar** min/max with a live playhead — that's the editor
look; only the pixel-snap seam fix was propagated to them.)

**6. One feature flag, default on.** `ui.browser.audioWaveforms` in
`constants.json` gates **both** the bake (generator) and the render (component).
Set it `false` to disable the whole feature with no code change.

## Consequences

**Positive**
- Sample tiles paint a waveform on first display with no per-tile network round
  trip — a real win on iPad, where every live peak fetch is iPad→Mac over HTTP.
- Warm builds are near-instant: only new/changed samples decode. The cold build
  pays once.
- **No backend, bridge, or Python changes.** The peaks endpoint, wire protocol,
  and control surface are untouched; the generator reuses the endpoint's modules.
- **Protected pack AIFC now renders.** Samples the streaming/decode paths can't
  read (Ableton's `able` codec) bake a real waveform from their `.asd` overview —
  previously they'd have tombstoned to a blank tile. For those samples the bake and
  the live render agree (both go through `.asd`).
- Bounded work at scale: the IntersectionObserver caps decode/draw to visible
  tiles regardless of folder size.
- Fully non-fatal: reducer-unavailable, per-file decode failure, or bake throw all
  degrade to thumbnail-less catalogs + live-fetch fallback; the catalog always
  builds.

**Negative / trade-offs**
- **Catalog JSON grows** ~684 bytes per PCM sample (base64 thumbnail, 256 bins).
  The catalogs are split per top-level folder and lazy-loaded (LRU 3), so the cost
  is bounded per open folder, but the largest folder file (`inst`, ~18k presets) is
  now ~22 MB. If a big folder's first drill feels heavy on iPad, `THUMB_BINS` can
  drop to 128 (halves it, still a big step up from 64) — a one-line change + re-bake.
- **Compressed formats without an `.asd` aren't baked** (Path C needs the sidecar;
  Path A is PCM-only). They render via a live fetch — correct, but not
  zero-round-trip. Baking them would mean pulling `audio-decode` into the generator;
  deferred.
- **Cold build costs a full decode pass** over the sample library. Acceptable
  (once), and the whole pass is skippable via the flag.
- **The generator now cross-imports the SvelteKit route tree** (`asdOverview` + the
  Path A reducer) via dynamic import. Guarded and lazy, but it's a coupling the
  generator didn't have before; if those modules move, update
  `audioThumbnailCache.ts`.
- **The bake and endpoint decode-path orders differ** (bake: C→A; endpoint: A→C→B).
  Intentional and documented in `computeThumbnail`, but a reader comparing the two
  must know the inversion is deliberate, not a bug.
- **Thumbnails are coarse relative to the focused surfaces.** 256 bins reads the
  envelope shape on a wide tile but isn't a substitute for the live 256/1024-bin
  renders (which also carry true per-bin peaks, not RMS).
- The sidecar cache lives in `scripts/.cache/` (gitignored, per-user), so a fresh
  clone's first build is always cold.

## Tags
`browser`, `audio-samples`, `waveform`, `drill-down-browser`, `sample-peaks`,
`asd`, `ableton-packs`, `json-generation`, `caching`, `svelte5`, `performance`,
`ui-architecture`
