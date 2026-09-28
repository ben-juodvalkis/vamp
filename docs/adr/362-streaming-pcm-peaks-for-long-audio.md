# ADR-362: Streaming PCM peaks for long audio (Path A / Path B split)

## Status
**Accepted** (2026-04-30)

## Context

`/api/sample-peaks` returns `[min, max]` per-bin peaks for the strip
waveform render and the auto-trim transient marker. The original
implementation (ADR-354 fed it transient detection; ADR-360 unified
fetch via `clipWaveformService`) read the full file with `readFile`,
fully decoded every frame via `audio-decode`, then ran a single linear
pass to pick peaks. A 75 MB file-size cap (`paths.waveformMaxBytes`,
78 643 200 B) returned `413 Payload Too Large` for anything larger,
because decoded `Float32Array` channel data scales ~6× the on-disk
size and the route shares a Mac with Live.

PR #405 validation surfaced a long jazz drum loop
(`Jazz Drum Loop (brushes)  Slow Swing Ballad  60 BPM.wav`,
99 840 080 B / 95.2 MB) that tripped the cap and silently rendered no
waveform — `getPeaks` resolved to `null`, `TrackClipView` painted the
lane background with a moving playhead but no envelope. The user-
visible failure was a blank lane that *looked* broken.

The structural problem with raising the cap was that the implementation
had the wrong cost shape: rendering 256 bins from a 1 GB WAV would read
1 GB, decode to ~6 GB of Float32, and discard 99.999% of it. CPU and
memory both scaled with file size rather than with the 256 bins
actually returned. The cap existed because that's not viable; lifting
it without a structural change would just push the OOM elsewhere.

For uniform PCM (WAV / AIFF / AIFC — the formats that produce the long
files, since compressed sources are typically short), the data on disk
is already a flat array of fixed-width frames after the header. We can
read only the bytes we need.

## Decision

Split the route into two paths behind one decision (the format probe)
and keep the same `PeakResponse` shape, the same cache key, and the
same client API.

### Path A — streaming PCM (WAV / AIFF / AIFC), no size cap

`probeFormat(fd, sizeBytes)` reads ≤ 4 KB from the head and returns a
`FormatInfo` describing a uniform-PCM container, or `null` for
anything else. `null` means "fall through to Path B."

Format coverage:

- **WAV / RIFF**: 8-bit unsigned int, 16/24/32-bit signed int, 32-bit
  float. **`WAVE_FORMAT_EXTENSIBLE` (0xFFFE)** is honored — the probe
  reads the sub-format GUID's first 2 bytes (which mirror the standard
  format codes, `0x0001` PCM / `0x0003` IEEE float). Common in
  multichannel and some 24-bit WAVs; missing it would silently fall
  through to Path B and re-trip the cap.
- **AIFF**: 8/16/24/32-bit big-endian PCM via `COMM` + `SSND`. Sample
  rate is read from the 80-bit IEEE extended-precision float (Apple
  SANE format). The `SSND` data does **not** start at the chunk body —
  there are 8 bytes of `(offset, blockSize)` then `offset` more bytes
  of pad. Most common AIFF parser bug; explicitly tested.
- **AIFC**: `NONE` (uncompressed BE PCM), `sowt` (uncompressed LE
  PCM), `fl32` (uncompressed BE float). `alaw`/`ulaw` and other
  non-uniform compressions punt to Path B.
- **RF64 / Wave64 / overflowed-uint32 sizes**: probe returns `null`
  (we'd need `ds64` parsing to handle them safely; defer).

`streamPcmPeaks(fd, info, bins, transientWindowFrames)` reads the data
chunk in 1 MB windows, maintains `2 * bins` floats of running min/max,
and copies the first ~200 ms of decoded float frames per channel into
small buffers handed to `findFirstTransient`. Bin assignment uses
`binEnd[i] = floor((i + 1) * fpb)` walked alongside the streaming
frame counter — this matches `reduceToPeaks`'s slice-based semantics
exactly. (The naive `floor(frameIdx / fpb)` diverges at non-integer-fpb
boundaries; the parity test catches it.)

Memory is bounded by `READ_BUFFER_BYTES` (1 MB) + transient window +
`2 * bins` floats, regardless of file size. Frame straddling across
the 1 MB boundary (especially 24-bit at odd alignments) is handled by
carrying up to `frameSize - 1` bytes of tail between reads.

### Path B — full-decode (compressed: mp3/flac/ogg/m4a/opus)

Unchanged behavior. `paths.waveformMaxBytes` (75 MB) becomes Path-B-
only. **The cap stays at 75 MB** — `audio-decode` still materializes
full PCM in memory (~10× on-disk for compressed), and Live shares this
Mac. Streaming-decode (e.g. `prism-media` for mp3/ogg, `flac.js` for
flac) is a follow-up; once it lands, the Path B cap can lift to match.

### Probe-before-cap

The route runs `probeFormat` **before** the size-cap check. If the
probe returns `FormatInfo`, the request takes Path A regardless of file
size. If it returns `null`, the cap applies and large compressed files
still 413. The original early-exit at `+server.ts:170-172` was moved
past the probe — leaving it in place would have left Path A 413ing on
the long WAVs that motivated this work.

### Feature flag

`paths.waveformStreamingEnabled` (boolean, defaults true). Setting to
`false` short-circuits the probe entirely and routes everything through
Path B (legacy behavior). Roll back without code change. Removed once
Path A has soaked for a week.

### Path-B fallback on streaming failure

If the probe accepts a file but `streamPcmPeaks` itself blows up
(malformed past the header, IO error mid-stream), the route logs a
`peaks-streaming-fallback` warn and falls through to Path B. Worst
case the file is genuinely broken and Path B 415s — same end-user
outcome as before. Better than 500ing on a recoverable parse error.

## Consequences

### Positive

- **The 75 MB cap no longer blocks long PCM.** A 95 MB WAV that
  previously 413'd now serves in 166 ms with 9.4 MB peak heap (smoke
  test, 256 bins, 12.48M frames at 44.1 kHz / 16-bit stereo). The
  blank-lane failure is fixed.
