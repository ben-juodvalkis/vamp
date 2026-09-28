"""DevicesComponent v3 handler tests — Phase 1 Commit B.

Covers:

- ``handle_set_param_v3``: happy path, generation-stale, path-not-found
  (malformed + out-of-range), path-not-supported (chains, returns),
  write-rejected (bad args, NaN, wrong arity), misconfigured-surface
  (no generation component wired), v3 arm routes through the v2
  suppression key so one arm silences both echo wires
- ``handle_v3_param_query``: happy path emits ``/looping/v3/param/value``,
  path-not-found error, path-not-supported error
- ``handle_v3_state_resync``: invokes callback, no-op without callback,
  swallows callback errors
"""

from __future__ import annotations

import pytest

from components.DevicesComponent import (
    DevicesComponent,
    V3_ERROR_ADDRESS,
    V3_ERROR_GENERATION_STALE,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_PATH_NOT_SUPPORTED,
    V3_ERROR_WRITE_REJECTED,
    V3_PARAM_QUERY_ADDRESS,
    V3_PARAM_SET_ADDRESS,
    V3_PARAM_VALUE_ADDRESS,
)
from components.GenerationComponent import GenerationComponent
from tests.test_lom_listeners import (
    StubDevice,
    StubParam,
    StubSong,
    StubTrack,
)


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def song_with_params():
    """Two regular tracks + a master track with devices + params.

    Layout:
      master         / devices[0]=did500 / params[0..1]=pid 401,402
      tracks[0]=t100 / devices[0]=did200 / params[0..1]=pid 301,302
      tracks[1]=t101 / devices[0]=did210 / params[0]  =pid 310
                      devices[1]=did211 / params[0]  =pid 311
    """
    m_p0 = StubParam(pid=401, name="m_a", value=0.1, min_v=0.0, max_v=1.0)
    m_p1 = StubParam(pid=402, name="m_b", value=64.0, min_v=0.0, max_v=127.0)
    master_dev = StubDevice(did=500, params=[m_p0, m_p1])
    master = StubTrack(tid=9_999_999, devices=[master_dev], name="Master")

    p301 = StubParam(pid=301, name="t0_d0_p0", value=0.25, min_v=0.0, max_v=1.0)
    p302 = StubParam(pid=302, name="t0_d0_p1", value=50.0, min_v=0.0, max_v=100.0)
    d200 = StubDevice(did=200, params=[p301, p302])
    t0 = StubTrack(tid=100, devices=[d200])

    p310 = StubParam(pid=310, name="t1_d0_p0", value=0.5, min_v=0.0, max_v=1.0)
    d210 = StubDevice(did=210, params=[p310])
    p311 = StubParam(pid=311, name="t1_d1_p0", value=0.0, min_v=0.0, max_v=1.0)
    d211 = StubDevice(did=211, params=[p311])
    t1 = StubTrack(tid=101, devices=[d210, d211])

    song = StubSong(tracks=[t0, t1], master=master)
    return song, master, t0, t1


@pytest.fixture
def emits():
    return []


@pytest.fixture
def generation():
    return GenerationComponent()


@pytest.fixture
def component(song_with_params, emits, generation):
    song, _m, _t0, _t1 = song_with_params
    comp = DevicesComponent(song=song, emit=lambda a, args: emits.append((a, args)))
    comp.set_generation(generation)
    return comp


# --- handle_set_param_v3: happy path --------------------------------------


def test_v3_set_writes_value(component, song_with_params, emits, generation):
    _song, _m, t0, _t1 = song_with_params
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.75, generation.current),
        source_addr=None,
    )
    assert t0.devices[0].parameters[0].value == pytest.approx(0.75)
    assert emits == []


def test_v3_set_master_param(component, song_with_params, emits, generation):
    _song, master, *_ = song_with_params
    component.handle_set_param_v3(
        args=("master/devices/0/params/1", 100.0, generation.current),
        source_addr=None,
    )
    assert master.devices[0].parameters[1].value == pytest.approx(100.0)


def test_v3_set_clamps_above_max(component, song_with_params, emits, generation):
    _song, _m, t0, _t1 = song_with_params
    # param 302 has max=100; value 500 clamps to 100.
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/1", 500.0, generation.current),
        source_addr=None,
    )
    assert t0.devices[0].parameters[1].value == pytest.approx(100.0)


def test_v3_set_bytes_path_decoded(component, song_with_params, generation):
    _song, _m, t0, _t1 = song_with_params
    component.handle_set_param_v3(
        args=(b"tracks/0/devices/0/params/0", 0.9, generation.current),
        source_addr=None,
    )
    assert t0.devices[0].parameters[0].value == pytest.approx(0.9)


# --- generation-stale -----------------------------------------------------


