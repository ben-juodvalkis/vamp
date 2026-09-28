"""ClipsComponent.handle_swap_file — a clip's file swapped for a similar one (ADR-440).

Live has no verb that changes an audio clip's file, so the swap is Live's
delete and ``create_audio_clip`` inside one undo step. These pin what makes
that safe to press mid-set:

- nothing is touched until every check passes, and every outcome answers on
  the reply address by request id;
- the old clip's settings, a name of its own, its playing and its focus land
  on the new clip, inside the one undo step;
- a file Live will not load puts the old file back;
- every LOM read and write is guarded — Live 12 properties raise rather than
  return a default (project_live_lom_quirks).
"""

from __future__ import annotations

from typing import List

import pytest

from tests.support.lom_fakes import RaisesOnRead, raising_getter

from components.ClipsComponent import (
    ClipsComponent,
    V3_CLIP_SWAP_FILE_REPLY_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_CLIP_FILE_UNKNOWN,
    V3_ERROR_CLIP_NOT_AUDIO,
    V3_ERROR_CLIP_NOT_PRESENT,
    V3_ERROR_CLIP_RECORDING,
    V3_ERROR_LOAD_FAILED,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_WRITE_REJECTED,
)

# Live's defaults for a created clip, as the rig's Shaker clip read them where
# measured (warping on, gain 0.4, Trigger, Global quantization).
DEFAULTS = {
    "warping": True,
    "warp_mode": 0,
    "gain": 0.4,
    "pitch_coarse": 0,
    "pitch_fine": 0,
    "looping": True,
    "launch_mode": 0,
    "launch_quantization": 0,
    "legato": False,
    "velocity_amount": 0.0,
    "ram_mode": False,
    "muted": False,
    "color": 0x3C3C3C,
}

CLIP = "tracks/0/slots/1/clip"
CAXIXI_02 = "African Seed Caxixi 02.aiff"
CAXIXI_06 = "African Seed Caxixi 06.aiff"
BROKEN = "Broken.wav"


def stem(path: str) -> str:
    return path.rsplit("/", 1)[-1].rsplit(".", 1)[0]


class Clip:
    """An audio clip as Live creates one: named after its file, at Live's
    defaults. ``refuse`` names the settings a write raises on."""

    def __init__(self, file_path: str, **settings):
        self.__dict__["refuse"] = set()
        self.is_audio_clip = True
        self.is_midi_clip = False
        self.is_recording = False
        self.is_playing = False
        self.is_triggered = False
        self.file_path = file_path
        self.name = stem(file_path)
        for name, value in {**DEFAULTS, **settings}.items():
            setattr(self, name, value)

    def __setattr__(self, name, value):
        if name in self.__dict__["refuse"]:
            raise RuntimeError("Live refuses %s" % name)
        object.__setattr__(self, name, value)


class Slot(RaisesOnRead):
    """``RaisesOnRead`` so a test can break a *getter* on a slot that is
    already in ``Track.clip_slots`` — the tuple is Live's shape, so the slot
    cannot be swapped for a proxy after the fact."""

    def __init__(self, log: List[tuple]):
        self.log = log
        self.clip = None
        self.has_clip = False
        self.fired = 0
        self.unloadable: set = set()
        self.refuse_on_create: set = set()

    def add_has_clip_listener(self, cb):
        pass

    def remove_has_clip_listener(self, cb):
        pass

    def delete_clip(self):
        self.log.append(("delete", self.clip.file_path))
        self.clip = None
        self.has_clip = False

    def create_audio_clip(self, path):
        if path in self.unloadable:
            self.log.append(("create-raised", path))
            raise RuntimeError("cannot read %s" % path)
        self.log.append(("create", path))
        self.clip = Clip(path)
        self.clip.__dict__["refuse"] = set(self.refuse_on_create)
        self.has_clip = True

    def fire(self):
        self.fired += 1
        self.log.append(("fire",))


class Track:
    def __init__(self, log: List[tuple], n: int = 4):
        self.clip_slots = tuple(Slot(log) for _ in range(n))


