"""DrumVirtualMacroComponent tests — issue #489 Milestone 1 (ADR-428).

Covers, with fakes shaped like the measured LOM:

- member resolution by instrument class + parameter name (DrumCell /
  OriginalSimpler / MultiSampler bound; Operator, a nested Instrument
  Rack, empty pads and unknown classes are non-members; effects on
  either side of the instrument are skipped);
- routing: unmapped → fan-out to every member, mapped pipeline kit →
  the legacy macro in macro units, per-function on a partially mapped
  kit, never a macro on a non-family rack;
- the write rule ``min + t·(max−min)`` through each member's own range,
  the two-state switch threshold, enum ints, whole-semitone pitch with
  clamping, ``is_enabled=False`` skipped without a raise;
- seeding from the first continuous member / the legacy macro, ``None``
  on an empty rack, the retry when pads populate after subscribe;
- the PropertyComponent lane: cold-read on subscribe, echo after set,
  rejection detail, missing provider, teardown on unsubscribe and on
  structural invalidate;
- deferred apply + flush coalescing (latest value once per pass);
- rack change listeners → deferred re-seed + re-emit;
- the ``vm.members`` census (Milestone 1b): pad count / class histogram
  / mapping flags / per-function member + held counts on DrumCell-only,
  Simpler+Sampler, plugin-pad and nested-rack fakes; held counting on a
  mapped fake; re-emit on re-seed; read-only on the channel;
- the rack-macro functions (2026-09-07): a kit of nested Instrument
  Racks lists its pad racks' macro names in the census (rack order,
  default names dropped), ``vm.macro.<name>`` seeds from the first pad,
  fans out by name through each macro's own 0..127, skips a held macro,
  never touches the Drum Rack's own macros, reads nil for a name the
  kit lacks; a re-seed drops a value whose members are gone; the
  channel synthesises the row on a Drum Rack only.
"""

from __future__ import annotations

import json
import math

import pytest

from components.DrumVirtualMacroComponent import (
    BOUND_CLASSES,
    CENSUS_BYTES_SOFT_CAP,
    EDIT_ABSORB_DELAY_MS,
    FUNCTIONS,
    FX_TYPE_MAX,
    INSTRUMENT_RACK_CLASS_NAME,
    MACRO_FUNCTION_PREFIX,
    MACRO_PROPERTY_PREFIX,
    MEMBERS_KEY,
    MEMBERS_PROPERTY,
    PAD_NAME_MAX,
    PAD_PROPERTY_PREFIX,
    PITCH_MACRO_NAMES,
    PITCH_MAX,
    PITCH_MIN,
    PROPERTY_NAMES,
    PROPERTY_PREFIX,
    PROVIDER_NAME,
    RESEED_DELAY_MS,
    SELECTED_PAD_KEY,
    SELECTED_PAD_PROPERTY,
    STALE_READ_WINDOW_MS,
    TOGGLE_ON_ABOVE_T,
    DrumVirtualMacroComponent,
    function_for_property,
    is_empty_macro_name,
    is_macro_function,
    is_pad_property,
    is_pitch_macro_name,
    macro_function,
    parse_pad_function,
)
from components.GenerationComponent import GenerationComponent
from components.PropertyComponent import (
    ALLOWLIST,
    V3_ERROR_ADDRESS,
    V3_ERROR_DETAIL_COMPUTED_PROVIDER_MISSING,
    V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED,
    V3_ERROR_DETAIL_PROPERTY_READ_ONLY,
    V3_ERROR_WRITE_REJECTED,
    V3_PROPERTY_SET_ADDRESS,
    V3_PROPERTY_SUBSCRIBE_ADDRESS,
    V3_PROPERTY_VALUE_ADDRESS,
    PropertyComponent,
    PropertySpec,
    spec_for,
)

# --- fakes ------------------------------------------------------------------
from tests.support.lom_fakes import (
    FX1_MEMBERS,
    FX2_MEMBERS,
    FakeChain,
    FakeDevice,
    FakePad,
    FakeParam,
    FakeRack,
    FakeSong,
    cells,
    drumcell,
    eq8,
    family_macros,
    growing_sampler,
    hand_edit,
    macro,
    make_rack,
    mapped_kit,
    pad,
    param,
    sampler,
    simpler,
    unmapped_kit,
)
from tests.test_lom_listeners import StubSong, StubTrack

# --- fixtures ---------------------------------------------------------------


@pytest.fixture
def emits():
    return []


@pytest.fixture
def comp(emits):
    return DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)))


PATH = "tracks/0/devices/0"

# --- table sanity -----------------------------------------------------------


def test_property_names_and_legacy_indices():
    # Table order follows the legacy macro index, which is also the order
    # the allowlist rows are generated in.
    assert PROPERTY_NAMES == (
        "vm.fx1", "vm.fx2", "vm.fxType", "vm.pitch", "vm.attack", "vm.decay", "vm.start",
        "vm.release", "vm.oscAmount", "vm.oscCoarse", "vm.pitchEnvAmount", "vm.pitchEnvAttack",
        "vm.sustain", "vm.spread", "vm.filterFreq", "vm.filterRes", "vm.gain",
        "vm.chainVolume", "vm.chainMute",
    )
    legacy = {name: fn.legacy_macro for name, fn in FUNCTIONS.items()}
    assert legacy == {
        "fx1": 1, "fx2": 2, "fxType": 3, "pitch": 4, "attack": 9, "decay": 10, "start": 11,
        "release": 0,   # no pipeline macro ever drove a release
        "oscAmount": 0, "oscCoarse": 0, "pitchEnvAmount": 0, "pitchEnvAttack": 0,
        "sustain": 0, "spread": 0, "filterFreq": 0, "filterRes": 0,
        "gain": 0,   # none of the later functions ever had one
        "chainVolume": 0, "chainMute": 0,
    }
    # Sustain and Spread are both sample instruments' (the Simpler kit's
    # Time pad and Trnsp use attack / release / pitch, bound long since).
    assert FUNCTIONS["sustain"].bindings == {"OriginalSimpler": ("Ve Sustain",), "MultiSampler": ("Ve Sustain",)}
    assert FUNCTIONS["spread"].bindings == {"OriginalSimpler": ("Spread",), "MultiSampler": ("Spread",)}
    # The Sampler row binds the section switch first, then the amount.
    assert FUNCTIONS["oscAmount"].bindings == {"MultiSampler": ("Osc On", "O Volume")}
    assert FUNCTIONS["pitchEnvAmount"].bindings == {"MultiSampler": ("Pe On", "Pe < Env")}
    assert FUNCTIONS["release"].bindings == {
        "OriginalSimpler": ("Ve Release",), "MultiSampler": ("Ve Release",),
    }
    assert BOUND_CLASSES == {"DrumCell", "OriginalSimpler", "MultiSampler"}
    assert set(FUNCTIONS["fx1"].bindings["DrumCell"]) == set(FX1_MEMBERS)
    assert set(FUNCTIONS["fx2"].bindings["DrumCell"]) == set(FX2_MEMBERS)
    assert "MultiSampler" not in FUNCTIONS["start"].bindings  # Sampler has no start


def test_allowlist_carries_computed_rows():
    for name in PROPERTY_NAMES:
        spec = ALLOWLIST[("DrumGroupDevice", name)]
        assert spec.computed == PROVIDER_NAME
        assert spec.writable
        assert spec.listener_path == ""
        assert spec.attr_name == name[len(PROPERTY_PREFIX):]
    assert function_for_property("vm.pitch") is FUNCTIONS["pitch"]
    assert function_for_property("sample.gain") is None


def test_property_spec_rejects_computed_with_lom_plumbing():
    with pytest.raises(ValueError):
        PropertySpec(listener_path="sample", attr_name="x", writable=True, computed="p")
    with pytest.raises(ValueError):
        PropertySpec(listener_path="", attr_name="x", writable=True, computed="p", coerce_to_int=True)


# --- member resolution ------------------------------------------------------


def test_resolves_drumcell_members_by_name(comp):
    rack = unmapped_kit(2)
    st = comp._state_for(rack, PATH)
    counts = {k: len(v) for k, v in st.members.items()}
    assert counts == {
        "fx1": 20, "fx2": 18, "fxType": 2, "pitch": 2, "attack": 2, "decay": 2, "start": 2,
        "release": 0, "oscAmount": 0, "oscCoarse": 0, "pitchEnvAmount": 0, "pitchEnvAttack": 0,
        # filterFreq counts the switch AND the amount, like oscAmount.
        "sustain": 0, "spread": 0, "filterFreq": 4, "filterRes": 2, "gain": 2,
        # The pad's own mixer strip: every pad with a chain.
        "chainVolume": 2, "chainMute": 2,
    }
    assert st.member_pads == 2
    assert st.family is True
    assert [m.note for m in st.members["pitch"]] == [36, 37]
    assert [m.pname for m in st.members["attack"]] == ["Attack", "Attack"]


def test_resolves_simpler_and_sampler_bindings(comp):
    rack = make_rack([pad(40, simpler()), pad(41, sampler())])
    st = comp._state_for(rack, PATH)
    by = {k: [(m.cls, m.pname) for m in v] for k, v in st.members.items()}
    assert by["pitch"] == [("OriginalSimpler", "Transpose"), ("MultiSampler", "Transpose")]
    assert by["attack"] == [("OriginalSimpler", "Ve Attack"), ("MultiSampler", "Ve Attack")]
    assert by["decay"] == [("OriginalSimpler", "Ve Decay"), ("MultiSampler", "Ve Decay")]
    assert by["start"] == [("OriginalSimpler", "S Start")]  # Sampler: non-member
    assert by["fx1"] == [] and by["fx2"] == [] and by["fxType"] == []


def test_unknown_instrument_and_nested_rack_are_non_members(comp):
    operator = FakeDevice("Operator", [FakeParam("Transpose", 0.0, -48, 48)])
    nested = FakeDevice("InstrumentGroupDevice", [FakeParam("Macro 1", 0.0, 0, 127)])
    rack = make_rack([pad(36, operator), pad(37, nested), pad(38, drumcell())])
    st = comp._state_for(rack, PATH)
    # The Operator pad contributes nothing at all, and the nested rack
    # nothing to the FIXED functions (its only macro is default-named, so
    # not a control either). Its CHAIN VOLUME is still a `gain` member
    # (2026-09-08) — that is the one thing a nested-rack pad always has —
    # so it counts as a member pad where before it did not.
    assert st.member_pads == 2
    assert [m.note for m in st.members["pitch"]] == [38]
    assert [(m.note, m.pname) for m in st.members["gain"]] == [(37, "Chain Volume"), (38, "Volume")]


def test_effects_around_the_instrument_are_skipped(comp):
    midi_fx = FakeDevice("MidiPitcher", [FakeParam("Pitch", 0.0)], type_=4)
    cell = drumcell()
    rack = make_rack([pad(36, midi_fx, cell, eq8(), eq8()), pad(37, eq8())])
    st = comp._state_for(rack, PATH)
    assert st.member_pads == 1
    assert st.members["pitch"][0].param is param(cell, "Transpose")


def test_missing_parameter_name_skips_only_that_member(comp):
    rack = make_rack([pad(36, drumcell(omit=("RM Amt",)))])
    st = comp._state_for(rack, PATH)
    assert len(st.members["fx1"]) == 9
    assert len(st.members["fx2"]) == 9
    assert len(st.members["pitch"]) == 1


def test_empty_rack_has_no_members(comp):
    rack = make_rack([])
    st = comp._state_for(rack, PATH)
    assert st.member_pads == 0
    assert all(v == [] for v in st.members.values())


# --- routing ----------------------------------------------------------------


def test_unmapped_kit_fans_out_to_every_member(comp):
    rack = unmapped_kit(3)
    ok, stored, detail = comp.write(rack, PATH, "fx2", 0.25)
    assert (ok, stored, detail) == (True, 0.25, "")
    for cell in cells(rack):
        for name in FX2_MEMBERS:
            assert param(cell, name).value == pytest.approx(0.25)
            assert len(param(cell, name).writes) == 1
    assert macro(rack, 2).writes == []  # FX2 macro untouched


# --- gain (2026-09-08) ------------------------------------------------------
#
# One "how loud is this pad" slider over three different measurements.
# Every bound class names the parameter ``Volume``; the ranges are what
# the rig reported, not what a doc says: DrumCell 0..1 (index 18 on
# `Octagonal House`), Sampler and Simpler -36..36 dB (index 15 on
# `Bright Room`, index 20 on the Acuff kit's Simplers). The ``t`` fan-out
# spans each member's own min..max, so one drag moves a mixed kit
# together and each pad lands in its own units.


def test_gain_binds_volume_on_every_bound_class(comp):
    rack = make_rack([pad(36, drumcell()), pad(37, simpler()), pad(38, sampler())])
    st = comp._state_for(rack, PATH)
    assert [(m.cls, m.pname, m.min, m.max) for m in st.members["gain"]] == [
        ("DrumCell", "Volume", 0.0, 1.0),
        ("OriginalSimpler", "Volume", -36.0, 36.0),
        ("MultiSampler", "Volume", -36.0, 36.0),
    ]


def test_gain_write_lands_in_each_members_own_units(comp):
    # Pads level with each other to start (both at half travel), so this
    # isolates the unit mapping from the per-pad deviations below:
    # t 0.75 is 0.75 of DrumCell's 0..1 and 0.75 of the Sampler's
    # -36..36 dB, which is +18.
    cell, samp = drumcell(), sampler()
    param(cell, "Volume").value = 0.5
    param(samp, "Volume").value = 0.0
    rack = make_rack([pad(36, cell), pad(37, samp)])
    ok, stored, detail = comp.write(rack, PATH, "gain", 0.75)
    assert (ok, stored, detail) == (True, 0.75, "")
    assert param(cell, "Volume").value == pytest.approx(0.75)
    assert param(samp, "Volume").value == pytest.approx(18.0)
    assert comp.read(rack, PATH, "gain") == 0.75


def test_gain_keeps_the_kits_balance(comp):
    # Gain is a `t` function, so it carries the per-pad deviations every
    # continuous function does (ADR-428): the kit value moves and each
    # pad keeps its offset from it. A kit is mixed both in class and in
    # level here — the DrumCell at 0.33 of 0..1 seeds the kit value, the
    # Simpler sits at -2.8125 dB (t 0.4609) and the Sampler at 0 dB
    # (t 0.5) — and a drag to 0.75 moves all three by the same +0.42 in
    # t, so the balance the kit was built with survives.
    rack = make_rack([pad(36, drumcell()), pad(37, simpler()), pad(38, sampler())])
    assert comp.read(rack, PATH, "gain") == pytest.approx(0.33)
    ok, _, _ = comp.write(rack, PATH, "gain", 0.75)
    assert ok
    delta = 0.75 - 0.33
    assert param(rack.drum_pads[36].chains[0].devices[0], "Volume").value == pytest.approx(0.33 + delta)
    assert param(rack.drum_pads[37].chains[0].devices[0], "Volume").value == pytest.approx(
        -36.0 + (0.4609375 + delta) * 72.0
    )
    assert param(rack.drum_pads[38].chains[0].devices[0], "Volume").value == pytest.approx(
        -36.0 + (0.5 + delta) * 72.0
    )


def test_chain_volume_and_mute_move_one_pad(comp):
    # The pad's own mixer strip (2026-09-29): every pad with a chain is a
    # member whatever its instrument, and a pad row moves that pad alone.
    rack = unmapped_kit(3)
    ok, stored, _ = comp.write(rack, PATH, "pad.37.chainVolume", 0.4)
    assert (ok, stored) == (True, 0.4)
    assert rack.drum_pads[37].chains[0].mixer_device.volume.writes == [pytest.approx(0.4)]
    assert rack.drum_pads[36].chains[0].mixer_device.volume.writes == []
    assert comp.read(rack, PATH, "pad.37.chainVolume") == pytest.approx(0.4)

    assert comp.read(rack, PATH, "pad.38.chainMute") == 0
    ok, stored, _ = comp.write(rack, PATH, "pad.38.chainMute", 1)
    assert (ok, stored) == (True, 1)
    assert rack.drum_pads[38].mute is True
    assert rack.drum_pads[36].mute is False
    assert comp.read(rack, PATH, "pad.38.chainMute") == 1
    comp.write(rack, PATH, "pad.38.chainMute", 0)
    assert rack.drum_pads[38].mute is False
    # Neither rides the census: the counts would say nothing.
    census = json.loads(comp.read(rack, PATH, "members"))
    assert "chainVolume" not in census["functions"] and "chainMute" not in census["functions"]


def test_gain_on_a_nested_rack_kit_is_the_pad_chain_volume(comp):
    # The pads' Samplers sit inside the racks where no name lookup
    # reaches them, so gain binds the DRUM PAD's own chain volume
    # instead (0..1, 0.85 = 0 dB on the rig).
    rack = ethnic_kit(3)
    st = comp._state_for(rack, PATH)
    assert [(m.cls, m.pname, m.note) for m in st.members["gain"]] == [
        ("InstrumentGroupDevice", "Chain Volume", 36),
        ("InstrumentGroupDevice", "Chain Volume", 37),
        ("InstrumentGroupDevice", "Chain Volume", 38),
    ]
    ok, stored, _ = comp.write(rack, PATH, "gain", 0.5)
    assert (ok, stored) == (True, 0.5)
    for note in (36, 37, 38):
        assert rack.drum_pads[note].chains[0].mixer_device.volume.writes == [pytest.approx(0.5)]
    # A rack macro named Volume would be its own control; gain never
    # writes one, and never the Drum Rack's own macros either.
    assert all(macro(rack, i).writes == [] for i in range(17))


def test_gain_has_no_legacy_macro_on_a_mapped_family_kit(comp):
    # No pipeline macro ever drove a pad volume, so even on a still-mapped
    # family kit gain fans out to the cells rather than routing to a macro
    # index that means something else.
    rack = mapped_kit(2)
    for cell in cells(rack):
        param(cell, "Volume").is_enabled = True   # Live left this one free
    ok, _, _ = comp.write(rack, PATH, "gain", 0.25)
    assert ok
    assert all(macro(rack, i).writes == [] for i in range(17))
    for cell in cells(rack):
        assert param(cell, "Volume").writes == [pytest.approx(0.25)]


# --- the filter XY (2026-09-09) ---------------------------------------------


def test_filter_binds_by_name_on_every_class(comp):
    rack = make_rack([pad(36, drumcell()), pad(37, simpler()), pad(38, sampler())])
    st = comp._state_for(rack, PATH)
    # The switch is the amount's first member, as on oscAmount.
    assert [(m.cls, m.pname) for m in st.members["filterFreq"]] == [
        ("DrumCell", "Filter On"), ("DrumCell", "Filter Freq"),
        ("OriginalSimpler", "F On"), ("OriginalSimpler", "Filter Freq"),
        ("MultiSampler", "F On"), ("MultiSampler", "Filter Freq"),
    ]
    assert [(m.cls, m.pname) for m in st.members["filterRes"]] == [
        ("DrumCell", "Filter Res"),
        ("OriginalSimpler", "Filter Res"),
        ("MultiSampler", "Filter Res"),
    ]


def test_filter_resonance_spans_each_members_own_range(comp):
    # Measured on `FAT Kit`: a Simpler's `Filter Res` tops out at 1.25,
    # not the 1.0 the request assumed. The fan-out reads the member's own
    # max, so t=1 is that member's maximum whatever it happens to be.
    cell, simp = drumcell(), simpler()
    rack = make_rack([pad(36, cell), pad(37, simp)])
    param(cell, "Filter Res").value = 0.0
    param(simp, "Filter Res").value = 0.0
    ok, _, _ = comp.write(rack, PATH, "filterRes", 1.0)
    assert ok
    assert param(cell, "Filter Res").value == pytest.approx(1.0)
    assert param(simp, "Filter Res").value == pytest.approx(1.25)


