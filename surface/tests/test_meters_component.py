"""MetersComponent unit tests — PR-5c.

Covers the two-address output-meter channel:

- Per-track L/R listener attach on init; either channel firing emits
  ``[path, L, R]`` once on ``/looping/v3/track/meter`` (one shared
  closure, two listener slots).
- Master listener attach on init; either L or R fire emits
  ``[L, R]`` once on ``/looping/v3/master/meter`` (no path arg —
  master is a singleton).
- 30 Hz per-track drop-intermediate throttle — monkeypatched
  ``time.monotonic`` drives the window boundary deterministically.
  Crucially, each track/master has its OWN window; busy track A
  cannot starve track B.
- Init-emit: cold-start seed emits once per track plus master so the
  UI's meter store isn't left at its 0.0 default before the first
  audio threshold-cross. Init-emit warms the throttle, so a listener
  fire inside the 33 ms window immediately after is suppressed.
- Structural rebind: ``on_structural_change`` drops the per-track
  listener map and rebinds against the current ``song.tracks`` walk;
  ``_last_emit`` entries for departed tracks are pruned (memory
  hygiene for long sessions with heavy add/remove churn).
- LOM exception swallowing: both attach and fire-time
  ``RuntimeError``/``AttributeError`` log WARNING once and do not
  crash (per ``project_live_lom_quirks``: master in Live 12 can raise
  RuntimeError on property access).
- Monotonic clock: backward wall-clock jumps (DST, NTP) cannot open
  or stall the window — the component reads ``time.monotonic``
  exclusively.
- ``disconnect`` detaches every listener, is idempotent, and late
  fires are swallowed silently.

The stub LOM models:
  - per-track: ``output_meter_left``, ``output_meter_right`` + one
    listener slot per channel; setting a value fires the listener.
  - master: identical shape (the meter channel is symmetric; PR-5b's
    mute asymmetry doesn't apply here).
"""

from __future__ import annotations

import logging
from typing import Callable, List, Tuple

import pytest

from components.MetersComponent import (
    MetersComponent,
    V3_MASTER_METER_ADDRESS,
    V3_TRACK_METER_ADDRESS,
)
import components.MetersComponent as meters_module


# --- stub LOM --------------------------------------------------------------


class StubMeterTrack:
    """Track with ``output_meter_left``/``right`` + one listener slot each.

    Setting a value fires that channel's listener synchronously.
    Either listener triggers the component's shared callback, which
    reads both channels off the track at fire time — so the order
    of L-then-R vs. R-then-L only matters for the emitted pair,
    never for the callback identity.
    """

    _ATTRS = ("output_meter_left", "output_meter_right")

    def __init__(
        self,
        left: float = 0.0,
        right: float = 0.0,
        raises_on_read: bool = False,
    ) -> None:
        object.__setattr__(
            self, "_listeners", {a: None for a in self._ATTRS},
        )
        object.__setattr__(self, "_values", {
            "output_meter_left": left,
            "output_meter_right": right,
        })
        object.__setattr__(self, "_raises_on_read", raises_on_read)
        object.__setattr__(self, "_raises_on_attach", set())

    def __getattr__(self, name):
        if name in ("output_meter_left", "output_meter_right"):
            if self.__dict__.get("_raises_on_read"):
                raise RuntimeError("Live 12 rejects %s" % name)
            return self.__dict__["_values"][name]
        raise AttributeError(name)

    def __setattr__(self, name, value):
        values = self.__dict__.get("_values")
        if values is None or name not in values:
            object.__setattr__(self, name, value)
            return
        values[name] = value
        cb = self.__dict__["_listeners"][name]
        if cb is not None:
            cb()

    def _make_add(attr):  # noqa: N805
        def add(self, cb):
            if attr in self.__dict__.get("_raises_on_attach", set()):
                raise RuntimeError(
                    "LOM attach rejected for %s" % attr,
                )
            assert self._listeners[attr] is None, (
                "StubMeterTrack supports one %s listener" % attr
            )
            self._listeners[attr] = cb
        return add

    def _make_remove(attr):  # noqa: N805
        def remove(self, cb):
            # Live's C++ side silently no-ops removal of a callback
            # that was never attached (e.g. after attach failed).
            # Mirror that here so the component's idempotent
            # disconnect can sweep without tripping an assert.
            if self._listeners[attr] == cb:
                self._listeners[attr] = None
        return remove

    for _attr in _ATTRS:
        locals()["add_%s_listener" % _attr] = _make_add(_attr)
        locals()["remove_%s_listener" % _attr] = _make_remove(_attr)

    del _make_add, _make_remove, _attr

    # Helper for tests: fire the listener without changing the value.
    def fire(self, channel: str = "output_meter_left") -> None:
        cb = self._listeners[channel]
        if cb is not None:
            cb()


