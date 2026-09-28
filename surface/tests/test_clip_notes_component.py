"""ClipNotesComponent tests — Phase 8 PR-8b.

Covers the single ``/looping/v3/clip/transpose`` handler:

- Round-trip preserves note count + non-pitch properties (velocity,
  duration, start, mute).
- Pitches shift by the requested number of semitones.
- MIDI clamp at 0 (transpose down) and 127 (transpose up).
- Non-MIDI clip → ``not-midi-clip``.
- Missing / empty / occupied-by-not-clip slot → typed resolver code.
- Malformed args (no path, non-int semitones, bool semitones) →
  ``write-rejected``.
- All three ``get_all_notes_extended`` return shapes (MidiNote vector,
  JSON string, parsed dict) parsed.
- ``add_new_notes`` LOM raise → ``write-rejected``.
- Post-disconnect handler is a no-op.

Write-path note: live Python returns a ``Clip.MidiNoteVector`` and
``MidiNote.pitch`` is read-only, so the component clears the clip
via ``remove_notes_extended`` and rewrites with
``add_new_notes(tuple(MidiNoteSpecification))``. Under tests Live
isn't importable, so the spec class falls back to ``dict`` — each
spec recorded by ``StubClip`` is a plain dict with the same keys
the previous ``apply_note_modifications`` payload used.
"""

from __future__ import annotations

import copy
import json
from typing import List, Tuple

import pytest

from components.ClipNotesComponent import (
    ClipNotesComponent,
    V3_CLIP_NOTES_GET_ADDRESS,
    V3_CLIP_NOTES_REPLY_ADDRESS,
    V3_CLIP_TRANSPOSE_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_CLIP_NOT_FOUND,
    V3_ERROR_CLIP_NOT_MIDI,
    V3_ERROR_CLIP_NOT_PRESENT,
    V3_ERROR_NOT_MIDI_CLIP,
    V3_ERROR_SLOT_NOT_FOUND,
    V3_ERROR_TOO_MANY_NOTES,
    V3_ERROR_WRITE_REJECTED,
)


# --- stub song ------------------------------------------------------------


def _make_note(pitch: int, **overrides) -> dict:
    """Build a stub note dict with the LOM's standard fields. Overrides
    let individual tests inject mute / start / velocity edge values."""
    note = {
        "pitch": pitch,
        "start_time": 0.0,
        "duration": 0.25,
        "velocity": 100.0,
        "mute": False,
        "probability": 1.0,
        "velocity_deviation": 0.0,
        "release_velocity": 64.0,
        "note_id": 1,
    }
    note.update(overrides)
    return note


class StubMidiNote:
    """Mirror Live's ``Clip.MidiNote`` — attribute access for note
    fields. Only the fields the component reads are exposed; pitch
    is intentionally writable on the stub for setup convenience but
    the component never mutates it (it reads then constructs new
    specs)."""

    __slots__ = (
        "pitch", "start_time", "duration", "velocity", "mute",
        "probability", "velocity_deviation", "release_velocity", "note_id",
    )

    def __init__(self, **kw):
        for slot in self.__slots__:
            setattr(self, slot, kw.get(slot))


