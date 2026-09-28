"""DeviceCommandsComponent unit tests — ROW 5 device chain ops.

Covers ``/looping/v3/device/{select,move_to_top,move_to_end}`` handler
contract: happy paths, typed errors, LOM raise handling, arg-count
validation, and disconnect idempotence.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.DeviceCommandsComponent import (
    DeviceCommandsComponent,
    V3_DEVICE_MOVE_TO_END_ADDRESS,
    V3_DEVICE_MOVE_TO_TOP_ADDRESS,
    V3_DEVICE_SELECT_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_PATH_NOT_SUPPORTED,
    V3_ERROR_WRITE_REJECTED,
    V3_SIMPLER_REVERSE_ADDRESS,
    V3_SIMPLER_WARP_DOUBLE_ADDRESS,
    V3_SIMPLER_WARP_HALF_ADDRESS,
)


# --- stub LOM -------------------------------------------------------------


class StubDevice:
    def __init__(self, name: str = "dev", canonical_parent=None):
        self.name = name
        self.canonical_parent = canonical_parent
        self._canonical_parent_raises = None

    def __getattribute__(self, item):
        if item == "canonical_parent":
            raises = object.__getattribute__(self, "_canonical_parent_raises")
            if raises is not None:
                raise raises
        return object.__getattribute__(self, item)


class StubTrack:
    """Regular track with a devices chain."""

    def __init__(self, devices: List[StubDevice]):
        self.devices = list(devices)
        # Back-link devices to this track as their canonical_parent.
        for d in self.devices:
            d.canonical_parent = self


class StubMasterTrack(StubTrack):
    pass


class StubSongView:
    def __init__(self):
        self.selected_device_calls: List[StubDevice] = []
        self._select_raises = None

    def select_device(self, device):
        if self._select_raises is not None:
            raise self._select_raises
        self.selected_device_calls.append(device)


class StubSong:
    def __init__(
        self,
        track_devices_per_track: List[List[StubDevice]] = None,
        master_devices: List[StubDevice] = None,
    ):
        if track_devices_per_track is None:
            track_devices_per_track = [
                [StubDevice("t0d0"), StubDevice("t0d1"), StubDevice("t0d2")],
                [StubDevice("t1d0")],
            ]
        if master_devices is None:
            master_devices = [StubDevice("m0"), StubDevice("m1")]
        self.tracks = tuple(StubTrack(ds) for ds in track_devices_per_track)
        self.master_track = StubMasterTrack(master_devices)
        self.return_tracks = ()
        self.view = StubSongView()
        self.move_device_calls: List[Tuple[StubDevice, object, int]] = []
        self._move_device_raises = None

    def move_device(self, device, target, target_index):
        if self._move_device_raises is not None:
            raise self._move_device_raises
        self.move_device_calls.append((device, target, target_index))
        # Mimic Live's in-place chain re-order so post-move index reads
        # against ``target.devices`` reflect the new layout.
        if device in target.devices:
            target.devices.remove(device)
        # Clamp to [0, len(target.devices)] to match LOM semantics.
        idx = max(0, min(target_index, len(target.devices)))
        target.devices.insert(idx, device)


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


@pytest.fixture
def component(emits):
    song = StubSong()

    def emit(addr, args):
        emits.append((addr, args))

    return DeviceCommandsComponent(song=song, emit=emit)


# --- arg-count validation -------------------------------------------------


@pytest.mark.parametrize(
    "address,handler_name",
    [
        (V3_DEVICE_SELECT_ADDRESS, "handle_select"),
        (V3_DEVICE_MOVE_TO_TOP_ADDRESS, "handle_move_to_top"),
        (V3_DEVICE_MOVE_TO_END_ADDRESS, "handle_move_to_end"),
    ],
)
def test_bad_arg_count_emits_write_rejected(
    component, emits, address, handler_name,
):
    handler = getattr(component, handler_name)
    handler(args=(), source_addr=None)
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, path, detail = payload
    assert originating == address
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == ""
    assert detail.startswith("arg-count:")


# --- handle_select --------------------------------------------------------


def test_select_happy_path_calls_lom(component, emits):
    component.handle_select(
        args=("tracks/0/devices/1",), source_addr=None,
    )
    song = component._song
    selected = song.view.selected_device_calls
    assert len(selected) == 1
    assert selected[0] is song.tracks[0].devices[1]
    assert emits == []


def test_select_master_device_works(component, emits):
    component.handle_select(
        args=("master/devices/0",), source_addr=None,
    )
    song = component._song
    selected = song.view.selected_device_calls
    assert len(selected) == 1
    assert selected[0] is song.master_track.devices[0]


def test_select_path_not_found_emits_typed_error(component, emits):
    component.handle_select(
        args=("tracks/0/devices/99",), source_addr=None,
    )
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, path, _detail = payload
    assert originating == V3_DEVICE_SELECT_ADDRESS
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/0/devices/99"


def test_select_malformed_path_emits_write_rejected(component, emits):
    component.handle_select(args=("not-a-path",), source_addr=None)
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_select_lom_raise_emits_write_rejected(component, emits):
    component._song.view._select_raises = RuntimeError("lom barfed")
    component.handle_select(
        args=("tracks/0/devices/0",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0/devices/0"
    assert "select_device raised" in detail
    assert "RuntimeError" in detail


def test_select_bytes_path_decoded(component, emits):
    component.handle_select(
        args=("tracks/0/devices/0".encode("utf-8"),), source_addr=None,
    )
    song = component._song
    assert song.view.selected_device_calls == [song.tracks[0].devices[0]]


# --- handle_move_to_top ---------------------------------------------------


def test_move_to_top_moves_device_to_index_zero(component, emits):
    song = component._song
    original_d1 = song.tracks[0].devices[1]
    component.handle_move_to_top(
        args=("tracks/0/devices/1",), source_addr=None,
    )
    assert len(song.move_device_calls) == 1
    device, target, target_index = song.move_device_calls[0]
    assert device is original_d1
    assert target is song.tracks[0]
    assert target_index == 0
    assert song.tracks[0].devices[0] is original_d1
    assert emits == []


def test_move_to_top_already_at_top_still_moves_with_idx_zero(component, emits):
    """No "already at top" short-circuit — LOM handles it. Handler still
    emits no error; the move is a quiet no-op at the LOM level."""
    song = component._song
    original_d0 = song.tracks[0].devices[0]
    component.handle_move_to_top(
        args=("tracks/0/devices/0",), source_addr=None,
    )
    assert len(song.move_device_calls) == 1
    _device, _target, target_index = song.move_device_calls[0]
    assert target_index == 0
    assert song.tracks[0].devices[0] is original_d0
    assert emits == []


def test_move_to_top_path_not_found(component, emits):
    component.handle_move_to_top(
        args=("tracks/5/devices/0",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_move_to_top_canonical_parent_raise_emits_write_rejected(
    component, emits,
):
    song = component._song
    song.tracks[0].devices[1]._canonical_parent_raises = RuntimeError("gone")
    component.handle_move_to_top(
        args=("tracks/0/devices/1",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "canonical_parent raised" in detail


def test_move_to_top_lom_move_raise(component, emits):
    component._song._move_device_raises = RuntimeError("live refused")
    component.handle_move_to_top(
        args=("tracks/0/devices/1",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "move_device raised" in detail
    assert "RuntimeError" in detail


# --- handle_move_to_end ---------------------------------------------------


def test_move_to_end_moves_device_to_last_index(component, emits):
    song = component._song
    original_d0 = song.tracks[0].devices[0]
    original_len = len(song.tracks[0].devices)
    component.handle_move_to_end(
        args=("tracks/0/devices/0",), source_addr=None,
    )
    assert len(song.move_device_calls) == 1
    _device, target, target_index = song.move_device_calls[0]
    assert target is song.tracks[0]
    # End index is the pre-removal count: Live shifts the source out
    # first and inserts at `target_index`, so `count` → append slot.
    # Passing `count - 1` would land on second-from-end.
    assert target_index == original_len
    assert song.tracks[0].devices[-1] is original_d0
    assert emits == []


def test_move_to_end_master_track(component, emits):
    song = component._song
    original = song.master_track.devices[0]
    original_len = len(song.master_track.devices)
    component.handle_move_to_end(
        args=("master/devices/0",), source_addr=None,
    )
    _device, target, target_index = song.move_device_calls[0]
    assert target is song.master_track
    assert target_index == original_len
    assert song.master_track.devices[-1] is original


def test_move_to_end_single_device_chain_is_noop_like(component, emits):
    """Track with a single device — move-to-end resolves to
    ``device_count`` = 1 (pre-removal count). Stub clamps to
    post-removal ``len``; LOM no-ops."""
    song = component._song
    original = song.tracks[1].devices[0]
    component.handle_move_to_end(
        args=("tracks/1/devices/0",), source_addr=None,
    )
    _device, _target, target_index = song.move_device_calls[0]
    assert target_index == 1
    assert song.tracks[1].devices[0] is original
    assert emits == []


def test_move_to_end_path_not_found(component, emits):
    component.handle_move_to_end(
        args=("tracks/0/devices/99",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_PATH_NOT_FOUND


# --- lifecycle ------------------------------------------------------------


def test_disconnect_short_circuits_all_handlers(component, emits):
    component.disconnect()
    component.disconnect()  # idempotent
    component.handle_select(
        args=("tracks/0/devices/0",), source_addr=None,
    )
    component.handle_move_to_top(
        args=("tracks/0/devices/0",), source_addr=None,
    )
    component.handle_move_to_end(
        args=("tracks/0/devices/0",), source_addr=None,
    )
    song = component._song
    assert song.view.selected_device_calls == []
    assert song.move_device_calls == []
    assert emits == []


# --- wire address constants -----------------------------------------------


def test_wire_addresses_are_stable():
    """Address rename guard — changing these is a wire-contract event."""
    assert V3_DEVICE_SELECT_ADDRESS == "/looping/v3/device/select"
    assert V3_DEVICE_MOVE_TO_TOP_ADDRESS == "/looping/v3/device/move_to_top"
    assert V3_DEVICE_MOVE_TO_END_ADDRESS == "/looping/v3/device/move_to_end"
    assert V3_SIMPLER_REVERSE_ADDRESS == "/looping/v3/simpler/reverse"
    assert V3_SIMPLER_WARP_HALF_ADDRESS == "/looping/v3/simpler/warp_half"
    assert V3_SIMPLER_WARP_DOUBLE_ADDRESS == "/looping/v3/simpler/warp_double"


# --- Simpler action handlers ---------------------------------------------
# Probed against live Simpler at tracks/1/devices/1 (2026-05-04): reverse(),
# warp_half(), warp_double() all exist and are callable; class_name on the
# real device is "OriginalSimpler". See `/looping/probe/lom_invoke` traces.


class StubSimpler(StubDevice):
    """Simpler stand-in. ``class_name`` defaults to 'OriginalSimpler'.

    Records calls to reverse / warp_half / warp_double. Any of the three
    can be made to raise by setting the matching ``_*_raises`` attribute.
    """

    def __init__(self, name: str = "simpler", class_name: str = "OriginalSimpler"):
        super().__init__(name=name)
        self.class_name = class_name
        self.reverse_calls = 0
        self.warp_half_calls = 0
        self.warp_double_calls = 0
        self._reverse_raises = None
        self._warp_half_raises = None
        self._warp_double_raises = None

    def reverse(self):
        if self._reverse_raises is not None:
            raise self._reverse_raises
        self.reverse_calls += 1

    def warp_half(self):
        if self._warp_half_raises is not None:
            raise self._warp_half_raises
        self.warp_half_calls += 1

    def warp_double(self):
        if self._warp_double_raises is not None:
            raise self._warp_double_raises
        self.warp_double_calls += 1


@pytest.fixture
def simpler_component(emits):
    """Component with a Simpler at tracks/0/devices/0."""
    simpler = StubSimpler()
    song = StubSong(track_devices_per_track=[[simpler]])

    def emit(addr, args):
        emits.append((addr, args))

    component = DeviceCommandsComponent(song=song, emit=emit)
    return component, simpler


@pytest.mark.parametrize(
    "address,handler_name,call_attr",
    [
        (V3_SIMPLER_REVERSE_ADDRESS, "handle_simpler_reverse", "reverse_calls"),
        (V3_SIMPLER_WARP_HALF_ADDRESS, "handle_simpler_warp_half", "warp_half_calls"),
        (V3_SIMPLER_WARP_DOUBLE_ADDRESS, "handle_simpler_warp_double", "warp_double_calls"),
    ],
)
def test_simpler_action_happy_path(simpler_component, emits, address, handler_name, call_attr):
    component, simpler = simpler_component
    handler = getattr(component, handler_name)
    handler(args=("tracks/0/devices/0",), source_addr=None)
    assert getattr(simpler, call_attr) == 1
    assert emits == []


@pytest.mark.parametrize(
    "address,handler_name",
    [
        (V3_SIMPLER_REVERSE_ADDRESS, "handle_simpler_reverse"),
        (V3_SIMPLER_WARP_HALF_ADDRESS, "handle_simpler_warp_half"),
        (V3_SIMPLER_WARP_DOUBLE_ADDRESS, "handle_simpler_warp_double"),
    ],
)
def test_simpler_action_bad_arg_count_emits_error(simpler_component, emits, address, handler_name):
    component, _simpler = simpler_component
    handler = getattr(component, handler_name)
    handler(args=(), source_addr=None)
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, _path, detail = payload
    assert originating == address
    assert code == V3_ERROR_WRITE_REJECTED
    assert detail.startswith("arg-count:")


def test_simpler_action_rejects_non_simpler_device(emits):
    not_simpler = StubSimpler(class_name="AutoFilter2")
    song = StubSong(track_devices_per_track=[[not_simpler]])

    def emit(addr, args):
        emits.append((addr, args))

    component = DeviceCommandsComponent(song=song, emit=emit)
    component.handle_simpler_reverse(args=("tracks/0/devices/0",), source_addr=None)
    assert not_simpler.reverse_calls == 0
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, _path, detail = payload
    assert originating == V3_SIMPLER_REVERSE_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert "AutoFilter2" in detail


def test_simpler_action_path_not_found(simpler_component, emits):
    component, _simpler = simpler_component
    component.handle_simpler_reverse(args=("tracks/0/devices/99",), source_addr=None)
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, path, _detail = payload
    assert originating == V3_SIMPLER_REVERSE_ADDRESS
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/0/devices/99"


def test_simpler_action_lom_raise_emits_error(simpler_component, emits):
    component, simpler = simpler_component
    simpler._reverse_raises = RuntimeError("LOM rejected reverse")
    component.handle_simpler_reverse(args=("tracks/0/devices/0",), source_addr=None)
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, _path, detail = payload
    assert originating == V3_SIMPLER_REVERSE_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert "RuntimeError" in detail
    assert "LOM rejected" in detail


def test_simpler_action_disconnect_no_op(simpler_component, emits):
    component, simpler = simpler_component
    component.disconnect()
    component.handle_simpler_reverse(args=("tracks/0/devices/0",), source_addr=None)
    component.handle_simpler_warp_half(args=("tracks/0/devices/0",), source_addr=None)
    component.handle_simpler_warp_double(args=("tracks/0/devices/0",), source_addr=None)
    assert simpler.reverse_calls == 0
    assert simpler.warp_half_calls == 0
    assert simpler.warp_double_calls == 0
    assert emits == []


# --- device/delete: remove a device from its chain (issue #491, 3.8.0) --------

from components.DeviceCommandsComponent import V3_DEVICE_DELETE_ADDRESS
from tests.support.lom_fakes import (
    FakeChain,
    FakeDevice,
    FakePad,
    FakeParam,
    FakeSong,
    FakeTrack,
    drumcell,
    make_rack,
)


def _delete_rig():
    reverb = FakeDevice("Hybrid", [FakeParam("Dry/Wet", 0.3)], type_=2, name="Reverb")
    rack = make_rack([FakePad(36, [FakeChain([drumcell(), reverb], name="Kick")])])
    util = FakeDevice("StereoGain", [FakeParam("Gain", 0.5)], type_=2, name="Utility")
    track = FakeTrack([rack, util], "Drums")
    song = FakeSong(tracks=[track])
    emits: List[Tuple[str, tuple]] = []
    comp = DeviceCommandsComponent(song=song, emit=lambda a, args: emits.append((a, tuple(args))))
    return comp, song, rack, reverb, util, emits


def test_delete_removes_a_pad_chain_device_by_identity():
    comp, _song, rack, _reverb, _util, emits = _delete_rig()
    comp.handle_delete(["tracks/0/devices/0/pads/36/devices/1"], None)
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell"]
    assert emits == []


def test_delete_removes_a_track_device():
    comp, song, _rack, _reverb, _util, emits = _delete_rig()
    comp.handle_delete(["tracks/0/devices/1"], None)
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]
    assert emits == []


def test_delete_errors():
    comp, _song, _rack, reverb, _util, emits = _delete_rig()
    comp.handle_delete(["tracks/0/devices/0/pads/36/devices/7"], None)
    assert emits[-1][1][:2] == (V3_DEVICE_DELETE_ADDRESS, V3_ERROR_PATH_NOT_FOUND)
    comp.handle_delete(["tracks/0/devices/0/chains/0/devices/0"], None)
    assert emits[-1][1][:2] == (V3_DEVICE_DELETE_ADDRESS, V3_ERROR_PATH_NOT_SUPPORTED)
    comp.handle_delete([], None)
    assert emits[-1][1][1] == V3_ERROR_WRITE_REJECTED
    reverb.canonical_parent = None
    comp.handle_delete(["tracks/0/devices/0/pads/36/devices/1"], None)
    assert emits[-1][1][1] == V3_ERROR_WRITE_REJECTED
    assert "canonical_parent" in emits[-1][1][3]


def test_delete_reports_a_lom_raise():
    comp, _song, rack, _reverb, _util, emits = _delete_rig()

    def boom(index):
        raise RuntimeError("Live said no")

    rack.drum_pads[36].chains[0].delete_device = boom
    comp.handle_delete(["tracks/0/devices/0/pads/36/devices/1"], None)
    assert emits[-1][1][1] == V3_ERROR_WRITE_REJECTED
    assert "delete_device raised: RuntimeError" in emits[-1][1][3]
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
