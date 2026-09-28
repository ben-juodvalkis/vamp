"""FastDrainPump — sub-tick socket drain for the Control Surface.

Why this exists
---------------

The surface used to read its inbound UDP socket only from
``LoopingSurface._tick``, which re-arms with
``schedule_message(1, self._tick)``. A Live tick was long assumed to
be "~100ms" in this tree — and measurement agrees: two independent
probes on 2026-08-31 put it at **99.4ms** (reply-clustering from a
40-probe burst) and ~104ms (max of 120 randomised-phase round trips).

The consequence was that every UI→Live command sat in the kernel
receive buffer until the next tick before the surface even *looked*
at it. Measured with ``owner/probes/inbound_latency_run.js`` against the
``/live/test`` echo, whose handler does nothing but log and return:
mean 52.06ms, p99 102.6ms, over a flat uniform distribution — the
signature of "wait for the next drain". Only 1.09ms of that (the
observed minimum) is loopback; the rest was pure queue-wait.

No existing perf instrumentation could see this, because all of it
starts its clock at ``perf_profiler.record_inbound`` — i.e. *after*
the wait. Meters are unaffected either way: they are listener-driven
and throttled to 30 Hz on the outbound side.

What it does
------------

Runs ``transport.poll()`` on a ``Timer`` owned by Live, at an
interval far shorter than a tick, so a packet is picked up roughly
when it lands instead of at the next tick boundary. No threads: the
timer is Live's own, and the callback is expected on the control
thread just like the tick.

Two hazards this module exists to handle
----------------------------------------

**1. Live's Timer stops itself on a callback error.** The class
docstring in the Live 12.4.5b11 binary says so outright: *"Errors in
the callback will stop the timer."* A single unhandled exception
would therefore silently return the surface to 100ms latency with no
signal. ``_on_fire`` is consequently total — it catches everything,
counts it, and returns normally. ``LoopingSurface._tick`` also keeps
its own ``poll()`` call as a fallback drain, so even a dead pump
degrades to the old behaviour rather than going deaf.

**2. Where ``Timer`` lives can only be settled at runtime.** It is
``Live.Base.Timer`` — confirmed by the surface resolving it there on
2026-08-31 against Live 12.4.5b11.

That is worth recording because reading the *binary* suggested
otherwise and was wrong. ``Live.Base``'s string-table block lists
only the vector containers, ``Text`` and ``LimitationError``, while
``Timer``'s docstring sits over in the ``Live.Track`` block between
``TakeLane`` and ``DeviceInsertMode``. String-table adjacency is
simply not a module map. ``discover_timer`` therefore looks the class
up at runtime and logs where it found it, which is both how the
question got answered and how a future Live that moves the symbol
will produce a logged capability miss plus a working (if slow)
surface rather than a crash.

What the timer actually does
----------------------------

Measured on the running surface via ``/looping/probe/drain_stats``,
sampling the monotonic ``fires`` counter 5 s apart:
``interval=1`` fires **every 10.77 ms (92.8 Hz)**. So the interval
argument is *not* milliseconds — 1 buys ~10 ms, not 1 ms.

That number also reconciles two claims in this tree that looked
contradictory. Live really does run a ~100 Hz internal loop, which
is what this timer rides. What it does *not* do is dispatch
``schedule_message`` at that rate: one ``schedule_message`` tick is
99.44 ms, i.e. ten of Live's internal beats. Both clocks are real;
they are just an order of magnitude apart, and the old
``_init_heartbeat_state`` docstring applied the fast one's rate to
the slow one's period.

Net effect, measured end to end with
``owner/probes/inbound_latency_run.js`` (120 samples, randomised phase):

    inbound command latency   before      after
    mean                      52.06 ms    5.63 ms
    p50                       49.37 ms    5.65 ms
    p99                      102.61 ms   10.33 ms
    max                      104.43 ms   11.02 ms
"""

from __future__ import annotations

import logging

logger = logging.getLogger("looping")

# Where to look for Live's Timer class, confirmed location first.
#
# ``Live.Base`` leads because that is where Live 12.4.5b11 actually
# exposes it at runtime. The rest are cheap insurance against a
# future move — a failed ``getattr`` costs nothing at init time, and
# ``Live.Track`` earns its place on the list because the binary's
# string table (misleadingly) groups ``Timer`` into that block.
TIMER_CANDIDATE_MODULES = (
    "Live.Base",
    "Live.Track",
    "Live.Application",
    "Live.Song",
)

