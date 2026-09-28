# ADR 034: Dynamic Middle Panel Layout

**Status**: Implemented
**Date**: 2025-10-11
**Context**: V6 UI Architecture

## Context

The middle panel of the interface is split between left-side clip controls (loop control, quantize/groove, mute sequencer, pitch sequencer) and a right-side central display that shows different views (devices, instruments, clips, utilities). Previously, this was a fixed 50/50 split.

However, different types of content have different space requirements:
- **Instrument views** (Drum Rack, Komplete Kontrol, Omnisphere, Simpler) need significant horizontal space for preset browsers, pad matrices, and parameter controls
- **Clip views** benefit from more space to display waveforms, MIDI note data, and clip properties
- **Device views** (auto filter, delay, compressor, etc.) have fewer controls and work well in a narrower layout
- **Utility views** (OSC tester, system controls) are simple interfaces that don't need much width

A fixed 50/50 split wastes space for devices while cramping instruments and clips.

## Decision

We implemented a dynamic layout system where the central display can request more or less width based on its content type, automatically adjusting the relative widths of the left controls panel and central display.

### Width Modes

**Wide Mode** (`wide: true`):
- Central display: **2/3 width** (66%)
- Left controls: **1/3 width** (33%)
- Used for: Instrument views, Clip views

**Normal Mode** (`wide: false` or `undefined`):
- Central display: **1/3 width** (33%)
- Left controls: **2/3 width** (66%)
- Used for: Device views, Utility views, Default view

### Data Model

Extended `CentralViewData` interface to include width preference:

```typescript
export interface CentralViewData {
  type: CentralViewType;
  subType?: string;
  data?: any;
  title?: string;
  wide?: boolean; // NEW: If true, takes 2/3 width; if false/undefined, takes 1/3
}
```

### Auto-Detection Logic

The `centralDisplayStore.setView()` method automatically determines appropriate width if not explicitly specified:

```typescript
setView(type: CentralViewType, subType?: string, data?: any, title?: string, wide?: boolean) {
  // Auto-set wide=true for instrument and clip views if not explicitly specified
  if (wide === undefined) {
    wide = type === 'instrument' || type === 'clip';
  }
  // ...
}
```

**Automatic Rules**:
- `type === 'instrument'` → `wide = true`
- `type === 'clip'` → `wide = true`
- All other types → `wide = false`
- Can be explicitly overridden by passing `wide` parameter

### Layout Implementation

**MiddlePanelV6.svelte** uses Svelte 5 runes to reactively adjust layout:

```typescript
// Get reactive wide state from store
let isWide = $derived(centralDisplayStore.view.wide ?? false);

// Calculate dynamic widths based on wide state
let leftWidth = $derived(isWide ? 'w-1/3' : 'w-2/3');
let rightWidth = $derived(isWide ? 'w-2/3' : 'w-1/3');
```

Applied to flex containers:
```svelte
<div class="{leftWidth} flex flex-col">
  <!-- Clip controls (loop, quantize, sequencers) -->
</div>

<div class="{rightWidth} h-full">
  <CentralDisplay />
</div>
```

## Consequences

### Positive

1. **Space Efficiency**: Instrument and clip views get the space they need for complex UIs
2. **Automatic Behavior**: Developers don't need to remember to set `wide` - it's inferred from view type
3. **Smooth Transitions**: Tailwind classes handle smooth layout changes
4. **Explicit Override**: Can manually set `wide` for special cases
5. **Reactive**: Layout automatically updates when view type changes via Svelte 5 `$derived`
6. **No Code Duplication**: Single store property controls multiple component widths

### Negative

1. **Potential Jumpiness**: Layout shifts when switching between wide and normal views (could add transitions)
2. **Fixed Breakpoints**: Only two width modes - no gradual scaling
3. **Manual Tuning Needed**: Other view types need manual `wide` specification if defaults don't work

### Trade-offs

- **Simplicity vs Flexibility**: Two fixed modes (1/3-2/3 split) rather than arbitrary percentages - easier to reason about but less flexible
- **Auto-Magic vs Explicit**: Automatically setting `wide` based on type is convenient but could surprise developers - mitigated by allowing explicit override
- **Tailwind Classes vs Inline Styles**: Using Tailwind fraction classes (`w-1/3`, `w-2/3`) rather than inline percentage styles - better for consistency but harder to customize per-view

## Implementation Notes

### Files Modified

1. **Store**: `interface/src/lib/stores/v6/centralDisplayStore.svelte.ts:17,34-38,65`
   - Added `wide?: boolean` to `CentralViewData` interface
   - Added auto-detection logic in `setView()`
   - Added `wide` to console logging

2. **Layout**: `interface/src/lib/components/v6/layout/MiddlePanelV6.svelte:8,10-15,20,40`
   - Import `centralDisplayStore`
   - Derive `isWide` from store
   - Calculate dynamic width classes
   - Apply to flex containers

### Usage Examples

**Automatic (recommended)**:
```typescript
// Automatically wide for instruments
centralDisplayStore.setView('instrument', 'drumrack', data, 'Drum Rack');

// Automatically wide for clips
centralDisplayStore.setView('clip', undefined, data, 'Audio Clip');

// Automatically normal width for devices
centralDisplayStore.setView('device', 'autofilter', data, 'Auto Filter');
```

**Explicit override**:
```typescript
// Force a device to be wide (rarely needed)
centralDisplayStore.setView('device', 'special', data, 'Special Device', true);

// Force an instrument to be normal width (rarely needed)
centralDisplayStore.setView('instrument', 'simple', data, 'Simple Instrument', false);
```

### Testing

To verify dynamic layout:
1. Open different instrument views (Drum Rack, Komplete Kontrol) - should see wide layout
2. Switch to device views (auto filter, delay) - should see normal layout
3. Open clip view - should see wide layout
4. Open utility views (OSC tester) - should see normal layout
5. Verify smooth transition between layouts
6. Check that left panel controls remain functional at both widths

## Future Considerations

1. **CSS Transitions**: Could add smooth transitions between width changes
2. **Three-Mode Layout**: Could add a "full width" mode that hides left controls entirely
3. **Responsive Breakpoints**: Could adjust ratios based on screen size (though primarily targeting iPad)
4. **Per-Component Preferences**: Individual instrument views could request custom widths
5. **User Preferences**: Could allow users to override default width behavior

## References

- **Implementation**:
  - Store: `interface/src/lib/stores/v6/centralDisplayStore.svelte.ts`
  - Layout: `interface/src/lib/components/v6/layout/MiddlePanelV6.svelte`
  - Display: `interface/src/lib/components/v6/central/CentralDisplay.svelte`

## Related ADRs

- ADR 001: Svelte 5 Runes Stores Architecture (reactive state management)
- ADR 018: Gesture Browser Architecture (instrument UI complexity that motivated this)
- ADR 020: Browser Layout and Persistent Mode (browser space requirements)
