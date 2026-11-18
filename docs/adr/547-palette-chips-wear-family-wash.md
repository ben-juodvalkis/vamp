# ADR-547: Palette chips wear a faint family wash

## Status
**Accepted** (2026-11-18). Interface only; no Live restart.

Amends [ADR-544](544-ink-one-visual-system.md)'s consequence "The palette's
effect names carry no colour: a chip is found by its place and its name."

## Context

Ben, looking at the chain's palette bar (ADR-523): all twenty-two chips were
the same grey outline, so the family blocks did not read as blocks. He asked
for faint colour to help tell them apart.

## Decision

- Each palette chip wears its **block's family colour** (the
  `DEVICE_FAMILY_INKS` table): an 11% wash for its fill and a 38% mix into
  its hairline. The name stays plain ink. A press deepens the wash.
- The colour comes from the palette block, mapped to a family in
  `ChainOverview` (`BLOCK_FAMILY`), and from the raw table, not a preset's
  scheme: since ADR-544 a scheme's `primary` answers with the selected
  track's ink, which painted every chip the track's colour.
- Only the chips. Devices on the chain, views and tiles keep ADR-544: their
  amounts are the track's ink.

## Consequences

- The bar reads as eight coloured blocks; a chip is found by its block's
  colour as well as its place and name.
- These are the only family colours left on screen. A family hue never
  marks "on" here: a chip is an action, not a state.
