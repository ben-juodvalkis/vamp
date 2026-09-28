# data/

Configuration data files for the Live Looping System.

## Key Files

### device-configs.json

Per-class LOM **property paths**, keyed by LOM ``class_name``. One
consumer, and only one: `surface/device_property_loader.py`
reads the `properties` block to decide which properties (e.g.
`sample.warp_mode`, `ir_category_index`) to project into `state/full`.
Four classes carry them — Compressor2, OriginalSimpler, Drift, Hybrid.

**Not the property allowlist** — the runtime allowlist is
hand-maintained in
`surface/components/PropertyComponent.py` and must
agree with this list. JSON omission means the property won't appear
in `state/full` even if the allowlist permits it. The loader fails
**soft**: an unreachable or malformed file logs a loud ERROR and
emits zero properties rather than raising, so a mistake here is
quiet at runtime.

**It is Python-only.** Nothing in the interface reads this file.
It used to carry two more sections, both cut 2026-09-02:

- `parameters` (42 classes) fed `interface/src/lib/utils/parameterLookup.ts`,
  which four views (EQ, Utility, AutoFilter, Chorus) called for `default`
  values. Every one of those call sites was written `lookup(...) ?? literal`,
  and measurement showed the lookup **never** returned anything the literal
  didn't already say — two classes had no entry for the index being asked
  for at all. The literals now live in the views and `parameterLookup.ts`
  is deleted.
- `insertion` (42 classes) fed `interface/src/lib/configs/UnifiedDeviceConfigs.ts`,
  which nothing imported.

**Do not use this file as a class-name reference.** It listed 44 classes
and now lists 4. Authoritative class names live in
`interface/src/lib/config/devicePresets.ts` (`expectedClassName`, effects
and virtual devices) and `interface/src/lib/services/instrumentService.ts`
(`KNOWN_INSTRUMENT_CLASSES`, instruments).

**Not stored here:**
- Device colors and FX-grid preset paths — see
  `interface/src/lib/config/devicePresets.ts`.
- Device-init rules (Simpler defaults, AU-plugin retry) — see
  `_INIT_RULES` in `DeviceInitComponent.py`.

**Adding device properties:**
1. ~~Add the property path to the device's `properties` block here.~~
   **Stale (verified 2026-09-07, ADR-428):** `device_property_loader.py`
   is imported by nothing but its own test — no component reads this
   file, and `state/full` carries no property values (ADR-002; the
   `prop_count` tail it once fed is gone). Editing `properties` here
   changes nothing at runtime. The four `properties` blocks above are
   a historical record, not configuration.
2. Add the `(className, propertyName)` entry to
   `PropertyComponent.py`'s `ALLOWLIST` — that is the only registration.
   A row that has no LOM attribute behind it (the Drum Rack's `vm.*`
   virtual macros) is a `computed=` spec whose provider owns the value;
   see ADR-428.
3. Quit Live fully and relaunch (bytecode cache).
4. UI subscribes via `/looping/v3/property/subscribe`; reads via
   `selectedTrackStore.propertyValue(devicePath, name)`.

## Related Scripts

- `scripts/generate-places-catalog.ts` - Generates the browser's Places catalog

## Related Documentation

- [Extending devices](../docs/reference/extending-devices.md)
- [Wire protocol — property ops](../docs/reference/wire-protocol.md)
- [ADR-088: Simpler Property Cache Migration](../docs/adr/088-simpler-property-cache-migration.md)
