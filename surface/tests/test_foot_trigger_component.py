"""FootTriggerComponent tests — Phase 9 PR-9b.

Covers the two arg-free handlers the pedal resolves to:

- ``handle_tap`` branches on highlighted_clip_slot state:
    * no slot               → no-op
    * empty slot            → slot.fire()
    * recording clip        → slot.fire() (end take, launch as a loop)
    * stopped clip          → slot.fire()
    * playing clip          → flip song.session_record
- ``handle_hold`` stops the selected track and highlights the first
  empty slot below the selected scene, appending a scene when there is
  none (2026-10-23).
- LOM raises are swallowed with a log line — never crash the surface.
- Post-disconnect handlers are no-ops for both addresses.

Why no timer mocking: the tap/hold decision runs upstream of this
component — in ``components/midi_pedal_input.py`` for the USB-direct
MIDI path (ADR-422; timing covered by ``test_midi_pedal_input.py``)
and in ``owner/Max Patches/foot-trigger.js`` for the legacy OSC path.
This component only sees the resolved gesture.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.FootTriggerComponent import (
    FootTriggerComponent,
    V3_FOOT_HOLD_ADDRESS,
    V3_FOOT_TAP_ADDRESS,
)


# --- stubs ----------------------------------------------------------------


class StubClip:
    def __init__(self, is_playing: bool = False, is_recording: bool = False):
        self.is_playing = is_playing
        self.is_recording = is_recording


class StubClipSlot:
    """Mirror Live's ``ClipSlot`` for the two attrs the component reads."""

    def __init__(self, has_clip: bool = False, clip=None):
        self.has_clip = has_clip
        self.clip = clip
        self.fire_calls = 0

    def fire(self):
        self.fire_calls += 1


class StubTrack:
    def __init__(self, filled=(), is_foldable: bool = False):
        """``filled``: one bool per scene, True where the slot holds a clip."""
        self.clip_slots = [StubClipSlot(has_clip=f) for f in filled]
        self.is_foldable = is_foldable
        self.stop_calls = 0

    def stop_all_clips(self):
        self.stop_calls += 1


class StubView:
    def __init__(self, highlighted_clip_slot=None, selected_track=None,
                 selected_scene=None):
        self.highlighted_clip_slot = highlighted_clip_slot
        self.selected_track = selected_track
        self.selected_scene = selected_scene


class StubSong:
    """Mirror the slice of ``Song`` the component touches.

    ``create_scene`` appends a scene and an empty slot on every track,
    as Live does. ``session_record`` is a plain bool the component flips.
    """

    def __init__(self, view=None, tracks=None, scene_count: int = 0,
                 session_record: bool = False):
        self.view = view if view is not None else StubView()
        self.tracks = list(tracks) if tracks is not None else []
        self.scenes = [object() for _ in range(scene_count)]
        self.session_record = session_record
        self.create_scene_calls: List[int] = []

    def create_scene(self, index: int):
        self.create_scene_calls.append(index)
        self.scenes.append(object())
        for track in self.tracks:
            track.clip_slots.append(StubClipSlot())


def _song_on(filled, scene_index: int, **track_kwargs):
    """A one-track song with that track and ``scene_index`` selected."""
    track = StubTrack(filled, **track_kwargs)
    song = StubSong(tracks=[track], scene_count=len(filled))
    song.view.selected_track = track
    song.view.selected_scene = song.scenes[scene_index]
    song.view.highlighted_clip_slot = track.clip_slots[scene_index]
    return song, track


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


def _make_component(emits, song):
    def emit(addr, args):
        emits.append((addr, args))

    return FootTriggerComponent(song=song, emit=emit)


# --- tap branches ---------------------------------------------------------


def test_tap_no_highlighted_slot_is_noop(emits):
    song = StubSong(view=StubView(highlighted_clip_slot=None))
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert emits == []
    assert song.session_record is False


def test_tap_empty_slot_fires(emits):
    slot = StubClipSlot(has_clip=False)
    song = StubSong(view=StubView(highlighted_clip_slot=slot))
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 1
    assert song.session_record is False  # not toggled


def test_tap_stopped_clip_fires(emits):
    clip = StubClip(is_playing=False)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(view=StubView(highlighted_clip_slot=slot))
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 1
    assert song.session_record is False


def test_tap_playing_clip_toggles_session_record_on(emits):
    clip = StubClip(is_playing=True)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=False,
    )
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 0  # didn't fire when toggling
    assert song.session_record is True


def test_tap_playing_clip_toggles_session_record_off(emits):
    clip = StubClip(is_playing=True)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=True,
    )
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert song.session_record is False


def test_tap_recording_clip_fires_to_end_the_take(emits):
    """A recording clip also reports ``is_playing``, so this case only
    reaches ``fire()`` if ``is_recording`` is branched on FIRST. Firing
    is what ends the take and launches it as a loop — the second press
    of the looper cycle."""
    clip = StubClip(is_playing=True, is_recording=True)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=False,
    )
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 1
    assert song.session_record is False  # overdub is the NEXT press


