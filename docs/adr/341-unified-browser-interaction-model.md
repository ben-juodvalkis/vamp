# ADR-341: Unified Browser Interaction Model (Press / Hold / Drag)

## Status
**Accepted**

## Context

The preset browser in `UnifiedGestureBrowser.v6.svelte` had two discrete interaction modes controlled by a binary `browserModeStore.isPersistent` flag:

- **Gesture mode** (`isPersistent = false`) — window-level drag handlers in `GestureModeController.svelte`, wide column gaps, closed on release. Entered by holding a vendor button for 200 ms.
- **Browse mode** (`isPersistent = true`) — element-level tap handlers in `BrowseModeController.svelte`, compact layout, stayed open. Entered by tapping a vendor button.

Two concrete problems:

1. **Visible lag on gesture entry.** `VendorButtonGrid.svelte` armed a per-button `HoldGestureDetector(200)` on touchdown and did nothing until the 200 ms hold timer fired `onVendorHold`. Only then did the browser call `handleVendorClick(vendor)` and set `isExpanded = true`. The user pressed and held a vendor button and saw nothing happen for a fifth of a second before the browser appeared.
2. **Gesture mode could only start at column 0.** Once the browser was open in browse mode, there was no way to enter gesture-drag from an intermediate folder or subfolder. The two modes were structurally separate — each had its own controller, its own CSS class, its own event-routing paths — and switching between them required closing and re-opening the browser.

The two controllers also duplicated significant concerns: both used `getEventCoordinates` / `getElementData`, both tracked pointer-type to prevent mouse/touch double-fire, and both hit-tested via `document.elementFromPoint`. The only meaningful differences were *where* their listeners attached and *what* events they emitted.

## Decision

Collapse the two modes into a **single press-then-hold-to-drag interaction model** driven by an `interactionState` state machine in `browserGestureStore.svelte.ts`. The browser opens immediately on touchdown. A brief press is a tap (navigate, load, toggle persistent). Holding past a short threshold transitions into drag, where window-level listeners track hover and release loads the hovered target.

### Interaction state machine

```ts
type InteractionState = 'idle' | 'pressing' | 'dragging';
interface PressTarget {
  kind: 'vendor' | 'folder' | 'preset' | 'scale' | 'empty';
  col: number;
  idx: number;
  folderName?: string;
  vendorId?: string;
  presetId?: string;
  scaleName?: string;
}
```

- **idle** — no finger down; browser may or may not be open.
- **pressing** — finger is down, hold timer armed. `touch-action: pan-y` allows native scrolling of the preset grid.
- **dragging** — hold timer fired. Window move listeners track hover via `elementFromPoint`; `touch-action: none`; CSS `.gesture-active` class expands column/folder gaps via a 180 ms transition.

Transitions: `idle → pressing` on `pointerdown`; `pressing → dragging` on hold timer (180 ms); `pressing → idle` on quick release (tap dispatched); `dragging → idle` on release (gesture end dispatched); `pressing|dragging → idle` on `pointercancel` (native scroll stole the gesture).

### Single unified controller

`BrowserInteractionController.svelte` replaces both `GestureModeController.svelte` and `BrowseModeController.svelte`. It is **always mounted** (not gated on `isExpanded`) so its pointerdown listener is live on the browser container from first render. On pointerdown it hit-tests the touched element into a `PressTarget` via the data attributes already present (`data-column`, `data-index`, `data-folder-name`, `data-preset-id`, `data-scale-name`), calls `browserGestureStore.beginPress(...)`, and arms the hold timer. Move/up/cancel attach to `window` so the finger can leave the origin element during drag.

> **Why always-mounted matters.** An earlier iteration gated the controller on `{#if isExpanded}`. That worked for interactions *after* the browser was already open, but silently broke hold-to-drag on the very first vendor press from a closed state: the button's `onVendorPress` fired and flipped `isExpanded = true`, but the controller's reactive mount happens on the *next* microtask — so the currently-in-flight `touchstart` had already propagated past `containerEl` before the controller's listener was attached. Without a `touchstart` being observed, `beginPress` never ran, state stayed `idle`, the hold timer never armed, and a 200 ms hold opened the browser in persistent browse mode instead of entering drag. The bug was state-dependent in a subtle way: if the previous touch had been on a vendor button (closing the browser), the controller was still mounted through the next touchstart and everything worked. If the previous touch had been on a fader/slider/XY pad (outside the browser), the controller was unmounted and the next vendor hold failed. Keeping the controller mounted at all times eliminates the mount race entirely.

