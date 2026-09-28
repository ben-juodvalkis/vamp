# ADR 038: VerticalSlider and VerticalDiscreteSlider Components

**Date:** 2025-10-11
**Status:** Accepted
**Deciders:** Ben Juodvalkis
**Tags:** UI/UX, Controls, Reusability

---

## Context

The AutoFilterCentralView needed vertical slider controls for multiple parameters (frequency, resonance, LFO rate, etc.). The existing slider components in the codebase were all horizontal:

1. **SliderControl** - Horizontal slider with loop brace aesthetic (used in groove/clip controls)
2. **DeviceSlider** - Horizontal/vertical controlled component for FX Grid (similar to DeviceXY pattern)

The AutoFilter central view required:
- **Continuous parameters** (frequency, resonance) - smooth 0-1 values
- **Discrete parameters** (filter type, slope) - labeled options with steps
- **Vertical orientation** - better space utilization in tall central panel
- **Consistent visual design** - matching the sequencer length/rate slider aesthetic

### Existing Component Limitations

**SliderControl (ADR 014):**
- Horizontal orientation only
- Loop brace aesthetic with tap-to-jump
- Used for groove controls (shuffle, random, chance)
- Not easily adaptable to vertical orientation

**DeviceSlider (ADR 036):**
- Designed for FX Grid controlled pattern
- Complex parent-controlled architecture
- Requires isDragging logic and optimistic updates
- Overkill for simple central view controls

**GenericParameter:**
- Self-contained with subscriptions
- Jump-to-click behavior
- More complex than needed for simple value display

---

## Decision

Create two new lightweight vertical slider components based on the **sequencer slider design pattern**:

1. **VerticalSlider** - Continuous values (0-1 normalized)
2. **VerticalDiscreteSlider** - Discrete labeled options

### Key Principles

1. **Simple and Lightweight**
   - No complex subscription logic
   - Parent provides value, component displays it
   - onChange callback for value updates
   - ~120 lines each (minimal complexity)

2. **Vertical Orientation**
   - Drag up = increase value
   - Drag down = decrease value
   - Fill indicator from bottom to top
   - Optimized for tall, narrow spaces

3. **Relative Dragging Only**
   - No jump-to-click (consistent with DeviceSlider)
   - Smooth drag interaction
   - Configurable sensitivity

4. **Auto-Enable Pattern**
   - Optional `onEnable` callback
   - Triggers when user starts dragging
   - Useful for auto-loading devices in ghost state

5. **Visual Consistency**
   - Matches sequencer slider aesthetic
   - Muted background with accent color fill
   - Border and hover states
   - Centered label display

---

## Architecture

### VerticalSlider (Continuous Values)

```typescript
interface Props {
  value: number;           // Current value (normalized to min-max range)
  label?: string;          // Display label (defaults to percentage)
  min?: number;            // Minimum value (default 0)
  max?: number;            // Maximum value (default 1)
  sensitivity?: number;    // Drag sensitivity in pixels (default 100)
  color?: string;          // Fill color (default blue)
  readonly?: boolean;      // Disable interaction
  onChange?: (value: number) => void;
  onEnable?: () => void;   // Auto-enable callback
}
```

**Use Cases:**
- Continuous parameters (frequency, resonance, drive)
- Normalized 0-1 values
- Any parameter requiring smooth control

### VerticalDiscreteSlider (Discrete Options)

```typescript
interface Props {
  value: number;           // Current selected value
  options: {               // Array of discrete options
    value: number;
    label: string;
    shortLabel?: string;   // Optional short label for display
  }[];
  color?: string;          // Fill color (default blue)
  readonly?: boolean;      // Disable interaction
  sensitivity?: number;    // Pixels per step (default 25)
  onChange?: (value: number) => void;
  onEnable?: () => void;   // Auto-enable callback
}
```

**Use Cases:**
- Filter type selection (lowpass, highpass, etc.)
- Slope selection (12db, 24db)
- LFO waveform selection (sine, saw, square)
- Any parameter with labeled discrete options

---

## Implementation Details

### Drag Behavior

Both components use **relative dragging**:

```typescript
function handlePointerMove(event: PointerEvent) {
  if (!isDragging) return;

  // Calculate delta from start position
  const deltaY = startY - event.clientY;

  // Continuous: scale by sensitivity and range
  const valueChange = (deltaY / sensitivity) * (max - min);
  const newValue = clamp(startValue + valueChange, min, max);

  // Discrete: convert to steps
  const stepsChanged = Math.round(deltaY / sensitivity);
  const newIndex = clamp(startIndex + stepsChanged, 0, options.length - 1);
}
```

### Visual Feedback

**Fill Indicator:**
- Bottom to top based on normalized value
- Smooth transition (150ms)
- Configurable color

