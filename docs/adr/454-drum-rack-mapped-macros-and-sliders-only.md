# ADR-454: A Drum Rack With Mapped Macros Shows Its Macros; Rack Macros Are Sliders Only

## Status
**Accepted** (2026-09-29). Supersedes ADR-428's rule that a still-mapped kit
shows its functions "held by macro" until the kit is unmapped.

## Context
The Drum Rack central view picks its layout from the pad classes in the
surface's `vm.members` census (ADR-428, Milestone 1b): a DrumCell kit gets
the seven virtual-macro controls, a Simpler or Sampler kit its row, a kit of
nested Instrument Racks one control per pad-rack macro name, and only a kit
with plugin-hosted pads gets the rack's own macros as a slider grid.

The rack's own macros never decided anything. On a kit whose macros are
mapped, the parameters they hold report `is_enabled == False`, so the view
kept its pad-class row and froze most of it read-only with a "macro" badge.
The macros that actually drive the kit had no control anywhere on the
screen. The user asked what happens in that case and made the call: a Drum
Rack with assigned macros should just show a slider for each macro.

Separately, every rack view shared a rule from the Instrument Rack view: two
consecutive macros sharing a first word ("Filter Cut" + "Filter Res")
became one XY pad. The user asked for it to go: "simplify and just show
sliders".

## Decision

**1. A Drum Rack whose own macros are mapped shows one slider per mapped
macro, and nothing else.** `kitProfile` returns `macro-grid` when the census
says `hasMacroMappings`, as it already did for plugin-hosted pads. The
macro grid (`DrumRackMacroGrid.svelte`) draws one 0–127 slider per mapped
macro in macro order, titled with the name Live reports. Gain, Trnsp, the FX
and Time pads and the Filter pad are not drawn; the pad column stays.
Unmapping the kit in Live re-emits the census (the surface already listens
to `macros_mapped`) and the kit's own controls return.

**2. Which macros are mapped is Live's `RackDevice.macros_mapped`, never the
names.** A mapped macro can keep its default `Macro N` name, and the grid's
old filter hid exactly those. The census gains `mappedMacros`: the mapped
macros as 1-based parameter indices (parameter 0 is Device On), `[]` when
none is. A list of indices and not sixteen booleans, because the census sits
near the datagram cap: the flags alone added ~90 bytes and pushed a 92-pad
kit with names at the cap past the 8,000-byte soft cap, which drops every
pad name.

**3. The first-word XY pairing is gone everywhere.** `buildMacroLayout`
returns one slider per named macro. The Instrument Rack and Pattern Rack
views, which each carried a private copy of the rule, now call it; the
Audio Effect Rack and Guitar views lose their XY branch; the drum
`rack-macros` row is one slider per pad-rack macro name. The XY pads that
are a device's own controls (the Drum Rack's FX, Time and Filter pads, the
effect views) are untouched: they are not derived from names.

## Consequences

- A kit whose macros are mapped is played through its macros, as its author
  set them up. The per-pad hold still selects a pad and scopes the FX grid,
  but there are no pad-level virtual controls on such a kit
  (`profileFunctions('macro-grid')` is empty).
- **Kits that lose their virtual controls:** every mapped kit, including
  Live's own `32 Pad Kit Jazz` as shipped and the rig's FX1/FX2 pipeline
  kits, whose macros are mapped. Unmapping a kit in Live brings the
  controls back.
- The FX-grid Pitch slider and the clip view's ±12 still go through
  `vm.pitch` and are refused where the census says pitch is held, as before.
- `hasMacroMappings` no longer describes a held pad parameter in the tests'
  fixtures: a function can still be held by a *pad rack's* own macro (a
  nested-rack kit), and that is what `held` now exercises.
- **Not changed:** a plain Instrument Rack still picks its macros by name, so
  a mapped macro left as `Macro N` stays hidden there. An Instrument Rack
  wrapped around a Drum Rack (the `Abyss Kit` shape: Instrument Rack → Drum
  Rack + Audio Effect Rack) is typed by its top-level class and gets the
  Instrument Rack view, not this one.
- Needed a Live restart (the census is the surface's).

## Validation

- On the rig (Live 12.4.15b4, 2026-09-29): the user mapped one macro on the
  set's `Memphis Studio + Plymouth` kit. Live read `has_macro_mappings`
  True, `macros_mapped` True for macro 1 only, `parameters[1].name`
  "Attack". The interface showed `data-vm-mode="macro-grid"` with a single
  Attack slider and no `.vm-slot`. A drag on it moved `parameters[1].value`
  0 → 57 in Live; it was restored to the 0 read before the test.
- Tests: `test_drum_virtual_macro_component.py` (`mappedMacros` in the
  census, and `[]` after an unmapping), `DrumRackCentralView.test.ts` (a
  mapped DrumCell kit draws a slider per mapped macro, a never-renamed
  `Macro 3` included, and returns to `full` when unmapped),
  `drumVirtualMacros.test.ts`, `macroLayoutUtils.test.ts`.
- Screenshots against the mock: the Jazz kit (mapped as shipped) shows
  Transpose and Release; the Ethnic kit shows Pitch Attack and Pitch Amount
  as two sliders.

## Tags
`drum-rack`, `macros`, `macros_mapped`, `vm-members`, `census`, `rack-views`, `xy-pad`, `sliders`
