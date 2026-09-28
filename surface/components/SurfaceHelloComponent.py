"""SurfaceHelloComponent — PR-3c (v2): unsolicited surface-restart advertisement.

Per [04 §8.6](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#86-surface-instance-advertisement-surfacehello).

Live 12.3.7 tears down and reconstructs the entire Python Control
Surface on File → Open (observed twice 2026-04-15 — see the
2026-04-15 PR-3c revision entry in
``implementation-log.md``). The bridge's WebSocket to the UI stays
alive across this because the bridge is a separate Node process,
so the UI has no signal that the surface underneath has been
replaced. Without a signal, the UI keeps addressing the previous
session's ``sessionId`` and ``generation``; writes either no-op
against the old session context or land on positionally-matching
but semantically-different params in the new set.

This component closes that gap by advertising the surface's
identity **unsolicited** on every ``__init__``:

    Surface → /looping/v3/surface/hello
              [surfaceInstanceId, protocolVersion, timestamp]

The ``surfaceInstanceId`` is a UUID minted fresh at every
``ControlSurface.__init__`` — not the ``sessionId`` (which is
per-handshake), but *per-surface-lifetime*. A reconstructed surface
emits a new instanceId; the UI's handler compares against the
last-seen value and re-handshakes on mismatch.

## Emission timing

The ``send_hello()`` call fires once, late in ``__init__`` — after
the UDP transport is bound so the emit actually lands, but
*before* any v2 fire-and-forget state/full push. This ordering
lets the UI see the restart signal before it starts consuming any
unsolicited traffic tagged with a stale generation from the v2
emitter.

## No re-fire

``send_hello()`` is one-shot. A second call is a no-op and logs a
warning — a re-fire would destroy the UI's idempotence assumption
(its "same instanceId → no-op" branch would suddenly be wrong
semantics for the second fire). If a future change needs a re-fire
trigger, design the handler semantics first.

## Compatibility

The address is additive. A UI that does not register a handler
for it drops the message; bring-up still works via
handshake-on-connect. This is a Phase-3 addition that Phase 4 keeps
(it's the v3-native replacement for the v2 ``reason=init``
side-channel).
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Callable, Optional

logger = logging.getLogger("looping")


# Wire address — module constant so renames fail at import time.
V3_SURFACE_HELLO_ADDRESS = "/looping/v3/surface/hello"

# Advertised protocol version — the highest the surface speaks.
# Must be present in ``HandshakeComponent.SUPPORTED_VERSIONS`` — a
# divergence would let a UI pre-reject a surface that would then
# successfully handshake, or vice-versa. Tests assert membership.
# Phase 7 PR-7a bumps this from 3.0.0 to 3.1.0 alongside the sceneRef
# grammar extension; additive-only minor bump.
# Phase 7 PR-7c pr7c-3 bumps to 3.2.0 alongside the T-record arity
# 8 \u2192 9 in V3StateFullComponent (`hasArrangementClips`). A 3.1.0 UI
# under-reads the 9th field, so the version bump and the arity bump
# ship together.
# ROW 5 2026-04-21 bumps to 3.3.0 alongside the D-record arity 4 -> 3
# (legacyId retired; path_resolver + DeviceCommandsComponent own the
# select/move ops in path-space). A 3.2.0 UI over-reads and grabs the
# following record tag as an int field, so the version bump and
# arity shrink ship together.
# 2026-08-31 bumps to 3.6.0 alongside the ``state/full`` collapse:
# ``begin -> chunk... -> end`` became a single ``state/full/tree``,
# so a pre-3.6.0 UI is listening on three addresses that no longer
# carry anything.
# 2026-09-10 bumps to 3.8.0 (issue #491) alongside the ``pads/<note>``
# path segment and the pad-scoped ``state/full/tree``.
# 2026-09-15 bumps to 3.9.0 (ADR-439): T record 14 -> 15, appending ``preset``.
PROTOCOL_VERSION = "3.11.0"


class SurfaceHelloComponent:
    """Emits one unsolicited ``/looping/v3/surface/hello`` per surface
    lifetime.

    Args:
        emit: Callable ``(address, args)`` — the transport's ``send``.
        instance_id_factory: Mints the per-surface instance id.
            Defaults to UUID4 hex. Tests override with a stable value.
        now: Clock for the ``timestamp`` arg. Defaults to
            ``time.time``; tests inject a constant.

    The instance id is minted at ``__init__`` and held for the
    component's lifetime. A surface teardown destroys the component
    with its id; a fresh surface mints a new one. That's the whole
    contract.
    """

    def __init__(
        self,
        emit: Callable,
        instance_id_factory: Optional[Callable[[], str]] = None,
        now: Optional[Callable[[], float]] = None,
    ):
        self._emit = emit
        self._now = now if now is not None else time.time
        self._instance_id = (
            instance_id_factory()
            if instance_id_factory is not None
            else uuid.uuid4().hex
        )
        self._sent = False
        self._disconnected = False

    @property
    def instance_id(self) -> str:
        """The per-surface-lifetime instance id. Exposed for logging
        and tests; no runtime consumer should depend on it."""
        return self._instance_id

    # --- emission --------------------------------------------------------

    def send_hello(self) -> None:
        """Fire the unsolicited ``/looping/v3/surface/hello``.

        One-shot: a second call is a no-op with a warning. Swallows
        emit-layer exceptions (the transport may be half-torn-down
        in a pathological bring-up sequence; we log and carry on
        rather than crash the surface during ``__init__``).
        """
        if self._disconnected:
            # Teardown racing bring-up; caller's ordering bug. Log and
            # skip rather than emit through a closed transport.
            logger.warning(
                "SurfaceHelloComponent: send_hello after disconnect; skipping"
            )
            return
        if self._sent:
            logger.warning(
                "SurfaceHelloComponent: send_hello called twice "
                "(instance_id=%s); this is a wiring bug — UI idempotence "
                "relies on one emission per surface lifetime",
                self._instance_id,
            )
            return
        timestamp = int(self._now())
        try:
            self._emit(
                V3_SURFACE_HELLO_ADDRESS,
                (self._instance_id, PROTOCOL_VERSION, timestamp),
            )
        except Exception as e:
            logger.error(
                "SurfaceHelloComponent: emit raised: %s", e, exc_info=True
            )
            return
        self._sent = True
        logger.info(
            "SurfaceHelloComponent: advertised surface instance "
            "(instance_id=%s, version=%s, timestamp=%d)",
            self._instance_id, PROTOCOL_VERSION, timestamp,
        )

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        """Idempotent teardown; prevents late ``send_hello`` from
        trying to emit on a torn-down transport."""
        self._disconnected = True
