"""PerformanceCaptureComponent — ipad-only auto-record + save-as-on-stop.

During an ``npm run ipad`` performance we want Live to capture the whole
session to the Arrangement and, when the player stops, offer to save the
set under an auto-generated name. This component wires both to Live's
transport, gated so it fires **only** while ``npm run ipad`` is the live
server (not ``npm run dev``, not when nothing is running):

- **Transport start** (``song.is_playing`` False→True): arm Live's
  global/arrangement record (``song.record_mode = 1``) so playing is
  captured into the Arrangement.
- **Transport stop** (True→False): disarm record (``record_mode = 0``),
  rewind the Arrangement start marker to one bar before the end of the
  recorded material (``song.start_time``), and emit
  ``/looping/v3/session/save_as_request [tempo, sigNum, sigDen]``
  to the bridge, which pops Live's native Save As dialog pre-typed with a
  counter/date/tempo/meter name for the user to accept or decline. (Live's
  LOM has no Save As verb — the dialog is OS keystroke automation the
  bridge owns.)

Start-marker rewind
-------------------

After a take, the next Play should pick up where the last one left off —
not from bar 1. On the same Stop edge that disarms and offers the save, we
read ``song.last_event_time`` (Live's beat time of the final event in the
Arrangement — unlike ``song_length`` it carries no display padding) and
write ``song.start_time`` one bar earlier, floored to a bar line so the
marker always lands on a downbeat. The next Play therefore starts with
roughly a bar of the previous take as lead-in and continues past its end.

Two Live-side caveats, both from the LOM's own docstrings:

- ``start_time`` is *"Get/Set access to the songs current start time in
  beats. The set time may be overridden by the current loop/locator start
  time."* — with the Arrangement loop switch **on**, Live starts from the
  loop start regardless of what we write here.
- Because the next Play is also an auto-record arm, that lead-in bar is
  recorded over on the armed track. That is the intended trade (context to
  play against), but it is why the rewind is exactly one bar and never
  more.

The gate is ``compose_capture_gate(session_settings)`` — i.e. the
``auto_capture`` toggle (``SessionSettings.should_auto_capture()``) with a
None-guard for the teardown window. That toggle *defaults* to
``is_ipad_present()`` at surface construction (ipad→on, dev→off) but is then
user-overridable, so this behavior is no longer hard-wired to ipad mode. The
gate is pulled fresh (not cached), but only on the **Play edge**: it decides
whether to *start* a capture. **Cleanup on the Stop edge is ownership-based,
not gate-based** — if this component armed the take (``_armed_by_us``), it
always disarms and prompts to save, regardless of the current gate. Otherwise
turning the toggle off mid-take (or a presence lapse that flips a
mode-tracking default) would strand ``record_mode = 1`` armed and silently
drop the take. So turning capture off mid-set stops *future* arming, but any
take already in progress is still cleaned up and offered for save on the next
Stop.

Edge-driven: arming happens on the *next* Play, so if transport is
already running when the ipad server comes up this component won't
retro-arm — acceptable for a performance that starts from a stopped
transport. It attaches its own ``is_playing`` listener; LOM allows
multiple, so ``SessionComponent``'s wire-event listener on the same
property is undisturbed.
"""

from __future__ import annotations

import logging
import math
from typing import Callable, Optional

from .ServerPresenceComponent import compose_capture_gate

logger = logging.getLogger("looping")


# Surface → bridge command. Bridge-terminated (pops the Save As dialog),
# not relayed to the UI. Module constant so a rename fails at import time.
V3_SESSION_SAVE_AS_REQUEST_ADDRESS = "/looping/v3/session/save_as_request"

# How far before the end of the Arrangement material the start marker is
# parked on Stop, in bars. One bar of lead-in is enough to play against and
# is the most the next (record-armed) take can safely overwrite.
BARS_BEFORE_LAST_EVENT = 1