class View:
    def __init__(self, log: List[tuple]):
        self._log = log
        self._detail_clip = None

    @property
    def detail_clip(self):
        return self._detail_clip

    @detail_clip.setter
    def detail_clip(self, clip):
        self._log.append(("focus", clip.file_path if clip is not None else None))
        self._detail_clip = clip


class Song:
    def __init__(self):
        self.log: List[tuple] = []
        self.tracks = tuple(Track(self.log) for _ in range(2))
        self.master_track = object()
        self.return_tracks = ()
        self.view = View(self.log)
        # The transport runs unless a test stops it.
        self.is_playing = True

    def begin_undo_step(self):
        self.log.append(("begin",))

    def end_undo_step(self):
        self.log.append(("end",))


@pytest.fixture
def files(tmp_path):
    made = {}
    for name in (CAXIXI_02, CAXIXI_06, BROKEN):
        (tmp_path / name).write_bytes(b"")
        made[name] = str(tmp_path / name)
    return made


@pytest.fixture
def song() -> Song:
    return Song()


@pytest.fixture
def emits() -> List[tuple]:
    return []


@pytest.fixture
def component(song, emits):
    return ClipsComponent(
        song=song,
        emit=lambda address, payload: emits.append((address, payload)),
        advance_generation=lambda reason: None,
    )


def put(song: Song, file_path: str, slot: int = 1, **settings) -> Clip:
    target = song.tracks[0].clip_slots[slot]
    target.clip = Clip(file_path, **settings)
    target.has_clip = True
    return target.clip


def replies(emits) -> List[tuple]:
    return [payload for address, payload in emits if address == V3_CLIP_SWAP_FILE_REPLY_ADDRESS]


# --- the swap -------------------------------------------------------------


def test_swaps_the_file_inside_one_undo_step_and_answers(component, song, emits, files):
    put(song, files[CAXIXI_02])
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert song.log == [
        ("begin",),
        ("delete", files[CAXIXI_02]),
        ("create", files[CAXIXI_06]),
        ("end",),
    ]
    assert replies(emits) == [("r1", 1, "", "")]
    assert song.tracks[0].clip_slots[1].clip.file_path == files[CAXIXI_06]


def test_keeps_every_setting_on_the_new_clip(component, song, emits, files):
    kept = {
        "warping": True,
        "warp_mode": 4,
        "gain": 0.62,
        "pitch_coarse": -3,
        "pitch_fine": 12,
        "looping": False,
        "launch_mode": 2,
        "launch_quantization": 5,
        "legato": True,
        "velocity_amount": 0.5,
        "ram_mode": True,
        "muted": True,
        "color": 0xFF3636,
    }
    put(song, files[CAXIXI_02], **kept)

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    new = song.tracks[0].clip_slots[1].clip
    assert {name: getattr(new, name) for name in kept} == kept
    assert replies(emits) == [("r1", 1, "", "")]


def test_a_name_of_the_users_own_stays_and_a_file_name_follows_the_file(component, song, files):
    put(song, files[CAXIXI_02]).name = "8ths"
    put(song, files[CAXIXI_02], slot=2)

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])
    component.handle_swap_file(["r2", "tracks/0/slots/2/clip", files[CAXIXI_06]])

    assert song.tracks[0].clip_slots[1].clip.name == "8ths"
    assert song.tracks[0].clip_slots[2].clip.name == "African Seed Caxixi 06"


@pytest.mark.parametrize(
    "transport, playing, queued, fires",
    [
        (True, True, False, 1),
        (True, False, True, 1),
        (True, False, False, 0),
        # Live reports a launched clip as playing after the transport stops (the
        # rig's "8ths" clip, 2026-09-15); firing its slot then would start the set.
        (False, True, False, 0),
        (False, False, True, 0),
    ],
)
def test_relaunches_a_playing_or_queued_clip_only_while_the_transport_runs(
    component, song, files, transport, playing, queued, fires,
):
    song.is_playing = transport
    clip = put(song, files[CAXIXI_02])
    clip.is_playing = playing
    clip.is_triggered = queued

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert song.tracks[0].clip_slots[1].fired == fires


