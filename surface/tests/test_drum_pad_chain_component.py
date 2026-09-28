"""DrumPadChainComponent — the devices inside a drum pad's chain (issue #491).

What is pinned here:

- the presence row: every populated pad's chain devices with index, class,
  name and type; the instrument listed too; names dropped past the cap;
- the subscription rows: a pad's cold read carries its entry AND sends a
  pad-scoped bundle; the parameter listeners of the pad's effects (never
  the instrument's) feed the mutation fan-out with the composed pad path;
- the structural composite: a chain listener fires → nothing happens in
  the notification; on the deferred tick the generation advances, the
  property channel's invalidate runs, presence and every subscribed pad
  are re-emitted, and the parameter listeners follow the new shape;
- the rack's own pad-list listeners re-attach chain listeners for pads
  that gained a chain;
- lifetime: the last unsubscribe releases every listener; a different
  rack at the same path starts fresh; the rows are read-only.
"""

from __future__ import annotations

import json

import pytest

from components.DrumPadChainComponent import (
    CHAIN_CHANGE_DELAY_MS,
    PAD_FX_BYTES_SOFT_CAP,
    PAD_FX_KEY,
    PAD_FX_PROPERTY,
    REASON_PAD_CHAIN,
    DrumPadChainComponent,
    is_pad_chain_property,
    pad_chain_function,
    pad_chain_property,
    parse_pad_chain_function,
)
from components.PropertyComponent import ALLOWLIST, spec_for
from tests.support.lom_fakes import (
    FakeChain,
    FakeDevice,
    FakePad,
    FakeParam,
    drumcell,
    eq8,
    make_rack,
    pad,
)

PATH = "tracks/2/devices/0"


def reverb():
    return FakeDevice("Hybrid", [FakeParam("Device On", 1.0), FakeParam("Dry/Wet", 0.3)], type_=2, name="Reverb")


def kit_with_effects():
    """Three DrumCell pads; 36 carries a Reverb after its cell, 38 an Eq8."""
    return make_rack([
        FakePad(36, [FakeChain([drumcell(), reverb()], name="Kick")]),
        pad(37, drumcell()),
        FakePad(38, [FakeChain([drumcell(), eq8()], name="Snare")]),
    ])


class Harness:
    def __init__(self, scheduler=True):
        self.emits = []
        self.scheduled = []
        self.advances = []
        self.invalidates = 0
        self.bundles = []
        self.param_fires = []
        self.comp = DrumPadChainComponent(
            emit=lambda a, args: self.emits.append((a, args)),
            schedule_delayed=(lambda ms, fn: self.scheduled.append((ms, fn))) if scheduler else None,
            advance_generation=lambda reason: self.advances.append(reason),
            on_structural_invalidate=self._invalidate,
            emit_pad_chain=lambda path: self.bundles.append(path),
            on_param_value_changed=lambda p, path: self.param_fires.append((p, path)),
        )

    def _invalidate(self):
        self.invalidates += 1

    def run_scheduled(self):
        pending, self.scheduled = self.scheduled, []
        for _, fn in pending:
            fn()

    def values(self, name):
        return [args for a, args in self.emits if a == "/looping/v3/property/value" and args[1] == name]


# --- names ---------------------------------------------------------------------


def test_row_names_and_parsers():
    assert PAD_FX_PROPERTY == "vm.padFx"
    assert pad_chain_function(38) == "padChain.38"
    assert pad_chain_property(38) == "vm.padChain.38"
    assert parse_pad_chain_function("padChain.38") == 38
    assert parse_pad_chain_function("padChain.128") is None
    assert parse_pad_chain_function("padChain.") is None
    assert parse_pad_chain_function("pad.38.pitch") is None
    assert is_pad_chain_property("vm.padChain.0")
    assert not is_pad_chain_property("vm.padChain.x")
    assert not is_pad_chain_property("vm.pad.38.pitch")


