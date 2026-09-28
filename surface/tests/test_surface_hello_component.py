"""SurfaceHelloComponent unit tests — v3 surface-restart advertisement.

Exercises the contract from [04 §8.6]: the surface emits exactly one
``/looping/v3/surface/hello [instanceId, protocolVersion, timestamp]``
per surface lifetime, with a fresh instance id per ``__init__``, and
the component tolerates emit-layer failures without crashing.

Covers the Python side of the re-scoped PR-3c fix (the UI side
consumes the address and re-handshakes on instanceId drift). See the
2026-04-15 PR-3c revision entry in ``implementation-log.md``.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.HandshakeComponent import SUPPORTED_VERSIONS
from components.SurfaceHelloComponent import (
    PROTOCOL_VERSION,
    SurfaceHelloComponent,
    V3_SURFACE_HELLO_ADDRESS,
)


@pytest.fixture
def emits() -> List[Tuple]:
    return []


@pytest.fixture
def emit(emits):
    def _emit(addr, args):
        emits.append((addr, args))
    return _emit


# --- emission ---------------------------------------------------------


def test_send_hello_emits_address_with_three_args(emit, emits):
    """Baseline wire shape: address + 3 args (instance_id, version, ts)."""
    comp = SurfaceHelloComponent(
        emit=emit,
        instance_id_factory=lambda: "abc123",
        now=lambda: 1_700_000_000.5,
    )
    comp.send_hello()
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_SURFACE_HELLO_ADDRESS
    assert args == ("abc123", "3.12.0", 1_700_000_000)


def test_instance_id_minted_at_construction(emit, emits):
    """The id is created at ``__init__``, not at ``send_hello`` — so a
    surface that waits before sending still uses the bring-up id, not
    a later-minted one. Matters for the UI's drift-comparison
    contract: instanceId identifies the *surface*, not the moment of
    emission."""
    ids: List[str] = []

    def factory():
        ids.append("generated-%d" % len(ids))
        return ids[-1]

    comp = SurfaceHelloComponent(emit=emit, instance_id_factory=factory)
    assert ids == ["generated-0"]  # minted at construction
    comp.send_hello()
    assert emits[0][1][0] == "generated-0"


def test_send_hello_is_one_shot(emit, emits):
    """Second call does not re-emit; the UI contract relies on one
    emission per surface lifetime. A re-fire with the same id would
    mean "UI saw my restart-signal twice"; a re-fire with a different
    id would break the property that instanceId is per-surface, not
    per-message."""
    comp = SurfaceHelloComponent(
        emit=emit,
        instance_id_factory=lambda: "once",
        now=lambda: 42.0,
    )
    comp.send_hello()
    comp.send_hello()
    comp.send_hello()
    assert len(emits) == 1


def test_different_instances_mint_different_ids(emit, emits):
    """Simulates two surface lifetimes: each ``__init__`` mints a
    fresh id. This is what the UI's drift-detection reads."""
    counter = {"n": 0}

    def factory():
        counter["n"] += 1
        return "inst-%d" % counter["n"]

    a = SurfaceHelloComponent(emit=emit, instance_id_factory=factory)
    b = SurfaceHelloComponent(emit=emit, instance_id_factory=factory)
    assert a.instance_id == "inst-1"
    assert b.instance_id == "inst-2"
    a.send_hello()
    b.send_hello()
    assert emits[0][1][0] == "inst-1"
    assert emits[1][1][0] == "inst-2"


def test_timestamp_is_integer_seconds(emit, emits):
    """``timestamp`` is an int — OSC transport handles int/float the
    same, but a fractional float can turn into a Timetag-looking value
    in logs. Coerce to int seconds."""
    comp = SurfaceHelloComponent(
        emit=emit,
        instance_id_factory=lambda: "t",
        now=lambda: 1234.999,
    )
    comp.send_hello()
    ts = emits[0][1][2]
    assert isinstance(ts, int)
    assert ts == 1234


# --- robustness -------------------------------------------------------


def test_send_hello_swallows_emit_exception(emits):
    """A raising emit (half-torn-down transport, OSC codec bug) must
    not crash the surface during ``__init__``. We log and carry on;
    the UI then has no restart signal this bring-up and falls back to
    handshake-on-connect."""
    def raising_emit(addr, args):
        raise RuntimeError("transport boom")

    comp = SurfaceHelloComponent(
        emit=raising_emit,
        instance_id_factory=lambda: "x",
    )
    # Must not raise.
    comp.send_hello()
    # ``_sent`` stays False so a later retry (if some future caller
    # wanted one) would be permitted — but nothing in the current
    # wiring retries. This is defensive: emit failure shouldn't
    # permanently latch the "sent" flag.
    # Second call still attempts (and raises-but-catches again).
    comp.send_hello()


def test_send_hello_after_disconnect_is_noop(emit, emits):
    """Teardown racing bring-up: a late ``send_hello`` call after
    ``disconnect`` skips rather than emits on a closed transport.
    Defensive; the current wiring doesn't actually race this, but the
    guard keeps the surface robust against future reordering."""
    comp = SurfaceHelloComponent(
        emit=emit,
        instance_id_factory=lambda: "late",
    )
    comp.disconnect()
    comp.send_hello()
    assert emits == []


def test_disconnect_is_idempotent(emit, emits):
    comp = SurfaceHelloComponent(
        emit=emit,
        instance_id_factory=lambda: "i",
    )
    comp.disconnect()
    comp.disconnect()
    comp.disconnect()
    # No exception, no emit.
    assert emits == []


# --- spec consistency --------------------------------------------------


def test_protocol_version_matches_handshake_supported():
    """The advertised ``protocolVersion`` must be one of the versions
    the surface will actually handshake on. A drift lets a UI
    pre-reject a surface that would then successfully handshake (or
    vice-versa). This test is the belt against a one-sided bump."""
    assert PROTOCOL_VERSION in SUPPORTED_VERSIONS
