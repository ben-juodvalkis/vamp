# ADR-345: Preset Card Scroll vs Tap Discrimination

## Status
**Accepted**

## Context

The unified browser interaction model (ADR-341) uses a press-then-hold-to-drag state machine for all targets inside the browser. When a touch begins on any element, a 180 ms hold timer is armed; if it fires, the interaction transitions to `dragging` state, which applies `touch-action: none` via the `.gesture-active` CSS class. This suppresses native scrolling and causes the release to load whatever preset is under the finger.

This created two problems when touching preset cards in the scrollable preset grid:

1. **Slow scroll triggers accidental load.** If the user's finger rests for >180 ms before moving (common on deliberate scrolls), the hold timer fires, native scroll is suppressed, and the release loads a preset.
2. **Quick flick-to-scroll triggers accidental load.** Even without entering drag mode, a short flick where `touchcancel` doesn't fire (the scroll distance is too small for Safari to claim the gesture) results in `touchend` while still in `pressing` state, which the tap handler treats as a preset load.

The hold-to-drag gesture (press a folder/vendor button, drag across columns to a preset, release to load) is only meaningful for folder and vendor targets. Preset cards only need two interactions: tap to load, or scroll to see more presets.

## Decision

Two targeted changes in `BrowserInteractionController.svelte`:

### 1. Skip the hold-to-drag timer for preset cards

When `hitTest` classifies the press target as `kind: 'preset'`, return immediately after `beginPress()` without arming the hold timer. The interaction stays in `pressing` state indefinitely, so:

- `touch-action: pan-y` remains active (no `.gesture-active` class is applied).
- Native scroll can take over freely, firing `touchcancel` which is already handled by `handlePointerCancel`.
- A quick release dispatches the existing tap handler.

### 2. Add a movement threshold to the tap handler

Before dispatching `onTap` in the `pressing` → release path, compare the release coordinates against `pressOrigin`. If the finger moved more than 10 px (Euclidean distance), reject the release as a scroll flick rather than an intentional tap. This catches short flicks where Safari doesn't fire `touchcancel`.

The threshold applies to all target types, not just presets. For vendor and folder buttons, the `pressing` window is at most 180 ms (before the hold timer promotes to `dragging`), so natural finger jitter during a quick tap stays well under 10 px.

## Consequences

**Positive:**
- Scrolling through the preset grid no longer accidentally loads presets.
- No new state, store fields, or CSS changes required.
- The hold-to-drag gesture for folders and vendors is completely unaffected.
- Works with Safari's native touch handling rather than against it.

**Negative:**
- Preset cards can no longer be the origin of a hold-to-drag gesture. This is acceptable because there is no use case for dragging from a preset card.
- Tapping a preset card to stop inertia scroll will still load the preset, because iOS Safari fires a normal `touchstart`/`touchend` with zero displacement for stop-scroll taps. Distinguishing this from an intentional tap would require tracking scroll velocity at press time. Accepted as a minor limitation — inertia scroll in the preset grid is uncommon given typical list sizes.

## Tags
`browser`, `touch`, `gesture`, `scroll`, `preset-grid`, `ipad`