**Container States:**
- Normal: Muted background, border
- Hover: Accent background (20% opacity)
- Active: Accent background (40% opacity)
- Readonly: 50% opacity, default cursor

**Label Display:**
- Centered text with z-index above fill
- VerticalSlider: Shows label or percentage
- VerticalDiscreteSlider: Shows option label (short or full)

### Pointer Capture

```typescript
function handlePointerDown(event: PointerEvent) {
  const target = event.target as Element;
  target.setPointerCapture(event.pointerId);

  // Auto-enable if callback provided
  if (onEnable) onEnable();
}

function handlePointerUp(event: PointerEvent) {
  const target = event.target as Element;
  target.releasePointerCapture(event.pointerId);
}
```

Ensures smooth dragging even when pointer moves outside component bounds.

---

## Usage Examples

### AutoFilterCentralView

```svelte
<!-- Continuous parameter: Frequency (0-1) -->
<VerticalSlider
  value={frequencyValue}
  label="FREQ"
  color="rgba(139, 92, 246, 0.3)"
  onChange={(val) => {
    frequencyValue = val;
    if (device) sendParam(FREQ_INDEX, val);
  }}
  onEnable={() => {
    if (isGhost) triggerLoad();
  }}
/>

<!-- Discrete parameter: Filter Type -->
<VerticalDiscreteSlider
  value={filterType}
  options={[
    { value: 0, label: 'Lowpass', shortLabel: 'LP' },
    { value: 1, label: 'Highpass', shortLabel: 'HP' },
    { value: 2, label: 'Bandpass', shortLabel: 'BP' }
  ]}
  color="rgba(139, 92, 246, 0.3)"
  onChange={(val) => {
    filterType = val;
    if (device) sendParam(TYPE_INDEX, val);
  }}
/>
```

---

## Comparison with Existing Components

| Feature | VerticalSlider | DeviceSlider | SliderControl | GenericParameter |
|---------|---------------|--------------|---------------|------------------|
| **Orientation** | Vertical only | Vertical/Horizontal | Horizontal only | Horizontal/Vertical |
| **Complexity** | ~120 lines | ~160 lines | ~250 lines | ~295 lines |
| **Pattern** | Simple callback | Controlled component | Tap-to-jump | Self-contained |
| **Use Case** | Central views | FX Grid | Groove controls | Legacy/prototyping |
| **Drag Behavior** | Relative | Relative | Tap-to-jump + drag | Jump-to-click |
| **State Management** | Parent | Parent (complex) | Parent (simple) | Internal |
| **Auto-Enable** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Discrete Options** | VerticalDiscreteSlider | ❌ No | ❌ No | ❌ No |

---

## Migration from SliderControl

The CHANCE and RANDOM sliders in ClipCentralView and GrooveControlsCompact currently use the horizontal **SliderControl** component. These can be replaced with **VerticalSlider** for better vertical space utilization.

### Before (Horizontal SliderControl)

```svelte
<div class="h-16">
  <SliderControl
    value={noteChance}
    label="CHANCE"
    color="blue"
    disabled={!hasClip}
    oninput={handleNoteChanceChange}
  />
</div>
```

**Issues:**
- Horizontal orientation wastes vertical space
- Fixed 16px height constraint
- Less touch-friendly for vertical panels

### After (VerticalSlider)

```svelte
<div class="h-full">
  <VerticalSlider
    value={noteChance}
    label="CHANCE"
    color="rgba(59, 130, 246, 0.3)"
    readonly={!hasClip}
    onChange={handleNoteChanceChange}
  />
</div>
```

**Benefits:**
- Better vertical space utilization
- Consistent with AutoFilter controls
- More natural vertical dragging
- Auto-enable pattern available if needed

---

## Consequences

### Positive

✅ **Lightweight and Simple**
- Minimal code (~120 lines each)
- Easy to understand and maintain
- No complex subscription logic

✅ **Vertical Space Optimization**
- Better for tall central panels
- More touch-friendly vertical dragging
- Consistent with sequencer controls

✅ **Discrete Option Support**
- VerticalDiscreteSlider handles labeled options elegantly
- Automatic fill calculation based on current index
- Short label support for compact display

✅ **Auto-Enable Pattern**
- Optional onEnable callback
- Useful for ghost state device loading
- Keeps component flexible

✅ **Reusable**
- Can be used in any central view
- Not tied to specific device architecture
- Simple props interface

### Negative

⚠️ **Another Slider Component**
- Now have 4 slider variants (SliderControl, DeviceSlider, VerticalSlider, VerticalDiscreteSlider)
- Potential confusion about which to use
- Could be consolidated in future

⚠️ **No Throttling**
- Unlike DeviceSlider, no built-in throttling
- Parent must handle OSC message rate limiting
- Acceptable for central views (less performance-critical than FX Grid)

