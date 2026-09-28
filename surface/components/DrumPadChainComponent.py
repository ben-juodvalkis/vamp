"""DrumPadChainComponent — the devices inside a Drum Rack pad's chain
(issue #491, 2026-09-10; protocol 3.8.0).

The virtual-macro layer (ADR-428, ``DrumVirtualMacroComponent``) reaches a
pad's *instrument* by parameter name. What it cannot reach is a device
the pad's chain carries beside the instrument — a Reverb after the
snare's Simpler, a Saturator after the kick's DrumCell — and neither can
anything else on the wire: the resolver, the listener registry and the
state-full walk all stop at the track's device list. This component is
the surface half of "hold a pad, and the FX grid is that pad's": it makes
the devices inside a pad chain addressable, listable, observable and
loadable, and it does so **without** feeding any of them to the
device-init hooks (``on_device_added`` schedules the Simpler init rules
and the random-start prepend — a Simpler kit's pads are Simplers, and
those rules must never fire per pad).

Two rows on the property channel, both computed (``computed`` provider
``drum_pad_chain``) and both read-only, on a ``DrumGroupDevice``:

- ``vm.padFx`` — **effect presence**, every populated pad at once: a
  JSON string ``{"pads":{"38":[{"index":0,"class":"OriginalSimpler",
  "name":"Snare","type":1},{"index":1,"class":"Hybrid","name":"Reverb",
  "type":2}]}}`` — each device on each pad's first chain with its chain
  index, class, name and Live's ``Device.type`` (1 instrument, 2 audio
  effect, 4 MIDI effect; ``None`` when unread). Built by a walk that
  reads only those three attributes per device, and re-emitted from the
  chains' own ``devices`` listeners, so the FX grid can flip a tile to
  ghost or active the instant a pad is touched, before any records
  land. A few hundred bytes for a kit; past ``PAD_FX_BYTES_SOFT_CAP`` the
  names are dropped so a 128-pad kit still fits the datagram.

- ``vm.padChain.<note>`` — **a pad's subscription**. The interface asks
  for one pad's chain; while the row is subscribed the surface keeps
  value listeners on every parameter of every effect on that chain
  (feeding the ordinary ``param/value`` echo through
  ``MutationComponent`` with the composed pad path, so echo suppression
  and display strings come free) and answers each cold read with a
  **pad-scoped ``state/full/tree``** — reason ``pad-chain``, scope the
  pad path, D and P records for the chain's effects under
  ``…/pads/<note>/devices/<index>`` — through ``V3StateFullComponent``.
  The row's own value is that pad's presence entry. Live's selected pad
  plays no part: selection is shared state two clients would fight over
  (ADR-428 keeps it off the surface), so which pads are watched is each
  client's own refcounted choice.

Structural changes ride a **narrower composite** than the track's: a
chain's ``devices`` listener (or the rack's ``drum_pads`` / ``chains``)
fires, the component marks the rack dirty and defers
``CHAIN_CHANGE_DELAY_MS`` — the re-seed's own margin, because a chain
populates after the add fires and Live refuses writes inside a
notification anyway — then, on the tick: advances the generation (paths
inside the chain shift, so the UI's mirror must move; the invalidate it
emits carries no paths), runs the property channel's structural
invalidate (so a pad Reverb's impulse-response subscriptions on a path
that moved are torn down), re-emits ``vm.padFx``, and for every
subscribed pad re-attaches the parameter listeners and re-emits the pad
bundle. It never republishes the song.

Writes happen nowhere here: the parameter channel writes through
``resolve_param`` (pad-aware since 3.8.0) and ``device/load`` places a
preset through ``DeviceLoadComponent``. Listener callbacks only mark and
schedule.
"""

from __future__ import annotations

import json
import logging
from typing import Callable, Dict, List, Optional, Set, Tuple

from .drum_vm_functions import (
    _LOM_ERRORS,
    DEVICE_TYPE_INSTRUMENT,
    DRUM_RACK_CLASS_NAME,
    PROPERTY_PREFIX,
    REASON_PAD_CHAIN,
    RESEED_DELAY_MS,
    V3_PROPERTY_VALUE_ADDRESS,
    _safe_class_name,
    device_type,
)
from .drum_vm_resolve import pad_devices
from .path_resolver import (
    PAD_NOTE_MAX,
    compose_chain_device_path,
    compose_pad_path,
    compose_param_path_under,
    find_drum_pad,
    same_lom_handle,
)

