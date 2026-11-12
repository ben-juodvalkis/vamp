"""RackChainDevicesComponent — the chains and devices inside a rack
(ADR-529, protocol 3.13.0, 2026-11-12).

Before it, the effect chain on the iPad stopped at a rack's own cell: the
wire could name nothing inside an Audio Effect Rack. This component is the
surface half of unfolding one. It is ``DrumPadChainComponent``'s shape
applied to the racks whose chains are a list the user orders (Audio Effect,
Instrument and MIDI Effect Racks), addressed ``…/chains/<i>/devices/<j>``.

One computed row on those racks, ``chain_devices`` (provider
``rack_chain_devices``), read-only, subscribed while the rack is unfolded on
a client:

- **its value** is the chains as JSON —
  ``{"chains":[{"index":0,"name":"Wet","color":16711680,"mute":0,"solo":0,
  "volume":0.85,"devices":[{"index":0,"class":"Hybrid","name":"Reverb","type":2,
  "rack":0}]}]}`` — ``rack`` 1 for a device that is itself a rack (the UI
  offers to unfold it; its own row is subscribed then);
- **every cold read also sends a rack-scoped ``state/full/tree``**
  (``V3StateFullComponent.emit_rack_chain``: reason ``rack-chain``, scope
  the rack's path, D and P records for every device on every chain), so
  the devices are ordinary device records on the client;
- **while subscribed** every parameter of every device on the chains has a
  value listener feeding the mutation fan-out with its composed path, so
  ``param/value`` echoes and writes work exactly as on a top-level device.

A writable ``show_devices`` row (0/1) on the same racks is Live's Show
Devices toggle (``view.is_showing_chain_devices``), which the chain overview's
fold mirrors both ways: its listener echoes a change made in Live, and a
write sets it, and the rack's chain list too where Live allows one (two
chains or more). A writable ``selected_chain`` row (an index) is the chain
Live shows the devices of (``view.selected_chain``), which the chain list's
choice mirrors the same way.

Three writable rows per chain, synthesised by ``PropertyComponent.spec_for``:
``chain.<i>.mute`` and ``chain.<i>.solo`` (0/1) — Live's chain activator and
solo — and ``chain.<i>.volume``, the chain's mixer volume (0..1, 0.85 =
0 dB), which the row also carries as ``volume``. Their echo is the
``chain_devices`` row the chain's own listeners re-emit.

Changes are deferred ``CHAIN_CHANGE_DELAY_MS`` (listeners only mark and
schedule; Live refuses writes and listener edits inside a notification).
A change of shape — a chain or a device added, removed or moved — advances
the generation, runs the property channel's structural invalidate (a nested
rack's subscription on a path that moved is torn down) and re-sends the
bundle; a rename, colour, mute or solo change re-emits the row alone. It
never republishes the song and never feeds ``on_device_added``.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Callable, Dict, List, Optional, Set, Tuple

from .path_resolver import (
    compose_chain_device_path,
    compose_param_path_under,
    compose_rack_chain_path,
    safe_rack_chains,
    same_lom_handle,
)

logger = logging.getLogger("looping")

PROVIDER_NAME = "rack_chain_devices"
CHAIN_DEVICES_KEY = "chain_devices"
#: Live's Show Devices toggle on a rack (``view.is_showing_chain_devices``),
#: which the chain overview's fold mirrors both ways.
SHOW_DEVICES_KEY = "show_devices"
#: The chain Live shows a rack's devices for (``view.selected_chain``), as an
#: index into its chains: the chain overview's chosen chain, both ways.
SELECTED_CHAIN_KEY = "selected_chain"
#: A rack's macro variations (ADR-531): ``{"count": n, "selected": i}``,
#: read-only, followed by Live's ``variation_count`` listener (the selected
#: index has none; the surface re-emits it after its own writes).
VARIATIONS_KEY = "variations"
#: The variation verbs, each a write: recall or delete the variation at an
#: index, store the macros as a new one, randomize the macros.
VARIATION_RECALL_KEY = "variation.recall"
VARIATION_STORE_KEY = "variation.store"
VARIATION_DELETE_KEY = "variation.delete"
VARIATION_RANDOMIZE_KEY = "variation.randomize"
VARIATION_ACTION_KEYS = (VARIATION_RECALL_KEY, VARIATION_STORE_KEY, VARIATION_DELETE_KEY, VARIATION_RANDOMIZE_KEY)
CHAIN_DEVICES_PROPERTY = CHAIN_DEVICES_KEY
#: The racks whose chains are reached by index (a Drum Rack's are by note).
RACK_CLASS_NAMES = ("AudioEffectGroupDevice", "InstrumentGroupDevice", "MidiEffectGroupDevice")
V3_PROPERTY_VALUE_ADDRESS = "/looping/v3/property/value"
REASON_RACK_CHAIN = "rack-chain"

#: The drum layer's re-seed margin: a chain populates after the add fires.
CHAIN_CHANGE_DELAY_MS = 150
#: Value listeners kept on one rack's chain devices.
MAX_CHAIN_PARAM_LISTENERS = 512
#: Past this many bytes the row drops device names.
CHAIN_DEVICES_BYTES_SOFT_CAP = 8000

_CHAIN_FIELD_RE = re.compile(r"^chain\.(0|[1-9][0-9]{0,2})\.(mute|solo|volume)$")
_LOM_ERRORS = (RuntimeError, AttributeError, TypeError, ValueError)


def parse_chain_field(property_name) -> Optional[Tuple[int, str]]:
    """``chain.3.mute`` → ``(3, "mute")``; ``None`` for anything else."""
    if not isinstance(property_name, str):
        return None
    m = _CHAIN_FIELD_RE.match(property_name)
    if m is None:
        return None
    return int(m.group(1)), m.group(2)


def chain_field_property(index: int, field: str) -> str:
    return "chain.%d.%s" % (index, field)


def _read(obj, attr, default=None):
    try:
        return getattr(obj, attr)
    except _LOM_ERRORS:
        return default


def _as_int_or_none(value) -> Optional[int]:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _flag(value) -> int:
    try:
        return 1 if bool(value) else 0
    except Exception:
        return 0


def _chain_volume(chain):
    """``chain.mixer_device.volume`` — Live's "Chain Volume", 0..1 with 0.85
    = 0 dB (measured on the rig, 2026-09-08) — or ``None``."""
    mixer = _read(chain, "mixer_device")
    return None if mixer is None else _read(mixer, "volume")


def _volume_value(chain) -> Optional[float]:
    param = _chain_volume(chain)
    try:
        return None if param is None else round(float(param.value), 4)
    except (TypeError, ValueError, RuntimeError, AttributeError):
        return None


def _devices_of(chain) -> List[object]:
    try:
        return list(chain.devices or ())
    except _LOM_ERRORS:
        return []


def _is_rack(device) -> bool:
    return bool(safe_rack_chains(device)) or (
        bool(_read(device, "can_have_chains", False)) and not bool(_read(device, "can_have_drum_pads", False))
    )


def chains_payload(rack) -> Dict[str, object]:
    chains = []
    for index, chain in enumerate(safe_rack_chains(rack)):
        devices = []
        for d_index, device in enumerate(_devices_of(chain)):
            devices.append({
                "index": d_index,
                "class": str(_read(device, "class_name", "") or ""),
                "name": str(_read(device, "name", "") or ""),
                "type": _as_int_or_none(_read(device, "type")),
                "rack": 1 if _is_rack(device) else 0,
            })
        chains.append({
            "index": index,
            "name": str(_read(chain, "name", "") or ""),
            "color": _as_int_or_none(_read(chain, "color")),
            "mute": _flag(_read(chain, "mute", False)),
            "solo": _flag(_read(chain, "solo", False)),
            "volume": _volume_value(chain),
            "devices": devices,
        })
    return {"chains": chains}


def chains_json(rack) -> str:
    payload = chains_payload(rack)
    text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    if len(text) > CHAIN_DEVICES_BYTES_SOFT_CAP:
        for chain in payload["chains"]:
            for d in chain["devices"]:
                d.pop("name", None)
        text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return text


class _RackState:
    __slots__ = ("device", "device_path", "subscribed", "shape_listeners", "param_listeners", "scheduled", "structural")

    def __init__(self, device, device_path: str) -> None:
        self.device = device
        self.device_path = device_path
        self.subscribed = False
        # (LOM object, attribute, callback)
        self.shape_listeners: List[Tuple[object, str, Callable[[], None]]] = []
        self.param_listeners: List[Tuple[object, Callable[[], None]]] = []
        self.scheduled = False
        self.structural = False


def read_show_devices(rack) -> Optional[int]:
    """1 while Live shows the rack's chain devices, 0 when not, ``None`` unread."""
    view = _read(rack, "view")
    if view is None:
        return None
    value = _read(view, "is_showing_chain_devices")
    return None if value is None else _flag(value)


