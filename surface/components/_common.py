"""Small helpers every surface component used to paste for itself.

Dependency-free on purpose: no Live import and no sibling import, so any
component can take these without an import cycle. Import relatively
(``from ._common import LOM_ERRORS, coerce_str``); the absolute form passes
pytest and fails inside Live (surface/CLAUDE.md).
"""

import logging
from typing import Optional, Tuple

logger = logging.getLogger("looping")

#: What a LOM read or write raises on a torn-down or refused handle.
#: ``TypeError`` covers ``Boost.Python.ArgumentError``. A component that
#: also wants ``IndexError`` / ``ValueError`` adds them at its call site.
LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


def coerce_str(x, none: str = "") -> str:
    """Coerce an OSC arg to ``str``: bytes → utf-8, ``None`` → ``none``.

    ``None`` shows up when the OSC encoder collapses an empty string, and
    reads as ``""`` so an empty-path check stays reachable. A component
    whose copy used to ``str()`` it (``"None"``) passes ``none="None"``
    to keep that behavior.
    """
    if x is None:
        return none
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


def is_stale_handle_error(exc: BaseException) -> bool:
    """``True`` when ``exc`` is Live's stale-LOM-handle marker.

    A ``remove_*_listener`` on an object Live has already torn down (a
    device that left its chain, a track just deleted) raises
    ``Boost.Python.ArgumentError`` — a ``TypeError`` — whose message
    carries "did not match C++ signature" and the ``TPyHandle`` type. The
    listener is already gone on Live's side; nothing is wrong. Matched on
    the message because the class is not importable outside Live.
    """
    try:
        msg = str(exc)
    except Exception:
        return False
    return "did not match C++ signature" in msg or "TPyHandle" in msg


def safe_remove(target, method_name: str, cb, ctx: str,
                other_level: int = logging.WARNING) -> bool:
    """Detach ``cb`` with ``target.<method_name>(cb)``; never raises.

    The one shape of the stale-handle detach: no such method (a test stub,
    an object that never had the listener) is a quiet ``False``; a
    stale-handle error is logged at DEBUG (the listener is already gone);
    anything else at ``other_level``. ``ctx`` names the caller in the log
    line. Returns ``True`` only when the call returned normally.
    """
    try:
        remover = getattr(target, method_name, None)
    except Exception:
        remover = None
    if not callable(remover):
        return False
    try:
        remover(cb)
    except Exception as e:
        if is_stale_handle_error(e):
            logger.debug("%s: %s skipped for stale handle %r", ctx, method_name, target)
        else:
            logger.log(other_level, "%s: %s failed on %r: %s", ctx, method_name, target, e)
        return False
    return True


def safe_emit(emit, address: str, payload, ctx: str) -> None:
    """``emit(address, payload)``; a raise is logged as a warning, never
    propagated (a closed transport in a teardown race, an encode error).
    The caller keeps its own ``_disconnected`` check."""
    try:
        emit(address, payload)
    except Exception as e:
        logger.warning("%s: emit %s failed: %s", ctx, address, e)


class WarnOnce:
    """Log a warning once per ``(scope, key)``: ``warned(scope, key, msg)``.

    For a LOM read that can fail on every listener fire, so a broken
    object names itself once instead of flooding Log.txt. ``(scope, key)
    in warned`` and ``clear()`` behave as on the set it replaces.
    """

    def __init__(self, ctx: str):
        self._ctx = ctx
        self._seen: set = set()

    def __call__(self, scope: str, key: str, message: str) -> None:
        k = (scope, key)
        if k in self._seen:
            return
        self._seen.add(k)
        logger.warning("%s: %s: %s", self._ctx, scope, message)

    def __contains__(self, k) -> bool:
        return k in self._seen

    def clear(self) -> None:
        self._seen.clear()


def safe_int_id(live_object) -> Optional[int]:
    """Read a stable LOM identity for ``live_object`` as an OSC-safe int32.

    The ``ableton.v3`` framework wraps raw LOM objects (Track, Device,
    etc.) and does *not* expose ``.id`` on those wrappers — only the
    underlying LOM pointer as ``_live_ptr``. Lower-level objects like
    ``DeviceParameter`` still expose ``.id`` directly. See
    ``BrowserProbe._chain_device_ids`` for the prior-art precedent of
    using ``_live_ptr`` as the stable identity.

    Resolution order:

    1. ``_live_ptr`` — v3 wrapper's LOM pointer, stable across
       renames/reorders. First choice for Track/Device/Chain.
    2. ``.id`` — native LOM property, still present on
       ``DeviceParameter`` and anything unwrapped.
    3. ``None`` — genuine unresolvable; caller must skip.

    We do NOT fall back to Python's built-in ``id()`` because that's
    process-address-based and would make two calls on the same LOM
    object *unrelated* to LOM identity (e.g., different Python
    wrapper instances for the same LOM track). LOM identity is the
    whole reason walk-based resolution works at all; using ``id()``
    would silently break the "stable across reorders" invariant that
    v2 addressing depends on.

    OSC-safe masking: LOM pointer values can exceed int32 on 64-bit
    macOS. We mask to 31 bits so OSC ``'i'`` emit doesn't overflow.
    Masking preserves identity: two reads on the same LOM object
    return the same masked value.

    Used by:
    - ``LOMListeners`` itself for device-id bookkeeping during the
      add/remove diff in ``_on_track_devices_changed``.
    - ``MutationComponent.on_param_value_changed`` to compute the v2
      wire pid from the parameter the listener handed it.
    - ``DevicesComponent`` v2/legacy write handlers' inline LOM walk
      (matches a wire pid against ``_safe_int_id(param)``).
    - ``StateFullComponent`` to label tree entries with their v2
      wire ids.
    """
    raw = getattr(live_object, "_live_ptr", None)
    if raw is None:
        try:
            raw = live_object.id
        except Exception as e:
            logger.warning(
                "safe_int_id: %r has no _live_ptr and .id raised %s: %s",
                live_object, type(e).__name__, e,
            )
            return None
    if raw is None:
        return None
    try:
        return int(raw) & 0x7FFFFFFF
    except (TypeError, ValueError):
        return None


def read_all_notes(clip):
    """Every MIDI note in ``clip``: ``(notes, None)``, or ``(None, exc)``
    when the LOM raised.

    ``Clip.get_all_notes_extended`` takes no arguments. Measured on Live
    13.0b26 (2026-11-25): the bare call returns the clip's
    ``MidiNoteVector``; ``(0, 128, 0.0, length)`` raises
    ``Boost.Python.ArgumentError`` ("did not match C++ signature
    get_all_notes_extended(TPyHandle<AClip>)"). That ranged form belongs to
    ``get_notes_extended(from_pitch, pitch_span, from_time, time_span)``.
    Every reader used to try the ranged form first and fall back on the
    ``TypeError``, so the fallback was the path every read took
    (docs/reference/live-api-measurements.md, "Clip").
    """
    try:
        return clip.get_all_notes_extended(), None
    except LOM_ERRORS as e:
        return None, e
