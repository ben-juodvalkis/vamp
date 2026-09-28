"""ClipNotesComponent M3 (rich channel) + M4 (note editing) tests.

Covers the clip-view-mirror milestones layered onto the existing
transpose/notes-get component:

M3 — rich focused-clip note channel
  - ``rich/get`` round-trips note_id + extended fields through the
    ``<iffffi>`` struct; reassembled blob decodes to the source notes.
  - Chunk boundaries fall on whole notes (never split a 24-byte struct).
  - Checksum is stable + matches a recompute over the concatenated blob.
  - Over-ceiling rejects with ``clip-too-many-notes``.
  - Non-MIDI / unresolvable reject with typed codes.
  - LRU replays the begin→chunk→end sequence on a duplicate request_id.
  - The focused-clip notes listener fires ``notes/changed``.

M4 — by-id note editing
  - ``remove`` maps to ``remove_notes_by_id``.
  - ``modify`` is read-mutate-writeback over the SAME vector, ids stable.
  - ``modify`` prefers ``get_notes_by_id`` (only touched notes re-read).
  - ``add`` builds id-less specs and replies ``notes/added`` with the
    real ids straight off ``add_new_notes``'s return.
  - non-MIDI / bad blob reject.

The stub models the Live 12.4 LOM contract the probe verified
(``StubRichClip``): writable ``MidiNote`` objects, ``apply_note_modifications``
keyed by id, ``add_new_notes`` returning new ids, ``remove_notes_by_id``,
plus a ``song.view.detail_clip`` for the listener.
"""

from __future__ import annotations

import struct
from typing import List, Tuple

import pytest

from components.ClipNotesComponent import (
    ClipNotesComponent,
    V3_CLIP_NOTES_RICH_BEGIN_ADDRESS,
    V3_CLIP_NOTES_RICH_CHUNK_ADDRESS,
    V3_CLIP_NOTES_RICH_END_ADDRESS,
    V3_CLIP_NOTES_ADDED_ADDRESS,
    V3_CLIP_NOTES_SELECT_ADDRESS,
    V3_CLIP_NOTES_DUPLICATE_ADDRESS,
    V3_CLIP_NOTES_CHANGED_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_CLIP_NOT_MIDI,
    V3_ERROR_NOT_MIDI_CLIP,
    V3_ERROR_TOO_MANY_NOTES,
    V3_ERROR_WRITE_REJECTED,
    _RICH_NOTE_PACK_FMT,
    _RICH_BYTES_PER_NOTE,
    _rich_blob_checksum,
)


# --- stubs ----------------------------------------------------------------


class StubNote:
    """Writable MidiNote — models read-mutate-writeback (probe contract)."""

    def __init__(self, note_id, pitch, start=0.0, dur=0.25, vel=100.0,
                 mute=False):
        self.note_id = note_id
        self.pitch = pitch
        self.start_time = start
        self.duration = dur
        self.velocity = vel
        self.mute = mute