def test_any_filter_write_turns_the_filter_on(comp):
    # The whole point of `switch_off_at_floor=False`: ANY write enables the
    # filter, including the first one and including one at the very floor
    # of the sweep — so the drag that moves cutoff is the same drag that
    # brings the filter out of bypass, and a pad that moved cutoff on a
    # bypassed filter never happens. (The pad is relative and suppresses
    # taps, so it is the first DRAG that does this, not the touch; the
    # user's call, 2026-09-09.)
    cell, simp, samp = drumcell(), simpler(), sampler()
    rack = make_rack([pad(36, cell), pad(37, simp), pad(38, samp)])
    for dev, switch in ((cell, "Filter On"), (simp, "F On"), (samp, "F On")):
        param(dev, switch).value = 0.0            # the filter starts bypassed
    ok, _, _ = comp.write(rack, PATH, "filterFreq", 0.0)   # touched at the floor
    assert ok
    for dev, switch in ((cell, "Filter On"), (simp, "F On"), (samp, "F On")):
        assert param(dev, switch).value == pytest.approx(1.0), dev.class_name


def test_filter_switch_turns_on_and_never_off(comp):
    # Cutoff at the floor with the filter ON is closed and silent; letting
    # the floor switch it OFF would open it wide instead, so the bottom of
    # the sweep would jump from silence to full.
    cell = drumcell()
    rack = make_rack([pad(36, cell)])
    param(cell, "Filter Freq").value = 0.5
    comp.write(rack, PATH, "filterFreq", 0.6)
    assert param(cell, "Filter On").value == pytest.approx(1.0)
    param(cell, "Filter On").writes.clear()
    comp.write(rack, PATH, "filterFreq", 0.0)   # all the way down
    assert param(cell, "Filter On").value == pytest.approx(1.0)
    assert 0.0 not in param(cell, "Filter On").writes


def test_filter_has_no_legacy_macro_on_a_mapped_family_kit(comp):
    # No pipeline macro ever drove a filter, so even on a still-mapped
    # family kit this fans out to the cells rather than routing to a macro
    # index that means something else.
    rack = mapped_kit(2)
    for cell in cells(rack):
        param(cell, "Filter Freq").is_enabled = True
        param(cell, "Filter On").is_enabled = True
    ok, _, _ = comp.write(rack, PATH, "filterFreq", 0.25)
    assert ok
    assert all(macro(rack, i).writes == [] for i in range(17))
    for cell in cells(rack):
        assert param(cell, "Filter Freq").writes == [pytest.approx(0.25)]


def test_mapped_kit_writes_only_the_legacy_macro(comp):
    rack = mapped_kit(3)
    ok, _, _ = comp.write(rack, PATH, "fx2", 0.25)
    assert ok
    assert macro(rack, 2).value == pytest.approx(31.75)
    assert macro(rack, 2).writes == [pytest.approx(31.75)]
    for cell in cells(rack):
        for p in cell.parameters:
            assert p.writes == []


def test_partially_mapped_kit_routes_per_function(comp):
    # Only macro 4 (Transpose) still mapped: pitch → macro, attack → cells.
    pads = [pad(36 + i, drumcell()) for i in range(2)]
    for p in pads:
        param(p.chains[0].devices[0], "Transpose").is_enabled = False
    rack = make_rack(pads, mapped_indices={4})
    comp.write(rack, PATH, "pitch", 12)
    comp.write(rack, PATH, "attack", 0.5)
    assert macro(rack, 4).value == pytest.approx((12 + 48) / 96 * 127)
    assert macro(rack, 9).writes == []
    for cell in cells(rack):
        assert param(cell, "Attack").value == pytest.approx(0.5)
        assert param(cell, "Transpose").writes == []


def test_non_family_rack_never_writes_a_macro(comp):
    # `32 Pad Kit Jazz`: macro 1 = Transpose (mapped), macro 2 = Release.
    names = ["Device On", "Transpose", "Release", "Macro 3", "Macro 4"] + ["Macro %d" % i for i in range(5, 17)]
    macros = family_macros(names=names, values={1: 63.5})
    rack = make_rack([pad(36, simpler(enabled=False)), pad(37, simpler(enabled=False))],
                     macros=macros, mapped_indices={1, 2})
    st = comp._state_for(rack, PATH)
    assert st.family is False
    comp.write(rack, PATH, "fx1", 0.9)   # legacy macro 1 == Jazz's Transpose: must not move
    comp.write(rack, PATH, "pitch", 7)   # members are macro-held → skipped, no raise
    assert macro(rack, 1).writes == []
    assert macro(rack, 2).writes == []
    for cell in cells(rack):
        assert param(cell, "Transpose").writes == []


# --- write rule -------------------------------------------------------------


def test_scaling_uses_each_members_own_range(comp):
    cell = drumcell()
    param(cell, "Attack").min = 10.0
    param(cell, "Attack").max = 20.0
    # Both pads sit at the same point of their own range, so neither
    # carries a deviation and the fan-out is pure range scaling. (A pad
    # left at 0.669 of a 10..20 range would read t=0 against the other's
    # t=0.669 — a real difference the kit keeps; see the deviation tests.)
    param(cell, "Attack").value = 16.69
    other = drumcell()
    rack = make_rack([pad(36, cell), pad(37, other)])
    comp.write(rack, PATH, "attack", 0.25)
    assert param(cell, "Attack").value == pytest.approx(12.5)
    assert param(other, "Attack").value == pytest.approx(0.25)


def test_two_state_switch_follows_measured_macro_threshold(comp):
    rack = unmapped_kit(1)
    cell = cells(rack)[0]
    comp.write(rack, PATH, "fx1", 0.0)
    assert param(cell, "FX On").value == 0
    comp.write(rack, PATH, "fx1", TOGGLE_ON_ABOVE_T * 0.5)
    assert param(cell, "FX On").value == 0
    comp.write(rack, PATH, "fx1", TOGGLE_ON_ABOVE_T * 1.5)
    assert param(cell, "FX On").value == 1
    assert param(cell, "Pitch Env Amt").value == pytest.approx(TOGGLE_ON_ABOVE_T * 1.5)
    comp.write(rack, PATH, "fx1", 1.0)
    assert param(cell, "FX On").value == 1
    for name in FX1_MEMBERS[1:]:
        assert param(cell, name).value == pytest.approx(1.0)


def test_fx_type_is_written_as_an_int(comp):
    rack = unmapped_kit(2)
    ok, stored, _ = comp.write(rack, PATH, "fxType", 3.4)
    assert ok and stored == 3 and isinstance(stored, int)
    for cell in cells(rack):
        v = param(cell, "FX Type").value
        assert v == 3 and isinstance(v, int)
    ok, stored, _ = comp.write(rack, PATH, "fxType", 11)
    assert stored == FX_TYPE_MAX


def test_fx_type_on_mapped_kit_uses_macro_travel(comp):
    rack = mapped_kit(1)
    comp.write(rack, PATH, "fxType", 3)
    assert macro(rack, 3).value == pytest.approx(3 / 8 * 127)


def test_pitch_is_whole_semitones_clamped(comp):
    rack = unmapped_kit(2)
    ok, stored, _ = comp.write(rack, PATH, "pitch", 12.4)
    assert ok and stored == 12 and isinstance(stored, int)
    for cell in cells(rack):
        assert param(cell, "Transpose").value == 12
    assert comp.write(rack, PATH, "pitch", 60)[1] == PITCH_MAX
    assert comp.write(rack, PATH, "pitch", -60)[1] == PITCH_MIN
    for cell in cells(rack):
        assert param(cell, "Transpose").value == PITCH_MIN


def test_pitch_on_mapped_kit_writes_macro_units(comp):
    rack = mapped_kit(1)
    comp.write(rack, PATH, "pitch", 12)
    assert macro(rack, 4).value == pytest.approx(79.375)
    comp.write(rack, PATH, "pitch", 0)
    assert macro(rack, 4).value == pytest.approx(63.5)


def test_t_values_are_clamped(comp):
    rack = unmapped_kit(1)
    assert comp.write(rack, PATH, "start", 1.7)[1] == 1.0
    assert comp.write(rack, PATH, "start", -0.2)[1] == 0.0
    assert param(cells(rack)[0], "Start").value == 0.0


def test_bad_values_are_rejected(comp):
    rack = unmapped_kit(1)
    assert comp.write(rack, PATH, "fx1", "abc")[0] is False
    assert comp.write(rack, PATH, "fx1", float("nan"))[0] is False
    assert comp.write(rack, PATH, "nope", 0.5)[0] is False
    assert all(p.writes == [] for cell in cells(rack) for p in cell.parameters)


def test_disabled_member_is_skipped_without_raise(comp):
    a, b = drumcell(), drumcell()
    param(b, "Attack").is_enabled = False
    rack = make_rack([pad(36, a), pad(37, b)])
    comp.write(rack, PATH, "attack", 0.7)
    assert param(a, "Attack").value == pytest.approx(0.7)
    assert param(b, "Attack").writes == []


def test_refused_write_marks_member_disabled_and_reresolves(comp):
    a, b = drumcell(), drumcell()
    rack = make_rack([pad(36, a), pad(37, b)])
    comp._state_for(rack, PATH)                       # snapshot: both enabled
    param(b, "Decay").is_enabled = False               # Live maps a macro underneath us
    comp.write(rack, PATH, "decay", 0.3)               # raises inside → caught
    assert param(a, "Decay").value == pytest.approx(0.3)
    assert comp._states[PATH].dirty is True
    comp.write(rack, PATH, "decay", 0.4)               # re-resolved: b skipped cleanly
    assert param(a, "Decay").value == pytest.approx(0.4)
    assert comp._states[PATH].dirty is False


# --- seeding ----------------------------------------------------------------


def test_seed_unmapped_from_first_continuous_member(comp):
    first = drumcell(values={
        "FX On": 1.0, "Pitch Env Amt": 0.3, "Pitch Env Decay": 0.8,
        "Attack": 0.1, "Decay": 0.9, "Start": 0.2, "FX Type": 5, "Transpose": 12.0,
    })
    rack = make_rack([pad(36, first), pad(37, drumcell())])
    assert comp.read(rack, PATH, "fx1") == pytest.approx(0.3)     # not FX On (quantized)
    assert comp.read(rack, PATH, "fx2") == pytest.approx(0.8)
    assert comp.read(rack, PATH, "attack") == pytest.approx(0.1)
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.9)
    assert comp.read(rack, PATH, "start") == pytest.approx(0.2)
    assert comp.read(rack, PATH, "fxType") == 5
    assert comp.read(rack, PATH, "pitch") == 12
    assert isinstance(comp.read(rack, PATH, "pitch"), int)


def test_seed_mapped_from_legacy_macro(comp):
    rack = make_rack([pad(36, drumcell(enabled=False))], mapped=True,
                     macros=family_macros(values={1: 0.0, 2: 63.5, 3: 47.625, 4: 80.0, 9: 85.0}))
    assert comp.read(rack, PATH, "fx1") == pytest.approx(0.0)
    assert comp.read(rack, PATH, "fx2") == pytest.approx(0.5)
    assert comp.read(rack, PATH, "fxType") == 3
    assert comp.read(rack, PATH, "pitch") == 12          # 80/127·96 − 48 = 12.47 → 12
    assert comp.read(rack, PATH, "attack") == pytest.approx(85 / 127)


def test_seed_is_none_on_a_rack_without_members(comp):
    rack = make_rack([])
    assert comp.read(rack, PATH, "pitch") is None
    assert comp.read(rack, PATH, "fx1") is None


def test_read_retries_when_pads_populate_after_subscribe(comp):
    rack = make_rack([])
    comp.subscribe(rack, PATH, "pitch")
    assert comp.read(rack, PATH, "pitch") is None
    rack.drum_pads[36] = pad(36, drumcell(values={"Transpose": -5.0}))
    assert comp.read(rack, PATH, "pitch") == -5


def test_read_returns_held_value_after_write(comp):
    rack = unmapped_kit(1)
    comp.write(rack, PATH, "fx1", 0.42)
    assert comp.read(rack, PATH, "fx1") == pytest.approx(0.42)


# --- PropertyComponent lane -------------------------------------------------


@pytest.fixture
def generation():
    g = GenerationComponent()
    g.advance("test")
    return g


def property_component(rack, emits, generation, providers=None):
    song = StubSong(tracks=[StubTrack(tid=100, devices=[rack])])
    pc = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
        computed_providers=providers,
    )
    pc.set_generation(generation)
    return song, pc


def values(emits, name):
    return [args for a, args in emits if a == V3_PROPERTY_VALUE_ADDRESS and args[1] == name]


def errors(emits):
    return [args for a, args in emits if a == V3_ERROR_ADDRESS]


def test_subscribe_cold_reads_the_seeded_value(comp, emits, generation):
    rack = make_rack([pad(36, drumcell(values={"Transpose": 7.0}))])
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_subscribe(args=(PATH, "vm.pitch"), source_addr=None)
    assert values(emits, "vm.pitch") == [(PATH, "vm.pitch", 7)]
    assert (PATH, "vm.pitch") in pc._subscriptions
    assert comp._states[PATH].subscribed == {"pitch"}
    assert rack.listener_count() == 4


def test_set_applies_and_echoes_the_stored_value(comp, emits, generation):
    rack = unmapped_kit(2)
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_set(args=(PATH, "vm.attack", 0.7, generation.current), source_addr=None)
    for cell in cells(rack):
        assert param(cell, "Attack").value == pytest.approx(0.7)
    assert values(emits, "vm.attack") == [(PATH, "vm.attack", pytest.approx(0.7))]
    assert errors(emits) == []


def test_set_echo_carries_the_clamped_int(comp, emits, generation):
    rack = unmapped_kit(1)
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_set(args=(PATH, "vm.pitch", 12.4, generation.current), source_addr=None)
    pc.handle_set(args=(PATH, "vm.fxType", 2.6, generation.current), source_addr=None)
    assert values(emits, "vm.pitch") == [(PATH, "vm.pitch", 12)]
    assert values(emits, "vm.fxType") == [(PATH, "vm.fxType", 3)]
    assert isinstance(values(emits, "vm.pitch")[0][2], int)


def test_set_bad_value_rejects(comp, emits, generation):
    rack = unmapped_kit(1)
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_set(args=(PATH, "vm.pitch", "x", generation.current), source_addr=None)
    err = errors(emits)
    assert len(err) == 1
    assert err[0][0] == V3_PROPERTY_SET_ADDRESS
    assert err[0][1] == V3_ERROR_WRITE_REJECTED
    assert "bad value" in err[0][4]
    assert values(emits, "vm.pitch") == []


def test_missing_provider_rejects_loudly(emits, generation):
    rack = unmapped_kit(1)
    _song, pc = property_component(rack, emits, generation, providers=None)
    pc.handle_subscribe(args=(PATH, "vm.pitch"), source_addr=None)
    pc.handle_set(args=(PATH, "vm.pitch", 1, generation.current), source_addr=None)
    err = errors(emits)
    assert [e[0] for e in err] == [V3_PROPERTY_SUBSCRIBE_ADDRESS, V3_PROPERTY_SET_ADDRESS]
    assert all(e[4] == V3_ERROR_DETAIL_COMPUTED_PROVIDER_MISSING for e in err)
    assert (PATH, "vm.pitch") not in pc._subscriptions


def test_unsubscribe_of_last_function_releases_the_state(comp, emits, generation):
    rack = unmapped_kit(1)
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_subscribe(args=(PATH, "vm.fx1"), source_addr=None)
    pc.handle_subscribe(args=(PATH, "vm.fx2"), source_addr=None)
    pc.handle_unsubscribe(args=(PATH, "vm.fx1"), source_addr=None)
    assert PATH in comp._states
    pc.handle_unsubscribe(args=(PATH, "vm.fx2"), source_addr=None)
    assert PATH not in comp._states
    assert rack.listener_count() == 0
    assert pc._subscriptions == {}


def test_structural_invalidate_rebinds_a_replaced_rack(comp, emits, generation):
    """Loading a kit preset over another one — a DrumCell Drum Rack
    replaced by a Sampler Drum Rack, say — leaves a different rack at the
    same path.

    The census subscription follows it. Releasing it instead left the
    view rendering the *old* kit indefinitely: same class and same path,
    so the UI's ``$effect`` never re-ran and nothing on its side ever
    re-subscribed, while the surface had already let its half go.
    """
    rack = make_rack([pad(36, drumcell(values={"Transpose": 7.0}))])
    song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_subscribe(args=(PATH, "vm.pitch"), source_addr=None)
    new_rack = make_rack([pad(36, drumcell(values={"Transpose": -3.0}))])
    song._tracks[0].set_devices([new_rack])
    emits.clear()

    pc.on_structural_invalidate()

    # The subscription survived, and it is the new rack's now.
    assert (PATH, "vm.pitch") in pc._subscriptions
    assert comp._states[PATH].device is new_rack
    assert new_rack.listener_count() > 0
    # The rack it replaced is fully let go — no listeners on a dead handle.
    assert rack.listener_count() == 0
    # And the UI is told the new kit's value, not left holding the old.
    assert values(emits, "vm.pitch") == [(PATH, "vm.pitch", -3)]


def test_state_rebuilds_when_a_different_rack_lands_on_the_path(comp):
    old = unmapped_kit(1)
    comp.write(old, PATH, "pitch", 5)
    new = make_rack([pad(36, drumcell(values={"Transpose": -3.0}))])
    assert comp.read(new, PATH, "pitch") == -3          # seeded from the new kit, not the held 5
    assert old.listener_count() == 0
    assert new.listener_count() == 4


# --- deferred apply / flush -------------------------------------------------


def test_deferred_apply_coalesces_to_the_latest_value(comp):
    rack = unmapped_kit(3)
    comp.enable_deferred_apply()
    assert comp.write(rack, PATH, "fx1", 0.2) == (True, 0.2, "")
    assert comp.write(rack, PATH, "fx1", 0.9) == (True, 0.9, "")
    assert comp.write(rack, PATH, "pitch", 3)[0]
    assert all(p.writes == [] for cell in cells(rack) for p in cell.parameters)
    assert comp.read(rack, PATH, "fx1") == pytest.approx(0.9)   # held value is already the latest
    assert comp.flush() == 2
    for cell in cells(rack):
        assert param(cell, "Pitch Env Amt").writes == [pytest.approx(0.9)]
        assert param(cell, "Transpose").writes == [3]
    assert comp.flush() == 0


def test_flush_survives_a_raising_rack(comp):
    rack = unmapped_kit(1)

    class Exploding:
        class_name = "DrumGroupDevice"

        def __getattr__(self, name):
            raise RuntimeError("gone")

    comp.enable_deferred_apply()
    comp._pending[("tracks/9/devices/0", "fx1")] = (Exploding(), 0.5)
    comp.write(rack, PATH, "attack", 0.6)
    assert comp.flush() == 1
    assert param(cells(rack)[0], "Attack").value == pytest.approx(0.6)


# --- change listeners -------------------------------------------------------


def test_chains_change_reseeds_and_emits_subscribed_functions(comp, emits):
    rack = make_rack([])
    comp.subscribe(rack, PATH, "pitch")
    comp.subscribe(rack, PATH, "fx1")
    assert comp.read(rack, PATH, "pitch") is None
    rack.drum_pads[36] = pad(36, drumcell(values={"Transpose": 4.0, "Pitch Env Amt": 0.25}))
    rack.fire("chains")   # no schedule_delayed wired → inline
    assert values(emits, "vm.pitch") == [(PATH, "vm.pitch", 4)]
    assert values(emits, "vm.fx1") == [(PATH, "vm.fx1", pytest.approx(0.25))]


