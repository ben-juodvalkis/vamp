"""InvalidationComponent unit tests — v3 state/invalidate emission.

Covers:

- Generation advance fires one ``/looping/v3/state/invalidate`` per advance
- Emitted generation matches the post-advance counter value
- Reason passes through verbatim
- Emit failure logs but does not raise (LOM listener path must stay alive)
- Disconnect silences subsequent advances; idempotent
"""

from __future__ import annotations

import pytest

from components.GenerationComponent import GenerationComponent
from components.InvalidationComponent import (
    InvalidationComponent,
    V3_STATE_INVALIDATE_ADDRESS,
)


@pytest.fixture
def wired():
    gen = GenerationComponent()
    emits: list = []
    inv = InvalidationComponent(
        generation_component=gen,
        emit=lambda a, args: emits.append((a, args)),
    )
    return gen, inv, emits


def test_advance_emits_invalidate(wired):
    gen, _inv, emits = wired
    gen.advance("track-added")
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_STATE_INVALIDATE_ADDRESS
    new_gen, reason = args
    assert new_gen == 2  # INITIAL=1, advance to 2
    assert reason == "track-added"


def test_each_advance_emits_once(wired):
    gen, _inv, emits = wired
    gen.advance("a")
    gen.advance("b")
    gen.advance("c")
    assert len(emits) == 3
    assert [e[1][0] for e in emits] == [2, 3, 4]
    assert [e[1][1] for e in emits] == ["a", "b", "c"]


def test_reason_passes_through(wired):
    gen, _inv, emits = wired
    gen.advance("device-swap")
    assert emits[0][1][1] == "device-swap"


def test_emit_failure_swallowed():
    gen = GenerationComponent()

    def boom(_a, _args):
        raise RuntimeError("transport closed")

    InvalidationComponent(generation_component=gen, emit=boom)
    # Must not raise.
    new_gen = gen.advance("any")
    assert new_gen == 2  # Counter still advanced.


def test_disconnect_silences_subsequent_advances(wired):
    gen, inv, emits = wired
    inv.disconnect()
    gen.advance("late-advance")
    assert emits == []


def test_disconnect_idempotent(wired):
    _gen, inv, _emits = wired
    inv.disconnect()
    inv.disconnect()  # no exception


def test_counter_still_advances_after_disconnect(wired):
    """Disconnecting the invalidation emitter doesn't freeze the counter
    — advances still land, they just don't reach the wire."""
    gen, inv, _emits = wired
    inv.disconnect()
    new_gen = gen.advance("still-advances")
    assert new_gen == 2
