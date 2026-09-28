# ADR-319: Replace AutoPan and AutoFilter with Movement Device

## Status
Accepted

## Context
The FX grid used three Ableton stock devices for tremolo and filter effects:
- **AutoPan (legacy)** — temporary workaround for AutoPan2 bug (ADR-015)
- **AutoPan2** — virtual device loaded alongside legacy AutoPan for the central view
- **Auto Filter** — Ableton's built-in resonant filter with LFO

These are replaced by **Movement**, a custom Max4Live audio effect with 2D waveshape morphing (Asym + Curve), transport-locked sync, swing groove, and switchable amplitude/filter modes. Movement provides a unified modulation engine where the same LFO shape controls drive both tremolo and filter effects, with richer waveshaping than the stock devices.

Two presets from the same parent device (`MxDeviceAudioEffect`):
- `movement-tremolo.adv` — Mode 0 (amplitude modulation)
- `movement-filter.adv` — Mode 1 (filter cutoff modulation)

## Decision
Replace both grid slots (fx4: filter, fx5: tremolo) and their central views with Movement-specific components. Remove the autopan2 virtual device entirely since Movement's central views provide all needed controls.

## Movement Parameters

| # | Name | Type | Range | Notes |
|---|------|------|-------|-------|
| 1 | Amount | Float | -1 to 1 | Bipolar depth |
| 2 | Sync Mode | Enum | 0/1 | Free/Sync |
| 3 | Rate | Float | 0.1-20 | Hz (free mode) |
| 4 | Division | Int | 1-16 | Sixteenths (sync mode) |
| 5 | Asym | Float | 0-1 | Waveshape asymmetry |
| 6 | Curve | Float | -1 to 1 | Waveshape bend |
| 7 | Offset | Float | 0-1 | Phase offset |
| 8 | Swing | Float | 0.5-0.75 | Cycle pair timing |
| 9 | Mode | Enum | 0/1 | AMP/FILTER |
| 10 | Cutoff | Float | 40-18000 Hz | Filter cutoff |
| 11 | Resonance | Float | 0-1 | Filter resonance |

## Changes

### New Files
- `MovementTremoloControl.svelte` — Grid XY pad: X=Rate/Division (with label), Y=Amount
- `MovementFilterControl.svelte` — Grid XY pad: X=Cutoff, Y=Resonance (with lowpass curve)
- `MovementTremoloCentralView.svelte` — Waveform visualization (ported from movement-display.js) + Asym/Curve/Swing sliders + Sync + Offset
- `MovementFilterCentralView.svelte` — Filter waveform viz + Rate/Amount XY pad + Asym/Curve/Swing + Sync + Offset

### Modified Files
- `devicePresets.ts` — tremolo/filter configs → Movement presets, removed autopan2
- `fxGridLayout.ts` — Swapped grid component imports
- `viewRegistry.ts` — Points to Movement central views, removed autofilter alias
- `parameterLookup.ts` — Extended `getConfigKey()` to disambiguate `MxDeviceAudioEffect` by name
- `device-configs.json` — Added parameter metadata for both Movement presets

### Deleted Files
- `AutoPanLegacyControl.svelte`, `AutoPan2Control.svelte`, `AutoFilterControl.svelte`
- `TremoloCentralView.svelte`, `AutoFilterCentralView.svelte`

### Architecture Notes
- Central views port the waveform math from `movement-display.js` (v8ui) to reactive SVG paths
- Both views use standard `DeviceXY` and `DeviceSlider` components (same as all other central views)
- `MxDeviceAudioEffect` disambiguation uses `className:defaultName` format in device-configs.json (same pattern as `AuPluginDevice`)

## Consequences

### Positive
- Unified modulation engine with richer waveshaping than stock devices
- Real-time waveform visualization in central views shows exact LFO shape
- Eliminates the AutoPan2 bug workaround (ADR-015 superseded)
- Removes virtual autopan2 device complexity

### Negative
- Movement is a custom Max4Live device (external dependency at `/Users/Shared/DevWork/GitHub/movement`)
- Users need the Movement device installed for these effects to work

## Supersedes
- ADR-015 (Temporary AutoPan Legacy Device Replacement)