def test_reseed_keeps_values_the_surface_already_holds(comp, emits):
    rack = unmapped_kit(1)
    comp.subscribe(rack, PATH, "pitch")
    comp.write(rack, PATH, "pitch", 7)
    rack.drum_pads[40] = pad(40, drumcell(values={"Transpose": 0.0}))
    rack.fire("drum_pads")
    assert values(emits, "vm.pitch")[-1] == (PATH, "vm.pitch", 7)
    assert len(comp._states[PATH].members["pitch"]) == 2


def test_macros_mapped_change_reroutes_the_next_write(comp):
    rack = unmapped_kit(2)
    comp.write(rack, PATH, "attack", 0.5)
    for cell in cells(rack):
        param(cell, "Attack").is_enabled = False       # Live mapped macro 9 underneath us
    rack.macros_mapped = tuple(i == 8 for i in range(16))
    rack.fire("macros_mapped")
    comp.write(rack, PATH, "attack", 0.3)
    assert macro(rack, 9).value == pytest.approx(0.3 * 127)
    for cell in cells(rack):
        assert param(cell, "Attack").writes == [pytest.approx(0.5)]


def test_change_listener_defers_through_schedule_delayed(emits):
    scheduled = []
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    rack = make_rack([])
    comp.subscribe(rack, PATH, "decay")
    rack.fire("chains")
    rack.fire("chains")            # coalesced: one pending re-seed
    assert [ms for ms, _ in scheduled] == [RESEED_DELAY_MS]
    assert values(emits, "vm.decay") == []
    rack.drum_pads[36] = pad(36, drumcell(values={"Decay": 0.35}))
    scheduled[0][1]()
    assert values(emits, "vm.decay") == [(PATH, "vm.decay", pytest.approx(0.35))]
    rack.fire("chains")            # a new fire after the flush schedules again
    assert len(scheduled) == 2


def test_disconnect_detaches_and_refuses_writes(comp):
    rack = unmapped_kit(1)
    comp.subscribe(rack, PATH, "pitch")
    comp.disconnect()
    assert rack.listener_count() == 0
    assert comp.write(rack, PATH, "pitch", 1) == (False, None, "disconnected")
    assert comp.read(rack, PATH, "pitch") is None


def test_pitch_offsets_hook_adds_per_note(comp):
    """The per-pad model: the fan-out adds each pad's offset and clamps
    (the offsets have no UI yet; a future milestone edits them)."""
    rack = unmapped_kit(2)
    st = comp._state_for(rack, PATH)
    st.pads[37].offset = 5
    comp.write(rack, PATH, "pitch", 46)
    a, b = cells(rack)
    assert param(a, "Transpose").value == 46
    assert param(b, "Transpose").value == 48       # 46 + 5 clamped


def test_toggle_threshold_matches_the_measurement():
    # 1.0 of 127 → off, 1.2 of 127 → on (rig, 2026-09-07).
    assert math.isclose(TOGGLE_ON_ABOVE_T, 1.0 / 127.0)
    assert not (1.0 / 127.0 > TOGGLE_ON_ABOVE_T)
    assert 1.2 / 127.0 > TOGGLE_ON_ABOVE_T


# --- gesture undo step (measured: Live records one step per parameter) -----



def test_flush_wraps_a_pass_in_one_undo_step_when_no_scheduler(emits):
    song = FakeSong()
    comp = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)), song=song)
    rack = unmapped_kit(2)
    comp.write(rack, PATH, "attack", 0.3)       # inline flush
    comp.write(rack, PATH, "decay", 0.4)
    assert (song.begins, song.ends) == (2, 2)   # balanced: one step per flush


def test_gesture_keeps_one_undo_step_open_across_passes(emits):
    song = FakeSong()
    scheduled = []
    now = [100.0]
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
        song=song,
    )
    comp._clock = lambda: now[0]
    comp.enable_deferred_apply()
    rack = unmapped_kit(2)

    comp.write(rack, PATH, "attack", 0.1); comp.flush()      # tick 1: opens the step
    assert (song.begins, song.ends) == (1, 0)
    assert [ms for ms, _ in scheduled] == [RESEED_DELAY_MS * 2]  # 300 ms close armed

    now[0] += 0.2
    comp.write(rack, PATH, "attack", 0.2); comp.flush()      # tick 2: same step, deadline moves
    assert (song.begins, song.ends) == (1, 0)
    assert len(scheduled) == 1                                # no second timer

    now[0] += 0.15                                            # 350 ms after tick 1, 150 after tick 2
    scheduled[0][1]()                                         # timer fires: deadline not reached → re-arms
    assert song.ends == 0
    assert len(scheduled) == 2 and 100 <= scheduled[1][0] <= 200

    now[0] += 0.2                                             # idle window passed
    scheduled[1][1]()
    assert (song.begins, song.ends) == (1, 1)                 # the gesture closed as one step

    comp.write(rack, PATH, "attack", 0.9); comp.flush()      # a new gesture opens a new step
    assert (song.begins, song.ends) == (2, 1)


def test_disconnect_closes_an_open_undo_step(emits):
    song = FakeSong()
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: None, song=song,
    )
    comp.enable_deferred_apply()
    rack = unmapped_kit(1)
    comp.write(rack, PATH, "pitch", 2); comp.flush()
    assert (song.begins, song.ends) == (1, 0)
    comp.disconnect()
    assert (song.begins, song.ends) == (1, 1)


def test_undo_step_raises_are_logged_not_fatal(emits):
    song = FakeSong(raise_on={"begin"})
    comp = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)), song=song)
    rack = unmapped_kit(1)
    assert comp.write(rack, PATH, "start", 0.5)[0]
    assert param(cells(rack)[0], "Start").value == pytest.approx(0.5)
    assert (song.begins, song.ends) == (0, 0)
    song2 = FakeSong(raise_on={"end"})
    comp2 = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)), song=song2)
    assert comp2.write(rack, PATH, "start", 0.6)[0]
    assert (song2.begins, song2.ends) == (1, 0)
    assert comp2._undo_open is False


def test_empty_flush_opens_no_undo_step(emits):
    song = FakeSong()
    comp = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)), song=song)
    comp.enable_deferred_apply()
    assert comp.flush() == 0
    assert (song.begins, song.ends) == (0, 0)


# --- vm.members census (Milestone 1b) ----------------------------------------


def members(comp, rack):
    raw = comp.read(rack, PATH, MEMBERS_KEY)
    assert isinstance(raw, str)
    return json.loads(raw)


def test_members_row_is_allowlisted_read_only():
    spec = ALLOWLIST[("DrumGroupDevice", MEMBERS_PROPERTY)]
    assert spec.computed == PROVIDER_NAME
    assert spec.writable is False
    assert spec.attr_name == MEMBERS_KEY
    assert MEMBERS_PROPERTY == "vm.members"
    assert MEMBERS_PROPERTY not in PROPERTY_NAMES
    assert function_for_property(MEMBERS_PROPERTY) is None


def test_members_census_on_a_drumcell_kit(comp):
    rack = unmapped_kit(3)
    m = members(comp, rack)
    assert m["padCount"] == 3
    assert m["padClasses"] == {"DrumCell": 3}
    assert m["hasMacroMappings"] is False
    assert m["family"] is True
    assert m["functions"] == {
        "fx1": {"members": 30, "held": 0}, "fx2": {"members": 27, "held": 0},
        "fxType": {"members": 3, "held": 0}, "pitch": {"members": 3, "held": 0},
        "attack": {"members": 3, "held": 0}, "decay": {"members": 3, "held": 0},
        "start": {"members": 3, "held": 0}, "release": {"members": 0, "held": 0},
        "oscAmount": {"members": 0, "held": 0}, "oscCoarse": {"members": 0, "held": 0},
        "pitchEnvAmount": {"members": 0, "held": 0}, "pitchEnvAttack": {"members": 0, "held": 0},
        "sustain": {"members": 0, "held": 0}, "spread": {"members": 0, "held": 0},
        "filterFreq": {"members": 6, "held": 0}, "filterRes": {"members": 3, "held": 0},
        "gain": {"members": 3, "held": 0},
    }


def test_members_census_on_a_mapped_jazz_shaped_kit(comp):
    # `32 Pad Kit Jazz`: Simplers (one with an Eq8 after it), one Sampler,
    # macro 1 = Transpose (mapped), macro 2 = Release (mapped) → every
    # pad's Transpose is macro-held; Start has no Sampler member; no FX.
    names = ["Device On", "Transpose", "Release"] + ["Macro %d" % i for i in range(3, 17)]
    s1, s2, smp = simpler(), simpler(), sampler()
    for dev in (s1, s2, smp):
        param(dev, "Transpose").is_enabled = False
    rack = make_rack([pad(36, s1, eq8()), pad(37, s2), pad(38, smp)],
                     macros=family_macros(names=names), mapped_indices={1, 2})
    m = members(comp, rack)
    assert m["padCount"] == 3
    assert m["padClasses"] == {"OriginalSimpler": 2, "MultiSampler": 1}
    assert m["hasMacroMappings"] is True
    # One flag per macro, as Live reports it: the view draws a slider for
    # each mapped one, whatever it is named.
    assert m["mappedMacros"] == [1, 2]
    assert m["family"] is False
    f = m["functions"]
    assert f["pitch"] == {"members": 3, "held": 3}
    assert f["attack"] == {"members": 3, "held": 0}
    assert f["decay"] == {"members": 3, "held": 0}
    assert f["start"] == {"members": 2, "held": 0}
    assert f["fx1"] == f["fx2"] == f["fxType"] == {"members": 0, "held": 0}


def test_members_census_counts_plugin_and_nested_rack_pads(comp):
    def plugin():
        return FakeDevice("AuPluginDevice", [FakeParam("Custom E", 64.0, 0, 127)],
                          name="Komplete Kontrol")
    nested = FakeDevice("InstrumentGroupDevice", [FakeParam("Macro 1", 0.0, 0, 127)])
    operator = FakeDevice("Operator", [FakeParam("Transpose", 0.0, -48, 48)])
    rack = make_rack([
        pad(36, plugin()), pad(37, plugin()), pad(38, nested), pad(39, operator),
        pad(40, eq8()),          # an effect-only chain: populated, no instrument
    ])
    m = members(comp, rack)
    assert m["padCount"] == 5
    assert m["padClasses"] == {"AuPluginDevice": 2, "InstrumentGroupDevice": 1, "Operator": 1}
    # Nothing here binds a fixed function — except the nested rack's own
    # chain volume, which is always a `gain` member (2026-09-08). A
    # plugin pad has no chain-volume member: `gain` is a nested-rack
    # fallback, not a universal one.
    assert all(v == {"members": 0, "held": 0} for k, v in m["functions"].items() if k != "gain")
    assert m["functions"]["gain"] == {"members": 1, "held": 0}


def test_members_census_on_an_empty_rack(comp):
    m = members(comp, make_rack([]))
    assert m["padCount"] == 0 and m["padClasses"] == {}
    assert all(v == {"members": 0, "held": 0} for v in m["functions"].values())


def test_members_held_follows_macros_mapped(comp, emits):
    rack = mapped_kit(2)
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    m = members(comp, rack)
    assert m["hasMacroMappings"] is True
    assert m["functions"]["pitch"] == {"members": 2, "held": 2}
    assert m["functions"]["fx1"] == {"members": 20, "held": 20}
    # Live unmaps the kit underneath us: every parameter re-enables and
    # macros_mapped fires → the census re-emits with nothing held.
    for cell in cells(rack):
        for p in cell.parameters:
            p.is_enabled = True
    rack.macros_mapped = (False,) * 16
    rack.fire("macros_mapped")   # no scheduler → inline re-seed + re-emit
    emitted = values(emits, MEMBERS_PROPERTY)
    assert len(emitted) == 1
    m2 = json.loads(emitted[0][2])
    assert m2["hasMacroMappings"] is False
    assert m2["mappedMacros"] == []
    assert m2["functions"]["pitch"] == {"members": 2, "held": 0}
    assert m2["functions"]["fx1"] == {"members": 20, "held": 0}


def test_members_reemits_when_pads_populate(comp, emits):
    rack = make_rack([])
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    comp.subscribe(rack, PATH, "pitch")
    assert members(comp, rack)["padCount"] == 0
    rack.drum_pads[36] = pad(36, drumcell(values={"Transpose": 3.0}))
    rack.fire("chains")
    assert json.loads(values(emits, MEMBERS_PROPERTY)[-1][2])["padCount"] == 1
    assert values(emits, "vm.pitch")[-1] == (PATH, "vm.pitch", 3)


def test_members_stays_under_the_datagram_on_a_full_kit(comp):
    # 92 playable pads, each with a name at the cap: the pad list is the
    # bulk of the census now, and it has to fit darwin's 9,216 B datagram.
    rack = make_rack([
        pad(36 + i, drumcell()) for i in range(92)
    ])
    for p in rack.drum_pads:
        if p.chains:
            p.chains[0].devices[0].name = "Kick Plastic 90s Heavy Rock Long"   # 32 chars → capped at 24
    raw = comp.read(rack, PATH, MEMBERS_KEY)
    assert len(raw.encode("utf-8")) < 9216
    pads = json.loads(raw)["pads"]
    assert len(pads) == 92 and pads[0] == {"note": 36, "name": "Kick Plastic 90s Heavy R", "class": "DrumCell", "color": None}


def test_members_drops_pad_names_past_the_soft_cap(comp):
    # 128 named pads would pass the soft cap: names go, notes and classes stay.
    rack = make_rack([pad(i, drumcell()) for i in range(128)])
    for p in rack.drum_pads:
        p.chains[0].devices[0].name = "Snare Stick Hit Number 3"
    raw = comp.read(rack, PATH, MEMBERS_KEY)
    assert len(raw.encode("utf-8")) < 9216
    pads = json.loads(raw)["pads"]
    assert len(pads) == 128 and pads[0] == {"note": 0, "class": "DrumCell", "color": None}


def test_members_write_is_refused(comp):
    rack = unmapped_kit(1)
    ok, stored, detail = comp.write(rack, PATH, MEMBERS_KEY, "{}")
    assert (ok, stored) == (False, None) and "read-only" in detail


def test_members_on_the_channel_cold_reads_and_rejects_writes(comp, emits, generation):
    rack = make_rack([pad(36, simpler()), pad(37, sampler())])
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_subscribe(args=(PATH, MEMBERS_PROPERTY), source_addr=None)
    got = values(emits, MEMBERS_PROPERTY)
    assert len(got) == 1
    assert json.loads(got[0][2])["padClasses"] == {"OriginalSimpler": 1, "MultiSampler": 1}
    assert comp._states[PATH].subscribed == {MEMBERS_KEY}
    pc.handle_set(args=(PATH, MEMBERS_PROPERTY, "{}", generation.current), source_addr=None)
    err = errors(emits)
    assert len(err) == 1 and err[0][4] == V3_ERROR_DETAIL_PROPERTY_READ_ONLY
    pc.handle_unsubscribe(args=(PATH, MEMBERS_PROPERTY), source_addr=None)
    assert PATH not in comp._states


# --- sequencer shift term (permute ADR-020) ----------------------------------------


def test_sequencer_shift_rides_the_fan_out_and_hides_from_the_global(comp):
    rack = unmapped_kit(2)
    comp.write(rack, PATH, "pitch", 5)
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    for cell in cells(rack):
        assert param(cell, "Transpose").value == 17
    assert comp.read(rack, PATH, "pitch") == 5          # the UI never sees the term
    assert comp.sequencer_shift(PATH) == 12
    assert comp.set_sequencer_shift(rack, PATH, 12) is False   # unchanged → no write
    comp.write(rack, PATH, "pitch", 10)                 # a user move while shifted
    for cell in cells(rack):
        assert param(cell, "Transpose").value == 22
    assert comp.set_sequencer_shift(rack, PATH, 0) is True
    for cell in cells(rack):
        assert param(cell, "Transpose").value == 10
    assert comp.sequencer_shift(PATH) == 0


def test_sequencer_shift_clamps_at_the_rail(comp):
    rack = unmapped_kit(1)
    comp.write(rack, PATH, "pitch", 40)
    comp.set_sequencer_shift(rack, PATH, 12)
    assert param(cells(rack)[0], "Transpose").value == 48
    comp.set_sequencer_shift(rack, PATH, 0)
    assert param(cells(rack)[0], "Transpose").value == 40


def test_sequencer_shift_on_a_mapped_family_kit_goes_through_the_macro(comp):
    rack = mapped_kit(1)
    comp.write(rack, PATH, "pitch", 0)
    comp.set_sequencer_shift(rack, PATH, 12)
    assert macro(rack, 4).value == pytest.approx(79.375)   # +12 st in macro units
    assert comp.read(rack, PATH, "pitch") == 0
    comp.set_sequencer_shift(rack, PATH, 0)
    assert macro(rack, 4).value == pytest.approx(63.5)


def test_sequencer_shift_is_its_own_undo_step_unless_a_gesture_is_open(emits):
    song = FakeSong()
    comp = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)), song=song)
    rack = unmapped_kit(2)
    comp.set_sequencer_shift(rack, PATH, 12)
    assert (song.begins, song.ends) == (1, 1)
    comp.set_sequencer_shift(rack, PATH, 0)
    assert (song.begins, song.ends) == (2, 2)


def test_sequencer_shift_rides_an_open_gesture_step(emits):
    pending = []
    song = FakeSong()
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: pending.append(fn), song=song,
    )
    rack = unmapped_kit(1)
    comp.write(rack, PATH, "attack", 0.5)          # opens the gesture step (scheduler present)
    assert (song.begins, song.ends) == (1, 0)
    comp.set_sequencer_shift(rack, PATH, 12)
    assert (song.begins, song.ends) == (1, 0)      # no second step opened
    assert param(cells(rack)[0], "Transpose").value == 12
    comp.disconnect()
    assert (song.begins, song.ends) == (1, 1)


def test_unsubscribe_keeps_a_shifted_rack_alive(comp):
    rack = unmapped_kit(1)
    comp.subscribe(rack, PATH, "pitch")
    comp.set_sequencer_shift(rack, PATH, 12)
    comp.unsubscribe(PATH, "pitch")
    assert comp.sequencer_shift(PATH) == 12          # state kept: the engine still owns a write
    assert rack.listener_count() == 4
    comp.set_sequencer_shift(rack, PATH, 0)
    comp.subscribe(rack, PATH, "pitch")
    comp.unsubscribe(PATH, "pitch")
    assert rack.listener_count() == 0                # released once the term is gone


def test_reseed_while_shifted_keeps_the_global(comp):
    rack = unmapped_kit(2)
    comp.subscribe(rack, PATH, "pitch")
    comp.write(rack, PATH, "pitch", 5)
    comp.set_sequencer_shift(rack, PATH, 12)
    st = comp._state_for(rack, PATH)
    st.values.pop("pitch")                           # force a re-seed from the members
    rack.fire("drum_pads")                           # no scheduler → inline re-seed
    assert comp.read(rack, PATH, "pitch") == 5       # 17 on the members, minus the term
    for cell in cells(rack):
        assert param(cell, "Transpose").value == 17


def test_sequencer_shift_after_disconnect_is_refused(comp):
    rack = unmapped_kit(1)
    comp.disconnect()
    assert comp.set_sequencer_shift(rack, PATH, 12) is False


# --- per-pad offsets seeded from the kit (2026-09-07) --------------------------------


