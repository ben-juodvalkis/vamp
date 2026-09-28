"""NoteEditProbe unit tests.

The real verdict (does apply_note_modifications change pitch keyed by
note_id on Live 12's Python binding?) can only come from a one-shot
session inside Live — ``Live.Clip`` isn't importable outside the host.
What pytest *can* cover is the probe's scaffolding: arg parse, the
focus/path resolve, MIDI/empty guards, the non-destructive
snapshot+restore, and the four-sub-probe verdict assembly.

The stub clip below models the LOM contract the probe assumes:

- ``get_all_notes_extended()`` returns a list of note objects each
  carrying a real int ``note_id``.
- The note objects expose a **read-only** ``pitch`` (assignment
  raises) — this is the production reality the probe's whole reason
  for existing is built around. Editing therefore *must* go through
  ``apply_note_modifications`` keyed by id, never by mutating the
  handle.
- ``apply_note_modifications({"notes": [...]})`` updates fields by id,
  preserving the id. This is the behaviour we expect Live to have and
  Permute proves it does — modeling it lets the happy-path verdict
  ("PASS, pitch changed, id stable") be asserted.
- ``add_new_notes`` mints a fresh id and returns None (the historical
  Live shape; the probe re-reads to find the id).
- ``remove_notes_by_id`` deletes by id.
"""

from __future__ import annotations

import pytest

from components.NoteEditProbe import (
    NoteEditProbe,
    NOTE_EDIT_RESULT_ADDRESS,
    _find_by_id,
    _normalize_notes,
)


# --- stubs -----------------------------------------------------------------


def _stub_get(obj, name, default=None):
    """Read ``name`` off an object or dict (mods may be either form)."""
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)



class StubNote:
    """A writable note, modeling the read-mutate-writeback contract.

    Run-2 against real Live established that ``MidiNoteSpecification``
    can't carry ``note_id`` (it's for *new* notes), so the modify path
    is: read the notes Live returns, mutate the returned object's
    fields, pass them back to ``apply_note_modifications``. This stub
    therefore exposes plain writable attributes — ``pitch`` included.

    ``_pitch`` mirrors ``pitch`` only so existing tests that read
    ``clip._notes[i]._pitch`` keep working; both stay in sync.
    """

    def __init__(self, note_id, pitch, start=0.0, dur=0.25, vel=100.0,
                 mute=False):
        self.note_id = note_id
        self.pitch = pitch
        self.start_time = start
        self.duration = dur
        self.velocity = vel
        self.mute = mute

    @property
    def _pitch(self):
        return self.pitch


class StubClip:
    """LOM ``Clip`` stand-in modeling the by-id note-edit contract."""

    def __init__(self, notes=None, is_midi=True, length=4.0,
                 has_remove_by_id=True):
        self.is_midi_clip = is_midi
        self.length = length
        self._notes = list(notes or ())
        self._next_id = 1000
        self.calls = []  # method-name log for assertions
        if not has_remove_by_id:
            # Model a Live version that genuinely lacks the method by
            # deleting it off the instance — the probe's getattr/callable
            # check must see it as absent, not raise from a present-but-
            # broken method (that would test a different branch).
            self.remove_notes_by_id = None

    def get_all_notes_extended(self):
        self.calls.append("get_all_notes_extended")
        # Return fresh wrappers each read, like the real LOM — so a
        # caller's in-place mutation only persists once passed back to
        # apply_note_modifications.
        return [
            StubNote(n.note_id, n.pitch, n.start_time, n.duration,
                     n.velocity, n.mute)
            for n in self._notes
        ]

    def apply_note_modifications(self, payload):
        self.calls.append("apply_note_modifications")
        mods = payload["notes"] if isinstance(payload, dict) else payload
        by_id = {n.note_id: n for n in self._notes}
        for mod in mods:
            nid = _stub_get(mod, "note_id")
            target = by_id.get(nid)
            if target is None:
                raise RuntimeError("unknown note_id %r" % nid)
            # Commit the (possibly-mutated) read-back object's fields by
            # id, preserving identity — pitch included.
            target.pitch = int(_stub_get(mod, "pitch", target.pitch))
            target.start_time = _stub_get(mod, "start_time", target.start_time)
            target.duration = _stub_get(mod, "duration", target.duration)
            target.velocity = _stub_get(mod, "velocity", target.velocity)
            target.mute = _stub_get(mod, "mute", target.mute)

    def add_new_notes(self, payload):
        self.calls.append("add_new_notes")
        # The probe passes a bare tuple of specs (the form
        # ClipNotesComponent uses); restore-from-snapshot also uses a
        # tuple. Accept the {"notes": [...]} wrapper too for robustness.
        specs = payload["notes"] if isinstance(payload, dict) else payload
        for spec in specs:
            self._next_id += 1
            self._notes.append(StubNote(
                self._next_id,
                int(spec["pitch"]),
                float(spec.get("start_time", 0.0)),
                float(spec.get("duration", 0.25)),
                float(spec.get("velocity", 100.0)),
                bool(spec.get("mute", False)),
            ))
        return None  # historical Live shape

    def remove_notes_by_id(self, ids):
        self.calls.append("remove_notes_by_id")
        idset = set(ids)
        self._notes = [n for n in self._notes if n.note_id not in idset]

    def remove_notes_extended(self, from_pitch, pitch_span, from_time,
                              time_span):
        self.calls.append("remove_notes_extended")
        self._notes = []


