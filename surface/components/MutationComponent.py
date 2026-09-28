"""MutationComponent — per-address mutation fires.

Emits ``/looping/v3/param/value [path, value]`` on every parameter
value-change. Hot path: a fader drag at ~120 writes/sec (per Gate 3)
should not trigger a tree republish; this address is one OSC message
per fire, one store update on the UI side.

Device-added / device-removed events are NOT emitted as per-address
mutations — structural changes trigger ``on_structural_change`` in
``LOMListeners`` which drives a v3 ``state/full`` republish (path
identity makes the bundle dedupe cheap).

Listener lifecycle lives in ``LOMListeners``, not here
------------------------------------------------------

The listener bookkeeper owns the LOM listener discipline (per-param
``value_changed``) and fans the events out through
``on_param_value_changed`` installed via ``set_mutation_callbacks``
at surface construction time. This component owns zero LOM
attachments directly — only the wire emit and the one-shot
suppression flag that swallows echoes of UI-driven writes.

The ``on_param_value_changed`` signature is
``(parameter, canonical_path)``: ``canonical_path`` is the
v3 positional path captured at listener-attach time in LOMListeners.

Suppression
-----------

``DevicesComponent`` writes to ``parameter.value``, which LOM answers
with a synchronous ``value_changed`` fire that this component would
otherwise emit back to the UI — the UI already has the value
(optimistic local update), and the echo would either be a no-op write
to the same Map entry (fine) or trigger a jitter loop if the UI's
reactivity also re-sends (not fine). The suppression flag is:

1. **Armed by ``arm_suppression(param_id)``** from the
   ``DevicesComponent`` handler, immediately before the LOM write.
2. **Consumed by the next fire for that param_id** — exactly one,
   regardless of whether LOM debounces multiple writes to one settling
   fire (Gate 3 verified it does). We clear on the next fire rather
   than use a counter so repeated rapid writes stay silenced.
3. **Auto-cleared on unarm** if the write raises, so a later unrelated
   fire isn't swallowed. ``DevicesComponent`` handles this contract.

The suppression key is ``param_id`` (not a single global flag) because
two parameters can change simultaneously; the old
``SessionComponent``-style global one-shot would over-swallow.

Display-value hot path
----------------------

Calling ``str(parameter)`` returns Live's GUI-formatted value
(``"440 Hz"``, ``"-12.0 dB"``, ``"1/4"``, ``"On"``) via the LOM's
``__str__``. We emit it as a *separate* address —
``/looping/v3/param/display [path, displayString]`` — so the existing
``param/value`` parser shape doesn't change and consumers that don't
need the formatted readout pay zero parser cost.

We don't compute the string on every fire (a single fader drag is
~120 writes/sec; ten dragged sliders is ~1.2k C-calls/sec on Live's
main thread, which the LOM repaints depend on). Instead, the surface
infers "this param is being interacted with" from the traffic it's
already receiving: ``DevicesComponent.handle_set_param_v3`` calls
``mark_hot(canonical_path)`` on every set. A short TTL (``HOT_TTL_SEC``)
keeps the path hot through the natural pauses inside a drag (a slider
that hits a value and the user holds it briefly) and decays naturally
when interaction stops — no UI-side subscribe/unsubscribe state machine,
no pointerdown/pointerup wiring, no dropped-cleanup edge case.

Display fires *bypass* suppression: the suppressed echo only protects
the UI from getting a redundant numeric `value` it already has
optimistically — the formatted *string* is genuinely new data that the
UI cannot compute locally (Live bakes the format curves — Hz log, dB
log, time-with-tempo-sync — into C). So even a suppressed fire emits
``param/display`` if the path is currently hot.

Stale entries are swept lazily on every fire (one ``time.monotonic()``
per fire, plus opportunistic dict-pop). No background timer, no
scheduler dependency — the component runs entirely on Live's main
thread via the LOM listener path.
"""

from __future__ import annotations

import logging
import time
from typing import Callable

logger = logging.getLogger("looping")


