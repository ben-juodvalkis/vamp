"""ClipsComponent.handle_sample_get — ADR-415 per-slot sample path.

The session clip grid draws a waveform in every audio cell, including
slots that have never played. Nothing else on the wire can answer that:
the track strip's waveform rides ``/looping/v3/track/playing_slot``,
which PlayheadComponent emits from ONE ``playing_slot_index`` listener
per track, so it covers the playing slot only.

These pin the contract that makes the query safe to fire from a
viewport full of cells:

- a MIDI clip is a REPLY (``isAudioClip=0``), not an error — the UI
  branches on that bit to draw note lanes instead
- an audio clip with no readable path replies with an empty path, not
  an error — a recording still flushing to disk reports one
- only an unresolvable path errors
- every LOM read is guarded: Live 12 properties *raise* rather than
  returning a default, so ``getattr(obj, name, fallback)`` does not
  save you (project_live_lom_quirks)
- an audio reply places its file in the clip's own time
  (``fileStart``, ``fileEnd``), ``0, 0`` when that can't be read
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.ClipsComponent import (
    ClipsComponent,
    V3_CLIP_SAMPLE_GET_ADDRESS,
    V3_CLIP_SAMPLE_REPLY_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_CLIP_NOT_PRESENT,
    V3_ERROR_WRITE_REJECTED,
)


class SampleClip:
    """Clip whose type/path reads can each be made to raise."""

    def __init__(self, *, is_audio=True, file_path="/S/kick.wav", has_is_audio=True):
        self._is_audio = is_audio
        self._file_path = file_path
        self._has_is_audio = has_is_audio
        self._is_audio_raises = None
        self._is_midi_raises = None
        self._file_path_raises = None

    @property
    def is_audio_clip(self):
        if not self._has_is_audio:
            raise AttributeError("is_audio_clip")
        if self._is_audio_raises is not None:
            raise self._is_audio_raises
        return self._is_audio

    @property
    def is_midi_clip(self):
        if self._is_midi_raises is not None:
            raise self._is_midi_raises
        return not self._is_audio

    @property
    def file_path(self):
        if self._file_path_raises is not None:
            raise self._file_path_raises
        return self._file_path


class SpanClip(SampleClip):
    """An audio clip that can answer where its file sits.

    Defaults are the rig's Bass take, measured 2026-09-18: 784000 frames,
    warped, ``sample_to_beat_time`` 0 → 0.0 and 784000 → 28.0, looping
    16..24 with ``length`` 8.
    """

    def __init__(self, *, warping=True, frames=784000, beats=28.0, rate=44100.0, **kw):
        super().__init__(**kw)
        self.warping = warping
        self.sample_length = frames
        self.sample_rate = rate
        self._beats, self._frames = beats, frames
        self.beat_calls = []

    def sample_to_beat_time(self, sample_time):
        self.beat_calls.append(sample_time)
        if not self.warping:
            raise RuntimeError("Sample is not warped")
        return sample_time * self._beats / self._frames


class Slot:
    def __init__(self):
        self.clip = None
        self.has_clip = False

    def add_has_clip_listener(self, cb):
        pass

    def remove_has_clip_listener(self, cb):
        pass


class Track:
    def __init__(self, n=4):
        self.clip_slots = tuple(Slot() for _ in range(n))


class Song:
    def __init__(self):
        self.tracks = tuple(Track() for _ in range(2))
        self.master_track = object()
        self.return_tracks = ()


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


@pytest.fixture
def song() -> Song:
    return Song()


@pytest.fixture
def component(song, emits):
    return ClipsComponent(
        song=song,
        emit=lambda address, payload: emits.append((address, payload)),
        advance_generation=lambda reason: None,
    )


def put(song, track, slot, clip) -> str:
    song.tracks[track].clip_slots[slot].clip = clip
    song.tracks[track].clip_slots[slot].has_clip = True
    return "tracks/%d/slots/%d/clip" % (track, slot)


def only_reply(emits):
    replies = [e for e in emits if e[0] == V3_CLIP_SAMPLE_REPLY_ADDRESS]
    assert len(replies) == 1, emits
    return replies[0][1]


# --- audio ----------------------------------------------------------------


def test_audio_clip_replies_with_path(component, song, emits):
    path = put(song, 0, 0, SampleClip(file_path="/S/kick.wav"))
    component.handle_sample_get(["r1", path])
    assert only_reply(emits) == ("r1", path, 1, "/S/kick.wav", 0.0, 0.0)


def test_audio_clip_with_empty_path_replies_not_errors(component, song, emits):
    """A recording still flushing to disk reports an empty file_path.

    That is "no waveform yet", not a failure — erroring would make
    every fresh recording look broken in the grid.
    """
    path = put(song, 0, 1, SampleClip(file_path=""))
    component.handle_sample_get(["r2", path])
    assert only_reply(emits) == ("r2", path, 1, "", 0.0, 0.0)


def test_file_path_raising_replies_with_empty_path(component, song, emits):
    clip = SampleClip()
    clip._file_path_raises = RuntimeError("torn-down handle")
    path = put(song, 0, 2, clip)
    component.handle_sample_get(["r3", path])
    assert only_reply(emits) == ("r3", path, 1, "", 0.0, 0.0)


def test_warped_clip_replies_with_file_span_in_beats(component, song, emits):
    clip = SpanClip(file_path="/S/bass.aif")
    path = put(song, 0, 0, clip)
    component.handle_sample_get(["s1", path])
    assert only_reply(emits) == ("s1", path, 1, "/S/bass.aif", 0.0, 28.0)
    assert clip.beat_calls == [0.0, 784000.0]


def test_unwarped_clip_replies_with_file_span_in_seconds(component, song, emits):
    """Unwarped, Live's loop points are seconds — so is the span."""
    clip = SpanClip(warping=False, frames=441000, rate=44100.0)
    path = put(song, 0, 1, clip)
    component.handle_sample_get(["s2", path])
    assert only_reply(emits)[4:] == (0.0, 10.0)
    assert clip.beat_calls == []


