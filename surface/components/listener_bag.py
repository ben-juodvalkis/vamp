"""ListenerBag: the ``(target, attr, cb)`` records a component keeps so it
can detach exactly the listeners it attached, on the wrappers it attached
them to.

Live hands out a fresh Python wrapper per attribute read, so a detach must
go through the wrapper the attach used, never a fresh read (ADR-350). Every
component that holds LOM listeners kept its own list or dict of those
records and its own guarded add/remove loop; this is that loop, once.
``RackChainDevicesComponent._add`` / ``_detach_all`` is the shape it was
taken from.

- :meth:`add` calls ``target.add_<attr>_listener(cb)`` and records it only
  when the call succeeded. A target without the method is skipped
  (``on_missing``), a raise is reported (``on_error``) and nothing is kept.
- :meth:`clear` calls ``remove_<attr>_listener(cb)`` on every record and
  empties the bag. A stale handle (the C++ object is already gone, so the
  listener is too) is logged at DEBUG; any other LOM error at
  ``remove_level``. Nothing raises out of it.

Every record carries an optional ``tag`` (a path, a key) for callers that
need to know which records they hold. Import relatively
(``from .listener_bag import ListenerBag``).
"""

from __future__ import annotations

import logging
from typing import Callable, Hashable, Iterator, List, Optional, Tuple

from ._common import LOM_ERRORS
from .LOMListeners import _is_stale_handle_error

logger = logging.getLogger("looping")

Record = Tuple[object, str, Callable, Optional[Hashable]]


class ListenerBag:
    __slots__ = ("_owner", "_records", "_remove_level", "_on_remove_error")

    def __init__(
        self,
        owner: str = "",
        remove_level: int = logging.WARNING,
        on_remove_error: Optional[Callable[[str, BaseException], None]] = None,
    ) -> None:
        """``on_remove_error(attr, exc)``, when given, takes a failed detach
        in place of the log line (a component's own ``_warn_once``)."""
        self._owner = owner
        self._remove_level = remove_level
        self._on_remove_error = on_remove_error
        self._records: List[Record] = []

    def add(
        self,
        target,
        attr: str,
        cb: Callable,
        tag: Optional[Hashable] = None,
        on_error: Optional[Callable[[BaseException], None]] = None,
        on_missing: Optional[Callable[[], None]] = None,
    ) -> bool:
        """Attach ``cb`` as ``target``'s ``attr`` listener; ``True`` when it
        is attached (and recorded)."""
        adder = getattr(target, "add_%s_listener" % attr, None)
        if not callable(adder):
            if on_missing is not None:
                on_missing()
            return False
        try:
            adder(cb)
        except LOM_ERRORS as e:
            if on_error is not None:
                on_error(e)
            else:
                logger.debug("%s: add_%s_listener failed: %s", self._owner, attr, e)
            return False
        self._records.append((target, attr, cb, tag))
        return True

    def track(self, target, attr: str, cb: Callable, tag: Optional[Hashable] = None) -> None:
        """Record a listener attached elsewhere, so :meth:`clear` detaches it."""
        self._records.append((target, attr, cb, tag))

    def clear(self) -> None:
        """Detach every recorded listener and forget them all."""
        records, self._records = self._records, []
        for target, attr, cb, tag in records:
            self._remove(target, attr, cb, tag)

    def remove_tag(self, tag: Hashable) -> None:
        """Detach and forget the records carrying ``tag``."""
        keep: List[Record] = []
        for rec in self._records:
            if rec[3] == tag:
                self._remove(*rec)
            else:
                keep.append(rec)
        self._records = keep

    def tags(self) -> List[Optional[Hashable]]:
        return [rec[3] for rec in self._records]

    def __contains__(self, tag) -> bool:
        return any(rec[3] == tag for rec in self._records)

    def __len__(self) -> int:
        return len(self._records)

    def __bool__(self) -> bool:
        return bool(self._records)

    def __iter__(self) -> Iterator[Record]:
        return iter(list(self._records))

    def _remove(self, target, attr: str, cb: Callable, tag) -> None:
        remover = getattr(target, "remove_%s_listener" % attr, None)
        if not callable(remover):
            return
        try:
            remover(cb)
        except LOM_ERRORS as e:
            if self._on_remove_error is not None:
                self._on_remove_error(attr, e)
            elif _is_stale_handle_error(e):
                logger.debug(
                    "%s: remove_%s_listener %s: stale LOM handle (already torn down): %s",
                    self._owner, attr, tag if tag is not None else "", e,
                )
            else:
                logger.log(
                    self._remove_level, "%s: remove_%s_listener %s failed: %s",
                    self._owner, attr, tag if tag is not None else "", e,
                )