def compute_rewound_start(last_event_time, sig_num, sig_den,
                          bars=BARS_BEFORE_LAST_EVENT):
    """Beat position for the start marker, or ``None`` for "don't move it".

    ``bars`` bars before ``last_event_time``, floored to a bar line so the
    marker lands on a downbeat (Live counts bars from beat 0). A bar is
    ``sig_num * 4 / sig_den`` beats, so 4/4 → 4.0 and 6/8 → 3.0.

    Returns ``None`` when there is nothing to rewind to (empty Arrangement)
    or the signature is nonsense; ``0.0`` when the material is shorter than
    the rewind distance.
    """
    try:
        beats_per_bar = float(sig_num) * 4.0 / float(sig_den)
        last = float(last_event_time)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if beats_per_bar <= 0.0 or last <= 0.0:
        return None
    target = last - (bars * beats_per_bar)
    if target <= 0.0:
        return 0.0
    return math.floor(target / beats_per_bar) * beats_per_bar


class PerformanceCaptureComponent:
    """Arms arrangement record on play and requests save-as on stop.

    Args:
        song: Live ``Song`` object.
        emit: ``self._transport.send`` — proactive outbound to the bridge.
        session_settings: ``SessionSettingsComponent`` — the ``auto_capture``
            toggle is the gate (default launch-mode-derived, then
            user-overridable). See ``compose_capture_gate``.

    Lifecycle:
        ``__init__`` attaches the ``is_playing`` listener and seeds the
        edge-detector from the current transport state (so a listener
        that fires before any real transition is a no-op).
        ``disconnect`` removes the listener; idempotent.
    """

    V3_SESSION_SAVE_AS_REQUEST_ADDRESS = V3_SESSION_SAVE_AS_REQUEST_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[..., None],
        session_settings,
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
    ):
        self._song = song
        self._emit = emit
        self._session_settings = session_settings
        # Live forbids mutating the song from inside a notification callback
        # ("Changes cannot be triggered by notifications. You will need to
        # defer your response."). is_playing fires as a notification, so the
        # record_mode writes must hop to the next tick via schedule_delayed
        # (LoopingSurface._schedule_delayed). When absent (unit tests, or a
        # song with no scheduler) we fall back to an inline call — fine off
        # the notification thread.
        self._schedule_delayed = schedule_delayed
        self._disconnected = False
        self._listener: Optional[Callable[[], None]] = None
        # True while *this component* holds the arrangement-record arm it
        # set on a gated Play. Cleanup on Stop keys off this, not the
        # gate, so a presence lapse mid-take can't strand record_mode=1.
        self._armed_by_us = False

        # Seed the edge-detector from current state so the first listener
        # fire only acts on a real transition.
        self._was_playing = self._read_is_playing()

        add = getattr(self._song, "add_is_playing_listener", None)
        if not callable(add):
            logger.warning(
                "PerformanceCaptureComponent: song has no "
                "add_is_playing_listener; capture disabled",
            )
            return
        cb = self._on_is_playing_changed
        try:
            add(cb)
        except (RuntimeError, AttributeError) as e:
            logger.warning(
                "PerformanceCaptureComponent: is_playing attach failed: %r", e,
            )
            return
        self._listener = cb
        logger.info(
            "PerformanceCaptureComponent init (was_playing=%s)",
            self._was_playing,
        )

    # --- transport edge --------------------------------------------------

    def _read_is_playing(self) -> bool:
        try:
            return bool(self._song.is_playing)
        except (RuntimeError, AttributeError):
            return False

    def _on_is_playing_changed(self) -> None:
        """No-arg LOM callback: detect play/stop edges and react."""
        if self._disconnected:
            return
        playing = self._read_is_playing()
        was = self._was_playing
        self._was_playing = playing
        if playing == was:
            return  # not a transition (spurious / attribute co-fire)

        if playing:
            # Rising edge: the gate decides whether to START a capture.
            # Pulled fresh here (the auto_capture toggle, whose default is
            # launch-mode-derived but user-overridable).
            if compose_capture_gate(self._session_settings):
                self._arm_record()
        else:
            # Falling edge: CLEANUP is ownership-based, not gate-based. If
            # we armed this take we always disarm + prompt to save it —
            # even if presence lapsed mid-take (ipad server killed, or a
            # heartbeat stall past the grace window). Gating cleanup on
            # presence would strand record_mode=1 and silently drop the
            # take the feature exists to save.
            if self._armed_by_us:
                self._disarm_record()
                self._rewind_start_marker()
                self._request_save_as()

    # --- actions ---------------------------------------------------------

    def _defer(self, fn: Callable[[], None]) -> None:
        """Run ``fn`` off the notification thread (next Live tick).

        The record_mode writes can't happen inline in the is_playing
        notification (Live raises "Changes cannot be triggered by
        notifications"). schedule_delayed hops to the next tick where the
        write is legal. Without a scheduler (tests) we call inline — those
        callers aren't inside a Live notification.
        """
        if self._schedule_delayed is not None:
            self._schedule_delayed(1, fn)
        else:
            fn()

    def _arm_record(self) -> None:
        # Claim ownership at decision time, not after the (deferred) write —
        # so a Stop that lands before the deferred arm still runs cleanup and
        # offers the take for save. The deferred write reconciles record_mode.
        self._armed_by_us = True
        logger.info("PerformanceCapture: transport start → arming arrangement record")
        self._defer(self._apply_record_mode_1)

    def _apply_record_mode_1(self) -> None:
        if self._disconnected or not self._armed_by_us:
            return  # stopped/torn down before the deferred write ran
        try:
            self._song.record_mode = 1
        except (RuntimeError, AttributeError) as e:
            logger.warning("PerformanceCapture: could not set record_mode=1: %r", e)
            # Drop ownership so a later Stop doesn't fire save-as for a take
            # that never actually armed.
            self._armed_by_us = False

    def _disarm_record(self) -> None:
        # Ownership drops now (synchronously) so re-entrant edges see a clean
        # slate; the actual record_mode=0 write defers off the notification.
        self._armed_by_us = False
        self._defer(self._apply_record_mode_0)

    def _apply_record_mode_0(self) -> None:
        if self._disconnected:
            return
        try:
            self._song.record_mode = 0
        except (RuntimeError, AttributeError) as e:
            logger.warning("PerformanceCapture: could not set record_mode=0: %r", e)

    def _rewind_start_marker(self) -> None:
        """Queue the ``song.start_time`` move for the next tick.

        Deferred for the same reason as the record_mode writes: this runs
        inside the ``is_playing`` notification, where Live forbids song
        mutation. Scheduled *before* the save-as emit goes out so the
        marker is already parked by the time the Save As dialog appears
        and the user commits the file.
        """
        self._defer(self._apply_start_marker)

    def _apply_start_marker(self) -> None:
        if self._disconnected:
            return
        try:
            last = float(self._song.last_event_time)
            sig_num = int(self._song.signature_numerator)
            sig_den = int(self._song.signature_denominator)
        except (RuntimeError, AttributeError, ValueError, TypeError) as e:
            logger.warning("PerformanceCapture: could not read arrangement "
                           "end/meter: %r", e)
            return
        start = compute_rewound_start(last, sig_num, sig_den)
        if start is None:
            logger.info("PerformanceCapture: empty arrangement "
                        "(last_event_time=%s) → start marker left alone", last)
            return
        try:
            self._song.start_time = start
        except (RuntimeError, AttributeError) as e:
            logger.warning("PerformanceCapture: could not set start_time "
                           "%.3f: %r", start, e)
            return
        logger.info(
            "PerformanceCapture: start marker → %.3f "
            "(last_event_time=%.3f, %d/%d, %d bar back)",
            start, last, sig_num, sig_den, BARS_BEFORE_LAST_EVENT,
        )

    def _request_save_as(self) -> None:
        """Read tempo + meter and ask the bridge to pop Save As."""
        try:
            tempo = int(round(float(self._song.tempo)))
            sig_num = int(self._song.signature_numerator)
            sig_den = int(self._song.signature_denominator)
        except (RuntimeError, AttributeError, ValueError, TypeError) as e:
            logger.warning("PerformanceCapture: could not read tempo/meter: %r", e)
            return
        logger.info(
            "PerformanceCapture: transport stop → save_as_request "
            "(%dbpm %d/%d)", tempo, sig_num, sig_den,
        )
        self._emit(V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [tempo, sig_num, sig_den])

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        """Remove the listener; idempotent. Swallows teardown errors."""
        if self._disconnected:
            return
        self._disconnected = True
        if self._listener is not None:
            remove = getattr(self._song, "remove_is_playing_listener", None)
            if callable(remove):
                try:
                    remove(self._listener)
                except (RuntimeError, AttributeError):
                    pass
            self._listener = None
