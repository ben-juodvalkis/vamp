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


class StubDeviceLoad:
    """Stand-in for DeviceLoadComponent used by the Random Start prepend
    path. Records every ``load_into_track`` call and appends a configured
    device onto the target track to simulate the browser-driven load.

    ``error`` overrides the success path so we can exercise the
    "browser returned a string error" branch (e.g. path-not-found).
    """

    def __init__(
        self,
        device_to_append: Optional[object] = None,
        error: Optional[str] = None,
        land: str = "head",
    ):
        self.calls: List[Tuple[object, str]] = []
        self.named: List[Tuple[str, str]] = []
        self._device = device_to_append
        self._error = error
        # Where Live puts a MIDI effect loaded through the browser: at the
        # head of the chain, ahead of the instrument (measured 2026-09-11).
        # ``"end"`` models a load that landed behind it instead.
        self._land = land

    def load_into_track(
        self, track, preset_path: str, at_head: bool = False,
        source: str = "", rel: str = "",
    ):
        self.calls.append((track, preset_path))
        self.named.append((source, rel))
        if self._error is not None:
            return self._error
        if self._device is not None:
            if self._land == "head":
                track.devices.insert(0, self._device)
            else:
                track.devices.append(self._device)
        return None


# --- fixtures -------------------------------------------------------------


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


def _make(
    song, emit,
    random_start_path: str = "",
    device_loader=None,
):
    """Construct the component under test.

    ``random_start_path`` defaults to empty so the broad existing test
    suite (which doesn't care about the prepend) runs untouched: an
    empty path makes ``_ensure_random_start`` a silent no-op. Tests
    that exercise the prepend pass a non-empty path and a
    ``device_loader`` resolver returning a ``StubDeviceLoad``.
    """
    resolve = (lambda: device_loader) if device_loader is not None else None
    return SimplerLoadComponent(
        song=song,
        emit=emit,
        random_start_device_path=random_start_path,
        resolve_device_loader=resolve,
    )


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


# --- post-replace: Random Start prepend -----------------------------------
#
# Both Simpler-load flows (clip + capture) prepend a Random Start MIDI
# utility before the freshly-loaded Simpler. Idempotent across reuse,
# silently disabled when the constants path is empty or the
# DeviceLoadComponent resolver returns None.


RANDOM_START_PATH = "/test/random-start.amxd"


class _NamedDevice:
    """Minimal device stub with a ``name`` and a ``type`` (a MIDI effect,
    4, unless told otherwise). Used to stand in for both Random Start
    (after the loader appends it) and existing track devices."""
    def __init__(self, name: str, kind: int = 4):
        self.name = name
        self.type = kind


def test_clip_flow_prepends_random_start_before_simpler(
    audio_clip_song, emit, emits,
):
    """ensure_random_start happy path: utility lands at index 0, Simpler
    shifts to index 1. Called directly (as DeviceInitComponent does) rather
    than as a side-effect of handle_replace_sample — ADR-378."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]
    # _NamedDevice doesn't carry a `parameters` list, so the post-load
    # zero-write helper finds no Random Amount and silently returns.
    # Tests that exercise the zero-write path use a richer stub below.
    rs_device = _NamedDevice("random-start")
    dlc = StubDeviceLoad(device_to_append=rs_device)

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    # The new MIDI track is at idx 1. Call ensure_random_start directly,
    # as DeviceInitComponent.on_device_added does after observing the insert.
    new_track = song.tracks[1]
    c.ensure_random_start(new_track)

    # Devices end up [RandomStart, Simpler].
    assert new_track.devices[0] is rs_device
    assert new_track.devices[1] is simpler
    # DeviceLoadComponent was invoked with the configured path on the new track.
    assert dlc.calls == [(new_track, RANDOM_START_PATH)]
    # The load names the "Vamp Devices" Place, like Permute and MidiWheels.
    assert dlc.named == [("place:Vamp Devices", "random-start/random-start.amxd")]
    # Live lands a MIDI effect at the head; nothing is moved (ADR-437).
    assert song.move_device_calls == []
    # Replace-sample still ran; no error on the wire.
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


def test_capture_flow_prepends_random_start_before_simpler(
    emit, emits,
):
    """ensure_random_start happy path on a capture-flow prepared track.
    Called directly, as DeviceInitComponent does (ADR-378)."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    rs_device = _NamedDevice("random-start")
    dlc = StubDeviceLoad(device_to_append=rs_device)

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample_onto_track(
        ("tracks/1", "/tmp/capture.wav"), None,
    )
    target_track = song.tracks[1]
    c.ensure_random_start(target_track)

    assert target_track.devices[0] is rs_device
    assert target_track.devices[1] is simpler
    assert dlc.calls == [(target_track, RANDOM_START_PATH)]
    assert simpler.replace_sample_calls == ["/tmp/capture.wav"]
    assert _errors(emits) == []


