"""ExclusiveArmComponent — arm-follows-selection side-effect.

On every ``song.view.selected_track`` change, arms the newly
selected track and disarms the *previously arm-by-us* track.
Sibling of ``SelectedTrackComponent`` (both subscribe to the same
``song.view`` attribute via independent listener slots — Live
supports multiple listeners on a single property).

Migrated from the v5 M4L JS ``handleAutomaticTrackArming`` at the
deleted ``ableton/device-retry/scripts/LiveAPI-v5.js`` (introduced
in commit f8a056ff, Sep 17 2025).

- No new wire address. This is a pure LOM side-effect; the arm
  flip surfaces to the UI through the existing
  ``/looping/v3/track/arm`` listener chain, same as any other
  mixer arm change.
- **Deferred LOM writes via ``schedule_delayed``.** Live 12 forbids
  writing LOM attributes from inside a notification callback
  ("Changes cannot be triggered by notifications. You will need
  to defer your response."). The listener cannot call
  ``setattr(track, 'arm', ...)`` directly — it raises. We capture
  the intent in ``_pending_*`` state and schedule the actual
  writes for the next tick. This is critical because when
  ``FootTriggerComponent.handle_hold`` calls
  ``song.create_audio_track``, Live synchronously auto-selects
  the new track *inside* that call. The resulting listener fire
  runs on the same stack as ``handle_hold`` — if we wrote arm
  there and raised, the raise would poison the notification
  stack so that FootTrigger's subsequent
  ``input_routing_channel`` + ``arm`` writes would also fail.
  Deferring keeps the stack clean.
- Coalesce semantics are free with the deferral: Live's
  insert-track double-fire resolves to the same track both
  times; the second fire overwrites the pending target with the
  same value, and a single deferred commit runs.
- Tracks ``_last_armed_track`` — *only* the track we ourselves
  armed — not "previous selection." If the user manually arms
  another track via the mixer, it stays armed across selection
  changes: we only touch what we armed. Matches the "allow user
  override" requirement.

Skip rules (both arm and disarm):

- Master track → no-op.
- Return track → no-op. Returns aren't in ``song.tracks`` and
  ``arm`` isn't a meaningful LOM attribute on them.

Handshake seed: on accept, arm the currently-selected track if
it's a regular track and record it as ``_last_armed_track``. No
disarm on accept — there's nothing yet to disarm. If Live opens
with master or a return selected, no arm fires until the user
selects a regular track. The accept path calls the arm primitives
directly (no deferral) because handshake runs from an OSC message
handler, not a notification.

LOM-touch guard: ``(RuntimeError, AttributeError, TypeError)``
wraps every ``setattr`` / attribute read. Failures log once per
kind and swallow — arm enforcement is best-effort.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from .LOMListeners import _is_stale_handle_error

logger = logging.getLogger("looping")


_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


class ExclusiveArmComponent:
    """Arms the selected track, disarms the previously arm-by-us track.

    Args:
        song: Live ``Song`` (tests: ``SelStubSong``-style with
            ``tracks``, ``master_track``, ``view``).
        schedule_delayed: ``(delay_ms, fn) -> None`` — invoked with
            ``(0, self._commit_pending)`` when a listener fire needs
            to write LOM. In production this binds to
            ``LoopingSurface._schedule_delayed`` (tick-rounded); in
            tests a fake scheduler captures the callback for
            deterministic firing. ``delay_ms=0`` asks for "next
            tick" — the smallest legal gap that unwinds the
            notification stack.

    Lifecycle:
        ``__init__`` attaches a ``selected_track`` listener on
        ``song.view``. No arm side-effect at construction —
        ``emit_on_accept`` seeds the first arm on handshake.
        ``disconnect`` detaches. Idempotent.
    """

    def __init__(
        self,
        song,
        schedule_delayed: Callable[[int, Callable[[], None]], None],
        should_auto_arm: Optional[Callable[[], bool]] = None,
    ):
        self._song = song
        self._schedule_delayed = schedule_delayed
        # ``should_auto_arm`` is pulled every commit — SessionSettings can
        # flip mid-session. Default ``lambda: True`` preserves the
        # pre-2026-04-22 behavior when the caller doesn't wire it.
        self._should_auto_arm = should_auto_arm or (lambda: True)
        self._disconnected = False
        self._last_armed_track = None
        self._warned: set = set()

        # Deferred-write state. The listener fills these; a scheduled
        # ``_commit_pending`` drains them on the next tick. ``_pending_*``
        # is a "latest wins" buffer — two fires inside the same tick
        # collapse into one write.
        self._pending_new_track = None
        self._pending_prev_track = None
        self._commit_scheduled = False

        self._view = self._safe_song_view()
        self._listener_attached = False
        if self._view is not None:
            try:
                self._view.add_selected_track_listener(
                    self._on_selected_track_changed,
                )
                self._listener_attached = True
            except _LOM_ERRORS as e:
                self._warn_once("selected_track", "attach", e)

        logger.info(
            "ExclusiveArmComponent init: listener_attached=%s",
            self._listener_attached,
        )

    # --- listener ---------------------------------------------------------

    def _on_selected_track_changed(self) -> None:
        """Fires on ``song.view.selected_track`` change.

        Cannot call ``setattr(track, 'arm', ...)`` here — we're
        inside Live's notification callback, and LOM writes from
        notifications raise. Stash the intent and schedule a
        deferred commit. Re-fires inside the same tick overwrite
        the stash (latest-wins) without re-scheduling — the
        already-scheduled commit will see the freshest target.
        """
        if self._disconnected:
            return
        new_track = self._current_selection_if_regular()
        if new_track is None:
            return
        if self._same_track(new_track, self._last_armed_track):
            return
        # Stash intent. ``_pending_prev_track`` captures the track we
        # last armed at the moment this fire ran — so a late commit
        # still knows what to disarm even if ``_last_armed_track``
        # is later updated by another fire.
        self._pending_new_track = new_track
        self._pending_prev_track = self._last_armed_track
        if self._commit_scheduled:
            return
        self._commit_scheduled = True
        try:
            self._schedule_delayed(0, self._commit_pending)
        except _LOM_ERRORS as e:
            # If scheduling itself fails we can't retry without
            # re-entering the notification, so clear the flag and
            # drop this fire. A subsequent selection change will
            # kick a fresh attempt.
            self._commit_scheduled = False
            self._warn_once("schedule_delayed", "schedule", e)

    def _commit_pending(self) -> None:
        """Deferred commit: run the arm/disarm writes now that we're
        off the notification stack. Clears ``_commit_scheduled`` so
        the next listener fire starts a fresh deferral. Safe to run
        after ``disconnect`` — gated on ``_disconnected``."""
        self._commit_scheduled = False
        if self._disconnected:
            return
        new_track = self._pending_new_track
        prev_track = self._pending_prev_track
        self._pending_new_track = None
        self._pending_prev_track = None
        if new_track is None:
            return
        # Re-check regularity at commit time — the world may have
        # shifted between listener fire and tick boundary.
        if not self._is_in_regular_tracks(new_track):
            return
        # Runtime auto-arm gate (SessionSettingsComponent). When off,
        # the component is fully passive: no arm, no disarm, no
        # ``_last_armed_track`` update — the user's current arm state
        # stays untouched. On re-enable, the next selection change
        # will arm that fresh target and record it as
        # ``_last_armed_track``; tracks armed while the toggle was off
        # stay armed (they were never "ours" to disarm).
        if not self._should_auto_arm():
            return
        self._disarm(prev_track)
        self._arm(new_track)
        self._last_armed_track = new_track

    # --- handshake --------------------------------------------------------

    def emit_on_accept(self) -> None:
        """Seed arm for the currently-selected track on handshake.

        If selection is on a regular track, arm it and record it as
        ``_last_armed_track``. Master/return selection skips silently
        — nothing to arm, nothing to disarm.
        """
        if self._disconnected:
            return
        if not self._should_auto_arm():
            return
        track = self._current_selection_if_regular()
        if track is None:
            return
        if self._same_track(track, self._last_armed_track):
            return
        self._arm(track)
        self._last_armed_track = track

    # --- arm / disarm primitives ------------------------------------------

    def _arm(self, track) -> None:
        if track is None:
            return
        try:
            setattr(track, "arm", True)
        except _LOM_ERRORS as e:
            self._warn_once("arm", "set", e)

    def _disarm(self, track) -> None:
        if track is None:
            return
        try:
            setattr(track, "arm", False)
        except _LOM_ERRORS as e:
            self._warn_once("arm", "clear", e)

    # --- selection resolution ---------------------------------------------

    def _current_selection_if_regular(self):
        """Return the selected track iff it's a regular (non-master,
        non-return) track. Master and return selections return
        ``None`` — the caller's no-op signal."""
        if self._view is None:
            return None
        try:
            selected = self._view.selected_track
        except _LOM_ERRORS as e:
            self._warn_once("selected_track", "read", e)
            return None
        if selected is None:
            return None
        if self._is_master(selected):
            return None
        if not self._is_in_regular_tracks(selected):
            return None
        return selected

    def _is_master(self, track) -> bool:
        try:
            master = self._song.master_track
        except _LOM_ERRORS as e:
            self._warn_once("master_track", "read", e)
            return False
        return self._same_track(track, master)

    def _is_in_regular_tracks(self, track) -> bool:
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._warn_once("tracks", "read", e)
            return False
        for t in tracks:
            if self._same_track(t, track):
                return True
        return False

    @staticmethod
    def _same_track(a, b) -> bool:
        """Identity check that tolerates Live's fresh-wrapper-per-read
        behavior. Falls back to ``_live_ptr`` comparison, matching
        ``path_resolver.same_lom_handle`` — which is now public and is
        the one to reach for in new code."""
        if a is None or b is None:
            return False
        if a is b:
            return True
        try:
            from .LOMListeners import _safe_int_id
        except Exception:
            return False
        aid = _safe_int_id(a)
        bid = _safe_int_id(b)
        if aid is None or bid is None:
            return False
        return aid == bid

    def _safe_song_view(self):
        try:
            return self._song.view
        except _LOM_ERRORS as e:
            self._warn_once("song.view", "read", e)
            return None

    # --- observers --------------------------------------------------------

    @property
    def listener_attached(self) -> bool:
        return self._listener_attached

    @property
    def last_armed_track(self):
        """Read-only accessor for tests — the track we most recently
        armed (or ``None`` before the first arm)."""
        return self._last_armed_track

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach the listener. Idempotent. Does not disarm
        ``_last_armed_track`` — surface teardown leaves Live's arm
        state as the user last saw it."""
        if self._disconnected:
            return
        self._disconnected = True
        if self._view is not None and self._listener_attached:
            remove = getattr(
                self._view, "remove_selected_track_listener", None,
            )
            if remove is not None:
                try:
                    remove(self._on_selected_track_changed)
                except _LOM_ERRORS as e:
                    self._warn_once("selected_track", "detach", e)
        self._listener_attached = False

    # --- warnings ---------------------------------------------------------

    def _warn_once(self, kind: str, context: str, exc: BaseException) -> None:
        # Track-deletion teardown races through _disarm on the departing
        # selection; the track's C++ handle is already invalidated by
        # the time we setattr. The write is a no-op in that world —
        # demote to DEBUG so track delete doesn't spam WARN. Genuine
        # failures (non-stale exceptions) stay at WARN.
        if _is_stale_handle_error(exc):
            logger.debug(
                "ExclusiveArmComponent: %s %s: stale LOM handle "
                "(track already torn down): %s", kind, context, exc,
            )
            return
        key = (kind, context)
        if key in self._warned:
            return
        self._warned.add(key)
        logger.warning(
            "ExclusiveArmComponent: %s %s failed: %s",
            kind, context, exc,
        )
