"""ADR-446 / ADR-447: the key-detect verb and Follow on the surface.

The stubs model what the design leans on: clips with a LOM identity
(``_live_ptr``), a song whose key writes fire ``scale_information`` the way
Live's do, Live's redo stack (``can_redo``), writes Live refuses, and the
playhead's change hook (``on_playing_change``), which a test calls by hand
where Live would.
"""

from __future__ import annotations

import itertools

import pytest

from components.KeyDetectComponent import (
    CHANGE_NOTES,
    CLASSIFY_DELAY_MS,
    EDIT_DELAY_MS,
    FOLLOW_DELAY_MS,
    V3_SESSION_SCALE_DETECTED_ADDRESS,
    KeyDetectComponent,
)

_PTR = itertools.count(1000)


class StubNote:
    def __init__(self, pitch, start, dur, mute=False):
        self.pitch, self.start_time, self.duration, self.mute = pitch, start, dur, mute


class StubClip:
    """A MIDI clip. ``get_notes_extended`` answers the window, as Live does."""

    def __init__(self, notes, loop_start=0.0, loop_end=8.0, is_midi=True, recording=False,
                 raise_on_notes=False):
        self._live_ptr = next(_PTR)
        self.notes = list(notes)
        self.is_midi_clip = is_midi
        self.looping = True
        self.loop_start, self.loop_end = loop_start, loop_end
        self.is_recording = recording
        self._raise = raise_on_notes
        self.calls = []

    def get_notes_extended(self, from_pitch, pitch_span, from_time, time_span):
        self.calls.append((from_pitch, pitch_span, from_time, time_span))
        if self._raise:
            raise RuntimeError("no notes for you")
        return tuple(n for n in self.notes if from_time <= n.start_time < from_time + time_span)


class StubSlot:
    def __init__(self, clip=None):
        self.clip = clip

    @property
    def has_clip(self):
        return self.clip is not None


class StubChain:
    def __init__(self, devices):
        self.devices = devices


class StubDevice:
    def __init__(self, class_name, chains=None):
        self.class_name = class_name
        self.can_have_chains = chains is not None
        self.chains = chains or []


class StubTrack:
    def __init__(self, clip=None, role="", playing=None, midi=True, foldable=False, devices=()):
        self.has_midi_input = midi
        self.is_foldable = foldable
        self.clip_slots = [StubSlot(clip)]
        self.playing_slot_index = (0 if clip is not None else -1) if playing is None else playing
        self.devices = list(devices)
        self._data = {"looping.role": role}

    def get_data(self, key, default):
        return self._data.get(key, default)

    def play(self, clip=None):
        if clip is not None:
            self.clip_slots[0].clip = clip
        self.playing_slot_index = 0

    def stop(self):
        self.playing_slot_index = -1


class RaisingTrack:
    """Live 12 raises RuntimeError on some reads; the component must skip it."""

    def __getattr__(self, name):
        raise RuntimeError("touchy")


class StubSong:
    """Key writes fire ``scale_information`` synchronously, as Live's do; a
    write to an attribute in ``refuse`` raises, as Live's can."""

    def __init__(self, tracks, root=0, scale="Major", numerator=4, denominator=4):
        self.tracks = tracks
        self.signature_numerator, self.signature_denominator = numerator, denominator
        self._root, self._scale = root, scale
        self.scale_mode = False
        self.can_redo = False
        self.refuse = set()
        self.undo = []
        self._scale_listeners = []

    @property
    def root_note(self):
        return self._root

    @root_note.setter
    def root_note(self, v):
        if "root_note" in self.refuse:
            raise RuntimeError("refused")
        self._root = v
        self.fire()

    @property
    def scale_name(self):
        return self._scale

    @scale_name.setter
    def scale_name(self, v):
        if "scale_name" in self.refuse:
            raise RuntimeError("refused")
        self._scale = v
        self.fire()

    def add_scale_information_listener(self, cb):
        self._scale_listeners.append(cb)

    def remove_scale_information_listener(self, cb):
        self._scale_listeners.remove(cb)

    def fire(self):
        for cb in list(self._scale_listeners):
            cb()

    def key_moves_in_live(self, root, scale, can_redo=False):
        """Live's chooser or Push (``can_redo`` False: a fresh action clears the
        redo stack), or Live's undo (``can_redo`` True: a redo is waiting)."""
        self._root, self._scale = root, scale
        self.can_redo = can_redo
        self.fire()

    def begin_undo_step(self):
        self.undo.append("begin")

    def end_undo_step(self):
        self.undo.append("end")