def test_v3_set_generation_stale(component, emits, generation):
    generation.advance("track-added")  # now 2
    generation.advance("track-added")  # now 3
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.5, 1),  # ui_gen=1 < surf=3
        source_addr=None,
    )
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_ERROR_ADDRESS
    failing_addr, code, path, detail = args
    assert failing_addr == V3_PARAM_SET_ADDRESS
    assert code == V3_ERROR_GENERATION_STALE
    assert path == "tracks/0/devices/0/params/0"
    assert "ui=1" in detail and "surf=3" in detail


def test_v3_set_equal_generation_ok(component, song_with_params, generation, emits):
    """ui_gen == surf_gen is not stale — the UI is caught up."""
    _song, _m, t0, _t1 = song_with_params
    generation.advance("any")  # now 2
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.42, 2),
        source_addr=None,
    )
    assert t0.devices[0].parameters[0].value == pytest.approx(0.42)
    assert emits == []


def test_v3_set_future_generation_ok(component, song_with_params, generation):
    """ui_gen > surf_gen isn't stale by the [04 §4.2] rule — only <."""
    _song, _m, t0, _t1 = song_with_params
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.11, 99),
        source_addr=None,
    )
    assert t0.devices[0].parameters[0].value == pytest.approx(0.11)


# --- path-not-found -------------------------------------------------------


def test_v3_set_path_out_of_range_not_found(component, emits, generation):
    component.handle_set_param_v3(
        args=("tracks/99/devices/0/params/0", 0.5, generation.current),
        source_addr=None,
    )
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_ERROR_ADDRESS
    _fa, code, path, _detail = args
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/99/devices/0/params/0"


def test_v3_set_path_malformed_maps_to_not_found(component, emits, generation):
    """Malformed grammar → wire code path-not-found (collapsed)."""
    component.handle_set_param_v3(
        args=("xyzzy/0", 0.5, generation.current),
        source_addr=None,
    )
    assert len(emits) == 1
    _addr, args = emits[0]
    _fa, code, _path, detail = args
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert "malformed" in detail.lower()


def test_v3_set_empty_path_not_found(component, emits, generation):
    component.handle_set_param_v3(
        args=("", 0.5, generation.current),
        source_addr=None,
    )
    assert emits[0][1][1] == V3_ERROR_PATH_NOT_FOUND


# --- path-not-supported ---------------------------------------------------


def test_v3_set_chains_not_supported(component, emits, generation):
    component.handle_set_param_v3(
        args=(
            "tracks/0/devices/0/chains/0/devices/0/params/0",
            0.5, generation.current,
        ),
        source_addr=None,
    )
    assert len(emits) == 1
    _addr, args = emits[0]
    _fa, code, _path, _detail = args
    assert code == V3_ERROR_PATH_NOT_SUPPORTED


def test_v3_set_returns_not_supported(component, emits, generation):
    component.handle_set_param_v3(
        args=("returns/0/devices/0/params/0", 0.5, generation.current),
        source_addr=None,
    )
    assert emits[0][1][1] == V3_ERROR_PATH_NOT_SUPPORTED


# --- write-rejected -------------------------------------------------------


def test_v3_set_wrong_arity(component, emits):
    component.handle_set_param_v3(args=("tracks/0",), source_addr=None)
    assert len(emits) == 1
    _addr, args = emits[0]
    _fa, code, _path, _detail = args
    assert code == V3_ERROR_WRITE_REJECTED


def test_v3_set_nan_value(component, emits, generation):
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", float("nan"), generation.current),
        source_addr=None,
    )
    assert len(emits) == 1
    _addr, args = emits[0]
    _fa, code, path, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "nan" in detail.lower()


def test_v3_set_non_numeric_value(component, emits, generation):
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", "not-a-float", generation.current),
        source_addr=None,
    )
    _addr, args = emits[0]
    _fa, code, _path, _detail = args
    assert code == V3_ERROR_WRITE_REJECTED


def test_v3_set_non_int_generation(component, emits, generation):
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.5, "not-an-int"),
        source_addr=None,
    )
    _addr, args = emits[0]
    _fa, code, _path, _detail = args
    assert code == V3_ERROR_WRITE_REJECTED


# --- misconfigured surface ------------------------------------------------


def test_v3_set_no_generation_component_rejects(song_with_params, emits):
    """No generation wired → refuse rather than bypass stale check."""
    song, *_ = song_with_params
    comp = DevicesComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    # Deliberately skip set_generation.
    comp.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.5, 1),
        source_addr=None,
    )
    assert len(emits) == 1
    _addr, args = emits[0]
    _fa, code, _path, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "misconfigured" in detail.lower()


# --- disconnect -----------------------------------------------------------


def test_v3_set_after_disconnect_silent(component, emits, generation):
    component.disconnect()
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.5, generation.current),
        source_addr=None,
    )
    assert emits == []


