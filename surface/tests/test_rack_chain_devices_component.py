"""RackChainDevicesComponent (ADR-529): a rack's chains and their devices."""

from __future__ import annotations

import json

from components.RackChainDevicesComponent import (
    CHAIN_DEVICES_KEY,
    RackChainDevicesComponent,
    chains_payload,
    parse_chain_field,
)
from tests.support.lom_fakes import FakeChain, FakeDevice, FakeEffectRack, FakeParam


class ListenedChain(FakeChain):
    """A chain with Live's ``name`` / ``mute`` / ``solo`` / ``color`` listeners."""

    def __init__(self, devices=(), name="chain", color=None):
        super().__init__(devices, color=color, name=name)
        self.mute = False
        self.solo = False
        self.attr_listeners = {"name": [], "mute": [], "solo": [], "color": []}

    def __getattr__(self, item):
        for attr in ("name", "mute", "solo", "color"):
            if item == "add_%s_listener" % attr:
                return self.attr_listeners[attr].append
            if item == "remove_%s_listener" % attr:
                return self.attr_listeners[attr].remove
        raise AttributeError(item)

    def fire_attr(self, attr):
        for cb in list(self.attr_listeners[attr]):
            cb()


def _rack():
    reverb = FakeDevice("Hybrid", [FakeParam("Device On", 1.0), FakeParam("Dry/Wet", 0.3)], type_=2, name="Reverb")
    delay = FakeDevice("Delay", [FakeParam("Device On", 1.0)], type_=2)
    inner = FakeEffectRack([FakeChain([])], name="Inner")
    rack = FakeEffectRack([ListenedChain([reverb], name="Wet", color=0xFF0000), ListenedChain([delay, inner], name="Echo")])
    return rack, reverb, delay, inner


def _component():
    emits, bundles, fanned, advanced = [], [], [], []
    comp = RackChainDevicesComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=None,
        advance_generation=lambda reason: advanced.append(reason),
        on_structural_invalidate=lambda: None,
        emit_rack_chain=bundles.append,
        on_param_value_changed=lambda p, path: fanned.append(path),
    )
    return comp, emits, bundles, fanned, advanced


def test_payload_lists_chains_and_devices():
    rack, *_ = _rack()
    p = chains_payload(rack)
    assert [c["name"] for c in p["chains"]] == ["Wet", "Echo"]
    assert p["chains"][0]["color"] == 0xFF0000
    assert p["chains"][1]["devices"] == [
        {"index": 0, "class": "Delay", "name": "Delay", "type": 2, "rack": 0},
        {"index": 1, "class": "AudioEffectGroupDevice", "name": "Inner", "type": 2, "rack": 1},
    ]


def test_read_sends_the_bundle_and_answers_the_json():
    rack, *_ = _rack()
    comp, _, bundles, _, _ = _component()
    value = comp.read(rack, "tracks/0/devices/0", CHAIN_DEVICES_KEY)
    assert bundles == ["tracks/0/devices/0"]
    assert json.loads(value)["chains"][0]["devices"][0]["class"] == "Hybrid"


def test_subscription_fans_parameter_moves_out_with_the_chain_path():
    rack, reverb, *_ = _rack()
    comp, _, _, fanned, _ = _component()
    comp.subscribe(rack, "tracks/0/devices/0", CHAIN_DEVICES_KEY)
    reverb.parameters[1].value = 0.7
    assert fanned == ["tracks/0/devices/0/chains/0/devices/0/params/1"]
    comp.unsubscribe("tracks/0/devices/0", CHAIN_DEVICES_KEY)
    reverb.parameters[1].value = 0.2
    assert len(fanned) == 1
    assert reverb.parameters[1].listeners == []


def test_a_device_added_is_structural_a_mute_is_not():
    rack, _, delay, _ = _rack()
    comp, emits, bundles, _, advanced = _component()
    comp.subscribe(rack, "tracks/0/devices/0", CHAIN_DEVICES_KEY)
    rack.chains[0].insert(1, FakeDevice("Redux2", [FakeParam("Device On", 1.0)], type_=2))
    assert advanced == ["rack-chain"] and bundles == ["tracks/0/devices/0"]
    assert json.loads(emits[-1][1][2])["chains"][0]["devices"][1]["class"] == "Redux2"
    rack.chains[1].mute = True
    rack.chains[1].fire_attr("mute")
    assert advanced == ["rack-chain"]
    assert json.loads(emits[-1][1][2])["chains"][1]["mute"] == 1


def test_chain_mute_and_solo_write():
    rack, *_ = _rack()
    comp, *_ = _component()
    assert parse_chain_field("chain.1.mute") == (1, "mute")
    assert parse_chain_field("chain.01.mute") is None
    assert comp.write(rack, "p", "chain.1.mute", 1) == (True, 1, "")
    assert rack.chains[1].mute is True
    assert comp.write(rack, "p", "chain.0.solo", 1)[0] is True
    assert comp.write(rack, "p", "chain.4.mute", 1)[0] is False
    assert comp.write(rack, "p", CHAIN_DEVICES_KEY, 1)[0] is False


