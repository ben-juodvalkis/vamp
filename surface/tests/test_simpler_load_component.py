"""SimplerLoadComponent tests — Flow #1 (audio clip → Simpler).

Covers the single wire ``/looping/v3/simpler/replace_sample [clipPath]``
and the adjacent-MIDI-track + Simpler-by-name + replace_sample pipeline.

Scenarios:

- Happy path: focused audio clip → new MIDI track at source_idx+1,
  a Simpler inserted by name, ``replace_sample(file_path)`` invoked with
  the clip's ``file_path``. No error emitted.
- An instrument already on the track is deleted and the Simpler takes
  its slot; leading MIDI effects stay ahead of it; one undo step.
- Arg-count != 1 → ``replace-sample-failed``.
- Empty clipPath → ``clip-not-found`` with ``empty-clip-path`` detail.
- Malformed / not-found clipPath → ``clip-not-found``.
- MIDI clip (``is_midi_clip == True``) → ``not-audio-clip``.
- Audio clip with empty ``file_path`` → ``no-file-path``.
- ``insert_device`` raises → ``simpler-insert-failed``.
- Device on new track without ``replace_sample`` attr (pre-12.4
  Simpler, or wrong device class) → ``replace-sample-missing``.
- ``replace_sample`` raises LOM error → ``replace-sample-failed``.
- ``song.create_midi_track`` raises → ``create-midi-track-failed``.
- Post-disconnect handler is a no-op; no LOM calls, no emits.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import pytest

from components.SimplerLoadComponent import (
    SimplerLoadComponent,
    V3_ERROR_ADDRESS,
    V3_ERROR_CLIP_NOT_FOUND,
    V3_ERROR_CREATE_FAILED,
    V3_ERROR_NOT_AUDIO_CLIP,
    V3_ERROR_NO_FILE_PATH,
    V3_ERROR_INSERT_FAILED,
    V3_ERROR_REPLACE_SAMPLE_FAILED,
    V3_ERROR_REPLACE_SAMPLE_MISSING,
    V3_ERROR_TRACK_INDEX_UNRESOLVED,
    V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
    V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
    V3_SIMPLER_REPLACED_ADDRESS,
)


# --- wire-traffic helpers -------------------------------------------------
#
# Success stopped being silent on 2026-09-17: both load flows now emit
# ``/looping/v3/simpler/replaced [originAddress, devicePath, filePath]``.
# Tests that mean "nothing went wrong" filter to the error address rather
# than asserting an empty emit log, so the ack doesn't read as a failure.


def _errors(emits):
    """Just the ``/looping/v3/error`` emits."""
    return [e for e in emits if e[0] == V3_ERROR_ADDRESS]


def _acks(emits):
    """Just the ``/looping/v3/simpler/replaced`` emits."""
    return [e for e in emits if e[0] == V3_SIMPLER_REPLACED_ADDRESS]


# --- stubs ----------------------------------------------------------------


class StubParameter:
    """DeviceParameter stub with a writable ``value`` attribute.

    ``raise_on_set`` simulates Live 12's quirk where LOM writes
    occasionally raise RuntimeError; the component swallows those.
    """

    def __init__(
        self,
        value: float = 0.0,
        raise_on_set: Optional[BaseException] = None,
    ):
        self._value = value
        self._raise_on_set = raise_on_set

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if self._raise_on_set is not None:
            raise self._raise_on_set
        self._value = v


class StubSimpler:
    """Simpler device exposing ``replace_sample(path)``. An instrument
    (``type`` 1), as Live reports it.

    Records every call; optionally raises a configured exception to
    simulate the LOM failure branches. ``parameters`` defaults to a
    6-long list so the Loop-enable path (index 5) has somewhere to
    write; pass a shorter list to exercise the out-of-range branch.
    """

    type = 1

    def __init__(
        self,
        raise_on_call: Optional[BaseException] = None,
        parameters: Optional[List["StubParameter"]] = None,
    ):
        self.replace_sample_calls: List[str] = []
        self._raise = raise_on_call
        self.parameters = (
            parameters if parameters is not None
            else [StubParameter() for _ in range(6)]
        )

    def replace_sample(self, path):
        self.replace_sample_calls.append(path)
        if self._raise is not None:
            raise self._raise


class LegacySimpler:
    """Pre-12.4 Simpler — lacks ``replace_sample`` entirely."""
    # Intentionally no replace_sample attribute.
    type = 1


class StubInstrument:
    """Another instrument (a default MIDI track's Operator)."""
    type = 1


class StubClip:
    """Clip stub with ``is_midi_clip`` + ``file_path``."""

    def __init__(self, *, is_midi: bool = False, file_path: str = "/tmp/a.wav"):
        self.is_midi_clip = is_midi
        self.file_path = file_path


class StubClipSlot:
    def __init__(self, clip: Optional[StubClip] = None):
        self._clip = clip

    @property
    def has_clip(self):
        return self._clip is not None

    @property
    def clip(self):
        return self._clip


class StubTrack:
    """Track with a device list + clip slot list, taking ``insert_device``
    and ``delete_device`` the way Live does. ``inserts`` queues the devices
    ``insert_device`` puts in, in order; empty, it puts in a fresh
    ``StubSimpler``. Live refuses a second instrument on a chain."""

    def __init__(self, devices=None, slots=None, inserts=None):
        self.devices = list(devices or ())
        self.clip_slots = list(slots or ())
        self.inserts = list(inserts or ())
        self.insert_calls: List[Tuple[str, Optional[int]]] = []
        self.delete_calls: List[int] = []
        self.raise_on_insert: Optional[BaseException] = None

    def insert_device(self, name, index=None):
        self.insert_calls.append((name, index))
        if self.raise_on_insert is not None:
            raise self.raise_on_insert
        if any(getattr(d, "type", None) == 1 for d in self.devices):
            raise RuntimeError(
                "Can not insert device %r: Device chains cannot have more "
                "than one instrument each." % name
            )
        device = self.inserts.pop(0) if self.inserts else StubSimpler()
        self.devices.insert(len(self.devices) if index is None else index, device)
        return device

    def delete_device(self, index):
        self.delete_calls.append(index)
        del self.devices[index]


class StubView:
    def __init__(self):
        self.selected_track: Optional[StubTrack] = None


class StubSong:
    """Tracks ``create_midi_track`` calls; inserts a tracked track.

    Also models ``move_device`` for the Random Start prepend tests:
    removes ``device`` from its current position and re-inserts on
    the destination ``target`` track at ``target_index``. Live's
    real ``move_device`` removes the source first and then inserts,
    matching this stub's behavior for index-after-remove math.
    """

    def __init__(self, tracks=None):
        self.tracks: list = list(tracks or ())
        self.view = StubView()
        self.create_midi_calls: List[int] = []
        self._raise_create: Optional[BaseException] = None
        # What the created MIDI track will carry, and what insert_device
        # puts on it — overwritten per-test.
        self.new_track_devices: List[object] = []
        self.new_track_inserts: List[object] = []
        self.undo_steps: List[str] = []
        # move_device call log + optional raise for failure tests.
        self.move_device_calls: List[Tuple[object, object, int]] = []
        self._raise_move: Optional[BaseException] = None

    def create_midi_track(self, index: int) -> None:
        self.create_midi_calls.append(index)
        if self._raise_create is not None:
            raise self._raise_create
        new_track = StubTrack(
            devices=list(self.new_track_devices),
            inserts=list(self.new_track_inserts),
        )
        # Insert at the requested position; Live's semantics for -1 is
        # "append," but this component never sends -1 (it computes
        # source_idx + 1), so we only support non-negative inserts.
        self.tracks.insert(index, new_track)

    def begin_undo_step(self):
        self.undo_steps.append("begin")

    def end_undo_step(self):
        self.undo_steps.append("end")

    def move_device(self, device, target, target_index):
        if self._raise_move is not None:
            raise self._raise_move
        self.move_device_calls.append((device, target, target_index))
        # Find which track currently holds the device and remove.
        for tr in self.tracks:
            if device in tr.devices:
                tr.devices.remove(device)
                break
        target.devices.insert(target_index, device)


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    """Captures every ``(address, args)`` the component emits."""
    return []


@pytest.fixture
def emit(emits):
    return lambda addr, args: emits.append((addr, args))


@pytest.fixture
def audio_clip_song():
    """Two-track song: tracks[0] audio with a clip at slots[0]."""
    clip = StubClip(is_midi=False, file_path="/tmp/sample.wav")
    track0 = StubTrack(slots=[StubClipSlot(clip), StubClipSlot()])
    track1 = StubTrack()  # arbitrary second track; not used
    song = StubSong(tracks=[track0, track1])
    return song, clip


def _make(song, emit):
    """Construct the component under test."""
    return SimplerLoadComponent(song=song, emit=emit)


# --- address constant -----------------------------------------------------


def test_address_constant_stable():
    assert V3_SIMPLER_REPLACE_SAMPLE_ADDRESS == "/looping/v3/simpler/replace_sample"


# --- happy path -----------------------------------------------------------


def test_happy_path_creates_midi_track_and_replaces_sample(
    audio_clip_song, emit, emits,
):
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    # The Simpler Live puts in on ``insert_device``.
    song.new_track_inserts = [simpler]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    # New MIDI track inserted at source_idx + 1 = 1.
    assert song.create_midi_calls == [1]
    # A Simpler inserted by name on the new track.
    assert song.tracks[1].insert_calls == [("Simpler", 0)]
    # replace_sample called with the audio clip's file_path.
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    # Silent on the wire.
    assert _errors(emits) == []


# --- arg parsing / bad input ---------------------------------------------


def test_arg_count_not_one_emits_replace_sample_failed(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    c = _make(song, emit)
    c.handle_replace_sample((), None)
    assert len(emits) == 1
    address, (inner_addr, code, path, detail) = emits[0]
    assert address == V3_ERROR_ADDRESS
    assert inner_addr == V3_SIMPLER_REPLACE_SAMPLE_ADDRESS
    assert code == V3_ERROR_REPLACE_SAMPLE_FAILED
    assert "arg-count" in detail


def test_empty_clippath_emits_clip_not_found(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    c = _make(song, emit)
    c.handle_replace_sample(("",), None)
    assert len(emits) == 1
    _, (_, code, _, detail) = emits[0]
    assert code == V3_ERROR_CLIP_NOT_FOUND
    assert detail == "empty-clip-path"


def test_malformed_clippath_emits_clip_not_found(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    c = _make(song, emit)
    c.handle_replace_sample(("not/a/real/path/shape",), None)
    assert len(emits) == 1
    _, (_, code, _, _) = emits[0]
    assert code == V3_ERROR_CLIP_NOT_FOUND


def test_clippath_out_of_range_emits_clip_not_found(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    c = _make(song, emit)
    # 99 tracks beyond song.tracks; resolver says NOT_FOUND.
    c.handle_replace_sample(("tracks/99/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, _, _) = emits[0]
    assert code == V3_ERROR_CLIP_NOT_FOUND


# --- midi clip rejection --------------------------------------------------


def test_midi_clip_rejected_as_not_audio_clip(
    emit, emits,
):
    midi_clip = StubClip(is_midi=True, file_path="")
    track0 = StubTrack(slots=[StubClipSlot(midi_clip)])
    song = StubSong(tracks=[track0])
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, _, _) = emits[0]
    assert code == V3_ERROR_NOT_AUDIO_CLIP
    assert song.create_midi_calls == []


# --- file_path branches ---------------------------------------------------


def test_audio_clip_with_empty_file_path_emits_no_file_path(
    emit, emits,
):
    clip = StubClip(is_midi=False, file_path="")
    track0 = StubTrack(slots=[StubClipSlot(clip)])
    song = StubSong(tracks=[track0])
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, _, _) = emits[0]
    assert code == V3_ERROR_NO_FILE_PATH


def test_file_path_read_raising_runtimeerror_emits_no_file_path(
    emit, emits,
):
    class RaisingClip:
        is_midi_clip = False

        @property
        def file_path(self):
            raise RuntimeError("torn down")

    track0 = StubTrack(slots=[StubClipSlot(RaisingClip())])
    song = StubSong(tracks=[track0])
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, _, _) = emits[0]
    assert code == V3_ERROR_NO_FILE_PATH


# --- insert_device branches ---------------------------------------------


def test_insert_raising_emits_insert_failed(audio_clip_song, emit, emits):
    song, _ = audio_clip_song

    real_create = song.create_midi_track

    def create_then_refuse(index):
        real_create(index)
        song.tracks[index].raise_on_insert = RuntimeError("insert refused")

    song.create_midi_track = create_then_refuse
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, path, detail) = emits[0]
    assert code == V3_ERROR_INSERT_FAILED
    assert path == "/tmp/sample.wav"
    assert "RuntimeError" in detail
    # MIDI track was created before the insert; we don't roll that back.
    assert song.create_midi_calls == [1]
    # The undo step closes even though the insert failed.
    assert song.undo_steps == ["begin", "end"]


def test_insert_goes_in_as_simpler_at_the_head_of_an_empty_track(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    new_track = song.tracks[1]
    assert new_track.insert_calls == [("Simpler", 0)]
    assert new_track.delete_calls == []
    assert new_track.devices[0].replace_sample_calls == ["/tmp/sample.wav"]
    assert song.undo_steps == ["begin", "end"]
    assert _errors(emits) == []


def test_instrument_already_on_the_track_is_replaced(audio_clip_song, emit, emits):
    """A default MIDI track comes with an instrument (the rig's Operator).
    Live refuses a second one, so it is deleted and the Simpler takes its
    slot — behind the MIDI effects, ahead of the audio effects."""
    song, _ = audio_clip_song
    arp = _NamedDevice("Arpeggiator")
    reverb = _NamedDevice("Reverb", kind=2)
    simpler = StubSimpler()
    song.new_track_devices = [arp, StubInstrument(), reverb]
    song.new_track_inserts = [simpler]
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    new_track = song.tracks[1]
    assert new_track.delete_calls == [1]
    assert new_track.insert_calls == [("Simpler", 1)]
    assert new_track.devices == [arp, simpler, reverb]
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _acks(emits)[0][1][1] == "tracks/1/devices/1"
    assert _errors(emits) == []


def test_simpler_goes_after_the_leading_midi_effects(audio_clip_song, emit, emits):
    song, _ = audio_clip_song
    arp = _NamedDevice("Arpeggiator")
    song.new_track_devices = [arp]
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    new_track = song.tracks[1]
    assert new_track.insert_calls == [("Simpler", 1)]
    assert new_track.devices[0] is arp
    assert _errors(emits) == []


# --- create_midi_track branches ------------------------------------------


def test_create_midi_track_raises_emits_create_failed(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    song._raise_create = RuntimeError("cannot create")
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, _, detail) = emits[0]
    assert code == V3_ERROR_CREATE_FAILED
    assert "RuntimeError" in detail
    # Nothing inserted because the create failed.
    assert all(t.insert_calls == [] for t in song.tracks)


# --- device presence on new track ----------------------------------------


def test_device_without_replace_sample_emits_replace_sample_missing(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    song.new_track_inserts = [LegacySimpler()]
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, _, detail) = emits[0]
    assert code == V3_ERROR_REPLACE_SAMPLE_MISSING
    assert "12.4" in detail


def test_replace_sample_raises_emits_replace_sample_failed(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    song.new_track_inserts = [StubSimpler(raise_on_call=RuntimeError("file unreadable"))]
    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert len(emits) == 1
    _, (_, code, path, detail) = emits[0]
    assert code == V3_ERROR_REPLACE_SAMPLE_FAILED
    assert path == "/tmp/sample.wav"
    assert "RuntimeError" in detail


# --- lifecycle ------------------------------------------------------------


def test_disconnect_silences_subsequent_calls(
    audio_clip_song, emit, emits,
):
    song, _ = audio_clip_song
    song.new_track_inserts = [StubSimpler()]
    c = _make(song, emit)
    c.disconnect()
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    assert emits == []
    assert song.create_midi_calls == []


def test_disconnect_is_idempotent(audio_clip_song, emit):
    song, _ = audio_clip_song
    c = _make(song, emit)
    c.disconnect()
    c.disconnect()
    c.disconnect()


# ===========================================================================
# handle_replace_sample_onto_track — capture-flow sibling
# ===========================================================================
#
# The capture flow skips clip resolution + adjacent-track creation. Caller
# already has a prepared MIDI track and a filesystem path. Shared helper
# `_load_simpler_onto_track` powers the tail of both handlers, so the
# existing tests above cover the insert / Simpler-missing / raise
# branches for this handler too. Tests below focus on the arg-shape and
# track-path-resolution layers unique to this handler.


def _make_capture_song(tracks_count=2, devices=None, inserts=None):
    """Song with `tracks_count` pre-existing tracks. The 'prepared track' the
    handler targets is the last (just like the UI's prepareTrack('midi')
    would select the newly created track): `devices` are already on it,
    `inserts` are what its ``insert_device`` puts in.
    """
    tracks = [StubTrack() for _ in range(tracks_count)]
    tracks[-1].devices = list(devices or ())
    tracks[-1].inserts = list(inserts or ())
    song = StubSong(tracks=tracks)
    return song


def test_onto_track_address_constant_stable():
    assert V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS == \
        "/looping/v3/simpler/replace_sample_onto_track"


def test_onto_track_happy_path_invokes_replace_sample(
    emit, emits,
):
    # Track 1 is the 'prepared' MIDI track the UI just created via
    # prepareTrack('midi').
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    c = _make(song, emit)

    c.handle_replace_sample_onto_track(
        ("tracks/1", "/tmp/capture.wav"), None,
    )

    # A Simpler inserted by name on the prepared track (idx 1).
    assert song.tracks[1].insert_calls == [("Simpler", 0)]
    # replace_sample called with the captured filepath.
    assert simpler.replace_sample_calls == ["/tmp/capture.wav"]
    # No error emitted — capture-flow success is silent, same as
    # clip-flow success.
    assert _errors(emits) == []
    # Crucially: no new MIDI track created. The caller already prepared
    # one; this handler just loads onto it.
    assert song.create_midi_calls == []


def test_onto_track_wrong_arg_count_emits_failed(
    emit, emits,
):
    song = _make_capture_song()
    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1",), None)  # 1 arg, needs 2
    assert len(emits) == 1
    _, (origin_addr, code, _, detail) = emits[0]
    assert origin_addr == V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    assert code == V3_ERROR_REPLACE_SAMPLE_FAILED
    assert "arg-count" in detail


def test_onto_track_empty_track_path_emits_track_index_unresolved(
    emit, emits,
):
    song = _make_capture_song()
    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("", "/tmp/x.wav"), None)
    assert len(emits) == 1
    _, (origin_addr, code, _, detail) = emits[0]
    assert origin_addr == V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    assert code == V3_ERROR_TRACK_INDEX_UNRESOLVED
    assert detail == "empty-track-path"


def test_onto_track_empty_file_path_emits_no_file_path(
    emit, emits,
):
    song = _make_capture_song()
    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", ""), None)
    assert len(emits) == 1
    _, (origin_addr, code, _, detail) = emits[0]
    assert origin_addr == V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    assert code == V3_ERROR_NO_FILE_PATH
    assert detail == "empty-file-path"


def test_onto_track_malformed_track_path_emits_track_index_unresolved(
    emit, emits,
):
    song = _make_capture_song()
    c = _make(song, emit)
    c.handle_replace_sample_onto_track(
        ("not-a-track-path", "/tmp/x.wav"), None,
    )
    assert len(emits) == 1
    _, (origin_addr, code, _, detail) = emits[0]
    assert origin_addr == V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    assert code == V3_ERROR_TRACK_INDEX_UNRESOLVED
    assert detail == "expected tracks/<N>"


def test_onto_track_index_out_of_range_emits_track_index_unresolved(
    emit, emits,
):
    song = _make_capture_song(tracks_count=2)  # tracks/0 and tracks/1 only
    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/99", "/tmp/x.wav"), None)
    assert len(emits) == 1
    _, (origin_addr, code, _, detail) = emits[0]
    assert origin_addr == V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    assert code == V3_ERROR_TRACK_INDEX_UNRESOLVED
    assert detail == "index-out-of-range"


def test_onto_track_device_without_replace_sample_emits_missing(
    emit, emits,
):
    song = _make_capture_song(
        tracks_count=2, inserts=[LegacySimpler()],
    )
    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/x.wav"), None)
    assert len(emits) == 1
    _, (origin_addr, code, _, _) = emits[0]
    assert origin_addr == V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS
    assert code == V3_ERROR_REPLACE_SAMPLE_MISSING


def test_onto_track_disconnect_silences(
    emit, emits,
):
    song = _make_capture_song(
        tracks_count=2, inserts=[StubSimpler()],
    )
    c = _make(song, emit)
    c.disconnect()
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/x.wav"), None)
    assert emits == []


# --- post-replace: parameters[5].value = 1.0 ("S Loop On") ----------------


def test_happy_path_enables_loop_parameter(
    audio_clip_song, emit, emits,
):
    """Clip flow: new sample defaults to Loop-on (Simpler param index 5)."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert simpler.parameters[5].value == 1.0
    assert _errors(emits) == []


def test_onto_track_enables_loop_parameter(
    emit, emits,
):
    """Capture flow: recorded sample defaults to Loop-on."""
    simpler = StubSimpler()
    song = _make_capture_song(
        tracks_count=2, inserts=[simpler],
    )

    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert simpler.replace_sample_calls == ["/tmp/capture.wav"]
    assert simpler.parameters[5].value == 1.0
    assert _errors(emits) == []


def test_loop_enable_runtime_error_is_swallowed(
    audio_clip_song, emit, emits,
):
    """LOM RuntimeError on param write must not raise or emit."""
    song, _clip = audio_clip_song
    params = [StubParameter() for _ in range(6)]
    params[5] = StubParameter(raise_on_set=RuntimeError("LOM not ready"))
    simpler = StubSimpler(parameters=params)
    song.new_track_inserts = [simpler]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


def test_loop_enable_short_parameters_list_is_noop(
    audio_clip_song, emit, emits,
):
    """If parameters list is shorter than 6, skip the write silently."""
    song, _clip = audio_clip_song
    # Only 3 parameters — no index 5 to write to.
    simpler = StubSimpler(parameters=[StubParameter() for _ in range(3)])
    song.new_track_inserts = [simpler]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


class _NamedDevice:
    """Minimal device stub with a ``name`` and a ``type`` (a MIDI effect,
    4, unless told otherwise), standing in for devices already on a track."""
    def __init__(self, name: str, kind: int = 4):
        self.name = name
        self.type = kind


def test_capture_flow_dedupes_same_track_and_file(
    emit, emits,
):
    """Two identical capture calls within TTL → first runs, second is silently
    dropped. No second insert, no second replace_sample, no error on
    the wire. Random Start prepend is now DeviceInitComponent's responsibility
    (ADR-378), not the replace_sample handler's."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])

    c = _make(song, emit)
    args = ("tracks/1", "/tmp/capture.wav")
    c.handle_replace_sample_onto_track(args, None)
    c.handle_replace_sample_onto_track(args, None)  # broadcast double

    assert len(song.tracks[1].insert_calls) == 1
    assert simpler.replace_sample_calls == ["/tmp/capture.wav"]
    assert _errors(emits) == []
    # One gesture, one ack — the dropped duplicate must not re-announce.
    assert len(_acks(emits)) == 1


def test_clip_flow_dedupes_same_track_and_file(
    audio_clip_song, emit, emits,
):
    """Same dedupe coverage for the audio-clip → Simpler flow. The second
    call also creates no extra MIDI track. Random Start prepend is now
    DeviceInitComponent's responsibility (ADR-378)."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)  # double

    # Wire-entry dedupe: second call drops before any LOM mutation runs,
    # so no extra MIDI track is created.
    assert song.create_midi_calls == [1]
    assert len(song.tracks[1].insert_calls) == 1
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []
    assert len(_acks(emits)) == 1


def test_capture_flow_different_file_on_same_track_passes(
    emit, emits,
):
    """Legitimate retake: same track, different file → both calls run.
    Dedupe key is (track, file), not just track. Random Start prepend is
    now DeviceInitComponent's responsibility (ADR-378)."""
    simpler1 = StubSimpler()
    simpler2 = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler1, simpler2])
    target_track = song.tracks[1]

    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/take1.wav"), None)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/take2.wav"), None)

    # The retake replaces the first take's Simpler with a fresh one, as
    # the old preset load through the browser did.
    assert target_track.delete_calls == [0]
    assert target_track.insert_calls == [("Simpler", 0), ("Simpler", 0)]
    assert target_track.devices == [simpler2]
    assert simpler1.replace_sample_calls == ["/tmp/take1.wav"]
    assert simpler2.replace_sample_calls == ["/tmp/take2.wav"]
    assert _errors(emits) == []


