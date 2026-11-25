"""ClipNotesComponent's codec: how a clip's notes are read off the LOM's
shapes and packed for the wire, and how a write's blob is unpacked.

No LOM handle and no component state: plain functions over note values,
so the blob layouts the UI decodes (``clipNotesService`` /
``clipRichNotesService``) are tested on their own. Moved out of
``ClipNotesComponent`` (code review, 2026-11-25); every name is still
importable from there. Import relatively
(``from .clip_notes_codec import …``).
"""

from __future__ import annotations

import json
import struct
from typing import Iterable, List, Optional, Tuple

# Live MIDI pitch range. Pitches transposed outside this range are
# clamped, not rejected — matches the M4L behaviour and the UI's
# expectation that "transpose down" never errors.
_MIDI_PITCH_MIN = 0
_MIDI_PITCH_MAX = 127


# Per-note layout for the notes/get blob. The cross-language stride is
# in *bytes* (UI's `NOTE_FLOAT_STRIDE = 16`); Python tracks both unit
# counts so the constants and the pack format stay in lockstep — and
# nobody ports the wrong unit between layers.
#
# The velocity's SIGN carries the note's mute (ADR-444): a muted note is
# packed as ``-velocity``. That keeps the stride at 16 B and the 512 cap
# where the UDP math put it — a fifth float would have cost a hundred
# notes of cap for one bit. Velocity 0 muted packs as ``-0.0``, which
# float32 preserves and the UI reads with ``Object.is(v, -0)``. Live
# itself never sees a negative velocity: ``MidiNote.mute`` is its own
# boolean, this is only how the bit rides our blob.
_FLOATS_PER_NOTE = 4
_BYTES_PER_NOTE = _FLOATS_PER_NOTE * 4  # 16 — matches TS NOTE_FLOAT_STRIDE
_NOTE_PACK_FMT = "<" + "f" * _FLOATS_PER_NOTE  # "<ffff" (little-endian)


# --- M3 rich-channel layout (identity-carrying) --------------------------
#
# Per-note struct ``<i f f f f i>`` = (note_id:int32, pitch:f32,
# start_beats:f32, dur_beats:f32, velocity:f32, mute:int32) = 24 bytes.
# note_id is an explicit int32 so it never round-trips through float32's
# 24-bit mantissa (plan decision 2). Mirrors the TS
# ``RICH_NOTE_STRIDE`` / ``decodeRichNotesBlob`` in clipRichNotesService.
_RICH_NOTE_PACK_FMT = "<iffffi"  # little-endian, 24 bytes
_RICH_BYTES_PER_NOTE = struct.calcsize(_RICH_NOTE_PACK_FMT)  # 24

