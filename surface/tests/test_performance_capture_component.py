"""PerformanceCaptureComponent unit tests.

Covers the auto-record + save-as-on-stop behavior:
- transport start (is_playing False→True) arms arrangement record;
- transport stop (True→False) disarms, rewinds the Arrangement start
  marker one bar back from ``last_event_time``, and emits save_as_request;
- both fire ONLY when the gate (SessionSettings.auto_capture) is True;
- spurious co-fires (no state change) are no-ops;
- disconnect detaches the listener and freezes the component.

The gate moved from ``ServerPresenceComponent.is_ipad_present()`` to
``SessionSettings.should_auto_capture()`` (2026-07-06 capture toggle) —
the ipad/dev distinction now lives in that toggle's *default seed*, not
in this component. These tests drive the gate directly via a fake
exposing ``should_auto_capture()``.

Uses injected fakes for song + gate — no Live import (same constraint
the other surface tests run under).
"""

from __future__ import annotations

import pytest

from components.PerformanceCaptureComponent import (
    PerformanceCaptureComponent,
    V3_SESSION_SAVE_AS_REQUEST_ADDRESS,
    compute_rewound_start,
)


class FakeSong:
    """Minimal Song stand-in with a single is_playing listener slot."""

    def __init__(self, tempo=120.0, sig_num=4, sig_den=4, last_event_time=0.0):
        self.is_playing = False
        self.record_mode = 0
        self.tempo = tempo
        self.signature_numerator = sig_num
        self.signature_denominator = sig_den
        # Arrangement end + start marker — the rewind-on-stop pair.
        self.last_event_time = last_event_time
        self.start_time = 0.0
        self._listener = None

    def add_is_playing_listener(self, cb):
        self._listener = cb

    def remove_is_playing_listener(self, cb):
        if self._listener is cb:
            self._listener = None

    # test helper: flip transport and fire the listener like Live would
    def set_playing(self, playing: bool):
        self.is_playing = playing
        if self._listener is not None:
            self._listener()


class FakeCaptureGate:
    """Stands in for SessionSettings — the auto_capture gate.

    ``on`` mirrors what the mode-derived default + user override resolve to;
    the component only reads ``should_auto_capture()``. (Named ``ipad`` in
    the ``_make`` helper for continuity with the pre-toggle tests, where the
    gate *was* ipad-presence.)
    """

    def __init__(self, on: bool):
        self.on = on

    def should_auto_capture(self) -> bool:
        return self.on


class EmitRecorder:
    def __init__(self):
        self.calls = []

    def __call__(self, address, args=()):
        self.calls.append((address, list(args)))


class FakeScheduler:
    """Queues deferred fns instead of running them, mirroring Live's
    schedule_message: record_mode writes must NOT run inline in the
    is_playing notification. ``flush`` fires them like the next tick."""

    def __init__(self):
        self.pending = []

    def __call__(self, ticks, fn):
        self.pending.append(fn)

    def flush(self):
        fns, self.pending = self.pending, []
        for fn in fns:
            fn()


@pytest.fixture
def song():
    return FakeSong()


@pytest.fixture
def emit():
    return EmitRecorder()


def _make(song, emit, ipad=True):
    # ``ipad`` names the resolved gate value for continuity with the
    # pre-toggle tests; it maps to SessionSettings.should_auto_capture().
    return PerformanceCaptureComponent(
        song=song, emit=emit, session_settings=FakeCaptureGate(ipad),
    )


# --- ipad present: full behavior ------------------------------------------


def test_play_arms_record(song, emit):
    _make(song, emit, ipad=True)
    song.set_playing(True)
    assert song.record_mode == 1
    assert emit.calls == []  # arming does not emit


def test_stop_disarms_and_requests_save_as(song, emit):
    _make(song, emit, ipad=True)
    song.set_playing(True)
    song.set_playing(False)
    assert song.record_mode == 0
    assert emit.calls == [
        (V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [120, 4, 4]),
    ]


def test_save_as_carries_current_tempo_and_meter(emit):
    song = FakeSong(tempo=91.6, sig_num=7, sig_den=8)
    _make(song, emit, ipad=True)
    song.set_playing(True)
    song.set_playing(False)
    # tempo rounded to nearest int, meter passed through
    assert emit.calls[-1] == (V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [92, 7, 8])


def test_multiple_stops_emit_each_time(song, emit):
    _make(song, emit, ipad=True)
    for _ in range(3):
        song.set_playing(True)
        song.set_playing(False)
    assert len(emit.calls) == 3


# --- gate off: nothing happens --------------------------------------------


