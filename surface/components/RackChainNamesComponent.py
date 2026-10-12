"""RackChainNamesComponent — an Audio Effect Rack's chain names (2026-10-12).

The computed ``chain_names`` row on ``AudioEffectGroupDevice``
(``PropertyComponent`` allowlist, provider ``rack_chains``): a JSON array
of the rack's chain names in chain order, read-only. The Pedal central view
titles the Wah slider with the chain the toe switch's Macro 2 selects.

A computed row rather than a plain attribute row because one listener is
not enough: Live's ``chains`` listener fires when a chain is added, removed
or moved, and a rename fires only that chain's own ``name`` listener. The
provider holds both — ``chains`` on the rack and ``name`` on every chain —
and re-attaches the per-chain set whenever the list changes, so the names
follow the rack however it is edited.

A fire marks the rack and resyncs on the next tick (``schedule_delayed``):
Live refuses listener changes made inside a notification, and a chain
being added fires before it is fully in place.
"""

import json
import logging
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PROVIDER_NAME = "rack_chains"
CHAIN_NAMES_KEY = "chain_names"
CHAIN_NAMES_PROPERTY = "chain_names"
RACK_CLASS_NAME = "AudioEffectGroupDevice"
V3_PROPERTY_VALUE_ADDRESS = "/looping/v3/property/value"
RESYNC_DELAY_MS = 50


def chain_names(device) -> Optional[List[str]]:
    """The rack's chain names in order, or ``None`` when they can't be read."""
    try:
        return [str(chain.name) for chain in device.chains]
    except Exception as e:
        logger.debug("RackChainNamesComponent: read chains raised: %s", e)
        return None


def chain_names_json(device) -> Optional[str]:
    names = chain_names(device)
    return None if names is None else json.dumps(names)


class _RackState:
    __slots__ = ("device", "listeners", "pending")

    def __init__(self, device) -> None:
        self.device = device
        # (LOM object, attribute, callback) for every attached listener.
        self.listeners: List[Tuple[object, str, Callable[[], None]]] = []
        self.pending = False


class RackChainNamesComponent:
    """Provider behind ``chain_names``: subscribe / read / write /
    unsubscribe / disconnect, the shape ``PropertyComponent`` calls."""

    def __init__(
        self,
        emit: Callable[[str, tuple], None],
        schedule_delayed: Optional[Callable[[int, Callable[[], None]], None]] = None,
    ) -> None:
        self._emit = emit
        self._schedule_delayed = schedule_delayed
        self._states: Dict[str, _RackState] = {}
        self._disconnected = False

    # --- provider API -------------------------------------------------------

    def subscribe(self, device, device_path: str, function: str) -> None:
        if self._disconnected or function != CHAIN_NAMES_KEY:
            return
        self.release(device_path)
        st = _RackState(device)
        self._states[device_path] = st
        self._attach(st, device_path)

    def unsubscribe(self, device_path: str, function: str) -> None:
        if function == CHAIN_NAMES_KEY:
            self.release(device_path)

    def release(self, device_path: str) -> None:
        st = self._states.pop(device_path, None)
        if st is not None:
            self._detach(st)

    def read(self, device, device_path: str, function: str):
        if self._disconnected or function != CHAIN_NAMES_KEY:
            return None
        return chain_names_json(device)

    def write(self, device, device_path: str, function: str, value):
        return False, None, "%s is read-only" % CHAIN_NAMES_PROPERTY

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        for st in list(self._states.values()):
            self._detach(st)
        self._states.clear()

    # --- listeners ----------------------------------------------------------

    def _attach(self, st: _RackState, device_path: str) -> None:
        cb = lambda: self._on_change(device_path)  # noqa: E731
        self._add(st, st.device, "chains", cb)
        try:
            chains = list(st.device.chains)
        except Exception:
            chains = []
        for chain in chains:
            self._add(st, chain, "name", cb)

    @staticmethod
    def _add(st: _RackState, target, attr: str, cb) -> None:
        try:
            adder = getattr(target, "add_%s_listener" % attr)
            adder(cb)
        except Exception as e:
            logger.debug("RackChainNamesComponent: add_%s_listener failed: %s", attr, e)
            return
        st.listeners.append((target, attr, cb))

    @staticmethod
    def _detach(st: _RackState) -> None:
        for target, attr, cb in st.listeners:
            try:
                getattr(target, "remove_%s_listener" % attr)(cb)
            except Exception as e:
                logger.debug("RackChainNamesComponent: remove_%s_listener failed: %s", attr, e)
        st.listeners = []

    def _on_change(self, device_path: str) -> None:
        if self._disconnected:
            return
        st = self._states.get(device_path)
        if st is None or st.pending:
            return
        if self._schedule_delayed is None:
            self._resync(device_path)
            return
        st.pending = True
        self._schedule_delayed(RESYNC_DELAY_MS, lambda: self._resync(device_path))

    def _resync(self, device_path: str) -> None:
        if self._disconnected:
            return
        st = self._states.get(device_path)
        if st is None:
            return
        st.pending = False
        self._detach(st)
        self._attach(st, device_path)
        try:
            self._emit(
                V3_PROPERTY_VALUE_ADDRESS,
                (device_path, CHAIN_NAMES_PROPERTY, chain_names_json(st.device)),
            )
        except Exception as e:
            logger.warning("RackChainNamesComponent: emit failed for %s: %s", device_path, e)
