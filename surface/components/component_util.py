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
from typing import Callable, Hashable, Optional, Set

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


def begin_undo_step(owner: str, song) -> bool:
    """Open an undo step; ``False`` when Live refused, so the caller does
    not close a step that never opened."""
    try:
        song.begin_undo_step()
    except LOM_ERRORS as e:
        logger.warning("%s: begin_undo_step raised %s: %s", owner, type(e).__name__, e)
        return False
    return True


def end_undo_step(owner: str, song, began: bool) -> None:
    """Close the step :func:`begin_undo_step` opened; nothing when it did not."""
    if not began:
        return
    try:
        song.end_undo_step()
    except LOM_ERRORS as e:
        logger.warning("%s: end_undo_step raised %s: %s", owner, type(e).__name__, e)


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