class StubRichClip:
    """LOM Clip modeling the by-id note-edit + rich-read contract."""

    def __init__(self, notes=None, is_midi=True, length=4.0,
                 has_get_by_id=True, add_returns_ids=True):
        self.is_midi_clip = is_midi
        self.length = length
        self._notes = list(notes or ())
        self._next_id = 5000
        self.calls: List[str] = []
        self._add_returns_ids = add_returns_ids
        if not has_get_by_id:
            self.get_notes_by_id = None

    # Both arities — the component tries the arg-bearing form first.
    def get_all_notes_extended(self, *args):
        self.calls.append("get_all_notes_extended")
        return [
            StubNote(n.note_id, n.pitch, n.start_time, n.duration,
                     n.velocity, n.mute)
            for n in self._notes
        ]

    def get_notes_by_id(self, ids):
        self.calls.append("get_notes_by_id")
        idset = set(ids)
        return [
            StubNote(n.note_id, n.pitch, n.start_time, n.duration,
                     n.velocity, n.mute)
            for n in self._notes if n.note_id in idset
        ]

    def apply_note_modifications(self, vec):
        self.calls.append("apply_note_modifications")
        by_id = {n.note_id: n for n in self._notes}
        for mod in vec:
            target = by_id.get(mod.note_id)
            if target is None:
                raise RuntimeError("unknown note_id %r" % mod.note_id)
            target.pitch = mod.pitch
            target.start_time = mod.start_time
            target.duration = mod.duration
            target.velocity = mod.velocity
            target.mute = mod.mute

    def add_new_notes(self, specs):
        self.calls.append("add_new_notes")
        new_ids = []
        for spec in specs:
            self._next_id += 1
            self._notes.append(StubNote(
                self._next_id,
                int(spec["pitch"]),
                float(spec.get("start_time", 0.0)),
                float(spec.get("duration", 0.25)),
                float(spec.get("velocity", 100.0)),
                bool(spec.get("mute", False)),
            ))
            new_ids.append(self._next_id)
        return new_ids if self._add_returns_ids else None

    def remove_notes_by_id(self, ids):
        self.calls.append("remove_notes_by_id")
        idset = set(ids)
        self._notes = [n for n in self._notes if n.note_id not in idset]

    def select_notes_by_id(self, ids):
        self.calls.append("select_notes_by_id")
        self.selected_ids = list(ids)

    def deselect_all_notes(self):
        self.calls.append("deselect_all_notes")
        self.selected_ids = []

    def duplicate_notes_by_id(self, ids):
        self.calls.append("duplicate_notes_by_id")
        new_ids = []
        by_id = {n.note_id: n for n in self._notes}
        for src in ids:
            base = by_id.get(src)
            self._next_id += 1
            # Live places copies after the source; mirror that loosely.
            start = (base.start_time + base.duration) if base else 0.0
            pitch = base.pitch if base else 60
            self._notes.append(StubNote(self._next_id, pitch, start))
            new_ids.append(self._next_id)
        return new_ids

    # Listener surface (for the focused-clip notes listener).
    def add_notes_listener(self, cb):
        self.calls.append("add_notes_listener")
        self._notes_cb = cb

    def remove_notes_listener(self, cb):
        self.calls.append("remove_notes_listener")
        self._notes_cb = None

    def fire_notes(self):
        cb = getattr(self, "_notes_cb", None)
        if cb is not None:
            cb()


class StubSlot:
    def __init__(self, clip):
        self.has_clip = clip is not None
        self.clip = clip


class StubTrack:
    def __init__(self, slots):
        self.clip_slots = tuple(slots)


class StubView:
    def __init__(self, clip):
        self.detail_clip = clip
        self._detail_cb = None

    def add_detail_clip_listener(self, cb):
        self._detail_cb = cb

    def remove_detail_clip_listener(self, cb):
        self._detail_cb = None

    def fire_detail(self):
        if self._detail_cb is not None:
            self._detail_cb()


class StubSong:
    def __init__(self, tracks, view_clip=None):
        self.tracks = tuple(tracks)
        self.master_track = object()
        self.return_tracks = ()
        self.view = StubView(view_clip)


CLIP_PATH = "tracks/0/slots/0/clip"


def _build(emits, clip, *, focus_clip=None):
    """Component whose track 0 / slot 0 holds ``clip``; optional focus."""
    track = StubTrack([StubSlot(clip), StubSlot(None)])
    song = StubSong([track], view_clip=focus_clip)

    def emit(addr, args):
        emits.append((addr, args))

    return ClipNotesComponent(song=song, emit=emit), song


def _pack_blob(notes) -> bytes:
    """Pack (id, pitch, start, dur, vel, mute) tuples into the rich blob."""
    return b"".join(
        struct.pack(_RICH_NOTE_PACK_FMT, nid, p, s, d, v, m)
        for (nid, p, s, d, v, m) in notes
    )


def _unpack_ids(blob) -> list:
    """Decode a little-endian int32 id blob (the notes/added id arg)."""
    if not blob:
        return []
    return [
        struct.unpack_from("<i", blob, off)[0]
        for off in range(0, len(blob), 4)
    ]


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


