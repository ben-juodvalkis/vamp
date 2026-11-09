"""SetlistComponent (ADR-519): one song and one sound on, Live's Device On
values as the only state, and asking never changing anything."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from components.SetlistComponent import (
    SETTLE_SECONDS,
    SetlistComponent,
    V3_SETLIST_STATE_ADDRESS,
    split_song_name,
)

RACK = "InstrumentGroupDevice"


class Param:
    min = 0.0
    max = 127.0

    def __init__(self, name, value):
        self.name = name
        self.value = value


class Device:
    def __init__(self, on=False, class_name=RACK, chains=()):
        self.class_name = class_name
        self.parameters = [Param("Device On", 1.0 if on else 0.0)]
        self.chains = list(chains)
        self.view = SimpleNamespace(selected_chain=None)

    @property
    def on(self):
        return self.parameters[0].value == 1.0


class Chain:
    def __init__(self, name, devices):
        self.name = name
        self.devices = list(devices)


class Track:
    def __init__(self, name, devices):
        self.name = name
        self.devices = list(devices)


class Song:
    def __init__(self, tracks):
        self.tracks = tracks
        self.tempo = 120.0
        self.undo_steps = 0
        self.undo_open = 0

    def begin_undo_step(self):
        self.undo_open += 1
        self.undo_steps += 1

    def end_undo_step(self):
        self.undo_open -= 1


def macros(name, *pairs):
    """An Audio Effect Rack: Device On, then eight macros, unnamed past `pairs`."""
    rack = Device(on=True, class_name="AudioEffectGroupDevice")
    rack.name = name
    filled = list(pairs) + [("Macro %d" % n, 0.0) for n in range(len(pairs) + 1, 9)]
    rack.parameters += [Param(n, v) for n, v in filled]
    rack.parameters.append(Param("Chain Selector", 0.0))
    return rack


def sound_rack(name):
    """A sound's rack. Ram Birds is a bare plug-in; Lead's macros are named."""
    if name == "Ram Birds":
        plugin = Device(class_name="AuPluginDevice")
        plugin.parameters += [Param("Cutoff", 10.0), Param("Res", 20.0), Param("A", 1.0), Param("B", 2.0)]
        return plugin
    rack = Device()
    names = ["Delay Time", "Delay Feedback", "Macro 3", "."] if name == "Lead" else ["Macro %d" % n for n in range(1, 5)]
    rack.parameters += [Param(n, 10.0 * (i + 1)) for i, n in enumerate(names)]
    rack.parameters += [Param("Macro %d" % n, 99.0) for n in range(5, 9)]
    return rack


def effect_racks():
    return [
        macros("Output", ("Output", 100.0)),
        macros("LOOPER"),
        macros("MFX 1", ("Stutter", 127.0), ("Variation", 0.0), ("Macro 3", 0.0), ("Macro 4", 0.0),
               ("Shape", 64.0), ("Macro 6", 125.0)),
    ]


clock = {"now": 0.0}


def build():
    """Three songs as the rig's set has them, every rack on and sound off."""
    sounds = {
        "Joke 144": ["Lead", "Organ"],
        "Pommel Horse160": ["Ram Lead", "Ram Birds", "Deep Organ"],
        "Blank": ["Piano"],
    }
    songs = [
        Chain(name, [Device(on=True, chains=[Chain(s, [sound_rack(s)]) for s in parts])])
        for name, parts in sounds.items()
    ]
    midi_rack = Device(class_name="MidiEffectGroupDevice", chains=[Chain("wrong", [])])
    instruments = Device(on=True, chains=songs)
    keys = Track("Keys", [midi_rack, instruments] + effect_racks())
    song = Song([Track("Other", [Device(chains=[Chain("wrong", [Device()])])]), keys])
    sent = []
    clock["now"] = 0.0
    component = SetlistComponent(
        song=song, emit=lambda a, args: sent.append((a, args)), clock=lambda: clock["now"]
    )
    clock["now"] = SETTLE_SECONDS
    return song, songs, component, sent


def last_state(sent):
    address, args = sent[-1]
    assert address == V3_SETLIST_STATE_ADDRESS
    return json.loads(args[0])


def on_map(songs):
    """Every device's Device On, song rack and sounds."""
    return {
        song.name: (
            song.devices[0].on,
            [sound.devices[0].on for sound in song.devices[0].chains],
        )
        for song in songs
    }


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Joke 144", ("Joke", 144)),
        ("Pommel Horse160", ("Pommel Horse", 160)),
        ("Someone to Rmind You 112", ("Someone to Rmind You", 112)),
        ("Blank", ("Blank", None)),
        ("144", ("144", None)),
    ],
)
def test_split_song_name(name, expected):
    assert split_song_name(name) == expected


