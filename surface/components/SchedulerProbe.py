"""SchedulerProbe — Gate 4b capability probe for ``schedule_message`` timing.

Purpose
-------

Gate 4b ([05-migration-plan.md §1], [06 §1.3]) asks: does
``ControlSurface.schedule_message(ticks, fn)`` fire ``fn`` on time
enough for the AU plugin retry schedule (``[400, 800, 1600]ms``) to
hold in Python? If the framework's scheduler drifts beyond the
acceptance bands (≤20ms short, ≤50ms at 1500ms), the preset-load
grouping must switch to tick-counted intervals instead of relying on
wall-clock millisecond math.

This probe measures actual fire time vs. requested delay for N
scheduled callbacks per bucket, emits aggregate statistics, and lets
the operator read a pass/fail off a markdown table the driver prints.

Shape
-----

One OSC address, ``/looping/probe/schedule_run [delay_ms, count]``,
routed to ``handle_schedule_run``. The handler:

1. Records ``t0 = time.monotonic()`` as the "scheduled at" baseline.
2. Schedules ``count`` callbacks back-to-back, each capturing its own
   closed-over ``t0`` so the deviation is measured against the
   scheduling timestamp, not against the previous callback.
3. Each callback records ``dt = (time.monotonic() - t0) * 1000``
   into a shared list.
4. Once all ``count`` callbacks have fired, emits
   ``/looping/probe/schedule_result
   [delay_ms, count, mean_ms, p50_ms, p99_ms, max_ms]``.

The emit happens inline from the last-firing callback rather than on
a separate tick. Stats are computed in pure Python on a small list
(N=100 is the plan's default); no numpy dependency, no thread.

Why ``time.monotonic()`` rather than wall clock: ``monotonic`` can't
go backwards across NTP adjustments, so a cosmic ray-grade deviation
can't be hidden by a clock slew mid-run.

Why bypass the v3 scheduler adapter
-----------------------------------

[LoopingSurface.py:223]'s ``_schedule_delayed(delay_ms, fn)`` rounds
up to whole ticks (~100ms), so a 10ms request always fires ≥100ms
late — through that adapter. That rounding is the right behaviour
for production probe-callers (the Gate 4a browser probe wants the
verify pass on the *next* tick, not the same one), but it would
mask the framework's actual fidelity at short delays.

The Gate 4b probe therefore takes the raw ``schedule_message`` bound
method directly ([03 §5.3] calls this out implicitly by naming
``schedule_message`` as the mechanism, not the adapter). In tests,
we inject a synchronous stand-in so the stats math can be asserted
inline.

Injection points
----------------

Takes ``schedule_message`` (``(ticks, fn)`` callable), ``emit``
(``(address, args)`` callable bound to ``transport.send``), and an
optional ``now`` callable (defaults to ``time.monotonic``) at
construction. The ``now`` hook lets unit tests deterministically
advance a fake clock between scheduled callbacks so the stats have
known values rather than host-scheduler noise.

Why not a ``pytest`` per bucket
-------------------------------

``schedule_message`` is a ``ControlSurface`` method; it only exists
inside Live's embedded Python. The live run is how we get real
verdicts. What pytest *can* cover is: argument parsing, stats math
(mean/p50/p99/max) against a hand-rolled reference, the emission
shape, the tick-conversion rule (ms → ticks with round-up), and the
single-run-at-a-time guard so back-to-back driver invocations don't
intermix samples. That is what ``tests/test_scheduler_probe.py``
does. The per-bucket verdicts come from a one-shot operator-driven
session, captured in the log and in [06 §1.3]'s table.
"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger("looping")


# OSC addresses owned by this probe. Kept as module constants so the
# unit tests and the driver script can reference them without
# duplicating strings.
RUN_ADDRESS = "/looping/probe/schedule_run"
RESULT_ADDRESS = "/looping/probe/schedule_result"

# Acceptance bands from [05 §1 Gate 4b] / [06 §1.3]. Not enforced
# here — the probe is a measurement tool, verdicts are the operator's
# call — but exported so the driver can colour the table.
ACCEPT_MS_SHORT = 20   # buckets ≤ 500ms
ACCEPT_MS_LONG = 50    # bucket = 1500ms

# One Live tick is ~100ms. ``schedule_message(ticks, fn)`` takes
# integer ticks, so the probe rounds ms → ticks with ceil-ish math
# so a 10ms request still defers by at least one tick (else ``fn``
# runs inline, which is not what the framework does in practice and
# would flatter the measurement).
MS_PER_TICK = 100


class SchedulerProbe:
    """Schedules N callbacks at a given delay and emits deviation stats.

    Args:
        schedule_message: ``(ticks, fn)`` callable — typically the
            bound ``ControlSurface.schedule_message`` method. The
            probe calls it directly rather than going through
            ``_schedule_delayed`` to measure framework fidelity, not
            adapter fidelity. Must be safe to call from the main
            tick thread; Live's implementation is.
        emit: ``(address, args)`` callable, usually
            ``transport.send``. Used to publish ``RESULT_ADDRESS``.
        now: Monotonic clock source, in seconds. Defaults to
            ``time.monotonic``. Tests inject a deterministic fake.
    """

    def __init__(self, schedule_message, emit, now=None):
        self._schedule_message = schedule_message
        self._emit = emit
        self._now = now or time.monotonic
        # Single-run guard. A concurrent second run would contaminate
        # the samples list and make the stats meaningless. The driver
        # is single-threaded and serial, so contention here would be
        # a driver bug — but refusing early with a clear error beats
        # a silent mixed-bucket result.
        self._active_run = None

    # --- handler ----------------------------------------------------------

    def handle_schedule_run(self, args, source_addr):
        """``/looping/probe/schedule_run [delay_ms, count]`` entry point.

        ``delay_ms`` is the requested delay in milliseconds (matches
        the schedule-message argument semantics the plan names).
        ``count`` is the sample size; the plan's default is 100, but
        the driver can pass a smaller value for a smoke run.
        """
        if len(args) < 2:
            logger.warning(
                "SchedulerProbe: expected (delay_ms, count), got %r", args,
            )
            return None
        try:
            delay_ms = int(args[0])
            count = int(args[1])
        except (TypeError, ValueError) as e:
            logger.warning("SchedulerProbe: bad args %r: %s", args, e)
            return None
        if delay_ms <= 0 or count <= 0:
            self._emit_error(delay_ms, count, "bad_args: delay_ms and count must be > 0")
            return None

        if self._active_run is not None:
            # A second driver call while the first is still collecting
            # samples would mix fire times across runs. Cheaper to
            # refuse than to guard every callback with a run-id check.
            self._emit_error(
                delay_ms, count,
                "busy: previous run for delay_ms=%d still collecting"
                % self._active_run["delay_ms"],
            )
            return None

        ticks = _ms_to_ticks(delay_ms)
        t0 = self._now()
        run = {
            "delay_ms": delay_ms,
            "count": count,
            "samples_ms": [],
            "t0": t0,
        }
        self._active_run = run

        # Schedule all N callbacks back-to-back. Every callback closes
        # over ``run`` so the samples accumulate in one place and the
        # last-firing callback is responsible for emitting.
        #
        # Known non-issue: because all N are scheduled inside the same
        # tick, Live's scheduler will dispatch them together on the
        # target tick. That's fine — what we're measuring is
        # scheduler→fire latency, which all N experience
        # independently. If Live ever changes to dispatch them
        # serialised over multiple ticks we'd see it show up as
        # widening p99 and that itself would be useful data.
        for _ in range(count):
            self._schedule_message(ticks, lambda r=run: self._on_fire(r))
        logger.info(
            "SchedulerProbe: scheduled %d callbacks at %dms (%d ticks)",
            count, delay_ms, ticks,
        )
        return None

    # --- internals --------------------------------------------------------

    def _on_fire(self, run):
        """Record deviation for one callback; emit when bucket is full."""
        dt_ms = (self._now() - run["t0"]) * 1000.0
        run["samples_ms"].append(dt_ms)
        if len(run["samples_ms"]) < run["count"]:
            return
        # Last sample in this bucket — compute and emit.
        stats = _summarise(run["samples_ms"])
        self._emit_result(
            run["delay_ms"],
            run["count"],
            stats["mean"],
            stats["p50"],
            stats["p99"],
            stats["max"],
        )
        # Clear the slot so the next bucket can run.
        self._active_run = None

    def _emit_result(self, delay_ms, count, mean_ms, p50_ms, p99_ms, max_ms):
        logger.info(
            "SchedulerProbe result: delay_ms=%d count=%d "
            "mean=%.2fms p50=%.2fms p99=%.2fms max=%.2fms",
            delay_ms, count, mean_ms, p50_ms, p99_ms, max_ms,
        )
        # Plain floats on the wire; the codec handles the conversion.
        # Keeping this as six positional args rather than a dict-ish
        # blob matches the Gate 4a result shape and the driver's
        # fixed-arity expectations.
        self._emit(
            RESULT_ADDRESS,
            (
                int(delay_ms),
                int(count),
                float(mean_ms),
                float(p50_ms),
                float(p99_ms),
                float(max_ms),
            ),
        )

    def _emit_error(self, delay_ms, count, detail):
        """Error path — same address, but mean/p50/p99/max all -1.

        Using the same address with sentinel values keeps the driver's
        subscriber logic simple: one listener, one arity, no separate
        error channel. The driver inspects ``mean < 0`` to branch.
        """
        logger.warning(
            "SchedulerProbe error: delay_ms=%r count=%r detail=%s",
            delay_ms, count, detail,
        )
        self._emit(
            RESULT_ADDRESS,
            (
                int(delay_ms) if isinstance(delay_ms, int) else -1,
                int(count) if isinstance(count, int) else -1,
                -1.0, -1.0, -1.0, -1.0,
            ),
        )


# --- helpers -------------------------------------------------------------


def _ms_to_ticks(delay_ms):
    """Convert milliseconds to Live ticks, rounding up to ≥1.

    One tick ≈ ``MS_PER_TICK`` ms. We deliberately use ceiling
    division so a 10ms request becomes 1 tick (~100ms), not 0 ticks
    (inline fire). The framework's ``schedule_message(0, fn)``
    behaviour is undefined/undocumented; 1 is the safe floor.
    """
    return max(1, (int(delay_ms) + MS_PER_TICK - 1) // MS_PER_TICK)


def _summarise(samples_ms):
    """Compute mean / p50 / p99 / max over a list of float ms deviations.

    Percentile strategy: nearest-rank on the sorted list, which is
    deterministic and needs no interpolation library. For N=100 this
    makes p50 the 50th element (index 49) and p99 the 99th (index 98)
    — close enough for the acceptance bands in [06 §1.3], and cheap
    to reason about when reading the driver's output.
    """
    if not samples_ms:
        # Defensive — the handler prevents this, but the helper is
        # exported for unit tests and should be total.
        return {"mean": 0.0, "p50": 0.0, "p99": 0.0, "max": 0.0}
    n = len(samples_ms)
    sorted_ms = sorted(samples_ms)
    mean = sum(sorted_ms) / n
    p50 = sorted_ms[_nearest_rank_index(n, 0.50)]
    p99 = sorted_ms[_nearest_rank_index(n, 0.99)]
    return {"mean": mean, "p50": p50, "p99": p99, "max": sorted_ms[-1]}


def _nearest_rank_index(n, pct):
    """Nearest-rank percentile index for a sorted list of length ``n``.

    ``pct`` is in ``[0, 1]``. Returns an integer in ``[0, n-1]``.
    ``pct=0.5, n=100`` → 49. ``pct=0.99, n=100`` → 98. ``pct=1.0`` →
    ``n-1``. The formula is ``ceil(pct * n) - 1`` clamped.
    """
    if n <= 1:
        return 0
    # ceil(pct * n) without importing math, since math is fine but
    # this is trivial and keeps the helper self-contained.
    raw = int(pct * n)
    if raw < pct * n:
        raw += 1
    return max(0, min(n - 1, raw - 1))