logger = logging.getLogger("looping")

#: The name ``PropertyComponent`` routes the computed rows to.
PROVIDER_NAME = "drum_pad_chain"

#: ``vm.padFx`` — effect presence for every populated pad.
PAD_FX_KEY = "padFx"
PAD_FX_PROPERTY = PROPERTY_PREFIX + PAD_FX_KEY
#: ``vm.padChain.<note>`` — one pad's chain, subscribed.
PAD_CHAIN_FUNCTION_PREFIX = "padChain."
PAD_CHAIN_PROPERTY_PREFIX = PROPERTY_PREFIX + PAD_CHAIN_FUNCTION_PREFIX

#: How long after a chain listener fires the composite runs — the very
#: margin the virtual-macro re-seed uses (chains populate after the add),
#: bound to it rather than re-typed so the two cannot drift.
CHAIN_CHANGE_DELAY_MS = RESEED_DELAY_MS
#: Past this many bytes the presence row drops device names.
PAD_FX_BYTES_SOFT_CAP = 8000
#: Value listeners kept on one rack's subscribed pads' effect parameters,
#: summed over the pads — per rack state, not across racks: two subscribed
#: racks may hold this many each.
MAX_CHAIN_PARAM_LISTENERS = 512


def pad_chain_function(note: int) -> str:
    """``38`` → ``"padChain.38"``."""
    return "%s%d" % (PAD_CHAIN_FUNCTION_PREFIX, note)


def pad_chain_property(note: int) -> str:
    """``38`` → ``"vm.padChain.38"``."""
    return PROPERTY_PREFIX + pad_chain_function(note)


def parse_pad_chain_function(function) -> Optional[int]:
    """``"padChain.38"`` → ``38``; ``None`` for anything else."""
    if not isinstance(function, str) or not function.startswith(PAD_CHAIN_FUNCTION_PREFIX):
        return None
    rest = function[len(PAD_CHAIN_FUNCTION_PREFIX):]
    if not rest.isdigit():
        return None
    note = int(rest)
    return note if note <= PAD_NOTE_MAX else None


def is_pad_chain_property(property_name) -> bool:
    """Whether ``property_name`` is a well-formed ``vm.padChain.<note>``."""
    return (
        isinstance(property_name, str)
        and property_name.startswith(PAD_CHAIN_PROPERTY_PREFIX)
        and parse_pad_chain_function(property_name[len(PROPERTY_PREFIX):]) is not None
    )


def _device_name(device) -> str:
    try:
        name = device.name
    except _LOM_ERRORS:
        return ""
    return name if isinstance(name, str) else ""


def _safe_int_note(pad) -> Optional[int]:
    try:
        note = int(pad.note)
    except (_LOM_ERRORS + (ValueError,)):
        return None
    return note if 0 <= note <= PAD_NOTE_MAX else None