def test_get_reads_and_changes_nothing():
    song, songs, component, sent = build()
    before = on_map(songs)
    component.handle_get([], None)
    state = last_state(sent)
    assert state["found"] is True
    assert state["songs"] == ["Joke", "Pommel Horse", "Blank"]
    assert (state["song"], state["sound"]) == (-1, -1)
    assert state["sounds"] == ["Lead", "Organ"]
    assert on_map(songs) == before
    assert song.undo_steps == 0
    assert song.tempo == 120.0


def test_select_song_leaves_one_song_and_its_first_sound_on_and_sets_tempo():
    song, songs, component, sent = build()
    component.handle_select_song([1], None)
    assert on_map(songs) == {
        "Joke 144": (False, [False, False]),
        "Pommel Horse160": (True, [True, False, False]),
        "Blank": (False, [False]),
    }
    assert song.tempo == 160.0
    state = last_state(sent)
    assert (state["song"], state["sound"]) == (1, 0)
    assert state["sounds"] == ["Ram Lead", "Ram Birds", "Deep Organ"]
    assert (song.undo_steps, song.undo_open) == (1, 0)


def test_new_sound_goes_on_before_the_old_goes_off():
    _, songs, component, _ = build()
    component.handle_select_song([1], None)
    order = []

    class Spy(Param):
        def __setattr__(self, key, value):
            if key == "value" and hasattr(self, "value"):
                order.append((self.name, value))
            object.__setattr__(self, key, value)

    old = songs[1].devices[0].chains[0].devices[0]
    new = songs[1].devices[0].chains[2].devices[0]
    old.parameters = [Spy("Device On", 1.0)]
    new.parameters = [Spy("Device On", 0.0)]
    component.handle_select_sound([2], None)
    assert order == [("Device On", 1.0), ("Device On", 0.0)]


def test_select_sound_stays_in_the_song_and_keeps_the_tempo():
    song, songs, component, sent = build()
    component.handle_select_song([1], None)
    song.tempo = 99.0
    component.handle_select_sound([2], None)
    assert on_map(songs)["Pommel Horse160"] == (True, [False, False, True])
    assert song.tempo == 99.0
    state = last_state(sent)
    assert (state["song"], state["sound"]) == (1, 2)


def test_a_sound_tap_with_nothing_on_starts_the_first_song():
    _, songs, component, sent = build()
    component.handle_select_sound([1], None)
    assert on_map(songs)["Joke 144"] == (True, [False, True])
    assert on_map(songs)["Blank"] == (False, [False])
    assert last_state(sent)["song"] == 0


@pytest.mark.parametrize("handler,index", [("handle_select_song", 9), ("handle_select_sound", 9)])
def test_out_of_range_changes_nothing_and_still_answers(handler, index):
    song, songs, component, sent = build()
    before = on_map(songs)
    getattr(component, handler)([index], None)
    assert on_map(songs) == before
    assert song.undo_steps == 0
    assert last_state(sent)["song"] == -1


def test_a_refused_write_closes_the_undo_step_and_reports_live():
    song, songs, component, sent = build()

    class Refuses(Param):
        def __setattr__(self, key, value):
            if key == "value" and hasattr(self, "value"):
                raise RuntimeError("parameter is mapped")
            object.__setattr__(self, key, value)

    songs[1].devices[0].chains[0].devices[0].parameters = [Refuses("Device On", 0.0)]
    component.handle_select_song([1], None)
    assert song.undo_open == 0
    assert last_state(sent)["song"] == -1


def test_no_keys_track_answers_not_found():
    song, _, component, sent = build()
    song.tracks = song.tracks[:1]
    component.handle_get([], None)
    state = last_state(sent)
    assert state["found"] is False
    assert state["songs"] == []


def by_label(state):
    return {pad["label"]: pad for pad in state["pads"]}


def output_param(song):
    return song.tracks[1].devices[2].parameters[1]


def mfx(song, index):
    return song.tracks[1].devices[4].parameters[index]


def test_state_reports_the_slider_and_a_pad_per_named_pair():
    _, _, component, sent = build()
    component.handle_get([], None)
    state = last_state(sent)
    assert state["output"] == {"key": "2/1", "value": 100.0}
    assert [pad["label"] for pad in state["pads"]] == ["Stutter", "Shape"]
    assert by_label(state)["Shape"]["x"] == {"key": "4/5", "value": 64.0}
    assert by_label(state)["Shape"]["y"] == {"key": "4/6", "value": 125.0}


