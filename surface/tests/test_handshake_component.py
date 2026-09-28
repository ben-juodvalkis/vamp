"""HandshakeComponent unit tests — v3 protocol negotiation.

Covers:

- Hello → accept happy path (version picked, session minted, generation
  included in reply)
- Version mismatch → typed error with ``handshake-version-mismatch`` code
- Malformed hello (no args, non-string args, empty-string args)
- Session eviction after timeout (with injected clock)
- Session ID minting via injected factory
- Disconnect clears sessions
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.GenerationComponent import GenerationComponent
from components.HandshakeComponent import (
    DEFAULT_SESSION_TIMEOUT_SECONDS,
    HANDSHAKE_VERSION_MISMATCH_CODE,
    HandshakeComponent,
    SUPPORTED_VERSIONS,
    V3_ERROR_ADDRESS,
    V3_HANDSHAKE_ACCEPT_ADDRESS,
    V3_HANDSHAKE_HELLO_ADDRESS,
)


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def fake_clock():
    """Mutable clock — tests advance by re-assigning ``clock[0]``."""
    return [1_000.0]


@pytest.fixture
def id_factory():
    """Counter-based session id factory for deterministic assertions."""
    counter = [0]

    def next_id():
        counter[0] += 1
        return "sess-%04d" % counter[0]

    return next_id


@pytest.fixture
def emits():
    """Captures (address, args) from the component's emit hook."""
    out: List[Tuple[str, tuple]] = []
    return out


@pytest.fixture
def component(fake_clock, id_factory, emits):
    """HandshakeComponent wired with deterministic clock + ids + emit list."""
    gen = GenerationComponent()
    return HandshakeComponent(
        emit=lambda a, args: emits.append((a, args)),
        generation_component=gen,
        now=lambda: fake_clock[0],
        session_id_factory=id_factory,
    ), gen


# --- happy path -----------------------------------------------------------


def test_hello_accepts_supported_version(component, emits):
    hs, _gen = component
    hs.handle_hello(("3.0.0",), ("127.0.0.1", 50000))
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_HANDSHAKE_ACCEPT_ADDRESS
    version, session_id, generation = args
    assert version == "3.0.0"
    assert session_id == "sess-0001"
    assert generation == 1  # INITIAL_GENERATION


def test_accept_carries_current_generation(component, emits):
    hs, gen = component
    gen.advance("track-added")
    gen.advance("track-added")
    hs.handle_hello(("3.0.0",), None)
    _addr, args = emits[-1]
    _version, _sid, generation = args
    assert generation == 3  # 1 + 2 advances


def test_multiple_ui_versions_highest_common_picked(component, emits):
    """UI advertises ["3.1.0", "2.0.0"]; surface picks 3.1.0."""
    hs, _gen = component
    hs.handle_hello(("2.0.0", "3.1.0"), None)
    _addr, args = emits[0]
    assert args[0] == "3.1.0"


def test_ui_with_both_3x_versions_picks_highest(component, emits):
    """UI advertises ["3.1.0", "3.0.0"]; surface picks 3.1.0 — this is
    the normal post-PR-7a case."""
    hs, _gen = component
    hs.handle_hello(("3.1.0", "3.0.0"), None)
    _addr, args = emits[0]
    assert args[0] == "3.1.0"


def test_stale_ui_still_accepted(component, emits):
    """UI advertises ["3.0.0"] only (pre-PR-7a build); surface still
    advertises both and picks 3.0.0 — downgrade-revert safety."""
    hs, _gen = component
    hs.handle_hello(("3.0.0",), None)
    _addr, args = emits[0]
    assert args[0] == "3.0.0"


def test_bytes_args_decoded(component, emits):
    """OSC may hand args as bytes; component decodes UTF-8."""
    hs, _gen = component
    hs.handle_hello((b"3.0.0",), None)
    assert emits[0][0] == V3_HANDSHAKE_ACCEPT_ADDRESS


# --- version mismatch -----------------------------------------------------


def test_no_common_version_emits_error(component, emits):
    hs, _gen = component
    hs.handle_hello(("2.0.0",), ("127.0.0.1", 50000))
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == V3_ERROR_ADDRESS
    error_address, code, path, detail = args
    assert error_address == V3_HANDSHAKE_HELLO_ADDRESS
    assert code == HANDSHAKE_VERSION_MISMATCH_CODE
    assert path == ""
    assert "2.0.0" in detail
    assert "3.1.0" in detail or "3.0.0" in detail


def test_future_version_only_emits_error(component, emits):
    """UI advertises 4.0.0 only; surface can't speak it."""
    hs, _gen = component
    hs.handle_hello(("4.0.0",), None)
    assert emits[0][0] == V3_ERROR_ADDRESS


