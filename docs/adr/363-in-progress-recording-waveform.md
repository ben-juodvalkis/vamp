# ADR-363: Track-strip waveform for in-progress recordings

## Status
**Accepted** (2026-04-30)

## Context

After a fresh audio recording into an empty slot, the track strip
showed an empty lane until the user manually refreshed the page. The
waveform never appeared on its own. Two distinct races combined to
produce the symptom.

### Race 1 — `playing_slot_index` flips before `slot.has_clip`

When the user fires record on an empty slot, Live flips the track's
`playing_slot_index` to the recording slot **before** that slot's
`has_clip` becomes true. `PlayheadComponent`'s `playing_slot_index`
listener fires, `_safe_resolve_clip` returns `None` (the slot has no
clip yet), and `_attach_clip_listeners` returns without attaching
anything — including the `is_recording` listener that would have
fired on record-stop. The clip materializes a tick later but no
re-emit is wired.

Consequence: even after the recording finished and `file_path`
populated in the LOM, no `playing_slot` ever re-emitted to the UI.
A page refresh worked because it re-ran `_emit_initial_values`, which
walks tracks fresh and resolves the now-materialized clip.

### Race 2 — AIFF probe rejects in-progress files

The other half of the bug lived on the SvelteKit server side. Live
writes the recording AIFF progressively: the `FORM` / `COMM` / `SSND`
header is written up front with the *eventual* sample count, but the
audio bytes are appended over time as recording continues. On the
first fetch immediately after `playing_slot` reaches the UI:

- `formatProbe.parseAiff` would read the header, see
  `ssndDataOffset + ssndDataSize > sizeBytes` (declared size larger
  than the file actually on disk), and reject with `null`.
- The route fell through to Path B (`audio-decode` full-decode), which
  choked on the partial AIFF and threw → **HTTP 415**.
- `clipWaveformService` returned `null`. `peakData` stayed `null`.
- `TrackClipView`'s fetch effect was keyed on `wavFilePath` only, so
  no re-fetch ever triggered for the same path — even after the file
  finalized.

