"""Tests for ``perf_profiler`` — surface-side aggregate counters.

These tests exercise the in-memory counter behaviour (no env-gating —
``record_*`` are no-ops when the profiler is disabled, so the tests
flip ``_ENABLED`` on directly via the module). File IO is not
exercised here; ``flush_due`` is tested up to the point where the
counters reset, asserting the resulting snapshot.

Pinned behaviours:

- ``record_send`` counts per address and accumulates byte-equivalents.
- The ``bool`` byte estimator runs (regression for the unreachable-
  branch bug — bool-only args sum to ``len(addr) + 1`` per arg, not 8).
- ``record_inbound`` and ``record_listener_fire`` accumulate by key.
- ``flush_due`` resets in-memory counters once the window closes.
- ``snapshot`` returns the live state without resetting.
- Disabled mode (``_ENABLED = False``) makes every recorder a no-op.
"""

from __future__ import annotations

import time

import perf_profiler


def _force_enable():
    """Flip the module-level enabled flag for in-memory tests.

    Avoids touching the env-var resolution path; the file-write side
    is intentionally not exercised here (tested by integration).
    """
    perf_profiler._ENABLED = True
    perf_profiler._counters.reset(time.monotonic())


def _force_disable():
    perf_profiler._ENABLED = False
    perf_profiler._counters.reset(time.monotonic())


def test_record_send_counts_addresses():
    _force_enable()
    perf_profiler.record_send("/a", ())
    perf_profiler.record_send("/a", ())
    perf_profiler.record_send("/b", ())

    snap = perf_profiler.snapshot()
    assert snap["send"]["/a"] == 2
    assert snap["send"]["/b"] == 1


def test_record_send_byte_estimator_handles_strings_and_numbers():
    _force_enable()
    perf_profiler.record_send("/abc", ("hello", 1.0, 42))
    snap = perf_profiler.snapshot()
    # 4 chars in address + len("hello")=5 + 8 (float) + 8 (int) = 25
    assert snap["sendBytes"] == 4 + 5 + 8 + 8


def test_record_send_byte_estimator_distinguishes_bool_from_int():
    """Regression for the dead-branch bug where bool was counted as 8.

    ``bool`` is a subclass of ``int`` in Python, so ``isinstance(True,
    (int, float))`` matches first if not ordered carefully. With the
    fix, two bool args sum to 2 bytes (1 each), not 16.
    """
    _force_enable()
    perf_profiler.record_send("/x", (True, False))
    snap = perf_profiler.snapshot()
    # 2 (address chars) + 1 + 1 = 4
    assert snap["sendBytes"] == 2 + 1 + 1


def test_record_inbound_counts_addresses():
    _force_enable()
    perf_profiler.record_inbound("/in/a")
    perf_profiler.record_inbound("/in/a")
    perf_profiler.record_inbound("/in/b")

    snap = perf_profiler.snapshot()
    assert snap["inbound"]["/in/a"] == 2
    assert snap["inbound"]["/in/b"] == 1


def test_record_listener_fire_counts_by_kind():
    _force_enable()
    perf_profiler.record_listener_fire("tracks_changed")
    perf_profiler.record_listener_fire("param:value")
    perf_profiler.record_listener_fire("param:value")

    snap = perf_profiler.snapshot()
    assert snap["listeners"]["tracks_changed"] == 1
    assert snap["listeners"]["param:value"] == 2


def test_record_tick_tracks_max_gap():
    _force_enable()
    perf_profiler.record_tick(0.001, 8.0)
    perf_profiler.record_tick(0.002, 600.0)
    perf_profiler.record_tick(0.003, 12.0)

    snap = perf_profiler.snapshot()
    assert snap["tickCount"] == 3
    assert snap["tickGapMaxMs"] == 600.0
    # 0.001 + 0.002 + 0.003 = 0.006 sec → 6 ms
    assert snap["tickTimeMs"] == 6


def test_disabled_mode_is_noop():
    _force_disable()
    perf_profiler.record_send("/a", (1,))
    perf_profiler.record_inbound("/in/a")
    perf_profiler.record_listener_fire("tracks_changed")
    perf_profiler.record_tick(0.001, 5.0)

    snap = perf_profiler.snapshot()
    assert snap["send"] == {}
    assert snap["inbound"] == {}
    assert snap["listeners"] == {}
    assert snap["tickCount"] == 0


def test_snapshot_does_not_reset_counters():
    _force_enable()
    perf_profiler.record_send("/a", ())
    perf_profiler.snapshot()
    perf_profiler.snapshot()
    snap = perf_profiler.snapshot()
    assert snap["send"]["/a"] == 1


def test_flush_due_before_window_closes_is_noop():
    """When the dump file isn't open and the window hasn't closed,
    ``flush_due`` is a clean no-op — counters survive untouched."""
    _force_enable()
    perf_profiler.record_send("/a", ())
    perf_profiler.flush_due()
    snap = perf_profiler.snapshot()
    assert snap["send"]["/a"] == 1
