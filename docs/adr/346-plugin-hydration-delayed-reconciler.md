# ADR-346: Plugin-Hydration Delayed Reconciler for AU/VST Parameter Lists

## Status
**Accepted**

## Context

Dragging an Omnisphere XY pad on the central view set the parameter value in Ableton but the UI handle snapped back to `(0.5, 0.5)` on release. Every XY drag released into a snap-back — blocking live performance.

Root cause, proven by Playwright-driven drag capture against the running UI:

- When Omnisphere is loaded onto a track, the Python surface correctly emits `/looping/v3/state/full` immediately. At that moment, Live's LOM reports Omnisphere has **1 parameter** (`[Device On]`) — the AU plugin is still booting its Configure mapping.
- Seconds later, the plugin finishes hydrating and Live's `device.parameters` grows to 27 entries (the full mapped set, macros + XY axes + filter/space/etc.).
- The surface already installed a `device.add_parameters_listener` (intended to pick up exactly this case). **It never fires for AU plugins in Live 12.3.x.** The listener attaches without error; the observation just never emits on post-insertion hydration.
- Result: UI tree stays at `paramCount=1`, every XY drag `send('/looping/v3/param/set', paramPath, …)` writes to a path the UI's path-keyed store does not know about. The normalized store drops the echo (`applyParamValue: unknown param`), the `<DeviceXY>` `$effect sync` reads back `undefined` from the store, coerces to 0.5, and the handle snaps to center.

Four prior attempts shipped without resolving it:
- ADR-001 — optimistic local write in `setParamValue`. Cleaner write path but still drops when the param is not in the store.
- ADR-002 — `SvelteMap` reactivity fix. Correct, but didn't address the missing-param case.
- ADR-003 — reconciling `replaceTree`. Preserves store identity across state/full re-emits, prerequisite for this fix.
- Surface-side `add_parameters_listener` — the right instinct, wrong trigger for AU plugins on this Live version.

Diagnostics also surfaced 40+ log warnings per plugin teardown:
```
LOMListeners: remove_value_listener failed for param_id=… Python argument types in
    DeviceParameter.remove_value_listener(DeviceParameter, function)
did not match C++ signature:
    remove_value_listener(TPyHandle<ATimeableValue>, boost::python::api::object)
```
These are the LOM's way of saying *"this handle is already dead"* — expected on device removal — but at WARNING level they drown real listener bugs in log noise.

## Decision

Two complementary fixes, both in `components/LOMListeners.py`.

### Fix A — Delayed post-add reconciler (the snapback fix)

After every device-add event, schedule a one-shot reconciler at **+750ms** via `ControlSurface.schedule_message`. The reconciler:

1. Reads the current `len(device.parameters)`.
2. Compares to the count snapshotted at add-time.
3. If the list grew, re-binds value-listeners for the now-visible params and fires `on_structural_change`, which re-emits `state/full` with the fully-hydrated parameter set.

Why 750ms: empirically Omnisphere and other AU plugins finish exposing their mapped parameter list within ~300–500ms of insertion. 750ms buys a comfortable margin without a noticeable delay in the UI's param appearance.

Wiring:
- `LOMListeners.__init__` takes a new `schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]]` arg.
- `LoopingSurface` passes `self._schedule_delayed` (the existing ms→ticks adapter around `ControlSurface.schedule_message`).
- Epoch-guarded: a global monotonic counter invalidates any pending reconciler if the same Python device churns through a rapid remove-and-readd before its callback fires. Prevents duplicate `state/full` emits during preset-swap churn.
- Tests inject a `_ManualScheduler` that records pending callbacks; `fire_all()` drives the timing deterministically.

The existing `add_parameters_listener` path stays — on stock devices (Operator, Reverb, …) it fires normally and covers the same case without the 750ms delay. The reconciler is a *belt-and-braces* pass for the plugin subclass the LOM observation skips.

### Fix B — Stale-handle suppression on listener detach

Live's `remove_*_listener` bindings raise `Boost.Python.ArgumentError` (a `TypeError` subclass) with "did not match C++ signature" in the message when the LOM wrapper's underlying object is already gone. On device removal, this is **expected**: the LOM has already detached listeners C++-side. The bookkeeping clears either way.

Fix: classify the exception via a new `_is_stale_handle_error(exc)` helper (matches on "did not match C++ signature" or "TPyHandle" substrings) and log stale-handle detaches at DEBUG rather than WARNING. Non-stale failures still log at WARNING so real listener-leak bugs remain visible.

## Consequences

**Positive:**
- XY snapback resolved: Omnisphere drags write to parameter paths the UI knows about.
- Pattern generalizes to every AU/VST that hydrates asynchronously — Kontakt, Pianoteq, instrument sampler plugins, etc. Not Omnisphere-specific.
- Epoch-guarded reconciler is safe under rapid preset churn: exactly one `state/full` re-emit per "real" hydration event, regardless of user tapping through presets quickly.
- Log.txt is readable again on device removal — ~40 lines per departure collapsed to a single DEBUG line.

**Negative:**
- `state/full` emits are now paced `1 + 1` per plugin insertion (immediate + delayed) instead of just `1`. State/full is chunked and idempotent; the UI's path-keyed reconciling `replaceTree` (ADR-003) preserves store identity across both, so no flicker.
- 750ms constant is empirical. Plugins that hydrate slower still snap back until their observation eventually lands, or until the next device-add trigger. A follow-up ADR could add a second poll at +3s if this turns out to be a problem.
- The delayed-scheduler parameter threads from `LoopingSurface` down into `LOMListeners`, coupling the class to the Live tick adapter. We already pass `song` and four callbacks; one more constructor arg doesn't materially change the interface.

**Rejected alternatives:**
- Polling every N seconds: wasteful, and hides the per-device signal.
- Observing `device.class_name` to only schedule for `AuPluginDevice` / `PluginDevice`: brittle cross-version, and the cost of a no-op reconciler on a non-plugin device is one `len()` call.
- Client-side retry on `applyParamValue: unknown param`: pushes the Live-version-specific workaround into the UI, which shouldn't care whether the plugin is stock or AU.

## Tags

`bugfix`, `lom-listeners`, `plugin-hydration`, `omnisphere`, `au-plugin`, `snapback`, `live-12.3`