def test_property_channel_rows_route_to_this_provider_and_are_read_only():
    spec = ALLOWLIST[("DrumGroupDevice", PAD_FX_PROPERTY)]
    assert spec.computed == "drum_pad_chain" and spec.writable is False and spec.attr_name == PAD_FX_KEY
    spec = spec_for("DrumGroupDevice", "vm.padChain.38")
    assert spec is not None and spec.computed == "drum_pad_chain" and spec.writable is False
    assert spec.attr_name == "padChain.38"
    assert spec_for("DrumGroupDevice", "vm.padChain.38") is spec  # cached
    assert spec_for("OriginalSimpler", "vm.padChain.38") is None
    # The per-pad value rows are still the virtual-macro provider's.
    assert spec_for("DrumGroupDevice", "vm.pad.38.pitch").computed == "drum_vm"


# --- presence ------------------------------------------------------------------


def test_presence_lists_every_populated_pads_chain_devices_with_index_class_name_and_type():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    raw = h.comp.read(rack, PATH, PAD_FX_KEY)
    payload = json.loads(raw)
    assert set(payload["pads"]) == {"36", "37", "38"}
    assert payload["pads"]["36"] == [
        {"index": 0, "class": "DrumCell", "name": "DrumCell", "type": 1},
        {"index": 1, "class": "Hybrid", "name": "Reverb", "type": 2},
    ]
    assert payload["pads"]["37"] == [{"index": 0, "class": "DrumCell", "name": "DrumCell", "type": 1}]
    assert payload["pads"]["38"][1]["class"] == "Eq8"
    # Key-sorted, compact: the census's own shape.
    assert raw == json.dumps(payload, separators=(",", ":"), sort_keys=True)


def test_presence_drops_names_past_the_soft_cap():
    h = Harness()
    long = "X" * 200
    pads = [FakePad(n, [FakeChain([FakeDevice("DrumCell", name=long), FakeDevice("Hybrid", type_=2, name=long)])]) for n in range(36, 100)]
    rack = make_rack(pads)
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    raw = h.comp.read(rack, PATH, PAD_FX_KEY)
    assert len(raw) <= PAD_FX_BYTES_SOFT_CAP + 2000  # names gone; the rest is bounded
    payload = json.loads(raw)
    assert "name" not in payload["pads"]["36"][0]
    assert payload["pads"]["36"][1]["class"] == "Hybrid"


def test_presence_tolerates_an_unreadable_type_and_a_missing_name():
    class Odd:
        class_name = "Weird"
        parameters = ()

        @property
        def type(self):
            raise RuntimeError("no type")

        @property
        def name(self):
            raise RuntimeError("no name")

    h = Harness()
    rack = make_rack([FakePad(36, [FakeChain([Odd()])])])
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    payload = json.loads(h.comp.read(rack, PATH, PAD_FX_KEY))
    assert payload["pads"]["36"] == [{"index": 0, "class": "Weird", "name": "", "type": None}]


# --- a pad's subscription --------------------------------------------------------


def test_pad_cold_read_carries_its_entry_and_sends_the_bundle():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, "padChain.36")
    raw = h.comp.read(rack, PATH, "padChain.36")
    assert json.loads(raw) == {
        "note": 36,
        "devices": [
            {"index": 0, "class": "DrumCell", "name": "DrumCell", "type": 1},
            {"index": 1, "class": "Hybrid", "name": "Reverb", "type": 2},
        ],
    }
    assert h.bundles == [PATH + "/pads/36"]
    # A second cold read (another client bumping the refcount) sends it again.
    h.comp.read(rack, PATH, "padChain.36")
    assert h.bundles == [PATH + "/pads/36", PATH + "/pads/36"]


def test_pad_with_no_chain_reads_nil_and_sends_no_bundle():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, "padChain.40")
    assert h.comp.read(rack, PATH, "padChain.40") is None
    assert h.bundles == []  # nothing to send; the emitter would only have refused it


def test_pad_lookup_scans_when_the_list_is_not_note_indexed():
    """A rack whose ``drum_pads`` list is not note-indexed (a stub, or a
    Live that stops guaranteeing it) still finds the pad by its note."""
    h = Harness()
    rack = make_rack([pad(40, drumcell()), FakePad(36, [FakeChain([drumcell(), reverb()], name="Kick")])])
    rack.drum_pads = [p for p in rack.drum_pads if p.chains]  # two pads, out of note order
    h.comp.subscribe(rack, PATH, "padChain.36")
    raw = h.comp.read(rack, PATH, "padChain.36")
    assert json.loads(raw)["devices"][1]["name"] == "Reverb"