class StubSession:
    """``SessionComponent``'s three handlers: validate, write, swallow a
    refused write (``_write_lom``), never raise."""

    def __init__(self, song, refuse_names=()):
        self.song = song
        self.refuse_names = set(refuse_names)
        self.calls = []

    def handle_set_scale_root(self, args, source_addr):
        self.calls.append(("root", args, source_addr))
        try:
            self.song.root_note = args[0]
        except RuntimeError:
            pass

    def handle_set_scale_name(self, args, source_addr):
        self.calls.append(("name", args, source_addr))
        if args[0] in self.refuse_names:
            return
        try:
            self.song.scale_name = args[0]
        except RuntimeError:
            pass

    def handle_set_scale_mode(self, args, source_addr):
        self.calls.append(("mode", args, source_addr))
        self.song.scale_mode = bool(args[0])


class Settings:
    def __init__(self, on=True):
        self.key_follow = on
        self.calls = []

    def should_follow_key(self):
        return self.key_follow

    def handle_set_key_follow(self, args, source_addr):
        self.calls.append(args)
        if args and args[0] in (0, 1):
            self.key_follow = bool(args[0])


class Scheduler:
    def __init__(self, raise_first=0):
        self.pending = []
        self._raise = raise_first

    def __call__(self, ms, fn):
        if self._raise:
            self._raise -= 1
            raise RuntimeError("task group torn down")
        self.pending.append((ms, fn))

    def run(self):
        for _ in range(20):
            if not self.pending:
                return
            pending, self.pending = self.pending, []
            for _ms, fn in pending:
                fn()


def _bass():
    # C on bar 1, D# on bar 2 — the rig's pattern.
    return StubClip([StubNote(36, 0.0, 2.0), StubNote(44, 2.0, 2.0), StubNote(39, 4.0, 2.0),
                     StubNote(41, 6.0, 2.0)])


def _keys():
    return StubClip([
        StubNote(60, 0.0, 4.0), StubNote(63, 0.0, 4.0), StubNote(67, 0.0, 4.0),
        StubNote(60, 4.0, 4.0), StubNote(65, 4.0, 4.0), StubNote(68, 4.0, 4.0),
    ])


def _melody():
    return StubClip([StubNote(67, 0.0, 1.0), StubNote(70, 1.0, 1.0), StubNote(74, 2.0, 1.0),
                     StubNote(72, 3.0, 1.0)])


@pytest.fixture
def emits():
    return []


def _rig(emits, tracks, following=False, session=True, scheduler=None, **song_kw):
    song = StubSong(tracks, **song_kw)
    settings = Settings(following)
    sched = scheduler if scheduler is not None else Scheduler()
    sess = StubSession(song) if session else None
    comp = KeyDetectComponent(
        song, lambda addr, args: emits.append((addr, args)), session_component=sess,
        is_following=settings.should_follow_key, follow_handler=settings.handle_set_key_follow,
        schedule_delayed=sched,
    )
    return song, comp, settings, sched, sess


def _replies(emits):
    out = []
    for addr, args in emits:
        assert addr == V3_SESSION_SCALE_DETECTED_ADDRESS
        root, scale, band, gap, r_root, r_scale, pcs, reasons, applied = args
        out.append({"root": root, "scale": scale, "band": band, "gap": gap,
                    "runner": (r_root, r_scale), "pcs": pcs, "reasons": reasons, "applied": applied})
    return out


def _reply(emits):
    replies = _replies(emits)
    assert len(replies) == 1, replies
    return replies[0]


# --- the verb ---------------------------------------------------------------

