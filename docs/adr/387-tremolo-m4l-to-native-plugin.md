# ADR-387: Tremolo — M4L Device → Native AU Plugin

## Status
**Accepted**

## Context

The FX-grid `fx5` slot ran `tremolo.amxd`, a Max for Live audio
effect (`MxDeviceAudioEffect:tremolo`). M4L only runs inside Live
with the M4L add-on, costs per-instance CPU even when bypassed, loads
slowly, and has no path to other DAWs. A native JUCE 8 port lives in
the sibling repo `/Users/Shared/DevWork/GitHub/tremolo` — a VST3 / AU
/ CLAP / Standalone build that reproduces the device's DSP and
parameter set. We installed the AU preset at
`…/Effect Patches/Tremolo.aupreset` and swapped Looping over to it.

Two facts drove every decision below:

1. **Parameter order changed.** The whole tremolo UI reads/writes
   params *by LOM index*. The M4L order was Amount, Shape, Sync,
   SyncRate, FreeRate, RandRate, RandRange, ShapeModDiv, ShapeModDepth.
   The plugin's runtime LOM order is different:
   `rate(1), sync(2), shape(3), division(4), shapeModDiv(5),
   amount(6), randRange(7), randRate(8), shapeModDepth(9)`. Note this
   is **not** the APVTS declaration order in the plugin's
   `Parameters.h` — it is the order a runtime read reports, consistent
   with the hidden-prefix-param gotcha seen with Permute (ADR on
   permute param indices). Indices were taken from the running device,
   not guessed from source.

2. **AU plugin params are normalized 0–1.** Unlike the M4L device
   (which reported engineering units — Hz, 1/16 divisions, −1..1
   bipolar), the AU exposes every parameter to the LOM as a normalized
   0–1 `value`/`min`/`max`. So the M4L-era unit conversions collapse:
   the UI now reads and writes the raw 0–1 slider/axis position
   directly. `DevicesComponent` already writes `parameter.value` and
   clamps to `[min,max]` (= `[0,1]`), so the contract is consistent
   end-to-end.

This is a *port*, not a redesign — the requirement was that the UX be
**identical**.

## Decision

**1. Device identity (`devicePresets.ts`)**

`tremolo` slot now points at `Tremolo.aupreset`,
`defaultName: 'Tremolo'`, `expectedClassName: 'AuPluginDevice'`.
Device matching is `className === expectedClassName && name ===
defaultName`, so these are what make the slot recognize the loaded
plugin. (`defaultName` must equal Live's *runtime* device name, which
for an AU preset is the plugin name `Tremolo`, not the `.aupreset`
basename — they happen to match here.)

**2. Device metadata (`device-configs.json`)**

Replaced the `MxDeviceAudioEffect:tremolo` block with
`AuPluginDevice:Tremolo` and the 9-param set in runtime order, all
with `min: 0, max: 1`. This block is metadata only for Tremolo
(`parameterLookup.ts` reads it by name for six *other* central views;
tremolo isn't one), but it's kept accurate.

**3. Index + normalization remap, UX unchanged (both Svelte files)**

`MovementTremoloControl.svelte` (FX-grid XY pad) and
`MovementTremoloCentralView.svelte` (detail panel) both got the new
`PARAM` index map and switched to normalized math:

- XY pad: X = rate (free) or division (synced) — both 0–1 already;
  Y = amount, 0–1 already. On interaction we write the normalized x to
  *both* `rate` and `division` (the active one depends on Sync) and y
  to `amount`. No `(amount+1)/2` / `(div-1)/15` / `0.1+x*19.9`
  conversions remain.
- Labels are reconstructed UI-side from the normalized position: the
  Hz readout *un-skews* the rate param (JUCE log skew 0.3 →
  `0.1 + 19.9·x^(1/0.3)`); the synced division label maps normalized →
  1..16 → `DIVISION_LABELS`.
- Central view: Shape and Amount sliders bind the normalized value
  directly; Shape-Mod Div quantizes to `round(v·15)/15`; the Random
  Rate/Range buttons key their highlight on reconstructed integers and
  write the normalized form (`randRate16` int 1–64 → `(steps−1)/63`;
  `randRange` 0–4 → `v/4`).

**4. Random-rate semantics**

M4L Rand Rate was an enum 0–4. The plugin's `randRate16` is the
re-roll period in **16th notes**, int 1–64. The five UX buttons keep
their `1/4 · 1/2 · 1 · 2 · 4` labels, now backed by 4/8/16/32/64
sixteenths.

**5. Slot wiring untouched**

The internal slot key / `deviceType` / central-view-registry key all
stay `'tremolo'`, so the grid position, tap-to-view, and view
registration are unchanged.

## Consequences

**Positive**
- Native plugin: instant load, no M4L runtime, runs in any host.
- Identical UX — same XY pad, sliders, sync toggle, random box,
  waveform mirror.
- Normalized params simplify the UI math (raw 0–1 in/out); the surface
  clamp range matches exactly.

**Verified at runtime (2026-05-29, via Playwright against the live bridge)**
- A dump of the loaded `AuPluginDevice:Tremolo` confirmed the index
  order. The LOM *does* prepend a hidden `Device On` at `params/0`, but
  this is harmless: the code indexes params from `1`, so all nine
  `PARAM` entries (`Rate=1 … Shape Mod Depth=9`) line up exactly with
  the dump (name-for-name match on every index). The +1 shift risk
  flagged in design is real but does not bite us.
- Every param reports normalized `value`/`min`/`max` in `[0,1]`, as the
  swap assumed. The dump's `display` field carries the engineering
  value (e.g. Rate "2.09", Division "1/1", Amount "0.92").
- The central view rendered correct live values, and a SYNC write
  round-trip (toggle `1→0→1`) reached the live plugin and echoed back,
  confirming the write path targets the right index.

**Negative / to verify at runtime**
- **Rate label skew** assumes JUCE `NormalisableRange` skew 0.3; if the
  plugin's actual skew differs, the Hz readout drifts (the *audio* is
  unaffected — only the displayed number). The dump's `display` field
  is the authoritative engineering value if a cross-check is ever
  needed.
- The old `MxDeviceAudioEffect:tremolo` config block is gone; any saved
  set still holding the M4L device won't match the slot until its
  `Tremolo.aupreset` is loaded.

## Tags
`ui`, `fx-grid`, `central-view`, `device-control`, `tremolo`, `plugin`, `au`, `m4l-migration`, `param-indices`, `normalized-params`
