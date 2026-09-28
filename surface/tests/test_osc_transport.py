"""OSC transport round-trip tests.

Exercises ``OSCTransport`` against a loopback peer socket to cover
the behaviour the surface's tick will rely on in Live: non-blocking
drain, reply routing, handler isolation, and lifecycle.

We bind two loopback sockets on ephemeral ports (``port=0``) rather
than on the production 11020/11021 pair — tests must not assume
those ports are free, and ephemeral binding is the standard pattern
for transport-layer tests.
"""

import socket
import time

import pytest

from osc_codec import decode_message, encode_message
from osc_transport import OSCTransport


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def transport_pair():
    """Two OSCTransports on ephemeral loopback ports.

    ``a`` is configured to send to ``b`` by default, and vice versa.
    The test decides which side plays "Live surface" and which plays
    "bridge."
    """
    # Bind both ends up front so each knows the other's real port.
    a_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    a_sock.bind(("127.0.0.1", 0))
    b_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    b_sock.bind(("127.0.0.1", 0))
    a_port = a_sock.getsockname()[1]
    b_port = b_sock.getsockname()[1]
    a_sock.close()
    b_sock.close()

    a = OSCTransport(
        local_addr=("127.0.0.1", a_port),
        remote_addr=("127.0.0.1", b_port),
        name="a",
    )
    b = OSCTransport(
        local_addr=("127.0.0.1", b_port),
        remote_addr=("127.0.0.1", a_port),
        name="b",
    )
    try:
        yield a, b
    finally:
        a.close()
        b.close()


def _drain_with_retry(transport, expected_count=1, timeout=0.5):
    """Poll until ``expected_count`` messages have been drained or timeout.

    UDP on loopback is ~instant but not synchronous; a tight
    ``transport.poll()`` right after ``send()`` can legitimately see
    zero messages on a slow machine. Tests should not be flaky.
    """
    deadline = time.monotonic() + timeout
    total = 0
    while total < expected_count and time.monotonic() < deadline:
        total += transport.poll()
        if total < expected_count:
            time.sleep(0.005)
    return total


# --- round trip ------------------------------------------------------------


def test_send_and_drain_single_message(transport_pair):
    a, b = transport_pair
    received = []
    b.add_handler("/live/test", lambda args, src: received.append(args) or None)

    a.send("/live/test", ("hello",))

    drained = _drain_with_retry(b, expected_count=1)
    assert drained == 1
    assert received == [["hello"]]


def test_handler_reply_routes_back_to_sender(transport_pair):
    a, b = transport_pair
    # ``b`` echoes, ``a`` collects the echo.
    b.add_handler("/live/test", lambda args, src: ("ok",))
    echoes = []
    a.add_handler("/live/test", lambda args, src: echoes.append(args) or None)

    a.send("/live/test", ("probe",))
    _drain_with_retry(b, expected_count=1)
    # ``b``'s handler sent a reply; now ``a`` drains it.
    _drain_with_retry(a, expected_count=1)

    assert echoes == [["ok"]]


def test_handler_none_reply_does_not_send(transport_pair):
    a, b = transport_pair
    b.add_handler("/live/test", lambda args, src: None)
    # Nothing in ``a``'s handler map; any stray reply would log a
    # "no handler" warning and be visible.
    a.send("/live/test", ("probe",))
    _drain_with_retry(b, expected_count=1)

    assert a.poll() == 0


def test_drains_multiple_messages_in_one_poll(transport_pair):
    a, b = transport_pair
    received = []
    b.add_handler("/live/test", lambda args, src: received.append(args) or None)

    for i in range(5):
        a.send("/live/test", (i,))

    drained = _drain_with_retry(b, expected_count=5)
    assert drained == 5
    assert received == [[0], [1], [2], [3], [4]]


# --- error paths -----------------------------------------------------------


def test_unknown_address_does_not_crash(transport_pair):
    a, b = transport_pair
    # ``b`` has no handlers; sending something shouldn't crash the poll.
    a.send("/not/registered", ("x",))
    # Dropped gracefully; drain returns 1 (the message was received
    # and parsed, just had no handler).
    assert _drain_with_retry(b, expected_count=1) == 1


def test_handler_exception_does_not_break_subsequent_messages(transport_pair):
    a, b = transport_pair

    def bad_handler(args, src):
        raise RuntimeError("intentional test failure")

    b.add_handler("/live/test", bad_handler)
    received = []
    b.add_handler("/other", lambda args, src: received.append(args) or None)

    a.send("/live/test", ("first",))  # will raise inside handler
    a.send("/other", ("second",))  # must still be delivered

    _drain_with_retry(b, expected_count=2)
    assert received == [["second"]]