def test_detect_reads_the_launched_clips_and_answers_c_minor(emits):
    song, comp, *_ = _rig(emits, [StubTrack(_bass(), "bass"), StubTrack(_keys(), "key"),
                                  StubTrack(_melody(), "synth")])
    comp.handle_detect((0,), None)
    r = _reply(emits)
    assert (r["root"], r["scale"], r["band"], r["applied"]) == (0, "Minor", "sure", 0)
    assert "bass downbeats C(8) D#(4)" in r["reasons"]
    assert (song.root_note, song.scale_name, song.scale_mode) == (0, "Major", False)


def test_notes_are_read_over_the_loop_only(emits):
    clip = _bass()
    clip.loop_start, clip.loop_end = 2.0, 6.0
    _song, comp, *_ = _rig(emits, [StubTrack(clip, "bass"), StubTrack(_keys(), "key")])
    comp.handle_detect((), None)
    assert clip.calls == [(0, 128, 2.0, 4.0)]


def test_an_unlooped_clip_is_read_between_its_markers(emits):
    """Looping off, Live reports the start and end markers in loop_start /
    loop_end. A clip trimmed to play beats 8..16 is read there, and a note
    before the start marker — which never sounds — casts no vote."""
    clip = StubClip([StubNote(30, 0.0, 8.0),                       # before the start marker
                     StubNote(36, 8.0, 4.0), StubNote(43, 12.0, 4.0)],
                    loop_start=8.0, loop_end=16.0)
    clip.looping = False
    _song, comp, *_ = _rig(emits, [StubTrack(clip, "bass"), StubTrack(_keys(), "key")])
    comp.handle_detect((), None)
    assert clip.calls == [(0, 128, 8.0, 8.0)]
    assert "F#" not in _reply(emits)["reasons"].split("collections that fit")[0]


def test_apply_writes_through_the_session_handlers_in_one_undo_step(emits):
    song, comp, _settings, _sched, sess = _rig(emits, [StubTrack(_bass(), "bass"),
                                                       StubTrack(_keys(), "key")])
    comp.handle_detect((1,), None)
    assert _reply(emits)["applied"] == 1
    assert [(k, a) for k, a, _src in sess.calls] == [("root", (0,)), ("name", ("Minor",)), ("mode", (1,))]
    assert song.undo == ["begin", "end"]
    assert (song.root_note, song.scale_name, song.scale_mode) == (0, "Minor", True)


def test_apply_without_a_session_component_writes_the_song_directly(emits):
    song, comp, *_ = _rig(emits, [StubTrack(_bass(), "bass"), StubTrack(_keys(), "key")], session=False)
    comp.handle_detect((1,), None)
    assert (song.root_note, song.scale_name, song.scale_mode) == (0, "Minor", True)
    assert _reply(emits)["applied"] == 1


def test_applied_is_zero_when_live_does_not_take_the_key(emits):
    """SessionComponent swallows a refused write, so its returning proves
    nothing: the component reads the key back."""
    song = StubSong([StubTrack(_bass(), "bass"), StubTrack(_keys(), "key")])
    settings = Settings(True)
    comp = KeyDetectComponent(
        song, lambda a, args: emits.append((a, args)),
        session_component=StubSession(song, refuse_names={"Minor"}),
        is_following=settings.should_follow_key, follow_handler=settings.handle_set_key_follow,
        schedule_delayed=None,
    )
    comp.handle_detect((1,), None)
    assert _reply(emits)["applied"] == 0
    assert (song.root_note, song.scale_name) == (0, "Major")
    # And a hand later choosing exactly that key is still a hand.
    song.key_moves_in_live(0, "Minor")
    assert settings.key_follow is False


def test_no_key_never_writes_even_when_asked(emits):
    song, comp, _settings, _sched, sess = _rig(emits, [StubTrack(_melody(), "synth")])
    comp.handle_detect((1,), None)
    r = _reply(emits)
    assert (r["root"], r["scale"], r["band"], r["applied"]) == (-1, "", "no-key", 0)
    assert sess.calls == [] and song.undo == []