class StubSong:
    def __init__(
        self,
        tracks: List[StubMeterTrack],
        master: StubMeterTrack,
    ) -> None:
        self._tracks = list(tracks)
        self.master_track = master

    @property
    def tracks(self):
        return list(self._tracks)

    def set_tracks(self, tracks: List[StubMeterTrack]) -> None:
        self._tracks = list(tracks)


# --- fixtures --------------------------------------------------------------


class EmitRecorder:
    """Captures ``(address, args)`` tuples emitted by the component."""

    def __init__(self) -> None:
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address: str, args) -> None:
        self.emissions.append((address, tuple(args)))

    def only(self, address: str) -> List[tuple]:
        return [payload for addr, payload in self.emissions if addr == address]

    def clear(self) -> None:
        self.emissions.clear()


@pytest.fixture
def recorder() -> EmitRecorder:
    return EmitRecorder()


@pytest.fixture
def tracks() -> List[StubMeterTrack]:
    return [StubMeterTrack(), StubMeterTrack(), StubMeterTrack()]


@pytest.fixture
def master() -> StubMeterTrack:
    return StubMeterTrack()


@pytest.fixture
def song(tracks, master) -> StubSong:
    return StubSong(tracks, master)


class FakeClock:
    """Monotonic-clock stand-in used to drive the throttle window.

    ``MetersComponent._window_open`` calls ``time.monotonic()``; we
    monkeypatch the module-level ``time.monotonic`` so every fire sees
    the clock we set here. ``advance()`` returns the new reading so
    tests read more naturally.
    """

    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock(start=1000.0)
    monkeypatch.setattr(meters_module.time, "monotonic", fake)
    return fake


@pytest.fixture
def component(song, recorder, clock):
    c = MetersComponent(song=song, emit=recorder)
    # Drop init-emit seed so each test's assertions only see fires
    # it triggered itself.
    recorder.clear()
    # Reset throttle so the first post-init fire is NOT suppressed by
    # the init-emit window. Re-keys are preserved; we just drop the
    # last-emit timestamps.
    c._last_emit.clear()
    yield c
    c.disconnect()


# --- init / attach ---------------------------------------------------------


def test_init_binds_every_regular_track(song, recorder, clock):
    c = MetersComponent(song=song, emit=recorder)
    try:
        for t in song.tracks:
            assert t._listeners["output_meter_left"] is not None
            assert t._listeners["output_meter_right"] is not None
    finally:
        c.disconnect()


def test_init_binds_master(song, master, recorder, clock):
    c = MetersComponent(song=song, emit=recorder)
    try:
        assert master._listeners["output_meter_left"] is not None
        assert master._listeners["output_meter_right"] is not None
    finally:
        c.disconnect()


def test_init_emit_seeds_every_track_and_master(song, tracks, master,
                                                recorder, clock):
    """Cold-start emit for every regular track + master.

    Design §3.4: state/full does not carry meter values; the UI's
    meter store derivation reads 0.0 until the first audio threshold
    crosses the listener trigger. Init-emit closes that gap.
    """
    tracks[0]._values["output_meter_left"] = 0.1
    tracks[0]._values["output_meter_right"] = 0.2
    tracks[1]._values["output_meter_left"] = 0.3
    tracks[1]._values["output_meter_right"] = 0.4
    tracks[2]._values["output_meter_left"] = 0.5
    tracks[2]._values["output_meter_right"] = 0.6
    master._values["output_meter_left"] = 0.7
    master._values["output_meter_right"] = 0.8

    c = MetersComponent(song=song, emit=recorder)
    try:
        track_emits = recorder.only(V3_TRACK_METER_ADDRESS)
        master_emits = recorder.only(V3_MASTER_METER_ADDRESS)

        assert track_emits == [
            ("tracks/0", 0.1, 0.2),
            ("tracks/1", 0.3, 0.4),
            ("tracks/2", 0.5, 0.6),
        ]
        assert master_emits == [(0.7, 0.8)]
    finally:
        c.disconnect()