- **Cost decoupled from file size for the common case.** A
  hypothetical 1 GB WAV would process in ~2-3 sec sequential disk
  read with the same constant memory; the previous path would have
  needed ~6 GB of `Float32Array` to do the same work.
- **`PeakResponse` shape unchanged**, cache key unchanged, callers
  unchanged. `clipWaveformService`, `TrackClipView`, `SimplerLoopControl`,
  and `clipOperations.fetchTransientFrame` all see identical responses.
- **Cache memory unchanged** — entries are still
  ~`bins * 16` bytes regardless of source file size. The 32-entry LRU
  is unaffected.
- **Observability**: `logger.debug('peaks-streaming', { path, ... })`
  on every served request, useful for the periodic Bridge Performance
  log when judging whether to invest in Path B streaming.
- **Rollback in one config flip**, no redeploy.

### Negative

- **Two code paths to maintain** until the flag retires. Mitigated by
  the parity test pinning Path A's bin assignment to `reduceToPeaks`'s
  exact semantics — refactoring either path can't drift the response
  shape without test failure.
- **WAV/AIFF parsing surface area** the route didn't have before. The
  formats are well-specified but have real edge cases (24-bit
  sign-extension, `WAVE_FORMAT_EXTENSIBLE` GUID, AIFF SSND offset,
  non-zero leading pad, frame-straddling read boundaries). 32 unit
  tests cover each.
- **RF64 / Wave64 punted.** Real-world Ableton libraries occasionally
  have RF64 stems for >4 GB files; for now they fall through to Path B
  and 413. Follow-up if it becomes a problem.
- **Compressed audio still capped at 75 MB.** A 100 MB stem in mp3
  still 413s. The proper fix is streaming decode for Path B; tracked
  as a follow-up.

## Validation

- 1021 / 1021 unit tests pass (was 989 pre-change; +32 new — 20 in
  `formatProbe.test.ts`, 12 in `streamingPcmPeaks.test.ts`).
- `npm run build` clean.
- `npm run validate:constants` clean (schema updated for the new flag).
- **Smoke on the failing PR-#405 sample** (`Jazz Drum Loop (brushes)
  Slow Swing Ballad  60 BPM.wav`, 99.84 MB, 16-bit stereo, 4:20
  duration): probe 0.6 ms, stream 166 ms, 256 bins emitted,
  `firstTransientFrame=634` (matches the lead-in brush hit), peak heap
  9.4 MB. Strip renders the envelope; user-validated in the actual UI.
- Cache hit on second request returns from the LRU without re-reading
  the file (verified via the existing `${realpath}:${mtimeMs}:${bins}`
  key — works identically for Path A).

## Files

New:

- `interface/src/routes/api/sample-peaks/formatProbe.ts`
- `interface/src/routes/api/sample-peaks/streamingPcmPeaks.ts`
- `interface/src/__tests__/unit/server/sample-peaks/fixtures.ts`
- `interface/src/__tests__/unit/server/sample-peaks/formatProbe.test.ts`
- `interface/src/__tests__/unit/server/sample-peaks/streamingPcmPeaks.test.ts`

Modified:

- `interface/src/routes/api/sample-peaks/+server.ts` — Path A wired in
  before the cap check; Path B unchanged for compressed.
- `config/constants.json` — new `paths.waveformStreamingEnabled`.
- `config/constants.schema.json` — schema for the new flag; updated
  description on `waveformMaxBytes` to clarify it's Path-B-only.
- `interface/src/lib/services/CLAUDE.md` — note that the route runs
  Path A or Path B.

## Follow-ups

- After ~1 week of clean Path A usage, remove the
  `paths.waveformStreamingEnabled` flag and the dead Path-B-fallback
  branch for PCM. (Suggest scheduling an agent to open the cleanup PR.)
- Streaming decode for Path B (e.g. `prism-media` for mp3/ogg,
  `flac.js` for flac) — would let the Path B cap lift safely. Only
  worth investing in once Path A is in production and we observe a
  real Path B latency / cap complaint.
- Consider RF64 / Wave64 support if long-stem libraries with >4 GB
  files start showing up in actual usage.

## Tags
`performance`, `sample-peaks`, `waveform`, `streaming`, `pcm`, `wav`,
`aiff`, `adr-354-followup`, `adr-360-followup`
