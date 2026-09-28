# ADR-347: Streamline `device-configs.json` to its post-Python-migration job

## Status
**Accepted**

## Context

`data/device-configs.json` was originally a multi-purpose hub that fed the
old Max-for-Live observer pipeline. It declared which parameter indices to
observe per device, held device-init rules, mapped string component names
to UI dispatch, and carried preset paths and color schemes for the device
browser. Different consumers read different sub-keys; nothing wrote to it.

The Phase 5–12 Python Control Surface migration superseded most of that:

- The Python surface now observes **all** parameters on every device
  directly via `device.parameters` in
  `surface/components/LOMListeners.py`. No JSON filter.
- Device init rules live in the hand-written `_INIT_RULES` table in
  `DeviceInitComponent.py`; the JSON's `deviceInitializations` block —
  which a stale docstring still claimed as authoritative — does not
  exist at runtime.
- The runtime property allowlist is a hardcoded `ALLOWLIST` in
  `PropertyComponent.py`; `device_property_loader.py` reads only the
  list of LOM property paths from `device-configs.json` to decide what
  to project into `state/full`.
- The UI's FX grid imports its Svelte control components statically in
  `interface/src/lib/config/fxGridLayout.ts`; the JSON's `ui.component`
  string is never dispatched on.
- Preset paths and color schemes for the FX grid live in
  `interface/src/lib/config/devicePresets.ts`; the JSON's
  `insertion.presetPath` and `colors` are duplicates kept in sync only
  by hope.

What remains genuinely load-bearing in `device-configs.json` after the
migration is two jobs:

1. **`properties` — Python-side**. `device_property_loader.py` walks each
   entry's `properties` dict and ships the keys (LOM property paths like
   `sample.warp_mode`, `ir_category_index`) into
   `StateFullComponent`'s emitter for `state/full`. Omitting an entry
   here means the property never appears on the wire even if
   `PropertyComponent.ALLOWLIST` permits it.
2. **`parameters` — UI-side name→index lookup**. Six central views (EQ,
   Reverb, Pitch, Chorus, Utility, Echo) call
   `interface/src/lib/utils/parameterLookup.ts` to resolve a parameter
   by *name* into an index, min/max range, and an optional `default`
   used to seed initial UI state. Without the JSON these views would
   need to scan the live param tree by name on every render, or hardcode
   indices.

A third role — the device browser metadata exposed by
`interface/src/lib/configs/UnifiedDeviceConfigs.ts`
(`getInsertableDevicesByCategory`, `getRecommendedDevices`,
`searchDevices`) — has zero call sites today. Kept on the principle
that ready-made device-picker metadata is cheap to leave, expensive to
recreate.

The remaining sub-keys (`ui`, `colors`, `enhanced`,
`insertion.insertName`, `insertion.presetPath`, `insertion.icon`,
`insertion.insertable`, `insertion.moveToTopOnLoad`,
`parameters[].dataType`, the never-existed `deviceInitializations`)
were vestigial: declared in TS interfaces, never branched on at
runtime.

## Decision

Strip `device-configs.json` and its TypeScript surface to fields with a
real consumer; fix the lying docstring; do not delete any device entries.

### JSON shape after the change

```jsonc
{
  "<ClassName>": {
    "parameters": {
      "<index>": {
        "index": <int>,
        "name": "<LOM name>",
        "displayName": "<UI label>",
        "min": <num>,
        "max": <num>,
        "default": <num>?
      }
    },
    "properties": {
      "<dotted.path>": { "type": "<type>", "description": "<…>" }
    },
    "insertion": {
      "displayName": "<browser name>",
      "category": "<group>",
      "description": "<…>",
      "recommended": <bool>?
    }
  }
}
```

Removed top-level: `enhanced`, `ui`, `colors`, `maxParameters`,
`initialization`. Removed from `insertion`: `insertName`, `presetPath`,
`icon`, `insertable`, `moveToTopOnLoad`. Removed from each parameter:
`dataType`. Result: file shrinks ~3500 → ~2800 lines (~20%) without
losing a single device entry.

### TypeScript tightening

