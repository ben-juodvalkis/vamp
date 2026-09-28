"""TrackPrepareComponent unit tests.

Covers:

- arg parsing: missing args, empty request_id, unsupported track_type
- decision matrix: track 0 always creates; type mismatch creates;
  empty selection creates; track with session/arrangement clips creates;
  empty same-type track gets reused
- create path: MIDI inline ack; audio defers via schedule_delayed
- LRU idempotency: a duplicate request_id returns the cached ack
  without re-creating the track
- nack path: load failure surfaces ``load-failed`` with the detail
  from ``DeviceLoadComponent.load_into_track``
- empty preset_path: create + (audio) configure but skip the load
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import pytest

from components.TrackPrepareComponent import (
    NACK_CREATE_FAILED,
    NACK_DUPLICATE_FAILED,
    NACK_INVALID_ARGS,
    NACK_LOAD_FAILED,
    NACK_NO_TRACK,
    NACK_UNSUPPORTED_TYPE,
    TrackPrepareComponent,
    V3_TRACK_DUPLICATE_ACK_ADDRESS,
    V3_TRACK_DUPLICATE_NACK_ADDRESS,
    V3_TRACK_PREPARE_ACK_ADDRESS,
    V3_TRACK_PREPARE_NACK_ADDRESS,
)
from components.TrackMetadataComponent import (
    TRACK_PRESET_DATA_KEY,
    V3_TRACK_PRESET_ADDRESS,
)


# --- stubs ----------------------------------------------------------------


class StubSlot:
    def __init__(self, has_clip=False):
        self.has_clip = has_clip
        self.audio_clip_path = None
        self.delete_calls = 0

    def create_audio_clip(self, path):
        self.audio_clip_path = path
        self.has_clip = True

    def delete_clip(self):
        self.delete_calls += 1
        self.has_clip = False


class RaisingDeleteSlot(StubSlot):
    """A slot whose ``delete_clip`` raises — the clear must warn past it
    and still ack, since the duplicate itself already succeeded."""

    def delete_clip(self):
        self.delete_calls += 1
        raise RuntimeError("delete boom")


class StubRoutingChannel:
    def __init__(self, name):
        self.display_name = name


class StubTrack:
    def __init__(
        self,
        has_midi_input=False,
        slots=None,
        arrangement_clips=None,
        available_input_channels=None,
    ):
        self.has_midi_input = has_midi_input
        self.has_audio_input = not has_midi_input
        self.clip_slots = list(slots or [StubSlot() for _ in range(8)])
        self.arrangement_clips = list(arrangement_clips or [])
        self.available_input_routing_channels = list(
            available_input_channels or [StubRoutingChannel("11/12 Guitar Mic")]
        )
        self.input_routing_channel = None
        self.arm = False
        self.devices = []


class StubSongView:
    def __init__(self, selected_track=None):
        self.selected_track = selected_track


class StubSong:
    def __init__(self, tracks=None, selected=None):
        self._tracks = list(tracks or [])
        self.view = StubSongView(selected_track=selected)
        # Track which create_*_track call ran, for assertions.
        self.create_calls: List[str] = []

    @property
    def tracks(self):
        return list(self._tracks)

    def create_audio_track(self, index):
        self.create_calls.append(("audio", index))
        new = StubTrack(has_midi_input=False)
        if index == -1 or index >= len(self._tracks):
            self._tracks.append(new)
        else:
            self._tracks.insert(index, new)

    def create_midi_track(self, index):
        self.create_calls.append(("midi", index))
        new = StubTrack(has_midi_input=True)
        if index == -1 or index >= len(self._tracks):
            self._tracks.append(new)
        else:
            self._tracks.insert(index, new)

    def duplicate_track(self, index):
        # Live inserts the copy directly after the source (index + 1).
        self.create_calls.append(("duplicate", index))
        source = self._tracks[index]
        copy = StubTrack(
            has_midi_input=source.has_midi_input,
            # Live's copy carries the source's CLIPS as well as its chain
            # — which is the whole reason the variation gesture has to
            # empty it afterwards.
            slots=[StubSlot(has_clip=s.has_clip) for s in source.clip_slots],
        )
        # Carry the device chain forward, as Live does for a real
        # duplicate (includes Permute).
        copy.devices = [StubDevice(d.name) for d in source.devices]
        self._tracks.insert(index + 1, copy)


class RaisingDuplicateSong(StubSong):
    """StubSong whose duplicate_track raises, to exercise the
    duplicate-failed nack path."""

    def duplicate_track(self, index):
        raise RuntimeError("duplicate boom")


class StubParameter:
    def __init__(self, name):
        self.name = name


class StubDevice:
    def __init__(self, name, parameters=None):
        self.name = name
        # Index 0 is Live's own "Device On"; macros start at 1 — the same
        # offset `macroLayoutUtils.ts` reads (`parameterNames[1]`).
        self.parameters = list(parameters or [])


def metronome_device():
    """An Instrument Rack shaped like the Skaka Metronome Rack: macro 1
    named "Pattern N" (macro 2 "Offset", per the real rack, though only
    macro 1's name is ever read)."""
    return StubDevice(
        "Skaka Metronome Rack",
        parameters=[StubParameter("Device On"), StubParameter("Pattern 4"), StubParameter("Offset")],
    )


class StubDeviceLoad:
    def __init__(self, error: Optional[str] = None, sequencer_error: Optional[str] = None):
        self._error = error
        self._sequencer_error = sequencer_error
        self.calls: List[Tuple[object, str]] = []

    def load_into_track(self, track, preset_path, at_head=False, source="", rel=""):
        self.calls.append((track, preset_path))
        # Mutate the stub track's device chain so _track_has_sequencer
        # observes the side effect — same shape Live exposes (devices
        # list grows as load_item runs).
        if preset_path == SEQUENCER_PATH:
            if self._sequencer_error is not None:
                return self._sequencer_error
            track.devices.append(StubDevice("Permute"))
            return None
        if self._error is not None:
            return self._error
        track.devices.append(StubDevice("Instrument"))
        return None

    # .alc clip-load: browser creates the track. The stub appends a track
    # to the song and returns it (or an error to trigger the raw fallback).
    def __init_alc__(self):
        pass

    def load_clip_new_track(self, alc_path, source="", rel=""):
        self.clip_calls = getattr(self, "clip_calls", [])
        self.clip_calls.append(alc_path)
        err = getattr(self, "_clip_error", None)
        if err is not None:
            return None, err
        song = getattr(self, "_song", None)
        if song is None:
            return None, "no-song"
        new = StubTrack(has_midi_input=False)
        song._tracks.append(new)
        return new, None

    def preset_calls(self):
        return [c for c in self.calls if c[1] != SEQUENCER_PATH]

    def sequencer_calls(self):
        return [c for c in self.calls if c[1] == SEQUENCER_PATH]


class Recorder:
    def __init__(self):
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address, args):
        self.emissions.append((address, tuple(args)))

    def acks(self):
        return [a for addr, a in self.emissions if addr == V3_TRACK_PREPARE_ACK_ADDRESS]

    def nacks(self):
        return [a for addr, a in self.emissions if addr == V3_TRACK_PREPARE_NACK_ADDRESS]

    def duplicate_acks(self):
        return [
            a for addr, a in self.emissions
            if addr == V3_TRACK_DUPLICATE_ACK_ADDRESS
        ]

    def duplicate_nacks(self):
        return [
            a for addr, a in self.emissions
            if addr == V3_TRACK_DUPLICATE_NACK_ADDRESS
        ]


