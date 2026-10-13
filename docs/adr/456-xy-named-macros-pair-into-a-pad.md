# ADR-456: Instrument Rack Macros Named "XY …" Pair Into One Pad

## Status
**Accepted** (2026-09-30; recorded 2026-10-13). Amends decision 3 of
ADR-454 ("the first-word XY pairing is gone everywhere") for the
Instrument Rack view only. Commits `beb50eb` and `4602270`.

## Context
Before ADR-454, two consecutive macros sharing a first word ("Filter
Cut" + "Filter Res") became one XY pad. That guessed from names that
were never written for it, so a rack whose macros happened to share a
word got a pad nobody meant. ADR-454 dropped the rule: every rack view
shows one slider per named macro.

The next day the Guitar rack's Drive + Fuzz and Tremolo Rate + Amount
wanted pads again (`beb50eb`, by their exact names). Then the Instrument
Rack wanted the same for any rack (`4602270`). The guess was what went
wrong, not the pads. A rack author who *asks* for a pad should get one.

## Decision
**A macro whose first word is "XY" pairs with the next macro that also
starts "XY", in macro order. The first is X, the second Y.** The pad
takes the earlier macro's place, two slider columns wide, titled by the
rest of both names ("XY Cutoff" + "XY Res" → "Cutoff/Res"). Four XY
macros make two pads. An odd one out stays a slider under its name.
`macroLayoutUtils.pairXYPrefixedMacros`.

**The prefix is the rack author's opt-in, and nothing else pairs.** A
shared first word no longer means anything. A macro that doesn't start
"XY" is a slider, as ADR-454 decided.

**Scope: the Instrument Rack view only.** The Pattern Rack and Audio
Effect Rack views and the Drum Rack's macro rows keep ADR-454's one
slider per macro. Pads that are a device's own controls (the Drum Rack's
FX, Time and Filter pads, the effect views) were never name-derived and
are untouched.

The Guitar rack's pads came through `pairMacros`, a fold by exact name
rules (`XYPairRule`). They live in the Pedal view since GuitarCentralView
folded into it (ADR-457), which draws its Tremolo pad itself, so
`pairMacros` had no caller left and was removed (2026-10-13).

## Consequences
- A rack author gets a pad by naming two macros, with no code change, and
  the pad's title is what they wrote after "XY".
- The "XY" prefix shows in Live's own macro names. That's the price of a
  convention Live has no field for.
- Pairing skips over macros in between: "XY A", "Gain", "XY B" make one
  pad at A's place, with Gain after it.
- The central tour shoots it as `inst-instrument-rack-xy`.

## Tags
`instrument-rack`, `macros`, `xy-pad`, `naming-convention`, `central-view`
