# ADR-497: Live's Own Effects Fill the Recents

## Status
**Superseded** by [ADR-523](523-a-fixed-effect-palette-over-the-chain.md) (2026-11-11). Accepted 2026-11-01. Amends [ADR-484](484-recent-effects-beside-add-effect.md):
the section is never empty now. No Live restart: interface only.

## Context
ADR-484's recents come only from effects added through the browser, kept
in this browser's localStorage. A fresh load (a new install, another
browser, the iPad's web app after its storage is cleared) showed none, so
the chain's ghost section was a bare + Effect. The user wanted a set of
options always there.

## Decision
- The recents come first, as before. What they leave of the section's
  room is filled from a fixed list (`recentEffects.DEFAULT_EFFECTS`):
  Echo, Reverb, Auto Filter, Guitar, Bass Amp, Channel EQ, Saturator,
  Glue Compressor, Chorus, Drum Buss, Redux, Gate, Shifter, Multiband
  Dynamics, Auto Pan, in that order of preference. The ones shown are
  still drawn in alphabetical order.
- Each loads as its FX tile does (`deviceLoadArgs`). Live's own devices
  are inserted by name (`native:<class>`, protocol 3.12.0): no file is
  read, and the user's own default for the device (`Defaults/Audio
  Effects` in their User Library) applies. The Guitar and Bass Amp racks
  load from the Vamp Devices Place (`place:Vamp Devices` and the path
  inside it).
- No Utility: the right sidebar always has its ghost (ADR-482). No
  Compressor or Phaser, to make room for the amp racks (the user, the
  same day).
- The same skipping as the recents: nothing the chain already holds, and
  no default whose device is already a recent. A device known by two
  names counts under both (a Hybrid Reverb preset is the Reverb).
- A default's tile draws its device's picture at the control's rest
  position, there being no file to read values from.
- A tap on a default does not make it a recent; only the browser records.

## Consequences
- The section is full on every chain; + Effect widening over unused
  recent columns now happens only when a chain holds most of the list.
- The list is code, not a setting.

## Tags
`fx-chain`, `chain-overview`, `recent`, `effects`, `native-devices`
