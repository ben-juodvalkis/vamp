"""MidiWheelsComponent — the on-screen pitch and mod wheels, through MidiWheels.

The interface's two wheels drive **MidiWheels** (``Vamp Devices/
MidiWheels.amxd``), a MIDI effect with two parameters — the mod wheel into
``ctlout 1`` and the pitch wheel into ``xbendout`` — on the selected track:

    /looping/v3/wheels/mod    [0-127]     → MidiWheels parameter 1
    /looping/v3/wheels/pitch  [0-16383]   → MidiWheels parameter 2 (8192 = centre)

Until 2026-09-25 the wheels went ``/midi/*`` → the bridge's ``midiConverter``
port (11004) → the standalone Max Utility patch → ``xbendout`` / ``ctlout``
into Live through Max's virtual MIDI port "a". A device on the track needs
no standalone Max, so the wheels work on any Live Suite install.

The expression pedal shares the device: on a MIDI track it loads and sweeps
the same MidiWheels (``WahPedalComponent``, which reads its target from
``read_midi_wheels_config`` below). One device per track, whichever of the
two touched it first; the pedal and the mod wheel both write parameter 1, so
they can't stack and the last one moved wins.

Behavior
--------

- **MIDI tracks only** (``track.has_midi_input``). A wheel move on an audio
  track is dropped.
- **Load on first touch.** No MidiWheels on the selected track → the first
  wheel move loads ``devices.midiWheels.devicePath`` through
  ``DeviceLoadComponent.load_into_track`` (the file is reached through the
  "Vamp Devices" sidebar Place). Live puts a MIDI
  effect ahead of the instrument, which is where its output has to go. The
  device is in ``track.devices`` when the load returns (ADR-437), so the
  same move then lands on it; if it isn't visible yet, one scheduled retry
  applies the value on the next tick.
- **The latest value wins.** Handlers only store the newest value per
  wheel; ``flush`` — a transport drain hook — writes them once per drain
  pass. A burst of frames costs one write, and the pitch wheel's spring-back
  (the UI's final 8192) can never be overtaken by an older frame.
- **One undo step per gesture.** Live records one undo step per parameter
  write, merging only unbroken runs on one parameter (measured 2026-09-25 on
  MidiWheels: seven writes alternating mod/pitch → three steps). The first
  write of a gesture opens ``song.begin_undo_step`` and the step closes
  after ``GESTURE_UNDO_IDLE_MS`` with no write, as the Drum view's macro
  drag does (ADR-428). The parameters stay **automatable**: a surface write
  records into the arrangement like a hand on the dial (measured the same
  day), which is how a performance keeps its wheel moves — the device's
  output is not recorded into the track's MIDI clip.
- **Ranges come from the device.** Every value is clamped into the
  parameter's own ``[min, max]``, and the pitch wheel additionally to the
  14-bit maximum 16383 — the dial's own range reads 0–16384, and
  ``xbendout`` takes 0–16383.
- Selection, device-list changes and a raising write drop the cached
  parameters; the next write re-resolves on the track now in view.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Dict, Optional, Tuple

from .drum_vm_functions import GESTURE_UNDO_IDLE_MS

from . import live_library
logger = logging.getLogger("looping")

_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)
_WRITE_ERRORS: Tuple[type, ...] = _LOM_ERRORS + (ValueError,)

V3_WHEELS_PITCH_ADDRESS = "/looping/v3/wheels/pitch"
V3_WHEELS_MOD_ADDRESS = "/looping/v3/wheels/mod"

CONFIG_KEY = "midiWheels"
DEFAULT_CLASS_NAME = "MxDeviceMidiEffect"
DEFAULT_DEVICE_NAME = "MidiWheels"
# parameters[0] is Live's "Device On"; the device's own dials follow.
DEFAULT_MOD_PARAM_INDEX = 1
DEFAULT_PITCH_PARAM_INDEX = 2

MOD = "mod"
PITCH = "pitch"

# The wire ranges (documented on the two addresses). The pitch ceiling is
# also enforced on the write: 16383 is the 14-bit maximum xbendout takes.
_WIRE_MAX = {MOD: 127.0, PITCH: 16383.0}


def _str_or(value, fallback: str) -> str:
    return value if isinstance(value, str) and value else fallback


def _int_or(value, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


class MidiWheelsConfig:
    """``constants.devices.midiWheels``, coerced. Shared with the pedal."""

    __slots__ = (
        "device_path", "class_name", "device_name", "mod_index",
        "pitch_index", "sweep_margin_raw",
    )

    def __init__(self, cfg) -> None:
        cfg = cfg if isinstance(cfg, dict) else {}
        # The checkout's own MidiWheels.amxd (2026-09-26), found from this
        # file; an older config's devicePath stands in when the checkout has
        # none. Loaded through the "Vamp Devices" Place, by path otherwise.
        self.device_path = live_library.device_path(
            live_library.MIDI_WHEELS_REL, _str_or(cfg.get("devicePath"), ""),
        )
        self.class_name = _str_or(cfg.get("className"), DEFAULT_CLASS_NAME)
        self.device_name = _str_or(cfg.get("deviceName"), DEFAULT_DEVICE_NAME)
        self.mod_index = _int_or(cfg.get("modParamIndex"), DEFAULT_MOD_PARAM_INDEX)
        self.pitch_index = _int_or(
            cfg.get("pitchParamIndex"), DEFAULT_PITCH_PARAM_INDEX,
        )
        # The pedal's sweep-to-load margin, read by WahPedalComponent.
        self.sweep_margin_raw = cfg.get("sweepLoadMargin")

    def index_for(self, wheel: str) -> int:
        return self.mod_index if wheel == MOD else self.pitch_index


def read_midi_wheels_config(constants) -> Optional[MidiWheelsConfig]:
    """The ``devices.midiWheels`` block, or None when it is absent."""
    if not isinstance(constants, dict):
        return None
    devices = constants.get("devices")
    if not isinstance(devices, dict) or not isinstance(devices.get(CONFIG_KEY), dict):
        return None
    return MidiWheelsConfig(devices[CONFIG_KEY])


def find_midi_wheels(track, cfg: MidiWheelsConfig):
    """MidiWheels on ``track`` (class + name match), or None."""
    try:
        devices = track.devices
    except _LOM_ERRORS as e:
        logger.warning(
            "MidiWheelsComponent: read track.devices raised: %s: %s",
            type(e).__name__, e,
        )
        return None
    for device in (devices or ()):
        try:
            if (
                getattr(device, "class_name", "") == cfg.class_name
                and getattr(device, "name", "") == cfg.device_name
            ):
                return device
        except _LOM_ERRORS:
            continue
    return None


class MidiWheelsComponent:
    """Owns ``/looping/v3/wheels/pitch`` and ``/looping/v3/wheels/mod``.

    Args:
        song: the Live ``Song``.
        constants: the loaded constants dict; reads ``devices.midiWheels``.
            No block → the wheels are dropped with one WARN (nothing to load
            or find).
        load_into_track: ``(track, preset_path, at_head=False) ->
            Optional[str]`` — ``DeviceLoadComponent.load_into_track``,
            resolved lazily by the caller. ``None`` on success.
        schedule_delayed: ``(delay_ms, fn)`` — the surface's
            ``schedule_message`` adapter; closes the gesture's undo step and
            retries a load not yet visible. ``None`` closes the step after
            every flush (tests).
        clock: seconds, monotonic.
    """

    V3_WHEELS_PITCH_ADDRESS = V3_WHEELS_PITCH_ADDRESS
    V3_WHEELS_MOD_ADDRESS = V3_WHEELS_MOD_ADDRESS

    def __init__(
        self,
        song,
        constants: dict,
        load_into_track: Callable[..., Optional[str]],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._song = song
        self._load_into_track = load_into_track
        self._schedule_delayed = schedule_delayed
        self._clock = clock
        self._disconnected = False
        self._cfg = read_midi_wheels_config(constants)
        if self._cfg is None:
            logger.warning(
                "MidiWheelsComponent: no devices.%s block in constants.json — "
                "the on-screen wheels are dropped.", CONFIG_KEY,
            )
        elif not self._cfg.device_path:
            logger.warning(
                "MidiWheelsComponent: devices.%s.devicePath missing — the "
                "wheels drive a MidiWheels already on the track but cannot "
                "load one.", CONFIG_KEY,
            )

        # Newest value per wheel since the last flush.
        self._pending: Dict[str, float] = {}
        # Cached parameters of the MidiWheels being driven, per wheel.
        self._params: Dict[str, object] = {}
        # A load was issued and its device has not been seen yet: never
        # issue a second one (it would stack a second MidiWheels).
        self._load_pending = False
        # A load failed on this track: don't retry on every frame. Both
        # flags clear on a selection or device-list change.
        self._load_failed = False
        self._retry_scheduled = False

        self._undo_open = False
        self._undo_close_scheduled = False
        self._undo_deadline = 0.0

        self._view = None
        self._listener_attached = False
        try:
            self._view = song.view
            self._view.add_selected_track_listener(self._on_selected_track_changed)
            self._listener_attached = True
        except _LOM_ERRORS as e:
            logger.warning(
                "MidiWheelsComponent: attach selected_track listener raised: "
                "%s: %s", type(e).__name__, e,
            )

        if self._cfg is not None:
            logger.info(
                "MidiWheelsComponent: ready (device=%r class=%r name=%r "
                "mod=parameters[%d] pitch=parameters[%d])",
                self._cfg.device_path, self._cfg.class_name,
                self._cfg.device_name, self._cfg.mod_index,
                self._cfg.pitch_index,
            )

    # --- wire handlers ----------------------------------------------------

    def handle_pitch(self, args, source_addr) -> None:
        """``/looping/v3/wheels/pitch [0-16383]`` — 8192 is centre."""
        self._store(PITCH, args)

    def handle_mod(self, args, source_addr) -> None:
        """``/looping/v3/wheels/mod [0-127]``."""
        self._store(MOD, args)

    def _store(self, wheel: str, args) -> None:
        if self._disconnected or self._cfg is None or not args:
            return
        try:
            value = float(args[0])
        except (TypeError, ValueError):
            logger.warning("MidiWheelsComponent: %s coerce failed args=%r", wheel, args)
            return
        if value != value:  # NaN
            return
        self._pending[wheel] = min(_WIRE_MAX[wheel], max(0.0, value))

    # --- drain hook -------------------------------------------------------

    def flush(self) -> None:
        """Write the newest value of each wheel that moved. Registered as a
        transport drain hook, so it runs once per pass that dispatched."""
        if self._disconnected or not self._pending:
            return
        track = self._selected_track()
        if track is None or not self._is_midi_track(track):
            self._pending.clear()
            return

        if not self._params:
            device = find_midi_wheels(track, self._cfg)
            if device is None:
                if not self._load_pending and not self._load_failed:
                    self._load(track)
                device = find_midi_wheels(track, self._cfg)
                if device is None:
                    # Not visible yet: keep the values for one retry.
                    self._schedule_retry()
                    return
            self._load_pending = False
            self._bind(device)
            if not self._params:
                self._pending.clear()
                return

        pending, self._pending = self._pending, {}
        for wheel, value in pending.items():
            param = self._params.get(wheel)
            if param is None:
                continue
            if not self._write(param, wheel, value):
                # Stale handle: re-resolve once and write fresh.
                self._params = {}
                device = find_midi_wheels(track, self._cfg)
                if device is None:
                    continue
                self._bind(device)
                param = self._params.get(wheel)
                if param is not None:
                    self._write(param, wheel, value)
        self._arm_undo_close()

    # --- structural hooks -------------------------------------------------

    def on_track_devices_changed(self, track) -> None:
        """Any track's device list changed: drop the cached parameters so
        the next write re-finds MidiWheels (a deleted one is re-loaded, a
        pedal-loaded one is picked up). Pure Python state — this runs inside
        Live's notification."""
        if self._disconnected:
            return
        self._params = {}
        self._load_pending = False
        self._load_failed = False

    def _on_selected_track_changed(self) -> None:
        if self._disconnected:
            return
        self._params = {}
        self._load_pending = False
        self._load_failed = False

    # --- internals --------------------------------------------------------

    def _selected_track(self):
        try:
            return self._song.view.selected_track
        except _LOM_ERRORS as e:
            logger.warning(
                "MidiWheelsComponent: read selected_track raised: %s: %s",
                type(e).__name__, e,
            )
            return None

    @staticmethod
    def _is_midi_track(track) -> bool:
        try:
            return bool(track.has_midi_input)
        except _LOM_ERRORS:
            return False

    def _bind(self, device) -> None:
        self._params = {}
        try:
            params = device.parameters
            count = len(params)
        except _LOM_ERRORS as e:
            logger.warning(
                "MidiWheelsComponent: read parameters raised: %s: %s",
                type(e).__name__, e,
            )
            return
        for wheel in (MOD, PITCH):
            index = self._cfg.index_for(wheel)
            if 0 <= index < count:
                self._params[wheel] = params[index]
            else:
                logger.warning(
                    "MidiWheelsComponent: MidiWheels has no parameter %d (%s)",
                    index, wheel,
                )

    def _load(self, track) -> None:
        if not self._cfg.device_path:
            return
        try:
            err = self._load_into_track(
                track, self._cfg.device_path, at_head=False,
                source=live_library.m4l_source(), rel=live_library.MIDI_WHEELS_REL,
            )
        except Exception as e:  # a load failure must not take the surface down
            logger.warning(
                "MidiWheelsComponent: load raised: %s: %s", type(e).__name__, e,
            )
            self._load_failed = True
            return
        if err:
            logger.warning("MidiWheelsComponent: load failed: %s", err)
            self._load_failed = True
            return
        self._load_pending = True
        logger.info("MidiWheelsComponent: loaded MidiWheels onto the selected track")

    def _schedule_retry(self) -> None:
        if not self._load_pending:
            # The load failed: nothing will appear to write to.
            self._pending.clear()
            return
        if self._retry_scheduled or self._schedule_delayed is None:
            # A retry is already on its way; it writes the newest value.
            return
        self._retry_scheduled = True

        def retry():
            self._retry_scheduled = False
            if self._pending and not self._disconnected:
                self.flush()
            # Still not visible: drop the values rather than hold them
            # forever. The load stays pending, so no second copy is loaded;
            # the device-list change that shows it clears the flag.
            if self._pending and not self._params:
                self._pending.clear()

        try:
            self._schedule_delayed(100, retry)
        except Exception as e:
            self._retry_scheduled = False
            logger.warning("MidiWheelsComponent: schedule_delayed failed: %s", e)

    def _write(self, param, wheel: str, value: float) -> bool:
        try:
            lo = float(param.min)
            hi = min(float(param.max), _WIRE_MAX[wheel])
            clamped = lo if value < lo else hi if value > hi else value
            if float(param.value) == clamped:
                return True
            self._open_undo_step()
            param.value = clamped
        except _WRITE_ERRORS as e:
            logger.warning(
                "MidiWheelsComponent: %s write raised (stale ref?): %s: %s",
                wheel, type(e).__name__, e,
            )
            return False
        return True

    # --- gesture undo step (the DrumVirtualMacroComponent pattern) ---------

    def _open_undo_step(self) -> None:
        if self._undo_open:
            return
        try:
            self._song.begin_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("MidiWheelsComponent: begin_undo_step raised: %s", e)
            return
        self._undo_open = True

    def _arm_undo_close(self) -> None:
        if not self._undo_open:
            return
        if self._schedule_delayed is None:
            self._close_undo_step()
            return
        self._undo_deadline = self._clock() + GESTURE_UNDO_IDLE_MS / 1000.0
        if self._undo_close_scheduled:
            return
        self._undo_close_scheduled = True
        try:
            self._schedule_delayed(GESTURE_UNDO_IDLE_MS, self._maybe_close_undo_step)
        except Exception as e:
            self._undo_close_scheduled = False
            logger.warning("MidiWheelsComponent: schedule_delayed failed: %s", e)
            self._close_undo_step()

    def _maybe_close_undo_step(self) -> None:
        self._undo_close_scheduled = False
        if not self._undo_open:
            return
        remaining = self._undo_deadline - self._clock()
        if remaining > 0.005:
            self._undo_close_scheduled = True
            try:
                self._schedule_delayed(int(remaining * 1000) + 1, self._maybe_close_undo_step)
                return
            except Exception as e:
                self._undo_close_scheduled = False
                logger.warning("MidiWheelsComponent: schedule_delayed failed: %s", e)
        self._close_undo_step()

    def _close_undo_step(self) -> None:
        if not self._undo_open:
            return
        self._undo_open = False
        try:
            self._song.end_undo_step()
        except _LOM_ERRORS as e:
            logger.warning("MidiWheelsComponent: end_undo_step raised: %s", e)

    # --- lifecycle --------------------------------------------------------

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._close_undo_step()
        self._disconnected = True
        if self._view is not None and self._listener_attached:
            try:
                self._view.remove_selected_track_listener(self._on_selected_track_changed)
            except _LOM_ERRORS as e:
                logger.warning(
                    "MidiWheelsComponent: detach selected_track listener "
                    "raised: %s: %s", type(e).__name__, e,
                )
        self._listener_attached = False
        self._pending.clear()
        self._params = {}