@pytest.mark.parametrize("args", [(), ("1",), (0.0,), (1.0,), (1.5,), (2,), (float("nan"),),
                                  (float("inf"),), (None,)])
def test_anything_but_an_int_one_means_no_apply_and_still_answers(emits, args):
    _song, comp, _settings, _sched, sess = _rig(emits, [StubTrack(_bass(), "bass"),
                                                        StubTrack(_keys(), "key")])
    comp.handle_detect(args, None)
    assert _reply(emits)["applied"] == 0 and sess.calls == []


def test_drum_rack_one_rack_deep_is_excluded_without_a_role(emits):
    kit = StubClip([StubNote(36, 0.0, 0.2), StubNote(38, 1.0, 0.2), StubNote(42, 2.0, 0.2),
                    StubNote(41, 3.0, 0.2)])
    rack = StubDevice("InstrumentGroupDevice", chains=[StubChain([StubDevice("DrumGroupDevice")])])
    with_kit = [StubTrack(_bass(), "bass"), StubTrack(_keys(), "key"), StubTrack(kit, "", devices=[rack])]
    _song, comp, *_ = _rig(emits, with_kit)
    comp.handle_detect((), None)
    with_kit_reply = _reply(emits)
    emits.clear()
    _song, comp, *_ = _rig(emits, with_kit[:2])
    comp.handle_detect((), None)
    assert with_kit_reply["reasons"] == _reply(emits)["reasons"]
    assert kit.calls == []  # never read


def test_audio_group_stopped_recording_and_raising_tracks_are_skipped(emits):
    tracks = [
        StubTrack(_bass(), "bass"),
        StubTrack(_keys(), "key"),
        StubTrack(_melody(), "synth", midi=False),                         # audio track
        StubTrack(_melody(), "synth", foldable=True),                      # group
        StubTrack(None, "synth"),                                           # nothing launched
        StubTrack(StubClip([], is_midi=False), "synth"),                   # audio clip
        StubTrack(_melody(), "synth", playing=-1),                         # stopped
        StubTrack(StubClip([StubNote(61, 0.0, 8.0)], recording=True), "synth"),  # half a take
        StubTrack(StubClip([StubNote(60, 0.0, 1.0)], raise_on_notes=True), "synth"),
        RaisingTrack(),
    ]
    _song, comp, *_ = _rig(emits, tracks)
    comp.handle_detect((), None)
    r = _reply(emits)
    assert (r["root"], r["scale"]) == (0, "Minor")
    assert "harmonic cycle 8 beats" in r["reasons"]
    assert "pitch classes present: C D# F G G# |" in r["reasons"]  # no C# from the half take


def test_the_time_signature_sets_the_downbeat_grid(emits):
    # In 3/4 bar 2 starts at beat 3, where the bass plays G#.
    _song, comp, *_ = _rig(emits, [StubTrack(_bass(), "bass"), StubTrack(_keys(), "key")], numerator=3)
    comp.handle_detect((), None)
    assert "bass downbeats C(8) G#(4) F(4)" in _reply(emits)["reasons"]


def test_a_six_eight_bar_is_three_quarter_notes(emits):
    """LOM beats are quarter notes whatever the signature: a two-bar 6/8 bass
    has its second downbeat at beat 3."""
    bass = StubClip([StubNote(36, 0.0, 3.0), StubNote(43, 3.0, 3.0)], loop_end=6.0)
    _song, comp, *_ = _rig(emits, [StubTrack(bass, "bass"), StubTrack(_keys(), "key")],
                           numerator=6, denominator=8)
    comp.handle_detect((), None)
    assert "bass downbeats C(8) G(4)" in _reply(emits)["reasons"]


def test_disconnect_is_idempotent_and_drops_the_song_listener(emits):
    song, comp, *_ = _rig(emits, [])
    assert len(song._scale_listeners) == 1
    comp.disconnect()
    comp.disconnect()
    assert song._scale_listeners == []


# --- a hand on the wire -------------------------------------------------------

WIRE = ("127.0.0.1", 50123)


