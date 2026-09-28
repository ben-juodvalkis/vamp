"""Tests for ``perf_logging`` — the rate-coalescing log helper.

Exercises:
- First call for a fresh key emits immediately at the chosen level.
- Subsequent calls in the same window do not emit again.
- ``flush_due()`` after the window closes emits the "xN" summary.
- ``flush_due()`` before the window closes is a no-op.
- ``reset()`` drops pending buckets without emitting summaries.
- Per-key isolation: separate keys do not coalesce together.

Tests are wall-clock-driven (the module uses ``time.monotonic``);
windows of ~1.0 s force short ``time.sleep`` calls in the few tests
that exercise expiry. Kept under 1.2 s total.
"""

from __future__ import annotations

import logging
import time

import perf_logging


def test_first_call_emits_immediately(caplog):
    perf_logging.reset()
    caplog.set_level(logging.INFO, logger="looping")

    perf_logging.rate("k1", logging.INFO, "first hit", {"i": 1})

    matching = [r for r in caplog.records if "first hit" in r.getMessage()]
    assert len(matching) == 1
    assert matching[0].levelno == logging.INFO


def test_repeats_in_same_window_do_not_emit(caplog):
    perf_logging.reset()
    caplog.set_level(logging.INFO, logger="looping")

    perf_logging.rate("k1", logging.INFO, "hit", None)
    perf_logging.rate("k1", logging.INFO, "hit", None)
    perf_logging.rate("k1", logging.INFO, "hit", None)

    # Exactly one emit during the window — the first.
    assert len([r for r in caplog.records if "hit" in r.getMessage()]) == 1


def test_flush_due_emits_summary_after_window_closes(caplog):
    perf_logging.reset()
    caplog.set_level(logging.INFO, logger="looping")

    perf_logging.rate("k1", logging.INFO, "hit", None)
    perf_logging.rate("k1", logging.INFO, "hit", None)
    perf_logging.rate("k1", logging.INFO, "hit", None)

    # No summary yet — window still open.
    perf_logging.flush_due()
    assert len([r for r in caplog.records if "x" in r.getMessage()]) == 0

    time.sleep(1.05)  # exceed the 1.0 s window
    perf_logging.flush_due()

    summary = [r for r in caplog.records
               if "x3" in r.getMessage() and "hit" in r.getMessage()]
    assert len(summary) == 1


def test_flush_before_window_closes_is_noop(caplog):
    perf_logging.reset()
    caplog.set_level(logging.DEBUG, logger="looping")

    perf_logging.rate("k1", logging.DEBUG, "hit", None)
    perf_logging.rate("k1", logging.DEBUG, "hit", None)

    perf_logging.flush_due()  # window still open
    # Just the initial emit — no summary yet.
    assert len(caplog.records) == 1


def test_reset_drops_buckets_without_summary(caplog):
    perf_logging.reset()
    caplog.set_level(logging.WARNING, logger="looping")

    perf_logging.rate("k1", logging.WARNING, "hit", None)
    perf_logging.rate("k1", logging.WARNING, "hit", None)

    caplog.clear()
    perf_logging.reset()
    time.sleep(1.05)
    perf_logging.flush_due()

    assert caplog.records == []


def test_separate_keys_do_not_coalesce(caplog):
    perf_logging.reset()
    caplog.set_level(logging.INFO, logger="looping")

    perf_logging.rate("a", logging.INFO, "a-msg", None)
    perf_logging.rate("b", logging.INFO, "b-msg", None)

    msgs = [r.getMessage() for r in caplog.records]
    assert any("a-msg" in m for m in msgs)
    assert any("b-msg" in m for m in msgs)


def test_disabled_level_skips_bucket_creation(monkeypatch):
    """When the level is filtered out, ``rate()`` must not even create a
    bucket — verified by inspecting module-level state rather than
    going through caplog (whose ``set_level`` overrides logger filters).
    """
    perf_logging.reset()
    # Force ``isEnabledFor`` to return False for any level so the early
    # return at the top of ``rate()`` fires. Avoids the caplog fixture's
    # level-override side effects.
    monkeypatch.setattr(perf_logging.logger, "isEnabledFor", lambda lvl: False)

    perf_logging.rate("k1", logging.DEBUG, "should-not-emit", None)

    # The bucket map should be untouched — no key was added.
    assert "k1" not in perf_logging._buckets