class StubView:
    def __init__(self, clip):
        self.detail_clip = clip


class StubSong:
    def __init__(self, clip):
        self.view = StubView(clip)


def _make_probe(clip):
    captured = {}

    def emit(address, args):
        captured["address"] = address
        captured["args"] = args

    probe = NoteEditProbe(song=StubSong(clip), emit=emit)
    return probe, captured


def _result(captured):
    """Return (clip_path, ok, detail) from a captured emit."""
    assert captured["address"] == NOTE_EDIT_RESULT_ADDRESS
    return captured["args"]


# --- module-helper tests ---------------------------------------------------


def test_normalize_notes_accepts_list_dict_and_none():
    assert _normalize_notes(None) is None
    assert _normalize_notes([1, 2]) == [1, 2]
    assert _normalize_notes({"notes": [3, 4]}) == [3, 4]
    assert _normalize_notes({"other": 1}) is None


def test_find_by_id_matches_objects_and_dicts():
    notes = [StubNote(7, 60), StubNote(8, 62)]
    assert _find_by_id(notes, 8).note_id == 8
    assert _find_by_id(notes, 99) is None
    dict_notes = [{"note_id": 7, "pitch": 60}]
    assert _find_by_id(dict_notes, 7)["pitch"] == 60


# --- guard tests -----------------------------------------------------------


def test_no_clip_reports_no_clip():
    probe, captured = _make_probe(None)
    probe.handle_note_edit([""], None)
    _path, ok, detail = _result(captured)
    assert ok == 0
    assert "no_clip" in detail


def test_audio_clip_rejected():
    clip = StubClip(is_midi=False)
    probe, captured = _make_probe(clip)
    probe.handle_note_edit([""], None)
    _path, ok, detail = _result(captured)
    assert ok == 0
    assert "not_midi" in detail


def test_empty_clip_reports_empty():
    clip = StubClip(notes=[])
    probe, captured = _make_probe(clip)
    probe.handle_note_edit([""], None)
    _path, ok, detail = _result(captured)
    assert ok == 0
    assert "clip_empty" in detail


# --- happy path: the verdict that matters ----------------------------------


def test_full_run_passes_and_reports_each_subprobe():
    clip = StubClip(notes=[
        StubNote(101, 60),
        StubNote(102, 64),
        StubNote(103, 67),
    ])
    probe, captured = _make_probe(clip)
    probe.handle_note_edit([""], None)
    _path, ok, detail = _result(captured)

    assert ok == 1, detail
    # All four sub-probes plus restore should be reported and Y.
    assert "P1_id_present=Y" in detail
    assert "P2_apply_pitch=Y" in detail
    assert "P3_add_ids=Y" in detail
    assert "P4_remove_by_id=Y" in detail
    assert "restore=Y" in detail


