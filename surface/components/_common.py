"""Small helpers every surface component used to paste for itself.

Dependency-free on purpose: no Live import and no sibling import, so any
component can take these without an import cycle. Import relatively
(``from ._common import LOM_ERRORS, coerce_str``); the absolute form passes
pytest and fails inside Live (surface/CLAUDE.md).
"""

import logging
from typing import Tuple

logger = logging.getLogger("looping")

#: What a LOM read or write raises on a torn-down or refused handle.
#: ``TypeError`` covers ``Boost.Python.ArgumentError``. A component that
#: also wants ``IndexError`` / ``ValueError`` adds them at its call site.
LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


def coerce_str(x, none: str = "") -> str:
    """Coerce an OSC arg to ``str``: bytes → utf-8, ``None`` → ``none``.

    ``None`` shows up when the OSC encoder collapses an empty string, and
    reads as ``""`` so an empty-path check stays reachable. A component
    whose copy used to ``str()`` it (``"None"``) passes ``none="None"``
    to keep that behavior.
    """
    if x is None:
        return none
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


def is_stale_handle_error(exc: BaseException) -> bool:
    """``True`` when ``exc`` is Live's stale-LOM-handle marker.

    A ``remove_*_listener`` on an object Live has already torn down (a
    device that left its chain, a track just deleted) raises
    ``Boost.Python.ArgumentError`` — a ``TypeError`` — whose message
    carries "did not match C++ signature" and the ``TPyHandle`` type. The
    listener is already gone on Live's side; nothing is wrong. Matched on
    the message because the class is not importable outside Live.
    """
    try:
        msg = str(exc)
    except Exception:
        return False
    return "did not match C++ signature" in msg or "TPyHandle" in msg


def safe_remove(target, method_name: str, cb, ctx: str,
                other_level: int = logging.WARNING) -> bool:
    """Detach ``cb`` with ``target.<method_name>(cb)``; never raises.

    The one shape of the stale-handle detach: no such method (a test stub,
    an object that never had the listener) is a quiet ``False``; a
    stale-handle error is logged at DEBUG (the listener is already gone);
    anything else at ``other_level``. ``ctx`` names the caller in the log
    line. Returns ``True`` only when the call returned normally.
    """
    try:
        remover = getattr(target, method_name, None)
    except Exception:
        remover = None
    if not callable(remover):
        return False
    try:
        remover(cb)
    except Exception as e:
        if is_stale_handle_error(e):
            logger.debug("%s: %s skipped for stale handle %r", ctx, method_name, target)
        else:
            logger.log(other_level, "%s: %s failed on %r: %s", ctx, method_name, target, e)
        return False
    return True


def safe_emit(emit, address: str, payload, ctx: str) -> None:
    """``emit(address, payload)``; a raise is logged as a warning, never
    propagated (a closed transport in a teardown race, an encode error).
    The caller keeps its own ``_disconnected`` check."""
    try:
        emit(address, payload)
    except Exception as e:
        logger.warning("%s: emit %s failed: %s", ctx, address, e)


class WarnOnce:
    """Log a warning once per ``(scope, key)``: ``warned(scope, key, msg)``.

    For a LOM read that can fail on every listener fire, so a broken
    object names itself once instead of flooding Log.txt. ``(scope, key)
    in warned`` and ``clear()`` behave as on the set it replaces.
    """

    def __init__(self, ctx: str):
        self._ctx = ctx
        self._seen: set = set()

    def __call__(self, scope: str, key: str, message: str) -> None:
        k = (scope, key)
        if k in self._seen:
            return
        self._seen.add(k)
        logger.warning("%s: %s: %s", self._ctx, scope, message)

    def __contains__(self, k) -> bool:
        return k in self._seen

    def clear(self) -> None:
        self._seen.clear()