# --- fire emits -----------------------------------------------------------


def test_track_left_fire_emits_pair(component, tracks, recorder):
    """L fire reads both channels and emits ``[path, L, R]`` once."""
    tracks[1]._values["output_meter_right"] = 0.42
    tracks[1].output_meter_left = 0.1  # fires L listener
    assert recorder.only(V3_TRACK_METER_ADDRESS) == [
        ("tracks/1", 0.1, 0.42),
    ]


def test_track_right_fire_emits_pair(component, tracks, recorder):
    """R-only fire also triggers one emit with both channels."""
    tracks[2]._values["output_meter_left"] = 0.55
    tracks[2].output_meter_right = 0.9
    assert recorder.only(V3_TRACK_METER_ADDRESS) == [
        ("tracks/2", 0.55, 0.9),
    ]


def test_master_fire_emits_pair_without_path(component, master, recorder):
    """Master emit has no trackPath arg — singleton address."""
    master._values["output_meter_right"] = 0.33
    master.output_meter_left = 0.77
    assert recorder.only(V3_MASTER_METER_ADDRESS) == [(0.77, 0.33)]


def test_fire_on_one_track_does_not_emit_for_siblings(component, tracks,
                                                     recorder):
    tracks[0].output_meter_left = 0.1
    emits = recorder.only(V3_TRACK_METER_ADDRESS)
    assert len(emits) == 1
    assert emits[0][0] == "tracks/0"


# --- throttle -------------------------------------------------------------


def test_throttle_drops_intermediate_within_window(component, tracks,
                                                  recorder, clock):
    """Two fires inside the 33 ms window emit once — drop-intermediate."""
    tracks[0].output_meter_left = 0.1  # first fire, window opens
    clock.advance(0.010)               # 10 ms elapsed — inside window
    tracks[0].output_meter_left = 0.2  # dropped
    clock.advance(0.010)               # 20 ms — still inside
    tracks[0].output_meter_left = 0.3  # dropped

    emits = recorder.only(V3_TRACK_METER_ADDRESS)
    assert len(emits) == 1
    assert emits[0] == ("tracks/0", 0.1, 0.0)


def test_throttle_reopens_at_window_boundary(component, tracks, recorder,
                                             clock):
    """Once the 33 ms window elapses, the next fire emits.

    ``_window_open`` uses ``<`` — exactly at the boundary still counts
    as inside. A single ulp past it re-opens the window.
    """
    tracks[0].output_meter_left = 0.1
    clock.advance(MetersComponent.WINDOW_SEC + 1e-6)  # just past boundary
    tracks[0].output_meter_left = 0.2                  # window re-opens

    emits = recorder.only(V3_TRACK_METER_ADDRESS)
    assert len(emits) == 2
    assert emits[1] == ("tracks/0", 0.2, 0.0)


def test_throttle_is_per_track_not_global(component, tracks, recorder):
    """Busy track A cannot starve track B — independent windows."""
    tracks[0].output_meter_left = 0.1
    tracks[1].output_meter_left = 0.2  # different track, own window
    tracks[2].output_meter_left = 0.3  # different track, own window

    emits = recorder.only(V3_TRACK_METER_ADDRESS)
    assert len(emits) == 3
    paths = [p for (p, _l, _r) in emits]
    assert paths == ["tracks/0", "tracks/1", "tracks/2"]


def test_throttle_master_independent_of_tracks(component, tracks, master,
                                              recorder):
    """Master's window is disjoint from any track's window."""
    tracks[0].output_meter_left = 0.1
    master.output_meter_left = 0.9
    assert len(recorder.only(V3_TRACK_METER_ADDRESS)) == 1
    assert len(recorder.only(V3_MASTER_METER_ADDRESS)) == 1


def test_throttle_window_uses_monotonic_not_walltime(component, tracks,
                                                    recorder, clock):
    """Backward 'wall-clock' jump must not open the window.

    We push the fake monotonic clock *backward* — a scenario that on
    ``time.time()`` would trip the window open on every fire because
    ``now - last < WINDOW_SEC`` would go negative and beat the guard.
    ``time.monotonic`` cannot move backward, but since we control the
    clock here we verify that `_window_open` uses `<` correctly.
    """
    tracks[0].output_meter_left = 0.1  # sets _last_emit to 1000.0
    clock.now = 999.0                  # pretend clock regressed
    tracks[0].output_meter_left = 0.2  # 999 - 1000 < 0.033 → dropped

    assert len(recorder.only(V3_TRACK_METER_ADDRESS)) == 1


