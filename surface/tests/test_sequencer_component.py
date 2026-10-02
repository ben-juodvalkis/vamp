"""SequencerComponent — S1 skeleton (permute ADR-020).

Fakes shaped like the measured LOM: a song with ``is_playing`` /
``current_song_time`` / ``tempo`` / ``signature_numerator``, regular
tracks with ``devices`` / ``clip_slots`` / ``playing_slot_index``, and a
thin Permute device whose 38 parameters carry the device's long names.
The clock is driven by hand: each ``tick()`` call is one pump fire.

Covers discovery (by name + class, top-level devices only), the
on/off gate (an injection point since the ``sequencer_engine`` toggle went), the by-name pattern cache and its listener
refresh, step math over the transport (including bar-length rates in
3/4), lookahead, step telemetry and the ``-1`` idle emits on stop /
disable / removal / disconnect, clip-slot tracking, the stats probe,
and the per-instance restore bookkeeping the action phases build on.
"""

from __future__ import annotations

import json
from typing import Dict, List, Optional

import pytest

from components import sequencer_math as sm
from components.SequencerComponent import (
    GATE_HEARTBEAT_S,
    KIND_MUTE,
    KIND_PITCH,
    PERMUTE_CLASS_NAME,
    PERMUTE_DEVICE_NAME,
    ROLE_NAMES,
    SequencerComponent,
    V3_PERMUTE_GATE_ADDRESS,
    V3_PERMUTE_STEP_ADDRESS,
)

# --- fakes ------------------------------------------------------------------


class FakeParam:
    _next = 1000

    def __init__(self, name: str, value: float = 0.0):
        FakeParam._next += 1
        self.id = FakeParam._next
        self._live_ptr = self.id
        self.name = name
        self._value = value
        self._listeners: List = []

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._value = v
        for cb in list(self._listeners):
            cb()

    def add_value_listener(self, cb):
        self._listeners.append(cb)

    def remove_value_listener(self, cb):
        self._listeners.remove(cb)


class FakeDevice:
    _next = 5000

    def __init__(self, name: str, class_name: str, params=(), chains=()):
        FakeDevice._next += 1
        self._live_ptr = FakeDevice._next
        self.name = name
        self.class_name = class_name
        self.parameters = list(params)
        self.chains = list(chains)

    def param(self, long_name: str) -> FakeParam:
        for p in self.parameters:
            if p.name == long_name:
                return p
        raise KeyError(long_name)


def thin_permute(values: Optional[Dict[str, float]] = None) -> FakeDevice:
    """The thin device as Live reports it: Device On + the 38 controls."""
    values = values or {}
    params = [FakeParam("Device On", 1.0)]
    for role, name in ROLE_NAMES.items():
        default = {"muteLength": 8, "muteRate": 3, "pitchLength": 8, "pitchRate": 3,
                   "chance": 1.0, "temperature": 0.0}.get(role, 1.0 if role.startswith("mute") else 0.0)
        params.append(FakeParam(name, values.get(name, default)))
    return FakeDevice(PERMUTE_DEVICE_NAME, PERMUTE_CLASS_NAME, params)


class FakeNote:
    """``Clip.MidiNote`` as the engine touches it."""

    def __init__(self, note_id, pitch, mute=False, probability=1.0, start_time=0.0):
        self.note_id = note_id
        self.pitch = pitch
        self.mute = mute
        self.probability = probability
        self.start_time = start_time
        self.duration = 0.25
        self.velocity = 100.0


class FakeClip:
    """A clip with an id, notes read back as fresh objects (Live hands out
    copies) and ``apply_note_modifications`` writing back by note_id, plus
    ``pitch_coarse`` for the audio path."""

    _next = 9000

    def __init__(self, is_midi=True, notes=(), pitch_coarse=0):
        FakeClip._next += 1
        self._live_ptr = FakeClip._next
        self.is_midi_clip = is_midi
        self.is_audio_clip = not is_midi
        self.length = 4.0
        self.notes: Dict[int, FakeNote] = {n.note_id: n for n in notes}
        self.pitch_coarse = pitch_coarse
        self.applies = 0
        self.scoped_reads = 0
        self.raise_on_apply = None
        self._loop_listeners: List = []
        self._notes_listeners: List = []

    def get_all_notes_extended(self, *args):
        return [FakeNote(n.note_id, n.pitch, n.mute, n.probability, n.start_time) for n in self.notes.values()]

    def get_notes_extended(self, from_pitch, pitch_span, from_time, time_span):
        """Live 11+'s ranged read: the notes starting inside the window."""
        self.scoped_reads += 1
        return [
            FakeNote(n.note_id, n.pitch, n.mute, n.probability, n.start_time)
            for n in self.notes.values()
            if from_pitch <= n.pitch < from_pitch + pitch_span and from_time <= n.start_time < from_time + time_span
        ]

    def apply_note_modifications(self, vec):
        if self.raise_on_apply is not None:
            raise self.raise_on_apply
        self.applies += 1
        for n in vec:
            mine = self.notes.get(n.note_id)
            if mine is not None:
                mine.pitch, mine.mute, mine.probability = n.pitch, n.mute, n.probability
        self.fire_notes()                       # Live notifies for our own writes too

    # observers (ADR-015): loop_jump + notes
    def add_loop_jump_listener(self, cb):
        self._loop_listeners.append(cb)

    def remove_loop_jump_listener(self, cb):
        self._loop_listeners.remove(cb)

    def add_notes_listener(self, cb):
        self._notes_listeners.append(cb)

    def remove_notes_listener(self, cb):
        self._notes_listeners.remove(cb)

    def fire_loop_jump(self):
        for cb in list(self._loop_listeners):
            cb()

    def fire_notes(self):
        for cb in list(self._notes_listeners):
            cb()

    def listener_count(self):
        return len(self._loop_listeners) + len(self._notes_listeners)

    def pitches(self):
        return [self.notes[k].pitch for k in sorted(self.notes)]


class FakeChain:
    def __init__(self, devices=()):
        self.devices = list(devices)


class FakeDrumVM:
    """Records ``set_sequencer_shift`` / ``rebind`` calls the way the drum
    fan-out sees them."""

    def __init__(self):
        self.calls: List = []
        self.pad_calls: List = []
        self.rebinds: List = []
        self.raise_on = None

    def set_sequencer_shift(self, device, device_path, shift):
        if self.raise_on is not None:
            raise self.raise_on
        self.calls.append((device, device_path, shift))
        return True

    def set_pad_sequencer_shift(self, device, device_path, note, shift):
        if self.raise_on is not None:
            raise self.raise_on
        self.pad_calls.append((device, device_path, note, shift))
        return True

    def rebind(self, device, device_path):
        self.rebinds.append((device, device_path))

    def shifts(self):
        return [c[2] for c in self.calls]


class FakeSlot:
    def __init__(self, clip=None):
        self.clip = clip

    @property
    def has_clip(self):
        return self.clip is not None


class FakeTrack:
    def __init__(self, devices=(), slots=(), playing_slot_index=-1, name="t"):
        self.name = name
        self.devices = list(devices)
        self.clip_slots = list(slots)
        self.playing_slot_index = playing_slot_index
        self.solo = False


class FakeSong:
    def __init__(self, tracks=(), tempo=120.0, numerator=4):
        self.tracks = list(tracks)
        self.tempo = tempo
        self.signature_numerator = numerator
        self.is_playing = False
        self.current_song_time = 0.0


class Recorder:
    def __init__(self):
        self.emits: List = []

    def __call__(self, address, args):
        self.emits.append((address, tuple(args)))

    def steps(self, kind=None, path=None):
        out = []
        for a, args in self.emits:
            if a != V3_PERMUTE_STEP_ADDRESS:
                continue
            if kind is not None and args[1] != kind:
                continue
            if path is not None and args[0] != path:
                continue
            out.append(args)
        return out

    def clear(self):
        self.emits.clear()


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def build(song, enabled=True, lookahead=False, playhead=None, drum_vm=None, seed=1, gate=None):
    import random as _random
    rec = Recorder()
    clock = Clock()
    comp = SequencerComponent(
        song=song, emit=rec, gate_emit=gate,
        is_enabled=(lambda: enabled) if enabled is not None else None,
        playhead=playhead, drum_vm=drum_vm, clock=clock, lookahead=lookahead,
        rng=_random.Random(seed),
    )
    return comp, rec, clock


def gate_flips(gate):
    """The gate states in order with repeats collapsed. The heartbeat
    re-states the value it already sent — deliberately, so a dropped
    datagram heals — and those repeats are not transitions."""
    out = []
    for _address, args in gate.emits:
        if not out or out[-1] != args:
            out.append(args)
    return out


def mute_pattern(off_steps, rate=5):
    """A thin device whose mute steps ``off_steps`` (0-based) are OFF (= muted),
    at quarter-note rate for both sequencers."""
    values = {"Mute Rate": rate, "Pitch Rate": rate}
    for i in off_steps:
        values["Mute %d" % (i + 1)] = 0.0
    return thin_permute(values)


def pitch_pattern(on_steps, rate=5):
    """A thin device whose pitch steps ``on_steps`` (0-based) are on, at
    quarter-note rate for both sequencers."""
    values = {"Mute Rate": rate, "Pitch Rate": rate}
    for i in on_steps:
        values["Pitch %d" % (i + 1)] = 1.0
    return thin_permute(values)


def play_to(song, comp, clock, beats: float, step_s: float = 0.0108):
    """Advance the transport to ``beats`` in one tick (the fake clock moves
    one pump period)."""
    song.is_playing = True
    song.current_song_time = beats
    clock.now += step_s
    comp.tick()


# --- discovery ------------------------------------------------------------------


def test_discovers_permute_by_name_and_class_on_regular_tracks():
    dev = thin_permute()
    other_max = FakeDevice("Wah Param Smoother", PERMUTE_CLASS_NAME)
    same_name_wrong_class = FakeDevice(PERMUTE_DEVICE_NAME, "AudioEffectGroupDevice")
    song = FakeSong([
        FakeTrack([FakeDevice("Kit", "DrumGroupDevice"), dev]),
        FakeTrack([other_max]),
        FakeTrack([same_name_wrong_class]),
    ])
    comp, rec, clock = build(song)
    paths = [i["path"] for i in comp.stats()["instances"]]
    assert paths == ["tracks/0/devices/1"]
    assert comp.stats()["instances"][0]["missing"] == []


