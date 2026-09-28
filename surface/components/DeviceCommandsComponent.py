"""DeviceCommandsComponent — ROW 5 device chain ops + Simpler actions.

Owns the path-addressed device-chain wires that retire the M4L
"appointed device" (blue-hand) dance, plus three Simpler-specific
side-effect methods that have no Live property surface (verified via
`/looping/probe/lom_introspect` against `SimplerDevice`):

    /looping/v3/device/select        [devicePath]
    /looping/v3/device/move_to_top   [devicePath]
    /looping/v3/device/move_to_end   [devicePath]
    /looping/v3/simpler/reverse      [devicePath]
    /looping/v3/simpler/warp_half    [devicePath]
    /looping/v3/simpler/warp_double  [devicePath]

The M4L predecessors (``/looping/device/select``,
``/looping/device/move_appointed_to_top``,
``/looping/device/move_appointed_to_end``) resolved by the M4L-space
``legacyId`` and required the UI to maintain a ``devicePath → legacyId``
side-table populated off the v3 state/full D-records. Under v3 the
device is reachable directly via ``path_resolver.resolve_device``;
legacyId becomes interim scaffolding and the side-table is retired
(see ROW 5 / closeout-0b).

The move handlers take the devicePath directly — no pre-select
handshake. They read ``device.canonical_parent`` to find the target
track or rack, then call ``Song.move_device(device, target, index)``
in a single LOM write. Select and move were always a two-step gesture
on the UI side; the v3 API collapses to one round-trip each.

Error taxonomy
--------------

- Malformed path → ``write-rejected`` with detail (same convention as
  ``ClipsComponent.handle_duplicate``).
- Device missing at a grammar-valid path → ``path-not-found``.
- Chain (rack) devicePaths → ``path-not-supported``; Phase-1 resolver
  refuses them.
- LOM raise on ``select_device`` / ``move_device`` /
  ``canonical_parent`` → ``write-rejected`` with the exception class
  and a truncated message.

The ``_LOM_ERRORS`` tuple includes ``TypeError`` so
``Boost.Python.ArgumentError`` (torn-down handle) surfaces cleanly
rather than crashing the tick, per CLAUDE.md merge-gate rule (9).
"""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from . import path_resolver
from .path_resolver import ResolveStatus

logger = logging.getLogger("looping")


_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum) -----------------------------------------

V3_DEVICE_SELECT_ADDRESS = "/looping/v3/device/select"
V3_DEVICE_MOVE_TO_TOP_ADDRESS = "/looping/v3/device/move_to_top"
V3_DEVICE_MOVE_TO_END_ADDRESS = "/looping/v3/device/move_to_end"
V3_DEVICE_DELETE_ADDRESS = "/looping/v3/device/delete"
V3_SIMPLER_REVERSE_ADDRESS = "/looping/v3/simpler/reverse"
V3_SIMPLER_WARP_HALF_ADDRESS = "/looping/v3/simpler/warp_half"
V3_SIMPLER_WARP_DOUBLE_ADDRESS = "/looping/v3/simpler/warp_double"

V3_ERROR_ADDRESS = "/looping/v3/error"


# --- error codes (match 04 §7.2) ------------------------------------------

V3_ERROR_PATH_NOT_FOUND = "path-not-found"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"
V3_ERROR_WRITE_REJECTED = "write-rejected"


# Share the resolver-status → wire-code mapping style of the other
# path-addressed components (ClipsComponent, ClipPropertiesComponent).
_DEVICE_RESOLVE_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_WRITE_REJECTED,
    ResolveStatus.NOT_FOUND: V3_ERROR_PATH_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
}


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


