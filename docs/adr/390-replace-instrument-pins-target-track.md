# ADR-390: Replace-Instrument Pins the Target Track

## Status
**Accepted**

## Context

The clip central view has a "Replace instrument" button: hold it, then
pick an instrument from the browser, and the instrument on the **current
track** should be swapped in place — clips, Permute, and FX preserved.

In practice it created a *new track* instead. The button is only enabled
when the current track has a clip (`!hasClip` gate in
`ClipCentralView.svelte`), and that clip was exactly what broke the swap.

The flow routed through the same atomic endpoint as a fresh preset load:
`/looping/v3/track/prepare_for_preset [request_id, track_type,
preset_path]`. That endpoint's `TrackPrepareComponent._decide` runs a
**reuse-vs-create** decision against authoritative LOM reads:

1. Reuse the selected track — but only if `_is_reusable`, which requires
   **no clips**.
2. Else scan for the lowest-index empty track.
3. Else **create** a new track.

A track with a clip fails step 1, usually fails step 2, and falls through
to step 3. So "replace the instrument on this track" — a track that by
definition has a clip — always created a new track. The wire had no way
to express "use THIS track regardless of clips"; replace mode also never
captured *which* track it was launched from (`openForReplace()` stored
nothing, and `skipPrepAndMarkReady()` left `preparedTrackIndex`
undefined), so even the client had lost the target by the time the preset
was picked.

Replace-instrument is a fundamentally different intent from
create-or-reuse. It needs an explicit target, not a heuristic.

## Decision

Add an **optional 4th wire arg** `target_track_path` to
`/looping/v3/track/prepare_for_preset`. When present and non-empty
(replace-instrument mode), Python resolves that exact `tracks/<N>` and
loads the preset onto it, **bypassing** `_decide` entirely. Live's
`browser.load_item` drops an instrument preset into the track's
instrument slot, replacing the existing instrument in place; clips,
Permute, and FX are untouched. The ack carries `was_created=0`.

The arg is threaded end to end:

- **`browserModeStore`** — `openForReplace(targetTrackPath)` captures the
  launching track; `replaceInstrumentTargetPath` getter exposes it;
  `exitReplaceMode()` clears it.
- **`ClipCentralView`** — passes `selectedTrackStore.selectedTrackPath`
  when entering replace mode.
- **`UnifiedGestureBrowser`** — forwards the pinned path to
  `loadPresetWithVariant` in both the tap (`handlePresetClick`) and
  drag-release (`handleGestureEnd`) branches, so replace works
  regardless of gesture. Both paths exit replace mode in a `finally`
  so a failed load (nack / timeout) can't leave the pin set and leak
  into the next browser open.
- **`presetLoader.loadPresetWithVariant`** — new `replaceTrackPath`
  param, forwarded to `prepareForPreset`.
- **`trackPreparation.prepareForPreset`** — new `targetTrackPath` param;
  always sends a 4th wire arg (empty string = auto), keeping the wire
  shape stable.
- **`TrackPrepareComponent.handle_prepare`** — accepts 3 *or* 4 args;
  `_resolve_pinned_track` validates the path (nacks `invalid-args` on a
  malformed path, `no-track` when out of range) and returns
  `(track, index)` with `was_created=False`. `_ensure_sequencer` still
  runs and is idempotent (Permute already present → skipped).

The track is also renamed to the new preset's name (the existing
unconditional `setTrackName` in `loadPresetWithVariant` already does
this).

## Consequences

**Positive**
- Replace-instrument swaps in place on the current track, clip and all —
  the intended behaviour.
- Reuse-vs-create stays server-authoritative for the normal load path;
  only the explicit-target case bypasses it, and it bypasses it cleanly.
- Wire shape is stable (4 args always sent); the endpoint stays backward
  compatible with a 3-arg message (treated as auto).
- Misdirected pins fail loud (`invalid-args` / `no-track`) instead of
  silently retargeting.

**Negative**
- One more positional wire arg to keep in sync across the five layers and
  two test suites.
- A pinned path is only validated for existence/range, not type — pinning
  an audio track for a `midi` load would attempt the load and likely nack
  `load-failed`. The UI never does this (the replace button is
  `trackType === 'midi'`-gated), so it's not guarded server-side.

## Tags
`track-preparation`, `wire-protocol`, `replace-instrument`,
`clip-central-view`, `device-load`