def test_param_writes_the_macro_clamped_and_changes_nothing_else():
    song, songs, component, _ = build()
    before = on_map(songs)
    component.handle_param(["4/1", 500.0], None)
    component.handle_param(["2/1", 30.0], None)
    assert mfx(song, 1).value == 127.0
    assert output_param(song).value == 30.0
    assert on_map(songs) == before


@pytest.mark.parametrize("key", ["4/0", "4/9", "1/1", "0/1", "junk", "99/1"])
def test_param_refuses_anything_but_an_effect_rack_macro(key):
    song, _, component, _ = build()
    device_on = mfx(song, 0).value
    instrument_on = song.tracks[1].devices[1].parameters[0].value
    component.handle_param([key, 0.0], None)
    assert mfx(song, 0).value == device_on
    assert song.tracks[1].devices[1].parameters[0].value == instrument_on


def test_a_sound_change_resets_output_to_64_and_pads_to_set_load_values():
    song, _, component, sent = build()
    component.handle_select_song([1], None)
    component.handle_param(["2/1", 10.0], None)
    component.handle_param(["4/1", 5.0], None)
    component.handle_param(["4/6", 7.0], None)
    component.handle_select_sound([1], None)
    assert output_param(song).value == 64.0
    assert mfx(song, 1).value == 127.0
    assert mfx(song, 6).value == 125.0
    state = last_state(sent)
    assert state["output"]["value"] == 64.0
    assert by_label(state)["Stutter"]["x"]["value"] == 127.0


def test_a_song_change_resets_too():
    song, _, component, _ = build()
    component.handle_param(["4/1", 5.0], None)
    component.handle_select_song([1], None)
    assert mfx(song, 1).value == 127.0
    assert output_param(song).value == 64.0


def test_tapping_the_sound_already_on_changes_nothing():
    song, _, component, sent = build()
    component.handle_select_song([1], None)
    steps = song.undo_steps
    component.handle_param(["4/1", 5.0], None)
    component.handle_select_sound([0], None)
    assert mfx(song, 1).value == 5.0
    assert song.undo_steps == steps
    assert last_state(sent)["sound"] == 0


def test_reading_state_never_moves_a_baseline():
    song, _, component, _ = build()
    component.handle_param(["4/1", 5.0], None)
    component.handle_get([], None)
    component.handle_select_song([1], None)
    assert mfx(song, 1).value == 127.0


def test_values_read_before_the_set_settles_are_never_used():
    """2026-11-08: the surface starts mid document exchange, read zeros, and
    every reset wrote those zeros over the set's real values."""
    song, _, component, sent = build()
    clock["now"] = 0.0
    component = SetlistComponent(
        song=song, emit=lambda a, args: sent.append((a, args)), clock=lambda: clock["now"]
    )
    mfx(song, 1).value = 0.0
    component.handle_get([], None)
    clock["now"] = SETTLE_SECONDS
    mfx(song, 1).value = 127.0
    component.handle_get([], None)
    component.handle_param(["4/1", 5.0], None)
    component.handle_select_song([1], None)
    assert mfx(song, 1).value == 127.0


def test_a_switch_before_the_set_settles_leaves_the_pads_alone():
    song, _, component, sent = build()
    clock["now"] = 0.0
    component = SetlistComponent(
        song=song, emit=lambda a, args: sent.append((a, args)), clock=lambda: clock["now"]
    )
    mfx(song, 1).value = 5.0
    component.handle_select_song([1], None)
    assert mfx(song, 1).value == 5.0
    assert output_param(song).value == 64.0


def test_the_set_load_read_happens_on_its_own_with_no_page_open():
    song, _, _, sent = build()
    clock["now"] = 0.0
    scheduled = []
    component = SetlistComponent(
        song=song,
        emit=lambda a, args: sent.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
        clock=lambda: clock["now"],
    )
    assert scheduled[0][0] > SETTLE_SECONDS * 1000
    clock["now"] = SETTLE_SECONDS
    scheduled[0][1]()
    mfx(song, 1).value = 5.0
    component.handle_select_song([1], None)
    assert mfx(song, 1).value == 127.0


def test_a_move_before_the_set_settles_is_refused():
    song, _, _, sent = build()
    clock["now"] = 0.0
    component = SetlistComponent(
        song=song, emit=lambda a, args: sent.append((a, args)), clock=lambda: clock["now"]
    )
    component.handle_param(["4/1", 5.0], None)
    assert mfx(song, 1).value == 127.0


