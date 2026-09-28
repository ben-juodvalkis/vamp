"""PlayheadComponent unit tests — ADR-360.

Covers the per-track playing-clip + playhead channel:

- Per-track ``playing_slot_index`` listener attach on init (1 listener
  per regular track).
- Init-emit seeds the UI for tracks already playing on cold start, and
  emits a stopped frame for tracks with no playing clip.
- Slot-change re-resolves the playing clip and detaches the prior
  ``playing_position`` (+ ``notes`` for MIDI) listeners before
  attaching to the new clip.
- ``playing_slot`` carries ``is_audio_clip``, ``file_path``, length,
  loop bounds, ``looping``, and ``status``. On stop (``slot_idx == -1``)
  trailing fields are zero/empty and ``status == 0``.
- ``playhead`` fires throttled 30 Hz drop-intermediate per track,
  monotonic-clock-immune (mirrors test_meters_component.py). Carries
  ``(track_path, slot_idx, position_beats, status)`` straight from the
  LOM — no anchor/rate extrapolation. When transport stops,
  ``playing_position`` listeners stop firing → no emits → playhead
  freezes naturally.
- Status transitions stopped → playing → recording emit the right
  ordinal; recording precedence over playing.
- Notes-changed wiring (Milestone 3): listener attached only when
  playing clip ``is_midi_clip``; slot change to non-MIDI / empty
  detaches.
- Structural-change rebind detaches all + reattaches against fresh
  walk; throttle ``_last_emit`` is pruned.
- LOM property quirks: ``RuntimeError`` on ``slot.is_playing`` etc.
  swallowed once per ``(key, context)``.
- ``disconnect`` detaches everything, idempotent.
"""

from __future__ import annotations

import logging
from typing import Callable, List, Tuple

import pytest

from components.PlayheadComponent import (
    PlayheadComponent,
    V3_CLIP_NOTES_CHANGED_ADDRESS,
    V3_TRACK_PLAYHEAD_ADDRESS,
    V3_TRACK_PLAYING_SLOT_ADDRESS,
)
import components.PlayheadComponent as playhead_module


# --- stub LOM ------------------------------------------------------------


class StubClip:
    """Clip with the attribute surface PlayheadComponent reads.

    ``add_playing_position_listener`` / ``add_notes_listener`` slots
    accept exactly one listener (assertion guards against double-attach
    bugs, mirroring the meter stub).
    """

    def __init__(
        self,
        *,
        is_audio_clip: bool = False,
        is_midi_clip: bool = True,
        is_recording: bool = False,
        file_path: str = "",
        length: float = 4.0,
        loop_start: float = 0.0,
        loop_end: float = 4.0,
        looping: bool = False,
        playing_position: float = 0.0,
    ):
        self.is_audio_clip = is_audio_clip
        self.is_midi_clip = is_midi_clip
        self._is_recording = is_recording
        self.file_path = file_path
        self.length = length
        self.loop_start = loop_start
        self.loop_end = loop_end
        self.looping = looping
        self._playing_position = playing_position
        self._position_listener: Callable[[], None] | None = None
        self._notes_listener: Callable[[], None] | None = None
        self._recording_listener: Callable[[], None] | None = None

    @property
    def is_recording(self) -> bool:
        return self._is_recording

    @is_recording.setter
    def is_recording(self, value: bool) -> None:
        self._is_recording = value
        cb = self._recording_listener
        if cb is not None:
            cb()

    @property
    def playing_position(self) -> float:
        return self._playing_position

    @playing_position.setter
    def playing_position(self, value: float) -> None:
        self._playing_position = value
        cb = self._position_listener
        if cb is not None:
            cb()

    def add_playing_position_listener(self, cb):
        assert self._position_listener is None, (
            "StubClip supports one playing_position listener"
        )
        self._position_listener = cb

    def remove_playing_position_listener(self, cb):
        if self._position_listener == cb:
            self._position_listener = None

    def add_notes_listener(self, cb):
        assert self._notes_listener is None, (
            "StubClip supports one notes listener"
        )
        self._notes_listener = cb

    def remove_notes_listener(self, cb):
        if self._notes_listener == cb:
            self._notes_listener = None

    def fire_notes(self) -> None:
        cb = self._notes_listener
        if cb is not None:
            cb()

    def add_is_recording_listener(self, cb):
        assert self._recording_listener is None, (
            "StubClip supports one is_recording listener"
        )
        self._recording_listener = cb

    def remove_is_recording_listener(self, cb):
        if self._recording_listener == cb:
            self._recording_listener = None


class StubClipSlot:
    def __init__(self, clip: StubClip | None = None):
        self.clip = clip

    @property
    def has_clip(self) -> bool:
        return self.clip is not None


class StubTrack:
    """Track with one ``playing_slot_index`` listener slot.

    Setting ``playing_slot_index`` fires the listener synchronously,
    mirroring Live's notification semantics.
    """

    def __init__(self, slots: List[StubClipSlot], slot_idx: int = -1):
        self._slots = list(slots)
        self._slot_idx = slot_idx
        self._listener: Callable[[], None] | None = None
        self._raises_on_attach = False

    @property
    def clip_slots(self):
        return tuple(self._slots)

    @property
    def playing_slot_index(self) -> int:
        return self._slot_idx

    @playing_slot_index.setter
    def playing_slot_index(self, value: int) -> None:
        self._slot_idx = value
        cb = self._listener
        if cb is not None:
            cb()

    def add_playing_slot_index_listener(self, cb):
        if self._raises_on_attach:
            raise RuntimeError("LOM attach rejected for slot listener")
        assert self._listener is None, (
            "StubTrack supports one playing_slot_index listener"
        )
        self._listener = cb

    def remove_playing_slot_index_listener(self, cb):
        if self._listener == cb:
            self._listener = None

    def fire(self) -> None:
        cb = self._listener
        if cb is not None:
            cb()


class StubSongView:
    """Stand-in for ``Live.Song.Song.View`` — only what PlayheadComponent reads."""

    def __init__(self) -> None:
        self.highlighted_clip_slot = None
        self._highlight_listeners: List[Callable[[], None]] = []

    def add_highlighted_clip_slot_listener(self, cb) -> None:
        self._highlight_listeners.append(cb)

    def remove_highlighted_clip_slot_listener(self, cb) -> None:
        if cb in self._highlight_listeners:
            self._highlight_listeners.remove(cb)

    def fire_highlight(self) -> None:
        for cb in list(self._highlight_listeners):
            cb()


class StubSong:
    def __init__(self, tracks: List[StubTrack], tempo: float = 120.0):
        self._tracks = list(tracks)
        self.tempo = tempo
        self.view = StubSongView()

    @property
    def tracks(self):
        return list(self._tracks)

    def set_tracks(self, tracks: List[StubTrack]) -> None:
        self._tracks = list(tracks)


# --- fixtures ------------------------------------------------------------


class EmitRecorder:
    """Captures ``(address, args)`` tuples emitted by the component."""

    def __init__(self) -> None:
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address: str, args) -> None:
        self.emissions.append((address, tuple(args)))

    def only(self, address: str) -> List[tuple]:
        return [p for a, p in self.emissions if a == address]

    def clear(self) -> None:
        self.emissions.clear()


@pytest.fixture
def recorder() -> EmitRecorder:
    return EmitRecorder()


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock(start=1000.0)
    monkeypatch.setattr(playhead_module.time, "monotonic", fake)
    return fake


