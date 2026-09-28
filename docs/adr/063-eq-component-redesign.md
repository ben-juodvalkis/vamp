# ADR 054: EQ Component Redesign with Invisible Controls

**Date:** 2025-10-15
**Status:** Implemented
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Device Controls, EQ

---

## Context

The original EQ component had zone-based click interaction on a FilterCurve visualization with interactive dots. This design had several issues:

1. **Confusing Interaction Model**
   - Clicking in different zones (left 25%, center 50%, right 25%) controlled different parameters
   - Not intuitive which zone controlled what
   - No clear visual feedback for interaction zones

2. **Limited Visual Feedback**
   - Small interactive dots were hard to see and manipulate
   - Curve visualization was relegated to top 40% of component
   - Controls obscured the frequency response information

3. **Missing Output Gain Parameter**
   - Parameter 6 (Output Gain) existed in device but wasn't exposed in UI
   - Not included in `device-configs.json` for complete state tracking

4. **Svelte 5 Compatibility Issue**
   - Initial attempt to use `AbletonXY` component failed
   - AbletonXY uses Svelte 4 `export let` syntax
   - Incompatible with Svelte 5 runes mode (`$props()`)

## Decision

Redesign the EQ component with modern control patterns and invisible control overlays:

### 1. Control Layout

**FX Grid Component (EQControl.svelte):**
- **Background Layer (z-0):** FilterCurve visualization at full component size (200x200px)
- **Foreground Layer (z-10):** Three invisible control zones overlaid on curve
  - **BASS (left 1/3):** Vertical drag slider, label-only, no visible container
  - **MID (center 1/3):** DeviceXY pad for frequency (X) and gain (Y) control
  - **TREB (right 1/3):** Vertical drag slider, label-only, no visible container

**Central View (EQCentralView.svelte):**
- **Left side:** Large readable band indicators (Low/Mid/High with frequency and gain readouts)
- **Right side:** Output Gain VerticalSlider (new)
- **Removed:** FilterCurve visualization (cleaner, info-focused layout)

### 2. Component Architecture

**Replace AbletonXY with DeviceXY:**
- AbletonXY: Svelte 4 `export let` → breaks in runes mode
- DeviceXY: Svelte 5 `$props()` → works correctly
- DeviceXY: Established pattern used by 8+ central views (AutoFilter, Saturator, Drum, etc.)
- DeviceXY: Single `onInteraction(x, y)` callback (simpler than separate `onXChange`/`onYChange`)

**Invisible Control Pattern:**
```svelte
<!-- Bass/Treble: Custom drag handlers, no VerticalSlider component -->
<div class="h-full w-full flex items-center justify-center cursor-ns-resize"
  onpointerdown={(e) => {
    lowDragState.dragging = true;
    lowDragState.startY = e.clientY;
    lowDragState.startValue = lowGainValue;
    (e.target as Element).setPointerCapture(e.pointerId);
  }}
  onpointermove={(e) => {
    if (!lowDragState.dragging || !e.buttons) return;
    const deltaY = lowDragState.startY - e.clientY;
    const newValue = Math.max(0, Math.min(1, lowDragState.startValue + deltaY / 100));
    lowGainValue = newValue;
    sendParam(PARAM_CONFIG.lowGain.index, newValue);
  }}
>
  <span class="text-sm font-semibold text-foreground pointer-events-none">BASS</span>
</div>

<!-- Mid: DeviceXY with transparent border -->
<div class="flex-1 eq-xy-invisible">
  <DeviceXY {...props} />
</div>

<style>
  :global(.eq-xy-invisible .xy-container) {
    border-color: transparent !important;
  }
</style>
```

### 3. Configuration Updates

**Added Output Gain to device-configs.json:**
```json
"ChannelEq": {
  "parameters": {
    "2": { "index": 2, "name": "Low Gain", ... },
    "3": { "index": 3, "name": "Mid Gain", ... },
    "4": { "index": 4, "name": "Mid Freq", ... },
    "5": { "index": 5, "name": "High Gain", ... },
    "6": { "index": 6, "name": "Output Gain", "min": 0, "max": 1, "dataType": "float" }
  }
}
```

**Regenerated Max config:**
```bash
npm run generate:max-config
# ✓ ChannelEq → 5 parameters: [2, 3, 4, 5, 6]
```

Now Max queries parameter 6 in complete state messages, and UI stays in sync on track switch.

## Implementation Details

### EQControl.svelte (FX Grid)

**Before:**
- 40% FilterCurve + 55% Controls (vertical split)
- Zone-based click interaction on curve
- Interactive dots overlay

**After:**
- 100% FilterCurve background + 100% Controls foreground (layered)
- Three distinct control zones (BASS/MID/TREB)
- Invisible containers, labels only

