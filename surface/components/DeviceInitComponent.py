"""DeviceInitComponent — device-class-keyed init rules + AU-plugin retry.

Phase 12 pr12-4. Replaces the M4L pair
[device-initialization.js](../../../scripts/device-initialization.js) +
[liveAPI-v6.js:1800-1839](../../../scripts/liveAPI-v6.js#L1800-L1839)
with a Python component that subscribes to LOMListeners'
``on_device_added`` callback.

## Two responsibilities, one component

Both kick off on ``on_device_added`` for pragmatic reasons:

1. **Simpler-type init rules.** When an ``OriginalSimpler`` device is
   inserted (most commonly by a preset load onto a new MIDI track),
   write a canonical set of parameter
   + property values so the track is playable in a looper-friendly
   mode (Loop on, Gate trigger, Classic playback, Warp off). Rules
   live in ``_INIT_RULES`` below; ``data/device-configs.json`` does
   **not** carry init rules.

2. **Random Start prepend.** When an ``OriginalSimpler`` is inserted by
   any means (browser load, clip-flow, capture-flow, drag-and-drop,
   or manual insertion), idempotently prepend the ``random-start``
   M4L utility so the RANDOM knob is always available in the central
   view. The callable is injected at construction time so
   ``SimplerLoadComponent`` owns the prepend logic; this component
   just triggers it from the right hook. If the callable is ``None``
   (feature disabled or surface mid-init), the pass is silently
   skipped. ADR-378.

3. **AU-plugin parameter-population retry.** macOS AU plugins
   (Komplete Kontrol, Omnisphere) don't expose their parameter
   list synchronously at insert; first LOM read finds
   ``device.parameters`` empty. Schedule 400/800/1600ms retries
   that re-emit a scoped ``state/full`` for the track when the
   params finally populate. The legacy M4L retry chain is at
   [liveAPI-v6.js:1350-1408 checkAuPluginsNeedRetry / scheduleAuPluginRetry](../../../scripts/liveAPI-v6.js#L1350-L1408);
   the Python port drops the M4L counter and timer in favour of
   ``schedule_delayed`` + per-device epoch guards.

The two behaviours share this component because both fire off the
same LOM hook, both need the ``_LOM_ERRORS`` guard discipline, and
both emit a scoped ``state/full`` as their success signal — init
rules fire value-listeners that advance generation, then the
scoped emit carries the canonical tree to the UI. Keeping them
separate would duplicate plumbing (hook subscription, track
resolution, scope emission) without a meaningful boundary.

## Why scoped emission (not whole-song)

Per [phase-12-device-observer-design.md §4.4](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/phase-12-device-observer-design.md#44-au-plugin-retry--decision),
scoped beats full-song for wire economy (1-track subtree vs. full
tree × 3 retries) and UI simplicity (no spinner state). The
``emit_selection_change`` callable is injected at construction
time so the component doesn't import ``V3StateFullComponent``
directly.

## Lifecycle

- **``__init__``**: store callables + rule table. No LOM work.
- **``on_device_added(track, device, chain_idx)``**: public entry
  point, installed via ``LOMListeners.set_mutation_callbacks``
  (or composed alongside another consumer by ``LoopingSurface``).
  Runs init rules synchronously if the device matches a rule;
  schedules AU-retry chain for ``AuPluginDevice``. Never raises.
- **``disconnect``**: idempotent; marks ``_disconnected`` so
  scheduled retries no-op on fire.

## Epoch discipline

Each AU-retry schedule captures a per-track monotonic epoch. The
closure compares its captured epoch to ``_au_retry_epoch[track_id]``
at fire time and bails if they differ — i.e., if the user selected
a different track (and a new retry was scheduled against it) in
between. Covers the design §4.4 "track-switched-mid-retry" case.
A device removal between schedule and fire is handled by
``_LOM_ERRORS`` on the ``device.parameters`` read.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional, Tuple

logger = logging.getLogger("looping")


_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --------------------------------------------------------------------------
# Rule table
# --------------------------------------------------------------------------
#
# Hand-written per design §3.4 Q2: one device, 6 actions — below the
# 50 LOC generator budget. This table is authoritative; if you add a
# device that needs initialization on insert, edit it here.
# ``data/device-configs.json`` does not carry init rules.
#
# Keyed by LOM ``class_name``. A secondary ``class_name:device_name``
# key is supported (for AuPluginDevice-per-plugin overrides); the
# lookup order lives in ``_lookup_rules``.

_INIT_RULES: dict = {
    "OriginalSimpler": {
        "description": (
            "Enable Loop, Gate mode, disable Retrigger and Warping, "
            "Thru slicing, and Classic playback"
        ),
        "actions": [
            {"type": "set_parameter", "index": 5, "value": 1},
            {"type": "set_parameter", "index": 34, "value": 1},
            {"type": "set_property", "path": "playback_mode", "value": 0},
            {"type": "set_property", "path": "retrigger", "value": 0},
            {"type": "set_property", "path": "sample.warping", "value": 0},
            {"type": "set_property", "path": "slicing_playback_mode", "value": 2},
        ],
    },
}


# Retry cadence. Matches the legacy M4L 400/800/1600ms backoff. The
# surface's ``_schedule_delayed`` rounds delays to the 100ms tick
# grid, so these three values land cleanly on ticks 4 / 8 / 16.
_AU_RETRY_DELAYS_MS: Tuple[int, ...] = (400, 800, 1600)


class DeviceInitComponent:
    """Writes canonical defaults on insert; re-emits scoped state/full for AU retries.

    Args:
        song: Live ``Song`` — used to resolve a ``track`` object to
            its canonical ``tracks/<N>`` or ``master`` path.
        emit_selection_change: ``(track_path: str) -> None``. Binds
            to ``V3StateFullComponent.emit_selection_change``. Invoked
            after successful init rule writes (to ship the written
            values) and on AU-retry success.
        schedule_delayed: ``(delay_ms: int, fn: Callable[[], None]) -> None``.
            Binds to ``LoopingSurface._schedule_delayed`` in
            production; tests pass a manual scheduler.
        compose_track_path: ``(song, track) -> Optional[str]``. The
            existing ``components.path_resolver.compose_track_path``;
            injected so the component doesn't depend on the module
            at class scope (lets tests pass a stub resolver).
        ensure_random_start: ``(track) -> None`` or ``None``. When
            supplied, called (deferred) after every ``OriginalSimpler``
            insertion to idempotently prepend the Random Start utility.
            Binds to ``SimplerLoadComponent._ensure_random_start`` in
            production. ``None`` disables the pass (feature off or
            surface mid-init).

    Lifecycle:
        ``__init__`` stores callables and zeroes the AU-retry epoch
        table; attaches no LOM listeners of its own. Event
        subscription happens at ``LoopingSurface.set_mutation_callbacks``
        wiring time, not here. ``disconnect`` is a simple flag flip.
    """

    def __init__(
        self,
        song,
        emit_selection_change: Callable[[str], None],
        schedule_delayed: Callable[[int, Callable[[], None]], None],
        compose_track_path: Callable[[Any, Any], Optional[str]],
        ensure_random_start: Optional[Callable] = None,
    ):
        self._song = song
        self._emit_selection_change = emit_selection_change
        self._schedule_delayed = schedule_delayed
        self._compose_track_path = compose_track_path
        self._ensure_random_start = ensure_random_start
        self._disconnected = False

        # Per-track monotonic epoch. A new AU-retry schedule bumps
        # ``_au_retry_epoch[id(track)]``; retry closures capture the
        # same value and bail on mismatch. See module docstring.
        self._au_retry_epoch: dict = {}

    # --- public entry point ----------------------------------------------

    def on_device_added(self, track, device, chain_idx: int) -> None:
        """LOM ``on_device_added`` subscriber.

        Runs three independent passes:

        1. Init-rule match by ``device.class_name`` → apply actions
           → scoped re-emit for the track.
        2. Random Start prepend — when an ``OriginalSimpler`` is added
           by any means, idempotently prepend the utility (ADR-378).
        3. AU-plugin check → schedule retry chain.

        Guarded so a failing rule on one device doesn't derail the
        other pass (or subsequent devices). Never raises.
        """
        if self._disconnected:
            return

        class_name = self._safe_class_name(device)
        if class_name is None:
            return

        device_name = self._safe_device_name(device)

        # Pass 1: init rules. Deferred to the next control-thread
        # tick because Live rejects parameter/property writes made
        # from inside a notification callback ("Changes cannot be
        # triggered by notifications. You will need to defer your
        # response."). ``on_device_added`` IS such a notification,
        # so every write during _apply_rules was silently failing.
        # The 0ms delay rounds up to the next scheduler tick — writes
        # then run on the control thread, same frame as OSC handlers.
        rules = self._lookup_rules(class_name, device_name)
        if rules is not None:
            try:
                self._schedule_delayed(
                    0, lambda: self._apply_rules_if_live(track, device, rules),
                )
            except Exception as e:  # noqa: BLE001 — scheduler is trusted; log + drop
                logger.warning(
                    "DeviceInitComponent: schedule_delayed(0) for init "
                    "rules failed: %s", e,
                )

        # Pass 2: Random Start prepend. Fires for every OriginalSimpler
        # insertion regardless of load path (browser, clip-flow, capture,
        # drag-and-drop). Deferred for the same reason as Pass 1 — LOM
        # writes from inside a notification callback are silently dropped.
        # _ensure_random_start is idempotent; a track that already has the
        # utility is a no-op. ``on_device_added`` also fires at startup for
        # already-present devices — the idempotency guard handles that too.
        if class_name == "OriginalSimpler" and self._ensure_random_start is not None:
            fn = self._ensure_random_start
            try:
                self._schedule_delayed(0, lambda: fn(track))
            except Exception as e:  # noqa: BLE001 — scheduler is trusted; log + drop
                logger.warning(
                    "DeviceInitComponent: schedule_delayed(0) for Random Start "
                    "prepend failed: %s", e,
                )

        # Pass 3: AU-plugin retry. The init-rule pass also covers the
        # case where an AU plugin happens to match a rule — not today
        # in practice (rules key on OriginalSimpler) but the two are
        # orthogonal by design.
        if class_name == "AuPluginDevice":
            self._schedule_au_retry(track, device)

    def _apply_rules_if_live(self, track, device, rules: dict) -> None:
        """Thin wrapper that bails if the component was disconnected
        between ``on_device_added`` and the scheduled fire — e.g. Live
        set reload mid-tick. ``_apply_rules`` itself is unchanged.
        """
        if self._disconnected:
            return
        self._apply_rules(track, device, rules)

    # --- init-rule application -------------------------------------------

    def _apply_rules(self, track, device, rules: dict) -> None:
        """Run every action in ``rules['actions']`` against ``device``.

        Writes use the same ``_LOM_ERRORS`` discipline as every other
        LOM-touching component: each action is independently guarded
        so a single failure doesn't abort the chain. After all actions
        run, fires a scoped ``state/full`` so the UI sees the new
        param/property values as one coherent bundle.

        Zero successful writes → no scoped emit. The init-rule miss
        is logged but not wire-signalled; the UI still has whatever
        state was already live.
        """
        actions = rules.get("actions") or []
        any_applied = False
        for action in actions:
            if self._apply_action(device, action):
                any_applied = True

        if not any_applied:
            return

        self._emit_scope_for_track(track)

    def _apply_action(self, device, action: dict) -> bool:
        """Apply one action. Returns True if write succeeded.

        Supported types:
            ``set_parameter`` — write ``device.parameters[index].value = value``.
            ``set_property`` — dotted-path setattr: ``sample.warping = 0``
              navigates ``device.sample`` then setattrs ``warping``.

        Unknown action types log-warn and return False so the caller
        knows to skip the scoped emit if nothing else succeeded.
        """
        atype = action.get("type")
        if atype == "set_parameter":
            return self._set_parameter(
                device, action.get("index"), action.get("value"),
            )
        if atype == "set_property":
            return self._set_property(
                device, action.get("path"), action.get("value"),
            )
        logger.warning(
            "DeviceInitComponent: unknown action type %r on device %r",
            atype, device,
        )
        return False

    def _set_parameter(self, device, index, value) -> bool:
        if not isinstance(index, int) or index < 0:
            logger.warning(
                "DeviceInitComponent: set_parameter bad index=%r", index,
            )
            return False
        try:
            params = device.parameters
            if index >= len(params):
                logger.warning(
                    "DeviceInitComponent: set_parameter index=%d out of "
                    "range (len=%d)", index, len(params),
                )
                return False
            params[index].value = value
        except _LOM_ERRORS as e:
            logger.warning(
                "DeviceInitComponent: set_parameter[%d]=%r failed on %r: %s",
                index, value, device, e,
            )
            return False
        return True

    def _set_property(self, device, path, value) -> bool:
        if not isinstance(path, str) or not path:
            logger.warning(
                "DeviceInitComponent: set_property bad path=%r", path,
            )
            return False
        segments = path.split(".")
        try:
            obj = device
            for seg in segments[:-1]:
                obj = getattr(obj, seg)
            setattr(obj, segments[-1], value)
        except _LOM_ERRORS as e:
            logger.warning(
                "DeviceInitComponent: set_property %s=%r failed on %r: %s",
                path, value, device, e,
            )
            return False
        return True

    # --- AU-plugin retry --------------------------------------------------

    def _schedule_au_retry(self, track, device) -> None:
        """Schedule 3 retries that emit scoped state/full when AU params populate.

        Each retry is an independent closure that captures:

        - ``track`` (for path resolution + epoch key)
        - ``device`` (for the ``parameters`` probe)
        - ``epoch`` (for track-switched-mid-retry guard)

        First retry where ``len(device.parameters) > 0`` wins — we
        fire the scoped emit and return without scheduling the
        remaining retries in that chain. Closures already enqueued
        still fire but short-circuit on the ``track_done`` check
        (their captured epoch was pre-bump; the bump happens on a
        fresh ``on_device_added``, not on the win).

        The win does NOT bump the epoch — so the trailing closures
        still match and run their own ``parameters`` probe. That's
        fine: after the first success, ``parameters`` stays
        populated, and the subsequent scoped emits are idempotent
        (same generation, same checksum → UI dedup). The minor
        cost is 2 extra checksumming passes; the benefit is we
        don't need a "first-win" flag to synchronize closures.
        """
        track_key = id(track)
        epoch = self._au_retry_epoch.get(track_key, 0) + 1
        self._au_retry_epoch[track_key] = epoch

        retries = list(enumerate(_AU_RETRY_DELAYS_MS))
        last_idx = len(retries) - 1
        for idx, delay_ms in retries:
            is_last = idx == last_idx
            self._schedule_one_retry(
                track, track_key, device, epoch, delay_ms, is_last,
            )

    def _schedule_one_retry(
        self, track, track_key: int, device, epoch: int, delay_ms: int,
        is_last: bool = False,
    ) -> None:
        def _fire() -> None:
            if self._disconnected:
                return
            if self._au_retry_epoch.get(track_key) != epoch:
                # Different device added to this track, or track
                # observation was torn down, between schedule and fire.
                return
            try:
                count = len(device.parameters)
            except _LOM_ERRORS as e:
                logger.debug(
                    "DeviceInitComponent: AU retry parameters read failed "
                    "(device removed?): %s", e,
                )
                return
            try:
                if count > 0:
                    self._emit_scope_for_track(track)
            finally:
                # Last retry in the chain clears its epoch so deleted
                # tracks don't leave orphan keys in the dict. Only the
                # last retry pops — earlier fires may still be in flight.
                if is_last and self._au_retry_epoch.get(track_key) == epoch:
                    self._au_retry_epoch.pop(track_key, None)

        try:
            self._schedule_delayed(delay_ms, _fire)
        except Exception as e:  # noqa: BLE001 — scheduler is trusted; log + drop
            logger.warning(
                "DeviceInitComponent: schedule_delayed(%d) failed: %s",
                delay_ms, e,
            )

    # --- helpers ---------------------------------------------------------

    def _emit_scope_for_track(self, track) -> None:
        """Resolve track → path → scoped emit. Null path logs + skips."""
        try:
            path = self._compose_track_path(self._song, track)
        except _LOM_ERRORS as e:
            logger.warning(
                "DeviceInitComponent: compose_track_path raised: %s", e,
            )
            return
        if not path:
            logger.debug(
                "DeviceInitComponent: track not resolvable to a path; "
                "skipping scoped emit",
            )
            return
        try:
            self._emit_selection_change(path)
        except Exception as e:  # noqa: BLE001 — emit path is best-effort
            logger.warning(
                "DeviceInitComponent: emit_selection_change(%s) raised: %s",
                path, e,
            )

    def _lookup_rules(self, class_name: str, device_name: Optional[str]) -> Optional[dict]:
        """Look up rules by ``class_name[:device_name]`` then by ``class_name``.

        Mirrors the JS ``getDeviceInitialization`` fallback order so
        an AU-plugin-per-name override (``AuPluginDevice:Omnisphere``)
        would resolve before the bare-class lookup.
        """
        if device_name:
            key = "%s:%s" % (class_name, device_name)
            rules = _INIT_RULES.get(key)
            if rules is not None:
                return rules
        return _INIT_RULES.get(class_name)

    @staticmethod
    def _safe_class_name(device) -> Optional[str]:
        try:
            value = getattr(device, "class_name", None)
        except _LOM_ERRORS:
            return None
        if not isinstance(value, str):
            return None
        return value

    @staticmethod
    def _safe_device_name(device) -> Optional[str]:
        try:
            value = getattr(device, "name", None)
        except _LOM_ERRORS:
            return None
        if not isinstance(value, str):
            return None
        return value

    # --- teardown --------------------------------------------------------

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        self._au_retry_epoch.clear()