def test_init_emit_warms_throttle(song, tracks, recorder, clock):
    """A fire within 33 ms of the init-emit must be suppressed."""
    c = MetersComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        # _last_emit was set by init-emit; the throttle is warm.
        clock.advance(0.010)
        tracks[0].output_meter_left = 0.42
        assert recorder.only(V3_TRACK_METER_ADDRESS) == []

        clock.advance(MetersComponent.WINDOW_SEC)
        tracks[0].output_meter_left = 0.43
        assert len(recorder.only(V3_TRACK_METER_ADDRESS)) == 1
    finally:
        c.disconnect()


# --- structural rebind ----------------------------------------------------


def test_on_structural_change_rebinds_to_current_tracks(song, recorder,
                                                      clock):
    """Track leaves + joins; listeners follow the new ``song.tracks``."""
    c = MetersComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()

        old = song.tracks[0]
        new = StubMeterTrack()
        # Live tears down C++-side listeners when the Python wrappers
        # are replaced wholesale (see MetersComponent docstring). The
        # stub doesn't simulate that — reset the listener slots on the
        # tracks that will be re-bound so the stub's one-slot assert
        # doesn't trip.
        kept1, kept2 = song.tracks[1], song.tracks[2]
        for t in (kept1, kept2):
            t._listeners["output_meter_left"] = None
            t._listeners["output_meter_right"] = None
        song.set_tracks([new, kept1, kept2])
        c.on_structural_change()

        # Old track listeners are dropped from the list — component no
        # longer holds a detach record for it.
        targets = [target for target, *_ in c._track_listeners]
        assert old not in targets
        # New track at index 0 has listeners attached.
        assert new._listeners["output_meter_left"] is not None
        assert new._listeners["output_meter_right"] is not None

        new.output_meter_left = 0.5
        assert recorder.only(V3_TRACK_METER_ADDRESS) == [
            ("tracks/0", 0.5, 0.0),
        ]
    finally:
        c.disconnect()


def test_on_structural_change_prunes_stale_last_emit(song, recorder, clock):
    """``_last_emit`` loses entries for departed tracks.

    Keeping them would leak memory across a long session with heavy
    track add/remove churn. Master key survives the prune.
    """
    c = MetersComponent(song=song, emit=recorder)
    try:
        # Poke every track so each has a _last_emit entry.
        recorder.clear()
        c._last_emit.clear()
        for t in song.tracks:
            t.output_meter_left = 0.1
            clock.advance(MetersComponent.WINDOW_SEC)
        master_key = "master"
        song.master_track.output_meter_left = 0.1
        c._last_emit[master_key] = clock.now

        assert set(c._last_emit.keys()) >= {
            "tracks/0", "tracks/1", "tracks/2", "master",
        }

        # Drop track 2 entirely. Reset listener slots on kept tracks
        # (see rebind-test: Live tears down C++-side listeners on
        # structural change; the stub doesn't simulate that).
        kept0, kept1 = song.tracks[0], song.tracks[1]
        for t in (kept0, kept1):
            t._listeners["output_meter_left"] = None
            t._listeners["output_meter_right"] = None
        song.set_tracks([kept0, kept1])
        c.on_structural_change()

        assert "tracks/2" not in c._last_emit
        assert "master" in c._last_emit
        assert "tracks/0" in c._last_emit or "tracks/1" in c._last_emit
    finally:
        c.disconnect()


# --- LOM exception swallowing ---------------------------------------------


def test_fire_time_runtime_error_is_swallowed(song, master, recorder, clock,
                                             caplog):
    """A ``RuntimeError`` on property read logs WARNING once, no crash."""
    master._raises_on_read = True
    c = MetersComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()

        with caplog.at_level(logging.WARNING, logger="looping"):
            master.output_meter_left = 0.5  # fire triggers readback
        # Master emit suppressed because readback raised.
        assert recorder.only(V3_MASTER_METER_ADDRESS) == []
        assert any("read-in-listener" in r.message for r in caplog.records)

        caplog.clear()
        # Second fire: same error, but warn-once must swallow log.
        clock.advance(MetersComponent.WINDOW_SEC)
        master.output_meter_left = 0.5
        assert all(
            "read-in-listener" not in r.message for r in caplog.records
        )
    finally:
        c.disconnect()


