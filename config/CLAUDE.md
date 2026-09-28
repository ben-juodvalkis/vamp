# Config - Single Source of Truth

All project-wide configuration lives here. **Never hardcode values that exist in `constants.json`.**

## Files

### `constants.json` (tracked): the general edition's defaults

The single source of truth for the entire project, the same on every clone. Used by Python, TypeScript and Node.js. The UI build compiles this file alone, and only what is the same on every machine (the role palette, gesture timing); a Mac's values reach clients at run time.

**Nothing about one Mac goes here** (general-release plan.md §3): no owner path, address, hardware map or switch turned on. Those go in `constants.local.json`.

**Contains:**
- Feature switches (`features`: one boolean per bespoke subsystem, general-release audit §7b), every one `false` here. Only an explicit `true` is on — a missing switch is off, never a default. The bridge reads them once at startup and sends clients `/bridge/features`, so flipping one needs a bridge restart and no iPad rebuild. `docs/reference/toggles.md` has what each does when off
- OSC port configuration (all port pairs for bridge communication), including the TotalMix blocks, read only while `features.totalmix` is on
- Timing constants (debounce, batch rates)
- Instrument transpose settings
- Audio defaults and device configuration
- UI theme colors and patterns
- The browser's catalog switches (`catalog`: `source` disk or index, the depth cap). Which Places are cataloged is not config: it is `logs/places.json`, ticked in Settings, and the Places themselves come from Live's own `Library.cfg`, as do the User Library and the Packs when a Mac sets no path. The surface finds Permute and MidiWheels in the checkout it runs from (`Vamp Devices`)

### `constants.local.json` (gitignored): one Mac's differences

Laid over `constants.json` by everything on the Mac: the bridge and the scripts through `interface/bridge/utils/constants.js`, the interface server through `interface/src/lib/server/runtimeConfig.ts`, the surface through `surface/config_loader.py` (a Live restart to take effect). Objects merge key by key; any other value replaces. No file is the general edition.

The owner's rig holds its switches (all on), its paths (`paths.*`: the User Library, the preset folders, the Sidebar, Live's app, the browser blocker), `network.hostname` and the iPad's addresses, `audio.defaultInputChannel`, the pedal CCs (`midiPedals`), the wah (`devices.wah`) and its Places tuning (`catalog.places`). Another Mac of the owner's needs its own copy: nothing syncs it.

### `constants.schema.json`

JSON Schema for `constants.json`, for the editor. Nothing validates against it. `npm run validate` is the setup check.

*(`trackTypes.json` and `omnisphere-consolidation-rules.js/.ts` were deleted
2026-09-23: nothing had read the first since b5ec46cbd or imported the second
since 2025-11. `constants.json.example` went on 2026-09-27: the tracked file is
what a fresh clone runs on.)*

## Important

- Editing either file affects the entire system - bridge, interface, and scripts all read them
- After editing, restart the dev server for changes to take effect
- Nothing copies the config into the build any more (2026-09-26): server modules read it from disk when they run, and the values a client needs about this Mac arrive from the bridge over `/bridge/machine`
