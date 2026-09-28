"""MetersComponent — PR-5c output-meter channel.

Owns ``/looping/v3/track/meter`` (regular tracks) and
``/looping/v3/master/meter`` (master) per
[04 §3.3](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md)
and [phase-5-pr5c-meters-design.md].

Scope: ``output_meter_left`` and ``output_meter_right`` on every
regular track plus the master track. Input meters stay on M4L for
Phase 5; a later PR may migrate them.

Throttle — 30 Hz per track, drop-intermediate
---------------------------------------------

Each track has its own 33.33 ms emit window keyed by its path
(``"tracks/<N>"`` or ``"master"``). On every fire we check
``time.monotonic()`` against ``_last_emit[key]``; if the window has
not elapsed we drop the fire silently. Drop-intermediate is the
simplest correct semantics for "emit the latest value at most every
33 ms" (design §3.1) — no leaky/token bucket, no queue, no memory
drift.

We use ``time.monotonic()`` (not ``time.time()``) because the throttle
must be immune to wall-clock jumps from DST, NTP step, or manual
clock-set. A backward wall-clock jump would trip the window open on
every fire and saturate the wire; a forward jump would silence meters
for the jump duration. Monotonic has neither failure mode.

Listener discipline
-------------------

Track-side: direct ``add_output_meter_left_listener`` /
``add_output_meter_right_listener`` on each regular track, with the
same ``on_structural_change`` rebind hook
TrackMetadataComponent uses. Both channels of a track share one
callback closure — the closure reads L and R from the track and emits
``[path, L, R]`` in one packet, so the throttle window applies to the
pair, not per-channel.

The design doc originally sketched a ``LOMListeners.register_meter_observer``
entry point. We follow TrackMetadataComponent's direct-attach pattern
instead, because (a) PR-5a / PR-5b already landed this shape, (b) it
avoids adding new API surface to LOMListeners for a single consumer,
and (c) the structural-rebind semantics are identical either way.

Master-side: direct attach in ``__init__``; master is a singleton with
no add/remove lifecycle, so no structural rebind is needed. The
``RuntimeError``/``AttributeError`` guard lives on every LOM touch for
the Live 12 property-access quirks that hit master.

No echo suppression
-------------------

Meters fire at tens of Hz and are read-only from the UI side — there
is no "UI→Surface write" to self-echo from. Suppression would be a
no-op, so we skip it (design §3.1).

Init-emit at startup
--------------------

State/full does not carry meter values; without a seed emit the UI's
meter derivation reads its 0.0 default until audio starts hitting the
listener threshold. ``_emit_initial_values()`` runs once at
``__init__`` after listener attach, emitting the current L/R for every
regular track plus master. This closes the cold-start gap — an idle
session (no audio) reports zero on the wire instead of never emitting
at all.

Generation — not carried on meter emits
---------------------------------------

Meter emits omit the structural generation (design §3.5). Meters don't
reshape the LOM; their value change doesn't advance generation. A
meter fire against a deleted track is prevented by the structural
detach path below — no stale-fire window to worry about.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Dict, List, Tuple

logger = logging.getLogger("looping")


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_TRACK_METER_ADDRESS = "/looping/v3/track/meter"
V3_MASTER_METER_ADDRESS = "/looping/v3/master/meter"


# --- throttle -------------------------------------------------------------

_RATE_HZ = 30
_WINDOW_SEC = 1.0 / _RATE_HZ  # 33.333... ms

# Keyed as "master" for the master track; "tracks/<N>" for regular tracks.
_MASTER_KEY = "master"


# --- component ------------------------------------------------------------


class MetersComponent:
    """Owns the ``/looping/v3/{track,master}/meter`` address family.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.

    No handlers are registered with the transport — meters are
    emit-only. The component only needs ``emit``; there is no
    ``set_generation`` because meter emits are not generation-gated.
    """

    WINDOW_SEC = _WINDOW_SEC

    def __init__(self, song, emit: Callable[[str, tuple], None]) -> None:
        self._song = song
        self._emit = emit
        self._disconnected = False

        # key → float (monotonic seconds). Shared between track and
        # master; keys are disjoint (tracks/<N> vs. "master").
        self._last_emit: Dict[str, float] = {}

        # Detach records — flat list of every track-side listener we
        # attached. Each record is ``(track, remove_method_name, cb,
        # track_path)`` where ``track`` is the wrapper we attached on,
        # ``cb`` is the shared L/R callback, and ``track_path`` is for
        # debug logging. Same shape TrackMetadataComponent uses (issue
        # #399 / ADR-350): ``id(track)`` is not stable across
        # ``song.tracks`` reads, so we hold detach refs by storing the
        # actual wrapper rather than its identity.
        self._track_listeners: List[
            Tuple[Any, str, Callable[[], None], str]
        ] = []

        # Master listener bookkeeping: the same callback is attached
        # to both L and R listeners.
        self._master = None
        self._master_cb: Callable[[], None] = None  # type: ignore[assignment]
        self._master_attached_left = False
        self._master_attached_right = False

        # (key, context) → True once WARNING has been logged, so a
        # RuntimeError inside a high-rate listener doesn't flood
        # Log.txt. Same pattern as MasterComponent.
        self._warned: set = set()

        self._bind_all_tracks()
        self._bind_master()
        self._emit_initial_values()

        logger.info(
            "MetersComponent ready: %d track-side listener records "
            "(2 per regular track, L+R), master=%s",
            len(self._track_listeners),
            "bound" if (self._master_attached_left
                        and self._master_attached_right) else "unavailable",
        )

    # --- structural-change hook -------------------------------------------

    def on_structural_change(self) -> None:
        """Detach every prior per-track listener, rebind against the walk.

        Issue #399: stale closures from a prior bind capture the *old*
        canonical path — after a track delete, the surviving track at
        the same index keeps emitting on the deleted track's path,
        contaminating the sibling slot in the UI's meter store. Drop
        every per-track listener and rebuild — no identity-based
        bookkeeping (ADR-350: Live hands out fresh wrappers per read,
        so ``id(track)`` is unreliable; the previous attempt that keyed
        on it lost detach refs and made the bug worse).

        Master listeners are left alone — master has no add/remove
        lifecycle.

        Per-track ``_last_emit`` entries for departed tracks are
        pruned; keeping them would leak memory across the lifetime of
        a long session with heavy track add/remove churn. Master key
        is preserved.
        """
        if self._disconnected:
            return

        for track, remove_method_name, cb, path in self._track_listeners:
            self._safe_remove_listener(track, remove_method_name, cb, path)
        self._track_listeners.clear()

        self._bind_all_tracks()

        # Prune stale last-emit entries. Master key is preserved.
        live_keys = {path for _track, _rm, _cb, path
                     in self._track_listeners}
        live_keys.add(_MASTER_KEY)
        for key in list(self._last_emit.keys()):
            if key not in live_keys:
                del self._last_emit[key]

    def _safe_remove_listener(
        self, target, remove_method_name: str, cb: Callable, path: str,
    ) -> None:
        """Call ``target.<remove_method_name>(cb)``, swallow LOM errors.

        Live tears down C++-side listeners when the LOM handle leaves
        the song, in which case the Python remove call raises
        ``Boost.Python.ArgumentError`` (a ``TypeError`` subclass) or
        ``RuntimeError``. Either is benign — we wanted detach, the C++
        side already did it.
        """
        remove = getattr(target, remove_method_name, None)
        if not callable(remove):
            return
        try:
            remove(cb)
        except (RuntimeError, AttributeError, TypeError) as e:
            logger.debug(
                "MetersComponent: %s on %s raised: %s",
                remove_method_name, path, e,
            )

    # --- listener attach / detach -----------------------------------------

    def _bind_all_tracks(self) -> None:
        """Attach L+R meter listeners to each regular track."""
        for idx, track in enumerate(self._iter_regular_tracks()):
            self._bind_track(track, "tracks/%d" % idx)

    def _bind_track(self, track, track_path: str) -> None:
        """Attach one shared L/R callback to a single track.

        The same callback is added as both ``output_meter_left`` and
        ``output_meter_right`` listener. Either fire triggers one
        ``[path, L, R]`` emit, throttled by the per-track window.
        Attaching once per channel means an L-only fire or an R-only
        fire still wakes the window. Each successful attach pushes a
        detach record (with the matching ``remove_*_listener`` name)
        onto ``_track_listeners`` so the rebind path can detach.
        """
        cb = self._make_track_listener(track=track, path=track_path)
        for method_name in ("add_output_meter_left_listener",
                            "add_output_meter_right_listener"):
            add = getattr(track, method_name, None)
            if not callable(add):
                self._warn_once(
                    track_path, "attach-missing",
                    AttributeError("no %s on track" % method_name),
                )
                continue
            try:
                add(cb)
            except (RuntimeError, AttributeError) as e:
                self._warn_once(track_path, "attach", e)
                continue
            remove_method_name = "remove_" + method_name[len("add_"):]
            self._track_listeners.append(
                (track, remove_method_name, cb, track_path),
            )

    def _bind_master(self) -> None:
        """Attach L+R meter listeners on the master track.

        Master is a singleton — no structural rebind. Attach failure
        on either channel is guard-logged once; the component stays
        up partial (per-track listeners may still be fine).
        """
        try:
            self._master = self._song.master_track
        except (RuntimeError, AttributeError) as e:
            self._warn_once(_MASTER_KEY, "master-lookup", e)
            self._master = None
            return

        cb = self._make_master_listener()
        self._master_cb = cb

        add_left = getattr(
            self._master, "add_output_meter_left_listener", None,
        )
        if callable(add_left):
            try:
                add_left(cb)
                self._master_attached_left = True
            except (RuntimeError, AttributeError) as e:
                self._warn_once(_MASTER_KEY, "master-attach-left", e)
        else:
            self._warn_once(
                _MASTER_KEY, "master-attach-left-missing",
                AttributeError(
                    "no add_output_meter_left_listener on master_track",
                ),
            )

        add_right = getattr(
            self._master, "add_output_meter_right_listener", None,
        )
        if callable(add_right):
            try:
                add_right(cb)
                self._master_attached_right = True
            except (RuntimeError, AttributeError) as e:
                self._warn_once(_MASTER_KEY, "master-attach-right", e)
        else:
            self._warn_once(
                _MASTER_KEY, "master-attach-right-missing",
                AttributeError(
                    "no add_output_meter_right_listener on master_track",
                ),
            )

    def _make_track_listener(
        self, track, path: str,
    ) -> Callable[[], None]:
        """Build the L/R-shared closure for one regular track.

        Captures ``track`` for fire-time ``getattr`` and ``path`` for
        the emit payload + throttle key. Same per-iteration default-arg
        closure pattern TrackMetadataComponent uses to sidestep the
        PR-4a loop-variable capture bug.
        """

        def _on_fire(t=track, p=path):
            if self._disconnected:
                return
            if not self._window_open(p):
                return
            try:
                left = t.output_meter_left
                right = t.output_meter_right
            except (RuntimeError, AttributeError) as e:
                self._warn_once(p, "read-in-listener", e)
                return
            self._safe_emit(
                V3_TRACK_METER_ADDRESS,
                (p, float(left), float(right)),
            )

        return _on_fire

    def _make_master_listener(self) -> Callable[[], None]:
        """Build the L/R-shared closure for the master track."""

        def _on_fire():
            if self._disconnected or self._master is None:
                return
            if not self._window_open(_MASTER_KEY):
                return
            try:
                left = self._master.output_meter_left
                right = self._master.output_meter_right
            except (RuntimeError, AttributeError) as e:
                self._warn_once(_MASTER_KEY, "read-in-listener", e)
                return
            self._safe_emit(
                V3_MASTER_METER_ADDRESS,
                (float(left), float(right)),
            )

        return _on_fire

    def _emit_initial_values(self) -> None:
        """Read current L/R on every track + master and emit once.

        Closes the cold-start gap — see module docstring "Init-emit at
        startup". Runs after listener attach so a value change racing
        the boot sequence is still picked up by the listener
        (idempotent re-emit is harmless: same value). The throttle
        ``_last_emit`` is updated by these emits, so a listener fire
        within the next 33 ms gets correctly suppressed.
        """
        tracks = list(self._iter_regular_tracks())
        for idx, track in enumerate(tracks):
            path = "tracks/%d" % idx
            try:
                left = track.output_meter_left
                right = track.output_meter_right
            except (RuntimeError, AttributeError) as e:
                self._warn_once(path, "initial-read", e)
                continue
            # Open the window for this track so the emit isn't
            # throttled on a cold cache. ``_window_open`` updates
            # ``_last_emit`` as a side effect.
            self._window_open(path)
            self._safe_emit(
                V3_TRACK_METER_ADDRESS,
                (path, float(left), float(right)),
            )

        if self._master is not None and (
            self._master_attached_left or self._master_attached_right
        ):
            try:
                left = self._master.output_meter_left
                right = self._master.output_meter_right
            except (RuntimeError, AttributeError) as e:
                self._warn_once(_MASTER_KEY, "initial-read", e)
                return
            self._window_open(_MASTER_KEY)
            self._safe_emit(
                V3_MASTER_METER_ADDRESS,
                (float(left), float(right)),
            )

    # --- throttle ---------------------------------------------------------

    def _window_open(self, key: str) -> bool:
        """Return True iff the 33 ms window has elapsed for ``key``.

        Updates ``_last_emit[key]`` as a side effect when it returns
        True. ``time.monotonic()`` chosen over ``time.time()`` so DST /
        NTP step cannot open or stall the window — see module docstring
        "Throttle".
        """
        now = time.monotonic()
        last = self._last_emit.get(key, 0.0)
        if now - last < self.WINDOW_SEC:
            return False
        self._last_emit[key] = now
        return True

    # --- iteration helpers ------------------------------------------------

    def _iter_regular_tracks(self) -> List[object]:
        try:
            return list(self._song.tracks)
        except Exception as e:
            logger.warning(
                "MetersComponent: tracks read failed: %s", e,
            )
            return []

    # --- emit helpers -----------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning(
                "MetersComponent: emit %s failed: %s", address, e,
            )

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        wkey: Tuple[str, str] = (key, context)
        if wkey in self._warned:
            return
        self._warned.add(wkey)
        logger.warning(
            "MetersComponent %s: %s access raised %s: %s "
            "(suppressing further warnings)",
            key, context, type(exc).__name__, exc,
        )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach every listener, drop state. Idempotent.

        Walks ``_track_listeners`` — each record carries the wrapper
        we attached on, so we don't need a fresh ``song.tracks`` read
        to resolve targets (which would hand back fresh wrappers per
        ADR-350 and miss). LOM errors swallowed at DEBUG: torn-down
        C++ handles are benign here.
        """
        if self._disconnected:
            return
        self._disconnected = True

        for track, remove_method_name, cb, path in self._track_listeners:
            self._safe_remove_listener(track, remove_method_name, cb, path)
        self._track_listeners.clear()

        if self._master is not None and self._master_cb is not None:
            if self._master_attached_left:
                remove = getattr(
                    self._master, "remove_output_meter_left_listener", None,
                )
                if callable(remove):
                    try:
                        remove(self._master_cb)
                    except (RuntimeError, AttributeError) as e:
                        logger.debug(
                            "MetersComponent: master remove L raised: %s",
                            e,
                        )
            if self._master_attached_right:
                remove = getattr(
                    self._master, "remove_output_meter_right_listener", None,
                )
                if callable(remove):
                    try:
                        remove(self._master_cb)
                    except (RuntimeError, AttributeError) as e:
                        logger.debug(
                            "MetersComponent: master remove R raised: %s",
                            e,
                        )
        self._master_attached_left = False
        self._master_attached_right = False
        self._master_cb = None  # type: ignore[assignment]

        self._last_emit.clear()