def _empty_song(track_count: int = 3) -> StubSong:
    tracks = []
    for _ in range(track_count):
        slots = [StubClipSlot(None) for _ in range(4)]
        tracks.append(StubTrack(slots, slot_idx=-1))
    return StubSong(tracks)


# --- init ---------------------------------------------------------------


def test_init_attaches_one_slot_listener_per_track(recorder, clock):
    song = _empty_song(track_count=4)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        for t in song.tracks:
            assert t._listener is not None
        assert len(c._slot_listeners) == 4
    finally:
        c.disconnect()


def test_init_emit_stopped_for_idle_tracks(recorder, clock):
    """Idle tracks emit a single ``slot_idx=-1`` frame so the UI knows
    the track has no playing clip rather than guessing from absence."""
    song = _empty_song(track_count=2)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 2
        for payload in emits:
            assert payload[1] == -1   # slot_idx
            assert payload[2] == 0    # is_audio_clip
            assert payload[3] == ""   # file_path
            assert payload[8] == 0    # status (stopped)
    finally:
        c.disconnect()


def test_init_emit_seeds_playing_clip_payload(recorder, clock):
    """Track with a clip already playing emits ``playing_slot`` with
    the full render context (file_path, length, loop bounds, status)."""
    clip = StubClip(
        is_audio_clip=True, is_midi_clip=False,
        file_path="/User Library/Samples/foo.wav",
        length=8.0, loop_start=2.0, loop_end=6.0, looping=True,
        playing_position=1.5,
    )
    track = StubTrack([StubClipSlot(clip), StubClipSlot(None)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        p = emits[0]
        assert p[0] == "tracks/0"
        assert p[1] == 0                                        # slot_idx
        assert p[2] == 1                                        # is_audio_clip
        assert p[3] == "/User Library/Samples/foo.wav"          # file_path
        assert p[4] == 8.0                                       # length
        assert p[5] == 2.0                                       # loop_start
        assert p[6] == 6.0                                       # loop_end
        assert p[7] == 1                                         # looping
        assert p[8] == 1                                         # status (playing)
    finally:
        c.disconnect()


# --- slot transitions ---------------------------------------------------


class StubAudioSpanClip(StubClip):
    """Audio clip that answers where its file sits (``read_file_span``).

    Defaults are the rig's Bass take, measured 2026-09-18: 784000 frames,
    warped, beats 0..28, looping 16..24 — and ``length`` 8, the loop's
    length, which is why the span has to travel separately.
    """

    def __init__(self, *, warping=True, frames=784000, beats=28.0, **kw):
        kw.setdefault("is_audio_clip", True)
        kw.setdefault("is_midi_clip", False)
        kw.setdefault("file_path", "/Rec/Bass 0001.aif")
        kw.setdefault("length", 8.0)
        kw.setdefault("loop_start", 16.0)
        kw.setdefault("loop_end", 24.0)
        kw.setdefault("looping", True)
        super().__init__(**kw)
        self.warping = warping
        self.sample_length = frames
        self.sample_rate = 44100.0
        self._beats, self._frames = beats, frames

    def sample_to_beat_time(self, sample_time):
        if not self.warping:
            raise RuntimeError("Sample is not warped")
        return sample_time * self._beats / self._frames


def test_playing_slot_carries_audio_file_span(recorder, clock):
    """The loop sits past ``length`` on a moved loop; the span is what
    lets the UI find it in the file (the blank-strip bug, 2026-09-18)."""
    track = StubTrack([StubClipSlot(StubAudioSpanClip())], slot_idx=0)
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    try:
        p = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)[0]
        assert p[4:7] == (8.0, 16.0, 24.0)   # length, loop_start, loop_end
        assert p[9:] == (0.0, 28.0)           # file_start, file_end
    finally:
        c.disconnect()


def test_playing_slot_unwarped_span_is_seconds(recorder, clock):
    clip = StubAudioSpanClip(warping=False, frames=441000)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    try:
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)[0][9:] == (0.0, 10.0)
    finally:
        c.disconnect()


def test_playing_slot_span_unknown_for_midi_and_empty(recorder, clock):
    """MIDI never asks for a span; an empty track sends zeros too."""
    midi = StubTrack([StubClipSlot(StubClip())], slot_idx=0)
    empty = StubTrack([StubClipSlot(None)], slot_idx=-1)
    c = PlayheadComponent(song=StubSong([midi, empty]), emit=recorder)
    try:
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 2
        for p in emits:
            assert len(p) == 11
            assert p[9:] == (0.0, 0.0)
    finally:
        c.disconnect()


def test_read_file_span_guards():
    read = playhead_module.read_file_span
    assert read(StubClip()) == (0.0, 0.0)                         # no sample_length
    assert read(StubAudioSpanClip(frames=0)) == (0.0, 0.0)        # flushing take
    clip = StubAudioSpanClip()
    clip.sample_to_beat_time = lambda t: (_ for _ in ()).throw(RuntimeError("gone"))
    assert read(clip) == (0.0, 0.0)                               # LOM raise
    clip = StubAudioSpanClip()
    clip.sample_to_beat_time = lambda t: float("nan")
    assert read(clip) == (0.0, 0.0)                               # NaN
    clip = StubAudioSpanClip()
    clip.sample_to_beat_time = lambda t: -4.0 + t / 28000.0       # pre-roll before beat 0
    assert read(clip) == (-4.0, 24.0)