def test_refocuses_the_clip_live_showed_after_the_relaunch_and_leaves_other_focus_alone(
    component, song, files,
):
    clip = put(song, files[CAXIXI_02])
    clip.is_playing = True
    song.view.detail_clip = clip
    put(song, files[CAXIXI_02], slot=2)
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])
    assert song.log == [
        ("begin",),
        ("delete", files[CAXIXI_02]),
        ("create", files[CAXIXI_06]),
        ("fire",),
        ("focus", files[CAXIXI_06]),
        ("end",),
    ]

    song.log.clear()
    component.handle_swap_file(["r2", "tracks/0/slots/2/clip", files[CAXIXI_06]])
    assert not [entry for entry in song.log if entry[0] == "focus"]


def test_names_a_setting_live_refuses_and_still_swaps(component, song, emits, files):
    put(song, files[CAXIXI_02], gain=0.62)
    song.tracks[0].clip_slots[1].refuse_on_create = {"gain"}

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert replies(emits) == [("r1", 1, "", "not kept: gain")]
    assert song.tracks[0].clip_slots[1].clip.file_path == files[CAXIXI_06]


def test_a_file_live_will_not_load_puts_the_old_file_back(component, song, emits, files):
    put(song, files[CAXIXI_02], warp_mode=4, pitch_coarse=-3).name = "8ths"
    slot = song.tracks[0].clip_slots[1]
    slot.unloadable = {files[BROKEN]}
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[BROKEN]])

    assert song.log == [
        ("begin",),
        ("delete", files[CAXIXI_02]),
        ("create-raised", files[BROKEN]),
        ("create", files[CAXIXI_02]),
        ("end",),
    ]
    back = slot.clip
    assert (back.file_path, back.name, back.warp_mode, back.pitch_coarse) == (files[CAXIXI_02], "8ths", 4, -3)
    [(request, ok, code, detail)] = replies(emits)
    assert (request, ok, code) == ("r1", 0, V3_ERROR_LOAD_FAILED)
    assert detail.endswith("the old file is back")


def test_says_the_slot_is_empty_when_the_old_file_will_not_load_either(component, song, emits, files):
    put(song, files[BROKEN])
    slot = song.tracks[0].clip_slots[1]
    slot.unloadable = {files[BROKEN], files[CAXIXI_06]}

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    [(request, ok, code, detail)] = replies(emits)
    assert (request, ok, code) == ("r1", 0, V3_ERROR_LOAD_FAILED)
    assert detail.endswith("the slot is empty")
    assert song.log[-1] == ("end",)


# --- refusals -------------------------------------------------------------


def test_refusals_change_nothing_and_still_answer(component, song, emits, files, tmp_path):
    component.handle_swap_file(["empty", CLIP, files[CAXIXI_06]])
    put(song, files[CAXIXI_02])
    component.handle_swap_file(["gone", CLIP, str(tmp_path / "gone.wav")])
    midi = put(song, files[CAXIXI_02], slot=2)
    midi.is_audio_clip = False
    midi.is_midi_clip = True
    component.handle_swap_file(["midi", "tracks/0/slots/2/clip", files[CAXIXI_06]])
    recording = put(song, files[CAXIXI_02], slot=3)
    recording.is_recording = True
    component.handle_swap_file(["recording", "tracks/0/slots/3/clip", files[CAXIXI_06]])
    component.handle_swap_file(["slot-path", "tracks/0/slots/1", files[CAXIXI_06]])
    component.handle_swap_file(["short", CLIP])

    assert [reply[:3] for reply in replies(emits)] == [
        ("empty", 0, V3_ERROR_CLIP_NOT_PRESENT),
        ("gone", 0, V3_ERROR_PATH_NOT_FOUND),
        ("midi", 0, V3_ERROR_CLIP_NOT_AUDIO),
        ("recording", 0, V3_ERROR_CLIP_RECORDING),
        ("slot-path", 0, V3_ERROR_WRITE_REJECTED),
        ("short", 0, V3_ERROR_WRITE_REJECTED),
    ]
    assert song.log == []


