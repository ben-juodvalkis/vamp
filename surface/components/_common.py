"""Small helpers every surface component used to paste for itself.

Dependency-free on purpose: no Live import and no sibling import, so any
component can take these without an import cycle. Import relatively
(``from ._common import LOM_ERRORS, coerce_str``); the absolute form passes
pytest and fails inside Live (surface/CLAUDE.md).
"""

from typing import Tuple

#: What a LOM read or write raises on a torn-down or refused handle.
#: ``TypeError`` covers ``Boost.Python.ArgumentError``. A component that
#: also wants ``IndexError`` / ``ValueError`` adds them at its call site.
LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


def coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``: bytes → utf-8, ``None`` → ``""``.

    ``None`` shows up when the OSC encoder collapses an empty string, and
    reads as ``""`` so an empty-path check stays reachable.
    """
    if x is None:
        return ""
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)
