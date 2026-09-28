# ADR-383: Instrument Slider in the FX Grid

## Status
**Superseded** by [ADR-438](438-the-fx-grid-goes-to-ten-columns.md)
(2026-09-15). The instrument slider left the FX grid with the ten-column
cut: the track strip's device band (PR #496) had taken over its tap-to-open
job on every track, and the grid's half-column was worth more as part of a
column removed. `InstrumentControl.svelte` and `instrumentSliderMap.ts` are
deleted. What follows is the original decision, kept for the history of why
the fx1 split existed at all.

## Context

The instrument central view (the per-synth detail panel — Drift, Operator, Omnisphere, Simpler, drum racks, etc.) was reachable only by tapping a track title: `TrackHeader` → `useTrackData.handleSelect()` → `instrumentDisplayCoordinator.showCurrentInstrument()` → `centralDisplayStore.setView('instrument', …)`. That gesture also did several other things (select, re-tap semantics), and it offered no inline expressive control over the instrument from the main FX layout.

We wanted a single control on the FX grid that (a) drives one expressive parameter of the selected track's instrument and (b) opens the instrument central view on tap — without removing the existing track-title path.

The left-hand fx1 slot (Guitar) was full-height (`rowSpan: 2`). Splitting it in half frees room for an instrument control above Guitar without touching the rest of the 11-column × 2-row grid.

## Decision

**1. fx1 split (top half = instrument slider, bottom half = Guitar)**

`FXGrid.svelte` special-cases the first slot (`i === 0`): the cell still row-spans both grid rows, but an inner flex column divides it evenly — `InstrumentControl` on top, the existing `GuitarControl` below. Every other slot renders unchanged. No change to `fxGridLayout.ts` (Guitar keeps `rowSpan: 2`).

**2. `InstrumentControl.svelte`**

A track-colored `DeviceSlider` that resolves the selected track's instrument and type from `currentInstrumentStore` (kept in sync by `instrumentDisplayCoordinator`). Tap → `centralDisplayStore.setView('instrument', type, { instrument })`. Drag → a per-instrument-type write. Slider tint follows the **track color** (`rgbToHex(v3Store.tracks.get(path).color)`), matching the selected strip, rather than a fixed device color.

**3. `instrumentSliderMap.ts` — mapping by instrument type**

A `Record<InstrumentType, InstrumentSliderMapping | null>` with five mapping kinds:

| kind | behavior | instruments |
|------|----------|-------------|
| `param` | drive one param by index | Drift 21, Meld 8, Wavetable 4, Electric 8, Collision 45, Omnisphere 26 (Orb Radius), Instrument-rack macro 1 |
| `param-pair` | drive two params from one value | Operator 29 + 34 (Time X/Y) |
| `transpose` | resolve the pitch macro index by name at runtime, then drive it | drum racks (`drumrack`, `drumrack-komplete-kontrol`) |
| `modwheel` | send `/midi/mod_wheel` (write-only, local state, starts at 0) | Komplete Kontrol |
| `simpler-start` | mode-aware: Classic writes param 3, Slicing writes `sample.start_marker` (frames) | Simpler, Sampler |
| `null` | view-only (slider renders + taps to view, drag inert) | analog, plugin, instrument-rack-pattern, unknown |

**4. Reuse, not reinvent, the transpose-macro resolver**

Drum-rack pitch macros vary by preset (and may be named `Custom E`, `Pitch`, `Transpose`, `Octave`, `Tune`). Rather than hardcode an index, `InstrumentControl` calls `findTransposeParameter(device)` — the same name-based resolver the Clip view's ±12 buttons use, driven by `constants.instruments.transpose.parameterNames` (priority order, case-insensitive). It was module-private in `clipTranspose.ts`; this branch exports it (and `TransposeParamInfo`). The slider drives the resolved param across its full macro range (0–127, center-origin at 64) for *continuous* control, complementing the ±octave-step buttons.

**5. Omnisphere uses Orb Radius, not the mod wheel**

Initially Omnisphere mapped to the mod wheel, but many Omnisphere patches don't map mod wheel, so the slider felt dead. Switched to param 26 (Orb Radius) — a real macro that always responds and reads back its value (the mod wheel is write-only). Same param the Orb control's radius axis drives in `OmnisphereCentralView`. Komplete Kontrol stays on the mod wheel.

**6. Track-title tap unchanged**

`useTrackData.handleSelect()` still opens the instrument view. The slider is an additional entry point, not a replacement — no regression to the existing flow.

## Consequences

**Positive**
- One inline gesture to both express on the instrument and open its detail view, from the main FX layout.
- Track-colored, so the control reads as belonging to the selected track.
- Drum-rack pitch reuses the proven name-based macro resolver, so `Custom E` / `Pitch` / `Transpose` / `Octave` / `Tune` all bind automatically.
- Most mappings read back their value (armed-aware), so the slider reflects external changes; only the Komplete mod wheel is write-only.
- Adding a new instrument mapping is a one-line edit to `instrumentSliderMap.ts`.

**Negative / to verify at runtime**
- **Meld param 8**: `device-configs.json` is sparse and doesn't name index 8; the "Osc 1 Shape" mapping is trusted from the design discussion, not config-confirmed. Verify if Meld's slider feels wrong.
- **Drum-rack absolute drive**: the slider drives the transpose macro's absolute 0–127 value (center 64), whereas the ±12 buttons apply relative octave steps via `shiftAmount`. The slider's center may not equal "0 semitones" if a macro's neutral point differs.
- Omnisphere param 26 is confirmed by the central-view Orb mapping, not by a named config entry (plugin params are runtime-discovered).
- The split fx1 makes Guitar half-height; on small layouts the two stacked controls compete for vertical space in that one column.

## Tags
`ui`, `fx-grid`, `instrument`, `central-view`, `device-control`, `slider`, `transpose`, `simpler`, `omnisphere`
