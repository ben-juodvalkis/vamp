"""SongChangeDetector — dormant guard (not wired in production).

**Status (2026-04-15):** this component is NOT instantiated in
``LoopingSurface.py``. Live 12.3.7 tears down and reconstructs the
entire Control Surface on File → Open (observed twice on 2026-04-15
— see the PR-3c revision entry in
Looping's ``documentation/archive/m4l-to-python-v3/implementation-log.md``),
so a surface-side song-change poll has nothing to detect: the old
detector is GC'd with the old surface, and the new one arms against
the new song as its baseline. Session-load invalidation is handled
UI-side — the fresh surface publishes ``state/full #1
reason=init`` on bring-up, and the UI treats that as a
surface-restart signal and re-runs the handshake.

The component + unit tests remain in-tree as a documented guard in
case a future Live release stops recycling the surface on
session-load. If that happens, re-wire by re-adding the
``SongChangeDetector`` import and instantiation in
``LoopingSurface.setup`` (previous wiring lived around the
``_on_structural_change_composite`` block), plus a ``check()`` call
in ``_tick`` and a ``disconnect()`` call in ``disconnect``.

---

Historical design notes (kept for the re-wire-if-needed path):

When the user loads a different ``.als`` (File → Open), Live rebinds
``ControlSurface.song`` to a new ``Song`` object but does not fire our
registered ``add_tracks_listener`` — listeners bound to the old song
silently orphan. Streak session 1 (2026-04-15) found the gap: the v3
surface stayed on the prior generation after File → Open and writes
landed on whatever happened to occupy the old positional paths in the
new set. See the 2026-04-15 ``streak-session-1`` entry in
``implementation-log.md`` and
[deferred-issues.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/deferred-issues.md).

This detector closes the gap with a cheap tick-driven poll: each
surface tick it reads ``application.get_document()`` and compares the
returned object's ``id()`` against the last seen id. On drift it
invokes the registered ``on_song_changed(new_song)`` callback. The
callback's job — wired in ``LoopingSurface`` — is to:

1. Rebind ``V3StateFullComponent``'s captured ``self._song`` to the
   new ``Song`` so the next walk reflects the loaded set's tree.
2. Advance ``GenerationComponent`` (which fires
   ``state/invalidate`` via ``InvalidationComponent.on_advance`` to
   keep the ordering guarantee in [04 §3.3]).
3. Emit a v3 ``state/full`` with ``reason="structural"`` so the UI
   rebuilds its normalized store against the new paths.

## Why a tick poll rather than a listener

[lom-reference.md](../../docs/reference/lom-reference.md) does not
document any ``Application`` listener that fires on ``get_document``
change. The Gate 4c verdict ([06 §2.1]) confirmed the framework
rebinds ``@listens``-decorated listeners across song load but raw
``add_tracks_listener`` bindings (which LOMListeners uses) orphan on
the old song. Polling ``application.get_document()`` each tick is
O(1), same cadence as the existing OSC drain, and avoids taking a
dependency on an undocumented framework behavior.

Ticks are ~100 ms in Live's embedded Python. A File → Open takes
seconds to visible state; a one-tick detection lag is imperceptible.

## Identity semantics

**Python's ``id()`` is unstable across ``application.get_document()``
calls.** Live wraps the Song in a fresh Python proxy object on every
``get_document()`` call, so ``id(application.get_document())`` flips
every tick even when the underlying Song is unchanged. Observed on
2026-04-15 during PR-3c's first live run: the detector storm-fired
every ~100 ms (generation blew past 1900 in seconds). The C++
Song object itself is stable though, and Live exposes its pointer
cookie as ``song._live_ptr`` (same value LOM uses internally for
object identity). The detector takes an ``identity_of(song)``
callable so production can use ``_live_ptr`` while tests can stay
on ``id()``. Production wiring passes
``lambda s: getattr(s, "_live_ptr", None) or id(s)`` — the fallback
keeps the component testable against stubs that don't define
``_live_ptr``.

## What this deliberately does NOT do

- It does **not** re-attach ``LOMListeners``'s root ``tracks`` listener
  against the new song. Streak session 1's exit criterion is
  "UI renders the new session after File → Open" — that is met by a
  single ``state/full`` bundle against the new tree. Re-attaching
  listeners so *subsequent* structural edits in the new session (add
  a track, reorder a device) are auto-detected is a Phase 4 concern
  filed in ``deferred-issues.md`` under the session-load entry. The
  three-session streak restarts from zero, so the typical flow is
  File → Open → handful of param writes → next session — not a
  marathon of structural edits within a session that began with a
  session-load.
- It does **not** reset generation to 1 per [04 §4.4]'s literal
  reading. A reset would be safe only if the UI is told via a new
  handshake, and handshake does not re-fire on File → Open
  (observed). Advance-through-the-boundary keeps ``ui < surf``
  strict ordering, which the stale-write rejection in [04 §4.2]
  already handles correctly — the UI's mirror catches up on the
  structural bundle we emit.

## Test surface

Unit tests cover the detector's three behaviors:

- First ``check()`` after construction does not fire (no drift yet).
- ``check()`` after the getter returns the same object is a no-op.
- ``check()`` after the getter returns a different object fires
  ``on_song_changed`` exactly once with the new object.

Live validation is scenario 7 in
[07 §1.7](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/07-validation-guide.md#17-session-load).
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

logger = logging.getLogger("looping")


class SongChangeDetector:
    """Polls ``get_current_song`` each tick; fires on identity drift.

    Args:
        get_current_song: Zero-arg callable returning the current
            ``Song`` object. Production wiring passes
            ``surface.application.get_document`` (bound method). Tests
            pass a closure over a mutable holder.
        on_song_changed: ``callable(new_song) -> None`` invoked when
            ``id(get_current_song())`` drifts from the last seen id.
            The callback is responsible for rebinding component song
            refs, advancing generation, and emitting the structural
            bundle.

    The detector captures the initial song id at construction, *not*
    from a first ``check()`` call — that way the first real tick of
    the surface cannot misfire as "changed from no-song-to-some-song"
    and triple-emit at bring-up.
    """

    def __init__(
        self,
        get_current_song: Callable[[], Any],
        on_song_changed: Callable[[Any], None],
        identity_of: Optional[Callable[[Any], Optional[int]]] = None,
    ):
        self._get_current_song = get_current_song
        self._on_song_changed = on_song_changed
        # Identity getter: production wiring passes a lambda that
        # reads Live's ``_live_ptr`` C++ cookie (stable across
        # ``application.get_document()`` calls); tests default to
        # ``id()`` since stubs don't define ``_live_ptr``. See the
        # "Identity semantics" section of the module docstring.
        self._identity_of = identity_of or (lambda s: id(s))
        self._disconnected = False
        try:
            initial = get_current_song()
        except Exception as e:
            # Application.get_document() should never raise in a live
            # surface, but a test fixture or a framework regression
            # might. Swallow and carry initial id as None — the first
            # successful poll will set it without firing the callback
            # (the guard below treats None as the "uninitialized"
            # sentinel).
            logger.error(
                "SongChangeDetector: initial get_current_song raised: %s",
                e,
            )
            initial = None
        self._last_song_id: Optional[int] = (
            self._safe_identity(initial) if initial is not None else None
        )
        if self._last_song_id is not None:
            logger.info(
                "SongChangeDetector: armed (initial song_id=%d)",
                self._last_song_id,
            )
        else:
            logger.warning(
                "SongChangeDetector: armed without initial song; "
                "first non-None poll will be treated as the baseline",
            )

    # --- public surface --------------------------------------------------

    def check(self) -> None:
        """Sample the current song; fire the callback on drift.

        Called from ``LoopingSurface._tick``. Safe to call even when
        the transport is down; the callback is the only thing that
        emits on the wire, and the callback itself is LoopingSurface's
        concern.
        """
        if self._disconnected:
            return
        try:
            current = self._get_current_song()
        except Exception as e:
            # Per the docstring: keep polling rather than latching a
            # failure. A transient framework hiccup shouldn't strand
            # the detector.
            logger.error(
                "SongChangeDetector: get_current_song raised: %s", e,
            )
            return
        if current is None:
            return
        current_id = self._safe_identity(current)
        if current_id is None:
            # Identity function returned None / raised. Nothing to
            # compare against; skip this tick so a transient hiccup
            # can't false-positive.
            return
        if self._last_song_id is None:
            # First successful poll after an unarmed construction.
            # Record the baseline, do not fire — there is no previous
            # session to invalidate from.
            self._last_song_id = current_id
            logger.info(
                "SongChangeDetector: baseline set (song_id=%d) after "
                "unarmed construction",
                current_id,
            )
            return
        if current_id == self._last_song_id:
            return
        old = self._last_song_id
        self._last_song_id = current_id
        logger.info(
            "SongChangeDetector: song changed (old=%d, new=%d); "
            "firing on_song_changed",
            old, current_id,
        )
        try:
            self._on_song_changed(current)
        except Exception as e:
            # A raising callback must not strand the detector. The
            # next tick will re-check; if the same drift is still
            # visible (same old→new transition) the id will already
            # match the new snapshot, so no re-fire — the callback's
            # failure mode is "one missed invalidate", not "stuck
            # storm". Log with traceback.
            logger.error(
                "SongChangeDetector: on_song_changed raised: %s",
                e, exc_info=True,
            )

    # --- internals -------------------------------------------------------

    def _safe_identity(self, song) -> Optional[int]:
        """Call the identity function; swallow exceptions to None.

        A raising ``identity_of`` must not strand the detector or
        cause a false "song changed" reading. Returning None tells
        the caller to skip this tick.
        """
        try:
            value = self._identity_of(song)
        except Exception as e:
            logger.error(
                "SongChangeDetector: identity_of raised: %s", e,
            )
            return None
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            logger.error(
                "SongChangeDetector: identity_of returned non-int %r",
                value,
            )
            return None

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent; freezes the detector."""
        if self._disconnected:
            return
        self._disconnected = True