# --- M3 rich/get ----------------------------------------------------------


def _collect_rich(emits):
    """Split a rich emit sequence into (begin, chunks, end)."""
    begin = next(a for a in emits if a[0] == V3_CLIP_NOTES_RICH_BEGIN_ADDRESS)
    chunks = [a for a in emits if a[0] == V3_CLIP_NOTES_RICH_CHUNK_ADDRESS]
    end = next(a for a in emits if a[0] == V3_CLIP_NOTES_RICH_END_ADDRESS)
    return begin, chunks, end


def _decode_chunks(chunks) -> List[dict]:
    blob = b"".join(c[1][2] for c in chunks)
    out = []
    for off in range(0, len(blob), _RICH_BYTES_PER_NOTE):
        nid, p, s, d, v, m = struct.unpack_from(_RICH_NOTE_PACK_FMT, blob, off)
        out.append({"note_id": nid, "pitch": p, "start": s, "dur": d,
                    "vel": v, "mute": m})
    return out


def test_rich_get_round_trips_id_and_fields(emits):
    clip = StubRichClip([
        StubNote(101, 60, 0.0, 0.5, 100.0, False),
        StubNote(102, 64, 0.5, 0.25, 80.0, True),
    ])
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("req-1", CLIP_PATH), None)

    begin, chunks, end = _collect_rich(emits)
    assert begin[1][0] == "req-1"
    assert begin[1][1] == CLIP_PATH
    assert begin[1][2] == 2  # note_count
    decoded = _decode_chunks(chunks)
    assert [d["note_id"] for d in decoded] == [101, 102]
    assert [round(d["pitch"]) for d in decoded] == [60, 64]
    assert decoded[1]["mute"] == 1
    assert pytest.approx(decoded[1]["vel"]) == 80.0


def test_rich_get_checksum_matches_recompute(emits):
    clip = StubRichClip([StubNote(1, 60), StubNote(2, 62), StubNote(3, 64)])
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("req-c", CLIP_PATH), None)
    _begin, chunks, end = _collect_rich(emits)
    blob = b"".join(c[1][2] for c in chunks)
    expected = "0x%08x" % _rich_blob_checksum(blob)
    assert end[1][1] == expected


def test_rich_get_chunks_on_note_boundaries(emits):
    # Force multiple chunks by lowering the per-chunk count via many notes.
    notes = [StubNote(i, 60 + (i % 12)) for i in range(1, 500)]
    clip = StubRichClip(notes)
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("req-b", CLIP_PATH), None)
    _begin, chunks, _end = _collect_rich(emits)
    # Every chunk blob length is a whole multiple of the note stride.
    for c in chunks:
        assert len(c[1][2]) % _RICH_BYTES_PER_NOTE == 0
    # Reassembled count matches.
    assert len(_decode_chunks(chunks)) == 499


def test_rich_get_empty_clip_emits_begin_end(emits):
    clip = StubRichClip([])
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("req-e", CLIP_PATH), None)
    begin, chunks, end = _collect_rich(emits)
    assert begin[1][2] == 0  # zero notes
    assert begin[1][3] == 0  # zero chunks
    assert chunks == []
    assert end[1][0] == "req-e"


def test_rich_get_over_ceiling_rejects(emits):
    notes = [StubNote(i, 60) for i in range(1, ClipNotesComponent
                                            .RICH_NOTES_HARD_CEILING + 2)]
    clip = StubRichClip(notes)
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("req-x", CLIP_PATH), None)
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    assert payload[1] == V3_ERROR_TOO_MANY_NOTES


def test_rich_get_audio_clip_rejects(emits):
    clip = StubRichClip([StubNote(1, 60)], is_midi=False)
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("req-a", CLIP_PATH), None)
    assert any(a[0] == V3_ERROR_ADDRESS and a[1][1] == V3_ERROR_CLIP_NOT_MIDI
               for a in emits)