def write_show_devices(rack, on: bool) -> Tuple[bool, str]:
    """Set Live's Show Devices toggle, and its chain list where the rack has
    the two chains Live needs for one (measured on 12.4.25b1: a one-chain
    rack refuses ``is_showing_chains`` with "Rack needs at least 2 chains to
    show in-line mixer", and ``can_show_chains`` reads False)."""
    view = _read(rack, "view")
    if view is None:
        return False, "rack has no view"
    try:
        view.is_showing_chain_devices = bool(on)
    except _LOM_ERRORS as e:
        return False, str(e)
    if bool(_read(rack, "can_show_chains", False)):
        try:
            rack.is_showing_chains = bool(on)
        except _LOM_ERRORS:
            pass
    return True, ""


def read_selected_chain(rack) -> Optional[int]:
    """The index of the chain Live shows the rack's devices for, ``None``
    when unread or not one of the rack's chains."""
    view = _read(rack, "view")
    chosen = _read(view, "selected_chain") if view is not None else None
    if chosen is None:
        return None
    for i, chain in enumerate(safe_rack_chains(rack)):
        if same_lom_handle(chain, chosen):
            return i
    return None


def write_selected_chain(rack, index: int) -> Tuple[bool, str]:
    """Show the chain at ``index`` in Live (measured settable on 12.4.25b1)."""
    chains = safe_rack_chains(rack)
    if not 0 <= index < len(chains):
        return False, "no chain %d" % index
    view = _read(rack, "view")
    if view is None:
        return False, "rack has no view"
    try:
        view.selected_chain = chains[index]
    except _LOM_ERRORS as e:
        return False, str(e)
    return True, ""


