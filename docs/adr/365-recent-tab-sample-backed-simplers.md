# ADR-365: Recent tab — sample-backed Simplers from capture and convert flows

## Status
**Accepted** (2026-05-01)

## Context

The browser's Recent tab
(`interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte` +
`recentInstrumentsStore` + `RecentInstrumentsAdapter`) only tracked
**library presets** — `.adg`/`.adv` files loaded through the browser's
`loadPresetWithVariant` → `prepareForPreset('midi', presetPath)` path.
The hook lived in one site:
`interface/src/lib/components/v6/browser/utils/presetLoader.ts`,
gated on `vendorId && vendorId !== 'audio-clips' && vendorId !== 'recent-instruments'`.

Two other code paths produce instruments the user genuinely wants to
re-spawn:

- **REC TO SIMPLER** (capture flow): looping-recorder.amxd writes a WAV,
  `captureStore` calls `loadCaptureIntoSimpler(filePath)` in
  `clipOperations.ts`, which preps a MIDI track and fires
  `/looping/v3/simpler/replace_sample_onto_track [trackPath, filePath]`
  to land an Empty Simpler holding that sample.
- **Audio clip → Simpler** (convert flow): `ClipCentralView` calls
  `sampleClipToSimpler()`, firing `/looping/v3/simpler/replace_sample
  [clipPath]`. Python creates a fresh MIDI track and an Empty Simpler
  whose sample is the clip's underlying audio.

Neither flow had a recent-add hook, so a captured loop was a one-shot:
once the Simpler was built, the only way to spawn a sibling was to
re-record. The two flows also differ in what they know about the sample
up front: the capture flow has the `filePath` synchronously (passed in
from looping-recorder), while the convert flow has only the source clip
path — `clip.file_path` is server-side and the surface emits no ack
carrying the resolved sample path. The convert flow learns the path
asynchronously, the same way the auto-trim feature does, by watching for
the post-load `sample.file_path` echo on a freshly-mounted Simpler
(`armAutoStartMarker`, ADR-354).

## Decision

Make the Recent list heterogeneous: it now holds preset entries (as
before) and **sample entries** that point at an absolute filesystem
path. Re-tapping a sample entry runs `loadCaptureIntoSimpler` against
the stored path — the same loader the original capture flow used —
producing a fresh MIDI track + Empty Simpler holding the same WAV.

### 1. Tagged-union store

`recentInstrumentsStore` becomes `RecentItem = RecentPresetItem |
RecentSampleItem`:

```ts
interface RecentPresetItem { kind: 'preset'; name; fullPath; vendorId; timestamp }
interface RecentSampleItem { kind: 'sample'; name; filePath; source: 'capture' | 'convert'; timestamp }
```

- Dedup keys are kind-scoped: presets by `fullPath`, samples by
  `filePath`. Same name across both kinds is fine.
- Storage key bumped to `looping:recentInstruments:v2`. v1 entries
  (untagged, preset-only) are dropped on first v2 boot — the cost is
  one user reloading recent instruments, vs. a real schema migration
  that would have to fabricate a `kind` field.
- `getAsPresets()` projects samples into the `Preset` shape with
  `kind: 'sample'` + `filePath` so the existing browser pipeline
  (adapter, grid, gesture handlers) renders them unchanged.

### 2. One shared post-load hook for both flows

`armAutoStartMarker` already watches for the qualifying
`sample.file_path` echo as the **proof-of-success signal** for the
auto-trim feature. We piggy-back on that watcher: it gained an
`onResolved(devicePath, filePath)` one-shot callback that fires the
first time the qualifying echo lands.

```ts
armAutoStartMarker({
  filePath, expectedDevicePath, flow: 'capture',
  onResolved: (_devicePath, resolvedPath) => {
    recentInstrumentsStore.addSample(deriveSampleDisplayName(resolvedPath), resolvedPath, 'capture');
  },
});
```

Three properties matter:

- **Fires after success.** A failed `replace_sample` won't emit the
  echo, so a load that bombs out on the surface side never adds a
  ghost to recents.
- **Fires once.** Independent of the auto-trim write itself —
  `onResolved` runs even when the auto-trim path bails (frame=0, race,
  length missing). The fact that the *sample* loaded is what we care
  about here, not whether the start-marker move succeeded.
- **Independent of the up-front filePath.** The capture flow knows
  `filePath` synchronously; the convert flow doesn't. Both pass an
  `onResolved` and let the watcher hand them the resolved path.

This keeps the recent-add hook as one shape, regardless of whether the
caller learned the path eagerly or via the echo.

### 3. Loader branch in `loadPresetWithVariant`

`presetLoader.ts:loadPresetWithVariant` now branches at the top:

```ts
if (preset.kind === 'sample' && preset.filePath) {
  await loadCaptureIntoSimpler(preset.filePath);
  browserNavigationStore.loadedPresetPath = preset.path;
  return;
}
```