def test_attach_runtime_error_leaves_component_partial(song, tracks,
                                                     recorder, caplog):
    """Attach-time error on one track logs WARNING, other tracks ok."""
    tracks[1]._raises_on_attach.add("output_meter_left")
    with caplog.at_level(logging.WARNING, logger="looping"):
        c = MetersComponent(song=song, emit=recorder)
    try:
        # Tracks 0 and 2 still attached on both channels.
        assert tracks[0]._listeners["output_meter_left"] is not None
        assert tracks[2]._listeners["output_meter_right"] is not None
        # Track 1 R channel still attached (L raised, we kept going).
        assert tracks[1]._listeners["output_meter_right"] is not None
    finally:
        c.disconnect()


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_every_listener(song, tracks, master, recorder,
                                            clock):
    c = MetersComponent(song=song, emit=recorder)
    c.disconnect()
    for t in tracks:
        assert t._listeners["output_meter_left"] is None
        assert t._listeners["output_meter_right"] is None
    assert master._listeners["output_meter_left"] is None
    assert master._listeners["output_meter_right"] is None


def test_disconnect_is_idempotent(song, recorder, clock):
    c = MetersComponent(song=song, emit=recorder)
    c.disconnect()
    c.disconnect()  # must not raise


def test_late_fire_after_disconnect_is_swallowed(song, tracks, recorder,
                                                clock):
    """Listener callbacks retained locally by tests must no-op post-disc."""
    c = MetersComponent(song=song, emit=recorder)
    # Grab the callback before disconnect so we can invoke it after.
    cb = tracks[0]._listeners["output_meter_left"]
    c.disconnect()
    recorder.clear()

    cb()  # late fire; must not emit
    assert recorder.emissions == []


# --- silent-session behavior ---------------------------------------------


def test_silent_session_only_emits_init_seed(song, recorder, clock):
    """No audio → listeners never fire → only the init-emit seed lands."""
    c = MetersComponent(song=song, emit=recorder)
    try:
        # init-emit landed 3 track + 1 master frames, nothing else.
        assert len(recorder.only(V3_TRACK_METER_ADDRESS)) == 3
        assert len(recorder.only(V3_MASTER_METER_ADDRESS)) == 1
    finally:
        c.disconnect()


# --- fresh-wrapper StubSong (issue #399) ---------------------------------
#
# The plain ``StubSong`` above re-uses the same ``StubMeterTrack`` instances
# across ``song.tracks`` reads, so identity-keyed bookkeeping accidentally
# works in tests but fails in Live's v3 framework (which hands out fresh
# wrappers per read — ADR-350). The fresh-wrapper fixtures below mimic Live's
# behavior so the structural-change rebind is exercised honestly: each read
# delivers new wrapper objects that delegate to the same underlying state.


class _FreshTrackWrapper:
    """Per-read wrapper around a ``StubMeterTrack`` core.

    Delegates attribute access, listener add/remove, and value writes
    to the underlying core. The wrapper itself has unique ``id()`` per
    instance — exactly the hostile shape that broke
    ``id(track)``-keyed bookkeeping in the dead branch (issue #399).
    A listener attached through one wrapper must be detachable via
    any other wrapper that shares the same core.
    """

    __slots__ = ("_core",)

    def __init__(self, core: StubMeterTrack):
        object.__setattr__(self, "_core", core)

    def __getattr__(self, name):
        return getattr(self._core, name)

    def __setattr__(self, name, value):
        if name == "_core":
            object.__setattr__(self, name, value)
            return
        setattr(self._core, name, value)


class FreshWrapperSong:
    """``StubSong`` whose ``tracks`` returns fresh wrappers per read.

    Every property access yields a brand-new list of brand-new
    ``_FreshTrackWrapper`` instances. The cores are shared, so a
    listener attached via one read's wrapper sees the same underlying
    listener slot as a wrapper from a later read.
    """

    def __init__(
        self,
        cores: List[StubMeterTrack],
        master: StubMeterTrack,
    ) -> None:
        self._cores = list(cores)
        self.master_track = master

    @property
    def tracks(self):
        return [_FreshTrackWrapper(c) for c in self._cores]

    def set_cores(self, cores: List[StubMeterTrack]) -> None:
        self._cores = list(cores)


