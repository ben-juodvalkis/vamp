# ADR-331: Compressor Makeup Auto Toggle

**Date**: 2026-02-04
**Status**: Accepted

---

## Context

The Compressor2 device in Ableton Live has a "Makeup" parameter (index 8) that enables automatic makeup gain — compensating for volume reduction caused by compression. This parameter was not exposed in the device configuration or UI, requiring users to adjust it manually in Ableton's native interface.

## Decision

Add the Makeup parameter (index 8) to the Compressor2 device configuration with a default value of 1 (on), and expose it as a toggle button labeled "MU" in both the UtilityCentralView and CompressorCentralView.

### Implementation

1. **Device config** (`data/device-configs/Compressor2.json`): Added parameter index 8 with `"default": 1`
2. **UtilityCentralView**: Added "MU" toggle button alongside existing compressor controls
3. **CompressorCentralView**: Added "MU" toggle button in the dedicated compressor view

The toggle reads the current parameter value and sends the inverse (0 or 1) via the standard device parameter OSC path.

## Files Changed

| File | Change |
|------|--------|
| `data/device-configs/Compressor2.json` | Added parameter index 8 (Makeup) with default 1 |
| `interface/src/lib/components/v6/central/views/UtilityCentralView.svelte` | Added MU toggle button |
| `interface/src/lib/components/v6/central/views/CompressorCentralView.svelte` | Added MU toggle button |

## Consequences

### Positive

- Auto makeup gain controllable from the iPad without switching to Ableton
- Default on (1) matches typical live looping use case where you want volume-compensated compression
- Consistent toggle pattern already used for other compressor controls

### Negative

- None significant — small, focused change

## Tags

`device-control`, `compressor`, `ui`
