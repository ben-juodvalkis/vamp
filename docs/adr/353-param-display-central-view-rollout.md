# ADR-353: Param Display Strings — Central-View Consumer Rollout

## Status

**Accepted** — 2026-04-26. Companion to ADR-352.

## Context

ADR-352 added the surface→UI wire and store layer for Live's
GUI-formatted parameter strings (`"440 Hz"`, `"1/4"`, `"-12.0 dB"`):

- New `/looping/v3/param/display [path, displayValue]` address.
- `MutationComponent.mark_hot(path)` flag set by `DevicesComponent`
  on every UI-driven `param/set`; `on_param_value_changed` calls
  `str(parameter)` and emits when hot.
- UI-side `paramDisplay()` accessor on
  `selectedTrackStore` and `useFxGridSlot`.

That ADR proved the mechanism with one consumer (`AutoFilterCentralView`
LFO XY title). This ADR captures the broader question: **how should
central views actually use the readout, and which views are good
candidates?**

A survey of the 40+ central views identified time/freq/dB/note-division
controls where Live's formatter substantially clarifies what the user
is doing — currently most controls show either raw 0-1 percent or a
local approximation that drifts from Live's actual formatter (e.g.
EchoCentralView locally computes Hz from the normalized 0-1 value via
`FilterResponseCalculator`, which is not what Live's panel shows).

Two presentation patterns were considered:

1. **Inline title append** — `"LFO"` → `"LFO · 880 Hz"`. The control's
   existing label expands during interaction, contracts on release.
   Spatially anchored to the control. Same line of sight as the user's
   thumb.
2. **Floating overlay pill** — a small absolute-positioned div that
   appears mid-drag near the control. More visible but adds chrome.

User explicitly preferred (1) over (2): "i don't want pill. i want it
similar to the autofilter lfo where it's just part of the display."

## Decision

**Inline title-append is the only sanctioned pattern. Apply it
everywhere a control already has a title or button caption to extend.
Where no inline label exists, defer the consumer rather than add new
chrome.**

Concretely:

### Applied (4 views)

- **AutoFilterCentralView** (the original) — LFO XY title:
  `"LFO"` → `"LFO · 880 Hz"` (Time mode) or `"LFO · 1/4"` (Sync mode).
  Active param switches with the Time/Sync toggle.
- **ArpeggiatorCentralView** — Rate slider title via `paramDisplay`
  for both sync (param 5) and free (param 7). This *also corrects an
  existing bug*: the free-rate label was using the wrong lookup table
  (`RATE_LABELS[round(rateValue)]` does not apply when not synced).
  Gate slider: `"Gate"` → `"Gate · 50 ms"`.
- **ReverbCentralView** — Algorithmic mode slider titles via a shared
  `sliderTitle(idx, baseName)` helper. Damping shows `"· 120 ms"`,
  Mod shows `"· 4.2 Hz"`, Tides Rate shows `"· 1/4"`, etc.
- **DigitalCentralView** — LFO XY title, prefer X-axis display, fall
  back to Y, fall back to `"LFO"`. Same shape as AutoFilter.

### Deferred (with reasoning embedded in the source)

- **EchoCentralView** — The HP/LP filter dots have no per-dot label;
  the FilterCurve canvas takes no `title` prop. A floating pill was
  prototyped and rejected by the user. The honest answer is to embed
  the current frequency into FilterCurve's own SVG axis labels
  (`showLabels` already draws `"100 Hz"`, `"1 kHz"`, `"10 kHz"` ticks)
  — that's a non-trivial change to a shared component and is out of
  scope for this rollout. Source carries a comment explaining the
  defer.

- **MovementTremoloCentralView** — Rate (param 3) and division (param 4)
  are not controlled from this view. ADR-352's hot-path discipline only
  emits display strings while the UI is *writing* to the param. Adding
  `paramDisplay(rate)` to the SYNC button caption would silently never
  populate. Source carries a comment naming the SYNC button caption
  as the natural slot when a rate control lands here.

### Helper conventions

- For single-control views with a single readout (`LFO`), build a
  `$derived` title that prefers the active axis's display string and
  falls back to the bare label. AutoFilter and Digital both follow
  this shape.
- For multi-slider views (Reverb's algorithmic mode), define a
  reusable `sliderTitle(idx, baseName) => baseName + display ? ...`
  helper rather than inlining the conditional in every slider.
- Always fall back to the existing label when `paramDisplay` is
  undefined. A bare label is the honest UX when the user isn't
  interacting; pretending we have units we don't drifts from Live.

## Consequences

### Positive

- **Same accessor pattern as `paramValue`** — every view already
  reads `fx.paramValue(idx)`; `fx.paramDisplay(idx)` is a one-line
  addition with no new state machine, subscription, or lifecycle
  hook to maintain.
- **Self-contained per view** — the only cross-cutting code is the
  `sliderTitle` helper used by Reverb (and likely future
  multi-slider views).
- **Bug-fix side benefit** — Arpeggiator's free-rate label bug
  (wrong lookup table when sync is off) is now structurally fixed
  by deferring to Live's authoritative formatter.
- **Echo's local Hz approximation can eventually retire** — once
  the FilterCurve axis-label change lands, the
  `FilterResponseCalculator.normalizedToFrequency()` math becomes
  display-only, with Live as the source of truth.

### Negative

- **Echo and Movement get no readout in this round.** Both have a
  legitimate UX gap. Adding a pill would close it but conflicts with
  the inline-only constraint; closing it properly requires either
  modifying FilterCurve.svelte's SVG (Echo) or surfacing a rate
  control in the view (Movement). Both are larger changes than this
  rollout warranted.
- **Inline labels grow at most ~12 characters.** Existing layouts
  accommodate this fine in practice (the appended string is short
  for almost all Live params), but very narrow slider columns may
  truncate with ellipsis. None observed in this rollout, but worth
  watching as new devices land.
- **Properties (LOM `.sample.*`, IR `.ir_attack_time`, etc.) remain
  unformatted.** ADR-352 only covers the param wire. A symmetric
  `/looping/v3/property/display` would extend the same model to the
  property channel — left as a follow-up if a property-driven UI
  surface ever needs the readout.

## Tags

`ui`, `central-view`, `param-display`, `lfo`, `audio-controls`,
`live-feedback`, `consumer-rollout`
