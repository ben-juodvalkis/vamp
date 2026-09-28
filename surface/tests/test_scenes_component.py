"""ScenesComponent tests — Phase 7 PR-7b pr7b-6.

Covers scene launch, per-track synthetic scene stop, scenes-
listener attach/fire/detach, error taxonomy, arg-count
validation, and disconnect idempotence.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.ScenesComponent import (
    ScenesComponent,
    V3_ERROR_ADDRESS,
    V3_ERROR_LAUNCH_FAILED,
    V3_ERROR_SCENE_NOT_FOUND,
    V3_ERROR_WRITE_REJECTED,
    V3_SCENE_LAUNCH_ADDRESS,
    V3_SCENE_STOP_ADDRESS,
)


# --- stub song ------------------------------------------------------------


class StubScene:
    def __init__(self):
        self.fired = 0
        self._fire_raises = None

    def fire(self):
        if self._fire_raises is not None:
            raise self._fire_raises
        self.fired += 1


class StubTrack:
    def __init__(self):
        self.stop_all_called = 0
        self._stop_all_raises = None

    def stop_all_clips(self):
        if self._stop_all_raises is not None:
            raise self._stop_all_raises
        self.stop_all_called += 1


class StubSong:
    def __init__(self, n_tracks: int = 3, n_scenes: int = 2):
        self.tracks = tuple(StubTrack() for _ in range(n_tracks))
        self.scenes = tuple(StubScene() for _ in range(n_scenes))
        self._scenes_listeners: List = []
        self._add_listener_raises = None
        self._remove_listener_raises = None

    def add_scenes_listener(self, cb):
        if self._add_listener_raises is not None:
            raise self._add_listener_raises
        self._scenes_listeners.append(cb)

    def remove_scenes_listener(self, cb):
        if self._remove_listener_raises is not None:
            raise self._remove_listener_raises
        if cb in self._scenes_listeners:
            self._scenes_listeners.remove(cb)

    def fire_scenes_listener(self):
        """Test helper: simulate Live firing the scenes listener."""
        for cb in list(self._scenes_listeners):
            cb()


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


@pytest.fixture
def advance_calls() -> List[str]:
    return []


@pytest.fixture
def component(emits, advance_calls):
    song = StubSong()

    def emit(addr, args):
        emits.append((addr, args))

    def advance(reason):
        advance_calls.append(reason)

    return ScenesComponent(song=song, emit=emit, advance_generation=advance)


# --- arg-count validation -------------------------------------------------


@pytest.mark.parametrize(
    "address,handler_name,bad_args,expected_detail",
    [
        (V3_SCENE_LAUNCH_ADDRESS, "handle_launch", (), "expected 1, got 0"),
        (V3_SCENE_LAUNCH_ADDRESS, "handle_launch", ("a", "b"), "expected 1, got 2"),
        (V3_SCENE_STOP_ADDRESS, "handle_stop", (), "expected 1, got 0"),
        (V3_SCENE_STOP_ADDRESS, "handle_stop", ("a", "b"), "expected 1, got 2"),
    ],
)
def test_bad_arg_count_emits_write_rejected(
    component, emits, address, handler_name, bad_args, expected_detail,
):
    handler = getattr(component, handler_name)
    handler(args=bad_args, source_addr=None)
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, path, detail = payload
    assert originating == address
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == ""
    assert detail == "arg-count: " + expected_detail


# --- scene launch ---------------------------------------------------------


def test_launch_happy_path_calls_scene_fire(component, emits):
    component.handle_launch(args=("scenes/0",), source_addr=None)

    assert component._song.scenes[0].fired == 1
    assert component._song.scenes[1].fired == 0
    assert emits == []


def test_launch_oob_emits_scene_not_found(component, emits):
    component.handle_launch(args=("scenes/99",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_SCENE_NOT_FOUND
    assert path == "scenes/99"
    # No scene was fired.
    for scene in component._song.scenes:
        assert scene.fired == 0


def test_launch_malformed_emits_write_rejected(component, emits):
    component.handle_launch(args=("not-a-path",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_launch_fire_raises_emits_launch_failed(component, emits):
    """``scene.fire()`` throws → ``launch-failed`` with the
    exception class in ``detail``."""
    component._song.scenes[1]._fire_raises = RuntimeError("live busy")

    component.handle_launch(args=("scenes/1",), source_addr=None)

    _addr, payload = emits[0]
    orig, code, path, detail = payload
    assert orig == V3_SCENE_LAUNCH_ADDRESS
    assert code == V3_ERROR_LAUNCH_FAILED
    assert path == "scenes/1"
    assert "RuntimeError" in detail
    assert "live busy" in detail


def test_launch_typeerror_caught(component, emits):
    """``Boost.Python.ArgumentError`` is a ``TypeError`` subclass."""
    component._song.scenes[0]._fire_raises = TypeError("C++ handle invalid")

    component.handle_launch(args=("scenes/0",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_LAUNCH_FAILED
    assert "TypeError" in detail


# --- scene stop -----------------------------------------------------------


def test_stop_calls_stop_all_on_every_track(component, emits):
    """Design §2.4: per-track synthetic — every track gets
    ``stop_all_clips`` called once."""
    component.handle_stop(args=("scenes/0",), source_addr=None)

    for track in component._song.tracks:
        assert track.stop_all_called == 1
    assert emits == []


def test_stop_validates_scene_path(component, emits):
    """Out-of-range scene index → ``scene-not-found``, no tracks
    touched (design explicitly requires scene-path validation
    before the fan-out)."""
    component.handle_stop(args=("scenes/99",), source_addr=None)

    for track in component._song.tracks:
        assert track.stop_all_called == 0
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SCENE_NOT_FOUND


def test_stop_malformed_path_emits_write_rejected(component, emits):
    component.handle_stop(args=("garbage",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    for track in component._song.tracks:
        assert track.stop_all_called == 0


def test_stop_one_track_raises_emits_write_rejected(component, emits):
    """If a per-track ``stop_all_clips`` raises, the handler
    continues on the remaining tracks (best-effort) and emits
    one aggregate ``write-rejected``. Other tracks are still
    stopped."""
    component._song.tracks[0]._stop_all_raises = RuntimeError("torn")

    component.handle_stop(args=("scenes/0",), source_addr=None)

    # Remaining tracks got their stop.
    assert component._song.tracks[1].stop_all_called == 1
    assert component._song.tracks[2].stop_all_called == 1
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "1/3" in detail


# --- scenes listener ------------------------------------------------------


def test_init_attaches_scenes_listener(component):
    assert len(component._song._scenes_listeners) == 1
    assert component._scenes_listener is not None


def test_scenes_change_advances_generation(component, emits, advance_calls):
    """Design §2.6: scene add/remove only advances generation —
    no targeted wire emit. The state/full scheduler rebuilds on
    the next tick."""
    component._song.fire_scenes_listener()

    assert advance_calls == ["scenes-changed"]
    assert emits == []


def test_scenes_change_multiple_fires_coalesced_by_generation(
    component, advance_calls,
):
    """Multiple scene-listener fires each advance the counter;
    the coalesce lives in the state/invalidate scheduler, not
    here. Two fires → two advances."""
    component._song.fire_scenes_listener()
    component._song.fire_scenes_listener()

    assert advance_calls == ["scenes-changed", "scenes-changed"]


def test_scenes_listener_is_song_scoped_no_structural_rebind(
    component, advance_calls,
):
    """pr7b-11 / CLAUDE.md rule 6: song-scoped attrs attach once at
    ``__init__`` — no structural rebind. The scenes listener lives
    on ``song`` (not a track or slot), so scene add/remove must
    *not* cause the component to reattach. Verified by asserting
    the listener count stays at 1 across a burst of fires, and no
    ``rebind`` method exists on the component.
    """
    # Listener attached exactly once at __init__.
    assert len(component._song._scenes_listeners) == 1
    cb_at_init = component._song._scenes_listeners[0]

    # Simulate 20 scene add/remove events in succession.
    for _ in range(20):
        component._song.fire_scenes_listener()

    # Still exactly one listener, same callback identity — no rebind.
    assert len(component._song._scenes_listeners) == 1
    assert component._song._scenes_listeners[0] is cb_at_init
    assert len(advance_calls) == 20

    # Public surface does not expose a rebind hook — matches rule 6.
    assert not hasattr(component, "rebind")


def test_advance_generation_exception_does_not_propagate(
    emits,
):
    """Defensive: a raising ``advance_generation`` must not escape
    the listener fire path."""
    def boom(reason):
        raise RuntimeError("generation torn down")

    song = StubSong()
    comp = ScenesComponent(
        song=song,
        emit=lambda a, x: emits.append((a, x)),
        advance_generation=boom,
    )
    # Must not raise.
    song.fire_scenes_listener()


def test_init_survives_song_without_listener_method(emits, advance_calls):
    """If the LOM doesn't expose ``add_scenes_listener`` (older
    builds / partial mocks), init still succeeds and the handlers
    still serve."""

    class SongNoListener:
        def __init__(self):
            self.tracks = (StubTrack(),)
            self.scenes = (StubScene(),)

    comp = ScenesComponent(
        song=SongNoListener(),
        emit=lambda a, x: emits.append((a, x)),
        advance_generation=lambda r: advance_calls.append(r),
    )
    assert comp._scenes_listener is None
    # Launch still works.
    comp.handle_launch(args=("scenes/0",), source_addr=None)
    assert emits == []


def test_init_survives_add_listener_raise(emits, advance_calls):
    """LOM raise during attach → log + continue. Listener bookkeep
    stays empty so disconnect doesn't try to detach a non-attach."""
    song = StubSong()
    song._add_listener_raises = RuntimeError("add failed")

    comp = ScenesComponent(
        song=song,
        emit=lambda a, x: emits.append((a, x)),
        advance_generation=lambda r: advance_calls.append(r),
    )
    assert comp._scenes_listener is None
    assert song._scenes_listeners == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_scenes_listener(component):
    component.disconnect()
    assert component._song._scenes_listeners == []
    assert component._scenes_listener is None


