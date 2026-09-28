"""Length-prefixed TCP transport for the Python Control Surface.

Why TCP at all
--------------

Every piece of framing machinery this surface owns exists because a
darwin UDP datagram cannot exceed 9,216 bytes. ``state/full`` is
389 KB on a realistic set (20 tracks x 4 heavy devices), so it ships
as 99 chunks wrapped in a ``begin -> chunk... -> end`` envelope, with
an FNV-1a checksum so the UI can tell a torn bundle from a whole one,
and a reassembler on the far side to put it back together. Ordered,
unbounded delivery makes all of that deletable.

Only the bridge<->surface leg moves. The UI's connection model is
untouched: the bridge stays, because it owns TotalMix, the AX click
handler, Save As, four other OSC backends, and a 378-line audio
decode route. Between two of our own processes on loopback there is
no reason to pay for WebSocket framing either — a 4-byte length
prefix is the whole protocol.

Threadless, deliberately
------------------------

Same idiom as ``osc_transport.py``: a non-blocking socket drained from
Live's pump, no background thread, no lock, no queue. AbletonOSC rolled
its own server because "pythonosc's OSC server causes a beachball" —
a blocking complaint, not a thread prohibition — and Ableton's own
``abl.webconnector`` does use ``threading.Thread`` inside Live. So
threads are probably *available*; they are just not *needed*, and the
version we don't have to reason about is the one that can't race a LOM
read.

The one piece of real work a stream adds over datagrams is the send
path: a non-blocking ``send`` can accept only part of a buffer, so
unsent bytes have to survive until the next pump.

Measured 2026-08-31, writing only from a pump at the surface's real
92.8 Hz rate: a 389 KB realistic bundle clears in **1 pump / 0.14 ms**,
and the 1.22 MB pathological case in 3 pumps / 24 ms — both well
inside one 99.4 ms Live tick. The migration plan had budgeted for a
~1 kHz pump and worried that 10 Hz would be marginal; at the actual
92.8 Hz the question doesn't arise, because the inner
drain-until-EAGAIN loop moves far more than one buffer per pump when
the reader is keeping up.

Wire format
-----------

    [4-byte big-endian unsigned length][OSC message bytes]

The payload is exactly what ``osc_codec.encode_message`` already
produces, so this is a transport swap and not a codec change. Length
is of the payload only.

Connection model
----------------

One peer: the bridge. The surface listens; the bridge dials in and
redials after a Live restart. A second connection replaces the first
rather than being queued — there is only ever one bridge, so a second
dial means the first is a corpse the kernel hasn't reaped.

"Newest wins" would thrash if two live bridges ever dialled at once,
each displacing the other forever. That configuration is already
broken for a different reason — only one process can bind the UDP
side's port 11021 — so this does not defend against it, but the
symptom is worth recognising: a repeating connect/drop pair in
Log.txt with no Live restart between them.
"""

import errno
import logging
import socket
import struct
import threading
import traceback

try:
    from .osc_codec import (
        OSCDecodeError,
        UnsupportedOSCType,
        decode_message,
        encode_message,
    )
except ImportError:
    from osc_codec import (
        OSCDecodeError,
        UnsupportedOSCType,
        decode_message,
        encode_message,
    )

try:
    from . import perf_profiler
except ImportError:
    import perf_profiler  # type: ignore[no-redef]

logger = logging.getLogger("looping")

#: Frame header: big-endian uint32 payload length.
_HEADER = struct.Struct(">I")
HEADER_BYTES = _HEADER.size

#: Reject an inbound frame claiming to be larger than this.
#:
#: A corrupt or hostile length prefix would otherwise have us buffer
#: toward 4 GiB inside Live's process. The largest thing we legitimately
#: send is the pathological ``state/full`` at ~1.2 MB, so 16 MB is a
#: generous ceiling that still fails fast on nonsense.
MAX_FRAME_BYTES = 16 * 1024 * 1024

#: Drop the connection rather than buffer more than this outbound.
#:
#: Unbounded delivery is the point of TCP, but "unbounded" must not mean
#: "grows until Live dies". A peer that has stopped reading is already
#: broken; dropping it frees the memory and lets it redial, which is a
#: recoverable state. Sized for several whole pathological bundles.
MAX_OUTBOX_BYTES = 8 * 1024 * 1024

