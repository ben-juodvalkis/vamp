# ADR-378: Random Start Prepend via Device Observer

## Status
**Accepted**

## Context

The `random-start.amxd` M4L utility is prepended before a Simpler on its
device chain so the RANDOM knob appears in the central view
(`SimplerCentralView.svelte`). Previously, `SimplerLoadComponent` called
`_ensure_random_start` explicitly at the end of both `replace_sample` handlers
(capture-flow and clip-flow). This meant browser loads — the third major load
path — were silently skipped: a user loading a sample through the browser
preset panel would get a Simpler with no Random Start, and the RANDOM knob
would never appear.

The root cause was coupling the invariant ("every Simpler track has Random
Start") to specific load-path call sites rather than to the structural event
that actually defines it ("a Simpler was added to a track").

## Decision

Move the Random Start prepend into `DeviceInitComponent.on_device_added` as a
new Pass 2. `DeviceInitComponent` already subscribes to `LOMListeners'`
`on_device_added` callback and fires for every device insertion regardless of
how it arrived — browser load, clip-flow, capture-flow, drag-and-drop, or
manual insertion. When `class_name == "OriginalSimpler"`, Pass 2 calls
`SimplerLoadComponent.ensure_random_start(track)` deferred via
`schedule_delayed(0, ...)` (same pattern as Pass 1 init rules, required because
LOM writes from inside a notification callback are silently dropped by Live).

`SimplerLoadComponent.ensure_random_start` (renamed from `_ensure_random_start`
to make it callable from outside the component) retains all existing logic:
idempotency guard, `load_into_track`, move-to-top, and zero Random Amount. The
`_zero_random_amount`, `_track_has_random_start`, and `_move_last_device_to_top`
helpers remain private.

`LoopingSurface` injects a lazy closure (`_resolve_ensure_random_start`) into
`DeviceInitComponent` rather than a direct reference, because
`SimplerLoadComponent` is constructed after `DeviceInitComponent`. The closure
reads `self._simpler_load_component` at call time and silently no-ops if it
is not yet present (mid-init edge case).

The explicit `_ensure_random_start` call sites are removed from both
`SimplerLoadComponent` replace_sample handlers — the observer now owns the
invariant.

`on_device_added` also fires at startup for already-present devices (the
initial walk). The existing idempotency guard (`_track_has_random_start`)
handles this correctly: tracks that already carry the utility are a no-op.

## Consequences

**Positive:**
- Browser sample loads now prepend Random Start, closing the coverage gap.
- The invariant is expressed once (in the observer) rather than at every
  load-path call site. Adding a fourth load path in the future requires no
  explicit wiring.
- Existing idempotency, error handling, and logging are unchanged.

**Negative:**
- `on_device_added` fires at startup for all existing Simpler tracks. This is
  benign (idempotency guard) but does schedule a deferred `ensure_random_start`
  call per Simpler on session open. Cost is negligible.
- A user who manually deletes Random Start from the chain and then loads any
  sample will have it re-prepended. This matches the intended behavior: the
  utility is considered a required part of the Simpler track setup, not an
  optional add-on.

## Tags
`simpler`, `random-start`, `device-observer`, `device-init`, `browser-load`
