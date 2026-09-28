# ADR-376: UI Interaction Latency Fixes

## Status
**Accepted**

## Context

Several UI interaction paths exhibited ~100ms perceived latency despite the app already using
optimistic OSC sends (store updates before network round-trip) in some places. Investigation
revealed three distinct categories of latency:

1. **CSS transition duration** — Track selection and clip outline used `transition-all duration-200`
   (200ms), so the highlight colour animated in slowly even though the underlying state changed
   instantly. Users perceived the midpoint of the animation as the response time.

2. **Missing optimistic updates on row-level tap handlers** — `TrackClipRow`, `TrackPermuteRow`,
   and `MasterTrack` each had their own tap handlers that `await`ed the OSC send before updating
   `session.selectedTrackIndex` and `selectedTrackStore`. This blocked the track highlight and
   central view switch for a full round-trip (~100ms) while the equivalent path through
   `useTrackData.handleSelect` (used by the volume meter) did the optimistic update first.

3. **Central display flash on view switches** — Three layered sources:
   - `{#key componentKey}` in `CentralDisplay` destroyed and recreated component DOM on every
     device type switch, causing a 1-frame blank flash.
   - On the first visit to a device type the JS chunk was fetched asynchronously while the
     display showed a spinner, blanking the previous content.
   - Device central views rendered a pulsing `isLoading` overlay during the ghost→loading→active
     window, which the user found more jarring than simply showing controls with default values.

## Decision

### 1. Shorten selection transitions

Replace `transition-all duration-200` on `TrackStrip` with a targeted transition scoped to the
`.track-selected` class itself: `transition: background 75ms, border-color 75ms`. Deselect is
now instant (class removed → styles drop immediately); select fades in over 75ms which reads as
immediate. Clip outline transitions reduced from 200ms → 75ms.

### 2. Align all row tap handlers with the optimistic pattern

`TrackClipRow.handleClipViewTap`, `TrackClipRow.handleEmptyClipTap`, `TrackPermuteRow.handleTap`,
and `MasterTrack.handleSelect` all updated to:

```
session.selectTrackOptimistically(trackIndex)
selectedTrackStore.handleTrackSelected(trackIndex)
centralDisplayStore.setView(...)
onTrackSelect?.(trackIndex)
send(OSC_ADDRESS, [...])   // fire-and-forget, no await
```

Matches the pattern already used by `useTrackData.handleSelect` (volume meter path).

### 3. Eliminate central display flash

- **Remove `{#key componentKey}`**: device central views are self-contained (`useFxGridSlot`
  with a hardcoded slot key, no props from parent), so forced remounting on type switch was
  never necessary. Removing it eliminates the blank-frame flash between device types.
- **Keep previous view visible during chunk fetch**: on first visit to a device type, keep
  `ViewComponent` pointing to whatever was previously showing. Only swap once the new module
  resolves. Spinner is shown only when `ViewComponent` is null (very first page load).
- **Remove `isLoading` overlays**: removed from all 13 device central views and from
  `BaseDeviceControl`. Controls now show with their default/fallback values during the
  ghost→loading window. Behavioural `isLoading` guards in interaction handlers (param routing
  to the pending queue) are untouched.

## Consequences

- **Positive**: Track highlight and central view switch feel instant on all tap targets.
- **Positive**: No spinner or blank flash when switching between FX device views.
- **Positive**: Ghost device loads no longer block the central view with an overlay.
- **Neutral**: Ghost device controls show default values briefly before real values arrive.
  This is intentional — the user accepted this trade-off explicitly.
- **Neutral**: The "Loading view…" spinner can still appear on the very first page load before
  any view has been shown. This is unavoidable without eager-loading all view chunks.
- **Negative**: If a future view component requires remounting when its props change (unlike
  current self-contained device views), the caller will need to add its own `{#key}` locally
  rather than relying on `CentralDisplay` to force it.

## Tags
`performance`, `optimistic-ui`, `latency`, `central-display`, `track-selection`, `fx-grid`
