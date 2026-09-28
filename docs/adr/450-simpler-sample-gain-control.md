# ADR-450: Simpler Sample Gain Control

## Status
Accepted

## Context
The SimplerCentralView needed a gain control for adjusting the sample volume. Unlike regular device parameters, `sample.gain` is a LiveAPI property that requires:
1. Configuration in `device-configs.json` for complete state loading
2. A bipolar UI control since gain has a natural center point (unity/0dB)

## Decision

### Property Configuration
Added `sample.gain` to the OriginalSimpler properties in `data/device-configs.json`:
```json
"sample.gain": {
  "name": "Sample Gain",
  "type": "float",
  "description": "Sample gain (0-1, 0.5 = unity)"
}
```

This ensures the gain value is queried during `buildCompleteDeviceState()` and available immediately when navigating to a Simpler track.

### DeviceSlider Center Origin Mode
Added `centerOrigin` and `centerValue` props to DeviceSlider for bipolar controls:

```typescript
centerOrigin?: boolean;  // Fill expands from center instead of bottom
centerValue?: number;    // Value representing center (default: midpoint)
```

When enabled:
- A center line indicator shows the unity position
- Fill bar expands upward when value > centerValue
- Fill bar expands downward when value < centerValue

### UI Layout
Positioned the GAIN slider in the bottom row of the central column, to the left of the TIME XY pad:
- Width: 160px (`w-40`)
- Range: 0-1 with center at 0.5
- Uses emerald color scheme to match Simpler theme

## Layout

```
┌─────────┬────────────────────────────────┬─────────┐
│ CLASSIC │         POSITION               │  WARP   │
│  /SLICE │      (Loop Brace)              │─────────│
│─────────│                                │  Beats  │
│         ├────┬─────────────────┬────────┤─────────│
│  FADE   │GAIN│     TIME        │ -1  +1 │  Cplx   │
│  /SENS  │    │     (XY)        │-12 +12 │─────────│
│         │    │                 │        │   Pro   │
└─────────┴────┴─────────────────┴────────┴─────────┘
```

## Consequences

### Positive
- Gain control loads correctly on track switch (no stale values)
- Center origin visualization provides intuitive feedback for boost/cut
- Reusable `centerOrigin` prop available for other bipolar controls

### Negative
- Additional property query adds minimal overhead to complete state

## Related
- [ADR-088: Simpler Property Cache Migration](088-simpler-property-cache-migration.md)
- [Guide: Adding Device Properties](../guides/adding-device-properties.md)