def test_refuses_before_the_delete_when_the_old_clip_names_no_file(component, song, emits, files):
    """``_put_back`` needs the old file's path and returns False without it, so
    a ``load-failed`` on a clip Live names no file for leaves the slot empty
    and the take gone — recoverable only by Cmd-Z. There is no way back from
    that, so the honest answer is a refusal, and it has to come before
    ``delete_clip``."""
    put(song, "")
    song.log.clear()

    component.handle_swap_file(["blank", CLIP, files[CAXIXI_06]])

    assert replies(emits)[-1][:3] == ("blank", 0, V3_ERROR_CLIP_FILE_UNKNOWN)
    assert song.log == []
    assert song.tracks[0].clip_slots[1].clip is not None


def test_refuses_the_same_way_when_the_file_path_read_raises(component, song, emits, files):
    """``_read_file_path_safe`` answers ``""`` for a raising read as well as for
    an empty one — Live 12 properties raise rather than return a default — so
    the two reach ``_put_back`` identically and are refused identically.

    The raising getter is ``lom_fakes.raising_getter`` rather than a subclass
    defined here: this file built the first one inline, and every other
    ``_LOM_ERRORS``-on-read guard in the surface needs the same trick.
    """
    slot = song.tracks[0].clip_slots[1]
    put(song, files[CAXIXI_02])
    slot.clip = raising_getter(slot.clip, "file_path")
    song.log.clear()

    component.handle_swap_file(["raises", CLIP, files[CAXIXI_06]])

    assert replies(emits)[-1][:3] == ("raises", 0, V3_ERROR_CLIP_FILE_UNKNOWN)
    assert song.log == []


def test_a_setting_whose_read_raises_is_named_not_kept(component, song, emits, files):
    """Swap audit M14.

    ``_read_swap_state`` skips a setting whose *read* raises. It was skipped
    silently: absent from ``settings``, so never written to the new clip and
    never in ``refused`` — the swap answered ok with an empty detail while the
    new clip sat at Live's default for it. A clip whose ``gain`` read raises
    swapped to Live's default gain and the reply said everything was kept.
    """
    put(song, files[CAXIXI_02])
    slot = song.tracks[0].clip_slots[1]
    slot.clip.gain = 0.9
    slot.clip = raising_getter(slot.clip, "gain")
    song.log.clear()

    component.handle_swap_file(["m14", CLIP, files[CAXIXI_06]])

    request, ok, code, detail = replies(emits)[-1][:4]
    assert (request, ok, code) == ("m14", 1, "")
    assert "not kept" in detail and "gain" in detail
    # The swap itself still happened, and everything readable still carried.
    assert slot.clip.file_path == files[CAXIXI_06]
    assert slot.clip.gain == DEFAULTS["gain"]


def test_a_slot_read_that_raises_after_create_is_not_reported_as_empty(component, song, emits, files):
    """Swap audit M13.

    ``_keep_on_new_clip`` returned ``None`` both for a slot that is genuinely
    empty after ``create_audio_clip`` — Live declined the file — and for one
    whose ``has_clip``/``clip`` *read* raised, which is a successful swap the
    surface merely cannot look at. The second was answered as ``load-failed``,
    "the slot holds no clip", with no restore: the new file in the slot with
    no settings, no name, no relaunch and no focus, under a code that says the
    load failed. The two endings now read differently.
    """
    put(song, files[CAXIXI_02])
    slot = song.tracks[0].clip_slots[1]
    real_create = slot.create_audio_clip

    def create_then_break(path):
        real_create(path)
        # Live has made the clip; reading the slot back is what fails.
        slot.raise_on_read = {"has_clip": RuntimeError}

    slot.create_audio_clip = create_then_break
    song.log.clear()

    component.handle_swap_file(["m13", CLIP, files[CAXIXI_06]])

    request, ok, code, detail = replies(emits)[-1][:4]
    assert (request, ok, code) == ("m13", 0, V3_ERROR_LOAD_FAILED)
    assert "reading the slot raised" in detail
    assert "holds no clip" not in detail


