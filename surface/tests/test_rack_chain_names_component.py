"""RackChainNamesComponent — the ``chain_names`` row on an Audio Effect
Rack: the cold read through ``PropertyComponent``, and the re-send when a
chain is added, removed or renamed."""

from __future__ import annotations

import json

from components.PropertyComponent import (
    ALLOWLIST,
    PropertyComponent,
    V3_PROPERTY_VALUE_ADDRESS,
)
from components.RackChainNamesComponent import RackChainNamesComponent
from tests.test_lom_listeners import StubSong, StubTrack


class _Listeners:
    def __init__(self):
        self._cbs = {}

    def _add(self, attr, cb):
        self._cbs.setdefault(attr, []).append(cb)

    def _remove(self, attr, cb):
        self._cbs[attr].remove(cb)

    def count(self, attr):
        return len(self._cbs.get(attr, []))

    def fire(self, attr):
        for cb in list(self._cbs.get(attr, [])):
            cb()


class StubChain(_Listeners):
    def __init__(self, name):
        super().__init__()
        self.name = name

    def add_name_listener(self, cb):
        self._add("name", cb)

    def remove_name_listener(self, cb):
        self._remove("name", cb)


class StubRack(_Listeners):
    def __init__(self, names):
        super().__init__()
        self.class_name = "AudioEffectGroupDevice"
        self.name = "Wah"
        self.parameters = []
        self.chains = [StubChain(n) for n in names]

    def add_chains_listener(self, cb):
        self._add("chains", cb)

    def remove_chains_listener(self, cb):
        self._remove("chains", cb)


def _setup(names):
    emits = []
    scheduled = []
    rack = StubRack(names)
    provider = RackChainNamesComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append(fn),
    )
    comp = PropertyComponent(
        song=StubSong(tracks=[StubTrack(tid=301, devices=[rack])]),
        emit=lambda a, args: emits.append((a, args)),
        computed_providers={"rack_chains": provider},
    )
    return rack, provider, comp, emits, scheduled


def _names(emits):
    values = [args for (addr, args) in emits if addr == V3_PROPERTY_VALUE_ADDRESS]
    assert values[-1][1] == "chain_names"
    return json.loads(values[-1][2])


def _run(scheduled):
    while scheduled:
        scheduled.pop(0)()


def test_chain_names_row_is_read_only_and_computed():
    spec = ALLOWLIST[("AudioEffectGroupDevice", "chain_names")]
    assert spec.writable is False
    assert spec.computed == "rack_chains"


def test_subscribe_cold_reads_the_names():
    rack, _p, comp, emits, _s = _setup(["Wah", "Volume", "Ring"])
    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    assert _names(emits) == ["Wah", "Volume", "Ring"]
    assert rack.count("chains") == 1
    assert [c.count("name") for c in rack.chains] == [1, 1, 1]


def test_a_chain_added_re_sends_and_is_watched():
    rack, _p, comp, emits, scheduled = _setup(["Wah", "Volume", "Ring"])
    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    rack.chains.append(StubChain("Fuzz"))
    rack.fire("chains")
    _run(scheduled)
    assert _names(emits) == ["Wah", "Volume", "Ring", "Fuzz"]
    assert [c.count("name") for c in rack.chains] == [1, 1, 1, 1]
    assert rack.count("chains") == 1


def test_a_chain_removed_re_sends():
    rack, _p, comp, emits, scheduled = _setup(["Wah", "Volume", "Ring"])
    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    gone = rack.chains.pop(1)
    rack.fire("chains")
    _run(scheduled)
    assert _names(emits) == ["Wah", "Ring"]
    assert gone.count("name") == 0


def test_a_rename_re_sends():
    rack, _p, comp, emits, scheduled = _setup(["Wah", "Volume", "Ring"])
    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    rack.chains[2].name = "Ring Mod"
    rack.chains[2].fire("name")
    _run(scheduled)
    assert _names(emits) == ["Wah", "Volume", "Ring Mod"]


def test_fires_in_one_tick_resync_once():
    rack, _p, comp, emits, scheduled = _setup(["Wah", "Volume"])
    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    rack.chains[0].fire("name")
    rack.chains[1].fire("name")
    rack.fire("chains")
    assert len(scheduled) == 1


def test_unsubscribe_and_disconnect_detach_everything():
    rack, provider, comp, _e, _s = _setup(["Wah", "Volume"])
    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    comp.handle_unsubscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    assert rack.count("chains") == 0
    assert [c.count("name") for c in rack.chains] == [0, 0]

    comp.handle_subscribe(args=("tracks/0/devices/0", "chain_names"), source_addr=None)
    provider.disconnect()
    assert rack.count("chains") == 0