class DeferredScheduler:
    """schedule_delayed stub. Captures pending callables so tests can
    fire them when ready (or assert they were never scheduled)."""

    def __init__(self):
        self.pending: List[Tuple[int, callable]] = []

    def __call__(self, delay, fn):
        self.pending.append((delay, fn))

    def fire_all(self):
        while self.pending:
            _, fn = self.pending.pop(0)
            fn()


SEQUENCER_PATH = "/test/Permute.amxd"
CONSTANTS = {
    "audio": {"defaultInputChannel": "11/12 Guitar Mic"},
    "devices": {"sequencer": {"devicePath": SEQUENCER_PATH}},
}


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def scheduler():
    return DeferredScheduler()


def make_component(
    song,
    device_load=None,
    scheduler=None,
    should_auto_arm=lambda: True,
):
    recorder = Recorder()
    component = TrackPrepareComponent(
        song=song,
        emit=recorder,
        device_load_component=device_load or StubDeviceLoad(),
        constants=CONSTANTS,
        schedule_delayed=scheduler or DeferredScheduler(),
        should_auto_arm=should_auto_arm,
    )
    return component, recorder


# --- arg parsing ----------------------------------------------------------


def test_missing_args_drops_silently():
    """No request_id available → can't ack/nack. Just log and drop."""
    song = StubSong(tracks=[StubTrack()])
    component, recorder = make_component(song)
    component.handle_prepare(args=(), source_addr=None)
    assert recorder.emissions == []


def test_empty_request_id_drops():
    song = StubSong(tracks=[StubTrack()])
    component, recorder = make_component(song)
    component.handle_prepare(args=("", "audio", ""), source_addr=None)
    assert recorder.emissions == []


def test_unsupported_track_type_nacks():
    song = StubSong(tracks=[StubTrack()])
    component, recorder = make_component(song)
    component.handle_prepare(args=("req-1", "drum", ""), source_addr=None)
    nacks = recorder.nacks()
    assert len(nacks) == 1
    rid, code, _detail = nacks[0]
    assert rid == "req-1"
    assert code == NACK_UNSUPPORTED_TYPE


# --- decision matrix ------------------------------------------------------


