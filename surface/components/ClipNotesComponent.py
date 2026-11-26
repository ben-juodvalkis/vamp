"""ClipNotesComponent — Phase 8 PR-8b clip-note transposition.

Owns the single UI→Surf address that mutates note content of a MIDI
clip:

    /looping/v3/clip/transpose  [clipPath:string, semitones:int, generation:int?]

Replaces the M4L ``/cmd/transpose_clip_notes`` handler in
``ableton/scripts/liveAPI-v6.js`` (deleted in the same PR). Lives as
its own component rather than folded into ``ClipPropertiesComponent``
because note content is a different LOM surface (``get_all_notes_extended``
+ ``apply_note_modifications``) than the property listeners that
component owns.

Wire shape (path-keyed)
-----------------------

The handler accepts any ``clipPath`` resolvable via ``resolve_clip``
— it does **not** require the path to be the currently focused clip.
The UI passes ``session.focusedClipPath`` today, but a path-keyed
write is the right contract: focus may change between the user's
gesture and the wire arrival, and dropping the write would produce a
worse UX than applying it to the path the user actually pointed at.

No echo address. Live's note edits don't fire a clip-property listener,
and the UI has no "transposed clip" state to reconcile — the whole
gesture is fire-and-forget. Errors flow through the shared
``/looping/v3/error`` channel.

LOM-touch guard
---------------

Every LOM read/call wrapped in ``_LOM_ERRORS`` per the Live 12 quirks
in ``project_live_lom_quirks.md`` (TypeError covers
``Boost.Python.ArgumentError`` from torn-down handles).

Validation
----------

- ``clipPath`` resolved via ``path_resolver.resolve_clip``; resolver-
  reported failure → typed wire code (``slot-not-found`` /
  ``clip-not-present`` / ``write-rejected``).
- ``semitones`` parsed as int; non-int → ``write-rejected``.
- Clip type checked via ``clip.is_midi_clip``; audio clip →
  ``not-midi-clip``.
- Each transposed pitch clamped to [0, 127] — Live's MIDI range. No
  rejection: a bass note transposed below 0 stays at 0, matching
  the M4L behaviour the UI already knows.

Round-trip
----------

Under live Python ``clip.get_all_notes_extended()`` returns a
``Clip.MidiNoteVector`` — a C++ container of ``MidiNote`` objects
exposing ``.note_id / .pitch / .start_time / .duration / .velocity /
.mute`` (and ``.probability / .velocity_deviation / .release_velocity``
when present). The M4L code worked with a JSON string because Max's
``LiveAPI.call`` serialises results across the host bridge; direct
Python access skips that.

**The read-back ``MidiNote`` objects are writable in place**, and
``apply_note_modifications(vec)`` commits those mutations keyed by
``note_id`` — including ``pitch`` (verified on Live 12.4, probe P2;
the pre-M4 docstring claiming pitch couldn't change this way was
wrong). The reliable write path for an edit is therefore
read-mutate-writeback: read the vector, mutate the targeted notes,
pass the SAME vector to ``apply_note_modifications`` — preserving
every id. ``transpose`` and the M4 ``notes/modify`` handler both use
this. Add uses ``MidiNoteSpecification`` (which CANNOT carry a
note_id) + ``add_new_notes``; remove uses ``remove_notes_by_id``. The
legacy clear-and-rewrite (``remove_notes_extended`` →
``add_new_notes``) survives only as a fallback when
``apply_note_modifications`` is absent. Some test stubs hand back a
JSON string / dict / list; ``_normalize_notes_iterable`` accepts those
shapes so unit tests don't need the real LOM types.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from typing import Callable, List, Optional, Tuple

from . import path_resolver
from .detail_clip import DetailClipWatch, focus_path
from ._common import LOM_ERRORS, coerce_str, read_all_notes
from .component_util import emit_error, first_time, parse_int_arg, safe_emit
from .path_resolver import ResolveStatus
from .clip_notes_codec import (  # noqa: F401  (re-exported: the tests import these from here)
    _FLOATS_PER_NOTE,
    _MIDI_PITCH_MAX,
    _MIDI_PITCH_MIN,
    _BYTES_PER_NOTE,
    _NOTE_PACK_FMT,
    _RICH_NOTE_PACK_FMT,
    _RICH_BYTES_PER_NOTE,
    _RICH_CHUNK_BUDGET_BYTES,
    _RICH_NOTES_PER_CHUNK,
    _RICH_NOTES_HARD_CEILING,
    _FNV_OFFSET_BASIS,
    _FNV_PRIME,
    _UINT32_MASK,
    _INT31_MASK,
    _FORWARDED_NOTE_ATTRS,
    _DEFAULTS,
    _READ_RAISED,
    _coerce_note_to_dict,
    _normalize_notes_iterable,
    _pack_notes_blob,
    _read_rich_notes,
    _coerce_rich_note,
    _pack_rich_note,
    _rich_blob_checksum,
    _to_blob_bytes,
    _unpack_rich_blob,
    _parse_id_list,
    _mutate_note_in_place,
    _pack_id_blob,
    _extract_added_ids,
)

try:  # pragma: no cover - real Live runtime only
    import Live  # type: ignore
    _MIDI_NOTE_SPEC = Live.Clip.MidiNoteSpecification
except Exception:  # pragma: no cover - tests run without Live
    Live = None  # type: ignore
    _MIDI_NOTE_SPEC = None

logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch must catch. ``TypeError`` covers
# ``Boost.Python.ArgumentError`` (TypeError subclass) raised when a
# C++ handle is torn down — see CLAUDE.md merge-gate rule (9).
_LOM_ERRORS = LOM_ERRORS


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_CLIP_TRANSPOSE_ADDRESS = "/looping/v3/clip/transpose"
V3_CLIP_NOTES_GET_ADDRESS = "/looping/v3/clip/notes/get"
V3_CLIP_NOTES_REPLY_ADDRESS = "/looping/v3/clip/notes"

# M3 rich focused-clip note channel (chunked, identity-carrying).
V3_CLIP_NOTES_RICH_GET_ADDRESS = "/looping/v3/clip/notes/rich/get"
V3_CLIP_NOTES_RICH_BEGIN_ADDRESS = "/looping/v3/clip/notes/rich/begin"
V3_CLIP_NOTES_RICH_CHUNK_ADDRESS = "/looping/v3/clip/notes/rich/chunk"
V3_CLIP_NOTES_RICH_END_ADDRESS = "/looping/v3/clip/notes/rich/end"
V3_CLIP_NOTES_CHANGED_ADDRESS = "/looping/v3/clip/notes/changed"

# M4 note-edit writes.
V3_CLIP_NOTES_REMOVE_ADDRESS = "/looping/v3/clip/notes/remove"
V3_CLIP_NOTES_MODIFY_ADDRESS = "/looping/v3/clip/notes/modify"
V3_CLIP_NOTES_ADD_ADDRESS = "/looping/v3/clip/notes/add"
V3_CLIP_NOTES_ADDED_ADDRESS = "/looping/v3/clip/notes/added"

# M6 editor→Live note selection (clip.select_notes_by_id). Verified on
# Live 12.4 via SelectionProbe: select_notes_by_id / deselect_all_notes
# live on Clip (not Clip.View); no selection-changed listener exists, so
# this is push-only (Live→editor reverse deferred to a polling design).
V3_CLIP_NOTES_SELECT_ADDRESS = "/looping/v3/clip/notes/select"

# M5 duplicate-region (clip.duplicate_notes_by_id — verified present on
# Clip via SelectionProbe). Replies on the shared notes/added address.
V3_CLIP_NOTES_DUPLICATE_ADDRESS = "/looping/v3/clip/notes/duplicate"

V3_ERROR_ADDRESS = "/looping/v3/error"


# --- error codes (closed-enum per 04 §7.2) --------------------------------

V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"
V3_ERROR_SLOT_NOT_FOUND = "slot-not-found"
V3_ERROR_CLIP_NOT_PRESENT = "clip-not-present"
V3_ERROR_CLIP_NOT_FOUND = "clip-not-found"
V3_ERROR_WRITE_REJECTED = "write-rejected"
V3_ERROR_NOT_MIDI_CLIP = "not-midi-clip"
V3_ERROR_CLIP_NOT_MIDI = "clip-not-midi"
V3_ERROR_TOO_MANY_NOTES = "clip-too-many-notes"


# --- notes/get reply tuning ----------------------------------------------

# Cap notes per emit so the OSC packet stays under the kernel's 9216-byte
# UDP MTU on darwin (Errno 40 above that — see V3StateFullComponent's
# CHUNK_BUDGET note). Each note is 16 bytes (4 floats), so 512 notes →
# 8192-byte blob; with the address + request_id + clip_path + count
# envelope the total packet lands ~8.3 KB, well inside the cap. 512 is
# generous for typical session clips: a 32-bar 16-step grid is 512
# notes exactly; busier clips reject with ``clip-too-many-notes``
# rather than silently truncate. ADR-360 deviates from the plan's 4096
# cap (which would have produced 64 KB blobs and silent UDP drops)
# precisely because the plan's UDP-fit calculation didn't account for
# the notes path.
_NOTES_PER_EMIT_CAP = 512

# --- request LRU ---------------------------------------------------------
#
# Bounded LRU for retransmit idempotency. Mirrors TrackPrepareComponent's
# 64×30s policy but smaller (32 entries) — notes/get traffic is rarer
# than prepare_for_preset and the reply blob is much larger, so keep
# fewer cached entries.
_REQUEST_LRU_MAX = 32
_REQUEST_LRU_TTL_SEC = 30.0


# ResolveStatus → wire-error-code map for the clipPath input.
_CLIP_RESOLVE_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_WRITE_REJECTED,
    ResolveStatus.NOT_FOUND: V3_ERROR_SLOT_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
    ResolveStatus.CLIP_NOT_PRESENT: V3_ERROR_CLIP_NOT_PRESENT,
}

# notes/get-specific resolve map — collapse all "couldn't resolve" cases
# into ``clip-not-found`` since the UI's pull endpoint just wants a
# binary "found / not found" verdict; the granular write codes
# (``slot-not-found`` etc) belong to write paths where the user
# expects to author against a specific slot.
_CLIP_RESOLVE_NOTES_GET_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_CLIP_NOT_FOUND,
    ResolveStatus.NOT_FOUND: V3_ERROR_CLIP_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_CLIP_NOT_FOUND,
    ResolveStatus.CLIP_NOT_PRESENT: V3_ERROR_CLIP_NOT_FOUND,
}


# --- helpers --------------------------------------------------------------


_coerce_str = coerce_str


def _parse_int_arg(args, index: int) -> Optional[int]:
    """Parse ``args[index]`` as an ``int``; ``None`` on any failure. A bool
    is refused so a stray ``True`` does not transpose by one."""
    return parse_int_arg(args, index, allow_bool=False)


# --- component ------------------------------------------------------------


class ClipNotesComponent:
    """Owns the ``/looping/v3/clip/transpose`` wire.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
    """

    V3_CLIP_TRANSPOSE_ADDRESS = V3_CLIP_TRANSPOSE_ADDRESS
    V3_CLIP_NOTES_GET_ADDRESS = V3_CLIP_NOTES_GET_ADDRESS
    V3_CLIP_NOTES_REPLY_ADDRESS = V3_CLIP_NOTES_REPLY_ADDRESS
    V3_CLIP_NOTES_RICH_GET_ADDRESS = V3_CLIP_NOTES_RICH_GET_ADDRESS
    V3_CLIP_NOTES_REMOVE_ADDRESS = V3_CLIP_NOTES_REMOVE_ADDRESS
    V3_CLIP_NOTES_MODIFY_ADDRESS = V3_CLIP_NOTES_MODIFY_ADDRESS
    V3_CLIP_NOTES_ADD_ADDRESS = V3_CLIP_NOTES_ADD_ADDRESS
    V3_CLIP_NOTES_SELECT_ADDRESS = V3_CLIP_NOTES_SELECT_ADDRESS
    V3_CLIP_NOTES_DUPLICATE_ADDRESS = V3_CLIP_NOTES_DUPLICATE_ADDRESS
    V3_ERROR_ADDRESS = V3_ERROR_ADDRESS

    NOTES_PER_EMIT_CAP = _NOTES_PER_EMIT_CAP
    RICH_NOTES_PER_CHUNK = _RICH_NOTES_PER_CHUNK
    RICH_NOTES_HARD_CEILING = _RICH_NOTES_HARD_CEILING

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
    ) -> None:
        self._song = song
        self._emit = emit
        self._disconnected = False
        # Bounded LRU for ``notes/get`` retransmit idempotency. Keyed by
        # ``request_id``; value is the cached reply-or-error tuple
        # (``address, args, ts``). Mirrors TrackPrepareComponent's LRU
        # but scoped to notes — replies are large blobs, so keep this
        # smaller (32 vs 64) and shorter (30s).
        self._request_lru: "OrderedDict[str, Tuple[str, tuple, float]]" = (
            OrderedDict()
        )
        # Separate LRU for the rich channel: a value is the full
        # begin→chunk→end emit list (not a single reply), keyed by
        # request_id, so a WS-flap retransmit replays the whole sequence.
        self._rich_lru: "OrderedDict[str, Tuple[list, float]]" = OrderedDict()

        # M3: focused-clip notes listener (plan decision 5). One listener
        # on the currently-focused clip's ``notes`` so an edit on any
        # client pokes the others to re-pull the rich channel. Lives
        # alongside ClipPropertiesComponent's detail_clip observation —
        # but owns its own ``song.view`` detail_clip listener so the two
        # components stay decoupled. Bounded: +1 notes listener for the
        # single focused clip.
        self._focused_clip = None
        self._focused_path: Optional[str] = None
        self._notes_listener: Optional[Callable[[], None]] = None
        self._notes_listener_attached = False
        # ``(key, context) -> True`` once warned, for de-dupe.
        self._warned: set = set()

        self._detail = DetailClipWatch(self._song, self._on_detail_clip_changed, self._warn_once)
        self._view = self._detail.view
        self._refocus()
        logger.info(
            "ClipNotesComponent: ready (focused_path=%s)", self._focused_path,
        )

    # --- wire handlers ----------------------------------------------------

    def handle_transpose(self, args, source_addr) -> None:
        """``[clipPath, semitones, gen?]`` — shift every note's pitch.

        Read-mutate-writeback (M4): read the clip's ``MidiNoteVector``,
        shift each note's ``pitch`` in place (clamped to [0, 127]), then
        ``apply_note_modifications(vec)`` — **preserving every note_id**.
        This corrects the pre-M4 clear-and-rewrite (``remove_notes_extended``
        → ``add_new_notes``), which churned every id on a pure pitch shift
        on the false premise that pitch is read-only via
        ``apply_note_modifications`` (probe P2 disproved it). Falls back to
        the clear-and-rewrite only when ``apply_note_modifications`` is
        unavailable (very old builds / minimal stubs). Each failure mode
        emits a typed ``/looping/v3/error``.
        """
        if self._disconnected:
            return

        if len(args) < 2:
            self._emit_error(
                V3_CLIP_TRANSPOSE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected ≥2, got %d" % len(args),
            )
            return

        clip_path = _coerce_str(args[0])
        semitones = _parse_int_arg(args, 1)
        if semitones is None:
            self._emit_error(
                V3_CLIP_TRANSPOSE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="semitones not an int: %r" % (args[1],),
            )
            return

        clip = self._resolve_clip_or_error(clip_path)
        if clip is None:
            return

        if not self._is_midi_clip_safe(clip):
            self._emit_error(
                V3_CLIP_TRANSPOSE_ADDRESS,
                V3_ERROR_NOT_MIDI_CLIP,
                path=clip_path,
                detail="clip is not a MIDI clip",
            )
            return

        try:
            count = self._transpose_in_place(clip, semitones)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_TRANSPOSE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="transpose raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return

        if count == 0:
            # No notes to transpose is not an error — matches M4L behaviour.
            logger.info(
                "ClipNotesComponent: %s has no notes; nothing to transpose",
                clip_path,
            )
            return
        logger.info(
            "ClipNotesComponent: transposed %d notes by %d on %s",
            count, semitones, clip_path,
        )

    def _transpose_in_place(self, clip, semitones: int) -> int:
        """Shift every note's pitch by ``semitones``, preserving ids.

        Returns the note count. Reads the vector, mutates ``pitch`` in
        place (clamped), and writes the same vector back via
        ``apply_note_modifications``. Falls back to clear-and-rewrite when
        that method is absent.
        """
        vec = clip.get_all_notes_extended()
        apply = getattr(clip, "apply_note_modifications", None)
        if callable(apply):
            count = 0
            for note in vec:
                try:
                    cur = int(getattr(note, "pitch"))
                except (TypeError, ValueError):
                    continue
                new_pitch = cur + semitones
                if new_pitch < _MIDI_PITCH_MIN:
                    new_pitch = _MIDI_PITCH_MIN
                elif new_pitch > _MIDI_PITCH_MAX:
                    new_pitch = _MIDI_PITCH_MAX
                note.pitch = new_pitch
                count += 1
            if count:
                apply(vec)
            return count

        # Legacy fallback: clear-and-rewrite (churns ids). Only reached on
        # builds without apply_note_modifications.
        notes = _normalize_notes_iterable(vec)
        if notes is None:
            # Unparseable payload (broken build / plugin bug) — surface it
            # as a write-rejected rather than silently no-op.
            raise TypeError(
                "notes payload unparseable (type=%s)" % type(vec).__name__,
            )
        if not notes:
            return 0
        for note in notes:
            new_pitch = note["pitch"] + semitones
            if new_pitch < _MIDI_PITCH_MIN:
                new_pitch = _MIDI_PITCH_MIN
            elif new_pitch > _MIDI_PITCH_MAX:
                new_pitch = _MIDI_PITCH_MAX
            note["pitch"] = new_pitch
        self._replace_clip_notes(clip, notes)
        return len(notes)

    # --- notes/get pull endpoint ------------------------------------------

    def handle_notes_get(self, args, source_addr) -> None:
        """``[request_id, clip_path]`` — read notes, reply with float blob.

        Wire reply: ``/looping/v3/clip/notes
        [request_id, clip_path, note_count, note_blob]`` where
        ``note_blob`` is a packed float32 array
        ``[pitch, start, duration, velocity] × note_count``.

        Errors flow through the standard ``/looping/v3/error`` channel
        with codes ``clip-not-found`` (any resolve failure),
        ``clip-not-midi`` (audio clip), ``clip-too-many-notes`` (over
        cap), or ``write-rejected`` (LOM raise / arg validation).

        Retransmit idempotency: a duplicate ``request_id`` replays the
        cached reply (or error) without touching the LOM. Mirrors
        TrackPrepareComponent's LRU policy.
        """
        if self._disconnected:
            return

        if len(args) < 2:
            # No request_id parsed yet — emit a generic error against
            # the address with empty path; the UI will time out.
            self._emit_error(
                V3_CLIP_NOTES_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected ≥2, got %d" % len(args),
            )
            return

        request_id = _coerce_str(args[0])
        clip_path = _coerce_str(args[1])

        if not request_id:
            self._emit_error(
                V3_CLIP_NOTES_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="empty request_id",
            )
            return

        cached = self._lookup_lru(request_id)
        if cached is not None:
            address, payload = cached
            self._safe_emit(address, payload)
            return

        # Resolve clip. notes/get collapses every resolve failure into
        # ``clip-not-found`` — see _CLIP_RESOLVE_NOTES_GET_ERROR_MAP.
        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            code = _CLIP_RESOLVE_NOTES_GET_ERROR_MAP.get(
                result.status, V3_ERROR_CLIP_NOT_FOUND,
            )
            self._record_and_emit_error(
                request_id, code, clip_path,
                detail=result.detail or "",
            )
            return
        clip = result.obj

        if not self._is_midi_clip_safe(clip):
            self._record_and_emit_error(
                request_id, V3_ERROR_CLIP_NOT_MIDI, clip_path,
                detail="clip is not a MIDI clip",
            )
            return

        raw_notes, e = self._try_read_notes_extended(clip)
        if e is not None:
            self._record_and_emit_error(
                request_id, V3_ERROR_WRITE_REJECTED, clip_path,
                detail="get_all_notes_extended raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return

        notes = _normalize_notes_iterable(raw_notes)
        if notes is None:
            self._record_and_emit_error(
                request_id, V3_ERROR_WRITE_REJECTED, clip_path,
                detail="notes payload unparseable (type=%s)" % (
                    type(raw_notes).__name__,
                ),
            )
            return

        if len(notes) > _NOTES_PER_EMIT_CAP:
            self._record_and_emit_error(
                request_id, V3_ERROR_TOO_MANY_NOTES, clip_path,
                detail="clip has %d notes, cap is %d" % (
                    len(notes), _NOTES_PER_EMIT_CAP,
                ),
            )
            return

        blob = _pack_notes_blob(notes)
        payload = (
            request_id,
            clip_path,
            int(len(notes)),
            blob,
        )
        self._record_lru(request_id, V3_CLIP_NOTES_REPLY_ADDRESS, payload)
        self._safe_emit(V3_CLIP_NOTES_REPLY_ADDRESS, payload)
        logger.info(
            "ClipNotesComponent: notes/get reply id=%s path=%s count=%d",
            request_id, clip_path, len(notes),
        )

    # --- rich notes channel (M3) ------------------------------------------

    def handle_notes_rich_get(self, args, source_addr) -> None:
        """``[request_id, clip_path]`` — chunked, identity-carrying read.

        Reply: ``rich/begin [request_id, clip_path, note_count,
        total_chunks]`` → N × ``rich/chunk [request_id, chunk_index,
        note_blob]`` → ``rich/end [request_id, checksum]``. Each note is
        the 24-byte ``<iffffi>`` struct (note_id + extended fields).

        Errors flow through ``/looping/v3/error`` like ``notes/get``:
        ``clip-not-found`` (resolve failure), ``clip-not-midi`` (audio),
        ``clip-too-many-notes`` (over the rich ceiling), ``write-rejected``
        (LOM raise / arg validation). Retransmit idempotency via the
        shared LRU — a duplicate ``request_id`` replays the cached
        begin/chunk/end sequence without re-reading the LOM.
        """
        if self._disconnected:
            return

        if len(args) < 2:
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected ≥2, got %d" % len(args),
            )
            return

        request_id = _coerce_str(args[0])
        clip_path = _coerce_str(args[1])
        if not request_id:
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="empty request_id",
            )
            return

        cached = self._lookup_rich_lru(request_id)
        if cached is not None:
            for address, payload in cached:
                self._safe_emit(address, payload)
            return

        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_CLIP_NOT_FOUND, clip_path,
                detail=result.detail or "",
            )
            return
        clip = result.obj

        if not self._is_midi_clip_safe(clip):
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_CLIP_NOT_MIDI, clip_path,
                detail="clip is not a MIDI clip",
            )
            return

        raw_notes = self._read_notes_extended(clip)
        if raw_notes is _READ_RAISED:
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED, clip_path,
                detail="get_all_notes_extended raised",
            )
            return

        notes = _read_rich_notes(raw_notes)
        if notes is None:
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_WRITE_REJECTED, clip_path,
                detail="notes payload unparseable (type=%s)" % (
                    type(raw_notes).__name__,
                ),
            )
            return

        if len(notes) > _RICH_NOTES_HARD_CEILING:
            self._emit_error(
                V3_CLIP_NOTES_RICH_GET_ADDRESS,
                V3_ERROR_TOO_MANY_NOTES, clip_path,
                detail="clip has %d notes, rich ceiling is %d" % (
                    len(notes), _RICH_NOTES_HARD_CEILING,
                ),
            )
            return

        emits = self._build_rich_emits(request_id, clip_path, notes)
        self._record_rich_lru(request_id, emits)
        for address, payload in emits:
            self._safe_emit(address, payload)
        logger.info(
            "ClipNotesComponent: rich/get id=%s path=%s count=%d chunks=%d",
            request_id, clip_path, len(notes), len(emits) - 2,
        )

    def _build_rich_emits(
        self, request_id: str, clip_path: str, notes: List[dict],
    ) -> List[Tuple[str, tuple]]:
        """Build the begin→chunk→end emit list for ``notes``.

        Chunks on whole-note boundaries (never splits a 24-byte struct
        across datagrams). The checksum runs over the concatenated chunk
        bytes so the UI can verify reassembly. Empty clip → zero chunks
        (begin with total_chunks=0, then end) so the UI still sees the
        full sequence.
        """
        per_chunk = _RICH_NOTES_PER_CHUNK
        chunk_blobs: List[bytes] = []
        for i in range(0, len(notes), per_chunk):
            slice_notes = notes[i:i + per_chunk]
            chunk_blobs.append(
                b"".join(_pack_rich_note(n) for n in slice_notes)
            )
        checksum = _rich_blob_checksum(b"".join(chunk_blobs))

        emits: List[Tuple[str, tuple]] = []
        emits.append((
            V3_CLIP_NOTES_RICH_BEGIN_ADDRESS,
            (request_id, clip_path, int(len(notes)), int(len(chunk_blobs))),
        ))
        for idx, blob in enumerate(chunk_blobs):
            emits.append((
                V3_CLIP_NOTES_RICH_CHUNK_ADDRESS,
                (request_id, int(idx), blob),
            ))
        emits.append((
            V3_CLIP_NOTES_RICH_END_ADDRESS,
            (request_id, "0x%08x" % checksum),
        ))
        return emits

    # --- note-edit writes (M4) --------------------------------------------

    def handle_notes_remove(self, args, source_addr) -> None:
        """``[clip_path, note_ids:int[], gen?]`` — delete notes by id.

        Maps to ``clip.remove_notes_by_id(ids)`` (verified — probe P4).
        Live's docstring: this is for delete only, never to implement a
        modification. Non-structural → no generation bump (decision 4);
        the focused-clip notes listener fans the change out to OTHER
        clients (the initiating client suppresses its own re-pull).
        """
        if self._disconnected:
            return
        clip, clip_path = self._resolve_write_clip(
            args, V3_CLIP_NOTES_REMOVE_ADDRESS,
        )
        if clip is None:
            return
        ids = _parse_id_list(args[1] if len(args) > 1 else None)
        if ids is None:
            self._emit_error(
                V3_CLIP_NOTES_REMOVE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="note_ids not an int list",
            )
            return
        if not ids:
            return  # nothing to remove — silent, matches transpose-empty
        remover = getattr(clip, "remove_notes_by_id", None)
        if not callable(remover):
            self._emit_error(
                V3_CLIP_NOTES_REMOVE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="remove_notes_by_id unavailable",
            )
            return
        try:
            remover(ids)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_NOTES_REMOVE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="remove_notes_by_id raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        logger.info(
            "ClipNotesComponent: removed %d notes on %s", len(ids), clip_path,
        )

    def handle_notes_select(self, args, source_addr) -> None:
        """``[clip_path, note_ids:blob, gen?]`` — select notes by id in Live.

        M6 editor→Live selection. Maps to ``clip.select_notes_by_id(ids)``
        (verified on Live 12.4 — SelectionProbe). An EMPTY id list clears
        the selection via ``clip.deselect_all_notes()``. Selection is view
        state, not note content — non-structural, no echo, fire-and-forget
        (there's no selection-changed listener to fan out, and the editor
        already holds the selection it just sent).
        """
        if self._disconnected:
            return
        clip, clip_path = self._resolve_write_clip(
            args, V3_CLIP_NOTES_SELECT_ADDRESS,
        )
        if clip is None:
            return
        ids = _parse_id_list(args[1] if len(args) > 1 else None)
        if ids is None:
            self._emit_error(
                V3_CLIP_NOTES_SELECT_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="note_ids not an int list",
            )
            return

        if not ids:
            # Empty selection → clear Live's selection.
            deselect = getattr(clip, "deselect_all_notes", None)
            if not callable(deselect):
                return  # older build without the call — silent no-op
            try:
                deselect()
            except _LOM_ERRORS as e:
                self._emit_error(
                    V3_CLIP_NOTES_SELECT_ADDRESS, V3_ERROR_WRITE_REJECTED,
                    path=clip_path,
                    detail="deselect_all_notes raised: %s: %s" % (
                        type(e).__name__, str(e)[:80],
                    ),
                )
            return

        selector = getattr(clip, "select_notes_by_id", None)
        if not callable(selector):
            self._emit_error(
                V3_CLIP_NOTES_SELECT_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="select_notes_by_id unavailable",
            )
            return
        try:
            selector(ids)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_NOTES_SELECT_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="select_notes_by_id raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        logger.info(
            "ClipNotesComponent: selected %d notes on %s", len(ids), clip_path,
        )

    def handle_notes_modify(self, args, source_addr) -> None:
        """``[clip_path, mods_blob, gen?]`` — edit notes in place by id.

        Read-mutate-writeback (verified — probe P2): read only the touched
        notes via ``get_notes_by_id`` (falling back to the full read on
        older builds), mutate the read-back ``MidiNote`` objects' fields,
        then ``apply_note_modifications(vec)`` — the SAME vector, passed
        positionally. NOT ``MidiNoteSpecification`` (it can't carry a
        note_id) and NOT ``{"notes":[...]}``.
        """
        if self._disconnected:
            return
        clip, clip_path = self._resolve_write_clip(
            args, V3_CLIP_NOTES_MODIFY_ADDRESS,
        )
        if clip is None:
            return
        mods = _unpack_rich_blob(args[1] if len(args) > 1 else None)
        if mods is None:
            self._emit_error(
                V3_CLIP_NOTES_MODIFY_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="mods_blob unparseable",
            )
            return
        if not mods:
            return
        mods_by_id = {m["note_id"]: m for m in mods}
        try:
            self._apply_modifications(clip, mods_by_id)
        except _LOM_ERRORS as e:
            # Covers both the read (get_notes_by_id / get_all_notes_extended
            # fallback) and the write (apply_note_modifications) — the
            # message stays accurate whichever LOM call in the
            # read-mutate-writeback raised.
            self._emit_error(
                V3_CLIP_NOTES_MODIFY_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="modify raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        logger.info(
            "ClipNotesComponent: modified %d notes on %s",
            len(mods_by_id), clip_path,
        )

    def handle_notes_add(self, args, source_addr) -> None:
        """``[request_id, clip_path, notes_blob, gen?]`` — add new notes.

        Builds an id-less ``MidiNoteSpecification`` per note (the
        constructor REJECTS note_id — Live assigns it) and calls
        ``clip.add_new_notes(tuple(specs))``, which returns an
        ``IntU64Vector`` of the new ids (verified — probe P3). Replies
        ``notes/added [request_id, clip_path, new_ids:int[]]`` so the UI
        can swap its temp negative ids for the real ones.
        """
        if self._disconnected:
            return
        if len(args) < 3:
            self._emit_error(
                V3_CLIP_NOTES_ADD_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path="", detail="arg-count: expected ≥3, got %d" % len(args),
            )
            return
        request_id = _coerce_str(args[0])
        clip_path = _coerce_str(args[1])
        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            self._emit_error(
                V3_CLIP_NOTES_ADD_ADDRESS,
                _CLIP_RESOLVE_ERROR_MAP.get(
                    result.status, V3_ERROR_WRITE_REJECTED,
                ),
                path=clip_path, detail=result.detail or "",
            )
            return
        clip = result.obj
        if not self._is_midi_clip_safe(clip):
            self._emit_error(
                V3_CLIP_NOTES_ADD_ADDRESS, V3_ERROR_NOT_MIDI_CLIP,
                path=clip_path, detail="clip is not a MIDI clip",
            )
            return
        specs_src = _unpack_rich_blob(args[2])
        if specs_src is None:
            self._emit_error(
                V3_CLIP_NOTES_ADD_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="notes_blob unparseable",
            )
            return
        if not specs_src:
            self._safe_emit(
                V3_CLIP_NOTES_ADDED_ADDRESS,
                (request_id, clip_path, _pack_id_blob([])),
            )
            return
        spec_cls = self._spec_factory_for_tests() if _MIDI_NOTE_SPEC is None \
            else _MIDI_NOTE_SPEC
        try:
            specs = [self._build_spec(spec_cls, n) for n in specs_src]
            ret = clip.add_new_notes(tuple(specs))
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_NOTES_ADD_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="add_new_notes raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        new_ids = _extract_added_ids(ret)
        self._safe_emit(
            V3_CLIP_NOTES_ADDED_ADDRESS,
            (request_id, clip_path, _pack_id_blob(new_ids)),
        )
        logger.info(
            "ClipNotesComponent: added %d notes on %s (ids=%s)",
            len(specs_src), clip_path, new_ids[:4],
        )

    def handle_notes_duplicate(self, args, source_addr) -> None:
        """``[request_id, clip_path, note_ids:blob]`` — duplicate by id.

        M5. Maps to ``clip.duplicate_notes_by_id(ids)`` (verified present
        on Live 12.4 — SelectionProbe). Live places the copies and returns
        the new ids; we reply on the shared ``notes/added`` address so the
        UI selects the copies. The focused-clip listener fans the content
        change out to other clients.
        """
        if self._disconnected:
            return
        if len(args) < 3:
            self._emit_error(
                V3_CLIP_NOTES_DUPLICATE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path="", detail="arg-count: expected ≥3, got %d" % len(args),
            )
            return
        request_id = _coerce_str(args[0])
        clip_path = _coerce_str(args[1])
        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            self._emit_error(
                V3_CLIP_NOTES_DUPLICATE_ADDRESS,
                _CLIP_RESOLVE_ERROR_MAP.get(
                    result.status, V3_ERROR_WRITE_REJECTED,
                ),
                path=clip_path, detail=result.detail or "",
            )
            return
        clip = result.obj
        if not self._is_midi_clip_safe(clip):
            self._emit_error(
                V3_CLIP_NOTES_DUPLICATE_ADDRESS, V3_ERROR_NOT_MIDI_CLIP,
                path=clip_path, detail="clip is not a MIDI clip",
            )
            return
        ids = _parse_id_list(args[2])
        if ids is None:
            self._emit_error(
                V3_CLIP_NOTES_DUPLICATE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="note_ids not an int list",
            )
            return
        if not ids:
            self._safe_emit(
                V3_CLIP_NOTES_ADDED_ADDRESS,
                (request_id, clip_path, _pack_id_blob([])),
            )
            return
        dup = getattr(clip, "duplicate_notes_by_id", None)
        if not callable(dup):
            self._emit_error(
                V3_CLIP_NOTES_DUPLICATE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path, detail="duplicate_notes_by_id unavailable",
            )
            return
        try:
            ret = dup(ids)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_CLIP_NOTES_DUPLICATE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=clip_path,
                detail="duplicate_notes_by_id raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        new_ids = _extract_added_ids(ret)
        self._safe_emit(
            V3_CLIP_NOTES_ADDED_ADDRESS,
            (request_id, clip_path, _pack_id_blob(new_ids)),
        )
        logger.info(
            "ClipNotesComponent: duplicated %d notes on %s (ids=%s)",
            len(ids), clip_path, new_ids[:4],
        )

    def _apply_modifications(self, clip, mods_by_id: dict) -> None:
        """Read touched notes, mutate fields in place, write back.

        Prefers ``get_notes_by_id`` (only re-reads the edited notes); on
        older builds / stubs lacking it, falls back to the full read.
        Mutates the read-back ``MidiNote`` objects directly (pitch / start
        / duration / velocity / mute are all writable — verified) and
        passes the SAME vector to ``apply_note_modifications``.
        """
        vec = None
        ids = list(mods_by_id.keys())
        get_by_id = getattr(clip, "get_notes_by_id", None)
        if callable(get_by_id):
            try:
                vec = get_by_id(ids)
            except _LOM_ERRORS:
                vec = None
        if vec is None:
            vec = clip.get_all_notes_extended()

        for note in vec:
            nid = getattr(note, "note_id", None)
            if nid is None and isinstance(note, dict):
                nid = note.get("note_id")
            mod = mods_by_id.get(int(nid)) if nid is not None else None
            if mod is None:
                continue
            _mutate_note_in_place(note, mod)
        clip.apply_note_modifications(vec)

    # --- focused-clip notes listener (M3 decision 5) ----------------------

    def _resolve_write_clip(self, args, address):
        """Resolve ``args[0]`` → (clip, path) for a note-edit write.

        Emits a typed error and returns ``(None, path)`` on any failure
        (arg-count, resolve failure, non-MIDI clip).
        """
        if not args:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path="", detail="empty args",
            )
            return None, ""
        clip_path = _coerce_str(args[0])
        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is not ResolveStatus.OK:
            self._emit_error(
                address,
                _CLIP_RESOLVE_ERROR_MAP.get(
                    result.status, V3_ERROR_WRITE_REJECTED,
                ),
                path=clip_path, detail=result.detail or "",
            )
            return None, clip_path
        clip = result.obj
        if not self._is_midi_clip_safe(clip):
            self._emit_error(
                address, V3_ERROR_NOT_MIDI_CLIP,
                path=clip_path, detail="clip is not a MIDI clip",
            )
            return None, clip_path
        return clip, clip_path


    def _on_detail_clip_changed(self) -> None:
        if self._disconnected:
            return
        self._refocus()

    def _refocus(self) -> None:
        """Move the notes listener to the newly-focused clip."""
        new_clip = self._read_detail_clip()
        new_path: Optional[str] = None
        if new_clip is not None:
            new_path = focus_path(self._song, new_clip, self._warn_once)

        self._detach_notes_listener()
        self._focused_clip = new_clip if new_path is not None else None
        self._focused_path = new_path
        if self._focused_clip is not None:
            self._attach_notes_listener(self._focused_clip)

    def _read_detail_clip(self):
        """``song.view.detail_clip``, or ``None`` on any LOM quirk."""
        return self._detail.read()

    def _attach_notes_listener(self, clip) -> None:
        add = getattr(clip, "add_notes_listener", None)
        if not callable(add):
            self._warn_once(
                "notes", "attach-missing",
                AttributeError("no add_notes_listener on clip"),
            )
            return

        def _fire() -> None:
            if self._disconnected:
                return
            # Echo caveat (plan decision 4): this fires on our OWN writes
            # too. We can't tell them apart here — the wire poke is
            # origin-blind — so the initiating UI client suppresses its
            # own re-pull for a short window after a local write. We just
            # broadcast the poke; cross-client sync is the point.
            self._emit_notes_changed(self._focused_path)

        try:
            add(_fire)
        except _LOM_ERRORS as e:
            self._warn_once("notes", "attach", e)
            return
        self._notes_listener = _fire
        self._notes_listener_attached = True

    def _detach_notes_listener(self) -> None:
        clip = self._focused_clip
        cb = self._notes_listener
        self._notes_listener = None
        self._notes_listener_attached = False
        if clip is None or cb is None:
            return
        remove = getattr(clip, "remove_notes_listener", None)
        if not callable(remove):
            return
        try:
            remove(cb)
        except _LOM_ERRORS as e:
            self._warn_once("notes", "detach", e)

    def _emit_notes_changed(self, clip_path: Optional[str]) -> None:
        """Emit ``/looping/v3/clip/notes/changed ["", clip_path]``.

        Track-path slot is empty for the focused-clip poke (the UI keys
        the re-pull on ``clip_path``). Shares the address with
        PlayheadComponent's playing-clip poke — the UI's subscriber set
        is keyed by clip_path, so both pokes fan out to the same
        re-pull machinery.
        """
        if clip_path is None:
            return
        self._safe_emit(V3_CLIP_NOTES_CHANGED_ADDRESS, ("", clip_path))

    # --- internal helpers -------------------------------------------------

    def _resolve_clip_or_error(self, clip_path: str) -> Optional[object]:
        """Resolve ``clip_path`` and emit a typed error on failure.

        Returns the clip object on OK, ``None`` otherwise.
        """
        result = path_resolver.resolve_clip(self._song, clip_path)
        if result.status is ResolveStatus.OK:
            return result.obj
        code = _CLIP_RESOLVE_ERROR_MAP.get(
            result.status,
            V3_ERROR_WRITE_REJECTED,
        )
        self._emit_error(
            V3_CLIP_TRANSPOSE_ADDRESS,
            code,
            path=clip_path,
            detail=result.detail or "",
        )
        return None

    def _is_midi_clip_safe(self, clip) -> bool:
        """Read ``clip.is_midi_clip`` guarded by ``_LOM_ERRORS``.

        A torn-down clip handle raises on attribute access — treat
        that as "not MIDI" so the caller surfaces ``not-midi-clip``
        rather than crashing. False is the safe default; an audio
        clip would have rejected anyway.
        """
        try:
            return bool(clip.is_midi_clip)
        except _LOM_ERRORS:
            return False

    def _read_notes_extended(self, clip):
        """``clip``'s notes (:meth:`_try_read_notes_extended`): the raw
        container (live ``MidiNoteVector`` or a stub's list/dict), or
        ``_READ_RAISED`` if the LOM raised."""
        raw, e = self._try_read_notes_extended(clip)
        return _READ_RAISED if e is not None else raw

    def _try_read_notes_extended(self, clip):
        """Read every note: ``(raw, None)``, or ``(None, exc)`` when the LOM
        raised. ``_common.read_all_notes``: the bare call, the one form
        Live accepts (measured on the rig, 2026-11-25)."""
        return read_all_notes(clip)

    def _replace_clip_notes(self, clip, notes: List[dict]) -> None:
        """Atomically replace every note in ``clip`` with ``notes``.

        A clear-and-rewrite over the full pitch/time span — the same
        approach AbletonOSC uses for ``/live/clip/add/notes``. Any note
        whose ``add_new_notes`` kwargs Live rejects propagates as a
        ``_LOM_ERRORS`` raise, which the handler turns into a
        ``write-rejected`` error.

        This docstring used to justify the approach with "Live's
        ``MidiNote`` is read-only, and ``apply_note_modifications``
        operates on existing notes by id (no pitch field accepted)".
        **That premise is false** and the module docstring 1,600 lines
        above records it as disproved — read-back ``MidiNote`` objects
        are writable in place and ``apply_note_modifications`` commits
        those mutations keyed by ``note_id``, pitch included (verified
        on Live 12.4, probe P2; ``handle_transpose`` says the same).
        The clear-and-rewrite is still the right shape HERE, because
        this path replaces the whole note set rather than editing
        identified notes — it just is not the only thing Live allows.
        """
        # Live calls accept floats; using -8192..16384 covers Live's
        # signed bar/beat range like AbletonOSC's defaults.
        clip.remove_notes_extended(0, 128, -8192, 16384)
        if _MIDI_NOTE_SPEC is None:  # test stubs swap out the spec class
            spec_cls = self._spec_factory_for_tests()
        else:
            spec_cls = _MIDI_NOTE_SPEC
        specs = [self._build_spec(spec_cls, n) for n in notes]
        clip.add_new_notes(tuple(specs))

    @staticmethod
    def _build_spec(spec_cls, note: dict):
        """Construct a ``MidiNoteSpecification`` from a normalised note.

        Only forwards kwargs Live's constructor accepts. Probability /
        velocity_deviation / release_velocity were added in Live 11/12
        — passing them on older builds would TypeError, so we drop
        anything ``spec_cls`` rejects on the first attempt and retry
        with the legacy kwargs only.
        """
        kwargs = {
            "pitch": note["pitch"],
            "start_time": note.get("start_time", _DEFAULTS["start_time"]),
            "duration": note.get("duration", _DEFAULTS["duration"]),
            "velocity": note.get("velocity", _DEFAULTS["velocity"]),
            "mute": note.get("mute", _DEFAULTS["mute"]),
        }
        for opt in ("probability", "velocity_deviation", "release_velocity"):
            if opt in note:
                kwargs[opt] = note[opt]
        try:
            return spec_cls(**kwargs)
        except TypeError:
            for opt in ("probability", "velocity_deviation", "release_velocity"):
                kwargs.pop(opt, None)
            return spec_cls(**kwargs)

    @staticmethod
    def _spec_factory_for_tests():
        """Fallback spec-builder when ``Live`` isn't importable.

        Tests inject a stub clip; this records constructor kwargs as
        a plain dict so assertions can read them back. Never reached
        under live Live since ``_MIDI_NOTE_SPEC`` is set at import.
        """
        return dict

    def _emit_error(
        self,
        originating_address: str,
        code: str,
        path: str,
        detail: str,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, path, detail]``."""
        if self._disconnected:
            return
        emit_error("ClipNotesComponent", self._emit, originating_address, code, path, detail)

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        safe_emit("ClipNotesComponent", self._emit, address, payload)

    def _record_lru(
        self, request_id: str, address: str, payload: tuple,
    ) -> None:
        """Cache a successful reply for retransmit idempotency."""
        self._evict_expired()
        self._request_lru[request_id] = (
            address, payload, time.monotonic(),
        )
        # Bound size — drop oldest.
        while len(self._request_lru) > _REQUEST_LRU_MAX:
            self._request_lru.popitem(last=False)

    def _record_and_emit_error(
        self, request_id: str, code: str, path: str, detail: str,
    ) -> None:
        """Cache an error reply alongside emission so a retransmit
        replays the same error rather than re-running the LOM read.

        We cache by emitting the standard ``/looping/v3/error`` shape,
        but stamp it with the request_id key so the LRU lookup hits.
        """
        payload = (V3_CLIP_NOTES_GET_ADDRESS, code, path, detail)
        self._evict_expired()
        self._request_lru[request_id] = (
            V3_ERROR_ADDRESS, payload, time.monotonic(),
        )
        while len(self._request_lru) > _REQUEST_LRU_MAX:
            self._request_lru.popitem(last=False)
        # Plain emit path (not _safe_emit) so we get the standard
        # WARNING log line on the dropped error.
        self._emit_error(
            V3_CLIP_NOTES_GET_ADDRESS, code, path=path, detail=detail,
        )

    def _lookup_lru(
        self, request_id: str,
    ) -> Optional[Tuple[str, tuple]]:
        """Return ``(address, payload)`` if a fresh reply is cached."""
        self._evict_expired()
        rec = self._request_lru.get(request_id)
        if rec is None:
            return None
        # Mark recent (LRU semantics).
        self._request_lru.move_to_end(request_id)
        address, payload, _ts = rec
        return (address, payload)

    def _evict_expired(self) -> None:
        cutoff = time.monotonic() - _REQUEST_LRU_TTL_SEC
        expired = [
            k for k, (_a, _p, ts) in self._request_lru.items()
            if ts < cutoff
        ]
        for k in expired:
            self._request_lru.pop(k, None)

    def _record_rich_lru(
        self, request_id: str, emits: List[Tuple[str, tuple]],
    ) -> None:
        """Cache a rich begin→chunk→end emit sequence for retransmit."""
        self._evict_rich_expired()
        self._rich_lru[request_id] = (list(emits), time.monotonic())
        while len(self._rich_lru) > _REQUEST_LRU_MAX:
            self._rich_lru.popitem(last=False)

    def _lookup_rich_lru(
        self, request_id: str,
    ) -> Optional[List[Tuple[str, tuple]]]:
        """Return the cached emit list for ``request_id``, or ``None``."""
        self._evict_rich_expired()
        rec = self._rich_lru.get(request_id)
        if rec is None:
            return None
        self._rich_lru.move_to_end(request_id)
        emits, _ts = rec
        return emits

    def _evict_rich_expired(self) -> None:
        cutoff = time.monotonic() - _REQUEST_LRU_TTL_SEC
        expired = [
            k for k, (_e, ts) in self._rich_lru.items() if ts < cutoff
        ]
        for k in expired:
            self._rich_lru.pop(k, None)

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        if first_time(self._warned, (key, context)):
            logger.warning(
                "ClipNotesComponent %s (%s): %s (suppressing further warnings)",
                key, context, exc,
            )

    # --- lifecycle --------------------------------------------------------

    def emit_on_accept(self) -> None:
        """Re-poke the focused clip after a handshake accept.

        A connecting UI pulls the rich channel itself on focus, but if a
        clip is already focused at connect time the UI has no focus-change
        event to trigger the pull — so nudge it with a ``notes/changed``
        for the focused clip. Symmetric with ClipPropertiesComponent's
        accept re-emit; wired into ``_emit_on_accept_chain``.
        """
        if self._disconnected:
            return
        if self._focused_path is not None:
            self._emit_notes_changed(self._focused_path)

    def disconnect(self) -> None:
        """Idempotent teardown. Subsequent handler calls short-circuit."""
        if self._disconnected:
            return
        self._disconnected = True

        # Focused-clip notes listener + the song.view detail_clip listener.
        self._detach_notes_listener()
        self._detail.detach()