def test_subscribed_pads_effect_parameters_fire_the_mutation_fanout_with_the_pad_path():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, "padChain.36")
    cell, rev = rack.drum_pads[36].chains[0].devices
    # The instrument's parameters are the virtual-macro layer's: not watched.
    assert all(not p.listeners for p in cell.parameters)
    assert all(len(p.listeners) == 1 for p in rev.parameters)
    rev.parameters[1].value = 0.9
    assert h.param_fires == [(rev.parameters[1], PATH + "/pads/36/devices/1/params/1")]
    # An unsubscribed pad's effects are not watched.
    assert all(not p.listeners for p in rack.drum_pads[38].chains[0].devices[1].parameters)


def test_writes_are_refused():
    h = Harness()
    rack = kit_with_effects()
    ok, stored, detail = h.comp.write(rack, PATH, "padChain.36", 1)
    assert ok is False and stored is None and "read-only" in detail


# --- the structural composite ------------------------------------------------------


def test_chain_listener_defers_then_advances_invalidates_and_reemits():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    h.comp.subscribe(rack, PATH, "padChain.36")
    h.comp.read(rack, PATH, PAD_FX_KEY)
    h.comp.read(rack, PATH, "padChain.36")
    h.emits.clear()
    h.bundles.clear()
    chain36 = rack.drum_pads[36].chains[0]
    assert chain36.listener_count() == 1
    assert rack.drum_pads[38].chains[0].listener_count() == 1  # every populated pad is watched

    # An insert fires the listener: nothing happens inside the notification.
    delay = FakeDevice("Delay", [FakeParam("Device On", 1.0)], type_=2, name="Delay")
    chain36.insert(1, delay)  # before the Reverb, which shifts to index 2
    assert h.advances == [] and h.invalidates == 0 and h.emits == [] and h.bundles == []
    assert [ms for ms, _ in h.scheduled] == [CHAIN_CHANGE_DELAY_MS]

    h.run_scheduled()
    assert h.advances == [REASON_PAD_CHAIN]
    assert h.invalidates == 1
    assert h.bundles == [PATH + "/pads/36"]
    presence = json.loads(h.values(PAD_FX_PROPERTY)[0][2])
    assert [d["name"] for d in presence["pads"]["36"]] == ["DrumCell", "Delay", "Reverb"]
    entry = json.loads(h.values("vm.padChain.36")[0][2])
    assert [d["index"] for d in entry["devices"]] == [0, 1, 2]
    # The parameter listeners follow the new shape: the Reverb's path is index 2 now.
    rev = chain36.devices[2]
    rev.parameters[1].value = 0.4
    assert h.param_fires[-1][1] == PATH + "/pads/36/devices/2/params/1"
    assert all(len(p.listeners) == 1 for p in delay.parameters)


def test_two_fires_inside_the_window_run_the_composite_once():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    chain = rack.drum_pads[36].chains[0]
    chain.fire()
    chain.fire()
    assert len(h.scheduled) == 1
    h.run_scheduled()
    assert h.advances == [REASON_PAD_CHAIN]


def test_pads_that_gain_a_chain_are_watched_after_the_racks_pad_listener_fires():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    new_chain = FakeChain([drumcell()], name="Tom")
    rack.drum_pads[40].chains = [new_chain]
    rack.fire("drum_pads")
    h.run_scheduled()
    assert new_chain.listener_count() == 1
    presence = json.loads(h.values(PAD_FX_PROPERTY)[-1][2])
    assert "40" in presence["pads"]


def test_a_scheduler_that_raises_leaves_the_next_change_schedulable():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    chain = rack.drum_pads[36].chains[0]
    h.comp._schedule_delayed = lambda ms, fn: (_ for _ in ()).throw(RuntimeError("no scheduler"))
    chain.fire()  # swallowed, logged; nothing pending
    assert h.scheduled == []
    h.comp._schedule_delayed = lambda ms, fn: h.scheduled.append((ms, fn))
    chain.fire()  # the next fire schedules as if nothing had happened
    assert len(h.scheduled) == 1
    h.run_scheduled()
    assert h.advances == [REASON_PAD_CHAIN]