**Key Features:**
- **Full-screen curve:** FilterCurve fills entire component (`absolute inset-0`)
- **Overlaid controls:** Transparent containers with pointer events
- **Ghost state support:** Triggers `triggerLoad()` on first interaction
- **Relative dragging:** BASS/TREB use pointer capture for smooth vertical drag
- **XY control:** MID uses DeviceXY for 2D frequency/gain control

### EQCentralView.svelte

**Before:**
- Large FilterCurve with grid and frequency labels
- Interactive dots
- Band indicators below

**After:**
- Clean layout: Band indicators (left) + Output Gain slider (right)
- No FilterCurve (redundant with FX grid visualization)
- Larger, more readable text
- Interactive output gain control

**Layout:**
```svelte
<div class="flex gap-4">
  <!-- Left: Band Indicators -->
  <div class="flex-1 flex flex-col items-center justify-center gap-8">
    <div class="flex flex-col gap-4 text-lg">
      <div>● Low: {gain}dB @ 80Hz</div>
      <div>● Mid: {gain}dB @ {freq}Hz</div>
      <div>● High: {gain}dB @ 12kHz</div>
    </div>
  </div>

  <!-- Right: Output Gain -->
  <div class="w-20">
    <VerticalSlider value={outputGainValue} ... />
  </div>
</div>
```

### Parameter Mapping

**ChannelEQ Device (Ableton Channel EQ):**
```
Index 2: Low Gain (0-1, shelf @ 80Hz, ±12dB range)
Index 3: Mid Gain (0-1, bell, ±12dB range)
Index 4: Mid Freq (0-1, 100Hz-10kHz logarithmic)
Index 5: High Gain (0-1, shelf @ 12kHz, ±12dB range)
Index 6: Output Gain (0-1, 0-100% output level)
```

**Frequency Calculation:**
```javascript
// Mid frequency: 100Hz to 10kHz logarithmic
const midFreq = Math.pow(10, 2 + midFreqValue * 2);
// midFreqValue=0 → 100Hz
// midFreqValue=0.5 → 1000Hz
// midFreqValue=1 → 10000Hz
```

**Gain Calculation:**
```javascript
// All bands: ±12dB range
const gain = (normalizedValue - 0.5) * 24;
// normalizedValue=0 → -12dB (cut)
// normalizedValue=0.5 → 0dB (flat)
// normalizedValue=1 → +12dB (boost)
```

### FilterCurve Band Configuration

```javascript
let bands = $derived([
  {
    freq: 80,        // Low shelf
    gain: (lowGainValue - 0.5) * 24,
    q: 0.71,         // Butterworth Q for smooth shelf
    type: 'lowshelf'
  },
  {
    freq: Math.pow(10, 2 + midFreqValue * 2),  // Mid bell (100Hz-10kHz)
    gain: (midGainValue - 0.5) * 24,
    q: 1.4,          // Musical Q for bell curve
    type: 'peak'
  },
  {
    freq: 12000,     // High shelf
    gain: (highGainValue - 0.5) * 24,
    q: 0.71,         // Butterworth Q for smooth shelf
    type: 'highshelf'
  }
]);
```

## Consequences

### Positive

✅ **Improved Visual Design**
- FilterCurve is prominent (100% of component)
- Controls don't obscure frequency response information
- Professional, minimalist appearance
- Maximum information density

✅ **Better Interaction Model**
- Clear control zones (BASS/MID/TREB)
- Familiar patterns (vertical sliders, XY pad)
- No confusing zone-based clicking
- Intuitive drag interactions

✅ **Complete State Support**
- Output Gain now in device-configs.json
- Max queries all 5 parameters on track switch
- UI reflects stored state correctly
- No missing parameters in complete state

✅ **Svelte 5 Compatibility**
- Replaced AbletonXY (Svelte 4) with DeviceXY (Svelte 5)
- Follows established pattern (8+ other central views)
- Simpler API (`onInteraction` vs separate X/Y callbacks)
- No compilation errors (500 error fixed)

✅ **Cleaner Central View**
- Removed redundant FilterCurve
- Focus on readable parameter values
- Added missing Output Gain control
- Better use of screen space

### Negative

⚠️ **Custom Drag Implementation**
- BASS/TREB don't use VerticalSlider component
- Inline pointer handlers (more code in template)
- Could be extracted to reusable component if pattern repeats
- Trade-off: flexibility vs reusability

⚠️ **Requires User to Reload Max Device**
- Output Gain parameter requires updated device-configs.js in Max
- User must restart Ableton or reload AbletonOSC V6 device
- One-time setup cost
- Documented in decision

⚠️ **Invisible Controls Trade-offs**
- Less obvious what's interactive (discoverability)
- Relies on user experimentation
- Works well for experienced users
- Could add subtle hover states if needed