def test_creates_when_selected_is_track_zero(scheduler):
    """Track 0 always triggers a create even if it would be reusable."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(
        song, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-1", "midi", ""), source_addr=None)
    # MIDI create is inline.
    assert song.create_calls == [("midi", -1)]
    acks = recorder.acks()
    assert len(acks) == 1
    rid, track_path, was_created = acks[0]
    assert rid == "req-1"
    assert track_path == "tracks/1"  # appended after t0
    assert was_created == 1


def test_creates_when_no_selected_track(scheduler):
    song = StubSong(tracks=[StubTrack(has_midi_input=True)], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-2", "midi", ""), source_addr=None)
    assert song.create_calls == [("midi", -1)]
    assert len(recorder.acks()) == 1


def test_reuses_empty_same_type_track(scheduler):
    """Selected non-zero track, no clips, type matches → reuse."""
    t0 = StubTrack(has_midi_input=False)  # audio
    t1 = StubTrack(has_midi_input=True)   # midi, empty
    song = StubSong(tracks=[t0, t1], selected=t1)
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-3", "midi", ""), source_addr=None)
    assert song.create_calls == []
    acks = recorder.acks()
    assert len(acks) == 1
    rid, track_path, was_created = acks[0]
    assert track_path == "tracks/1"
    assert was_created == 0


def test_reuses_when_selected_is_fresh_wrapper_with_matching_live_ptr(scheduler):
    """Regression: Live's v3 framework hands out a fresh Python wrapper
    per ``song.view.selected_track`` read. ``is`` comparison fails even
    when the underlying LOM track is the same one in ``song.tracks``.
    The component must compare by ``_live_ptr`` (via ``_safe_int_id``).

    Pre-fix bug: every prepare_for_preset call created a new track even
    when the user was on a reusable empty same-type track."""
    t0 = StubTrack(has_midi_input=False)
    t1 = StubTrack(has_midi_input=True)
    t1._live_ptr = 0x1234ABCD
    # Different Python wrapper, same LOM identity — what real Live does.
    fresh_wrapper = StubTrack(has_midi_input=True)
    fresh_wrapper._live_ptr = 0x1234ABCD
    assert fresh_wrapper is not t1
    song = StubSong(tracks=[t0, t1], selected=fresh_wrapper)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-fresh", "midi", ""), source_addr=None)
    assert song.create_calls == [], (
        "Expected reuse, but got create — _selected_track_index "
        "fell back to identity comparison and missed the fresh wrapper."
    )
    acks = recorder.acks()
    assert len(acks) == 1
    rid, track_path, was_created = acks[0]
    assert track_path == "tracks/1"
    assert was_created == 0


def test_creates_on_type_mismatch(scheduler):
    """Selected midi track, audio requested → create new."""
    t0 = StubTrack(has_midi_input=False)
    t1 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0, t1], selected=t1)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-4", "audio", ""), source_addr=None)
    assert song.create_calls == [("audio", -1)]
    # Audio create defers — fire the deferred work to land the ack.
    scheduler.fire_all()
    assert len(recorder.acks()) == 1


def test_creates_when_selected_has_session_clip(scheduler):
    t0 = StubTrack(has_midi_input=False)
    busy_slots = [StubSlot(has_clip=True)] + [StubSlot() for _ in range(7)]
    t1 = StubTrack(has_midi_input=True, slots=busy_slots)
    song = StubSong(tracks=[t0, t1], selected=t1)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-5", "midi", ""), source_addr=None)
    assert song.create_calls == [("midi", -1)]


def test_creates_when_selected_has_arrangement_clip(scheduler):
    t0 = StubTrack(has_midi_input=False)
    t1 = StubTrack(has_midi_input=True, arrangement_clips=[object()])
    song = StubSong(tracks=[t0, t1], selected=t1)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-6", "midi", ""), source_addr=None)
    assert song.create_calls == [("midi", -1)]


# --- replace-instrument: pinned target track -----------------------------


def test_pinned_target_loads_onto_track_with_clips_no_create(scheduler):
    """Replace-instrument mode: a 4th arg pins the load to a track that
    HAS a clip. Must load in place (was_created=0), NOT create a new
    track. This is the swap-instrument-on-current-track regression."""
    t0 = StubTrack(has_midi_input=True)
    busy_slots = [StubSlot(has_clip=True)] + [StubSlot() for _ in range(7)]
    t1 = StubTrack(has_midi_input=True, slots=busy_slots)  # has clip
    song = StubSong(tracks=[t0, t1], selected=t1)
    device_load = StubDeviceLoad()
    component, recorder = make_component(song, device_load=device_load, scheduler=scheduler)
    component.handle_prepare(
        args=("req-pin-1", "midi", "/Synth.adv", "tracks/1"), source_addr=None
    )
    # No track created despite the clip on the target.
    assert song.create_calls == []
    # Preset loaded onto the pinned track.
    preset_loads = device_load.preset_calls()
    assert len(preset_loads) == 1
    assert preset_loads[0][0] is t1
    acks = recorder.acks()
    assert len(acks) == 1
    rid, track_path, was_created = acks[0]
    assert rid == "req-pin-1"
    assert track_path == "tracks/1"
    assert was_created == 0


def test_pinned_target_keeps_existing_sequencer_idempotent(scheduler):
    """Pinned track already has Permute → _ensure_sequencer skips it
    (no second append, no double-load)."""
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])
    t1.devices = [StubDevice("Permute")]
    song = StubSong(tracks=[t0, t1], selected=t1)
    device_load = StubDeviceLoad()
    component, recorder = make_component(song, device_load=device_load, scheduler=scheduler)
    component.handle_prepare(
        args=("req-pin-2", "midi", "/Synth.adv", "tracks/1"), source_addr=None
    )
    # Permute already present → no sequencer load fired.
    assert device_load.sequencer_calls() == []
    assert recorder.acks()[0][2] == 0


def test_pinned_target_out_of_range_nacks(scheduler):
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(
        args=("req-pin-3", "midi", "/Synth.adv", "tracks/9"), source_addr=None
    )
    assert song.create_calls == []
    nacks = recorder.nacks()
    assert len(nacks) == 1
    assert nacks[0][1] == NACK_NO_TRACK


def test_pinned_target_malformed_path_nacks(scheduler):
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(
        args=("req-pin-4", "midi", "/Synth.adv", "bogus"), source_addr=None
    )
    nacks = recorder.nacks()
    assert len(nacks) == 1
    assert nacks[0][1] == NACK_INVALID_ARGS


def test_empty_target_arg_falls_back_to_auto_decision(scheduler):
    """A 4-arg message with an EMPTY target string behaves exactly like
    the legacy 3-arg auto path (reuse-vs-create)."""
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])  # has clip
    t2 = StubTrack(has_midi_input=True)  # empty → reuse target
    song = StubSong(tracks=[t0, t1, t2], selected=t1)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(
        args=("req-pin-5", "midi", "", ""), source_addr=None
    )
    # Empty target → auto path scans and reuses the empty t2, no create.
    assert song.create_calls == []
    assert recorder.acks()[0][1] == "tracks/2"


# --- looping.preset: the swap control's reference (ADR-439) ----------------


class DataTrack(StubTrack):
    """StubTrack with Live 12's per-track key-value store."""

    def __init__(self, *args, raises=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.data = {}
        self._raises = raises

    def set_data(self, key, value):
        if self._raises:
            raise RuntimeError("no data store on this build")
        self.data[key] = value


class DataSong(StubSong):
    """Creates tracks that carry a data store, as Live 12's do."""

    def create_audio_track(self, index):
        self.create_calls.append(("audio", index))
        new = DataTrack(has_midi_input=False)
        if index == -1 or index >= len(self._tracks):
            self._tracks.append(new)
        else:
            self._tracks.insert(index, new)


def _preset_echoes(recorder):
    return [a for addr, a in recorder.emissions if addr == V3_TRACK_PRESET_ADDRESS]


class TypedDevice(StubDevice):
    """A device whose ``Device.type`` the record reads: 1 instrument,
    2 audio effect, 4 MIDI effect."""

    def __init__(self, name, class_name, type_=1):
        super().__init__(name)
        self.class_name = class_name
        self.type = type_


class LandingDeviceLoad(StubDeviceLoad):
    """Leaves each preset's device where Live does: an instrument replaces
    the track's instrument in its slot, anything else is appended."""

    def __init__(self, lands):
        super().__init__()
        self._lands = lands

    def load_into_track(self, track, preset_path, at_head=False, source="", rel=""):
        if preset_path not in self._lands:
            return super().load_into_track(track, preset_path)
        self.calls.append((track, preset_path))
        device = self._lands[preset_path]
        for i, existing in enumerate(track.devices):
            if device.type == 1 and getattr(existing, "type", None) == 1:
                track.devices[i] = device
                return None
        track.devices.append(device)
        return None


class TornAfterLoad(DataTrack):
    """A track whose chain cannot be read once a load has landed on it."""

    def __init__(self, *args, **kwargs):
        self.torn = False
        super().__init__(*args, **kwargs)

    @property
    def devices(self):
        if self.torn:
            raise RuntimeError("chain torn down")
        return self._devices

    @devices.setter
    def devices(self, value):
        self._devices = value


class TearingDeviceLoad(StubDeviceLoad):
    """Lands the preset, then leaves the chain unreadable; Permute cannot land."""

    def load_into_track(self, track, preset_path, at_head=False, source="", rel=""):
        self.calls.append((track, preset_path))
        if preset_path == SEQUENCER_PATH:
            return "chain torn down"
        track.torn = True
        return None


OMNI_PATCH = "/Presets/Omni/Keys/Warm.aupreset"


def test_a_landed_replace_load_records_the_preset_and_its_instrument_before_the_ack(scheduler):
    t0 = DataTrack(has_midi_input=True)
    t1 = DataTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])
    t1.devices = [TypedDevice("808 Core Kit", "DrumGroupDevice"), StubDevice("Permute")]
    song = StubSong(tracks=[t0, t1], selected=t1)
    load = LandingDeviceLoad({OMNI_PATCH: TypedDevice("Omnisphere", "AuPluginDevice")})
    component, recorder = make_component(song, device_load=load, scheduler=scheduler)
    component.handle_prepare(args=("req-preset-1", "midi", OMNI_PATCH, "tracks/1"), source_addr=None)
    # The instrument the load left, not the kit it replaced: it is what the
    # T record checks the track against.
    assert t1.data == {TRACK_PRESET_DATA_KEY: {
        "path": OMNI_PATCH,
        "instrument": {"class": "AuPluginDevice", "name": "Omnisphere"},
    }}
    assert _preset_echoes(recorder) == [("tracks/1", OMNI_PATCH)]
    addresses = [addr for addr, _ in recorder.emissions]
    assert addresses.index(V3_TRACK_PRESET_ADDRESS) < addresses.index(V3_TRACK_PREPARE_ACK_ADDRESS)


