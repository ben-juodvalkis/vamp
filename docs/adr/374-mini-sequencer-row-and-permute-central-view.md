# ADR-374: Mini Sequencer Row and Permute Central View

## Status
**Accepted**

## Context

The Permute sequencer was previously accessible only via the instrument panel drill-down path — selecting a track, then navigating to the device. There was no at-a-glance way to see sequencer state across all tracks simultaneously, and no direct tap-to-open path from the main layout.

ADR-372 introduced the detached clip row (row 2 of the tracks grid). This branch adds a dedicated Permute row (now row 2) and moves the clip row to row 3, giving the track grid three logical rows: track strips (fills remaining height), permute thumbnails (auto), clip slots (auto).

## Decision

**1. TrackPermuteRow component**

A new `TrackPermuteRow.svelte` uses `display: contents` so each `.permute-cell` is a direct grid item inheriting the parent's column widths — the same pattern as `TrackClipRow`. Each cell renders a `MiniSequencer` thumbnail driven by Permute param reads from `v3Store`.

**2. MiniSequencer component**

A new `MiniSequencer.svelte` renders a 50 px thumbnail showing two rows of steps (mute orange / pitch blue), with active, current, and disabled states. Tracks without a Permute device show a ghost placeholder with dashed outlines and low-opacity fills so the row height is consistent.

**3. useTinySequencer composable**

A `useTinySequencer.svelte.ts` composable encapsulates the Permute param-index layout (mute steps 1–8, pitch steps 11–18, lengths at 9/19, current positions at 23/24) and exposes a reactive `TinySequencerState`. `TrackPermuteRow` reads state inline (same logic), which is acceptable duplication at this stage; the composable is the canonical reference if a third consumer appears.

**4. PermuteCentralView and 'permute' view type**

A new `PermuteCentralView.svelte` is registered as the `'permute'` view type in `centralDisplayStore`, `viewRegistry`, and `CentralViewType`. Tapping a MiniSequencer cell selects that track and opens this view. Wide mode is set automatically (same policy as `'clip'`).

`PermuteCentralView` renders `MuteSequencerControl` and `PitchSequencerControl` without their length/rate sliders (new `showLengthSlider` / `showRateSlider` props added to both controls), giving a clean full-screen grid view focused on the pattern.

**5. Border style calibration**

Track strip borders (in `useTrackData`), clip outlines (`TrackClipRow`), and permute outlines (`TrackPermuteRow`) are unified at 1 px with 55 hex alpha on the track colour. Selection state switches to `rgba(255,255,255,0.6)` (white outline) instead of the previous primary-colour glow — less visual noise on a crowded layout.

TrackStrip's `.track-selected` box-shadow glow is removed; only the border colour changes. RecordButton gets an explicit `border-2 border-red-500` so its affordance reads clearly at the top of the layout.

**6. TrackHeader fluid font**

The four-breakpoint `@container` font-size ladder is replaced with a single `clamp(0.688rem, 7cqi, 1.125rem)` rule, and the name is wrapped in a `-webkit-line-clamp: 2` span so long names truncate gracefully instead of overflowing.

**7. MasterTrack meter inset**

`topInset` on `MeterVisualization` was hardcoded to 96 px (the old header height) in MasterTrack. With the flex layout the meter container already starts below the header, so `topInset` is corrected to 0.

## Consequences

**Positive**
- Permute step state is visible at a glance across all tracks without any navigation.
- Tapping a cell is a single gesture to open the full sequencer view for that track.
- Unified 1 px border alpha reduces visual clutter compared to the previous glow-on-glow selection style.
- `showLengthSlider` / `showRateSlider` props give composable control over sequencer control density for different view contexts.

**Negative**
- The Permute param-index constants are duplicated between `useTinySequencer.svelte.ts` and `TrackPermuteRow.svelte`; they must stay in sync with `sequencerStore` if the Permute device layout ever changes.
- The tracks grid is now three rows tall; on small screens the clip row may compete for vertical space with the track strips.

## Tags
`ui`, `tracks`, `permute`, `sequencer`, `mini-sequencer`, `central-view`, `layout`
