"""InvalidationComponent — emits ``/looping/v3/state/invalidate`` on
generation advance.

Per [04 §3.3](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#33-state-invalidate-and-state-full).

Wire shape: ``/looping/v3/state/invalidate [generation, reason, paths...]``

- ``generation`` is the new generation the advance produced.
- ``reason`` is the same free-text tag ``GenerationComponent.advance``
  received (``"track-added"``, ``"device-swap"``, etc.), passed
  through so log-trawling across wire tap + Python log can correlate.
- ``paths`` is a variadic tail of path strings the UI should treat as
  dead. Phase 1 Commit B emits it empty — there's no UI consumer yet
  and computing targeted path lists means walking the pre- and
  post-advance tree to find what changed, which is Phase 2 work. An
  empty tail tells the UI "drop everything and resync" (the
  conservative interpretation per [04 §3.3] "UI drops any cache entry
  rooted at each listed path"). Wire the structural-hint paths in
  Phase 2 once the v3 UI exists to consume them.

Wire hook-up: the component calls ``GenerationComponent.set_on_advance``
at construction, which replaces whatever previous hook the surface
had. ``LoopingSurface`` is responsible for keeping that single-writer
discipline — if a second consumer wants to observe advances it needs
to layer on via this component, not by re-hooking.

Failure tolerance: emit failures are log-and-swallow (same posture as
MutationComponent) — a broken transport must not prevent future
advances from landing on the counter.
"""

from __future__ import annotations

import logging
from typing import Callable

logger = logging.getLogger("looping")


V3_STATE_INVALIDATE_ADDRESS = "/looping/v3/state/invalidate"


class InvalidationComponent:
    """Bridges ``GenerationComponent.on_advance`` to the v3 wire.

    Args:
        generation_component: The authoritative ``GenerationComponent``.
            We install ourselves as its single ``on_advance`` hook.
        emit: ``callable(address, args)`` — the transport's ``send``.
    """

    def __init__(self, generation_component, emit: Callable):
        self._generation = generation_component
        self._emit = emit
        self._disconnected = False
        # Single-writer: hook us into the generation component.
        self._generation.set_on_advance(self._on_advance)

    def _on_advance(
        self, old_generation: int, new_generation: int, reason: str,
    ) -> None:
        """``GenerationComponent`` hook — emit the invalidate.

        Signature matches ``GenerationComponent.advance`` internal call
        ``(old, new, reason)``. We carry only the new generation on the
        wire — UI tracks its own mirror and doesn't need the old value.
        """
        if self._disconnected:
            return
        try:
            self._emit(
                V3_STATE_INVALIDATE_ADDRESS,
                (int(new_generation), str(reason)),
            )
        except Exception as e:
            logger.error(
                "InvalidationComponent: emit failed for gen=%d reason=%s: %s",
                new_generation, reason, e,
            )

    def disconnect(self) -> None:
        """Stop emitting; idempotent.

        Does not unhook from the generation component — the generation
        component's own disconnect freezes future advances, and the
        _disconnected flag here silences any in-flight callback that
        lands between the two disconnects.
        """
        if self._disconnected:
            return
        self._disconnected = True