# --- handle_v3_param_query ------------------------------------------------


def test_v3_query_emits_value(component, song_with_params, emits):
    _song, _m, t0, _t1 = song_with_params
    t0.devices[0].parameters[0].value = 0.314
    component.handle_v3_param_query(
        args=("tracks/0/devices/0/params/0",), source_addr=None,
    )
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_PARAM_VALUE_ADDRESS
    path, value = args
    assert path == "tracks/0/devices/0/params/0"
    assert value == pytest.approx(0.314)


def test_v3_query_bytes_path(component, song_with_params, emits):
    _song, _m, t0, _t1 = song_with_params
    t0.devices[0].parameters[0].value = 0.5
    component.handle_v3_param_query(
        args=(b"tracks/0/devices/0/params/0",), source_addr=None,
    )
    addr, args = emits[0]
    assert addr == V3_PARAM_VALUE_ADDRESS


def test_v3_query_path_not_found(component, emits):
    component.handle_v3_param_query(
        args=("tracks/99/devices/0/params/0",), source_addr=None,
    )
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_ERROR_ADDRESS
    _fa, code, _path, _detail = args
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_v3_query_path_not_supported(component, emits):
    component.handle_v3_param_query(
        args=("returns/0/devices/0/params/0",), source_addr=None,
    )
    _addr, args = emits[0]
    _fa, code, _path, _detail = args
    assert code == V3_ERROR_PATH_NOT_SUPPORTED


def test_v3_query_empty_args(component, emits):
    component.handle_v3_param_query(args=(), source_addr=None)
    assert len(emits) == 1
    addr, _args = emits[0]
    assert addr == V3_ERROR_ADDRESS


def test_v3_query_after_disconnect_silent(component, emits):
    component.disconnect()
    component.handle_v3_param_query(
        args=("tracks/0/devices/0/params/0",), source_addr=None,
    )
    assert emits == []


# --- handle_v3_state_resync -----------------------------------------------


def test_v3_resync_invokes_callback(component):
    called = []
    component.set_state_full_on_resync(lambda: called.append(True))
    component.handle_v3_state_resync(args=(), source_addr=None)
    assert called == [True]


def test_v3_resync_no_callback_is_noop(component, emits):
    component.handle_v3_state_resync(args=(), source_addr=None)
    assert emits == []  # No error, no emission.


def test_v3_resync_callback_error_swallowed(component):
    def bad():
        raise RuntimeError("boom")
    component.set_state_full_on_resync(bad)
    # Should not raise.
    component.handle_v3_state_resync(args=(), source_addr=None)


def test_v3_resync_after_disconnect_noop(component):
    called = []
    component.set_state_full_on_resync(lambda: called.append(True))
    component.disconnect()
    component.handle_v3_state_resync(args=(), source_addr=None)
    assert called == []


# --- suppression arming (v3 arms with v2 pid) -----------------------------


class _RecordingMutation:
    """Minimal MutationComponent stand-in capturing arm/unarm/hot calls."""

    def __init__(self):
        self.armed = []
        self.unarmed = []
        self.hot_paths = []

    def arm_suppression(self, param_id):
        self.armed.append(param_id)

    def unarm_suppression(self, param_id):
        self.unarmed.append(param_id)

    def mark_hot(self, canonical_path):
        self.hot_paths.append(canonical_path)


def test_v3_set_arms_v2_suppression_key(component, song_with_params, generation):
    """A v3 write must arm suppression using ``_safe_int_id(parameter)``
    — the same key the v2 echo uses — so one arm silences both echoes."""
    _song, _m, t0, _t1 = song_with_params
    from components.LOMListeners import _safe_int_id
    mut = _RecordingMutation()
    component.set_mutation(mut)
    expected_pid = _safe_int_id(t0.devices[0].parameters[0])
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.5, generation.current),
        source_addr=None,
    )
    assert expected_pid in mut.armed


def test_v3_set_marks_path_hot(component, song_with_params, generation):
    """A v3 write must call ``mark_hot(path)`` so the resulting fire
    surfaces a ``param/display`` carrying Live's formatted string."""
    mut = _RecordingMutation()
    component.set_mutation(mut)
    component.handle_set_param_v3(
        args=("tracks/0/devices/0/params/0", 0.5, generation.current),
        source_addr=None,
    )
    assert mut.hot_paths == ["tracks/0/devices/0/params/0"]


def test_v3_set_does_not_mark_hot_on_resolution_failure(component, generation):
    """A path that fails resolution must not pollute the hot map."""
    mut = _RecordingMutation()
    component.set_mutation(mut)
    component.handle_set_param_v3(
        args=("tracks/99/devices/0/params/0", 0.5, generation.current),
        source_addr=None,
    )
    assert mut.hot_paths == []