def test_a_chain_unreadable_after_the_load_clears_the_record(scheduler):
    """With no instrument to pin the path to, an older record must not stay
    standing: it could still match the track and name the wrong preset."""
    t0 = TornAfterLoad(has_midi_input=True)
    t0.data[TRACK_PRESET_DATA_KEY] = {"path": "/Old.adv", "instrument": None}
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(song, device_load=TearingDeviceLoad(), scheduler=scheduler)
    component.handle_prepare(args=("req-preset-6", "midi", "/Synth.adv", "tracks/0"), source_addr=None)
    assert t0.data == {TRACK_PRESET_DATA_KEY: None}
    assert _preset_echoes(recorder) == [("tracks/0", "")]
    assert len(recorder.acks()) == 1


def test_a_failed_load_records_no_preset(scheduler):
    t0 = DataTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(
        song, device_load=StubDeviceLoad(error="landed-nowhere"), scheduler=scheduler,
    )
    component.handle_prepare(args=("req-preset-2", "midi", "/Synth.adv", "tracks/0"), source_addr=None)
    assert t0.data == {} and _preset_echoes(recorder) == []
    assert recorder.nacks()[0][1] == NACK_LOAD_FAILED


def test_an_empty_prepare_records_no_preset(scheduler):
    t0 = DataTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-preset-3", "midi", ""), source_addr=None)
    assert _preset_echoes(recorder) == []


def test_a_deferred_audio_create_records_after_its_load(scheduler):
    t0 = DataTrack(has_midi_input=True)
    song = DataSong(tracks=[t0], selected=t0)
    load = LandingDeviceLoad({"/Guitar.adg": TypedDevice("Guitar", "AudioEffectGroupDevice", type_=2)})
    component, recorder = make_component(song, device_load=load, scheduler=scheduler)
    component.handle_prepare(args=("req-preset-4", "audio", "/Guitar.adg"), source_addr=None)
    assert _preset_echoes(recorder) == [], "nothing is loaded until the deferred finalize runs"
    scheduler.fire_all()
    _, track_path, was_created = recorder.acks()[0]
    assert was_created == 1
    index = int(track_path.split("/")[1])
    # An audio track holds no instrument, so the record names none.
    assert song.tracks[index].data == {TRACK_PRESET_DATA_KEY: {"path": "/Guitar.adg", "instrument": None}}
    assert _preset_echoes(recorder) == [(track_path, "/Guitar.adg")]


def test_a_store_that_refuses_the_write_still_acks(scheduler):
    t0 = DataTrack(has_midi_input=True, raises=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-preset-5", "midi", "/Synth.adv", "tracks/0"), source_addr=None)
    assert _preset_echoes(recorder) == []
    assert len(recorder.acks()) == 1


# --- empty-track scan ----------------------------------------------------


def test_scan_reuses_lowest_empty_when_selected_ineligible(scheduler):
    """Selected has clips → scan finds lowest-index empty matching track
    (not the selected one, and not index 0) and reuses it.
    """
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])  # has clip
    t2 = StubTrack(has_midi_input=True)  # empty, midi → reusable
    t3 = StubTrack(has_midi_input=True)  # also empty, but higher index
    song = StubSong(tracks=[t0, t1, t2, t3], selected=t1)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-1", "midi", ""), source_addr=None)
    assert song.create_calls == []
    acks = recorder.acks()
    assert len(acks) == 1
    rid, track_path, was_created = acks[0]
    assert track_path == "tracks/2"  # lowest empty, not t3
    assert was_created == 0


