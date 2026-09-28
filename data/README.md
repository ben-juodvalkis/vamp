# Data Directory

Local data files, caches, and configuration.
**`CLAUDE.md` in this directory is the authoritative description** — this
file is a map, not a spec.

## Structure

- `device-configs.json` - Per-class LOM **property paths**, read only by the
  Python surface. See `CLAUDE.md`.
- `device-configs/` - Per-device parameter dumps, kept as reference material.
  **Not loaded by anything**, and not trustworthy for parameter indices —
  several list documentation order with no Device On at 0. Measure the
  `.adv` artifact instead.
- `cache/` - Search result caches and file indexes.

## device-configs.json

See [CLAUDE.md](CLAUDE.md). In short: it carries one section (`properties`)
for four classes, it is read only by
`surface/device_property_loader.py`, and nothing in the
interface imports it.

Its `parameters` and `insertion` sections were removed on 2026-09-02 once
measurement showed neither changed any behavior. If you are here looking for
a parameter index, **do not take it from a JSON file** — dump the `.adv`
preset (gzipped XML, element order is LOM order with Device On at 0) and
confirm against a runtime `state/full`. Device colors and FX-grid preset
paths live in `interface/src/lib/config/devicePresets.ts`.

## External Database Locations

Sound libraries remain in their original locations:
- Komplete Kontrol: `~/Library/Application Support/Native Instruments/Komplete Kontrol/Browser Data/komplete.db3`
