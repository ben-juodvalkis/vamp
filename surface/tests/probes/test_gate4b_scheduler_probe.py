"""SchedulerProbe unit tests.

``ControlSurface.schedule_message`` only exists inside Live's embedded
Python, so these tests cannot measure real scheduler fidelity. What
they *can* cover is the probe's scaffolding: argument parsing, the
ms → ticks conversion, the stats math (mean / p50 / p99 / max), the
single-run-at-a-time guard, and the emission shape.

Strategy
--------

A ``FakeScheduler`` queues ``(ticks, fn)`` pairs and exposes a ``fire``
method that advances a fake clock by a configurable deviation and
invokes each queued callback in order. This lets a single test
produce a deterministic distribution over samples — e.g., 100 calls
at "exactly 10ms requested, actually 12±2ms observed" — and assert
the resulting stats precisely.

Real Live-side behaviour (jitter, tick-quantised fire) is Gate 4b's
live run to verify, not these tests'.
"""

from __future__ import annotations

import logging

import pytest

from components.SchedulerProbe import (
    ACCEPT_MS_LONG,
    ACCEPT_MS_SHORT,
    RESULT_ADDRESS,
    RUN_ADDRESS,
    SchedulerProbe,
    _ms_to_ticks,
    _nearest_rank_index,
    _summarise,
)


# --- fakes ------------------------------------------------------------------


class FakeClock:
    """Deterministic monotonic clock stand-in.

    Seconds, matching ``time.monotonic``'s contract. Tests advance the
    clock explicitly between fires so deviations are exact, not
    noisy.
    """

    def __init__(self, start=1000.0):
        self.t = start

    def __call__(self):
        return self.t

    def advance_ms(self, ms):
        self.t += ms / 1000.0


class FakeScheduler:
    """Captures ``(ticks, fn)`` calls for later firing.

    The probe only reads ``ticks`` as a sanity signal (the real
    ``schedule_message`` uses it to time the fire); here we just
    record them for assertions and ignore for firing order, which
    tests control explicitly.
    """

    def __init__(self):
        self.calls = []  # list of (ticks, fn)

    def __call__(self, ticks, fn):
        self.calls.append((ticks, fn))

    def fire_all(self, clock, deviations_ms):
        """Fire each queued callback, advancing ``clock`` between fires.

        ``deviations_ms`` is a list matching ``len(self.calls)``: each
        entry is the *absolute* time (in ms past the probe's ``t0``)
        when that callback fires. The probe's stats are computed
        against ``now - t0``, so setting absolute fire times gives
        the test full control over the resulting samples.
        """
        if len(deviations_ms) != len(self.calls):
            raise AssertionError(
                "fire_all expected %d deviations, got %d"
                % (len(self.calls), len(deviations_ms))
            )
        # Snapshot the callbacks up front because firing the last one
        # clears ``self.calls`` indirectly (via the probe's reset).
        calls = list(self.calls)
        self.calls.clear()
        t0 = clock.t  # captured before any fire; all deviations are relative to this
        for (_, fn), dev_ms in zip(calls, deviations_ms):
            clock.t = t0 + dev_ms / 1000.0
            fn()


class EmitCapture:
    def __init__(self):
        self.events = []  # list of (address, args)

    def __call__(self, address, args):
        self.events.append((address, tuple(args)))


# --- fixtures ---------------------------------------------------------------


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def scheduler():
    return FakeScheduler()


@pytest.fixture
def emit():
    return EmitCapture()


@pytest.fixture
def probe(scheduler, emit, clock):
    return SchedulerProbe(
        schedule_message=scheduler,
        emit=emit,
        now=clock,
    )


# --- address / band constants ----------------------------------------------


def test_address_constants_stable():
    # Driver script (and any external operator tool) encodes these
    # strings. Freezing them in the test prevents silent rename
    # breakage — same pattern as test_gate4a_browser_probe.
    assert RUN_ADDRESS == "/looping/probe/schedule_run"
    assert RESULT_ADDRESS == "/looping/probe/schedule_result"


def test_acceptance_bands_match_spec():
    # [05 §1 Gate 4b] and [06 §1.3] name these thresholds; the driver
    # reads them to colour its markdown table. If either changes, the
    # spec and the driver must change together — this test catches a
    # silent drift.
    assert ACCEPT_MS_SHORT == 20
    assert ACCEPT_MS_LONG == 50


