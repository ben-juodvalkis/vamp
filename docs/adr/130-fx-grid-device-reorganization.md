# ADR-052: FX Grid Device Reorganization - Digital and Comb Migration

**Date:** 2025-10-29  
**Status:** Accepted  
**Decision Makers:** User, Claude Code  

## Context

The FX grid had a Comb device occupying a grid position, but we needed to:
1. Replace the Comb grid position with a new Digital device
2. Move Comb functionality to the SmudgeCentralView for better organization
3. Expand Comb functionality with additional LFO controls

## Decision

We reorganized the FX grid and central view structure as follows:

### FX Grid Changes
- **Removed:** Comb device from FX grid position (row 1, column 4)
- **Added:** Digital device in the same grid position
- **Digital Configuration:**
  - Preset: `/Users/Shared/DevWork/GitHub/Looping/ableton/Presets/Effect Patches/Digital.adg`
  - Class: `AudioEffectGroupDevice`
  - Device Name: `Digital`
  - Grid control: Parameters 1-2 (0-127 range, defaults to 0,0)
  - Central view: Parameters 3-4 LFO control (0-127 range, defaults to 64,0)

### Comb Configuration
- **Main Control:** Parameters 1,2,3 (moved from grid to SmudgeCentralView)
- **LFO Control:** Parameters 4-5 (defaults to 0.5,0 - halfway X, bottom Y)

### SmudgeCentralView Expansion
- **Added:** Comb device control (moved from FX grid)
- **Added:** Comb LFO control (parameters 4-5)
- **Layout:** 3-column grid accommodating:
  1. Chorus (existing virtual device)
  2. Comb (main device control)
  3. Comb LFO (additional XY control)

### Configuration Changes
- **Digital:** Grid device (`gridSlot: true`, default)
- **Comb:** Virtual device (`gridSlot: false`, `centralViewGroup: 'smudge'`)
- **Device Configs:** Updated `device-configs.json` to remove Comb entry, relies on `AudioEffectGroupDevice` for Digital

## Consequences

### Positive
- **Expanded FX Options:** Digital device provides new functionality in the grid
- **Consolidated Comb Controls:** Both main and LFO controls accessible in one view
- **Better Organization:** Related effects (Saturn/Smudge family) grouped together
- **Flexible Layout:** SmudgeCentralView can accommodate multiple related devices

### Technical Details
- **Parameter Ranges:** Digital uses 0-127 integer ranges with proper normalization
- **Central View Navigation:** Digital navigates to DigitalCentralView, Comb controls disable navigation
- **Device Loading:** Both grid and virtual devices use BaseDeviceControl for consistent behavior
- **Layout Scaling:** CSS Grid ensures controls fit properly across different screen sizes

### Files Modified
- `devicePresets.ts` - Device configuration updates
- `FXGrid.svelte` - Replaced CombControl with DigitalControl
- `DigitalControl.svelte` - New grid device component
- `DigitalCentralView.svelte` - New central view for Digital LFO
- `SmudgeCentralView.svelte` - Expanded to include Comb controls
- `CentralDisplay.svelte` - Added Digital central view routing
- `data/device-configs.json` - Updated parameter configurations

## Implementation Notes

### Device Control Patterns
- **Grid Devices:** Use `centralDisplayStore.setView()` for navigation
- **Virtual Devices:** Use `disableCentralViewOnTap={true}` to prevent navigation
- **Parameter Handling:** 0-127 ranges normalized to 0-1 for UI, converted back for Ableton

### Migration Strategy
The migration maintains backward compatibility while expanding functionality:
1. Existing Comb presets continue to work as virtual devices
2. Digital provides new grid functionality
3. SmudgeCentralView becomes a hub for distortion/modulation effects

This reorganization improves the logical grouping of effects while expanding the available control surface for both Digital and Comb devices.