def test_chain_volume_reads_writes_and_follows_live():
    rack, *_ = _rack()
    comp, emits, _, _, advanced = _component()
    assert chains_payload(rack)["chains"][0]["volume"] == 0.85
    assert comp.read(rack, "p", "chain.0.volume") == 0.85
    assert comp.write(rack, "p", "chain.0.volume", 0.5) == (True, 0.5, "")
    assert rack.chains[0].mixer_device.volume.value == 0.5
    assert comp.write(rack, "p", "chain.0.volume", 7)[1] == 1.0  # clamped
    comp.subscribe(rack, "tracks/0/devices/0", CHAIN_DEVICES_KEY)
    rack.chains[1].mixer_device.volume.value = 0.2  # Live moves it
    assert json.loads(emits[-1][1][2])["chains"][1]["volume"] == 0.2
    assert advanced == []


class FakeRackView:
    """``RackDevice.View``'s Show Devices toggle and selected chain, each
    with its listener pair."""

    def __init__(self, showing=False):
        self._showing = showing
        self.listeners = []
        self._selected = None
        self.chain_listeners = []

    @property
    def selected_chain(self):
        return self._selected

    @selected_chain.setter
    def selected_chain(self, chain):
        self._selected = chain
        for cb in list(self.chain_listeners):
            cb()

    def add_selected_chain_listener(self, cb):
        self.chain_listeners.append(cb)

    def remove_selected_chain_listener(self, cb):
        self.chain_listeners.remove(cb)

    @property
    def is_showing_chain_devices(self):
        return self._showing

    @is_showing_chain_devices.setter
    def is_showing_chain_devices(self, v):
        self._showing = bool(v)
        for cb in list(self.listeners):
            cb()

    def add_is_showing_chain_devices_listener(self, cb):
        self.listeners.append(cb)

    def remove_is_showing_chain_devices_listener(self, cb):
        self.listeners.remove(cb)


class ShowingRack(FakeEffectRack):
    """A rack with Live's chain list switch, which refuses on fewer than two
    chains as Live does (measured on 12.4.25b1)."""

    def __init__(self, chains):
        super().__init__(chains)
        self.view = FakeRackView()
        self._showing_chains = False

    @property
    def can_show_chains(self):
        return len(self.chains) >= 2

    @property
    def is_showing_chains(self):
        return self._showing_chains

    @is_showing_chains.setter
    def is_showing_chains(self, v):
        if len(self.chains) < 2:
            raise RuntimeError("Rack needs at least 2 chains to show in-line mixer")
        self._showing_chains = bool(v)


def test_show_devices_mirrors_live_both_ways():
    from components.RackChainDevicesComponent import SHOW_DEVICES_KEY
    rack = ShowingRack([FakeChain([]), FakeChain([])])
    comp, emits, *_ = _component()
    assert comp.read(rack, "r", SHOW_DEVICES_KEY) == 0
    comp.subscribe(rack, "r", SHOW_DEVICES_KEY)
    # Unfolded from Vamp: Live shows the devices and the chain list.
    assert comp.write(rack, "r", SHOW_DEVICES_KEY, 1) == (True, 1, "")
    assert rack.view.is_showing_chain_devices is True and rack.is_showing_chains is True
    # Live's own toggle echoes to the client.
    rack.view.is_showing_chain_devices = False
    assert emits[-1] == ("/looping/v3/property/value", ("r", SHOW_DEVICES_KEY, 0))
    comp.unsubscribe("r", SHOW_DEVICES_KEY)
    assert rack.view.listeners == []


def test_show_devices_on_a_one_chain_rack_leaves_the_chain_list_alone():
    from components.RackChainDevicesComponent import SHOW_DEVICES_KEY
    rack = ShowingRack([FakeChain([])])
    comp, *_ = _component()
    assert comp.write(rack, "r", SHOW_DEVICES_KEY, 1) == (True, 1, "")
    assert rack.view.is_showing_chain_devices is True and rack.is_showing_chains is False


def test_selected_chain_mirrors_live_both_ways():
    from components.RackChainDevicesComponent import SELECTED_CHAIN_KEY, SHOW_DEVICES_KEY
    rack = ShowingRack([FakeChain([]), FakeChain([]), FakeChain([])])
    rack.view.selected_chain = rack.chains[1]
    comp, emits, *_ = _component()
    assert comp.read(rack, "r", SELECTED_CHAIN_KEY) == 1
    comp.subscribe(rack, "r", SELECTED_CHAIN_KEY)
    comp.subscribe(rack, "r", SHOW_DEVICES_KEY)
    # Chosen in Vamp: Live shows that chain.
    assert comp.write(rack, "r", SELECTED_CHAIN_KEY, 2) == (True, 2, "")
    assert rack.view.selected_chain is rack.chains[2]
    # Chosen in Live: echoed to the client.
    rack.view.selected_chain = rack.chains[0]
    assert emits[-1] == ("/looping/v3/property/value", ("r", SELECTED_CHAIN_KEY, 0))
    # A chain the rack does not have is refused and changes nothing.
    assert comp.write(rack, "r", SELECTED_CHAIN_KEY, 5) == (False, None, "no chain 5")
    assert comp.write(rack, "r", SELECTED_CHAIN_KEY, "x")[0] is False
    assert rack.view.selected_chain is rack.chains[0]
    # Each row lets go of its own listener.
    comp.unsubscribe("r", SELECTED_CHAIN_KEY)
    assert rack.view.chain_listeners == [] and len(rack.view.listeners) == 1
    comp.disconnect()
    assert rack.view.listeners == []