def read_variations(rack) -> Optional[str]:
    """The rack's variations as JSON, ``{"count": n, "selected": i}``
    (``selected`` -1 when none is), or ``None`` unread. Measured on
    12.4.25b1: ``variation_count`` is listenable, ``selected_variation_index``
    settable but not listenable, and Live refuses to set it back to -1."""
    count = _as_int_or_none(_read(rack, "variation_count"))
    if count is None:
        return None
    selected = _as_int_or_none(_read(rack, "selected_variation_index"))
    return json.dumps({"count": count, "selected": -1 if selected is None else selected}, separators=(",", ":"), sort_keys=True)


def write_variation_action(rack, key: str, value) -> Tuple[bool, object, str]:
    """Run one variation verb on the rack: ``(ok, echo, detail)``."""
    count = _as_int_or_none(_read(rack, "variation_count")) or 0
    try:
        if key in (VARIATION_RECALL_KEY, VARIATION_DELETE_KEY):
            try:
                index = int(value)
            except (TypeError, ValueError):
                return False, None, "expected a variation index"
            if not 0 <= index < count:
                return False, None, "no variation %d" % index
            rack.selected_variation_index = index
            if key == VARIATION_RECALL_KEY:
                rack.recall_selected_variation()
            else:
                rack.delete_selected_variation()
            return True, index, ""
        if key == VARIATION_STORE_KEY:
            rack.store_variation()
            return True, 1, ""
        if key == VARIATION_RANDOMIZE_KEY:
            rack.randomize_macros()
            return True, 1, ""
    except _LOM_ERRORS as e:
        return False, None, str(e)
    return False, None, "unknown variation verb %s" % key


#: The rack rows a client follows by listener: key -> (listener name, reader,
#: on the rack's view rather than the rack).
_VIEW_ROWS = {
    SHOW_DEVICES_KEY: ("is_showing_chain_devices", read_show_devices, True),
    SELECTED_CHAIN_KEY: ("selected_chain", read_selected_chain, True),
    VARIATIONS_KEY: ("variation_count", read_variations, False),
}