class DeviceCommandsComponent:
    """Owns select + move_to_top + move_to_end for devices.

    Args:
        song: The Live ``Song``. Used for
            ``song.view.select_device(device)`` and
            ``song.move_device(device, target, index)``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
    """

    V3_DEVICE_SELECT_ADDRESS = V3_DEVICE_SELECT_ADDRESS
    V3_DEVICE_MOVE_TO_TOP_ADDRESS = V3_DEVICE_MOVE_TO_TOP_ADDRESS
    V3_DEVICE_MOVE_TO_END_ADDRESS = V3_DEVICE_MOVE_TO_END_ADDRESS
    V3_SIMPLER_REVERSE_ADDRESS = V3_SIMPLER_REVERSE_ADDRESS
    V3_SIMPLER_WARP_HALF_ADDRESS = V3_SIMPLER_WARP_HALF_ADDRESS
    V3_SIMPLER_WARP_DOUBLE_ADDRESS = V3_SIMPLER_WARP_DOUBLE_ADDRESS

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
    ) -> None:
        self._song = song
        self._emit = emit
        self._disconnected = False

    # --- wire handlers ---------------------------------------------------

    def handle_select(self, args, source_addr) -> None:
        """``[devicePath]`` — set the view's selected device.

        Mirrors Live's ``view.select_device(device)`` (blue-hand). Used
        by the UI tap gesture and as a convenience before opening a
        device-specific central view. Idempotent; selecting an already-
        selected device is a no-op at the LOM layer.
        """
        if self._disconnected:
            return
        address = V3_DEVICE_SELECT_ADDRESS
        if not self._check_arg_count(address, args, 1):
            return
        device_path = _coerce_str(args[0])
        device = self._resolve_device_or_error(address, device_path)
        if device is None:
            return
        try:
            self._song.view.select_device(device)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="select_device raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def handle_move_to_top(self, args, source_addr) -> None:
        """``[devicePath]`` — move the device to index 0 in its chain."""
        self._move_to(args, V3_DEVICE_MOVE_TO_TOP_ADDRESS, position="top")

    def handle_move_to_end(self, args, source_addr) -> None:
        """``[devicePath]`` — move the device to the last index in its chain."""
        self._move_to(args, V3_DEVICE_MOVE_TO_END_ADDRESS, position="end")

    def handle_delete(self, args, source_addr) -> None:
        """``[devicePath]`` — remove the device from its chain (issue #491,
        protocol 3.8.0). ``parent.delete_device(index)`` on whatever
        ``canonical_parent`` is — a track, or since the pad grammar a
        drum pad's chain — with the index found by LOM identity, never
        by the path's own number (the path is a position and the parent
        list is the truth). Errors: ``write-rejected`` (LOM raise, no
        parent, device not in its parent's list), ``path-not-found``,
        ``path-not-supported``."""
        if self._disconnected:
            return
        if not self._check_arg_count(V3_DEVICE_DELETE_ADDRESS, args, 1):
            return
        device_path = _coerce_str(args[0])
        device = self._resolve_device_or_error(V3_DEVICE_DELETE_ADDRESS, device_path)
        if device is None:
            return
        try:
            parent = device.canonical_parent
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_DEVICE_DELETE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="canonical_parent raised: %s: %s" % (type(e).__name__, str(e)[:80]),
            )
            return
        if parent is None:
            self._emit_error(
                V3_DEVICE_DELETE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=device_path, detail="device has no canonical_parent",
            )
            return
        try:
            siblings = list(parent.devices)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_DEVICE_DELETE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="parent.devices read raised: %s: %s" % (type(e).__name__, str(e)[:80]),
            )
            return
        index = next(
            (i for i, d in enumerate(siblings) if d is device or path_resolver.same_lom_handle(d, device)),
            None,
        )
        if index is None:
            self._emit_error(
                V3_DEVICE_DELETE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=device_path, detail="device not in its parent's list",
            )
            return
        try:
            parent.delete_device(index)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_DEVICE_DELETE_ADDRESS, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="delete_device raised: %s: %s" % (type(e).__name__, str(e)[:80]),
            )

    def handle_simpler_reverse(self, args, source_addr) -> None:
        """``[devicePath]`` — flip the loaded sample in place.

        Resolved to ``SimplerDevice.reverse()``. Verified via
        `/looping/probe/lom_invoke` to actually flip the sample
        (visual confirmation + `sample.warp_markers` rebuild).
        Symmetric — calling twice un-reverses.
        """
        self._invoke_simpler_method(
            args, V3_SIMPLER_REVERSE_ADDRESS, "reverse",
        )

    def handle_simpler_warp_half(self, args, source_addr) -> None:
        """``[devicePath]`` — halve the warped sample tempo (Simpler).

        Resolved to ``SimplerDevice.warp_half()``. Requires
        ``sample.warping`` to be True; the UI hides the button when
        warping is off, but the surface no-ops gracefully if the LOM
        rejects the call (logged at WARN, no UI error).
        """
        self._invoke_simpler_method(
            args, V3_SIMPLER_WARP_HALF_ADDRESS, "warp_half",
        )

    def handle_simpler_warp_double(self, args, source_addr) -> None:
        """``[devicePath]`` — double the warped sample tempo (Simpler)."""
        self._invoke_simpler_method(
            args, V3_SIMPLER_WARP_DOUBLE_ADDRESS, "warp_double",
        )

    # --- internal --------------------------------------------------------

    def _move_to(self, args, address: str, position: str) -> None:
        """Shared body for move_to_top / move_to_end.

        Resolves the devicePath, reads ``canonical_parent`` to locate
        the destination track / rack, then calls
        ``song.move_device(device, parent, target_index)``.

        ``target_index`` is ``0`` for top; for end it's
        ``len(parent.devices)``. Live's ``move_device`` treats the
        index as the position *before removing the source from its
        current slot*, so to land at the last position we pass
        ``device_count`` (not ``device_count - 1`` — that lands on
        second-from-end because Live shifts the source out first and
        then inserts at the old-index). ``device_count`` is accepted
        by LOM and means "append"; larger values are rejected.
        Reading ``parent.devices`` after we have the parent is a
        one-off LOM touch; we don't cache anything.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(address, args, 1):
            return
        device_path = _coerce_str(args[0])
        device = self._resolve_device_or_error(address, device_path)
        if device is None:
            return
        try:
            parent = device.canonical_parent
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="canonical_parent raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if parent is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path, detail="device has no canonical_parent",
            )
            return
        try:
            device_count = len(parent.devices)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="parent.devices read raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if device_count == 0:
            # Shouldn't happen (the device we resolved lives in the
            # parent's chain) but guard to keep the index math safe.
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path, detail="parent.devices is empty",
            )
            return
        target_index = 0 if position == "top" else device_count
        try:
            self._song.move_device(device, parent, target_index)
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="move_device raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )

    def _invoke_simpler_method(
        self, args, address: str, method_name: str,
    ) -> None:
        """Resolve devicePath, gate on Simpler class, call ``method_name()``.

        Class gate uses ``device.class_name == 'OriginalSimpler'`` —
        same identifier the property layer uses (see
        ``data/device-configs.json`` and the
        ``feedback_default_name_matches_adv_filename`` memory).
        """
        if self._disconnected:
            return
        if not self._check_arg_count(address, args, 1):
            return
        device_path = _coerce_str(args[0])
        device = self._resolve_device_or_error(address, device_path)
        if device is None:
            return
        try:
            class_name = getattr(device, "class_name", "")
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="class_name read raised: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        if class_name != "OriginalSimpler":
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="device is %r, not OriginalSimpler" % class_name,
            )
            return
        method = getattr(device, method_name, None)
        if not callable(method):
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="Simpler has no callable %s" % method_name,
            )
            return
        try:
            method()
        except _LOM_ERRORS as e:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                path=device_path,
                detail="%s raised: %s: %s" % (
                    method_name, type(e).__name__, str(e)[:80],
                ),
            )

    def _check_arg_count(
        self, originating_address: str, args, expected: int,
    ) -> bool:
        """Gate on positional-arg count; emit ``write-rejected`` on mismatch."""
        if len(args) == expected:
            return True
        self._emit_error(
            originating_address, V3_ERROR_WRITE_REJECTED,
            path="",
            detail="arg-count: expected %d, got %d" % (
                expected, len(args),
            ),
        )
        return False

    def _resolve_device_or_error(
        self, originating_address: str, device_path: str,
    ) -> Optional[object]:
        """Resolve ``device_path`` and emit a typed error on failure."""
        result = path_resolver.resolve_device(self._song, device_path)
        if result.status is ResolveStatus.OK:
            return result.obj
        code = _DEVICE_RESOLVE_ERROR_MAP.get(
            result.status, V3_ERROR_WRITE_REJECTED,
        )
        self._emit_error(
            originating_address, code,
            path=device_path, detail=result.detail or "",
        )
        return None

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
            "DeviceCommandsComponent: emit error addr=%r code=%r "
            "path=%r detail=%r",
            originating_address, code, path, detail,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (originating_address, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "DeviceCommandsComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
