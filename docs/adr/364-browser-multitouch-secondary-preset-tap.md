# ADR-364: Browser multitouch — secondary-finger preset tap during a primary drag

## Status
**Accepted** (2026-05-01)

## Context

The unified gesture browser
(`interface/src/lib/components/v6/browser/UnifiedGestureBrowser.v6.svelte`
+ `BrowserInteractionController.svelte`) was a strict single-touch state
machine. One press → tap-or-hold → drag → release. `browserGestureStore`
held one `pressOrigin`, one `pressTarget`, one `hoveredCol/Idx/Preset`;
`getEventCoordinates(event)` always read `touches[0]` /
`changedTouches[0]`. A second finger was either ignored or, worse, its
`touchend` `changedTouches[0]` was treated as the primary release —
ending the drag prematurely.

The performance gesture the user wanted is two-handed: left hand holds
a vendor button and swipes through subfolder columns; right hand taps a
preset card the moment it appears. Today this requires releasing the
left hand (which fires `onEnd` → "load random from current folder"),
losing the finger's drag context, then doing a second one-finger tap on
the preset.

## Decision

Land an additive multitouch path in `BrowserInteractionController` that
preserves the existing single-touch state machine intact. The primary
finger continues to own the drag; secondary fingers landing during the
drag are evaluated independently as instant preset taps. No store-level
changes — `browserGestureStore` still tracks one interaction.

### 1. Primary touch identifier

`BrowserInteractionController` records the `Touch.identifier` of the
finger that began the press (`primaryTouchId`). On a `MouseEvent`
press, it stays `null` (no multitouch path applies).

`getEventCoordinates(event, touchId?)` gained an optional second
parameter that picks the matching `Touch` from the event's
`touches` / `changedTouches` list rather than blindly indexing `[0]`.
`handlePointerMove` and `handlePointerUp` pass `primaryTouchId` so a
secondary finger's `touchend` cannot be mistaken for the primary
release.

### 2. Secondary-finger fast path

`handlePointerDown` now branches at the top:

```ts
if (
  event instanceof TouchEvent &&
  browserGestureStore.interactionState === 'dragging' &&
  primaryTouchId !== null
) { ... return }
```

For each new touch in `changedTouches` (filtered by `findNewTouches`
against a `secondaryTouchIds: Set<number>`), the controller hit-tests
the touch's coordinates and — only if `kind === 'preset'` — fires
`onTap({kind:'preset', presetId})` synchronously and adds the
identifier to `secondaryTouchIds`. The branch always `return`s
without calling `beginPress`, so the primary press is untouched.

Non-preset secondary touches (folder, vendor, empty) are deliberately
ignored: the use case is "drag with one finger, tap a leaf with the
other," not "two-finger column navigation."

### 3. Secondary-touch event filtering

- `handlePointerMove`: if the event's `changedTouches` contains no
  identifier matching `primaryTouchId`, drop the event. Secondary
  fingers cannot steer hover state.
- `handlePointerUp`: scan `changedTouches`. If only secondary
  identifiers ended, drop them from `secondaryTouchIds` and `return`
  — the drag continues. Only when the primary finger's identifier
  appears in `changedTouches` does `endInteraction` fire.

### 4. Suppress the primary release's load when a secondary tap fired

A boolean `secondaryTapConsumedThisDrag` flips true on any consumed
preset tap. `onEnd` now passes `{ secondaryTapConsumed }` to
`UnifiedGestureBrowser.handleGestureEnd`, which short-circuits to
"close the browser, don't load anything" when the flag is set:

```ts
if (meta?.secondaryTapConsumed) {
  browserModeStore.isPersistent = false;
  closeButPreserveState();
  return;
}
```

Without this, the user's secondary preset tap would race the primary
release's "load random preset from current folder" path and lose:
the right-hand selection would be silently overwritten by a sibling.
The flag clears in every `endInteraction` site (`pressing` end,
`dragging` end, cancel) for hygiene.

### 5. `findNewTouches` helper

Added alongside `getEventCoordinates` in
`interface/src/lib/components/v6/browser/utils/touchHandlers.ts`.
Returns `Touch[]` from `event.changedTouches` whose identifiers aren't
in a caller-supplied `Set`. Single call site today (the controller's
secondary branch); kept as a helper so the event-list iteration stays
out of the controller's branching logic.

## Consequences

### Positive

- Two-handed performance gesture works: left-hand drags through
  type/folder columns, right-hand taps a preset card without ending
  the drag. The drag finger can keep navigating after the tap to try
  different presets.
- Single-finger interaction is unchanged. Same hold-to-drag, same
  release-on-folder behavior, same retap-to-close.
- Zero changes to `browserGestureStore`. The multitouch path lives
  entirely in `BrowserInteractionController` and the touch-handler
  utility, so the store's interaction state machine stays a clean
  single-finger model.
- No wire / OSC changes. `loadPresetWithVariant` is the existing
  preset-load path, hit through the existing `onTap` callback.

### Negative

- Only preset cards consume secondary touches. A user trying to
  "two-finger drag through columns" will find the second finger
  silently ignored. Generalizing to per-finger drag state requires
  the larger refactor sketched as Option A in the design discussion
  (gesture store grows to `Map<touchId, PressState>`); that path is
  left for if/when the use case appears.
- `getEventCoordinates(event, touchId)` returns `null` when the
  requested id isn't in the event being delivered. Callers must
  treat null as "this event isn't for me" rather than "no
  coordinates available." Today only `handlePointerMove` and
  `handlePointerUp` pass `touchId`, and both already have null-coords
  branches.
- `secondaryTapConsumedThisDrag` is a per-drag flag, not per-finger.
  If a future change ever supports multiple consecutive secondary
  taps within one drag and wants different end semantics for each,
  the flag would need to become a counter or a per-touch record.
  Today the "any tap consumed → primary release closes silently"
  rule is exactly what the user wants.

## Validation

- Production build green (`npm run build`).
- Full TS suite: 1022 / 1022 across 59 files (`npm run test:run`).
- Manual validation on iPad: hold a vendor button to enter drag mode,
  drag to a subfolder column, tap a preset card with the second
  finger — preset loads, drag continues, releasing the primary finger
  closes the browser without overwriting the loaded preset.

## Tags
`browser`, `gesture`, `multitouch`, `ipad`, `touch-events`,
`unified-gesture-browser`
