"""TrackPrepareComponent — atomic track-prepare-and-load endpoint.

Owns ``/looping/v3/track/prepare_for_preset``, the single-tick
replacement for the multi-step UI orchestration that previously ran
across ``/looping/v3/track/{create_audio,create_midi}`` →
``/looping/v3/track/select`` → ``/looping/v3/device/load``. The UI
sends *intent*; this component decides reuse-vs-create using
authoritative LOM reads, executes the create (when needed), runs
audio routing/arm, and loads the preset — all within Live's main
thread, so no concurrent writer can interleave and clobber state.

Wire shape
----------

    UI → Surf  /looping/v3/track/prepare_for_preset
               [request_id:str, track_type:str, preset_path:str,
                target_track_path:str (optional)]

      track_type ∈ {"audio", "midi"}
      preset_path: filesystem path under User Library or a configured
                   Place. Empty string → create+configure but skip the
                   load (used by foot-trigger, drum-empty taps, etc.)
      target_track_path: optional ``tracks/<N>``. When present and
                   non-empty (replace-instrument mode), the reuse-vs-
                   create decision is bypassed and the preset loads
                   onto that exact track — Live swaps the instrument in
                   place, leaving clips / Permute / FX untouched. A
                   missing or empty arg is the legacy auto behaviour.

    Surf → UI  /looping/v3/track/prepare_for_preset/ack
               [request_id:str, track_path:str, was_created:int(0|1)]

    Surf → UI  /looping/v3/track/prepare_for_preset/nack
               [request_id:str, code:str, detail:str]

      Codes: ``invalid-args`` / ``create-failed`` / ``load-failed``
             / ``no-track`` / ``unsupported-type``

Idempotency
-----------

A bounded LRU keyed by ``request_id`` caches the most recent ack/nack
result. A retransmit (UI WebSocket flapped, bridge replayed) finds its
``request_id`` in the cache and re-emits the same ack — no second
track gets created. The cache is time-bounded (30s TTL); past that
window a stale repeat is treated as a new request.

Audio template settling
-----------------------

When ``create_audio_track`` returns, Live is still applying the
``Default Audio Track.als`` template asynchronously (observed:
routing/arm writes immediately after create get clobbered when the
template finalizes). For audio creates the configure step (routing,
arm) AND the preset load AND the ack are deferred to the next tick
via ``schedule_delayed(0, …)``, so writes land after Live has
settled. MIDI creates and reuse paths run inline.

Permute placement
-----------------

After the preset load (or in lieu of it for empty-prep), Permute is
appended to the track via ``DeviceLoadComponent.load_into_track``.
Live places loaded instruments in the instrument slot regardless of
existing audio FX in the chain, so loading Permute first then the
instrument on a subsequent prepare-call still produces
``[Instrument, Permute]``. Idempotent: ``_track_has_sequencer``
short-circuits when the device is already present (covers reuse of
a track that was prepped earlier in the session). Replaces the
two-round-trip UI follow-up that previously fired
``/looping/v3/device/load`` after every prepare ack (ADR-348).
"""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Callable, Optional, Tuple

from . import alc_resolver
from .TrackMetadataComponent import (  # ADR-439: written here, on a load's ack path
    TRACK_PRESET_DATA_KEY,
    TRACK_PRESET_UNSET,
    V3_TRACK_PRESET_ADDRESS,
    preset_record,
)

from . import live_library
logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch must catch. ``TypeError`` covers
# ``Boost.Python.ArgumentError`` (TypeError subclass) raised when a
# C++ handle is torn down — see CLAUDE.md merge-gate rule (9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# LOM identity helper. Resolved at import time with a graceful fallback
# so per-call lookups in ``_selected_track_index`` stay branch-free.
# See ADR-350 for why ``is`` comparison fails against v3 wrappers.
try:
    from .LOMListeners import _safe_int_id
except Exception:  # pragma: no cover — only hit if LOMListeners can't import
    _safe_int_id = None  # type: ignore[assignment]


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_TRACK_PREPARE_ADDRESS = "/looping/v3/track/prepare_for_preset"
V3_TRACK_PREPARE_ACK_ADDRESS = "/looping/v3/track/prepare_for_preset/ack"
V3_TRACK_PREPARE_NACK_ADDRESS = "/looping/v3/track/prepare_for_preset/nack"

V3_TRACK_DUPLICATE_ADDRESS = "/looping/v3/track/duplicate"
V3_TRACK_DUPLICATE_ACK_ADDRESS = "/looping/v3/track/duplicate/ack"
V3_TRACK_DUPLICATE_NACK_ADDRESS = "/looping/v3/track/duplicate/nack"


# --- error codes ----------------------------------------------------------

