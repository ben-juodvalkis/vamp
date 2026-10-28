"""TCP transport tests — framing, streaming, and failure handling.

Exercises ``TCPTransport`` against a real loopback peer. The whole
point of this transport is that it removes the 9,216-byte darwin UDP
ceiling that every piece of chunking machinery in this tree exists to
work around, so the tests that matter most are the ones proving a
payload far past that ceiling arrives whole and in order.

The stream-specific hazards, none of which UDP had:

- a frame can arrive split across several ``recv`` calls, or several
  frames can arrive in one
- a non-blocking ``send`` can accept only part of a buffer, so unsent
  bytes have to survive to the next pump
- a corrupt length prefix desynchronises the stream permanently, since
  every subsequent offset is then wrong
- a peer that stops reading would grow the outbox without bound
"""

import socket
import struct
import time

import pytest

from osc_codec import encode_message
from tcp_transport import (
    HEADER_BYTES,
    MAX_FRAME_BYTES,
    MAX_OUTBOX_BYTES,
    TCPTransport,
)


# ``decode_message`` returns args as a ``list`` (see its docstring), so
# handlers receive lists and the assertions below compare against lists
# even where the send side passes tuples.


def _frame(address, args=()):
    """Build one wire frame the way a peer would."""
    payload = encode_message(address, args)
    return struct.pack(">I", len(payload)) + payload


def _pump_until(transport, done, timeout=5.0):
    """Poll until ``done()`` or the deadline.

    Loopback delivery is asynchronous — a peer's ``sendall`` returning
    does not mean the bytes are readable yet. Pumping until the
    expected state arrives makes the race impossible rather than
    unlikely, and mirrors how Live actually drives this (repeated
    pumps, not one).
    """
    deadline = time.monotonic() + timeout
    while True:
        transport.poll()
        if done():
            return
        if time.monotonic() > deadline:
            raise AssertionError("condition not met within %.1fs" % timeout)
        time.sleep(0.001)


@pytest.fixture
def transport():
    t = TCPTransport(local_addr=("127.0.0.1", 0), name="test")
    yield t
    t.close()


@pytest.fixture
def peer(transport):
    """A connected client socket, with the transport's accept done."""
    sock = socket.create_connection(transport.local_addr)
    _pump_until(transport, lambda: transport.connected)
    yield sock
    try:
        sock.close()
    except OSError:
        pass


#: What ``pinned_peer`` asks the kernel for, on each end of the path.
#: Smaller is not better: at 16 KB macOS drains the 2 MB carry-over in
#: up to 1.5 s against 0.16 s at this size (30 runs each, 2026-09-25).
_PINNED_BUFFER_BYTES = 64 * 1024


