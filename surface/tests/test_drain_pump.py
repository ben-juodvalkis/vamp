"""FastDrainPump + drain re-entrancy tests.

Covers the two hazards the pump exists to handle:

1. Live stops a Timer whose callback raises ("Errors in the callback
   will stop the timer" — the class docstring in the 12.4.5b11
   binary). ``_on_fire`` must therefore be total.
2. ``Timer`` is not at the documented location, so the pump discovers
   it at runtime and degrades to a logged capability miss rather than
   crashing the surface.

Plus the interleaving contract: two pumps now call
``OSCTransport.poll()``, and a concurrent or re-entrant second call
must not double-dispatch a handler.
"""

import socket
import threading
import time

import pytest

from drain_pump import (
    DEFAULT_INTERVAL,
    DEFAULT_INTERVAL_MS,
    STATS_ADDRESS,
    FastDrainPump,
    discover_timer,
)
from osc_codec import encode_message
from osc_transport import OSCTransport


# --- fakes -----------------------------------------------------------------


class FakeTimer:
    """Stand-in for Live's Timer. Fires only when the test says so."""

    def __init__(self, callback, interval, repeat):
        self.callback = callback
        self.interval = interval
        self.repeat = repeat
        self.started = False
        self.stopped = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def fire(self, times=1):
        for _ in range(times):
            self.callback()


@pytest.fixture
def pump_with_timer():
    """A pump wired to a FakeTimer, plus a drain-call counter."""
    calls = {"n": 0, "raise": None, "returns": 0}
    made = {}

    def drain():
        calls["n"] += 1
        if calls["raise"] is not None:
            raise calls["raise"]
        return calls["returns"]

    def factory(callback, interval, repeat):
        made["timer"] = FakeTimer(callback, interval, repeat)
        return made["timer"]

    pump = FastDrainPump(drain=drain, interval_ms=1, timer_factory=factory)
    return pump, calls, made


# --- discovery -------------------------------------------------------------


def test_discover_timer_finds_it_on_the_candidate_module():
    """A Live-shaped module exposing Track.Timer resolves to that path."""

    class Timer:
        pass

    track = type("Track", (), {"Timer": Timer})
    live = type("Live", (), {"Track": track})

    cls, source = discover_timer(live_module=live)
    assert cls is Timer
    assert source == "Live.Track.Timer"


def test_discover_timer_prefers_live_base_the_confirmed_location():
    """Live.Base wins the tie — that is where the runtime actually has it.

    Reading the binary suggested ``Live.Track``: Timer's docstring
    sits in that module's string-table block, and ``Live.Base``'s
    block lists only the vector containers, Text and LimitationError.
    The running surface resolved ``Live.Base.Timer`` on 2026-08-31
    against 12.4.5b11 regardless, which is the ground truth and the
    reason discovery happens at runtime instead of by inspection.
    """
    track_timer = type("TrackTimer", (), {})
    base_timer = type("BaseTimer", (), {})
    live = type("Live", (), {
        "Track": type("Track", (), {"Timer": track_timer}),
        "Base": type("Base", (), {"Timer": base_timer}),
    })

    cls, source = discover_timer(live_module=live)
    assert cls is base_timer
    assert source == "Live.Base.Timer"


def test_discover_timer_reports_a_reason_when_absent():
    live = type("Live", (), {"Base": type("Base", (), {})})
    cls, reason = discover_timer(live_module=live)
    assert cls is None
    assert "no Timer" in reason


def test_discover_timer_survives_a_raising_attribute():
    """Live 12 raises non-AttributeError on some reads; keep scanning."""

    class Exploding:
        def __getattr__(self, name):
            raise RuntimeError("Live said no")

    good = type("GoodTimer", (), {})
    live = type("Live", (), {
        "Base": Exploding(),
        "Track": type("Track", (), {"Timer": good}),
    })

    cls, source = discover_timer(live_module=live)
    assert cls is good
    assert source == "Live.Track.Timer"


# --- lifecycle -------------------------------------------------------------


def test_start_constructs_and_starts_a_repeating_timer(pump_with_timer):
    pump, _calls, made = pump_with_timer
    assert pump.start() is True
    assert pump.running is True
    assert made["timer"].started is True
    assert made["timer"].repeat is True
    assert made["timer"].interval == 1


def test_start_is_idempotent(pump_with_timer):
    pump, _calls, made = pump_with_timer
    pump.start()
    first = made["timer"]
    pump.start()
    assert made["timer"] is first


def test_stop_stops_the_timer_and_is_idempotent(pump_with_timer):
    pump, _calls, made = pump_with_timer
    pump.start()
    pump.stop()
    assert made["timer"].stopped is True
    assert pump.running is False
    pump.stop()  # must not raise


