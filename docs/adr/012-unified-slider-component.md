# ADR 014: Unified Slider Component with Loop Brace Aesthetic

**Status**: Accepted and Implemented
**Date**: 2025-10-06
**Deciders**: Development Team
**Related**: ClipLoopControlV6, QuantizeGrooveControl, GrooveControlsCompact, ClipCentralView

---

## Context

The application had multiple slider implementations with inconsistent visual designs:

1. **Loop Brace Control** - Custom implementation with sharp corners, custom handle, drag interaction
2. **Quantize Control** - HTML5 range input with rounded styling
3. **Groove Controls** - HTML5 range inputs with rounded fat thumbs
4. **Chance Control** - HTML5 range input with blue theme

This created several problems:

1. **Visual inconsistency** - Mix of sharp/rounded corners, different handle styles
2. **Behavioral inconsistency** - Loop brace had tap-to-jump, others didn't
3. **Code duplication** - Similar drag logic repeated across components
4. **Touch optimization** - Passive event listener warnings, inconsistent touch handling
5. **Maintenance burden** - Changes needed in multiple places

User feedback indicated preference for the Loop Brace aesthetic across all sliders.

## Decision

Create a **unified `SliderControl` component** that:

1. Matches the Loop Brace visual aesthetic (sharp corners, custom handle)
2. Provides tap-to-jump functionality for all sliders
3. Handles touch events properly (non-passive listeners, no console warnings)
4. Supports color theming (purple, blue, green)
5. Provides disabled state support
6. Replaces all HTML5 range inputs in groove and clip controls

## Architecture

### Component API

```svelte
<SliderControl
  value={number}
  min={number}        // default: 0
  max={number}        // default: 100
  label={string}
  color={'purple' | 'blue' | 'green'}  // default: 'purple'
  disabled={boolean}  // default: false
  oninput={(value: number) => void}
/>
```

### Visual Design

- **Track**: Muted background with sharp corners (`rounded-lg`)
- **Filled region**: Colored region from min to handle position (`rounded-md`)
- **Handle**:
  - Custom styled with border and shadow
  - Displays current value as percentage
  - Small indicator dot
  - Scale effect on drag (110%)
  - Sharp corners (`rounded-lg`)

### Behavior

1. **Drag interaction**: Click/touch handle and drag to any position
2. **Tap-to-jump**: Click/tap anywhere on track to jump handle
3. **Optimistic updates**: Immediate visual feedback during interaction
4. **Touch handling**: Non-passive event listeners prevent scroll interference
5. **Accessibility**: Proper ARIA labels and keyboard support

### Touch Event Handling

```typescript
// Non-passive listeners in $effect to prevent default behavior
containerRef.addEventListener('touchstart', preventTouch, { passive: false });
containerRef.addEventListener('touchmove', preventTouch, { passive: false });
```

This prevents passive event listener warnings while allowing proper touch interaction.

## Implementation

### Components Updated

1. **QuantizeGrooveControl** - Replaced inline implementation with SliderControl
2. **GrooveControlsCompact** - Replaced SHUFFLE and RANDOM HTML5 inputs
3. **ClipCentralView** - Replaced CHANCE HTML5 input
4. **SliderControl** (new) - Reusable slider component

### Color Mapping

```typescript
const colorMap = {
  purple: { hsl: '280 60% 50%', border: 'border-purple-500/50' },
  blue: { hsl: '217 91% 60%', border: 'border-blue-500/50' },
  green: { hsl: '120 60% 50%', border: 'border-green-500/50' }
};
```

### Code Reduction

- **Removed**: ~150 lines of CSS for custom range input styling
- **Removed**: Duplicate drag handling logic
- **Added**: Single 250-line reusable component
- **Net**: ~40% less code with better maintainability

## Consequences

### Positive

✅ **Visual consistency** - All sliders share the same professional aesthetic
✅ **Improved UX** - Tap-to-jump available everywhere
✅ **Better touch support** - No passive event warnings, proper scroll prevention
✅ **Maintainable** - Single source of truth for slider behavior
✅ **Themeable** - Easy to add new colors or adjust styling
✅ **Accessible** - Proper ARIA labels and keyboard support
✅ **Reusable** - Can be used for any future slider needs

### Negative

⚠️ **Component complexity** - SliderControl handles multiple concerns (drag, touch, tap)
⚠️ **Breaking change** - Old HTML5 range inputs no longer supported
⚠️ **Learning curve** - New developers need to understand custom component vs HTML5 input

### Neutral

- All sliders now have the same interaction model
- Color theming limited to predefined set (can be extended)
- Requires Svelte 5 runes ($state, $derived, $effect)

## Alternatives Considered

### 1. Keep HTML5 Range Inputs with CSS Styling
**Rejected**: Cannot achieve tap-to-jump functionality or custom handle design with native inputs. Browser inconsistencies in touch handling.

### 2. Create Multiple Specialized Components
**Rejected**: Would still have duplication. Unified component provides better consistency.

### 3. Use Third-Party Slider Library
**Rejected**: Adds dependency, may not match Loop Brace aesthetic, harder to customize for touch-optimized iPad interface.

## Future Considerations

1. **Additional colors** - Easy to extend colorMap for new themes
2. **Step sizes** - Could add step parameter for quantized values
3. **Range slider** - Could extend to support two handles (min/max range)
4. **Vertical orientation** - Could add orientation parameter
5. **Custom formatting** - Could allow custom value display formatting

## References

- ClipLoopControlV6.svelte - Original Loop Brace implementation
- SliderControl.svelte - New unified component
- Svelte 5 Runes documentation
- Touch event handling best practices
