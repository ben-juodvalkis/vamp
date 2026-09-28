"""ScenesComponent — Phase 7 PR-7b scene write + scene-count observer.

Owns the UI→Surf scene-lifecycle addresses:

    /looping/v3/scene/launch   [scenePath]
    /looping/v3/scene/stop     [scenePath]

And the song-scope ``scenes`` listener that rides ``state/full``
on scene add/remove (no targeted wire emit — scene churn
restructures every track's ``clip_slots``, so re-riding state/full
is cheaper than enumerating affected paths; see
[phase-7-pr7b-design.md §2.6](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/phase-7-pr7b-design.md#26-scene-count-observer--on-songadd_scenes_listener)).

``/scene/stop`` is a per-track synthetic: LOM has no ``scene.stop()``
method that stops the clips a prior ``scene.fire()`` already started.
The handler iterates ``song.tracks`` and calls
``track.stop_all_clips()`` on each — design §2.4.

Rows landed so far
------------------

- **pr7b-6** — this component. ``handle_launch``, ``handle_stop``,
  ``scenes`` listener attach/detach, ``disconnect`` idempotence.
  Surface wiring lands in pr7b-8.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from . import path_resolver
from .path_resolver import ResolveStatus

logger = logging.getLogger("looping")


# Tuple of exceptions every LOM touch in this module must catch.
# Includes ``TypeError`` for ``Boost.Python.ArgumentError`` per
# [CLAUDE.md] merge-gate rule (9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_SCENE_LAUNCH_ADDRESS = "/looping/v3/scene/launch"
V3_SCENE_STOP_ADDRESS = "/looping/v3/scene/stop"

V3_ERROR_ADDRESS = "/looping/v3/error"


# --- error codes (closed-enum per 04 §7.2) --------------------------------

V3_ERROR_SCENE_NOT_FOUND = "scene-not-found"
V3_ERROR_LAUNCH_FAILED = "launch-failed"
V3_ERROR_WRITE_REJECTED = "write-rejected"
V3_ERROR_PATH_NOT_SUPPORTED = "path-not-supported"


# --- helpers --------------------------------------------------------------


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


# ResolveStatus → wire-error-code mapping for scenePath. NOT_FOUND
# surfaces ``scene-not-found`` (the dedicated code for index-oob
# scene paths per 04 §7.2); MALFORMED stays ``write-rejected`` as
# grammar failures don't warrant a scene-specific code.
_SCENE_RESOLVE_ERROR_MAP = {
    ResolveStatus.MALFORMED: V3_ERROR_WRITE_REJECTED,
    ResolveStatus.NOT_FOUND: V3_ERROR_SCENE_NOT_FOUND,
    ResolveStatus.NOT_SUPPORTED: V3_ERROR_PATH_NOT_SUPPORTED,
}


class ScenesComponent:
    """Owns the scene-lifecycle wire.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.
        advance_generation: Callable taking a reason string
            (``"scenes-changed"``) and advancing the shared
            generation counter. Invoked from the ``scenes`` listener.
    """

    def __init__(
        self,
        song,
        emit: Callable[[str, tuple], None],
        advance_generation: Callable[[str], None],
    ) -> None:
        self._song = song
        self._emit = emit
        self._advance_generation = advance_generation
        self._disconnected = False
        self._scenes_listener: Optional[Callable] = None
        self._attach_scenes_listener()
        logger.info("ScenesComponent: ready")

    # --- wire handlers ----------------------------------------------------

    def handle_launch(self, args, source_addr) -> None:
        """``[scenePath]`` — launch all clips in the scene.

        Resolves ``scenePath``, calls ``scene.fire()``. Per-track
        empties are silent no-ops at the Live layer (``scene.fire()``
        on a scene with no clips is idempotent). ``launch-failed``
        fires only on a ``_LOM_ERRORS`` exception.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_SCENE_LAUNCH_ADDRESS, args, 1):
            return
        scene_path = _coerce_str(args[0])
        scene = self._resolve_scene_or_error(
            V3_SCENE_LAUNCH_ADDRESS, scene_path,
        )
        if scene is None:
            return
        try:
            scene.fire()
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_SCENE_LAUNCH_ADDRESS,
                V3_ERROR_LAUNCH_FAILED,
                path=scene_path,
                detail="%s: %s" % (type(e).__name__, str(e)[:80]),
            )

    def handle_stop(self, args, source_addr) -> None:
        """``[scenePath]`` — per-track synthetic stop.

        Design §2.4: LOM has no ``scene.stop()`` that stops already-
        playing clips. Iterate ``song.tracks`` and call
        ``track.stop_all_clips()`` on each — equivalent to firing
        ``/clip/stop`` against every track.

        The ``scenePath`` argument is validated (resolved) so an
        out-of-range scene index produces ``scene-not-found`` rather
        than silently stopping everything. The resolved scene object
        itself is unused beyond validation.
        """
        if self._disconnected:
            return
        if not self._check_arg_count(V3_SCENE_STOP_ADDRESS, args, 1):
            return
        scene_path = _coerce_str(args[0])
        scene = self._resolve_scene_or_error(
            V3_SCENE_STOP_ADDRESS, scene_path,
        )
        if scene is None:
            return
        # Iterate all regular tracks and stop each. Master has no
        # clip_slots to stop — skipped implicitly since we walk
        # song.tracks, not iter_all_tracks. Return tracks are not
        # playing clips in Phase 1.
        try:
            tracks = tuple(self._song.tracks)
        except _LOM_ERRORS as e:
            self._emit_error(
                V3_SCENE_STOP_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=scene_path,
                detail="song.tracks read failed: %s: %s" % (
                    type(e).__name__, str(e)[:80],
                ),
            )
            return
        failed_tracks = 0
        for idx, track in enumerate(tracks):
            try:
                track.stop_all_clips()
            except _LOM_ERRORS as e:
                failed_tracks += 1
                logger.warning(
                    "ScenesComponent: tracks/%d.stop_all_clips raised: "
                    "%s: %s", idx, type(e).__name__, str(e)[:80],
                )
        if failed_tracks:
            self._emit_error(
                V3_SCENE_STOP_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                path=scene_path,
                detail="stop_all_clips raised on %d/%d tracks" % (
                    failed_tracks, len(tracks),
                ),
            )

    # --- scenes listener --------------------------------------------------

    def _attach_scenes_listener(self) -> None:
        """Attach ``song.add_scenes_listener`` if available.

        Older stubs and older Live builds may not expose the
        listener; log and continue so the component still serves
        write-handler requests.
        """
        if self._disconnected:
            return
        add_listener = getattr(self._song, "add_scenes_listener", None)
        if not callable(add_listener):
            return
        try:
            add_listener(self._on_scenes_changed)
        except _LOM_ERRORS as e:
            logger.warning(
                "ScenesComponent: add_scenes_listener failed: %s", e,
            )
            return
        self._scenes_listener = self._on_scenes_changed

    def _on_scenes_changed(self) -> None:
        """Scene add/remove fire path. Design §2.6: advance
        generation only — no targeted wire emit. The state/full
        scheduler handles the rebuild on the next tick."""
        if self._disconnected:
            return
        try:
            self._advance_generation("scenes-changed")
        except Exception as e:
            logger.warning(
                "ScenesComponent: advance_generation raised: %s", e,
            )

    def _detach_scenes_listener(self) -> None:
        """Symmetric detach. Swallows raises so teardown always
        completes even when the LOM handle is torn down."""
        if self._scenes_listener is None:
            return
        remove_listener = getattr(self._song, "remove_scenes_listener", None)
        if callable(remove_listener):
            try:
                remove_listener(self._scenes_listener)
            except _LOM_ERRORS as e:
                logger.warning(
                    "ScenesComponent: remove_scenes_listener failed: %s", e,
                )
        self._scenes_listener = None

    # --- internal ---------------------------------------------------------

    def _check_arg_count(
        self,
        originating_address: str,
        args,
        expected: int,
    ) -> bool:
        """Gate on positional-arg count; emit ``write-rejected`` on mismatch."""
        if len(args) == expected:
            return True
        self._emit_error(
            originating_address,
            V3_ERROR_WRITE_REJECTED,
            path="",
            detail="arg-count: expected %d, got %d" % (expected, len(args)),
        )
        return False

    def _resolve_scene_or_error(
        self,
        originating_address: str,
        scene_path: str,
    ) -> Optional[object]:
        """Resolve ``scene_path`` and emit a typed error on failure.

        Returns the scene object on OK, ``None`` otherwise.
        """
        result = path_resolver.resolve_scene(self._song, scene_path)
        if result.status is ResolveStatus.OK:
            return result.obj
        code = _SCENE_RESOLVE_ERROR_MAP.get(
            result.status,
            V3_ERROR_WRITE_REJECTED,
        )
        self._emit_error(
            originating_address,
            code,
            path=scene_path,
            detail=result.detail or "",
        )
        return None

    def _emit_error(
        self,
        originating_address: str,
        code: str,
        path: str,
        detail: str,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, path, detail]``.
        Four-arg shape — matches ClipsComponent and every other v3
        component."""
        if self._disconnected:
            return
        logger.warning(
            "ScenesComponent: emit error addr=%r code=%r path=%r detail=%r",
            originating_address, code, path, detail,
        )
        try:
            self._emit(
                V3_ERROR_ADDRESS,
                (originating_address, code, path, detail),
            )
        except Exception as e:
            logger.warning(
                "ScenesComponent: emit %s failed: %s",
                V3_ERROR_ADDRESS, e,
            )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. Detaches the scenes listener and
        marks the component blocked."""
        if self._disconnected:
            return
        self._disconnected = True
        self._detach_scenes_listener()