# --- arg parsing / bad input -----------------------------------------------


def test_missing_args_logs_and_noops(probe, emit, caplog):
    with caplog.at_level(logging.WARNING, logger="looping"):
        assert probe.handle_schedule_run((), None) is None
        assert probe.handle_schedule_run((10,), None) is None
    assert emit.events == []
    assert any("expected (delay_ms, count)" in m for m in caplog.messages)


def test_non_int_args_log_and_noop(probe, emit, caplog):
    with caplog.at_level(logging.WARNING, logger="looping"):
        # Strings aren't coerceable by ``int()`` without digits.
        assert probe.handle_schedule_run(("fast", "many"), None) is None
    assert emit.events == []
    assert any("bad args" in m for m in caplog.messages)


def test_zero_or_negative_delay_emits_error(probe, emit):
    probe.handle_schedule_run((0, 10), None)
    assert len(emit.events) == 1
    addr, args = emit.events[0]
    assert addr == RESULT_ADDRESS
    # Error sentinel shape: mean/p50/p99/max all -1.0.
    assert args[2] == -1.0
    assert args[3] == -1.0
    assert args[4] == -1.0
    assert args[5] == -1.0


def test_zero_count_emits_error(probe, emit):
    probe.handle_schedule_run((10, 0), None)
    assert len(emit.events) == 1
    # Same sentinel shape regardless of which arg was bad.
    assert emit.events[0][1][2] == -1.0


# --- ms → ticks conversion -------------------------------------------------


@pytest.mark.parametrize(
    "delay_ms, expected_ticks",
    [
        (1, 1),       # floor: sub-tick request still defers by one tick
        (10, 1),
        (99, 1),
        (100, 1),     # exactly one tick
        (101, 2),     # round up
        (500, 5),
        (1500, 15),
        (1499, 15),   # ceiling: any partial tick pushes up
    ],
)
def test_ms_to_ticks(delay_ms, expected_ticks):
    assert _ms_to_ticks(delay_ms) == expected_ticks


def test_scheduler_receives_expected_tick_count(probe, scheduler):
    probe.handle_schedule_run((500, 3), None)
    # Three calls to schedule_message, all at 5 ticks (500ms).
    assert len(scheduler.calls) == 3
    for ticks, fn in scheduler.calls:
        assert ticks == 5
        assert callable(fn)


# --- single-run guard ------------------------------------------------------


def test_concurrent_second_run_refused_with_busy(probe, scheduler, emit, clock):
    probe.handle_schedule_run((100, 5), None)
    # Mid-run: a second call while samples are still accumulating must
    # not mix into the first bucket. The probe should emit an error
    # and leave the first run's scheduled callbacks intact.
    assert len(scheduler.calls) == 5
    probe.handle_schedule_run((200, 5), None)
    # One additional emit (the error), no new schedule_message calls.
    assert len(emit.events) == 1
    assert emit.events[0][1][0] == 200  # delay_ms echoed back in error
    assert emit.events[0][1][2] == -1.0
    assert len(scheduler.calls) == 5  # unchanged


def test_run_clears_slot_after_completion(probe, scheduler, emit, clock):
    # First run: scheduled, fired, emitted, slot cleared.
    probe.handle_schedule_run((100, 2), None)
    scheduler.fire_all(clock, [100.0, 100.0])
    assert len(emit.events) == 1
    assert emit.events[0][1][0] == 100

    # Second run: different delay — must proceed without busy error.
    probe.handle_schedule_run((500, 2), None)
    scheduler.fire_all(clock, [500.0, 500.0])
    assert len(emit.events) == 2
    assert emit.events[1][1][0] == 500


# --- emission shape / stats end-to-end -------------------------------------


def test_emit_shape_is_six_positional_args(probe, scheduler, emit, clock):
    probe.handle_schedule_run((100, 4), None)
    # Fire with exactly 100ms deviation each; stats collapse to all 100s.
    scheduler.fire_all(clock, [100.0, 100.0, 100.0, 100.0])
    assert len(emit.events) == 1
    addr, args = emit.events[0]
    assert addr == RESULT_ADDRESS
    assert len(args) == 6
    delay_ms, count, mean, p50, p99, max_ms = args
    assert delay_ms == 100
    assert count == 4
    assert mean == pytest.approx(100.0)
    assert p50 == pytest.approx(100.0)
    assert p99 == pytest.approx(100.0)
    assert max_ms == pytest.approx(100.0)