def test_apply_pitch_changes_pitch_keyed_by_id():
    """The core claim: pitch IS editable via read-mutate-writeback."""
    clip = StubClip(notes=[StubNote(201, 60)])
    probe, _captured = _make_probe(clip)
    ok, detail = probe._probe_apply_pitch_by_id(clip)
    assert ok, detail
    # Reports which writeback shape worked, and pitch moved id-stable.
    assert "via" in detail
    assert clip._notes[0].note_id == 201
    assert clip._notes[0].pitch == 59  # shifted down by 1


def test_dump_note_api_runs_without_raising():
    """The read-only API dump must never raise, even with no Live."""
    clip = StubClip(notes=[StubNote(301, 60)])
    probe, _captured = _make_probe(clip)
    # _MIDI_NOTE_SPEC is None under tests; dump must handle that gracefully.
    probe._dump_note_api(clip)  # no assertion — just must not raise


def test_dump_does_not_mutate_clip():
    """The dump is read-only — clip contents unchanged after it runs."""
    clip = StubClip(notes=[StubNote(401, 60), StubNote(402, 64)])
    probe, _captured = _make_probe(clip)
    before = [(n.note_id, n.pitch) for n in clip._notes]
    probe._dump_note_api(clip)
    after = [(n.note_id, n.pitch) for n in clip._notes]
    assert before == after


def test_add_returns_readable_stable_int_id():
    clip = StubClip(notes=[StubNote(301, 60)])
    probe, _captured = _make_probe(clip)
    ok, detail = probe._probe_add_returns_ids(clip)
    assert ok, detail
    # Probe cleans up its own added note, leaving the original.
    assert [n.note_id for n in clip._notes] == [301]


def test_remove_by_id_deletes_the_note():
    clip = StubClip(notes=[StubNote(401, 60)])
    probe, _captured = _make_probe(clip)
    ok, detail = probe._probe_remove_by_id(clip)
    assert ok, detail
    # The throwaway note the sub-probe added is gone; original remains.
    assert [n.note_id for n in clip._notes] == [401]


def test_remove_by_id_absent_is_reported_not_crashed():
    clip = StubClip(notes=[StubNote(501, 60)], has_remove_by_id=False)
    probe, _captured = _make_probe(clip)
    ok, detail = probe._probe_remove_by_id(clip)
    assert not ok
    assert "absent" in detail


# --- non-destructive restore -----------------------------------------------


def test_clip_is_restored_to_original_pitches_after_run():
    original = [(601, 60), (602, 64), (603, 67)]
    clip = StubClip(notes=[StubNote(nid, p) for nid, p in original])
    probe, _captured = _make_probe(clip)
    probe.handle_note_edit([""], None)

    # Ids change on restore (clear-and-rewrite) but the musical content
    # — pitch set and count — must match what we started with.
    final_pitches = sorted(n._pitch for n in clip._notes)
    assert final_pitches == sorted(p for _nid, p in original)
    assert len(clip._notes) == len(original)


def test_restore_never_clears_clip_when_spec_build_fails(monkeypatch):
    """The exact bug that ate a note: a failed restore must NOT empty.

    If spec-building raises, the clip must be left untouched — never
    cleared-then-failed-to-readd. This is the structural guarantee the
    fail-safe restore provides (build all specs BEFORE the clear).
    """
    original = [(701, 60), (702, 64)]
    clip = StubClip(notes=[StubNote(nid, p) for nid, p in original])
    probe, _captured = _make_probe(clip)

    # Force spec-building to raise the way the real binding did when fed
    # the wrong type (RuntimeError stands in for Boost ArgumentError).
    def boom(*_a, **_k):
        raise RuntimeError("no registered converter")

    monkeypatch.setattr(probe, "_make_add_spec", boom)

    ok = probe._restore(clip, [
        {"pitch": p, "start_time": 0.0, "duration": 0.25, "velocity": 100.0,
         "mute": False}
        for _nid, p in original
    ])

    assert ok is False
    # Crucially: the clip still has its original notes — remove_notes_extended
    # was never called.
    assert "remove_notes_extended" not in clip.calls
    assert sorted(n._pitch for n in clip._notes) == sorted(
        p for _nid, p in original
    )
