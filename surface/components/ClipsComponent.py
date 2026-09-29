"""ClipsComponent — Phase 7 PR-7b clip write + structural observer.

Owns the UI→Surf clip-lifecycle addresses:

    /looping/v3/clip/launch             [slotPath]
    /looping/v3/clip/stop               [trackPath]
    /looping/v3/clip/focus              [slotPath]
    /looping/v3/clip/delete             [slotPath]
    /looping/v3/clip/duplicate          [slotPath, destSlotPath]
    /looping/v3/clip/duplicate_region   [slotPath]   # ROW 8
    /looping/v3/clip/load_file          [trackPath, slotPath, filePath]
    /looping/v3/clip/set/color          [clipPath, color:int]
    /looping/v3/clip/swap_file          [requestId, clipPath, filePath]  # ADR-440

``duplicate`` is Live's session-view "Duplicate" gesture — copies the
clip into the next slot on the same track. ``duplicate_region`` is
the older in-place semantic (double the looped region inside the
same MIDI clip) that AbletonOSC's ``/live/clip/duplicate_loop``
used to provide; ROW 8 reinstated it as a dedicated v3 wire so the
Dup button doubles musical content in place instead of copying to
the next slot. See [10-cleanup-plan.md] ROW 8.

And the Surf→UI structural echoes from per-slot ``has_clip``
listeners (rows pr7b-5 onward):

    /looping/v3/clip/created     [slotPath, generation]
    /looping/v3/clip/removed     [slotPath, generation]

Empty-slot launch matches Live's session-view UX — ``slot.fire()``
against an empty slot starts recording on an armed track, and is a
silent no-op otherwise. See
[phase-7-pr7b-design.md §2.1](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/phase-7-pr7b-design.md#21-empty-slot-cliplaunch--match-live-ux-record-into-armed).

Duplicate is same-track-only via ``track.duplicate_clip_slot`` —
cross-track rejects with ``path-not-supported``. Design §2.2.

Rows landed so far
------------------

- **pr7b-2** — this skeleton. ``__init__`` wiring, ``handle_*`` arg
  validation, ``_emit_error`` shape, ``disconnect`` idempotence.
  Actual LOM calls and listener attach land in pr7b-3 … pr7b-5.
"""

from __future__ import annotations

import logging
import os
from typing import Callable, Optional, Tuple

from . import alc_resolver
from . import path_resolver
from .LOMListeners import _is_stale_handle_error
from .PlayheadComponent import read_file_span
from .path_resolver import ResolveStatus

logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch in this module must catch.
# Includes ``TypeError`` to cover ``Boost.Python.ArgumentError`` (a
# ``TypeError`` subclass) raised when a C++ handle is torn down — see
# [CLAUDE.md] merge-gate rule (9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_CLIP_LAUNCH_ADDRESS = "/looping/v3/clip/launch"
V3_CLIP_STOP_ADDRESS = "/looping/v3/clip/stop"
# Session-grid long-press: show a clip without firing it. Focus was an
# inbound-only channel until now (ClipPropertiesComponent observes
# ``song.view.detail_clip``), so the UI could only ever follow Live's
# own selection — there was no way to say "show me THAT clip".
V3_CLIP_FOCUS_ADDRESS = "/looping/v3/clip/focus"
V3_CLIP_DELETE_ADDRESS = "/looping/v3/clip/delete"
V3_CLIP_DUPLICATE_ADDRESS = "/looping/v3/clip/duplicate"
V3_CLIP_DUPLICATE_REGION_ADDRESS = "/looping/v3/clip/duplicate_region"
V3_CLIP_LOAD_FILE_ADDRESS = "/looping/v3/clip/load_file"
V3_CLIP_SET_COLOR_ADDRESS = "/looping/v3/clip/set/color"

V3_CLIP_CREATED_ADDRESS = "/looping/v3/clip/created"

# Live's own clip panel. Whenever the app makes a clip the one in play —
# picks it in a session grid, long-presses it, records it, duplicates or
# drops a file into it — Live's Detail view switches to that clip too, so
# the Mac screen shows what the iPad is working on.
CLIP_DETAIL_VIEW = "Detail/Clip"
V3_CLIP_REMOVED_ADDRESS = "/looping/v3/clip/removed"

# Launch-queued state: the slot has been fired but the transport
# hasn't reached the quantization boundary yet, which is exactly what
# Live blinks in its own session view. Nothing else on the wire can
# express it — ``playing_slot`` reports what IS playing, and the S
# record is a snapshot of what EXISTS — so between tapping a cell and
# the next bar the UI had no way to show the tap registered. At 1/1 or
# 1 bar quantization that gap is most of a bar of silence, which reads
# as a missed tap.
#
# Rides its own per-slot listener rather than the S record: it is
# transient (true then false within a bar), so it must never land in a
# snapshot that outlives it.
V3_CLIP_TRIGGERED_ADDRESS = "/looping/v3/clip/triggered"

V3_ERROR_ADDRESS = "/looping/v3/error"


# --- error codes (closed-enum per 04 §7.2) --------------------------------

V3_ERROR_SLOT_NOT_FOUND = "slot-not-found"
V3_ERROR_CLIP_NOT_PRESENT = "clip-not-present"

# ADR-415: per-slot sample query for the session clip grid.
#
# The grid draws a waveform in every audio cell, including slots that
# have never played. Nothing else on the wire can answer that: the
# strip's waveform rides ``/looping/v3/track/playing_slot``, which
# PlayheadComponent emits from ONE ``playing_slot_index`` listener per
# track — so it carries a path for the playing slot only. ``state/full``
# deliberately omits ``file_path`` (a path per clip would add kilobytes
# of strings to a bundle that already chunks), and ``clip/property``
# fires only for the focused clip.
#
# A pull endpoint is the cheap shape: the UI asks only about cells that
# are on screen, so traffic scales with the viewport rather than with
# the set. It lives here rather than in its own component because this
# is already the owner of ``tracks/N/slots/M`` scope and clip
# resolution.
V3_CLIP_SAMPLE_GET_ADDRESS = "/looping/v3/clip/sample/get"
V3_CLIP_SAMPLE_REPLY_ADDRESS = "/looping/v3/clip/sample"
V3_ERROR_CLIP_NOT_MIDI = "clip-not-midi"
V3_ERROR_DUPLICATE_REJECTED = "duplicate-rejected"
V3_ERROR_LAUNCH_FAILED = "launch-failed"
V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"
V3_ERROR_WRITE_REJECTED = "write-rejected"
V3_ERROR_LOAD_FAILED = "load-failed"
V3_ERROR_NO_EMPTY_SLOT = "no-empty-slot"

# ADR-440: a clip's file swapped for a similar one with the clip kept — the
# clip view's similar-sound pill. Live has no verb that changes a clip's file,
# so ``handle_swap_file`` is Live's delete and create inside one undo step, with
# the old clip's settings written onto the new clip. It answers on its own
# reply address, fixed arity, never the error channel.
V3_CLIP_SWAP_FILE_ADDRESS = "/looping/v3/clip/swap_file"
V3_CLIP_SWAP_FILE_REPLY_ADDRESS = "/looping/v3/clip/swap_file/reply"
V3_ERROR_CLIP_NOT_AUDIO = "clip-not-audio"
V3_ERROR_CLIP_RECORDING = "clip-recording"
# The old clip's ``file_path`` reads empty, so ``_put_back`` could not restore
# it if Live refused the new file — and a swap is ``delete_clip`` first. There
# is no way back from that, so the honest answer is a refusal before the delete.
V3_ERROR_CLIP_FILE_UNKNOWN = "clip-file-unknown"

# What a swap keeps, in the order it is written onto the new clip: ``warping``
# first, the rest in any order (``gain`` needs no warping: a write on an
# unwarped clip landed, measured 2026-09-27, Live 12.4.15b4). Every name is on ``Live.Clip.Clip`` in
# 12.4.15b2 (py_introspect, 2026-09-15). Loop and start/end markers and warp
# markers are not here: they belong to the old file.
_CARRIED_CLIP_SETTINGS: Tuple[str, ...] = (
    "warping",
    "warp_mode",
    "gain",
    "pitch_coarse",
    "pitch_fine",
    "looping",
    "launch_mode",
    "launch_quantization",
    "legato",
    "velocity_amount",
    "ram_mode",
    "muted",
    "color",
)