def test_disconnect_blocks_handlers(component, emits):
    component.disconnect()
    component.handle_launch(args=("scenes/0",), source_addr=None)
    component.handle_stop(args=("scenes/0",), source_addr=None)
    assert emits == []


def test_disconnect_idempotent(component):
    component.disconnect()
    component.disconnect()
    component.disconnect()  # no-raise


def test_disconnect_survives_remove_listener_raise(component):
    """Torn-down LOM: ``remove_scenes_listener`` raises. Disconnect
    still completes and the listener tracking clears."""
    component._song._remove_listener_raises = RuntimeError("handle invalid")
    component.disconnect()
    assert component._scenes_listener is None


def test_disconnected_listener_fire_is_silent(
    component, emits, advance_calls,
):
    """Stale fire after disconnect (teardown race) is short-
    circuited by the _disconnected guard in _on_scenes_changed."""
    stale_cb = component._song._scenes_listeners[0]

    component.disconnect()

    stale_cb()

    assert advance_calls == []
    assert emits == []


# --- wire-address constants ----------------------------------------------


def test_wire_addresses_are_stable():
    assert V3_SCENE_LAUNCH_ADDRESS == "/looping/v3/scene/launch"
    assert V3_SCENE_STOP_ADDRESS == "/looping/v3/scene/stop"
    assert V3_ERROR_ADDRESS == "/looping/v3/error"
