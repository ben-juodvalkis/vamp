# ADR 104: System Panel TotalMix Integration

**Status**: Superseded
**Date**: 2025-01-04
**Superseded Date**: 2025-01-04
**Deciders**: Development Team
**Related**: ADR 036 (Master Track Device Parameter Support)

> **Note**: This ADR has been superseded. The TotalMix sliders described below have been commented out in favor of an alternative approach for handling audio interface controls. The implementation code remains in [SystemCentralView.svelte](interface/src/lib/components/v6/central/views/SystemCentralView.svelte) as commented-out code for reference.

## Context

The master track in the looping system serves as a natural entry point for system-wide controls. Users need quick access to audio interface controls (TotalMix) for adjusting room mic levels, playback monitoring, click track volume, and master volume without leaving the performance interface.

Previously, double-tapping the master track title opened a System panel that only contained session management features (track cleanup and session reset). This was underutilized real estate that could provide more value with hardware integration controls.

## Decision

We have implemented a System panel accessible via single-tap on the master track title that includes:

1. **Four Vertical Sliders** for TotalMix control:
   - Room Mic (0-1 range)
   - Playback (0-1 range)
   - Click (0-1 range)
   - Volume (0-1 range)

2. **OSC Routing** via `/totalmix/` prefix to port 11004:
   - `/totalmix/room_mic`
   - `/totalmix/playback`
   - `/totalmix/click`
   - `/totalmix/volume`

3. **Simplified Interaction**:
   - Changed from double-tap to single-tap for faster access
   - Removed session reset functionality (cleanup remains)
   - Streamlined UI to focus on frequently-used controls

## Technical Implementation

### Component Architecture

**SystemCentralView.svelte** uses the existing `DeviceSlider` component:
- Vertical orientation for touch-friendly control
- Orange color scheme (`#ff8800`) matching master track
- Range 0-1 with smooth interpolation
- Throttled OSC updates at ~60 FPS

### OSC Bridge Routing

**enhanced-osc-bridge.js** routes `/totalmix/` messages to the MIDI Converter port (11004):
```javascript
if (address.startsWith('/totalmix/')) return 'midiConverter';
```

This reuses the existing infrastructure for MIDI pitch/mod wheel messages, allowing external OSC receivers on port 11004 to handle TotalMix integration.

### Master Track Interaction

**MasterTrack.svelte** simplified tap handling:
- Removed double-tap detection logic
- Single tap on title immediately opens System panel
- Updated tooltip: "Tap to open System panel"

## Consequences

### Positive

- **Fast Hardware Access**: Single tap provides immediate access to audio interface controls
- **Performance-Focused**: Critical mix controls available without disrupting performance flow
- **Reuses Infrastructure**: Leverages existing port 11004 routing and DeviceSlider component
- **Clean UI**: Removed rarely-used session reset feature in favor of frequently-used hardware controls
- **Touch-Optimized**: Large vertical sliders designed for iPad interaction

### Negative

- **External Dependency**: Requires external OSC receiver on port 11004 to interpret `/totalmix/` messages
- **No Feedback**: Sliders are send-only; no bidirectional sync with TotalMix state
- **Generic Names**: Slider names are generic and may not match specific TotalMix channel names

### Neutral

- Session reset functionality removed (can be accessed via menu or other means if needed)
- Track cleanup remains as single button below sliders

## Alternatives Considered

1. **Keep Double-Tap**: Rejected due to slower interaction and accidental activation issues
2. **Use `/midi/` Prefix**: Rejected to semantically separate MIDI wheel messages from audio interface controls
3. **Bidirectional Sync**: Deferred due to complexity; can be added later if TotalMix provides OSC feedback
4. **Dedicated TotalMix Port**: Rejected to avoid adding another UDP port; reusing 11004 is simpler

## Future Enhancements

- Add OSC learning mode to map sliders to any TotalMix parameter
- Implement bidirectional sync if TotalMix OSC API supports it
- Add configurable slider labels via constants.json
- Expand to 8 sliders if additional controls are needed
- Add preset recall for different TotalMix configurations

## References

- [TotalMix OSC Documentation](https://www.rme-audio.de/totalmix-fx.html)
- [DeviceSlider Component](interface/src/lib/components/v6/device-panel/DeviceSlider.svelte)
- [Enhanced OSC Bridge](interface/bridge/enhanced-osc-bridge.js)
- ADR 036: Master Track Device Parameter Support
