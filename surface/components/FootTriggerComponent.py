"""FootTriggerComponent — Phase 9 PR-9b foot pedal action layer.

Owns the two arg-free wires emitted by ``owner/Max Patches/foot-trigger.js``
after that v8 module's tap/hold timer decides which gesture happened:

    /looping/v3/foot/tap     # released within HOLD_MS of press
    /looping/v3/foot/hold    # HOLD_MS elapsed with pedal still down

Tap action — branches on the highlighted clip slot's state, mirroring
the M4L behaviour the user has in their muscle memory:

    no slot highlighted     → no-op (logged)
    empty slot              → fire (Live starts recording)
    recording clip          → fire (end the take, launch it as a loop)
    stopped clip            → fire (Live starts playing)
    playing clip            → toggle ``session_record`` (overdub)

Hold action — append an audio track, name it ``"Audio"``, set its
input routing channel to ``audio.defaultInputChannel`` from
``constants.json`` when one is set (unset, Live's own default input
stays), arm it, and append Permute (the sequencer device)
inline via ``DeviceLoadComponent.load_into_track``.

Permute load location (2026-04-30): the previous design re-emitted
``/looping/v3/track/created`` so the UI ran ``loadSequencerAndAwait``
on it. The bridge broadcasts every OSC message to all connected WS
clients, so when both Mac and iPad are open each client fired a
duplicate ``/looping/v3/device/load`` and the audio track ended up
with two Permutes appended. Owning the load on the Python side
collapses that to a single inline call — the gesture has a single
authoritative initiator (this component), so the Permute placement
should too. ADR-348's "UI-owns-Permute" remains true for the browser
preset path (request-id-correlated, single client awaits).

LOM-touch guard: every read/call wrapped in ``_LOM_ERRORS`` per the
Live 12 quirks doc — TypeError covers ``Boost.Python.ArgumentError``
from torn-down handles. Failures are logged and swallowed; this
gesture path is fire-and-forget (no UI awaiting an ack), so a typed
wire error is overkill.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Optional, Tuple

from . import live_library
logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch must catch. ``TypeError`` covers
# ``Boost.Python.ArgumentError`` (TypeError subclass) raised when a
# C++ handle is torn down — see CLAUDE.md merge-gate rule (9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_FOOT_TAP_ADDRESS = "/looping/v3/foot/tap"
V3_FOOT_HOLD_ADDRESS = "/looping/v3/foot/hold"


# Name applied to tracks created by the hold gesture. Matches the
# previous M4L behaviour — kept intentionally generic so the operator
# sees "Audio" and knows it's the foot-trigger-created scratch track.
_HOLD_TRACK_NAME = "Audio"

# Minimum seconds between successive hold-create gestures. Prevents
# accidental double-fires from a bouncy pedal or a held press that
# re-triggers before the first track finishes loading.
_HOLD_RATE_LIMIT_SECS = 5.0


class FootTriggerComponent:
    """Handles the two foot-pedal gesture wires.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender. Retained for symmetry
            with sibling components; this component currently emits
            nothing on the hold path (Permute load runs inline via
            ``load_preset``).
        constants: The constants dict (already loaded by
            ``LoopingSurface`` via ``config_loader.load()``). Reads
            ``audio.defaultInputChannel``, optional: unset, the new
            track keeps Live's own default input. Also reads
            ``devices.sequencer.devicePath`` for the inline Permute
            append.
        schedule_delayed: ``(delay, fn)`` scheduler; the hold-gesture
            configure runs on the next tick so Live's audio-track
            template settles before we touch name/route/arm.
        should_auto_arm: Callable returning whether new tracks should
            be armed by default. Pulled per gesture so SessionSettings
            toggles take effect immediately.
        load_preset: ``(track_index, preset_path) -> None`` closure
            wired by ``LoopingSurface`` to ``DeviceLoadComponent``.
            Called from ``_configure_held_track`` to append Permute
            inline. ``None`` (e.g. older Live without the device-load
            component) skips the Permute step with a WARN — the
            gesture still creates + names + routes the track.
    """

    V3_FOOT_TAP_ADDRESS = V3_FOOT_TAP_ADDRESS
    V3_FOOT_HOLD_ADDRESS = V3_FOOT_HOLD_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        constants: dict,
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        should_auto_arm: Optional[Callable[[], bool]] = None,
        load_preset: Optional[Callable[[int, str], None]] = None,
    ) -> None:
        self._song = song
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        # Pulled every hold-gesture configure tick — SessionSettings can
        # flip between handle_hold and the deferred _configure_held_track
        # fire. Default ``lambda: True`` preserves legacy behavior.
        self._should_auto_arm = should_auto_arm or (lambda: True)
        self._load_preset = load_preset
        self._disconnected = False
        self._last_hold_time: float = -_HOLD_RATE_LIMIT_SECS
        self._input_channel = self._resolve_input_channel(constants)
        self._sequencer_device_path = self._resolve_sequencer_path(constants)
        logger.info(
            "FootTriggerComponent: ready (hold input channel=%r, deferred=%s, "
            "sequencer=%r, load_preset=%s)",
            self._input_channel,
            "yes" if schedule_delayed is not None else "no",
            self._sequencer_device_path,
            "yes" if load_preset is not None else "no",
        )

    # --- wire handlers ----------------------------------------------------

    def handle_tap(self, args, source_addr) -> None:
        """``/looping/v3/foot/tap`` — fire/overdub the highlighted slot.

        Branches on the highlighted slot's own state — never on what
        else is playing on that track — which is what lets one pedal
        walk a single slot through the whole looper cycle:

            no slot highlighted     → no-op
            empty slot              → fire (start recording)
            recording clip          → fire (end take, launch as a loop)
            stopped clip            → fire (start playing)
            playing clip            → toggle ``session_record`` (overdub)
        """
        if self._disconnected:
            return
        slot = self._highlighted_clip_slot()
        if slot is None:
            logger.info("FootTriggerComponent: tap with no highlighted slot")
            return
        try:
            has_clip = bool(slot.has_clip)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: slot.has_clip raised: %s: %s",
                type(e).__name__, e,
            )
            return
        if not has_clip:
            self._fire_slot(slot, "empty slot — start recording")
            return
        try:
            clip = slot.clip
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: slot.clip raised: %s: %s",
                type(e).__name__, e,
            )
            return
        # ``is_recording`` is read FIRST and branched on FIRST, because a
        # clip Live is recording into also reports ``is_playing``. Before
        # this branch existed the take-ending press fell through to the
        # overdub arm and toggled ``session_record`` instead of closing
        # the loop — so the looper cycle stalled at one press.
        #
        # A read failure degrades to False rather than aborting the tap:
        # losing the flag costs the take-ending press its correct branch,
        # but aborting would cost the gesture entirely.
        try:
            is_recording = bool(clip.is_recording)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: clip.is_recording raised (assuming "
                "not recording): %s: %s",
                type(e).__name__, e,
            )
            is_recording = False
        if is_recording:
            self._fire_slot(slot, "recording clip — end take, launch loop")
            return
        try:
            is_playing = bool(clip.is_playing)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: clip.is_playing raised: %s: %s",
                type(e).__name__, e,
            )
            return
        if not is_playing:
            self._fire_slot(slot, "stopped clip — start playing")
            return
        self._toggle_session_record()

    def handle_hold(self, args, source_addr) -> None:
        """``/looping/v3/foot/hold`` — create an armed audio track."""
        if self._disconnected:
            return
        now = time.monotonic()
        elapsed = now - self._last_hold_time
        if elapsed < _HOLD_RATE_LIMIT_SECS:
            logger.warning(
                "FootTriggerComponent: hold rate-limited (%.1fs < %.1fs); ignoring",
                elapsed, _HOLD_RATE_LIMIT_SECS,
            )
            return
        self._last_hold_time = now
        logger.info("FootTriggerComponent: handle_hold entered (src=%r)", source_addr)

        try:
            pre_count = len(self._song.tracks)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: pre-create read song.tracks raised: %s: %s",
                type(e).__name__, e,
            )
            pre_count = -1
        logger.info(
            "FootTriggerComponent: pre-create tracks_count=%s; calling create_audio_track(-1)",
            pre_count,
        )

        try:
            self._song.create_audio_track(-1)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: create_audio_track raised: %s: %s",
                type(e).__name__, e,
            )
            return
        logger.info("FootTriggerComponent: create_audio_track returned cleanly")

        new_track = self._newly_created_track()
        if new_track is None:
            logger.warning(
                "FootTriggerComponent: track created but couldn't locate "
                "it in song.tracks; skipping name/route/arm",
            )
            return
        try:
            new_index = len(self._song.tracks) - 1
        except _LOM_ERRORS:
            new_index = -1
        logger.info(
            "FootTriggerComponent: located new track at index=%s (obj=%r)",
            new_index, new_track,
        )

        # Live finishes applying the audio-track template *after*
        # ``create_audio_track`` returns — the ``Loading document ...
        # Default Audio Track.als`` step in Log.txt is async relative
        # to our stack. Writes made here (name, routing_channel, arm)
        # land on pre-template state and get overwritten when the
        # template finalizes (observed: routing reads back OK from
        # LOM but the UI sticks at the template default 1/2). Defer
        # the config step off the notification stack so the writes
        # land after Live has settled the new track. Same pattern
        # ``ExclusiveArmComponent`` uses for its arm writes.
        if self._schedule_delayed is not None:
            logger.info(
                "FootTriggerComponent: scheduling deferred configure (index=%s)",
                new_index,
            )
            try:
                self._schedule_delayed(
                    0,
                    lambda t=new_track, i=new_index: self._configure_held_track(t, i),
                )
            except _LOM_ERRORS as e:
                logger.warning(
                    "FootTriggerComponent: schedule_delayed for configure raised: %s: %s",
                    type(e).__name__, e,
                )
                # Fallback: best-effort inline configure so the user
                # still gets some of the work done.
                self._configure_held_track(new_track, new_index)
        else:
            self._configure_held_track(new_track, new_index)
        logger.info("FootTriggerComponent: handle_hold complete (configure may be deferred)")

    # --- internal helpers -------------------------------------------------

    def _highlighted_clip_slot(self):
        """Return ``song.view.highlighted_clip_slot`` or ``None`` on failure.

        Live's view always has a ``highlighted_clip_slot`` attribute,
        but it may be the sentinel "no slot" object. The previous M4L
        code checked ``api.id === "0"``; the Python equivalent is to
        treat anything raising on attribute access as "no slot."
        """
        try:
            view = self._song.view
            slot = view.highlighted_clip_slot
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: highlighted_clip_slot raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        return slot

    def _fire_slot(self, slot, reason: str) -> None:
        try:
            slot.fire()
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: slot.fire raised (%s): %s: %s",
                reason, type(e).__name__, e,
            )
            return
        logger.info("FootTriggerComponent: tap fired (%s)", reason)

    def _toggle_session_record(self) -> None:
        """Flip ``song.session_record``. SessionComponent's listener
        emits the new value out; no direct emit needed here."""
        try:
            current = bool(self._song.session_record)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: read session_record raised: %s: %s",
                type(e).__name__, e,
            )
            return
        new_value = not current
        try:
            self._song.session_record = new_value
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: write session_record=%r raised: %s: %s",
                new_value, type(e).__name__, e,
            )
            return
        logger.info(
            "FootTriggerComponent: tap toggled session_record %s → %s",
            current, new_value,
        )

    def _newly_created_track(self):
        """Return the track Live just created via ``create_audio_track(-1)``.

        Live appends and auto-selects the new track, so the safe
        post-create handle is ``song.tracks[-1]`` — but we filter to
        regular tracks to skip the master/return mixin some test
        stubs put at the end of ``tracks``.
        """
        try:
            tracks = self._song.tracks
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: read song.tracks raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        if not tracks:
            return None
        return tracks[-1]

    def _configure_held_track(self, track, track_index: int = -1) -> None:
        """Name + input-route + arm the track Live just created, then
        append Permute via the load_preset closure.

        Each step is independent: a failure in one shouldn't suppress
        the others. The previous M4L code did the equivalent via three
        separate AbletonOSC writes; this preserves that fail-soft shape.

        The Permute append runs from this deferred tick so Live has
        finished applying the audio-track template before we touch the
        device chain. Owning the load on the Python side avoids the
        multi-client double-load — every WS client used to react to
        the broadcast ``track/created`` event independently.
        """
        if self._disconnected:
            return
        logger.info(
            "FootTriggerComponent: _configure_held_track running "
            "(track=%r, index=%s)",
            track, track_index,
        )
        # --- name
        try:
            track.name = _HOLD_TRACK_NAME
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: set track.name=%r raised: %s: %s",
                _HOLD_TRACK_NAME, type(e).__name__, e,
            )
        else:
            try:
                post_name = track.name
            except _LOM_ERRORS:
                post_name = "<read-raised>"
            logger.info(
                "FootTriggerComponent: track.name set (attempted=%r, readback=%r)",
                _HOLD_TRACK_NAME, post_name,
            )

        # --- routing: only when this Mac names an input
        # (``audio.defaultInputChannel``, general-release plan §4).
        if self._input_channel:
            self._set_input_routing_channel(track, self._input_channel)

        # --- arm (gated by SessionSettings auto_arm toggle; 2026-04-22).
        # Skip the write when auto-arm is disabled — the track stays in
        # whatever arm state Live's audio-track template set it to
        # (typically disarmed). The rest of configure (name, routing,
        # auto-load) still runs.
        if self._should_auto_arm():
            try:
                track.arm = True
            except _LOM_ERRORS as e:
                logger.warning(
                    "FootTriggerComponent: set track.arm=True raised: %s: %s",
                    type(e).__name__, e,
                )
            else:
                try:
                    post_arm = bool(track.arm)
                except _LOM_ERRORS:
                    post_arm = "<read-raised>"
                logger.info(
                    "FootTriggerComponent: track.arm set (readback=%s)", post_arm,
                )
        else:
            logger.info(
                "FootTriggerComponent: skipping arm — auto_arm disabled",
            )

        # --- append Permute inline. Single authoritative initiator —
        # avoids the multi-client double-load that used to happen when
        # we broadcast track/created and every WS client fired its own
        # device/load.
        if track_index < 0:
            logger.warning(
                "FootTriggerComponent: Permute load skipped — unknown track index",
            )
            return
        if self._load_preset is None:
            logger.warning(
                "FootTriggerComponent: Permute load skipped — no load_preset closure",
            )
            return
        if not self._sequencer_device_path:
            logger.warning(
                "FootTriggerComponent: Permute load skipped — no sequencer devicePath in constants",
            )
            return
        try:
            self._load_preset(track_index, self._sequencer_device_path)
        except Exception as e:  # defensive — load failure must not abort
            logger.warning(
                "FootTriggerComponent: Permute load raised: %s: %s",
                type(e).__name__, e,
            )

    def _set_input_routing_channel(self, track, channel_name: str) -> None:
        """Set ``track.input_routing_channel`` by display-name lookup.

        Live 11+ exposes ``input_routing_channel`` as a routing object
        (with ``display_name``), not a string. Setting requires the
        object instance. The display-name lookup runs against the
        track's ``available_input_routing_channels``; if no match is
        found we fall back to assigning the string directly (the M4L
        path used the AbletonOSC string setter, which works on older
        Live builds and on test stubs that store the string).
        """
        # --- pre-state dump: what routing_type + channel the track
        # has BEFORE we touch it, plus the available type + channel
        # lists. This is the evidence we need when "routing didn't
        # change" without a WARN — e.g. we matched a channel under
        # the wrong type, or the type defaulted to something that
        # has no useful channels.
        try:
            pre_type = track.input_routing_type
        except _LOM_ERRORS as e:
            pre_type = None
            logger.warning(
                "FootTriggerComponent: read input_routing_type raised: %s: %s",
                type(e).__name__, e,
            )
        try:
            pre_channel = track.input_routing_channel
        except _LOM_ERRORS as e:
            pre_channel = None
            logger.warning(
                "FootTriggerComponent: read input_routing_channel raised: %s: %s",
                type(e).__name__, e,
            )
        try:
            available_types = [
                getattr(t, "display_name", None)
                for t in (track.available_input_routing_types or ())
            ]
        except _LOM_ERRORS as e:
            available_types = None
            logger.warning(
                "FootTriggerComponent: read available_input_routing_types raised: %s: %s",
                type(e).__name__, e,
            )
        try:
            available = track.available_input_routing_channels
        except _LOM_ERRORS as e:
            available = None
            logger.warning(
                "FootTriggerComponent: read available_input_routing_channels raised: %s: %s",
                type(e).__name__, e,
            )
        try:
            available_names = [
                getattr(r, "display_name", None) for r in (available or ())
            ]
        except _LOM_ERRORS:
            available_names = None

        logger.info(
            "FootTriggerComponent: routing pre-state "
            "want=%r pre_type=%r pre_channel=%r "
            "available_types=%r available_channels=%r",
            channel_name,
            getattr(pre_type, "display_name", None),
            getattr(pre_channel, "display_name", None),
            available_types, available_names,
        )

        # --- display-name match against channels under the current type.
        if available:
            for routing in available:
                try:
                    routing_name = getattr(routing, "display_name", None)
                    if routing_name == channel_name:
                        try:
                            track.input_routing_channel = routing
                        except _LOM_ERRORS as e:
                            logger.warning(
                                "FootTriggerComponent: assign input_routing_channel=%r "
                                "raised: %s: %s",
                                routing_name, type(e).__name__, e,
                            )
                            return
                        try:
                            post_type = getattr(
                                track.input_routing_type, "display_name", None,
                            )
                        except _LOM_ERRORS:
                            post_type = "<read-raised>"
                        try:
                            post_channel = getattr(
                                track.input_routing_channel, "display_name", None,
                            )
                        except _LOM_ERRORS:
                            post_channel = "<read-raised>"
                        logger.info(
                            "FootTriggerComponent: routing set via display-name "
                            "match (attempted=%r, readback type=%r channel=%r)",
                            routing_name, post_type, post_channel,
                        )
                        return
                except _LOM_ERRORS as e:
                    logger.warning(
                        "FootTriggerComponent: iterate available_input_routing_channels "
                        "raised at entry: %s: %s",
                        type(e).__name__, e,
                    )
                    continue

        # No match — the diagnostic has already been logged above via
        # pre-state. Fall back to a string assignment; on real Live 12
        # this raises (``RoutingChannel`` expected), which becomes
        # another WARN.
        logger.warning(
            "FootTriggerComponent: no input_routing_channel match for %r under "
            "type %r; attempting string fallback",
            channel_name,
            getattr(pre_type, "display_name", None),
        )
        try:
            track.input_routing_channel = channel_name
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: string-fallback set input_routing_channel=%r "
                "raised: %s: %s",
                channel_name, type(e).__name__, e,
            )

    @staticmethod
    def _resolve_input_channel(constants: dict) -> Optional[str]:
        """``audio.defaultInputChannel`` from constants, or ``None`` when
        unset: then the new track keeps Live's own default input."""
        audio = constants.get("audio") if isinstance(constants, dict) else None
        if isinstance(audio, dict):
            channel = audio.get("defaultInputChannel")
            if isinstance(channel, str) and channel:
                return channel
        return None

    @staticmethod
    def _resolve_sequencer_path(constants: dict) -> str:
        """Read ``devices.sequencer.devicePath`` from constants. Empty
        string when missing — caller skips the Permute append with a
        WARN rather than a hard failure."""
        devices = constants.get("devices") if isinstance(constants, dict) else None
        configured = None
        if isinstance(devices, dict):
            sequencer = devices.get("sequencer")
            if isinstance(sequencer, dict):
                configured = sequencer.get("devicePath")
        # The checkout's own Permute (2026-09-26): ``Vamp Devices``,
        # found from this file, loaded through the "Vamp Devices" Place. An
        # older config's devicePath stands in when the checkout has none.
        path = live_library.device_path(live_library.SEQUENCER_REL, configured)
        if path:
            return path
        logger.warning(
            "FootTriggerComponent: no Permute.amxd under %r and no "
            "devices.sequencer.devicePath; Permute append on hold-create will be skipped",
            live_library.m4l_devices_root(),
        )
        return ""

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. Subsequent handler calls short-circuit."""
        if self._disconnected:
            return
        self._disconnected = True
