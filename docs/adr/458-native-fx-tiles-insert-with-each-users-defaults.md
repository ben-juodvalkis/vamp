# ADR-458: Native FX Tiles Insert Live's Own Device, With Each User's Defaults

## Status
**Accepted** (2026-09-28; recorded 2026-10-13). Protocol 3.12.0.
Supersedes ADR-430's "the app's presets become Live's defaults"
(`install-device-defaults` and the byte-identical check). ADR-430's
pad-chain loads stand. For native tiles it also ends the preset-file
paths of ADR-079 and ADR-137. Commits `a87ac4d` and `a542e98`.

## Context
Every FX-grid tile named a preset file, `{effectPresetsBase}/X.adv`, in
a folder only the owner's Mac has. On any other Mac every tile failed
silently (`path-not-found`), so a fresh install's FX grid did nothing.

ADR-430 had already built an insert-by-name path (`insert_device` with
the display name, a rename, one undo step). But it was taken only when
Live's user default for the device was byte-identical to the owner's
preset file. `scripts/install-device-defaults.mjs` overwrote Live's
defaults to make that true, which no other Mac had run.

Ben's call (2026-09-28): trust each user's defaults, with no starting
values in code. The owner's tuned sound is already his Live defaults.

## Decision
**A tile that is a single native Live device names no file.** It sends
`device/load` with an empty `presetPath`, source `native:<class>` (the
class Live reports: `Hybrid`, `AutoFilter2`, `MidiRandom` …) and the
tile's name. The surface always inserts it by name
(`Chain.insert_device` / `Track.insert_device`). Live applies that
user's own default for the device (`Defaults/Audio Effects` or
`Defaults/MIDI Effects` in their User Library), else the factory
settings. The surface renames the device to the tile's name (`Reverb`,
not `Hybrid Reverb`) in the same undo step.

**The class → display-name map has no fallback.** It was measured on
Live 12.4.15b2 by inserting each name, and many rows can't be derived
from the class string (`StereoGain` → Utility, `Hybrid` → Hybrid
Reverb). An unknown class is refused as `load-failed` with `detail`
`unknown-device: <class>`. An insert Live refuses or won't rename is
`insert-refused`. Both name `native:<class>` as the error's `path`,
which the UI's slot reset matches (`loadKey`).

**Racks, plug-in presets and Max devices stay files**, loaded through
the browser. The app's own Max devices and presets load from the
"Vamp Devices" Place (protocol 3.11.0). A user's own preset of a native
device still loads through the browser as that preset.

**Removed:** `install-device-defaults`, the byte-identical check and the
`.adv` class sniffing.

The Tremolo tile followed on 2026-10-01: Live accepts
`insert_device("Auto Pan Legacy")` (the earlier refusal was for "Auto
Pan"). The Gain view's Multiband Dynamics sliders (2026-10-09) insert by
name the same way. `devicePresets.ts` has 22 native entries today.

## Consequences
- The FX grid works on any Mac with no setup, and each user hears
  devices the way they set them up in Live.
- The owner's sound depends on his Live defaults. Resetting them changes
  what a tile inserts, and nothing in the repo records the tuned
  settings.
- A native insert is one undo step in place: no track republish and no
  change of selection.
- 3.12.0 changes no arities, but the UI speaks only 3.12.0. Until Live
  restarted and loaded the new surface, the page refused the handshake.
- A new native tile needs its class in the surface's
  `NATIVE_DEVICE_NAMES` and in the tile's `expectedClassName`, measured
  on the running Live.

## Tags
`fx-grid`, `device-load`, `native-devices`, `user-defaults`, `protocol-3.12`, `general-release`