def test_span_read_raising_replies_unknown_span(component, song, emits):
    clip = SpanClip()
    clip.sample_to_beat_time = lambda t: (_ for _ in ()).throw(RuntimeError("gone"))
    path = put(song, 0, 2, clip)
    component.handle_sample_get(["s3", path])
    assert only_reply(emits) == ("s3", path, 1, "/S/kick.wav", 0.0, 0.0)


def test_empty_take_replies_unknown_span(component, song, emits):
    """A take still flushing has no frames yet — no span to report."""
    path = put(song, 0, 3, SpanClip(frames=0, file_path=""))
    component.handle_sample_get(["s4", path])
    assert only_reply(emits) == ("s4", path, 1, "", 0.0, 0.0)


# --- MIDI -----------------------------------------------------------------


def test_midi_clip_replies_with_zero_flag(component, song, emits):
    path = put(song, 1, 0, SampleClip(is_audio=False))
    component.handle_sample_get(["r4", path])
    assert only_reply(emits) == ("r4", path, 0, "", 0.0, 0.0)


def test_midi_clip_never_reads_file_path(component, song, emits):
    clip = SpanClip(is_audio=False)
    clip._file_path_raises = RuntimeError("must not be read")
    path = put(song, 1, 1, clip)
    component.handle_sample_get(["r5", path])
    assert only_reply(emits) == ("r5", path, 0, "", 0.0, 0.0)
    assert clip.beat_calls == []


def test_falls_back_to_is_midi_clip_when_is_audio_absent(component, song, emits):
    path = put(song, 0, 3, SampleClip(is_audio=True, has_is_audio=False))
    component.handle_sample_get(["r6", path])
    assert only_reply(emits)[2] == 1


def test_both_type_reads_raising_reports_not_audio(component, song, emits):
    """Read positively: negating a FAILED read would claim the opposite
    — that an unreadable handle is audio — and send the UI chasing peaks
    for a path it cannot have."""
    clip = SampleClip()
    clip._is_audio_raises = RuntimeError("gone")
    clip._is_midi_raises = RuntimeError("gone")
    path = put(song, 0, 0, clip)
    component.handle_sample_get(["r7", path])
    assert only_reply(emits) == ("r7", path, 0, "", 0.0, 0.0)


# --- failures -------------------------------------------------------------


def test_empty_slot_errors(component, emits):
    component.handle_sample_get(["r8", "tracks/0/slots/2/clip"])
    address, payload = emits[0]
    assert address == V3_ERROR_ADDRESS
    assert payload[0] == V3_CLIP_SAMPLE_GET_ADDRESS
    assert payload[1] == V3_ERROR_CLIP_NOT_PRESENT


def test_out_of_range_track_errors(component, emits):
    component.handle_sample_get(["r9", "tracks/99/slots/0/clip"])
    assert emits[0][0] == V3_ERROR_ADDRESS


def test_short_args_error_write_rejected(component, emits):
    component.handle_sample_get(["only-one"])
    assert emits[0][0] == V3_ERROR_ADDRESS
    assert emits[0][1][1] == V3_ERROR_WRITE_REJECTED


def test_empty_request_id_errors_write_rejected(component, song, emits):
    path = put(song, 0, 0, SampleClip())
    component.handle_sample_get(["", path])
    assert emits[0][0] == V3_ERROR_ADDRESS
    assert emits[0][1][1] == V3_ERROR_WRITE_REJECTED


def test_bytes_args_are_decoded(component, song, emits):
    path = put(song, 0, 0, SampleClip(file_path="/S/a.wav"))
    component.handle_sample_get([b"r10", path.encode("utf-8")])
    assert only_reply(emits) == ("r10", path, 1, "/S/a.wav", 0.0, 0.0)


def test_disconnect_silences(component, song, emits):
    path = put(song, 0, 0, SampleClip())
    component.disconnect()
    component.handle_sample_get(["after", path])
    assert emits == []
