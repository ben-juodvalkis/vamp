# ADR-169: System Central View Tempo and Time Signature Controls

## Status
Accepted

## Context
The System Central View (shown when master track is selected) was largely empty, containing only a "Clean Up Tracks" button and commented-out TotalMix sliders. This wasted valuable screen real estate that could provide quick access to essential session controls.

The session header already had draggable tempo and time signature controls, but they were small and optimized for information display rather than precise adjustment.

## Decision
Add large, draggable tempo and time signature controls to the System Central View:

### Layout
```
┌──────────────────────────────────────────┐
│                                          │
│       120          4  /  4               │
│       BPM           Time                 │
│                                          │
│          [ Clean Up Tracks ]             │
└──────────────────────────────────────────┘
```

### Tempo Control
- **Display**: Integer only (rounded from session.tempo)
- **Range**: 20-999 BPM
- **Sensitivity**: 0.1 (low, for fine-tuning - ~10px drag per BPM)
- **OSC**: `/live/song/set/tempo [value]`

### Time Signature Control
- **Numerator**: 1-32, sensitivity 0.05
- **Denominator**: Steps through [1, 2, 4, 8, 16], sensitivity 0.015
- **OSC**: `/live/song/set/signature_numerator` and `/live/song/set/signature_denominator`

### Visual Design
- Orange color scheme (#ff8800) matching master track styling
- 6rem font size for both tempo and time signature digits
- Hover state: 10% orange background
- Active (dragging) state: 20% orange background
- Labels below each control ("BPM", "Time") in muted orange

### Implementation Pattern
- Separate `$effect()` blocks for tempo and time signature drag listeners
- Global mouse/touch event listeners attached on drag start, cleaned up on end
- Throttled updates - only sends OSC when value actually changes
- Touch and mouse support for iPad compatibility

## Consequences

### Positive
- Quick access to tempo and time signature from master track view
- Low sensitivity allows precise tempo adjustments during performance
- Integer-only tempo display reduces visual noise
- Consistent orange color scheme reinforces "system/master" context

### Negative
- Some code duplication with SessionHeaderV6.svelte drag logic (acceptable for 2 instances)

## Related
- Issue #272 - Original feature request
- SessionHeaderV6.svelte - Reference implementation for smaller header controls
- ADR-104 - TotalMix integration (superseded, sliders commented out)
