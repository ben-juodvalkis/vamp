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