def test_random_start_prepend_is_idempotent_when_already_present(
    audio_clip_song, emit, emits,
):
    """Track that already carries a 'Random Start' device is left alone:
    no DLC call, no move_device. Mirrors Permute's idempotency posture."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    existing_rs = _NamedDevice("random-start")
    # Simulate a track that already has Random Start (e.g. capture-onto-track
    # called twice on the same prepared MIDI track).
    song.new_track_devices = [existing_rs]
    song.new_track_inserts = [simpler]
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert dlc.calls == []           # loader never invoked
    assert song.move_device_calls == []
    # The pre-existing chain is untouched (still [RandomStart, Simpler]).
    new_track = song.tracks[1]
    assert [getattr(d, "name", None) for d in new_track.devices] == [
        "random-start", None,  # StubSimpler has no .name attribute
    ]
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


def test_random_start_prepend_skipped_when_path_empty(
    audio_clip_song, emit, emits,
):
    """No constants config → no prepend attempt, no errors, Simpler still loads."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))

    c = _make(
        song, emit,
        random_start_path="", device_loader=dlc,  # path empty → disabled
    )
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert dlc.calls == []
    assert song.move_device_calls == []
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


def test_random_start_prepend_skipped_when_resolver_returns_none(
    audio_clip_song, emit, emits,
):
    """Resolver returning None (DLC mid-init or permanently absent) →
    silent skip. Simpler load still succeeds."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]

    c = SimplerLoadComponent(
        song=song,
        emit=emit,
        random_start_device_path=RANDOM_START_PATH,
        resolve_device_loader=lambda: None,
    )
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)

    assert song.move_device_calls == []
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


def test_random_start_load_failure_does_not_emit_or_break_simpler(
    audio_clip_song, emit, emits,
):
    """DLC returns an error string (e.g. browser miss) → warning logged,
    no error on the wire, no move_device call. Simpler load itself
    already succeeded so the user still sees the new sample.
    ensure_random_start called directly as DeviceInitComponent does (ADR-378)."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]
    dlc = StubDeviceLoad(error="not-in-browser")

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    new_track = song.tracks[1]
    c.ensure_random_start(new_track)

    assert dlc.calls == [(new_track, RANDOM_START_PATH)]
    assert song.move_device_calls == []
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


def test_random_start_behind_the_instrument_is_reported_not_moved(
    audio_clip_song, emit, emits,
):
    """A Random Start that Live put behind the Simpler stays there: a warning,
    no ``move_device`` (undoing the move of a device Live had just loaded
    aborts Live — ADR-437), no emit, Simpler still loaded."""
    song, _clip = audio_clip_song
    simpler = StubSimpler()
    song.new_track_inserts = [simpler]
    rs_device = _NamedDevice("random-start")
    dlc = StubDeviceLoad(device_to_append=rs_device, land="end")

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    new_track = song.tracks[1]
    c.ensure_random_start(new_track)

    assert dlc.calls == [(new_track, RANDOM_START_PATH)]
    assert new_track.devices[-1] is rs_device       # left where it landed
    assert song.move_device_calls == []
    assert simpler.replace_sample_calls == ["/tmp/sample.wav"]
    assert _errors(emits) == []


# --- duplicate-broadcast dedupe -------------------------------------------
#
# The bridge re-broadcasts every wire to all connected WS clients, so a
# user gesture lands as N identical Python invocations. Without dedupe,
# each one stacks another Simpler insert + Random Start prepend +
# normalize pass on the same track. Tests below pin the gate at the
# `_load_simpler_onto_track` boundary so both flow handlers benefit.


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


# --- post-prepend: Random Amount → 0 --------------------------------------


class _RandomStartDevice:
    """Random Start stub carrying a Random Amount parameter. Used to
    pin the zero-on-load behavior — a real .amxd ships at 50% per
    `@_parameter_initial 50.`, but we want fresh captures to start
    inert so the user opts into randomization explicitly."""
    def __init__(self, initial: float = 50.0):
        self.name = "random-start"
        self._random_amount = StubParameter(value=initial)
        # Other params don't matter; include a couple to verify the
        # name-based scan finds the right one.
        self.parameters = [
            StubParameter(value=0.0),  # arbitrary
            self._random_amount,
        ]
        self._random_amount.name = "Random Amount"
        self.parameters[0].name = "Bypass"

    @property
    def random_amount_value(self):
        return self._random_amount.value


