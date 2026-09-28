"""ServerPresenceComponent — "is the dev server running?" liveness gate.

The Python Control Surface runs inside Live for the whole time Live is
open, independent of whether the bridge / SvelteKit interface ("the
server", started by ``npm run dev`` / ``npm run ipad``) is up. Some
surface behaviors are only wanted *during a performance* — when the
server is actually running — and are a distraction otherwise (e.g.
arm-follows-selection during production / cleanup work in bare Live).

This component turns "is the server running" into a runtime predicate
other components can gate on. It's driven by a heartbeat the bridge
emits while its process is alive:

    Bridge → /looping/v3/server/heartbeat [seq, epochMs]   (~every 2s)

Each heartbeat stamps ``_last_seen``. ``server_present()`` is
presence-based, not event-based: it returns True iff a heartbeat
landed within ``grace_window_s``. That makes it self-healing and
crash-safe in exactly the cases that matter:

- **Dev server quit / crash** (Live stays open): heartbeats stop, the
  window lapses, presence goes False on its own. No "goodbye" event is
  required — a ``kill -9`` is handled the same as a clean quit.
- **Load a new set / restart Live** (dev server stays up): Live tears
  down and reconstructs the whole surface, so this component starts
  fresh with ``_last_seen = None`` (absent). The bridge's next
  heartbeat (≤ ``heartbeatIntervalMs`` later) re-establishes presence.
  ``mark_alive`` is *also* called from the handshake-accept chain, so
  the re-handshake that a surface restart triggers
  (``SurfaceHelloComponent`` → UI re-hello → accept) marks presence
  immediately — closing the race where the accept-seed arm would
  otherwise run before the first post-restart heartbeat arrived.

The heartbeat only tracks the *bridge process* being alive, which is
the direct encoding of "I ran ``npm run dev``". It does not require a
WebSocket UI client to be connected — matching the user's mental model
that starting the server is the "I'm performing" signal. A manual
override (``SessionSettingsComponent.auto_arm``) composes on top so the
user can still silence a behavior while the server is up.

Presence is *pulled* on demand (at the moment a gated behavior would
fire); there's no timer here. Edge transitions are logged so Log.txt
shows when the surface believes the server came up or went away.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Optional

logger = logging.getLogger("looping")


# Wire address — module constant so renames fail at import time.
# Distinct from ``/looping/v3/bridge/heartbeat`` (surface → bridge, the
# tick-liveness proof): this one is bridge → surface, "the server is
# alive". Bridge-originated and sent straight to the surface UDP port,
# so it does not need a ``backendScope.pythonSurface`` routing entry.
V3_SERVER_HEARTBEAT_ADDRESS = "/looping/v3/server/heartbeat"

# Default liveness window if constants.json doesn't override it. Sized
# to tolerate ~2 missed heartbeats (bridge default cadence ~2s) plus
# UDP jitter before declaring the server gone.
DEFAULT_GRACE_WINDOW_SECONDS: float = 6.0


def compose_auto_arm_gate(session_settings, server_presence) -> bool:
    """Two-switch gate for arm-follows-selection.

    Arm only when the user has opted in
    (``SessionSettings.should_auto_arm()``, default on) **and** the dev
    server is present (``ServerPresenceComponent.server_present()``).
    Either arg being ``None`` — the teardown window where a component
    may already be dropped — reads as False: never arm against a
    half-freed object graph.

    Free function (not a method) so the AND-composition + None-guards
    are unit-testable without importing ``LoopingSurface``, which pulls
    in Live's ``ableton.v3.control_surface`` framework and can't load in
    the test env. ``LoopingSurface._should_auto_arm_in_performance``
    is a thin ``getattr`` wrapper over this.
    """
    if session_settings is None or not session_settings.should_auto_arm():
        return False
    if server_presence is None:
        return False
    return server_presence.server_present()


def compose_key_follow_gate(session_settings, server_presence) -> bool:
    """Two-switch gate for key Follow (ADR-447), the arm-follows-selection
    shape: the ``key_follow`` toggle (default on, persisted) **and** the dev
    server present. Without the app running — a production session in bare
    Live — the surface must not rewrite the set's key behind the user's
    back. Either arg ``None`` (teardown) reads as False."""
    if session_settings is None or not session_settings.should_follow_key():
        return False
    if server_presence is None:
        return False
    return server_presence.server_present()


def compose_capture_gate(session_settings) -> bool:
    """Gate for the performance-capture behaviors (auto-record + save-as).

    The behaviors run iff the user-facing ``auto_capture`` toggle is on
    (``SessionSettings.should_auto_capture()``). That toggle is the *sole*
    gate: its **default** is launch-mode-derived (``is_ipad_present()`` at
    surface construction — ipad→on, dev→off), but once seeded the user can
    override it either way. So this is not an AND of mode-and-setting the way
    ``compose_auto_arm_gate`` ANDs setting-and-presence — forcing the toggle
    on under ``npm run dev`` genuinely enables capture, and forcing it off
    under ``npm run ipad`` genuinely disables it.

    Historical note: this gate was ``is_ipad_present()`` directly (2026-07-06,
    the original iPad-only capture feature). The mode check moved into the
    toggle's *default seed* (2026-07-06, capture toggle) so the behavior
    became user-overridable while keeping the same out-of-the-box defaults.

    ``session_settings`` being ``None`` — the teardown window where the
    component may already be dropped — reads as False: never capture against
    a half-freed object graph.

    Free function (not a method) so the None-guard + predicate are
    unit-testable without importing ``LoopingSurface`` (which pulls in Live's
    ``ableton.v3.control_surface`` and can't load under test), mirroring
    ``compose_auto_arm_gate``.
    """
    if session_settings is None:
        return False
    return session_settings.should_auto_capture()


class ServerPresenceComponent:
    """Tracks whether the bridge ("the server") is currently alive.

    Args:
        grace_window_s: How long a single heartbeat keeps presence
            "on". A heartbeat older than this → absent.
        now: Monotonic clock, injected for deterministic tests.
            Defaults to ``time.monotonic`` (never runs backwards, unlike
            wall-clock time — correct for elapsed-time comparisons).

    Lifecycle:
        ``__init__`` starts absent (no heartbeat seen yet).
        ``disconnect`` freezes the component so a late heartbeat or
        query after teardown is a no-op. Idempotent.
    """

    V3_SERVER_HEARTBEAT_ADDRESS = V3_SERVER_HEARTBEAT_ADDRESS

    def __init__(
        self,
        grace_window_s: float = DEFAULT_GRACE_WINDOW_SECONDS,
        now: Optional[Callable[[], float]] = None,
        on_first_mode: Optional[Callable[[str], None]] = None,
    ):
        self._grace = float(grace_window_s)
        self._now = now if now is not None else time.monotonic
        # Invoked once, with the mode string, when the first heartbeat
        # carrying a mode lands — lets SessionSettings seed its launch-mode
        # default for ``auto_capture`` (the mode isn't known at surface
        # construction, only when the bridge's first heartbeat arrives).
        self._on_first_mode = on_first_mode
        # ``None`` = never seen a heartbeat (cold start / fresh surface).
        self._last_seen: Optional[float] = None
        # Launch mode from the most recent heartbeat's 3rd arg
        # ("ipad" | "dev"). ``None`` until the first heartbeat carrying
        # it lands. ``mark_alive`` (handshake path) does not carry a
        # mode, so it leaves this untouched — the next heartbeat sets it.
        self._mode: Optional[str] = None
        # Last value ``server_present`` reported — for edge logging only.
        self._was_present = False
        self._disconnected = False

        logger.info(
            "ServerPresenceComponent init: grace_window=%.1fs (absent "
            "until first heartbeat)",
            self._grace,
        )

    # --- heartbeat -------------------------------------------------------

    def mark_alive(self) -> None:
        """Stamp "the server is alive right now".

        Called by the heartbeat handler and by the handshake-accept
        chain. After teardown it's a no-op so a late fire can't
        resurrect presence against a half-freed object graph.
        """
        if self._disconnected:
            return
        self._last_seen = self._now()

    def handle_heartbeat(self, args, source_addr):
        """``/looping/v3/server/heartbeat [seq, epochMs, mode?]``.

        ``seq`` (gap detection) and ``epochMs`` (cross-log correlation)
        are diagnostic only; presence is driven purely by arrival time.
        The optional 3rd arg ``mode`` ("ipad" | "dev") records which npm
        script started the bridge and drives ``is_ipad_present()``. Older
        bridges send only 2 args — mode then stays as last known / None.
        Returns ``None`` — no reply.
        """
        if self._disconnected:
            return None
        if args is not None and len(args) >= 3 and args[2]:
            first_mode = self._mode is None
            self._mode = str(args[2])
            # On the first mode we learn, let listeners seed mode-derived
            # defaults (auto_capture). Fire after _mode is set so a
            # re-entrant read sees the value. Guarded so a callback raising
            # can't wedge presence tracking.
            if first_mode and self._on_first_mode is not None:
                try:
                    self._on_first_mode(self._mode)
                except Exception as e:  # noqa: BLE001 — never break heartbeat
                    logger.warning(
                        "ServerPresenceComponent: on_first_mode raised: %r", e,
                    )
        self.mark_alive()
        return None

    # --- query -----------------------------------------------------------

    def server_present(self) -> bool:
        """True iff a heartbeat landed within the grace window.

        Pull this at the moment a gated behavior would fire. Logs the
        present↔absent edge so Log.txt reflects when the surface
        believes the server came up or went away. The present→absent
        edge is only observed when something queries — which is exactly
        when it matters (a gated behavior is being evaluated)."""
        present = self._compute_present()
        if present != self._was_present:
            self._was_present = present
            logger.info(
                "ServerPresenceComponent: server %s",
                "PRESENT (dev server up)" if present
                else "ABSENT (dev server not running)",
            )
        return present

    def is_ipad_present(self) -> bool:
        """True iff the server is present **and** its mode is ``"ipad"``.

        The predicate for ipad-only behaviors (arrangement-record-on-play,
        save-as-on-stop): the ``npm run ipad`` bridge stamps ``"ipad"`` on
        its heartbeat, ``npm run dev`` stamps ``"dev"``, and no bridge at
        all means not present. Composed via ``compose_capture_gate``."""
        return self.server_present() and self._mode == "ipad"

    def _compute_present(self) -> bool:
        if self._disconnected:
            return False
        if self._last_seen is None:
            return False
        return (self._now() - self._last_seen) <= self._grace

    # --- lifecycle -------------------------------------------------------

    def disconnect(self) -> None:
        """Freeze the component; idempotent."""
        self._disconnected = True

    # --- test hooks ------------------------------------------------------

    @property
    def last_seen(self) -> Optional[float]:
        return self._last_seen

    @property
    def mode(self) -> Optional[str]:
        return self._mode
