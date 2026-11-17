# ADR-545: A track's colour is its instrument's

## Status
**Accepted** (2026-11-17). Interface only; no Live restart.

Supersedes [ADR-399](399-role-based-track-coloring.md) for the track's
colour, and the strip's category marks of 2026-09-18 (`useTrackDevice`).
The role is still recorded on the track (`applyAutoRoleOnPrepareAck`).

## Context

Since Ink ([ADR-544](544-ink-one-visual-system.md)) the selected track's
colour draws nearly everything: the strip, the title band, every amount in
a view. That colour was the ROLE of the last preset loaded (the Place it
came from: Drum, Bass, Key, ...), so a Drift bass and an Omnisphere bass
looked alike, and a Drum Rack filed under Perc looked unlike one under
Drum. Ben: base the track colour on instrument type (Collision, Drum Rack,
Drift, Meld, ...), and the same for the strip's icons.

## Decision

- **A track's colour is its instrument type's**, from
  `constants.json:vendors.devices`, the colours the browser's preset cards
  already wear: Drum Rack, Instrument Rack (the pattern rack too), Operator,
  Analog, Wavetable, Drift, Collision, Electric, Meld, Sampler, Simpler.
  Omnisphere and Komplete Kontrol take their brand's (`vendors.brands`). A
  generic plug-in or an instrument the rig does not know leaves the colour
  alone. A sample or clip loaded as audio stays `vendors.special.audio`.
- **When it is written** (`useInstrumentTrackColors`, mounted by the root
  layout, over the type the strip's device band reads):
  - an instrument loaded from the app: the prepare ack marks the track,
    and it is coloured once its device is in the tree, even when the type
    did not change (a load is intent; the ack comes before the device);
  - a track whose instrument type changes while the app runs, a load in
    Live included, or a new track that arrives holding an instrument.
  The first tree is the baseline: **opening a set recolours nothing**, and
  a reconnect to the same set recolours nothing either. The track's clips
  are recoloured with it.
- **The strip's icon is the instrument's own mark** (Drift's saw,
  Omnisphere's orb, Collision's beater, ...), whatever folder its preset
  came from; a Drum Rack draws the drum. Every icon is in its own track's
  colour, an audio track's effect included: a device family has no colour
  since ADR-544, so the icon's old family ink had become the SELECTED
  track's colour on every strip.

## Consequences

- A set opened from before keeps its role colours until a track's
  instrument is loaded or changed. Recolouring a whole set on open would
  be one call per track (`applyInstrumentColor`) if Ben wants it.
- A colour set by hand in Live survives until that track's instrument type
  changes or the app loads onto it.
- Inserting a track in Live shifts the tracks after it to new paths; any
  whose new path held another instrument type is recoloured to its own
  instrument's colour, which is the rule anyway.
- The browser rail's Places keep their role colours: they colour where a
  preset comes from, not a track.
- The recorded role has no reader in the interface now; it stays on the
  wire and in the set.

## Tags
`colour`, `track`, `track-strip`, `instrument`