def test_rescan_follows_a_moved_device_and_keeps_its_state():
    dev = thin_permute({"Mute Rate": 5})
    t0 = FakeTrack([FakeDevice("Kit", "DrumGroupDevice"), dev])
    song = FakeSong([FakeTrack([]), t0])
    comp, rec, clock = build(song)
    assert [i["path"] for i in comp.stats()["instances"]] == ["tracks/1/devices/1"]
    play_to(song, comp, clock, 1.5)   # step 1 at 1/4
    assert comp.stats()["instances"][0]["mute"]["step"] == 1

    # A track above it is deleted: same device, new path.
    song.tracks = [t0]
    comp.on_structural_change()
    inst = comp.stats()["instances"][0]
    assert inst["path"] == "tracks/0/devices/1"
    assert inst["mute"]["step"] == 1      # runtime state survived the re-key


def test_removed_device_is_retired_on_the_next_tick_with_idle_emits():
    dev = thin_permute()
    track = FakeTrack([dev])
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.1)
    rec.clear()

    track.devices = []
    comp.on_device_removed(track, dev._live_ptr)
    assert rec.steps() == []          # notification context: no emits yet
    comp.tick()
    assert rec.steps() == [("tracks/0/devices/0", KIND_MUTE, -1), ("tracks/0/devices/0", KIND_PITCH, -1)]
    assert comp.stats()["instances"] == []


def test_device_missing_controls_is_tolerated_with_defaults():
    dev = FakeDevice(PERMUTE_DEVICE_NAME, PERMUTE_CLASS_NAME, [FakeParam("Device On", 1.0), FakeParam("Mute 1", 0.0)])
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    inst = comp.stats()["instances"][0]
    assert "muteRate" in inst["missing"]
    assert inst["values"]["muteRate"] == 3     # default rate
    play_to(song, comp, clock, 0.0)
    assert rec.steps(KIND_MUTE) == [("tracks/0/devices/0", KIND_MUTE, 0)]


# --- gate -----------------------------------------------------------------------


def test_disabled_engine_emits_nothing_and_does_not_track():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song, enabled=False)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 2.0)
    assert rec.steps() == []
    assert comp.stats()["instances"][0]["mute"]["step"] == -1


def test_disabling_mid_play_restores_and_emits_idle_once():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    flag = {"on": True}
    rec = Recorder()
    clock = Clock()
    comp = SequencerComponent(song, rec, is_enabled=lambda: flag["on"], clock=clock, lookahead=False)
    play_to(song, comp, clock, 4.2)      # bar 2 at the device's default 1-bar rate
    assert rec.steps(KIND_MUTE)[-1][2] == 1
    rec.clear()
    flag["on"] = False
    comp.tick()
    comp.tick()
    assert rec.steps() == [("tracks/0/devices/0", KIND_MUTE, -1), ("tracks/0/devices/0", KIND_PITCH, -1)]
    assert comp.stats()["instances"][0]["mute"]["step"] == -1


# --- pattern cache ----------------------------------------------------------------


def test_pattern_is_read_by_name_and_refreshed_from_value_listeners():
    dev = thin_permute({"Mute 3": 0.0, "Pitch 2": 1.0, "Mute Rate": 5, "Pitch Rate": 5})
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 2.0)     # step 2 at 1/4 → Mute 3 = 0 → mute value 0
    inst = comp.stats()["instances"][0]
    assert inst["mute"]["value"] == 0
    assert inst["pitch"]["value"] == 0

    # The value listener path: an envelope flips Pitch 3 on before step 2 arrives.
    p = dev.param("Pitch 3")
    p.value = 1.0
    comp.on_param_value_changed(p, "tracks/0/devices/0/params/13")
    play_to(song, comp, clock, 2.01)   # same step, no new transition
    assert comp.stats()["instances"][0]["pitch"]["value"] == 0
    play_to(song, comp, clock, 3.0)    # step 3 → Pitch 4 = 0
    play_to(song, comp, clock, 10.0)   # step 2 again → Pitch 3 now 1
    assert comp.stats()["instances"][0]["pitch"]["value"] == 1


def test_value_listener_for_unknown_parameter_is_ignored():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    stray = FakeParam("Volume", 0.5)
    comp.on_param_value_changed(stray, "tracks/3/devices/0/params/1")   # no raise, no effect
    assert comp.stats()["instances"][0]["values"]["chance"] == 1.0


def test_rate_and_length_are_sampled_from_the_cache():
    dev = thin_permute({"Mute Rate": 7, "Mute Length": 4, "Pitch Rate": 3})
    song = FakeSong([FakeTrack([dev])], numerator=3)
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    inst = comp.stats()["instances"][0]
    assert inst["mute"]["tps"] == 120 and inst["mute"]["len"] == 4
    assert inst["pitch"]["tps"] == 3 * 480        # one bar of 3/4
    # 1/16 steps of length 4: beat 1.0 = 4 sixteenths → wraps to step 0.
    play_to(song, comp, clock, 0.75)
    assert comp.stats()["instances"][0]["mute"]["step"] == 3
    play_to(song, comp, clock, 1.0)
    assert comp.stats()["instances"][0]["mute"]["step"] == 0


# --- transport + telemetry ------------------------------------------------------------


def test_steps_advance_with_song_time_and_emit_once_per_change():
    dev = thin_permute({"Mute Rate": 5, "Pitch Rate": 5})   # quarter notes
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    for beats in (0.0, 0.3, 0.99, 1.0, 1.5, 2.0, 2.2, 7.9, 8.0):
        play_to(song, comp, clock, beats)
    assert [s[2] for s in rec.steps(KIND_MUTE)] == [0, 1, 2, 7, 0]
    assert [s[2] for s in rec.steps(KIND_PITCH)] == [0, 1, 2, 7, 0]
    assert rec.steps()[0][0] == "tracks/0/devices/0"


def test_transport_stop_emits_idle_and_resets_steps():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 5.0)
    rec.clear()
    song.is_playing = False
    comp.tick()
    assert rec.steps() == [("tracks/0/devices/0", KIND_MUTE, -1), ("tracks/0/devices/0", KIND_PITCH, -1)]
    comp.tick()
    assert len(rec.steps()) == 2       # idle is emitted once, not per tick
    # Restart from bar 1: fresh transitions, including step 0 again.
    play_to(song, comp, clock, 0.0)
    assert rec.steps(KIND_MUTE)[-1][2] == 0


def test_two_devices_run_independently():
    a = thin_permute({"Mute Rate": 5})
    b = thin_permute({"Mute Rate": 3})
    song = FakeSong([FakeTrack([a]), FakeTrack([FakeDevice("Kit", "DrumGroupDevice"), b])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 3.0)
    assert [s[2] for s in rec.steps(KIND_MUTE, "tracks/0/devices/0")] == [0, 3]
    assert [s[2] for s in rec.steps(KIND_MUTE, "tracks/1/devices/1")] == [0]
    play_to(song, comp, clock, 4.0)
    assert rec.steps(KIND_MUTE, "tracks/1/devices/1")[-1][2] == 1


def test_lookahead_moves_the_transition_a_32nd_early():
    dev = thin_permute({"Mute Rate": 5})
    song = FakeSong([FakeTrack([dev])], tempo=120.0)
    comp, rec, clock = build(song, lookahead=True)
    # The lead is a 1/32 (60 ticks = 0.125 beats), not the ~10 ms pump
    # period it used to be. A tenth of a beat before the boundary is
    # inside it, and the engine already evaluates step 1.
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0 - 0.1)
    assert rec.steps(KIND_MUTE)[-1][2] == 1
    lag = comp.stats()["lag"]
    # Three transitions: both kinds at step 0, then the mute step 1 — early.
    assert lag["count"] == 3
    assert lag["last_ms"] == pytest.approx(-50.0, abs=0.5)   # 0.1 beat at 120


def test_the_old_one_interval_lead_would_have_missed_that_boundary():
    """Pins why the lead moved (2026-09-09): a tick interval of headroom
    is 0.0216 beats at 120 BPM, so a transition a tenth of a beat out was
    still reading the old step. Measured on the rig, that left a third of
    transitions landing *after* the boundary."""
    dev = thin_permute({"Mute Rate": 5})
    song = FakeSong([FakeTrack([dev])], tempo=120.0)
    comp, rec, clock = build(song, lookahead=True)
    play_to(song, comp, clock, 0.0)
    one_interval = sm.lookahead_ticks(0.0108, 120.0)
    assert one_interval == pytest.approx(10.4, abs=0.1)      # ticks
    assert sm.lead_ticks(0.0108, 120.0, 480) == 60.0         # what it leads by now
    play_to(song, comp, clock, 1.0 - 0.1)
    assert rec.steps(KIND_MUTE)[-1][2] == 1                  # the new lead catches it


def test_the_lead_is_clamped_per_sequencer_not_per_device():
    """The mute and pitch rates rarely match, and the half-step clamp is a
    property of each sequencer's own rate — so the lead is computed inside
    the per-sequencer loop. Mute at 1 bar (2880) leads a full 1/32; pitch
    at 1/16 (120) is clamped to half its step, which is also 60."""
    dev = thin_permute({"Mute Rate": 3, "Pitch Rate": 7})
    song = FakeSong([FakeTrack([dev])], tempo=120.0)
    comp, _rec, clock = build(song, lookahead=True)
    play_to(song, comp, clock, 0.0)
    st = comp.stats()["instances"][0]
    assert st["mute"]["tps"] == 1920 and st["pitch"]["tps"] == 120   # a 4/4 bar
    assert sm.lead_ticks(comp.stats()["interval_ms"] / 1000.0, 120.0, 1920) == 60.0
    assert sm.lead_ticks(comp.stats()["interval_ms"] / 1000.0, 120.0, 120) == 60.0
    # The 1/16 sequencer never leads past half a step, whatever the clock does.
    assert sm.lead_ticks(0.040, 240.0, 120) == 60.0


def test_stats_reports_the_lead_it_is_aiming_for():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])], tempo=120.0)
    comp, _rec, clock = build(song, lookahead=True)
    play_to(song, comp, clock, 0.0)
    lead = comp.stats()["lead"]
    assert lead["on"] is True
    assert lead["ticks"] == pytest.approx(60.0)
    assert lead["ms"] == pytest.approx(62.5, abs=0.5)        # a 1/32 at 120 BPM
    assert lead["floor_ticks"] == 60 and lead["max_fraction"] == 0.5
    comp2, _rec2, _clock2 = build(song, lookahead=False)
    assert comp2.stats()["lead"] == {"on": False}