def test_rich_get_lru_replays_sequence(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, _ = _build(emits, clip)
    comp.handle_notes_rich_get(("dup", CLIP_PATH), None)
    first_count = len(emits)
    reads_before = clip.calls.count("get_all_notes_extended")
    emits.clear()
    comp.handle_notes_rich_get(("dup", CLIP_PATH), None)
    # Same sequence replayed without a second LOM read.
    assert len(emits) == first_count
    assert clip.calls.count("get_all_notes_extended") == reads_before


# --- M3 focused-clip notes listener ---------------------------------------


def test_focused_listener_fires_notes_changed(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, song = _build(emits, clip, focus_clip=clip)
    # Listener attached at construction (clip is focused).
    assert "add_notes_listener" in clip.calls
    emits.clear()
    clip.fire_notes()
    assert any(a[0] == V3_CLIP_NOTES_CHANGED_ADDRESS for a in emits)
    poke = next(a for a in emits if a[0] == V3_CLIP_NOTES_CHANGED_ADDRESS)
    assert poke[1][1] == CLIP_PATH  # clip_path slot


def test_refocus_moves_listener(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, song = _build(emits, clip, focus_clip=None)
    assert "add_notes_listener" not in clip.calls
    # Focus the clip → detail listener fires → notes listener attaches.
    song.view.detail_clip = clip
    song.view.fire_detail()
    assert "add_notes_listener" in clip.calls


# --- M4 remove ------------------------------------------------------------


def test_remove_maps_to_remove_by_id(emits):
    clip = StubRichClip([StubNote(1, 60), StubNote(2, 62), StubNote(3, 64)])
    comp, _ = _build(emits, clip)
    comp.handle_notes_remove((CLIP_PATH, [1, 3]), None)
    assert "remove_notes_by_id" in clip.calls
    assert [n.note_id for n in clip._notes] == [2]
    assert emits == []  # success, no error


def test_remove_empty_ids_is_noop(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, _ = _build(emits, clip)
    comp.handle_notes_remove((CLIP_PATH, []), None)
    assert "remove_notes_by_id" not in clip.calls
    assert emits == []


def test_remove_audio_clip_rejects(emits):
    clip = StubRichClip([StubNote(1, 60)], is_midi=False)
    comp, _ = _build(emits, clip)
    comp.handle_notes_remove((CLIP_PATH, [1]), None)
    assert any(a[1][1] == V3_ERROR_NOT_MIDI_CLIP for a in emits)


# --- M6 select (editor→Live) ----------------------------------------------


def test_select_maps_to_select_by_id(emits):
    clip = StubRichClip([StubNote(1, 60), StubNote(2, 62), StubNote(3, 64)])
    comp, _ = _build(emits, clip)
    comp.handle_notes_select((CLIP_PATH, [1, 3]), None)
    assert "select_notes_by_id" in clip.calls
    assert clip.selected_ids == [1, 3]
    assert emits == []  # fire-and-forget, no echo


def test_select_empty_clears_selection(emits):
    clip = StubRichClip([StubNote(1, 60)])
    clip.selected_ids = [1]
    comp, _ = _build(emits, clip)
    comp.handle_notes_select((CLIP_PATH, []), None)
    assert "deselect_all_notes" in clip.calls
    assert "select_notes_by_id" not in clip.calls
    assert clip.selected_ids == []
    assert emits == []


def test_select_audio_clip_rejects(emits):
    clip = StubRichClip([StubNote(1, 60)], is_midi=False)
    comp, _ = _build(emits, clip)
    comp.handle_notes_select((CLIP_PATH, [1]), None)
    assert any(a[1][1] == V3_ERROR_NOT_MIDI_CLIP for a in emits)


def test_select_blob_ids_decode(emits):
    clip = StubRichClip([StubNote(7, 60), StubNote(8, 62)])
    comp, _ = _build(emits, clip)
    # ids as a little-endian int32 blob (the real wire shape).
    blob = b"".join(struct.pack("<i", i) for i in (7, 8))
    comp.handle_notes_select((CLIP_PATH, blob), None)
    assert clip.selected_ids == [7, 8]


# --- M5 duplicate ---------------------------------------------------------


def test_duplicate_maps_to_duplicate_by_id_and_replies_added(emits):
    clip = StubRichClip([StubNote(1, 60), StubNote(2, 62)])
    comp, _ = _build(emits, clip)
    blob = b"".join(struct.pack("<i", i) for i in (1, 2))
    comp.handle_notes_duplicate(("dupreq", CLIP_PATH, blob), None)
    assert "duplicate_notes_by_id" in clip.calls
    added = next(a for a in emits if a[0] == V3_CLIP_NOTES_ADDED_ADDRESS)
    req, path, id_blob = added[1]
    new_ids = _unpack_ids(id_blob)
    assert req == "dupreq"
    assert path == CLIP_PATH
    assert len(new_ids) == 2  # two copies
    assert all(nid in [n.note_id for n in clip._notes] for nid in new_ids)


def test_duplicate_empty_ids_replies_empty(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, _ = _build(emits, clip)
    comp.handle_notes_duplicate(("r", CLIP_PATH, b""), None)
    added = next(a for a in emits if a[0] == V3_CLIP_NOTES_ADDED_ADDRESS)
    assert _unpack_ids(added[1][2]) == []
    assert "duplicate_notes_by_id" not in clip.calls


def test_duplicate_audio_clip_rejects(emits):
    clip = StubRichClip([StubNote(1, 60)], is_midi=False)
    comp, _ = _build(emits, clip)
    blob = struct.pack("<i", 1)
    comp.handle_notes_duplicate(("r", CLIP_PATH, blob), None)
    assert any(a[1][1] == V3_ERROR_NOT_MIDI_CLIP for a in emits)


# --- M4 modify ------------------------------------------------------------


def test_modify_is_read_mutate_writeback_id_stable(emits):
    clip = StubRichClip([StubNote(201, 60, 0.0, 0.5, 100.0, False)])
    comp, _ = _build(emits, clip)
    # Move pitch 60→67, duration 0.5→1.0.
    blob = _pack_blob([(201, 67.0, 0.0, 1.0, 100.0, 0)])
    comp.handle_notes_modify((CLIP_PATH, blob), None)
    assert "apply_note_modifications" in clip.calls
    assert clip._notes[0].note_id == 201  # id preserved
    assert clip._notes[0].pitch == 67
    assert clip._notes[0].duration == 1.0
    assert emits == []


def test_modify_prefers_get_notes_by_id(emits):
    clip = StubRichClip([StubNote(1, 60), StubNote(2, 62)])
    comp, _ = _build(emits, clip)
    blob = _pack_blob([(2, 65.0, 0.0, 0.25, 100.0, 0)])
    comp.handle_notes_modify((CLIP_PATH, blob), None)
    assert "get_notes_by_id" in clip.calls
    assert "get_all_notes_extended" not in clip.calls
    assert clip._notes[1].pitch == 65


def test_modify_falls_back_to_full_read(emits):
    clip = StubRichClip([StubNote(1, 60)], has_get_by_id=False)
    comp, _ = _build(emits, clip)
    blob = _pack_blob([(1, 61.0, 0.0, 0.25, 100.0, 0)])
    comp.handle_notes_modify((CLIP_PATH, blob), None)
    assert "get_all_notes_extended" in clip.calls
    assert clip._notes[0].pitch == 61


def test_modify_bad_blob_rejects(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, _ = _build(emits, clip)
    # 23-byte blob — not a whole stride.
    comp.handle_notes_modify((CLIP_PATH, b"x" * 23), None)
    assert any(a[1][1] == V3_ERROR_WRITE_REJECTED for a in emits)


# --- M4 add ---------------------------------------------------------------


def test_add_builds_idless_specs_and_replies_ids(emits):
    clip = StubRichClip([StubNote(1, 60)])
    comp, _ = _build(emits, clip)
    # note_id slot is ignored on add (UI sends a temp negative id).
    blob = _pack_blob([(-7, 72.0, 1.0, 0.5, 90.0, 0)])
    comp.handle_notes_add(("addreq", CLIP_PATH, blob), None)
    assert "add_new_notes" in clip.calls
    added = next(a for a in emits if a[0] == V3_CLIP_NOTES_ADDED_ADDRESS)
    req, path, id_blob = added[1]
    new_ids = _unpack_ids(id_blob)
    assert req == "addreq"
    assert path == CLIP_PATH
    assert len(new_ids) == 1
    # The new note carries the real id Live assigned, not the temp -7.
    assert new_ids[0] in [n.note_id for n in clip._notes]
    assert new_ids[0] > 0


def test_add_returns_empty_ids_when_lom_returns_none(emits):
    clip = StubRichClip([], add_returns_ids=False)
    comp, _ = _build(emits, clip)
    blob = _pack_blob([(-1, 60.0, 0.0, 0.25, 100.0, 0)])
    comp.handle_notes_add(("r", CLIP_PATH, blob), None)
    added = next(a for a in emits if a[0] == V3_CLIP_NOTES_ADDED_ADDRESS)
    _req, _path, id_blob = added[1]
    assert _unpack_ids(id_blob) == []  # UI falls back to a notes/changed re-pull


def test_add_audio_clip_rejects(emits):
    clip = StubRichClip([], is_midi=False)
    comp, _ = _build(emits, clip)
    blob = _pack_blob([(-1, 60.0, 0.0, 0.25, 100.0, 0)])
    comp.handle_notes_add(("r", CLIP_PATH, blob), None)
    assert any(a[1][1] == V3_ERROR_NOT_MIDI_CLIP for a in emits)


# --- transpose preserves ids (M4 migration) -------------------------------


def test_transpose_uses_apply_and_preserves_ids(emits):
    clip = StubRichClip([StubNote(11, 60), StubNote(12, 64)])
    comp, _ = _build(emits, clip)
    comp.handle_transpose((CLIP_PATH, 5), None)
    assert "apply_note_modifications" in clip.calls
    assert "add_new_notes" not in clip.calls  # no clear-and-rewrite
    assert [n.note_id for n in clip._notes] == [11, 12]  # ids preserved
    assert [n.pitch for n in clip._notes] == [65, 69]


# --- _rich_blob_checksum: the reference implementation it must equal -------


def _reference_fnv1a(blob):
    """FNV-1a 32-bit, written out longhand.

    This is the algorithm the wire contract names, and what
    ``clipRichNotesService.computeRichBlobChecksum`` implements on the
    other side. ``_rich_blob_checksum`` is the same thing with the two
    no-op masks removed and the constants bound as locals, so it must
    agree here byte for byte and for every length — including 0, where
    the loop never runs and the offset basis falls straight through.
    """
    h = 0x811C9DC5
    for byte in blob:
        h = (h ^ (byte & 0xFF)) & 0xFFFFFFFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h & 0x7FFFFFFF


def test_rich_blob_checksum_matches_the_longhand_reference():
    import os
    import random

    random.seed(20260911)
    cases = [b"", b"\x00", b"\xff", bytes(range(256))]
    cases += [os.urandom(random.randint(1, 4096)) for _ in range(60)]
    # 4096 notes x 24 bytes is _RICH_NOTES_HARD_CEILING's worth — the
    # size the optimisation was measured at (10.30 ms -> 7.04 ms here).
    cases.append(os.urandom(4096 * 24))

    for blob in cases:
        assert _rich_blob_checksum(blob) == _reference_fnv1a(blob), (
            "checksum diverged at length %d" % len(blob)
        )


def test_rich_blob_checksum_stays_inside_the_osc_int_positive_range():
    """Emitted as an OSC int, so the int31 mask is part of the contract."""
    import os

    for _ in range(200):
        value = _rich_blob_checksum(os.urandom(64))
        assert 0 <= value <= 0x7FFFFFFF