def test_gate_off_does_not_arm_or_emit(song, emit):
    _make(song, emit, ipad=False)  # ipad=False → should_auto_capture() False
    song.set_playing(True)
    song.set_playing(False)
    assert song.record_mode == 0  # never armed
    assert emit.calls == []


# --- presence lapse mid-take (the PR #444 regression) ---------------------


def test_presence_lapse_mid_take_still_disarms_and_saves(song, emit):
    """Armed while ipad present, presence lapses, then user stops:
    cleanup + save-as must still fire (ownership, not gate)."""
    gate = FakeCaptureGate(on=True)
    comp = PerformanceCaptureComponent(
        song=song, emit=emit, session_settings=gate,
    )
    song.set_playing(True)
    assert song.record_mode == 1  # armed while gate on
    # Gate flips off mid-take (user toggled auto_capture off, or a
    # mode-tracking default lapsed) — cleanup must still fire.
    gate.on = False
    song.set_playing(False)
    # Cleanup happens anyway — record disarmed and the take offered to save.
    assert song.record_mode == 0
    assert emit.calls == [
        (V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [120, 4, 4]),
    ]


def test_play_while_gate_off_then_on_at_stop_does_nothing(song, emit):
    """Never armed (gate off at Play) → Stop is a no-op even if the gate
    is on by then. Cleanup keys off _armed_by_us, not the live gate."""
    gate = FakeCaptureGate(on=False)
    comp = PerformanceCaptureComponent(
        song=song, emit=emit, session_settings=gate,
    )
    song.set_playing(True)  # gate off → no arm
    assert song.record_mode == 0
    gate.on = True  # gate flips on mid-take
    song.set_playing(False)
    # We never armed, so there's nothing to clean up or save.
    assert song.record_mode == 0
    assert emit.calls == []


# --- deferred record_mode writes (Live notification rule) -----------------
#
# Live forbids mutating the song inside the is_playing notification. In
# production record_mode writes hop to the next tick via schedule_delayed;
# these tests use FakeScheduler to prove the write is deferred, not inline.


def _make_deferred(song, emit, sched, ipad=True):
    return PerformanceCaptureComponent(
        song=song, emit=emit, session_settings=FakeCaptureGate(ipad),
        schedule_delayed=sched,
    )


def test_arm_is_deferred_not_inline(song, emit):
    sched = FakeScheduler()
    _make_deferred(song, emit, sched, ipad=True)
    song.set_playing(True)
    # Nothing written yet — the write is queued for the next tick.
    assert song.record_mode == 0
    assert len(sched.pending) == 1
    sched.flush()
    assert song.record_mode == 1  # lands on the tick


def test_disarm_and_save_as_deferred(song, emit):
    sched = FakeScheduler()
    _make_deferred(song, emit, sched, ipad=True)
    song.set_playing(True)
    sched.flush()  # arm lands
    assert song.record_mode == 1
    song.set_playing(False)
    # save_as emits immediately (an OSC send, legal in a notification), but
    # the record_mode=0 write is deferred.
    assert emit.calls == [(V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [120, 4, 4])]
    assert song.record_mode == 1  # not disarmed until the tick
    sched.flush()
    assert song.record_mode == 0


def test_stop_before_deferred_arm_runs_still_saves(song, emit):
    """Play then Stop within the same tick (arm never applied): ownership was
    claimed at decision time, so cleanup + save-as still fire, and the queued
    arm no-ops (ownership dropped)."""
    sched = FakeScheduler()
    _make_deferred(song, emit, sched, ipad=True)
    song.set_playing(True)   # queues arm, claims ownership
    song.set_playing(False)  # stop before flush → disarm + save-as
    assert emit.calls == [(V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [120, 4, 4])]
    sched.flush()  # both queued writes run; net result is disarmed
    assert song.record_mode == 0


def test_disconnect_before_deferred_arm_is_noop(song, emit):
    sched = FakeScheduler()
    comp = _make_deferred(song, emit, sched, ipad=True)
    song.set_playing(True)
    comp.disconnect()
    sched.flush()  # deferred arm must see the disconnect and skip the write
    assert song.record_mode == 0


# --- edge detection --------------------------------------------------------


def test_spurious_same_state_fire_is_noop(song, emit):
    _make(song, emit, ipad=True)
    # Listener fires but is_playing is still False (co-fire) → no edge.
    song._listener()
    assert song.record_mode == 0
    assert emit.calls == []


def test_already_playing_at_construction_does_not_retro_arm(emit):
    song = FakeSong()
    song.is_playing = True  # transport already running before we attach
    _make(song, emit, ipad=True)
    # A co-fire with no change must not arm (edge-driven).
    song._listener()
    assert song.record_mode == 0
    assert emit.calls == []