# Wire address — module constant so renames fail at import time, not runtime.
# Path is canonical (resolved at listener-attach time in LOMListeners);
# value is a float. No generation on the echo — the UI infers it from
# its own counter (echoes always refer to current state).
V3_PARAM_VALUE_ADDRESS = "/looping/v3/param/value"

# Companion display-string address. Args: (path:string, displayString:string).
# Same canonical path as ``param/value`` so the UI keys both off the same
# store entry. Emitted only while the path is "hot" (recent ``param/set``
# traffic from the UI). See module docstring §"Display-value hot path".
V3_PARAM_DISPLAY_ADDRESS = "/looping/v3/param/display"

# Hot-flag TTL. Drag traffic at 30+ Hz keeps refreshing the entry well
# below this window; the value is sized to ride through ~half-second
# user pauses inside a single drag without the readout going dark. A
# subsequent ``param/set`` resets the timer. Decay is lazy on the next
# fire — no wall-clock ticking required.
HOT_TTL_SEC = 0.75


class MutationComponent:
    """Emits per-event mutation fires in response to listener callbacks.

    Args:
        listeners: A ``LOMListeners`` instance. Retained for symmetry
            with the pre-v3 constructor; currently unused on the v3
            wire (param-value fires carry a pre-resolved path).
        emit: ``callable(address, args)`` — the transport's ``send``.

    The component installs no listeners of its own. All fires originate
    in ``LOMListeners`` callbacks.
    """

    def __init__(self, listeners, emit: Callable):
        self._listeners = listeners
        self._emit = emit
        self._disconnected = False
        # Per-param suppression: ``{param_id: True}`` when armed. A
        # single fire consumes and clears. Dict rather than set because
        # it documents intent and makes "is this armed?" an O(1)
        # dict-get rather than an O(1) set-in (same cost, clearer).
        self._suppress: dict[int, bool] = {}
        # Per-path hot map: ``{canonical_path: monotonic_expiry_ts}``.
        # Refreshed by ``mark_hot`` from ``DevicesComponent.handle_set_param_v3``;
        # checked by ``on_param_value_changed`` to decide whether to call
        # ``str(parameter)`` and emit ``param/display``. Lazily swept on
        # each fire — no separate ticker. See module docstring
        # §"Display-value hot path".
        self._hot_paths: dict[str, float] = {}

    # --- suppression --------------------------------------------------------

    def arm_suppression(self, param_id: int) -> None:
        """Arm the one-shot echo suppression for ``param_id``.

        Called by ``DevicesComponent`` immediately before writing to
        ``parameter.value``. The next ``on_param_value_changed`` fire
        for this id is swallowed; all subsequent fires emit normally.
        Re-arming before the first fire lands is idempotent (the flag
        stays True).
        """
        self._suppress[int(param_id)] = True

    def unarm_suppression(self, param_id: int) -> None:
        """Clear the one-shot flag for ``param_id``.

        Called by ``DevicesComponent`` when the write raised. Without
        this, a later unrelated fire (the same parameter really did
        change externally) would be silently dropped.
        """
        self._suppress.pop(int(param_id), None)

    # --- display-value hot map ---------------------------------------------

    def mark_hot(self, canonical_path: str) -> None:
        """Mark ``canonical_path`` as actively-interacted-with.

        Called by ``DevicesComponent.handle_set_param_v3`` on every
        ``/looping/v3/param/set``. The next ``on_param_value_changed``
        fire for this path (whether driven by our write or an external
        change to the same param while the user is dragging) emits one
        ``/looping/v3/param/display`` with the formatted string. The
        entry expires ``HOT_TTL_SEC`` seconds after the most recent
        ``mark_hot`` call — drag traffic keeps refreshing it; release
        lets it decay naturally on the next fire's lazy sweep.

        No-op for empty paths (the listener path-capture path can't
        produce one, but the contract is symmetric with the rest of the
        component).
        """
        if self._disconnected or not canonical_path:
            return
        self._hot_paths[canonical_path] = time.monotonic() + HOT_TTL_SEC

    def _is_hot(self, canonical_path: str) -> bool:
        """Return True if ``canonical_path`` is within its TTL window.

        Lazily sweeps the entry if it's expired so the dict can't grow
        unboundedly across long sessions of incidental interactions.
        """
        ts = self._hot_paths.get(canonical_path)
        if ts is None:
            return False
        if time.monotonic() >= ts:
            self._hot_paths.pop(canonical_path, None)
            return False
        return True

    # --- registry callbacks -------------------------------------------------

    def on_param_value_changed(self, parameter, canonical_path: str) -> None:
        """``/looping/v3/param/value [path, value]`` — hot-path fire.

        Installed via ``LOMListeners.set_mutation_callbacks``. The
        listener closure captured ``(parameter, canonical_path)`` at
        attach time. Reads ``parameter.value`` and emits it as a
        float. Swallows the fire if the one-shot for this id is armed.

        If ``canonical_path`` is currently hot (recent ``mark_hot``
        from a UI-driven ``param/set``), additionally emit
        ``/looping/v3/param/display [path, str(parameter)]`` — Live's
        GUI-formatted string, which the UI cannot compute locally.
        Display fires bypass the one-shot suppression (the suppression
        only protects against numeric-value echo loops; the formatted
        string is genuinely new data).
        """
        if self._disconnected:
            return
        from .LOMListeners import _safe_int_id

        pid = _safe_int_id(parameter)
        if pid is None:
            logger.warning(
                "MutationComponent: on_param_value_changed for "
                "unidentifiable parameter at path=%s; skipping fire",
                canonical_path,
            )
            return

        suppressed = self._suppress.pop(pid, False)

        # Display string rides parallel to the value emit. Compute
        # only when the path is hot — keeps the str() cost off the
        # idle listener-fire path entirely (external changes, automation
        # ticks, MIDI controller writes don't pay it).
        if canonical_path and self._is_hot(canonical_path):
            try:
                display = str(parameter)
            except Exception as e:
                # Live's __str__ can raise on torn-down handles
                # (preset reload mid-fire). Skip the display emit, let
                # the value emit (if any) still go.
                logger.debug(
                    "MutationComponent: str(parameter) raised pid=%d "
                    "path=%s: %s", pid, canonical_path, e,
                )
            else:
                self._safe_emit(
                    V3_PARAM_DISPLAY_ADDRESS, (canonical_path, display),
                )

        if suppressed:
            # Echo of a UI-driven write. The UI already has the value;
            # emitting would be a no-op at best and a jitter loop at
            # worst. The display emit (above) still ran — that's the
            # whole point.
            logger.debug(
                "MutationComponent: echo SUPPRESSED pid=%d path=%s",
                pid, canonical_path,
            )
            return
        try:
            value = float(getattr(parameter, "value", 0.0))
        except (TypeError, ValueError):
            logger.warning(
                "MutationComponent: param %d value read failed; skipping fire",
                pid,
            )
            return
        if value != value:  # NaN guard, same posture as DevicesComponent.
            return
        if canonical_path:
            self._safe_emit(V3_PARAM_VALUE_ADDRESS, (canonical_path, value))

    # --- helpers ------------------------------------------------------------

    def _safe_emit(self, address: str, args) -> None:
        """Emit via the transport; log-and-swallow any failure.

        An emit exception is either a closed transport (shutdown race)
        or an encode error (both would be logged upstream). Never
        propagate — a mutation fire that can't reach the UI is not a
        reason to crash the LOM listener dispatch path, which would
        leave Live's tick thread in a bad state.
        """
        try:
            self._emit(address, args)
        except Exception as e:
            logger.error(
                "MutationComponent: emit failed for %s: %s (args=%r)",
                address, e, args,
            )

    # --- lifecycle ----------------------------------------------------------

    def disconnect(self) -> None:
        """Stop emitting; idempotent.

        Clears the suppression and hot-path maps and flips the
        ``_disconnected`` flag so any in-flight LOM fire (between this
        call and the registry's own detach in its ``disconnect``) is
        silenced.
        """
        if self._disconnected:
            return
        self._disconnected = True
        self._suppress.clear()
        self._hot_paths.clear()