def test_capture_flow_zeroes_random_amount_on_prepend(
    emit, emits,
):
    """After the prepend lands, Random Amount is forced to 0 so the
    device starts inert (overrides the .amxd's 50% init).
    ensure_random_start called directly as DeviceInitComponent does (ADR-378)."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    rs_device = _RandomStartDevice(initial=50.0)
    dlc = StubDeviceLoad(device_to_append=rs_device)

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample_onto_track(
        ("tracks/1", "/tmp/capture.wav"), None,
    )
    target_track = song.tracks[1]
    c.ensure_random_start(target_track)

    assert target_track.devices[0] is rs_device
    assert target_track.devices[1] is simpler
    assert rs_device.random_amount_value == 0
    assert _errors(emits) == []


def test_zero_random_amount_lom_error_does_not_break_load(
    emit, emits,
):
    """LOM RuntimeError on the param write is swallowed; Simpler load
    itself still succeeds silently."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    rs_device = _RandomStartDevice(initial=50.0)
    # Replace the Random Amount param with one that raises on set.
    raising = StubParameter(raise_on_set=RuntimeError("LOM not ready"))
    raising.name = "Random Amount"
    rs_device.parameters[1] = raising
    dlc = StubDeviceLoad(device_to_append=rs_device)

    c = _make(
        song, emit,
        random_start_path=RANDOM_START_PATH, device_loader=dlc,
    )
    c.handle_replace_sample_onto_track(
        ("tracks/1", "/tmp/capture.wav"), None,
    )

    # No error on the wire even though the zero-write raised.
    assert _errors(emits) == []
    assert simpler.replace_sample_calls == ["/tmp/capture.wav"]


# --- success ack (2026-09-17) ---------------------------------------------
#
# Both load flows emit ``/looping/v3/simpler/replaced [originAddress,
# devicePath, filePath]`` once the sample is on the Simpler. Before this,
# success was silent and the UI inferred the device by watching for the
# first ``sample.file_path`` property echo from a device path that hadn't
# existed when the gesture started — an inference the clip flow's adjacent
# track insert defeats whenever the shift lands the new Simpler on a path
# some other device already occupied.


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


# --- ack waits for the Random Start prepend (2026-09-27) ------------------
#
# DeviceInitComponent prepends Random Start on a deferred tick (ADR-378),
# at the head of the chain, so on a fresh track the Simpler moves from
# devices/0 to devices/1 after the handler has returned. Measured on the
# rig 2026-09-27: the ack named ``tracks/2/devices/0`` and the chain then
# read ``['random-start', 'Clap Aquarius']`` — the UI trimmed and
# subscribed on Random Start. The ack now waits for the prepend.


class _ManualScheduler:
    """``schedule_delayed`` stand-in: callbacks queue until ``tick()``,
    which runs what was queued before it, in order — as Live's
    ``schedule_message`` does one tick later."""

    def __init__(self):
        self.queue: List = []

    def __call__(self, delay_ms, fn):
        self.queue.append(fn)

    def tick(self):
        due, self.queue = self.queue, []
        for fn in due:
            fn()


def _make_settling(song, emit, dlc, scheduler):
    return SimplerLoadComponent(
        song=song,
        emit=emit,
        random_start_device_path=RANDOM_START_PATH,
        resolve_device_loader=lambda: dlc,
        schedule_delayed=scheduler,
    )


