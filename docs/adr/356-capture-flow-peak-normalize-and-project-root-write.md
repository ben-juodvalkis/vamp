# ADR-356: Capture Flow — Peak-Normalize to −1 dBFS, Write to Project Root

## Status
Accepted (2026-04-28)

## Amendment — 2026-08-29

**The clip-flow exemption below no longer describes the code.** Both handlers
now pass `normalize=True`: `SimplerLoadComponent.py:300` (clip flow) and `:420`
(capture flow), and the comment at `:520-521` states it outright. Every
statement in this ADR that the clip flow is not normalized — under *Sample-gain
normalization*, *Architecture*, and *Consequences → Negative* — is therefore
stale. Left in place as the record of what was decided; this note is what is
true.

The change matters beyond documentation: normalizing the clip flow routes
Live's own recordings (AIFC `fl32`) into `sample_normalize._peak_float_be`,
which is the float branch, not the fast integer one. See audit finding #8.

## Context

The capture flow (looping-recorder.amxd → `/looping/v3/simpler/replace_sample_onto_track`) had two problems exposed in the same session:

### 1. Captures landing on inconsistent levels
Recordings off the audio interface vary widely in peak level depending on the source signal and gain staging upstream. After the WAV was loaded into the Empty Simpler preset, the Simpler's `sample.gain` was left at its preset default (0.40 = 0 dBFS / unity). A quiet capture stayed quiet; a hot capture risked slamming the channel strip on the loop's first replay. There was no normalization step anywhere in the flow.

### 2. Recorder silently failing on a missing capture directory
The Max recorder (`capture-looping.js`) computed its capture directory as `<set_dir>/Samples/Recorded` from the LOM's `live_set.file_path`. When that subdirectory didn't exist (typical on a freshly-created project — Live only auto-creates `Samples/Recorded` on its own first sample write, not on save), `sfrecord~` opened the path, returned successfully from the `open` message, accepted the `1` (start) message, **and silently wrote nothing to disk**. The Python surface then received `/capture/file <path>` pointing at a nonexistent file, called `simpler.replace_sample(path)`, and got `ValueError: The provided path does not appear to point to a valid audio file`.

Max v8 JavaScript has no portable mkdir — `Folder` is read-only, `File` won't create parents, and shelling out requires a third-party external. That ruled out a Max-side fix.

A Python-side `os.makedirs` wrapper *would* have worked but was rejected because the recorder is intended to be shareable as a standalone .amxd. Requiring the Python Control Surface as a hard dependency for capture-to-disk would defeat that.

## Decision

### Capture path: write to project root with a recognizable filename prefix

`capture-looping.js` now writes to `<set_dir>/` directly, alongside the `.als`. The project root always exists (Live created it on save), so `sfrecord~ open` can never fail on a missing parent. Filenames are prefixed `LOOPING_CAPTURE_` so they're trivially distinguishable from Live's own auto-recordings, third-party samples that happen to live in the project folder, or any other detritus.

```
<set_dir>/LOOPING_CAPTURE_20260428_174435.wav
```

The unsaved-set fallback (`/Users/Shared/Music/Ableton/User Library/Captures/`) gets the same prefix for symmetry.

This *does* clutter the project root — after a long session there will be dozens of capture WAVs alongside the .als. The trade-off was deliberate: the prefix makes them easy to filter in Finder (`LOOPING_CAPTURE_*`), Live's "Collect All and Save" still bundles them since they're referenced by the set, and the alternative (a Max-side mkdir) wasn't possible without breaking shareability.

### Sample-gain normalization: peak-normalize captures to −1 dBFS

After `simpler.replace_sample(file_path)` succeeds in the **capture flow only** (`handle_replace_sample_onto_track`), the Python surface:

1. Reads the WAV peak using stdlib `wave` + a hand-rolled `array.array` decoder (replacement for `audioop.max`, which was removed in Python 3.13 — Live ships 3.11 where it still exists, but tests run on 3.13).
2. Computes peak in dBFS.
3. Computes the offset to hit −1 dBFS target.
4. Maps that offset to a `sample.gain` value via a calibrated lookup-and-formula curve (see below).
5. Writes `simpler.sample.gain = value`.

Silent or unreadable WAVs leave gain at its preset default and log a warning. The clip-flow path (`handle_replace_sample`, where the user converts an existing audio clip to Simpler) is **not** normalized — library samples are presumed deliberate.

### `sample.gain` curve calibration