def test_scan_skips_track_zero_even_when_empty_and_matching(scheduler):
    """Track 0 is permanently off-limits. Selected is None so step 1
    is skipped; the scan must not pick t0 even though it qualifies.
    """
    t0 = StubTrack(has_midi_input=True)  # empty + midi but at index 0
    t1 = StubTrack(has_midi_input=True)  # empty + midi at index 1
    song = StubSong(tracks=[t0, t1], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-2", "midi", ""), source_addr=None)
    assert song.create_calls == []
    acks = recorder.acks()
    assert acks[0][1] == "tracks/1"
    assert acks[0][2] == 0


def test_scan_skips_wrong_type_tracks(scheduler):
    """Audio requested, but lowest empty track is MIDI — scan must
    skip it and continue looking. Only matching type counts."""
    t0 = StubTrack(has_midi_input=False)
    t1 = StubTrack(has_midi_input=True)   # empty but MIDI — skip
    t2 = StubTrack(has_midi_input=False)  # empty audio — pick
    song = StubSong(tracks=[t0, t1, t2], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-3", "audio", ""), source_addr=None)
    assert song.create_calls == []
    assert recorder.acks()[0][1] == "tracks/2"


def test_scan_skips_group_tracks(scheduler):
    """Group tracks (is_foldable=True) look like 'empty audio' to a
    naïve scan — they have no clips and no midi input. They must be
    skipped so a preset never lands inside a group fold."""
    t0 = StubTrack(has_midi_input=False)
    group = StubTrack(has_midi_input=False)
    group.is_foldable = True
    t2 = StubTrack(has_midi_input=False)  # real empty audio
    song = StubSong(tracks=[t0, group, t2], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-4", "audio", ""), source_addr=None)
    assert song.create_calls == []
    assert recorder.acks()[0][1] == "tracks/2"


def test_scan_skips_the_metronome_track_wherever_it_sits(scheduler):
    """The metronome track (an Instrument Rack whose macro 1 reads
    "Pattern N" — in practice the Skaka Metronome Rack) has no clips of
    its own, since it free-runs off the transport, so it looks exactly
    like an empty matching track to a naive scan. Track-0 protection
    (ADR-385) doesn't reach it here on purpose: this proves the scan
    skips it at index **2**, not 0 — the whole point is that it stays
    protected after being grouped or otherwise moved off the first
    slot."""
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])  # has a clip, not a candidate
    metronome = StubTrack(has_midi_input=True)
    metronome.devices = [metronome_device()]
    t3 = StubTrack(has_midi_input=True)  # real empty track, further down
    song = StubSong(tracks=[t0, t1, metronome, t3], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-metro", "midi", ""), source_addr=None)
    assert song.create_calls == []
    assert recorder.acks()[0][1] == "tracks/3"  # not tracks/2, the metronome


def test_selected_metronome_track_is_never_reused(scheduler):
    """Step 1 (prefer the selected track) must refuse the metronome
    track too, not just the scan in step 2 — a performer could easily
    have it selected when they go to load something else."""
    t0 = StubTrack(has_midi_input=True)
    metronome = StubTrack(has_midi_input=True)
    metronome.devices = [metronome_device()]
    song = StubSong(tracks=[t0, metronome], selected=metronome)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-metro-sel", "midi", ""), source_addr=None)
    # Nothing reusable (t0 is index 0, metronome is protected) -> creates.
    assert song.create_calls == [("midi", -1)]


def test_a_device_with_no_pattern_macro_is_not_mistaken_for_the_metronome(scheduler):
    """An ordinary Instrument Rack (or any device) whose macro 1 is
    unnamed, or named something else, must not trip the guard -- this
    is a structural test, not "every Instrument Rack is protected"."""
    t0 = StubTrack(has_midi_input=True)
    ordinary = StubTrack(has_midi_input=True)
    ordinary.devices = [StubDevice("Bass Rack", parameters=[StubParameter("Device On"), StubParameter("Filter")])]
    song = StubSong(tracks=[t0, ordinary], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-ordinary", "midi", ""), source_addr=None)
    assert song.create_calls == []
    assert recorder.acks()[0][1] == "tracks/1"


def test_selected_eligible_wins_over_lower_empty(scheduler):
    """When the selected track is itself eligible, prefer it even
    when a lower-index empty matching track exists. Respects intent.
    """
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True)  # empty + matching, lower
    t2 = StubTrack(has_midi_input=True)  # empty + matching, selected
    song = StubSong(tracks=[t0, t1, t2], selected=t2)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-5", "midi", ""), source_addr=None)
    assert song.create_calls == []
    assert recorder.acks()[0][1] == "tracks/2"


def test_creates_when_no_empty_tracks_anywhere(scheduler):
    """All tracks have clips → scan finds nothing → CREATE."""
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])
    t2 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])
    song = StubSong(tracks=[t0, t1, t2], selected=t1)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-scan-6", "midi", ""), source_addr=None)
    assert song.create_calls == [("midi", -1)]


# --- create path: audio deferral -----------------------------------------


def test_audio_create_defers_finalize_via_scheduler(scheduler):
    """create_audio_track returns immediately; routing/arm/load/ack
    must wait one tick for Live's audio-track template to settle."""
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)  # selected==index 0 → create
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(
        args=("req-7", "audio", "/path/to/preset.adv"), source_addr=None,
    )
    # Track was created, but no ack/load yet.
    assert song.create_calls == [("audio", -1)]
    assert recorder.emissions == []
    assert device_load.calls == []
    # One deferred callable pending.
    assert len(scheduler.pending) == 1

    scheduler.fire_all()

    # Now the ack lands and both loads ran (preset, then Permute).
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0] == ("req-7", "tracks/1", 1)
    assert [c[1] for c in device_load.calls] == ["/path/to/preset.adv", SEQUENCER_PATH]


def test_audio_create_arms_track(scheduler):
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)
    component, _ = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("r", "audio", ""), source_addr=None)
    scheduler.fire_all()
    new_track = song.tracks[-1]
    assert new_track.arm is True


def test_audio_create_skips_arm_when_auto_arm_disabled(scheduler):
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)
    component, _ = make_component(
        song, scheduler=scheduler, should_auto_arm=lambda: False,
    )
    component.handle_prepare(args=("r", "audio", ""), source_addr=None)
    scheduler.fire_all()
    assert song.tracks[-1].arm is False


def test_audio_create_sets_routing_channel(scheduler):
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)
    component, _ = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("r", "audio", ""), source_addr=None)
    scheduler.fire_all()
    new_track = song.tracks[-1]
    assert getattr(new_track.input_routing_channel, "display_name", None) == "11/12 Guitar Mic"


def test_audio_create_keeps_lives_input_when_no_channel_is_set(scheduler):
    """No ``audio.defaultInputChannel`` (the general edition): the new
    audio track keeps Live's own input, and is still armed."""
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)
    recorder = Recorder()
    component = TrackPrepareComponent(
        song=song,
        emit=recorder,
        device_load_component=StubDeviceLoad(),
        constants={k: v for k, v in CONSTANTS.items() if k != "audio"},
        schedule_delayed=scheduler,
    )
    component.handle_prepare(args=("r", "audio", ""), source_addr=None)
    scheduler.fire_all()
    new_track = song.tracks[-1]
    assert new_track.input_routing_channel is None
    assert new_track.arm is True