def test_a_key_picked_from_the_interface_turns_follow_off_then_writes(emits):
    song, comp, settings, _sched, sess = _rig(emits, [], following=True)
    comp.handle_set_scale_root((9,), WIRE)
    assert settings.key_follow is False and settings.calls == [(0,)]
    assert sess.calls == [("root", (9,), WIRE)]
    assert song.root_note == 9


def test_picking_the_key_already_set_still_locks(emits):
    """Live fires nothing for a key that does not change, so only the verb
    can see this pick."""
    _song, comp, settings, _sched, sess = _rig(emits, [], following=True)
    comp.handle_set_scale_name(("Major",), WIRE)
    assert settings.key_follow is False
    assert sess.calls == [("name", ("Major",), WIRE)]


def test_a_pick_while_locked_does_not_touch_the_toggle(emits):
    _song, comp, settings, *_ = _rig(emits, [], following=False)
    comp.handle_set_scale_root((2,), WIRE)
    assert settings.calls == []


# --- Follow -----------------------------------------------------------------

def _follow(emits, **kw):
    """Follow on, bass and keys on stopped tracks, Live on C Major."""
    bass, keys = StubTrack(_bass(), "bass", playing=-1), StubTrack(_keys(), "key", playing=-1)
    song, comp, settings, sched, sess = _rig(emits, [bass, keys], following=True, **kw)
    return song, comp, settings, sched, bass, keys


def _launch(comp, track, path, clip=None):
    track.play(clip)
    comp.on_playing_change(path, "target")


def test_launches_coalesce_into_one_pass_that_sets_the_key(emits):
    song, comp, settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    assert [ms for ms, _fn in sched.pending] == [FOLLOW_DELAY_MS]
    sched.run()
    assert (song.root_note, song.scale_name, song.scale_mode) == (0, "Minor", True)
    r = _reply(emits)
    assert r["applied"] == 1
    assert r["reasons"].endswith("follow (2 new): C Major does not fit what is playing: wrote C Minor")
    assert settings.key_follow is True  # its own write is not a hand's
    assert song.undo == ["begin", "end"]


def test_what_was_playing_at_start_is_not_news(emits):
    bass, keys = StubTrack(_bass(), "bass"), StubTrack(_keys(), "key")
    song, comp, _settings, sched, _sess = _rig(emits, [bass, keys], following=True)
    comp.on_playing_change("tracks/0", "target")  # a highlight move, a rebind
    sched.run()
    assert emits == [] and (song.root_note, song.scale_name) == (0, "Major")