### Vendor button opens instantly

`VendorButtonGrid.svelte` is now **purely presentational** — its buttons carry only `data-column` / `data-index` / `data-vendor-id` attributes and no `ontouchstart` / `onmousedown` handlers at all. The always-mounted `BrowserInteractionController` listens for pointerdown at the `.browser` container level and hit-tests into a `PressTarget`. For vendor, scale, and audio targets, the controller fires a synchronous `onOpenTarget(target)` callback during `handlePointerDown`, which runs in the same task as the originating touchstart — so the browser still opens on touchdown with zero lag, without the button needing its own handlers.

The tap-vs-hold distinction (toggle persistent vs enter drag) is decided by the controller on pointerup based on how much time elapsed.

#### Why a single source of truth for presses

An earlier iteration kept per-button `ontouchstart` / `onmousedown` handlers *in addition to* the controller's container listener. Both paths fired for the same event, coordinated via a module-level `pressWasRetap` boolean in `UnifiedGestureBrowser`. This produced two bugs in quick succession:

1. Safari's synthesized mouse-after-touch double-fired the press handler and the controller's pointerdown listener, re-entering `handleVendorPress` with stale state and flipping `pressWasRetap` to `true` so the subsequent release closed the browser instead of leaving it open.
2. When the previous touch was on a non-browser element (fader, slider), the controller was unmounted during the initial vendor touchstart, so the hold timer never armed and a hold silently downgraded to a tap.

Fix (1) was the shared mouse-suppression store; fix (2) was always-mounting the controller. Both were correct, but left a brittle dual-dispatch design: any future change to either the button handlers or the controller had to keep both paths in sync.

The final design collapses the two paths. The controller's pointerdown is the **only** code that reacts to a press inside `.browser`. It:
- hit-tests into a `PressTarget` via data attributes,
- captures `wasRetap = (browser already open on this target)` synchronously onto the target,
- fires `onOpenTarget(target)` if it's a fresh press on a target that should open the browser (vendor / scale / audio),
- calls `beginPress()` and arms the hold timer.

`PressTarget.wasRetap` lives with the press on the gesture store, so the tap dispatcher at release-time reads it from the target itself — no module-level flag, no race window. A retap tap closes; a non-retap tap is a no-op (the press already opened it). A hold ignores `wasRetap` entirely and transitions to drag as usual.

### User-facing behavior decisions

Confirmed with the user during design:

- **Drag trigger is hold-only.** Movement during the pre-hold window does not activate drag; only the 180 ms hold timer firing does. Simpler model and matches the old "deliberate hold" muscle memory.
- **Spacing animates on gesture entry.** The browser opens with compact browse-mode-like gaps. When the hold timer fires, `.gesture-active` is applied and a CSS transition on `gap` and `padding` smoothly expands the layout to the wider gesture-mode spacing. This provides a visible cue that "you're now in drag mode" at the moment of transition.
- **Hold-folder-release-in-place still loads a random preset.** The old "hold folder = random preset" affordance is preserved as a natural fall-through: when the hold timer fires on a folder, the origin folder is seeded as the hover target, so releasing without further movement lands in the random-preset branch of `handleGestureEnd`.
- **Drag always closes.** Any gesture-drag release closes the browser, matching the old gesture-mode close-on-release behavior.

### CSS restructure

The binary `.browser.gesture-mode` / `.browser.browse-mode` class split was removed. Replaced with a single base layout plus a `.browser.gesture-active` / `.browser.dragging` class that applies transient drag-state styling (`cursor: grabbing`, `touch-action: none`, wider gaps, amplified hover highlights). Gap transitions are animated so the mode change is visible. `.folder-navigation .button-list` gained `transition: gap 180ms, padding 180ms` to animate the expansion.

### Hit-test correctness

