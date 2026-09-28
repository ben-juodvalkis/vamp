"""Surface-side performance profiler.

Counts every OSC send the surface emits, every dispatched inbound
message, and selected LOM-listener fires (tracks/devices/value/
parameters). Once per ``window_sec`` (default 1.0 s) the rollup is
appended as a JSON line to the dump file.

Off by default. Enabled with the env var ``LOOPING_SURFACE_PROFILE=1``
(read at module import). Optional ``LOOPING_SURFACE_PROFILE_FILE`` for
a custom path (must be absolute); when unset the profiler writes to
``/tmp/looping-surface-profile.ndjson``. The repo path can't be
inferred at runtime — Live loads this module from the User Library
install, so any "walk up from __file__" heuristic ends up at the
User Library root, not the repo (issue #381).

Hot-path discipline
-------------------

The profile hook is two dict ops on the hot path; the flush only fires
inside ``flush_due()`` which is called from ``LoopingSurface._tick``.
There are no threads, no JSON encoders on the hot path, no IO outside
the once-per-window flush. When disabled, the hooks short-circuit on
the first line.

Why a dedicated module instead of folding into ``perf_logging``: the
logger coalescer is for *messages we want to read*; the profiler is
for *aggregate counts dumped to disk for analysis*. They share an
env-gating idiom but no other coupling.
"""

from __future__ import annotations

import json
import logging
import os
import time
import traceback
from typing import Dict, Optional

logger = logging.getLogger("looping")


_DEFAULT_DUMP_PATH = "/tmp/looping-surface-profile.ndjson"


def _resolve_dump_path() -> Optional[str]:
    # No repo-relative resolution: Live runs the surface from the User
    # Library, so __file__-based walks land outside the repo. If the
    # operator wants a repo-local dump, they pass an absolute path via
    # LOOPING_SURFACE_PROFILE_FILE — see documentation/performance-audit.md.
    raw = os.environ.get("LOOPING_SURFACE_PROFILE_FILE")
    if raw and os.path.isabs(raw):
        return raw
    return _DEFAULT_DUMP_PATH


_ENABLED = os.environ.get("LOOPING_SURFACE_PROFILE") in ("1", "true", "True")
_DUMP_PATH: Optional[str] = _resolve_dump_path() if _ENABLED else None
_WINDOW_SEC = float(os.environ.get("LOOPING_SURFACE_PROFILE_WINDOW_SEC", "1.0"))


class _Counters:
    __slots__ = (
        "send_by_address",      # Dict[str, int]
        "send_bytes",           # int
        "inbound_by_address",   # Dict[str, int]
        "listener_fires",       # Dict[str, int]
        "listener_durations",   # Dict[str, float] cumulative seconds
        "tick_count",
        "tick_time_total",      # cumulative seconds spent in tick
        "tick_gap_max_ms",
        "window_start",         # float (monotonic)
    )

    def __init__(self) -> None:
        self.send_by_address: Dict[str, int] = {}
        self.send_bytes: int = 0
        self.inbound_by_address: Dict[str, int] = {}
        self.listener_fires: Dict[str, int] = {}
        self.listener_durations: Dict[str, float] = {}
        self.tick_count: int = 0
        self.tick_time_total: float = 0.0
        self.tick_gap_max_ms: float = 0.0
        self.window_start: float = time.monotonic()

    def reset(self, now: float) -> None:
        self.send_by_address.clear()
        self.inbound_by_address.clear()
        self.listener_fires.clear()
        self.listener_durations.clear()
        self.send_bytes = 0
        self.tick_count = 0
        self.tick_time_total = 0.0
        self.tick_gap_max_ms = 0.0
        self.window_start = now


_counters = _Counters()
_dump_file = None
_open_failed = False


def _ensure_dump_file():
    global _dump_file, _open_failed
    if _dump_file is not None or _open_failed or not _ENABLED or _DUMP_PATH is None:
        return
    try:
        os.makedirs(os.path.dirname(_DUMP_PATH), exist_ok=True)
        _dump_file = open(_DUMP_PATH, "a", buffering=1)
        logger.info(
            "Surface profiler enabled: dumping to %s every %.1fs",
            _DUMP_PATH, _WINDOW_SEC,
        )
    except Exception as e:
        _open_failed = True
        logger.error(
            "Surface profiler: open failed for %s: %s\n%s",
            _DUMP_PATH, e, traceback.format_exc(),
        )


