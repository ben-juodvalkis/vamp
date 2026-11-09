"""SetlistComponent (ADR-519): one song and one sound on, Live's Device On
values as the only state, and asking never changing anything."""

from __future__ import annotations

import json

import pytest

from components.SetlistComponent import (
    SetlistComponent,
    V3_SETLIST_STATE_ADDRESS,
    split_song_name,
)

RACK = "InstrumentGroupDevice"


class Param:
    def __init__(self, name, value):
        self.name = name
        self.value = value


class Device:
    def __init__(self, on=False, class_name=RACK, chains=()):
        self.class_name = class_name
        self.parameters = [Param("Device On", 1.0 if on else 0.0)]
        self.chains = list(chains)

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


def build():
    """Three songs as the rig's set has them, every rack on and sound off."""
    sounds = {
        "Joke 144": ["Lead", "Organ"],
        "Pommel Horse160": ["Ram Lead", "Ram Birds", "Deep Organ"],
        "Blank": ["Piano"],
    }
    songs = [
        Chain(name, [Device(on=True, chains=[Chain(s, [Device()]) for s in parts])])
        for name, parts in sounds.items()
    ]
    midi_rack = Device(class_name="MidiEffectGroupDevice", chains=[Chain("wrong", [])])
    keys = Track("Keys", [midi_rack, Device(on=True, chains=songs)])
    song = Song([Track("Other", [Device(chains=[Chain("wrong", [Device()])])]), keys])
    sent = []
    component = SetlistComponent(song=song, emit=lambda a, args: sent.append((a, args)))
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