def tuned_kit(*transposes):
    return make_rack([pad(36 + i, drumcell(values={"Transpose": float(t)})) for i, t in enumerate(transposes)], mapped=False)


def transposes(rack):
    return [param(c, "Transpose").value for c in cells(rack)]


def test_offsets_seed_from_the_kits_own_tuning(comp):
    rack = tuned_kit(0, 3, -5)
    assert comp.read(rack, PATH, "pitch") == 0            # the first member is the global
    comp.write(rack, PATH, "pitch", 2)
    assert transposes(rack) == [2, 5, -3]                 # every pad moved by the same amount
    comp.set_sequencer_shift(rack, PATH, 12)
    assert transposes(rack) == [14, 17, 9]                # 2 + 12 + (0, 3, -5)
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [2, 5, -3]
    assert comp.read(rack, PATH, "pitch") == 2


def test_offsets_adopt_a_pad_edit_made_in_lives_pad_view(comp):
    rack = tuned_kit(0, 0)
    comp.write(rack, PATH, "pitch", 2)
    assert transposes(rack) == [2, 2]
    param(cells(rack)[1], "Transpose").value = 10          # the user tunes the snare in Live
    comp.write(rack, PATH, "pitch", 4)
    assert transposes(rack) == [4, 12]                    # the edit survives the slider
    comp.set_sequencer_shift(rack, PATH, 12)
    assert transposes(rack) == [16, 24]
    param(cells(rack)[0], "Transpose").value = 20          # edited while shifted: +4
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [8, 12]                    # home moved by the same +4
    assert comp.read(rack, PATH, "pitch") == 4            # the global is untouched


def test_offsets_clamp_at_the_rail_without_losing_the_offset(comp):
    rack = tuned_kit(0, 40)
    comp.write(rack, PATH, "pitch", 5)
    assert transposes(rack) == [5, 45]
    comp.set_sequencer_shift(rack, PATH, 12)
    assert transposes(rack) == [17, 48]
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [5, 45]


def test_a_pad_added_after_seeding_keeps_its_pitch_until_the_next_move(comp):
    rack = tuned_kit(0)
    comp.subscribe(rack, PATH, "pitch")
    comp.write(rack, PATH, "pitch", 3)
    rack.drum_pads[40] = pad(40, drumcell(values={"Transpose": -7.0}))
    rack.fire("drum_pads")                                # inline re-seed, pitch keeps its value
    comp.write(rack, PATH, "pitch", 3)
    assert transposes(rack) == [3, -7]                    # first seen: adopts its pitch
    comp.write(rack, PATH, "pitch", 5)
    assert transposes(rack) == [5, -5]


def test_offsets_are_not_seeded_on_a_mapped_family_kit(comp):
    rack = mapped_kit(2)
    st = comp._state_for(rack, PATH)
    assert st.pads == {}
    assert comp.debug_state(PATH)["offsets"] == {} and comp.debug_state(PATH)["written"] == {}
    comp.write(rack, PATH, "pitch", 12)
    assert macro(rack, 4).value == pytest.approx(79.375)


def test_a_stale_read_back_is_not_a_user_edit(comp):
    """A pad that reads what it held BEFORE our last write is our write
    still landing (rig, 2026-09-07), not an edit; folding it in walked the
    offsets away by the shift on every step."""
    class Lagging(FakeParam):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.lag = False
            self._shown = self._value

        @property
        def value(self):
            return self._shown if self.lag else self._value

        @value.setter
        def value(self, v):
            self._shown = self._value        # the read-back shows the previous value
            FakeParam.value.fset(self, v)

    cell = FakeDevice("DrumCell", [FakeParam("Device On", 1.0, 0, 1, quantized=True), Lagging("Transpose", 0.0, -48.0, 48.0)])
    rack = make_rack([FakePad(36, [FakeChain([cell])])], mapped=False)
    tr = param(cell, "Transpose")
    comp.write(rack, PATH, "pitch", 2)
    assert tr._value == 2
    tr.lag = True
    comp.set_sequencer_shift(rack, PATH, 12)         # reads 2 (stale), expected 2 → fine
    assert tr._value == 14
    comp.set_sequencer_shift(rack, PATH, 0)          # reads 2 (stale), expected 14, prev 2 → not an edit
    assert tr._value == 2
    comp.set_sequencer_shift(rack, PATH, 12)         # reads 14 (stale), expected 2, prev 14 → not an edit
    assert tr._value == 14
    tr.lag = False
    tr.value = 20                                    # a real edit while shifted (+6)
    comp.set_sequencer_shift(rack, PATH, 0)
    assert tr._value == 8
    st = comp._state_for(rack, PATH)
    assert comp.debug_state(PATH)["offsets"] == {"36": 6} and st.values["pitch"] == 2


# --- review fixes (2026-09-07): kit moves, the stale-read window, rebind, shift commit ---


def hand_set(rack, *values):
    """The user (or Live's undo) puts every pad's Transpose to ``values``."""
    for cell, v in zip(cells(rack), values):
        param(cell, "Transpose").value = v


def clocked(comp):
    """Drive the component's clock by hand; returns ``later(seconds)``.
    An undo or a hand edit comes seconds after our write — past the
    stale-read window — which a fake's instant read-back would not."""
    now = [100.0]
    comp._clock = lambda: now[0]

    def later(seconds):
        now[0] += seconds
    return later


def test_pad_records_carry_offset_written_prev_and_the_debug_keys(comp):
    rack = tuned_kit(0, 3)
    st = comp._state_for(rack, PATH)
    assert {n: (p.offset, p.written, p.prev) for n, p in st.pads.items()} == {36: (0, 0, None), 37: (3, 3, None)}
    comp.write(rack, PATH, "pitch", 2)
    assert {n: (p.offset, p.written, p.prev) for n, p in st.pads.items()} == {36: (0, 2, 0), 37: (3, 5, 3)}
    comp.write(rack, PATH, "pitch", 4)
    d = comp.debug_state(PATH)
    assert d["offsets"] == {"37": 3}
    assert d["written"] == {"36": 4, "37": 7}
    assert d["prev"] == {"36": 2, "37": 5}
    assert {"values", "shift", "family", "mapped", "members", "offsets", "written", "prev"} <= set(d)


def test_undo_after_a_slider_gesture_is_a_kit_move_not_hand_edits(comp):
    later = clocked(comp)
    rack = tuned_kit(0, 3, -5)
    comp.write(rack, PATH, "pitch", 7)
    assert transposes(rack) == [7, 10, 2]
    later(2.0)
    hand_set(rack, 0, 3, -5)                               # Edit → Undo in Live: every pad −7
    comp.write(rack, PATH, "pitch", 8)
    assert transposes(rack) == [8, 11, 3]                  # the slider's value wins, the kit stays tuned
    assert comp.debug_state(PATH)["offsets"] == {"37": 3, "38": -5}
    assert comp.read(rack, PATH, "pitch") == 8


def test_two_gestures_undone_together_are_still_one_kit_move(comp):
    rack = tuned_kit(0, 3, -5)
    comp.write(rack, PATH, "pitch", 3)
    comp.write(rack, PATH, "pitch", 7)                     # written 7 / 10 / 2, pre-write 3 / 6 / -2
    hand_set(rack, 0, 3, -5)                               # Cmd-Z twice: not the pre-write value, so no window applies
    comp.write(rack, PATH, "pitch", 8)
    assert transposes(rack) == [8, 11, 3]
    assert comp.debug_state(PATH)["offsets"] == {"37": 3, "38": -5}


def test_undo_under_a_held_shift_leaves_the_kit_at_home(comp, emits):
    later = clocked(comp)
    rack = tuned_kit(0, 3, -5)
    comp.subscribe(rack, PATH, "pitch")
    comp.write(rack, PATH, "pitch", 2)
    comp.set_sequencer_shift(rack, PATH, 12)
    assert transposes(rack) == [14, 17, 9]
    later(1.0)
    hand_set(rack, 2, 5, -3)                               # Cmd-Z on the held step
    emits.clear()
    assert comp.set_sequencer_shift(rack, PATH, 0) is True
    assert transposes(rack) == [2, 5, -3]                  # home — not an octave below it
    assert comp.read(rack, PATH, "pitch") == 2             # the global adopted from the kit
    assert values(emits, "vm.pitch") == [(PATH, "vm.pitch", 2)]   # … and the slider told
    assert comp.debug_state(PATH)["offsets"] == {"37": 3, "38": -5}
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    assert transposes(rack) == [14, 17, 9]                 # a following shift lands home + 12


def test_a_gesture_undone_before_a_step_pulls_the_slider_to_the_kit(comp, emits):
    later = clocked(comp)
    rack = tuned_kit(0, 3)
    comp.subscribe(rack, PATH, "pitch")
    comp.write(rack, PATH, "pitch", 7)
    assert transposes(rack) == [7, 10]
    later(2.0)
    hand_set(rack, 0, 3)                                   # Edit → Undo of the drag, then a step fires
    emits.clear()
    comp.set_sequencer_shift(rack, PATH, 12)
    assert comp.read(rack, PATH, "pitch") == 0             # the global follows Live's undo
    assert values(emits, "vm.pitch") == [(PATH, "vm.pitch", 0)]
    assert transposes(rack) == [12, 15]                    # the step lands on the undone kit
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [0, 3]


def test_undo_plus_one_hand_edit_in_the_same_step(comp):
    later = clocked(comp)
    rack = tuned_kit(0, 3, -5)
    comp.write(rack, PATH, "pitch", 7)                     # [7, 10, 2]
    later(2.0)
    hand_set(rack, 0, 6, -5)                               # undo (−7 everywhere) and the snare tuned +3 (−4 net)
    comp.write(rack, PATH, "pitch", 8)
    assert transposes(rack) == [8, 14, 3]                  # only the snare's offset moved, by +3
    assert comp.debug_state(PATH)["offsets"] == {"37": 6, "38": -5}


def test_two_identical_hand_edits_are_outvoted_by_the_unchanged_pads(comp):
    rack = tuned_kit(0, 0, 0, 0, 0, 0)
    comp.write(rack, PATH, "pitch", 1)
    hand_set(rack, 6, 6)                                   # two toms tuned +5 each, four pads untouched
    comp.write(rack, PATH, "pitch", 2)
    assert transposes(rack) == [7, 7, 2, 2, 2, 2]          # both edits survive
    assert comp.debug_state(PATH)["offsets"] == {"36": 5, "37": 5}


def test_single_member_kit_keeps_the_per_pad_rule(comp):
    later = clocked(comp)
    rack = tuned_kit(0)
    comp.write(rack, PATH, "pitch", 7)
    later(2.0)
    hand_set(rack, 0)                                      # an undo or an edit: one pad cannot tell
    comp.write(rack, PATH, "pitch", 8)
    assert transposes(rack) == [1]                         # the documented residual: per-pad
    assert comp.debug_state(PATH)["offsets"] == {"36": -7}


def test_a_rail_pad_does_not_vote_and_keeps_its_offset_under_a_kit_move(comp):
    later = clocked(comp)
    rack = tuned_kit(0, 3, 40)
    comp.write(rack, PATH, "pitch", 5)
    assert transposes(rack) == [5, 8, 45]
    comp.set_sequencer_shift(rack, PATH, 12)
    assert transposes(rack) == [17, 20, 48]                # the third pad at the rail
    later(1.0)
    hand_set(rack, 5, 8, 45)                               # Cmd-Z: the rail pad's delta is −3, not −12
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [5, 8, 45]
    assert comp.debug_state(PATH)["offsets"] == {"37": 3, "38": 40}


def test_stale_read_past_the_window_is_an_edit(comp):
    now = [100.0]
    comp._clock = lambda: now[0]
    rack = tuned_kit(0, 0)
    comp.write(rack, PATH, "pitch", 2)
    comp.set_sequencer_shift(rack, PATH, 12)               # written 14 on both, prev 2
    now[0] += STALE_READ_WINDOW_MS / 1000.0 + 0.05
    param(cells(rack)[0], "Transpose").value = 2           # a hand tune back to the old value, after the window
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [-10, 2]                    # the edit survived our write: −12 on that pad
    assert comp.debug_state(PATH)["offsets"] == {"36": -12}


def test_stale_read_inside_the_window_is_our_write_landing(comp):
    now = [100.0]
    comp._clock = lambda: now[0]
    rack = tuned_kit(0, 0)
    comp.write(rack, PATH, "pitch", 2)
    comp.set_sequencer_shift(rack, PATH, 12)
    now[0] += 0.083                                        # one 1/16 step at 180 BPM later
    param(cells(rack)[0], "Transpose").value = 2           # reads the pre-write value: still landing
    comp.set_sequencer_shift(rack, PATH, 0)
    assert transposes(rack) == [2, 2]
    assert comp.debug_state(PATH)["offsets"] == {}
    assert comp.debug_state(PATH)["prev"] == {"36": 14, "37": 14}


def test_shift_is_not_held_when_nothing_could_be_written(comp):
    rack = make_rack([])                                   # a kit whose chains have not populated yet
    assert comp.set_sequencer_shift(rack, PATH, 12) is False
    assert comp.sequencer_shift(PATH) == 0                 # skipped, not deferred
    rack.drum_pads[36] = pad(36, drumcell(values={"Transpose": 5.0}))
    rack.fire("chains")                                    # inline re-seed
    assert comp.read(rack, PATH, "pitch") == 5             # the global is what the kit loaded at
    assert comp.set_sequencer_shift(rack, PATH, 0) is False
    assert transposes(rack) == [5]                         # the step-off writes nothing below home
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    assert transposes(rack) == [17]


def test_shift_is_not_held_when_every_member_is_macro_held(comp):
    # A non-family rack whose pads are all held by a Live macro: the
    # fan-out runs and writes nothing, so no term is committed and a
    # re-seed must not subtract one.
    names = ["Device On", "Transpose", "Release"] + ["Macro %d" % i for i in range(3, 17)]
    rack = make_rack([pad(36, simpler(enabled=False, transpose=4.0)), pad(37, simpler(enabled=False, transpose=4.0))],
                     macros=family_macros(names=names), mapped_indices={1, 2})
    assert comp.read(rack, PATH, "pitch") == 4
    assert comp.set_sequencer_shift(rack, PATH, 12) is False
    assert comp.sequencer_shift(PATH) == 0
    comp._states[PATH].values.pop("pitch")
    rack.fire("macros_mapped")
    assert comp.read(rack, PATH, "pitch") == 4


def test_rebind_moves_a_shifted_rack_with_its_path(comp):
    rack = tuned_kit(0, 3)
    comp.write(rack, "tracks/6/devices/0", "pitch", 2)
    comp.set_sequencer_shift(rack, "tracks/6/devices/0", 12)
    assert transposes(rack) == [14, 17]
    # A track above it is deleted: same rack, new path, nothing fires on the rack itself.
    assert comp.rebind(rack, "tracks/5/devices/0") is comp._states["tracks/5/devices/0"]
    assert "tracks/6/devices/0" not in comp._states
    assert comp.sequencer_shift("tracks/5/devices/0") == 12
    assert comp.set_sequencer_shift(rack, "tracks/5/devices/0", 0) is True
    assert transposes(rack) == [2, 5]                      # restored — not re-seeded from the shifted pads
    assert comp.read(rack, "tracks/5/devices/0", "pitch") == 2
    assert rack.listener_count() == 4                      # the listeners came along, none doubled
    assert comp.rebind(rack, "tracks/5/devices/0") is comp._states["tracks/5/devices/0"]   # idempotent
    assert comp.rebind(unmapped_kit(1), "tracks/9/devices/0") is None                      # unknown rack


def test_sequencer_shift_finds_a_moved_rack_without_a_rescan(comp):
    rack = tuned_kit(0, 3)
    comp.write(rack, "tracks/6/devices/0", "pitch", 2)
    comp.set_sequencer_shift(rack, "tracks/6/devices/0", 12)
    assert comp.set_sequencer_shift(rack, "tracks/5/devices/0", 0) is True
    assert transposes(rack) == [2, 5]
    assert list(comp._states) == ["tracks/5/devices/0"]
    assert comp.sequencer_shift("tracks/5/devices/0") == 0


def test_subscribe_after_a_move_cold_reads_the_global_not_the_shifted_value(comp):
    rack = tuned_kit(0, 3)
    comp.write(rack, "tracks/6/devices/0", "pitch", 2)
    comp.set_sequencer_shift(rack, "tracks/6/devices/0", 12)
    comp.subscribe(rack, "tracks/5/devices/0", "pitch")
    assert comp.read(rack, "tracks/5/devices/0", "pitch") == 2
    assert comp.sequencer_shift("tracks/5/devices/0") == 12
    assert comp._states["tracks/5/devices/0"].subscribed == {"pitch"}
    assert list(comp._states) == ["tracks/5/devices/0"]


def test_rebind_carries_pending_applies_and_emits_to_the_new_path(comp, emits):
    comp.enable_deferred_apply()
    rack = tuned_kit(0)
    comp.subscribe(rack, "tracks/6/devices/0", "pitch")
    comp.write(rack, "tracks/6/devices/0", "pitch", 5)      # queued for the drain hook
    comp.rebind(rack, "tracks/5/devices/0")
    assert comp.flush() == 1
    assert transposes(rack) == [5]
    rack.drum_pads[40] = pad(40, drumcell(values={"Transpose": 1.0}))
    rack.fire("chains")                                     # inline re-seed: the emit carries the new path
    assert values(emits, "vm.pitch")[-1] == ("tracks/5/devices/0", "vm.pitch", 5)


def test_deferred_reseed_follows_a_move_and_clears_its_flag(emits):
    scheduled = []
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append(fn),
    )
    rack = tuned_kit(2)
    comp.subscribe(rack, "tracks/6/devices/0", "pitch")
    rack.fire("chains")
    assert comp._states["tracks/6/devices/0"].reseed_scheduled is True
    comp.rebind(rack, "tracks/5/devices/0")                 # moved between the fire and the 150 ms re-seed
    scheduled[0]()
    st = comp._states["tracks/5/devices/0"]
    assert st.reseed_scheduled is False
    assert values(emits, "vm.pitch") == [("tracks/5/devices/0", "vm.pitch", 2)]
    # A state released before its re-seed fires: the flag is cleared, nothing is emitted.
    rack.fire("chains")
    comp.release("tracks/5/devices/0")
    scheduled[1]()
    assert st.reseed_scheduled is False
    assert len(values(emits, "vm.pitch")) == 1


def test_rebind_parks_a_shifted_occupant_at_the_vacated_path(comp):
    upper = tuned_kit(0)          # tracks/5: its track is deleted while a step is held
    lower = tuned_kit(0, 3)       # tracks/6: moves up to tracks/5
    comp.set_sequencer_shift(upper, "tracks/5/devices/0", 12)
    comp.set_sequencer_shift(lower, "tracks/6/devices/0", 12)
    comp.rebind(lower, "tracks/5/devices/0")
    assert comp._states["tracks/5/devices/0"].device is lower
    assert comp.sequencer_shift("tracks/6/devices/0") == 12          # the old occupant, parked, still held
    assert comp.set_sequencer_shift(lower, "tracks/5/devices/0", 0) is True
    assert transposes(lower) == [0, 3]
    # The retired engine instance restores the parked rack by handle, in
    # place: the live rack at its old path is not displaced.
    assert comp.set_sequencer_shift(upper, "tracks/5/devices/0", 0) is True
    assert transposes(upper) == [0]
    assert comp._states["tracks/5/devices/0"].device is lower