def test_slot_change_emits_playing_slot_with_payload(recorder, clock):
    """Track stopped → playing emits the full render payload."""
    clip = StubClip(file_path="", length=2.0, loop_end=2.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        track.playing_slot_index = 0
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == 0  # slot_idx
        assert emits[0][2] == 0  # not audio
        assert emits[0][4] == 2.0  # length
    finally:
        c.disconnect()


def test_slot_change_to_minus_one_falls_back_to_display_slot(recorder, clock):
    """Track playing → stopped emits the *display* slot frozen.

    When a clip is still on the track, transitioning ``playing_slot_index``
    to -1 surfaces the highlighted/first-non-empty slot with status=stopped
    so the UI keeps rendering content while the playhead freezes naturally
    (no further ``playhead`` emits while transport is stopped). The
    truly-empty case is covered separately.
    """
    clip = StubClip()
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        track.playing_slot_index = -1
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        p = emits[0]
        assert p[1] == 0           # display slot, not -1
        assert p[8] == 0           # status (stopped)
    finally:
        c.disconnect()


def test_slot_change_to_minus_one_on_empty_track_emits_empty(recorder, clock):
    """Truly empty track (no clips anywhere) emits ``slot_idx=-1``.

    Init seeds the empty frame; the dedupe cache then suppresses redundant
    re-emits with identical payloads. Clear the cache to verify the
    listener-fire path produces the right shape on its own.
    """
    track = StubTrack([StubClipSlot(None) for _ in range(4)], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        # Bypass dedupe so we can re-assert the listener-fire payload
        # shape; the dedupe behaviour itself is covered by
        # `test_emit_playing_slot_empty_dedupes`.
        c._last_emitted_payload.clear()
        track.playing_slot_index = -1  # re-fire listener
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == -1
        assert emits[0][3] == ""
        assert emits[0][8] == 0  # status (stopped)
    finally:
        c.disconnect()


def test_slot_change_detaches_prior_position_listener(recorder, clock):
    """Switching playing slot detaches the prior clip's position
    listener so a stale fire can't double-emit."""
    clip0 = StubClip()
    clip1 = StubClip()
    track = StubTrack(
        [StubClipSlot(clip0), StubClipSlot(clip1)], slot_idx=0,
    )
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert clip0._position_listener is not None
        track.playing_slot_index = 1
        assert clip0._position_listener is None
        assert clip1._position_listener is not None
    finally:
        c.disconnect()


def test_slot_change_to_minus_one_keeps_display_listener(recorder, clock):
    """Stopping a track with a clip swaps the playing-clip listener for
    the display-slot listener (still on the same clip if slot 0 is the
    display slot)."""
    clip = StubClip()
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert clip._position_listener is not None
        track.playing_slot_index = -1
        # Listener is re-attached on the display slot (which is the
        # same clip — slot 0 is the only non-empty slot).
        assert clip._position_listener is not None
    finally:
        c.disconnect()


def test_slot_change_to_minus_one_on_empty_track_detaches(recorder, clock):
    """Stopping a track with no other clips truly detaches the listener."""
    clip = StubClip()
    # Only slot 0 has a clip; once playing → -1 with no other clip and
    # no highlight, display fallback still resolves to slot 0 (clip
    # is still on the track). Simulate the truly-empty case by removing
    # the clip from the slot first.
    slot = StubClipSlot(clip)
    track = StubTrack([slot], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert clip._position_listener is not None
        # Empty the slot, then transition to -1. ``has_clip`` is a
        # derived property; setting ``slot.clip = None`` flips it.
        slot.clip = None
        track.playing_slot_index = -1
        assert clip._position_listener is None
    finally:
        c.disconnect()


# --- playhead emits + throttle ------------------------------------------


def test_playing_position_fire_emits_playhead(recorder, clock):
    clip = StubClip(playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip.playing_position = 1.25
        emits = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        assert len(emits) == 1
        assert emits[0][0] == "tracks/0"
        assert emits[0][1] == 0           # slot_idx
        assert emits[0][2] == 1.25        # position_beats
        assert emits[0][3] == 1           # status (playing)
        assert len(emits[0]) == 4          # no anchor/bps tail
    finally:
        c.disconnect()


def test_playhead_throttle_drops_intermediate_within_window(recorder, clock):
    clip = StubClip(playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip.playing_position = 0.1
        clock.advance(0.010)
        clip.playing_position = 0.2  # dropped
        clock.advance(0.010)
        clip.playing_position = 0.3  # dropped

        emits = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        assert len(emits) == 1
        assert emits[0][2] == 0.1
    finally:
        c.disconnect()


def test_playhead_throttle_reopens_at_window_boundary(recorder, clock):
    clip = StubClip(playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip.playing_position = 0.1
        clock.advance(PlayheadComponent.WINDOW_SEC + 1e-6)
        clip.playing_position = 0.2

        emits = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        assert len(emits) == 2
        assert emits[1][2] == 0.2
    finally:
        c.disconnect()


def test_playhead_throttle_is_per_track(recorder, clock):
    clip0 = StubClip()
    clip1 = StubClip()
    t0 = StubTrack([StubClipSlot(clip0)], slot_idx=0)
    t1 = StubTrack([StubClipSlot(clip1)], slot_idx=0)
    song = StubSong([t0, t1])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip0.playing_position = 0.1
        clip1.playing_position = 0.5  # different track, own window

        emits = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        paths = [e[0] for e in emits]
        assert paths == ["tracks/0", "tracks/1"]
    finally:
        c.disconnect()


def test_playhead_window_immune_to_clock_regression(recorder, clock):
    """Backward jump on the fake monotonic clock must not open the
    window — same defence as MetersComponent's monotonic guard."""
    clip = StubClip(playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip.playing_position = 0.1
        clock.now = 999.0
        clip.playing_position = 0.2  # 999 - 1000 < 0.033 → dropped

        assert len(recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)) == 1
    finally:
        c.disconnect()


# --- anchor + tempo -----------------------------------------------------


def test_playhead_emits_position_directly_without_anchor_tail(recorder, clock):
    """``playhead`` ships the live ``playing_position`` straight through,
    with no anchor/rate tail. Tempo changes are absorbed by the LOM
    (``Clip.playing_position`` slows / speeds up under us); we just paint
    whatever value Live hands us at each throttle window."""
    clip = StubClip(playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip.playing_position = 0.5
        clock.advance(PlayheadComponent.WINDOW_SEC + 0.005)
        clip.playing_position = 1.25
        emits = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        assert len(emits) == 2
        assert emits[0][2] == 0.5
        assert emits[1][2] == 1.25
        # Wire shape is exactly four args: no anchor/rate tail.
        for e in emits:
            assert len(e) == 4
    finally:
        c.disconnect()


# --- status -------------------------------------------------------------


def test_status_recording_takes_precedence_over_playing(recorder, clock):
    clip = StubClip(is_recording=True, playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()
        clip.playing_position = 0.5
        emits = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        assert emits[0][3] == PlayheadComponent.STATUS_RECORDING
    finally:
        c.disconnect()


# --- notes-changed (Milestone 3) ----------------------------------------


def test_midi_clip_attaches_notes_listener(recorder, clock):
    clip = StubClip(is_midi_clip=True, is_audio_clip=False)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert clip._notes_listener is not None
    finally:
        c.disconnect()


def test_audio_clip_does_not_attach_notes_listener(recorder, clock):
    clip = StubClip(is_audio_clip=True, is_midi_clip=False)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert clip._notes_listener is None
    finally:
        c.disconnect()


def test_notes_listener_emits_changed_with_track_and_clip_path(
    recorder, clock,
):
    clip = StubClip(is_midi_clip=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        clip.fire_notes()
        emits = recorder.only(V3_CLIP_NOTES_CHANGED_ADDRESS)
        assert emits == [("tracks/0", "tracks/0/slots/0/clip")]
    finally:
        c.disconnect()


def test_slot_change_to_audio_detaches_notes_listener(recorder, clock):
    midi_clip = StubClip(is_midi_clip=True)
    audio_clip = StubClip(is_audio_clip=True, is_midi_clip=False)
    track = StubTrack(
        [StubClipSlot(midi_clip), StubClipSlot(audio_clip)], slot_idx=0,
    )
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert midi_clip._notes_listener is not None
        track.playing_slot_index = 1
        assert midi_clip._notes_listener is None
        assert audio_clip._notes_listener is None
    finally:
        c.disconnect()


# --- recording → playing settle re-emit ---------------------------------


class FakeScheduler:
    """Records ``(delay_ms, fn)`` pending callbacks; ``run_due`` fires them."""

    def __init__(self) -> None:
        self.pending: List[Tuple[int, Callable[[], None]]] = []

    def __call__(self, delay_ms: int, fn: Callable[[], None]) -> None:
        self.pending.append((delay_ms, fn))

    def run_all(self) -> None:
        pending = list(self.pending)
        self.pending.clear()
        for _delay, fn in pending:
            fn()


def test_recording_listener_attached_on_audio_clip(recorder, clock):
    clip = StubClip(is_audio_clip=True, is_midi_clip=False, is_recording=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert clip._recording_listener is not None
    finally:
        c.disconnect()


def test_recording_finished_re_emits_playing_slot_after_settle(
    recorder, clock,
):
    """Record → play transition: ``is_recording`` flips false, the
    settle delay elapses, ``playing_slot`` re-emits with the now-populated
    ``file_path``. Mirrors what the UI sees when Live finishes capturing
    a fresh sample.
    """
    clip = StubClip(
        is_audio_clip=True, is_midi_clip=False,
        is_recording=True, file_path="",
    )
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])
    sched = FakeScheduler()

    c = PlayheadComponent(song=song, emit=recorder, schedule_delayed=sched)
    try:
        # Initial emit happened during init — clear and watch the
        # transition.
        recorder.clear()

        # Live populates the path synchronously with the transition.
        clip.file_path = "/Users/foo/Audio 0001.aif"
        clip.is_recording = False  # fires the listener

        # Listener scheduled exactly one settle recheck; nothing on
        # the wire yet.
        assert len(sched.pending) == 1
        assert sched.pending[0][0] == PlayheadComponent.RECORD_SETTLE_DELAY_MS
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []

        sched.run_all()

        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        # file_path now populated, status flipped to playing.
        assert emits[0][3] == "/Users/foo/Audio 0001.aif"
        assert emits[0][8] == PlayheadComponent.STATUS_PLAYING
    finally:
        c.disconnect()


def test_recording_listener_falls_back_to_sync_emit_without_scheduler(
    recorder, clock,
):
    """Test-friendly path: when no scheduler is wired (legacy test
    construction), the recording listener emits synchronously rather
    than dropping the update."""
    clip = StubClip(
        is_audio_clip=True, is_midi_clip=False,
        is_recording=True, file_path="",
    )
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        clip.file_path = "/Users/foo/sample.aif"
        clip.is_recording = False

        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][3] == "/Users/foo/sample.aif"
        assert emits[0][8] == PlayheadComponent.STATUS_PLAYING
    finally:
        c.disconnect()


def test_fresh_recording_race_late_attaches_via_has_clip_callback(
    recorder, clock,
):
    """Fresh recording into an empty slot: ``playing_slot_index`` flips
    to N before Live populates ``slot.has_clip``. The slot listener
    can't resolve a clip on first try; once ClipsComponent's
    ``has_clip`` fanout fires, ``on_slot_has_clip_changed`` late-attaches
    listeners and re-emits ``playing_slot`` with the populated render
    context.
    """
    slot = StubClipSlot(None)
    track = StubTrack([slot, StubClipSlot(None)], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()

        # Live flips slot index to 0 before clip is materialized.
        track.playing_slot_index = 0
        # Slot listener fired but resolved no clip — empty-frame emit
        # is dedup-suppressed (init already advertised the empty
        # state for this idle track), matching real UX.

        # Live materializes the clip; ClipsComponent's has_clip
        # listener flips and fires its in-process fanout.
        slot.clip = StubClip(
            is_audio_clip=True, is_midi_clip=False,
            is_recording=True, file_path="",
        )
        recorder.clear()
        c.on_slot_has_clip_changed("tracks/0/slots/0", True)

        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == 0  # slot_idx
        # is_recording listener now attached for the eventual stop.
        assert slot.clip._recording_listener is not None
    finally:
        c.disconnect()


def test_full_record_cycle_emits_populated_playing_slot(recorder, clock):
    """End-to-end: empty slot → record start (clip materializes via
    has_clip fanout) → late-attach + emit → record stop (file_path
    populates, is_recording listener schedules settle recheck) →
    populated frame on the wire.
    """
    slot = StubClipSlot(None)
    track = StubTrack([slot], slot_idx=-1)
    song = StubSong([track])
    sched = FakeScheduler()

    c = PlayheadComponent(song=song, emit=recorder, schedule_delayed=sched)
    try:
        recorder.clear()

        # Phase 1: user fires record on empty slot. Live materializes
        # the clip; has_clip fanout → late-attach + emit.
        track.playing_slot_index = 0
        slot.clip = StubClip(
            is_audio_clip=True, is_midi_clip=False,
            is_recording=True, file_path="",
        )
        c.on_slot_has_clip_changed("tracks/0/slots/0", True)
        post_attach_emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(post_attach_emits) == 1
        assert post_attach_emits[0][3] == ""  # file_path still empty
        assert post_attach_emits[0][8] == PlayheadComponent.STATUS_RECORDING

        # Phase 2: user stops recording. Live populates file_path
        # synchronously with is_recording flipping false.
        recorder.clear()
        slot.clip.file_path = "/Users/foo/Audio 0001.aif"
        slot.clip.is_recording = False  # fires is_recording listener
        sched.run_all()  # is_recording → settle recheck → emit

        final_emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(final_emits) == 1
        assert final_emits[0][3] == "/Users/foo/Audio 0001.aif"
        assert final_emits[0][8] == PlayheadComponent.STATUS_PLAYING
    finally:
        c.disconnect()


def test_has_clip_false_on_rendered_slot_re_resolves(recorder, clock):
    """User deletes the clip we're currently rendering. The has_clip
    fanout fires with has_clip=False on the rendered slot; the
    component detaches, re-resolves the display slot, and emits the
    next-best frame (or empty)."""
    slot_a = StubClipSlot(StubClip(is_audio_clip=True, is_midi_clip=False))
    track = StubTrack([slot_a, StubClipSlot(None)], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init pointed display at slot 0 and attached listeners. Now
        # the user deletes the clip from slot 0.
        recorder.clear()
        slot_a.clip = None
        c.on_slot_has_clip_changed("tracks/0/slots/0", False)

        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == -1  # no display fallback — track is empty
        # Listener record cleared.
        assert "tracks/0" not in c._clip_listeners
    finally:
        c.disconnect()


def test_has_clip_false_promotes_next_display_slot(recorder, clock):
    """Deleting the rendered display slot when another non-empty slot
    exists should promote that slot to the new display fallback."""
    slot_a = StubClipSlot(StubClip(is_audio_clip=True, is_midi_clip=False))
    slot_b = StubClipSlot(StubClip(is_audio_clip=True, is_midi_clip=False))
    track = StubTrack([slot_a, slot_b], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        slot_a.clip = None
        c.on_slot_has_clip_changed("tracks/0/slots/0", False)

        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == 1  # display fell to slot 1
        # Now bound to slot 1's clip.
        rec = c._clip_listeners["tracks/0"]
        assert rec["slot_idx"] == 1
    finally:
        c.disconnect()


def test_has_clip_false_on_unrelated_slot_is_noop(recorder, clock):
    """A has_clip=False fanout for a slot we're not rendering must
    not detach the listener record we already hold for a different
    slot on the same track."""
    slot_a = StubClipSlot(StubClip(is_audio_clip=True, is_midi_clip=False))
    slot_b = StubClipSlot(StubClip(is_audio_clip=True, is_midi_clip=False))
    track = StubTrack([slot_a, slot_b], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init bound display to slot 0.
        assert c._clip_listeners["tracks/0"]["slot_idx"] == 0
        recorder.clear()

        # Delete from slot 1 (we're not rendering it).
        slot_b.clip = None
        c.on_slot_has_clip_changed("tracks/0/slots/1", False)

        # No re-emit, no detach of slot 0 listeners.
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
        assert c._clip_listeners["tracks/0"]["slot_idx"] == 0
    finally:
        c.disconnect()


def test_has_clip_true_on_idle_track_promotes_to_display(recorder, clock):
    """Track is stopped and currently empty (no display fallback).
    A clip is created on a slot — promote it to the display."""
    track = StubTrack(
        [StubClipSlot(None), StubClipSlot(None)], slot_idx=-1,
    )
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        # User drops a clip into slot 1.
        track._slots[1].clip = StubClip(
            is_audio_clip=True, is_midi_clip=False,
        )
        c.on_slot_has_clip_changed("tracks/0/slots/1", True)

        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == 1
        assert emits[0][8] == PlayheadComponent.STATUS_STOPPED
    finally:
        c.disconnect()


def test_has_clip_callback_ignores_malformed_paths(recorder, clock):
    """Wrong path shapes (return tracks, master, garbage) must not
    raise or touch the LOM."""
    track = StubTrack([StubClipSlot(None)], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c.on_slot_has_clip_changed("returns/0/slots/0", True)
        c.on_slot_has_clip_changed("master/slots/0", False)
        c.on_slot_has_clip_changed("tracks/abc/slots/0", True)
        c.on_slot_has_clip_changed("garbage", True)
        c.on_slot_has_clip_changed("", False)
        # Out-of-range track index — also a no-op.
        c.on_slot_has_clip_changed("tracks/99/slots/0", True)
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
    finally:
        c.disconnect()


def test_slot_change_detaches_recording_listener(recorder, clock):
    a = StubClip(is_audio_clip=True, is_midi_clip=False, is_recording=True)
    b = StubClip(is_audio_clip=True, is_midi_clip=False)
    track = StubTrack([StubClipSlot(a), StubClipSlot(b)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        assert a._recording_listener is not None
        track.playing_slot_index = 1
        assert a._recording_listener is None
    finally:
        c.disconnect()


# --- resolver priority --------------------------------------------------


def test_resolver_priority_playing_beats_highlight(recorder, clock):
    """Priority 1 (playing slot) wins over priority 2 (highlight)."""
    clip_a = StubClip(is_audio_clip=True, is_midi_clip=False)
    clip_b = StubClip(is_audio_clip=True, is_midi_clip=False)
    slot_a = StubClipSlot(clip_a)
    slot_b = StubClipSlot(clip_b)
    # Playing slot 0; highlight points at slot 1.
    track = StubTrack([slot_a, slot_b], slot_idx=0)
    song = StubSong([track])
    song.view.highlighted_clip_slot = slot_b

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        rendered = c._clip_listeners["tracks/0"]["slot_idx"]
        assert rendered == 0  # playing wins
    finally:
        c.disconnect()


def test_resolver_priority_highlight_beats_first_non_empty(recorder, clock):
    """Priority 2 (highlight on this track) wins over priority 3
    (first non-empty slot)."""
    clip_a = StubClip(is_audio_clip=True, is_midi_clip=False)
    clip_b = StubClip(is_audio_clip=True, is_midi_clip=False)
    slot_a = StubClipSlot(clip_a)
    slot_b = StubClipSlot(clip_b)
    slot_a._live_ptr = 0x3001
    slot_b._live_ptr = 0x3002
    # Track stopped; highlight on slot 1 (slot 0 has a clip too,
    # which is what priority 3 would pick).
    track = StubTrack([slot_a, slot_b], slot_idx=-1)
    song = StubSong([track])
    song.view.highlighted_clip_slot = slot_b

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        rendered = c._clip_listeners["tracks/0"]["slot_idx"]
        assert rendered == 1  # highlight wins over first-non-empty
    finally:
        c.disconnect()


def test_resolver_priority_first_non_empty_when_no_highlight(recorder, clock):
    """Priority 3: stopped track, no highlight on it → first
    non-empty slot."""
    clip_b = StubClip(is_audio_clip=True, is_midi_clip=False)
    track = StubTrack(
        [StubClipSlot(None), StubClipSlot(clip_b), StubClipSlot(None)],
        slot_idx=-1,
    )
    song = StubSong([track])
    # No highlight set (default None).

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        rendered = c._clip_listeners["tracks/0"]["slot_idx"]
        assert rendered == 1
    finally:
        c.disconnect()


def test_resolver_empty_track_emits_minus_one(recorder, clock):
    """Priority 4: track has no clips at all → emit slot_idx=-1 so
    UI hides the strip."""
    track = StubTrack(
        [StubClipSlot(None), StubClipSlot(None)], slot_idx=-1,
    )
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == -1
        # No clip listeners for an empty track.
        assert "tracks/0" not in c._clip_listeners
    finally:
        c.disconnect()


def test_resolver_re_resolves_when_highlight_moves(recorder, clock):
    """Highlight moving onto a different non-empty slot of a stopped
    track flips the displayed slot via the unified resolver."""
    clip_a = StubClip(is_audio_clip=True, is_midi_clip=False)
    clip_b = StubClip(is_audio_clip=True, is_midi_clip=False)
    slot_a = StubClipSlot(clip_a)
    slot_b = StubClipSlot(clip_b)
    slot_a._live_ptr = 0x4001
    slot_b._live_ptr = 0x4002
    track = StubTrack([slot_a, slot_b], slot_idx=-1)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init picked first non-empty (slot 0).
        assert c._clip_listeners["tracks/0"]["slot_idx"] == 0
        recorder.clear()

        # Highlight slot 1; the resolver now prefers it.
        song.view.highlighted_clip_slot = slot_b
        song.view.fire_highlight()

        rendered = c._clip_listeners["tracks/0"]["slot_idx"]
        assert rendered == 1
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == 1
    finally:
        c.disconnect()


# --- structural rebind --------------------------------------------------


def test_on_structural_change_rebinds_to_current_tracks(recorder, clock):
    song = _empty_song(track_count=3)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c._last_emit.clear()

        old_track = song.tracks[0]
        kept1, kept2 = song.tracks[1], song.tracks[2]
        new_track = StubTrack(
            [StubClipSlot(None) for _ in range(4)], slot_idx=-1,
        )
        # Live tears down C++ listeners on rebind; the stub doesn't
        # simulate that, so reset slots on the kept tracks.
        for t in (kept1, kept2):
            t._listener = None
        song.set_tracks([new_track, kept1, kept2])
        c.on_structural_change()

        targets = [target for target, *_ in c._slot_listeners]
        assert old_track not in targets
        assert new_track._listener is not None
    finally:
        c.disconnect()


def test_on_structural_change_prunes_stale_last_emit(recorder, clock):
    song = _empty_song(track_count=3)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Seed _last_emit for every track.
        c._last_emit["tracks/0"] = clock.now
        c._last_emit["tracks/1"] = clock.now
        c._last_emit["tracks/2"] = clock.now

        kept0, kept1 = song.tracks[0], song.tracks[1]
        for t in (kept0, kept1):
            t._listener = None
        song.set_tracks([kept0, kept1])
        c.on_structural_change()

        assert "tracks/2" not in c._last_emit
    finally:
        c.disconnect()


def test_on_structural_change_clears_warned(recorder, clock, caplog):
    """`_warned` clears on rebind so a fresh LOM wrapper can re-warn."""
    song = _empty_song(track_count=1)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        with caplog.at_level(logging.WARNING, logger="looping"):
            c._warn_once("tracks/0", "ctx", RuntimeError("boom-1"))
            assert ("tracks/0", "ctx") in c._warned

            c.on_structural_change()
            assert ("tracks/0", "ctx") not in c._warned

            # Same key should now warn again.
            c._warn_once("tracks/0", "ctx", RuntimeError("boom-2"))
            warns = [
                r for r in caplog.records
                if r.levelno == logging.WARNING and "ctx" in r.message
            ]
            assert len(warns) == 2
    finally:
        c.disconnect()


def test_on_structural_change_prunes_stale_last_emitted_payload(
    recorder, clock,
):
    """Dedup cache drops entries for tracks that disappeared."""
    song = _empty_song(track_count=3)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        c._last_emitted_payload["tracks/0"] = ("tracks/0", -1, 0, "", 0.0,
                                               0.0, 0.0, 0, 0)
        c._last_emitted_payload["tracks/1"] = ("tracks/1", -1, 0, "", 0.0,
                                               0.0, 0.0, 0, 0)
        c._last_emitted_payload["tracks/2"] = ("tracks/2", -1, 0, "", 0.0,
                                               0.0, 0.0, 0, 0)

        kept0, kept1 = song.tracks[0], song.tracks[1]
        for t in (kept0, kept1):
            t._listener = None
        song.set_tracks([kept0, kept1])
        c.on_structural_change()

        assert "tracks/2" not in c._last_emitted_payload
    finally:
        c.disconnect()


# --- emit_on_accept (handshake reseed) ----------------------------------


def test_emit_on_accept_clears_dedup_and_reemits(recorder, clock):
    """Reconnect path: dedup cache cleared so the re-seed actually lands.

    State/full doesn't carry file_path / loop_* / looping / is_audio_clip,
    so the strip relies on PlayheadComponent's playing_slot for those
    fields. Without this hook a stationary-state reconnect would leave
    the strip blank — the dedup would suppress the (byte-identical)
    re-emit attempt.
    """
    audio_clip = StubClip(is_audio_clip=True, is_midi_clip=False, length=4.0)
    track = StubTrack([StubClipSlot(audio_clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init seeds the dedup cache.
        assert "tracks/0" in c._last_emitted_payload
        recorder.clear()

        # Reconnect: emit_on_accept must re-emit even though LOM state
        # is unchanged (every payload is byte-identical to what's in the
        # cache).
        c.emit_on_accept()
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][1] == 0  # slot_idx
    finally:
        c.disconnect()


def test_emit_on_accept_seeds_empty_tracks(recorder, clock):
    """Empty tracks get their slot_idx=-1 frame on re-seed too."""
    song = _empty_song(track_count=3)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        c.emit_on_accept()
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 3
        for p in emits:
            assert p[1] == -1
    finally:
        c.disconnect()


def test_emit_on_accept_after_disconnect_is_noop(recorder, clock):
    """Late accept hook after disconnect must not crash or emit."""
    song = _empty_song(track_count=1)
    c = PlayheadComponent(song=song, emit=recorder)
    c.disconnect()
    recorder.clear()
    c.emit_on_accept()  # must not raise
    assert recorder.emissions == []


# --- emit dedupe --------------------------------------------------------


def test_emit_playing_slot_dedupes_identical_payloads(recorder, clock):
    """Re-emitting the same payload to the same path is a no-op on wire."""
    audio_clip = StubClip(is_audio_clip=True, is_midi_clip=False, length=4.0)
    track = StubTrack([StubClipSlot(audio_clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init emitted one playing_slot for the playing track.
        first = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(first) == 1

        # Manually re-invoke emit_initial_values (mimics post-rebind path
        # where the LOM state is unchanged).
        recorder.clear()
        c._emit_initial_values()
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
    finally:
        c.disconnect()


def test_emit_playing_slot_fires_when_payload_changes(recorder, clock):
    """A real state change still emits — dedupe is content-based."""
    audio_clip = StubClip(is_audio_clip=True, is_midi_clip=False, length=4.0)
    track = StubTrack([StubClipSlot(audio_clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        recorder.clear()
        # Mutate clip length — the next emit lands a different payload.
        audio_clip.length = 8.0
        c._emit_initial_values()
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        # Payload index 4 is length_beats.
        assert emits[0][4] == 8.0
    finally:
        c.disconnect()


def test_emit_playing_slot_empty_dedupes(recorder, clock):
    """Empty frames dedupe too — re-emitting the same `slot_idx=-1` is a no-op."""
    song = _empty_song(track_count=1)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init emitted one empty frame.
        first = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(first) == 1
        assert first[0][1] == -1

        recorder.clear()
        c._emit_playing_slot_empty("tracks/0")
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
    finally:
        c.disconnect()


# --- highlight guard ----------------------------------------------------


def test_highlight_unchanged_display_slot_skips_work(recorder, clock):
    """Re-firing highlight with the same resolved display_idx is a no-op.

    The current display slot is the highlighted one (slot 0). Firing
    highlight again with the same target should not re-emit, re-attach,
    or re-detach.
    """
    midi_clip = StubClip(is_midi_clip=True, length=4.0)
    slots = [StubClipSlot(midi_clip), StubClipSlot(None)]
    # Slot identity for `_safe_int_id` lookups in `_resolve_display_slot`.
    slots[0]._live_ptr = 0x1001
    slots[1]._live_ptr = 0x1002
    track = StubTrack(slots, slot_idx=-1)
    song = StubSong([track])
    song.view.highlighted_clip_slot = slots[0]

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init: track stopped → display slot 0 attached + emitted.
        initial_position_listener = midi_clip._position_listener
        initial_notes_listener = midi_clip._notes_listener
        assert initial_position_listener is not None
        assert initial_notes_listener is not None
        recorder.clear()

        # Fire highlight with the same target.
        song.view.fire_highlight()

        # No new emit; existing listeners untouched (same callbacks).
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
        assert midi_clip._position_listener is initial_position_listener
        assert midi_clip._notes_listener is initial_notes_listener
    finally:
        c.disconnect()


def test_highlight_changed_display_slot_emits_and_reattaches(recorder, clock):
    """A real display-slot change does detach/attach/emit."""
    clip0 = StubClip(is_midi_clip=True, length=4.0)
    clip1 = StubClip(is_midi_clip=True, length=8.0)
    slots = [StubClipSlot(clip0), StubClipSlot(clip1)]
    slots[0]._live_ptr = 0x2001
    slots[1]._live_ptr = 0x2002
    track = StubTrack(slots, slot_idx=-1)
    song = StubSong([track])
    song.view.highlighted_clip_slot = slots[0]

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init attached to slot 0.
        assert clip0._position_listener is not None
        recorder.clear()

        # Move highlight to slot 1.
        song.view.highlighted_clip_slot = slots[1]
        song.view.fire_highlight()

        # Old listener detached, new one attached, emit fired.
        assert clip0._position_listener is None
        assert clip1._position_listener is not None
        assert len(recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)) == 1
    finally:
        c.disconnect()


def test_highlight_unchanged_empty_track_skips_work(recorder, clock):
    """Highlight on a truly-empty track (display_idx == -1) is also a no-op
    once we've already emitted the empty frame."""
    track = StubTrack(
        [StubClipSlot(None) for _ in range(2)], slot_idx=-1,
    )
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Init emitted the empty frame.
        recorder.clear()
        song.view.fire_highlight()
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
    finally:
        c.disconnect()


# --- LOM exception swallowing -------------------------------------------


def test_attach_runtime_error_does_not_crash(recorder, clock, caplog):
    song = _empty_song(track_count=2)
    song.tracks[0]._raises_on_attach = True
    with caplog.at_level(logging.WARNING, logger="looping"):
        c = PlayheadComponent(song=song, emit=recorder)
    try:
        # Track 1 still attached.
        assert song.tracks[1]._listener is not None
        # Component logged the WARNING for track 0.
        assert any(
            "PlayheadComponent" in r.message and "attach" in r.message
            for r in caplog.records
        )
    finally:
        c.disconnect()


def test_warn_once_dedupes_repeat_failures(recorder, clock, caplog):
    """Same (key, context) only logs once."""
    song = _empty_song(track_count=1)
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        with caplog.at_level(logging.WARNING, logger="looping"):
            c._warn_once("tracks/0", "some-context", RuntimeError("boom"))
            c._warn_once("tracks/0", "some-context", RuntimeError("boom"))
        warns = [
            r for r in caplog.records
            if r.levelno == logging.WARNING and "some-context" in r.message
        ]
        assert len(warns) == 1
    finally:
        c.disconnect()


# --- disconnect ---------------------------------------------------------


def test_disconnect_detaches_every_listener(recorder, clock):
    midi_clip = StubClip(is_midi_clip=True)
    track = StubTrack([StubClipSlot(midi_clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    c.disconnect()

    assert track._listener is None
    assert midi_clip._position_listener is None
    assert midi_clip._notes_listener is None


def test_disconnect_is_idempotent(recorder, clock):
    song = _empty_song(track_count=2)
    c = PlayheadComponent(song=song, emit=recorder)
    c.disconnect()
    c.disconnect()  # must not raise


def test_late_fire_after_disconnect_is_swallowed(recorder, clock):
    clip = StubClip(playing_position=0.0)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    song = StubSong([track])

    c = PlayheadComponent(song=song, emit=recorder)
    # Capture the per-clip position callback before disconnect.
    cb = clip._position_listener
    c.disconnect()
    recorder.clear()

    cb()  # late fire; must not emit
    assert recorder.emissions == []


# --- clip replacement at a fixed slot index (audit item 23) ----------------
#
# `_apply_render_target` short-circuited on slot INDEX alone. But
# `ClipsComponent.handle_load_file` has replace semantics — `delete_clip()`
# then `create_audio_clip()` (ClipsComponent.py:753-771) — so "replace the
# audio in this loop" installs a different clip at the same index while
# `playing_slot_index` still reads that index. The short-circuit fired, and
# all three listeners stayed bound to the torn-down handle: the strip's
# playhead froze and clip/notes/changed stopped firing for that clip until
# some unrelated structural change forced a rebind.
#
# These stubs carry `_live_ptr` so `_safe_int_id` can tell the two clips
# apart, which is what the component now compares (ADR-350: identity is
# `_live_ptr`-based, never Python-object identity).


def _identified(clip, ptr: int):
    """Give a StubClip a LOM identity, as a real clip wrapper has."""
    clip._live_ptr = ptr
    return clip


def test_clip_replaced_at_same_slot_rebinds_listeners(recorder, clock):
    song = _empty_song(track_count=1)
    track = song.tracks[0]
    clip_a = _identified(StubClip(is_audio_clip=True, is_midi_clip=False), 0xA1)
    track._slots[2] = StubClipSlot(clip_a)

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        track.playing_slot_index = 2
        assert clip_a._position_listener is not None

        # Replace: same slot index, different clip object and identity.
        clip_b = _identified(StubClip(is_audio_clip=True, is_midi_clip=False), 0xB2)
        track._slots[2] = StubClipSlot(clip_b)
        c._apply_render_target(track, 0, "tracks/0")

        assert clip_a._position_listener is None, "listeners left on the dead clip"
        assert clip_a._notes_listener is None
        assert clip_a._recording_listener is None
        assert clip_b._position_listener is not None, "new clip never bound"

        # The live clip's playhead now reaches the wire.
        recorder.clear()
        clip_b._playing_position = 1.5
        clip_b._position_listener()
        assert recorder.emissions, (
            "position change from the replacement clip never emitted"
        )
    finally:
        c.disconnect()


def test_same_clip_at_same_slot_still_short_circuits(recorder, clock):
    """The optimization this guards must survive: an unchanged clip at an
    unchanged index must NOT tear down and re-attach its listeners."""
    song = _empty_song(track_count=1)
    track = song.tracks[0]
    clip = _identified(StubClip(is_audio_clip=True, is_midi_clip=False), 0xC3)
    track._slots[2] = StubClipSlot(clip)

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        track.playing_slot_index = 2
        first = clip._position_listener
        assert first is not None

        c._apply_render_target(track, 0, "tracks/0")

        assert clip._position_listener is first, "listener was needlessly rebound"
    finally:
        c.disconnect()


def test_unidentifiable_clip_falls_back_to_index_only(recorder, clock):
    """A clip whose identity cannot be resolved must not churn.

    `_safe_int_id` returns None for a handle Live will not answer for.
    Treating that as "different" would tear down and re-attach three
    listeners on every render-target pass, which is worse than the bug.
    """
    song = _empty_song(track_count=1)
    track = song.tracks[0]
    clip = StubClip(is_audio_clip=True, is_midi_clip=False)  # no _live_ptr
    track._slots[2] = StubClipSlot(clip)

    c = PlayheadComponent(song=song, emit=recorder)
    try:
        track.playing_slot_index = 2
        first = clip._position_listener
        c._apply_render_target(track, 0, "tracks/0")
        assert clip._position_listener is first
    finally:
        c.disconnect()


# --- playing_clip query (permute ADR-020) -------------------------------------------


def test_playing_clip_returns_the_playing_slots_clip(recorder):
    clip = StubClip()
    track = StubTrack([StubClipSlot(None), StubClipSlot(clip)], slot_idx=-1)
    song = StubSong([track])
    comp = PlayheadComponent(song=song, emit=recorder)

    assert comp.playing_clip(track, "tracks/0") is None      # stopped
    track.playing_slot_index = 1
    got = comp.playing_clip(track, "tracks/0")
    assert got is not None and got[0] is clip and got[1] == 1
    track.playing_slot_index = 0                              # empty slot
    assert comp.playing_clip(track, "tracks/0") is None
    # No second slot listener was attached for the query.
    assert track._listener is not None
    comp.disconnect()
    assert comp.playing_clip(track, "tracks/0") is None


# --- edits and a stopped transport (2026-09-18) --------------------------


class StubEditableClip(StubAudioSpanClip):
    """Audio clip whose loop points, markers, looping and warping fire
    listeners when set — the six properties ``_EDIT_PROPERTIES`` watches."""

    _PROPS = ("warping", "looping", "loop_start", "loop_end", "start_marker", "end_marker")

    def __init__(self, **kw):
        object.__setattr__(self, "_edit_listeners", {p: [] for p in self._PROPS})
        super().__init__(**kw)
        self.start_marker = kw.get("loop_start", 16.0)
        self.end_marker = 28.0

    def __setattr__(self, name, value):
        object.__setattr__(self, name, value)
        listeners = self.__dict__.get("_edit_listeners", {}).get(name)
        if listeners:
            for cb in list(listeners):
                cb()

    def __getattr__(self, name):
        for verb in ("add", "remove"):
            prefix, suffix = verb + "_", "_listener"
            if name.startswith(prefix) and name.endswith(suffix):
                prop = name[len(prefix):-len(suffix)]
                if prop in self._PROPS:
                    lst = self.__dict__["_edit_listeners"][prop]
                    return lst.append if verb == "add" else lst.remove
        raise AttributeError(name)


def test_edit_while_stopped_resends_the_window(recorder, clock):
    """Turning warping off with the transport stopped converted the loop
    points to seconds in Live, and the strip never heard about it."""
    clip = StubEditableClip()
    track = StubTrack([StubClipSlot(clip)], slot_idx=-1)   # stopped: display slot
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    try:
        recorder.clear()
        clip.warping = False
        clip.loop_start = 10.158730158730158
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert emits, "an edit on the displayed clip re-sends it"
        last = emits[-1]
        assert last[5] == pytest.approx(10.158730158730158)   # loop_start
        assert last[9:] == pytest.approx((0.0, 784000 / 44100.0))  # span in seconds
    finally:
        c.disconnect()


def test_edits_coalesce_into_one_refresh(recorder, clock):
    """One warping toggle converts every loop point and marker with it —
    six fires, one re-send, read after Live has finished."""
    clip = StubEditableClip()
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    sched = FakeScheduler()
    c = PlayheadComponent(song=StubSong([track]), emit=recorder, schedule_delayed=sched)
    try:
        recorder.clear()
        clip.warping = False
        clip.loop_start = 10.0
        clip.loop_end = 17.0
        clip.start_marker = 10.0
        assert len(sched.pending) == 1
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS) == []
        sched.run_all()
        emits = recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
        assert len(emits) == 1
        assert emits[0][5:7] == (10.0, 17.0)
    finally:
        c.disconnect()


def test_resend_of_a_live_clip_restates_its_position(recorder, clock):
    """A fresh ``playing_slot`` rebuilds the UI's entry; the position has
    to follow it, or a held clip reads 0 while Live holds it mid-loop."""
    clip = StubEditableClip(playing_position=17.56)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    try:
        heads = recorder.only(V3_TRACK_PLAYHEAD_ADDRESS)
        assert heads == [("tracks/0", 0, 17.56, PlayheadComponent.STATUS_PLAYING)]
        recorder.clear()
        c.emit_on_accept()                        # a UI connects
        order = [a for a, _ in recorder.emissions]
        assert order == [V3_TRACK_PLAYING_SLOT_ADDRESS, V3_TRACK_PLAYHEAD_ADDRESS]
    finally:
        c.disconnect()


def test_stopped_display_clip_sends_no_position(recorder, clock):
    track = StubTrack([StubClipSlot(StubEditableClip())], slot_idx=-1)
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    try:
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)[0][8] == 0
        assert recorder.only(V3_TRACK_PLAYHEAD_ADDRESS) == []
    finally:
        c.disconnect()


class StubTransportSong(StubSong):
    def __init__(self, tracks):
        super().__init__(tracks)
        self._is_playing = True
        self._transport_listeners: List[Callable[[], None]] = []

    @property
    def is_playing(self):
        return self._is_playing

    @is_playing.setter
    def is_playing(self, value):
        self._is_playing = value
        for cb in list(self._transport_listeners):
            cb()

    def add_is_playing_listener(self, cb):
        self._transport_listeners.append(cb)

    def remove_is_playing_listener(self, cb):
        self._transport_listeners.remove(cb)


def test_transport_stop_restates_each_live_clip_once(recorder, clock):
    """The 30 Hz window can drop the last position before a stop; the stop
    says where Live froze each clip, outside the window."""
    live = StubEditableClip(playing_position=1.0)
    idle = StubEditableClip()
    t_live = StubTrack([StubClipSlot(live)], slot_idx=0)
    t_idle = StubTrack([StubClipSlot(idle)], slot_idx=-1)
    song = StubTransportSong([t_live, t_idle])
    c = PlayheadComponent(song=song, emit=recorder)
    try:
        live._playing_position = 1.5577      # moved; the window swallowed it
        recorder.clear()
        song.is_playing = False
        assert recorder.only(V3_TRACK_PLAYHEAD_ADDRESS) == [
            ("tracks/0", 0, 1.5577, PlayheadComponent.STATUS_PLAYING),
        ]
        recorder.clear()
        song.is_playing = True
        assert recorder.only(V3_TRACK_PLAYHEAD_ADDRESS) == []
    finally:
        c.disconnect()
    assert song._transport_listeners == []


def test_disconnect_detaches_edit_listeners(recorder, clock):
    clip = StubEditableClip()
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    assert all(len(v) == 1 for v in clip._edit_listeners.values())
    c.disconnect()
    assert all(v == [] for v in clip._edit_listeners.values())


# --- change hook (ADR-447: key Follow rides the playhead) ----------------------


def _hooked(song, **kw):
    seen = []
    c = PlayheadComponent(song=song, emit=lambda *a: None, **kw)
    c.add_change_callback(lambda path, kind: seen.append((path, kind)))
    return c, seen


def test_change_hook_fires_target_on_a_slot_change(recorder, clock):
    clip = StubClip(is_midi_clip=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=-1)
    c, seen = _hooked(StubSong([track]))
    try:
        track.playing_slot_index = 0
        assert ("tracks/0", "target") in seen
    finally:
        c.disconnect()


def test_change_hook_fires_notes_before_the_throttle(recorder, clock):
    clip = StubClip(is_midi_clip=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    c, seen = _hooked(StubSong([track]))
    try:
        clip.fire_notes()
        clip.fire_notes()  # inside the 250 ms window: no wire emit, still a change
        assert seen.count(("tracks/0", "notes")) == 2
    finally:
        c.disconnect()


def test_change_hook_fires_recorded_only_while_the_track_plays(recorder, clock):
    clip = StubClip(is_midi_clip=True, is_recording=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    c, seen = _hooked(StubSong([track]), schedule_delayed=FakeScheduler())
    try:
        clip.is_recording = False  # the take ended and plays on
        assert seen == [("tracks/0", "recorded")]
        seen.clear()
        track._slot_idx = -1  # a stopped take: Live moved the slot first
        clip.is_recording = True
        clip.is_recording = False
        assert seen == []
    finally:
        c.disconnect()


def test_a_raising_change_callback_does_not_stop_the_playhead(recorder, clock):
    clip = StubClip(is_midi_clip=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=-1)
    c = PlayheadComponent(song=StubSong([track]), emit=recorder)
    seen = []

    def boom(path, kind):
        raise RuntimeError("a subscriber's bug")

    c.add_change_callback(boom)
    c.add_change_callback(lambda path, kind: seen.append(kind))
    try:
        recorder.clear()
        track.playing_slot_index = 0
        assert "target" in seen
        assert recorder.only(V3_TRACK_PLAYING_SLOT_ADDRESS)
    finally:
        c.disconnect()


def test_disconnect_drops_change_callbacks(recorder, clock):
    clip = StubClip(is_midi_clip=True)
    track = StubTrack([StubClipSlot(clip)], slot_idx=0)
    c, seen = _hooked(StubSong([track]))
    c.disconnect()
    c._notify_change("tracks/0", "target")
    assert seen == []