#: How much to ask for per ``recv``.
_RECV_CHUNK = 65536


class TCPTransport:
    """Non-blocking length-prefixed TCP server, pumped from Live's tick.

    Mirrors ``OSCTransport``'s surface — ``add_handler`` / ``send`` /
    ``poll`` / ``close`` — so callers can be moved across one address
    at a time without learning a second shape.

    Args:
        local_addr: ``(host, port)`` to listen on.
        name: Log-prefix string. Defaults to ``"tcp"``.
    """

    def __init__(self, local_addr, name="tcp", on_connect=None):
        self._local_addr = local_addr
        self._name = name
        # Fired once per accepted peer, after the connection is live.
        #
        # This is what lets a stream-only publisher be safe. Over UDP a
        # message sent with nobody listening was simply lost, and that
        # was survivable because the next LOM change would resend. A
        # bundle that can *only* go over the stream has no such
        # backstop: if it is produced while the peer is redialling, the
        # UI ends up with a session and no tree until something
        # unrelated changes. Republishing on connect closes that window
        # rather than hoping it stays short.
        self._on_connect = on_connect

        self._listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._listener.setblocking(False)
        self._listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._listener.bind(self._local_addr)
        self._listener.listen(1)
        self._local_addr = self._listener.getsockname()

        self._conn = None
        self._peer = None
        self._inbox = bytearray()
        self._outbox = bytearray()

        self._handlers = {}
        self._closed = False

        # Same non-blocking re-entrancy guard as OSCTransport.poll —
        # two pumps call this (the fast Timer and the tick fallback),
        # and a second entrant must skip rather than interleave a
        # partial frame parse with the first.
        self._drain_lock = threading.Lock()
        self._drain_skips = 0

        # Diagnostics for /looping/probe/tcp_stats.
        self._frames_in = 0
        self._frames_out = 0
        self._bytes_out = 0
        self._connects = 0
        self._drops = 0
        self._dropped_frames = 0
        self._last_error = ""

        logger.info(
            "%s transport listening on %s", self._name, self._local_addr,
        )

    # --- registration ------------------------------------------------------

    def add_handler(self, address, handler):
        """Register a handler for an exact OSC address.

        ``handler(args, source_addr) -> Optional[tuple]``. A non-None
        return is sent back as an OSC message with the same address.
        """
        if address in self._handlers:
            raise ValueError("TCP handler already registered for %r" % address)
        self._handlers[address] = handler

    def clear_handlers(self):
        self._handlers = {}

    # --- properties --------------------------------------------------------

    @property
    def local_addr(self):
        return self._local_addr

    @property
    def connected(self):
        return self._conn is not None

    @property
    def drain_skips(self):
        return self._drain_skips

    def stats(self):
        return {
            "connected": 1 if self._conn is not None else 0,
            "peer": "%s:%d" % self._peer if self._peer else "",
            "framesIn": self._frames_in,
            "framesOut": self._frames_out,
            "bytesOut": self._bytes_out,
            "pendingOut": len(self._outbox),
            "connects": self._connects,
            "drops": self._drops,
            "droppedFrames": self._dropped_frames,
            "drainSkips": self._drain_skips,
            "lastError": self._last_error,
        }

    # --- send --------------------------------------------------------------

    def send(self, address, args=(), remote_addr=None):
        """Encode and queue an OSC message; flush what the socket takes.

        ``remote_addr`` is accepted and ignored so this is signature-
        compatible with ``OSCTransport.send``. A stream has exactly one
        peer — there is nowhere else to send it.

        Returns True if the frame was queued. False means it was
        dropped, and the reason is logged: no peer connected, an
        encode failure, or a backed-up outbox.
        """
        if self._closed:
            logger.warning("%s send on closed transport: %s", self._name, address)
            return False
        if self._conn is None:
            # Not an error worth a stack trace: the bridge redials after
            # a restart, and anything emitted in that window is simply
            # lost — exactly as it was over UDP with no listener.
            self._dropped_frames += 1
            logger.debug(
                "%s send with no peer, dropping: %s", self._name, address,
            )
            return False

        try:
            payload = encode_message(address, args)
        except (TypeError, ValueError, OverflowError) as e:
            logger.error(
                "%s encode failed for %s %r: %s", self._name, address, args, e,
            )
            return False

        if len(self._outbox) + HEADER_BYTES + len(payload) > MAX_OUTBOX_BYTES:
            # The peer has stopped reading. Dropping it is recoverable —
            # it redials and resyncs — where growing the buffer is not.
            logger.error(
                "%s outbox over %d bytes with peer %s; dropping connection",
                self._name, MAX_OUTBOX_BYTES, self._peer,
            )
            self._drop_connection("outbox overflow")
            return False

        self._outbox += _HEADER.pack(len(payload))
        self._outbox += payload
        self._frames_out += 1
        perf_profiler.record_send(address, args)
        self._flush()
        return True

    def _flush(self):
        """Push as much of the outbox as the socket will take.

        Stops on EAGAIN and leaves the remainder for the next pump —
        that carry-over is the only real difference between a stream
        and a datagram here.
        """
        if self._conn is None or not self._outbox:
            return
        while self._outbox:
            try:
                sent = self._conn.send(self._outbox)
            except OSError as e:
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    return  # kernel buffer full; resume next pump
                if e.errno == errno.EINTR:
                    continue
                self._last_error = "send: %s" % e
                logger.warning(
                    "%s send failed (%s); dropping connection", self._name, e,
                )
                self._drop_connection("send error")
                return
            if sent == 0:
                self._drop_connection("send returned 0")
                return
            del self._outbox[:sent]
            self._bytes_out += sent

    # --- receive -----------------------------------------------------------

    def poll(self):
        """Accept, read, dispatch, and flush. Returns frames dispatched.

        Call from Live's pump. Safe to interleave with a second pump:
        a concurrent or re-entrant call returns 0 rather than
        interleaving a partial frame parse.
        """
        if self._closed:
            return 0
        if not self._drain_lock.acquire(False):
            self._drain_skips += 1
            return 0
        try:
            self._accept_pending()
            count = self._read_and_dispatch()
            # Flush last: a handler may have queued a reply, and this
            # gets it onto the wire in the same pump rather than the
            # next one.
            self._flush()
            return count
        finally:
            self._drain_lock.release()

    def _accept_pending(self):
        """Take a pending connection, if any. Non-blocking."""
        while True:
            try:
                conn, peer = self._listener.accept()
            except OSError as e:
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    return
                if e.errno == errno.EINTR:
                    continue
                logger.error("%s accept failed: %s", self._name, e)
                return

            if self._conn is not None:
                # There is only ever one bridge, so a second dial means
                # the first is a corpse the kernel hasn't reaped yet
                # (common after a hard bridge restart). Newest wins.
                logger.info(
                    "%s replacing existing peer %s with %s",
                    self._name, self._peer, peer,
                )
                self._drop_connection("superseded")

            conn.setblocking(False)
            # Bundles go out as one burst of frames; Nagle would sit on
            # the tail waiting for an ACK that only matters on a WAN.
            try:
                conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError as e:  # pragma: no cover - platform dependent
                logger.warning("%s TCP_NODELAY failed: %s", self._name, e)
            self._conn = conn
            self._peer = peer
            self._inbox = bytearray()
            self._outbox = bytearray()
            self._connects += 1
            logger.info("%s peer connected: %s", self._name, peer)
            if self._on_connect is not None:
                try:
                    self._on_connect()
                except Exception as e:
                    # A failing hook must not cost us the connection we
                    # just accepted — the peer is live either way.
                    logger.error(
                        "%s on_connect hook raised: %s\n%s",
                        self._name, e, traceback.format_exc(),
                    )

    def _read_and_dispatch(self):
        """Drain the socket into the inbox and dispatch whole frames."""
        if self._conn is None:
            return 0

        while True:
            try:
                data = self._conn.recv(_RECV_CHUNK)
            except OSError as e:
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    break
                if e.errno == errno.EINTR:
                    continue
                if e.errno == errno.ECONNRESET:
                    logger.info(
                        "%s peer reset the connection: %s", self._name, self._peer,
                    )
                    self._drop_connection("peer reset")
                    return 0
                self._last_error = "recv: %s" % e
                logger.warning("%s recv failed: %s", self._name, e)
                self._drop_connection("recv error")
                return 0
            except Exception as e:  # pragma: no cover - defensive
                logger.error(
                    "%s recv unexpected error: %s\n%s",
                    self._name, e, traceback.format_exc(),
                )
                self._drop_connection("recv exception")
                return 0

            if not data:
                logger.info("%s peer closed: %s", self._name, self._peer)
                self._drop_connection("peer closed")
                return 0
            self._inbox += data

        return self._dispatch_frames()

    def _dispatch_frames(self):
        """Pull every complete frame out of the inbox and dispatch it."""
        count = 0
        while True:
            if len(self._inbox) < HEADER_BYTES:
                return count
            (length,) = _HEADER.unpack_from(self._inbox, 0)
            if length > MAX_FRAME_BYTES:
                # Can't resynchronise a stream once the length prefix is
                # nonsense — every subsequent offset is wrong too. Drop
                # the connection and let the peer redial clean.
                logger.error(
                    "%s frame claims %d bytes (max %d); dropping connection",
                    self._name, length, MAX_FRAME_BYTES,
                )
                self._drop_connection("oversized frame")
                return count
            if len(self._inbox) < HEADER_BYTES + length:
                return count  # partial frame; wait for the rest

            payload = bytes(self._inbox[HEADER_BYTES:HEADER_BYTES + length])
            del self._inbox[:HEADER_BYTES + length]
            self._frames_in += 1
            self._dispatch(payload)
            count += 1

    def _dispatch(self, payload):
        try:
            address, args = decode_message(payload)
        except UnsupportedOSCType as e:
            logger.warning("%s unsupported OSC type: %s", self._name, e)
            return
        except OSCDecodeError as e:
            # Unlike UDP, a decode failure here does not mean a bad
            # packet — the framing already guaranteed we have exactly
            # the bytes the peer sent. It means a codec disagreement,
            # which is worth noticing but is not a reason to tear down
            # a stream that is otherwise in sync.
            logger.warning(
                "%s decode failed from %s: %s (bytes=%r)",
                self._name, self._peer, e, payload[:64],
            )
            return

        perf_profiler.record_inbound(address)

        handler = self._handlers.get(address)
        if handler is None:
            logger.warning(
                "%s no handler for %s (from %s)", self._name, address, self._peer,
            )
            return

        try:
            reply = handler(args, self._peer)
        except Exception as e:
            logger.error(
                "%s handler for %s raised: %s\n%s",
                self._name, address, e, traceback.format_exc(),
            )
            return

        if reply is not None:
            if not isinstance(reply, tuple):
                logger.error(
                    "%s handler for %s returned non-tuple reply %r; "
                    "dropping (tuple required, use (x,) for 1-arg)",
                    self._name, address, reply,
                )
                return
            self.send(address, reply)

    # --- lifecycle ---------------------------------------------------------

    def _drop_connection(self, reason):
        """Close the peer socket and reset stream state.

        Buffers are discarded deliberately: a half-written frame cannot
        be resumed on a new connection, and a half-read one cannot be
        completed. The peer redials and the surface republishes.
        """
        conn, self._conn = self._conn, None
        peer, self._peer = self._peer, None
        self._inbox = bytearray()
        self._outbox = bytearray()
        if conn is None:
            return
        self._drops += 1
        self._last_error = reason
        try:
            conn.close()
        except OSError:
            pass
        logger.info("%s peer %s dropped: %s", self._name, peer, reason)

    def close(self):
        """Close the peer and the listener. Idempotent."""
        if self._closed:
            return
        self._closed = True
        self._drop_connection("transport closing")
        try:
            self._listener.close()
        except OSError as e:
            logger.warning("%s listener close error: %s", self._name, e)
        logger.info("%s transport closed", self._name)
