"""TrackTransposeComponent — the clip view's ±12 on an Instrument Rack
routes to a wrapped Drum Rack's vm.pitch, by class, as Permute does."""

import json

from components.TrackTransposeComponent import (
    V3_TRACK_TRANSPOSE_REPLY_ADDRESS,
    TrackTransposeComponent,
)


class Dev:
    def __init__(self, class_name, chains=()):
        self.class_name = class_name
        self.chains = list(chains)


class Chain:
    def __init__(self, devices=()):
        self.devices = list(devices)


class Track:
    def __init__(self, devices=()):
        self.devices = list(devices)


class Song:
    def __init__(self, tracks=()):
        self.tracks = list(tracks)
        self.return_tracks = []


class FakeVM:
    def __init__(self, pitch=0, members=32, held=0):
        self.pitch = pitch
        self.census = {"functions": {"pitch": {"members": members, "held": held}}}
        self.writes = []

    def read(self, device, path, fn):
        if fn == "members":
            return json.dumps(self.census)
        return self.pitch if fn == "pitch" else None

    def write(self, device, path, fn, value):
        self.writes.append((device, path, fn, value))
        self.pitch = value
        return True, value, ""


def build(tracks, vm):
    emits = []
    comp = TrackTransposeComponent(Song(tracks), lambda a, p: emits.append((a, p)), vm)
    return comp, emits


def replies(emits):
    return [p for a, p in emits if a == V3_TRACK_TRANSPOSE_REPLY_ADDRESS]


def wrapped_kit():
    kit = Dev("DrumGroupDevice")
    rack = Dev("InstrumentGroupDevice", chains=[Chain([Dev("Eq8")]), Chain([kit])])
    return kit, rack


def test_a_kit_wrapped_in_an_instrument_rack_moves_its_pitch():
    kit, rack = wrapped_kit()
    vm = FakeVM(pitch=-3)
    comp, emits = build([Track([rack])], vm)
    comp.handle_transpose(["r1", "tracks/0", 12])
    path = "tracks/0/devices/0/chains/1/devices/0"
    assert vm.writes == [(kit, path, "pitch", 9)]
    assert ("/looping/v3/property/value", (path, "vm.pitch", 9)) in emits
    assert replies(emits) == [("r1", "drum", "", 9)]


def test_down_an_octave_clamps_at_the_rail():
    _, rack = wrapped_kit()
    vm = FakeVM(pitch=-40)
    comp, emits = build([Track([rack])], vm)
    comp.handle_transpose(["r", "tracks/0", -12])
    assert vm.writes[-1][3] == -48
    comp.handle_transpose(["r2", "tracks/0", -12])
    assert len(vm.writes) == 1  # already at -48: nothing written
    assert replies(emits)[-1] == ("r2", "drum", "at the rail", -48)


def test_a_plain_instrument_rack_is_not_a_drum_track():
    rack = Dev("InstrumentGroupDevice", chains=[Chain([Dev("InstrumentVector")])])
    vm = FakeVM()
    comp, emits = build([Track([rack])], vm)
    comp.handle_transpose(["r", "tracks/0", 12])
    assert vm.writes == []
    assert replies(emits) == [("r", "not-drum", "", 0)]


def test_a_macro_held_kit_writes_nothing_and_says_held():
    _, rack = wrapped_kit()
    vm = FakeVM(members=16, held=16)
    comp, emits = build([Track([rack])], vm)
    comp.handle_transpose(["r", "tracks/0", 12])
    assert vm.writes == []
    assert replies(emits)[0][:2] == ("r", "held")


def test_a_kit_with_no_pitch_member_or_value_moves_nothing():
    _, rack = wrapped_kit()
    for vm in (FakeVM(members=0), FakeVM(pitch=None)):
        comp, emits = build([Track([rack])], vm)
        comp.handle_transpose(["r", "tracks/0", 12])
        assert vm.writes == []
        assert replies(emits)[0][:2] == ("r", "none")


def test_top_level_drum_rack_is_found_too():
    kit = Dev("DrumGroupDevice")
    vm = FakeVM()
    comp, _ = build([Track([Dev("MidiArpeggiator"), kit])], vm)
    comp.handle_transpose(["r", "tracks/0", 12])
    assert vm.writes == [(kit, "tracks/0/devices/1", "pitch", 12)]


def test_bad_args_and_missing_track_reply_without_writing():
    vm = FakeVM()
    comp, emits = build([Track([])], vm)
    comp.handle_transpose(["a", "tracks/0"])
    comp.handle_transpose(["b", "tracks/0", "up"])
    comp.handle_transpose(["c", "tracks/9", 12])
    assert [r[:2] for r in replies(emits)] == [
        ("a", "invalid-args"), ("b", "invalid-args"), ("c", "no-track"),
    ]
    assert vm.writes == []


def test_disconnected_is_silent():
    _, rack = wrapped_kit()
    comp, emitted = build([Track([rack])], FakeVM())
    comp.disconnect()
    comp.handle_transpose(["r", "tracks/0", 12])
    assert emitted == []