def test_midi_create_inline_no_defer(scheduler):
    """MIDI create has no audio-template settling concern → inline."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)  # index 0 → create
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("req-m", "midi", ""), source_addr=None)
    # No deferred work — ack landed inline.
    assert scheduler.pending == []
    assert len(recorder.acks()) == 1


# --- LRU idempotency -----------------------------------------------------


def test_duplicate_request_id_replays_cached_ack(scheduler):
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)  # index 0 → create
    component, recorder = make_component(song, scheduler=scheduler)
    # First call: real execution.
    component.handle_prepare(args=("dup-1", "midi", ""), source_addr=None)
    assert song.create_calls == [("midi", -1)]
    first_acks = list(recorder.acks())
    assert len(first_acks) == 1

    # Second call with same request_id: replays cached ack, doesn't
    # re-create.
    component.handle_prepare(args=("dup-1", "midi", ""), source_addr=None)
    assert song.create_calls == [("midi", -1)]  # unchanged
    second_acks = recorder.acks()
    assert len(second_acks) == 2
    assert second_acks[0] == second_acks[1]


def test_duplicate_request_id_replays_cached_nack(scheduler):
    """A failed request also caches its nack — retransmits don't retry."""
    song = StubSong(tracks=[StubTrack()])
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("nack-1", "drum", ""), source_addr=None)
    component.handle_prepare(args=("nack-1", "drum", ""), source_addr=None)
    nacks = recorder.nacks()
    assert len(nacks) == 2
    assert nacks[0] == nacks[1]


def test_distinct_request_ids_run_independently(scheduler):
    """Two different request_ids each get processed (not collapsed by LRU).

    First call creates a new track (only existing track is index 0).
    Second call reuses the freshly-created empty track via the scan path,
    so we only see one create — but two distinct acks.
    """
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    component, recorder = make_component(song, scheduler=scheduler)
    component.handle_prepare(args=("a", "midi", ""), source_addr=None)
    component.handle_prepare(args=("b", "midi", ""), source_addr=None)
    # First request: scan finds nothing past index 0 → CREATE.
    # Second request: scan finds the just-created empty track → REUSE.
    assert song.create_calls == [("midi", -1)]
    acks = recorder.acks()
    assert len(acks) == 2
    # First was a create, second was a reuse.
    assert acks[0][2] == 1
    assert acks[1][2] == 0


# --- load failure --------------------------------------------------------


def test_load_failure_nacks(scheduler):
    """When DeviceLoadComponent.load_into_track returns an error string,
    the request becomes a load-failed nack."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    device_load = StubDeviceLoad(error="path-not-found")
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(
        args=("req-9", "midi", "/nonexistent.adv"), source_addr=None,
    )
    nacks = recorder.nacks()
    assert len(nacks) == 1
    rid, code, detail = nacks[0]
    assert rid == "req-9"
    assert code == NACK_LOAD_FAILED
    assert detail == "path-not-found"


def test_audio_load_failure_after_create_nacks(scheduler):
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)
    device_load = StubDeviceLoad(error="not-in-browser")
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(
        args=("req-10", "audio", "/x.adv"), source_addr=None,
    )
    scheduler.fire_all()
    nacks = recorder.nacks()
    assert len(nacks) == 1
    assert nacks[0][1] == NACK_LOAD_FAILED


# --- empty preset path ---------------------------------------------------


def test_empty_preset_path_skips_preset_load_but_still_appends_sequencer(scheduler):
    """Empty preset_path means create-and-configure, no instrument —
    but Permute is still appended so the new track is fully prepared."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-11", "midi", ""), source_addr=None)
    assert device_load.preset_calls() == []
    assert len(device_load.sequencer_calls()) == 1
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0][2] == 1  # was_created


# --- Permute placement ---------------------------------------------------


def test_midi_create_appends_sequencer_after_preset_load(scheduler):
    """MIDI create + preset load: preset lands first, Permute appended
    after — so the chain ends up [Instrument, ..., Permute]."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)  # selected==0 → create
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(
        args=("req-perm-1", "midi", "/path/to/instrument.adv"), source_addr=None,
    )
    paths = [c[1] for c in device_load.calls]
    assert paths == ["/path/to/instrument.adv", SEQUENCER_PATH]
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0][1] == "tracks/1"


def test_reuse_appends_sequencer_when_missing(scheduler):
    """Reuse path (existing empty same-type track without Permute) —
    Permute is appended on first reuse so the track still ends ready."""
    t0 = StubTrack(has_midi_input=False)
    t1 = StubTrack(has_midi_input=True)  # empty, reusable, no Permute
    song = StubSong(tracks=[t0, t1], selected=t1)
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-perm-2", "midi", ""), source_addr=None)
    assert song.create_calls == []
    assert len(device_load.sequencer_calls()) == 1
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0][2] == 0  # reuse


def test_reuse_skips_sequencer_when_already_present(scheduler):
    """Idempotent: a track that already has Permute is not loaded a
    second time. Critical when the user reopens the browser on a
    previously-prepared track."""
    t0 = StubTrack(has_midi_input=False)
    t1 = StubTrack(has_midi_input=True)
    t1.devices = [StubDevice("Permute")]  # already prepared
    song = StubSong(tracks=[t0, t1], selected=t1)
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-perm-3", "midi", ""), source_addr=None)
    assert device_load.sequencer_calls() == []
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0][2] == 0  # reuse


def test_audio_create_appends_sequencer_in_deferred_finalize(scheduler):
    """Audio create defers the configure+load tick; Permute lands in the
    same deferred tick (after preset load, before ack)."""
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-perm-4", "audio", ""), source_addr=None)
    assert device_load.calls == []  # nothing yet — deferred
    scheduler.fire_all()
    # Empty preset path → only Permute is loaded.
    paths = [c[1] for c in device_load.calls]
    assert paths == [SEQUENCER_PATH]
    acks = recorder.acks()
    assert len(acks) == 1


def test_sequencer_load_failure_does_not_nack_prep(scheduler):
    """Permute load failure is logged but the prep still succeeds —
    the track is usable without Permute, the operator can drop it
    manually. A nack here would have lost the create."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    device_load = StubDeviceLoad(sequencer_error="not-in-browser")
    component, recorder = make_component(
        song, device_load=device_load, scheduler=scheduler,
    )
    component.handle_prepare(args=("req-perm-5", "midi", ""), source_addr=None)
    # Sequencer was attempted but failed; ack still emitted.
    assert len(device_load.sequencer_calls()) == 1
    nacks = recorder.nacks()
    assert nacks == []
    acks = recorder.acks()
    assert len(acks) == 1


