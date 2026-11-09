# ADR-522: Device Views Are Multitouch

## Status
**Accepted** (2026-11-09). Supersedes ADR-427's tier 4 ("Central views
and the browser … deliberately not done") for the central views and the
chain's device cells. The browser, Settings and pairing stay as they were.
Interface only; no Live restart.

## Context
ADR-427 left the device views on `onclick`, reasoning that nobody edits
two device parameters with two hands. Ben did, on the iPad: sliding the
Arpeggiator's Rate knob with one finger and tapping Steps with another,
the Steps tap did nothing. iOS synthesizes no `click` for a tap while
another finger is on the glass, so every switch, tab and chooser in a
device view was dead whenever a knob or pad was in use. "We need this app
to be multitouch."

## Decision
- **Every button under `components/v6/central/` and
  `components/v6/device-panel/` answers `use:press`**, ADR-427's
  primitive, in place of `onclick`: fires on release, owned by its own
  pointer, Enter/Space kept. A button that was `disabled` passes the same
  condition as the press's `disabled`.
- **`ScrubTabs`** already owns its finger through the frame's `use:drag`;
  its options' click handler, which only duplicated that, became a
  keydown handler for Enter/Space.
- **The touch gate covers both directories** (`check-touch-dialects.mjs`'s
  `PERFORMANCE_SURFACE`), so a new `onclick` there fails the push.
- The knobs and sliders (`DeviceSlider`) already tracked their pointer by
  capture and needed nothing.

## Consequences
- A tap in a device view lands while another finger holds a knob, a pad
  or a fader anywhere on the screen.
- Tests tap a device view's buttons with `helpers/pressTap.ts`
  (pointerdown + pointerup) and pick a `ScrubTabs` option with
  `scrubPick` (Enter), since jsdom has no layout for the drag to read.
  `MidiEffectCentralViews.test.ts` holds the reported case: Rate turning
  under one pointer, Steps tapped by a second.
- The iPad half is unmeasured by any harness here: Chromium's synthetic
  touches do not reproduce iOS's click suppression. Manual test checklist
  §13 is where it is checked.
