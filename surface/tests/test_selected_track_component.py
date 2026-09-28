"""SelectedTrackComponent tests — Phase 7 PR-7d pr7d-2..pr7d-4.

Covers:

- **pr7d-2 (skeleton).** ``__init__`` attaches the
  ``selected_track`` listener on ``song.view`` and caches the
  canonical path. Return-track selection resolves to ``None``
  (design §4.2 / Q1 skip-emit case). ``disconnect`` detaches;
  subsequent late fires no-op. LOM failures on attach / read are
  swallowed and warned once.
- **pr7d-3 (emit).** Commit fire with a resolvable path emits
  ``/looping/v3/selected_track [trackPath]`` and calls
  ``schedule_state_full(path)``. Return-track commits skip both
  calls. No emit fires from ``__init__``. Disconnected
  component never emits.
- **pr7d-4 (50ms coalesce).** Listener fires schedule a single
  delayed commit via ``schedule_delayed``; subsequent fires in
  the window overwrite the pending target without re-scheduling
  (last-wins). The injected ``schedule_delayed`` stub captures
  calls and lets the suite drive commits deterministically —
  no wall-clock dependency.

Stubs mirror ``test_clip_properties_component.StubView`` — same
``song.view`` shape but observing ``selected_track`` instead of
``detail_clip``.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import pytest

from components.SelectedTrackComponent import (
    V3_DRUM_PAD_HOLD_ADDRESS,
    V3_MOVE_PAD_HOLD_ADDRESS,
    COALESCE_WINDOW_MS,
    MOVE_VOLUME_STEP,
    SelectedTrackComponent,
    V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_PATH_NOT_SUPPORTED,
    V3_ERROR_WRITE_REJECTED,
    V3_SELECT_CLIP_ADDRESS,
    V3_SELECTED_SCENE_ADDRESS,
    V3_SELECTED_TRACK_ADDRESS,
    V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS,
    V3_TRACK_SELECT_ADDRESS,
)
from tests.test_lom_listeners import StubTrack


class FakeScheduler:
    """Captures ``schedule_delayed`` calls and lets tests fire the
    pending callback on demand. Real Live uses
    ``LoopingSurface._schedule_delayed`` (100ms tick rounding);
    tests drive ``fire_pending()`` to commit without wall time."""

    def __init__(self):
        self.calls: List[Tuple[int, object]] = []

    def __call__(self, delay_ms, fn):
        self.calls.append((delay_ms, fn))

    def fire_pending(self) -> None:
        """Run the most recently scheduled callback and pop it.
        Mirrors the "next tick" behavior of Live's scheduler."""
        if not self.calls:
            raise AssertionError("no pending scheduled callback")
        _, fn = self.calls.pop()
        fn()

    @property
    def pending_count(self) -> int:
        return len(self.calls)


# --- stubs ----------------------------------------------------------------


class StubView:
    """``song.view`` shim with ``selected_track`` + listener.

    ROW 7c added ``selected_scene`` + listener (same shape) and
    ``highlighted_clip_slot`` (write-only target of
    ``handle_select_clip``). Tests that don't care about scene still
    see a quiet listener slot — fires are only emitted when tests
    explicitly invoke ``set_selected_scene``.
    """

    def __init__(self, selected_track=None, selected_scene=None):
        self._selected_track = selected_track
        self._listener = None
        self._selected_scene = selected_scene
        self._scene_listener = None
        self.highlighted_clip_slot = None

    @property
    def selected_track(self):
        return self._selected_track

    @selected_track.setter
    def selected_track(self, track) -> None:
        """Direct assignment — mirrors Live's ``view.selected_track =
        track`` contract. Fires the listener synchronously
        (observable-attr protocol)."""
        self._selected_track = track
        if self._listener is not None:
            self._listener()

    def set_selected_track(self, track) -> None:
        """Back-compat for the existing listener-fire helper."""
        self.selected_track = track

    def add_selected_track_listener(self, cb):
        assert self._listener is None, "one selected_track listener"
        self._listener = cb

    def remove_selected_track_listener(self, cb):
        assert self._listener == cb
        self._listener = None

    def has_listener(self) -> bool:
        return self._listener is not None

    # --- ROW 7c: selected_scene -----------------------------------------

    @property
    def selected_scene(self):
        return self._selected_scene

    @selected_scene.setter
    def selected_scene(self, scene) -> None:
        self._selected_scene = scene
        if self._scene_listener is not None:
            self._scene_listener()

    def set_selected_scene(self, scene) -> None:
        self.selected_scene = scene

    def add_selected_scene_listener(self, cb):
        assert self._scene_listener is None, "one selected_scene listener"
        self._scene_listener = cb

    def remove_selected_scene_listener(self, cb):
        assert self._scene_listener == cb
        self._scene_listener = None

    def has_scene_listener(self) -> bool:
        return self._scene_listener is not None


class SelStubSong:
    """Song with tracks + master_track + ``view``.

    Distinct from ``test_lom_listeners.StubSong`` because that one
    has no ``view`` attribute. The component also never touches
    ``song.return_tracks`` directly in pr7d-2 (path_resolver walks
    ``song.tracks`` + master); return-track selection is simulated
    by handing the view a Track that isn't in the tracks list and
    isn't master — ``compose_track_path`` returns ``None`` for that
    handle, which is the "skip emit" case per design §4.2.
    """

    def __init__(
        self,
        tracks: Optional[List[StubTrack]] = None,
        master: Optional[StubTrack] = None,
        selected_track=None,
        scenes: Optional[list] = None,
        selected_scene=None,
    ):
        self._tracks = list(tracks or [])
        self.master_track = master if master is not None else StubTrack(
            tid=9_999_999, name="Master",
        )
        self._scenes = list(scenes or [])
        self.view = StubView(
            selected_track=selected_track,
            selected_scene=selected_scene,
        )

    @property
    def tracks(self):
        return list(self._tracks)

    @property
    def scenes(self):
        return list(self._scenes)


class RaisingView:
    """``song.view`` that raises on attribute access — exercises
    the LOM-guard path."""

    def __init__(self, attach_raises=False, read_raises=False):
        self._attach_raises = attach_raises
        self._read_raises = read_raises
        self.attach_attempts = 0

    @property
    def selected_track(self):
        if self._read_raises:
            raise RuntimeError("selected_track read boom")
        return None

    def add_selected_track_listener(self, cb):
        self.attach_attempts += 1
        if self._attach_raises:
            raise RuntimeError("attach boom")

    # ROW 7c: scene listener surface — quiet defaults so tests that
    # only target ``selected_track``'s LOM-guard path don't accidentally
    # trip the scene attach branch too.
    @property
    def selected_scene(self):
        return None

    def add_selected_scene_listener(self, cb):
        return None