The original probe rejection comment ("Real-world WAVs sometimes
record `dataSize = 0xFFFFFFFF` or a value that runs past EOF") was
defending against a different shape of malformation. The cure was
worse than the disease for the in-progress recording case, which has
exactly the same shape (declared > on-disk).

The two races compounded: even if Race 1 had been fixed alone, the
re-emit would have re-fetched and hit the same 415 because the file
was still finalizing.

## Decision

Three coordinated fixes — each at the correct layer, no client-side
polling.

### 1. Server probe clamps in-progress dataSize instead of rejecting

`formatProbe.ts` (both `parseWav` and `parseAiff`):

- Reject only when `dataOffset >= sizeBytes` (genuinely malformed
  header pointing past EOF).
- When `dataOffset + dataSize > sizeBytes`, **clamp** `dataSize` to
  `sizeBytes - dataOffset` and continue.

`streamingPcmPeaks.ts` already handles short reads gracefully
(`if (bytesRead <= 0) break;`), so the streaming path renders the
bytes that exist. Bins past the on-disk extent end up empty
(`UNTOUCHED_MIN/MAX → 0`) without crashing or returning 415. The
file's on-disk bytes are valid PCM samples — Live writes append-only
— so we just can't read past them.

### 2. Single render-decision function for the strip

PlayheadComponent previously had four separate code paths deciding
"what should this track render": the `playing_slot_index` listener,
the `highlighted_clip_slot` listener, `_emit_initial_values`, and
the `has_clip` callback. Each had its own detach / attach / emit
sequence with subtle differences.

These collapse into one resolver + one applier:

```python
def _resolve_render_target(track, track_path) -> (slot_idx, status_override):
    # Priority:
    #   1. playing_slot_index >= 0 → that slot, status derived
    #   2. highlighted_clip_slot if on this track + has_clip
    #   3. first non-empty slot (lowest index)
    #   4. -1 (track has no clips → UI hides the strip)

def _apply_render_target(track, track_idx, track_path):
    # Compare resolver output to existing bookkeeping; detach +
    # attach only when slot changed; always emit (dedup suppresses
    # no-op payloads).
```

Every listener — playing_slot_index flip, has_clip fanout, highlight
move, structural rebind, init seed — now ends in one line:
`self._apply_render_target(track, track_idx, track_path)`. Adding
a future signal to the decision (e.g. ClipPropertiesComponent
reactions) means modifying one resolver instead of four handlers.

The "track has no clips → emit slot_idx=-1 → UI hides the strip"
priority closes the gap where empty tracks previously rendered a
ghost outline. TrackStrip already gates `<TrackClipView />` on
`hasClip`; the resolver now makes that gate authoritative.

### 3. Python re-emits `playing_slot` via shared `has_clip` fanout

ClipsComponent already owns a `has_clip` listener on every regular
slot — it's the source of `/clip/created` and `/clip/removed`. Rather
than have PlayheadComponent attach its own duplicate listener and
schedule a bounded poll, ClipsComponent now exposes an in-process
pub/sub:

```python
# ClipsComponent
def add_has_clip_change_callback(self, cb):  # cb(slot_path, has_clip)
    ...

# fired from _on_has_clip_changed, after the wire emit
for cb in self._has_clip_callbacks:
    cb(slot_path, has_clip)
```

PlayheadComponent registers `on_slot_has_clip_changed`. That callback
parses `tracks/N/slots/M`, looks at the track's current
`playing_slot_index` and the rendered slot we have bookkeeping for,
and acts on:

- **`has_clip=True` on the slot the playing index points at** —
  fresh-recording materialization. Late-attach listeners (including
  `is_recording`) and emit `playing_slot` with the real render
  context. Replaces the bounded settle recheck.
- **`has_clip=True` on a stopped track currently showing the empty
  ghost** — promote the new clip to the display slot if
  `_resolve_display_slot` agrees.
- **`has_clip=False` on the rendered slot** — clip was deleted under
  us. Detach, re-resolve display, emit the next-best frame (or
  empty).
- **Anything else** — no-op. The wire `/clip/removed` already went
  out for any UI that cares structurally.

For the recording-stop transition (record→play, file_path populates
synchronously while OS finishes flushing the .aif), PlayheadComponent
also attaches a per-clip `is_recording` listener inside
`_attach_clip_listeners`. On flip-to-false it schedules
`RECORD_SETTLE_DELAY_MS = 250 ms` of disk-flush settle via
`schedule_delayed` and then re-emits `playing_slot`. Existing
`_emit_playing_slot_dedup` suppresses no-op fires.

`LoopingSurface.py` wires the components together:

```python
self._clips_component.add_has_clip_change_callback(
    self._playhead_component.on_slot_has_clip_changed,
)
```

LoopingSurface owns the dependency direction; PlayheadComponent has
no knowledge of ClipsComponent. The wiring is testable in isolation
by invoking `on_slot_has_clip_changed` directly.

The re-emit carries the now-populated `filePath` and the finalized
`lengthBeats`. Together with (1) the server now successfully serves
peaks even mid-recording, and after stop the re-emit triggers a
fresh fetch.

### 4. Client refetches when `lengthBeats` changes for the same path

`clipWaveformService.getPeaks` accepts a `{ force: true }` option
that bypasses the LRU cache and aborts any inflight fetch for the
same `(filePath, bins)` key.

`TrackClipView.svelte` now derives a `peaksFetchKey` of
`${wavFilePath}::${wavLengthBeats}`. The fetch effect tracks the
prior key; if only `lengthBeats` changed (same path, new length),
it calls `getPeaks(path, STRIP_BINS, { force: true })`. This catches
the recording-stop case: Python re-emits `playing_slot`, the store
entry rebuilds with the finalized length, and the strip swaps the
partial-recording peaks for the full ones.

Cosmetic: while in the partial state, the existing per-window
normalization handles the in-progress portion fine. ADR-360's
TrackClipView already caps gain at 20× and applies a 0.6-power curve
(2026-04-30) so quiet clips read tall — same code path as the
post-stop render.

## Consequences

**Positive**

- Track strip waveform appears during recording (partial bytes) and
  swaps to the finalized version when recording stops, with no manual
  refresh.
- Clip *deletion* on a non-playing track is also picked up — the
  same `has_clip` fanout that catches creation catches removal.
  Previously the strip kept painting peaks for a deleted clip until
  the next slot-index flip.
- Listener-driven, not poll-driven. No HTTP retry loop, no rAF
  watchdog, no bounded retry budget. Each `has_clip` LOM listener
  fires once per state change; the in-process fanout is
  deterministic.
- Single source of truth for `slot.has_clip`. Future consumers
  (ClipPropertiesComponent reacting to focused-clip deletion, etc.)
  register one callback instead of attaching their own listener and
  duplicating the structural-rebind path.
- Server probe is more permissive in the in-progress shape *only*.
  Genuinely-malformed headers (offset past EOF) still reject. Only
  the past-EOF size case clamps, which is benign — `streamingPcmPeaks`
  already short-circuits on EOF.

**Negative / risks**

- The clamping path could in principle render a few stale bins from a
  WAV header with a corrupt `dataSize` field. Path B previously
  refused such files; Path A will now stream the available bytes. In
  practice the streaming render is silent on the unfilled tail and
  the user sees a partial but coherent waveform, which is strictly
  better than blank.
- An exception inside one `has_clip` callback is caught and logged;
  later callbacks still fire. The wire emit is unaffected because it
  runs first.

**Tests**

- `tests/test_clips_component.py`: dispatch order (after wire emit),
  exception isolation between callbacks, `disconnect` clears the
  callback list.
- `tests/test_playhead_component.py`: fresh-recording materialization
  via `on_slot_has_clip_changed`; deletion on the rendered slot
  re-resolves display; deletion of a different slot is a no-op;
  creation on a stopped empty track promotes to display;
  malformed paths (non-track / out-of-range / garbage) are ignored;
  full record cycle (empty → record-start fanout → record-stop
  is_recording recheck) lands the populated `playing_slot`.
- `interface/src/__tests__/unit/server/sample-peaks/formatProbe.test.ts`:
  AIFF and WAV both clamp `dataSize` when chunk size runs past EOF.
- 1419 surface tests + 1022 UI unit tests pass; production build clean.

## Files

- `surface/components/ClipsComponent.py`
- `surface/components/PlayheadComponent.py`
- `surface/LoopingSurface.py`
- `surface/tests/test_clips_component.py`
- `surface/tests/test_playhead_component.py`
- `interface/src/routes/api/sample-peaks/formatProbe.ts`
- `interface/src/__tests__/unit/server/sample-peaks/formatProbe.test.ts`
- `interface/src/lib/services/clipWaveformService.ts`
- `interface/src/lib/components/v6/tracks/TrackStrip/components/TrackClipView.svelte`

## Tags

`waveform`, `recording`, `playhead-component`, `sample-peaks`,
`aiff`, `streaming`, `live-listener-races`, `playing-slot`, `adr-360`,
`adr-362`