NACK_INVALID_ARGS = "invalid-args"
NACK_UNSUPPORTED_TYPE = "unsupported-type"
NACK_CREATE_FAILED = "create-failed"
NACK_LOAD_FAILED = "load-failed"
NACK_NO_TRACK = "no-track"
NACK_DUPLICATE_FAILED = "duplicate-failed"


# --- LRU cache config -----------------------------------------------------

# Maximum number of cached request_id → result entries. 64 covers
# realistic retransmit windows (a flapping WS reconnect carries at
# most a handful of inflight messages); the bound is a safety belt
# against unbounded growth.
_LRU_MAX_ENTRIES = 64

# How long a cached result remains valid for retransmit replay.
# 30 seconds covers WebSocket reconnect + bridge replay; past that,
# a duplicate request_id is treated as a fresh request rather than
# replaying potentially stale state (e.g. the cached track may have
# been deleted since).
_LRU_TTL_SECONDS = 30.0


def _coerce_str(x) -> str:
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


def _is_alc(path: str) -> bool:
    """True if ``path`` is an Ableton Live Clip by extension."""
    return bool(path) and path.lower().endswith(".alc")


# Mirrors the frontend's ``parseTrackIndex`` regex (trackPreparation.ts).
# Track paths are the canonical ``tracks/<N>`` wire form.
_TRACK_PATH_RE = re.compile(r"^tracks/(\d+)$")


def _parse_track_index(path: str) -> Optional[int]:
    m = _TRACK_PATH_RE.match(path)
    return int(m.group(1)) if m else None


# Mirrors the frontend's ``patternCountFromName`` / ``isPatternRackMacroName``
# (macroLayoutUtils.ts) — the "is this a pattern rack" test, reused here as
# "is this the metronome track". See ``_is_metronome_track``.
_PATTERN_MACRO_RE = re.compile(r"^Pattern\s+\d+$", re.IGNORECASE)