class StubClip:
    """Stub clip exposing the LOM surface the component touches:
    ``get_all_notes_extended``, ``remove_notes_extended``,
    ``add_new_notes``, plus ``is_midi_clip``.

    ``return_shape`` toggles what ``get_all_notes_extended`` returns:

    - ``"vector"`` (default) — iterable of ``StubMidiNote``, what
      live Python actually hands back.
    - ``"json"`` — JSON string under a ``notes`` key, the legacy
      LiveAPI bridge shape.
    - ``"dict"`` — the parsed dict directly.

    ``applied_payloads`` records each ``add_new_notes`` call as
    ``{"notes": [spec_dict, ...]}`` — under tests the spec class
    falls back to ``dict`` because Live isn't importable, so each
    spec is already a plain dict with the same keys the prior
    ``apply_note_modifications`` payload used. Existing assertions
    keep working unchanged.
    """

    def __init__(
        self,
        notes: list,
        is_midi_clip: bool = True,
        return_shape: str = "vector",
    ):
        self._notes = [copy.deepcopy(n) for n in notes]
        self.is_midi_clip = is_midi_clip
        self._return_shape = return_shape
        self.applied_payloads: List[dict] = []
        self.remove_calls: List[tuple] = []
        self._get_raises = None
        self._apply_raises = None

    def get_all_notes_extended(self):
        if self._get_raises is not None:
            raise self._get_raises
        if self._return_shape == "vector":
            return [StubMidiNote(**copy.deepcopy(n)) for n in self._notes]
        if self._return_shape == "json":
            return json.dumps({"notes": [copy.deepcopy(n) for n in self._notes]})
        if self._return_shape == "dict":
            return {"notes": [copy.deepcopy(n) for n in self._notes]}
        raise AssertionError("unknown return_shape: %r" % self._return_shape)

    def remove_notes_extended(self, pitch_start, pitch_span, time_start, time_span):
        self.remove_calls.append(
            (pitch_start, pitch_span, time_start, time_span),
        )

    def add_new_notes(self, specs):
        if self._apply_raises is not None:
            raise self._apply_raises
        notes = [copy.deepcopy(s) for s in specs]
        self.applied_payloads.append({"notes": notes})
        self._notes = notes


class StubClipSlot:
    def __init__(self, clip=None):
        self.has_clip = clip is not None
        self.clip = clip


class StubTrack:
    def __init__(self, slots):
        self.clip_slots = tuple(slots)


class StubMasterTrack:
    pass


class StubSong:
    def __init__(self, tracks):
        self.tracks = tuple(tracks)
        self.master_track = StubMasterTrack()
        self.return_tracks = ()


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


def _component_with(emits, *, clip):
    """Build a component whose track 0 / slot 0 holds ``clip`` (or is
    empty if ``clip`` is None)."""
    slot0 = StubClipSlot(clip)
    slot1 = StubClipSlot(None)
    track = StubTrack([slot0, slot1])
    song = StubSong([track])

    def emit(addr, args):
        emits.append((addr, args))

    return ClipNotesComponent(song=song, emit=emit), slot0


# --- happy path ----------------------------------------------------------


def test_transpose_up_shifts_every_pitch(emits):
    notes = [_make_note(60), _make_note(62), _make_note(64)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert emits == []  # no error, no echo
    assert len(clip.applied_payloads) == 1
    pitches = [n["pitch"] for n in clip.applied_payloads[0]["notes"]]
    assert pitches == [72, 74, 76]


def test_transpose_down_shifts_every_pitch(emits):
    notes = [_make_note(60), _make_note(64)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", -12), source_addr=None)

    pitches = [n["pitch"] for n in clip.applied_payloads[0]["notes"]]
    assert pitches == [48, 52]
    assert emits == []


def test_round_trip_preserves_non_pitch_properties(emits):
    """Velocity, duration, start, mute and other fields must survive
    the round-trip — the M4L handler did so via in-place mutation, and
    the component's payload is the same shape Live's
    ``apply_note_modifications`` accepts."""
    notes = [
        _make_note(60, velocity=42.5, duration=1.5, start_time=0.25, mute=True),
        _make_note(72, velocity=99.0, duration=0.125, probability=0.5),
    ]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 7), source_addr=None)

    applied = clip.applied_payloads[0]["notes"]
    assert len(applied) == 2
    assert applied[0]["pitch"] == 67
    assert applied[0]["velocity"] == 42.5
    assert applied[0]["duration"] == 1.5
    assert applied[0]["start_time"] == 0.25
    assert applied[0]["mute"] is True
    assert applied[1]["pitch"] == 79
    assert applied[1]["velocity"] == 99.0
    assert applied[1]["probability"] == 0.5


def test_dict_payload_branch(emits):
    """When the LOM hands back a parsed dict directly, the parser
    still works — the JSON-decode step is skipped."""
    notes = [_make_note(60)]
    clip = StubClip(notes, return_shape="dict")
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 5), source_addr=None)

    assert clip.applied_payloads[0]["notes"][0]["pitch"] == 65
    assert emits == []


