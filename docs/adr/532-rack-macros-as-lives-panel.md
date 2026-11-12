# ADR-532: A rack's macros laid out as Live's macro panel

## Status
**Accepted** (2026-11-12). Interface only. Supersedes ADR-530's "how many
fit" rule (the first macros in Live's order, as many as fit) and changes
the Audio Effect and Instrument Rack views' macro grids. Moves ADR-531's
variations from under the macros to the left of them.

## Context

ADR-530 drew a rack's named macros in its chain cell in Live's order,
wrapping into as many rows as the cell held, and the central views laid
them out by their own rules (a knob grid sized for the count; two rows
filled column by column on the Instrument Rack). None of them looked like
Live's macro panel, so a macro was never where Ben's eye expected it from
Ableton. He asked for two rows, as in Live, in the chain and in the
central view, and for the variations down the left.

## Decision

- **One layout rule, Live's** (`liveMacroSlots`): two rows, numbered row
  by row, as many columns as half the rack's visible macros (eight are
  1–4 over 5–8, sixteen 1–8 over 9–16, one a single cell). Every visible
  macro stands in its place; one Live still names "Macro N" is drawn dim
  (opacity 0.35), as Live greys an unmapped macro, and stays playable.
  The chain cell, the Audio Effect Rack view and the Instrument Rack view
  all use it (`chain/RackFace`, `central/RackMacroPanel`).
- **The chain cell shows a window of the panel** (`rackMacroWindow`): its
  left columns, as many as fit at 48px, of both rows, so each macro shown
  is where Live has it. A cell too short for two rows at full size
  (48 x 68px, a 36px knob over one line of name) draws compact knobs
  (48 x 42px, a smaller knob and a 10px name), so a two-row chain's cells
  keep both rows; only a cell too short even for those shows the top row
  alone. The "+N" in the corner counts the named macros outside the
  window.
- **The Instrument Rack view keeps its XY pads** where a rack pairs macros
  by the "XY " name prefix; any other rack draws Live's panel there.
- **The variations are a column down the left** of both rack views: the
  variation buttons top to bottom. Store and Rand were dropped from the view
  the same day (Ben); the surface keeps `variation.store` and
  `variation.randomize`, unused.

## Consequences

- A rack with few named macros shows its unused ones dimmed, as Live
  does, rather than closing the gaps.
- A narrow cell shows Live's left columns, not the first macros in
  order: on a 12-macro rack a two-column cell shows 1–2 over 7–8.

## Tags
`racks`, `macros`, `chain-overview`, `central-view`