`elementFromPoint` returns the deepest visible element. Vendor buttons wrap their label in `<span class="category-name">` without data attributes, so a touch on the text would resolve to the span and miss the data-attributed parent. Fixed by setting `pointer-events: none` on `.category-name` so hits fall through to the button element.

### Safari mouse-after-touch guard (shared across components)

Safari fires synthesized mouse events ~100–350 ms after a real touch. The initial implementation kept a local `suppressMouseUntil` inside `BrowserInteractionController`, set on `touchend`. That was insufficient for the instant-open flow because the controller is **not mounted** when the first touch happens — it only mounts reactively once `handleVendorPress` flips `isExpanded = true`. By the time the synthesized `mousedown` arrived, the controller's window listener was live but its `suppressMouseUntil` was still 0.

The observed failure: a real touchstart on a vendor button opened the browser; ~110 ms later Safari's synthesized `mousedown` reached both the button's `onmousedown` (which re-entered `handleVendorPress`, set `pressWasRetap = true`) **and** the controller's window listener (which armed a phantom "press" on the same vendor). On release, the controller dispatched `onTap`, which routed to `handleVendorTapRelease`, which saw the still-set `pressWasRetap` flag and closed the browser. The tap that was supposed to open persistent browse mode flashed open and immediately closed.

Fix: move mouse-after-touch suppression onto `browserGestureStore` as shared state (`noteTouch()` / `shouldSuppressMouse()`, 500 ms window). Both `VendorButtonGrid` (which sees the very first `touchstart` before the controller exists) and `BrowserInteractionController` (which sees subsequent touches via window listeners) call `noteTouch()` on real touches and `shouldSuppressMouse()` before processing a mouse event. The suppression window now covers the entire race — the button's own `onmousedown` re-entry and the controller's phantom `pointerdown` — from the moment the initial finger lands, not from when the controller happens to mount.

## Consequences

- **Positive** — no visible lag on gesture entry; browser appears instantly on any touchdown.
- **Positive** — gesture mode can be entered from any folder or subfolder at any time, not just from column 0 vendor buttons.
- **Positive** — one state machine replaces two controllers' worth of ad-hoc state (`isDragging`, `gestureStartedInColumn0`, `activePointerType`, per-button hold detectors, `.gesture-mode`/`.browse-mode` CSS classes). Net diff was ~640 lines removed vs ~535 added.
- **Positive** — visual gap expansion on drag entry gives clear affordance feedback at the moment of mode change.
- **Positive** — `HoldGestureDetector` class became dead code and was removed; `touchHandlers.ts` is now just three pure hit-test helpers.
- **Positive** — shared mouse-suppression state on `browserGestureStore` eliminates a whole class of "first touch opens, release closes" bugs that the original per-controller `suppressMouseUntil` could not prevent, because the controller mounts *after* the initial touch.
- **Positive** — always-mounted controller means hold-to-drag works on the *first* vendor press from any UI state, not just after a previous browser interaction. Closes a state-dependent bug where a hold would silently downgrade to a tap if the previous touch was a non-browser element (fader, slider, XY pad).
- **Positive** — `VendorButtonGrid` is now purely presentational. The controller is the single source of truth for all press events inside `.browser`, and `PressTarget.wasRetap` travels with the press through the gesture store instead of via a module-level flag — eliminating the dual-dispatch race entirely. Retap-close semantics are the same, but there is one code path instead of two.
- **Negative** — instant-open means `isExpanded = true` fires on every touchdown including taps, so the expand animation plays even for fast toggles. Acceptable in practice since the animation is short and taps finish during it.
- **Negative** — `pointer-events: none` on `.category-name` means CSS `:hover` selectors targeting the span directly (e.g. `.category-button:hover .category-name`) still work via the parent button but any future styling that relies on the span itself intercepting needs to remember this.
- **Follow-ups** — mouse-hover highlights for desktop users while `idle`; explicit cancel-without-load when release coords are outside the browser bounds; optional "scroll wins" heuristic (`dy > dx * 1.5`) as a backup for `pointercancel` on touch-action gating.

## Tags
`browser`, `gesture`, `interaction`, `svelte`, `state-machine`, `ux`