`UnifiedDeviceConfigs.ts` interfaces collapse to `ParameterMeta`,
`InsertionConfig`, and `UnifiedDeviceConfig`. The dead exports
(`getDeviceUIConfig`, `getUnifiedConfigStats`, `UIConfig`,
`DeviceColors`, `DeviceInitializationConfig` and its action union)
are deleted. `parameterLookup.ts` drops `dataType` from
`ParameterConfig` and prunes its parallel `DeviceConfig` shadow type.

`DeviceColors` had one consumer (`contexts/deviceColors.ts`) so it
moves there as a local interface — separation by use, not pre-emptive
sharing.

### Python docstring fix

`DeviceInitComponent.py` had a docstring claiming the JSON's
`deviceInitializations` key was authoritative and warning the rule
table "MUST match" it. The key has never existed in the current
iteration of the JSON. Updated to state that `_INIT_RULES` is itself
authoritative; the JSON does not carry init rules.

### Documentation

`data/CLAUDE.md` rewritten to describe the file's actual two jobs
(Python `properties` projection; UI parameter-name lookup), with
cross-references to `devicePresets.ts` for colors/preset paths and
`DeviceInitComponent.py` for init rules. Adding a property is now
documented as a two-side workflow: JSON entry **and**
`PropertyComponent.ALLOWLIST` entry.

### Out of scope

Three follow-ups deferred to keep this ADR's blast radius small:

- The 14 unreferenced device entries (AutoPan, Collision, Echo,
  Operator, Wah, …). User chose "keep, future use is plausible."
- Migrating the six central views from `parameterLookup.ts` to
  wire-derived param-name resolution, which would let `parameters`
  blocks be deleted entirely.
- The dead device-browser exports in `UnifiedDeviceConfigs.ts`.

## Consequences

**Positive:**
- Single source of truth for each piece of data: presets and colors in
  `devicePresets.ts`, init rules in `DeviceInitComponent._INIT_RULES`,
  property allowlist in `PropertyComponent.ALLOWLIST`. The drift
  hazards (JSON `presetPath` vs. TS `presetPath`, JSON `colors` vs. TS
  `color`) are gone.
- TypeScript interfaces describe what the JSON actually contains, not
  what it once contained. `npm run check` will now catch reads of
  removed fields immediately.
- Smaller file is easier to review when adding a device. The two real
  jobs are visible at a glance instead of buried under decorative keys.
- The `deviceInitializations` docstring no longer lies. New
  contributors won't waste time editing the JSON expecting init
  behavior to follow.

**Negative:**
- The change is a one-time hand-edit of every device entry; future
  device additions need to follow the slimmer schema. Mitigated by
  `data/CLAUDE.md` documenting the new shape.
- `default` was very nearly removed during planning — the audit
  initially flagged it as unused. Reading the central views
  invalidated that. A future reviewer might repeat the mistake. The
  ADR makes the load-bearing role of `default` explicit:
  EQ/Chorus/Pitch/Utility/Echo views read it via
  `configDefaults[idx]?.default`.
- TS callers that imported `DeviceColors` from `UnifiedDeviceConfigs`
  must now import from `contexts/deviceColors`. Only one such caller
  existed.

**Rejected alternatives:**
- *Delete unreferenced device entries.* Would shrink the file further
  but lose ready-to-go metadata for devices we may bring back. Cost of
  keeping is bytes; cost of recreating is research.
- *Make the JSON the runtime authority for init rules / property
  allowlist.* Would centralize, but introduces a startup-failure mode
  (Python panics if the JSON is unparseable or missing) and forces a
  Live restart loop per JSON edit. Hand-written Python tables are
  faster to iterate on.
- *Generate the JSON from TS.* Premature; the file is ~50 entries and
  hand-edited rarely. Codegen can come if entry count multiplies.
- *Build-time validator that fails when `devicePresets.ts` and
  `device-configs.json` colors / preset paths drift.* Solves a problem
  this ADR removes by deleting the duplicate fields outright. Simpler
  to delete than to police.

## Tags

`device-configs`, `python-migration`, `cleanup`, `single-source-of-truth`,
`property-allowlist`, `parameter-lookup`, `unified-device-configs`,
`technical-debt`
