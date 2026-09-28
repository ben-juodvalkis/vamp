"""GroovePoolComponent — PR-5e2 song-scoped groove pool bookkeeping.

Owns ``song.groove_pool.grooves`` — the Live project's shared
groove pool — and the operations that rename pool entries in and
out of the ``unassigned-<idx>`` / ``Clip_<pathHash>`` tag scheme
that marks which grooves are currently claimed by clips.

Scope — song-scoped, not focus-scoped
-------------------------------------

The pool is a shared resource. Any clip in the set can claim a
pool entry or return one; any Live-UI action (user dragging a
groove preset into the pool from the browser, user renaming a
pool entry by hand) can mutate pool state. This component keeps
its listener on the pool **always**, regardless of whether any
clip is focused, so external pool mutations are observable and
the verbs stay available to ``GrooveComponent`` on writes that
target non-focused clips.

This is distinct from the sibling ``GrooveComponent`` (focus-
scoped — see that module). Split per [phase-5-pr5e2-design.md §2].

Public surface
--------------

``find_unassigned_groove()`` — linear scan of ``grooves`` for the
first entry whose ``name`` starts with ``"unassigned-"``. Returns
the ``Groove`` object or ``None`` if the pool is fully claimed.
Mirrors ``liveAPI-v6.js:4720-4738``.

``assign_groove_to_clip(clip, clip_path)`` — rename-then-link
atom:

1. Find an unassigned groove. If None, raise ``PoolExhausted``.
2. Rename it to ``Clip_<pathHash>`` (the claim).
3. Assign it to ``clip.groove`` (the link).

The ordering invariant matters even though Live's single-tick
loop makes the critical section effectively atomic. See
[design §8].

``return_groove_to_pool(clip_path)`` — the inverse verb. Looks
up the groove currently named ``Clip_<pathHash(clip_path)>``,
renames it back to ``unassigned-<idx>`` (where ``idx`` is its
position in the pool — matches M4L's naming convention so legacy
tools reading the pool name remain correct).

``path_hash(clip_path)`` — deterministic 8-char hash used for
the tag. ``hashlib.sha1(clip_path.encode("utf-8")).hexdigest()[:8]``.

Tag format interop
------------------

New claims use ``Clip_<pathHash>``. Legacy M4L claims use
``Clip_<liveId>``. Both coexist: ``find_unassigned_groove`` keys
on the ``unassigned-`` prefix, not on absence of ``Clip_``, so a
legacy entry is correctly skipped. No migration needed. See
[design §6.1].

LOM-touch guard
---------------

Every LOM read/write is wrapped in ``_LOM_ERRORS`` per the Live
12 quirks documented in ``project_live_lom_quirks.md``. Warnings
de-dupe through ``_warn_once(key, context)``.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Callable, Optional, Tuple

logger = logging.getLogger("looping")


# Same tuple shape as ClipPropertiesComponent — ``Boost.Python.ArgumentError``
# is a ``TypeError`` subclass raised on invalidated C++ handles.
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


_UNASSIGNED_PREFIX = "unassigned-"
_CLIP_TAG_PREFIX = "Clip_"


class PoolExhausted(Exception):
    """Raised when ``find_unassigned_groove`` returns None during a claim.

    Carries the ``clip_path`` of the write that triggered the
    assignment attempt so the caller can emit a
    ``/looping/v3/error pool-exhausted`` with the correct path.
    """

    def __init__(self, clip_path: str):
        super().__init__(
            "pool-exhausted for clip_path=%r" % (clip_path,),
        )
        self.clip_path = clip_path


def path_hash(clip_path: str) -> str:
    """8-char sha1 prefix of the UTF-8 encoded path.

    Deterministic, collision-safe at the pool's practical scale
    (tens of grooves per project, so pair-collision probability
    2⁻³² is ignorable). Lives at module scope so tests can use
    it directly without instantiating the component.
    """
    return hashlib.sha1(clip_path.encode("utf-8")).hexdigest()[:8]


class GroovePoolComponent:
    """Song-scoped groove pool observer + assign/return verbs.

    Args:
        song: Live ``Song`` (test: stub with ``groove_pool.grooves``).
        emit: ``(address, args) -> None`` — OSC sender. Currently
            unused (pool has no UI-visible state of its own; all
            UI emits flow through GrooveComponent) but kept for
            symmetry with sibling components and future use.

    Lifecycle:
        ``__init__`` attaches the ``groove_pool.grooves`` list
        listener (always on). ``disconnect`` detaches it.
    """

    def __init__(self, song, emit: Callable[[str, tuple], None]):
        self._song = song
        self._emit = emit
        self._disconnected = False

        # ``(key, context) -> True`` once warned, for de-dupe.
        self._warned: set = set()

        self._pool = self._safe_groove_pool()
        self._grooves_listener_attached = False
        self._grooves_listener_cb: Optional[Callable[[], None]] = None
        if self._pool is not None:
            cb = self._on_grooves_changed
            try:
                self._pool.add_grooves_listener(cb)
                self._grooves_listener_attached = True
                self._grooves_listener_cb = cb
            except _LOM_ERRORS as e:
                self._warn_once("grooves", "attach", e)

        logger.info(
            "GroovePoolComponent init: pool=%s listener=%s",
            "ok" if self._pool is not None else "missing",
            self._grooves_listener_attached,
        )

    # --- listener ----------------------------------------------------------

    def _on_grooves_changed(self) -> None:
        """Fires when the pool's grooves list changes.

        Structural notification only — the pool's contents changed
        (entry added, removed, or reordered). We don't emit
        anything to UI today: pool state is only surfaced via
        GrooveComponent's focused-clip has_groove / amount emits.
        The listener exists to exercise the pool attribute so LOM
        keeps the reference live, and to provide a hook for future
        pool-wide UI (e.g. a Phase 7 groove browser).
        """
        if self._disconnected:
            return
        # No emit today. Cheap probe-log at DEBUG so
        # validation can confirm the listener fires.
        logger.debug("GroovePoolComponent: grooves list fired")

    # --- pool scan + verbs -------------------------------------------------

    def find_unassigned_groove(self):
        """Return first ``unassigned-*`` groove, or None.

        Linear scan of ``pool.grooves`` in list order. Matches
        M4L's ``findUnassignedGroove`` (liveAPI-v6.js:4720) so
        the pool walk stays predictable across the migration.

        Skips:
        - ``Clip_<pathHash>`` entries (v3 claims).
        - ``Clip_<liveId>`` entries (legacy M4L claims).
        - Any other name not starting with ``unassigned-`` (e.g.
          Ableton preset grooves dragged in from the browser).
        """
        grooves = self._safe_grooves_list()
        if grooves is None:
            return None
        for groove in grooves:
            name = self._safe_read_name(groove)
            if name is None:
                continue
            if name.startswith(_UNASSIGNED_PREFIX):
                return groove
        return None

    def assign_groove_to_clip(self, clip, clip_path: str):
        """Rename-then-link: claim an unassigned groove for ``clip``.

        Order is critical. See [design §8]:
        1. Find an unassigned groove. If None, raise PoolExhausted.
        2. Rename the groove (the claim). If this raises, nothing
           is linked; rollback is a no-op.
        3. Assign the groove to the clip (the link). If this raises,
           the groove is named-but-orphaned. Next delete-return sweep
           reclaims it.

        Returns the assigned groove object on success.
        """
        groove = self.find_unassigned_groove()
        if groove is None:
            raise PoolExhausted(clip_path)

        new_name = _CLIP_TAG_PREFIX + path_hash(clip_path)
        try:
            groove.name = new_name
        except _LOM_ERRORS as e:
            logger.warning(
                "GroovePoolComponent assign rename raised: %s (clip_path=%r)",
                e, clip_path,
            )
            raise

        try:
            clip.groove = groove
        except _LOM_ERRORS as e:
            logger.warning(
                "GroovePoolComponent assign link raised: %s (clip_path=%r, "
                "groove=%r) — groove left named-but-orphaned",
                e, clip_path, new_name,
            )
            raise

        return groove

    def return_groove_to_pool(self, clip_path: str) -> bool:
        """Rename ``Clip_<pathHash(clip_path)>`` back to ``unassigned-<idx>``.

        Returns True on return, False when the tag was not found
        (e.g. the clip had no groove, or a previous call already
        reclaimed it).

        Linear scan — same cost shape as ``find_unassigned_groove``.
        ``<idx>`` is the groove's position in the pool; matches M4L's
        naming convention so external tools reading names stay
        correct.
        """
        target_tag = _CLIP_TAG_PREFIX + path_hash(clip_path)
        grooves = self._safe_grooves_list()
        if grooves is None:
            return False
        for idx, groove in enumerate(grooves):
            name = self._safe_read_name(groove)
            if name is None:
                continue
            if name == target_tag:
                new_name = _UNASSIGNED_PREFIX + str(idx)
                try:
                    groove.name = new_name
                except _LOM_ERRORS as e:
                    logger.warning(
                        "GroovePoolComponent return rename raised: %s "
                        "(clip_path=%r, target=%r, new=%r)",
                        e, clip_path, target_tag, new_name,
                    )
                    return False
                return True
        return False

    # --- emit_on_accept ----------------------------------------------------

    def emit_on_accept(self) -> None:
        """Handshake-accept re-emit hook.

        Pool has no UI-visible state of its own — grooves only
        surface via GrooveComponent's focus-scoped emits. This
        method is present for symmetry with the
        ``_emit_on_accept_chain`` convention and is deliberately
        a no-op.
        """
        return

    # --- LOM guards --------------------------------------------------------

    def _safe_groove_pool(self):
        try:
            return self._song.groove_pool
        except _LOM_ERRORS as e:
            self._warn_once("song.groove_pool", "read", e)
            return None

    def _safe_grooves_list(self):
        if self._pool is None:
            return None
        try:
            return list(self._pool.grooves)
        except _LOM_ERRORS as e:
            self._warn_once("grooves", "read", e)
            return None

    def _safe_read_name(self, groove) -> Optional[str]:
        try:
            return groove.name
        except _LOM_ERRORS as e:
            self._warn_once("groove.name", "read", e)
            return None

    # --- diagnostics -------------------------------------------------------

    def _warn_once(self, key: str, context: str, exc: BaseException) -> None:
        slot = (key, context)
        if slot in self._warned:
            return
        self._warned.add(slot)
        logger.warning(
            "GroovePoolComponent %s (%s): %s (suppressing further warnings)",
            key, context, exc,
        )

    # --- lifecycle ---------------------------------------------------------

    def disconnect(self):
        if self._disconnected:
            return
        self._disconnected = True

        if (self._grooves_listener_attached and self._pool is not None
                and self._grooves_listener_cb is not None):
            try:
                self._pool.remove_grooves_listener(
                    self._grooves_listener_cb,
                )
            except _LOM_ERRORS as e:
                logger.warning(
                    "GroovePoolComponent grooves detach failed: %s", e,
                )
            self._grooves_listener_attached = False
            self._grooves_listener_cb = None
