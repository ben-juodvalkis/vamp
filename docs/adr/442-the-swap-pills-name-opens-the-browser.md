# ADR-442: The swap pill's name opens the browser

## Status
**Accepted** (extends ADR-439/440, moves the gesture ADR-390/441 built)

## Context

Two controls changed the instrument, in two different places.

The **swap pill** (ADR-439) lives in every instrument central view — the loaded
name between two arrows, stepping to the neighbor: Live's similar sounds on a
Drum Rack, the next preset in the catalog folder everywhere else. The clip
view carries the same pill for an audio clip (ADR-440).

**Replace Inst** lived in `ClipCentralView`'s button rail, column 9: an 800 ms
hold that opened the browser pinned to the track. Beside it, on an audio track,
**Replace clip** did the same for the focused clip's slot.

Those are the same job at two settings — step to the next one, or go and pick
one — and they sat in different sections of the screen, in different idioms.
The rail is also where the hold belonged least: everything else in column 9
acts on the *track* and is genuinely destructive or expensive (Dup Trk), while
opening a browser is neither. The hold was there because the rail is a dense
grid of clip controls where a stray tap is disruptive — a gate against its
neighbors, not against its own consequence.

ADR-441 had just made that browser open land on the track's own patch, which
sharpened the point: the browser now opens *on* what the pill is showing.

## Decision

**A tap on the pill's name opens the browser**, a tap either side of the name
steps, and Replace Inst / Replace clip leave the rail.

**1. The name is the door.** `SwapControl` takes an optional `onOpen`; given
one, the name is drawn as a button over the two halves instead of a label that
lets presses through to them. Its box is exactly the text's length and the
pill's full thickness, centered, so the pill reads the way it looks: on the
name opens, off the name steps — left/down back, right/up onward. One rule
covers both orientations, measured in Chromium on the column (2026-09-16): a
press 3px beyond either end of the name lands on that half, and a press on the
name, its edge across the column included, lands on the door.

**2. Each step keeps a touch target.** The name never runs closer than
`--height-touch` (44px) to either end of the pill; a longer name ellipsizes.
So however long the preset name, both steps stay reachable.

**3. It hangs off the pill's own model.** `swapHost`'s `SwapPill` gains
`open`, so the door appears wherever the pill appears — `CentralDisplay`'s
column and all ten-odd views that place `HostedSwapPill` — with no per-view
work. `useInstrumentSwap.open()` opens the browser pinned to the track, with
its recorded patch, which is the ADR-441 landing; `useClipSwap.open()` opens it
pinned to the focused clip's slot. Each hook answers `canOpen`, so a pill with
no track (or no slot) keeps a plain label rather than a dead button.

**4. It is a tap.** The 800 ms hold was a gate against its neighbors in a dense
rail. On the name, the gesture needs no gate — opening a browser is neither
destructive nor irreversible.

**5. It stays live while the pill cannot step.** "No preset recorded", the AX
helper down, a kit Live cannot rank: every one of those is a case where picking
from the browser is the way *out*, and each is shown in the name's place. The
door must not go inert with the halves.

**6. Column 9 is Dup Trk at full height**, which is what it was before Replace
joined it (2026-09-13).

**How it got here, the same day.** The first cut put a hot-swap *square* beside
the pill, `--height-touch` on a side, with an arrow-into-a-tray glyph; the user
then picked a ring of two chasing arrows for it, inked like the name, and took
the box away; then moved the door onto the name itself and dropped the icon.
The square cost the views a cell of room and read as a second control for what
is one object.

## Consequences

**Positive**
- One control changes an instrument, at two settings: step, or pick.
- The gesture lands on the thing it changes, and (ADR-441) opens on it.
- No extra cell: the pill is the same size it was before this ADR.
- It reaches every instrument, a Drum Rack included — the pill steps a kit
  through Live's similar sounds, but the browser replaces the instrument, and
  the pin is a track path either way.
- Column 9 gets a full-height Dup Trk back.

**Negative / accepted**
- **The clip view of a MIDI track can no longer replace its instrument.** There
  is no instrument pill there (the clip pill is audio-only), so the way to it
  is the strip's device band — one tap — and then the name. This is the real
  cost of the move and was taken deliberately.
- **A flat pill too narrow to draw a name has no door**, so a HOST that can
  end up that narrow has to keep room for one. Under 6.5rem the name is hidden
  outright (ADR-439) and only the arrows remain. That bit the Drum Rack: the
  pads-alone pill is exactly as wide as the pad column, one pad is 68px, and
  one pad is what a drum track at rest draws (`padGridNotes` — nothing playing,
  one selected pad), on every profile but DrumCell and Sampler and on any
  profile with a pad's effect pane open. `.vm-pads-with-pill` now floors that
  column at three touch targets — one per arrow and one for the name — so the
  door survives; the pads keep their own 68px and stay at the column's leading
  edge, and the width comes out of the controls beside them. Two pad columns
  are already 140px, so only the one-column case moves. **At that floor the
  name is a door before it is a label**: 44px less its padding ellipsizes all
  but a character or two. Raising the floor buys legibility straight out of
  the controls' width — 4 touch targets reads ~8 characters, 5 reads ~12.
- Any *other* host that places a flat pill under 6.5rem would have the same
  hole, and the same obligation. Today only the Drum Rack gets that narrow.
- **The name's extent is a hidden boundary.** Nothing marks where the door
  ends and a step begins except the text itself; a short name leaves big step
  zones, a long one small (never under 44px).
- A pad scope cannot narrow the door: with a pad held, the pill steps *that
  pad's* similar sounds while the name still replaces the whole instrument.
  The pin is a track path and there is no per-pad replace on the wire. The
  pad's own chain is reachable from the Drum Rack view's pane instead.

## Tags
`central-view`, `swap-pill`, `browser`, `replace-instrument`, `clip-view`,
`adr-390`, `adr-439`, `adr-440`, `adr-441`
