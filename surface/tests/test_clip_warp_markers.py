"""Warp markers on the focused audio clip: ``clip/warp_markers`` out,
``clip/warp_marker/move`` in (``ClipPropertiesComponent``)."""

from __future__ import annotations

import pytest

from components.ClipPropertiesComponent import (
    ClipPropertiesComponent,
    V3_CLIP_WARP_MARKERS_ADDRESS,
)
from tests.test_clip_properties_component import ClipStubSong
from tests.test_lom_listeners import StubTrack
from tests.test_path_resolver import StubClipSlot


class Marker:
    def __init__(self, beat_time, sample_time):
        self.beat_time = beat_time
        self.sample_time = sample_time


class AudioClip:
    """An audio clip with Live's warp surface: ``warp_markers`` and
    ``warping`` observable, ``move_warp_marker`` moving a marker's beat
    and clamping it short of its neighbors, as measured on the rig."""

    def __init__(self, cid, markers, warping=True, is_audio=True):
        self._live_ptr = cid
        self.name = "clip"
        self.is_audio_clip = is_audio
        self.sample_rate = 48000.0
        self.sample_length = 48000 * 8
        self._warping = warping
        self._markers = [Marker(b, s) for b, s in markers]
        self.listeners = {"warp_markers": [], "warping": []}
        self.moves = []
        self.move_raises = False

    @property
    def warping(self):
        return self._warping

    @property
    def warp_markers(self):
        return list(self._markers)

    def set_warping(self, value):
        self._warping = value
        for cb in list(self.listeners["warping"]):
            cb()

    def move_warp_marker(self, beat_time, distance):
        self.moves.append((beat_time, distance))
        if self.move_raises:
            raise RuntimeError("refused")
        i = next(i for i, m in enumerate(self._markers) if m.beat_time == beat_time)
        target = beat_time + distance
        if i > 0:
            target = max(target, self._markers[i - 1].beat_time + 0.01)
        if i + 1 < len(self._markers):
            target = min(target, self._markers[i + 1].beat_time - 0.01)
        self._markers[i].beat_time = target
        for cb in list(self.listeners["warp_markers"]):
            cb()

    def add_warp_marker(self, marker):
        if self.move_raises:
            raise RuntimeError("refused")
        self._markers.append(marker)
        self._markers.sort(key=lambda m: m.beat_time)
        for cb in list(self.listeners["warp_markers"]):
            cb()

    def remove_warp_marker(self, beat_time):
        self._markers = [m for m in self._markers if m.beat_time != beat_time]
        for cb in list(self.listeners["warp_markers"]):
            cb()

    def __getattr__(self, name):
        for prefix, op in (("add_", "add"), ("remove_", "remove")):
            if name.startswith(prefix) and name.endswith("_listener"):
                attr = name[len(prefix):-len("_listener")]
                if attr in ("warp_markers", "warping"):
                    lst = self.listeners[attr]
                    return lst.append if op == "add" else lst.remove
        raise AttributeError(name)


MARKERS = [(0.0, 0.0), (4.0, 2.0), (8.0, 4.0), (8.03125, 4.015625)]
PATH = "tracks/0/slots/0/clip"


@pytest.fixture
def setup():
    clip = AudioClip(cid=700, markers=MARKERS)
    track = StubTrack(tid=100, name="t0")
    track.clip_slots = [StubClipSlot(clip=clip)]
    song = ClipStubSong(tracks=[track])
    song.view._detail_clip = clip
    emits = []
    comp = ClipPropertiesComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
        warp_marker=lambda sample_time, beat_time: Marker(beat_time, sample_time),
    )
    return comp, clip, song, emits


def marker_emits(emits):
    return [args for addr, args in emits if addr == V3_CLIP_WARP_MARKERS_ADDRESS]


def flat(markers):
    out = []
    for b, s in markers:
        out.extend((b, s))
    return out


def test_focusing_an_audio_clip_sends_its_markers(setup):
    _comp, _clip, _song, emits = setup
    assert marker_emits(emits) == [(PATH, 1, 8.0, *flat(MARKERS))]


def test_a_midi_clip_sends_no_markers():
    clip = AudioClip(cid=701, markers=MARKERS, is_audio=False)
    track = StubTrack(tid=100, name="t0")
    track.clip_slots = [StubClipSlot(clip=clip)]
    song = ClipStubSong(tracks=[track], detail_clip=clip)
    emits = []
    ClipPropertiesComponent(song=song, emit=lambda a, args: emits.append((a, args)))
    assert marker_emits(emits) == []
    assert clip.listeners == {"warp_markers": [], "warping": []}


def test_an_unwarped_clip_sends_its_length_and_no_markers(setup):
    _comp, clip, _song, emits = setup
    emits.clear()
    clip.set_warping(False)
    assert marker_emits(emits) == [(PATH, 0, 8.0)]