# --- lifecycle -------------------------------------------------------------


def test_disconnect_detaches_listener(song, emit):
    comp = _make(song, emit, ipad=True)
    comp.disconnect()
    assert song._listener is None
    # A late fire (should not be possible, but defensive) is a no-op.
    song.is_playing = True
    comp._on_is_playing_changed()
    assert song.record_mode == 0
    assert emit.calls == []


def test_disconnect_is_idempotent(song, emit):
    comp = _make(song, emit, ipad=True)
    comp.disconnect()
    comp.disconnect()
    assert song._listener is None


def test_address_constant():
    assert V3_SESSION_SAVE_AS_REQUEST_ADDRESS == "/looping/v3/session/save_as_request"


# --- start-marker rewind on stop -------------------------------------------


@pytest.mark.parametrize("last,num,den,expected", [
    # 4/4, bar = 4 beats
    (64.0, 4, 4, 60.0),    # end on a bar line → exactly one bar back
    (63.5, 4, 4, 56.0),    # mid-bar end → floored to a downbeat (1.875 bars)
    (4.0, 4, 4, 0.0),      # exactly one bar of material → back to the top
    (2.0, 4, 4, 0.0),      # less than a bar → clamped to 0
    # 3/4, bar = 3 beats
    (30.0, 3, 4, 27.0),
    # 6/8, bar = 3 beats
    (24.0, 6, 8, 21.0),
    # 7/8, bar = 3.5 beats
    (35.0, 7, 8, 31.5),
    # nothing recorded / nonsense meter → don't move the marker
    (0.0, 4, 4, None),
    (-1.0, 4, 4, None),
    (64.0, 0, 4, None),
])
def test_compute_rewound_start(last, num, den, expected):
    assert compute_rewound_start(last, num, den) == expected


def test_compute_rewound_start_bad_types():
    assert compute_rewound_start(None, 4, 4) is None
    assert compute_rewound_start(64.0, 4, 0) is None


def test_stop_rewinds_start_marker(emit):
    song = FakeSong(last_event_time=64.0)
    _make(song, emit, ipad=True)
    song.set_playing(True)
    song.set_playing(False)
    assert song.start_time == 60.0  # one bar before the end, on the downbeat


def test_stop_rewind_is_deferred_not_inline(emit):
    """The start_time write is a song mutation — illegal inside the
    is_playing notification, so it must hop to the next tick."""
    song = FakeSong(last_event_time=64.0)
    sched = FakeScheduler()
    _make_deferred(song, emit, sched, ipad=True)
    song.set_playing(True)
    sched.flush()
    song.set_playing(False)
    assert song.start_time == 0.0     # not written yet
    assert len(sched.pending) == 2    # disarm + rewind, both queued
    sched.flush()
    assert song.start_time == 60.0


def test_stop_with_empty_arrangement_leaves_marker_alone(emit):
    song = FakeSong(last_event_time=0.0)
    song.start_time = 12.0
    _make(song, emit, ipad=True)
    song.set_playing(True)
    song.set_playing(False)
    assert song.start_time == 12.0


def test_unowned_stop_does_not_rewind(emit):
    """Gate off at Play → we never armed → Stop touches nothing, marker
    included."""
    song = FakeSong(last_event_time=64.0)
    song.start_time = 8.0
    _make(song, emit, ipad=False)
    song.set_playing(True)
    song.set_playing(False)
    assert song.start_time == 8.0


def test_rewind_survives_missing_lom_attrs(emit):
    """A Song that raises on last_event_time must not break disarm/save-as."""
    class Hostile(FakeSong):
        @property
        def last_event_time(self):
            raise RuntimeError("nope")

        @last_event_time.setter
        def last_event_time(self, _value):
            pass  # FakeSong.__init__ seeds it; the getter is the point

    song = Hostile()
    _make(song, emit, ipad=True)
    song.set_playing(True)
    song.set_playing(False)
    assert song.record_mode == 0
    assert emit.calls == [(V3_SESSION_SAVE_AS_REQUEST_ADDRESS, [120, 4, 4])]


def test_disconnect_before_deferred_rewind_is_noop(emit):
    song = FakeSong(last_event_time=64.0)
    sched = FakeScheduler()
    comp = _make_deferred(song, emit, sched, ipad=True)
    song.set_playing(True)
    sched.flush()
    song.set_playing(False)
    comp.disconnect()
    sched.flush()
    assert song.start_time == 0.0