def test_a_request_with_no_id_goes_to_the_error_channel(component, song, emits, files):
    put(song, files[CAXIXI_02])

    component.handle_swap_file(["", CLIP, files[CAXIXI_06]])
    component.handle_swap_file([])

    errors = [payload for address, payload in emits if address == V3_ERROR_ADDRESS]
    assert [payload[1] for payload in errors] == [V3_ERROR_WRITE_REJECTED, V3_ERROR_WRITE_REJECTED]
    assert replies(emits) == []
    assert song.log == []


def test_closes_the_undo_step_when_live_refuses_the_delete(component, song, emits, files):
    put(song, files[CAXIXI_02])
    slot = song.tracks[0].clip_slots[1]

    def refuse():
        raise RuntimeError("no delete")

    slot.delete_clip = refuse
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert song.log == [("begin",), ("end",)]
    assert replies(emits)[0][:3] == ("r1", 0, V3_ERROR_WRITE_REJECTED)


def test_a_create_that_raises_outside_the_lom_tuple_still_restores(component, song, emits, files):
    """Swap audit M11.

    ``delete_clip`` has already returned when ``create_audio_clip`` runs, so
    the slot is empty and the take exists nowhere else. A raise outside
    ``(RuntimeError, AttributeError, TypeError)`` used to leave ``_put_file``
    entirely, miss ``_put_back``, and be answered by the outer net as
    ``write-rejected`` — the code ``wire-protocol.md`` defines as "a refusal
    changes nothing". This asserts the opposite: the old file goes back and the
    ending is ``load-failed``.
    """
    put(song, files[CAXIXI_02])
    slot = song.tracks[0].clip_slots[1]
    real_create = slot.create_audio_clip
    calls = []

    def explode_once(path):
        calls.append(path)
        if len(calls) == 1:
            raise ValueError("not a LOM error")
        return real_create(path)

    slot.create_audio_clip = explode_once
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert song.log[0] == ("begin",) and song.log[-1] == ("end",)
    reply = replies(emits)[0]
    assert reply[:3] == ("r1", 0, V3_ERROR_LOAD_FAILED)
    assert "the old file is back" in reply[3]
    # The restore used the old path, not the one that would not load.
    assert calls == [files[CAXIXI_06], files[CAXIXI_02]]
    assert slot.clip is not None and slot.clip.file_path == files[CAXIXI_02]


def test_a_create_that_raises_and_cannot_be_put_back_says_the_slot_is_empty(component, song, emits, files):
    """The other half of M11: the restore failed too, and the reply says so
    rather than claiming nothing changed."""
    put(song, files[CAXIXI_02])
    slot = song.tracks[0].clip_slots[1]

    def explode(path):
        raise ValueError("not a LOM error")

    slot.create_audio_clip = explode
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert song.log[0] == ("begin",) and song.log[-1] == ("end",)
    reply = replies(emits)[0]
    assert reply[:3] == ("r1", 0, V3_ERROR_LOAD_FAILED)
    assert "the slot is empty" in reply[3]


def test_swaps_without_an_undo_step_when_live_will_not_open_one(component, song, emits, files):
    put(song, files[CAXIXI_02])

    def refuse():
        raise RuntimeError("no begin")

    song.begin_undo_step = refuse
    song.log.clear()

    component.handle_swap_file(["r1", CLIP, files[CAXIXI_06]])

    assert ("end",) not in song.log
    assert replies(emits) == [("r1", 1, "", "")]


def test_bytes_args_are_decoded_and_disconnect_silences(component, song, emits, files):
    put(song, files[CAXIXI_02])

    component.handle_swap_file([b"r1", CLIP.encode("utf-8"), files[CAXIXI_06].encode("utf-8")])
    assert replies(emits) == [("r1", 1, "", "")]

    component.disconnect()
    component.handle_swap_file(["r2", CLIP, files[CAXIXI_02]])
    assert len(replies(emits)) == 1