Sample-backed entries skip the `prepareForPreset` path entirely —
there's no preset on disk, only a WAV. The loader handles its own MIDI
track prep + Empty-Simpler swap. Move-to-front is automatic via the
same `onResolved` hook (the re-tap goes through `loadCaptureIntoSimpler`
→ `armAutoStartMarker.onResolved` → `addSample`, which de-dups by path
and re-inserts at the front).

The existing preset-add at line 192 of `presetLoader.ts` continues to
gate on `vendorId !== 'recent-instruments'`, so re-tapping a preset
recent doesn't grow a duplicate preset entry.

### 4. Prune on `replace-sample-failed`

WAV paths can move/disappear between sessions. `handleV3Error` in
`v3Handshake.ts` now branches on `code === 'replace-sample-failed'`:
the surface emits this from `SimplerLoadComponent.handle_replace_sample_onto_track`
when `simpler.replace_sample(file_path)` raises, and the typed error's
`path` arg carries the file path that failed. We prune the matching
sample entry so a future tap doesn't keep retrying the same dead file.
Dynamic import keeps the v3 handler off a top-of-module v6-store
dependency, mirroring the existing pattern for `pool-exhausted` and
`clip-not-midi`.

The error code is the right one because every realistic "sample is
gone" failure (missing file, unreadable, format unsupported, the
underlying `_LOM_ERRORS` raise from `replace_sample`) lands here, and
non-sample-related Simpler errors (`empty-preset-configured`,
`no-simpler-on-track`, `replace-sample-missing` for Live <12.4) carry
preset paths or empty paths in the same arg slot, so the pruner's
file-path equality check naturally ignores them.

### 5. Display name

`deriveSampleDisplayName(filePath)` strips the directory and extension.
Capture filenames follow the `LOOPING_CAPTURE_<timestamp>` convention
(ADR-356), which renders as e.g. `LOOPING_CAPTURE_2026-05-01-143022`.
Not pretty, but readable and stable; a future cleanup pass can format
the timestamp into something tile-friendly without changing the
storage shape.

## Consequences

### Positive

- Captured and converted Simplers are first-class re-spawnable
  instruments. The two-bar loop you grabbed via REC TO SIMPLER lives
  in Recent until you push it out at the 20-item cap.
- Cross-session persistence via `localStorage` works for samples
  exactly like it does for presets — capture file paths are stable
  (project root or `~/Music/Ableton/User Library/Captures/`,
  ADR-356).
- One canonical add-to-recent hook for both flows. The convert
  flow's "I don't know my filePath up front" problem is solved by
  the same echo watcher that already exists for auto-trim, not by a
  parallel discovery mechanism.
- Failed loads don't pollute the list. `onResolved` only fires on
  success; missing-file taps prune themselves via the v3 error bus.
- No UI surface area changes beyond the existing Recent tab. The
  adapter, grid, gesture controller, and store-driven rendering all
  see Recent items as `Preset` shapes with one optional `kind`
  discriminator.

### Negative

- The `Preset` interface in `browserAdapter.ts` grew two optional
  fields (`kind?: 'sample'`, `filePath?: string`) it didn't have
  before. Cheap, but it's a small leakage of recent-tab concerns
  into the shared adapter type. Worth revisiting if more entry kinds
  appear; until then, two optional fields beat a parallel type
  hierarchy.
- Sample tiles render with the same visual treatment as preset tiles.
  A user can't tell at a glance that an entry is a captured WAV vs a
  library preset. Acceptable for v1; a small "WAV" badge or
  alternate background tint is a follow-up.
- Display names show the raw `LOOPING_CAPTURE_<timestamp>` filename.
  Functional but ugly. Same follow-up note.
- v1 → v2 storage migration drops existing recent presets on first
  boot. Single-shot cost; the user reloads from the browser and
  the new entries land in v2 storage.
- The capture flow's `onResolved` adds-to-recent runs even when
  auto-trim itself bails (frame=0, race-detected, length-missing).
  This is the right call — we want the entry regardless of whether
  the start-marker write succeeded — but it does mean the recent
  entry exists for samples where the auto-trim's defensive guards
  fired. No user-visible bug; documented here so future-me doesn't
  conflate the two signals.

## Validation

- Production build green (`npm run build`).
- Full TS suite: 1022 / 1022 across 59 files (`npm run test:run`).
- `npm run check`: no errors introduced; the 6 pre-existing errors
  are in test fixtures (`SvelteMap` typing) and `ErrorBoundary.svelte`,
  unrelated to this work.
- Manual validation pending: REC TO SIMPLER → close browser → open
  Recent → tap entry → expect a fresh MIDI track with a new Simpler
  holding the same WAV; same flow from the audio-clip-to-Simpler
  convert button.

## Tags
`recent-instruments`, `simpler`, `capture`, `convert`,
`auto-trim`, `arm-auto-start-marker`, `sample-backed`,
`replace-sample-onto-track`, `unified-gesture-browser`,
`v3-error-bus`
