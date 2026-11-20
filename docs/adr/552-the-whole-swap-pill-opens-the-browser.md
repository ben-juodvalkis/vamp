# ADR-552: The whole swap pill opens the browser

## Status
**Accepted** (2026-11-20). Supersedes ADR-442's split pill (the name a door
between two step halves) and drops ADR-439/440's step arrows from the pill.
The stepping services (`presetSwap`, `similarSwap`, `clipSimilarSwap`) stay.

## Context

The swap pill in every instrument view and the audio clip view was the
loaded name between a back and a forward arrow: a press on either half
stepped to the neighboring preset, similar sample or clip file, and only a
press on the name itself opened the browser. Ben's call: the arrows go, and
touching the pill anywhere opens the browser.

## Decision

`SwapControl` draws no arrows and no halves. Given an `open`, the whole pill
is one button (`data-swap="open"`) that opens the browser on a tap, live
while the pill is disabled or working, exactly as the name was. Without an
`open` the pill is a plain label. Its shape, place and orientations
(upright column, or flat via `HostedSwapPill`) are unchanged.

## Consequences

- Nothing in the UI steps presets, a held Drum Sampler pad's similar
  samples, or an audio clip's similar files any more. The services and the
  `SwapPill.act` hook remain, unbound from the pill, should a step come back
  on another control (a pedal, a gesture).
- A flat pill too narrow for its name (a one-column kit) now ellipsizes the
  name instead of hiding it, since there are no arrows to keep clear.
- A pill with no `open` (no track or slot to open onto) does nothing.

## Tags
swap-pill, browser, central-view