class PadChainWatcher:
    """The listeners that say a Drum Rack's pad chains changed shape:
    ``drum_pads`` and ``chains`` on the rack itself, and one ``devices``
    listener on every populated pad's first chain.

    ``on_change`` fires from inside the LOM notification for any of them
    — mark and schedule there, never read or write. :meth:`refresh`
    re-walks the pads (idempotent per chain, by handle: a pad that
    gained a chain since the last pass gets its listener, one whose
    chain went is dropped) and answers with the populated pads, so a
    caller that needs to read the chains walks them once. :meth:`detach`
    lets everything go.

    Split out of :class:`DrumPadChainComponent` on 2026-09-14 (ADR-435):
    the component holds one for as long as a client holds the rack's
    rows, and ``SequencerComponent`` holds one per Drum Rack for as long
    as the rack is in the set — a Permute dropped into a pad chain in
    Live has to reach the engine with no client connected at all.
    """

    __slots__ = ("_warn", "chain_listeners", "device", "device_path", "on_change", "rack_listeners")

    def __init__(
        self, device, device_path: str, on_change: Callable[[], None],
        warn: Optional[Callable[[str, str], None]] = None,
    ) -> None:
        self.device = device
        self.device_path = device_path
        self.on_change = on_change
        self._warn = warn
        # (attribute name, callback) on the rack itself.
        self.rack_listeners: List[Tuple[str, Callable[[], None]]] = []
        # note → (chain, callback): one ``devices`` listener per populated pad.
        self.chain_listeners: Dict[int, Tuple[object, Callable[[], None]]] = {}

    def attach(self) -> List[Tuple[int, object]]:
        """The rack's own pad-list listeners, then the chains. Returns
        what :meth:`refresh` returns."""
        for name in ("drum_pads", "chains"):
            adder = getattr(self.device, "add_%s_listener" % name, None)
            if not callable(adder):
                continue
            cb = self.on_change
            try:
                adder(cb)
            except _LOM_ERRORS as e:
                self._warn_once("listener:" + name, "add_%s_listener raised: %s" % (name, e))
                continue
            self.rack_listeners.append((name, cb))
        return self.refresh()

    def refresh(self) -> List[Tuple[int, object]]:
        """One ``devices`` listener on every populated pad's first chain.
        Returns ``[(note, chain), …]`` for the pads that carry one, in
        the rack's pad order."""
        try:
            rack_pads = list(self.device.drum_pads or ())
        except _LOM_ERRORS as e:
            self._warn_once("drum_pads", "drum_pads read raised: %s" % e)
            return []
        seen: Set[int] = set()
        populated: List[Tuple[int, object]] = []
        for pad in rack_pads:
            note = _safe_int_note(pad)
            if note is None:
                continue
            try:
                chains = list(pad.chains or ())
            except _LOM_ERRORS:
                continue
            if not chains:
                continue
            chain = chains[0]
            seen.add(note)
            populated.append((note, chain))
            held = self.chain_listeners.get(note)
            if held is not None and same_lom_handle(held[0], chain):
                continue
            if held is not None:
                self._remove_chain(note)
            adder = getattr(chain, "add_devices_listener", None)
            if not callable(adder):
                continue
            cb = self.on_change
            try:
                adder(cb)
            except _LOM_ERRORS as e:
                self._warn_once("listener:chain", "chain add_devices_listener raised: %s" % e)
                continue
            self.chain_listeners[note] = (chain, cb)
        for note in [n for n in self.chain_listeners if n not in seen]:
            self._remove_chain(note)
        return populated

    def detach(self) -> None:
        for note in list(self.chain_listeners):
            self._remove_chain(note)
        for name, cb in self.rack_listeners:
            remover = getattr(self.device, "remove_%s_listener" % name, None)
            if not callable(remover):
                continue
            try:
                remover(cb)
            except _LOM_ERRORS:
                pass
        self.rack_listeners = []

    def chain_notes(self) -> List[int]:
        return sorted(self.chain_listeners)

    def _remove_chain(self, note: int) -> None:
        held = self.chain_listeners.pop(note, None)
        if held is None:
            return
        chain, cb = held
        remover = getattr(chain, "remove_devices_listener", None)
        if not callable(remover):
            return
        try:
            remover(cb)
        except _LOM_ERRORS as e:
            logger.debug(
                "PadChainWatcher: remove_devices_listener on %s pad %d raised: %s",
                self.device_path, note, e,
            )

    def _warn_once(self, key: str, message: str) -> None:
        if self._warn is not None:
            self._warn(key, message)
        else:
            logger.warning("PadChainWatcher: %s: %s", self.device_path, message)


class _PadChainState:
    """Everything held for one rack: who is subscribed to what, and the
    listeners keeping it fresh."""

    __slots__ = ("device", "device_path", "param_listeners", "scheduled", "subscribed", "watcher")

    def __init__(self, device, device_path: str) -> None:
        self.device = device
        self.device_path = device_path
        # Function names: ``padFx`` and ``padChain.<note>``.
        self.subscribed: Set[str] = set()
        # The rack's shape listeners, for as long as the state is held.
        self.watcher: Optional[PadChainWatcher] = None
        # note → [(parameter, callback)] for a subscribed pad's effects.
        self.param_listeners: Dict[int, List[Tuple[object, Callable[[], None]]]] = {}
        # A composite is pending on the scheduler; a second fire inside
        # the window rides it.
        self.scheduled = False