### Neutral

➖ **Different from Other FX Devices**
- Other devices use visible VerticalSlider/DeviceXY components
- EQ uses invisible overlay pattern
- Justified by visual importance of frequency response curve
- Unique design appropriate for unique use case

## Alternatives Considered

### 1. Keep AbletonXY, Migrate to Svelte 5

**Considered:** Convert AbletonXY.svelte from `export let` to `$props()` syntax.

**Rejected Because:**
- AbletonXY barely used (only in old docs/archives)
- DeviceXY already established pattern (8+ components)
- DeviceXY simpler API (single callback vs separate X/Y)
- No benefit to maintaining two XY components
- Migration effort wasted on unused component

### 2. Use Visible VerticalSlider Components

**Considered:** Keep BASS/TREB as visible VerticalSlider components.

**Rejected Because:**
- VerticalSlider has border, background, fill indicator
- Would obscure FilterCurve (defeats purpose of full-screen curve)
- Less elegant visual design
- User requested invisible controls specifically

**Could Revisit If:**
- Discoverability becomes an issue
- Could add `transparent` prop to VerticalSlider
- Compromise: subtle border on hover only

### 3. Keep FilterCurve in Central View

**Considered:** Keep large FilterCurve visualization in central panel.

**Rejected Because:**
- Redundant with FX grid visualization
- Central panel better for precise readouts
- Screen space better used for output gain control
- User requested removal

### 4. Add Output Gain to FX Grid

**Considered:** Add output gain slider to FX grid component.

**Rejected Because:**
- FX grid space limited (already has 3 controls)
- Output gain less frequently adjusted than EQ bands
- Better fit for central panel (secondary control)
- Keeps FX grid focused on EQ curve

## Migration Path

### For Users

1. **Update device config:**
   ```bash
   npm run generate:max-config
   ```

2. **Reload Max device in Ableton:**
   - Restart Ableton Live, OR
   - Delete and re-add AbletonOSC V6 device

3. **Verify complete state:**
   - Switch between tracks with EQ
   - Output gain value should persist
   - Check Max console for "5 parameters" in complete state

### For Developers

**When adding new device parameters:**
1. ✅ Add to `data/device-configs.json`
2. ✅ Run `npm run generate:max-config`
3. ✅ Reload Max device in Ableton
4. ✅ Test track switching (verify complete state)

**When using XY pads:**
- ✅ Use DeviceXY (not AbletonXY)
- ✅ Follow pattern from AutoFilter/Saturator/etc.
- ✅ Single `onInteraction(x, y)` callback

**When needing invisible controls:**
- Consider this EQ pattern (inline drag handlers + CSS)
- Extract to reusable component if pattern repeats
- Balance discoverability vs visual design

## Related Decisions

- **ADR 038:** VerticalSlider Components (considered but not used for BASS/TREB)
- **ADR 040:** Complete State Architecture (why device-configs.json is critical)
- **ADR 042:** Device Configuration Completeness (Output Gain missing → added)
- **ADR 041:** Component State Management Pattern ($state + $effect for cache reads)

## References

- **Files Modified:**
  - `/Users/Shared/DevWork/GitHub/Looping/interface/src/lib/components/v6/device-panel/EQControl.svelte`
  - `/Users/Shared/DevWork/GitHub/Looping/interface/src/lib/components/v6/central/views/EQCentralView.svelte`
  - `/Users/Shared/DevWork/GitHub/Looping/data/device-configs.json`

- **Generated:**
  - `/Users/Shared/DevWork/GitHub/Looping/ableton/scripts/device-configs.js` (via npm run generate:max-config)

- **Component Used:**
  - `DeviceXY` (Svelte 5 compatible)
  - `VerticalSlider` (for Output Gain in central view)
  - `FilterCurve` (background visualization)

- **Commit:** (to be added after merge)

---

## Decision Outcome

**Accepted** - Implemented and working in both FX grid and central view.

**Success Criteria Met:**
- ✅ FilterCurve at full component size in FX grid
- ✅ Invisible control overlays (BASS/MID/TREB)
- ✅ DeviceXY for mid control (Svelte 5 compatible)
- ✅ Output Gain added to config and central view
- ✅ Clean central view (no redundant curve)
- ✅ Complete state includes all 5 parameters
- ✅ 500 error fixed (AbletonXY → DeviceXY)
- ✅ Ghost state support maintained
- ✅ Professional, minimalist design

**User Testing:**
- Test BASS/TREB vertical drag (smooth interaction)
- Test MID XY pad (frequency + gain control)
- Test Output Gain slider in central view
- Verify FilterCurve updates in real-time
- Confirm complete state on track switch
- Check ghost state loads device correctly