def test_tap_unreadable_is_recording_falls_back_to_overdub(emits):
    """Losing the flag must not kill the gesture — a raising
    ``is_recording`` degrades to the playing branch rather than
    aborting the tap."""

    class NoRecordingFlagClip:
        is_playing = True

        @property
        def is_recording(self):
            raise RuntimeError("torn-down handle")

    slot = StubClipSlot(has_clip=True, clip=NoRecordingFlagClip())
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=False,
    )
    comp = _make_component(emits, song)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 0
    assert song.session_record is True


class _RaisesOnRead:
    """Descriptor-ish stand-in that raises when read."""

    def __init__(self, exc):
        self._exc = exc

    def __get__(self, instance, owner):
        raise self._exc


class _SongWithRaisingView:
    """Song whose ``view.highlighted_clip_slot`` raises a LOM error."""

    class _View:
        @property
        def highlighted_clip_slot(self):
            raise RuntimeError("LOM torn down")

    view = _View()
    session_record = False
    tracks: list = []


def test_tap_swallows_lom_error_on_view_read(emits):
    comp = _make_component(emits, _SongWithRaisingView())
    # Should not raise; logs WARNING and returns.
    comp.handle_tap((), source_addr=None)
    assert emits == []



# --- hold: next take ------------------------------------------------------


def test_hold_stops_the_track_and_highlights_the_next_empty_slot(emits):
    song, track = _song_on([True, True, False, False], scene_index=0)
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert track.stop_calls == 1
    assert song.view.highlighted_clip_slot is track.clip_slots[2]
    assert song.create_scene_calls == []
    assert emits == []


def test_hold_looks_below_the_highlight_not_above(emits):
    """An empty slot above the selected scene is not "down"."""
    song, track = _song_on([False, True, True, False], scene_index=1)
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert song.view.highlighted_clip_slot is track.clip_slots[3]


def test_hold_on_an_empty_slot_still_moves_down(emits):
    song, track = _song_on([True, False, False], scene_index=1)
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert song.view.highlighted_clip_slot is track.clip_slots[2]


def test_hold_appends_a_scene_when_nothing_below_is_empty(emits):
    song, track = _song_on([False, True, True], scene_index=1)
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert song.create_scene_calls == [-1]
    assert len(track.clip_slots) == 4
    assert song.view.highlighted_clip_slot is track.clip_slots[3]
    assert track.stop_calls == 1


def test_hold_on_the_last_scene_appends_a_scene(emits):
    song, track = _song_on([True], scene_index=0)
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert song.create_scene_calls == [-1]
    assert song.view.highlighted_clip_slot is track.clip_slots[1]


def test_hold_ignores_a_group_track(emits):
    song, track = _song_on([False, False], scene_index=0, is_foldable=True)
    before = song.view.highlighted_clip_slot
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert track.stop_calls == 0
    assert song.view.highlighted_clip_slot is before


def test_hold_ignores_a_selection_that_is_not_a_regular_track(emits):
    """Master or a return selected: nothing to stop, no slot to move to."""
    song, track = _song_on([True, False], scene_index=0)
    master = StubTrack([False, False])
    song.view.selected_track = master
    before = song.view.highlighted_clip_slot
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert master.stop_calls == 0
    assert track.stop_calls == 0
    assert song.view.highlighted_clip_slot is before
    assert song.create_scene_calls == []


def test_hold_moves_on_when_the_stop_raises(emits):
    """Stopping is best-effort; the take still gets its empty slot."""
    song, track = _song_on([True, False], scene_index=0)

    def raising_stop():
        raise RuntimeError("torn-down handle")

    track.stop_all_clips = raising_stop
    comp = _make_component(emits, song)

    comp.handle_hold((), source_addr=None)

    assert song.view.highlighted_clip_slot is track.clip_slots[1]


def test_hold_swallows_a_raising_selection_read(emits):
    comp = _make_component(emits, _SongWithRaisingView())
    comp.handle_hold((), source_addr=None)  # logs and returns
    assert emits == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_makes_handlers_noop(emits):
    song, track = _song_on([False, False], scene_index=0)
    slot = song.view.highlighted_clip_slot
    comp = _make_component(emits, song)

    comp.disconnect()
    comp.handle_tap((), source_addr=None)
    comp.handle_hold((), source_addr=None)

    assert slot.fire_calls == 0
    assert track.stop_calls == 0
    assert song.view.highlighted_clip_slot is slot


def test_disconnect_is_idempotent(emits):
    comp = _make_component(emits, StubSong())

    comp.disconnect()
    comp.disconnect()  # no exception


# --- address constants exposed on the class -------------------------------


def test_address_constants_match_module_constants():
    assert FootTriggerComponent.V3_FOOT_TAP_ADDRESS == V3_FOOT_TAP_ADDRESS
    assert FootTriggerComponent.V3_FOOT_HOLD_ADDRESS == V3_FOOT_HOLD_ADDRESS
    assert V3_FOOT_TAP_ADDRESS == "/looping/v3/foot/tap"
    assert V3_FOOT_HOLD_ADDRESS == "/looping/v3/foot/hold"