class RackChainDevicesComponent:
    """Provider behind ``chain_devices`` and ``chain.<i>.{mute,solo}``.

    Args:
        emit: ``(address, args)`` — ``OSCTransport.send``.
        schedule_delayed: ``(delay_ms, fn)``; ``None`` (tests) runs inline.
        advance_generation: ``(reason) -> int``.
        on_structural_invalidate: ``PropertyComponent.on_structural_invalidate``.
        emit_rack_chain: ``(rack_path)`` — ``V3StateFullComponent.emit_rack_chain``.
        on_param_value_changed: ``(parameter, path)`` — the mutation fan-out.
    """

    def __init__(
        self,
        emit: Callable[[str, tuple], None],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        advance_generation: Optional[Callable[[str], object]] = None,
        on_structural_invalidate: Optional[Callable[[], None]] = None,
        emit_rack_chain: Optional[Callable[[str], None]] = None,
        on_param_value_changed: Optional[Callable[[object, str], None]] = None,
    ) -> None:
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._advance_generation = advance_generation
        self._on_structural_invalidate = on_structural_invalidate
        self._emit_rack_chain = emit_rack_chain
        self._on_param_value_changed = on_param_value_changed
        self._states: Dict[str, _RackState] = {}
        # (rack path, row) -> (rack, view, callback) for every rack-view row
        # (Show Devices, the selected chain) a client is following.
        self._show_watch: Dict[Tuple[str, str], Tuple[object, object, Callable[[], None]]] = {}
        self._disconnected = False
        self._warned: Set[Tuple[str, str]] = set()
        logger.info(
            "RackChainDevicesComponent: ready (row=%s, writes=chain.<i>.mute|solo, provider=%s)",
            CHAIN_DEVICES_PROPERTY, PROVIDER_NAME,
        )

    # --- provider API -------------------------------------------------------

    def subscribe(self, device, device_path: str, function: str) -> None:
        if self._disconnected:
            return
        if function in _VIEW_ROWS:
            self._watch_view_row(device, device_path, function)
            return
        if function != CHAIN_DEVICES_KEY:
            return
        st = self._state_for(device, device_path)
        st.subscribed = True
        self._attach_all(st)

    def unsubscribe(self, device_path: str, function: str) -> None:
        if function == CHAIN_DEVICES_KEY:
            self.release(device_path)
        elif function in _VIEW_ROWS:
            self._unwatch_view_row(device_path, function)

    def release(self, device_path: str) -> None:
        st = self._states.pop(device_path, None)
        if st is not None:
            self._detach_all(st)

    def read(self, device, device_path: str, function: str):
        if self._disconnected:
            return None
        if function == CHAIN_DEVICES_KEY:
            self._send_bundle(device_path)
            return chains_json(device)
        if function in _VIEW_ROWS:
            return _VIEW_ROWS[function][1](device)
        field = parse_chain_field(function)
        if field is None:
            return None
        chains = safe_rack_chains(device)
        if field[0] >= len(chains):
            return None
        if field[1] == "volume":
            return _volume_value(chains[field[0]])
        return _flag(_read(chains[field[0]], field[1], False))

    def write(self, device, device_path: str, function: str, value):
        if function in VARIATION_ACTION_KEYS:
            ok, echo, detail = write_variation_action(device, function, value)
            if ok:
                # The selected index has no listener; say what it is now.
                self._safe_emit(V3_PROPERTY_VALUE_ADDRESS, (device_path, VARIATIONS_KEY, read_variations(device)))
            return ok, echo, detail
        if function == SHOW_DEVICES_KEY:
            try:
                on = bool(int(value))
            except (TypeError, ValueError):
                return False, None, "expected 0 or 1"
            ok, detail = write_show_devices(device, on)
            return (True, 1 if on else 0, "") if ok else (False, None, detail)
        if function == SELECTED_CHAIN_KEY:
            try:
                index = int(value)
            except (TypeError, ValueError):
                return False, None, "expected a chain index"
            ok, detail = write_selected_chain(device, index)
            return (True, index, "") if ok else (False, None, detail)
        field = parse_chain_field(function)
        if field is None:
            return False, None, "%s is read-only" % function
        index, attr = field
        chains = safe_rack_chains(device)
        if index >= len(chains):
            return False, None, "no chain %d" % index
        if attr == "volume":
            param = _chain_volume(chains[index])
            if param is None:
                return False, None, "chain %d has no volume" % index
            try:
                v = max(float(param.min), min(float(param.max), float(value)))
                param.value = v
            except (TypeError, ValueError) as e:
                return False, None, "expected a number: %s" % e
            except _LOM_ERRORS as e:
                return False, None, str(e)
            return True, round(v, 4), ""
        try:
            on = bool(int(value))
        except (TypeError, ValueError):
            return False, None, "expected 0 or 1"
        try:
            setattr(chains[index], attr, on)
        except _LOM_ERRORS as e:
            return False, None, str(e)
        return True, 1 if on else 0, ""

    def debug_state(self, device_path: str) -> Optional[Dict[str, object]]:
        st = self._states.get(device_path)
        if st is None:
            return None
        return {
            "subscribed": st.subscribed,
            "shapeListeners": len(st.shape_listeners),
            "paramListeners": len(st.param_listeners),
        }

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        for st in list(self._states.values()):
            self._detach_all(st)
        self._states.clear()
        for path, key in list(self._show_watch):
            self._unwatch_view_row(path, key)

    # --- the rack view's rows: Show Devices, the selected chain ------------------

    def _watch_view_row(self, rack, device_path: str, key: str) -> None:
        self._unwatch_view_row(device_path, key)
        attr, reader, on_view = _VIEW_ROWS[key]
        view = _read(rack, "view") if on_view else rack
        adder = getattr(view, "add_%s_listener" % attr, None) if view is not None else None
        if not callable(adder):
            return

        def _on_change():
            # A read and an emit; nothing is written in the notification.
            if self._disconnected:
                return
            self._safe_emit(V3_PROPERTY_VALUE_ADDRESS, (device_path, key, reader(rack)))

        try:
            adder(_on_change)
        except _LOM_ERRORS as e:
            logger.debug("RackChainDevicesComponent: add_%s_listener failed: %s", attr, e)
            return
        self._show_watch[(device_path, key)] = (rack, view, _on_change)

    def _unwatch_view_row(self, device_path: str, key: str) -> None:
        entry = self._show_watch.pop((device_path, key), None)
        if entry is None:
            return
        _rack, view, cb = entry
        try:
            getattr(view, "remove_%s_listener" % _VIEW_ROWS[key][0])(cb)
        except Exception:
            pass

    # --- state ----------------------------------------------------------------

    def _state_for(self, device, device_path: str) -> _RackState:
        st = self._states.get(device_path)
        if st is not None and not same_lom_handle(st.device, device):
            self.release(device_path)
            st = None
        if st is None:
            st = _RackState(device, device_path)
            self._states[device_path] = st
        return st

    def _is_held(self, st: _RackState) -> bool:
        return self._states.get(st.device_path) is st

    def _send_bundle(self, device_path: str) -> None:
        if self._emit_rack_chain is None:
            return
        try:
            self._emit_rack_chain(device_path)
        except Exception as e:
            logger.warning("RackChainDevicesComponent: bundle emit for %s raised: %s", device_path, e)

    # --- listeners ------------------------------------------------------------

    def _attach_all(self, st: _RackState) -> None:
        self._detach_all(st)
        shape = lambda: self._on_fire(st, True)  # noqa: E731
        surface_only = lambda: self._on_fire(st, False)  # noqa: E731
        self._add(st, st.device, "chains", shape)
        total = 0
        for c_index, chain in enumerate(safe_rack_chains(st.device)):
            self._add(st, chain, "devices", shape)
            for attr in ("name", "color", "mute", "solo"):
                self._add(st, chain, attr, surface_only)
            volume = _chain_volume(chain)
            if volume is not None:
                self._add(st, volume, "value", surface_only)
            chain_path = compose_rack_chain_path(st.device_path, c_index)
            for d_index, device in enumerate(_devices_of(chain)):
                self._add(st, device, "name", surface_only)
                device_path = compose_chain_device_path(chain_path, d_index)
                try:
                    params = list(device.parameters or ())
                except _LOM_ERRORS:
                    continue
                for p_index, param in enumerate(params):
                    if total >= MAX_CHAIN_PARAM_LISTENERS:
                        self._warn_once(st.device_path, "cap", "parameter listeners capped at %d" % MAX_CHAIN_PARAM_LISTENERS)
                        return
                    adder = getattr(param, "add_value_listener", None)
                    if not callable(adder):
                        continue
                    cb = self._make_param_callback(param, compose_param_path_under(device_path, p_index))
                    try:
                        adder(cb)
                    except _LOM_ERRORS:
                        continue
                    st.param_listeners.append((param, cb))
                    total += 1

    def _add(self, st: _RackState, target, attr: str, cb) -> None:
        adder = getattr(target, "add_%s_listener" % attr, None)
        if not callable(adder):
            return
        try:
            adder(cb)
        except _LOM_ERRORS as e:
            logger.debug("RackChainDevicesComponent: add_%s_listener failed: %s", attr, e)
            return
        st.shape_listeners.append((target, attr, cb))

    def _detach_all(self, st: _RackState) -> None:
        for target, attr, cb in st.shape_listeners:
            try:
                getattr(target, "remove_%s_listener" % attr)(cb)
            except Exception:
                pass
        st.shape_listeners = []
        for param, cb in st.param_listeners:
            try:
                param.remove_value_listener(cb)
            except Exception:
                pass
        st.param_listeners = []

    def _make_param_callback(self, param, path: str) -> Callable[[], None]:
        def _on_value():
            if self._disconnected or self._on_param_value_changed is None:
                return
            try:
                self._on_param_value_changed(param, path)
            except Exception as e:
                logger.error("RackChainDevicesComponent: on_param_value_changed raised for %s: %s", path, e)
        return _on_value

    def _on_fire(self, st: _RackState, structural: bool) -> None:
        """Mark and schedule; nothing is read or written in a notification."""
        if self._disconnected or not self._is_held(st):
            return
        st.structural = st.structural or structural
        if st.scheduled:
            return
        if self._schedule_delayed is None:
            self._on_change(st)
            return
        st.scheduled = True
        try:
            self._schedule_delayed(CHAIN_CHANGE_DELAY_MS, lambda: self._on_change(st))
        except Exception as e:
            st.scheduled = False
            logger.warning("RackChainDevicesComponent: schedule_delayed failed: %s", e)

    def _on_change(self, st: _RackState) -> None:
        st.scheduled = False
        structural, st.structural = st.structural, False
        if self._disconnected or not self._is_held(st):
            return
        if structural:
            if self._advance_generation is not None:
                try:
                    self._advance_generation(REASON_RACK_CHAIN)
                except Exception as e:
                    logger.error("RackChainDevicesComponent: generation.advance raised: %s", e)
            if self._on_structural_invalidate is not None:
                try:
                    self._on_structural_invalidate()
                except Exception as e:
                    logger.error("RackChainDevicesComponent: structural invalidate raised: %s", e)
            if not self._is_held(st):
                return
            self._attach_all(st)
            self._send_bundle(st.device_path)
        else:
            # A chain or device renamed: the listener set is unchanged, but
            # a rename can also be a hot-swap Live reports as one.
            self._attach_all(st)
        self._safe_emit(V3_PROPERTY_VALUE_ADDRESS, (st.device_path, CHAIN_DEVICES_PROPERTY, chains_json(st.device)))

    # --- logging --------------------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning("RackChainDevicesComponent: emit %s failed: %s", address, e)

    def _warn_once(self, device_path: str, key: str, message: str) -> None:
        k = (device_path, key)
        if k in self._warned:
            return
        self._warned.add(k)
        logger.warning("RackChainDevicesComponent: %s: %s", device_path, message)


__all__ = [
    "VARIATIONS_KEY",
    "VARIATION_ACTION_KEYS",
    "VARIATION_RECALL_KEY",
    "VARIATION_STORE_KEY",
    "VARIATION_DELETE_KEY",
    "VARIATION_RANDOMIZE_KEY",
    "read_variations",
    "write_variation_action",
    "SHOW_DEVICES_KEY",
    "read_show_devices",
    "write_show_devices",
    "SELECTED_CHAIN_KEY",
    "read_selected_chain",
    "write_selected_chain",
    "CHAIN_CHANGE_DELAY_MS",
    "CHAIN_DEVICES_KEY",
    "CHAIN_DEVICES_PROPERTY",
    "MAX_CHAIN_PARAM_LISTENERS",
    "PROVIDER_NAME",
    "RACK_CLASS_NAMES",
    "REASON_RACK_CHAIN",
    "RackChainDevicesComponent",
    "chain_field_property",
    "chains_json",
    "chains_payload",
    "parse_chain_field",
]