# Chunk budget for the rich channel: keep each datagram comfortably under
# the 9216 B darwin UDP MTU. 24 B/note × cap means a single packet can't
# hold a dense clip, so chunk on whole-note boundaries (never split a
# note struct across chunks). Mirrors V3StateFullComponent's 4 KB budget
# leaving headroom for the address + request_id + chunk_index envelope.
_RICH_CHUNK_BUDGET_BYTES = 4 * 1024
_RICH_NOTES_PER_CHUNK = max(1, _RICH_CHUNK_BUDGET_BYTES // _RICH_BYTES_PER_NOTE)

# Hard ceiling on the rich channel (chunking allows more than the cheap
# blob's 512, but a dense clip past this rejects rather than flooding the
# wire). Open-questions item from the plan; 4096 is the plan's ceiling.
_RICH_NOTES_HARD_CEILING = 4096

# FNV-1a 32-bit constants for the rich-channel blob checksum. Computed
# over the concatenated chunk bytes; the UI recomputes byte-for-byte
# (clipRichNotesService.computeRichBlobChecksum) and re-requests on
# mismatch. Same constants as V3StateFullComponent.
_FNV_OFFSET_BASIS = 0x811C9DC5
_FNV_PRIME = 0x01000193
_UINT32_MASK = 0xFFFFFFFF
_INT31_MASK = 0x7FFFFFFF


# Per-note properties we copy through into the rebuilt
# ``MidiNoteSpecification``. Pitch is set explicitly (the whole point
# of transposition); the rest are forwarded verbatim if the source
# exposes them. Anything missing falls back to a Live default — see
# ``_DEFAULTS`` below — which matches the behaviour of new notes
# created by add_new_notes when those kwargs are omitted.
_FORWARDED_NOTE_ATTRS: Tuple[str, ...] = (
    "start_time",
    "duration",
    "velocity",
    "mute",
    "probability",
    "velocity_deviation",
    "release_velocity",
)

_DEFAULTS = {
    "start_time": 0.0,
    "duration": 0.25,
    "velocity": 100.0,
    "mute": False,
}

# Sentinel returned by ``_read_notes_extended`` when the LOM read raised
# (vs. an empty-but-valid read which returns an empty container). ``None``
# is a legitimate "no notes" shape from some stubs, so we need a distinct
# marker for the error path.
_READ_RAISED = object()


def _coerce_note_to_dict(note) -> Optional[dict]:
    """Pull the writable subset of a note source into a plain dict.

    Accepts:
      * ``MidiNote``-like (attribute access; what live Python returns)
      * ``dict`` (what test stubs and JSON payloads use)

    Returns ``None`` if no usable pitch is present — the caller drops
    such entries rather than failing the whole transpose.
    """
    if isinstance(note, dict):
        getter = note.get
    else:
        def getter(name, default=None):
            return getattr(note, name, default)
    raw_pitch = getter("pitch")
    if raw_pitch is None:
        return None
    try:
        pitch = int(raw_pitch)
    except (TypeError, ValueError):
        return None
    out = {"pitch": pitch}
    for attr in _FORWARDED_NOTE_ATTRS:
        val = getter(attr, None)
        if val is not None:
            out[attr] = val
    return out


def _normalize_notes_iterable(raw) -> Optional[List[dict]]:
    """Return a list of normalised note dicts, or ``None`` on failure.

    Live's bundled Python returns ``Clip.MidiNoteVector`` — an
    iterable of ``MidiNote`` objects. Test stubs may hand back a
    JSON string, a ``{"notes": [...]}`` dict, or a bare list of
    dicts. All four shapes funnel through ``_coerce_note_to_dict``.
    """
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return None
    if isinstance(raw, dict):
        raw = raw.get("notes")
        if not isinstance(raw, list):
            return None
    try:
        items: Iterable = iter(raw)
    except TypeError:
        return None
    out: List[dict] = []
    for note in items:
        normalised = _coerce_note_to_dict(note)
        if normalised is not None:
            out.append(normalised)
    return out


def _pack_notes_blob(notes: List[dict]) -> bytes:
    """Pack a normalised note list into a flat little-endian float32 blob.

    Layout: ``[pitch, start_beats, duration_beats, velocity] × n``.
    Velocity is the raw 0..127 LOM value (UI normalises if it wants),
    negated when the note is muted — the sign is the mute bit (ADR-444),
    so the strip can ghost a silent note without a fifth float.
    Probability / deviation / etc. are deliberately omitted — the
    strip-render consumer only paints pitch lanes; carrying every field
    would triple the blob with values nothing reads.
    """
    if not notes:
        return b""
    # ``struct.pack`` per-field is faster than building one format
    # string for very large note lists; the per-field stride keeps the
    # math obvious. ``_NOTE_PACK_FMT`` is the single source of truth
    # for the layout — keep it in lockstep with TS's `DataView` reads
    # in `clipNotesService.decodeNotesBlob`.
    parts: List[bytes] = []
    for note in notes:
        pitch = float(note.get("pitch", 0))
        start = float(note.get("start_time", 0.0))
        duration = float(note.get("duration", 0.0))
        velocity = float(note.get("velocity", 100.0))
        if note.get("mute"):
            velocity = -abs(velocity)
        parts.append(struct.pack(_NOTE_PACK_FMT, pitch, start, duration, velocity))
    return b"".join(parts)


def _read_rich_notes(raw) -> Optional[List[dict]]:
    """Coerce a ``get_all_notes_extended`` return into rich note dicts.

    Unlike ``_normalize_notes_iterable`` (which drops ``note_id`` for the
    identity-blind cheap blob), this preserves ``note_id`` — the whole
    point of the rich channel. Accepts the live ``MidiNoteVector`` plus
    the dict / JSON shapes the test stubs hand back. Returns ``None`` if
    the payload is unparseable; drops individual notes with no usable
    ``note_id`` rather than failing the whole read.
    """
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return None
    if isinstance(raw, dict):
        raw = raw.get("notes")
        if not isinstance(raw, list):
            return None
    try:
        items: Iterable = iter(raw)
    except TypeError:
        return None
    out: List[dict] = []
    for note in items:
        coerced = _coerce_rich_note(note)
        if coerced is not None:
            out.append(coerced)
    return out


def _coerce_rich_note(note) -> Optional[dict]:
    """Pull (note_id, pitch, start, duration, velocity, mute) off a note.

    Returns ``None`` when there's no usable ``note_id`` — a note with no
    identity can't be referenced for editing, so it has no place on the
    rich channel.
    """
    if isinstance(note, dict):
        getter = note.get
    else:
        def getter(name, default=None):
            return getattr(note, name, default)
    raw_id = getter("note_id")
    if raw_id is None:
        return None
    try:
        note_id = int(raw_id)
    except (TypeError, ValueError):
        return None
    raw_pitch = getter("pitch")
    if raw_pitch is None:
        return None
    try:
        pitch = float(raw_pitch)
    except (TypeError, ValueError):
        return None
    return {
        "note_id": note_id,
        "pitch": pitch,
        "start_time": float(getter("start_time", 0.0) or 0.0),
        "duration": float(getter("duration", 0.0) or 0.0),
        "velocity": float(getter("velocity", 100.0) or 100.0),
        "mute": 1 if getter("mute", False) else 0,
    }


def _pack_rich_note(note: dict) -> bytes:
    """Pack one rich note dict into the ``<iffffi>`` 24-byte struct."""
    return struct.pack(
        _RICH_NOTE_PACK_FMT,
        int(note["note_id"]),
        float(note["pitch"]),
        float(note.get("start_time", 0.0)),
        float(note.get("duration", 0.0)),
        float(note.get("velocity", 100.0)),
        1 if note.get("mute") else 0,
    )


def _rich_blob_checksum(blob: bytes) -> int:
    """FNV-1a over the rich blob bytes. Mirrors the TS side byte-for-byte.

    The checksum runs over the concatenated chunk bytes (the same bytes
    the UI reassembles), so any dropped / reordered chunk is caught at
    the ``end`` step and re-requested. Masked to int31 so it fits an OSC
    int positive range; emitted as ``0x%08x`` like state/full.

    This runs on Live's main thread, once per clip-editor open. Two
    things were removed from the loop and neither changes a single
    output byte:

    * ``byte & 0xFF`` — iterating ``bytes`` in Python 3 already yields
      ints in [0, 255].
    * the ``& _UINT32_MASK`` after the XOR — the loop invariant from the
      multiply is ``h <= 0xFFFFFFFF``, and ``x ^ y`` cannot exceed
      ``max(x, y)``'s bit width when ``y <= 0xFF``, so the XOR can never
      widen ``h`` past 32 bits. ``_FNV_OFFSET_BASIS`` satisfies the
      invariant on entry.

    The two globals are bound as locals for the same reason — a global
    lookup per iteration, twice, over up to 98,304 bytes.

    Measured on this machine at the 4096-note ceiling (98,304 bytes):
    **10.30 ms -> 7.04 ms**, byte-identical output over 201 blobs.
    Do NOT reach for a faster variant that changes the byte order or
    the intermediate width: ``clipRichNotesService.computeRichBlobChecksum``
    mirrors this exactly, and the wire format is the contract.
    """
    h = _FNV_OFFSET_BASIS
    prime = _FNV_PRIME
    mask = _UINT32_MASK
    for byte in blob:
        h = (h ^ byte) * prime & mask
    return h & _INT31_MASK


def _to_blob_bytes(arg) -> Optional[bytes]:
    """Coerce an OSC blob arg to ``bytes``.

    The bridge may hand the blob through as ``bytes``/``bytearray``
    (live), a ``memoryview``, or — in test fixtures — a list of ints.
    """
    if arg is None:
        return None
    if isinstance(arg, (bytes, bytearray)):
        return bytes(arg)
    if isinstance(arg, memoryview):
        return arg.tobytes()
    if isinstance(arg, list):
        try:
            return bytes(arg)
        except (TypeError, ValueError):
            return None
    return None


def _unpack_rich_blob(arg) -> Optional[List[dict]]:
    """Unpack a ``<iffffi>``-packed blob into rich note dicts.

    Returns ``None`` if the blob can't be coerced or its length isn't a
    whole multiple of the 24-byte stride. Each dict carries note_id +
    the editable fields, ready for modify/add.
    """
    blob = _to_blob_bytes(arg)
    if blob is None:
        return None
    if len(blob) % _RICH_BYTES_PER_NOTE != 0:
        return None
    out: List[dict] = []
    for off in range(0, len(blob), _RICH_BYTES_PER_NOTE):
        note_id, pitch, start, dur, vel, mute = struct.unpack_from(
            _RICH_NOTE_PACK_FMT, blob, off,
        )
        out.append({
            "note_id": int(note_id),
            "pitch": int(round(pitch)),
            "start_time": float(start),
            "duration": float(dur),
            "velocity": float(vel),
            "mute": bool(mute),
        })
    return out


def _parse_id_list(arg) -> Optional[List[int]]:
    """Parse an OSC int-array arg into a list of ints. ``None`` on failure.

    Accepts a list/tuple of ints (the typical osc.js shape) or a packed
    int32 blob (defensive — some encoders pack int arrays as blobs).
    """
    if arg is None:
        return []
    if isinstance(arg, (list, tuple)):
        out: List[int] = []
        for x in arg:
            if isinstance(x, bool):
                return None
            try:
                out.append(int(x))
            except (TypeError, ValueError):
                return None
        return out
    blob = _to_blob_bytes(arg)
    if blob is not None and len(blob) % 4 == 0:
        return [
            struct.unpack_from("<i", blob, off)[0]
            for off in range(0, len(blob), 4)
        ]
    return None


def _mutate_note_in_place(note, mod: dict) -> None:
    """Set the editable fields of a read-back ``MidiNote`` from ``mod``.

    Works on both the live writable ``MidiNote`` and the test stub. Pitch
    is clamped to Live's MIDI range; the rest pass through.
    """
    pitch = mod["pitch"]
    if pitch < _MIDI_PITCH_MIN:
        pitch = _MIDI_PITCH_MIN
    elif pitch > _MIDI_PITCH_MAX:
        pitch = _MIDI_PITCH_MAX
    note.pitch = pitch
    note.start_time = float(mod["start_time"])
    note.duration = float(mod["duration"])
    note.velocity = float(mod["velocity"])
    note.mute = bool(mod["mute"])


def _pack_id_blob(ids: List[int]) -> bytes:
    """Pack note ids as a little-endian int32 blob for the wire.

    OSC has no array type and the codec rejects Python lists, so id
    arrays travel as a blob (symmetric with ``_parse_id_list``'s blob
    branch on the read side and ``toUint8Array`` on the UI). Empty list
    → empty blob.
    """
    if not ids:
        return b""
    return b"".join(struct.pack("<i", int(i)) for i in ids)


def _extract_added_ids(ret) -> List[int]:
    """Read the new note ids off ``add_new_notes``'s return.

    Live 12.4 returns an ``IntU64Vector`` of the new ids (verified —
    probe P3). Older builds returned ``None``; in that case we have no
    ids to hand back (the UI falls back to a re-pull on notes/changed).
    Also accepts a ``MidiNoteVector`` (some builds) by reading
    ``note_id`` off each element.
    """
    if ret is None:
        return []
    out: List[int] = []
    try:
        for item in ret:
            if isinstance(item, (int,)) and not isinstance(item, bool):
                out.append(int(item))
            else:
                nid = getattr(item, "note_id", None)
                if nid is not None:
                    out.append(int(nid))
    except TypeError:
        return []
    return out