# --- malformed --------------------------------------------------------


def test_empty_args_emits_error(component, emits):
    hs, _gen = component
    hs.handle_hello((), None)
    assert len(emits) == 1
    assert emits[0][0] == V3_ERROR_ADDRESS


def test_empty_strings_only_emits_error(component, emits):
    hs, _gen = component
    hs.handle_hello(("", "  "), None)
    assert emits[0][0] == V3_ERROR_ADDRESS


def test_non_string_args_coerced_or_dropped(component, emits):
    """Ints, floats, bools in args get stringified. If none is parseable
    as a supported version, emit mismatch. Crucially: don't raise."""
    hs, _gen = component
    hs.handle_hello((42, 3.14), None)
    # "42" and "3.14" aren't supported versions → mismatch.
    assert emits[0][0] == V3_ERROR_ADDRESS
    _addr, args = emits[0]
    assert args[1] == HANDSHAKE_VERSION_MISMATCH_CODE


# --- session tracking -----------------------------------------------------


def test_each_hello_mints_new_session(component, emits):
    hs, _gen = component
    hs.handle_hello(("3.0.0",), None)
    hs.handle_hello(("3.0.0",), None)
    assert [emits[0][1][1], emits[1][1][1]] == ["sess-0001", "sess-0002"]


def test_active_sessions_tracked(component):
    hs, _gen = component
    hs.handle_hello(("3.0.0",), None)
    hs.handle_hello(("3.0.0",), None)
    assert len(hs.active_session_ids()) == 2


def test_stale_sessions_evicted(component, fake_clock):
    hs, _gen = component
    hs.handle_hello(("3.0.0",), None)
    # Advance clock past the timeout.
    fake_clock[0] += DEFAULT_SESSION_TIMEOUT_SECONDS + 1
    # Any subsequent access that runs eviction should clear it.
    assert hs.active_session_ids() == []


def test_touch_marks_active(component, fake_clock):
    """A touched session survives past the original timeout window."""
    hs, _gen = component
    hs.handle_hello(("3.0.0",), None)
    sid = hs.active_session_ids()[0]

    # Advance 25s (under the 30s window), touch, then advance another 20s.
    fake_clock[0] += 25
    assert hs.touch(sid) is True
    fake_clock[0] += 20  # 45s since hello, but only 20s since touch

    assert sid in hs.active_session_ids()


def test_touch_unknown_session_returns_false(component):
    hs, _gen = component
    assert hs.touch("nonexistent") is False


# --- disconnect -----------------------------------------------------------


def test_disconnect_clears_sessions(component):
    hs, _gen = component
    hs.handle_hello(("3.0.0",), None)
    hs.disconnect()
    assert hs.active_session_ids() == []


def test_disconnect_makes_handler_noop(component, emits):
    hs, _gen = component
    hs.disconnect()
    hs.handle_hello(("3.0.0",), None)
    assert emits == []


def test_disconnect_idempotent(component):
    hs, _gen = component
    hs.disconnect()
    hs.disconnect()  # no-raise


# --- SUPPORTED_VERSIONS sanity -------------------------------------------


def test_advertises_3_7_0_down_to_3_0_0():
    """Phase 7 PR-7c pr7c-3 adds 3.2.0 alongside 3.1.0 / 3.0.0 \u2014 all
    three are advertised in preference order. Dropping older versions
    from the list would break stale-UI handshake and violate the
    rollback-safety guarantee in phase-7-pr7a-design.md \u00a72.4."""
    assert SUPPORTED_VERSIONS == (
        "3.12.0", "3.11.0", "3.10.0", "3.9.0", "3.8.0", "3.7.0", "3.6.0", "3.5.0", "3.4.0", "3.3.0",
        "3.2.0", "3.1.0", "3.0.0",
    )

    # 3.12.0 (2026-09-28) is ``device/load``'s ``native:<class>`` source: a
    # tile names a native device, not a preset file.
    # 3.11.0 (2026-09-26) is the loads that name their Place: two optional
    # trailing args on ``prepare_for_preset`` and ``device/load``.

    # 3.9.0 (2026-09-15, ADR-439) grows the T record 14 -> 15 with ``preset``.
    # 3.8.0 (2026-09-10, issue #491) adds the note-keyed ``pads/<note>`` path
    # segment, the ``pad-chain`` state/full reason and a read ``devicePath``
    # on ``device/load``; record arities are unchanged.
    # 3.5.0 (2026-08-31) adds the client-declared ETag: an ``etag:0x...``
    # token in hello plus the ``state/full/unchanged`` marker. Unlike
    # every prior bump it does NOT change record arity, so it is the
    # first a UI can genuinely negotiate down from — a 3.5.0 UI against
    # a 3.4.0 surface simply never receives a marker and always gets
    # full trees.
    #
    # 3.6.0 (2026-08-31) collapses ``state/full`` to a single
    # ``state/full/tree`` message. The tail stays because clients that
    # never read the tree still negotiate against it (the Swift menubar
    # advertises only 3.3.0), but a pre-3.6.0 client that *wants* the
    # tree cannot be served one at any floor — the addresses it listens
    # on no longer exist.
    #
    # 3.7.0 (2026-08-31) grows the T record 13 -> 14 fields (``role``),
    # which is an ordinary arity bump: an older UI under-reads T and
    # mis-tags the following record, so surface and UI ship together.


