"""FootTriggerComponent — the foot pedal's two gestures.

Owns the two arg-free wires the tap/hold timer resolves to — the
surface's own ``MidiPedalInput`` for a USB pedal, or
``owner/Max Patches/foot-trigger.js`` for the Max path:

    /looping/v3/foot/tap     # released within HOLD_MS of press
    /looping/v3/foot/hold    # HOLD_MS elapsed with pedal still down

Tap action — branches on the highlighted clip slot's state, mirroring
the M4L behaviour the user has in their muscle memory:

    no slot highlighted     → no-op (logged)
    empty slot              → fire (Live starts recording)
    recording clip          → fire (end the take, launch it as a loop)
    stopped clip            → fire (Live starts playing)
    playing clip            → toggle ``session_record`` (overdub)

Hold action — "next take" (2026-10-23): stop the selected track's
clips and move the highlight to the next empty slot below it on that
track, appending a scene when there is none, so the next tap records a
new clip instead of overdubbing the one that is playing. A strip tap
aims the pedal at the track's playing clip, and before this the only
way off it was to touch a grid cell. Hold used to create an armed
audio track with Permute; the tracks panel's New Audio / New MIDI
buttons do that now, through ``prepare_for_preset``.

LOM-touch guard: every read/call wrapped in ``_LOM_ERRORS`` per the
Live 12 quirks doc — TypeError covers ``Boost.Python.ArgumentError``
from torn-down handles. Failures are logged and swallowed; this
gesture path is fire-and-forget (no UI awaiting an ack), so a typed
wire error is overkill.
"""

from __future__ import annotations

import logging
from typing import Callable, Tuple

from .path_resolver import same_lom_handle

logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch must catch. ``TypeError`` covers
# ``Boost.Python.ArgumentError`` (TypeError subclass) raised when a
# C++ handle is torn down — see CLAUDE.md merge-gate rule (9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_FOOT_TAP_ADDRESS = "/looping/v3/foot/tap"
V3_FOOT_HOLD_ADDRESS = "/looping/v3/foot/hold"


class FootTriggerComponent:
    """Handles the two foot-pedal gesture wires.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender. Retained for symmetry
            with sibling components; this component emits nothing —
            the highlight and scene changes echo through the selection
            listeners and the structural republish.
    """

    V3_FOOT_TAP_ADDRESS = V3_FOOT_TAP_ADDRESS
    V3_FOOT_HOLD_ADDRESS = V3_FOOT_HOLD_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
    ) -> None:
        self._song = song
        self._emit = emit
        self._disconnected = False
        logger.info("FootTriggerComponent: ready")

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
        """``/looping/v3/foot/hold`` — next take on the selected track.

        Stops the track's clips (quantized, as Live's own stop is) and
        highlights the first empty slot below the highlighted one,
        appending a scene when every slot below holds a clip. The
        pedal's next tap then records there. A group track is left
        alone: stopping it stops every member, and its slots never hold
        a clip, so "the next empty one" means nothing there.
        """
        if self._disconnected:
            return
        target = self._selected_track_and_scene()
        if target is None:
            return
        track, scene_index = target
        try:
            if bool(getattr(track, "is_foldable", False)):
                logger.info("FootTriggerComponent: hold on a group track; ignored")
                return
        except _LOM_ERRORS:
            pass
        try:
            track.stop_all_clips()
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: stop_all_clips raised: %s: %s",
                type(e).__name__, e,
            )
        slot = self._next_empty_slot(track, scene_index)
        if slot is None:
            return
        try:
            self._song.view.highlighted_clip_slot = slot
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: highlighted_clip_slot write raised: %s: %s",
                type(e).__name__, e,
            )
            return
        logger.info("FootTriggerComponent: hold — stopped the track, next empty slot highlighted")

    def _selected_track_and_scene(self):
        """``(track, scene_index)`` for the selected track and scene, or
        ``None`` (logged) when either is unreadable or the selection is
        not a regular track (master, a return)."""
        try:
            view = self._song.view
            track = view.selected_track
            scene = view.selected_scene
            tracks = list(self._song.tracks)
            scenes = list(self._song.scenes)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: hold selection read raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        if not any(same_lom_handle(track, t) for t in tracks):
            logger.info("FootTriggerComponent: hold with no regular track selected")
            return None
        for index, candidate in enumerate(scenes):
            if same_lom_handle(scene, candidate):
                return track, index
        logger.info("FootTriggerComponent: hold with no scene selected")
        return None

    def _next_empty_slot(self, track, scene_index: int):
        """The first slot below ``scene_index`` with no clip, after
        appending a scene if there is none; ``None`` (logged) on a LOM
        failure."""
        try:
            slots = list(track.clip_slots)
            for slot in slots[scene_index + 1:]:
                if not bool(slot.has_clip):
                    return slot
            self._song.create_scene(-1)
            slots = list(track.clip_slots)
        except _LOM_ERRORS as e:
            logger.warning(
                "FootTriggerComponent: next empty slot raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        if len(slots) <= scene_index + 1:
            logger.warning("FootTriggerComponent: create_scene added no slot")
            return None
        logger.info("FootTriggerComponent: hold appended a scene")
        return slots[-1]

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

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. Subsequent handler calls short-circuit."""
        if self._disconnected:
            return
        self._disconnected = True