# Probe address. Answers with a JSON blob of ``FastDrainPump.stats()``
# plus the transport's contention counter. Returned as a tuple so
# ``OSCTransport._dispatch``'s auto-reply sends it back to whoever
# asked, which lets an ephemeral-port driver read it without
# disturbing the bridge's conversation on 11021.
STATS_ADDRESS = "/looping/probe/drain_stats"

# Timer interval. Deliberately NOT named "ms": measurement says 1
# buys a ~10.8 ms period, so whatever the unit is, it is not
# milliseconds. Live's class docstring says only "a certain
# inverval" [sic] and names no unit.
#
# 1 is also the floor worth asking for — it lands on Live's own
# ~100 Hz internal beat, which is as fine-grained as this timer can
# usefully get. Read the real rate off a running surface with
# ``/looping/probe/drain_stats`` rather than trusting this number.
DEFAULT_INTERVAL = 1

# Back-compat alias. The config key is still ``drainIntervalMs``
# because that is what shipped; renaming a constants.json key is a
# cross-language change (Python, TS, Node, Max all read that file)
# and not worth it to fix a misnomer.
DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL


def discover_timer(live_module=None):
    """Locate Live's ``Timer`` class.

    Returns ``(cls, "Live.X.Timer")`` on success, or ``(None, reason)``
    where ``reason`` is a short human-readable string for the log.

    Takes the ``Live`` module by injection so the unit tests can hand
    in a stand-in; outside Live there is no ``Live`` to import.
    """
    if live_module is None:
        try:
            import Live  # type: ignore[import-not-found]
        except ImportError as e:
            return None, "Live module unavailable: %s" % e
        live_module = Live

    for mod_name in TIMER_CANDIDATE_MODULES:
        # ``Live.Track`` etc. are attributes on the ``Live`` package
        # object once Live has populated it; a plain getattr chain is
        # enough and avoids importlib inside the embedded interpreter.
        sub = live_module
        try:
            for seg in mod_name.split(".")[1:]:
                sub = getattr(sub, seg)
            timer_cls = getattr(sub, "Timer")
        except AttributeError:
            continue
        except Exception as e:  # pragma: no cover - defensive
            # Live 12 raises non-AttributeError on some attribute
            # reads (see the master.mute quirk in MasterComponent);
            # a probe must not assume the exception type.
            logger.warning(
                "drain pump: probing %s.Timer raised %s: %s",
                mod_name, type(e).__name__, e,
            )
            continue
        if timer_cls is None:
            continue
        return timer_cls, "%s.Timer" % mod_name

    return None, "no Timer in %s" % ", ".join(TIMER_CANDIDATE_MODULES)


