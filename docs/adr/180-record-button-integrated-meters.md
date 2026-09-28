# ADR 180: Record Button Integrated Meters

**Date:** 2025-01-27
**Status:** Implemented
**Context:** Capture System, Track Metering

## Problem

Users have no visual feedback about audio levels when using the record-to-simpler buttons. This makes it difficult to:

1. Know if signal is present before arming recording
2. Monitor levels during recording to avoid clipping
3. Verify the correct audio source is routed

## Decision

Add integrated meter visualizations to both record buttons, each showing different signal sources:

| Button | Location | Signal Source | Purpose |
|--------|----------|---------------|---------|
| RecordButton | Sidebar | Audio interface input | Monitor input before/during capture |
| REC TO SIMPLER | ClipCentralView | Current track output | Monitor what's being sent to recorder |

### Why Two Different Meters?

The sidebar button is for capturing external audio (microphone, instrument), so it shows the **input level**. The clip view button routes the current track's output to the recorder, so it shows the **track output level**.

## Implementation

### Sidebar RecordButton (Input Meter)

Uses a new OSC message from the Max patch:

```
/capture/meter [float 0.0-1.0]
```

- Sent to bridge port 9001
- Handled by `captureStore.handleMessage()`
- Stored in `captureStore.meterLevel`

### ClipCentralView Button (Track Meter)

Reuses existing track meter infrastructure:

```typescript
$effect(() => {
  const trackIndex = session.selectedTrackIndex;
  if (trackIndex < 0) return;

  const observer = useMaxTrackObserver(trackIndex, false, {
    onTrackUpdate: (property, value) => {
      if (property === 'meterLevel' && typeof value === 'number') {
        trackMeterLevel = value;
      }
    }
  });

  observer.initialize();
  return () => observer.cleanup();
});
```

### Visual Design

Both meters use identical CSS for consistency:

- **Gradient**: Green (0%) → Lime (25%) → Yellow (50%) → Orange (75%) → Red (100%)
- **Rendering**: CSS `clip-path` with CSS custom property `--clip-top`
- **Animation**: 50ms transition for visual smoothing
- **Opacity**: 0.4 normal, 0.6 when clipping (>90%)

```css
.meter-fill {
  background: linear-gradient(to top, #22c55e 0%, #84cc16 25%,
    #eab308 50%, #f97316 75%, #ef4444 100%);
  clip-path: inset(var(--clip-top) 0 0 0);
  transition: clip-path 0.05s ease-out;
  opacity: 0.4;
}
```

## Alternatives Considered

### 1. Separate Meter Components

Could have created dedicated meter components next to buttons.

**Rejected because:**
- Takes additional screen space on iPad
- Less intuitive connection between meter and button
- More complex layout management

### 2. Single Meter Source for Both

Could use track meter for both buttons.

**Rejected because:**
- Sidebar button captures external input, not track output
- Different use cases require different signal sources
- Input metering helps before any track is selected

### 3. Peak Hold Indicators

Could add peak hold dots that slowly decay.

**Deferred because:**
- Adds complexity for minimal benefit
- Current design is sufficient for monitoring
- Can be added later if needed

## Consequences

### Positive

- Immediate visual feedback for recording levels
- Reuses existing meter infrastructure (no new OSC polling)
- GPU-accelerated rendering via CSS clip-path
- Consistent visual language with existing meters

### Negative

- Max patch must send `/capture/meter` messages (additional implementation required)
- Two different data sources to maintain
- Slightly increased CPU usage from track observer in ClipCentralView

## Files Changed

- `interface/src/lib/stores/v6/captureStore.svelte.ts` - Added meterLevel state
- `interface/src/lib/components/v6/controls/RecordButton.svelte` - Added meter visualization
- `interface/src/lib/components/v6/central/views/ClipCentralView.svelte` - Added track meter observer
- `interface/src/__tests__/unit/stores/captureStore.test.ts` - Added meter tests

## Max Patch Requirements

The capture Max device needs to send input meter data:

```
/capture/meter [float 0.0-1.0]
```

- Send to `127.0.0.1:9001` (bridge max4Live port)
- Recommended update rate: 30-60Hz
- Signal source: Pre-fader input level
