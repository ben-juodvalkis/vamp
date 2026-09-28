"""TrackMetadataComponent.volume — ROW 2-F3 mixer-param writer.

Covers the ``/looping/v3/track/volume`` extension added on top of the
PR-5a eight-attribute base. Volume differs from the other eight because
it lives on ``track.mixer_device.volume.value`` rather than a direct
``Track`` attribute — listener attach, read, and write all route
through the mixer-device parameter.

These tests use a volume-enabled StubTrack (adds ``mixer_device.volume``
as a ``StubMixerParam``); the rest of the track-metadata surface stays
on the plain attribute path and is exercised in
``test_track_metadata_component.py``.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.GenerationComponent import GenerationComponent
from components.TrackMetadataComponent import (
    TrackMetadataComponent,
    V3_ERROR_ADDRESS,
    V3_ERROR_WRITE_REJECTED,
    V3_TRACK_VOLUME_ADDRESS,
)


class StubMixerParam:
    """Mirror of ``master.mixer_device.volume`` — one listener slot."""

    def __init__(self, value: float = 0.85):
        self.value = value
        self._listener = None
        self._raise_on_set = False

    def __setattr__(self, name, value):
        if (
            name == "value"
            and self.__dict__.get("_raise_on_set")
        ):
            raise RuntimeError("LOM rejects volume=%r" % value)
        object.__setattr__(self, name, value)
        if (
            name == "value"
            and self.__dict__.get("_listener") is not None
        ):
            self._listener()

    def add_value_listener(self, cb):
        assert self._listener is None, "one listener slot"
        self._listener = cb

    def remove_value_listener(self, cb):
        assert self._listener is cb, "detaching unattached listener"
        self._listener = None


class StubMixer:
    def __init__(self, volume: float = 0.85):
        self.volume = StubMixerParam(volume)


class StubTrack:
    """Minimum-viable track with just the mixer-device hook.

    The eight PR-5a attrs are present but unexercised here — their
    dedicated coverage is in ``test_track_metadata_component.py``.
    The stub exposes listener methods for those attrs so the component's
    ``_bind_track`` walk doesn't emit DEBUG noise on attach.
    """

    _ATTRS = (
        "name", "color", "arm", "mute", "solo", "panning",
        "input_routing_type", "input_routing_channel",
    )

    def __init__(self, volume: float = 0.85):
        self.name = "T"
        self.color = 0
        self.arm = False
        self.mute = False
        self.solo = False
        self.panning = 0.0
        self.input_routing_type = "Ext. In"
        self.input_routing_channel = "1/2"
        self.mixer_device = StubMixer(volume)
        self._listeners = {a: None for a in self._ATTRS}
        self._arrangement_clips_listener = None
        self.arrangement_clips = ()

    def _make_add(attr):  # noqa: N805
        def add(self, cb):
            self._listeners[attr] = cb
        return add

    def _make_remove(attr):  # noqa: N805
        def remove(self, cb):
            self._listeners[attr] = None
        return remove

    for _a in _ATTRS:
        locals()["add_%s_listener" % _a] = _make_add(_a)
        locals()["remove_%s_listener" % _a] = _make_remove(_a)
    del _make_add, _make_remove, _a

    def add_arrangement_clips_listener(self, cb):
        self._arrangement_clips_listener = cb

    def remove_arrangement_clips_listener(self, cb):
        self._arrangement_clips_listener = None


class StubSong:
    def __init__(self, tracks: List[StubTrack]):
        self.tracks = list(tracks)


class EmitRecorder:
    def __init__(self):
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address: str, args) -> None:
        self.emissions.append((address, tuple(args)))

    def only(self, address: str):
        return [p for a, p in self.emissions if a == address]

    def errors(self):
        return self.only(V3_ERROR_ADDRESS)


@pytest.fixture
def song():
    return StubSong(tracks=[StubTrack(volume=0.5), StubTrack(volume=0.9)])


@pytest.fixture
def recorder():
    return EmitRecorder()


@pytest.fixture
def component(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    yield c
    c.disconnect()


# --- listener attach ------------------------------------------------------


def test_volume_listener_attaches_on_every_track(component, song):
    for t in song.tracks:
        assert t.mixer_device.volume._listener is not None


def test_outside_volume_edit_fires_listener(component, song, recorder):
    # Simulate an outside edit — fader moved in Ableton, not via the wire.
    song.tracks[1].mixer_device.volume.value = 0.42
    emits = recorder.only(V3_TRACK_VOLUME_ADDRESS)
    assert emits == [("tracks/1", 0.42)]


# --- handle_set_volume ----------------------------------------------------


def test_set_volume_writes_and_suppresses_echo(component, song, recorder):
    component.handle_set_volume(
        args=("tracks/0", 0.7), source_addr=None,
    )
    assert song.tracks[0].mixer_device.volume.value == 0.7
    # Echo is suppressed — no self-fire on the wire.
    assert recorder.only(V3_TRACK_VOLUME_ADDRESS) == []
    assert recorder.errors() == []


def test_set_volume_out_of_range_high_rejects(component, song, recorder):
    component.handle_set_volume(
        args=("tracks/0", 1.5), source_addr=None,
    )
    assert song.tracks[0].mixer_device.volume.value == 0.5  # unchanged
    errors = recorder.errors()
    assert len(errors) == 1
    _addr, code, path, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0"
    assert "1.5" in detail


def test_set_volume_negative_rejects(component, song, recorder):
    component.handle_set_volume(
        args=("tracks/0", -0.1), source_addr=None,
    )
    assert song.tracks[0].mixer_device.volume.value == 0.5
    assert len(recorder.errors()) == 1


def test_set_volume_nan_rejects(component, song, recorder):
    component.handle_set_volume(
        args=("tracks/0", float("nan")), source_addr=None,
    )
    assert song.tracks[0].mixer_device.volume.value == 0.5
    assert len(recorder.errors()) == 1


def test_set_volume_non_numeric_rejects(component, song, recorder):
    component.handle_set_volume(
        args=("tracks/0", "loud"), source_addr=None,
    )
    assert song.tracks[0].mixer_device.volume.value == 0.5
    assert len(recorder.errors()) == 1


def test_set_volume_master_path_rejected_as_not_supported(
    component, song, recorder,
):
    component.handle_set_volume(args=("master", 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _addr, code, path, _detail = errors[0]
    assert code == "path-not-supported"
    assert path == "master"


def test_set_volume_missing_path_arg_rejected(component, recorder):
    component.handle_set_volume(args=(), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _addr, code, _path, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert "trackPath" in detail


def test_set_volume_lom_reject_roundtrips_as_write_rejected(
    component, song, recorder,
):
    song.tracks[0].mixer_device.volume._raise_on_set = True
    component.handle_set_volume(
        args=("tracks/0", 0.7), source_addr=None,
    )
    errors = recorder.errors()
    assert len(errors) == 1
    _addr, code, path, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0"
    assert "lom rejected" in detail


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_mixer_listener(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    for t in song.tracks:
        assert t.mixer_device.volume._listener is not None
    c.disconnect()
    for t in song.tracks:
        assert t.mixer_device.volume._listener is None


def test_disconnected_set_volume_is_noop(component, song):
    component.disconnect()
    component.handle_set_volume(
        args=("tracks/0", 0.3), source_addr=None,
    )
    assert song.tracks[0].mixer_device.volume.value == 0.5  # unchanged


# --- wire address constant ------------------------------------------------


def test_volume_wire_address_is_stable():
    assert V3_TRACK_VOLUME_ADDRESS == "/looping/v3/track/volume"