def test_without_lookahead_the_transition_lands_after_the_boundary():
    dev = thin_permute({"Mute Rate": 5})
    song = FakeSong([FakeTrack([dev])], tempo=120.0)
    comp, rec, clock = build(song, lookahead=False)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0 - 0.015)
    assert rec.steps(KIND_MUTE)[-1][2] == 0
    play_to(song, comp, clock, 1.004)
    assert rec.steps(KIND_MUTE)[-1][2] == 1
    assert comp.stats()["lag"]["last_ms"] == pytest.approx(2.0, abs=0.05)   # 0.004 beats late at 120


def test_interval_ema_tracks_the_pump_period_within_bounds():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    for _ in range(50):
        play_to(song, comp, clock, 0.0, step_s=0.020)
    assert comp.stats()["interval_ms"] == pytest.approx(20.0, abs=0.5)
    # A 3 s control-thread stall is not a tick interval.
    play_to(song, comp, clock, 0.0, step_s=3.0)
    assert comp.stats()["interval_ms"] == pytest.approx(20.0, abs=0.5)


# --- clip tracking -------------------------------------------------------------------


class QueryPlayhead:
    """Stand-in for PlayheadComponent.playing_clip."""

    def __init__(self):
        self.calls = 0

    def playing_clip(self, track, track_path=""):
        self.calls += 1
        idx = track.playing_slot_index
        if idx < 0:
            return None
        slot = track.clip_slots[idx]
        return (slot.clip, idx) if slot.has_clip else None


def test_clip_state_follows_the_playing_slot_via_the_playhead_query():
    dev = thin_permute()
    midi = FakeClip(is_midi=True)
    audio = FakeClip(is_midi=False)
    track = FakeTrack([dev], slots=[FakeSlot(midi), FakeSlot(None), FakeSlot(audio)])
    song = FakeSong([track])
    ph = QueryPlayhead()
    comp, rec, clock = build(song, playhead=ph)
    play_to(song, comp, clock, 0.0)
    assert comp.stats()["instances"][0]["clip"] is None
    track.playing_slot_index = 0
    play_to(song, comp, clock, 0.1)
    assert comp.stats()["instances"][0]["clip"] == midi._live_ptr
    track.playing_slot_index = 2
    play_to(song, comp, clock, 0.2)
    assert comp.stats()["instances"][0]["clip"] == audio._live_ptr
    track.playing_slot_index = 1          # empty slot
    play_to(song, comp, clock, 0.3)
    assert comp.stats()["instances"][0]["clip"] is None
    assert ph.calls == 3                  # resolved only on a slot change (three changes)