def test_emit_types_are_wire_clean(probe, scheduler, emit, clock):
    # The OSC codec distinguishes ints from floats. The result shape
    # is (int, int, float, float, float, float); regressing this
    # would break the driver's arg-type assumptions silently.
    probe.handle_schedule_run((100, 2), None)
    scheduler.fire_all(clock, [100.0, 100.0])
    _, args = emit.events[0]
    assert type(args[0]) is int
    assert type(args[1]) is int
    assert type(args[2]) is float
    assert type(args[3]) is float
    assert type(args[4]) is float
    assert type(args[5]) is float


def test_stats_across_a_known_distribution(probe, scheduler, emit, clock):
    # 10 samples with a known spread so p50 and p99 have exact values.
    # Sorted: [100, 105, 110, 115, 120, 125, 130, 135, 140, 145].
    # Nearest-rank p50 for n=10 → index 4 → 120.
    # Nearest-rank p99 for n=10 → index 9 → 145.
    probe.handle_schedule_run((100, 10), None)
    deviations = [100.0, 105.0, 110.0, 115.0, 120.0, 125.0, 130.0, 135.0, 140.0, 145.0]
    scheduler.fire_all(clock, deviations)
    _, args = emit.events[0]
    _, _, mean, p50, p99, max_ms = args
    assert mean == pytest.approx(sum(deviations) / len(deviations))
    assert p50 == pytest.approx(120.0)
    assert p99 == pytest.approx(145.0)
    assert max_ms == pytest.approx(145.0)


def test_stats_emit_happens_only_on_last_callback(probe, scheduler, emit, clock):
    # Partial fires should leave the emit empty; only the Nth fire
    # triggers the summary. This is load-bearing: a driver that read
    # a partial emit would pick up garbage mean/p99.
    probe.handle_schedule_run((100, 5), None)
    # Fire four of five.
    calls = list(scheduler.calls)
    scheduler.calls.clear()
    t0 = clock.t
    for idx, (_, fn) in enumerate(calls[:4]):
        clock.t = t0 + 0.100  # 100ms past t0
        fn()
    assert emit.events == []
    # Fifth fire completes the bucket.
    clock.t = t0 + 0.110
    calls[4][1]()
    assert len(emit.events) == 1


# --- helpers / pure math ---------------------------------------------------


def test_summarise_empty_returns_zeros():
    # The handler guards against this, but the helper is exported
    # and should be total — defensive in a way that's cheap.
    s = _summarise([])
    assert s == {"mean": 0.0, "p50": 0.0, "p99": 0.0, "max": 0.0}


def test_summarise_single_sample():
    s = _summarise([42.0])
    assert s["mean"] == 42.0
    assert s["p50"] == 42.0
    assert s["p99"] == 42.0
    assert s["max"] == 42.0


@pytest.mark.parametrize(
    "n, pct, expected",
    [
        (100, 0.5, 49),   # plan's default N=100, p50 → index 49
        (100, 0.99, 98),  # p99 → index 98
        (100, 1.0, 99),   # p100 → last
        (10, 0.5, 4),     # p50 of 10 → index 4
        (10, 0.99, 9),    # p99 of 10 → index 9 (nearest rank clamps)
        (1, 0.5, 0),      # single element
        (1, 0.99, 0),
        (0, 0.5, 0),      # degenerate — shouldn't blow up
    ],
)
def test_nearest_rank_index(n, pct, expected):
    assert _nearest_rank_index(n, pct) == expected


def test_summarise_unsorted_input():
    # The helper sorts internally; callers don't need to pre-sort.
    # This is worth a test because a regression that removed the
    # ``sorted()`` call would leave mean correct and percentiles
    # silently wrong.
    s = _summarise([145.0, 100.0, 125.0, 110.0, 135.0, 105.0, 140.0, 115.0, 130.0, 120.0])
    assert s["p50"] == pytest.approx(120.0)
    assert s["p99"] == pytest.approx(145.0)
    assert s["max"] == pytest.approx(145.0)
