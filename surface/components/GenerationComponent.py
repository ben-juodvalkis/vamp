"""GenerationComponent — authoritative structural-generation counter.

Per [04 §4](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#4-generation-numbering)
and [03 §7](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/03-target-architecture.md#7-generation-numbering):
v3 replaces pointer-id identity with positional paths, and uses a
monotonic ``int32`` **generation** to invalidate cached UI state on
structural change. Every v3 write carries the UI's current generation;
the surface compares and rejects with ``generation-stale`` if the UI
is behind.

Surface owns the authoritative counter; the UI mirrors it. The mirror
is refreshed by ``state/full/tree`` (carries ``generation``) and by
``state/invalidate`` (carries ``generation``). See
[04 §3.2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#32-state-full-chunking).

Structural changes that advance the counter (per [04 §4]):

- Track insert / delete
- Device add, remove, or reorder (on any track, master, or return)
- Plugin-initiated parameter list reconfig (e.g. VST preset load
  changing parameter count)
- Rack chain add/remove/reorder (future; deferred behind
  ``path-not-supported``)
- Clip create / delete
- Song or set load (counter resets to ``1`` on new session)

What does **NOT** advance (per [04 §4]):

- Parameter value changes (writes are the hot path; they stay cheap)
- Clip property edits (length, name, color, warp markers)
- Transport state (play/stop/tempo/metronome)
- Track mute/solo/arm

## Ordering guarantee

Per [04 §3.3](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#33-targeted-invalidation-new):
structural announcements (``state/full`` or ``state/invalidate``)
always precede the first ``param/value`` emission against the
post-advance tree. This component doesn't enforce the ordering by
itself — it just owns the int. The ``LoopingSurface`` wires the
structural-change listener so that ``advance()`` runs before
``StateFullComponent`` / ``MutationComponent`` re-emit. Live's
single-threaded Python embed gives us serial callback dispatch for
free.

## Wraparound

``int32`` = 2.1B. At a structural change every second (wildly
unrealistic — real rate is minutes to hours) wraparound is 68 years
away. Spec ([04 §4.3]) says treat the comparison as modular-int; in
practice no session hits it. This component just increments; nothing
special at the boundary.

Starting value is ``1`` per [04 §4.4]; ``0`` is reserved on the UI
side as "unset sentinel" and must not appear on the wire.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

logger = logging.getLogger("looping")

# Reserved sentinel per [04 §4.4] — never emit this.
UNSET_GENERATION = 0

# Starting generation per [04 §4.4]. A fresh session begins here; the
# first state/full/tree carries this value.
INITIAL_GENERATION = 1


class GenerationComponent:
    """Authoritative ``int32`` generation counter + on-advance hook.

    Args:
        on_advance: Optional ``callable(old_gen: int, new_gen: int,
            reason: str) -> None``. Fires synchronously at the end of
            ``advance()``. The LoopingSurface wires this to a structural
            announcer (``state/full`` or ``state/invalidate`` emitter)
            so the ordering guarantee in [04 §3.3] is preserved.
            ``None`` means no-op; used in unit tests that just want to
            observe the counter.

    The counter starts at ``INITIAL_GENERATION`` (1). The UNSET_GENERATION
    sentinel is never produced by this component.
    """

    def __init__(
        self,
        on_advance: Optional[Callable[[int, int, str], None]] = None,
    ):
        self._value = INITIAL_GENERATION
        self._on_advance = on_advance
        self._disconnected = False

    # --- counter access ---------------------------------------------------

    @property
    def current(self) -> int:
        """Current generation. Read-only; mutate via ``advance``."""
        return self._value

    def advance(self, reason: str) -> int:
        """Bump the counter by one. Returns the new value.

        ``reason`` is a short free-form string ("track-added",
        "plugin-reconfig", "clip-created", etc.). Logged at INFO so the
        session's structural timeline shows in Log.txt without needing
        DEBUG. Also forwarded to the ``on_advance`` callback — the
        structural-full / invalidate emitter uses it in the emitted
        message's ``reason`` field.

        Idempotent-ish: a disconnected component silently refuses to
        advance and returns the current value, same posture as the
        other components' disconnected guards.
        """
        if self._disconnected:
            return self._value
        old = self._value
        self._value = old + 1
        logger.info(
            "generation advanced: %d -> %d (%s)", old, self._value, reason,
        )
        if self._on_advance is not None:
            try:
                self._on_advance(old, self._value, reason)
            except Exception as e:
                # A raising on_advance must not roll back the counter
                # (the advance already happened in-memory) and must not
                # bring down the listener dispatch that called us. Log
                # and swallow — same posture as MutationComponent emits.
                logger.error(
                    "GenerationComponent: on_advance raised for "
                    "%d -> %d (%s): %s",
                    old, self._value, reason, e, exc_info=True,
                )
        return self._value

    # --- stale-check helper -----------------------------------------------

    def is_stale(self, ui_generation: int) -> bool:
        """``True`` if the UI's generation is behind the surface's.

        Used by v3 write handlers: a stale write is rejected with
        ``generation-stale`` per [04 §4.2]. Modular comparison would
        be more correct per [04 §4.3] but in practice never matters
        within a session — a plain ``<`` is fine and clearer.

        ``ui_generation`` of ``UNSET_GENERATION`` (0) is treated as
        stale: the UI should always send its mirror, never the sentinel.
        """
        try:
            ui = int(ui_generation)
        except (TypeError, ValueError):
            return True
        if ui == UNSET_GENERATION:
            return True
        return ui < self._value

    # --- callback installation -------------------------------------------

    def set_on_advance(
        self, cb: Optional[Callable[[int, int, str], None]],
    ) -> None:
        """Install or replace the on-advance callback post-construction.

        Used by ``LoopingSurface.__init__`` when the emitter component
        (``StateFullComponent`` / ``MutationComponent``) is built after
        the counter. Passing ``None`` detaches.
        """
        self._on_advance = cb

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown. Drops the callback; freezes the counter."""
        if self._disconnected:
            return
        self._disconnected = True
        self._on_advance = None