def test_stop_on_a_never_started_pump_is_safe(pump_with_timer):
    pump, _calls, _made = pump_with_timer
    pump.stop()
    assert pump.running is False


def test_start_returns_false_when_the_timer_cannot_be_built():
    """A construction failure is a logged verdict, not an exception.

    Signature drift across Live versions is the realistic cause. The
    surface must stay up on the tick's fallback drain.
    """
    def factory(callback, interval, repeat):
        raise TypeError("unexpected keyword argument 'repeat'")

    pump = FastDrainPump(drain=lambda: 0, timer_factory=factory)
    assert pump.start() is False
    assert pump.running is False
    assert "TypeError" in pump.stats()["lastError"]


def test_stop_survives_a_timer_that_raises_on_stop(pump_with_timer):
    pump, _calls, made = pump_with_timer
    pump.start()
    made["timer"].stop = lambda: (_ for _ in ()).throw(RuntimeError("nope"))
    pump.stop()  # must not raise
    assert pump.running is False


# --- the callback must never raise -----------------------------------------


def test_fire_drains(pump_with_timer):
    pump, calls, made = pump_with_timer
    pump.start()
    made["timer"].fire(3)
    assert calls["n"] == 3
    assert pump.stats()["fires"] == 3


def test_a_raising_drain_does_not_escape_the_callback(pump_with_timer):
    """Hazard 1: Live kills a Timer whose callback raises.

    If this leaks, the pump dies on the first bad packet and the
    surface silently reverts to ~100ms latency with no signal.
    """
    pump, calls, made = pump_with_timer
    pump.start()
    calls["raise"] = ValueError("bad packet")
    made["timer"].fire(2)  # must not raise
    stats = pump.stats()
    assert stats["errors"] == 2
    assert stats["fires"] == 2
    assert "ValueError" in stats["lastError"]


def test_the_pump_keeps_draining_after_an_error(pump_with_timer):
    pump, calls, made = pump_with_timer
    pump.start()
    calls["raise"] = ValueError("transient")
    made["timer"].fire()
    calls["raise"] = None
    calls["returns"] = 4
    made["timer"].fire()
    stats = pump.stats()
    assert stats["errors"] == 1
    assert stats["drained"] == 4


def test_stats_shape(pump_with_timer):
    pump, _calls, _made = pump_with_timer
    pump.start()
    stats = pump.stats()
    assert set(stats) == {
        "running", "source", "intervalMs", "fires",
        "drained", "errors", "hookErrors", "tickHooks", "lastError",
    }
    assert stats["running"] == 1
    assert stats["source"] == "injected"


def test_probe_address_is_namespaced_with_the_other_probes():
    assert STATS_ADDRESS == "/looping/probe/drain_stats"
    assert DEFAULT_INTERVAL >= 1


def test_interval_alias_matches():
    """``DEFAULT_INTERVAL_MS`` is a misnomer kept for the config key.

    Measurement says ``interval=1`` buys a ~10.8 ms period, so the
    unit is not milliseconds. The alias exists only because
    ``constants.json`` already ships ``drainIntervalMs`` and renaming
    a key in that file is a four-language change.
    """
    assert DEFAULT_INTERVAL_MS == DEFAULT_INTERVAL


# --- interleaving ----------------------------------------------------------


def _poll_until(transport, done, timeout=2.0):
    """Drain repeatedly until ``done()`` or the deadline passes.

    UDP loopback delivery is asynchronous — ``sendto`` returning does
    not mean ``recvfrom`` will see the bytes yet. A single ``poll()``
    straight after a send therefore drains however many datagrams
    happened to have landed, which made these tests flaky (observed
    ~1 run in 3). Draining until the expected count arrives makes the
    race impossible rather than unlikely, and does not weaken what is
    being asserted: the guarantee under test is "each message is
    dispatched exactly once", not "one call drains everything".

    Returns the total number of messages drained.
    """
    deadline = time.monotonic() + timeout
    total = 0
    while True:
        total += transport.poll()
        if done():
            return total
        if time.monotonic() > deadline:
            raise AssertionError(
                "condition not met within %.1fs (drained %d)" % (timeout, total)
            )
        time.sleep(0.001)