class DrumPadChainComponent:
    """Computed-property provider for a Drum Rack's pad chains.

    Args:
        emit: ``(address, args)`` — ``OSCTransport.send``.
        schedule_delayed: ``(delay_ms, fn)`` — the deferred composite.
            ``None`` (tests) runs it inline.
        advance_generation: ``(reason) -> int`` — ``GenerationComponent.advance``.
        on_structural_invalidate: ``PropertyComponent.on_structural_invalidate``,
            called after the advance so subscriptions on paths that moved
            are torn down.
        emit_pad_chain: ``(pad_path)`` — ``V3StateFullComponent.emit_pad_chain``.
        on_param_value_changed: ``(parameter, path)`` — the mutation fan-out
            a chain device's parameter fires ride.
    """

    def __init__(
        self,
        emit: Callable[[str, tuple], None],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
        advance_generation: Optional[Callable[[str], object]] = None,
        on_structural_invalidate: Optional[Callable[[], None]] = None,
        emit_pad_chain: Optional[Callable[[str], None]] = None,
        on_param_value_changed: Optional[Callable[[object, str], None]] = None,
    ) -> None:
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._advance_generation = advance_generation
        self._on_structural_invalidate = on_structural_invalidate
        self._emit_pad_chain = emit_pad_chain
        self._on_param_value_changed = on_param_value_changed
        self._states: Dict[str, _PadChainState] = {}
        self._disconnected = False
        self._warned: Set[Tuple[str, str]] = set()
        logger.info(
            "DrumPadChainComponent: ready (presence=%s; subscription=%s<note>; provider=%s)",
            PAD_FX_PROPERTY, PAD_CHAIN_PROPERTY_PREFIX, PROVIDER_NAME,
        )

    # --- provider API (called by PropertyComponent) -----------------------

    @staticmethod
    def _known(function: str) -> bool:
        return function == PAD_FX_KEY or parse_pad_chain_function(function) is not None

    def subscribe(self, device, device_path: str, function: str) -> None:
        """A consumer opened ``vm.padFx`` or ``vm.padChain.<note>``."""
        if self._disconnected or not self._known(function):
            return
        st = self._state_for(device, device_path)
        st.subscribed.add(function)
        note = parse_pad_chain_function(function)
        if note is not None:
            self._attach_param_listeners(st, note)

    def unsubscribe(self, device_path: str, function: str) -> None:
        """The last consumer of a row left; the state goes with the last row."""
        st = self._states.get(device_path)
        if st is None:
            return
        st.subscribed.discard(function)
        note = parse_pad_chain_function(function)
        if note is not None:
            self._detach_param_listeners(st, note)
        if not st.subscribed:
            self.release(device_path)

    def release(self, device_path: str) -> None:
        """Drop the state for ``device_path`` (rack replaced / gone)."""
        st = self._states.pop(device_path, None)
        if st is None:
            return
        self._detach_all(st)

    def read(self, device, device_path: str, function: str):
        """The cold read: the presence JSON for ``padFx``; for a pad row,
        that pad's presence entry — and the pad's records, as a pad-scoped
        ``state/full/tree``, sent alongside. Emitted from the read rather
        than the subscribe so a second client bumping the refcount gets
        the bundle too."""
        if self._disconnected or not self._known(function):
            return None
        st = self._state_for(device, device_path)
        if function == PAD_FX_KEY:
            return self.presence_json(st)
        note = parse_pad_chain_function(function)
        if note is None:
            return None
        entry = self._pad_entry(st, note)
        if entry is None:
            # A pad with no chain has no records to send: the emitter would
            # only walk to "unresolvable" and log it (code review, 2026-09-12).
            return None
        self._send_pad_bundle(st, note)
        return json.dumps(entry, separators=(",", ":"), sort_keys=True)

    def write(self, device, device_path: str, function: str, value):
        """Every row here is read-only; ``PropertyComponent`` rejects a
        set before asking, this is the belt to those braces."""
        return False, None, "%s is read-only" % (PROPERTY_PREFIX + function)

    def debug_state(self, device_path: str) -> Optional[Dict[str, object]]:
        st = self._states.get(device_path)
        if st is None:
            return None
        return {
            "subscribed": sorted(st.subscribed),
            "chainListeners": st.watcher.chain_notes() if st.watcher is not None else [],
            "paramListeners": {n: len(v) for n, v in st.param_listeners.items()},
        }

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        for st in list(self._states.values()):
            self._detach_all(st)
        self._states.clear()

    # --- presence -----------------------------------------------------------

    def _chain_entries(self, pad) -> Optional[List[Dict[str, object]]]:
        devices = pad_devices(pad)
        if devices is None:
            return None
        out: List[Dict[str, object]] = []
        for index, dev in enumerate(devices):
            out.append({
                "index": index,
                "class": _safe_class_name(dev),
                "name": _device_name(dev),
                "type": device_type(dev),
            })
        return out

    def presence_payload(self, st: _PadChainState) -> Dict[str, object]:
        """``{"pads": {"<note>": [entries…]}}`` for every pad carrying a chain."""
        pads: Dict[str, object] = {}
        try:
            rack_pads = list(st.device.drum_pads or ())
        except _LOM_ERRORS as e:
            self._warn_once(st.device_path, "drum_pads", "drum_pads read raised: %s" % e)
            rack_pads = []
        for pad in rack_pads:
            note = _safe_int_note(pad)
            if note is None:
                continue
            entries = self._chain_entries(pad)
            if entries is None:
                continue
            pads[str(note)] = entries
        return {"pads": pads}

    def presence_json(self, st: _PadChainState) -> str:
        payload = self.presence_payload(st)
        text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        if len(text) > PAD_FX_BYTES_SOFT_CAP:
            for entries in payload["pads"].values():
                for e in entries:
                    e.pop("name", None)
            text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
            self._warn_once(
                st.device_path, "padFx:size",
                "pad presence over %d bytes; device names dropped" % PAD_FX_BYTES_SOFT_CAP,
            )
        return text

    def _pad_entry(self, st: _PadChainState, note: int) -> Optional[Dict[str, object]]:
        pad = find_drum_pad(st.device, note)
        if pad is None:
            return None
        entries = self._chain_entries(pad)
        if entries is None:
            return None
        return {"note": note, "devices": entries}

    def _send_pad_bundle(self, st: _PadChainState, note: int) -> None:
        if self._emit_pad_chain is None:
            return
        try:
            self._emit_pad_chain(compose_pad_path(st.device_path, note))
        except Exception as e:
            logger.warning(
                "DrumPadChainComponent: pad bundle emit for %s pad %d raised: %s",
                st.device_path, note, e,
            )

    # --- state ------------------------------------------------------------

    def _state_for(self, device, device_path: str) -> _PadChainState:
        st = self._states.get(device_path)
        if st is not None and not same_lom_handle(st.device, device):
            # A different rack lives at this path now: the old state
            # describes a kit that is gone.
            self.release(device_path)
            st = None
        if st is None:
            st = _PadChainState(device, device_path)
            self._states[device_path] = st
            st.watcher = PadChainWatcher(
                device, device_path, self._make_change_callback(st),
                warn=lambda key, message, path=device_path: self._warn_once(path, key, message),
            )
            st.watcher.attach()
        return st

    def _is_held(self, st: _PadChainState) -> bool:
        return self._states.get(st.device_path) is st

    def _subscribed_notes(self, st: _PadChainState) -> List[int]:
        notes = [parse_pad_chain_function(fn) for fn in st.subscribed]
        return sorted(n for n in notes if n is not None)

    # --- listeners --------------------------------------------------------

    def _make_change_callback(self, st: _PadChainState) -> Callable[[], None]:
        """A chain (or the rack's pad list) changed. Mark and schedule —
        nothing is read or written inside the notification."""
        def _on_change():
            if self._disconnected or not self._is_held(st):
                return
            self._schedule_change(st)
        return _on_change

    def _schedule_change(self, st: _PadChainState) -> None:
        if st.scheduled:
            return
        if self._schedule_delayed is None:
            self._on_chain_changed(st)
            return
        st.scheduled = True
        try:
            self._schedule_delayed(CHAIN_CHANGE_DELAY_MS, lambda: self._on_chain_changed(st))
        except Exception as e:
            st.scheduled = False
            logger.warning("DrumPadChainComponent: schedule_delayed failed: %s", e)

    def _on_chain_changed(self, st: _PadChainState) -> None:
        """The deferred composite: advance, invalidate the property
        channel, re-emit presence, re-emit and re-watch every subscribed
        pad. Never republishes the song."""
        st.scheduled = False
        if self._disconnected or not self._is_held(st):
            return
        if st.watcher is not None:
            st.watcher.refresh()
        if self._advance_generation is not None:
            try:
                self._advance_generation(REASON_PAD_CHAIN)
            except Exception as e:
                logger.error("DrumPadChainComponent: generation.advance raised: %s", e)
        if self._on_structural_invalidate is not None:
            try:
                self._on_structural_invalidate()
            except Exception as e:
                logger.error("DrumPadChainComponent: property structural-invalidate raised: %s", e)
        # The invalidate above may have released this very state (the
        # rack no longer resolves at its path); nothing more to say then.
        if not self._is_held(st):
            return
        if PAD_FX_KEY in st.subscribed:
            self._safe_emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (st.device_path, PAD_FX_PROPERTY, self.presence_json(st)),
            )
        for note in self._subscribed_notes(st):
            self._attach_param_listeners(st, note)
            self._send_pad_bundle(st, note)
            entry = self._pad_entry(st, note)
            self._safe_emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (
                    st.device_path, pad_chain_property(note),
                    None if entry is None else json.dumps(entry, separators=(",", ":"), sort_keys=True),
                ),
            )

    # --- value listeners on a subscribed pad's effects ----------------------

    def _attach_param_listeners(self, st: _PadChainState, note: int) -> None:
        """Watch every parameter of every effect on the pad's chain. Always
        detaches first: the chain may have changed shape, and a captured
        path must describe the device's current index."""
        self._detach_param_listeners(st, note)
        pad = find_drum_pad(st.device, note)
        if pad is None:
            return
        devices = pad_devices(pad)
        if devices is None:
            return
        total = sum(len(v) for v in st.param_listeners.values())
        pad_path = compose_pad_path(st.device_path, note)
        attached: List[Tuple[object, Callable[[], None]]] = []
        for dev_index, dev in enumerate(devices):
            if device_type(dev) == DEVICE_TYPE_INSTRUMENT:
                continue  # the instrument is the virtual-macro layer's
            device_path = compose_chain_device_path(pad_path, dev_index)
            try:
                params = list(dev.parameters or ())
            except _LOM_ERRORS:
                continue
            for param_index, param in enumerate(params):
                if total >= MAX_CHAIN_PARAM_LISTENERS:
                    self._warn_once(
                        st.device_path, "param-listeners:cap",
                        "chain parameter listeners capped at %d" % MAX_CHAIN_PARAM_LISTENERS,
                    )
                    st.param_listeners[note] = attached
                    return
                adder = getattr(param, "add_value_listener", None)
                if not callable(adder):
                    continue
                cb = self._make_param_callback(param, compose_param_path_under(device_path, param_index))
                try:
                    adder(cb)
                except _LOM_ERRORS:
                    continue
                attached.append((param, cb))
                total += 1
        st.param_listeners[note] = attached

    def _detach_param_listeners(self, st: _PadChainState, note: int) -> None:
        for param, cb in st.param_listeners.pop(note, []):
            remover = getattr(param, "remove_value_listener", None)
            if not callable(remover):
                continue
            try:
                remover(cb)
            except _LOM_ERRORS:
                pass

    def _make_param_callback(self, param, path: str) -> Callable[[], None]:
        """A chain device's parameter moved: hand it to the mutation
        fan-out with its composed pad path, exactly as a track-level
        parameter's fire is handed over by ``LOMListeners``."""
        def _on_value():
            if self._disconnected:
                return
            cb = self._on_param_value_changed
            if cb is None:
                return
            try:
                cb(param, path)
            except Exception as e:
                logger.error("DrumPadChainComponent: on_param_value_changed raised for %s: %s", path, e)
        return _on_value

    def _detach_all(self, st: _PadChainState) -> None:
        for note in list(st.param_listeners):
            self._detach_param_listeners(st, note)
        if st.watcher is not None:
            st.watcher.detach()
            st.watcher = None

    # --- logging ----------------------------------------------------------

    def _safe_emit(self, address: str, payload: tuple) -> None:
        if self._disconnected:
            return
        try:
            self._emit(address, payload)
        except Exception as e:
            logger.warning("DrumPadChainComponent: emit %s failed: %s", address, e)

    def _warn_once(self, device_path: str, key: str, message: str) -> None:
        k = (device_path, key)
        if k in self._warned:
            return
        self._warned.add(k)
        logger.warning("DrumPadChainComponent: %s: %s", device_path, message)


__all__ = [
    "CHAIN_CHANGE_DELAY_MS",
    "DRUM_RACK_CLASS_NAME",
    "MAX_CHAIN_PARAM_LISTENERS",
    "PAD_CHAIN_FUNCTION_PREFIX",
    "PAD_CHAIN_PROPERTY_PREFIX",
    "PAD_FX_BYTES_SOFT_CAP",
    "PAD_FX_KEY",
    "PAD_FX_PROPERTY",
    "PROVIDER_NAME",
    "REASON_PAD_CHAIN",
    "DrumPadChainComponent",
    "PadChainWatcher",
    "is_pad_chain_property",
    "pad_chain_function",
    "pad_chain_property",
    "parse_pad_chain_function",
]
