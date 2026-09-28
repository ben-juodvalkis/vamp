# ADR-431: The Drum Buss Is a Grid Tile With Its Own View; the Saturator Goes Back Into the Pedal View

## Status
**Accepted** (2026-09-10). Supersedes the placement half of ADR-424 — the
role-gated `DrumBussRail` on instrument views — and the 2026-08-22 grid
re-deal that gave the Saturator a tile.

## Context

The Drum Buss lived beside every instrument view of a drum- or perc-role
track as a fixed-width rail (ADR-424): the Comp switch, the Boom XY, the
Drum XY and, since 2026-09-02, the Glue Compressor's Squash slider. On the
Drum Rack view that rail sat next to the kit's own controls, the pad grid
and — since issue #491 — the pad-scoped effect pane, and the user wanted
the view to be the kit's alone: "remove the drum XYs and squash control
from the drum rack central view". At the same time the Saturator had a
grid tile whose central view was an empty placeholder broken out into four
faders, and the Pedal view it had left was three columns wide.

## Decision

- **The Drum XY is a grid tile** (`device-panel/DrumBussControl.svelte`,
  position `fx6`, the Saturator's old tile): transients across, dry/wet
  up, the same two parameters the rail's Drum XY drove. It is `padScoped`
  (from 2026-09-11 — it shipped inert under a pad scope for a day, on the
  reasoning that a Drum Buss is a track device; a kick with its own is
  the ordinary case), so under a held pad it is that pad's Drum Buss.
- **Its view holds what the tile cannot:** `views/DrumBussCentralView.svelte`
  — the Comp switch and the Boom XY (decay across, amount up), registered
  as `device/drum`. Same slot machinery as every device view: ghost until
  the track carries a Drum Buss, first touch loads `Drum Buss.adv`.
- **The rail is gone.** `DrumBussRail.svelte` is deleted and
  `CentralDisplay` mounts every instrument view full-width again. Squash
  is not moved anywhere: the Gain / Utility view already mounts the same
  `squash` slot, and that stays its doorway.
- **The Saturator returns to the Pedal view** as two columns — its XY
  (the grid tile component, mounted standalone with the tap's navigation
  off, since the view is its home) and its four parameters on faders
  (Drive, Color Hi, Output, Mix, which `SaturatorCentralView` broke out).
  That view is deleted and `device/saturator` is no longer registered;
  the preset and its slot are untouched, so a Saturator loads exactly as
  before, from inside the Pedal view.

`trackRole.svelte.ts` stays: the rail was its only consumer, but the role
is the signal the next change — an FX grid that varies by track kind —
will key on.

## Addendum (same day): Squash shares the Gain column

The user then asked for Squash — the Glue Compressor's threshold and
makeup on one finger — on the FX grid and out of the Gain / Utility
view; first as a full-height column of its own beside Gain (which made
the grid twelve columns for an hour), then as the top half of the Gain
column with Gain below it. `SquashControl` became a `BaseDeviceControl`
tile with no layout entry, and `FXGrid` splits `fx7` the way it splits
`fx1` for the instrument slider, so the grid stays at eleven columns
and the TotalMix status strip's ruler with it. The Utility view is
three columns (sidechain · compressor · gate). A tap on the Squash tile
opens that view, registered as `device/squash`. Squash is `padScoped`,
so under a held pad it is the pad's Glue Compressor.

## Consequences

- The Drum tile is on every track's grid, drum or not, until the grid
  learns to vary by track kind; the rail was role-gated and this is not.
- The Pedal view is five columns again at the iPad's width: three pads
  sharing the space, a 4 × 56px fader group and the type tabs.
- ADR-424's measurement of why the role, not the class name, gates drum
  things is still the reason the role exists; only the rail it gated is
  gone.

## Tags
`drum-buss`, `saturator`, `fx-grid`, `pedal-view`, `central-display`, `adr-424`
