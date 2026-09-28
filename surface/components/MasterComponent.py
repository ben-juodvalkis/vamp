"""MasterComponent — PR-5b master-track metadata channel.

Owns ``/looping/v3/master/{volume,name,color,pan,mute}`` per
[04 §2.4](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#24-non-normative-what-the-1-master-sentinel-becomes)
and [phase-5-pr5b-master-design.md].

Scope: master track attributes only. Devices on the master track are
emitted by V3StateFullComponent under ``master/devices/<N>/params/<N>``
— this component does not touch that path.

Wire shape — no path arg
------------------------

Master is a singleton per session, so the address family is flat and
the ``trackPath`` argument is omitted:

    /looping/v3/master/name    [name:string]
    /looping/v3/master/color   [rgb:int]
    /looping/v3/master/volume  [value:float]
    /looping/v3/master/pan     [pan:float]
    /looping/v3/master/mute    [muted:int]

See the design doc for the 8-byte-per-meter rationale.

``master.mute`` RuntimeError guard
----------------------------------

Per user memory ``project_live_lom_quirks.md`` and confirmed in Phase 1
exploration: in Live 12 ``master.mute`` raises ``RuntimeError('Main
track has no 'mute' property!')`` from *inside* the property getter.
``getattr(master, 'mute', default)`` does NOT save you — ``getattr``'s
default-on-AttributeError semantics don't cover ``RuntimeError``. The
guard must name ``RuntimeError`` + ``AttributeError`` explicitly so a
new exception from a future Live update surfaces as a bug, not silent
failure. Bare ``except:`` is rejected by design.

The guard lives on every LOM touch: listener attach in ``__init__``,
read in fire callbacks, setattr in the handler. On failure we log
WARNING once per (attr, context) pair (not per fire — a dragged fader
that keeps failing would flood Log.txt) and return cleanly.

Volume / pan live on the mixer_device
-------------------------------------

Live exposes volume and pan via ``master.mixer_device.volume.value``
and ``master.mixer_device.panning.value`` — not as attributes on the
master track itself. Listener attach is on the *parameter* object, not
the track. See the ``_MIXER_ATTRS`` table below for the split.

No echo suppression
-------------------

Unlike TrackMetadataComponent, master writes do **not** suppress the
self-fire. The UI surface for master volume/pan has no optimistic
local update — the listener echo *is* the signal that triggers the
re-render (see ``MasterTrack.svelte``'s ``$derived`` off
``v3Store.tracks.get('master').volume``). Suppressing the echo would
strand the UI on whatever value it last saw. Cost is one extra
emission per UI-originated write — for a dragged fader that's
dwarfed by the per-frame fire rate already in flight.

This is the master-vs-track-metadata seam: track metadata has
optimistic state, master doesn't.

Initial emit at startup
-----------------------

``state/full`` does not carry master volume or pan (the T record's
columns are name/color/mute/solo/arm/capabilities only — see
[03 §5]). Without a seed emit, the UI's master ``$derived`` would
fall back to its 0.85 default forever unless the user moved the
fader manually in Ableton. ``_emit_initial_values()`` runs once at
init, after listener attach, and emits each attr's current LOM
value through the same path the listener fires use. This closes the
cold-start gap with one emission per attr at boot.

Range validation
----------------

Validate-and-reject, never clamp — same contract as
TrackMetadataComponent.

- ``volume``: float, ``0.0 ≤ v ≤ 1.0``, NaN rejected.
- ``pan``: float, ``-1.0 ≤ v ≤ +1.0``, NaN rejected.
- ``name``: non-empty string, ``≤ 255`` chars.
- ``color``: int, ``0 ≤ v ≤ 0xFFFFFF``.
- ``mute``: 0 or 1; nonzero int coerces to True; strings rejected.

No device duplication — no structural rebind
--------------------------------------------

Master devices already emit through V3StateFullComponent under
``master/devices/*``; this component leaves that alone. Master itself
is permanent — no tracks-changed analog — so no
``on_structural_change`` hook; listeners attach in ``__init__`` and
detach in ``disconnect``. If a device is added to the master track
mid-session the existing structural composite fires
``state/full reason="structural"`` covering the master subtree; the
listeners here don't depend on device structure and survive
untouched.
"""