def test_the_composite_stops_when_the_invalidate_released_its_state():
    """The property channel's structural invalidate can unsubscribe the
    very rows the composite is serving (the rack is gone from its path):
    the composite then re-emits nothing for a state it no longer holds."""
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    h.comp.subscribe(rack, PATH, "padChain.36")

    def release_everything():
        h.invalidates += 1
        h.comp.unsubscribe(PATH, PAD_FX_KEY)
        h.comp.unsubscribe(PATH, "padChain.36")

    h.comp._on_structural_invalidate = release_everything
    h.emits.clear()
    h.bundles.clear()
    rack.drum_pads[36].chains[0].fire()
    h.run_scheduled()
    assert h.advances == [REASON_PAD_CHAIN] and h.invalidates == 1
    assert h.emits == [] and h.bundles == []
    assert h.comp.debug_state(PATH) is None


def test_the_parameter_listener_cap_leaves_the_rest_of_a_pad_unwatched(monkeypatch):
    import components.DrumPadChainComponent as mod

    monkeypatch.setattr(mod, "MAX_CHAIN_PARAM_LISTENERS", 1)
    h = Harness()
    rack = kit_with_effects()  # pad 36's Reverb has two parameters
    h.comp.subscribe(rack, PATH, "padChain.36")
    rev = rack.drum_pads[36].chains[0].devices[1]
    assert [len(p.listeners) for p in rev.parameters] == [1, 0]
    assert h.comp.debug_state(PATH)["paramListeners"] == {36: 1}
    h.comp.unsubscribe(PATH, "padChain.36")
    assert [len(p.listeners) for p in rev.parameters] == [0, 0]


def test_without_a_scheduler_the_composite_runs_inline():
    h = Harness(scheduler=False)
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    rack.drum_pads[36].chains[0].fire()
    assert h.advances == [REASON_PAD_CHAIN] and h.invalidates == 1


# --- lifetime -----------------------------------------------------------------------


def test_last_unsubscribe_releases_every_listener():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, PAD_FX_KEY)
    h.comp.subscribe(rack, PATH, "padChain.36")
    rev = rack.drum_pads[36].chains[0].devices[1]
    assert rack.listener_count() == 2  # drum_pads + chains
    assert rev.parameters[0].listeners
    h.comp.unsubscribe(PATH, "padChain.36")
    assert not rev.parameters[0].listeners  # the pad's watch went with its row
    assert rack.drum_pads[36].chains[0].listener_count() == 1  # presence still needs the chain
    h.comp.unsubscribe(PATH, PAD_FX_KEY)
    assert rack.listener_count() == 0
    assert rack.drum_pads[36].chains[0].listener_count() == 0
    assert rack.drum_pads[38].chains[0].listener_count() == 0
    assert h.comp.debug_state(PATH) is None
    # A fire after release is inert.
    rack.drum_pads[36].chains[0].fire()
    assert h.scheduled == []


def test_a_different_rack_at_the_same_path_starts_fresh():
    h = Harness()
    first = kit_with_effects()
    h.comp.subscribe(first, PATH, PAD_FX_KEY)
    second = kit_with_effects()
    h.comp.subscribe(second, PATH, PAD_FX_KEY)
    assert first.listener_count() == 0
    assert second.listener_count() == 2


def test_disconnect_detaches_and_silences():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, "padChain.36")
    h.comp.disconnect()
    assert rack.listener_count() == 0
    assert h.comp.read(rack, PATH, PAD_FX_KEY) is None
    rack.drum_pads[36].chains[0].fire()
    assert h.scheduled == []


def test_unknown_functions_are_ignored():
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, "fx1")
    assert h.comp.debug_state(PATH) is None
    assert h.comp.read(rack, PATH, "fx1") is None


@pytest.mark.parametrize("function", ["padChain.36", PAD_FX_KEY])
def test_debug_state_reports_what_is_held(function):
    h = Harness()
    rack = kit_with_effects()
    h.comp.subscribe(rack, PATH, function)
    state = h.comp.debug_state(PATH)
    assert state["subscribed"] == [function]
    assert state["chainListeners"] == [36, 37, 38]
