"""The blue hand: ``device/select`` puts Live's appointed device on the
device, and ``/looping/v3/device/appointed`` reports wherever it goes
(2026-10-25). Plus the walk that names any device's path,
``path_resolver.compose_device_path_for``.
"""

from __future__ import annotations

from typing import List, Tuple

from components import path_resolver
from components.DeviceCommandsComponent import (
    DeviceCommandsComponent,
    V3_DEVICE_APPOINTED_ADDRESS,
)
from tests.support.lom_fakes import FakeChain, FakeDevice, FakeTrack, make_rack, pad


class _View:
    def __init__(self, song):
        self._song = song
        self.selected: List = []
        # Live's default: the hand follows the selection. Off, a select
        # leaves the hand where it was — the case the explicit write covers.
        self.hand_follows = True

    def select_device(self, device):
        self.selected.append(device)
        if self.hand_follows:
            self._song.appointed_device = device


class _Song:
    """Tracks, a master, no returns, and ``appointed_device`` with Live's
    listener pair: an assignment fires the listeners, as Live does for a
    surface's own write."""

    def __init__(self, tracks=(), master=None):
        self.tracks = list(tracks)
        self.master_track = master if master is not None else FakeTrack(name="Master")
        self.return_tracks = ()
        self.view = _View(self)
        self._appointed = None
        self.appointed_listeners: List = []
        self.appointed_writes = 0

    @property
    def appointed_device(self):
        return self._appointed

    @appointed_device.setter
    def appointed_device(self, device):
        self.appointed_writes += 1
        self._appointed = device
        for cb in list(self.appointed_listeners):
            cb()

    def add_appointed_device_listener(self, cb):
        self.appointed_listeners.append(cb)

    def remove_appointed_device_listener(self, cb):
        self.appointed_listeners.remove(cb)


def _set():
    """Track 0: an instrument, an Auto Filter and a kit whose pad 38 has a
    Reverb after its sample. Track 1: an effect rack holding an Echo."""
    reverb = FakeDevice("Hybrid", type_=2, name="Reverb")
    kit = make_rack([pad(36, FakeDevice("DrumCell")), pad(38, FakeDevice("DrumCell"), reverb)])
    for p in kit.drum_pads:
        for chain in p.chains:
            chain.canonical_parent = kit
    synth = FakeDevice("InstrumentVector", name="Wavetable")
    filt = FakeDevice("AutoFilter2", type_=2, name="Wobble")
    t0 = FakeTrack([synth, filt, kit])
    echo = FakeDevice("Echo", type_=2)
    chain = FakeChain([echo])
    rack = FakeDevice("AudioEffectGroupDevice", type_=2, name="Dub Space")
    chain.canonical_parent = rack
    t1 = FakeTrack([rack])
    song = _Song([t0, t1])
    return song, {"synth": synth, "filter": filt, "kit": kit, "reverb": reverb, "rack": rack, "echo": echo}


def _component(song) -> Tuple[DeviceCommandsComponent, List]:
    emits: List = []
    return DeviceCommandsComponent(song=song, emit=lambda a, args: emits.append((a, args))), emits


def _appointed(emits):
    return [args[0] for addr, args in emits if addr == V3_DEVICE_APPOINTED_ADDRESS]


# --- compose_device_path_for ----------------------------------------------


def test_path_of_a_track_device():
    song, d = _set()
    assert path_resolver.compose_device_path_for(song, d["filter"]) == "tracks/0/devices/1"


def test_path_of_a_master_device():
    comp = FakeDevice("GlueCompressor", type_=2)
    song = _Song(master=FakeTrack([comp], name="Master"))
    assert path_resolver.compose_device_path_for(song, comp) == "master/devices/0"


def test_path_of_a_device_in_a_pad_chain():
    song, d = _set()
    assert path_resolver.compose_device_path_for(song, d["reverb"]) == "tracks/0/devices/2/pads/38/devices/1"


def test_a_device_in_another_racks_chain_names_the_rack():
    song, d = _set()
    assert path_resolver.compose_device_path_for(song, d["echo"]) == "tracks/1/devices/0"


def test_no_path_for_nothing_a_stray_or_a_return():
    song, d = _set()
    assert path_resolver.compose_device_path_for(song, None) is None
    assert path_resolver.compose_device_path_for(song, FakeDevice("Echo")) is None  # no parent
    ret = FakeDevice("Echo", type_=2)
    FakeTrack([ret], name="Return A")  # a track the song does not list
    assert path_resolver.compose_device_path_for(song, ret) is None


# --- device/select appoints -------------------------------------------------


def test_select_leaves_the_hand_alone_when_it_followed():
    song, d = _set()
    component, _ = _component(song)
    component.handle_select(("tracks/0/devices/1",), None)
    assert song.appointed_device is d["filter"]
    assert song.appointed_writes == 1  # the selection's own, not ours


def test_select_puts_the_hand_there_when_live_did_not():
    song, d = _set()
    song.view.hand_follows = False
    component, _ = _component(song)
    component.handle_select(("tracks/0/devices/1",), None)
    assert song.view.selected == [d["filter"]]
    assert song.appointed_device is d["filter"]


def test_a_refused_select_writes_no_hand():
    song, d = _set()
    song.view.hand_follows = False

    def refuse(_device):
        raise RuntimeError("no")

    song.view.select_device = refuse
    component, emits = _component(song)
    component.handle_select(("tracks/0/devices/1",), None)
    assert song.appointed_device is None
    assert _appointed(emits) == []


# --- device/appointed ---------------------------------------------------------


def test_a_move_in_live_is_reported_once():
    song, d = _set()
    component, emits = _component(song)
    song.appointed_device = d["reverb"]
    song.appointed_device = d["reverb"]
    assert _appointed(emits) == ["tracks/0/devices/2/pads/38/devices/1"]


def test_our_select_is_reported_through_the_listener():
    song, d = _set()
    component, emits = _component(song)
    component.handle_select(("tracks/1/devices/0",), None)
    assert _appointed(emits) == ["tracks/1/devices/0"]


def test_a_structural_change_resends_only_a_moved_path():
    song, d = _set()
    component, emits = _component(song)
    song.appointed_device = d["filter"]
    component.on_structural_change()  # nothing moved
    song.tracks[0].devices.remove(d["synth"])  # the filter is device 0 now
    component.on_structural_change()
    assert _appointed(emits) == ["tracks/0/devices/1", "tracks/0/devices/0"]


def test_accept_always_seeds_and_none_is_empty():
    song, d = _set()
    component, emits = _component(song)
    component.emit_on_accept()
    song.appointed_device = d["synth"]
    component.emit_on_accept()
    assert _appointed(emits) == ["", "tracks/0/devices/0", "tracks/0/devices/0"]


def test_disconnect_detaches_and_goes_quiet():
    song, d = _set()
    component, emits = _component(song)
    assert len(song.appointed_listeners) == 1
    component.disconnect()
    assert song.appointed_listeners == []
    component.emit_on_accept()
    assert _appointed(emits) == []


def test_a_song_without_the_hand_is_left_alone():
    """Every older fake (and a Live that refused the listener) still works."""

    class _Bare:
        tracks = ()
        return_tracks = ()

    component, emits = _component(_Bare())
    component.on_structural_change()
    assert _appointed(emits) == [""]
