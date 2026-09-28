"""Coalesced logging helper for the Python control surface.

Identical-key messages within a 1-second window are folded into a
single "<msg> xN in last Tms" emit at window close. The first hit on
a fresh key emits immediately at the chosen level so the very first
event is never delayed.

Use this on high-rate paths — meter listener fires, parameter
value-listener bursts during preset swaps, post-add reconciler
churn — where an unconditional DEBUG would drown out anything else
in Log.txt.

There is no background thread: flushes happen lazily inside ``rate``
and via ``flush_due()`` which the caller can wire to ``_tick`` (cheap
O(open buckets)). The intent is to be safe on Live's main thread —
no GIL contention, no socket IO, no allocations on the steady path.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("looping")

_RATE_WINDOW_SEC = 1.0


# bucket: (level, message, context, count, first_monotonic)
_buckets: Dict[str, Tuple[int, str, Optional[dict], int, float]] = {}


def rate(
    key: str,
    level: int,
    message: str,
    context: Optional[dict] = None,
) -> None:
    """Emit ``message`` at ``level``, coalescing repeats by ``key``.

    The first call for a given ``key`` emits immediately. Further calls
    in the same 1-second window only increment the count; the deferred
    summary fires from ``flush_due()`` once the window has elapsed.

    ``context`` is appended to the formatted line as ``{...}`` JSON-ish
    text via ``logger.log`` formatting — no JSON serializer to keep
    this dependency-free under Live's embedded Python.
    """
    if not logger.isEnabledFor(level):
        return
    now = time.monotonic()
    existing = _buckets.get(key)
    if existing is None:
        _buckets[key] = (level, message, context, 1, now)
        _emit(level, message, context)
        return
    e_level, _e_msg, _e_ctx, count, first_ts = existing
    _buckets[key] = (e_level, message, context, count + 1, first_ts)


def flush_due() -> None:
    """Emit the deferred summary for any window that has closed.

    Cheap to call every Live tick: O(open buckets), no IO unless an
    actual flush fires.
    """
    if not _buckets:
        return
    now = time.monotonic()
    expired = []
    for key, (level, message, context, count, first_ts) in _buckets.items():
        if now - first_ts < _RATE_WINDOW_SEC:
            continue
        expired.append(key)
        if count > 1:
            elapsed_ms = int((now - first_ts) * 1000.0)
            summary = "%s x%d in last %dms" % (message, count, elapsed_ms)
            _emit(level, summary, context)
    for key in expired:
        _buckets.pop(key, None)


def reset() -> None:
    """Drop all pending buckets without emitting. Test-only."""
    _buckets.clear()


def _emit(level: int, message: str, context: Optional[dict]) -> None:
    if context:
        logger.log(level, "%s %s", message, _format_context(context))
    else:
        logger.log(level, "%s", message)


def _format_context(context: dict) -> str:
    # Avoid json.dumps on the steady path — it allocates more than
    # necessary under Live's GC. Comma-joined ``k=v`` is enough for the
    # diagnostic shape and it round-trips cleanly through Log.txt's
    # plain-text rendering.
    parts = []
    for k, v in context.items():
        parts.append("%s=%r" % (k, v))
    return "{" + ", ".join(parts) + "}"


# Convenience level shortcuts so callers don't need to import logging.
DEBUG = logging.DEBUG
INFO = logging.INFO
WARNING = logging.WARNING
ERROR = logging.ERROR