def test_rebind_releases_an_unshifted_occupant(comp):
    gone = tuned_kit(0)
    mover = tuned_kit(3)
    comp.subscribe(gone, "tracks/5/devices/0", "pitch")
    comp.set_sequencer_shift(mover, "tracks/6/devices/0", 12)
    comp.rebind(mover, "tracks/5/devices/0")
    assert list(comp._states) == ["tracks/5/devices/0"]
    assert gone.listener_count() == 0


def test_two_racks_moving_down_together_keep_their_shifts(comp):
    a, b = tuned_kit(0), tuned_kit(3)
    comp.set_sequencer_shift(a, "tracks/5/devices/0", 12)
    comp.set_sequencer_shift(b, "tracks/6/devices/0", 12)
    comp.rebind(a, "tracks/4/devices/0")     # a track above both deleted; the rescan re-keys in path order
    comp.rebind(b, "tracks/5/devices/0")
    assert sorted(comp._states) == ["tracks/4/devices/0", "tracks/5/devices/0"]
    assert comp.set_sequencer_shift(a, "tracks/4/devices/0", 0) is True and transposes(a) == [0]
    assert comp.set_sequencer_shift(b, "tracks/5/devices/0", 0) is True and transposes(b) == [3]


def test_restore_for_a_rack_not_held_touches_nothing(comp):
    survivor = tuned_kit(0)
    comp.set_sequencer_shift(survivor, "tracks/5/devices/0", 12)
    gone = tuned_kit(7)                                     # its track was deleted; its old path now names the survivor
    assert comp.set_sequencer_shift(gone, "tracks/5/devices/0", 0) is False
    assert comp._states["tracks/5/devices/0"].device is survivor
    assert comp.sequencer_shift("tracks/5/devices/0") == 12
    assert transposes(survivor) == [12]


def test_swapped_kit_parks_the_shifted_predecessor_instead_of_releasing_it(comp):
    old = tuned_kit(0)
    comp.set_sequencer_shift(old, PATH, 12)
    new = tuned_kit(-3)
    assert comp.read(new, PATH, "pitch") == -3              # the new kit seeds from itself
    assert comp._states[PATH].device is new
    assert len(comp._states) == 2 and old.listener_count() == 4
    # A swapped kit that held no shift is simply released (the old rule).
    comp.set_sequencer_shift(old, PATH, 0)
    assert transposes(old) == [0]
    newer = tuned_kit(1)
    assert comp.read(newer, PATH, "pitch") == 1
    assert new.listener_count() == 0


# --- rack-macro functions (nested Instrument Rack kits, 2026-09-07) ---------


# The rig's `Ethnic Drums` pad rack (2026-09-07): seven named macros, the
# rest default-named; the Drum Rack's own macros wear the same names
# minus Transpose and are NOT mapped.
RACK_MACRO_NAMES = ["Attack", "Release", "Transpose", "Osc", "Pitch Attack", "Pitch Amount", "Room"]
ETHNIC_RACK_MACRO_NAMES = (
    ["Device On", "Attack", "Release", "Macro 3", "Osc", "Pitch Attack", "Pitch Amount", "Room"]
    + ["Macro %d" % i for i in range(8, 17)]
)


def nested_rack(names=None, values=None, held=(), omit=()):
    """An Instrument Rack on a pad, shaped like the rig's: ``Device On``,
    16 macros on ``0..127``, ``Chain Selector``. ``held`` names macros
    mapped from the Drum Rack's own macro (``is_enabled == False``);
    ``omit`` leaves those slots default-named, so that pad's rack lacks
    them."""
    names = list(names or RACK_MACRO_NAMES)
    values = values or {}
    params = [FakeParam("Device On", 1.0, 0, 1, quantized=True)]
    for i in range(16):
        name = names[i] if i < len(names) else "Macro %d" % (i + 1)
        if name in omit:
            name = "Macro %d" % (i + 1)
        # A transpose-named macro ships at 63.5 (0 st on the ±48 convention),
        # as the rig's kit does; every other macro at 0.
        default = 63.5 if is_pitch_macro_name(name) else 0.0
        params.append(FakeParam(name, values.get(name, default), 0.0, 127.0, enabled=name not in held))
    params.append(FakeParam("Chain Selector", 0.0, 0.0, 127.0))
    return FakeDevice(INSTRUMENT_RACK_CLASS_NAME, params, name="Alfaias")


def ethnic_kit(n=3, **kw):
    return make_rack(
        [pad(36 + i, nested_rack(**kw)) for i in range(n)],
        macros=family_macros(names=ETHNIC_RACK_MACRO_NAMES),
    )


def rack_macro(rack: FakeRack, note: int, name: str) -> FakeParam:
    return param(rack.drum_pads[note].chains[0].devices[0], name)


def test_rack_macro_function_names():
    fn = function_for_property("vm.macro.Pitch Attack")
    assert fn is not None
    assert fn.name == "macro.Pitch Attack"
    assert fn.kind == "t"
    assert fn.legacy_macro == 0
    assert fn.macro_name == "Pitch Attack"
    assert fn.bindings == {INSTRUMENT_RACK_CLASS_NAME: ("Pitch Attack",)}
    assert MACRO_PROPERTY_PREFIX == "vm.macro."
    assert MACRO_FUNCTION_PREFIX == "macro."
    # The bare prefix is not a function; a name may carry a dot.
    assert function_for_property("vm.macro.") is None
    assert function_for_property("vm.macro.A.B").macro_name == "A.B"
    assert is_macro_function("macro.Room") and not is_macro_function("macro.") and not is_macro_function("pitch")
    assert macro_function("Room").name == "macro.Room"
    # The seven functions carry no macro name and are not rack macros.
    assert all(fn.macro_name is None for fn in FUNCTIONS.values())
    assert INSTRUMENT_RACK_CLASS_NAME not in BOUND_CLASSES


def test_empty_macro_names():
    for name in ("Macro 1", "Macro 16", "macro 3", "Macro3", "", ".", "-", " ", None):
        assert is_empty_macro_name(name), name
    for name in ("Attack", "Pitch Attack", "Macro Tune", "1 Drive"):
        assert not is_empty_macro_name(name), name


def test_census_lists_the_pad_racks_macros_in_rack_order(comp):
    rack = ethnic_kit(3)
    m = members(comp, rack)
    assert m["padCount"] == 3
    assert m["padClasses"] == {INSTRUMENT_RACK_CLASS_NAME: 3}
    assert m["hasMacroMappings"] is False and m["family"] is False
    # The fixed functions have no member (the parameters they bind sit
    # inside the pad racks); pitch binds through the Transpose macro, and
    # gain through each pad's own chain volume (2026-09-08).
    assert all(
        v == {"members": 0, "held": 0}
        for k, v in m["functions"].items() if k not in ("pitch", "gain")
    )
    assert m["functions"]["pitch"] == {"members": 3, "held": 0}
    assert m["functions"]["gain"] == {"members": 3, "held": 0}
    assert m["pitchMacro"] == "Transpose"
    assert m["macros"] == [{"name": n, "members": 3, "held": 0} for n in RACK_MACRO_NAMES]
    # The census is a list because sort_keys would reorder a dict.
    assert [x["name"] for x in m["macros"]] == RACK_MACRO_NAMES


def test_census_macros_follow_the_first_pad_and_count_partial_names(comp):
    rack = make_rack([
        pad(36, nested_rack(["Attack", "Release"])),
        pad(37, nested_rack(["Release", "Attack", "Room"])),
        pad(38, simpler()),
    ], macros=family_macros(names=ETHNIC_RACK_MACRO_NAMES))
    m = members(comp, rack)
    assert m["padClasses"] == {INSTRUMENT_RACK_CLASS_NAME: 2, "OriginalSimpler": 1}
    assert [x["name"] for x in m["macros"]] == ["Attack", "Release", "Room"]
    assert m["macros"][2] == {"name": "Room", "members": 1, "held": 0}
    # The Simpler pad still feeds the seven functions as before.
    assert m["functions"]["pitch"] == {"members": 1, "held": 0}


def test_census_has_no_macros_on_a_kit_without_nested_racks(comp):
    assert members(comp, unmapped_kit(2))["macros"] == []
    assert members(comp, make_rack([]))["macros"] == []


def test_rack_macro_seed_reads_the_first_pad_racks_macro(comp):
    rack = ethnic_kit(3, values={"Attack": 25.4, "Room": 127.0})
    rack_macro(rack, 37, "Attack")._value = 100.0   # a later pad differs; the first pad seeds
    assert comp.read(rack, PATH, "macro.Attack") == pytest.approx(0.2)
    assert comp.read(rack, PATH, "macro.Room") == pytest.approx(1.0)
    assert comp.read(rack, PATH, "macro.Osc") == 0.0
    # Pitch seeds through the Transpose macro (63.5 ↔ 0 st); the rest
    # still read nil on this kit: nothing to seed from.
    assert comp.read(rack, PATH, "pitch") == 0
    assert comp.read(rack, PATH, "attack") is None


def test_rack_macro_write_fans_out_by_name_through_the_macro_range(comp):
    rack = ethnic_kit(3)
    ok, stored, detail = comp.write(rack, PATH, "macro.Attack", 0.5)
    assert (ok, stored, detail) == (True, 0.5, "")
    for note in (36, 37, 38):
        assert rack_macro(rack, note, "Attack").writes == [63.5]
        assert rack_macro(rack, note, "Release").writes == []
    # The Drum Rack's own macros — named the same, unmapped — are never
    # written on a rack macro's behalf.
    assert all(macro(rack, i).writes == [] for i in range(17))
    assert comp.read(rack, PATH, "macro.Attack") == 0.5
    comp.write(rack, PATH, "macro.Pitch Amount", 1.0)
    assert rack_macro(rack, 36, "Pitch Amount").writes == [127.0]


def test_rack_macro_never_touches_the_legacy_macro_on_a_mapped_family_kit(comp):
    # Family fingerprint + every macro mapped: the seven would route to
    # their legacy macros here. A rack macro has none (index 0), and
    # the guard keeps ``macros_mapped[-1]`` from routing it to Device On.
    rack = make_rack([pad(36, nested_rack()), pad(37, nested_rack())], mapped=True)
    assert comp._states.get(PATH) is None
    comp.write(rack, PATH, "macro.Attack", 0.25)
    st = comp._states[PATH]
    assert st.family is True and st.has_macro_mappings is True
    assert all(macro(rack, i).writes == [] for i in range(17))
    assert rack_macro(rack, 36, "Attack").writes == [31.75]
    assert rack_macro(rack, 37, "Attack").writes == [31.75]


def test_rack_macro_held_pads_are_skipped_and_counted(comp):
    rack = make_rack([
        pad(36, nested_rack(held=("Transpose",))),
        pad(37, nested_rack(held=("Transpose",))),
        pad(38, nested_rack()),
    ])
    m = members(comp, rack)
    assert next(x for x in m["macros"] if x["name"] == "Transpose") == {"name": "Transpose", "members": 3, "held": 2}
    comp.write(rack, PATH, "macro.Transpose", 0.75)
    assert rack_macro(rack, 36, "Transpose").writes == []
    assert rack_macro(rack, 37, "Transpose").writes == []
    assert rack_macro(rack, 38, "Transpose").writes == [95.25]


def test_rack_macro_the_kit_lacks_reads_nil_and_a_write_moves_nothing(comp):
    rack = ethnic_kit(2)
    assert comp.read(rack, PATH, "macro.Nope") is None
    ok, stored, _ = comp.write(rack, PATH, "macro.Nope", 0.4)
    assert ok is True and stored == 0.4          # stored + echoed, like any member-less function
    assert comp.read(rack, PATH, "macro.Nope") == 0.4
    for note in (36, 37):
        for name in RACK_MACRO_NAMES:
            assert rack_macro(rack, note, name).writes == []
    # Not in the census: the kit does not carry it.
    assert "Nope" not in [x["name"] for x in members(comp, rack)["macros"]]


def test_rack_macro_only_the_first_sixteen_slots_count(comp):
    dev = nested_rack(["M%d" % i for i in range(1, 17)])
    dev.parameters.insert(17, FakeParam("Extra", 0.0, 0.0, 127.0))   # a 17th named param before Chain Selector
    rack = make_rack([pad(36, dev)])
    names = [x["name"] for x in members(comp, rack)["macros"]]
    assert names == ["M%d" % i for i in range(1, 17)]
    assert "Extra" not in names and "Chain Selector" not in names and "Device On" not in names


def test_reseed_drops_a_value_whose_members_vanished(comp):
    # A Sampler kit seeds decay; racks are then dropped onto every pad
    # (the rig's Ethnic Drums), chains fire, and the held decay must not
    # survive as a number the kit cannot move.
    rack = make_rack([pad(36, sampler()), pad(37, sampler())])
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.6)
    assert comp.read(rack, PATH, "pitch") == 0
    for note in (36, 37):
        rack.drum_pads[note].chains = [FakeChain([nested_rack(["Attack", "Room"])])]
    rack.fire("chains")
    assert comp.read(rack, PATH, "decay") is None
    assert comp.read(rack, PATH, "pitch") is None     # no transpose macro on these racks
    m = members(comp, rack)
    assert m["functions"]["decay"] == {"members": 0, "held": 0}
    assert m["pitchMacro"] is None
    assert [x["name"] for x in m["macros"]] == ["Attack", "Room"]
    assert comp.read(rack, PATH, "macro.Attack") == 0.0


def test_reseed_drops_a_rack_macro_the_new_pads_lack(comp):
    rack = make_rack([pad(36, nested_rack(["Attack", "Room"]))])
    assert comp.read(rack, PATH, "macro.Room") == 0.0
    rack.drum_pads[36].chains = [FakeChain([nested_rack(["Attack"])])]
    rack.fire("chains")
    assert comp.read(rack, PATH, "macro.Room") is None
    assert [x["name"] for x in members(comp, rack)["macros"]] == ["Attack"]


def test_reseed_keeps_a_rack_macro_value_that_still_has_members(comp):
    rack = ethnic_kit(2)
    comp.write(rack, PATH, "macro.Osc", 0.9)
    rack.fire("chains")
    assert comp.read(rack, PATH, "macro.Osc") == 0.9


def test_reseed_emits_subscribed_rack_macros_with_the_census(comp, emits):
    rack = ethnic_kit(2)
    comp.subscribe(rack, PATH, "macro.Room")
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    emits.clear()
    rack_macro(rack, 36, "Room")._value = 63.5
    rack.drum_pads[38] = pad(38, nested_rack())
    rack.fire("drum_pads")
    names = [args[1] for a, args in emits if a == V3_PROPERTY_VALUE_ADDRESS]
    assert names == ["vm.macro.Room", MEMBERS_PROPERTY]
    room = [args for a, args in emits if args[1] == "vm.macro.Room"][0]
    assert room[2] == 0.0   # the held value survives a re-seed while it has members
    census = json.loads([args for a, args in emits if args[1] == MEMBERS_PROPERTY][0][2])
    assert census["padCount"] == 3


def test_rack_macro_debug_state_and_unsubscribe(comp):
    rack = ethnic_kit(2)
    comp.subscribe(rack, PATH, "macro.Attack")
    assert comp.debug_state(PATH)["members"]["macro.Attack"] == 2
    comp.unsubscribe(PATH, "macro.Attack")
    assert PATH not in comp._states


def test_spec_for_synthesises_the_rack_macro_row_on_a_drum_rack_only():
    spec = spec_for("DrumGroupDevice", "vm.macro.Pitch Attack")
    assert spec is not None
    assert spec.computed == PROVIDER_NAME and spec.writable is True
    assert spec.attr_name == "macro.Pitch Attack"
    assert spec.listener_path == ""
    assert spec_for("DrumGroupDevice", "vm.macro.Pitch Attack") is spec   # one object per name
    assert spec_for("DrumGroupDevice", "vm.macro.") is None
    assert spec_for("OriginalSimpler", "vm.macro.Pitch Attack") is None
    assert spec_for("DrumGroupDevice", "vm.pitch") is ALLOWLIST[("DrumGroupDevice", "vm.pitch")]
    assert ("DrumGroupDevice", "vm.macro.Pitch Attack") not in ALLOWLIST


def test_rack_macro_rows_ride_the_channel(comp, emits, generation):
    rack = ethnic_kit(2, values={"Attack": 12.7})
    song = StubSong(tracks=[StubTrack(tid=100, devices=[rack, simpler()])])
    pc = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
        computed_providers={PROVIDER_NAME: comp},
    )
    pc.set_generation(generation)
    pc.handle_subscribe(args=(PATH, "vm.macro.Attack"), source_addr=None)
    got = values(emits, "vm.macro.Attack")
    assert len(got) == 1 and got[0][0] == PATH and got[0][2] == pytest.approx(0.1)
    assert comp._states[PATH].subscribed == {"macro.Attack"}
    pc.handle_set(args=(PATH, "vm.macro.Attack", 0.25, generation.current), source_addr=None)
    assert values(emits, "vm.macro.Attack")[-1][2] == 0.25
    assert rack_macro(rack, 36, "Attack").writes == [31.75]
    assert rack_macro(rack, 37, "Attack").writes == [31.75]
    assert errors(emits) == []
    # The bare prefix, and the family on a Simpler, are not allowed.
    pc.handle_subscribe(args=(PATH, "vm.macro."), source_addr=None)
    pc.handle_subscribe(args=("tracks/0/devices/1", "vm.macro.Attack"), source_addr=None)
    err = errors(emits)
    assert len(err) == 2 and all(e[4] == V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED for e in err)
    pc.handle_unsubscribe(args=(PATH, "vm.macro.Attack"), source_addr=None)
    assert PATH not in comp._states


# --- pitch through the pad rack's transpose macro (2026-09-07) --------------


def st_to_macro(st: float) -> float:
    """The convention: a pitch macro spans −48..48 over 0..127."""
    return (st + 48.0) / 96.0 * 127.0


def test_pitch_macro_names_are_exact_and_case_insensitive():
    assert PITCH_MACRO_NAMES == ("Transpose", "Pitch", "Tune", "Trnsp")
    for name in ("Transpose", "transpose", "PITCH", "Tune", " Trnsp "):
        assert is_pitch_macro_name(name), name
    for name in ("Pitch Attack", "Pitch Amount", "Transposed", "Osc", "", None):
        assert not is_pitch_macro_name(name), name


def test_pitch_binds_through_the_transpose_macro_in_semitones(comp):
    rack = ethnic_kit(3, values={"Transpose": 63.5})
    assert comp.read(rack, PATH, "pitch") == 0
    comp.write(rack, PATH, "pitch", 12)
    for note in (36, 37, 38):
        assert rack_macro(rack, note, "Transpose").writes == [pytest.approx(79.375)]
    assert comp.read(rack, PATH, "pitch") == 12
    comp.write(rack, PATH, "pitch", -48)
    assert rack_macro(rack, 36, "Transpose").writes[-1] == pytest.approx(0.0)
    comp.write(rack, PATH, "pitch", 48)
    assert rack_macro(rack, 36, "Transpose").writes[-1] == pytest.approx(127.0)
    # The Drum Rack's own (unmapped) macros stay untouched.
    assert all(macro(rack, i).writes == [] for i in range(17))


def test_pitch_seeds_from_the_first_pad_racks_transpose_macro(comp):
    rack = ethnic_kit(2, values={"Transpose": 25.4})
    assert comp.read(rack, PATH, "pitch") == -29     # 25.4 → −28.8 st, rounded
    rack = ethnic_kit(2, values={"Transpose": st_to_macro(7)})
    assert comp.read(rack, PATH, "pitch") == 7


