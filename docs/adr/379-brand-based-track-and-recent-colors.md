# ADR-379: Brand-Based Track Coloring and Recents Vendor Color Persistence

## Status
**Accepted**

## Context

The preset browser assigns a color to each card's left border using `vendorColor` —
a per-preset value baked into the type-first JSON by `generate-type-first-json.ts`.
These colors reflect the **brand** of the preset's source library:
Ableton (yellow), NI (cyan), Omni (magenta).

Previously, track auto-coloring on preset load used the **instrument type** (drum/bass/
synth/key/inst/fx) extracted from path segment 1. This meant an Ableton drum kit and
an Omni drum kit both turned the same red — disconnected from the browser's per-card
brand coloring that the user sees while browsing.

Additionally, recent instruments in the Recents sidebar showed no left-border color:
`RecentPresetItem` didn't store the preset's `vendorColor`, and `getAsPresets()` returned
bare `Preset` objects with no `vendorColor` field, so every card fell back to the
purple Recent-button color.

## Decision

### 1. Brand-based track coloring

Track auto-color now resolves by **brand** (path segment 0) first, falling back to
instrument type (segment 1) for unrecognized brands:

```
audio vendorId → vendors.special.audio (green, unchanged)
   ↓ else
segment 0 brand (Ableton/NI/Omni) → vendors.brands.<Brand>.color
   ↓ fallback (unknown brand)
segment 1 type (drum/bass/synth/…) → vendors.types.<type>.color
   ↓ fallback (unknown type)
no recolor
```

Brand colors are defined in `config/constants.json:vendors.brands` — the single
source of truth — and `generate-type-first-json.ts` reads them from there instead
of its previous inline hardcoded map. `trackColoring.ts` exports two new helpers:
`brandFromPresetPath()` and `colorForBrand()`.

### 2. Recents vendor color persistence

`RecentPresetItem` gains an optional `color?: string` field. `addInstrument()` captures
`preset.vendorColor` at load time. `getAsPresets()` surfaces it as `vendorColor` on the
returned `Preset` so `PresetGrid`'s existing left-border coloring works automatically.

Entries already in localStorage (pre-ADR-379) have no color field and fall back to the
parent `vendorColor` passed from the browser component (the purple Recent button color).

## Consequences

**Positive:**
- Track color now matches the brand color of the preset card the user tapped — visual
  coherence between browser and session view.
- Recents cards show the brand color they had when originally loaded, giving quick
  visual identification of source library within the flat recents list.
- Brand colors are a single source of truth in `constants.json`; no duplication
  between the generator script and the runtime color resolver.

**Negative:**
- Existing sessions lose their type-based track colors on next preset load (one-time
  churn; the new brand colors replace them at next explicit instrument selection).
- Pre-ADR-379 recents entries in localStorage show no brand color until reloaded.
- The type-color fallback still exists but is now only hit for unrecognized brands —
  adding a new brand requires updating `constants.json:vendors.brands`.

## Tags
`colors`, `browser`, `track-coloring`, `recents`, `preset-library`
