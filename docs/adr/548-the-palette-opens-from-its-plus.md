# ADR-548: The Palette Opens From Its +

## Status
**Accepted** (2026-11-18). Amends ADR-535 (the palette is no longer
always two rows; the section is in sixths, not thirds) and ADR-523 (the
bar's + no longer opens the browser). Interface only; no Live restart.

## Context
The bar's + opened the full-page browser on the effects Place. Ben asked
what it would look like for the + to grow the palette in place instead.
Mocked first with a full-section takeover: the + menu (his +Effect
folder) holds 34 devices, 22 of them already chips and Utility the Gain
chip, so only 11 were left and a takeover was mostly empty. He chose one
extra row, and the bar at one row until the + opens it.

## Decision
- **Closed, the palette is its first row** of chips, the + and the Gain
  chip side by side at its end (each three quarters of a chip wide), and
  the chain has the rest of the section.
- **The + opens the bar**: the second row as before, and a **third row**,
  the rest of the + menu (`paletteExtras`): Chord, Velocity, Chance,
  Rand Oct, Wah, Tone Shaper, Comp, Gate, Drive, Ring Mod, Phaser. The
  families hold one to four of these each, so the row is not under the
  family columns: it runs along the chip columns in family order, each
  chip in its own family's wash. The MIDI ones go on an audio track. An
  effect not on this Mac keeps an empty slot. Ring Mod has no device
  type and loads as its file in the effects folder. MidiWheels is left
  out: it is the on-screen wheels, not an effect.
- **Open, the + is an x** that closes it, and an **All effects** tile under
  it opens the browser on the effects Place, as the + did. The bar stays
  open across picks and track changes until the x.
- **The section is six equal rows**, a row of chips each, on the rail's
  row gap: closed the bar is the first and the chain the other five;
  open, the bar the first three and the chain the last three. A row of
  chips is the height it was (half the rail's Record tile).
- **The phone** keeps a fixed bar: 44px closed, three rows (140px) open.

## Consequences
- The chain is taller by default (five sixths of the section against two
  thirds) and shorter while the bar is open (half).
- Closed, the bar's bottom edge no longer meets the rail's seam; open, it
  ends on the seam under the rail's second tile.
- The second row is a tap away rather than always there.
- A device added to the +Effect folder does not become a chip by itself;
  the row is a list in `services/effectPalette`.
