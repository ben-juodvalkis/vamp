"""ViewComponent — ROW 5 /looping/v3/view/focus.

Owns a single application-level view-focus wire, lifted off the M4L
``/view/set/focus_view`` helper:

    /looping/v3/view/focus  [viewName:str]

``viewName`` is one of Live's ``Application.View.available_main_views``
values ("Browser", "Arranger", "Session", "Detail", "Detail/Clip",
"Detail/DeviceChain"). Unknown names are rejected with
``write-rejected`` rather than clamped — same posture as
``SessionComponent.handle_set_tempo``.

No listeners, no state; the component is a thin wrapper around
``application.view.focus_view``. Fire-and-forget — LOM propagates the
focused-view change itself; there's no companion observer on this
component because no UI surface needs to react to view focus today.
"""

from __future__ import annotations

import logging
from typing import Callable, Tuple

logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch must catch.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum) -----------------------------------------

V3_VIEW_FOCUS_ADDRESS = "/looping/v3/view/focus"
V3_ERROR_ADDRESS = "/looping/v3/error"


# --- error codes (match 04 §7.2) ------------------------------------------

V3_ERROR_WRITE_REJECTED = "write-rejected"


# Six entries, matching ``Application.View.available_main_views`` in
# Live 12. Compose-time check; LOM rejects unknowns with a C++
# exception, but surfacing the error as a typed wire code here is
# cleaner than relying on the ``_LOM_ERRORS`` branch.
_VALID_VIEWS = frozenset((
    "Browser",
    "Arranger",
    "Session",
    "Detail",
    "Detail/Clip",
    "Detail/DeviceChain",
))


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; ``None`` → ``""``."""
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


class ViewComponent:
    """Owns the application-view focus wire.

    Args:
        application: ``Live.Application.get_application()`` (inherited
            on ``ControlSurface`` as ``self.application``).
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
    """

    V3_VIEW_FOCUS_ADDRESS = V3_VIEW_FOCUS_ADDRESS

    def __init__(
        self,
        application,
        emit: Callable[[str, tuple], None],
    ) -> None:
        self._application = application
        self._emit = emit
        self._disconnected = False

    # --- wire handlers ---------------------------------------------------

    def handle_focus(self, args, source_addr) -> None:
        """``[viewName]`` — call ``application.view.focus_view(name)``.

        Rejects wrong arg count + unknown view names with
        ``write-rejected``. LOM raises on unknown names too, but the
        pre-check keeps the typed error shape uniform.
        """
        if self._disconnected:
            return
        if len(args) != 1:
            self._emit_error(
                V3_VIEW_FOCUS_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="arg-count: expected 1, got %d" % len(args),
            )
            return
        name = _coerce_str(args[0])
        if name not in _VALID_VIEWS:
            self._emit_error(
                V3_VIEW_FOCUS_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="unknown-view: %r" % name,
            )
            return
        try:
            self._application.view.focus_view(name)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_VIEW_FOCUS_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path="",
                detail="focus_view raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    # --- internal --------------------------------------------------------

    def _emit_error(
        self,
        originating_address: str,
        code: str,
        path: str,
        detail: str,
    ) -> None:
        if self._disconnected:
            return
        logger.warning(
            "ViewComponent: emit error addr=%r code=%r detail=%r",
            originating_address, code, detail,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (originating_address, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "ViewComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