def test_pitch_offsets_are_seeded_from_the_racks_tuning(comp):
    rack = ethnic_kit(2)
    rack_macro(rack, 37, "Transpose")._value = st_to_macro(3)      # pad 37 tuned +3
    assert comp.read(rack, PATH, "pitch") == 0
    assert comp.debug_state(PATH)["offsets"] == {"37": 3}
    comp.write(rack, PATH, "pitch", 5)
    assert rack_macro(rack, 36, "Transpose").writes == [pytest.approx(st_to_macro(5))]
    assert rack_macro(rack, 37, "Transpose").writes == [pytest.approx(st_to_macro(8))]


def test_sequencer_shift_rides_the_transpose_macro(comp):
    rack = ethnic_kit(2)
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    for note in (36, 37):
        assert rack_macro(rack, note, "Transpose").writes == [pytest.approx(st_to_macro(12))]
    assert comp.read(rack, PATH, "pitch") == 0           # the UI never sees the term
    assert comp.set_sequencer_shift(rack, PATH, 0) is True
    assert rack_macro(rack, 36, "Transpose").writes[-1] == pytest.approx(63.5)


def test_pitch_macro_held_on_every_pad_is_held_and_the_shift_is_refused(comp):
    rack = ethnic_kit(2, held=("Transpose",))
    m = members(comp, rack)
    assert m["functions"]["pitch"] == {"members": 2, "held": 2}
    assert m["pitchMacro"] == "Transpose"
    assert comp.set_sequencer_shift(rack, PATH, 12) is False
    assert rack_macro(rack, 36, "Transpose").writes == []


def test_pitch_macro_follows_the_priority_list_and_is_absent_without_one(comp):
    rack = make_rack([pad(36, nested_rack(["Attack", "Pitch", "Tune"]))])
    m = members(comp, rack)
    assert m["pitchMacro"] == "Pitch"
    assert m["functions"]["pitch"] == {"members": 1, "held": 0}
    comp.write(rack, PATH, "pitch", 12)
    assert rack_macro(rack, 36, "Pitch").writes == [pytest.approx(st_to_macro(12))]
    assert rack_macro(rack, 36, "Tune").writes == []
    rack = make_rack([pad(36, nested_rack(["Attack", "Pitch Attack", "Room"]))])
    m = members(comp, rack)
    assert m["pitchMacro"] is None
    assert m["functions"]["pitch"] == {"members": 0, "held": 0}
    assert comp.read(rack, PATH, "pitch") is None


def test_pitch_macro_and_its_rack_macro_row_are_two_views_of_one_knob(comp):
    rack = ethnic_kit(1)
    assert comp.read(rack, PATH, "pitch") == 0
    comp.write(rack, PATH, "macro.Transpose", 1.0)      # the raw macro, t
    assert rack_macro(rack, 36, "Transpose").writes == [127.0]
    # A re-seed keeps the held pitch (it still has a source); a fresh state
    # reads the same knob back in semitones.
    rack.fire("chains")
    assert comp.read(rack, PATH, "pitch") == 0
    comp.release(PATH)
    assert comp.read(rack, PATH, "pitch") == 48
    # And the pitch path reconciles the knob before writing: the raw move
    # reads as a kit move on the next pitch write, which the incoming
    # value overrides — every pad lands where the slider says.
    comp.write(rack, PATH, "pitch", 3)
    assert rack_macro(rack, 36, "Transpose").writes[-1] == pytest.approx(st_to_macro(3))


# --- release (Sampler kits, 2026-09-07) --------------------------------------


def test_release_binds_ve_release_on_the_sample_instruments_only(comp):
    rack = make_rack([pad(36, sampler()), pad(37, simpler()), pad(38, drumcell())])
    m = members(comp, rack)
    assert m["functions"]["release"] == {"members": 2, "held": 0}
    assert comp.read(rack, PATH, "release") == pytest.approx(0.5)
    comp.write(rack, PATH, "release", 0.25)
    assert param(rack.drum_pads[36].chains[0].devices[0], "Ve Release").writes == [0.25]
    assert param(rack.drum_pads[37].chains[0].devices[0], "Ve Release").writes == [0.25]
    assert all(p.writes == [] for p in rack.drum_pads[38].chains[0].devices[0].parameters)
    # A DrumCell kit has no release stage at all.
    assert members(comp, unmapped_kit(2))["functions"]["release"] == {"members": 0, "held": 0}
    assert comp.read(unmapped_kit(2), "tracks/0/devices/1", "release") is None


def test_release_never_writes_a_legacy_macro_on_a_mapped_family_kit(comp):
    rack = make_rack([pad(36, sampler()), pad(37, sampler())], mapped=True)
    comp.write(rack, PATH, "release", 1.0)
    assert all(macro(rack, i).writes == [] for i in range(17))
    assert param(rack.drum_pads[36].chains[0].devices[0], "Ve Release").writes == [1.0]


def test_release_is_held_when_the_kits_release_macro_maps_it(comp):
    # `32 Pad Kit Jazz` as shipped: macro 2 = Release drives every pad's Ve Release.
    s1, s2 = simpler(), simpler()
    for dev in (s1, s2):
        param(dev, "Ve Release").is_enabled = False
    rack = make_rack([pad(36, s1), pad(37, s2)], mapped_indices={2})
    m = members(comp, rack)
    assert m["functions"]["release"] == {"members": 2, "held": 2}
    comp.write(rack, PATH, "release", 0.1)
    assert param(s1, "Ve Release").writes == []


# --- the Sampler row: osc / pitch envelope / sustain / spread (2026-09-07) ----


def sp(rack: FakeRack, note: int, name: str) -> FakeParam:
    return param(rack.drum_pads[note].chains[0].devices[0], name)


def test_sampler_row_functions_resolve_on_a_sampler_kit_only(comp):
    rack = make_rack([pad(36, sampler()), pad(37, sampler()), pad(38, drumcell()), pad(39, simpler())])
    m = members(comp, rack)
    f = m["functions"]
    assert f["oscAmount"] == {"members": 4, "held": 0}        # switch + amount per Sampler
    assert f["oscCoarse"] == {"members": 2, "held": 0}
    assert f["pitchEnvAmount"] == {"members": 4, "held": 0}
    assert f["pitchEnvAttack"] == {"members": 2, "held": 0}
    assert f["sustain"] == {"members": 3, "held": 0}          # the Simpler has these too
    assert f["spread"] == {"members": 3, "held": 0}
    assert f["release"] == {"members": 3, "held": 0}


def test_sampler_row_seeds_from_the_amounts_not_the_switches(comp):
    rack = make_rack([pad(36, sampler())])
    sp(rack, 36, "O Volume")._value = 0.3
    sp(rack, 36, "Pe < Env")._value = 24.0
    sp(rack, 36, "Spread")._value = 25.0
    assert comp.read(rack, PATH, "oscAmount") == pytest.approx(0.3)
    assert comp.read(rack, PATH, "oscCoarse") == pytest.approx(3.0 / 50.0)   # 1.0 on −2..48
    assert comp.read(rack, PATH, "pitchEnvAmount") == pytest.approx(0.75)    # +24 st on ±48
    assert comp.read(rack, PATH, "pitchEnvAttack") == pytest.approx(0.31)
    assert comp.read(rack, PATH, "sustain") == pytest.approx(1.0)
    assert comp.read(rack, PATH, "spread") == pytest.approx(0.25)


def test_sampler_row_writes_through_each_ranges_and_switches_follow_the_amount(comp):
    rack = make_rack([pad(36, sampler()), pad(37, sampler())])
    comp.write(rack, PATH, "oscAmount", 0.4)
    for note in (36, 37):
        assert sp(rack, note, "Osc On").writes == [1.0]
        assert sp(rack, note, "O Volume").writes == [pytest.approx(0.4)]
    comp.write(rack, PATH, "oscAmount", 0.0)
    assert sp(rack, 36, "Osc On").writes[-1] == 0.0       # at the floor the section goes off
    comp.write(rack, PATH, "pitchEnvAmount", 0.25)
    assert sp(rack, 36, "Pe On").writes == [1.0]
    assert sp(rack, 36, "Pe < Env").writes == [pytest.approx(-24.0)]
    comp.write(rack, PATH, "pitchEnvAmount", 0.5)
    assert sp(rack, 36, "Pe < Env").writes[-1] == pytest.approx(0.0)   # centre = no envelope
    # A bipolar amount's floor is −48 st, not "off": the switch stays on.
    comp.write(rack, PATH, "pitchEnvAmount", 0.0)
    assert sp(rack, 36, "Pe < Env").writes[-1] == pytest.approx(-48.0)
    assert sp(rack, 36, "Pe On").writes == [1.0, 1.0, 1.0]
    comp.write(rack, PATH, "pitchEnvAttack", 0.5)
    assert sp(rack, 36, "Pe Attack").writes == [pytest.approx(0.5)]
    assert sp(rack, 36, "Pe Decay").writes == []
    comp.write(rack, PATH, "oscCoarse", 1.0)
    assert sp(rack, 36, "O Coarse").writes == [pytest.approx(48.0)]
    comp.write(rack, PATH, "spread", 0.5)
    assert sp(rack, 36, "Spread").writes == [pytest.approx(50.0)]
    comp.write(rack, PATH, "sustain", 0.75)
    assert sp(rack, 36, "Ve Sustain").writes == [pytest.approx(0.75)]
    # The Drum Rack's own macros are never touched.
    assert all(macro(rack, i).writes == [] for i in range(17))


def test_a_section_never_enabled_lists_only_its_switch_and_grows_on_the_first_write(comp):
    rack = make_rack([pad(36, growing_sampler()), pad(37, growing_sampler())])
    m = members(comp, rack)
    assert m["functions"]["oscAmount"] == {"members": 2, "held": 0}   # the switches only
    assert m["functions"]["oscCoarse"] == {"members": 0, "held": 0}
    assert comp.read(rack, PATH, "oscAmount") == 0.0                    # off
    assert comp.read(rack, PATH, "oscCoarse") is None
    # The first write turns the section on, re-reads the rack and lands
    # the amount in the same pass; coarse becomes a member too.
    comp.write(rack, PATH, "oscAmount", 0.6)
    for note in (36, 37):
        assert sp(rack, note, "Osc On").writes == [1.0]
        assert sp(rack, note, "O Volume").writes == [pytest.approx(0.6)]
    m = members(comp, rack)
    assert m["functions"]["oscAmount"] == {"members": 4, "held": 0}
    assert m["functions"]["oscCoarse"] == {"members": 2, "held": 0}
    assert comp.read(rack, PATH, "oscCoarse") == pytest.approx(3.0 / 50.0)
    # The pitch envelope section, still off, is untouched.
    assert m["functions"]["pitchEnvAttack"] == {"members": 0, "held": 0}
    assert sp(rack, 36, "Pe On").writes == []


def test_a_section_switched_off_again_keeps_its_parameters_listed(comp):
    # Off after on removes nothing (the user's toggle test): the amount
    # stays a member, is written at the floor with the switch, and the
    # next switch-on grows nothing and writes each member once.
    rack = make_rack([pad(36, growing_sampler())])
    comp.write(rack, PATH, "oscAmount", 0.6)
    n_params = len(rack.drum_pads[36].chains[0].devices[0].parameters)
    comp.write(rack, PATH, "oscAmount", 0.0)
    assert len(rack.drum_pads[36].chains[0].devices[0].parameters) == n_params
    comp.write(rack, PATH, "oscAmount", 0.2)
    assert sp(rack, 36, "Osc On").writes == [1.0, 0.0, 1.0]
    assert sp(rack, 36, "O Volume").writes == [pytest.approx(0.6), pytest.approx(0.0), pytest.approx(0.2)]
    assert members(comp, rack)["functions"]["oscAmount"] == {"members": 2, "held": 0}


# --- the Simpler kit's Time pad and Trnsp (2026-09-07) -----------------------


def test_simpler_kit_time_and_trnsp_resolve_by_name(comp):
    # `Acuff Kit`: Ve Attack at 21, Ve Release at 24, Transpose at 11 —
    # bound by name, the indices never matter.
    rack = make_rack([pad(36, simpler()), pad(37, simpler())])
    f = members(comp, rack)["functions"]
    assert f["attack"] == f["release"] == f["pitch"] == {"members": 2, "held": 0}
    assert f["sustain"] == f["spread"] == {"members": 2, "held": 0}
    comp.write(rack, PATH, "attack", 0.2)
    comp.write(rack, PATH, "release", 0.8)
    comp.write(rack, PATH, "pitch", -48)
    for note in (36, 37):
        assert sp(rack, note, "Ve Attack").writes == [pytest.approx(0.2)]
        assert sp(rack, note, "Ve Release").writes == [pytest.approx(0.8)]
        assert sp(rack, note, "Transpose").writes == [-48]
    assert all(macro(rack, i).writes == [] for i in range(17))


# --- per-pad deviations + member value listeners (2026-09-08) ---------------
#
# The pitch model (``_PadPitch`` offsets, reconciled by a read-before-write
# poll) generalised to the continuous functions, driven by the members' own
# value listeners instead: a kit control moves the kit and keeps its shape,
# and a pad edited by hand in Live survives the next gesture instead of
# being flattened by it.


def two_pad_kit(a=0.4, b=0.6):
    """Two pads whose Decay differs — a hand-tuned kit, which is the normal
    case, not the exception."""
    return make_rack([
        pad(36, drumcell(values={"Decay": a})),
        pad(37, drumcell(values={"Decay": b})),
    ], mapped=False)


def decay(rack, note):
    return param(next(p for p in rack.drum_pads if p.note == note).chains[0].devices[0], "Decay")


def test_the_kit_value_seeds_from_the_first_pad_and_the_rest_deviate(comp):
    rack = two_pad_kit(0.4, 0.6)
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.4)
    devs = comp.debug_state(PATH)["deviations"]["decay"]
    assert devs == {"37:Decay": pytest.approx(0.2)}


def test_a_fan_out_keeps_the_kits_shape(comp):
    # The whole point: one control moves every pad by the same amount and
    # the kit stays tuned. Before this, the first touch flattened it.
    rack = two_pad_kit(0.4, 0.6)
    comp.write(rack, PATH, "decay", 0.7)
    assert decay(rack, 36).value == pytest.approx(0.7)
    assert decay(rack, 37).value == pytest.approx(0.9)


def test_a_pad_squeezed_against_a_rail_re_anchors_its_deviation(comp):
    # The clamp is what the pad can no longer keep (the user's call,
    # 2026-09-15): +0.2 against the top rail with the kit at 0.9 leaves
    # +0.1, and coming off the rail the pad moves at once rather than
    # standing still until the kit value comes back under its old distance.
    rack = two_pad_kit(0.4, 0.6)
    comp.write(rack, PATH, "decay", 0.9)      # pad 37 wants 1.1, clamps to 1.0
    assert decay(rack, 37).value == pytest.approx(1.0)
    assert comp.debug_state(PATH)["deviations"]["decay"] == {
        "37:Decay": pytest.approx(0.1),
    }
    comp.write(rack, PATH, "decay", 0.5)
    assert decay(rack, 37).value == pytest.approx(0.6)


def test_a_partial_squeeze_shrinks_the_deviation_by_what_the_clamp_hid(comp):
    rack = two_pad_kit(0.4, 0.9)              # pad 37 sits +0.5
    comp.write(rack, PATH, "decay", 0.7)      # wants 1.2, clamps to 1.0: +0.3 left
    assert comp.debug_state(PATH)["deviations"]["decay"] == {
        "37:Decay": pytest.approx(0.3),
    }
    comp.write(rack, PATH, "decay", 0.4)
    assert decay(rack, 37).value == pytest.approx(0.7)


def test_a_sweep_to_the_rail_flattens_the_kit(comp):
    # What a performer expects of a full sweep: push the control to an end
    # and the pads squeezed there come away level with it.
    rack = two_pad_kit(0.4, 0.6)
    comp.write(rack, PATH, "decay", 1.0)
    assert decay(rack, 36).value == pytest.approx(1.0)
    assert decay(rack, 37).value == pytest.approx(1.0)
    assert comp.debug_state(PATH)["deviations"] == {}
    comp.write(rack, PATH, "decay", 0.5)
    assert decay(rack, 36).value == pytest.approx(0.5)
    assert decay(rack, 37).value == pytest.approx(0.5)


def test_only_the_direction_squeezed_is_flattened(comp):
    # The Cait Slow 01 case (rig, 2026-09-15): 28 cells sat 0.685 BELOW the
    # kit value, so Decay at max never clamped them — their own ceiling is
    # lower — and the kit control looked broken. The bottom rail is the one
    # that reaches a pad below the kit.
    rack = two_pad_kit(1.0, 0.315)
    comp.write(rack, PATH, "decay", 1.0)
    assert decay(rack, 37).value == pytest.approx(0.315)
    comp.write(rack, PATH, "decay", 0.0)      # squeeze the other way
    assert decay(rack, 37).value == pytest.approx(0.0)
    assert comp.debug_state(PATH)["deviations"] == {}
    comp.write(rack, PATH, "decay", 1.0)
    assert decay(rack, 37).value == pytest.approx(1.0)


def load_preset(rack, preset_name, **values):
    """A preset load into the same Drum Rack, as the rig showed it
    (2026-09-15): the chains, the devices and every DeviceParameter are the
    SAME objects, holding the new kit's values under new names, and the rack
    takes the preset's name. Nothing's ``_live_ptr`` changes and the chains'
    own ``devices`` listeners do not fire — the rack's ``chains`` listener
    does."""
    for i, pad_obj in enumerate([p for p in rack.drum_pads if p.chains]):
        cell = pad_obj.chains[0].devices[0]
        for pname, v in values.items():
            hand_edit(param(cell, pname), v)
        cell.name = "%s %d" % (preset_name, i)
        pad_obj.chains[0].name = cell.name
    rack.name = preset_name
    rack.fire("chains")


def test_a_preset_load_into_the_same_rack_adopts_the_new_kit(comp):
    # `prepare_for_preset` loads a new kit into the rack that is already
    # there, so the state survives and the per-pad records — keyed by pad
    # note and parameter name — would be inherited by a kit that never had
    # them. Measured on the rig 2026-09-15: a 32-cell kit landed uniform at
    # 40/127 while the held decay stayed at the previous kit's 0.928, which
    # gave every pad a -0.613 deviation at once. The new kit is adopted
    # instead (the user's call).
    rack = two_pad_kit(0.4, 0.6)
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.4)
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"37:Decay": pytest.approx(0.2)}

    load_preset(rack, "Cait Slow 01", Decay=0.5)

    assert comp.read(rack, PATH, "decay") == pytest.approx(0.5)   # adopted
    assert comp.debug_state(PATH)["deviations"] == {}             # nothing inherited
    comp.write(rack, PATH, "decay", 0.8)
    assert decay(rack, 36).value == pytest.approx(0.8)
    assert decay(rack, 37).value == pytest.approx(0.8)            # level, as the kit is


def test_a_re_resolve_under_the_same_name_keeps_its_deviations(comp):
    # The counter-case to the name test: a structural change that is not a
    # preset load — a pad added, a device dropped into a chain, Live
    # rebuilding the list — re-resolves under the same kit name, and the
    # kit's shape is still the kit's.
    rack = two_pad_kit(0.4, 0.6)
    comp.read(rack, PATH, "decay")
    rack.fire("chains")
    rack.fire("drum_pads")
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"37:Decay": pytest.approx(0.2)}
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.4)