@pytest.fixture
def pinned_peer(transport):
    """A connected peer with the kernel's buffering on the way to it pinned.

    For the back-pressure tests, which need a peer that is not reading
    to back the transport up. How much the kernel takes before that
    happens is its own call, and measured 2026-09-25 with nothing
    pinned it varies too much to test against:

    - Linux sizes an accepted loopback socket's send buffer from the
      64 KB loopback MSS, 2,626,560 bytes, so a 2 MB send goes out
      whole and nothing carries over. On a host whose ``tcp_wmem``
      default is 4 MB it takes ~4 MB, more than the overflow test's
      four spare frames, and the outbox never reaches its cap.
    - macOS takes 1.45 MB of the 2 MB send and 3.31 MB of the overflow
      test's frames, so that test tripped on its twelfth and last.

    Setting a size switches the kernel's autotuning off, so what it
    reads back afterwards bounds what it takes (``_kernel_holds``).
    The peer's receive buffer is set before ``connect``: the window it
    advertises is fixed at the handshake, and set after it Linux takes
    more than the sizes it reports. Linux doubles both requests (128 KB
    each, so 262,144 bytes all told); macOS keeps the send buffer and
    raises the receive buffer to 342,972 (408,508 all told). The tests'
    payloads are megabytes.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, _PINNED_BUFFER_BYTES)
    sock.connect(transport.local_addr)
    _pump_until(transport, lambda: transport.connected)
    transport._conn.setsockopt(
        socket.SOL_SOCKET, socket.SO_SNDBUF, _PINNED_BUFFER_BYTES,
    )
    yield sock
    try:
        sock.close()
    except OSError:
        pass


def _kernel_holds(transport, peer):
    """Bytes the kernel can hold between the transport and a stalled peer.

    The transport's send buffer plus the peer's receive buffer, as the
    kernel reports them — an upper bound only once ``pinned_peer`` has
    set both.
    """
    return (
        transport._conn.getsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF)
        + peer.getsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF)
    )


# --- connection ------------------------------------------------------------


def test_starts_unconnected(transport):
    assert transport.connected is False
    assert transport.local_addr[1] != 0, "must report the bound port"


def test_accepts_a_peer(transport, peer):
    assert transport.connected is True
    assert transport.stats()["connects"] == 1


def test_a_second_dial_replaces_the_first(transport, peer):
    """There is only ever one bridge.

    A second dial means the first is a corpse the kernel hasn't reaped
    — common after a hard bridge restart — so newest wins rather than
    queueing behind a dead socket.
    """
    second = socket.create_connection(transport.local_addr)
    try:
        _pump_until(transport, lambda: transport.stats()["connects"] == 2)
        assert transport.connected is True
        assert transport.stats()["drops"] >= 1
    finally:
        second.close()


def test_peer_close_is_noticed(transport, peer):
    peer.close()
    _pump_until(transport, lambda: not transport.connected)
    assert transport.connected is False


def test_poll_on_a_closed_transport_returns_zero(transport):
    transport.close()
    assert transport.poll() == 0


def test_close_is_idempotent(transport):
    transport.close()
    transport.close()


# --- receive ---------------------------------------------------------------


def test_dispatches_a_frame(transport, peer):
    seen = []
    transport.add_handler("/x", lambda args, addr: seen.append(args) or None)

    peer.sendall(_frame("/x", (42,)))
    _pump_until(transport, lambda: seen)

    assert seen == [[42]]


def test_several_frames_in_one_write_arrive_in_order(transport, peer):
    seen = []
    transport.add_handler("/x", lambda args, addr: seen.append(args[0]) or None)

    peer.sendall(b"".join(_frame("/x", (i,)) for i in range(20)))
    _pump_until(transport, lambda: len(seen) == 20)

    assert seen == list(range(20))


def test_a_frame_split_across_writes_is_reassembled(transport, peer):
    """The core stream hazard UDP never had."""
    seen = []
    transport.add_handler("/x", lambda args, addr: seen.append(args) or None)

    blob = _frame("/x", ("hello world",))
    for i in range(0, len(blob), 3):
        peer.sendall(blob[i:i + 3])
        transport.poll()  # pump mid-frame; must not dispatch a partial
        assert seen == [] or i + 3 >= len(blob)
    _pump_until(transport, lambda: seen)

    assert seen == [["hello world"]]


def test_a_partial_header_is_held(transport, peer):
    """Fewer than 4 bytes cannot even be length-decoded."""
    seen = []
    transport.add_handler("/x", lambda args, addr: seen.append(args) or None)

    blob = _frame("/x", (1,))
    peer.sendall(blob[:2])
    for _ in range(5):
        transport.poll()
    assert seen == []

    peer.sendall(blob[2:])
    _pump_until(transport, lambda: seen)
    assert seen == [[1]]


def test_payload_far_past_the_udp_ceiling_arrives_whole(transport, peer):
    """The entire reason this transport exists.

    A darwin UDP datagram tops out at 9,216 bytes, which is why
    ``state/full`` ships as ~99 chunks with a checksum and a
    reassembler. One frame, no chunking, no checksum.
    """
    seen = []
    transport.add_handler("/big", lambda args, addr: seen.append(args) or None)

    payload = "x" * 400_000  # ~ one realistic state/full bundle
    peer.sendall(_frame("/big", (payload,)))
    _pump_until(transport, lambda: seen, timeout=10.0)

    assert len(seen[0][0]) == 400_000
    assert seen[0][0] == payload


def test_an_unknown_address_is_logged_not_fatal(transport, peer):
    seen = []
    transport.add_handler("/known", lambda args, addr: seen.append(args) or None)

    peer.sendall(_frame("/unknown", (1,)))
    peer.sendall(_frame("/known", (2,)))
    _pump_until(transport, lambda: seen)

    assert seen == [[2]], "the stream stays in sync past an unknown address"


def test_a_raising_handler_does_not_desync_the_stream(transport, peer):
    """One bad handler must not cost the frames behind it."""
    seen = []

    def handler(args, addr):
        if args[0] == 1:
            raise RuntimeError("boom")
        seen.append(args[0])
        return None

    transport.add_handler("/x", handler)
    peer.sendall(_frame("/x", (1,)) + _frame("/x", (2,)))
    _pump_until(transport, lambda: seen)

    assert seen == [2]
    assert transport.connected is True


def test_an_oversized_length_prefix_drops_the_connection(transport, peer):
    """A stream cannot resynchronise past a corrupt length.

    Every subsequent offset would be wrong, so the only honest recovery
    is to drop and let the peer redial clean.
    """
    peer.sendall(struct.pack(">I", MAX_FRAME_BYTES + 1) + b"junk")
    _pump_until(transport, lambda: not transport.connected)

    assert transport.connected is False


def test_undecodable_payload_keeps_the_connection(transport, peer):
    """Distinct from a corrupt length: framing was fine, the codec
    disagreed. The stream is still in sync, so keep it."""
    seen = []
    transport.add_handler("/x", lambda args, addr: seen.append(args) or None)

    peer.sendall(struct.pack(">I", 5) + b"\x00\x01\x02\x03\x04")
    peer.sendall(_frame("/x", (7,)))
    _pump_until(transport, lambda: seen)

    assert seen == [[7]]
    assert transport.connected is True


# --- send ------------------------------------------------------------------


def test_send_reaches_the_peer(transport, peer):
    assert transport.send("/reply", ("ok",)) is True
    transport.poll()

    peer.settimeout(5.0)
    header = peer.recv(HEADER_BYTES)
    (length,) = struct.unpack(">I", header)
    body = b""
    while len(body) < length:
        body += peer.recv(length - len(body))
    assert body == encode_message("/reply", ("ok",))


def test_send_with_no_peer_is_dropped_not_raised(transport):
    """Matches UDP-with-no-listener: the bridge redials and resyncs."""
    assert transport.send("/x", (1,)) is False
    assert transport.stats()["droppedFrames"] == 1


def test_a_handler_reply_goes_back_to_the_peer(transport, peer):
    transport.add_handler("/ping", lambda args, addr: ("pong",))

    peer.sendall(_frame("/ping"))
    peer.settimeout(5.0)
    _pump_until(transport, lambda: transport.stats()["framesOut"] >= 1)

    header = peer.recv(HEADER_BYTES)
    (length,) = struct.unpack(">I", header)
    body = b""
    while len(body) < length:
        body += peer.recv(length - len(body))
    assert body == encode_message("/ping", ("pong",))


def test_a_large_send_carries_over_across_pumps(transport, pinned_peer):
    """The one real difference between a stream and a datagram.

    A non-blocking ``send`` can accept part of a buffer; the remainder
    must survive to the next pump. Forced here by not reading from the
    peer until the kernel buffer is full.
    """
    big = "y" * 2_000_000
    expected = HEADER_BYTES + len(encode_message("/big", (big,)))
    holds = _kernel_holds(transport, pinned_peer)
    assert expected > 2 * holds, (
        f"the kernel can hold {holds} bytes of a {expected}-byte frame"
    )
    assert transport.send("/big", (big,)) is True

    # With nobody reading, the outbox cannot have drained fully.
    assert transport.stats()["pendingOut"] > 0

    received = bytearray()
    pinned_peer.settimeout(0.05)
    deadline = time.monotonic() + 15.0
    while len(received) < expected and time.monotonic() < deadline:
        transport.poll()  # each pump pushes more of the carry-over
        try:
            chunk = pinned_peer.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        received += chunk

    assert len(received) == expected
    assert transport.stats()["pendingOut"] == 0


def test_outbox_overflow_drops_the_connection(transport, pinned_peer):
    """A peer that stopped reading is already broken.

    Dropping it is recoverable — it redials and resyncs — where growing
    the buffer until Live dies is not.
    """
    blob = "z" * 1_000_000
    # Frames past the cap, to cover what the kernel takes first.
    spare = 4
    holds = _kernel_holds(transport, pinned_peer)
    assert 2 * holds < spare * len(blob), (
        f"the kernel can hold {holds} bytes, too much for {spare} spare frames"
    )
    # Never read from the peer, so the kernel buffer fills and the outbox
    # grows until it trips the cap.
    for _ in range(MAX_OUTBOX_BYTES // len(blob) + spare):
        if not transport.send("/flood", (blob,)):
            break

    assert transport.connected is False
    assert transport.stats()["pendingOut"] == 0


# --- interleaving ----------------------------------------------------------


def test_reentrant_poll_does_not_double_dispatch(transport, peer):
    """Two pumps drive this, exactly as with the UDP transport."""
    seen = []

    def handler(args, addr):
        seen.append(args[0])
        transport.poll()  # re-enter
        return None

    transport.add_handler("/x", handler)
    peer.sendall(b"".join(_frame("/x", (i,)) for i in (1, 2, 3)))
    _pump_until(transport, lambda: len(seen) >= 3)

    assert sorted(seen) == [1, 2, 3], "each frame dispatched exactly once"
    assert transport.drain_skips >= 1, "the re-entrant poll must be refused"


def test_stats_shape(transport):
    stats = transport.stats()
    assert set(stats) == {
        "connected", "peer", "framesIn", "framesOut", "bytesOut",
        "pendingOut", "connects", "drops", "droppedFrames",
        "drainSkips", "lastError",
    }


def test_duplicate_handler_registration_is_refused(transport):
    transport.add_handler("/x", lambda a, b: None)
    with pytest.raises(ValueError):
        transport.add_handler("/x", lambda a, b: None)


# --- routed through the UDP transport (ADR-489) ----------------------------
#
# The bridge sends every message over this leg while it is connected, so
# the leg dispatches through ``OSCTransport``'s one handler table and drain
# hooks. A real ``OSCTransport`` on an ephemeral port is the router, so the
# tests prove the wiring ``LoopingSurface`` uses, not a stand-in for it.


@pytest.fixture
def udp():
    from osc_transport import OSCTransport

    t = OSCTransport(
        local_addr=("127.0.0.1", 0), remote_addr=("127.0.0.1", 1), name="udp",
    )
    yield t
    t.close()


@pytest.fixture
def routed(udp):
    t = TCPTransport(local_addr=("127.0.0.1", 0), name="routed", router=udp)
    yield t
    t.close()


@pytest.fixture
def routed_peer(routed):
    sock = socket.create_connection(routed.local_addr)
    _pump_until(routed, lambda: routed.connected)
    yield sock
    try:
        sock.close()
    except OSError:
        pass


def _read_frame(sock):
    sock.settimeout(5.0)
    header = b""
    while len(header) < HEADER_BYTES:
        header += sock.recv(HEADER_BYTES - len(header))
    (length,) = struct.unpack(">I", header)
    body = b""
    while len(body) < length:
        body += sock.recv(length - len(body))
    return body


def test_a_frame_reaches_the_udp_transports_handler(udp, routed, routed_peer):
    """One table: a handler registered on the UDP port hears the stream."""
    seen = []
    udp.add_handler("/looping/v3/handshake/hello", lambda a, s: seen.append(a) or None)

    routed_peer.sendall(_frame("/looping/v3/handshake/hello", ("3.12.0",)))
    _pump_until(routed, lambda: seen)

    assert seen == [["3.12.0"]]


def test_frames_dispatch_in_the_order_sent(udp, routed, routed_peer):
    """Ordered delivery is the point: a burst lands as it was sent."""
    seen = []
    udp.add_handler("/x", lambda a, s: seen.append(a[0]) or None)

    routed_peer.sendall(b"".join(_frame("/x", (i,)) for i in range(50)))
    _pump_until(routed, lambda: len(seen) >= 50)

    assert seen == list(range(50))


def test_a_routed_reply_goes_back_on_the_stream(udp, routed, routed_peer):
    """A tuple reply returns on the leg the request came in on."""
    udp.add_handler("/live/test", lambda a, s: ("ok",))

    routed_peer.sendall(_frame("/live/test"))
    _pump_until(routed, lambda: routed.stats()["framesOut"] >= 1)

    assert _read_frame(routed_peer) == encode_message("/live/test", ("ok",))


def test_a_pass_that_dispatched_runs_the_drain_hooks(udp, routed, routed_peer):
    """The drum fan-out applies from a drain hook (ADR-428); a write
    that came over the stream must not sit queued until a datagram
    happens to arrive."""
    calls = []
    udp.add_handler("/x", lambda a, s: calls.append("handler") or None)
    udp.add_drain_hook(lambda: calls.append("hook"))

    routed_peer.sendall(_frame("/x", (1,)) + _frame("/x", (2,)))
    _pump_until(routed, lambda: calls.count("handler") >= 2 and "hook" in calls)

    assert calls[-1] == "hook", "hooks run after the pass's handlers"


def test_an_empty_pass_runs_no_drain_hooks(udp, routed, routed_peer):
    hooks = []
    udp.add_drain_hook(lambda: hooks.append(1))

    for _ in range(5):
        routed.poll()

    assert hooks == []


def test_a_routed_unknown_address_is_not_fatal(udp, routed, routed_peer):
    seen = []
    udp.add_handler("/known", lambda a, s: seen.append(a) or None)

    routed_peer.sendall(_frame("/unknown") + _frame("/known", (1,)))
    _pump_until(routed, lambda: seen)

    assert routed.connected is True
    assert seen == [[1]]


def test_a_routed_raising_handler_keeps_the_stream(udp, routed, routed_peer):
    seen = []

    def boom(args, src):
        raise RuntimeError("handler bug")

    udp.add_handler("/boom", boom)
    udp.add_handler("/after", lambda a, s: seen.append(a) or None)

    routed_peer.sendall(_frame("/boom") + _frame("/after", (7,)))
    _pump_until(routed, lambda: seen)

    assert routed.connected is True
    assert seen == [[7]]