@pytest.fixture
def surface_transport():
    """One OSCTransport on an ephemeral port, plus a raw sender socket."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()

    t = OSCTransport(
        local_addr=("127.0.0.1", port),
        remote_addr=("127.0.0.1", 1),  # never sent to in these tests
        name="surface",
    )
    sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    yield t, sender, port
    sender.close()
    t.close()


def test_reentrant_poll_does_not_double_dispatch(surface_transport):
    """The core interleaving contract.

    A handler that re-enters ``poll()`` — the shape a nested drain
    would take if the fast pump fired inside a handler — must not
    dispatch the queued messages a second time.
    """
    t, sender, port = surface_transport
    seen = []

    def handler(args, source_addr):
        seen.append(args[0])
        # Re-enter. Without the guard this drains the *other* queued
        # message here and again in the outer loop.
        t.poll()
        return None

    t.add_handler("/x", handler)
    for i in (1, 2, 3):
        sender.sendto(encode_message("/x", (i,)), ("127.0.0.1", port))

    _poll_until(t, lambda: len(seen) >= 3)
    assert sorted(seen) == [1, 2, 3], "each message dispatched exactly once"
    assert t.drain_skips >= 1, "the re-entrant poll must have been refused"


def test_concurrent_poll_from_two_threads_dispatches_each_once(
    surface_transport,
):
    """Belt-and-braces: the guard holds if Live ever fires the Timer
    off the control thread. We don't believe it does, but the cost of
    being right either way is one non-blocking lock acquire.
    """
    t, sender, port = surface_transport
    seen = []
    lock = threading.Lock()
    release = threading.Event()

    def handler(args, source_addr):
        with lock:
            seen.append(args[0])
        release.wait(1.0)
        return None

    t.add_handler("/x", handler)
    for i in range(5):
        sender.sendto(encode_message("/x", (i,)), ("127.0.0.1", port))

    results = []

    def drain():
        results.append(
            _poll_until(t, lambda: len(seen) >= 5, timeout=5.0)
        )

    threads = [threading.Thread(target=drain) for _ in range(2)]
    for th in threads:
        th.start()
    release.set()
    for th in threads:
        th.join(10.0)

    assert sorted(seen) == [0, 1, 2, 3, 4]
    assert len(seen) == len(set(seen)), "no message dispatched twice"


def test_poll_on_a_closed_transport_returns_zero(surface_transport):
    t, _sender, _port = surface_transport
    t.close()
    assert t.poll() == 0


# --- tick hooks (permute ADR-020: the sequencer engine's clock) --------------


def test_tick_hook_runs_on_every_fire_even_with_nothing_drained(pump_with_timer):
    pump, calls, made = pump_with_timer
    ticks = {"n": 0}
    pump.add_tick_hook(lambda: ticks.__setitem__("n", ticks["n"] + 1))
    pump.start()
    made["timer"].fire(times=3)
    assert ticks["n"] == 3
    assert calls["n"] == 3          # the drain still ran first each time
    assert pump.stats()["tickHooks"] == 1


def test_tick_hook_runs_after_the_drain(pump_with_timer):
    pump, calls, made = pump_with_timer
    order = []
    original = pump._drain

    def drain():
        order.append("drain")
        return original()

    pump._drain = drain
    pump.add_tick_hook(lambda: order.append("hook"))
    pump.start()
    made["timer"].fire()
    assert order == ["drain", "hook"]


def test_raising_tick_hook_is_counted_and_never_reaches_the_timer(pump_with_timer):
    pump, calls, made = pump_with_timer
    seen = []

    def bad():
        raise RuntimeError("boom")

    pump.add_tick_hook(bad)
    pump.add_tick_hook(lambda: seen.append(1))
    pump.start()
    made["timer"].fire(times=2)        # would stop a real Timer if it escaped
    assert seen == [1, 1]              # the hook after the bad one still ran
    stats = pump.stats()
    assert stats["hookErrors"] == 2 and stats["errors"] == 0
    assert "boom" in stats["lastError"]


def test_tick_hook_skipped_when_the_drain_itself_raises(pump_with_timer):
    pump, calls, made = pump_with_timer
    ticks = {"n": 0}
    pump.add_tick_hook(lambda: ticks.__setitem__("n", ticks["n"] + 1))
    pump.start()
    calls["raise"] = ValueError("transient")
    made["timer"].fire()
    assert ticks["n"] == 0
    calls["raise"] = None
    made["timer"].fire()
    assert ticks["n"] == 1


def test_remove_tick_hook(pump_with_timer):
    pump, calls, made = pump_with_timer
    ticks = {"n": 0}
    hook = lambda: ticks.__setitem__("n", ticks["n"] + 1)  # noqa: E731
    pump.add_tick_hook(hook)
    pump.remove_tick_hook(hook)
    pump.remove_tick_hook(hook)        # idempotent
    pump.start()
    made["timer"].fire()
    assert ticks["n"] == 0
    with pytest.raises(TypeError):
        pump.add_tick_hook("not callable")
