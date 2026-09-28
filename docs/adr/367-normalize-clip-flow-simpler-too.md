# ADR-367: Normalize the Clip-Flow Simpler Conversion Too

## Status
**Accepted** (2026-05-03)

Supersedes the clip-flow carve-out in [ADR-356](./356-capture-flow-peak-normalize-and-project-root-write.md).

## Context

ADR-356 added peak-normalization to −1 dBFS for the **capture flow** (`/looping/v3/simpler/replace_sample_onto_track`) but explicitly **skipped** the **clip flow** (`/looping/v3/simpler/replace_sample`, the "Simpler" button in `ClipCentralView`). The reasoning at the time:

> Library samples are presumed deliberate; auto-normalizing them would be surprising.

In practice, the audio clips users hit "Simpler" on are not curated library samples — they're the user's own session recordings (loop captures, takes from `[sfrecord~]`-style clip recording, audio clips dragged in from earlier sessions). The amplitude profile is the same as the capture flow: unpredictable, often quiet, occasionally hot. The "library sample dragged onto an audio clip then converted" path is rare and goes through the browser, not the clip-flow Simpler button.

Result: the clip-flow Simpler conversion left users with quiet, unusable Simplers that needed manual `sample.gain` adjustment, while the capture flow Just Worked.

## Decision

`SimplerLoadComponent.handle_replace_sample` now passes `normalize=True` to `_load_simpler_onto_track`. Both flows peak-normalize to −1 dBFS via the same `_apply_peak_normalization` helper.

The `normalize: bool = False` parameter on the helper is preserved as a seam — silent / unreadable WAVs still skip cleanly, and a future caller (e.g. a "load preset preserving original gain" flow) could opt out.

## Consequences

- One-line behavior change in the clip-flow handler. No new code paths, no new tests — `test_sample_normalize.py` and the existing helper unit tests already cover the normalization logic exhaustively.
- Users who had compensated for the old clip-flow quietness with manual `sample.gain` adjustments will see those Simplers at expected loudness on next conversion. Existing Simplers in saved sets are unaffected.
- The "library sample → audio clip → Simpler" edge case (rare) now auto-boosts. Acceptable: the user can dial `sample.gain` back manually, and the discoverability of the GAIN slider in `SimplerCentralView` is high.

## Implementation pointers

- **Wire-up:** [SimplerLoadComponent.py](../../surface/components/SimplerLoadComponent.py) — `handle_replace_sample` call site (search for `normalize=True`); helper docstring updated to drop the capture-only language.
- **Helper unchanged:** `_apply_peak_normalization` and `sample_normalize.py` are reused as-is.

## Tags
`simpler`, `normalize`, `sample.gain`, `clip-flow`, `python-surface`, `supersedes-356`