def test_move_passes_lives_own_beat_time_and_echoes(setup):
    comp, clip, _song, emits = setup
    emits.clear()
    comp.handle_move_warp_marker((PATH, 4.0004, 0.5), None)
    assert clip.moves == [(4.0, 0.5)]
    sent = marker_emits(emits)
    assert sent and sent[-1][3:5] == (0.0, 0.0)
    assert sent[-1][5:7] == (4.5, 2.0)


def test_a_clamped_move_echoes_where_live_put_it(setup):
    comp, _clip, _song, emits = setup
    emits.clear()
    comp.handle_move_warp_marker((PATH, 4.0, 10.0), None)
    assert marker_emits(emits)[-1][5] == pytest.approx(7.99)


def test_move_rejects_a_beat_with_no_marker(setup):
    comp, clip, _song, emits = setup
    emits.clear()
    comp.handle_move_warp_marker((PATH, 4.1, 0.5), None)
    assert clip.moves == []
    assert marker_emits(emits) == []


@pytest.mark.parametrize("args", [
    (PATH, float("nan"), 0.5),
    (PATH, 4.0, float("inf")),
    (PATH, "x", 0.5),
    (PATH, 4.0),
    (PATH, 4.0, 0.0),
])
def test_move_rejects_bad_args(setup, args):
    comp, clip, _song, _emits = setup
    comp.handle_move_warp_marker(args, None)
    assert clip.moves == []


def test_move_on_an_unwarped_clip_writes_nothing(setup):
    comp, clip, _song, _emits = setup
    clip.set_warping(False)
    comp.handle_move_warp_marker((PATH, 4.0, 0.5), None)
    assert clip.moves == []


def test_a_refused_move_still_echoes_the_markers(setup):
    comp, clip, _song, emits = setup
    clip.move_raises = True
    emits.clear()
    comp.handle_move_warp_marker((PATH, 4.0, 0.5), None)
    assert marker_emits(emits) == [(PATH, 1, 8.0, *flat(MARKERS))]


def test_focus_change_and_disconnect_detach_the_listeners(setup):
    comp, clip, song, _emits = setup
    assert len(clip.listeners["warp_markers"]) == 1
    song.view.set_detail_clip(None)
    assert clip.listeners == {"warp_markers": [], "warping": []}
    song.view.set_detail_clip(clip)
    assert len(clip.listeners["warping"]) == 1
    comp.disconnect()
    assert clip.listeners == {"warp_markers": [], "warping": []}


def test_emit_on_accept_resends_the_markers(setup):
    comp, _clip, _song, emits = setup
    emits.clear()
    comp.emit_on_accept()
    assert marker_emits(emits) == [(PATH, 1, 8.0, *flat(MARKERS))]


def beats(clip):
    return [m.beat_time for m in clip.warp_markers]


def test_add_pins_the_sample_time_to_the_beat_and_echoes(setup):
    comp, clip, _song, emits = setup
    emits.clear()
    comp.handle_add_warp_marker((PATH, 1.25, 2.5), None)
    assert (2.5, 1.25) in [(m.beat_time, m.sample_time) for m in clip.warp_markers]
    assert marker_emits(emits)[-1][5:7] == (2.5, 1.25)


@pytest.mark.parametrize("args", [
    (PATH, -0.1, 2.0),
    (PATH, 1.0, 4.0005),  # a marker is already there
    (PATH, float("nan"), 2.0),
    (PATH, 1.0),
])
def test_add_rejects(setup, args):
    comp, clip, _song, _emits = setup
    comp.handle_add_warp_marker(args, None)
    assert beats(clip) == [0.0, 4.0, 8.0, 8.03125]


def test_add_that_live_refuses_still_echoes(setup):
    comp, clip, _song, emits = setup
    clip.move_raises = True
    emits.clear()
    comp.handle_add_warp_marker((PATH, 1.0, 2.0), None)
    assert marker_emits(emits) == [(PATH, 1, 8.0, *flat(MARKERS))]


def test_remove_takes_an_inner_marker(setup):
    comp, clip, _song, emits = setup
    emits.clear()
    comp.handle_remove_warp_marker((PATH, 4.0003), None)
    assert beats(clip) == [0.0, 8.0, 8.03125]
    assert marker_emits(emits)


@pytest.mark.parametrize("beat", [0.0, 8.0, 8.03125, 5.0])
def test_remove_refuses_the_ends_the_hidden_marker_and_nothing(setup, beat):
    comp, clip, _song, _emits = setup
    comp.handle_remove_warp_marker((PATH, beat), None)
    assert beats(clip) == [0.0, 4.0, 8.0, 8.03125]


def test_add_and_remove_need_a_warped_clip(setup):
    comp, clip, _song, _emits = setup
    clip.set_warping(False)
    comp.handle_add_warp_marker((PATH, 1.0, 2.0), None)
    comp.handle_remove_warp_marker((PATH, 4.0), None)
    assert beats(clip) == [0.0, 4.0, 8.0, 8.03125]