class TrackPrepareComponent:
    """Owns ``/looping/v3/track/prepare_for_preset``.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender (``OSCTransport.send``).
        device_load_component: For ``load_into_track`` calls.
        constants: Dict from ``constants.json`` — reads
            ``audio.defaultInputChannel`` for audio routing, optional:
            unset, a new audio track keeps Live's own default input.
        schedule_delayed: ``(delay, fn)`` scheduler. Required for the
            audio template-settling deferral (see module docstring).
        should_auto_arm: Callable returning whether new audio tracks
            should be armed by default. Pulled per request so the
            ``SessionSettings.auto_arm`` toggle takes effect immediately.
    """

    V3_TRACK_PREPARE_ADDRESS = V3_TRACK_PREPARE_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        device_load_component,
        constants: dict,
        schedule_delayed: Callable[[int, Callable[[], None]], None],
        should_auto_arm: Optional[Callable[[], bool]] = None,
    ) -> None:
        self._song = song
        self._emit = emit
        self._device_load = device_load_component
        self._schedule_delayed = schedule_delayed
        self._should_auto_arm = should_auto_arm or (lambda: True)
        self._input_channel = self._resolve_input_channel(constants)
        self._sequencer_device_path = self._resolve_sequencer_path(constants)
        # request_id → (timestamp, address, args) of the last ack/nack.
        # Insertion-ordered for cheap LRU eviction.
        self._lru: "dict[str, Tuple[float, str, tuple]]" = {}
        self._disconnected = False
        logger.info(
            "TrackPrepareComponent: ready (input_channel=%r, sequencer=%r)",
            self._input_channel, self._sequencer_device_path,
        )

    # --- wire handler -----------------------------------------------------

    def handle_prepare(self, args, source_addr) -> None:
        if self._disconnected:
            return
        logger.info(
            "TrackPrepareComponent: handle_prepare args=%r", args,
        )

        if len(args) not in (3, 4, 6):
            # No request_id available → can't bind to a request. Log and
            # drop; the UI's request will time out and retry. (No reply
            # because the UI's correlation key is request_id.)
            logger.warning(
                "TrackPrepareComponent: arg-count mismatch (expected 3, 4 or 6, got %d)",
                len(args),
            )
            return

        request_id = _coerce_str(args[0])
        track_type = _coerce_str(args[1])
        preset_path = _coerce_str(args[2])
        # Optional 4th arg: pin replace-instrument loads to an exact track.
        target_track_path = _coerce_str(args[3]) if len(args) >= 4 else ""
        # Optional 5th and 6th (3.11.0): the Place the preset is in
        # (``place:<name>`` / ``library`` / ``pack:<name>``) and its path
        # inside it. The surface looks the file up there first, and fills
        # in an empty preset_path from the Place's folder.
        source = _coerce_str(args[4]) if len(args) == 6 else ""
        rel = _coerce_str(args[5]) if len(args) == 6 else ""
        if source and rel:
            preset_path = self._device_load.absolute_path(preset_path, source, rel)

        if not request_id:
            logger.warning(
                "TrackPrepareComponent: empty request_id; dropping",
            )
            return

        # Idempotency check — a retransmit replays the cached result.
        cached = self._lru_get(request_id)
        if cached is not None:
            address, payload = cached
            logger.info(
                "TrackPrepareComponent: replaying cached %s for request_id=%r",
                address, request_id,
            )
            self._emit(address, payload)
            return

        if track_type not in ("audio", "midi"):
            self._nack(
                request_id, NACK_UNSUPPORTED_TYPE,
                "track_type must be 'audio' or 'midi', got %r" % track_type,
            )
            return

        # An .alc (Ableton Live Clip) can't be created-then-loaded like a
        # device preset: Live's Browser creates its OWN track for the clip
        # (it ignores highlighted_clip_slot). So we let the browser create
        # the track, then prep THAT track. Separate path from the standard
        # create-or-reuse flow below.
        if _is_alc(preset_path):
            self._handle_alc_prepare(request_id, preset_path, source, rel)
            return

        if target_track_path:
            # Replace-instrument mode: load onto this exact track,
            # bypassing reuse-vs-create. Live swaps the instrument in the
            # instrument slot in place; clips / Permute / FX are preserved.
            pinned = self._resolve_pinned_track(target_track_path, request_id)
            if pinned is None:
                # _resolve_pinned_track already nacked.
                return
            track, target_index = pinned
            was_created = False
        else:
            decision = self._decide(track_type, request_id)
            if decision is None:
                # _decide already nacked.
                return
            track, was_created, target_index = decision

        if was_created and track_type == "audio":
            # Defer the rest off the create's notification stack so
            # Live's audio-track template can finalize before our
            # routing/arm/load writes land. Same pattern FootTriggerComponent
            # uses (see its `_configure_held_track` deferral).
            try:
                self._schedule_delayed(
                    0,
                    lambda t=track, i=target_index, p=preset_path, r=request_id, sr=(source, rel):
                        self._finalize_audio_create(t, i, p, r, sr),
                )
                return
            except _LOM_ERRORS as e:
                logger.warning(
                    "TrackPrepareComponent: schedule_delayed raised: %s: %s; "
                    "falling back to inline finalize",
                    type(e).__name__, e,
                )
                # Fall through to inline path. The user might see a
                # routing flash but at least the load lands.

        # Inline path: reuse, MIDI create, or audio-create-with-failed-defer.
        if track_type == "audio" and was_created:
            self._configure_audio(track)
        track_path = "tracks/%d" % target_index
        if preset_path:
            # ``load_into_track`` sets ``selected_track = track`` internally
            # before invoking ``browser.load_item``, so selection follows
            # without an explicit ``_select_track`` call here.
            err = self._device_load.load_into_track(
                track, preset_path, source=source, rel=rel,
            )
            if err is not None:
                self._nack(request_id, NACK_LOAD_FAILED, err)
                return
            self._record_preset(track, track_path, preset_path)
        elif not was_created:
            # Reuse without a preset path: ``load_into_track`` is never
            # called, so we have to select explicitly so the UI follows.
            # Matches the behaviour the old multi-step orchestration produced.
            self._select_track(track)

        self._ensure_sequencer(track)

        self._ack(request_id, track_path, was_created)

    def _record_preset(self, track, track_path: str, preset_path: str) -> None:
        """Write ``looping.preset`` for a load that landed, and echo it (ADR-439).

        The swap control's folder-next steps from this path, so it records
        what *this* load put on the track — replace-instrument mode included,
        which is how every folder-next step itself arrives. Beside the path
        goes the instrument the load left (``preset_record``): the store is
        outside Live's undo history, and that instrument is how the T record
        tells that the track no longer holds the preset. Written before the
        ack and before the load's deferred structural republish walks the
        tree, so the next T record already carries it. Never fatal: a store
        that refuses the write leaves the track with no reference (the swap
        control shows disabled) and the load still acks.
        """
        record = preset_record(track, preset_path)
        try:
            track.set_data(TRACK_PRESET_DATA_KEY, record)
        except _LOM_ERRORS as e:  # set_data is Live 12 API; a refusal must not cost the ack
            logger.warning(
                "TrackPrepareComponent: set_data preset on %s raised: %s",
                track_path, e,
            )
            return
        # A chain that could not be read records nothing (``None``), and says so.
        self._emit(
            V3_TRACK_PRESET_ADDRESS,
            (track_path, preset_path if record is not None else TRACK_PRESET_UNSET),
        )

    # --- duplicate handler -----------------------------------------------

    def handle_duplicate(self, args, source_addr) -> None:
        """``[request_id, source_track_path, clear_clips:int=0]`` — duplicate
        a whole track.

        Live's ``Song.duplicate_track(N)`` inserts the copy at index
        ``N + 1`` and carries the source's entire device chain (including
        Permute), so this handler does NOT append a sequencer — the copy
        already has one. The frontend resets the copied Permute's params
        after the ack lands.

        ``clear_clips`` (the variation-track gesture) empties every clip
        slot on the copy before the ack. **This has to happen here, not in
        the UI**: a duplicate shifts every track below it by one, so the
        UI's snapshot of ``tracks/<N+1>`` still describes the track that
        used to live at that index until the next ``state/full`` lands.
        Deleting "the clips this track has" off that snapshot deleted the
        wrong set — in practice one scene, whichever the stale neighbour
        happened to hold. Here the copy is in hand, in the same Live tick
        that made it, with nothing to be stale about.

        Idempotency, ack/nack, and LRU plumbing are shared with
        ``handle_prepare`` (same component, same ``request_id``-keyed
        cache — fresh UUID per UI action, so the two never collide).
        """
        if self._disconnected:
            return
        if len(args) not in (2, 3):
            # No usable request_id correlation key → drop; UI times out
            # and retries. Mirrors handle_prepare's arg-count posture.
            logger.warning(
                "TrackPrepareComponent: duplicate arg-count mismatch "
                "(expected 2 or 3, got %d)",
                len(args),
            )
            return

        request_id = _coerce_str(args[0])
        source_path = _coerce_str(args[1])
        clear_clips = bool(args[2]) if len(args) == 3 else False
        if not request_id:
            logger.warning(
                "TrackPrepareComponent: duplicate empty request_id; dropping",
            )
            return

        cached = self._lru_get(request_id)
        if cached is not None:
            address, payload = cached
            logger.info(
                "TrackPrepareComponent: replaying cached %s for request_id=%r",
                address, request_id,
            )
            self._emit(address, payload)
            return

        source_index = _parse_track_index(source_path)
        if source_index is None:
            self._nack_duplicate(
                request_id, NACK_INVALID_ARGS,
                "source_track_path must be tracks/<N>, got %r" % source_path,
            )
            return

        try:
            tracks_pre = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._nack_duplicate(
                request_id, NACK_DUPLICATE_FAILED,
                "read song.tracks raised: %s: %s" % (type(e).__name__, e),
            )
            return

        if source_index < 0 or source_index >= len(tracks_pre):
            self._nack_duplicate(
                request_id, NACK_NO_TRACK,
                "source_index %d out of range (len=%d)" % (
                    source_index, len(tracks_pre),
                ),
            )
            return

        try:
            self._song.duplicate_track(source_index)
        except _LOM_ERRORS as e:
            self._nack_duplicate(
                request_id, NACK_DUPLICATE_FAILED,
                "duplicate_track(%d) raised: %s: %s" % (
                    source_index, type(e).__name__, e,
                ),
            )
            return

        try:
            tracks_post = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._nack_duplicate(
                request_id, NACK_DUPLICATE_FAILED,
                "post-duplicate read song.tracks raised: %s: %s" % (
                    type(e).__name__, e,
                ),
            )
            return

        if len(tracks_post) <= len(tracks_pre):
            self._nack_duplicate(
                request_id, NACK_DUPLICATE_FAILED,
                "post-duplicate len=%d not greater than pre=%d" % (
                    len(tracks_post), len(tracks_pre),
                ),
            )
            return

        # Live places the copy directly after the source. Within a single
        # Live tick this is race-free; nothing interleaves between
        # duplicate_track and our re-read.
        new_index = source_index + 1
        new_path = "tracks/%d" % new_index
        logger.info(
            "TrackPrepareComponent: duplicated track %d -> %s",
            source_index, new_path,
        )

        if clear_clips:
            self._clear_all_clips(tracks_post[new_index], new_path)

        self._ack_duplicate(request_id, new_path)

    def _clear_all_clips(self, track, track_path: str) -> None:
        """Delete every clip on ``track``.

        Degraded, never fatal: the duplicate itself has already succeeded
        by the time this runs, so a slot that refuses to give up its clip
        is a warning and the ack still goes out. Reads ``has_clip``
        defensively — a half-torn-down slot raising on the read is the
        same "nothing to delete" as a slot reading False.
        """
        try:
            slots = list(track.clip_slots)
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackPrepareComponent: %s.clip_slots read failed: %s: %s",
                track_path, type(e).__name__, e,
            )
            return

        deleted = 0
        for index, slot in enumerate(slots):
            try:
                if not slot.has_clip:
                    continue
                slot.delete_clip()
                deleted += 1
            except _LOM_ERRORS as e:
                logger.warning(
                    "TrackPrepareComponent: %s/slots/%d delete_clip "
                    "failed: %s: %s",
                    track_path, index, type(e).__name__, e,
                )

        logger.info(
            "TrackPrepareComponent: cleared %d clip(s) on %s",
            deleted, track_path,
        )

    # --- decision: reuse vs create ---------------------------------------

    def _decide(self, track_type: str, request_id: str):
        """Return ``(track, was_created, track_index)`` or ``None`` after
        emitting a nack.

        Server-authoritative: reads ``song.tracks`` and the selected
        track's clip slots directly. No UI snapshot involved, so the
        decision can't be stale.

        Reuse order:
        1. The selected track, if it's eligible (not index 0, type
           matches, no clips, not a group). Respects explicit intent.
        2. The lowest-index eligible track (scan starts at index 1).
        3. CREATE a new track.
        """
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._nack(
                request_id, NACK_CREATE_FAILED,
                "read song.tracks raised: %s: %s" % (type(e).__name__, e),
            )
            return None

        selected_index = self._selected_track_index(tracks)

        # Step 1: prefer the selected track if it's eligible. Track 0 is
        # off-limits regardless (keeps the first track clean — matches
        # the legacy UI policy in trackPreparation.ts:319-326).
        if selected_index not in (None, 0):
            candidate = tracks[selected_index]
            if self._is_reusable(candidate, track_type):
                logger.info(
                    "TrackPrepareComponent._decide: REUSE_SELECTED "
                    "track %d for %s",
                    selected_index, track_type,
                )
                return candidate, False, selected_index

        # Step 2: scan for the lowest-index eligible track (skip 0).
        scanned = self._find_lowest_empty_track(tracks, track_type)
        if scanned is not None:
            scan_track, scan_index = scanned
            logger.info(
                "TrackPrepareComponent._decide: REUSE_EMPTY "
                "track %d for %s (selected_index=%r)",
                scan_index, track_type, selected_index,
            )
            return scan_track, False, scan_index

        # Step 3: nothing reusable — create.
        logger.info(
            "TrackPrepareComponent._decide: CREATE %s "
            "(selected_index=%r, len(tracks)=%d, no empty matching track)",
            track_type, selected_index, len(tracks),
        )
        return self._create(track_type, tracks, request_id)

    def _resolve_pinned_track(self, track_path: str, request_id: str):
        """Resolve ``tracks/<N>`` to ``(track, index)`` for replace mode,
        or ``None`` after emitting a nack.

        No reuse-eligibility check: the caller explicitly wants THIS
        track regardless of clips. Only validates that the path is
        well-formed and in range — a stale/deleted index nacks with
        ``no-track`` so the UI surfaces it instead of silently
        retargeting.
        """
        index = _parse_track_index(track_path)
        if index is None:
            self._nack(
                request_id, NACK_INVALID_ARGS,
                "target_track_path must be tracks/<N>, got %r" % track_path,
            )
            return None
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS as e:
            # Failed LOM read, not an out-of-range index — match the
            # code _decide/_create use for the same _LOM_ERRORS on
            # song.tracks (NACK_NO_TRACK conventionally means "index
            # out of range").
            self._nack(
                request_id, NACK_CREATE_FAILED,
                "read song.tracks raised: %s: %s" % (type(e).__name__, e),
            )
            return None
        if index < 0 or index >= len(tracks):
            self._nack(
                request_id, NACK_NO_TRACK,
                "target index %d out of range (len=%d)" % (index, len(tracks)),
            )
            return None
        return tracks[index], index

    def _is_reusable(self, track, track_type: str) -> bool:
        if self._is_group_track(track):
            return False
        if self._is_metronome_track(track):
            return False
        if not self._track_type_matches(track, track_type):
            return False
        if self._track_has_any_clips(track):
            return False
        return True

    def _find_lowest_empty_track(self, tracks, track_type: str):
        """Return ``(track, index)`` for the lowest-index reusable track,
        or ``None``. Always skips index 0.
        """
        for i, track in enumerate(tracks):
            if i == 0:
                continue
            if self._is_reusable(track, track_type):
                return track, i
        return None

    @staticmethod
    def _is_group_track(track) -> bool:
        try:
            return bool(getattr(track, "is_foldable", False))
        except _LOM_ERRORS:
            return False

    @staticmethod
    def _is_metronome_track(track) -> bool:
        """A track holding an Instrument Rack whose macro 1 is named
        "Pattern N" — in practice the Skaka Metronome Rack, which
        generates its own notes off the transport and so carries no
        clips of its own. Never a reuse/create target, regardless of
        position.

        This exists because track 0's own protection (below, and the
        long-standing "keep the first track clean" policy of ADR-385) is
        purely *positional* — it breaks the moment the metronome track
        is grouped or otherwise moved off index 0, at which point a
        normal preset load can land right on top of it. The macro-name
        test travels with the rack instead, wherever it ends up.

        Deliberately the same structural test the UI's Pattern Rack
        central view uses to route itself
        (`macroLayoutUtils.isPatternRackMacroName`) rather than a
        literal name match on the rack or the track — a resave from
        Live's own preset browser can drift the device's own name, and
        the whole point is not to depend on the track being named any
        particular thing either.
        """
        try:
            devices = track.devices
        except _LOM_ERRORS:
            return False
        for device in devices:
            try:
                params = device.parameters
                if params and len(params) > 1 and _PATTERN_MACRO_RE.match(str(params[1].name or "")):
                    return True
            except _LOM_ERRORS:
                continue
        return False

    def _selected_track_index(self, tracks) -> Optional[int]:
        try:
            view = self._song.view
            selected = view.selected_track
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackPrepareComponent: read selected_track raised: %s: %s",
                type(e).__name__, e,
            )
            return None
        if selected is None:
            return None
        # Live's v3 framework hands out fresh wrappers per read, so ``is``
        # comparison fails. Compare by stable LOM identity (``_live_ptr``)
        # — same pattern ExclusiveArmComponent._same_track uses.
        if _safe_int_id is not None:
            sel_id = _safe_int_id(selected)
            if sel_id is not None:
                for i, t in enumerate(tracks):
                    if _safe_int_id(t) == sel_id:
                        return i
        # Identity fallback (covers test stubs where _live_ptr is absent).
        for i, t in enumerate(tracks):
            if t is selected:
                return i
        return None

    @staticmethod
    def _track_type_matches(track, track_type: str) -> bool:
        try:
            has_midi = bool(track.has_midi_input)
        except _LOM_ERRORS:
            has_midi = False
        return (has_midi and track_type == "midi") or (
            (not has_midi) and track_type == "audio"
        )

    @staticmethod
    def _track_has_any_clips(track) -> bool:
        # Session view.
        try:
            slots = list(track.clip_slots)
        except _LOM_ERRORS:
            slots = []
        for slot in slots:
            try:
                if slot.has_clip:
                    return True
            except _LOM_ERRORS:
                continue
        # Arrangement view.
        try:
            arr = track.arrangement_clips
            if arr and len(arr) > 0:
                return True
        except _LOM_ERRORS:
            pass
        return False

    def _create(self, track_type: str, tracks_pre, request_id: str):
        try:
            if track_type == "audio":
                self._song.create_audio_track(-1)
            else:
                self._song.create_midi_track(-1)
        except _LOM_ERRORS as e:
            self._nack(
                request_id, NACK_CREATE_FAILED,
                "create_%s_track raised: %s: %s" %
                (track_type, type(e).__name__, e),
            )
            return None

        try:
            tracks_post = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._nack(
                request_id, NACK_CREATE_FAILED,
                "post-create read song.tracks raised: %s: %s" %
                (type(e).__name__, e),
            )
            return None

        if len(tracks_post) <= len(tracks_pre):
            self._nack(
                request_id, NACK_CREATE_FAILED,
                "post-create len(tracks)=%d not greater than pre-create len=%d" %
                (len(tracks_post), len(tracks_pre)),
            )
            return None

        # Live appends the new track to song.tracks — index is len-1.
        # Within a single Live tick this is race-free; nothing else can
        # interleave between create_*_track and our re-read.
        new_index = len(tracks_post) - 1
        new_track = tracks_post[new_index]
        logger.info(
            "TrackPrepareComponent: created %s track at index %d",
            track_type, new_index,
        )
        return new_track, True, new_index

    # --- audio configure -------------------------------------------------

    def _handle_alc_prepare(self, request_id: str, alc_path: str, source: str = "", rel: str = "") -> None:
        """Load an ``.alc`` clip via the Browser (Live creates the track),
        then prep that track (audio routing/arm + Permute) and ack.

        On a browser-resolution miss, falls back to creating a plain audio
        track and loading the ``.alc``'s underlying raw sample (metadata
        lost, but the clip lands).
        """
        track, err = self._device_load.load_clip_new_track(alc_path, source, rel)
        if track is None:
            # Browser couldn't load the clip — fall back to a raw audio
            # track + create_audio_clip on the resolved sample.
            logger.warning(
                "TrackPrepareComponent: .alc browser load failed (%s); "
                "falling back to raw sample for %r", err, alc_path,
            )
            self._alc_raw_fallback(request_id, alc_path, err)
            return

        # Prep the browser-created track like any audio track.
        self._configure_audio(track)
        self._ensure_sequencer(track)
        index = self._track_index_of(track)
        if index is None:
            self._nack(request_id, NACK_CREATE_FAILED, "alc-track-index-lost")
            return
        self._ack(request_id, "tracks/%d" % index, True)

    def _alc_raw_fallback(self, request_id: str, alc_path: str, err: str) -> None:
        """Create an audio track and load the ``.alc``'s raw sample."""
        sample = alc_resolver.resolve_alc(alc_path)
        if sample is None:
            self._nack(
                request_id, NACK_LOAD_FAILED, "alc-unresolvable: %s" % err,
            )
            return
        try:
            tracks_pre = list(self._song.tracks)
        except _LOM_ERRORS as e:
            self._nack(request_id, NACK_CREATE_FAILED, "read tracks: %s" % e)
            return
        created = self._create("audio", tracks_pre, request_id)
        if created is None:
            return  # _create nacked
        track, _was, index = created
        self._configure_audio(track)
        slot = None
        for s in getattr(track, "clip_slots", None) or ():
            try:
                if not s.has_clip:
                    slot = s
                    break
            except _LOM_ERRORS:
                continue
        if slot is None:
            self._nack(request_id, NACK_LOAD_FAILED, "no-empty-slot")
            return
        try:
            slot.create_audio_clip(sample)
        except _LOM_ERRORS as e:
            self._nack(
                request_id, NACK_LOAD_FAILED,
                "create_audio_clip: %s: %s" % (type(e).__name__, e),
            )
            return
        self._ensure_sequencer(track)
        self._ack(request_id, "tracks/%d" % index, True)

    def _track_index_of(self, track):
        """Return the index of ``track`` in ``song.tracks``, or ``None``."""
        target = _safe_int_id(track) if _safe_int_id is not None else None
        try:
            tracks = list(self._song.tracks)
        except _LOM_ERRORS:
            return None
        for i, t in enumerate(tracks):
            if target is not None and _safe_int_id is not None:
                if _safe_int_id(t) == target:
                    return i
            elif t is track:
                return i
        return None

    def _finalize_audio_create(
        self, track, track_index: int, preset_path: str, request_id: str,
        source_rel: Tuple[str, str] = ("", ""),
    ) -> None:
        """Deferred finalization for an audio create. Configures routing
        + arm, optionally loads the preset, then emits the ack."""
        if self._disconnected:
            return
        logger.info(
            "TrackPrepareComponent: finalizing audio create index=%d "
            "preset=%r request_id=%r",
            track_index, preset_path, request_id,
        )
        self._configure_audio(track)
        track_path = "tracks/%d" % track_index
        if preset_path:
            err = self._device_load.load_into_track(
                track, preset_path, source=source_rel[0], rel=source_rel[1],
            )
            if err is not None:
                self._nack(request_id, NACK_LOAD_FAILED, err)
                return
            self._record_preset(track, track_path, preset_path)
        self._ensure_sequencer(track)
        self._ack(request_id, track_path, True)

    def _configure_audio(self, track) -> None:
        """Apply audio-track defaults: input routing channel (when this
        Mac names one) + arm."""
        if self._input_channel:
            self._set_input_routing_channel(track, self._input_channel)
        if self._should_auto_arm():
            try:
                track.arm = True
            except _LOM_ERRORS as e:
                logger.warning(
                    "TrackPrepareComponent: set track.arm=True raised: %s: %s",
                    type(e).__name__, e,
                )

    def _set_input_routing_channel(self, track, channel_name: str) -> None:
        """Set ``track.input_routing_channel`` by display-name lookup.

        Mirrors :meth:`FootTriggerComponent._set_input_routing_channel`
        but stripped down — we don't need the elaborate diagnostic
        logging here (Foot trigger had it because of a real bug it
        was investigating).
        """
        try:
            available = track.available_input_routing_channels
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackPrepareComponent: read available_input_routing_channels "
                "raised: %s: %s", type(e).__name__, e,
            )
            return

        if available:
            for routing in available:
                try:
                    if getattr(routing, "display_name", None) == channel_name:
                        track.input_routing_channel = routing
                        return
                except _LOM_ERRORS:
                    continue

        # No display-name match — try string fallback. On real Live
        # this raises (the setter expects a routing object); test stubs
        # accept it. The resulting WARN is the diagnostic.
        try:
            track.input_routing_channel = channel_name
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackPrepareComponent: input_routing_channel=%r fallback "
                "raised: %s: %s",
                channel_name, type(e).__name__, e,
            )

    def _select_track(self, track) -> None:
        try:
            self._song.view.selected_track = track
        except _LOM_ERRORS as e:
            logger.warning(
                "TrackPrepareComponent: select_track raised: %s: %s",
                type(e).__name__, e,
            )

    # --- Permute placement -----------------------------------------------

    def _ensure_sequencer(self, track) -> None:
        """Append Permute to ``track`` unless it's already present.

        Failure does not propagate to a nack — the prep itself
        succeeded, and a missing Permute is a degraded but useful
        outcome (the track still works, the user can drop Permute
        manually). Logs the reason so the operator can diagnose.
        """
        if not self._sequencer_device_path:
            return
        if self._track_has_sequencer(track):
            return
        err = self._device_load.load_into_track(
            track, self._sequencer_device_path,
            source=live_library.m4l_source(), rel=live_library.SEQUENCER_REL,
        )
        if err is not None:
            logger.warning(
                "TrackPrepareComponent: Permute load failed (%s); "
                "prep continues without it",
                err,
            )

    @staticmethod
    def _track_has_sequencer(track) -> bool:
        """True when a device named ``Permute`` is already on ``track``.

        Matches by ``device.name`` rather than ``class_name``. The
        external M4L device's ``class_name`` (``MxDeviceAudioEffect``)
        also covers other Max audio effects, so name is the only
        distinguishing attribute we can rely on.
        """
        try:
            devices = list(track.devices)
        except _LOM_ERRORS:
            return False
        for device in devices:
            try:
                # Load-bearing literal: the .amxd must keep the name
                # "Permute" or this guard fails open and every prep on a
                # reused track double-loads the device.
                if getattr(device, "name", None) == "Permute":
                    return True
            except _LOM_ERRORS:
                continue
        return False

    # --- ack / nack + LRU -------------------------------------------------

    def _ack(self, request_id: str, track_path: str, was_created: bool) -> None:
        payload = (request_id, track_path, 1 if was_created else 0)
        self._lru_put(request_id, V3_TRACK_PREPARE_ACK_ADDRESS, payload)
        self._emit(V3_TRACK_PREPARE_ACK_ADDRESS, payload)

    def _nack(self, request_id: str, code: str, detail: str) -> None:
        # Trim detail to keep wire size sane (matches the convention in
        # other components' load-failed details).
        payload = (request_id, code, detail[:160])
        self._lru_put(request_id, V3_TRACK_PREPARE_NACK_ADDRESS, payload)
        self._emit(V3_TRACK_PREPARE_NACK_ADDRESS, payload)

    def _ack_duplicate(self, request_id: str, new_track_path: str) -> None:
        payload = (request_id, new_track_path)
        self._lru_put(request_id, V3_TRACK_DUPLICATE_ACK_ADDRESS, payload)
        self._emit(V3_TRACK_DUPLICATE_ACK_ADDRESS, payload)

    def _nack_duplicate(self, request_id: str, code: str, detail: str) -> None:
        payload = (request_id, code, detail[:160])
        self._lru_put(request_id, V3_TRACK_DUPLICATE_NACK_ADDRESS, payload)
        self._emit(V3_TRACK_DUPLICATE_NACK_ADDRESS, payload)

    def _lru_get(self, request_id: str):
        entry = self._lru.get(request_id)
        if entry is None:
            return None
        ts, address, args = entry
        if time.monotonic() - ts > _LRU_TTL_SECONDS:
            # Expired — drop and treat as fresh.
            self._lru.pop(request_id, None)
            return None
        return address, args

    def _lru_put(self, request_id: str, address: str, args: tuple) -> None:
        self._lru[request_id] = (time.monotonic(), address, args)
        # Evict oldest while over capacity.
        while len(self._lru) > _LRU_MAX_ENTRIES:
            # Pop the oldest insertion-order entry. Python 3.7+ dicts
            # preserve insertion order, so iter(self._lru) yields oldest
            # first.
            oldest = next(iter(self._lru))
            self._lru.pop(oldest, None)

    # --- helpers ---------------------------------------------------------

    @staticmethod
    def _resolve_input_channel(constants: dict) -> Optional[str]:
        """``audio.defaultInputChannel``, or ``None`` when unset: then a new
        audio track keeps Live's own default input."""
        if isinstance(constants, dict):
            audio = constants.get("audio")
            if isinstance(audio, dict):
                ch = audio.get("defaultInputChannel")
                if isinstance(ch, str) and ch:
                    return ch
        return None

    @staticmethod
    def _resolve_sequencer_path(constants: dict) -> str:
        """Read ``devices.sequencer.devicePath`` from constants. Empty
        string when missing — ``_ensure_sequencer`` skips the append
        rather than failing the prep."""
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
            "TrackPrepareComponent: no Permute.amxd under %r and no "
            "devices.sequencer.devicePath; Permute append on prep will be skipped",
            live_library.m4l_devices_root(),
        )
        return ""

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        self._lru.clear()