def test_json_string_payload_branch(emits):
    """JSON-string return shape (legacy LiveAPI bridge / older
    builds) still parses — the normaliser decodes before iterating."""
    notes = [_make_note(60)]
    clip = StubClip(notes, return_shape="json")
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 3), source_addr=None)

    assert clip.applied_payloads[0]["notes"][0]["pitch"] == 63
    assert emits == []


def test_remove_then_add_round_trip(emits):
    """Write path is clear-and-rewrite: ``remove_notes_extended``
    over the full pitch/time span, then ``add_new_notes`` with the
    shifted specs. ``apply_note_modifications`` is never called
    because ``MidiNote.pitch`` is read-only on live Python."""
    notes = [_make_note(60), _make_note(64)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 7), source_addr=None)

    assert len(clip.remove_calls) == 1
    pitch_start, pitch_span, time_start, time_span = clip.remove_calls[0]
    assert pitch_start == 0 and pitch_span == 128
    assert time_start <= 0 and time_span >= 16384
    pitches = [n["pitch"] for n in clip.applied_payloads[0]["notes"]]
    assert pitches == [67, 71]


# --- clamp ---------------------------------------------------------------


def test_clamp_at_zero_when_transposing_below(emits):
    """Pitches transposed below 0 clamp to 0 (no error). M4L does the
    same; the UI's "down an octave" gesture should never raise."""
    notes = [_make_note(2), _make_note(11), _make_note(60)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", -12), source_addr=None)

    pitches = [n["pitch"] for n in clip.applied_payloads[0]["notes"]]
    assert pitches == [0, 0, 48]
    assert emits == []


def test_clamp_at_127_when_transposing_above(emits):
    notes = [_make_note(120), _make_note(115), _make_note(60)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    pitches = [n["pitch"] for n in clip.applied_payloads[0]["notes"]]
    assert pitches == [127, 127, 72]


# --- empty clip ----------------------------------------------------------


def test_empty_clip_is_silent_no_op(emits):
    """No notes to transpose is not an error — matches M4L. We don't
    even call ``apply_note_modifications`` because there's nothing to
    apply."""
    clip = StubClip([])
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert clip.applied_payloads == []
    assert emits == []


# --- non-MIDI clip -------------------------------------------------------


def test_audio_clip_emits_not_midi(emits):
    clip = StubClip([_make_note(60)], is_midi_clip=False)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert clip.applied_payloads == []
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, path, _detail = payload
    assert originating == V3_CLIP_TRANSPOSE_ADDRESS
    assert code == V3_ERROR_NOT_MIDI_CLIP
    assert path == "tracks/0/slots/0/clip"


# --- resolver failures ---------------------------------------------------


def test_empty_slot_emits_clip_not_present(emits):
    comp, _ = _component_with(emits, clip=None)  # slot 0 empty

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_PRESENT


def test_out_of_range_slot_emits_slot_not_found(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_transpose(("tracks/0/slots/99/clip", 12), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_malformed_clip_path_emits_write_rejected(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_transpose(("not-a-clip-path", 12), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


# --- malformed args ------------------------------------------------------


def test_missing_args_emits_write_rejected(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_transpose((), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "arg-count" in detail


def test_one_arg_emits_write_rejected(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_transpose(("tracks/0/slots/0/clip",), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "arg-count" in detail


def test_non_int_semitones_emits_write_rejected(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_transpose(
        ("tracks/0/slots/0/clip", "twelve"), source_addr=None,
    )

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "semitones" in detail


def test_bool_semitones_rejected(emits):
    """``True`` is an int subclass; reject explicitly so the wire
    doesn't accept ``True``→1 and ``False``→0 as valid transpose
    amounts. The OSC layer never serializes Python bools as ints
    today, but defensive parsing matches the rest of the surface."""
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_transpose(
        ("tracks/0/slots/0/clip", True), source_addr=None,
    )

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


# --- LOM raise -----------------------------------------------------------


def test_get_notes_raise_emits_write_rejected(emits):
    clip = StubClip([_make_note(60)])
    clip._get_raises = RuntimeError("torn down")
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    # M4: transpose is read-mutate-writeback; a get raise propagates
    # through the handler's guard as a "transpose raised" write-rejected.
    assert "transpose raised" in detail
    assert "torn down" in detail


def test_add_new_notes_raise_emits_write_rejected(emits):
    """The write side of the round-trip. A LOM raise propagates as
    ``write-rejected``. The StubClip lacks ``apply_note_modifications``,
    so transpose uses the legacy clear-and-rewrite fallback whose
    ``add_new_notes`` raise surfaces here."""
    clip = StubClip([_make_note(60)])
    clip._apply_raises = RuntimeError("add failed")
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "transpose raised" in detail
    assert "add failed" in detail


def test_unparseable_payload_emits_write_rejected(emits):
    """If ``get_all_notes_extended`` returns garbage (broken Live build,
    plugin bug), surface it cleanly rather than crashing."""
    clip = StubClip([_make_note(60)])
    # Override to return something neither parseable as JSON nor a
    # dict/list.
    clip.get_all_notes_extended = lambda: 12345
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "unparseable" in detail


# --- disconnect ----------------------------------------------------------


def test_disconnect_makes_handler_no_op(emits):
    clip = StubClip([_make_note(60)])
    comp, _ = _component_with(emits, clip=clip)

    comp.disconnect()
    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    assert clip.applied_payloads == []
    assert emits == []


def test_disconnect_is_idempotent(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.disconnect()
    comp.disconnect()  # second call must not raise


# --- error emission shape ------------------------------------------------


def test_error_uses_four_arg_shape(emits):
    """``/looping/v3/error`` always carries 4 args:
    ``(originating_address, code, path, detail)`` — same as
    DevicesComponent / ClipsComponent / DeviceLoadComponent."""
    comp, _ = _component_with(emits, clip=None)  # empty slot triggers err

    comp.handle_transpose(("tracks/0/slots/0/clip", 12), source_addr=None)

    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    assert len(payload) == 4
    originating, code, path, detail = payload
    assert originating == V3_CLIP_TRANSPOSE_ADDRESS
    assert isinstance(code, str)
    assert isinstance(path, str)
    assert isinstance(detail, str)


# --- notes/get pull endpoint (Milestone 3) -------------------------------

import math  # noqa: E402 — late import keeps the legacy section unchanged
import struct  # noqa: E402 — late import keeps the legacy section unchanged


def _unpack_notes_blob(blob: bytes) -> list:
    """Round-trip helper: decode the float32 blob the component emits."""
    out = []
    if not blob:
        return out
    stride = 16  # 4 floats × 4 bytes
    for i in range(0, len(blob), stride):
        pitch, start, duration, vel = struct.unpack(
            "<ffff", blob[i:i + stride],
        )
        out.append(
            {"pitch": pitch, "start": start,
             "duration": duration, "velocity": vel},
        )
    return out


def test_notes_get_returns_packed_blob_for_midi_clip(emits):
    notes = [
        _make_note(60, start_time=0.0, duration=0.5, velocity=100),
        _make_note(64, start_time=0.5, duration=0.25, velocity=80),
    ]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-1", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_CLIP_NOTES_REPLY_ADDRESS
    request_id, clip_path, count, blob = payload
    assert request_id == "req-1"
    assert clip_path == "tracks/0/slots/0/clip"
    assert count == 2
    decoded = _unpack_notes_blob(blob)
    assert decoded[0]["pitch"] == 60.0
    assert decoded[0]["duration"] == 0.5
    assert decoded[1]["pitch"] == 64.0
    assert decoded[1]["velocity"] == 80.0


def test_notes_get_signs_velocity_for_muted_notes(emits):
    """The velocity's sign is the mute bit (ADR-444): a muted note packs
    as ``-velocity`` so the strip can ghost it at the same 16 B stride.
    Velocity 0 muted must survive as ``-0.0`` — float32 keeps the sign
    and the UI reads it with ``Object.is``."""
    notes = [
        _make_note(60, velocity=100),
        _make_note(64, velocity=80, mute=True),
        _make_note(67, velocity=0, mute=True),
    ]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-mute", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 1
    _, payload = emits[0]
    _, _, count, blob = payload
    assert count == 3
    decoded = _unpack_notes_blob(blob)
    assert decoded[0]["velocity"] == 100.0
    assert decoded[1]["velocity"] == -80.0
    assert decoded[2]["velocity"] == 0.0
    assert math.copysign(1.0, decoded[2]["velocity"]) == -1.0


def test_notes_get_audio_clip_emits_clip_not_midi(emits):
    clip = StubClip([_make_note(60)], is_midi_clip=False)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-2", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, path, _detail = payload
    assert originating == V3_CLIP_NOTES_GET_ADDRESS
    assert code == V3_ERROR_CLIP_NOT_MIDI
    assert path == "tracks/0/slots/0/clip"


def test_notes_get_missing_clip_emits_clip_not_found(emits):
    """An empty slot resolves with CLIP_NOT_PRESENT — notes/get
    collapses every resolve failure into ``clip-not-found`` because the
    pull endpoint just wants a binary verdict, not the granular write
    codes."""
    comp, _ = _component_with(emits, clip=None)

    comp.handle_notes_get(
        ("req-3", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_FOUND


def test_notes_get_malformed_path_emits_clip_not_found(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_notes_get(("req-4", "this is garbage"), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_FOUND


def test_notes_get_over_cap_emits_too_many_notes(emits):
    """Cap rejects rather than truncates — a UI showing only the first
    N notes would silently lie about the clip's contents."""
    cap = ClipNotesComponent.NOTES_PER_EMIT_CAP
    notes = [_make_note(60 + (i % 12)) for i in range(cap + 1)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-5", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_TOO_MANY_NOTES


def test_notes_get_at_cap_replies_successfully(emits):
    """Boundary: exactly ``cap`` notes still replies with a blob."""
    cap = ClipNotesComponent.NOTES_PER_EMIT_CAP
    notes = [_make_note(60) for _ in range(cap)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-6", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_CLIP_NOTES_REPLY_ADDRESS
    _rid, _path, count, _blob = payload
    assert count == cap


def test_notes_get_empty_request_id_rejected(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_notes_get(("", "tracks/0/slots/0/clip"), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_notes_get_arity_below_two_rejected(emits):
    comp, _ = _component_with(emits, clip=StubClip([_make_note(60)]))

    comp.handle_notes_get(("req-only",), source_addr=None)

    assert len(emits) == 1
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_notes_get_duplicate_request_id_replays_cached_reply(emits):
    """Retransmit idempotency: same request_id replays the cached reply
    without re-reading notes from the LOM."""
    notes = [_make_note(60, velocity=99)]
    clip = StubClip(notes)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-dup", "tracks/0/slots/0/clip"), source_addr=None,
    )
    first_emits = list(emits)

    # Mutate the underlying notes — if the LOM is re-read, the second
    # reply would carry the new note. The cache must replay the
    # original reply unchanged.
    clip._notes = [_make_note(72, velocity=10)]

    comp.handle_notes_get(
        ("req-dup", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 2
    assert emits[0] == first_emits[0]
    assert emits[1] == first_emits[0]


def test_notes_get_duplicate_request_id_replays_cached_error(emits):
    """Errors are cached too — a duplicate request after a non-MIDI
    error doesn't re-walk the LOM."""
    clip = StubClip([_make_note(60)], is_midi_clip=False)
    comp, _ = _component_with(emits, clip=clip)

    comp.handle_notes_get(
        ("req-err", "tracks/0/slots/0/clip"), source_addr=None,
    )
    comp.handle_notes_get(
        ("req-err", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert len(emits) == 2
    assert emits[0] == emits[1]


def test_notes_get_disconnect_silences_handler(emits):
    clip = StubClip([_make_note(60)])
    comp, _ = _component_with(emits, clip=clip)
    comp.disconnect()

    comp.handle_notes_get(
        ("req-late", "tracks/0/slots/0/clip"), source_addr=None,
    )

    assert emits == []