def test_clip_resolution_without_playhead_reads_the_track():
    dev = thin_permute()
    clip = FakeClip()
    track = FakeTrack([dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert comp.stats()["instances"][0]["clip"] == clip._live_ptr


# --- probe + lifecycle ---------------------------------------------------------------


def test_stats_probe_replies_json_and_resets_on_request():
    dev = thin_permute({"Mute Rate": 5, "Pitch Rate": 5})
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    reply = json.loads(comp.handle_stats([], ("127.0.0.1", 1))[0])
    assert reply["enabled"] is True and reply["lag"]["count"] == 4
    assert reply["instances"][0]["path"] == "tracks/0/devices/0"
    reply = json.loads(comp.handle_stats(["reset"], ("127.0.0.1", 1))[0])
    assert reply["lag"]["count"] == 0 and reply["ticks"] == 2


def test_disconnect_emits_idle_for_active_devices_and_goes_quiet():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 2.0)
    rec.clear()
    comp.disconnect()
    assert rec.steps() == [("tracks/0/devices/0", KIND_MUTE, -1), ("tracks/0/devices/0", KIND_PITCH, -1)]
    comp.tick()
    comp.on_structural_change()
    comp.disconnect()
    assert len(rec.steps()) == 2
    assert comp.stats()["instances"] == []


def test_disconnect_while_stopped_emits_nothing():
    dev = thin_permute()
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    comp.tick()
    comp.disconnect()
    assert rec.steps() == []


def test_tick_survives_a_raising_song_read():
    class BrokenSong(FakeSong):
        @property
        def current_song_time(self):
            raise RuntimeError("LOM tantrum")

        @current_song_time.setter
        def current_song_time(self, v):
            pass

    dev = thin_permute()
    song = BrokenSong([FakeTrack([dev])])
    comp, rec, clock = build(song)
    song.is_playing = True
    comp.tick()
    comp.tick()
    assert rec.steps() == []
    assert comp.stats()["ticks"] == 2


# --- S2: pitch ------------------------------------------------------------------------


def test_drum_route_adds_the_shift_term_and_needs_no_clip():
    kit = FakeDevice("606 + 808", "DrumGroupDevice")
    dev = pitch_pattern([1, 2])
    song = FakeSong([FakeTrack([kit, dev])])
    vm = FakeDrumVM()
    comp, rec, clock = build(song, drum_vm=vm)
    assert comp.stats()["instances"][0]["route"] == "drum"
    assert comp.stats()["instances"][0]["rack"] == "tracks/0/devices/0"
    play_to(song, comp, clock, 0.0)          # step 0: off → nothing to write yet
    assert vm.calls == []
    play_to(song, comp, clock, 1.0)          # step 1: on
    assert vm.calls[-1] == (kit, "tracks/0/devices/0", 12)
    play_to(song, comp, clock, 2.0)          # step 2: still on → no repeat
    assert vm.shifts() == [12]
    play_to(song, comp, clock, 3.0)          # step 3: off
    assert vm.shifts() == [12, 0]
    play_to(song, comp, clock, 9.0)          # step 1 again
    assert vm.shifts() == [12, 0, 12]
    song.is_playing = False
    comp.tick()                              # transport stop zeroes the term
    assert vm.shifts() == [12, 0, 12, 0]
    assert comp.stats()["instances"][0]["drum_shift"] == 0


def test_drum_route_finds_a_rack_nested_in_an_instrument_rack():
    inner = FakeDevice("Kit", "DrumGroupDevice")
    outer = FakeDevice("Rack", "InstrumentGroupDevice", chains=[FakeChain([FakeDevice("Eq8", "Eq8")]), FakeChain([inner])])
    dev = pitch_pattern([0])
    song = FakeSong([FakeTrack([outer, dev])])
    vm = FakeDrumVM()
    comp, rec, clock = build(song, drum_vm=vm)
    inst = comp.stats()["instances"][0]
    assert inst["route"] == "drum" and inst["rack"] == "tracks/0/devices/0/chains/1/devices/0"
    play_to(song, comp, clock, 0.0)
    assert vm.calls == [(inner, "tracks/0/devices/0/chains/1/devices/0", 12)]


def test_instrument_rack_without_a_drum_rack_is_the_clip_route():
    rack = FakeDevice("Rack", "InstrumentGroupDevice", chains=[FakeChain([FakeDevice("Wavetable", "InstrumentVector")])])
    dev = pitch_pattern([0])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([rack, dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    vm = FakeDrumVM()
    comp, rec, clock = build(song, drum_vm=vm)
    assert comp.stats()["instances"][0]["route"] == "clip"
    play_to(song, comp, clock, 0.0)
    assert vm.calls == [] and clip.pitches() == [72]


def test_drum_shift_survives_a_failing_fan_out_and_a_missing_component():
    kit = FakeDevice("Kit", "DrumGroupDevice")
    dev = pitch_pattern([0])
    song = FakeSong([FakeTrack([kit, dev])])
    comp, rec, clock = build(song, drum_vm=None)
    play_to(song, comp, clock, 0.0)          # no component: logged once, no raise
    assert comp.stats()["instances"][0]["drum_shift"] == 12
    vm = FakeDrumVM(); vm.raise_on = RuntimeError("rack gone")
    comp2, rec2, clock2 = build(song, drum_vm=vm)
    play_to(song, comp2, clock2, 0.0)
    assert comp2.stats()["ticks"] == 1


def test_melodic_notes_shift_up_an_octave_and_back_by_their_own_delta():
    dev = pitch_pattern([1])
    clip = FakeClip(notes=[FakeNote(1, 60), FakeNote(2, 120), FakeNote(3, 127)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() == [60, 120, 127] and clip.applies == 0
    play_to(song, comp, clock, 1.0)          # step 1 on
    assert clip.pitches() == [72, 127, 127]  # +12, +7 (clamped), +0
    assert clip.applies == 1
    st = comp.stats()["instances"][0]["clip_pitch"]
    assert st == {"applied": True, "shift": 12, "audio": False}
    # An overdub recorded while shifted keeps the pitch it was played at.
    clip.notes[4] = FakeNote(4, 65)
    play_to(song, comp, clock, 2.0)          # step 2 off
    assert clip.pitches() == [60, 120, 127, 65]
    assert clip.applies == 2


def test_melodic_restore_on_transport_stop_and_on_disable():
    dev = pitch_pattern([0])
    clip = FakeClip(notes=[FakeNote(1, 48)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    flag = {"on": True}
    rec = Recorder(); clock = Clock()
    comp = SequencerComponent(song, rec, is_enabled=lambda: flag["on"], clock=clock, lookahead=False)
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() == [60]
    song.is_playing = False
    comp.tick()
    assert clip.pitches() == [48]
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() == [60]
    flag["on"] = False
    comp.tick()
    assert clip.pitches() == [48]


def test_melodic_restore_on_disconnect_and_on_removal():
    dev = pitch_pattern([0])
    clip = FakeClip(notes=[FakeNote(1, 48)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() == [60]
    comp.disconnect()
    assert clip.pitches() == [48]

    comp2, rec2, clock2 = build(song)
    play_to(song, comp2, clock2, 0.0)
    assert clip.pitches() == [60]
    comp2.on_device_removed(track, dev._live_ptr)
    assert clip.pitches() == [60]            # notification context: nothing written
    comp2.tick()
    assert clip.pitches() == [48]


def test_clip_change_under_a_held_step_moves_the_shift_to_the_new_clip():
    dev = pitch_pattern([0, 1, 2, 3])
    a = FakeClip(notes=[FakeNote(1, 60)])
    b = FakeClip(notes=[FakeNote(7, 40)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(a), FakeSlot(b)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert a.pitches() == [72] and b.pitches() == [40]
    track.playing_slot_index = 1
    play_to(song, comp, clock, 0.5)          # same step, new clip
    assert a.pitches() == [60] and b.pitches() == [52]
    song.is_playing = False
    comp.tick()
    assert b.pitches() == [40]


def test_step_on_with_no_clip_lands_when_a_clip_starts():
    dev = pitch_pattern([0, 1, 2, 3])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=-1)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() == [60]
    track.playing_slot_index = 0
    play_to(song, comp, clock, 0.2)
    assert clip.pitches() == [72]


def test_audio_pitch_coarse_shifts_relative_and_restores_with_drift():
    dev = pitch_pattern([1])
    clip = FakeClip(is_midi=False, pitch_coarse=3)
    track = FakeTrack([dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    assert clip.pitch_coarse == 15
    assert comp.stats()["instances"][0]["clip_pitch"]["audio"] is True
    clip.pitch_coarse = 20                   # re-pitched by the user while shifted
    play_to(song, comp, clock, 2.0)
    assert clip.pitch_coarse == 8            # home 3 + (20 − 15)
    play_to(song, comp, clock, 9.0)          # step 1 again, from the new home
    assert clip.pitch_coarse == 20
    song.is_playing = False
    comp.tick()
    assert clip.pitch_coarse == 8


def test_audio_pitch_coarse_clamps_at_the_rail_and_comes_back():
    dev = pitch_pattern([0])
    clip = FakeClip(is_midi=False, pitch_coarse=40)
    track = FakeTrack([dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.pitch_coarse == 48
    song.is_playing = False
    comp.tick()
    assert clip.pitch_coarse == 40


def simpler(transpose=0.0):
    return FakeDevice("Simpler", "OriginalSimpler", [FakeParam("Device On", 1.0), FakeParam("Transpose", transpose)])


def test_simpler_route_moves_transpose_not_the_notes():
    sim = simpler(-5.0)
    dev = pitch_pattern([1])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([sim, dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    inst = comp.stats()["instances"][0]
    assert inst["route"] == "simpler" and inst["simpler"]["path"] == "tracks/0/devices/0"
    play_to(song, comp, clock, 0.0)          # step 0 off: nothing written
    assert sim.param("Transpose").value == -5.0
    play_to(song, comp, clock, 1.0)          # step 1 on
    assert sim.param("Transpose").value == 7.0
    assert clip.pitches() == [60] and clip.applies == 0
    play_to(song, comp, clock, 2.0)          # step 2 off
    assert sim.param("Transpose").value == -5.0
    assert clip.pitches() == [60] and clip.applies == 0


def test_simpler_route_needs_no_clip_adopts_a_repitch_and_restores_on_stop():
    sim = simpler(0.0)
    dev = pitch_pattern([1])
    song = FakeSong([FakeTrack([sim, dev])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    assert sim.param("Transpose").value == 12.0
    sim.param("Transpose").value = 15.0      # the user turns it while shifted
    play_to(song, comp, clock, 2.0)
    assert sim.param("Transpose").value == 3.0
    play_to(song, comp, clock, 9.0)          # step 1 again, from the new home
    assert sim.param("Transpose").value == 15.0
    song.is_playing = False
    comp.tick()
    assert sim.param("Transpose").value == 3.0
    assert comp.stats()["instances"][0]["simpler"]["written"] is None


def test_simpler_route_clamps_at_the_rail_and_comes_back():
    sim = simpler(40.0)
    dev = pitch_pattern([0])
    song = FakeSong([FakeTrack([sim, dev])])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert sim.param("Transpose").value == 48.0
    comp.disconnect()
    assert sim.param("Transpose").value == 40.0


def test_simpler_inside_an_instrument_rack_is_the_clip_route():
    rack = FakeDevice("Rack", "InstrumentGroupDevice", chains=[FakeChain([simpler()])])
    dev = pitch_pattern([0])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([rack, dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    assert comp.stats()["instances"][0]["route"] == "clip"
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() == [72]


def test_a_drum_rack_wins_over_a_simpler_on_the_same_track():
    kit = FakeDevice("Kit", "DrumGroupDevice")
    sim = simpler(0.0)
    dev = pitch_pattern([0])
    song = FakeSong([FakeTrack([kit, sim, dev])])
    vm = FakeDrumVM()
    comp, rec, clock = build(song, drum_vm=vm)
    assert comp.stats()["instances"][0]["route"] == "drum"
    play_to(song, comp, clock, 0.0)
    assert vm.shifts() == [12] and sim.param("Transpose").value == 0.0


def test_note_write_failure_leaves_the_state_unapplied():
    dev = pitch_pattern([0])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    clip.raise_on_apply = RuntimeError("clip locked")
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert comp.stats()["instances"][0]["clip_pitch"]["applied"] is False
    assert clip.pitches() == [60]


# --- S3: mute --------------------------------------------------------------------------


def test_midi_mute_mutes_only_unmuted_notes_and_unmutes_only_those():
    dev = mute_pattern([1])
    clip = FakeClip(notes=[FakeNote(1, 60), FakeNote(2, 64, mute=True), FakeNote(3, 67)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert [clip.notes[i].mute for i in (1, 2, 3)] == [False, True, False] and clip.applies == 0
    play_to(song, comp, clock, 1.0)                    # step 1: muted
    assert [clip.notes[i].mute for i in (1, 2, 3)] == [True, True, True]
    assert comp.stats()["instances"][0]["clip_mute"] == {"applied": True, "notes": 2}
    clip.notes[4] = FakeNote(4, 72)                    # recorded while the step held: plays
    play_to(song, comp, clock, 2.0)                    # step 2: plays
    assert [clip.notes[i].mute for i in (1, 2, 3, 4)] == [False, True, False, False]
    assert clip.applies == 2


def test_sixteen_step_pattern_reaches_steps_nine_to_sixteen():
    """ADR-443: a lane runs up to 16 steps; step 12 is its own control."""
    dev = thin_permute({"Mute Rate": 5, "Pitch Rate": 5, "Mute Length": 16, "Mute 12": 0.0})
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    for beats in (0.0, 7.0, 8.0, 11.0):
        play_to(song, comp, clock, beats)
    assert clip.notes[1].mute is True                  # step 12 (index 11): muted
    assert comp.stats()["instances"][0]["mute"]["len"] == 16
    play_to(song, comp, clock, 12.0)
    assert clip.notes[1].mute is False
    play_to(song, comp, clock, 16.0)                   # wraps after 16, not 8
    assert [s[2] for s in rec.steps(KIND_MUTE)] == [0, 7, 8, 11, 12, 0]


def test_pre_sixteen_step_device_plays_its_eight_steps():
    """A device from before ADR-443 (22 controls) still runs: steps 9-16 are
    missing and read as the default, which its 1..8 length never reaches."""
    dev = mute_pattern([1])
    dev.parameters = [p for p in dev.parameters
                      if not any(p.name == f"{lane} {i}" for lane in ("Mute", "Pitch") for i in range(9, 17))]
    assert len(dev.parameters) == 23
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, _rec, clock = build(song)
    play_to(song, comp, clock, 1.0)
    assert clip.notes[1].mute is True
    play_to(song, comp, clock, 8.0)                    # length 8: back to step 0
    assert clip.notes[1].mute is False
    assert len(comp.stats()["instances"][0]["missing"]) == 16


def test_mute_restores_on_stop_disable_disconnect_and_removal():
    dev = mute_pattern([0, 1, 2, 3, 4, 5, 6, 7])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    flag = {"on": True}
    rec = Recorder(); clock = Clock()
    comp = SequencerComponent(song, rec, is_enabled=lambda: flag["on"], clock=clock, lookahead=False)
    play_to(song, comp, clock, 0.0)
    assert clip.notes[1].mute is True
    song.is_playing = False; comp.tick()
    assert clip.notes[1].mute is False
    play_to(song, comp, clock, 0.0)
    assert clip.notes[1].mute is True
    flag["on"] = False; comp.tick()
    assert clip.notes[1].mute is False
    flag["on"] = True
    play_to(song, comp, clock, 0.0)
    assert clip.notes[1].mute is True
    comp.disconnect()
    assert clip.notes[1].mute is False

    comp2, rec2, clock2 = build(song)
    play_to(song, comp2, clock2, 0.0)
    assert clip.notes[1].mute is True
    comp2.on_device_removed(track, dev._live_ptr)
    comp2.tick()
    assert clip.notes[1].mute is False


def test_audio_mute_zeroes_the_gain_and_restores_it():
    dev = mute_pattern([1])
    clip = FakeClip(is_midi=False)
    clip.gain = 0.4
    track = FakeTrack([dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    assert clip.gain == 0.0
    play_to(song, comp, clock, 2.0)
    assert clip.gain == 0.4
    play_to(song, comp, clock, 9.0)
    assert clip.gain == 0.0
    song.is_playing = False; comp.tick()
    assert clip.gain == 0.4


def _held_audio_clip(gain=0.4):
    dev = mute_pattern([1])
    clip = FakeClip(is_midi=False)
    clip.gain = gain
    track = FakeTrack([dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    return song, comp, clock, clip


def test_held_gain_is_what_the_mute_step_puts_back():
    song, comp, clock, clip = _held_audio_clip(0.4)
    assert comp.held_gain(clip) is None
    play_to(song, comp, clock, 1.0)
    assert (clip.gain, comp.held_gain(clip)) == (0.0, 0.4)
    play_to(song, comp, clock, 2.0)
    assert comp.held_gain(clip) is None
    assert comp.held_gain(FakeClip(is_midi=False)) is None


def test_a_gain_set_under_a_mute_step_stays_silent_and_is_put_back():
    song, comp, clock, clip = _held_audio_clip(0.4)
    assert comp.adopt_gain(clip, 0.7) is False     # nothing holds it yet
    play_to(song, comp, clock, 1.0)
    assert comp.adopt_gain(clip, 0.7) is True
    assert (clip.gain, comp.held_gain(clip)) == (0.0, 0.7)
    play_to(song, comp, clock, 2.0)
    assert clip.gain == 0.7
    play_to(song, comp, clock, 9.0)                 # the next hold keeps it
    assert comp.held_gain(clip) == 0.7
    song.is_playing = False; comp.tick()
    assert clip.gain == 0.7


def test_a_gain_edited_in_live_under_a_mute_step_is_silenced_on_the_next_tick():
    song, comp, clock, clip = _held_audio_clip(0.4)
    play_to(song, comp, clock, 1.0)
    clip.gain = 0.6                                 # the edit reached the clip
    assert comp.adopt_gain(clip, 0.6, rezero=True) is True
    assert clip.gain == 0.6                         # a notification writes nothing
    play_to(song, comp, clock, 1.5)
    assert (clip.gain, comp.held_gain(clip)) == (0.0, 0.6)
    play_to(song, comp, clock, 2.0)
    assert clip.gain == 0.6


def test_the_gain_echo_inside_the_mute_write_reads_as_held():
    """Live fires the clip's gain listener inside the write, so the hold is
    in place before the 0 goes out and gone before the restore does."""
    seen = []

    class EchoingClip(FakeClip):
        def __setattr__(self, name, value):
            object.__setattr__(self, name, value)
            if name == "gain" and getattr(self, "comp", None) is not None:
                seen.append((value, self.comp.held_gain(self)))

    dev = mute_pattern([1])
    clip = EchoingClip(is_midi=False)
    clip.gain = 0.4
    track = FakeTrack([dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    clip.comp = comp
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    play_to(song, comp, clock, 2.0)
    assert seen == [(0.0, 0.4), (0.4, None)]


def test_solo_overrides_the_mute_pattern_at_once():
    dev = mute_pattern([0, 1, 2, 3, 4, 5, 6, 7])
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.notes[1].mute is True
    track.solo = True
    play_to(song, comp, clock, 0.3)                    # mid-step: unmutes now
    assert clip.notes[1].mute is False
    play_to(song, comp, clock, 1.0)                    # next step: still playing while soloed
    assert clip.notes[1].mute is False
    track.solo = False
    play_to(song, comp, clock, 1.3)                    # un-solo mid-step: pattern resumes
    assert clip.notes[1].mute is True
    assert comp.stats()["instances"][0]["solo"] is False


def test_mute_moves_with_a_clip_change_and_lands_on_a_late_clip():
    dev = mute_pattern([0, 1, 2, 3, 4, 5, 6, 7])
    a = FakeClip(notes=[FakeNote(1, 60)])
    b = FakeClip(notes=[FakeNote(7, 40)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(a), FakeSlot(b)], playing_slot_index=-1)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)                    # muted step, nothing playing yet
    assert a.notes[1].mute is False
    track.playing_slot_index = 0
    play_to(song, comp, clock, 0.2)
    assert a.notes[1].mute is True
    track.playing_slot_index = 1
    play_to(song, comp, clock, 0.4)
    assert a.notes[1].mute is False and b.notes[7].mute is True
    song.is_playing = False; comp.tick()
    assert b.notes[7].mute is False


def test_mute_and_pitch_compose_on_one_clip():
    dev = thin_permute({"Mute Rate": 5, "Pitch Rate": 5, "Mute 2": 0.0, "Pitch 2": 1.0})
    clip = FakeClip(notes=[FakeNote(1, 60)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    assert clip.notes[1].pitch == 72 and clip.notes[1].mute is True
    play_to(song, comp, clock, 2.0)
    assert clip.notes[1].pitch == 60 and clip.notes[1].mute is False
    play_to(song, comp, clock, 9.0)
    comp.disconnect()
    assert clip.notes[1].pitch == 60 and clip.notes[1].mute is False


def test_stats_carry_diagnostic_counters_and_the_drum_state():
    class DumpingVM(FakeDrumVM):
        def debug_state(self, path):
            return {"shift": self.shifts()[-1] if self.calls else 0, "path": path}

    kit = FakeDevice("Kit", "DrumGroupDevice")
    dev = pitch_pattern([0])
    song = FakeSong([FakeTrack([kit, dev])])
    vm = DumpingVM()
    comp, rec, clock = build(song, drum_vm=vm)
    play_to(song, comp, clock, 0.0)
    song.is_playing = False
    comp.tick()
    s = comp.stats()
    assert s["counters"]["transitions"] == 2 and s["counters"]["stop_all"] == 1
    assert s["counters"]["pitch_applies"] == 1 and s["counters"]["rescans"] == 1
    assert s["instances"][0]["drum_vm"] == {"shift": 0, "path": "tracks/0/devices/0"}


# --- S4: chance -------------------------------------------------------------------------


def chance_change(comp, dev, value):
    """Move the Chance slider the way Live reports it: the value listener fires."""
    p = dev.param("Chance")
    p.value = value
    comp.on_param_value_changed(p, "x")


def test_slider_move_writes_probability_at_once_even_while_stopped():
    dev = thin_permute()
    clip = FakeClip(notes=[FakeNote(1, 60, probability=1.0), FakeNote(2, 64, probability=0.3)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    comp.tick()                                          # stopped, chance 1.0: nothing written
    assert clip.applies == 0
    chance_change(comp, dev, 0.5)
    assert clip.applies == 0                             # notification context: no write yet
    comp.tick()
    assert [clip.notes[i].probability for i in (1, 2)] == [0.5, 0.5] and clip.applies == 1
    comp.tick()
    assert clip.applies == 1                             # no repeat while nothing changed
    chance_change(comp, dev, 1.0)                        # back to 1.0 is authoritative
    comp.tick()
    assert [clip.notes[i].probability for i in (1, 2)] == [1.0, 1.0]
    assert comp.stats()["counters"]["chance_applies"] == 2


def test_chance_below_one_reapplies_on_clip_change_and_transport_start():
    dev = thin_permute({"Chance": 0.25})
    a = FakeClip(notes=[FakeNote(1, 60)])
    b = FakeClip(notes=[FakeNote(7, 40, probability=0.9)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(a), FakeSlot(b)], playing_slot_index=-1)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    track.playing_slot_index = 0
    play_to(song, comp, clock, 0.0)                      # transport start → the current clip
    assert a.notes[1].probability == 0.25
    track.playing_slot_index = 1
    play_to(song, comp, clock, 0.3)                      # clip change → the new clip
    assert b.notes[7].probability == 0.25
    song.is_playing = False; comp.tick()                 # stop restores nothing: the slider is the truth
    assert b.notes[7].probability == 0.25
    comp.disconnect()
    assert b.notes[7].probability == 0.25


def test_chance_at_one_leaves_a_clips_own_probabilities_alone_on_clip_change():
    dev = thin_permute()                                 # Chance 1.0
    clip = FakeClip(notes=[FakeNote(1, 60, probability=0.4)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.notes[1].probability == 0.4 and clip.applies == 0


def test_chance_ignores_audio_clips_and_survives_a_failing_write():
    dev = thin_permute({"Chance": 0.5})
    audio = FakeClip(is_midi=False)
    track = FakeTrack([dev], slots=[FakeSlot(audio)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert comp.stats()["counters"]["chance_applies"] == 0

    clip = FakeClip(notes=[FakeNote(1, 60)])
    clip.raise_on_apply = RuntimeError("locked")
    track2 = FakeTrack([FakeDevice("Operator", "Operator"), thin_permute({"Chance": 0.5})], slots=[FakeSlot(clip)], playing_slot_index=0)
    song2 = FakeSong([track2])
    comp2, rec2, clock2 = build(song2)
    play_to(song2, comp2, clock2, 0.0)
    assert comp2.stats()["instances"][0]["clip_chance"] is None    # the write raised: nothing recorded
    assert comp2.stats()["ticks"] == 1


# --- S5: temperature (permute ADR-015) ----------------------------------------------------


ORIGINAL = [60, 62, 64, 65, 67, 69, 71, 72]


def melodic_setup(temperature=0.0, pitch_on=(), notes=ORIGINAL):
    values = {"Temperature": temperature, "Mute Rate": 5, "Pitch Rate": 5}
    for i in pitch_on:
        values["Pitch %d" % (i + 1)] = 1.0
    dev = thin_permute(values)
    clip = FakeClip(notes=[FakeNote(i + 1, p, start_time=float(i)) for i, p in enumerate(notes)])
    track = FakeTrack([FakeDevice("Operator", "Operator"), dev], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    return dev, clip, track, song


def temp_change(comp, dev, value):
    p = dev.param("Temperature")
    p.value = value
    comp.on_param_value_changed(p, "x")


def test_temperature_scrambles_from_the_base_and_returns_exactly():
    dev, clip, track, song = melodic_setup()
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    temp_change(comp, dev, 0.8)
    play_to(song, comp, clock, 0.1)
    scrambled = clip.pitches()
    assert sorted(scrambled) == ORIGINAL and scrambled != ORIGINAL
    assert clip.listener_count() == 2
    st = comp.stats()["instances"][0]["clip_temperature"]
    assert st == {"hot": True, "base_notes": 8}
    # Our own write fired `notes`; the content diff must NOT re-baseline.
    play_to(song, comp, clock, 0.2)
    assert comp.stats()["counters"]["temp_rebaselines"] == 0
    # Loop jumps derive fresh variations from the base, never cumulatively.
    for k in range(20):
        clip.fire_loop_jump()
        play_to(song, comp, clock, 0.3 + k * 0.01)
        assert sorted(clip.pitches()) == ORIGINAL
    assert comp.stats()["counters"]["temp_variations"] >= 20
    # Return to 0 rewrites the base verbatim, ids intact, observers gone.
    temp_change(comp, dev, 0.0)
    play_to(song, comp, clock, 1.0)
    assert clip.pitches() == ORIGINAL
    assert sorted(clip.notes) == list(range(1, 9))
    assert clip.listener_count() == 0
    assert comp.stats()["instances"][0]["clip_temperature"] == {"hot": False, "base_notes": 0}


def test_transport_stop_restores_and_restart_captures_the_clean_clip():
    dev, clip, track, song = melodic_setup(temperature=0.9)
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)               # transport start: capture + variation
    assert sorted(clip.pitches()) == ORIGINAL and clip.pitches() != ORIGINAL
    song.is_playing = False; comp.tick()
    assert clip.pitches() == ORIGINAL and clip.listener_count() == 0
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() != ORIGINAL
    comp.disconnect()
    assert clip.pitches() == ORIGINAL and clip.listener_count() == 0


def test_temperature_with_the_pitch_octave_held():
    dev, clip, track, song = melodic_setup(temperature=0.7, pitch_on=(0, 1, 2, 3))
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)               # pitch +12 and a hot variation
    shifted = [p + 12 for p in ORIGINAL]
    assert sorted(clip.pitches()) == shifted and clip.pitches() != shifted
    temp_change(comp, dev, 0.0)
    play_to(song, comp, clock, 0.1)
    assert clip.pitches() == shifted               # return to 0 keeps the octave
    temp_change(comp, dev, 0.7)
    play_to(song, comp, clock, 0.2)
    play_to(song, comp, clock, 4.0)               # step 4: octave off, still hot
    assert sorted(clip.pitches()) == ORIGINAL
    song.is_playing = False; comp.tick()
    assert clip.pitches() == ORIGINAL


def test_a_user_repitch_while_hot_becomes_the_new_base():
    dev, clip, track, song = melodic_setup(temperature=0.5)
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    # The user drags note 3 (base 64) to 80 in Live's editor.
    clip.notes[3].pitch = 80
    clip.fire_notes()
    play_to(song, comp, clock, 0.2)
    assert comp.stats()["counters"]["temp_rebaselines"] == 1
    temp_change(comp, dev, 0.0)
    play_to(song, comp, clock, 0.3)
    expected = list(ORIGINAL); expected[2] = 80
    assert clip.pitches() == expected              # the edit is the new composition


def test_an_overdub_while_hot_is_kept_at_its_pitch_and_folded_in():
    dev, clip, track, song = melodic_setup(temperature=0.6)
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    clip.notes[9] = FakeNote(9, 90, start_time=3.5)   # recorded while hot
    clip.fire_notes()
    play_to(song, comp, clock, 0.2)                    # re-baselined: the overdub joins the base
    assert comp.stats()["instances"][0]["clip_temperature"]["base_notes"] == 9
    for k in range(10):
        clip.fire_loop_jump()
        play_to(song, comp, clock, 0.3 + k * 0.01)
    temp_change(comp, dev, 0.0)
    play_to(song, comp, clock, 1.0)
    assert clip.pitches() == ORIGINAL + [90]


def test_an_overdub_not_yet_observed_is_never_swapped():
    dev, clip, track, song = melodic_setup(temperature=1.0)
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 0.05)                   # service our own write's notification
    clip.notes[9] = FakeNote(9, 90, start_time=3.5)   # the overdub's own notification has not fired
    for k in range(10):
        clip.fire_loop_jump()
        play_to(song, comp, clock, 0.1 + k * 0.01)
        assert clip.notes[9].pitch == 90
    temp_change(comp, dev, 0.0)
    play_to(song, comp, clock, 1.0)
    assert clip.pitches() == ORIGINAL + [90]


def test_clip_change_while_hot_restores_the_old_and_captures_the_new():
    dev, clip, track, song = melodic_setup(temperature=0.8)
    other = FakeClip(notes=[FakeNote(i + 20, p, start_time=float(i)) for i, p in enumerate((40, 43, 47))])
    track.clip_slots.append(FakeSlot(other))
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert clip.pitches() != ORIGINAL
    track.playing_slot_index = 1
    play_to(song, comp, clock, 0.2)
    assert clip.pitches() == ORIGINAL and clip.listener_count() == 0
    assert sorted(other.pitches()) == [40, 43, 47] and other.pitches() != [40, 43, 47]
    assert other.listener_count() == 2


def test_temperature_change_while_hot_keeps_the_base():
    dev, clip, track, song = melodic_setup(temperature=0.3)
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    temp_change(comp, dev, 0.9)
    play_to(song, comp, clock, 0.1)
    clip.fire_loop_jump()
    play_to(song, comp, clock, 0.2)
    temp_change(comp, dev, 0.0)
    play_to(song, comp, clock, 0.3)
    assert clip.pitches() == ORIGINAL


def test_temperature_ignores_audio_clips_and_disable_restores():
    dev = thin_permute({"Temperature": 0.9})
    audio = FakeClip(is_midi=False)
    song = FakeSong([FakeTrack([dev], slots=[FakeSlot(audio)], playing_slot_index=0)])
    comp, rec, clock = build(song)
    play_to(song, comp, clock, 0.0)
    assert comp.stats()["counters"]["temp_variations"] == 0

    dev2, clip, track, song2 = melodic_setup(temperature=0.9)
    flag = {"on": True}
    rec2 = Recorder(); clock2 = Clock()
    import random as _random
    comp2 = SequencerComponent(song2, rec2, is_enabled=lambda: flag["on"], clock=clock2, lookahead=False, rng=_random.Random(3))
    play_to(song2, comp2, clock2, 0.0)
    assert clip.pitches() != ORIGINAL
    flag["on"] = False; comp2.tick()
    assert clip.pitches() == ORIGINAL and clip.listener_count() == 0


# --- review fixes (2026-09-07): rebind on a path move, toggle OFF while stopped ---


def test_rescan_rebinds_the_drum_state_when_the_rack_path_moves():
    kit = FakeDevice("Kit", "DrumGroupDevice")
    dev = pitch_pattern([0, 1, 2, 3])
    t1 = FakeTrack([kit, dev])
    song = FakeSong([FakeTrack([]), t1])
    vm = FakeDrumVM()
    comp, rec, clock = build(song, drum_vm=vm)
    assert comp.stats()["instances"][0]["rack"] == "tracks/1/devices/0"
    play_to(song, comp, clock, 0.0)
    assert vm.calls == [(kit, "tracks/1/devices/0", 12)]
    song.tracks = [t1]                                     # the track above is deleted
    comp.on_structural_change()                            # notification context: bookkeeping only
    assert vm.rebinds == [(kit, "tracks/0/devices/0")]
    assert comp.stats()["instances"][0]["rack"] == "tracks/0/devices/0"
    play_to(song, comp, clock, 4.0)                        # step 4: off
    assert vm.calls[-1] == (kit, "tracks/0/devices/0", 0)
    comp.on_structural_change()                            # no move: no rebind
    assert len(vm.rebinds) == 1


def test_rescan_after_a_track_delete_restores_the_pads_through_the_real_provider():
    from components.DrumVirtualMacroComponent import DrumVirtualMacroComponent
    from tests.test_drum_virtual_macro_component import cells, drumcell, make_rack, pad, param

    rack = make_rack([pad(36, drumcell(values={"Transpose": 0.0})), pad(37, drumcell(values={"Transpose": 3.0}))])
    dev = pitch_pattern([0, 1, 2, 3])
    t1 = FakeTrack([rack, dev])
    song = FakeSong([FakeTrack([]), t1])
    emits = []
    vm = DrumVirtualMacroComponent(emit=lambda a, args: emits.append((a, args)))
    comp, rec, clock = build(song, drum_vm=vm)

    def transposes():
        return [param(c, "Transpose").value for c in cells(rack)]

    play_to(song, comp, clock, 0.0)                        # step 0 on: +12 on every pad
    assert transposes() == [12, 15]
    assert vm.sequencer_shift("tracks/1/devices/0") == 12
    song.tracks = [t1]                                     # delete the empty track above the kit
    comp.on_structural_change()
    assert list(vm._states) == ["tracks/0/devices/0"]      # the state followed the rack
    assert vm.sequencer_shift("tracks/0/devices/0") == 12
    play_to(song, comp, clock, 4.0)                        # step 4 off: restore through the moved state
    assert transposes() == [0, 3]
    assert vm.read(rack, "tracks/0/devices/0", "pitch") == 0
    play_to(song, comp, clock, 8.0)                        # step 0 again: +12 from home, not +24
    assert transposes() == [12, 15]
    song.is_playing = False
    comp.tick()                                            # stop leaves home
    assert transposes() == [0, 3]
    assert vm.sequencer_shift("tracks/0/devices/0") == 0


def test_toggle_off_while_stopped_restores_a_hot_temperature():
    dev, clip, track, song = melodic_setup()
    flag = {"on": True}
    rec = Recorder(); clock = Clock()
    import random as _random
    comp = SequencerComponent(song, rec, is_enabled=lambda: flag["on"], clock=clock, lookahead=False, rng=_random.Random(1))
    comp.tick()                                            # stopped, cold: nothing written
    assert clip.applies == 0
    temp_change(comp, dev, 0.9)
    comp.tick()                                            # the slider move applies while stopped
    assert clip.applies == 1 and clip.listener_count() == 2
    for k in range(5):                                     # loop jumps keep varying, transport still stopped
        clip.fire_loop_jump()
        comp.tick()
    assert sorted(clip.pitches()) == ORIGINAL and clip.pitches() != ORIGINAL
    assert comp.stats()["active"] is False
    rec.clear()
    flag["on"] = False
    comp.tick()                                            # OFF restores everything applied
    assert clip.pitches() == ORIGINAL
    assert clip.listener_count() == 0
    assert rec.steps() == [("tracks/0/devices/1", KIND_MUTE, -1), ("tracks/0/devices/1", KIND_PITCH, -1)]
    comp.tick()
    assert len(rec.steps()) == 2                           # idle emitted once
    assert comp.stats()["instances"][0]["clip_temperature"] == {"hot": False, "base_notes": 0}


# --- a Permute inside a pad's chain (ADR-435, 2026-09-14) ---------------------------
#
# The rack fakes are the drum components' own (``tests.support.lom_fakes``):
# 128 pads, a chain per populated pad with its ``devices`` listener, the
# rack's pad-list listeners. The thin device inside a chain is this file's
# ``thin_permute``; its parameters carry value listeners, which is what a
# pad instance has to bring itself.

from tests.support.lom_fakes import FakeChain as RackChain
from tests.support.lom_fakes import FakePad, cells, drumcell, make_rack
from tests.support.lom_fakes import param as rack_param

RACK = "tracks/0/devices/0"


def pad_kit(chains):
    """A Drum Rack whose pads carry ``{note: [the devices after the cell]}``."""
    return make_rack([
        FakePad(note, [RackChain([drumcell()] + list(extra))], name="Pad %d" % note)
        for note, extra in chains.items()
    ])


def test_discovers_a_permute_inside_a_pad_chain_as_a_pad_instance():
    seq = pitch_pattern([0])
    rack = pad_kit({36: [], 38: [seq]})
    song = FakeSong([FakeTrack([rack])])
    vm = FakeDrumVM()
    comp, rec, clock = build(song, drum_vm=vm)
    inst = comp.stats()["instances"]
    assert [(i["path"], i["route"], i["pad"], i["rack"]) for i in inst] == [
        (RACK + "/pads/38/devices/1", "pad", 38, RACK),
    ]
    assert comp.stats()["rescan"]["watchers"] == 1
    assert rack.listener_count() == 2                         # drum_pads + chains
    assert rack.drum_pads[36].chains[0].listener_count() == 1  # every populated pad is watched
    assert rack.drum_pads[38].chains[0].listener_count() == 1
    play_to(song, comp, clock, 0.0)                           # step 0 on: the pad's own term, never the kit's
    assert vm.pad_calls == [(rack, RACK, 38, 12)]
    assert vm.calls == []
    assert rec.steps(KIND_PITCH) == [(RACK + "/pads/38/devices/1", KIND_PITCH, 0)]
    song.is_playing = False
    comp.tick()
    assert vm.pad_calls[-1] == (rack, RACK, 38, 0)
    assert comp.stats()["instances"][0]["drum_shift"] == 0


def test_a_rack_nested_in_an_instrument_rack_is_not_walked_for_pad_permutes():
    seq = pitch_pattern([0])
    inner = pad_kit({38: [seq]})
    outer = FakeDevice("Rack", "InstrumentGroupDevice", chains=[FakeChain([inner])])
    comp, rec, clock = build(FakeSong([FakeTrack([outer])]), drum_vm=FakeDrumVM())
    assert comp.stats()["instances"] == []                    # the wire has no path to that pad
    assert comp.stats()["rescan"]["watchers"] == 0


def test_pad_instance_mutes_and_unmutes_only_the_pads_notes():
    seq = mute_pattern([0])
    rack = pad_kit({36: [], 38: [seq]})
    clip = FakeClip(notes=[FakeNote(1, 36), FakeNote(2, 38), FakeNote(3, 38, start_time=1.0), FakeNote(4, 42)])
    track = FakeTrack([rack], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    play_to(song, comp, clock, 0.0)                           # step 0 off → the pad's notes muted
    assert [clip.notes[i].mute for i in (1, 2, 3, 4)] == [False, True, True, False]
    assert clip.scoped_reads >= 1                             # read through the ranged form
    assert comp.stats()["instances"][0]["clip_mute"] == {"applied": True, "notes": 2}
    play_to(song, comp, clock, 1.0)                           # step 1 on → back
    assert [clip.notes[i].mute for i in (1, 2, 3, 4)] == [False] * 4


def test_pad_instance_filters_a_full_read_when_the_clip_lacks_the_ranged_form():
    class OldClip(FakeClip):
        get_notes_extended = None                             # not callable → TypeError → the fallback

    seq = mute_pattern([0])
    rack = pad_kit({38: [seq]})
    clip = OldClip(notes=[FakeNote(1, 36), FakeNote(2, 38)])
    track = FakeTrack([rack], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    play_to(song, comp, clock, 0.0)
    assert (clip.notes[1].mute, clip.notes[2].mute) == (False, True)
    assert clip.scoped_reads == 0


def test_pad_instance_leaves_an_audio_clip_alone():
    seq = mute_pattern([0])
    rack = pad_kit({38: [seq]})
    clip = FakeClip(is_midi=False)
    clip.gain = 0.7
    track = FakeTrack([rack], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    play_to(song, comp, clock, 0.0)
    assert clip.gain == 0.7


def test_pad_instance_chance_writes_only_its_notes_and_the_kit_permute_skips_them():
    kit_seq = thin_permute({"Chance": 0.5})
    pad_seq = thin_permute({"Chance": 0.25})
    rack = pad_kit({36: [], 38: [pad_seq]})
    clip = FakeClip(notes=[FakeNote(1, 36), FakeNote(2, 38)])
    track = FakeTrack([rack, kit_seq], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    play_to(song, comp, clock, 0.0)                           # transport start applies both, below 1.0
    assert clip.notes[1].probability == 0.5                   # the kit's, on the ungoverned pad
    assert clip.notes[2].probability == 0.25                  # the pad's own value wins on its notes
    chance_change(comp, kit_seq, 0.1)
    comp.tick()
    assert (clip.notes[1].probability, clip.notes[2].probability) == (0.1, 0.25)
    chance_change(comp, pad_seq, 0.9)                         # its own listener carries the slider
    comp.tick()
    assert (clip.notes[1].probability, clip.notes[2].probability) == (0.1, 0.9)


def test_pad_instance_pattern_rides_its_own_value_listeners():
    seq = mute_pattern([])
    rack = pad_kit({38: [seq]})
    song = FakeSong([FakeTrack([rack])])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    p = seq.param("Mute 1")
    assert len(p._listeners) == 1                             # the engine's own — nothing else reaches a chain device
    p.value = 0.0                                             # moved in Live: no LOMListeners fan-out here
    inst = next(iter(comp._instances.values()))
    assert inst.values["mute1"] == 0.0
    comp.on_structural_change()                               # a rescan re-syncs by id: still one listener
    assert len(p._listeners) == 1
    comp.disconnect()
    assert p._listeners == []


def test_a_permute_dropped_into_a_pad_chain_is_found_on_the_deferred_rescan():
    rack = pad_kit({36: [], 38: []})
    song = FakeSong([FakeTrack([rack])])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    assert comp.stats()["instances"] == []
    seq = pitch_pattern([0])
    rack.drum_pads[38].chains[0].insert(1, seq)               # Live fires the chain's devices listener
    assert comp.stats()["instances"] == []                    # notification context: nothing yet
    assert comp.stats()["rescan"]["due"] is True
    comp.tick()                                               # too early: the chain is still populating
    assert comp.stats()["instances"] == []
    clock.now += 0.2
    comp.tick()
    assert [i["path"] for i in comp.stats()["instances"]] == [RACK + "/pads/38/devices/1"]
    assert comp.stats()["counters"]["pad_rescans"] == 1
    assert comp.stats()["rescan"]["due"] is False
    # A pad that gains a chain after the watcher attached is watched from
    # the next pass on.
    rack.drum_pads[40].chains.append(RackChain([drumcell()]))
    rack.fire("drum_pads")
    clock.now += 0.2
    comp.tick()
    assert rack.drum_pads[40].chains[0].listener_count() == 1


def test_a_pad_permute_removed_in_live_is_retired_and_restored():
    seq = mute_pattern([0])
    rack = pad_kit({38: [seq]})
    clip = FakeClip(notes=[FakeNote(1, 38)])
    track = FakeTrack([rack], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    play_to(song, comp, clock, 0.0)
    assert clip.notes[1].mute is True
    p = seq.param("Mute 1")
    rec.clear()
    rack.drum_pads[38].chains[0].delete_device(1)
    clock.now += 0.2
    comp.tick()                                               # rescan → retire → restore, on the one tick
    assert clip.notes[1].mute is False
    assert comp.stats()["instances"] == []
    assert rec.steps() == [(RACK + "/pads/38/devices/1", KIND_MUTE, -1), (RACK + "/pads/38/devices/1", KIND_PITCH, -1)]
    assert p._listeners == []                                 # the own listener went with it


def test_a_rack_removed_drops_its_watcher_and_its_pad_permute():
    seq = mute_pattern([0])
    rack = pad_kit({38: [seq]})
    track = FakeTrack([rack])
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    assert comp.stats()["rescan"]["watchers"] == 1
    track.devices = []
    comp.on_structural_change()
    assert comp.stats()["rescan"]["watchers"] == 0
    assert rack.listener_count() == 0
    assert rack.drum_pads[38].chains[0].listener_count() == 0
    comp.tick()
    assert comp.stats()["instances"] == []


def test_pad_instance_temperature_is_inert():
    seq = thin_permute({"Temperature": 0.9})
    rack = pad_kit({38: [seq]})
    clip = FakeClip(notes=[FakeNote(1, 38), FakeNote(2, 38, start_time=1.0)])
    track = FakeTrack([rack], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM())
    play_to(song, comp, clock, 0.0)
    assert clip.applies == 0 and clip.listener_count() == 0
    temp_change(comp, seq, 0.5)
    comp.tick()
    assert clip.applies == 0
    assert comp.stats()["instances"][0]["clip_temperature"] == {"hot": False, "base_notes": 0}


def test_kit_and_pad_permutes_compose_through_the_real_provider():
    from components.DrumVirtualMacroComponent import DrumVirtualMacroComponent

    kit_seq = pitch_pattern([0, 1])
    pad_seq = pitch_pattern([1, 2])
    rack = pad_kit({36: [], 38: [pad_seq]})
    song = FakeSong([FakeTrack([rack, kit_seq])])
    vm = DrumVirtualMacroComponent(emit=lambda a, args: None)
    comp, rec, clock = build(song, drum_vm=vm)

    def transposes():
        return [rack_param(c, "Transpose").value for c in cells(rack)]

    play_to(song, comp, clock, 0.0)                           # kit step 0 on, pad step 0 off
    assert transposes() == [12, 12]
    play_to(song, comp, clock, 1.0)                           # both on: they add on the pad
    assert transposes() == [12, 24]
    play_to(song, comp, clock, 2.0)                           # kit off, pad on
    assert transposes() == [0, 12]
    assert vm.pad_sequencer_shift(RACK, 38) == 12
    assert vm.read(rack, RACK, "pad.38.pitch") == 0           # the pad row reads without either term
    assert vm.read(rack, RACK, "pitch") == 0
    play_to(song, comp, clock, 3.0)                           # both off
    assert transposes() == [0, 0]
    play_to(song, comp, clock, 10.0)                          # round again, step 2: the pad on alone
    assert transposes() == [0, 12]
    song.is_playing = False
    comp.tick()                                               # stop puts both back
    assert transposes() == [0, 0]
    assert vm.pad_sequencer_shift(RACK, 38) == 0 and vm.sequencer_shift(RACK) == 0


# --- the kit's Temperature over a pad's mute and Chance (ADR-435 addendum, 2026-09-18) ---


KIT_NOTES = [36, 38, 42, 36, 38, 42, 36, 38]


def kit_and_held_pad(seed=1, pad_chance=None, kit_chance=None, notes=None):
    """A kit whose track-level Permute runs hot (Temperature 0.9) while
    pad 38's Permute mutes step 0 at quarter-note rate. Notes alternate
    36 / 38 / 42 with distinct start times so the shuffle has neighbours."""
    pad_values = {"Mute Rate": 5, "Pitch Rate": 5, "Mute 1": 0.0}
    if pad_chance is not None:
        pad_values["Chance"] = pad_chance
    pad_seq = thin_permute(pad_values)
    kit_values = {"Temperature": 0.9, "Mute Rate": 5, "Pitch Rate": 5}
    if kit_chance is not None:
        kit_values["Chance"] = kit_chance
    kit = thin_permute(kit_values)
    rack = pad_kit({36: [], 38: [pad_seq], 42: []})
    if notes is None:
        notes = [FakeNote(i + 1, p, start_time=i * 0.5) for i, p in enumerate(KIT_NOTES)]
    clip = FakeClip(notes=notes)
    track = FakeTrack([rack, kit], slots=[FakeSlot(clip)], playing_slot_index=0)
    song = FakeSong([track])
    comp, rec, clock = build(song, drum_vm=FakeDrumVM(), seed=seed)
    return comp, clock, song, clip, kit, pad_seq


def muted(clip):
    return sorted((n.pitch, n.note_id) for n in clip.notes.values() if n.mute)


def on_pad(clip, pitch=38):
    return [n for n in clip.notes.values() if n.pitch == pitch]


def test_kit_temperature_keeps_a_pads_mute_on_the_pad():
    """Seed 1 is the stranding case reproduced 2026-09-18: the loop-jump
    variation carried two muted notes off pad 38 and two unmuted ones
    onto it, the pad's unmute found one of its three, and a return to 0
    and a stop left the other two muted on pads 42 and 36."""
    comp, clock, song, clip, kit, pad_seq = kit_and_held_pad(seed=1)
    play_to(song, comp, clock, 0.0)                 # variation 1, then the pad mutes what sits on 38
    assert len(muted(clip)) == 3 and all(p == 38 for p, _ in muted(clip))
    writes = clip.applies
    clip.fire_loop_jump()
    play_to(song, comp, clock, 0.1)                 # variation 2 with the pad still held
    assert clip.applies == writes + 1               # the settle rode inside the variation's write
    assert sorted(clip.pitches()) == sorted(KIT_NOTES) and clip.pitches() != KIT_NOTES
    assert on_pad(clip) and all(n.mute for n in on_pad(clip))          # whatever landed on 38 is silent
    assert not any(n.mute for n in clip.notes.values() if n.pitch != 38)  # nothing muted elsewhere
    assert comp.stats()["instances"][0]["clip_mute"] == {"applied": True, "notes": len(on_pad(clip))}
    play_to(song, comp, clock, 1.0)                 # pad step 1 → play: its unmute finds every id
    assert muted(clip) == []
    clip.fire_loop_jump()
    play_to(song, comp, clock, 1.1)                 # a variation with the pad open mutes nothing
    assert muted(clip) == []
    play_to(song, comp, clock, 8.0)                 # step 0 again: the current occupants of 38
    assert all(n.mute for n in on_pad(clip)) and len(muted(clip)) == len(on_pad(clip))
    temp_change(comp, kit, 0.0); comp.tick()        # back to base while held: the mute stays on the pad
    assert clip.pitches() == KIT_NOTES
    assert muted(clip) == [(38, 2), (38, 5), (38, 8)]
    song.is_playing = False; comp.tick()            # stop: nothing stranded
    assert muted(clip) == [] and clip.pitches() == KIT_NOTES
    assert clip.listener_count() == 0


def test_kit_temperature_moves_chance_with_the_pad():
    comp, clock, song, clip, kit, pad_seq = kit_and_held_pad(seed=1, pad_chance=0.3, kit_chance=0.7)

    def expected():
        return all(abs(n.probability - (0.3 if n.pitch == 38 else 0.7)) < 1e-9 for n in clip.notes.values())

    play_to(song, comp, clock, 0.0)                 # start: both Chances land, then variation 1
    assert expected()
    for k in range(6):
        clip.fire_loop_jump()
        play_to(song, comp, clock, 0.1 + k * 0.1)   # every variation: the pad's value on 38, the kit's elsewhere
        assert expected()
    temp_change(comp, kit, 0.0); comp.tick()        # back to base: still each pad's own value
    assert clip.pitches() == KIT_NOTES and expected()


def test_kit_temperature_leaves_a_hand_muted_note_and_an_overdub_alone():
    notes = [FakeNote(i + 1, p, start_time=i * 0.5) for i, p in enumerate(KIT_NOTES)]
    notes[0].mute = True                            # the user muted the first kick by hand
    comp, clock, song, clip, kit, pad_seq = kit_and_held_pad(seed=1, notes=notes)
    play_to(song, comp, clock, 0.0)                 # seed 1 moves that kick onto 38 in variation 1
    assert clip.notes[1].pitch == 38 and clip.notes[1].mute
    assert comp.stats()["instances"][0]["clip_mute"]["notes"] == 2   # the pad remembers only its own two
    clip.notes[9] = FakeNote(9, 38, start_time=3.75)  # recorded on the held pad, not yet in the base
    clip.fire_loop_jump()
    play_to(song, comp, clock, 0.1)                 # variation 2 moves the kick off 38 again
    assert clip.notes[1].pitch != 38 and clip.notes[1].mute            # hand mute survives the move
    assert clip.notes[9].pitch == 38 and not clip.notes[9].mute        # the overdub keeps playing
    play_to(song, comp, clock, 1.0)                 # pad → play
    assert clip.notes[1].mute and not clip.notes[9].mute
    assert not any(n.mute for n in clip.notes.values() if n.note_id != 1)
    song.is_playing = False; comp.tick()
    assert clip.notes[1].mute and clip.notes[1].pitch == 36            # still the user's, back home
    assert not clip.notes[9].mute


# --- the gate wire --------------------------------------------------------------------


def test_the_gate_states_the_mute_lane_to_a_max_device():
    """A track whose instrument makes its own notes has no clip for the
    mute lane to write to. The wire is the only thing it can hear."""
    dev = mute_pattern([1, 2])
    song = FakeSong([FakeTrack([FakeDevice("Rack", "InstrumentGroupDevice"), dev])])
    gate = Recorder()
    comp, rec, clock = build(song, gate=gate)
    play_to(song, comp, clock, 0.0)          # step 0 plays
    play_to(song, comp, clock, 1.0)          # step 1 muted
    play_to(song, comp, clock, 2.0)          # step 2 muted too
    play_to(song, comp, clock, 3.0)          # plays again
    assert gate_flips(gate) == [(0, 1), (0, 0), (0, 1)]
    assert set(a for a, _ in gate.emits) == {V3_PERMUTE_GATE_ADDRESS}
    song.is_playing = False
    comp.tick()                              # a stop must never leave it shut
    assert gate_flips(gate)[-1] == (0, 1)


def test_the_gate_writes_nothing_to_live():
    """The whole reason it exists: a mute lane at rate would otherwise put
    an undo step on Live's stack per transition."""
    rack = FakeDevice("Rack", "InstrumentGroupDevice",
                      [FakeParam("Device On", 1.0), FakeParam("Mute", 0.0)])
    dev = mute_pattern([1])
    song = FakeSong([FakeTrack([rack, dev])])
    gate = Recorder()
    comp, rec, clock = build(song, gate=gate)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)          # muted
    play_to(song, comp, clock, 2.0)          # and back
    assert gate_flips(gate) == [(0, 1), (0, 0), (0, 1)]
    # A macro called Mute is just a macro called Mute.
    assert rack.param("Mute").value == 0.0


def test_the_gate_names_the_track_it_is_on():
    dev = mute_pattern([0])
    song = FakeSong([FakeTrack([]), FakeTrack([]), FakeTrack([dev])])
    gate = Recorder()
    comp, rec, clock = build(song, gate=gate)
    play_to(song, comp, clock, 0.0)
    assert gate.emits[-1] == (V3_PERMUTE_GATE_ADDRESS, (2, 0))


def test_the_gate_repeats_on_a_heartbeat_so_a_dropped_datagram_heals():
    dev = mute_pattern([0])
    song = FakeSong([FakeTrack([dev])])
    gate = Recorder()
    comp, rec, clock = build(song, gate=gate)
    play_to(song, comp, clock, 0.0)          # step 0 muted
    assert gate.emits[-1] == (V3_PERMUTE_GATE_ADDRESS, (0, 0))
    n = len(gate.emits)
    play_to(song, comp, clock, 0.1)          # well inside the heartbeat
    assert len(gate.emits) == n
    clock.now += GATE_HEARTBEAT_S
    comp.tick()
    assert gate.emits[-1] == (V3_PERMUTE_GATE_ADDRESS, (0, 0))
    assert len(gate.emits) == n + 1


def test_a_soloed_track_holds_the_gate_open():
    dev = mute_pattern(range(8))             # every step muted
    track = FakeTrack([dev])
    track.solo = True
    song = FakeSong([track])
    gate = Recorder()
    comp, rec, clock = build(song, gate=gate)
    play_to(song, comp, clock, 0.0)
    play_to(song, comp, clock, 1.0)
    assert gate_flips(gate) == [(0, 1)]
    track.solo = False
    play_to(song, comp, clock, 2.0)
    assert gate_flips(gate) == [(0, 1), (0, 0)]


def test_a_pad_permute_states_no_gate():
    """The wire names a track; a pad's mute governs one pad, so a pad
    instance must not claim the whole track's sound."""
    seq = mute_pattern([0])
    kit = pad_kit({38: [seq]})
    song = FakeSong([FakeTrack([kit])])
    gate = Recorder()
    comp, rec, clock = build(song, drum_vm=FakeDrumVM(), gate=gate)
    play_to(song, comp, clock, 0.0)
    assert gate.emits == []


def test_a_failing_gate_sender_does_not_break_the_tick():
    def boom(address, args):
        raise RuntimeError("socket gone")

    dev = mute_pattern([0])
    song = FakeSong([FakeTrack([dev])])
    comp, rec, clock = build(song, gate=boom)
    play_to(song, comp, clock, 0.0)
    assert comp.stats()["ticks"] == 1
    assert comp.stats()["counters"]["gate_emits"] == 0