def test_ack_waits_for_random_start_and_names_the_shifted_simpler(emit, emits):
    """The rig's case: a fresh track, DeviceInitComponent's prepend queued
    during the insert, ahead of the ack's own wait. The ack goes out on
    that tick, at devices/1."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=3, inserts=[simpler])
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)
    track = song.tracks[2]
    # Queued by on_device_added during insert_device, before the handler returns.
    tick(0, lambda: c.ensure_random_start(track))

    c.handle_replace_sample_onto_track(("tracks/2", "/tmp/clap.wav"), None)
    assert _acks(emits) == []

    tick.tick()
    assert [getattr(d, "name", None) for d in track.devices] == ["random-start", None]
    assert _acks(emits) == [(
        V3_SIMPLER_REPLACED_ADDRESS,
        (V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS, "tracks/2/devices/1", "/tmp/clap.wav"),
    )]


def test_ack_waits_another_tick_when_the_prepend_is_queued_behind_it(emit, emits):
    """If the prepend lands a tick after the ack first looks, the ack
    looks again rather than naming the slot Random Start is about to take."""
    simpler = StubSimpler()
    song = _make_capture_song(tracks_count=2, inserts=[simpler])
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)
    track = song.tracks[1]

    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)
    tick(0, lambda: c.ensure_random_start(track))

    tick.tick()
    assert _acks(emits) == []
    tick.tick()
    assert _acks(emits)[0][1][1] == "tracks/1/devices/1"


def test_clip_flow_ack_waits_for_random_start(audio_clip_song, emit, emits):
    song, _clip = audio_clip_song
    song.new_track_inserts = [StubSimpler()]
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)

    c.handle_replace_sample(("tracks/0/slots/0/clip",), None)
    tick(0, lambda: c.ensure_random_start(song.tracks[1]))
    assert _acks(emits) == []

    tick.tick()
    tick.tick()
    assert _acks(emits) == [(
        V3_SIMPLER_REPLACED_ADDRESS,
        (V3_SIMPLER_REPLACE_SAMPLE_ADDRESS, "tracks/1/devices/1", "/tmp/sample.wav"),
    )]


def test_ack_goes_out_when_the_prepend_never_lands(emit, emits):
    """A failed prepend (browser miss) still gets its ack once the wait
    runs out, at the slot the Simpler actually holds."""
    song = _make_capture_song(tracks_count=2, inserts=[StubSimpler()])
    dlc = StubDeviceLoad(error="not-in-browser")
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)

    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)
    tick(0, lambda: c.ensure_random_start(song.tracks[1]))
    for _ in range(10):
        tick.tick()

    assert [a[1][1] for a in _acks(emits)] == ["tracks/1/devices/0"]
    assert tick.queue == []


def test_ack_is_immediate_when_random_start_is_already_there(emit, emits):
    """A reused track that already carries the utility has nothing to
    wait for."""
    song = _make_capture_song(
        tracks_count=2,
        devices=[_NamedDevice("random-start")], inserts=[StubSimpler()],
    )
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)

    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert [a[1][1] for a in _acks(emits)] == ["tracks/1/devices/1"]
    assert tick.queue == []


def test_ack_is_immediate_when_random_start_is_disabled(emit, emits):
    song = _make_capture_song(tracks_count=2, inserts=[StubSimpler()])
    tick = _ManualScheduler()
    c = SimplerLoadComponent(
        song=song, emit=emit,
        random_start_device_path="",
        resolve_device_loader=lambda: StubDeviceLoad(),
        schedule_delayed=tick,
    )

    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)

    assert [a[1][1] for a in _acks(emits)] == ["tracks/1/devices/0"]
    assert tick.queue == []


def test_ack_reads_the_track_index_when_it_goes_out(emit, emits):
    """A track inserted above while the ack waited moves the Simpler's
    track down one; the ack names where it is now."""
    song = _make_capture_song(tracks_count=2, inserts=[StubSimpler()])
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)
    track = song.tracks[1]

    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)
    song.tracks.insert(0, StubTrack())
    c.ensure_random_start(track)
    tick.tick()

    assert [a[1][1] for a in _acks(emits)] == ["tracks/2/devices/1"]


def test_no_ack_after_disconnect_while_waiting(emit, emits):
    song = _make_capture_song(tracks_count=2, inserts=[StubSimpler()])
    dlc = StubDeviceLoad(device_to_append=_NamedDevice("random-start"))
    tick = _ManualScheduler()
    c = _make_settling(song, emit, dlc, tick)

    c.handle_replace_sample_onto_track(("tracks/1", "/tmp/capture.wav"), None)
    c.disconnect()
    for _ in range(10):
        tick.tick()

    assert _acks(emits) == []


def test_random_start_is_the_checkouts_own_device():
    """With no config, Random Start is the checkout's own .amxd inside the
    "Vamp Devices" Place (2026-09-27); a configured path still wins."""
    import os
    from components import live_library
    derived = live_library.device_path(live_library.RANDOM_START_REL)
    assert os.path.isfile(derived)
    assert derived.endswith(os.path.join("Vamp Devices", "random-start", "random-start.amxd"))
    assert live_library.device_path(live_library.RANDOM_START_REL, "/x/rs.adv") == "/x/rs.adv"