def test_audio_inline_fallback_when_schedule_delayed_raises_still_appends_sequencer():
    """When schedule_delayed raises during an audio create, the inline
    fallback runs configure_audio + preset load + sequencer ensure +
    ack. The user might see a routing flash but Permute still lands —
    same end-state as the deferred path. Pins the fallback shape so a
    future refactor can't quietly skip Permute on this path."""
    class RaisingScheduler:
        def __call__(self, delay, fn):
            raise RuntimeError("scheduler unavailable")

    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0], selected=t0)  # selected==0 → create
    device_load = StubDeviceLoad()
    component, recorder = make_component(
        song, device_load=device_load, scheduler=RaisingScheduler(),
    )
    component.handle_prepare(
        args=("req-fallback", "audio", "/path/to/preset.adv"), source_addr=None,
    )
    # Inline path ran: preset, then Permute.
    assert [c[1] for c in device_load.calls] == ["/path/to/preset.adv", SEQUENCER_PATH]
    new_track = song.tracks[-1]
    assert new_track.arm is True  # _configure_audio also ran
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0] == ("req-fallback", "tracks/1", 1)


def test_missing_sequencer_path_in_constants_logs_warning_and_skips(scheduler, monkeypatch):
    """No devices.sequencer.devicePath and no Permute.amxd in the checkout
    (the derived path, 2026-09-26) must not break prep — the component logs
    a warning at init and skips the Permute append. Prep itself still acks
    normally."""
    from components import live_library
    monkeypatch.setattr(live_library, "m4l_devices_root", lambda: "/nonexistent/Vamp Devices")
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0], selected=t0)
    device_load = StubDeviceLoad()
    recorder = Recorder()
    from components.TrackPrepareComponent import TrackPrepareComponent
    component = TrackPrepareComponent(
        song=song,
        emit=recorder,
        device_load_component=device_load,
        constants={"audio": {"defaultInputChannel": "1/2"}},  # no devices key
        schedule_delayed=scheduler,
    )
    component.handle_prepare(args=("req-perm-6", "midi", ""), source_addr=None)
    assert device_load.calls == []  # neither preset nor Permute
    acks = recorder.acks()
    assert len(acks) == 1


# --- LRU capacity eviction -----------------------------------------------


def test_lru_evicts_oldest_when_capacity_exceeded(scheduler):
    """A 65th distinct request_id evicts the first; the original
    request_id no longer hits the cache and would re-execute on retransmit.
    Pins the eviction loop in ``_lru_put``."""
    from components.TrackPrepareComponent import _LRU_MAX_ENTRIES

    t0 = StubTrack(has_midi_input=True)
    # Empty selection so every request takes the create path — no reuse
    # short-circuit, and each call lands a fresh entry in the LRU.
    song = StubSong(tracks=[t0], selected=None)
    component, recorder = make_component(song, scheduler=scheduler)

    # Fill to capacity exactly.
    first_rid = "req-evict-0"
    for i in range(_LRU_MAX_ENTRIES):
        rid = "req-evict-0" if i == 0 else f"req-evict-{i}"
        component.handle_prepare(args=(rid, "midi", ""), source_addr=None)
    assert len(component._lru) == _LRU_MAX_ENTRIES
    assert first_rid in component._lru

    # One more distinct request should evict ``first_rid`` (oldest).
    component.handle_prepare(
        args=(f"req-evict-{_LRU_MAX_ENTRIES}", "midi", ""), source_addr=None,
    )
    assert len(component._lru) == _LRU_MAX_ENTRIES
    assert first_rid not in component._lru, (
        "Oldest request_id should have been evicted when LRU exceeded "
        "_LRU_MAX_ENTRIES; eviction loop in _lru_put is broken."
    )


# --- duplicate handler ----------------------------------------------------


def test_duplicate_happy_path_acks_new_index():
    """duplicate_track(N) → copy at N+1; ack carries tracks/<N+1>."""
    t0 = StubTrack(has_midi_input=True)
    t1 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])
    t1.devices = [StubDevice("Instrument"), StubDevice("Permute")]
    song = StubSong(tracks=[t0, t1])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-1", "tracks/1"), source_addr=None)

    acks = recorder.duplicate_acks()
    assert len(acks) == 1
    request_id, new_path = acks[0]
    assert request_id == "req-dup-1"
    assert new_path == "tracks/2"
    assert ("duplicate", 1) in song.create_calls
    # Copy carries the source device chain (incl. Permute) — no append.
    assert len(song.tracks) == 3
    assert [d.name for d in song.tracks[2].devices] == ["Instrument", "Permute"]


def test_duplicate_source_track_zero():
    """Track 0 is duplicable (no force-create policy like prepare)."""
    t0 = StubTrack(has_midi_input=False)
    song = StubSong(tracks=[t0])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-0", "tracks/0"), source_addr=None)

    acks = recorder.duplicate_acks()
    assert len(acks) == 1
    assert acks[0][1] == "tracks/1"


def test_duplicate_idempotent_replay():
    """A retransmit replays the cached ack without a second duplicate."""
    t0 = StubTrack(has_midi_input=True)
    song = StubSong(tracks=[t0])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-r", "tracks/0"), source_addr=None)
    component.handle_duplicate(args=("req-dup-r", "tracks/0"), source_addr=None)

    assert len(recorder.duplicate_acks()) == 2  # both emit (cached replay)
    # ...but duplicate_track ran only once.
    dup_calls = [c for c in song.create_calls if c[0] == "duplicate"]
    assert len(dup_calls) == 1
    assert len(song.tracks) == 2


def test_duplicate_clear_clips_empties_every_scene():
    """The variation gesture empties the WHOLE copy, not one scene.

    The source holds clips in scenes 0, 3 and 7; every one of them has to
    be gone from the copy. This is the regression the UI-side emptying
    could not hold: it deleted off a track snapshot that a duplicate had
    already shifted out from under it.
    """
    t0 = StubTrack(has_midi_input=True)
    source_slots = [StubSlot(has_clip=i in (0, 3, 7)) for i in range(8)]
    t1 = StubTrack(has_midi_input=True, slots=source_slots)
    song = StubSong(tracks=[t0, t1])
    component, recorder = make_component(song)

    component.handle_duplicate(
        args=("req-dup-clear", "tracks/1", 1), source_addr=None
    )

    assert len(recorder.duplicate_acks()) == 1
    copy = song.tracks[2]
    assert [s.has_clip for s in copy.clip_slots] == [False] * 8
    # Only the three occupied slots were touched.
    assert [s.delete_calls for s in copy.clip_slots] == [
        1, 0, 0, 1, 0, 0, 0, 1
    ]
    # The SOURCE keeps its clips — this is a copy-and-empty, not a move.
    assert [s.has_clip for s in song.tracks[1].clip_slots] == [
        True, False, False, True, False, False, False, True
    ]


