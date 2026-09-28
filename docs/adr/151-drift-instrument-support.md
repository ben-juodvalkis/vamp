# ADR-151: Drift Instrument Support

## Status

Accepted

## Date

2026-01-05

## Context

Drift is Ableton Live's organic synthesizer with a distinctive filter and time-based modulation system. Adding support for Drift as a recognized instrument type enables a dedicated central view with XY controls for its key parameters.

### Requirements

- Detect Drift devices by className (`Drift`)
- Display dedicated DriftCentralView when Drift is the active instrument
- Provide XY controls for Filter (Cutoff/Resonance) and Time parameters
- Follow ADR-149 patterns for `$derived` reactivity

## Decision

Add Drift as a recognized instrument type with a dedicated central view containing two XY pads:

1. **Filter XY**: Controls Cutoff (param 1) and Resonance (param 2)
2. **Time XY**: Controls Time X (param 35) and Time Y (param 37)

### Implementation

#### Type System Updates

Added `'drift'` to `InstrumentType` union in:
- `interface/src/lib/services/instrumentService.ts`
- `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts`

#### Detection Logic

Added className detection in both files:
```typescript
if (className === 'Drift') return 'drift';
```

Also added `'Drift'` to `INSTRUMENT_CLASSES` array in instrumentService.ts.

#### Device Configuration

Added Drift to `data/device-configs.json` with 4 parameters:
- Parameter 1: Cutoff (0-1, default 1)
- Parameter 2: Resonance (0-1, default 0)
- Parameter 35: Time X (0-1, default 0.5)
- Parameter 37: Time Y (0-1, default 0.5)

This enables Max to query these parameters in the complete state message.

#### Central View

Created `DriftCentralView.svelte` following ADR-149 patterns:
- Uses `$derived` for all parameter values (not `$state` + `$effect`)
- Simple handlers that call `selectedTrackStore.setParameter()`
- 2-column grid layout with Filter and Time XY pads
- Cyan/teal color scheme (`#06b6d4`) matching Drift's aesthetic

#### View Registry

Registered `'drift'` in `viewRegistry.ts` instrument section.

## Consequences

### Positive

- Drift devices now have a dedicated control interface
- Filter and Time parameters accessible via intuitive XY pads
- Follows established patterns for instrument views
- Lazy-loaded component keeps bundle size minimal

### Negative

- Only 4 parameters exposed initially (Drift has many more)
- Future expansion will require device-configs.json and view updates

### Future Enhancements

Additional parameters could be added:
- Shape/Character controls
- Modulation routing
- Voice settings

## Files Changed

| File | Change |
|------|--------|
| `interface/src/lib/services/instrumentService.ts` | Added 'drift' to InstrumentType, INSTRUMENT_CLASSES, detection logic |
| `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` | Added 'drift' to InstrumentType, detection logic |
| `interface/src/lib/components/v6/central/viewRegistry.ts` | Registered DriftCentralView |
| `interface/src/lib/components/v6/central/views/DriftCentralView.svelte` | New component |
| `data/device-configs.json` | Added Drift device configuration with 4 parameters |

## Related

- ADR-149: Central View $derived Reactivity Pattern
- ADR-049: Complete State Architecture
