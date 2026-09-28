# ADR-372: Detached Clip Row and Track Strip Visual Refresh

## Status
**Accepted**

## Context

The track strip previously held three overlapping layers in a single `Card`:
- A volume meter filling the full card
- A track name pill anchored to the top
- A clip view pill (waveform/MIDI) anchored to the bottom

This created several structural problems:
- `overflow: hidden` on the card worked against any design that wanted the clip to feel detached from the meter body
- The volume drag inset calculation was coupled to clip height (`clipAnchorHeight`), so adding/removing a clip changed the drag zone geometry
- The `MeterVisualizationV6` painted its own opaque `var(--card)` background, hiding the per-track color tint that `borderStyle` was setting on the card — meaning the color coding silently didn't work
- The meter fill had no upper bound, so at loud levels it bled behind the track name label

A LiquidGlass pill effect was explored on the clip view but abandoned: the SVG filter + backdrop-filter stack added visual complexity without improving readability, and the frosted-glass abstraction fought the design rather than serving it.

## Decision

### Layout — CSS grid with two rows

`TracksPanelV6` switches from a flex row to a CSS grid with one column per visible track (`minmax(0, 1fr)`). The grid has two rows:

- **Row 1** (`1fr`): `TrackStrip` instances — meter + track name header + volume drag
- **Row 2** (`auto`): `TrackClipRow` — a new component that renders one clip cell per column

`TrackClipRow` uses `display: contents` so its child `.clip-cell` divs are direct grid items and inherit the parent column widths automatically. Each cell is `grid-row: 2`, placing it beneath its corresponding track strip with zero coordination code.

### TrackStrip simplification

The clip pill and its dependencies (`LiquidGlassPill`, `playingClipsStore`, `centralDisplayStore`) are removed from `TrackStrip`. The volume drag bottom inset simplifies to a fixed `GAP` constant. `LiquidGlassPill.svelte` is deleted entirely.

### TrackClipRow

Renders a plain outlined container (track-colored border + `{trackColor}15` fill) instead of the glass pill. Matches the same selected-state styling as `TrackStrip` (primary-color border + box-shadow) via a `clip-selected` class driven by `session.selectedTrackIndex`. Tap gesture mirrors ADR-360: `send('/looping/v3/track/select')` + `centralDisplayStore.setView('clip')`.

### Meter cap

`MeterVisualizationV6` gains a `topInset` prop. `.meter-background` starts at `top: var(--top-inset)` rather than `top: 0`, so the meter bar never covers the track name. The `background-color: var(--card)` on `.meter-visualization` is removed (set to `transparent`) so the per-track color tint on the card is no longer obscured.

### Visual polish

- Track number prepended to track name in `TrackHeader` (`trackNumber` prop) — large standalone number removed from `TrackVolumeMeter`
- Volume handle line: 2px, `color-mix(in srgb, var(--foreground), transparent 45%)` — matches the playhead in `TrackClipView`, replaces the opaque white
- `MasterTrack` updated to match: meter `topInset={96}` (fixed header height), same volume handle treatment
- `TrackClipMidiView` and `TrackClipView` internal backgrounds set to `transparent` so the clip outline container owns the background

## Consequences

**Positive**
- Clip and strip are independently styleable — future work (animations, alternate layouts) requires no changes to `TrackStrip`
- Per-track color tint now visible on both strip and clip, giving consistent color coding across the row
- Volume drag inset no longer depends on clip height; no reactive coupling between the two rows
- Meter never covers the track name regardless of signal level
- `LiquidGlassPill` deleted; no unused SVG filter machinery in the bundle

**Negative**
- `readPermuteMuteCurrent` logic is duplicated between `useTrackData` and `TrackClipRow` — a shared utility extraction is the right long-term fix but was deferred to keep the scope bounded
- `TrackClipRow` accesses `v3Store` and `playingClipsStore` directly rather than through a composable, which is slightly less testable

## Tags
`ui`, `track-strip`, `layout`, `css-grid`, `clip-view`, `meter`, `visual-polish`
