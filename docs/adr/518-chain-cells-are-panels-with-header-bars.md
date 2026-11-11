# ADR-518: A chain cell is a panel with a header bar

## Status
**Accepted** (2026-11-08). Builds on ADR-485 (the FX section is the
chain), ADR-492 (faces pick their layout by cell size), ADR-506 (the ghost
Utility) and ADR-516 (a board's tiles are panels with header bars), whose
grammar it carries into the chain. Interface only; no Live restart. Amended by [ADR-523](523-a-fixed-effect-palette-over-the-chain.md): a tap on the bar is Device On; no power button, the name centered.

## Context

Ben asked for a deep UI pass over the effect chain in the top third of the
screen, "something a super talented and experienced UI/UX designer would
make". A screenshot pass over the chain's states (one row, two rows, a
bypassed device, a rack, a plug-in, a scoped pad, a crowded Recent
section) found the same faults as the boards had before ADR-516:

- **No module, only wells.** A cell was a dark well (`--surface-well`) in
  a near-black hairline on a near-black page, and its face was another
  well with another hairline inside it: a box in a box of one colour, so
  the chain read as one dark field with names floating in it.
- **No bar, so no handle and no state.** The name sat loose in the cell's
  top band with a lone grey power glyph at its end, in the same muted ink
  whether the device ran or not; bypass was a dimmed face and a slightly
  dimmer glyph. The band is the handle the cell is dragged by (the user,
  2026-10-26), and nothing said so.
- **Names without their kind.** A device is named for its preset ("Wobble",
  "Dub Space", "Grit", "Supermassive"), and a one-row chain's 56px band
  held the name and 30px of air under it.
- **The blue hand in the family's ink.** The appointed device wore its own
  ink as a frame and a wash, which a strongly inked face (Permute's steps,
  a filled slider) swallowed; the selected strip wears Live's selection
  blue.
- **Three ghost dialects.** The recents and + Effect were dashed boxes in
  `--line-strong`, the ghost Utility a solid-framed grey slab beside them,
  and the recents' names sat at 50% of the muted ink, under 2.5:1 on the
  page.
- **Marks in a void.** A plug-in's plug, a Max device's box and the Tone
  Shaper's glyph were 30–44px in a cell of 200 × 260.

## Decision

- **A cell is a panel** (`ChainOverview`'s `.chain-cell`): the strips' own
  surface (`--card`) on the page, a `--line` hairline, 6px corners as the
  boards' tiles have, its face inset 6px (4px on two rows) so the face's
  own frame reads as a field sunk into it. Inside a tile the tile's frame,
  in the device's ink, is the field's one frame; the XY's or slider's own
  hairline inside it is dropped.
- **Every cell has a header bar** (`.cell-head`): the name in its ink over
  a 10% wash of it, a hairline under it, at the height of a strip's name
  band (half that on two rows), still the handle. The chain's instrument
  wears an 18% wash of the track's colour, a shade deeper, the way the
  strip's name block wears it, so the chain reads as that strip's; under
  a pad scope the pad's instrument wears the pad's.
- **Device On is the bar's switch**, at its right as every section's switch
  sits on its bar (ADR-516): a `.physical-button` the bar's height less a
  step, 2.75rem wide (2.125rem in a narrow cell), the power glyph alone
  (the word "On" would not fit a narrow cell or a half band, and the lamp
  a `.btn-toggle` draws crossed the word), **lit in the device's ink while
  it runs** and framed in it while bypassed. Bypassed, the bar loses its
  wash, the name goes to the muted ink and the face ghosts, as a board's
  tile ghosts its body when its section is off.
- **A caption says what the device is** (`chain/deviceTypeLabel.ts`): Live's
  word for its class ("Auto Filter", "Hybrid Reverb", "Audio Effect Rack",
  "Audio Unit", "Max for Live") in the tertiary ink under the name, only on
  a one-row chain's full band, and only where the name does not already
  say it ("Auto Filter", "Echo", "Drum-Rack", "Auto Pan Legacy" draw
  none). A class the table does not know draws none.
- **The blue hand is the selection blue**: the appointed cell's frame is
  `--flat-selection`, 2px (the hairline plus an inset ring), the ink the
  selected strip wears, so one colour means Live's selection across the
  screen. No wash.
- **One ghost dialect.** The recents, + Effect and the ghost Utility are
  the same shape: no fill, a dashed line in the tertiary ink at 45% (70%
  for + Effect, the one that always does something), 4px corners. A
  recent's name is the tertiary ink at full strength, its picture at 60%.
  The ghost section's gap is 6px.
- **A lone mark is drawn to its cell**: the plug, the box, the glyphs scale
  with the cell (`cqmin`), 28–96px.

## Consequences

- A cell's face is 4px narrower each side than before (the inset was 4px
  with a 2px bleed); ADR-492's width steps are unchanged, and the faces
  audit's cells stay in the same steps on the iPad.
- `.power` keeps its class and `.on` for the shot steps and tests; the
  cell's `.cell-head .name` selector is unchanged.
- `deviceTypeLabel` is a table of Live's class names; a new device class
  gets its word there or draws no caption.
- The chain tour's states are unchanged; `chain-pad-add` was failing before
  this change (a browser tile the mock does not list) and still is.

## Tags
`fx-chain`, `chain-overview`, `ui-design`, `layout`
