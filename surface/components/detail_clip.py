"""What the clip-scoped components share about the clip Live shows and the
clip a write names.

``ClipNotesComponent``, ``ClipPropertiesComponent`` and ``GrooveComponent``
each follow ``song.view.detail_clip`` with a listener of their own (one per
component, so a teardown of one cannot leave another deaf) and each pasted
the same view read, listener attach, guarded ``detail_clip`` read and
detach. :class:`DetailClipWatch` is that, once; the component keeps its
own refocus. ``parse_clip_arg`` and ``encode_scalar`` are the setter-side
helpers ClipProperties and Groove both carried. Import relatively
(``from .detail_clip import DetailClipWatch``).
"""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from . import path_resolver
from ._common import LOM_ERRORS

logger = logging.getLogger("looping")

#: ``warn(key, context, exc)``: the owning component's ``_warn_once``.
Warn = Callable[[str, str, BaseException], None]


class DetailClipWatch:
    """A ``detail_clip`` listener on ``song.view``, attached on construction.

    ``view`` is ``None`` when ``song.view`` cannot be read; ``attached``
    says whether the listener went on. Every LOM failure goes to ``warn``
    under the keys the components always used (``song.view``/``read``,
    ``detail_clip``/``attach`` | ``read`` | ``detach``).
    """

    __slots__ = ("view", "attached", "_on_change", "_warn")

    def __init__(self, song, on_change: Callable[[], None], warn: Warn) -> None:
        self._on_change = on_change
        self._warn = warn
        self.attached = False
        try:
            self.view = song.view
        except LOM_ERRORS as e:
            warn("song.view", "read", e)
            self.view = None
            return
        try:
            self.view.add_detail_clip_listener(on_change)
            self.attached = True
        except LOM_ERRORS as e:
            warn("detail_clip", "attach", e)

    def read(self):
        """``song.view.detail_clip``, or ``None`` on any LOM quirk."""
        if self.view is None:
            return None
        try:
            return self.view.detail_clip
        except LOM_ERRORS as e:
            self._warn("detail_clip", "read", e)
            return None

    def detach(self) -> None:
        if self.attached and self.view is not None:
            try:
                self.view.remove_detail_clip_listener(self._on_change)
            except LOM_ERRORS as e:
                self._warn("detail_clip", "detach", e)
        self.attached = False


def focus_path(song, clip, warn: Warn) -> Optional[str]:
    """The session path of ``clip`` (``tracks/N/slots/M/clip``), or ``None``
    for no clip, an arrangement clip, or a raising resolve."""
    if clip is None:
        return None
    try:
        return path_resolver.clip_path_for(song, clip)
    except LOM_ERRORS as e:
        warn("clip_path_for", "refocus", e)
        return None


def parse_clip_arg(song, args, owner: str, attr_name: str) -> Tuple[Optional[object], Optional[str]]:
    """Resolve ``args[0]`` as a clipPath: ``(clip, path)``, or
    ``(None, None)`` after a warning for empty args, a non-string path or
    a path that does not resolve."""
    if not args:
        logger.warning("%s set %s: empty args, ignoring", owner, attr_name)
        return None, None
    raw = args[0]
    if not isinstance(raw, str):
        logger.warning("%s set %s: clipPath not a string: %r", owner, attr_name, raw)
        return None, None
    r = path_resolver.resolve_clip(song, raw)
    if not r.ok:
        logger.warning(
            "%s set %s: clipPath %r unresolved: %s (%s)",
            owner, attr_name, raw, r.status.value, r.detail,
        )
        return None, None
    return r.obj, raw


#: The scalar shapes a ``clip/property`` or ``clip/groove`` value takes.
SCALAR_INT = "int"
SCALAR_FLOAT = "float"
SCALAR_BOOL01 = "bool01"


def encode_scalar(kind: Optional[str], raw):
    """A LOM value as the wire's single scalar, or ``None`` when it will
    not coerce (or ``kind`` is unknown)."""
    if kind == SCALAR_INT:
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    if kind == SCALAR_FLOAT:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    if kind == SCALAR_BOOL01:
        try:
            return 1 if bool(raw) else 0
        except Exception:
            return None
    return None