⚠️ **Vertical Only**
- Cannot be reused for horizontal use cases
- Would need SliderControl or DeviceSlider for horizontal
- Acceptable trade-off for simplicity

### Neutral

- Similar to DeviceSlider but simpler
- Complements rather than replaces existing components
- Each slider variant has clear use case

---

## Design Rationale

### Why Not Extend SliderControl?

**Considered:** Adding orientation prop to SliderControl.

**Rejected Because:**
1. SliderControl has tap-to-jump behavior (different interaction model)
2. Loop brace aesthetic doesn't translate well to vertical
3. Component already 250 lines (adding orientation would increase complexity)
4. Different use cases warrant different components

### Why Not Use DeviceSlider?

**Considered:** Using DeviceSlider with vertical orientation.

**Rejected Because:**
1. DeviceSlider designed for FX Grid controlled pattern
2. Requires complex parent logic (isDragging, timers, optimistic updates)
3. Overkill for simple central view controls
4. No discrete option support

### Why Two Components?

**VerticalSlider vs VerticalDiscreteSlider**

**Considered:** Single component with optional discrete mode.

**Accepted Separation Because:**
1. Different props interface (options[] vs min/max)
2. Different calculation logic (index vs normalized value)
3. Clearer intent (continuous vs discrete)
4. Components still small (~120 lines each)
5. Easier to maintain and understand

---

## Testing Strategy

### Manual Testing (iPad)

1. **Continuous Values (VerticalSlider)**
   - Drag up/down smoothly
   - Value changes proportional to drag distance
   - Fill indicator animates from bottom to top
   - Label shows percentage or custom label
   - Readonly state prevents interaction

2. **Discrete Values (VerticalDiscreteSlider)**
   - Drag up/down to change options
   - Snaps to discrete steps based on sensitivity
   - Short labels display when provided
   - Fill indicator matches current option index
   - Readonly state prevents interaction

3. **Auto-Enable Pattern**
   - onEnable fires when drag starts
   - Only fires once at start of drag
   - Useful for ghost state device loading

4. **Touch Optimization**
   - Pointer capture works across component bounds
   - No scroll interference
   - Smooth drag interaction on iPad

---

## Future Considerations

### Potential Enhancements

1. **Value Formatting**
   - Custom format functions (db, hz, percentage)
   - Currently shows raw percentage or label
   - Could add formatValue prop

2. **Haptic Feedback**
   - Discrete sliders could trigger haptics on step change
   - iOS haptic API integration
   - Light tap on option change

3. **Keyboard Support**
   - Arrow keys for value change
   - Page up/down for larger steps
   - Enter to reset to default

4. **Consolidation**
   - Evaluate if SliderControl usage can be replaced
   - Consider unified API across all slider variants
   - Trade-off: flexibility vs simplicity

### When to Use Each Slider

**VerticalSlider:**
- Vertical central view controls
- Continuous normalized parameters
- Simple value callback pattern
- Auto-enable needed

**VerticalDiscreteSlider:**
- Vertical central view controls
- Discrete labeled options
- Filter types, slopes, waveforms
- Auto-enable needed

**DeviceSlider:**
- FX Grid single-parameter controls
- Controlled component pattern required
- Optimistic updates with subscriptions
- Ghost state with pending params

**SliderControl:**
- Horizontal groove controls
- Tap-to-jump interaction desired
- Loop brace aesthetic
- Clip/quantize controls

---

## Related Decisions

- **ADR 014:** Unified Slider Component (horizontal SliderControl)
- **ADR 036:** DeviceSlider Component for FX Grid (controlled pattern)
- **ADR 001:** Svelte 5 Runes Stores Architecture (reactive patterns)

---

## References

- Implementation:
  - `interface/src/lib/components/v6/controls/VerticalSlider.svelte`
  - `interface/src/lib/components/v6/controls/VerticalDiscreteSlider.svelte`
- First usage: `interface/src/lib/components/v6/central/views/AutoFilterCentralView.svelte`
- Commit: b59ce7e (feat: add VerticalSlider and VerticalDiscreteSlider components)
- Pattern source: Sequencer length/rate slider design

---

## Decision Outcome

**Accepted** - Implemented and working in AutoFilterCentralView.

**Success Criteria Met:**
- ✅ Lightweight components (~120 lines each)
- ✅ Vertical orientation with bottom-to-top fill
- ✅ Continuous and discrete value support
- ✅ Auto-enable pattern for ghost state
- ✅ Relative dragging with configurable sensitivity
- ✅ Pointer capture for smooth interaction
- ✅ Consistent visual design with sequencer controls

**Next Steps:**
- Replace horizontal sliders in ClipCentralView with VerticalSlider
- Replace horizontal sliders in GrooveControlsCompact with VerticalSlider
- Evaluate other central views for vertical slider adoption
- Consider value formatting enhancements if needed
