"""MidiWheelsComponent tests — the on-screen wheels through MidiWheels.

Covers:

- find-or-insert: a wheel move on a MIDI track without MidiWheels loads
  ``devices.midiWheels.devicePath`` once and lands the value on the device
  the load put there; a present MidiWheels (class + name) is used as is; a
  load that fails, or whose device is not visible yet, is never re-issued on
  every frame and never stacks a second copy.
- parameter index and range: mod → ``parameters[1]``, pitch →
  ``parameters[2]`` (configurable), each clamped into the parameter's own
  range and pitch additionally to 16383 (the dial reads 0–16384).
- audio tracks are ignored.
- one device per track: nothing is loaded while one is there, and the
  cached parameters follow selection and device-list changes.
- the latest value wins per drain pass, so the spring-back's 8192 lands.
- one undo step per gesture: opened on the first write, closed after the
  idle window, re-armed by every flush.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.MidiWheelsComponent import (
    CONFIG_KEY,
    DEFAULT_CLASS_NAME,
    DEFAULT_DEVICE_NAME,
    MidiWheelsComponent,
    V3_WHEELS_MOD_ADDRESS,
    V3_WHEELS_PITCH_ADDRESS,
)
from components.drum_vm_functions import GESTURE_UNDO_IDLE_MS

_PATH = "/tmp/Vamp Devices/MidiWheels.amxd"


# --- stubs ----------------------------------------------------------------


class StubParam:
    def __init__(self, value=0.0, minimum=0.0, maximum=127.0, raise_on_write=False):
        self.min = minimum
        self.max = maximum
        self._value = float(value)
        self.raise_on_write = raise_on_write
        self.writes: List[float] = []

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if self.raise_on_write:
            raise RuntimeError("stale param handle")
        self._value = float(v)
        self.writes.append(float(v))


def midi_wheels(name=DEFAULT_DEVICE_NAME, class_name=DEFAULT_CLASS_NAME, pitch_max=16384.0):
    """MidiWheels as the rig measured it: Device On, Mod Wheel 0–127,
    Pitch 0–16384 starting at centre."""

    class Device:
        pass

    d = Device()
    d.name = name
    d.class_name = class_name
    d.parameters = [
        StubParam(1.0, 0.0, 1.0),
        StubParam(0.0, 0.0, 127.0),
        StubParam(8192.0, 0.0, pitch_max),
    ]
    return d


class StubTrack:
    def __init__(self, devices=None, has_midi_input=True):
        self.devices = list(devices) if devices is not None else []
        self.has_midi_input = has_midi_input


class StubView:
    def __init__(self, track):
        self.selected_track = track
        self.listeners: List = []

    def add_selected_track_listener(self, cb):
        self.listeners.append(cb)

    def remove_selected_track_listener(self, cb):
        self.listeners.remove(cb)


class StubSong:
    def __init__(self, track):
        self.view = StubView(track)
        self.undo_log: List[str] = []

    def begin_undo_step(self):
        self.undo_log.append("begin")

    def end_undo_step(self):
        self.undo_log.append("end")

    def select(self, track):
        self.view.selected_track = track
        for cb in list(self.view.listeners):
            cb()


class Scheduler:
    """Collects ``schedule_delayed`` calls; ``run`` fires them in order."""

    def __init__(self):
        self.calls: List[Tuple[int, object]] = []

    def __call__(self, delay_ms, fn):
        self.calls.append((delay_ms, fn))

    def run(self):
        calls, self.calls = self.calls, []
        for _, fn in calls:
            fn()


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


@pytest.fixture
def constants():
    return {
        "devices": {
            CONFIG_KEY: {
                "devicePath": _PATH,
                "className": DEFAULT_CLASS_NAME,
                "deviceName": DEFAULT_DEVICE_NAME,
                "modParamIndex": 1,
                "pitchParamIndex": 2,
            }
        }
    }


def make(track, constants, loader=None, scheduler=None, clock=None):
    song = StubSong(track)
    loads: List[Tuple[object, str, bool]] = []

    def default_loader(t, path, at_head=False, source="", rel=""):
        loads.append((t, path, at_head))
        t.devices.insert(0, midi_wheels())  # Live puts a MIDI effect first
        return None

    comp = MidiWheelsComponent(
        song=song,
        constants=constants,
        load_into_track=loader or default_loader,
        schedule_delayed=scheduler,
        clock=clock or Clock(),
    )
    return comp, song, loads


def move(comp, wheel, value):
    handler = comp.handle_pitch if wheel == "pitch" else comp.handle_mod
    handler((value,), None)
    comp.flush()


# --- find-or-insert -------------------------------------------------------


def test_first_touch_on_a_bare_midi_track_loads_midi_wheels_and_lands(constants):
    track = StubTrack(devices=[])
    comp, _, loads = make(track, constants)

    move(comp, "mod", 64)

    assert loads == [(track, _PATH, False)]
    wheels = track.devices[0]
    assert wheels.parameters[1].writes == [64.0]


def test_a_present_midi_wheels_is_used_and_nothing_is_loaded(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[object(), wheels])
    comp, _, loads = make(track, constants)

    move(comp, "pitch", 10000)
    move(comp, "mod", 5)

    assert loads == []
    assert wheels.parameters[2].writes == [10000.0]
    assert wheels.parameters[1].writes == [5.0]


def test_a_device_with_another_name_is_not_midi_wheels(constants):
    other = midi_wheels(name="Modwheel Sender")
    track = StubTrack(devices=[other])
    comp, _, loads = make(track, constants)

    move(comp, "mod", 30)

    assert len(loads) == 1
    assert other.parameters[1].writes == []


def test_one_device_per_track_across_many_moves(constants):
    track = StubTrack(devices=[])
    comp, _, loads = make(track, constants)

    for v in (1, 2, 3, 4):
        move(comp, "mod", v)
    move(comp, "pitch", 9000)

    assert len(loads) == 1
    assert len([d for d in track.devices if d.name == DEFAULT_DEVICE_NAME]) == 1


def test_a_failed_load_is_not_retried_every_frame(constants):
    track = StubTrack(devices=[])
    calls = []

    def failing(t, path, at_head=False, **kw):
        calls.append(path)
        return "not-in-browser"

    comp, song, _ = make(track, constants, loader=failing)

    for v in (1, 2, 3):
        move(comp, "mod", v)
    assert calls == [_PATH]

    song.select(StubTrack(devices=[]))     # a new track may try again
    move(comp, "mod", 4)
    assert calls == [_PATH, _PATH]


def test_a_load_not_yet_visible_retries_once_and_never_stacks(constants):
    track = StubTrack(devices=[])
    sched = Scheduler()
    calls = []

    def late(t, path, at_head=False, **kw):
        calls.append(path)
        return None  # the device shows up later

    comp, _, _ = make(track, constants, loader=late, scheduler=sched)

    move(comp, "mod", 50)
    move(comp, "mod", 60)                  # while the load is in flight
    assert calls == [_PATH]

    wheels = midi_wheels()
    track.devices.insert(0, wheels)        # Live shows it
    sched.run()                            # the retry lands the newest value
    assert wheels.parameters[1].writes == [60.0]
    assert calls == [_PATH]


def test_no_config_block_drops_the_wheels(constants):
    track = StubTrack(devices=[])
    comp, _, loads = make(track, {"devices": {}})

    move(comp, "mod", 10)

    assert loads == []


# --- parameter index and range ----------------------------------------------


def test_mod_is_parameter_1_and_pitch_parameter_2(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    move(comp, "mod", 100)
    move(comp, "pitch", 12000)

    assert wheels.parameters[0].writes == []       # Device On untouched
    assert wheels.parameters[1].writes == [100.0]
    assert wheels.parameters[2].writes == [12000.0]


def test_indices_come_from_config(constants):
    constants["devices"][CONFIG_KEY]["modParamIndex"] = 2
    constants["devices"][CONFIG_KEY]["pitchParamIndex"] = 1
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    move(comp, "mod", 7)

    assert wheels.parameters[2].writes == [7.0]
    assert wheels.parameters[1].writes == []


def test_pitch_is_clamped_to_16383_though_the_dial_reads_16384(constants):
    wheels = midi_wheels(pitch_max=16384.0)
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    move(comp, "pitch", 16384)
    move(comp, "pitch", 99999)
    move(comp, "pitch", -5)

    assert wheels.parameters[2].writes == [16383.0, 0.0]


def test_values_clamp_into_the_parameters_own_range(constants):
    wheels = midi_wheels(pitch_max=8000.0)
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    move(comp, "mod", 500)
    move(comp, "pitch", 12000)

    assert wheels.parameters[1].writes == [127.0]
    assert wheels.parameters[2].writes == [8000.0]


def test_non_numeric_and_nan_are_dropped(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    move(comp, "mod", "loud")
    move(comp, "mod", float("nan"))
    comp.handle_mod((), None)
    comp.flush()

    assert wheels.parameters[1].writes == []


# --- audio tracks ------------------------------------------------------------


def test_audio_tracks_are_ignored(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels], has_midi_input=False)
    bare = StubTrack(devices=[], has_midi_input=False)
    comp, song, loads = make(track, constants)

    move(comp, "pitch", 3000)
    song.select(bare)
    move(comp, "mod", 3)

    assert wheels.parameters[2].writes == []
    assert loads == []
    assert song.undo_log == []


# --- selection and device-list changes -----------------------------------------


def test_selection_change_moves_the_wheels_to_the_new_track(constants):
    a, b = midi_wheels(), midi_wheels()
    ta, tb = StubTrack(devices=[a]), StubTrack(devices=[b])
    comp, song, _ = make(ta, constants)

    move(comp, "mod", 10)
    song.select(tb)
    move(comp, "mod", 20)

    assert a.parameters[1].writes == [10.0]
    assert b.parameters[1].writes == [20.0]


def test_a_deleted_midi_wheels_is_loaded_again_on_the_next_touch(constants):
    track = StubTrack(devices=[])
    comp, _, loads = make(track, constants)

    move(comp, "mod", 10)
    track.devices.clear()                  # the user deleted it
    comp.on_track_devices_changed(track)
    move(comp, "mod", 11)

    assert len(loads) == 2
    assert track.devices[0].parameters[1].writes == [11.0]


def test_a_stale_parameter_re_resolves_and_writes(constants):
    old = midi_wheels()
    track = StubTrack(devices=[old])
    comp, _, _ = make(track, constants)
    move(comp, "mod", 1)

    old.parameters[1].raise_on_write = True
    fresh = midi_wheels()
    track.devices[:] = [fresh]
    move(comp, "mod", 2)

    assert fresh.parameters[1].writes == [2.0]


# --- latest value wins --------------------------------------------------------


def test_only_the_newest_value_per_wheel_is_written_per_pass(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    for v in (9000, 11000, 13000, 8192):   # a spring-back burst in one pass
        comp.handle_pitch((v,), None)
    comp.handle_mod((40,), None)
    comp.flush()

    assert wheels.parameters[2].writes == [8192.0] or wheels.parameters[2].writes == []
    assert wheels.parameters[2].value == 8192.0
    assert wheels.parameters[1].writes == [40.0]


def test_the_release_to_centre_lands_after_a_bend(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, _, _ = make(track, constants)

    move(comp, "pitch", 15000)
    move(comp, "pitch", 8192)

    assert wheels.parameters[2].writes == [15000.0, 8192.0]


# --- one undo step per gesture ---------------------------------------------------


def test_a_gesture_is_one_undo_step(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    sched, clock = Scheduler(), Clock()
    comp, song, _ = make(track, constants, scheduler=sched, clock=clock)

    for v in (9000, 10000, 11000):
        move(comp, "pitch", v)
    move(comp, "mod", 20)                  # alternating wheels, same step
    assert song.undo_log == ["begin"]
    assert sched.calls and sched.calls[0][0] == GESTURE_UNDO_IDLE_MS

    clock.t += GESTURE_UNDO_IDLE_MS / 1000.0 + 0.01
    sched.run()
    assert song.undo_log == ["begin", "end"]

    move(comp, "pitch", 8192)              # the next gesture opens its own
    assert song.undo_log == ["begin", "end", "begin"]


def test_a_write_inside_the_window_pushes_the_close_out(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    sched, clock = Scheduler(), Clock()
    comp, song, _ = make(track, constants, scheduler=sched, clock=clock)

    move(comp, "mod", 1)
    clock.t += 0.2
    move(comp, "mod", 2)                   # deadline moves to t+0.5
    clock.t += 0.15
    sched.run()                            # first check: not yet idle
    assert song.undo_log == ["begin"]
    clock.t += 0.2
    sched.run()
    assert song.undo_log == ["begin", "end"]


def test_an_unchanged_value_opens_no_undo_step(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, song, _ = make(track, constants, scheduler=Scheduler())

    move(comp, "pitch", 8192)              # already at centre

    assert song.undo_log == []
    assert wheels.parameters[2].writes == []


def test_disconnect_closes_an_open_step_and_silences_handlers(constants):
    wheels = midi_wheels()
    track = StubTrack(devices=[wheels])
    comp, song, _ = make(track, constants, scheduler=Scheduler())

    move(comp, "mod", 3)
    comp.disconnect()
    move(comp, "mod", 4)

    assert song.undo_log == ["begin", "end"]
    assert wheels.parameters[1].writes == [3.0]
    assert song.view.listeners == []


def test_addresses_are_stable():
    assert V3_WHEELS_PITCH_ADDRESS == "/looping/v3/wheels/pitch"
    assert V3_WHEELS_MOD_ADDRESS == "/looping/v3/wheels/mod"
