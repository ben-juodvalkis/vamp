"""GenerationComponent unit tests — structural-generation counter.

Covers the counter itself (start value, advance monotonicity, returned
value), the on-advance hook (fires with old/new/reason, doesn't roll
back on raise), the stale-check helper (ordering, sentinel handling,
malformed input), and the lifecycle (disconnect idempotency, frozen
after disconnect).

Per [04 §4](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#4-generation-numbering).
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.GenerationComponent import (
    GenerationComponent,
    INITIAL_GENERATION,
    UNSET_GENERATION,
)


# --- counter basics --------------------------------------------------------


def test_starts_at_initial_generation():
    g = GenerationComponent()
    assert g.current == INITIAL_GENERATION
    assert INITIAL_GENERATION == 1
    assert UNSET_GENERATION == 0


def test_advance_returns_new_value():
    g = GenerationComponent()
    assert g.advance("track-added") == 2
    assert g.current == 2


def test_advance_monotonic():
    g = GenerationComponent()
    seen: List[int] = [g.current]
    for reason in ("a", "b", "c", "d"):
        seen.append(g.advance(reason))
    assert seen == [1, 2, 3, 4, 5]


def test_unset_sentinel_never_produced():
    """UNSET (0) is reserved; the counter must never hold it at rest."""
    g = GenerationComponent()
    assert g.current != UNSET_GENERATION
    for _ in range(10):
        assert g.advance("x") != UNSET_GENERATION


# --- on_advance hook -------------------------------------------------------


def test_on_advance_fires_with_old_new_reason():
    calls: List[Tuple[int, int, str]] = []
    g = GenerationComponent(on_advance=lambda old, new, reason: calls.append(
        (old, new, reason),
    ))
    g.advance("track-added")
    g.advance("plugin-reconfig")
    assert calls == [(1, 2, "track-added"), (2, 3, "plugin-reconfig")]


def test_on_advance_installed_post_construction():
    """set_on_advance replaces the hook; old hook stops firing."""
    calls_a: List[Tuple[int, int, str]] = []
    calls_b: List[Tuple[int, int, str]] = []
    g = GenerationComponent(on_advance=lambda o, n, r: calls_a.append((o, n, r)))
    g.advance("first")
    g.set_on_advance(lambda o, n, r: calls_b.append((o, n, r)))
    g.advance("second")
    assert calls_a == [(1, 2, "first")]
    assert calls_b == [(2, 3, "second")]


def test_on_advance_none_detaches():
    calls: List[Tuple[int, int, str]] = []
    g = GenerationComponent(on_advance=lambda o, n, r: calls.append((o, n, r)))
    g.set_on_advance(None)
    g.advance("silent")
    assert calls == []
    assert g.current == 2  # counter still advanced


def test_on_advance_raising_does_not_roll_back():
    """A raising hook must not undo the counter advance."""
    def boom(old, new, reason):
        raise RuntimeError("hook blew up")

    g = GenerationComponent(on_advance=boom)
    # advance() itself must not raise — the listener dispatch that
    # called us would otherwise crash Live's tick thread.
    new_gen = g.advance("risky")
    assert new_gen == 2
    assert g.current == 2


# --- is_stale --------------------------------------------------------------


def test_is_stale_ui_behind():
    g = GenerationComponent()
    g.advance("x")  # now 2
    assert g.is_stale(1) is True


def test_is_stale_ui_caught_up():
    g = GenerationComponent()
    assert g.is_stale(1) is False
    g.advance("x")
    assert g.is_stale(2) is False


def test_is_stale_ui_ahead_not_stale():
    """A UI that's ahead is weird but not "stale" — spec defines stale
    as UI < surface; UI > surface is a desync the write handler treats
    as stale-like via separate path-structural-mismatch handling, but
    this helper returns False for ahead."""
    g = GenerationComponent()
    assert g.is_stale(5) is False  # surface is at 1, UI claims 5


def test_is_stale_unset_sentinel_is_stale():
    """UNSET_GENERATION (0) from the UI is always stale."""
    g = GenerationComponent()
    assert g.is_stale(UNSET_GENERATION) is True
    assert g.is_stale(0) is True


def test_is_stale_malformed_is_stale():
    """Non-int UI generation (coerce failure) treated as stale."""
    g = GenerationComponent()
    assert g.is_stale("not-a-number") is True
    assert g.is_stale(None) is True


# --- lifecycle -------------------------------------------------------------


def test_disconnect_freezes_counter():
    g = GenerationComponent()
    g.advance("x")
    g.disconnect()
    # Post-disconnect advance is a no-op; counter frozen at last value.
    current_before = g.current
    result = g.advance("after-disconnect")
    assert result == current_before
    assert g.current == current_before


def test_disconnect_idempotent():
    g = GenerationComponent()
    g.disconnect()
    g.disconnect()  # no-raise
    assert g.current == INITIAL_GENERATION


def test_disconnect_drops_on_advance():
    calls: List[Tuple[int, int, str]] = []
    g = GenerationComponent(on_advance=lambda o, n, r: calls.append((o, n, r)))
    g.disconnect()
    g.advance("silent")
    assert calls == []


def test_on_advance_only_on_real_advance():
    """A disconnected component's advance must not fire the hook."""
    calls: List[Tuple[int, int, str]] = []
    g = GenerationComponent(on_advance=lambda o, n, r: calls.append((o, n, r)))
    g.advance("real")
    assert len(calls) == 1
    g.disconnect()
    g.advance("noop")
    assert len(calls) == 1