def test_duplicate_without_flag_leaves_clips():
    """Two-arg form is unchanged: duplicate, don't empty."""
    t0 = StubTrack(has_midi_input=True, slots=[StubSlot(has_clip=True)])
    song = StubSong(tracks=[t0])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-keep", "tracks/0"), source_addr=None)

    assert len(recorder.duplicate_acks()) == 1
    assert song.tracks[1].clip_slots[0].has_clip is True


def test_duplicate_clear_clips_survives_a_failing_slot():
    """A slot that refuses to delete warns; the rest still clear and the
    ack still goes out — the duplicate has already succeeded."""
    t0 = StubTrack(
        has_midi_input=True,
        slots=[StubSlot(has_clip=True), StubSlot(has_clip=True)],
    )
    song = StubSong(tracks=[t0])
    component, recorder = make_component(song)
    # duplicate_track builds the copy's slots; swap the first for a
    # raising one after the fact by patching the stub's factory result.
    original_duplicate = song.duplicate_track

    def duplicate_with_bad_slot(index):
        original_duplicate(index)
        copy = song.tracks[index + 1]
        copy.clip_slots[0] = RaisingDeleteSlot(has_clip=True)

    song.duplicate_track = duplicate_with_bad_slot

    component.handle_duplicate(
        args=("req-dup-boom", "tracks/0", 1), source_addr=None
    )

    acks = recorder.duplicate_acks()
    assert len(acks) == 1
    assert acks[0][1] == "tracks/1"
    copy = song.tracks[1]
    assert copy.clip_slots[0].has_clip is True   # the one that raised
    assert copy.clip_slots[1].has_clip is False  # the rest cleared


def test_duplicate_bad_path_nacks_invalid_args():
    song = StubSong(tracks=[StubTrack(has_midi_input=True)])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-bad", "notapath"), source_addr=None)

    nacks = recorder.duplicate_nacks()
    assert len(nacks) == 1
    assert nacks[0][1] == NACK_INVALID_ARGS
    assert recorder.duplicate_acks() == []


def test_duplicate_out_of_range_nacks_no_track():
    song = StubSong(tracks=[StubTrack(has_midi_input=True)])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-oob", "tracks/9"), source_addr=None)

    nacks = recorder.duplicate_nacks()
    assert len(nacks) == 1
    assert nacks[0][1] == NACK_NO_TRACK


def test_duplicate_lom_raise_nacks_duplicate_failed():
    song = RaisingDuplicateSong(tracks=[StubTrack(has_midi_input=True)])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("req-dup-boom", "tracks/0"), source_addr=None)

    nacks = recorder.duplicate_nacks()
    assert len(nacks) == 1
    assert nacks[0][1] == NACK_DUPLICATE_FAILED


def test_duplicate_arg_count_mismatch_drops():
    """Wrong arg count → no correlation key → drop silently (no emit)."""
    song = StubSong(tracks=[StubTrack(has_midi_input=True)])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("only-one",), source_addr=None)

    assert recorder.duplicate_acks() == []
    assert recorder.duplicate_nacks() == []


def test_duplicate_empty_request_id_drops():
    song = StubSong(tracks=[StubTrack(has_midi_input=True)])
    component, recorder = make_component(song)

    component.handle_duplicate(args=("", "tracks/0"), source_addr=None)

    assert recorder.duplicate_acks() == []
    assert recorder.duplicate_nacks() == []


# --- .alc clip prepare (browser creates the track) ------------------------


def test_alc_prepare_browser_creates_track_and_acks(scheduler):
    """An .alc path routes to the browser-create path: no create_audio_track
    call from the component (Live's browser makes the track), and the ack
    points at the browser-created track."""
    song = StubSong(tracks=[StubTrack(has_midi_input=True)], selected=None)
    dl = StubDeviceLoad()
    dl._song = song  # let the stub append the browser-created track
    component, recorder = make_component(song, device_load=dl, scheduler=scheduler)

    component.handle_prepare(
        args=("req-alc", "audio", "/lib/Clips/loop.alc"), source_addr=None,
    )
    scheduler.fire_all()

    # Component did NOT call create_audio_track — the browser did.
    assert song.create_calls == []
    # It DID load the clip via the browser.
    assert getattr(dl, "clip_calls", []) == ["/lib/Clips/loop.alc"]
    acks = recorder.acks()
    assert len(acks) == 1
    rid, track_path, was_created = acks[0]
    assert rid == "req-alc"
    assert track_path == "tracks/1"  # the appended browser track
    assert was_created == 1
    assert recorder.nacks() == []


def test_alc_prepare_falls_back_to_raw_sample_track(scheduler, tmp_path, monkeypatch):
    """If the browser can't resolve the .alc, create an audio track and load
    the resolved raw sample instead (metadata lost, clip still lands)."""
    # Real .alc + sample so alc_resolver.resolve_alc succeeds.
    import gzip
    pack = tmp_path / "Pack"
    (pack / "Clips").mkdir(parents=True)
    sample = pack / "Samples" / "kick.wav"
    sample.parent.mkdir(parents=True)
    sample.write_bytes(b"RIFF")
    alc = pack / "Clips" / "clip.alc"
    xml = (
        '<Ableton><SampleRef><FileRef>'
        '<RelativePath><RelativePathElement Dir="Samples" /></RelativePath>'
        '<Name Value="kick.wav" /></FileRef></SampleRef></Ableton>'
    )
    with gzip.open(str(alc), "wb") as f:
        f.write(xml.encode("utf-8"))

    song = StubSong(tracks=[StubTrack(has_midi_input=True)], selected=None)
    dl = StubDeviceLoad()
    dl._song = song
    dl._clip_error = "not-in-browser"  # force fallback
    component, recorder = make_component(song, device_load=dl, scheduler=scheduler)

    component.handle_prepare(
        args=("req-fb", "audio", str(alc)), source_addr=None,
    )
    scheduler.fire_all()

    # Fallback created an audio track and loaded the raw sample into a slot.
    assert ("audio", -1) in song.create_calls
    acks = recorder.acks()
    assert len(acks) == 1
    assert acks[0][0] == "req-fb"
    assert recorder.nacks() == []
    # The raw sample landed in the new track's first slot.
    new_track = song.tracks[-1]
    assert any(
        getattr(s, "audio_clip_path", None) == str(sample)
        for s in new_track.clip_slots
    )