def test_a_pad_added_to_the_kit_leaves_the_other_deviations_alone(comp):
    # The counter-case the disjoint test exists for: one new member among
    # the old ones is a pad added to THIS kit, not a new kit.
    rack = two_pad_kit(0.4, 0.6)
    comp.read(rack, PATH, "decay")
    fresh = next(p for p in rack.drum_pads if p.note == 40)
    fresh.chains = [FakeChain([drumcell(values={"Decay": 0.9})])]
    rack.fire("drum_pads")

    devs = comp.debug_state(PATH)["deviations"]["decay"]
    assert devs["37:Decay"] == pytest.approx(0.2)    # kept
    assert devs["40:Decay"] == pytest.approx(0.5)    # the newcomer keeps what it holds
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.4)


def test_a_preset_load_drops_the_pitch_offsets_too(comp):
    rack = two_pad_kit(0.4, 0.6)
    hand_set(rack, 0, 7)                         # pad 37 tuned +7
    assert comp.read(rack, PATH, "pitch") == 0
    load_preset(rack, "Cait Slow 01", Transpose=3.0)

    assert comp.read(rack, PATH, "pitch") == 3
    comp.write(rack, PATH, "pitch", 5)
    assert transposes(rack) == [5, 5]


def test_a_hand_edit_in_live_becomes_that_pads_deviation(comp):
    rack = two_pad_kit(0.5, 0.5)
    comp.write(rack, PATH, "decay", 0.5)
    hand_edit(decay(rack, 37), 0.8)           # the user tunes one pad in Live
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"37:Decay": pytest.approx(0.3)}
    comp.write(rack, PATH, "decay", 0.6)
    assert decay(rack, 36).value == pytest.approx(0.6)
    assert decay(rack, 37).value == pytest.approx(0.9)


def test_a_hand_edit_does_not_move_the_held_kit_value(comp, emits):
    rack = two_pad_kit(0.5, 0.5)
    comp.subscribe(rack, PATH, "decay")
    comp.write(rack, PATH, "decay", 0.5)
    emits.clear()
    hand_edit(decay(rack, 37), 0.8)
    # One pad moving is that pad's business: the kit control still reads
    # what the kit is at, and nothing is pushed to the UI.
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.5)
    assert emits == []


def test_our_own_fan_out_is_never_read_as_an_edit(comp):
    rack = two_pad_kit(0.5, 0.5)
    for v in (0.2, 0.4, 0.6, 0.8):
        comp.write(rack, PATH, "decay", v)
    assert comp.debug_state(PATH)["deviations"] == {}
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.8)


def test_a_move_the_whole_kit_shares_is_adopted_and_re_emitted(emits):
    # Live's Edit → Undo of our own gesture moves every pad at once. The
    # deferred absorb is what makes that visible as one event: fired
    # inline, each pad would be seen alone and read as an edit.
    scheduled = []
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    rack = make_rack([pad(36 + i, drumcell(values={"Decay": 0.5})) for i in range(3)])
    comp.subscribe(rack, PATH, "decay")
    comp.write(rack, PATH, "decay", 0.5)
    emits.clear()
    scheduled.clear()
    for i in range(3):
        hand_edit(decay(rack, 36 + i), 0.3)
    assert [ms for ms, _ in scheduled] == [EDIT_ABSORB_DELAY_MS]
    scheduled[0][1]()
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.3)
    assert comp.debug_state(PATH)["deviations"] == {}
    assert emits == [(V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.decay", pytest.approx(0.3)))]


def test_a_kit_move_leaves_a_hand_tuned_pads_deviation_alone(emits):
    scheduled = []
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    rack = make_rack([pad(36 + i, drumcell(values={"Decay": 0.5})) for i in range(3)])
    comp.write(rack, PATH, "decay", 0.5)
    scheduled.clear()
    # Two pads move by −0.2 (the kit) and one by −0.3 (the kit move plus a
    # hand tune of −0.1 on that pad).
    hand_edit(decay(rack, 36), 0.3)
    hand_edit(decay(rack, 37), 0.3)
    hand_edit(decay(rack, 38), 0.2)
    scheduled[0][1]()
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.3)
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"38:Decay": pytest.approx(-0.1)}


def test_a_stale_read_inside_the_window_is_our_write_still_landing(emits):
    scheduled = []
    now = [1000.0]
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    comp._clock = lambda: now[0]
    rack = two_pad_kit(0.5, 0.5)
    comp.write(rack, PATH, "decay", 0.5)
    comp.write(rack, PATH, "decay", 0.8)
    scheduled.clear()
    # The pad reads one write behind (measured on the rig, ADR-429).
    hand_edit(decay(rack, 37), 0.5)
    now[0] += STALE_READ_WINDOW_MS / 1000.0 / 2
    scheduled[0][1]()
    assert comp.debug_state(PATH)["deviations"] == {}
    # Past the window the same read is the user's own.
    scheduled.clear()
    hand_edit(decay(rack, 37), 0.5)
    now[0] += STALE_READ_WINDOW_MS / 1000.0 * 2
    scheduled[0][1]()
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"37:Decay": pytest.approx(-0.3)}


def test_switches_enums_and_pitch_carry_no_deviation(comp):
    rack = unmapped_kit(2)
    comp.read(rack, PATH, "fx1")
    comp.read(rack, PATH, "fxType")
    comp.read(rack, PATH, "pitch")
    cell = cells(rack)[0]
    # A two-state switch follows the measured macro threshold, fxType is a
    # choice not an amount, and pitch keeps its own ``_PadPitch`` offsets.
    assert param(cell, "FX On").listeners == []
    assert param(cell, "FX Type").listeners == []
    assert param(cell, "Transpose").listeners == []
    # A continuous fx1 member is watched like any other.
    assert len(param(cell, "Pitch Env Amt").listeners) == 1


def test_a_mapped_kit_carries_no_deviations_and_no_member_listeners(comp):
    rack = mapped_kit(2)
    comp.read(rack, PATH, "decay")
    assert comp.debug_state(PATH)["deviations"] == {}
    # Only the pads' chain volumes, which no macro holds.
    assert comp.debug_state(PATH)["watching"] == 2
    assert param(cells(rack)[0], "Decay").listeners == []


def test_member_listeners_are_detached_on_release(comp):
    rack = two_pad_kit()
    comp.subscribe(rack, PATH, "decay")
    assert decay(rack, 36).listeners != []
    comp.release(PATH)
    assert decay(rack, 36).listeners == []
    assert decay(rack, 37).listeners == []


def test_member_listeners_are_replaced_not_stacked_on_a_re_resolve(comp):
    rack = two_pad_kit()
    comp.subscribe(rack, PATH, "decay")
    for _ in range(3):
        rack.fire("chains")               # no scheduler wired → re-seeds inline
    assert len(decay(rack, 36).listeners) == 1


def test_the_absorb_is_scheduled_once_for_a_burst(emits):
    scheduled = []
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    rack = make_rack([pad(36 + i, drumcell()) for i in range(8)])
    comp.write(rack, PATH, "decay", 0.5)
    scheduled.clear()
    for i in range(8):
        hand_edit(decay(rack, 36 + i), 0.1 * i)
    assert len(scheduled) == 1


def test_a_pad_added_after_seeding_keeps_what_it_holds(comp):
    rack = make_rack([pad(36, drumcell(values={"Decay": 0.5}))])
    comp.write(rack, PATH, "decay", 0.5)
    rack.drum_pads[40] = pad(40, drumcell(values={"Decay": 0.9}))
    rack.fire("drum_pads")
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"40:Decay": pytest.approx(0.4)}
    comp.write(rack, PATH, "decay", 0.4)
    assert decay(rack, 40).value == pytest.approx(0.8)


def test_rack_macro_functions_carry_deviations_too(comp):
    rack = ethnic_kit(2)
    m0 = param(cells(rack)[0], "Attack")
    m1 = param(cells(rack)[1], "Attack")
    comp.write(rack, PATH, "macro.Attack", 0.5)
    assert [m0.value, m1.value] == [pytest.approx(63.5), pytest.approx(63.5)]
    hand_edit(m1, 95.25)                              # +0.25 of the macro's travel
    assert comp.debug_state(PATH)["deviations"]["macro.Attack"] == {
        "37:Attack": pytest.approx(0.25),
    }
    comp.write(rack, PATH, "macro.Attack", 0.25)
    assert [m0.value, m1.value] == [pytest.approx(31.75), pytest.approx(63.5)]


# --- per-pad rows + the selected pad (2026-09-08) ---------------------------
#
# The wire a pad grid needs: the census lists the pads, ``vm.selectedPad``
# is Live's own selection both ways, and ``vm.pad.<note>.<fn>`` reads and
# writes one pad's value — absolute on the wire, stored as that pad's
# deviation from the kit value so the next kit gesture carries it.


def test_pad_function_parsing():
    assert parse_pad_function("pad.38.decay") == (38, "decay")
    assert parse_pad_function("pad.0.pitch") == (0, "pitch")
    assert parse_pad_function("pad.127.fxType") == (127, "fxType")
    assert parse_pad_function("pad.37.macro.Pitch Attack") == (37, "macro.Pitch Attack")
    for bad in ("pad.", "pad.38", "pad.38.", "pad.x.decay", "pad.128.decay", "pad.-1.decay",
                "pad.38.bogus", "pad.38.macro.", "decay", "macro.Attack", "", None, 38):
        assert parse_pad_function(bad) is None, bad
    assert is_pad_property("vm.pad.38.decay")
    assert is_pad_property("vm.pad.38.macro.Attack")
    assert not is_pad_property("vm.pad.")
    assert not is_pad_property("vm.pad.38.bogus")
    assert not is_pad_property("vm.decay")
    assert PAD_PROPERTY_PREFIX == "vm.pad."
    assert SELECTED_PAD_PROPERTY == "vm.selectedPad" and SELECTED_PAD_KEY == "selectedPad"


def test_census_lists_the_pads_in_note_order_with_names_and_classes(comp):
    rack = make_rack([
        pad(38, drumcell()),
        pad(36, simpler()),
        FakePad(40, [FakeChain([FakeDevice("Eq8", type_=2)])]),      # effect-only chain
        pad(45, FakeDevice("Operator")),
    ])
    # The sample pads read their instruments (ADR-439); the Operator pad its chain.
    rack.drum_pads[36].chains[0].devices[0].name = "Kick Plastic 90s Heavy Rock"
    rack.drum_pads[38].chains[0].devices[0].name = "  Snare Stick Hit 3 "
    rack.drum_pads[36].chains[0].color = 0x85961F          # the Croydon kick's olive
    rack.drum_pads[38].chains[0].color = 0xFFFFFF
    rack.drum_pads[45].chains[0].color = "not a colour"
    m = members(comp, rack)
    assert m["pads"] == [
        {"note": 36, "name": "Kick Plastic 90s Heavy R", "class": "OriginalSimpler", "color": 0x85961F},
        {"note": 38, "name": "Snare Stick Hit 3", "class": "DrumCell", "color": 0xFFFFFF},
        {"note": 40, "name": "Pad 40", "class": None, "color": None},
        {"note": 45, "name": "Pad 45", "class": "Operator", "color": None},
    ]
    assert len(m["pads"][0]["name"]) == PAD_NAME_MAX
    assert m["padCount"] == 4
    assert CENSUS_BYTES_SOFT_CAP < 9216


def test_census_names_a_swapped_pad_after_its_instrument_not_its_stale_chain(comp):
    # Measured on the Plymouth kit, 2026-09-15: pad 38's chain still reads the
    # sample the kit was built with, its Drum Sampler the one a swap loaded.
    rack = make_rack([pad(36, drumcell()), pad(38, drumcell())])
    rack.drum_pads[38].name = "Snare-SessionDry-Stick-Hit-Soft"
    rack.drum_pads[38].chains[0].devices[0].name = "Snare-SessionDry-Stick-Hit-Medium"
    names = {p["note"]: p["name"] for p in members(comp, rack)["pads"]}
    assert names[38] == "Snare-SessionDry-Stick-Hit-Medium"[:PAD_NAME_MAX]


def test_census_keeps_the_chain_name_where_the_instrument_is_not_named_after_a_sample(comp):
    rack = make_rack([pad(36, drumcell()), pad(38, simpler()), pad(40, FakeDevice("Operator"))])
    rack.drum_pads[36].name = "Kick"
    rack.drum_pads[36].chains[0].devices[0].name = "Drum Sampler"   # Live's name before a sample
    rack.drum_pads[38].name = "Snare"
    rack.drum_pads[38].chains[0].devices[0].name = "Simpler"
    rack.drum_pads[40].name = "Tom FM"                               # the device reads "Operator"
    names = {p["note"]: p["name"] for p in members(comp, rack)["pads"]}
    assert names == {36: "Kick", 38: "Snare", 40: "Tom FM"}


def test_a_pad_instrument_renamed_in_live_re_emits_the_census(comp, emits):
    # ADR-439 open question 5: a swap made in Live's own UI renames the Drum
    # Sampler and moves nothing else this component watches.
    rack = make_rack([pad(36, drumcell()), pad(38, drumcell())])
    rack.drum_pads[38].chains[0].devices[0].name = "Snare Old"
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    emits.clear()
    rack.drum_pads[38].chains[0].devices[0].rename("Snare New")    # no scheduler wired → inline
    census = [args for a, args in emits if a == V3_PROPERTY_VALUE_ADDRESS and args[1] == MEMBERS_PROPERTY]
    assert census, "the rename re-emitted no census"
    names = {p["note"]: p["name"] for p in json.loads(census[-1][2])["pads"]}
    assert names[38] == "Snare New"


def test_name_listeners_ride_the_sample_pads_only_and_are_replaced_not_stacked(comp):
    rack = make_rack([pad(36, drumcell()), pad(38, simpler()), pad(40, FakeDevice("Operator"))])
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    cell, simp, op = (rack.drum_pads[n].chains[0].devices[0] for n in (36, 38, 40))
    assert len(cell.name_listeners) == 1 and len(simp.name_listeners) == 1
    assert op.name_listeners == []            # its name is the device's, not the sound's
    for _ in range(3):
        rack.fire("chains")                   # no scheduler wired → re-resolves inline
    assert len(cell.name_listeners) == 1
    comp.release(PATH)
    assert cell.name_listeners == [] and simp.name_listeners == []


def test_disconnect_detaches_the_name_listeners(comp):
    rack = make_rack([pad(36, drumcell())])
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    comp.disconnect()
    assert rack.drum_pads[36].chains[0].devices[0].name_listeners == []


def test_census_pads_follow_the_rack(comp):
    rack = unmapped_kit(2)
    assert [p["note"] for p in members(comp, rack)["pads"]] == [36, 37]
    rack.drum_pads[50] = pad(50, drumcell())
    rack.fire("drum_pads")
    assert [p["note"] for p in members(comp, rack)["pads"]] == [36, 37, 50]


def test_census_follows_a_preset_loaded_into_the_same_rack(comp, emits):
    """The reported bug: load a Sampler kit over a DrumCell kit and the
    central view kept the DrumCell layout, the old pad names and the old
    values.

    Measured on the rig (2026-09-15), a preset load into an existing Drum
    Rack changes the rack's ``name`` and **nothing else observable** — same
    ``_live_ptr`` on the chains, the pads, the devices and every
    DeviceParameter, and the pad chains' ``devices`` listeners never fire.
    So the rack's name is the only signal there is, and with nothing
    watching it no re-resolve ran: ``_kit_replaced`` was unreachable and the
    census was never re-emitted.
    """
    rack = make_rack([pad(36, drumcell())])
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    assert members(comp, rack)["padClasses"] == {"DrumCell": 1}
    emits.clear()

    rack.load_kit("Jazz Kit", [pad(36, simpler())])

    census = json.loads(values(emits, "vm." + MEMBERS_KEY)[-1][2])
    assert census["padClasses"] == {"OriginalSimpler": 1}
    # The view's profile follows the census, so this is the layout changing.
    assert [p["class"] for p in census["pads"]] == ["OriginalSimpler"]


def test_a_similar_sample_swap_does_not_read_as_a_new_kit(comp, emits):
    """ADR-439 renames the chains and the instruments, never the rack — which
    is why the rack's name is the signal with the least noise. A swap must
    still re-emit the census (the instruments' own ``name`` listeners), but
    it must not drop the per-pad records the way a kit load does."""
    rack = make_rack([pad(36, drumcell(values={"Decay": 0.5}))])
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    comp.write(rack, PATH, "pad.36.decay", 0.9)
    before = comp._states[PATH].kit_name
    instrument = rack.drum_pads[36].chains[0].devices[0]

    instrument.rename("Snare-SessionDry-Stick-Hit-Medium")

    # The rack's name never moved, so the records survive the swap.
    assert comp._states[PATH].kit_name == before
    assert comp.read(rack, PATH, "pad.36.decay") == pytest.approx(0.9)


def test_census_follows_a_pad_whose_instrument_is_replaced(comp, emits):
    """A pad's instrument swapped out — a similar-sound swap that replaces
    the device rather than renaming it, or a hot-swap in Live — fires the
    pad chain's own ``devices`` listener and nothing on the rack.

    The component watches the chains through the shared
    ``PadChainWatcher`` for exactly this: without a listener there the
    census kept the replaced instrument's class and name, and the ADR-439
    ``name`` listener stayed attached to an instrument that had gone.
    """
    rack = make_rack([pad(36, drumcell())])
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    assert members(comp, rack)["padClasses"] == {"DrumCell": 1}
    chain = rack.drum_pads[36].chains[0]
    emits.clear()

    chain.delete_device(0)
    chain.insert(0, simpler())

    # The chain's fire re-resolved the rack and pushed the census.
    census = json.loads(values(emits, "vm." + MEMBERS_KEY)[-1][2])
    assert census["padClasses"] == {"OriginalSimpler": 1}
    # And the name listener moved with it, so the *next* rename still lands.
    st = comp._states[PATH]
    assert [d for d, _cb in st.name_listeners] == [chain.devices[0]]


def test_pad_chain_listeners_are_let_go_with_the_rack(comp):
    """The watcher is the component's, so a release takes its chain
    listeners with it — a kit left holding them would keep re-resolving a
    rack nobody is subscribed to."""
    rack = unmapped_kit(2)
    comp.subscribe(rack, PATH, MEMBERS_KEY)
    chains = [p.chains[0] for p in (rack.drum_pads[36], rack.drum_pads[37])]
    assert [c.listener_count() for c in chains] == [1, 1]
    comp.release(PATH)
    assert [c.listener_count() for c in chains] == [0, 0]


def test_selected_pad_reads_lives_selection(comp):
    rack = unmapped_kit(3)
    assert comp.read(rack, PATH, SELECTED_PAD_KEY) == 36
    rack.view.selected_drum_pad = rack.drum_pads[38]
    assert comp.read(rack, PATH, SELECTED_PAD_KEY) == 38
    rack.view.selected_drum_pad = None
    assert comp.read(rack, PATH, SELECTED_PAD_KEY) is None


