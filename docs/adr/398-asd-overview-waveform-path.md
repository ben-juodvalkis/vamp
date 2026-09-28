# ADR-398: `.asd` Overview as a Waveform Source for Undecodable Pack Samples

## Status
**Accepted**

## Context

The track-strip waveform (ADR-360, ADR-363) renders from
`/api/sample-peaks`, which decodes a sample and returns per-bin
`[min, max]` peaks. The route has two paths:

- **Path A** — streaming PCM peaks for uniform WAV/AIFF/AIFC
  (`formatProbe.ts` + `streamingPcmPeaks.ts`).
- **Path B** — full-decode via `audio-decode` for compressed formats
  (mp3/flac/ogg/m4a/opus), gated by a file-size cap.

Audio clips sourced from **Ableton's protected pack content** render a
blank waveform. These are AIFC files carrying a proprietary compression
tag `able` ("Ableton Content") — encrypted pack assets only Live can
read. Path A's probe rejects them (not uniform PCM → `parseAiff`
returns null on the unknown compression tag), and Path B's decoders all
fail: `audio-decode`, macOS CoreAudio (`afinfo`), and even `ffmpeg`
(`could not find COMM tag or invalid block_align value`) refuse the
codec. The result is a **415** that `clipWaveformService.getPeaks()`
degrades to `null` — a silently blank canvas, indistinguishable from a
bug (the reported symptom that opened this investigation: track 3's
audio clip showing no waveform).

There is no missing decoder that would fix this — the raw audio bytes
are genuinely unreadable outside Live.

However, every warped sample ships a `<sample>.asd` analysis sidecar
next to it, and that file already contains **Live's own precomputed
waveform overview** — the exact min/max envelope Live draws in its clip
view. No audio decode required.

## Decision

Add **Path C** to `/api/sample-peaks`, tried after Path A returns null
and **before** Path B's decode (so a `.asd`-backed sample renders
instead of 415ing):

1. Look for `<resolvedSamplePath>.asd` next to the sample.
2. Parse its highest-resolution overview level and extract the min/max
   pairs.
3. Resample to the requested `bins` (min-of-mins / max-of-maxes) and
   return the normal `PeakResponse`.
4. If no `.asd` exists or it has no valid level, fall through to Path B
   unchanged.

New module `asdOverview.ts` owns the parse + resample; the route change
is the Path C block plus one import.

### `.asd` overview format (reverse-engineered, verified)

No existing open-source `.asd` parser extracts the overview — they use
the `SampleOverViewLevel` string only as a landmark to skip to warp/BPM
data. The overview encoding was reverse-engineered here and verified
against the real `LL Loop 79 BPM.aif.asd` (Chop and Swing pack):

```
"SampleOverViewLevel"   19 ASCII bytes (marker; NOT a fixed offset)
uint32 LE  levelIndex   0 = highest resolution
uint32 LE  count        = 2 * bins (number of float16 values)
float16[count] LE       interleaved: min0, max0, min1, max1, ...
                        normalized to [-1, 1]
```

The marker also appears in the file's schema/type header (~6× total);
only 1–3 occurrences are real data levels. They are distinguished
**structurally**, not by index: a real level has `count > 0`, `count`
even, the block fits within the file, and every decoded value sits
within a small tolerance of `[-1, 1]` with `min <= max`. Schema hits
fail those guards. We locate blocks by scanning for the marker (the
absolute offset shifts between Live versions) and select the level with
the most bins.

Half-precision is decoded by hand (`halfToFloat`) — Node's `Buffer` has
no float16 reader and `DataView.getFloat16` is not baseline in the
target server runtime.

## Consequences

**Positive**
- Real waveforms for **every warped Ableton pack sample**, not just the
  reported clip — no decode, no dependency on Live having cached a
  decoded copy.
- The `.asd` overview is amplitude-only but far exceeds display needs
  (~2094 source bins → 256-bin strip), so it reads identical to a real
  decode.
- Zero behavior change for WAV/AIFF (Path A) and compressed audio
  (Path B): Path C only fires when the probe already returned null, and
  a missing `.asd` falls straight through.
- Verified end-to-end: the route returns 200 with a clean 256-bin
  envelope for the previously-415ing file, and the strip renders it.

**Negative / limitations**
- **No `firstTransientFrame`** from this path — the `.asd` overview
  carries no per-frame data, so Path C returns `0`. Auto-trim (ADR-354)
  degrades to its existing silent-skip for these clips, same as any
  undecodable file. `sampleRate`/`frames`/`channels` are also reported
  as `0` (unknown from the overview); the strip render uses only
  `peaks` and doesn't rely on them for `.asd`-sourced clips.
- The format is reverse-engineered and undocumented by Ableton. It has
  been stable across Live 10/12, but a future Live version could change
  the block layout. The structural guards fail safe (return null → fall
  through to Path B → 415 as before), and a real-fixture integration
  test guards against silent drift.
- Path C reads the whole `.asd` into memory. These are small (tens of
  KB), so this is bounded and cheap; no streaming needed.

## Tags
`waveform`, `sample-peaks`, `asd`, `ableton-pack`, `aifc`, `track-strip`,
`clip-view`