Live 12.4's `OriginalSimpler.sample.gain` is a normalized 0..1 float that maps non-linearly to dB. Calibrated 2026-04-28 by sweeping values via `/looping/v3/property/set` on a live Simpler and reading the dB display:

| sample.gain | dB |
|---|---|
| 0.00 | −∞ |
| 0.05 | −39 |
| 0.10 | −31 |
| 0.15 | −23 |
| 0.20 | −16 |
| 0.25 | −11 |
| 0.30 | −6.2 |
| 0.35 | −2.6 |
| 0.40 | 0 (unity) |
| 0.45 | +2 |
| 0.50 | +4 |
| 0.75 | +14 |
| 0.90 | +20 |
| 1.00 | +24 |

**Above 0.40 the curve is linear**: `dB = 40·gain − 16`, i.e. `gain = (dB + 16) / 40`. Confirmed exact at 0.40, 0.45, 0.50, 0.75, 0.90, 1.00.

**Below 0.40 the curve is nonlinear** (cubic-ish toward −∞). Implemented as table interpolation across the calibration points.

**Clamps:** boost capped at +24 dB (gain = 1.0), cut floored at −39 dB (gain = 0.05). A capture asking for more cut than that almost certainly clipped at the input — pulling the gain knob lower won't fix that.

### Architecture: keep it in `SimplerLoadComponent`

The normalization helper (`components/sample_normalize.py`) is pure — no Live API touches, fully unit-tested with synthetic WAVs. `SimplerLoadComponent._load_simpler_onto_track` gained a `normalize: bool = False` parameter; only `handle_replace_sample_onto_track` passes `normalize=True`. The clip-flow handler stays at the default.

## Consequences

### Positive
- Captures land at consistent, predictable levels across varying input gain. Hot signals get pulled back, quiet ones get boosted, both targeting −1 dBFS peak.
- Capture-to-disk works on freshly-saved projects without the user having to manually create `Samples/Recorded/`. The "ValueError: not a valid audio file" failure mode is structurally impossible now.
- The recorder remains a portable .amxd — no Python dependency for the recording leg. (It still needs the Python surface for the *load-into-Simpler* leg, but that's been true since the v3 migration.)
- Prefix makes captures easy to find, filter, or sweep out of the project folder later.

### Negative
- **Project root clutter.** Long sessions produce many `LOOPING_CAPTURE_*.wav` files alongside the .als. Mitigated by the recognizable prefix. Users who want them organized can move them post-session.
- **Curve is calibrated, not derived.** If Live changes `sample.gain`'s mapping in a future release, the table goes stale. The `test_curve_*` tests in `tests/test_sample_normalize.py` will be the first thing to fail, which makes the breakage easy to spot. The fix is a re-run of `owner/probes/sample_gain_curve_probe.js`.
- **No LUFS / loudness normalization** — peak only. Two captures that both peak at −1 dBFS but have different RMS will sound very different. A dynamic single-shot will be quieter on average than a sustained pad. Acceptable for a live looping context where the loop is going to interact with other tracks anyway.
- **`audioop` removal.** Python 3.13 dropped `audioop`. The hand-rolled `_max_abs_sample` in `sample_normalize.py` covers 8/16/24/32-bit signed PCM. If looping-recorder ever switches to a format outside that set (24-bit float? unlikely for `sfrecord~`), the helper returns 0 → silent → no normalization, which is safe.
- The clip-flow path is not normalized, so converting a quiet library sample to Simpler will not auto-boost it. Considered out of scope for this ADR — library samples are presumed deliberate; auto-normalizing them would be surprising.

## Implementation pointers

- **Recorder path change:** `Vamp Devices/looping-recorder/capture-looping.js` — `refreshProjectPath()` and `CAPTURE_FILENAME_PREFIX`.
- **Normalize helpers:** `surface/components/sample_normalize.py`. Pure, no Live imports.
- **Wire-up:** `surface/components/SimplerLoadComponent.py` — `_load_simpler_onto_track(..., normalize=True)` and `_apply_peak_normalization`.
- **Tests:** `surface/tests/test_sample_normalize.py` (25 cases covering curve and WAV peak).
- **Calibration probe:** `owner/probes/sample_gain_curve_probe.js` — re-run if Live's gain curve changes.

## Tags
`capture`, `simpler`, `normalize`, `sample.gain`, `m4l-recorder`, `python-surface`, `live-12.4`
