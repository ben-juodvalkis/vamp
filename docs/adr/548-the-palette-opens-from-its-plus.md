# ADR-548: The Palette Opens Under the Finger

## Status
**Accepted** (2026-11-18). Amends ADR-535 (the palette is no longer
always two rows; the section is in sixths, not thirds) and ADR-523 (the
bar has no + and no way to the browser). Interface only; no Live restart.

## Context
The bar's + opened the full-page browser on the effects Place. Ben asked
what it would look like for the + to grow the palette in place instead.
A full-section takeover was mocked first: the + menu (his +Effect
folder) holds 34 devices, most of them already chips, so a takeover was
mostly empty. The same day went through a + that opened the bar to three
rows, then a lit downward chevron, an All effects tile, and a hold
gesture; Ben then laid the chips out himself in a planner page (a grid
he dragged them around on) and asked for the chevron to go.

## Decision
- **The bar is one row**: the first row of chips and a downward chevron
  at its end, every chip one width, and the chain has the rest of the
  section. **The chevron opens the bar** to three rows and closes it, lit
  while open; a latched bar stays open across picks and tracks. (The
  same day it went, then came back on Ben's word, with the Gain chip's
  place; the Gain chip, a Utility's Gain lying flat, became an ordinary
  chip named Utility under it.)
- **A finger on a chip opens it to three rows** for as long as it is
  down: after a 120ms hold, or at once when the finger slides. The chip
  under the finger lights; letting go on a chip loads that one, letting
  go off the chips loads nothing, and the bar closes. A quick tap loads
  the chip it lands on and never opens the bar. One gesture on the whole
  bar (`use:drag`), so the chips take no press of their own and a finger
  crosses them. 300ms felt laggy (page timers run late on the iPad).
- **The chips are one grid with no gaps**, a hairline between them and no
  seam between families: a sliding finger never falls between two chips,
  and the family washes divide the blocks.
- **Ben's layout** (`services/effectPalette`): one column per family, two
  for Distortion, three rows deep, top to bottom:
  Random, Arp, Wheels · Filter, EQ, Tone Shaper · Glue, Multiband, Gate ·
  Drum Buss, Roar, Saturator · Pedal, Redux, Shifter · Guitar, Bass, Wah ·
  Trem, Chorus, Blur · Stutter, Glitch, Pitch Hack · Echo, Reverb, Comb;
  Utility and Pitch Shift under the chevron. Blur wears the modulation
  wash, as the column it sits in. Off the bar (the browser only): Chord,
  Velocity, Chance, Rand Oct, Compressor, Phaser. Shifter is Live's own, loaded by
  name (it stood in for the folder's Ring Mod preset); Wheels has no type
  and loads as its file in the effects folder. Multiband's label carries a
  soft hyphen, so on a narrow chip it breaks as Multi-band.
- **The bar has no way to the browser.** The browser rail and a rack
  chain's own + still open it on Effect.
- **The section is six equal rows**, a row of chips each, on the rail's
  row gap: the bar is the first and the chain the other five; held open,
  the bar the first three and the chain the last three. The phone keeps
  a fixed bar: 44px, 140px held open.
- The MIDI column goes on an audio track; an effect not on this Mac keeps
  an empty slot.

## Consequences
- The chain is taller by default (five sixths of the section against two
  thirds) and shorter while a finger holds the bar open.
- The bar's bottom edge no longer meets the rail's seam.
- Nothing opens the full browser from the bar; a device not on it is
  added from the browser rail.
- A device added to the +Effect folder does not become a chip by itself.
- `npm run multitouch -- --only palette` drives the gesture: a hold
  slides to a third-row chip and loads it, a hold let go in place loads
  that chip, a quick tap loads without opening, and a release over the
  chain loads nothing.