from __future__ import annotations

import logging
import math
from typing import Callable, Dict, Optional, Tuple

logger = logging.getLogger("looping")


# --- wire addresses (closed-enum; renames fail at import time) ------------

V3_MASTER_VOLUME_ADDRESS = "/looping/v3/master/volume"
V3_MASTER_NAME_ADDRESS = "/looping/v3/master/name"
V3_MASTER_COLOR_ADDRESS = "/looping/v3/master/color"
V3_MASTER_PAN_ADDRESS = "/looping/v3/master/pan"
V3_MASTER_MUTE_ADDRESS = "/looping/v3/master/mute"

# /looping/v3/error — same address as TrackMetadataComponent /
# DevicesComponent / PropertyComponent.
V3_ERROR_ADDRESS = "/looping/v3/error"

V3_ERROR_GENERATION_STALE = "generation-stale"
V3_ERROR_WRITE_REJECTED = "write-rejected"

# Error detail string used when a LOM property is unavailable — primarily
# master.mute on Live 12. Stable string so UI tests can assert on it.
DETAIL_ATTRIBUTE_UNAVAILABLE = "attribute-unavailable"


# --- attribute table ------------------------------------------------------
#
# Two families:
#
# - **track attrs** live directly on ``master_track`` (name, color,
#   mute). Listener-attach via ``add_<attr>_listener`` on the track.
# - **mixer attrs** live on ``master.mixer_device.<param>`` as
#   ``DeviceParameter`` objects (volume, pan). Listener-attach via
#   ``add_value_listener`` on the parameter object; read/write via the
#   parameter's ``.value``.
#
# The split matters for listener attach + read/write paths but not for
# the wire (all five addresses look the same to the UI).

_ATTR_VOLUME = "volume"
_ATTR_NAME = "name"
_ATTR_COLOR = "color"
_ATTR_PAN = "pan"
_ATTR_MUTE = "mute"


_ADDRESS_FOR_ATTR: Dict[str, str] = {
    _ATTR_VOLUME: V3_MASTER_VOLUME_ADDRESS,
    _ATTR_NAME: V3_MASTER_NAME_ADDRESS,
    _ATTR_COLOR: V3_MASTER_COLOR_ADDRESS,
    _ATTR_PAN: V3_MASTER_PAN_ADDRESS,
    _ATTR_MUTE: V3_MASTER_MUTE_ADDRESS,
}


# Attributes served off ``master_track`` directly.
_TRACK_ATTRS = frozenset({_ATTR_NAME, _ATTR_COLOR, _ATTR_MUTE})

# Attributes served off ``master.mixer_device.<param>``.
_MIXER_ATTRS = frozenset({_ATTR_VOLUME, _ATTR_PAN})

# LOM mixer-parameter name per mixer attr.
_MIXER_PARAM_FOR: Dict[str, str] = {
    _ATTR_VOLUME: "volume",
    _ATTR_PAN: "panning",
}


# --- helpers --------------------------------------------------------------


def _coerce_str(x) -> str:
    """Coerce an OSC arg to ``str``. Bytes → utf-8; everything else → ``str()``.

    Mirrors TrackMetadataComponent._coerce_str.
    """
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8")
        except UnicodeDecodeError:
            return x.decode("utf-8", errors="replace")
    return str(x)


# --- component ------------------------------------------------------------