# --- helpers --------------------------------------------------------------


def _file_stem(path: str) -> str:
    """A file's name without its extension: how Live names a clip it made from
    the file (the rig's ``Quarters.wav`` clip reads ``Quarters``)."""
    return os.path.splitext(os.path.basename(path))[0]


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; ``None`` → ``""``."""
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


def _parse_slot_path(path: str) -> Optional[Tuple[str, int]]:
    """Parse ``tracks/<N>/slots/<M>`` → ``(track_path, slot_idx)``.

    Returns ``None`` for any shape the grammar does not accept.
    Duplicate-handler uses this to compare track-prefix equality
    and slot-index adjacency without re-resolving each side.
    Master slots are not supported by the grammar (master has no
    clip_slots), so ``master/...`` returns ``None``.
    """
    if not path:
        return None
    parts = path.split("/")
    if len(parts) != 4:
        return None
    if parts[0] != "tracks" or parts[2] != "slots":
        return None
    try:
        track_idx = int(parts[1])
        slot_idx = int(parts[3])
    except ValueError:
        return None
    if track_idx < 0 or slot_idx < 0:
        return None
    return ("tracks/%d" % track_idx, slot_idx)


# ResolveStatus → wire-error-code mapping for slotPath inputs. The
# component handlers consult this when ``resolve_slot`` returns
# anything other than OK, so every failure surfaces a typed wire code
# rather than a bare log line.
_SLOT_RESOLVE_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_WRITE_REJECTED,
    ResolveStatus.NOT_FOUND: V3_ERROR_SLOT_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
}

# Parallel map for ``resolve_track`` consumers (``/clip/stop``).
# NOT_FOUND → generic ``path-not-found`` because there is no
# ``track-not-found`` code in the 04 §7.2 table; NOT_SUPPORTED
# covers return-track paths which the Phase 1 resolver rejects.
_TRACK_RESOLVE_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_WRITE_REJECTED,
    ResolveStatus.NOT_FOUND: V3_ERROR_PATH_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
}


class ClipsComponent:
    """Owns the clip-lifecycle wire.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
        advance_generation: Callable taking a reason string
            (``"clip-created"``, ``"clip-removed"``, …) and advancing
            the shared generation counter. Invoked from the per-slot
            ``has_clip`` listener (pr7b-5).
        application: ``Live.Application``, for ``view.show_view``;
            without it the clip panel is never switched.
        schedule_next_tick: runs a callable outside the listener that
            asked for it. A clip appearing reaches us inside Live's
            ``has_clip`` notification, where LOM writes are refused.
    """

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        advance_generation: Callable[[str], None],
        application=None,
        schedule_next_tick: Optional[Callable[[Callable[[], None]], None]] = None,
    ) -> None:
        self._song = song
        self._emit = emit
        self._advance_generation = advance_generation
        self._application = application
        self._schedule_next_tick = schedule_next_tick
        # The slot the app just asked for a clip in (a record, a
        # duplicate, a file drop). When its clip appears, Live's clip
        # panel shows it. One at a time: the latest request wins.
        self._reveal_on_create: Optional[str] = None
        self._disconnected = False
        # Per-slot ``has_clip`` listener bookkeeping. Key is the slotPath
        # (stable for the listener's lifetime since structural change
        # triggers a full detach+reattach via ``rebind``). Value is
        # ``(slot, callback)`` — detach goes through
        # ``slot.remove_has_clip_listener``. Pattern mirrors
        # LOMListeners._param_value_listeners.
        self._has_clip_listeners: dict = {}
        # Parallel bookkeeping for the per-slot ``is_triggered``
        # listener. Same key shape and same rebind lifecycle as
        # ``_has_clip_listeners`` — kept in its own map so a Live build
        # (or a test stub) that exposes one listener and not the other
        # still gets everything it can support.
        self._is_triggered_listeners: dict = {}
        # In-process pub/sub for ``has_clip`` flips. Other components
        # (PlayheadComponent today, future ClipPropertiesComponent etc.)
        # register a ``cb(slot_path, has_clip)`` callback to react to
        # clip-create / clip-delete without each attaching their own
        # ``has_clip`` listener — single source of truth, single
        # detach path on structural rebind. ADR-363.
        self._has_clip_callbacks: list = []
        self._attach_all_slot_listeners()
        logger.info(
            "ClipsComponent: ready; %d slot listeners attached",
            len(self._has_clip_listeners),
        )

    def add_has_clip_change_callback(
        self, cb: Callable[[str, bool], None],
    ) -> None:
        """Register a callback fired on every slot ``has_clip`` flip.

        Invoked synchronously from the LOM listener fire path, after
        the wire emit. Signature: ``cb(slot_path, has_clip)`` — same
        ``slot_path`` shape as the wire emits (``tracks/N/slots/M``).

        Callbacks are kept in registration order; exceptions in one
        callback do not prevent later callbacks from firing.

        No deregistration API — callbacks live for the component's
        lifetime. ``disconnect`` drops the list.
        """
        if cb is None:
            return
        self._has_clip_callbacks.append(cb)

    # --- wire handlers ----------------------------------------------------

    def handle_launch(self, args, source_addr) -> None:
        """``[slotPath]`` — launch clip at slot.

        Resolves ``slotPath``, calls ``slot.fire()``. Empty slot:
        ``slot.fire()`` on an armed track starts recording; on an
        unarmed track Live silently no-ops — either outcome is the
        intended session-view UX. Never emits ``clip-not-present``
        for empty slots.

        ``launch-failed`` fires only when ``slot.fire()`` itself
        raises a ``_LOM_ERRORS`` exception — covers the rare
        half-torn-down slot case.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_LAUNCH_ADDRESS, args, 1):
            return
        slot_path = _coerce_str(args[0])
        slot = self._resolve_slot_or_error(V3_CLIP_LAUNCH_ADDRESS, slot_path)
        if slot is None:
            return
        if not self._slot_has_clip_safe(slot):
            # An armed empty slot records: show the take once it exists.
            self._reveal_on_create = slot_path
        try:
            slot.fire()
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_LAUNCH_ADDRESS,
                V3_ERROR_LAUNCH_FAILED,
                path=slot_path,
                detail="%s: %s" % (type(e).__name__, str(e)[:80]),
            )

    def handle_stop(self, args, source_addr) -> None:
        """``[trackPath]`` — stop all clips on a track.

        Resolves ``trackPath``, calls ``track.stop_all_clips()``.
        Idempotent — stopping a track with no playing clip is a
        silent no-op at the LOM layer.

        Master track is a valid target (master has no clip slots,
        so ``stop_all_clips`` is a no-op for it). Return tracks are
        ``path-not-supported`` via the resolver.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_STOP_ADDRESS, args, 1):
            return
        track_path = _coerce_str(args[0])
        track = self._resolve_track_or_error(V3_CLIP_STOP_ADDRESS, track_path)
        if track is None:
            return
        try:
            track.stop_all_clips()
        except _LOM_ERRORS as e:
            # No dedicated error code for stop-failed; reuse
            # write-rejected since the gesture is a failed write
            # attempt, not a not-found condition.
            self._emit_error(
                V3_CLIP_STOP_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=track_path,
                detail="stop-all-clips raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_focus(self, args, source_addr) -> None:
        """``[slotPath]`` — focus the slot's clip. Never fires it.

        The session grid's long-press gesture: bring a clip up in the
        clip view without launching it. Everything the clip view needs
        (properties, rich notes, groove) is focus-scoped on the surface
        — ``ClipPropertiesComponent`` observes ``song.view.detail_clip``
        and only emits for the focused clip — so "show me this clip"
        has to be a real write to Live's focus, not a client-side
        selection.

        Writes ``song.view.detail_clip`` (what the focused-clip channel
        observes) and, best-effort first, ``highlighted_clip_slot`` so
        Live's own session view highlights the same cell.

        This handler emits nothing itself: the existing detail_clip
        listener answers with ``clip/focused`` + the property echoes,
        so a focus driven from here and one driven by Live's own
        selection land on exactly the same wire.

        Empty slot → ``clip-not-present``. There is nothing to show,
        and moving Live's selection to display nothing is worse than
        a no-op.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_FOCUS_ADDRESS, args, 1):
            return
        slot_path = _coerce_str(args[0])
        slot = self._resolve_slot_or_error(V3_CLIP_FOCUS_ADDRESS, slot_path)
        if slot is None:
            return
        if not self._slot_has_clip_safe(slot):
            self._emit_error(
                V3_CLIP_FOCUS_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="slot is empty",
            )
            return
        try:
            clip = slot.clip
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_FOCUS_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=slot_path,
                detail="slot.clip raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if clip is None:
            # has_clip said yes a moment ago — the clip went away
            # between the two reads. Same outcome as an empty slot.
            self._emit_error(
                V3_CLIP_FOCUS_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="slot.clip is None",
            )
            return
        # Highlight is cosmetic and best-effort: it moves Live's
        # session selection, which is a nicety, while detail_clip is
        # what actually drives the focused-clip channel the UI reads.
        # Losing the highlight must not cost the focus.
        try:
            self._song.view.highlighted_clip_slot = slot
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: highlighted_clip_slot=%r raised: %s: %s",
                slot_path, type(e).__name__, str(e)[:80],
            )
        try:
            self._song.view.detail_clip = clip
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_FOCUS_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=slot_path,
                detail="detail_clip write raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        self._show_clip_view()

    def reveal_slot(self, slot) -> None:
        """Show ``slot``'s clip in Live's clip panel. Empty slot: no-op.

        Makes it ``song.view.detail_clip`` (skipped when it already is,
        so the focused-clip channel doesn't re-emit for nothing) and
        switches Live's Detail view to Clip. Best-effort throughout:
        this is what the Mac screen shows, never what the iPad relies
        on, so a refusal is logged, not put on the wire.
        """
        if self._disconnected:
            return
        if not self._slot_has_clip_safe(slot):
            return
        try:
            clip = slot.clip
        except _LOM_ERRORS:
            return
        if clip is None:
            return
        view = self._song.view
        try:
            if not path_resolver.same_lom_handle(view.detail_clip, clip):
                view.detail_clip = clip
        except _LOM_ERRORS as e:
            logger.info(
                "ClipsComponent: reveal detail_clip write raised: %s: %s",
                type(e).__name__, e,
            )
            return
        self._show_clip_view()

    def _show_clip_view(self) -> None:
        if self._application is None:
            return
        try:
            self._application.view.show_view(CLIP_DETAIL_VIEW)
        except _LOM_ERRORS as e:
            logger.info(
                "ClipsComponent: show_view(%s) raised: %s: %s",
                CLIP_DETAIL_VIEW, type(e).__name__, e,
            )

    def _should_reveal_new_clip(self, slot, slot_path: str) -> bool:
        """A clip just appeared here: is it the one in play?

        Yes when the app asked for it (``_reveal_on_create``) or when
        it landed in the highlighted slot — the pedal's target, which
        is how a pedal record or a clip dropped on the selection
        arrives.
        """
        if slot_path == self._reveal_on_create:
            self._reveal_on_create = None
            return True
        try:
            highlighted = self._song.view.highlighted_clip_slot
        except _LOM_ERRORS:
            return False
        return path_resolver.same_lom_handle(highlighted, slot)

    def handle_delete(self, args, source_addr) -> None:
        """``[slotPath]`` — delete clip at slot.

        Empty slot → ``clip-not-present``. A half-torn-down
        ``slot.has_clip`` read is treated as "empty" by the
        resolver (pr5e1 convention), so the error surfaces cleanly
        without a separate TypeError branch here.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_DELETE_ADDRESS, args, 1):
            return
        slot_path = _coerce_str(args[0])
        slot = self._resolve_slot_or_error(V3_CLIP_DELETE_ADDRESS, slot_path)
        if slot is None:
            return
        if not self._slot_has_clip_safe(slot):
            self._emit_error(
                V3_CLIP_DELETE_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="slot is empty",
            )
            return
        try:
            slot.delete_clip()
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_DELETE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=slot_path,
                detail="delete_clip raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_duplicate(self, args, source_addr) -> None:
        """``[slotPath, destSlotPath]`` — duplicate to next slot.

        Same-track-only. ``destSlotPath`` must equal
        ``<trackPath>/slots/<src_idx + 1>`` — mirrors Live's
        ``Track.duplicate_clip_slot(src_idx)`` which duplicates to
        the next slot on the same track. Cross-track rejects with
        ``path-not-supported``; anything else invalid is
        ``duplicate-rejected`` with a specific sub-reason in
        ``detail``.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_DUPLICATE_ADDRESS, args, 2):
            return
        slot_path = _coerce_str(args[0])
        dest_slot_path = _coerce_str(args[1])

        src_parts = _parse_slot_path(slot_path)
        dest_parts = _parse_slot_path(dest_slot_path)
        if src_parts is None:
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=slot_path,
                detail="source slotPath malformed",
            )
            return
        if dest_parts is None:
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=dest_slot_path,
                detail="dest slotPath malformed",
            )
            return

        src_track_path, src_idx = src_parts
        dest_track_path, dest_idx = dest_parts

        if src_track_path != dest_track_path:
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_PATH_NOT_SUPPORTED,
                path=dest_slot_path,
                detail="cross-track duplicate not supported",
            )
            return

        if dest_idx != src_idx + 1:
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_DUPLICATE_REJECTED,
                path=dest_slot_path,
                detail="destination-not-next-slot",
            )
            return

        src_slot = self._resolve_slot_or_error(
            V3_CLIP_DUPLICATE_ADDRESS, slot_path,
        )
        if src_slot is None:
            return
        dest_slot = self._resolve_slot_or_error(
            V3_CLIP_DUPLICATE_ADDRESS, dest_slot_path,
        )
        if dest_slot is None:
            return

        if not self._slot_has_clip_safe(src_slot):
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="source slot is empty",
            )
            return

        if self._slot_has_clip_safe(dest_slot):
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_DUPLICATE_REJECTED,
                path=dest_slot_path,
                detail="destination-occupied",
            )
            return

        track_result = path_resolver.resolve_track(self._song, src_track_path)
        if track_result.status is not ResolveStatus.OK:
            # Defensive: src_slot resolved OK, so the track must
            # exist — but guard anyway.
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=slot_path,
                detail="track resolution drift",
            )
            return
        track = track_result.obj
        # Before the call: Live may notify has_clip from inside it.
        self._reveal_on_create = dest_slot_path
        try:
            track.duplicate_clip_slot(src_idx)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_DUPLICATE_ADDRESS,
                V3_ERROR_DUPLICATE_REJECTED,
                path=slot_path,
                detail="%s: %s" % (type(e).__name__, str(e)[:80]),
            )

    def handle_duplicate_region(self, args, source_addr) -> None:
        """``[slotPath]`` — double the loop region in place (MIDI only).

        ROW 8 (2026-04-21). Restores the pre-PR-7b in-place semantic of
        ``AbletonOSC /live/clip/duplicate_loop`` on a dedicated v3 wire,
        so the Dup button doubles the clip's musical content without
        moving to the next slot.

        Errors:
            - ``clip-not-present`` if the slot is empty.
            - ``clip-not-midi`` for audio clips (LOM's ``duplicate_loop``
              is MIDI-only).
            - ``write-rejected`` (with detail) for torn-down handles or
              any other LOM raise on the ``duplicate_loop`` call.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_DUPLICATE_REGION_ADDRESS, args, 1):
            return
        slot_path = _coerce_str(args[0])
        slot = self._resolve_slot_or_error(
            V3_CLIP_DUPLICATE_REGION_ADDRESS, slot_path,
        )
        if slot is None:
            return
        if not self._slot_has_clip_safe(slot):
            self._emit_error(
                V3_CLIP_DUPLICATE_REGION_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="slot is empty",
            )
            return
        try:
            clip = slot.clip
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_DUPLICATE_REGION_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="slot.clip raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if clip is None:
            self._emit_error(
                V3_CLIP_DUPLICATE_REGION_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="slot.clip is None",
            )
            return
        try:
            is_midi = bool(clip.is_midi_clip)
        except _LOM_ERRORS as e:
            # Half-torn-down clip — same convention as the launch / delete
            # paths: treat as "not usable right now" rather than crashing.
            self._emit_error(
                V3_CLIP_DUPLICATE_REGION_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=slot_path,
                detail="is_midi_clip raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if not is_midi:
            self._emit_error(
                V3_CLIP_DUPLICATE_REGION_ADDRESS,
                V3_ERROR_CLIP_NOT_MIDI,
                path=slot_path,
                detail="clip is not a MIDI clip",
            )
            return
        try:
            clip.duplicate_loop()
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_DUPLICATE_REGION_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=slot_path,
                detail="duplicate_loop raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_load_file(self, args, source_addr) -> None:
        """``[trackPath, slotPath, filePath]`` — load an audio file into a clip slot.

        Bypasses Live's Browser entirely (``browser.user_library`` does
        not expose raw audio leaves, which is why
        ``/looping/v3/device/load`` fails for ``.wav``/``.aif``/etc.).
        Uses ``ClipSlot.create_audio_clip(file_path)`` — the LOM entry
        point for "attach an arbitrary audio file to this slot".

        Arg shape:
            - ``trackPath``: ``tracks/<N>`` — used only when ``slotPath``
              is empty, to pick the first empty slot on that track.
            - ``slotPath``: ``tracks/<N>/slots/<M>`` for a specific slot,
              or ``""`` for "first empty slot on ``trackPath``".
            - ``filePath``: absolute path to an audio file.

        If ``slotPath`` resolves to an already-populated slot, the existing
        clip is deleted first (replace semantics matches the UI gesture).

        Errors:
            - ``write-rejected`` — arg-count, malformed path, empty
              filePath.
            - ``path-not-found`` — ``trackPath`` doesn't resolve, or
              ``filePath`` isn't a file on disk.
            - ``slot-not-found`` — explicit ``slotPath`` out of range.
            - ``no-empty-slot`` — ``slotPath`` empty and every slot on
              ``trackPath`` is full.
            - ``load-failed`` — ``create_audio_clip`` raised.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_LOAD_FILE_ADDRESS, args, 3):
            return
        track_path = _coerce_str(args[0])
        slot_path = _coerce_str(args[1])
        file_path = _coerce_str(args[2])

        if not file_path:
            self._emit_error(
                V3_CLIP_LOAD_FILE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="empty filePath",
            )
            return
        if not os.path.isfile(file_path):
            self._emit_error(
                V3_CLIP_LOAD_FILE_ADDRESS,
                V3_ERROR_PATH_NOT_FOUND,
                path=file_path,
                detail="file not on disk",
            )
            return

        # An .alc (Ableton Live Clip) is a gzipped XML wrapper, not audio —
        # ``create_audio_clip`` only accepts raw audio. Resolve it to the
        # underlying .wav/.aif it references. (Warp/loop metadata in the
        # .alc is not carried over; we load the raw sample.)
        if alc_resolver.is_alc(file_path):
            resolved = alc_resolver.resolve_alc(file_path)
            if resolved is None:
                self._emit_error(
                    V3_CLIP_LOAD_FILE_ADDRESS,
                    V3_ERROR_PATH_NOT_FOUND,
                    path=file_path,
                    detail="could not resolve .alc to an audio file",
                )
                return
            file_path = resolved

        # Two paths: explicit slot (replace semantics) or trackPath-only
        # (auto-pick first empty slot). The explicit path is what the
        # "replace audio clip" UI gesture sends; the trackPath-only path
        # is for a fresh drop onto the selected track (no specific slot).
        if slot_path:
            slot = self._resolve_slot_or_error(
                V3_CLIP_LOAD_FILE_ADDRESS, slot_path,
            )
            if slot is None:
                return
            resolved_slot_path = slot_path
        else:
            if not track_path:
                self._emit_error(
                    V3_CLIP_LOAD_FILE_ADDRESS,
                    V3_ERROR_WRITE_REJECTED,
                    path="",
                    detail="both trackPath and slotPath empty",
                )
                return
            track = self._resolve_track_or_error(
                V3_CLIP_LOAD_FILE_ADDRESS, track_path,
            )
            if track is None:
                return
            pick = self._first_empty_slot(track)
            if pick is None:
                self._emit_error(
                    V3_CLIP_LOAD_FILE_ADDRESS,
                    V3_ERROR_NO_EMPTY_SLOT,
                    path=track_path,
                    detail="every slot on track is occupied",
                )
                return
            slot, slot_idx = pick
            resolved_slot_path = "%s/slots/%d" % (track_path, slot_idx)

        # Replace semantics: if the slot already has a clip, delete it
        # first so ``create_audio_clip`` has a clean target. ``has_clip``
        # read is guarded — a half-torn-down slot reads as empty and we
        # let ``create_audio_clip`` surface any resulting failure.
        if self._slot_has_clip_safe(slot):
            try:
                slot.delete_clip()
            except _LOM_ERRORS as e:
                self._emit_error(
                    V3_CLIP_LOAD_FILE_ADDRESS,
                    V3_ERROR_WRITE_REJECTED,
                    path=resolved_slot_path,
                    detail="pre-load delete_clip raised: %s: %s" % (
                        type(e).__name__, str(e)[:80],
                    ),
                )
                return

        self._reveal_on_create = resolved_slot_path
        try:
            slot.create_audio_clip(file_path)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_LOAD_FILE_ADDRESS,
                V3_ERROR_LOAD_FAILED,
                path=file_path,
                detail="create_audio_clip raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return

        logger.info(
            "ClipsComponent: load_file OK slot=%r file=%r",
            resolved_slot_path, file_path,
        )

    def handle_set_color(self, args, source_addr) -> None:
        """``[clipPath, color:int]`` — write ``clip.color``.

        Writes an integer RGB color (``0 ≤ v ≤ 0xFFFFFF``) to the
        clip resolved by ``clipPath`` (shape ``tracks/N/slots/M/clip``).
        Used by the auto-coloring flow that recolors clips alongside
        their parent track on preset load (see TS `trackColoring`).

        No listener echo: clip color is read-only via state/full
        snapshots today (no per-clip color listener attached on the
        surface). UI applies the write optimistically; cross-client
        sync recovers on the next state-full re-emit.

        Errors:
            - ``write-rejected`` — arg-count, malformed ``clipPath``,
              non-int / out-of-range color, or LOM raise on assignment.
            - ``path-not-found`` — clipPath resolves to a slot that
              doesn't exist (or master/return path).
            - ``path-not-supported`` — clipPath resolves to a path
              the resolver rejects (e.g., return tracks).
            - ``clip-not-present`` — slot is empty.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_SET_COLOR_ADDRESS, args, 2):
            return
        clip_path = _coerce_str(args[0])
        raw_color = args[1]

        # Reject booleans — mis-dispatch guard (bool is a subclass of int).
        # Accept whole-number floats: the OSC bridge encodes plain JS numbers
        # as float32, so 0x52b788 arrives as 5420936.0 rather than 5420936.
        if isinstance(raw_color, bool):
            self._emit_error(
                V3_CLIP_SET_COLOR_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="color: expected int, got bool",
            )
            return
        if isinstance(raw_color, float):
            if not raw_color.is_integer():
                self._emit_error(
                    V3_CLIP_SET_COLOR_ADDRESS,
                    V3_ERROR_WRITE_REJECTED,
                    path=clip_path,
                    detail="color: non-integer float %r" % raw_color,
                )
                return
            raw_color = int(raw_color)
        if not isinstance(raw_color, int):
            self._emit_error(
                V3_CLIP_SET_COLOR_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="color: expected int, got %s" % type(raw_color).__name__,
            )
            return
        if raw_color < 0 or raw_color > 0xFFFFFF:
            self._emit_error(
                V3_CLIP_SET_COLOR_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="color: %d out of range [0, 0xFFFFFF]" % raw_color,
            )
            return

        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            # CLIP_NOT_PRESENT is resolve_clip's own status (slot
            # resolves but is empty); other failures fall through the
            # generic slot-error map shared with launch/delete/etc.
            if result.status is ResolveStatus.CLIP_NOT_PRESENT:
                code = V3_ERROR_CLIP_NOT_PRESENT
            else:
                code = _SLOT_RESOLVE_ERROR_MAP.get(
                    result.status, V3_ERROR_WRITE_REJECTED,
                )
            self._emit_error(
                V3_CLIP_SET_COLOR_ADDRESS,
                code,
                path=clip_path,
                detail=result.detail or "",
            )
            return

        clip = result.obj
        try:
            clip.color = raw_color
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_SET_COLOR_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="color setattr raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    # --- internal ---------------------------------------------------------

    def _check_arg_count(
        self,
        originating_address: str,
        args,
        expected: int,
    ) -> bool:
        """Gate on positional-arg count; emit ``write-rejected`` on mismatch.

        Returns ``True`` when the wire shape matches, ``False`` after
        emitting a typed error. Centralized so the 4 handlers read
        uniformly.
        """
        if len(args) == expected:
            return True
        self._emit_error(
            originating_address,
            V3_ERROR_WRITE_REJECTED,
            path="",
            detail="arg-count: expected %d, got %d" % (expected, len(args)),
        )
        return False

    def _resolve_slot_or_error(
        self,
        originating_address: str,
        slot_path: str,
    ) -> Optional[object]:
        """Resolve ``slot_path`` and emit a typed error on failure.

        Returns the slot object on OK, ``None`` otherwise. Helper
        exists from pr7b-2 so every slot-consuming handler (pr7b-3,
        pr7b-4) gets the same error taxonomy for free.
        """
        result = path_resolver.resolve_slot(self._song, slot_path)
        if result.status is ResolveStatus.OK:
            return result.obj
        code = _SLOT_RESOLVE_ERROR_MAP.get(
            result.status,
            V3_ERROR_WRITE_REJECTED,
        )
        self._emit_error(
            originating_address,
            code,
            path=slot_path,
            detail=result.detail or "",
        )
        return None

    def _resolve_track_or_error(
        self,
        originating_address: str,
        track_path: str,
    ) -> Optional[object]:
        """Resolve ``track_path`` and emit a typed error on failure.

        Returns the track on OK, ``None`` otherwise. Used by
        ``handle_stop``; no other current handler consumes a bare
        trackPath, but the helper is symmetric with the slot variant
        for future use.
        """
        result = path_resolver.resolve_track(self._song, track_path)
        if result.status is ResolveStatus.OK:
            return result.obj
        code = _TRACK_RESOLVE_ERROR_MAP.get(
            result.status,
            V3_ERROR_WRITE_REJECTED,
        )
        self._emit_error(
            originating_address,
            code,
            path=track_path,
            detail=result.detail or "",
        )
        return None

    def _slot_has_clip_safe(self, slot) -> bool:
        """Read ``slot.has_clip`` guarded by ``_LOM_ERRORS``.

        Half-torn-down slots can raise ``Boost.Python.ArgumentError``
        (a ``TypeError``) on attribute access — treat those as
        "empty" so callers surface ``clip-not-present`` rather than
        crashing. Matches the pr5e1 convention.
        """
        try:
            return bool(slot.has_clip)
        except _LOM_ERRORS:
            return False

    def _first_empty_slot(self, track):
        """Return ``(slot, index)`` for the lowest-index empty slot on
        ``track``, or ``None`` if every slot is occupied.

        Used by ``handle_load_file`` when the UI sends a trackPath-only
        load (no specific slot chosen). Group tracks have clip_slots
        that aren't user-addressable but still expose the attr; a
        torn-down-handle read counts as "occupied" (same conservative
        posture as ``_slot_has_clip_safe``) to avoid writing into a
        partially-alive slot.
        """
        try:
            slots = track.clip_slots
        except _LOM_ERRORS:
            return None
        for idx, slot in enumerate(slots):
            try:
                occupied = bool(slot.has_clip)
            except _LOM_ERRORS:
                occupied = True
            if not occupied:
                return slot, idx
        return None

    # --- has_clip listener attach/fire -----------------------------------

    def _iter_regular_tracks(self):
        """Yield ``(track_idx, track)`` for every regular (non-master,
        non-return) track. Master has no clip_slots; returns are not
        addressable in Phase 1 (path resolver rejects them)."""
        try:
            tracks = tuple(self._song.tracks)
        except _LOM_ERRORS as e:
            logger.warning("ClipsComponent: song.tracks read failed: %s", e)
            return
        for idx, track in enumerate(tracks):
            yield idx, track

    def _attach_all_slot_listeners(self) -> None:
        """Walk every regular track's ``clip_slots`` and attach a
        ``has_clip`` listener per slot.

        Idempotent under repeated calls only if
        ``_detach_all_slot_listeners`` is called first — callers that
        want to rebind should use ``rebind()`` which sequences
        detach+attach. On first init this runs against an empty
        listener map, so re-entry is not a risk.
        """
        if self._disconnected:
            return
        for track_idx, track in self._iter_regular_tracks():
            try:
                slots = tuple(track.clip_slots)
            except _LOM_ERRORS as e:
                logger.warning(
                    "ClipsComponent: tracks/%d.clip_slots read failed: %s",
                    track_idx, e,
                )
                continue
            for slot_idx, slot in enumerate(slots):
                slot_path = "tracks/%d/slots/%d" % (track_idx, slot_idx)
                self._attach_has_clip_listener(slot, slot_path)
                self._attach_is_triggered_listener(slot, slot_path)

    def _attach_has_clip_listener(self, slot, slot_path: str) -> None:
        """Attach one ``has_clip`` listener to one slot.

        Listener callback is closed over ``(slot, slot_path)`` so the
        fire path never re-walks the LOM to identify which slot
        changed. If the LOM doesn't expose ``add_has_clip_listener``
        (older Live builds or test stubs that haven't opted in), log
        once and move on — the rest of the attach walk still succeeds.
        """
        add_listener = getattr(slot, "add_has_clip_listener", None)
        if not callable(add_listener):
            return
        cb = self._make_has_clip_callback(slot, slot_path)
        try:
            add_listener(cb)
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: add_has_clip_listener %s failed: %s",
                slot_path, e,
            )
            return
        self._has_clip_listeners[slot_path] = (slot, cb)

    def _make_has_clip_callback(self, slot, slot_path: str):
        """Build the listener closure. Separated so tests can verify
        the fire-path behaviour against a manually-constructed
        callback without relying on the stub's listener plumbing."""
        def _on_has_clip():
            self._on_has_clip_changed(slot, slot_path)
        return _on_has_clip

    def _on_has_clip_changed(self, slot, slot_path: str) -> None:
        """``has_clip`` listener fire path.

        Reads the new state, advances generation, emits
        ``/clip/created`` or ``/clip/removed`` with the post-advance
        generation. The generation coalesce model already compresses
        a listener burst (e.g. scene duplicate) into a single
        ``state/invalidate`` on the next scheduler tick — no explicit
        debounce here; see
        [phase-7-pr7b-design.md §2.5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/phase-7-pr7b-design.md#25-has_clip-listener--per-slot-attach-no-debounce).
        """
        if self._disconnected:
            return
        has_clip = self._slot_has_clip_safe(slot)
        reason = "clip-created" if has_clip else "clip-removed"
        try:
            self._advance_generation(reason)
        except Exception as e:
            logger.warning(
                "ClipsComponent: advance_generation(%r) raised: %s",
                reason, e,
            )
        address = (
            V3_CLIP_CREATED_ADDRESS if has_clip
            else V3_CLIP_REMOVED_ADDRESS
        )
        try:
            self._emit(address, (slot_path,))
        except Exception as e:
            logger.warning(
                "ClipsComponent: emit %s %s failed: %s",
                address, slot_path, e,
            )
        if (
            has_clip
            and self._schedule_next_tick is not None
            and self._should_reveal_new_clip(slot, slot_path)
        ):
            self._schedule_next_tick(lambda: self.reveal_slot(slot))
        # In-process fanout. After the wire emit so other components
        # observe the same ordering UI clients do.
        for cb in self._has_clip_callbacks:
            try:
                cb(slot_path, has_clip)
            except Exception as e:
                logger.warning(
                    "ClipsComponent: has_clip callback raised "
                    "(slot=%s, has_clip=%s): %s",
                    slot_path, has_clip, e,
                )

    def _attach_is_triggered_listener(self, slot, slot_path: str) -> None:
        """Attach one ``is_triggered`` listener to one slot.

        ``ClipSlot.is_triggered`` is observable (unlike ``Clip``'s own
        read-only twin), which is why the launch-queued signal is
        slot-scoped: it also covers an EMPTY slot queued to record,
        where there is no clip object to observe yet.
        """
        add_listener = getattr(slot, "add_is_triggered_listener", None)
        if not callable(add_listener):
            return
        cb = self._make_is_triggered_callback(slot, slot_path)
        try:
            add_listener(cb)
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: add_is_triggered_listener %s failed: %s",
                slot_path, e,
            )
            return
        self._is_triggered_listeners[slot_path] = (slot, cb)

    def _make_is_triggered_callback(self, slot, slot_path: str):
        def _on_is_triggered():
            self._on_is_triggered_changed(slot, slot_path)
        return _on_is_triggered

    def _slot_is_triggered_safe(self, slot) -> bool:
        """Read ``slot.is_triggered`` guarded by ``_LOM_ERRORS``.

        A half-torn-down slot reads as "not queued" — the harmless
        direction, since the UI's blink simply stops.
        """
        try:
            return bool(slot.is_triggered)
        except _LOM_ERRORS:
            return False

    def _on_is_triggered_changed(self, slot, slot_path: str) -> None:
        """``is_triggered`` listener fire path.

        Pure telemetry: no generation advance and no structural
        meaning. The flag flips true on fire and false the instant
        Live launches (or the trigger is cancelled), so both edges are
        emitted and the UI simply follows — it never has to time out a
        blink of its own.
        """
        if self._disconnected:
            return
        triggered = self._slot_is_triggered_safe(slot)
        try:
            self._emit(V3_CLIP_TRIGGERED_ADDRESS, (slot_path, 1 if triggered else 0))
        except Exception as e:
            logger.warning(
                "ClipsComponent: emit %s %s failed: %s",
                V3_CLIP_TRIGGERED_ADDRESS, slot_path, e,
            )

    def _detach_all_is_triggered_listeners(self) -> None:
        """Detach every ``is_triggered`` listener we attached.

        Same swallow-and-clear contract as the ``has_clip`` twin: a
        torn-down handle can't have its listener removed, but the
        bookkeeping entry must go so the next attach walk builds into
        a clean map.
        """
        for slot_path, (slot, cb) in list(self._is_triggered_listeners.items()):
            remove_listener = getattr(slot, "remove_is_triggered_listener", None)
            if callable(remove_listener):
                try:
                    remove_listener(cb)
                except _LOM_ERRORS as e:
                    if _is_stale_handle_error(e):
                        logger.debug(
                            "ClipsComponent: remove_is_triggered_listener "
                            "%s: stale LOM handle (already torn down): %s",
                            slot_path, e,
                        )
                    else:
                        logger.warning(
                            "ClipsComponent: remove_is_triggered_listener "
                            "%s failed: %s", slot_path, e,
                        )
        self._is_triggered_listeners.clear()

    def _detach_all_slot_listeners(self) -> None:
        """Detach every per-slot listener we attached — both kinds.

        The exact counterpart of ``_attach_all_slot_listeners``, which
        attaches both. Keeping this the single umbrella means rebind
        and disconnect can never detach one kind and leak the other:
        a leaked ``is_triggered`` listener would survive the reattach
        and double every launch emit.
        """
        self._detach_all_has_clip_listeners()
        self._detach_all_is_triggered_listeners()

    def _detach_all_has_clip_listeners(self) -> None:
        """Detach every ``has_clip`` listener we attached.

        Swallows per-slot detach failures — a torn-down C++ handle
        can't have its listener removed, but the bookkeeping entry
        must still go away so the next ``_attach_all_slot_listeners``
        has a clean map to build into.
        """
        for slot_path, (slot, cb) in list(self._has_clip_listeners.items()):
            remove_listener = getattr(slot, "remove_has_clip_listener", None)
            if callable(remove_listener):
                try:
                    remove_listener(cb)
                except _LOM_ERRORS as e:
                    if _is_stale_handle_error(e):
                        # Slot's C++ handle already torn down (track
                        # delete / scene delete). Listener is gone on
                        # the LOM side; bookkeeping still gets cleared
                        # below.
                        logger.debug(
                            "ClipsComponent: remove_has_clip_listener "
                            "%s: stale LOM handle (already torn "
                            "down): %s", slot_path, e,
                        )
                    else:
                        logger.warning(
                            "ClipsComponent: remove_has_clip_listener "
                            "%s failed: %s", slot_path, e,
                        )
        self._has_clip_listeners.clear()

    def rebind(self) -> None:
        """Full detach + reattach across all regular tracks.

        Called by the surface on structural change — track
        insert/remove or scene add/remove (both restructure
        ``track.clip_slots``). Rare; no incremental-rebind
        optimization (design §2.5 trailing paragraph)."""
        if self._disconnected:
            return
        self._detach_all_slot_listeners()
        self._attach_all_slot_listeners()
        logger.info(
            "ClipsComponent: rebind complete; %d slot listeners",
            len(self._has_clip_listeners),
        )

    # --- sample/get pull endpoint (ADR-415) -------------------------------

    def handle_sample_get(self, args, source_addr=None) -> None:
        """``[requestId, clipPath]`` — reply with the slot's sample path.

        Reply: ``/looping/v3/clip/sample
        [requestId, clipPath, isAudioClip:int, filePath:string,
        fileStart:float, fileEnd:float]``.

        ``fileStart`` / ``fileEnd`` place the file in the clip's own time
        (``read_file_span``) so the cell's waveform lines up with the
        clip's beats; ``0, 0`` when unknown (MIDI, a flushing take).

        Answers for **any** resolvable clip path, not just the focused
        or playing one — that is the whole point, since the session grid
        asks about cells the user has not touched.

        A MIDI clip is a REPLY (``isAudioClip=0``), not an error: the UI
        branches on that bit to draw note lanes instead of a waveform,
        so routing it to the error channel would cost the caller the one
        piece of information it needs.

        An audio clip with no readable path also replies, with an empty
        ``filePath``. Live reports one for a clip whose recording is
        still flushing to disk (the same settle window PlayheadComponent
        works around), and a fresh recording must not look broken in the
        grid — the UI draws the chip without a waveform and asks again.

        Only an unresolvable path errors, collapsed to
        ``clip-not-present``: the caller just wants to know whether
        there is anything to draw, so the granular resolve codes would
        all mean the same thing to it.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_CLIP_SAMPLE_GET_ADDRESS, args, 2):
            return

        request_id = _coerce_str(args[0])
        clip_path = _coerce_str(args[1])
        if not request_id:
            self._emit_error(
                V3_CLIP_SAMPLE_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="empty request_id",
            )
            return

        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            self._emit_error(
                V3_CLIP_SAMPLE_GET_ADDRESS,
                V3_ERROR_CLIP_NOT_PRESENT,
                path=clip_path,
                detail=result.detail or str(result.status),
            )
            return

        clip = result.obj
        is_audio = self._is_audio_clip_safe(clip)
        file_path = self._read_file_path_safe(clip) if is_audio else ""
        file_start, file_end = read_file_span(clip) if is_audio else (0.0, 0.0)

        if self._disconnected:
            return
        try:
            self._emit(
                V3_CLIP_SAMPLE_REPLY_ADDRESS,
                (
                    request_id, clip_path, 1 if is_audio else 0, file_path,
                    float(file_start), float(file_end),
                ),
            )
        except Exception as e:
            logger.warning(
                "ClipsComponent: emit %s failed: %s",
                V3_CLIP_SAMPLE_REPLY_ADDRESS, e,
            )

    def _is_audio_clip_safe(self, clip) -> bool:
        """``clip.is_audio_clip``, False on any LOM raise.

        Read positively rather than as ``not is_midi_clip``: negating a
        FAILED read would claim the opposite — that an unreadable handle
        is audio — and send the UI off to fetch peaks for a path it
        cannot have. Falls back to ``is_midi_clip`` only when
        ``is_audio_clip`` is genuinely absent.
        """
        try:
            return bool(clip.is_audio_clip)
        except _LOM_ERRORS:
            pass
        try:
            return not bool(clip.is_midi_clip)
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: clip-type read raised: %s: %s",
                type(e).__name__, e,
            )
            return False

    def _read_file_path_safe(self, clip) -> str:
        """``clip.file_path``, empty string on any LOM raise.

        Empty is a legitimate answer (recording still flushing), not a
        failure — see ``handle_sample_get``.
        """
        try:
            return _coerce_str(clip.file_path)
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: file_path read raised: %s: %s",
                type(e).__name__, e,
            )
            return ""

    # --- similar-sound swap for an audio clip (ADR-440) -------------------

    def handle_swap_file(self, args, source_addr=None) -> None:
        """``[requestId, clipPath, filePath]`` — put ``filePath`` in the
        clip's slot and keep the clip: its settings, a name of its own, its
        playing and its focus. The clip view's similar-sound pill.

        Always answers ``/looping/v3/clip/swap_file/reply [requestId, ok,
        code, detail]`` — fixed arity, never the error channel — so the
        pill's request settles by id whatever happened, as
        ``drum/swap_similar`` does. Only a request with no id to answer goes
        to ``/looping/v3/error``.

        Live has no verb that changes a clip's file (``Live.Clip.Clip``
        offers none on 12.4.15b2), so the swap is Live's delete and
        ``create_audio_clip``:

        1. every check comes first — the file is on disk, the slot holds an
           audio clip, it is not recording, and the clip's OWN file path reads
           (without it step 3 has nothing to put back) — so a refusal changes
           nothing;
        2. inside one undo step: delete, create, then the old clip's
           ``_CARRIED_CLIP_SETTINGS`` written onto the new clip, its name
           when that was not its file's stem (the rig's Shaker clips are
           named "8ths" and "16ths"), ``slot.fire()`` when it was playing or
           queued while the transport runs, and ``song.view.detail_clip``
           when it was the clip Live showed, since deleting the focused clip
           empties the clip view;
        3. a file Live will not load puts the old file back with the same
           settings, still inside the step, and answers ``load-failed``.

        What a different file cannot share stays Live's default: loop and
        start/end markers, warp markers. A setting Live refuses on the new
        clip keeps its default and is named in the ``detail`` of an ``ok``
        reply.
        """
        if self._disconnected:
            return
        request_id = _coerce_str(args[0]) if args else ""
        if not request_id:
            self._emit_error(
                V3_CLIP_SWAP_FILE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="no request_id to answer",
            )
            return
        if len(args) != 3:
            self._reply_swap(
                request_id, False, V3_ERROR_WRITE_REJECTED,
                "arg-count: expected 3, got %d" % len(args),
            )
            return
        clip_path = _coerce_str(args[1])
        file_path = _coerce_str(args[2])

        slot, clip, refusal = self._swap_target(clip_path, file_path)
        if refusal is not None:
            self._reply_swap(request_id, False, refusal[0], refusal[1])
            return
        old = self._read_swap_state(clip)
        began = self._begin_undo_step()
        try:
            ok, code, detail = self._put_file(slot, file_path, old)
        except Exception as e:
            # A raise of a kind the LOM tuple does not name still closes the
            # step (finally) and still answers, or the pill waits it out.
            logger.exception("ClipsComponent: swap_file raised")
            ok, code, detail = False, V3_ERROR_WRITE_REJECTED, "swap raised %s: %s" % (
                type(e).__name__, str(e)[:80],
            )
        finally:
            self._end_undo_step(began)
        self._reply_swap(request_id, ok, code, detail)

    def _swap_target(self, clip_path: str, file_path: str):
        """``(slot, clip, None)`` for the clip a swap would replace, or
        ``(None, None, (code, detail))`` for why it must not."""
        if not file_path or not os.path.isfile(file_path):
            return None, None, (V3_ERROR_PATH_NOT_FOUND, "file not on disk: %s" % file_path)
        if not clip_path.endswith("/clip"):
            return None, None, (V3_ERROR_WRITE_REJECTED, "not a clip path: %r" % clip_path)
        result = path_resolver.resolve_slot(self._song, clip_path[: -len("/clip")])
        if result.status is not ResolveStatus.OK:
            return None, None, (
                V3_ERROR_CLIP_NOT_PRESENT, result.detail or str(result.status),
            )
        slot = result.obj
        clip = self._read_attr_safe(slot, "clip") if self._slot_has_clip_safe(slot) else None
        if clip is None:
            return None, None, (V3_ERROR_CLIP_NOT_PRESENT, "slot is empty")
        if not self._is_audio_clip_safe(clip):
            return None, None, (V3_ERROR_CLIP_NOT_AUDIO, "a MIDI clip has no file to swap")
        if self._read_attr_safe(clip, "is_recording", False):
            return None, None, (V3_ERROR_CLIP_RECORDING, "the clip is still recording")
        # The last check, and the one with no second chance. A swap is
        # ``delete_clip`` and ``create_audio_clip``; when Live will not load the
        # new file, ``_put_back`` puts the old one in the slot again. It cannot
        # do that without the old file's path, and ``_read_file_path_safe``
        # answers ``""`` for any LOM raise as well as for a clip Live reports no
        # file for — so starting the swap here risks an emptied slot and a take
        # recoverable only by Cmd-Z.
        if not self._read_file_path_safe(clip):
            return None, None, (
                V3_ERROR_CLIP_FILE_UNKNOWN,
                "Live reports no file for this clip, so the swap could not be undone if the new one "
                "would not load",
            )
        return slot, clip, None

    def _read_swap_state(self, clip) -> dict:
        """What a swap keeps from the clip it replaces."""
        settings = {}
        # A setting whose *read* raises cannot be carried. It used to vanish
        # here: absent from ``settings``, never written, never refused, so the
        # reply said everything was kept while the new clip sat at Live's
        # default. A clip whose ``gain`` read raises swapped to default gain
        # and reported nothing (swap audit M14). Named alongside the writes
        # Live refused, in the one ``not kept:`` list.
        unread = []
        for name in _CARRIED_CLIP_SETTINGS:
            try:
                settings[name] = getattr(clip, name)
            except _LOM_ERRORS as e:
                unread.append(name)
                logger.info(
                    "ClipsComponent: swap_file cannot read %s: %s: %s",
                    name, type(e).__name__, e,
                )
        file_path = self._read_file_path_safe(clip)
        name = _coerce_str(self._read_attr_safe(clip, "name", ""))
        try:
            focused = path_resolver.same_lom_handle(self._song.view.detail_clip, clip)
        except _LOM_ERRORS:
            focused = False
        return {
            "file_path": file_path,
            "settings": settings,
            "unread": unread,
            # A clip still named after its file takes the new file's name, as
            # Live names a clip it creates; any other name is the user's.
            "name": name if name and name != _file_stem(file_path) else "",
            # Live keeps a launched clip marked playing after the transport
            # stops, and firing its slot then would start the set.
            "relaunch": bool(self._read_attr_safe(self._song, "is_playing", False))
            and (
                bool(self._read_attr_safe(clip, "is_playing", False))
                or bool(self._read_attr_safe(clip, "is_triggered", False))
            ),
            "focused": bool(focused),
        }

    def _put_file(self, slot, file_path: str, old: dict):
        """Delete, create, and put what the old clip kept onto the new one.
        ``(ok, code, detail)``.

        The catch around ``create_audio_clip`` is ``Exception``, not
        ``_LOM_ERRORS``. Once ``delete_clip`` has returned, the take is gone
        from the slot and the only thing that can put it back is ``_put_back``
        — so every way the create can fail has to reach it. A raise outside
        ``(RuntimeError, AttributeError, TypeError)`` used to leave this
        function entirely and be answered by the outer net as
        ``write-rejected``, which ``wire-protocol.md`` defines as "a refusal
        changes nothing" while the slot sat empty (swap audit M11).
        ``write-rejected`` is for the pre-checks in ``_swap_target``, which run
        before anything is deleted.
        """
        try:
            slot.delete_clip()
        except _LOM_ERRORS as e:
            # Nothing has changed yet, so this one really is a refusal.
            return False, V3_ERROR_WRITE_REJECTED, "delete_clip raised: %s: %s" % (
                type(e).__name__, str(e)[:80],
            )
        try:
            slot.create_audio_clip(file_path)
        except Exception as e:  # noqa: BLE001 - see the docstring: the slot is empty here
            why = "create_audio_clip raised: %s: %s" % (type(e).__name__, str(e)[:80])
            if self._put_back(slot, old):
                return False, V3_ERROR_LOAD_FAILED, why + "; the old file is back"
            return False, V3_ERROR_LOAD_FAILED, why + "; the slot is empty"
        refused, why_no_clip = self._keep_on_new_clip(slot, old)
        if refused is None:
            # M13: "the slot reads as empty" and "reading the slot raised" are
            # different endings. The second one is a swap that *worked* —
            # ``create_audio_clip`` returned — reported as ``load-failed`` with
            # no restore, leaving the new file in the slot with no settings, no
            # name, no relaunch and no focus, under a code that says the load
            # failed. Say which it was.
            return False, V3_ERROR_LOAD_FAILED, why_no_clip
        return True, "", ("not kept: %s" % ", ".join(refused)) if refused else ""

    def _put_back(self, slot, old: dict) -> bool:
        """The old file back in ``slot``, with what the old clip kept, after
        Live would not load the new one."""
        if not old["file_path"]:
            return False
        try:
            slot.create_audio_clip(old["file_path"])
        except Exception as e:  # noqa: BLE001 - the restore is the last chance; nothing may escape
            logger.warning(
                "ClipsComponent: swap_file could not put %r back: %s: %s",
                old["file_path"], type(e).__name__, e,
            )
            return False
        return self._keep_on_new_clip(slot, old)[0] is not None

    def _keep_on_new_clip(self, slot, old: dict):
        """The old clip's settings, name, playing and focus onto the clip now
        in ``slot``. Returns ``(refused_names, why_no_clip)``: the names Live
        refused and ``""``, or ``(None, <reason>)`` when there is no clip to
        write to. Settings go in ``_CARRIED_CLIP_SETTINGS`` order; one already
        at the old value is not written.

        ``why_no_clip`` distinguishes the two ways this returns nothing, which
        used to collapse into one ``None`` (swap audit M13). A slot that reads
        as empty after ``create_audio_clip`` is Live declining the file. A slot
        whose ``has_clip`` or ``clip`` *raised* is a read failure over a swap
        that already happened, and reporting it as "holds no clip" sent the
        caller down the load-failed path for a clip that is sitting right
        there.
        """
        clip, why_no_clip = self._new_clip_or_reason(slot)
        if clip is None:
            return None, why_no_clip
        # M14: a setting whose read raised in ``_read_swap_state`` never
        # reached ``old["settings"]``, so it cannot be carried and cannot be
        # refused — it has to be named here or it is lost silently.
        refused = list(old.get("unread") or [])
        unread = object()
        for name, value in old["settings"].items():
            current = self._read_attr_safe(clip, name, unread)
            if current is not unread and current == value:
                continue
            try:
                setattr(clip, name, value)
            except _LOM_ERRORS as e:
                logger.info(
                    "ClipsComponent: swap_file %s=%r refused: %s: %s",
                    name, value, type(e).__name__, e,
                )
                refused.append(name)
        if old["name"]:
            try:
                clip.name = old["name"]
            except _LOM_ERRORS:
                refused.append("name")
        if old["relaunch"]:
            try:
                slot.fire()
            except _LOM_ERRORS:
                refused.append("launch")
        if old["focused"]:
            try:
                self._song.view.detail_clip = clip
            except _LOM_ERRORS:
                refused.append("focus")
        return refused, ""

    def _new_clip_or_reason(self, slot):
        """``(clip, "")`` for the clip in ``slot``, else ``(None, why)``.

        Separated from ``_slot_has_clip_safe`` / ``_read_attr_safe`` because
        both of those answer "no" for a raise as well as for an empty slot,
        and after ``create_audio_clip`` those two mean opposite things.
        """
        try:
            has_clip = bool(slot.has_clip)
        except _LOM_ERRORS as e:
            return None, "reading the slot raised: %s: %s (the new file may be in the slot)" % (
                type(e).__name__, str(e)[:80],
            )
        if not has_clip:
            return None, "the slot holds no clip after create_audio_clip"
        try:
            clip = slot.clip
        except _LOM_ERRORS as e:
            return None, "reading the new clip raised: %s: %s (the new file may be in the slot)" % (
                type(e).__name__, str(e)[:80],
            )
        if clip is None:
            return None, "the slot holds no clip after create_audio_clip"
        return clip, ""

    @staticmethod
    def _read_attr_safe(obj, name: str, default=None):
        """``getattr`` that treats a raising LOM property as absent — Live 12
        properties raise rather than return a default."""
        try:
            return getattr(obj, name)
        except _LOM_ERRORS:
            return default

    def _reply_swap(self, request_id: str, ok: bool, code: str, detail: str) -> None:
        if self._disconnected:
            return
        if not ok:
            logger.warning(
                "ClipsComponent: swap_file refused code=%r detail=%r", code, detail,
            )
        try:
            self._emit(
                V3_CLIP_SWAP_FILE_REPLY_ADDRESS,
                (request_id, 1 if ok else 0, code, detail),
            )
        except Exception as e:
            logger.warning(
                "ClipsComponent: emit %s failed: %s",
                V3_CLIP_SWAP_FILE_REPLY_ADDRESS, e,
            )

    def _begin_undo_step(self) -> bool:
        """Open an undo step; ``False`` when Live refused, so nothing closes
        a step that never opened (DeviceLoadComponent's rule)."""
        try:
            self._song.begin_undo_step()
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: begin_undo_step raised %s: %s", type(e).__name__, e,
            )
            return False
        return True

    def _end_undo_step(self, began: bool) -> None:
        if not began:
            return
        try:
            self._song.end_undo_step()
        except _LOM_ERRORS as e:
            logger.warning(
                "ClipsComponent: end_undo_step raised %s: %s", type(e).__name__, e,
            )

    def _emit_error(
        self,
        originating_address: str,
        code: str,
        path: str,
        detail: str,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, path, detail]``.

        Four-arg shape — same as DevicesComponent /
        DeviceLoadComponent / ClipPropertiesComponent.
        """
        if self._disconnected:
            return
        logger.warning(
            "ClipsComponent: emit error addr=%r code=%r path=%r detail=%r",
            originating_address, code, path, detail,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (originating_address, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "ClipsComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. Detaches every per-slot ``has_clip``
        listener and marks the component blocked — subsequent
        handler calls short-circuit without touching the LOM."""
        if self._disconnected:
            return
        self._disconnected = True
        self._detach_all_slot_listeners()
        self._has_clip_callbacks = []