def test_selected_pad_write_selects_in_live_and_the_listener_re_emits(comp, emits):
    rack = unmapped_kit(3)
    comp.subscribe(rack, PATH, SELECTED_PAD_KEY)
    ok, stored, detail = comp.write(rack, PATH, SELECTED_PAD_KEY, 37.0)
    assert (ok, stored, detail) == (True, 37, "")
    assert rack.view.selected_drum_pad is rack.drum_pads[37]
    # Live's own listener fired on our write and pushed the row.
    assert emits == [(V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.selectedPad", 37))]
    emits.clear()
    # A pad tapped in Live reaches the subscribers the same way.
    rack.view.selected_drum_pad = rack.drum_pads[38]
    assert emits == [(V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.selectedPad", 38))]
    # An empty pad can be selected too (Live allows it).
    assert comp.write(rack, PATH, SELECTED_PAD_KEY, 100)[0] is True
    assert rack.view.selected_drum_pad is rack.drum_pads[100]


def test_selected_pad_write_rejects_bad_notes(comp):
    rack = unmapped_kit(1)
    for bad in ("x", None, 128, -1):
        ok, stored, detail = comp.write(rack, PATH, SELECTED_PAD_KEY, bad)
        assert ok is False and stored is None and detail, bad
    assert rack.view.selected_drum_pad is rack.drum_pads[36]


def test_selected_pad_listener_is_detached_on_release_and_not_stacked(comp):
    rack = unmapped_kit(1)
    comp.subscribe(rack, PATH, SELECTED_PAD_KEY)
    assert len(rack.view.listeners) == 1
    rack.fire("chains")
    assert len(rack.view.listeners) == 1
    comp.release(PATH)
    assert rack.view.listeners == []


def test_pad_row_reads_the_pads_own_value(comp):
    rack = make_rack([
        pad(36, drumcell(values={"Decay": 0.2, "Transpose": 3.0, "FX Type": 5})),
        pad(37, drumcell(values={"Decay": 0.9, "Transpose": -7.0, "FX Type": 1})),
    ])
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.2)           # the kit: pad 36
    assert comp.read(rack, PATH, "pad.36.decay") == pytest.approx(0.2)
    assert comp.read(rack, PATH, "pad.37.decay") == pytest.approx(0.9)
    assert comp.read(rack, PATH, "pad.37.pitch") == -7
    assert comp.read(rack, PATH, "pad.37.fxType") == 1
    assert comp.read(rack, PATH, "pad.37.fx1") == pytest.approx(0.0)     # first continuous fx1 member
    # No such pad / no member on that pad → nil.
    assert comp.read(rack, PATH, "pad.50.decay") is None
    assert comp.read(rack, PATH, "pad.36.oscAmount") is None


def test_pad_row_pitch_reads_without_the_sequencer_shift(comp):
    rack = make_rack([pad(36, drumcell(values={"Transpose": 2.0}))])
    comp.read(rack, PATH, "pitch")
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    assert param(cells(rack)[0], "Transpose").value == 14
    assert comp.read(rack, PATH, "pad.36.pitch") == 2


def test_pad_row_write_moves_that_pad_only_and_keeps_the_kit_value(comp, emits):
    rack = make_rack([pad(36 + i, drumcell(values={"Decay": 0.5})) for i in range(3)])
    comp.subscribe(rack, PATH, "decay")
    comp.write(rack, PATH, "decay", 0.5)
    emits.clear()
    ok, stored, detail = comp.write(rack, PATH, "pad.37.decay", 0.8)
    assert (ok, stored, detail) == (True, pytest.approx(0.8), "")
    assert [decay(rack, n).value for n in (36, 37, 38)] == [0.5, pytest.approx(0.8), 0.5]
    assert comp.read(rack, PATH, "decay") == pytest.approx(0.5)
    assert emits == []                                    # the kit row did not move
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"37:Decay": pytest.approx(0.3)}
    # The next kit gesture carries the pad at its new distance.
    comp.write(rack, PATH, "decay", 0.6)
    assert [decay(rack, n).value for n in (36, 37, 38)] == [
        pytest.approx(0.6), pytest.approx(0.9), pytest.approx(0.6),
    ]


def test_pad_row_write_is_clamped_and_echoes_the_clamp(comp):
    rack = two_pad_kit(0.5, 0.5)
    ok, stored, _ = comp.write(rack, PATH, "pad.37.decay", 1.7)
    assert ok and stored == 1.0
    assert decay(rack, 37).value == 1.0
    assert comp.debug_state(PATH)["deviations"]["decay"] == {"37:Decay": pytest.approx(0.5)}


def test_pad_row_switch_follows_the_pads_own_amount(comp):
    rack = unmapped_kit(2)
    comp.write(rack, PATH, "fx1", 0.0)
    a, b = cells(rack)
    comp.write(rack, PATH, "pad.37.fx1", 0.4)
    assert param(b, "FX On").value == 1 and param(b, "Sub Amt").value == pytest.approx(0.4)
    assert param(a, "FX On").value == 0 and param(a, "Sub Amt").value == pytest.approx(0.0)
    comp.write(rack, PATH, "pad.37.fx1", 0.0)
    assert param(b, "FX On").value == 0


def test_pad_row_fx_type_sets_one_pads_type(comp):
    rack = unmapped_kit(2)
    comp.write(rack, PATH, "fxType", 2)
    ok, stored, _ = comp.write(rack, PATH, "pad.37.fxType", 6.4)
    assert ok and stored == 6
    a, b = cells(rack)
    assert param(a, "FX Type").value == 2 and param(b, "FX Type").value == 6
    assert comp.read(rack, PATH, "fxType") == 2
    assert comp.read(rack, PATH, "pad.37.fxType") == 6


def test_pad_row_pitch_sets_that_pads_offset_and_rides_the_kit_from_then_on(comp):
    rack = make_rack([pad(36 + i, drumcell(values={"Transpose": 0.0})) for i in range(3)])
    comp.write(rack, PATH, "pitch", 0)
    ok, stored, _ = comp.write(rack, PATH, "pad.37.pitch", 5.3)
    assert ok and stored == 5
    assert [param(c, "Transpose").value for c in cells(rack)] == [0, 5, 0]
    assert comp.debug_state(PATH)["offsets"] == {"37": 5}
    assert comp.read(rack, PATH, "pitch") == 0
    comp.write(rack, PATH, "pitch", 2)
    assert [param(c, "Transpose").value for c in cells(rack)] == [2, 7, 2]
    # The sequencer's octave stacks on top, and the pad row still reads
    # the user's own number.
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    assert [param(c, "Transpose").value for c in cells(rack)] == [14, 19, 14]
    assert comp.read(rack, PATH, "pad.37.pitch") == 7


def test_pad_row_pitch_under_a_held_shift_writes_the_shift_too(comp):
    rack = make_rack([pad(36, drumcell()), pad(37, drumcell())])
    comp.write(rack, PATH, "pitch", 0)
    assert comp.set_sequencer_shift(rack, PATH, 12) is True
    comp.write(rack, PATH, "pad.37.pitch", -3)
    assert param(cells(rack)[1], "Transpose").value == 9           # −3 + the octave
    assert comp.read(rack, PATH, "pad.37.pitch") == -3
    assert comp.set_sequencer_shift(rack, PATH, 0) is True
    assert [param(c, "Transpose").value for c in cells(rack)] == [0, -3]


def test_pad_row_on_a_mapped_family_kit_is_dropped(comp, caplog):
    rack = mapped_kit(2)
    comp.write(rack, PATH, "pad.37.decay", 0.8)
    assert all(param(c, "Decay").writes == [] for c in cells(rack))
    assert "still macro-mapped" in caplog.text


def test_pad_row_on_a_pad_without_a_member_is_dropped(comp, caplog):
    rack = make_rack([pad(36, simpler()), pad(37, drumcell())])
    ok, stored, _ = comp.write(rack, PATH, "pad.36.fx1", 0.5)        # a Simpler has no FX
    assert ok is True and stored == 0.5                               # stored + echoed, nothing moved
    assert "no member on pad 36" in caplog.text
    assert param(cells(rack)[1], "Sub Amt").writes == []


def test_pad_row_on_a_rack_macro_kit_writes_one_pads_macro(comp):
    rack = ethnic_kit(3)
    comp.write(rack, PATH, "macro.Attack", 0.5)
    comp.write(rack, PATH, "pad.37.macro.Attack", 0.75)
    assert [rack_macro(rack, n, "Attack").value for n in (36, 37, 38)] == [
        pytest.approx(63.5), pytest.approx(95.25), pytest.approx(63.5),
    ]
    assert comp.read(rack, PATH, "pad.37.macro.Attack") == pytest.approx(0.75)
    assert comp.read(rack, PATH, "macro.Attack") == pytest.approx(0.5)
    # Its transpose macro is the pad's pitch, in semitones.
    comp.write(rack, PATH, "pad.37.pitch", 12)
    assert rack_macro(rack, 37, "Transpose").value == pytest.approx(st_to_macro(12))
    assert rack_macro(rack, 36, "Transpose").value == pytest.approx(63.5)
    assert comp.read(rack, PATH, "pad.37.pitch") == 12


def test_pad_row_sets_coalesce_to_the_latest_per_pass(emits):
    comp = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)))
    comp.enable_deferred_apply()
    rack = two_pad_kit(0.5, 0.5)
    for v in (0.1, 0.2, 0.3):
        comp.write(rack, PATH, "pad.37.decay", v)
    comp.write(rack, PATH, "pad.36.decay", 0.9)
    assert decay(rack, 37).writes == []
    assert comp.flush() == 2
    assert decay(rack, 37).writes == [pytest.approx(0.3)]
    assert decay(rack, 36).writes == [pytest.approx(0.9)]


def test_pad_row_apply_rides_the_gesture_undo_step(emits):
    song = FakeSong()
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)), schedule_delayed=None, song=song,
    )
    comp.enable_deferred_apply()
    rack = two_pad_kit(0.5, 0.5)
    comp.write(rack, PATH, "pad.37.decay", 0.8)
    comp.write(rack, PATH, "pad.36.decay", 0.2)
    comp.flush()
    assert (song.begins, song.ends) == (1, 1)


def test_a_hand_edit_re_emits_the_pads_row(comp, emits):
    rack = two_pad_kit(0.5, 0.5)
    comp.subscribe(rack, PATH, "pad.37.decay")
    comp.subscribe(rack, PATH, "pad.36.decay")
    comp.write(rack, PATH, "decay", 0.5)
    emits.clear()
    hand_edit(decay(rack, 37), 0.8)
    assert emits == [(V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.pad.37.decay", pytest.approx(0.8)))]


def test_a_kit_move_re_emits_every_subscribed_pad_row(emits):
    scheduled = []
    comp = DrumVirtualMacroComponent(
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    rack = make_rack([pad(36 + i, drumcell(values={"Decay": 0.5})) for i in range(3)])
    for n in (36, 38):
        comp.subscribe(rack, PATH, "pad.%d.decay" % n)
    comp.write(rack, PATH, "decay", 0.5)
    scheduled.clear()
    emits.clear()
    for i in range(3):
        hand_edit(decay(rack, 36 + i), 0.3)
    scheduled[0][1]()
    assert emits == [
        (V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.pad.36.decay", pytest.approx(0.3))),
        (V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.pad.38.decay", pytest.approx(0.3))),
    ]


def test_a_re_seed_re_emits_subscribed_pad_rows(comp, emits):
    rack = two_pad_kit(0.4, 0.6)
    comp.subscribe(rack, PATH, "pad.37.decay")
    comp.subscribe(rack, PATH, SELECTED_PAD_KEY)
    emits.clear()
    rack.fire("chains")
    assert (V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.pad.37.decay", pytest.approx(0.6))) in emits
    assert (V3_PROPERTY_VALUE_ADDRESS, (PATH, "vm.selectedPad", 36)) in emits


def test_pad_row_subscriptions_hold_the_state_and_release_when_last(comp):
    rack = two_pad_kit()
    comp.subscribe(rack, PATH, "pad.37.decay")
    assert PATH in comp._states
    comp.unsubscribe(PATH, "pad.37.decay")
    assert PATH not in comp._states


def test_spec_for_synthesises_pad_rows_and_lists_the_selected_pad():
    spec = spec_for("DrumGroupDevice", "vm.pad.38.decay")
    assert spec is not None and spec.computed == PROVIDER_NAME and spec.writable is True
    assert spec.attr_name == "pad.38.decay" and spec.listener_path == ""
    assert spec_for("DrumGroupDevice", "vm.pad.38.decay") is spec
    assert spec_for("DrumGroupDevice", "vm.pad.38.macro.Attack").attr_name == "pad.38.macro.Attack"
    for bad in ("vm.pad.", "vm.pad.38", "vm.pad.x.decay", "vm.pad.200.decay", "vm.pad.38.bogus"):
        assert spec_for("DrumGroupDevice", bad) is None, bad
    assert spec_for("OriginalSimpler", "vm.pad.38.decay") is None
    sel = ALLOWLIST[("DrumGroupDevice", "vm.selectedPad")]
    assert sel.computed == PROVIDER_NAME and sel.writable is True and sel.attr_name == "selectedPad"
    assert spec_for("OriginalSimpler", "vm.selectedPad") is None


def test_pad_rows_and_the_selected_pad_ride_the_channel(comp, emits, generation):
    rack = make_rack([pad(36, drumcell(values={"Decay": 0.5})), pad(37, drumcell(values={"Decay": 0.5}))])
    _song, pc = property_component(rack, emits, generation, {PROVIDER_NAME: comp})
    pc.handle_subscribe(args=(PATH, "vm.pad.37.decay"), source_addr=None)
    pc.handle_subscribe(args=(PATH, "vm.selectedPad"), source_addr=None)
    pc.handle_subscribe(args=(PATH, "vm.decay"), source_addr=None)
    assert values(emits, "vm.pad.37.decay") == [(PATH, "vm.pad.37.decay", pytest.approx(0.5))]
    assert values(emits, "vm.selectedPad") == [(PATH, "vm.selectedPad", 36)]
    emits.clear()
    pc.handle_set(args=(PATH, "vm.pad.37.decay", 0.8, generation.current), source_addr=None)
    assert values(emits, "vm.pad.37.decay") == [(PATH, "vm.pad.37.decay", pytest.approx(0.8))]
    assert values(emits, "vm.decay") == []                # the kit row is untouched
    assert decay(rack, 37).value == pytest.approx(0.8) and decay(rack, 36).value == 0.5
    emits.clear()
    pc.handle_set(args=(PATH, "vm.selectedPad", 37, generation.current), source_addr=None)
    # handle_set's echo, then the rack view's own listener — both carry 37.
    assert [v[2] for v in values(emits, "vm.selectedPad")] == [37, 37]
    assert rack.view.selected_drum_pad is rack.drum_pads[37]
    assert errors(emits) == []
    pc.handle_subscribe(args=(PATH, "vm.pad.38.bogus"), source_addr=None)
    assert errors(emits)[-1][4] == V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED
    pc.handle_unsubscribe(args=(PATH, "vm.pad.37.decay"), source_addr=None)
    pc.handle_unsubscribe(args=(PATH, "vm.selectedPad"), source_addr=None)
    pc.handle_unsubscribe(args=(PATH, "vm.decay"), source_addr=None)
    assert PATH not in comp._states


# --- a pad's own sequencer term (ADR-435, 2026-09-14) -----------------------------
#
# A Permute inside a pad's chain holds its octave on that pad alone,
# through ``set_pad_sequencer_shift``: ``pitch = global + offset + kit
# shift + pad shift``. The kit's term and the pad's compose (the user's
# rule), the pad row reads without either, a held term keeps the state
# alive and survives a re-seed, and a pad that cannot move on its own —
# a mapped kit, a pad with no enabled pitch member — refuses it.


def test_pad_shift_moves_one_pad_and_composes_with_the_kit_shift(comp):
    rack = make_rack([pad(36, drumcell()), pad(37, drumcell(values={"Transpose": 3.0})), pad(38, drumcell())])
    comp.write(rack, PATH, "pitch", 0)
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 12) is True
    assert [param(c, "Transpose").value for c in cells(rack)] == [0, 15, 0]
    assert comp.pad_sequencer_shift(PATH, 37) == 12 and comp.pad_sequencer_shift(PATH, 36) == 0
    assert comp.debug_state(PATH)["padShifts"] == {"37": 12}
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 12) is False       # already held: nothing written
    assert comp.set_sequencer_shift(rack, PATH, 12) is True                 # the kit's octave on top
    assert [param(c, "Transpose").value for c in cells(rack)] == [12, 27, 12]
    comp.write(rack, PATH, "pitch", 2)                                      # a kit gesture carries both terms
    assert [param(c, "Transpose").value for c in cells(rack)] == [14, 29, 14]
    assert comp.read(rack, PATH, "pad.37.pitch") == 5                       # the pad row: neither term
    assert comp.read(rack, PATH, "pitch") == 2
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 0) is True
    assert [param(c, "Transpose").value for c in cells(rack)] == [14, 17, 14]
    assert comp.set_sequencer_shift(rack, PATH, 0) is True
    assert [param(c, "Transpose").value for c in cells(rack)] == [2, 5, 2]
    assert comp.debug_state(PATH)["padShifts"] == {}


def test_pad_shift_is_one_undo_step_and_clamps_at_the_rail(emits):
    song = FakeSong()
    comp = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)), song=song)
    rack = make_rack([pad(36, drumcell(values={"Transpose": 40.0})), pad(37, drumcell())])
    comp.write(rack, PATH, "pitch", 40)
    begins = song.begins
    assert comp.set_pad_sequencer_shift(rack, PATH, 36, 12) is True
    assert song.begins == begins + 1 and song.ends == song.begins           # opened and closed around the write
    assert param(cells(rack)[0], "Transpose").value == 48                   # +12 from 40, clamped
    assert comp.set_pad_sequencer_shift(rack, PATH, 36, 0) is True
    assert param(cells(rack)[0], "Transpose").value == 40


def test_pad_shift_keeps_the_state_alive_and_survives_a_reseed(comp):
    rack = make_rack([pad(36, drumcell()), pad(37, drumcell())])
    comp.subscribe(rack, PATH, "pitch")
    comp.read(rack, PATH, "pitch")
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 12) is True
    comp.unsubscribe(PATH, "pitch")
    assert PATH in comp._states                                             # held by the pad's term alone
    rack.fire("chains")                                                     # a re-seed, inline (no scheduler)
    assert comp.pad_sequencer_shift(PATH, 37) == 12
    assert comp.debug_state(PATH)["offsets"] == {}                          # the term did not become an offset
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 0) is True
    assert param(cells(rack)[1], "Transpose").value == 0


def test_pad_shift_is_refused_where_a_pad_cannot_move_on_its_own(comp, caplog):
    mapped = mapped_kit(2)
    comp.read(mapped, PATH, "pitch")
    assert comp.set_pad_sequencer_shift(mapped, PATH, 37, 12) is False
    assert "still macro-mapped" in caplog.text
    rack = make_rack([pad(36, drumcell()), pad(37, FakeDevice("Operator", [FakeParam("Device On", 1.0)]))])
    other_path = "tracks/1/devices/0"
    comp.read(rack, other_path, "pitch")
    assert comp.set_pad_sequencer_shift(rack, other_path, 37, 12) is False   # no pitch member on that pad
    assert comp.set_pad_sequencer_shift(rack, other_path, 50, 12) is False   # no such pad
    assert "no enabled pitch member" in caplog.text
    assert comp.set_pad_sequencer_shift(rack, other_path, 36, "x") is False
    assert comp.set_pad_sequencer_shift(rack, other_path, "x", 12) is False
    # A restore for a rack this component never held puts nothing back
    # and holds nothing.
    stranger = make_rack([pad(36, drumcell())])
    assert comp.set_pad_sequencer_shift(stranger, "tracks/2/devices/0", 36, 0) is False
    assert "tracks/2/devices/0" not in comp._states


def test_the_ui_pad_write_rides_a_held_pad_shift(comp):
    rack = make_rack([pad(36, drumcell()), pad(37, drumcell())])
    comp.write(rack, PATH, "pitch", 0)
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 12) is True
    comp.write(rack, PATH, "pad.37.pitch", -3)                              # the user's number, the term on top
    assert param(cells(rack)[1], "Transpose").value == 9
    assert comp.read(rack, PATH, "pad.37.pitch") == -3
    assert comp.set_pad_sequencer_shift(rack, PATH, 37, 0) is True
    assert param(cells(rack)[1], "Transpose").value == -3
    assert comp.debug_state(PATH)["offsets"] == {"37": -3}