def test_selected_chain_reads_none_without_a_selection():
    from components.RackChainDevicesComponent import SELECTED_CHAIN_KEY
    rack = ShowingRack([FakeChain([])])
    comp, *_ = _component()
    assert comp.read(rack, "r", SELECTED_CHAIN_KEY) is None


def test_visible_macro_count_is_a_read_only_row_on_every_chain_rack():
    """The chain overview reads how many macros Live shows on a rack."""
    from components.PropertyComponent import spec_for

    for cls in ("AudioEffectGroupDevice", "InstrumentGroupDevice", "MidiEffectGroupDevice"):
        spec = spec_for(cls, "visible_macro_count")
        assert spec is not None
        assert spec.attr_name == "visible_macro_count"
        assert spec.listener_path == ""
        assert not spec.writable
        assert spec.computed is None
    assert spec_for("DrumGroupDevice", "visible_macro_count") is None


class VariationRack(FakeEffectRack):
    """A rack with Live's macro variations: snapshots of its macro values."""

    def __init__(self, snapshots):
        super().__init__([], macros=[FakeParam("Device On", 1.0), FakeParam("Drive", 10.0, 0, 127), FakeParam("Tone", 20.0, 0, 127)])
        self.snapshots = [list(s) for s in snapshots]
        self._selected = -1
        self.count_listeners = []

    @property
    def variation_count(self):
        return len(self.snapshots)

    @property
    def selected_variation_index(self):
        return self._selected

    @selected_variation_index.setter
    def selected_variation_index(self, i):
        if not 0 <= i < len(self.snapshots):
            raise RuntimeError("Variation index out of range")
        self._selected = i

    def recall_selected_variation(self):
        for p, v in zip(self.parameters[1:], self.snapshots[self._selected]):
            p.value = v

    def store_variation(self):
        self.snapshots.append([p.value for p in self.parameters[1:]])
        self._fire()

    def delete_selected_variation(self):
        del self.snapshots[self._selected]
        self._selected = -1
        self._fire()

    def randomize_macros(self):
        for p in self.parameters[1:]:
            p.value = 99.0

    def add_variation_count_listener(self, cb):
        self.count_listeners.append(cb)

    def remove_variation_count_listener(self, cb):
        self.count_listeners.remove(cb)

    def _fire(self):
        for cb in list(self.count_listeners):
            cb()


def test_variations_recall_store_delete_and_randomize():
    from components.RackChainDevicesComponent import (
        VARIATIONS_KEY, VARIATION_DELETE_KEY, VARIATION_RANDOMIZE_KEY, VARIATION_RECALL_KEY, VARIATION_STORE_KEY,
    )
    rack = VariationRack([[1.0, 2.0], [100.0, 120.0]])
    comp, emits, *_ = _component()
    assert json.loads(comp.read(rack, "r", VARIATIONS_KEY)) == {"count": 2, "selected": -1}
    comp.subscribe(rack, "r", VARIATIONS_KEY)
    # Recall: the macros take the variation, and the row says which is selected.
    assert comp.write(rack, "r", VARIATION_RECALL_KEY, 1) == (True, 1, "")
    assert [p.value for p in rack.parameters[1:]] == [100.0, 120.0]
    assert emits[-1] == ("/looping/v3/property/value", ("r", VARIATIONS_KEY, '{"count":2,"selected":1}'))
    # An index the rack does not have is refused and recalls nothing.
    assert comp.write(rack, "r", VARIATION_RECALL_KEY, 2) == (False, None, "no variation 2")
    # Store: Live's count listener and the write both say there are three.
    assert comp.write(rack, "r", VARIATION_STORE_KEY, 1) == (True, 1, "")
    assert json.loads(emits[-1][1][2])["count"] == 3
    # Delete the first.
    assert comp.write(rack, "r", VARIATION_DELETE_KEY, 0) == (True, 0, "")
    assert rack.snapshots == [[100.0, 120.0], [100.0, 120.0]]
    # Randomize moves the macros.
    assert comp.write(rack, "r", VARIATION_RANDOMIZE_KEY, 1) == (True, 1, "")
    assert [p.value for p in rack.parameters[1:]] == [99.0, 99.0]
    comp.unsubscribe("r", VARIATIONS_KEY)
    assert rack.count_listeners == []


def test_variation_rows_are_allowed_on_every_chain_rack():
    from components.PropertyComponent import spec_for

    for cls in ("AudioEffectGroupDevice", "InstrumentGroupDevice", "MidiEffectGroupDevice"):
        assert not spec_for(cls, "variations").writable
        for verb in ("variation.recall", "variation.store", "variation.delete", "variation.randomize"):
            assert spec_for(cls, verb).writable
    assert spec_for("DrumGroupDevice", "variations") is None