def test_duplicate_handler_registration_raises(transport_pair):
    a, _ = transport_pair
    a.add_handler("/x", lambda args, src: None)
    with pytest.raises(ValueError):
        a.add_handler("/x", lambda args, src: None)


def test_non_tuple_reply_is_dropped(transport_pair, caplog):
    a, b = transport_pair
    # Handler returns a list instead of a tuple — easy bug, must not
    # silently send garbage.
    b.add_handler("/live/test", lambda args, src: ["ok"])
    a.send("/live/test", ("probe",))
    _drain_with_retry(b, expected_count=1)

    # ``a`` should not have received anything.
    assert a.poll() == 0


def test_garbage_bytes_are_dropped(transport_pair):
    a, b = transport_pair
    b.add_handler("/live/test", lambda args, src: None)
    # Send raw non-OSC bytes by reaching past the transport's encoder.
    raw_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    raw_sock.sendto(b"this is not an OSC message", b._local_addr)
    raw_sock.close()
    # The message shows up on the wire and gets drained, but decoding
    # fails and the handler never fires. Drain count == 1, no crash.
    assert _drain_with_retry(b, expected_count=1) == 1


# --- lifecycle -------------------------------------------------------------


def test_close_is_idempotent(transport_pair):
    a, _ = transport_pair
    a.close()
    a.close()  # must not raise


def test_send_after_close_does_not_crash(transport_pair):
    a, b = transport_pair
    a.close()
    a.send("/live/test", ("probe",))  # logs warning, does not raise
    # ``b`` received nothing.
    assert _drain_with_retry(b, expected_count=1, timeout=0.1) == 0


def test_poll_after_close_returns_zero(transport_pair):
    a, _ = transport_pair
    a.close()
    assert a.poll() == 0


# --- default reply target is fixed, not last-sender -----------------------


def test_default_remote_addr_fixed_after_receive(transport_pair):
    """``_remote_addr`` must NOT auto-update from the last sender.

    The old AbletonOSC-style "last-sender wins" caused the foot-pedal
    freeze: a fire-and-forget tap from an ephemeral source port would
    redirect every subsequent meter/heartbeat emit to that dead port.
    Handlers that need to reply to a specific asker use the
    ``remote_addr`` parameter on ``send()`` — see the ``_dispatch``
    auto-reply path.
    """
    a, b = transport_pair
    # Record ``b``'s default reply target before any receive.
    original_default = b._remote_addr

    c = OSCTransport(
        local_addr=("127.0.0.1", 0),
        remote_addr=("127.0.0.1", b._local_addr[1]),
        name="c",
    )
    try:
        received_by_c = []
        c.add_handler("/pong", lambda args, src: received_by_c.append(args) or None)

        def pong(args, src):
            # Reply to whoever asked, not to ``b``'s default.
            b.send("/pong", ("from_b",), remote_addr=src)
            return None

        b.add_handler("/ping", pong)
        c.send("/ping", ())
        _drain_with_retry(b, expected_count=1)
        _drain_with_retry(c, expected_count=1)

        assert received_by_c == [["from_b"]]
        # ``b``'s default is unchanged — no last-sender clobber.
        assert b._remote_addr == original_default
    finally:
        c.close()


# --- drain hooks (ADR-428) ---------------------------------------------------


def test_drain_hook_runs_once_per_pass_that_dispatched(transport_pair):
    a, b = transport_pair
    b.add_handler("/live/test", lambda args, src: None)
    runs = []
    b.add_drain_hook(lambda: runs.append(len(runs)))

    assert b.poll() == 0          # nothing queued → hook not run
    assert runs == []

    for i in range(3):
        a.send("/live/test", (i,))
    drained = _drain_with_retry(b, expected_count=3)
    assert drained == 3
    # One pass may have picked up all three or split them; either way the
    # hook ran once per pass that dispatched something, never per message.
    assert 1 <= len(runs) <= 3


def test_raising_drain_hook_does_not_stop_the_others(transport_pair):
    a, b = transport_pair
    b.add_handler("/live/test", lambda args, src: None)
    order = []

    def boom():
        order.append("boom")
        raise RuntimeError("hook failed")

    b.add_drain_hook(boom)
    b.add_drain_hook(lambda: order.append("after"))
    a.send("/live/test", ("x",))
    _drain_with_retry(b, expected_count=1)
    assert order == ["boom", "after"]


def test_drain_hook_must_be_callable(transport_pair):
    _a, b = transport_pair
    with pytest.raises(TypeError):
        b.add_drain_hook("not-callable")