class MasterComponent:
    """Owns the ``/looping/v3/master/*`` metadata address family.

    Args:
        song: The Live ``Song``.
        emit: ``(address, args)`` OSC sender — ``OSCTransport.send``.

    Generation injection is deferred via :meth:`set_generation` so
    tests can construct without the full surface graph. Without
    generation wired, handlers with a supplied ``ui_gen`` reject with
    ``write-rejected detail="surface misconfigured"``; handlers called
    without ``ui_gen`` bypass the stale check (matches
    TrackMetadataComponent posture).
    """

    def __init__(self, song, emit: Callable[[str, tuple], None]) -> None:
        self._song = song
        self._emit = emit
        self._generation = None
        self._disconnected = False

        # attr → listener callback, captured for detach.
        self._track_listeners: Dict[str, Callable[[], None]] = {}
        self._mixer_listeners: Dict[str, Callable[[], None]] = {}

        # (attr, context) → True once WARNING has been logged. Stops
        # the master.mute RuntimeError path from flooding Log.txt on a
        # dragged fader.
        self._warned: set = set()

        try:
            self._master = song.master_track
        except Exception as e:
            logger.error(
                "MasterComponent: master_track read failed: %s — "
                "component will reject all writes", e,
            )
            self._master = None
            return

        self._attach_all()
        self._emit_initial_values()
        logger.info(
            "MasterComponent ready: %d track listeners, %d mixer listeners",
            len(self._track_listeners), len(self._mixer_listeners),
        )

    def set_generation(self, generation_component) -> None:
        """Inject the ``GenerationComponent`` for stale-write checks.

        Idempotent; mirrors TrackMetadataComponent.set_generation.
        """
        self._generation = generation_component

    # --- listener attach / detach -----------------------------------------

    def _attach_all(self) -> None:
        """Attach one listener per attr.

        Track attrs go on ``master_track`` directly. Mixer attrs
        resolve ``master.mixer_device.<param>`` and attach a value
        listener on the parameter. Any attach failure is guard-
        logged once and skipped — the component stays up with a
        partial listener set.
        """
        for attr in _TRACK_ATTRS:
            self._attach_track_attr(attr)
        for attr in _MIXER_ATTRS:
            self._attach_mixer_attr(attr)

    def _attach_track_attr(self, attr: str) -> None:
        method_name = "add_%s_listener" % attr
        try:
            add = getattr(self._master, method_name, None)
        except (RuntimeError, AttributeError) as e:
            self._warn_once(attr, "listener-attach-lookup", e)
            return
        if not callable(add):
            self._warn_once(
                attr, "listener-attach-missing",
                AttributeError("no %s on master_track" % method_name),
            )
            return
        cb = self._make_track_listener(attr)
        try:
            add(cb)
        except (RuntimeError, AttributeError) as e:
            self._warn_once(attr, "listener-attach", e)
            return
        self._track_listeners[attr] = cb

    def _attach_mixer_attr(self, attr: str) -> None:
        param = self._resolve_mixer_param(attr)
        if param is None:
            return
        add = getattr(param, "add_value_listener", None)
        if not callable(add):
            self._warn_once(
                attr, "listener-attach-missing",
                AttributeError("no add_value_listener on mixer.%s"
                               % _MIXER_PARAM_FOR[attr]),
            )
            return
        cb = self._make_mixer_listener(attr)
        try:
            add(cb)
        except (RuntimeError, AttributeError) as e:
            self._warn_once(attr, "listener-attach", e)
            return
        self._mixer_listeners[attr] = cb

    def _resolve_mixer_param(self, attr: str):
        """Return the mixer parameter object for ``attr`` or ``None``.

        Wraps the ``master.mixer_device.<param>`` walk in the same
        RuntimeError/AttributeError guard as every other LOM touch in
        this component. A missing mixer is a framework regression but
        the component should still come up partially.
        """
        try:
            mixer = self._master.mixer_device
        except (RuntimeError, AttributeError) as e:
            self._warn_once(attr, "mixer-lookup", e)
            return None
        try:
            return getattr(mixer, _MIXER_PARAM_FOR[attr])
        except (RuntimeError, AttributeError) as e:
            self._warn_once(attr, "mixer-param-lookup", e)
            return None

    def _make_track_listener(self, attr: str) -> Callable[[], None]:
        """Build the closure for one track-attr (name/color/mute)."""

        def _on_fire(a=attr):
            if self._disconnected:
                return
            try:
                value = getattr(self._master, a)
            except (RuntimeError, AttributeError) as e:
                self._warn_once(a, "read-in-listener", e)
                return
            self._safe_emit(_ADDRESS_FOR_ATTR[a],
                            (self._coerce_to_wire(a, value),))

        return _on_fire

    def _make_mixer_listener(self, attr: str) -> Callable[[], None]:
        """Build the closure for one mixer-attr (volume/pan)."""

        def _on_fire(a=attr):
            if self._disconnected:
                return
            param = self._resolve_mixer_param(a)
            if param is None:
                return
            try:
                value = param.value
            except (RuntimeError, AttributeError) as e:
                self._warn_once(a, "read-in-listener", e)
                return
            self._safe_emit(_ADDRESS_FOR_ATTR[a],
                            (self._coerce_to_wire(a, value),))

        return _on_fire

    def _emit_initial_values(self) -> None:
        """Read each attr's current LOM value and emit once.

        Closes the cold-start gap — see module docstring "Initial
        emit at startup". Runs after listener attach, so a value
        change racing the boot sequence is still picked up by the
        listener (idempotent re-emit is harmless: same value).
        """
        for attr in _TRACK_ATTRS:
            try:
                value = getattr(self._master, attr)
            except (RuntimeError, AttributeError) as e:
                self._warn_once(attr, "initial-read", e)
                continue
            self._safe_emit(_ADDRESS_FOR_ATTR[attr],
                            (self._coerce_to_wire(attr, value),))
        for attr in _MIXER_ATTRS:
            param = self._resolve_mixer_param(attr)
            if param is None:
                continue
            try:
                value = param.value
            except (RuntimeError, AttributeError) as e:
                self._warn_once(attr, "initial-read", e)
                continue
            self._safe_emit(_ADDRESS_FOR_ATTR[attr],
                            (self._coerce_to_wire(attr, value),))

    # --- set handlers -----------------------------------------------------
    #
    # Five handler methods, one per attribute. LoopingSurface registers
    # each as a transport handler. Wire shape: ``[value, generation?]``
    # — no trackPath arg.

    def handle_set_volume(self, args, source_addr) -> None:
        self._handle_set(_ATTR_VOLUME, args)

    def handle_set_name(self, args, source_addr) -> None:
        self._handle_set(_ATTR_NAME, args)

    def handle_set_color(self, args, source_addr) -> None:
        self._handle_set(_ATTR_COLOR, args)

    def handle_set_pan(self, args, source_addr) -> None:
        self._handle_set(_ATTR_PAN, args)

    def handle_set_mute(self, args, source_addr) -> None:
        self._handle_set(_ATTR_MUTE, args)

    def _handle_set(self, attr: str, args) -> None:
        """Shared body for the five set handlers.

        Wire: ``[value, generation:int?]`` per [04 §2.4]. Generation is
        optional; a missing generation bypasses the stale check (same
        posture as TrackMetadataComponent).
        """
        if self._disconnected:
            return
        address = _ADDRESS_FOR_ATTR[attr]
        if self._master is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                detail="master-unavailable",
            )
            return
        if not args:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                detail="expected [value, generation?]",
            )
            return

        value = args[0]
        ui_gen: Optional[int] = None
        if len(args) >= 2:
            try:
                ui_gen = int(args[1])
            except (TypeError, ValueError) as e:
                self._emit_error(
                    address, V3_ERROR_WRITE_REJECTED,
                    detail="bad generation: %s" % e,
                )
                return

        if ui_gen is not None:
            if self._generation is None:
                logger.error(
                    "MasterComponent: generation component not wired; "
                    "refusing %s", attr,
                )
                self._emit_error(
                    address, V3_ERROR_WRITE_REJECTED,
                    detail="surface misconfigured",
                )
                return
            if self._generation.is_stale(ui_gen):
                self._emit_error(
                    address, V3_ERROR_GENERATION_STALE,
                    detail="ui=%d, surf=%d" % (
                        ui_gen, self._generation.current,
                    ),
                )
                return

        coerced = self._coerce_from_wire(attr, value)
        if coerced is None:
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                detail="out-of-range: %r" % (value,),
            )
            return

        try:
            if attr in _TRACK_ATTRS:
                self._write_track_attr(attr, coerced)
            else:
                self._write_mixer_attr(attr, coerced)
        except (RuntimeError, AttributeError) as e:
            detail = (
                DETAIL_ATTRIBUTE_UNAVAILABLE
                if isinstance(e, RuntimeError)
                else "lom rejected: %s" % e
            )
            self._warn_once(attr, "write", e)
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED, detail=detail,
            )
        except Exception as e:
            logger.warning(
                "MasterComponent: write %s=%r raised: %s",
                attr, coerced, e,
            )
            self._emit_error(
                address, V3_ERROR_WRITE_REJECTED,
                detail="lom rejected: %s" % e,
            )

    def _write_track_attr(self, attr: str, value) -> None:
        setattr(self._master, attr, value)

    def _write_mixer_attr(self, attr: str, value) -> None:
        param = self._resolve_mixer_param(attr)
        if param is None:
            # Raise so the outer handler emits write-rejected; the
            # resolver already logged the attach-path WARNING.
            raise RuntimeError(DETAIL_ATTRIBUTE_UNAVAILABLE)
        param.value = value

    # --- validation + coercion --------------------------------------------

    def _coerce_from_wire(self, attr: str, value):
        """Validate + coerce wire → LOM. Returns ``None`` to reject."""
        if attr == _ATTR_VOLUME:
            try:
                fv = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(fv) or math.isinf(fv):
                return None
            if fv < 0.0 or fv > 1.0:
                return None
            return fv
        if attr == _ATTR_PAN:
            try:
                fv = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(fv) or math.isinf(fv):
                return None
            if fv < -1.0 or fv > 1.0:
                return None
            return fv
        if attr == _ATTR_COLOR:
            if isinstance(value, bool):
                return None
            if isinstance(value, float):
                if not value.is_integer():
                    return None
                value = int(value)
            if not isinstance(value, int):
                return None
            if value < 0 or value > 0xFFFFFF:
                return None
            return value
        if attr == _ATTR_NAME:
            if not isinstance(value, (str, bytes)):
                return None
            sv = _coerce_str(value)
            if not sv or len(sv) > 255:
                return None
            return sv
        if attr == _ATTR_MUTE:
            if isinstance(value, str):
                return None
            try:
                iv = int(value)
            except (TypeError, ValueError):
                return None
            return bool(iv)
        return None

    def _coerce_to_wire(self, attr: str, value):
        """Coerce LOM → wire. Inverse of _coerce_from_wire."""
        if attr == _ATTR_MUTE:
            return 1 if bool(value) else 0
        if attr == _ATTR_COLOR:
            try:
                return int(value)
            except (TypeError, ValueError):
                return 0
        if attr in (_ATTR_VOLUME, _ATTR_PAN):
            try:
                return float(value)
            except (TypeError, ValueError):
                return 0.0
        # name
        return _coerce_str(value) if isinstance(value, bytes) else value

    # --- emit helpers -----------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning(
                "MasterComponent: emit %s failed: %s", address, e,
            )

    def _emit_error(
        self,
        address: str,
        code: str,
        detail: str,
    ) -> None:
        """Emit ``/looping/v3/error [address, code, trackPath, detail]``.

        Same four-arg shape as TrackMetadataComponent — the UI error
        parser keys on ``(address, code)`` and tolerates an empty
        trackPath. We pass the literal ``"master"`` so the error log
        tells a human reader what was targeted without the UI having
        to reverse-engineer the address family.
        """
        self._safe_emit(
            V3_ERROR_ADDRESS, (address, code, "master", detail),
        )

    def _warn_once(self, attr: str, context: str, exc: BaseException) -> None:
        key: Tuple[str, str] = (attr, context)
        if key in self._warned:
            return
        self._warned.add(key)
        logger.warning(
            "MasterComponent %s: %s access raised %s: %s "
            "(suppressing further warnings)",
            attr, context, type(exc).__name__, exc,
        )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        """Detach all listeners, drop state. Idempotent."""
        if self._disconnected:
            return
        self._disconnected = True

        for attr, cb in list(self._track_listeners.items()):
            remove = getattr(
                self._master, "remove_%s_listener" % attr, None,
            )
            if not callable(remove):
                continue
            try:
                remove(cb)
            except (RuntimeError, AttributeError) as e:
                logger.debug(
                    "MasterComponent: remove_%s_listener raised: %s",
                    attr, e,
                )

        for attr, cb in list(self._mixer_listeners.items()):
            param = self._resolve_mixer_param(attr)
            if param is None:
                continue
            remove = getattr(param, "remove_value_listener", None)
            if not callable(remove):
                continue
            try:
                remove(cb)
            except (RuntimeError, AttributeError) as e:
                logger.debug(
                    "MasterComponent: mixer remove_value_listener for "
                    "%s raised: %s", attr, e,
                )

        self._track_listeners.clear()
        self._mixer_listeners.clear()
