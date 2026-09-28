"""UDP OSC transport for the Python Control Surface.

Non-blocking UDP socket + synchronous drain loop. Designed to be
driven from Live's main-thread tick via ``ControlSurface.schedule_message``
— no background threads, no queue, no locking. This matches the
idiom AbletonOSC uses (see ``osc_server.py`` in that remote script);
Live's embedded Python does not tolerate socket threads well.

Handlers receive ``(args, source_addr)`` and may return an optional
``tuple`` reply, which is sent back to the source address on the
transport's configured response port. This mirrors AbletonOSC's
wildcard auto-reply pattern but without the wildcard (Gate 1 doesn't
need it; add when a caller does).

Exceptions raised by handlers are caught and logged at ERROR so a
bad packet cannot take down the tick. A handler that *must* see its
exception propagate should log + re-raise explicitly.

This module has no Live coupling and can be unit-tested against a
loopback socket pair. Lifecycle wiring into ``ControlSurface`` lives
in ``LoopingSurface.py``.
"""

import errno
import logging
import socket
import threading
import traceback

# Dual import: relative form for production (Live loads us as the
# ``Looping`` Remote Script package — absolute sibling names are not
# on ``sys.path``); absolute form for pytest, which inserts the
# package directory on ``sys.path`` and imports test targets flat.
# Tried moving tests into a package to unify this; not worth the
# churn for one import statement.
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

# Surface-side perf profiler. Both record_send / record_inbound are
# no-ops when ``LOOPING_SURFACE_PROFILE`` is unset, so the import is
# safe under Live's embedded Python with zero runtime cost.
try:
    from . import perf_profiler
except ImportError:
    import perf_profiler  # type: ignore[no-redef]

logger = logging.getLogger("looping")