def sound(songs, song_index, sound_index):
    return songs[song_index].devices[0].chains[sound_index].devices[0]


def test_the_sound_on_gets_two_pads_from_macros_1_to_4():
    _, _, component, sent = build()
    component.handle_select_song([0], None)
    pads = last_state(sent)["soundPads"]
    assert [pad["label"] for pad in pads] == ["Delay Time", ""]
    assert pads[0]["x"] == {"key": "s/0/0/1", "value": 10.0}
    assert pads[0]["y"] == {"key": "s/0/0/2", "value": 20.0}
    assert pads[1]["x"] == {"key": "s/0/0/3", "value": 30.0}
    assert pads[1]["y"] == {"key": "s/0/0/4", "value": 40.0}


def test_no_sound_on_or_a_bare_plugin_gets_no_pads():
    _, _, component, sent = build()
    component.handle_get([], None)
    assert last_state(sent)["soundPads"] == []
    component.handle_select_song([1], None)
    component.handle_select_sound([1], None)
    assert last_state(sent)["soundPads"] == []


def test_a_sound_pad_writes_only_the_sound_on_and_only_macros_1_to_4():
    _, songs, component, _ = build()
    component.handle_select_song([0], None)
    component.handle_param(["s/0/0/2", 500.0], None)
    assert sound(songs, 0, 0).parameters[2].value == 127.0
    component.handle_param(["s/0/1/1", 5.0], None)
    assert sound(songs, 0, 1).parameters[1].value == 10.0
    component.handle_param(["s/0/0/5", 5.0], None)
    assert sound(songs, 0, 0).parameters[5].value == 99.0
    component.handle_param(["s/0/0/0", 0.0], None)
    assert sound(songs, 0, 0).on


def test_choosing_a_sound_returns_its_macros_to_their_set_load_values():
    _, songs, component, _ = build()
    component.handle_select_song([0], None)
    component.handle_param(["s/0/0/1", 77.0], None)
    component.handle_select_sound([1], None)
    assert sound(songs, 0, 0).parameters[1].value == 77.0
    component.handle_select_sound([0], None)
    assert sound(songs, 0, 0).parameters[1].value == 10.0


def test_a_song_change_resets_the_sound_it_lands_on():
    _, songs, component, _ = build()
    component.handle_select_song([0], None)
    component.handle_param(["s/0/0/1", 77.0], None)
    component.handle_select_song([1], None)
    component.handle_select_song([0], None)
    assert sound(songs, 0, 0).parameters[1].value == 10.0


def test_tapping_the_sound_on_keeps_its_macros():
    _, songs, component, _ = build()
    component.handle_select_song([0], None)
    component.handle_param(["s/0/0/1", 77.0], None)
    component.handle_select_sound([0], None)
    assert sound(songs, 0, 0).parameters[1].value == 77.0


def test_sound_macros_read_during_startup_are_never_used():
    song, songs, _, sent = build()
    clock["now"] = 0.0
    scheduled = []
    real = sound(songs, 0, 0).parameters[1]
    real.value = 0.0
    component = SetlistComponent(
        song=song,
        emit=lambda a, args: sent.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append(fn),
        clock=lambda: clock["now"],
    )
    component.handle_get([], None)
    real.value = 10.0
    clock["now"] = SETTLE_SECONDS
    scheduled[0]()
    real.value = 77.0
    component.handle_select_song([0], None)
    assert real.value == 10.0


def test_a_switch_selects_the_song_and_sound_chains_in_live():
    song, songs, component, _ = build()
    instruments = song.tracks[1].devices[1]
    component.handle_select_song([1], None)
    assert instruments.view.selected_chain is songs[1]
    assert songs[1].devices[0].view.selected_chain is songs[1].devices[0].chains[0]
    component.handle_select_sound([2], None)
    assert instruments.view.selected_chain is songs[1]
    assert songs[1].devices[0].view.selected_chain is songs[1].devices[0].chains[2]


def test_asking_for_state_selects_nothing():
    song, _, component, _ = build()
    component.handle_get([], None)
    assert song.tracks[1].devices[1].view.selected_chain is None


def test_a_refused_selection_still_switches_the_sound():
    class Refuses:
        def __setattr__(self, key, value):
            raise RuntimeError("no")

    song, songs, component, sent = build()
    song.tracks[1].devices[1].view = Refuses()
    component.handle_select_song([1], None)
    assert sound(songs, 1, 0).on
    assert last_state(sent)["song"] == 1
