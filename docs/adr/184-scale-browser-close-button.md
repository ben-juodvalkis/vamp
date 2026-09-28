# ADR-184: Scale Browser Close Button

## Status
Accepted

## Context
When the scale browser is opened from the key signature button in `SystemCentralView`, the `VendorButtonGrid` component was incorrectly showing all vendor buttons (Drums, Bass, FX, Keys, Synth, etc.) alongside the root note selector. This was confusing because:

1. The vendor buttons are not relevant when selecting a scale
2. There was no clear way to close the scale browser
3. The UI was cluttered with irrelevant options

## Decision
When the scale browser is expanded (`isExpanded && selectedCategory === 'scale'`), `VendorButtonGrid` now shows only a single "Close" button instead of the full vendor button grid.

The implementation uses a conditional block:
- When in scale mode: Show only the Close button
- Otherwise: Show the normal vendor button groups (Recent, Record, Audio, Drums, Bass, FX, etc.)

## Consequences

### Positive
- Clean, focused UI when selecting scales - only root notes and scale names visible
- Clear affordance for closing the scale browser
- Consistent with the pattern of showing context-appropriate controls

### Negative
- Cannot switch directly from scale browser to a vendor browser without closing first (acceptable trade-off for clarity)

## Implementation
- Modified `VendorButtonGrid.svelte` to wrap vendor buttons in `{#if}/{:else}` block
- Added `scale-close-group` CSS class for full-height layout
- Close button uses the existing `onClose` prop
