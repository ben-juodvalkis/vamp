"""The notes codec on its own: the rich blob and the id blob round-trip, a
short blob is refused, and the component still re-exports every name."""

from components import ClipNotesComponent as component
from components import clip_notes_codec as codec


NOTE = {"note_id": 7, "pitch": 60, "start_time": 1.5, "duration": 0.25, "velocity": 90.0, "mute": True}


def test_rich_note_round_trips():
    blob = codec._pack_rich_note(NOTE) + codec._pack_rich_note(dict(NOTE, note_id=8, mute=False))
    assert len(blob) == 2 * codec._RICH_BYTES_PER_NOTE
    out = codec._unpack_rich_blob(blob)
    assert out[0] == NOTE
    assert out[1]["note_id"] == 8 and out[1]["mute"] is False


def test_a_blob_off_the_stride_is_refused():
    assert codec._unpack_rich_blob(codec._pack_rich_note(NOTE)[:-1]) is None


def test_id_blob_round_trips():
    assert codec._parse_id_list(codec._pack_id_blob([1, -2, 300])) == [1, -2, 300]
    assert codec._pack_id_blob([]) == b""
    assert codec._parse_id_list([True]) is None


def test_the_component_re_exports_the_codec():
    for name in ("_pack_notes_blob", "_rich_blob_checksum", "_RICH_NOTE_PACK_FMT", "_READ_RAISED"):
        assert getattr(component, name) is getattr(codec, name)