# --- PR-3b: accept drives state/full -------------------------------------


def test_accept_hook_fires_after_accept_emit(component, emits):
    """Per [04 §8.5]: after emitting accept, handshake calls the
    post-accept hook so the surface can fan out a state/full bundle."""
    hs, _gen = component
    calls: list[str] = []

    def hook():
        # Capture the ordering: emits should already contain the accept
        # reply by the time we're invoked — the UI sees accept *then*
        # state/full on the wire.
        calls.append("fired at emit_count=%d" % len(emits))

    hs.set_state_full_on_accept(hook)
    hs.handle_hello(("3.0.0",), ("127.0.0.1", 50000))
    assert len(calls) == 1
    # Accept is already in emits when the hook fires.
    assert calls[0] == "fired at emit_count=1"
    assert emits[0][0] == V3_HANDSHAKE_ACCEPT_ADDRESS


def test_accept_hook_fires_on_every_accept(component, emits):
    """Cold-start and reconnect both go through handle_hello and both
    produce an accept — both must fire the hook. This is the core of
    why PR-3b eliminated the UI's reconnect-specific resync."""
    hs, _gen = component
    count = [0]

    def hook():
        count[0] += 1

    hs.set_state_full_on_accept(hook)
    hs.handle_hello(("3.0.0",), None)  # cold-start
    hs.handle_hello(("3.0.0",), None)  # reconnect
    assert count[0] == 2


def test_accept_hook_not_fired_on_version_mismatch(component, emits):
    """No accept → no hook. Version-mismatch sends an error reply and
    returns early; the hook has no state to deliver because the
    session never opened."""
    hs, _gen = component
    count = [0]
    hs.set_state_full_on_accept(lambda: count.__setitem__(0, count[0] + 1))
    hs.handle_hello(("2.0.0",), None)
    assert count[0] == 0


def test_accept_hook_not_fired_on_malformed_hello(component, emits):
    """Malformed hello → error reply, no accept, no hook fire."""
    hs, _gen = component
    count = [0]
    hs.set_state_full_on_accept(lambda: count.__setitem__(0, count[0] + 1))
    hs.handle_hello((), None)
    assert count[0] == 0


def test_missing_hook_logs_error_but_still_accepts(component, emits, caplog):
    """If LoopingSurface forgets to wire the hook, accept still works
    (session is minted, reply is sent) but the surface logs loudly so
    the wiring bug surfaces in the Log.txt."""
    import logging

    hs, _gen = component
    # Deliberately do NOT call set_state_full_on_accept.
    with caplog.at_level(logging.ERROR, logger="looping"):
        hs.handle_hello(("3.0.0",), None)
    # Accept still went out.
    assert emits[0][0] == V3_HANDSHAKE_ACCEPT_ADDRESS
    # And we logged the wiring bug.
    assert any("accept hook not wired" in rec.message for rec in caplog.records)


def test_hook_exception_swallowed(component, emits):
    """A broken hook must not break accept — the session is still
    valid, the UI just lacks the tree and can fall back to a manual
    state/resync."""
    hs, _gen = component

    def broken():
        raise RuntimeError("hook boom")

    hs.set_state_full_on_accept(broken)
    # Must not raise.
    hs.handle_hello(("3.0.0",), None)
    # Accept still landed on the wire.
    assert emits[0][0] == V3_HANDSHAKE_ACCEPT_ADDRESS


def test_disconnected_component_does_not_fire_hook(component, emits):
    """Disconnected handler is a no-op — no accept, no hook."""
    hs, _gen = component
    count = [0]
    hs.set_state_full_on_accept(lambda: count.__setitem__(0, count[0] + 1))
    hs.disconnect()
    hs.handle_hello(("3.0.0",), None)
    assert count[0] == 0
    assert emits == []