def test_dedupe_window_clears_after_ttl(
    emit, monkeypatch,
):
    """After the TTL window elapses the same (track, file) call goes through
    again. Verifies time-based eviction (otherwise a stuck entry would
    permanently lock out a track + file combo)."""
    from components import SimplerLoadComponent as mod

    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    fake_now = [1000.0]
    monkeypatch.setattr(mod.time, "monotonic", lambda: fake_now[0])

    c = _make(song, emit)
    args = ("tracks/1", "/tmp/capture.wav")
    c.handle_replace_sample_onto_track(args, None)
    assert len(song.tracks[1].insert_calls) == 1

    # Within TTL → dropped.
    fake_now[0] += mod._DEDUPE_TTL_SECONDS - 0.1
    c.handle_replace_sample_onto_track(args, None)
    assert len(song.tracks[1].insert_calls) == 1  # unchanged

    # Past TTL → fires again.
    fake_now[0] += 1.0
    c.handle_replace_sample_onto_track(args, None)
    assert len(song.tracks[1].insert_calls) == 2


def test_disconnect_clears_dedupe(
    emit,
):
    """``disconnect`` wipes the in-flight dict so a reconnect starts fresh.
    Tests the cleanup path; production lifecycle re-creates the component
    per surface init, but disconnect-then-call would otherwise be a
    silent dropped load."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    c = _make(song, emit)
    args = ("tracks/1", "/tmp/capture.wav")
    c.handle_replace_sample_onto_track(args, None)
    assert len(song.tracks[1].insert_calls) == 1
    c.disconnect()
    # Post-disconnect calls are no-ops via the existing disconnected
    # gate; nothing about dedupe changes that.
    c.handle_replace_sample_onto_track(args, None)
    assert len(song.tracks[1].insert_calls) == 1
    # The dict itself was cleared (white-box check on internal state).
    assert c._inflight == {}


def test_replaced_address_constant_stable():
    assert V3_SIMPLER_REPLACED_ADDRESS == "/looping/v3/simpler/replaced"


def test_clip_flow_emits_replaced_ack(
    audio_clip_song, emit, emits,
):
    """Convert flow: ack carries its own origin address, the new MIDI
    track's Simpler path, and the clip's file_path."""
    song, _clip = audio_clip_song
    song.new_track_inserts = [StubSimpler()]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    # Source audio track is idx 0, so the new MIDI track is idx 1.
    assert _acks(emits) == [(
        V3_SIMPLER_REPLACED_ADDRESS,
        (
            V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
            "tracks/1/devices/0",
            "/tmp/sample.wav",
        ),
    )]


def test_capture_flow_emits_replaced_ack(
    emit, emits,
):
    """Capture flow: same ack, stamped with the onto-track address so the
    UI can tell the two gestures apart."""
    song = _make_capture_song(tracks_count=2, inserts=[StubSimpler()])

    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert _acks(emits) == [(
        V3_SIMPLER_REPLACED_ADDRESS,
        (
            V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
            "tracks/1/devices/0",
            "/tmp/capture.wav",
        ),
    )]


def test_ack_device_path_skips_a_head_loaded_midi_effect(
    emit, emits,
):
    """The ack's devicePath is the Simpler's real slot, not a hardcoded 0.

    A track that already carries Random Start puts the utility at index 0
    and the Simpler at index 1 — the UI subscribes on this path, so an
    off-by-one here would silently break auto-trim on exactly the tracks
    the prepend has touched.
    """
    simpler = StubSimpler()
    song = _make_capture_song(
        tracks_count=2,
        devices=[_NamedDevice("random-start")], inserts=[simpler],
    )

    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert simpler.replace_sample_calls == ["/tmp/capture.wav"]
    assert _acks(emits)[0][1][1] == "tracks/1/devices/1"


def test_ack_lands_after_post_load_defaults_are_written(
    emit, emits,
):
    """Ordering guard: Loop-on and slicing-mode are written before the ack.

    The UI reads the Simpler off the back of this message, so anything the
    handler still intends to write has to be in place first.
    """
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    seen_at_emit = {}

    def recording_emit(addr, args):
        emits.append((addr, args))
        if addr == V3_SIMPLER_REPLACED_ADDRESS:
            seen_at_emit["loop"] = simpler.parameters[5].value
            seen_at_emit["slicing"] = simpler.slicing_playback_mode

    c = _make(song, recording_emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert seen_at_emit == {"loop": 1.0, "slicing": 2}


def test_no_ack_when_replace_sample_raises(
    audio_clip_song, emit, emits,
):
    """A failed load emits an error and no ack — the UI must not treat a
    failure as a landed sample."""
    song, _clip = audio_clip_song
    song.new_track_inserts = [StubSimpler(raise_on_call=RuntimeError("nope"))]

    c = _make(song, emit)
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert _acks(emits) == []
    assert [e[1][1] for e in _errors(emits)] == [V3_ERROR_REPLACE_SAMPLE_FAILED]


def test_no_ack_when_the_insert_is_refused(emit, emits):
    song = _make_capture_song(tracks_count=2)
    song.tracks[1].raise_on_insert = RuntimeError("refused")

    c = _make(song, emit)
    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert _acks(emits) == []
    assert [e[1][1] for e in _errors(emits)] == [V3_ERROR_INSERT_FAILED]
