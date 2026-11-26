"""Emit, warn, undo-step and arg-parse helpers several components shared
as pasted copies.

Each component keeps its own thin method (``self._safe_emit`` and the
rest), because tests and callers reach for those by name; the method
hands its owner's name, emit callable and state to the function here, so
the log lines read exactly as they did. ``_common`` holds the
dependency-free basics (``LOM_ERRORS``, ``coerce_str``); this module adds
the ones that log. Import relatively (``from .component_util import …``).
"""

from __future__ import annotations

import logging
from typing import Callable, Hashable, Iterable, Optional, Set, Tuple

from ._common import LOM_ERRORS

logger = logging.getLogger("looping")

#: ``/looping/v3/error [address, code, path, detail]``, the four-arg shape
#: every component's error emit uses.
V3_ERROR_ADDRESS = "/looping/v3/error"


def safe_emit(owner: str, emit: Callable, address: str, payload: tuple) -> None:
    """``emit(address, payload)``; a raise is logged, never propagated."""
    try:
        emit(address, payload)
    except Exception as e:
        logger.warning("%s: emit %s failed: %s", owner, address, e)


def emit_error(
    owner: str, emit: Callable, originating_address: str, code: str, path: str, detail: str,
) -> None:
    """Log and emit ``/looping/v3/error [address, code, path, detail]``."""
    logger.warning(
        "%s: emit error addr=%r code=%r path=%r detail=%r",
        owner, originating_address, code, path, detail,
    )
    try:
        emit(V3_ERROR_ADDRESS, (originating_address, code, path, detail))
    except Exception as e:
        logger.warning("%s: emit %s failed: %s", owner, V3_ERROR_ADDRESS, e)


def first_time(warned: Set[Hashable], slot: Hashable) -> bool:
    """``True`` the first time ``slot`` is seen (and records it): the gate
    of every ``_warn_once``."""
    if slot in warned:
        return False
    warned.add(slot)
    return True


# --- the song's undo step: one owner for every component -------------------
#
# Live's ``begin_undo_step`` / ``end_undo_step`` are not reference-counted
# (measured on Live 12.4.15b2, 2026-09-16, and again on Live 13.0b26,
# 2026-11-25): an inner ``end`` closes the step an outer ``begin`` opened.
# DrumSwapComponent holds a step open for a whole similar-sound swap, up to
# 60 s, while DrumVirtualMacroComponent, MidiWheels and the others open and
# close their own around a gesture. Measured on the rig (2026-11-25): a
# Drum Rack value moved mid-swap closed the swap's step, and one Undo then
# reverted the macro together with the second half of the swap, leaving
# the first half for another Undo.
#
# So every component opens and closes the song's step through these two
# functions, which count per song: a begin while a step is open joins it,
# and only the outermost end calls Live. A gesture made during a swap is
# then part of the swap's one undo step.

_UNDO_DEPTH: dict = {}


def _undo_key(song):
    # By LOM identity where the song has one: ``self.song`` can hand each
    # component its own wrapper. A stub without one is keyed by ``id()``.
    ptr = getattr(song, "_live_ptr", None)
    return ("lom", ptr) if ptr is not None else ("py", id(song))


def begin_undo_step(owner: str, song, warn: Optional[Callable[[Exception], None]] = None) -> bool:
    """Open the song's undo step, or join the one already open. ``True``
    means the caller holds a level and must pass it to
    :func:`end_undo_step`; ``False`` when Live refused, so the caller does
    not close a step that never opened. ``warn`` replaces the warning log
    for a caller that rate-limits its own."""
    key = _undo_key(song)
    depth = _UNDO_DEPTH.get(key, 0)
    if depth == 0:
        try:
            song.begin_undo_step()
        except LOM_ERRORS as e:
            if warn is not None:
                warn(e)
            else:
                logger.warning("%s: begin_undo_step raised %s: %s", owner, type(e).__name__, e)
            return False
    _UNDO_DEPTH[key] = depth + 1
    return True


def end_undo_step(owner: str, song, began: bool,
                  warn: Optional[Callable[[Exception], None]] = None) -> None:
    """Give back the level :func:`begin_undo_step` took; the last one out
    closes Live's step. Nothing when ``began`` is False."""
    if not began:
        return
    key = _undo_key(song)
    depth = _UNDO_DEPTH.get(key, 0)
    if depth > 1:
        _UNDO_DEPTH[key] = depth - 1
        return
    _UNDO_DEPTH.pop(key, None)
    try:
        song.end_undo_step()
    except LOM_ERRORS as e:
        if warn is not None:
            warn(e)
        else:
            logger.warning("%s: end_undo_step raised %s: %s", owner, type(e).__name__, e)


def undo_depth(song) -> int:
    """How many owners hold the song's step (tests and the debug probe)."""
    return _UNDO_DEPTH.get(_undo_key(song), 0)


def reset_undo_steps() -> None:
    """Forget every held level. A new surface instance starts here: an old
    one torn down mid-gesture cannot leave the count above zero, which
    would keep every later begin from reaching Live."""
    _UNDO_DEPTH.clear()


def safe_class_name(device) -> str:
    """``device.class_name``, or ``""`` when the read raises or is empty."""
    try:
        return getattr(device, "class_name", "") or ""
    except Exception:
        return ""


def parse_int_arg(args, index: int, allow_bool: bool = True) -> Optional[int]:
    """``int(args[index])``, or ``None`` when it is missing or will not parse.

    ``allow_bool=False`` refuses a bool, which is an ``int`` subclass, so a
    stray ``True`` does not read as ``1``.
    """
    if len(args) <= index:
        return None
    raw = args[index]
    if not allow_bool and isinstance(raw, bool):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def run_guarded_steps(owner: str, steps: Iterable[Tuple[str, Callable[[], None]]]) -> int:
    """Run each ``(name, fn)`` in order; one that raises is logged and the
    rest still run. Returns how many raised.

    The handshake's accept and resync chains seed a dozen separate things
    (the tree, session values, the selection, arm, the playhead). A raise in
    one used to skip every seed after it (code review, 2026-11-25): the UI
    got a tree and no selected track. Same shape as the structural
    composite's per-hook guards.
    """
    failed = 0
    for name, fn in steps:
        try:
            fn()
        except Exception as e:
            failed += 1
            logger.error("%s: %s raised: %s", owner, name, e, exc_info=True)
    return failed