class RaisingViewSong:
    def __init__(self, view):
        self.view = view
        self._tracks: List[StubTrack] = []
        self.master_track = StubTrack(tid=9_999_999, name="Master")

    @property
    def tracks(self):
        return list(self._tracks)

    @property
    def scenes(self):
        return []


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def captured_emits() -> List[Tuple[str, list]]:
    return []


@pytest.fixture
def state_full_calls() -> List[str]:
    return []


@pytest.fixture
def scheduler() -> FakeScheduler:
    return FakeScheduler()


def _make_component(song, captured_emits, state_full_calls, scheduler):
    emit = lambda addr, args: captured_emits.append((addr, args))
    schedule_state_full = lambda path: state_full_calls.append(path)
    return SelectedTrackComponent(
        song=song,
        emit=emit,
        schedule_state_full=schedule_state_full,
        schedule_delayed=scheduler,
    )


# --- tests ----------------------------------------------------------------


def test_init_attaches_listener_on_song_view(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    assert comp.listener_attached is True
    assert song.view.has_listener() is True


def test_init_seeds_regular_track_path(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t1)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    assert comp.selected_path == "tracks/1"


def test_init_seeds_master_path_literal(
    captured_emits, state_full_calls, scheduler,
):
    master = StubTrack(tid=9_999_999, name="Master")
    song = SelStubSong(
        tracks=[StubTrack(tid=100)], master=master, selected_track=master,
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    # Literal "master" — not "tracks/-1" — per design §3.4.
    assert comp.selected_path == "master"


def test_init_on_return_track_records_none_path(
    captured_emits, state_full_calls, scheduler,
):
    """Return tracks are not in ``song.tracks`` and aren't master;
    ``compose_track_path`` returns ``None``. Per design §4.2 / Q1
    the component records ``None`` (skip-emit)."""
    t0 = StubTrack(tid=100, name="t0")
    # Simulate a return-track selection by handing the view a track
    # handle that isn't in ``song.tracks`` and isn't master.
    return_track = StubTrack(tid=200, name="Return A")
    song = SelStubSong(tracks=[t0], selected_track=return_track)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    assert comp.selected_path is None


def test_init_does_not_emit(captured_emits, state_full_calls, scheduler):
    """``__init__`` only seeds the cache — it does not emit. The
    ``emit_on_accept`` hook (pr7d-5) handles post-handshake seed;
    the constructor stays silent so cold-start ordering stays
    under `LoopingSurface`'s control."""
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)

    assert captured_emits == []
    assert state_full_calls == []


def test_listener_schedules_one_commit(
    captured_emits, state_full_calls, scheduler,
):
    """First fire in a quiet period schedules a single delayed
    commit. No emit until ``fire_pending`` runs."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    song.view.set_selected_track(t1)

    assert scheduler.pending_count == 1
    assert scheduler.calls[0][0] == COALESCE_WINDOW_MS
    # Emit is deferred — no wire yet.
    assert captured_emits == []
    assert state_full_calls == []


def test_commit_emits_regular_track_path(
    captured_emits, state_full_calls, scheduler,
):
    """After ``schedule_delayed`` fires, the commit emits
    ``/looping/v3/selected_track [tracks/<N>]`` and calls
    ``schedule_state_full``."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    song.view.set_selected_track(t1)
    scheduler.fire_pending()

    assert captured_emits == [
        ("/looping/v3/selected_track", ["tracks/1"]),
    ]
    assert len(state_full_calls) == 1


def test_commit_emits_master_as_literal(
    captured_emits, state_full_calls, scheduler,
):
    """Master selection commits to literal ``"master"`` — the
    canonical path per design §3.4."""
    t0 = StubTrack(tid=100, name="t0")
    master = StubTrack(tid=9_999_999, name="Master")
    song = SelStubSong(tracks=[t0], master=master, selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    song.view.set_selected_track(master)
    scheduler.fire_pending()

    assert captured_emits == [
        ("/looping/v3/selected_track", ["master"]),
    ]
    assert len(state_full_calls) == 1


def test_commit_skips_on_return_track(
    captured_emits, state_full_calls, scheduler,
):
    """Return-track pending target → commit skips emit +
    state/full. Per design §4.2 / Q1."""
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    return_track = StubTrack(tid=200, name="Return A")
    song.view.set_selected_track(return_track)
    scheduler.fire_pending()

    assert captured_emits == []
    assert state_full_calls == []


def test_coalesce_collapses_burst_to_one_emit(
    captured_emits, state_full_calls, scheduler,
):
    """8 fires inside the 50ms window → exactly one scheduled
    commit → one emit, last-wins. This is the core pr7d-4
    invariant — the entire PR's reason for existing is to keep
    rapid selection steps from flooding the wire."""
    tracks = [StubTrack(tid=100 + i, name=f"t{i}") for i in range(8)]
    song = SelStubSong(tracks=tracks, selected_track=tracks[0])

    _make_component(song, captured_emits, state_full_calls, scheduler)
    for target in tracks[1:]:
        song.view.set_selected_track(target)

    # 7 fires, all during one window → one schedule.
    assert scheduler.pending_count == 1
    assert captured_emits == []

    scheduler.fire_pending()
    # Last-wins: the final target (tracks[7]) is what emits.
    assert captured_emits == [
        ("/looping/v3/selected_track", ["tracks/7"]),
    ]
    assert len(state_full_calls) == 1


def test_coalesce_reopens_window_after_commit(
    captured_emits, state_full_calls, scheduler,
):
    """After a commit fires, a subsequent listener fire schedules
    a fresh window. Two windows → two emits."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    t2 = StubTrack(tid=102, name="t2")
    song = SelStubSong(tracks=[t0, t1, t2], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    song.view.set_selected_track(t1)
    scheduler.fire_pending()
    song.view.set_selected_track(t2)
    scheduler.fire_pending()

    assert captured_emits == [
        ("/looping/v3/selected_track", ["tracks/1"]),
        ("/looping/v3/selected_track", ["tracks/2"]),
    ]
    assert len(state_full_calls) == 2


def test_coalesce_last_wins_regular_then_return(
    captured_emits, state_full_calls, scheduler,
):
    """Regular → return inside one window: commit sees the
    return as pending and skips emit. The earlier regular
    target does not sneak through."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    return_track = StubTrack(tid=200, name="Return A")
    song.view.set_selected_track(t1)
    song.view.set_selected_track(return_track)
    scheduler.fire_pending()

    assert captured_emits == []
    assert state_full_calls == []


def test_coalesce_last_wins_return_then_regular(
    captured_emits, state_full_calls, scheduler,
):
    """Return → regular inside one window: commit sees the
    regular as pending and emits it. The earlier return-track
    skip does not suppress."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    _make_component(song, captured_emits, state_full_calls, scheduler)
    return_track = StubTrack(tid=200, name="Return A")
    song.view.set_selected_track(return_track)
    song.view.set_selected_track(t1)
    scheduler.fire_pending()

    assert captured_emits == [
        ("/looping/v3/selected_track", ["tracks/1"]),
    ]
    assert len(state_full_calls) == 1


def test_disconnect_before_commit_cancels_emit(
    captured_emits, state_full_calls, scheduler,
):
    """If the component is disconnected between schedule and
    commit, the pending callback must not emit. Real Live
    ``schedule_message`` callbacks can fire after the component
    has been torn down."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    song.view.set_selected_track(t1)
    comp.disconnect()
    scheduler.fire_pending()

    assert captured_emits == []
    assert state_full_calls == []


def test_disconnected_listener_does_not_schedule(
    captured_emits, state_full_calls, scheduler,
):
    """A late LOM fire after ``disconnect`` must not emit and
    must not schedule. The ``_disconnected`` gate precedes both."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.disconnect()
    comp._on_selected_track_changed()  # simulate late fire

    assert captured_emits == []
    assert state_full_calls == []
    assert scheduler.pending_count == 0


def test_listener_updates_cached_path_on_change(
    captured_emits, state_full_calls, scheduler,
):
    """The listener body is wired; only the emit is deferred to
    pr7d-3. Path cache must refresh on each fire so pr7d-3 / pr7d-4
    can read ``selected_path`` at emit time."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    t2 = StubTrack(tid=102, name="t2")
    song = SelStubSong(tracks=[t0, t1, t2], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    assert comp.selected_path == "tracks/0"

    song.view.set_selected_track(t2)
    assert comp.selected_path == "tracks/2"

    song.view.set_selected_track(song.master_track)
    assert comp.selected_path == "master"


def test_listener_change_to_return_track_clears_path(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    assert comp.selected_path == "tracks/0"

    return_track = StubTrack(tid=200, name="Return A")
    song.view.set_selected_track(return_track)
    assert comp.selected_path is None


def test_disconnect_detaches_listener(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    assert song.view.has_listener() is True

    comp.disconnect()

    assert song.view.has_listener() is False
    assert comp.listener_attached is False


def test_disconnect_is_idempotent(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.disconnect()
    comp.disconnect()  # must not raise

    assert comp.listener_attached is False


def test_listener_noop_after_disconnect(
    captured_emits, state_full_calls, scheduler,
):
    """The StubView detaches on ``disconnect``, but in real Live a
    late-firing listener could still land. Body must no-op when
    ``_disconnected``."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    # Direct-invoke the listener after disconnect to simulate a
    # late LOM fire before Live cleans up the callback slot.
    comp.disconnect()
    song._tracks = [t0, t1]
    comp._selected_path = "tracks/0"  # pre-disconnect value frozen
    comp._on_selected_track_changed()

    # Path must not have updated — disconnect gate holds.
    assert comp.selected_path == "tracks/0"


def test_attach_failure_is_warned_and_component_stays_usable(
    captured_emits, state_full_calls, scheduler,
):
    view = RaisingView(attach_raises=True)
    song = RaisingViewSong(view)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    # Listener didn't attach, but construction still succeeded.
    assert comp.listener_attached is False
    # No crash on path read; returns None from safe-fallback.
    assert comp.selected_path is None


def test_selected_track_read_failure_swallowed(
    captured_emits, state_full_calls, scheduler,
):
    view = RaisingView(read_raises=True)
    song = RaisingViewSong(view)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    # Listener attached (attach didn't raise) but the initial seed
    # read raised — ``_selected_path`` safely defaults to ``None``.
    assert comp.listener_attached is True
    assert comp.selected_path is None


def test_address_constant_matches_wire_spec():
    """Sanity-check the closed-enum address string so a rename in
    one place breaks the test, not the wire."""
    assert V3_SELECTED_TRACK_ADDRESS == "/looping/v3/selected_track"


# --- emit_on_accept (pr7d-5) ----------------------------------------------


def test_emit_on_accept_seeds_regular_track(
    captured_emits, state_full_calls, scheduler,
):
    """Handshake accept re-emits the current selected path so a
    late-connecting UI sees the current state. Bypasses the
    coalesce — accept is a one-shot seed, not bursty."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t1)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.emit_on_accept()

    assert captured_emits == [
        ("/looping/v3/selected_track", ["tracks/1"]),
    ]
    # No state/full — accept chain already has V3StateFullComponent.emit_on_accept
    # handling the tree; a second state/full schedule here would be
    # redundant and noisy.
    assert state_full_calls == []


def test_emit_on_accept_seeds_master(
    captured_emits, state_full_calls, scheduler,
):
    master = StubTrack(tid=9_999_999, name="Master")
    song = SelStubSong(
        tracks=[StubTrack(tid=100)], master=master, selected_track=master,
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.emit_on_accept()

    assert captured_emits == [
        ("/looping/v3/selected_track", ["master"]),
    ]


def test_emit_on_accept_skips_when_path_is_none(
    captured_emits, state_full_calls, scheduler,
):
    """If the current selection is a return track (or otherwise
    unresolvable), accept has nothing to seed — skip silently.
    The skip log already fired at the initial listener fire; no
    need to duplicate on accept."""
    t0 = StubTrack(tid=100, name="t0")
    return_track = StubTrack(tid=200, name="Return A")
    song = SelStubSong(tracks=[t0], selected_track=return_track)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    assert comp.selected_path is None

    comp.emit_on_accept()
    assert captured_emits == []


def test_emit_on_accept_is_noop_after_disconnect(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.disconnect()
    comp.emit_on_accept()

    assert captured_emits == []


# --- handle_select (ROW 2-F4) ---------------------------------------------


def test_handle_select_regular_track_writes_view(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select(["tracks/1"], source_addr=None)

    assert song.view.selected_track is t1


def test_handle_select_master_writes_view(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select(["master"], source_addr=None)

    assert song.view.selected_track is song.master_track


def test_handle_select_not_found_emits_error(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select(["tracks/99"], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    addr, args = errors[0]
    originating, code, path, _detail = args
    assert originating == V3_TRACK_SELECT_ADDRESS
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/99"
    # View untouched.
    assert song.view.selected_track is t0


def test_handle_select_malformed_path_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select(["bogus/1/2"], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    originating, code, path, _detail = args
    assert originating == V3_TRACK_SELECT_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "bogus/1/2"


def test_handle_select_arg_count_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select([], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "arg-count" in detail


def test_handle_select_noop_after_disconnect(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.disconnect()
    comp.handle_select(["tracks/1"], source_addr=None)

    # View untouched; no errors emitted after disconnect.
    assert song.view.selected_track is t0
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_handle_select_wire_address_stable():
    assert V3_TRACK_SELECT_ADDRESS == "/looping/v3/track/select"


# --- handle_relative_volume (ROW 5 Move encoder) --------------------------


class StubVolumeParam:
    """``mixer_device.volume`` shim — minimal ``value`` + raise hooks."""

    def __init__(self, value=0.5, read_raises=False, write_raises=False):
        self._value = float(value)
        self._read_raises = read_raises
        self._write_raises = write_raises
        self.writes: List[float] = []

    @property
    def value(self):
        if self._read_raises:
            raise RuntimeError("volume read boom")
        return self._value

    @value.setter
    def value(self, v):
        if self._write_raises:
            raise RuntimeError("volume write boom")
        self._value = float(v)
        self.writes.append(self._value)


class StubMixer:
    def __init__(self, volume: StubVolumeParam):
        self.volume = volume


def _attach_mixer(track, initial_value=0.5, **kwargs):
    """Attach a ``mixer_device.volume`` onto a ``StubTrack`` and
    return the underlying ``StubVolumeParam`` for assertions."""
    vol = StubVolumeParam(value=initial_value, **kwargs)
    track.mixer_device = StubMixer(vol)
    return vol


def test_relative_volume_up_applies_positive_step(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([1], source_addr=None)

    assert vol.writes == [pytest.approx(0.5 + MOVE_VOLUME_STEP)]
    # No direct emit — listener echo is the sole sync path.
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_relative_volume_down_applies_negative_step(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([127], source_addr=None)

    assert vol.writes == [pytest.approx(0.5 - MOVE_VOLUME_STEP)]


def test_relative_volume_clamps_to_unity(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.999)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([1], source_addr=None)

    assert vol.writes == [1.0]


def test_relative_volume_clamps_to_silence(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.001)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([127], source_addr=None)

    assert vol.writes == [0.0]


def test_relative_volume_master_selection_writes_master_mixer(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(tracks=[t0])
    master_vol = _attach_mixer(song.master_track, initial_value=0.5)
    song.view.selected_track = song.master_track
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([1], source_addr=None)

    assert master_vol.writes == [pytest.approx(0.5 + MOVE_VOLUME_STEP)]


def test_relative_volume_invalid_midi_value_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([64], source_addr=None)

    assert vol.writes == []
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    originating, code, _, detail = args
    assert originating == V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert "midi-value" in detail


def test_relative_volume_non_numeric_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume(["not-a-number"], source_addr=None)

    assert vol.writes == []
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "midi-value" in detail


def test_relative_volume_arg_count_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_mixer(t0)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "arg-count" in detail


# --- SessionSettings move_volume_knob gate (2026-04-22) ------------------


def test_relative_volume_silently_dropped_when_gate_off(
    captured_emits, state_full_calls, scheduler,
):
    """Gate OFF: no volume write, no error emit. Silent drop —
    a Move-sending-while-off is not a user error, just inactive input."""
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = SelectedTrackComponent(
        song=song,
        emit=lambda addr, args: captured_emits.append((addr, args)),
        schedule_state_full=lambda path: state_full_calls.append(path),
        schedule_delayed=scheduler,
        should_handle_move_volume_knob=lambda: False,
    )

    comp.handle_relative_volume([1], source_addr=None)
    comp.handle_relative_volume([127], source_addr=None)

    assert vol.writes == []
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_relative_volume_gate_flip_respected_live(
    captured_emits, state_full_calls, scheduler,
):
    """The getter is pulled per-call — flipping between messages
    changes the outcome without re-constructing the component."""
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)

    gate = {"on": True}
    comp = SelectedTrackComponent(
        song=song,
        emit=lambda addr, args: captured_emits.append((addr, args)),
        schedule_state_full=lambda path: state_full_calls.append(path),
        schedule_delayed=scheduler,
        should_handle_move_volume_knob=lambda: gate["on"],
    )

    comp.handle_relative_volume([1], source_addr=None)
    assert len(vol.writes) == 1  # wrote while on

    gate["on"] = False
    comp.handle_relative_volume([1], source_addr=None)
    assert len(vol.writes) == 1  # skipped while off

    gate["on"] = True
    comp.handle_relative_volume([1], source_addr=None)
    assert len(vol.writes) == 2  # wrote again after re-enable


def test_relative_volume_default_getter_preserves_legacy_behavior(
    captured_emits, state_full_calls, scheduler,
):
    """No ``should_handle_move_volume_knob`` arg → default on →
    legacy volume-write behavior unchanged."""
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([1], source_addr=None)

    assert len(vol.writes) == 1


def test_relative_volume_lom_read_raise_emits_error(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_mixer(t0, initial_value=0.5, read_raises=True)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([1], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "volume read raised" in detail


def test_relative_volume_lom_write_raise_emits_error(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_mixer(t0, initial_value=0.5, write_raises=True)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_relative_volume([1], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "volume write raised" in detail


def test_relative_volume_noop_after_disconnect(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    vol = _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.disconnect()
    comp.handle_relative_volume([1], source_addr=None)

    assert vol.writes == []
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_relative_volume_wire_address_stable():
    assert (
        V3_SELECTED_TRACK_VOLUME_RELATIVE_ADDRESS
        == "/looping/v3/selected_track/volume_relative"
    )


# --- ROW 7c: selected_scene listener + handle_select_clip -----------------


class _StubScene:
    """Minimal stand-in for ``Live.Scene``. Identity-distinct objects;
    the component matches by ``is``, so plain Python identity works."""

    def __init__(self, name: str = ""):
        self.name = name


class _StubClipSlot:
    """Stand-in for ``ClipSlot`` — a plain sentinel, since
    ``handle_select_clip`` writes it straight into
    ``view.highlighted_clip_slot`` without inspection."""

    def __init__(self, label: str = ""):
        self.label = label


def _attach_clip_slots(track: StubTrack, num_slots: int = 4) -> list:
    slots = [_StubClipSlot(label="t%d_s%d" % (track.id, i)) for i in range(num_slots)]
    track.clip_slots = slots
    return slots


def test_scene_listener_attached_on_init(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    scene0 = _StubScene("1")
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=[scene0],
        selected_scene=scene0,
    )

    _make_component(song, captured_emits, state_full_calls, scheduler)

    assert song.view.has_scene_listener() is True


def test_scene_init_seeds_current_index(
    captured_emits, state_full_calls, scheduler,
):
    """``__init__`` caches the initial scene index but does not emit —
    same discipline as selected_track; accept-emit seeds the wire."""
    t0 = StubTrack(tid=100, name="t0")
    scenes = [_StubScene(str(i)) for i in range(3)]
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=scenes,
        selected_scene=scenes[2],
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    assert comp._selected_scene_index == 2
    # Silent at construction — emit_on_accept carries the seed.
    assert captured_emits == []


def test_scene_change_emits_index_immediately(
    captured_emits, state_full_calls, scheduler,
):
    """Scene changes emit without coalesce (no Live burst-fire pattern
    analogous to selected_track's insert-track double-fire)."""
    t0 = StubTrack(tid=100, name="t0")
    scenes = [_StubScene(str(i)) for i in range(3)]
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=scenes,
        selected_scene=scenes[0],
    )

    _make_component(song, captured_emits, state_full_calls, scheduler)
    song.view.set_selected_scene(scenes[1])

    assert captured_emits == [
        (V3_SELECTED_SCENE_ADDRESS, [1]),
    ]
    # No scheduler activity — scene fires commit inline.
    assert scheduler.pending_count == 0


def test_scene_change_to_unknown_suppresses_emit(
    captured_emits, state_full_calls, scheduler,
):
    """If the selected scene is not in ``song.scenes`` (shouldn't happen
    in practice, but LOM races under rebuild are possible), emit is
    suppressed — index stays ``None``."""
    t0 = StubTrack(tid=100, name="t0")
    scenes = [_StubScene(str(i)) for i in range(2)]
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=scenes,
        selected_scene=scenes[0],
    )

    _make_component(song, captured_emits, state_full_calls, scheduler)
    captured_emits.clear()

    stray = _StubScene("stray")
    song.view.set_selected_scene(stray)

    assert captured_emits == []


def test_emit_on_accept_seeds_scene_index(
    captured_emits, state_full_calls, scheduler,
):
    """Cold-start seed: accept-emit must push current scene index
    alongside selected_track so the UI lands with correct state."""
    t0 = StubTrack(tid=100, name="t0")
    scenes = [_StubScene(str(i)) for i in range(4)]
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=scenes,
        selected_scene=scenes[3],
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.emit_on_accept()

    assert (V3_SELECTED_TRACK_ADDRESS, ["tracks/0"]) in captured_emits
    assert (V3_SELECTED_SCENE_ADDRESS, [3]) in captured_emits


def test_emit_on_accept_skips_scene_when_index_is_none(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    song = SelStubSong(
        tracks=[t0], selected_track=t0, scenes=[], selected_scene=None,
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.emit_on_accept()

    scene_emits = [e for e in captured_emits if e[0] == V3_SELECTED_SCENE_ADDRESS]
    assert scene_emits == []


def test_disconnect_detaches_scene_listener(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    scenes = [_StubScene("0")]
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=scenes,
        selected_scene=scenes[0],
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    assert song.view.has_scene_listener() is True

    comp.disconnect()
    assert song.view.has_scene_listener() is False


def test_scene_fire_after_disconnect_does_not_emit(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    scenes = [_StubScene(str(i)) for i in range(2)]
    song = SelStubSong(
        tracks=[t0],
        selected_track=t0,
        scenes=scenes,
        selected_scene=scenes[0],
    )

    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.disconnect()
    comp._on_selected_scene_changed()  # simulate late fire

    scene_emits = [e for e in captured_emits if e[0] == V3_SELECTED_SCENE_ADDRESS]
    assert scene_emits == []


def test_scene_wire_address_stable():
    assert V3_SELECTED_SCENE_ADDRESS == "/looping/v3/selected_scene"


# --- handle_select_clip ---------------------------------------------------


def test_handle_select_clip_sets_highlighted_clip_slot(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    slots = _attach_clip_slots(t0, num_slots=4)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["tracks/0", 2], source_addr=None)

    assert song.view.highlighted_clip_slot is slots[2]
    # Silent wire on success.
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_handle_select_clip_out_of_range_rejects_not_found(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["tracks/0", 9], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    originating, code, _path, detail = args
    assert originating == V3_SELECT_CLIP_ADDRESS
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert "out of range" in detail
    # View untouched.
    assert song.view.highlighted_clip_slot is None


def test_handle_select_clip_negative_index_rejects_not_found(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["tracks/0", -1], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, _ = args
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_handle_select_clip_unknown_track_rejects_not_found(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["tracks/42", 0], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    originating, code, path, _ = args
    assert originating == V3_SELECT_CLIP_ADDRESS
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/42"


def test_handle_select_clip_malformed_path_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["bogus/x", 0], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, path, _ = args
    assert code in (V3_ERROR_WRITE_REJECTED, V3_ERROR_PATH_NOT_FOUND)
    assert path == "bogus/x"


def test_handle_select_clip_non_integer_scene_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["tracks/0", "oops"], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "sceneIndex" in detail


def test_handle_select_clip_arg_count_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_select_clip(["tracks/0"], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "arg-count" in detail


def test_handle_select_clip_lom_rejection_emits_write_rejected(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    # Patch the view's setter to raise.
    class _BoomView:
        def __init__(self, inner):
            self._inner = inner

        def __getattr__(self, name):
            return getattr(self._inner, name)

        @property
        def highlighted_clip_slot(self):
            return getattr(self._inner, "highlighted_clip_slot", None)

        @highlighted_clip_slot.setter
        def highlighted_clip_slot(self, v):
            raise RuntimeError("LOM rejects highlighted_clip_slot")

    # Swap the view reference on the component (mirrors how real Live
    # could reject a write without exposing a raising attribute on the
    # stock stub). The component caches ``self._view`` at init, so
    # this rebind is the simplest way to exercise the write-raise path.
    comp._view = _BoomView(song.view)

    comp.handle_select_clip(["tracks/0", 0], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "highlighted_clip_slot write raised" in detail


def test_handle_select_clip_after_disconnect_is_noop(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    _attach_clip_slots(t0, num_slots=2)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.disconnect()

    comp.handle_select_clip(["tracks/0", 0], source_addr=None)

    assert song.view.highlighted_clip_slot is None
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_select_clip_wire_address_stable():
    assert V3_SELECT_CLIP_ADDRESS == "/looping/v3/selected_clip"

# --- handle_drum_chain_relative_volume (ADR-412 Move encoder 2) -----------


class StubChain:
    """``Chain`` shim — just the ``mixer_device.volume`` leg."""

    def __init__(self, volume: StubVolumeParam | None = None):
        self.mixer_device = StubMixer(volume or StubVolumeParam())


class StubDrumPad:
    """``DrumPad`` shim — ``chains`` list (empty = empty pad) and the
    pad's MIDI ``note`` (ADR-432 names it on the wire)."""

    def __init__(self, chains=None, note=36):
        self.chains = list(chains or [])
        self.note = note


class StubRackView:
    """``RackDevice.view`` shim — ``selected_drum_pad`` +
    ``selected_chain``."""

    def __init__(self, selected_drum_pad=None, selected_chain=None):
        self.selected_drum_pad = selected_drum_pad
        self.selected_chain = selected_chain


class StubRackDevice:
    """``RackDevice`` shim carrying ``class_name`` + ``view``."""

    def __init__(self, view, class_name="DrumGroupDevice", name="Drum Rack"):
        self.class_name = class_name
        self.name = name
        self.view = view


class StubPlainDevice:
    """Non-rack device — the scan must skip it."""

    def __init__(self, class_name="AutoFilter2", name="fx"):
        self.class_name = class_name
        self.name = name


def _make_drum_track(tid=100, chain_value=0.5, prefix_devices=None):
    """StubTrack with a drum rack whose selected pad has one chain.
    Returns ``(track, chain_volume_param)``."""
    vol = StubVolumeParam(value=chain_value)
    chain = StubChain(vol)
    pad = StubDrumPad(chains=[chain])
    rack = StubRackDevice(view=StubRackView(selected_drum_pad=pad))
    devices = list(prefix_devices or []) + [rack]
    track = StubTrack(tid=tid, name="drums", devices=devices)
    return track, vol


def test_drum_chain_volume_up_applies_positive_step(
    captured_emits, state_full_calls, scheduler,
):
    t0, vol = _make_drum_track(chain_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    assert vol.writes == [pytest.approx(0.5 + MOVE_VOLUME_STEP)]
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_drum_chain_volume_down_applies_negative_step(
    captured_emits, state_full_calls, scheduler,
):
    t0, vol = _make_drum_track(chain_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([127], source_addr=None)

    assert vol.writes == [pytest.approx(0.5 - MOVE_VOLUME_STEP)]


def test_drum_chain_volume_clamps_both_ends(
    captured_emits, state_full_calls, scheduler,
):
    t0, vol = _make_drum_track(chain_value=0.999)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)
    assert vol.writes == [1.0]

    t1, vol_low = _make_drum_track(tid=101, chain_value=0.001)
    song.view.selected_track = t1
    song._tracks.append(t1)
    comp.handle_drum_chain_relative_volume([127], source_addr=None)
    assert vol_low.writes == [0.0]


def test_drum_chain_volume_skips_non_rack_devices(
    captured_emits, state_full_calls, scheduler,
):
    t0, vol = _make_drum_track(
        chain_value=0.5,
        prefix_devices=[StubPlainDevice(), StubPlainDevice("Compressor2")],
    )
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    assert vol.writes == [pytest.approx(0.5 + MOVE_VOLUME_STEP)]


def test_drum_chain_volume_falls_back_to_selected_chain(
    captured_emits, state_full_calls, scheduler,
):
    """No pad selected at all → ``selected_chain`` is the target."""
    vol = StubVolumeParam(value=0.4)
    chain = StubChain(vol)
    rack = StubRackDevice(
        view=StubRackView(selected_drum_pad=None, selected_chain=chain),
    )
    t0 = StubTrack(tid=100, name="drums", devices=[rack])
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    assert vol.writes == [pytest.approx(0.4 + MOVE_VOLUME_STEP)]


def test_drum_chain_volume_empty_pad_drops_without_fallback(
    captured_emits, state_full_calls, scheduler,
):
    """Selected pad with no chain drops the message even when
    ``selected_chain`` still points at another pad's chain — nudging
    a pad the user didn't select is worse than doing nothing."""
    stale_vol = StubVolumeParam(value=0.7)
    stale_chain = StubChain(stale_vol)
    rack = StubRackDevice(
        view=StubRackView(
            selected_drum_pad=StubDrumPad(chains=[]),
            selected_chain=stale_chain,
        ),
    )
    t0 = StubTrack(tid=100, name="drums", devices=[rack])
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    assert stale_vol.writes == []
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_drum_chain_volume_no_rack_is_silent_drop(
    captured_emits, state_full_calls, scheduler,
):
    """Knob turned while a non-drum track is in view: no write, no
    error emit (performance state, not a protocol error)."""
    t0 = StubTrack(tid=100, name="guitar", devices=[StubPlainDevice()])
    _attach_mixer(t0, initial_value=0.5)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == []


def test_drum_chain_volume_invalid_midi_value_rejects(
    captured_emits, state_full_calls, scheduler,
):
    t0, vol = _make_drum_track()
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([64], source_addr=None)

    assert vol.writes == []
    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    originating, code, _, detail = args
    assert originating == V3_DRUM_CHAIN_VOLUME_RELATIVE_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert "midi-value" in detail


def test_drum_chain_volume_no_selected_track_rejects(
    captured_emits, state_full_calls, scheduler,
):
    song = SelStubSong(tracks=[], selected_track=None)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "no selected track" in detail


def test_drum_chain_volume_gate_off_drops_silently(
    captured_emits, state_full_calls, scheduler,
):
    t0, vol = _make_drum_track()
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = SelectedTrackComponent(
        song=song,
        emit=lambda addr, args: captured_emits.append((addr, args)),
        schedule_state_full=lambda path: state_full_calls.append(path),
        schedule_delayed=scheduler,
        should_handle_move_volume_knob=lambda: False,
    )

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    assert vol.writes == []
    assert captured_emits == []


def test_drum_chain_volume_write_raise_rejects(
    captured_emits, state_full_calls, scheduler,
):
    vol = StubVolumeParam(value=0.5, write_raises=True)
    chain = StubChain(vol)
    pad = StubDrumPad(chains=[chain])
    rack = StubRackDevice(view=StubRackView(selected_drum_pad=pad))
    t0 = StubTrack(tid=100, name="drums", devices=[rack])
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_drum_chain_relative_volume([1], source_addr=None)

    errors = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(errors) == 1
    _, args = errors[0]
    _, code, _, detail = args
    assert code == V3_ERROR_WRITE_REJECTED
    assert "chain volume write raised" in detail


# --- structural change: selection re-index (2026-08-31) --------------------
#
# Live's ``selected_track`` listener fires when the selected *object*
# changes. Removing a track *below* the selection doesn't change the
# object — it only slides it down a slot — so Live stays silent and the
# UI's positional ``tracks/<N>`` mirror is left one too high. Every
# consumer that resolves it then targets the wrong track, including the
# UI's own "don't delete the selected track" guard.


def test_structural_change_reemits_when_selection_re_indexed(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    t2 = StubTrack(tid=102, name="t2")
    song = SelStubSong(tracks=[t0, t1, t2], selected_track=t2)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    assert comp.selected_path == "tracks/2"
    captured_emits.clear()

    # Delete t0 — t2 is still selected, now at index 1. Live fires nothing.
    song._tracks.remove(t0)
    comp.on_structural_change()

    assert captured_emits == [(V3_SELECTED_TRACK_ADDRESS, ["tracks/1"])]
    assert comp.selected_path == "tracks/1"


def test_structural_change_is_silent_when_the_index_did_not_move(
    captured_emits, state_full_calls, scheduler,
):
    """An unrelated structural change costs one comparison, no traffic."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    t2 = StubTrack(tid=102, name="t2")
    song = SelStubSong(tracks=[t0, t1, t2], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    captured_emits.clear()

    # Removal *above* the selection leaves tracks/0 where it was.
    song._tracks.remove(t2)
    comp.on_structural_change()

    assert captured_emits == []
    assert comp.selected_path == "tracks/0"


def test_structural_change_does_not_schedule_a_state_full(
    captured_emits, state_full_calls, scheduler,
):
    """The structural composite already republishes the whole tree —
    this hook only corrects the selection address."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t1)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    state_full_calls.clear()

    song._tracks.remove(t0)
    comp.on_structural_change()

    assert state_full_calls == []


def test_structural_change_updates_a_pending_coalesced_commit(
    captured_emits, state_full_calls, scheduler,
):
    """A commit already queued must not land the pre-shift path."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    t2 = StubTrack(tid=102, name="t2")
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    # A real selection change queues a 50ms commit for tracks/2...
    song._tracks.append(t2)
    song.view.set_selected_track(t2)
    captured_emits.clear()

    # ...and a structural change lands inside that window.
    song._tracks.remove(t0)
    comp.on_structural_change()
    scheduler.fire_pending()

    # Both the immediate re-emit and the coalesced commit say tracks/1.
    assert [a for a in captured_emits if a[0] == V3_SELECTED_TRACK_ADDRESS] == [
        (V3_SELECTED_TRACK_ADDRESS, ["tracks/1"]),
        (V3_SELECTED_TRACK_ADDRESS, ["tracks/1"]),
    ]


def test_structural_change_is_silent_when_selection_unresolvable(
    captured_emits, state_full_calls, scheduler,
):
    """A return track (or a torn read) composes to None — skip, don't
    emit a lie about what's selected."""
    t0 = StubTrack(tid=100, name="t0")
    return_track = StubTrack(tid=200, name="Return A")
    song = SelStubSong(tracks=[t0], selected_track=return_track)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    captured_emits.clear()

    comp.on_structural_change()

    assert captured_emits == []


def test_structural_change_after_disconnect_is_a_noop(
    captured_emits, state_full_calls, scheduler,
):
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    song = SelStubSong(tracks=[t0, t1], selected_track=t1)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)
    comp.disconnect()
    captured_emits.clear()

    song._tracks.remove(t0)
    comp.on_structural_change()

    assert captured_emits == []


# --- ADR-432: a Move pad held past the patch's threshold ------------------


def _hold_emits(captured_emits):
    return [e for e in captured_emits if e[0] == V3_DRUM_PAD_HOLD_ADDRESS]


def _errors(captured_emits):
    return [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]


def _make_pad_hold_track(tid=100, note=36, prefix_devices=None):
    """A drum track whose rack has ``note`` selected, with one chain on
    it. Returns ``(track, rack_view)`` so a test can move the selection."""
    pad = StubDrumPad(chains=[StubChain()], note=note)
    view = StubRackView(selected_drum_pad=pad)
    rack = StubRackDevice(view=view)
    devices = list(prefix_devices or []) + [rack]
    return StubTrack(tid=tid, name="drums", devices=devices), view


def test_pad_hold_announces_the_selected_pad_and_its_rack_then_releases_it(
    captured_emits, state_full_calls, scheduler,
):
    t0, _ = _make_pad_hold_track(note=38)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)
    assert _hold_emits(captured_emits) == [
        (V3_DRUM_PAD_HOLD_ADDRESS, ["tracks/0/devices/0", 38, 1]),
    ]

    comp.handle_pad_hold([60, 0], source_addr=None)
    assert _hold_emits(captured_emits)[-1] == (
        V3_DRUM_PAD_HOLD_ADDRESS, ["tracks/0/devices/0", 38, 0],
    )
    assert _errors(captured_emits) == []


def test_pad_hold_names_the_rack_by_its_index_on_the_track(
    captured_emits, state_full_calls, scheduler,
):
    t0, _ = _make_pad_hold_track(prefix_devices=[StubPlainDevice()])
    t1 = StubTrack(tid=101, name="other")
    song = SelStubSong(tracks=[t1, t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)

    assert _hold_emits(captured_emits) == [
        (V3_DRUM_PAD_HOLD_ADDRESS, ["tracks/1/devices/1", 36, 1]),
    ]


def test_pad_hold_release_names_the_pad_it_announced_not_the_current_selection(
    captured_emits, state_full_calls, scheduler,
):
    t0, view = _make_pad_hold_track(note=36)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)
    # A quick hit on another pad mid-hold moves Live's selection …
    view.selected_drum_pad = StubDrumPad(chains=[StubChain()], note=40)
    comp.handle_pad_hold([60, 0], source_addr=None)

    # … but the release is the pad that was held.
    assert _hold_emits(captured_emits)[-1] == (
        V3_DRUM_PAD_HOLD_ADDRESS, ["tracks/0/devices/0", 36, 0],
    )


def test_pad_hold_two_pads_are_two_holds_paired_by_tag(
    captured_emits, state_full_calls, scheduler,
):
    t0, view = _make_pad_hold_track(note=36)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)
    view.selected_drum_pad = StubDrumPad(chains=[StubChain()], note=38)
    comp.handle_pad_hold([62, 1], source_addr=None)
    comp.handle_pad_hold([60, 0], source_addr=None)
    comp.handle_pad_hold([62, 0], source_addr=None)

    assert [e[1] for e in _hold_emits(captured_emits)] == [
        ["tracks/0/devices/0", 36, 1],
        ["tracks/0/devices/0", 38, 1],
        ["tracks/0/devices/0", 36, 0],
        ["tracks/0/devices/0", 38, 0],
    ]


def test_pad_hold_repeated_hold_is_idempotent_and_a_stray_release_is_silent(
    captured_emits, state_full_calls, scheduler,
):
    t0, _ = _make_pad_hold_track()
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([61, 0], source_addr=None)   # never announced
    comp.handle_pad_hold([60, 1], source_addr=None)
    comp.handle_pad_hold([60, 1], source_addr=None)   # the patch repeating itself

    assert len(_hold_emits(captured_emits)) == 1
    assert _errors(captured_emits) == []


def test_pad_hold_a_fresh_hold_for_a_recorded_tag_releases_the_stale_one(
    captured_emits, state_full_calls, scheduler,
):
    """The patch sends ``1`` once per hold, so a second ``1`` for a tag
    still recorded means its ``0`` never arrived — a datagram lost, or the
    patch restarted mid-hold. It used to be dropped as a repeat, which left
    the tag stuck for the session and every later hold of that Move pad
    ignored (code review, 2026-09-12)."""
    t0, view = _make_pad_hold_track(note=36)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)          # … and its 0 is lost
    view.selected_drum_pad = StubDrumPad(chains=[StubChain()], note=40)
    comp.handle_pad_hold([60, 1], source_addr=None)          # the same Move pad, held again
    assert [e[1] for e in _hold_emits(captured_emits)] == [
        ["tracks/0/devices/0", 36, 1],
        ["tracks/0/devices/0", 36, 0],   # the stale hold is released first
        ["tracks/0/devices/0", 40, 1],
    ]
    comp.handle_pad_hold([60, 0], source_addr=None)
    assert _hold_emits(captured_emits)[-1][1] == ["tracks/0/devices/0", 40, 0]
    assert _errors(captured_emits) == []


def test_pad_hold_a_fresh_hold_with_no_context_still_releases_a_stale_tag(
    captured_emits, state_full_calls, scheduler,
):
    """A stale tag held again with a non-drum track in view: nothing to
    announce, but the patch says the pad is down again, so what was
    recorded is over — released rather than left to block the tag."""
    t0, _ = _make_pad_hold_track(note=36)
    t1 = StubTrack(tid=101, name="synth", devices=[StubPlainDevice()])
    song = SelStubSong(tracks=[t0, t1], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)
    song.view.selected_track = t1
    comp.handle_pad_hold([60, 1], source_addr=None)
    assert [e[1] for e in _hold_emits(captured_emits)] == [
        ["tracks/0/devices/0", 36, 1],
        ["tracks/0/devices/0", 36, 0],
    ]
    comp.handle_pad_hold([60, 0], source_addr=None)          # nothing recorded any more: silent
    assert len(_hold_emits(captured_emits)) == 2
    assert _errors(captured_emits) == []


@pytest.mark.parametrize(
    "track_factory",
    [
        lambda: StubTrack(tid=100, name="synth", devices=[StubPlainDevice()]),
        lambda: StubTrack(
            tid=100, name="drums",
            devices=[StubRackDevice(view=StubRackView(selected_drum_pad=None))],
        ),
        lambda: StubTrack(
            tid=100, name="drums",
            devices=[StubRackDevice(view=StubRackView(
                selected_drum_pad=StubDrumPad(chains=[], note=36),
            ))],
        ),
    ],
    ids=["no-rack", "no-selected-pad", "empty-pad"],
)
def test_pad_hold_context_misses_drop_silently(
    track_factory, captured_emits, state_full_calls, scheduler,
):
    t0 = track_factory()
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)
    comp.handle_pad_hold([60, 0], source_addr=None)

    assert _hold_emits(captured_emits) == []
    assert _errors(captured_emits) == []


def test_pad_hold_no_selected_track_drops_silently(
    captured_emits, state_full_calls, scheduler,
):
    t0, _ = _make_pad_hold_track()
    song = SelStubSong(tracks=[t0], selected_track=None)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)

    assert _hold_emits(captured_emits) == []
    assert _errors(captured_emits) == []


@pytest.mark.parametrize(
    "args", [[], [60], [60, 1, 2], ["x", 1], [60, 2], [60, -1]],
    ids=["empty", "one-arg", "three-args", "non-int-note", "held-2", "held-neg"],
)
def test_pad_hold_malformed_args_reject(
    args, captured_emits, state_full_calls, scheduler,
):
    t0, _ = _make_pad_hold_track()
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold(args, source_addr=None)

    assert _hold_emits(captured_emits) == []
    errors = _errors(captured_emits)
    assert len(errors) == 1
    assert errors[0][1][0] == V3_MOVE_PAD_HOLD_ADDRESS
    assert errors[0][1][1] == V3_ERROR_WRITE_REJECTED


def test_pad_hold_disconnect_forgets_the_holds(
    captured_emits, state_full_calls, scheduler,
):
    t0, _ = _make_pad_hold_track()
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([60, 1], source_addr=None)
    comp.disconnect()
    comp.handle_pad_hold([60, 0], source_addr=None)

    assert [e[1][2] for e in _hold_emits(captured_emits)] == [1]


def test_pad_hold_two_tags_naming_one_pad_announce_once_and_release_on_the_last_lift(
    captured_emits, state_full_calls, scheduler,
):
    """Two pads hit together both read Live's one selection (measured
    2026-09-11: tags 78 and 76 both named pad 40). The pad is announced
    once and stays held until the last tag lifts."""
    t0, _ = _make_pad_hold_track(note=40)
    song = SelStubSong(tracks=[t0], selected_track=t0)
    comp = _make_component(song, captured_emits, state_full_calls, scheduler)

    comp.handle_pad_hold([78, 1], source_addr=None)
    comp.handle_pad_hold([76, 1], source_addr=None)
    assert [e[1] for e in _hold_emits(captured_emits)] == [["tracks/0/devices/0", 40, 1]]

    comp.handle_pad_hold([76, 0], source_addr=None)   # one finger lifts …
    assert len(_hold_emits(captured_emits)) == 1      # … the pad stays held
    comp.handle_pad_hold([78, 0], source_addr=None)   # the last one lifts
    assert [e[1] for e in _hold_emits(captured_emits)] == [
        ["tracks/0/devices/0", 40, 1],
        ["tracks/0/devices/0", 40, 0],
    ]