@pytest.fixture
def fw_cores() -> List[StubMeterTrack]:
    return [StubMeterTrack(), StubMeterTrack(), StubMeterTrack()]


@pytest.fixture
def fw_master() -> StubMeterTrack:
    return StubMeterTrack()


@pytest.fixture
def fw_song(fw_cores, fw_master) -> FreshWrapperSong:
    return FreshWrapperSong(fw_cores, fw_master)


def test_fresh_wrappers_delete_in_middle_no_sibling_contamination(
    fw_song, fw_cores, recorder, clock,
):
    """Issue #399: delete track 1 → surviving track at index 1 emits on
    ``tracks/1`` only; no echo from the closure that captured the now-
    dead path. Without the detach-all rebind the surviving track's old
    listener (still attached via the LOM C++ side) would emit on
    ``tracks/2``, contaminating the UI store slot for the new track 2.
    """
    c = MetersComponent(song=fw_song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()

        # Delete the middle track. cores[2] survives at index 1.
        survivor = fw_cores[2]
        fw_song.set_cores([fw_cores[0], fw_cores[2]])
        c.on_structural_change()

        # Survivor fires; expect emit on tracks/1 (its new path) only,
        # never on tracks/2 (its prior path).
        survivor.output_meter_left = 0.42
        emits = recorder.only(V3_TRACK_METER_ADDRESS)
        assert emits == [("tracks/1", 0.42, 0.0)], (
            "expected emit on new path tracks/1; "
            "stale closure on old path tracks/2 would contaminate"
        )
    finally:
        c.disconnect()


def test_fresh_wrappers_no_structural_change_is_idempotent(
    fw_song, fw_cores, recorder, clock,
):
    """Repeated ``on_structural_change()`` with no actual change must
    not leak listeners. The stub asserts ``one slot per channel`` —
    a double-attach (the dead branch's failure mode) trips it.
    """
    c = MetersComponent(song=fw_song, emit=recorder)
    try:
        for _ in range(3):
            c.on_structural_change()
        # Each core has exactly one L and one R listener.
        for core in fw_cores:
            assert core._listeners["output_meter_left"] is not None
            assert core._listeners["output_meter_right"] is not None
        # And exactly two records per surviving track.
        assert len(c._track_listeners) == 2 * len(fw_cores)
    finally:
        c.disconnect()


def test_fresh_wrappers_add_at_end_existing_tracks_keep_working(
    fw_song, fw_cores, recorder, clock,
):
    new_core = StubMeterTrack()
    c = MetersComponent(song=fw_song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()

        fw_song.set_cores(list(fw_cores) + [new_core])
        c.on_structural_change()

        # New track gets a listener.
        assert new_core._listeners["output_meter_left"] is not None
        new_core.output_meter_left = 0.7
        assert ("tracks/3", 0.7, 0.0) in recorder.only(
            V3_TRACK_METER_ADDRESS,
        )

        # Existing tracks still emit on their original paths.
        clock.advance(MetersComponent.WINDOW_SEC + 1e-6)
        fw_cores[0].output_meter_left = 0.1
        assert ("tracks/0", 0.1, 0.0) in recorder.only(
            V3_TRACK_METER_ADDRESS,
        )
    finally:
        c.disconnect()


def test_fresh_wrappers_reorder_emits_on_new_paths_only(
    fw_song, fw_cores, recorder, clock,
):
    """Reverse track order; each surviving core emits on its new
    canonical path only. A stale closure would emit on the prior path
    and contaminate the UI store.
    """
    c = MetersComponent(song=fw_song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()

        # Reverse: cores [0, 1, 2] → [2, 1, 0]
        fw_song.set_cores(list(reversed(fw_cores)))
        c.on_structural_change()

        # cores[0] is now at index 2.
        fw_cores[0].output_meter_left = 0.11
        # cores[2] is now at index 0.
        clock.advance(MetersComponent.WINDOW_SEC + 1e-6)
        fw_cores[2].output_meter_left = 0.22

        emits = recorder.only(V3_TRACK_METER_ADDRESS)
        # cores[0] fires on its new path tracks/2; cores[2] on tracks/0.
        assert ("tracks/2", 0.11, 0.0) in emits
        assert ("tracks/0", 0.22, 0.0) in emits
        # And no emit on the OLD paths for those cores.
        assert ("tracks/0", 0.11, 0.0) not in emits
        assert ("tracks/2", 0.22, 0.0) not in emits
    finally:
        c.disconnect()