class FastDrainPump:
    """Drives ``drain()`` from a Live-owned repeating timer.

    Args:
        drain: Zero-arg callable, normally ``transport.poll``. Must be
            safe to call concurrently with the tick's own call — see
            ``OSCTransport.poll``'s non-blocking drain lock.
        interval_ms: Timer period, in Live's own unit — NOT
            milliseconds despite the name. See ``DEFAULT_INTERVAL``.
        timer_factory: ``(callback, interval, repeat) -> timer``.
            Defaults to the discovered Live class. Injected by tests,
            which have no Live to discover.
    """

    def __init__(self, drain, interval_ms=DEFAULT_INTERVAL,
                 timer_factory=None):
        self._drain = drain
        self._interval_ms = interval_ms
        self._timer_factory = timer_factory
        self._timer = None
        self._source = None
        self._fires = 0
        self._drained = 0
        self._errors = 0
        self._last_error = ""
        # Callables run on EVERY fire, after the drain, whether or not a
        # message arrived (unlike ``OSCTransport.add_drain_hook``, which
        # runs only after a non-empty drain). This is the surface's
        # steadiest clock — 92.8 Hz measured — and a Timer callback is a
        # legal LOM write context (the drum-rack fan-out already writes
        # from here), so the sequencer engine (permute ADR-020) ticks off
        # it. Each hook is guarded: a raising hook is counted and logged,
        # never allowed to reach the Timer (hazard 1 above).
        self._tick_hooks = []
        self._hook_errors = 0

    # --- hooks ------------------------------------------------------------

    def add_tick_hook(self, hook):
        """Register ``hook()`` to run on every timer fire, after the drain."""
        if not callable(hook):
            raise TypeError("tick hook must be callable, got %r" % (hook,))
        self._tick_hooks.append(hook)

    def remove_tick_hook(self, hook):
        try:
            self._tick_hooks.remove(hook)
        except ValueError:
            pass

    # --- lifecycle --------------------------------------------------------

    def start(self):
        """Construct and start the timer. Returns True if it is running.

        A False return is not fatal: ``LoopingSurface._tick`` still
        drains, so the surface keeps working at the old ~100ms
        latency. The reason is logged at WARNING and surfaced in
        ``stats()`` so ``/looping/probe/drain_stats`` can report it.
        """
        if self._timer is not None:
            return True

        factory = self._timer_factory
        if factory is None:
            timer_cls, source = discover_timer()
            if timer_cls is None:
                self._last_error = source
                logger.warning(
                    "drain pump unavailable (%s) — inbound stays on the "
                    "~100ms tick drain", source,
                )
                return False
            self._source = source

            def factory(callback, interval, repeat):
                return timer_cls(
                    callback=callback, interval=interval, repeat=repeat,
                )
        else:
            self._source = "injected"

        try:
            self._timer = factory(self._on_fire, self._interval_ms, True)
            self._timer.start()
        except Exception as e:
            # Constructor signature drift across Live versions is the
            # likely failure here. Same posture as Gate 4c's decorator
            # probe: record the failure, keep the surface up.
            self._timer = None
            self._last_error = "%s: %s" % (type(e).__name__, e)
            logger.warning(
                "drain pump failed to start via %s (%s) — inbound stays "
                "on the ~100ms tick drain", self._source, self._last_error,
            )
            return False

        logger.info(
            "drain pump started via %s at interval=%s (repeat=True)",
            self._source, self._interval_ms,
        )
        return True

    def stop(self):
        """Stop the timer. Idempotent; safe on a pump that never started."""
        timer, self._timer = self._timer, None
        if timer is None:
            return
        try:
            timer.stop()
        except Exception as e:
            logger.warning("drain pump stop raised %s: %s", type(e).__name__, e)

    # --- callback ---------------------------------------------------------

    def _on_fire(self):
        """Drain once. Never raises — see hazard 1 in the module docstring."""
        self._fires += 1
        try:
            drained = self._drain()
        except Exception as e:
            self._errors += 1
            self._last_error = "%s: %s" % (type(e).__name__, e)
            # Not ``exc_info=True``: at a sub-tick interval a repeating
            # fault would write a traceback per fire and drown Log.txt.
            # The count and the last message are enough to notice; the
            # per-handler traceback is already logged inside
            # ``OSCTransport._dispatch``, which is where a real handler
            # fault surfaces anyway.
            logger.error("drain pump callback error: %s", self._last_error)
            return
        if drained:
            self._drained += drained
        if self._tick_hooks:
            self._run_tick_hooks()

    def _run_tick_hooks(self):
        """Run every tick hook, each guarded — never raises."""
        for hook in list(self._tick_hooks):
            try:
                hook()
            except Exception as e:
                self._hook_errors += 1
                self._last_error = "tick hook %r: %s: %s" % (
                    hook, type(e).__name__, e,
                )
                if self._hook_errors <= 5 or self._hook_errors % 1000 == 0:
                    logger.error(
                        "drain pump tick hook error #%d: %s",
                        self._hook_errors, self._last_error,
                    )

    # --- introspection ----------------------------------------------------

    @property
    def running(self):
        return self._timer is not None

    def stats(self):
        """Snapshot for ``/looping/probe/drain_stats``."""
        return {
            "running": 1 if self._timer is not None else 0,
            "source": self._source or "",
            "intervalMs": self._interval_ms,
            "fires": self._fires,
            "drained": self._drained,
            "errors": self._errors,
            "hookErrors": self._hook_errors,
            "tickHooks": len(self._tick_hooks),
            "lastError": self._last_error,
        }