def test_a_stop_keeps_a_key_that_still_fits(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    emits.clear()
    keys.stop()
    comp.on_playing_change("tracks/1", "target")
    sched.run()
    r = _reply(emits)
    assert r["applied"] == 0 and (song.root_note, song.scale_name) == (0, "Minor")
    assert "follow (1 gone): " in r["reasons"] and song.undo == ["begin", "end"]


def test_everything_stopped_keeps_the_key(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    bass.stop()
    keys.stop()
    comp.on_playing_change("tracks/0", "target")
    sched.run()
    assert (song.root_note, song.scale_name) == (0, "Minor")
    assert _replies(emits)[-1]["band"] == "no-key"


def test_permute_octave_and_mute_steps_are_no_pass_at_all(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    emits.clear()
    clip = bass.clip_slots[0].clip
    clip.notes[1].pitch += 12       # an octave step
    clip.notes[2].mute = True       # a mute step
    comp.on_playing_change("tracks/0", CHANGE_NOTES)
    assert [ms for ms, _fn in sched.pending] == [EDIT_DELAY_MS]
    sched.run()
    assert emits == [] and song.undo == ["begin", "end"]


def test_an_edit_inside_the_key_keeps_it(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    bass.clip_slots[0].clip.notes[3].pitch = 43   # F -> G, still C minor
    comp.on_playing_change("tracks/0", CHANGE_NOTES)
    sched.run()
    assert (song.root_note, song.scale_name) == (0, "Minor")
    assert song.undo == ["begin", "end"]


def test_an_edit_outside_the_key_corrects_it(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    keys.clip_slots[0].clip.notes = [   # E major and A major now
        StubNote(64, 0.0, 4.0), StubNote(68, 0.0, 4.0), StubNote(71, 0.0, 4.0),
        StubNote(69, 4.0, 4.0), StubNote(73, 4.0, 4.0), StubNote(76, 4.0, 4.0),
    ]
    bass.clip_slots[0].clip.notes = [StubNote(40, 0.0, 4.0), StubNote(45, 4.0, 4.0)]
    comp.on_playing_change("tracks/0", CHANGE_NOTES)
    comp.on_playing_change("tracks/1", CHANGE_NOTES)
    sched.run()
    assert (song.root_note, song.scale_name) != (0, "Minor")
    assert "does not fit what is playing" in _replies(emits)[-1]["reasons"]


def test_a_new_take_is_analyzed_when_it_ends_not_while_it_records(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, keys, "tracks/1")
    sched.run()
    emits.clear()
    take = StubClip(_bass().notes, recording=True)
    _launch(comp, bass, "tracks/0", take)
    sched.run()
    assert emits == []                              # half a take: nothing yet
    take.is_recording = False
    comp.on_playing_change("tracks/0", "recorded")
    sched.run()
    r = _replies(emits)[-1]
    assert "1 new" in r["reasons"] and (song.root_note, song.scale_name) == (0, "Minor")


def test_a_stopped_take_is_not_a_new_loop(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, keys, "tracks/1")
    sched.run()
    key_before = (song.root_note, song.scale_name)
    take = StubClip(_bass().notes, recording=True)
    _launch(comp, bass, "tracks/0", take)
    sched.run()
    bass.stop()
    take.is_recording = False
    comp.on_playing_change("tracks/0", "target")
    sched.run()
    assert (song.root_note, song.scale_name) == key_before
    assert all("new" not in r["reasons"].rsplit("follow (", 1)[-1] for r in _replies(emits)[1:])


def test_a_track_deleted_above_moves_nothing(emits):
    """Clips are keyed by LOM identity, so shifted paths are not news."""
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    emits.clear()
    song.tracks = [StubTrack(None, "synth"), bass, keys]
    comp.on_playing_change("tracks/1", "target")
    sched.run()
    assert emits == []


def test_follow_off_schedules_nothing(emits):
    _song, comp, settings, sched, bass, _keys_track = _follow(emits)
    settings.key_follow = False
    _launch(comp, bass, "tracks/0")
    comp.on_playing_change("tracks/0", CHANGE_NOTES)
    assert sched.pending == []


def test_turning_follow_on_decides_at_once(emits):
    bass, keys = StubTrack(_bass(), "bass"), StubTrack(_keys(), "key")
    song, comp, settings, sched, _sess = _rig(emits, [bass, keys], following=False)
    comp.handle_set_follow((1,), None)
    assert settings.key_follow is True and len(sched.pending) == 1
    sched.run()
    assert (song.root_note, song.scale_name) == (0, "Minor")
    assert "follow (follow turned on" in _reply(emits)["reasons"]


def test_a_scheduler_that_refuses_once_does_not_kill_follow(emits):
    song, comp, _settings, sched, bass, keys = _follow(emits, scheduler=Scheduler(raise_first=1))
    _launch(comp, bass, "tracks/0")     # refused: logged, the lane is free again
    _launch(comp, keys, "tracks/1")
    sched.run()
    assert (song.root_note, song.scale_name) == (0, "Minor")


def test_disconnect_stops_follow(emits):
    _song, comp, _settings, sched, bass, _keys_track = _follow(emits)
    comp.disconnect()
    _launch(comp, bass, "tracks/0")
    assert sched.pending == []


# --- who set the key ----------------------------------------------------------

def _following_c_minor(emits):
    song, comp, settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    assert (song.root_note, song.scale_name) == (0, "Minor")
    return song, comp, settings, sched


def test_a_hand_in_live_turns_follow_off_a_tick_later(emits):
    song, _comp, settings, sched = _following_c_minor(emits)
    song.key_moves_in_live(9, "Minor")               # Live's chooser: no redo waiting
    assert settings.key_follow is True               # not decided inside the notification
    assert [ms for ms, _fn in sched.pending] == [CLASSIFY_DELAY_MS]
    sched.run()
    assert settings.key_follow is False


def test_a_hand_picking_the_key_from_before_follow_is_still_a_hand(emits):
    song, _comp, settings, sched = _following_c_minor(emits)
    song.key_moves_in_live(0, "Major")               # the pre-write key, chosen fresh
    sched.run()
    assert settings.key_follow is False


def test_lives_undo_and_redo_through_several_writes_keep_follow_on(emits):
    song, comp, settings, sched = _following_c_minor(emits)
    # A second write: a new take in E minor territory.
    comp._last_written = (7, "Major")
    song._root, song._scale = 7, "Major"
    song.key_moves_in_live(0, "Minor", can_redo=True)    # undo
    sched.run()
    song.key_moves_in_live(0, "Major", can_redo=True)    # undo, one write deeper
    sched.run()
    song.key_moves_in_live(0, "Minor", can_redo=True)    # redo, more waiting
    sched.run()
    song.key_moves_in_live(7, "Major", can_redo=False)   # the last redo: Follow's own key
    sched.run()
    assert settings.key_follow is True


def test_a_mode_only_change_is_not_a_hand(emits):
    song, _comp, settings, sched = _following_c_minor(emits)
    song.scale_mode = False
    song.fire()
    sched.run()
    assert settings.key_follow is True and sched.pending == []


def test_after_a_lock_and_re_enable_the_old_key_is_no_longer_follows(emits):
    """Once a hand took over, the key Follow wrote before is nobody's: a hand
    choosing it later, after Follow is back on, is a hand."""
    song, comp, settings, sched = _following_c_minor(emits)
    song.key_moves_in_live(9, "Minor")
    sched.run()
    assert settings.key_follow is False
    for track in song.tracks:
        track.stop()
    comp.handle_set_follow((1,), None)
    sched.run()                                        # nothing playing: no write
    assert (song.root_note, song.scale_name) == (9, "Minor")
    song.key_moves_in_live(0, "Minor")                 # the key Follow once wrote
    sched.run()
    assert settings.key_follow is False


def test_a_hand_change_is_read_before_a_pending_pass_can_write(emits):
    song, comp, settings, sched = _following_c_minor(emits)
    song.key_moves_in_live(9, "Minor")                 # classification pending
    new_melody = StubClip(_melody().notes)
    song.tracks.append(StubTrack(new_melody, "synth"))
    comp.on_playing_change("tracks/2", "target")       # a pass pending too
    passes = [fn for ms, fn in sched.pending if ms == FOLLOW_DELAY_MS]
    passes[0]()                                        # the pass runs first
    assert settings.key_follow is False
    assert (song.root_note, song.scale_name) == (9, "Minor")


def test_moving_a_loop_to_other_material_counts_as_a_new_loop(emits):
    """Loop markers decide what is heard: a loop moved to a section in another
    key is re-read and decided like a new loop."""
    song, comp, _settings, sched, bass, keys = _follow(emits)
    _launch(comp, bass, "tracks/0")
    _launch(comp, keys, "tracks/1")
    sched.run()
    clip = keys.clip_slots[0].clip
    clip.notes += [  # bars 3-4 of the clip: E major and A major chords
        StubNote(64, 8.0, 4.0), StubNote(68, 8.0, 4.0), StubNote(71, 8.0, 4.0),
        StubNote(69, 12.0, 4.0), StubNote(73, 12.0, 4.0), StubNote(76, 12.0, 4.0),
    ]
    clip.loop_start, clip.loop_end = 8.0, 16.0          # the playhead's edit listener fires
    bass.clip_slots[0].clip.notes = [StubNote(40, 0.0, 4.0), StubNote(45, 4.0, 4.0)]
    comp.on_playing_change("tracks/1", "target")
    comp.on_playing_change("tracks/0", CHANGE_NOTES)
    sched.run()
    last = _replies(emits)[-1]
    assert "1 re-looped" in last["reasons"]
    assert (song.root_note, song.scale_name) != (0, "Minor")