class OSCTransport:
    """Non-blocking UDP OSC socket with a synchronous drain loop.

    Args:
        local_addr: ``(host, port)`` to bind for incoming. Use
            ``("127.0.0.1", 11020)`` for the surface's dedicated
            receive port.
        remote_addr: Default ``(host, port)`` for outgoing replies.
            The drain loop also updates this to the last sender's
            address, matching AbletonOSC's behaviour so a reply to a
            probe goes back to whoever sent it.
        name: Log-prefix string; lets multi-transport setups
            disambiguate in Log.txt. Defaults to ``"osc"``.
    """

    def __init__(self, local_addr, remote_addr, name="osc"):
        self._local_addr = local_addr
        self._remote_addr = remote_addr
        self._name = name

        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._socket.setblocking(False)
        # SO_REUSEADDR lets us rebind quickly after a hot-reload.
        # Without this, Live-side script reloads frequently trip
        # ``OSError: [Errno 48] Address already in use`` for several
        # seconds while the kernel holds the socket in TIME_WAIT.
        self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._socket.bind(self._local_addr)
        # If the caller passed port 0 (ephemeral — tests use this),
        # update ``_local_addr`` to the actually-bound port so
        # ``transport.local_addr`` is always correct.
        self._local_addr = self._socket.getsockname()

        self._handlers = {}
        self._closed = False
        # Drain mutual-exclusion. Two pumps now call ``poll()``: the
        # fast ``Live.Timer`` pump (sub-tick) and the ``_tick``
        # fallback. They are expected to share the control thread, so
        # this is really a *re-entrancy* guard rather than a
        # cross-thread one — but a non-blocking lock is correct under
        # both models for the same ~100ns, so we don't have to bet on
        # which thread Live fires the timer from.
        #
        # ``acquire(blocking=False)`` is the load-bearing detail: a
        # second entrant (same thread or not) fails to take the lock
        # and returns immediately instead of waiting. Waiting would be
        # wrong — a re-entrant caller that blocks on a lock its own
        # stack frame holds is a deadlock, and a concurrent caller
        # that blocks would just serialise two drains of the same
        # queue for no benefit. Skipping is always safe: whoever holds
        # the lock drains until EAGAIN, so nothing is left behind.
        self._drain_lock = threading.Lock()
        self._drain_skips = 0
        # ADR-428: callables run once at the end of every ``poll()`` that
        # dispatched at least one message, while the drain lock is still
        # held. A handler that wants to coalesce a burst of same-target
        # writes into one apply (the Drum Rack virtual-macro fan-out)
        # queues from its handler and applies from here, so N queued
        # sets for one target cost one apply per pass instead of N.
        self._drain_hooks = []

        logger.info(
            "%s transport bound on %s, default reply to %s",
            self._name, self._local_addr, self._remote_addr,
        )

    # --- registration ------------------------------------------------------

    def add_handler(self, address, handler):
        """Register a handler for an exact OSC address.

        ``handler(args, source_addr) -> Optional[tuple]``. A non-None
        return is sent back as an OSC message with the same address.
        """
        if address in self._handlers:
            # Silent overwrite would be a gift to future debuggers
            # only in the most ironic sense. Fail loud.
            raise ValueError("OSC handler already registered for %r" % address)
        self._handlers[address] = handler

    def clear_handlers(self):
        self._handlers = {}

    def add_drain_hook(self, hook):
        """Register ``hook()`` to run after each drain pass that dispatched
        ≥1 message. Hooks run in registration order, each guarded — one
        raising hook is logged and the rest still run."""
        if not callable(hook):
            raise TypeError("drain hook must be callable, got %r" % (hook,))
        self._drain_hooks.append(hook)

    # --- IO ----------------------------------------------------------------

    def send(self, address, args=(), remote_addr=None):
        """Encode and send an OSC message.

        Safe to call from any context that already holds the tick;
        do not call from a background thread — Live's embedded Python
        has trouble with concurrent socket use.
        """
        if self._closed:
            logger.warning("%s send on closed transport: %s", self._name, address)
            return
        try:
            datagram = encode_message(address, args)
        except (TypeError, ValueError, OverflowError) as e:
            logger.error(
                "%s encode failed for %s %r: %s",
                self._name, address, args, e,
            )
            return

        target = remote_addr if remote_addr is not None else self._remote_addr
        try:
            self._socket.sendto(datagram, target)
        except OSError as e:
            logger.error(
                "%s sendto %s failed for %s: %s",
                self._name, target, address, e,
            )
            return
        # Hot-path profile hook (no-op unless LOOPING_SURFACE_PROFILE=1).
        perf_profiler.record_send(address, args)

    def poll(self):
        """Drain all queued UDP packets and dispatch their handlers.

        Called from both drain pumps — the fast ``Live.Timer`` pump
        and the ``_tick`` fallback. Returns the number of messages
        drained (useful for tests and for logging bursty traffic).

        Safe to interleave: if another drain is already in progress
        this returns 0 immediately rather than double-dispatching.
        See ``_drain_lock`` in ``__init__`` for why non-blocking.
        """
        if self._closed:
            return 0
        if not self._drain_lock.acquire(False):
            # Someone else is mid-drain. They loop until EAGAIN, so
            # anything queued now is theirs to take — bailing out
            # cannot strand a packet, and re-entering would dispatch
            # the same handler twice.
            self._drain_skips += 1
            return 0
        try:
            count = self._drain()
            if count and self._drain_hooks:
                self._run_drain_hooks()
            return count
        finally:
            self._drain_lock.release()

    def _run_drain_hooks(self):
        for hook in self._drain_hooks:
            try:
                hook()
            except Exception as e:
                logger.error(
                    "%s drain hook %r raised: %s\n%s",
                    self._name, hook, e, traceback.format_exc(),
                )

    def _drain(self):
        """Inner drain loop. Caller must hold ``_drain_lock``."""
        count = 0
        while True:
            try:
                data, source_addr = self._socket.recvfrom(65536)
            except OSError as e:
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    # No more data — normal end-of-queue for a
                    # non-blocking socket. Not an error.
                    return count
                if e.errno == errno.ECONNRESET:
                    # AbletonOSC's osc_server.py treats this as a
                    # benign Windows-startup quirk; documenting the
                    # same here rather than silently suppressing it.
                    logger.warning(
                        "%s recvfrom ECONNRESET (benign): %s", self._name, e,
                    )
                    continue
                logger.error("%s recvfrom failed: %s", self._name, e)
                return count
            except Exception as e:  # pragma: no cover - defensive
                logger.error(
                    "%s recvfrom unexpected error: %s\n%s",
                    self._name, e, traceback.format_exc(),
                )
                return count

            # Do NOT auto-update ``_remote_addr`` from the last sender.
            # In our topology, the bridge lives at a fixed known port
            # (11021) and fire-and-forget senders (foot-pedal Max JS)
            # use ephemeral source ports. The "last-sender wins" pattern
            # AbletonOSC uses would then route meters/heartbeats to a
            # dead ephemeral port for every tap, causing the freeze.
            # Handlers that need to reply to a specific asker call
            # ``send(addr, args, remote_addr=source_addr)`` — see the
            # auto-reply path at the bottom of ``_dispatch``.

            self._dispatch(data, source_addr)
            count += 1

    def _dispatch(self, data, source_addr):
        try:
            address, args = decode_message(data)
        except UnsupportedOSCType as e:
            logger.warning("%s unsupported OSC type: %s", self._name, e)
            return
        except OSCDecodeError as e:
            logger.warning(
                "%s decode failed from %s: %s (bytes=%r)",
                self._name, source_addr, e, data[:64],
            )
            return

        # Inbound profile hook (no-op unless LOOPING_SURFACE_PROFILE=1).
        perf_profiler.record_inbound(address)

        handler = self._handlers.get(address)
        if handler is None:
            logger.warning(
                "%s no handler for %s (from %s)",
                self._name, address, source_addr,
            )
            return

        try:
            reply = handler(args, source_addr)
        except Exception as e:
            # Deliberate blanket catch: one misbehaving handler must
            # not poison the tick. The traceback goes to Log.txt so
            # the failure is diagnosable.
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
            self.send(address, reply, remote_addr=source_addr)

    @property
    def drain_skips(self):
        """How many ``poll()`` calls bailed out because a drain was live.

        Surfaced through ``/looping/probe/drain_stats``. A steadily
        rising count means the two pumps are genuinely contending; a
        flat zero means the fast pump is doing all the work and the
        tick fallback always finds the queue already empty.
        """
        return self._drain_skips

    # --- lifecycle ---------------------------------------------------------

    def close(self):
        """Close the socket. Idempotent."""
        if self._closed:
            return
        self._closed = True
        try:
            self._socket.close()
        except OSError as e:
            logger.warning("%s socket close error: %s", self._name, e)
        logger.info("%s transport closed", self._name)