def is_enabled() -> bool:
    return _ENABLED and not _open_failed


def record_send(address: str, args=()) -> None:
    """Hot path: count one OSC send. ~2 dict ops when enabled, no-op otherwise."""
    if not _ENABLED:
        return
    _counters.send_by_address[address] = _counters.send_by_address.get(address, 0) + 1
    # Crude byte-equivalent: address chars + 8 per numeric arg + len(s) per string.
    # bool is checked before int/float because ``bool`` is a subclass of ``int``
    # in Python — without this order, ``isinstance(True, (int, float))`` would
    # match first and the bool branch would be unreachable.
    n = len(address)
    for a in args:
        if isinstance(a, bool):
            n += 1
        elif isinstance(a, str):
            n += len(a)
        elif isinstance(a, (int, float)):
            n += 8
    _counters.send_bytes += n


def record_inbound(address: str) -> None:
    if not _ENABLED:
        return
    _counters.inbound_by_address[address] = _counters.inbound_by_address.get(address, 0) + 1


def record_listener_fire(kind: str, duration_sec: float = 0.0) -> None:
    """Count one LOM-listener invocation by kind.

    ``kind`` is a stable label like ``"tracks_changed"``,
    ``"track:devices"``, ``"param:value"``, ``"device:parameters"``.
    ``duration_sec`` is optional — if the caller measured callback
    duration, we'll roll up cumulative seconds per kind.
    """
    if not _ENABLED:
        return
    _counters.listener_fires[kind] = _counters.listener_fires.get(kind, 0) + 1
    if duration_sec > 0.0:
        _counters.listener_durations[kind] = (
            _counters.listener_durations.get(kind, 0.0) + duration_sec
        )


def record_tick(duration_sec: float, gap_ms: float) -> None:
    if not _ENABLED:
        return
    _counters.tick_count += 1
    _counters.tick_time_total += duration_sec
    if gap_ms > _counters.tick_gap_max_ms:
        _counters.tick_gap_max_ms = gap_ms


def flush_due() -> None:
    """Emit one JSON line if the rollup window has closed.

    Cheap to call every Live tick — early-exit when disabled or when
    the window hasn't elapsed.
    """
    if not _ENABLED:
        return
    _ensure_dump_file()
    if _dump_file is None:
        return
    now = time.monotonic()
    elapsed = now - _counters.window_start
    if elapsed < _WINDOW_SEC:
        return
    record = {
        "ts": int(time.time() * 1000.0),
        "windowSec": elapsed,
        "tickCount": _counters.tick_count,
        "tickTimeMs": int(_counters.tick_time_total * 1000.0),
        "tickGapMaxMs": _counters.tick_gap_max_ms,
        "send": dict(_counters.send_by_address),
        "sendBytes": _counters.send_bytes,
        "inbound": dict(_counters.inbound_by_address),
        "listeners": dict(_counters.listener_fires),
        "listenerMs": {
            k: int(v * 1000.0) for k, v in _counters.listener_durations.items()
        },
    }
    try:
        _dump_file.write(json.dumps(record))
        _dump_file.write("\n")
    except Exception as e:
        logger.error("Surface profiler write failed: %s", e)
    _counters.reset(now)


def close() -> None:
    """Flush and close the dump file. Idempotent."""
    global _dump_file
    if _dump_file is None:
        return
    try:
        flush_due()
    finally:
        try:
            _dump_file.flush()
            _dump_file.close()
        except Exception:
            pass
        _dump_file = None


def snapshot() -> dict:
    """Return the current rollup as a dict without flushing/clearing.

    Useful for ad-hoc /looping/perf/dump probes and tests.
    """
    return {
        "windowElapsedSec": time.monotonic() - _counters.window_start,
        "tickCount": _counters.tick_count,
        "tickTimeMs": int(_counters.tick_time_total * 1000.0),
        "tickGapMaxMs": _counters.tick_gap_max_ms,
        "send": dict(_counters.send_by_address),
        "sendBytes": _counters.send_bytes,
        "inbound": dict(_counters.inbound_by_address),
        "listeners": dict(_counters.listener_fires),
    }
