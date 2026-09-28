"""NoteEditProbe — capability probe for by-ID MIDI note editing.

Purpose
-------

The clip-view-mirror plan (M4) wants to edit MIDI notes by stable
``note_id`` via ``apply_note_modifications`` / ``remove_notes_by_id`` /
``add_new_notes``, instead of the clear-and-rewrite path
``ClipNotesComponent.handle_transpose`` uses today
(``remove_notes_extended`` over the full span → ``add_new_notes``,
which destroys every ``note_id`` on every edit).

That clear-and-rewrite exists because the production docstring in
``ClipNotesComponent`` asserts (lines 59-61):

    ``MidiNote.pitch`` is read-only, and ``apply_note_modifications``
    requires a vector of in-place mutations keyed by ``note_id`` — it
    can't change pitch.

Permute (sibling Max4Live device, same Live 12 environment) flatly
contradicts the second clause: it reads ``get_all_notes_extended``,
sets ``note.pitch`` on the *parsed copies*, and calls
``apply_note_modifications(notes)`` — pitch changes, IDs preserved, in
production. The suspicion is that the Looping claim conflates "the live
C++ ``MidiNote`` handle's pitch is read-only" (true) with "the method
can't change pitch" (false — you submit a fresh payload keyed by id,
you never mutate the handle).

This probe answers the question empirically on the *Python* binding
(not Max's JSON bridge), because that's where M4 will actually run.

Questions answered
------------------

P1. Does ``get_all_notes_extended()`` actually expose ``note_id`` on
    the Python surface, and is it a real int (not a float-truncated
    value)?
P2. Does ``apply_note_modifications`` accept a payload that changes
    **pitch** keyed by ``note_id`` — and does the id survive?
P3. Do note ids survive an ``add_new_notes`` → re-read round-trip,
    and does ``add_new_notes`` return the new ids?
P4. Does ``remove_notes_by_id`` exist and delete by id?

The probe is **non-destructive**: it snapshots the focused clip's
notes up front and restores them exactly (clear-and-rewrite from the
snapshot) in a ``finally`` pass, so running it against a real clip
leaves the clip as it was found.

Shape
-----

One OSC address, ``/looping/probe/note_edit [clip_path]`` (empty
string ⇒ ``song.view.detail_clip``), routed to ``handle_note_edit``.
The handler runs all four sub-probes synchronously (note edits are
not async — unlike the browser load probe there's no settle delay to
wait on) and emits a single result line:

    /looping/probe/note_edit_result [clip_path, ok, detail]

``detail`` is a compact ``;``-joined report of each sub-probe's
verdict so the operator sees the whole picture in one packet.

This is a throwaway diagnostic, like ``BrowserProbe`` — no UI
consumer, not in ``backendScope``. Delete once M4's ADR records the
verdict, or keep as a Live-upgrade regression catch.

Injection points
----------------

Takes ``song`` and ``emit`` at construction. Tests drive
``handle_note_edit`` against a stub clip that mimics the real LOM's
``get_all_notes_extended`` / ``apply_note_modifications`` /
``add_new_notes`` / ``remove_notes_by_id`` grab-bag so the
scaffolding (arg parse, snapshot/restore, verdict assembly) is
exercised without Live. The empirical pitch/id verdicts only come
from a one-shot operator session inside Live.
"""

from __future__ import annotations

import logging
from typing import List, Optional, Tuple

try:  # pragma: no cover - real Live runtime only
    import Live  # type: ignore
    _MIDI_NOTE_SPEC = Live.Clip.MidiNoteSpecification
except Exception:  # pragma: no cover - tests run without Live
    Live = None  # type: ignore
    _MIDI_NOTE_SPEC = None

logger = logging.getLogger("looping")


# Exceptions every LOM touch must catch. TypeError covers
# Boost.Python.ArgumentError on torn-down handles (see
# ClipNotesComponent / project_live_lom_quirks memory).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)

NOTE_EDIT_ADDRESS = "/looping/probe/note_edit"
NOTE_EDIT_RESULT_ADDRESS = "/looping/probe/note_edit_result"

# Attributes we read off a note when snapshotting for non-destructive
# restore. Mirrors ClipNotesComponent's forwarded set so the restore
# rebuilds the clip faithfully.
_SNAPSHOT_ATTRS = (
    "pitch",
    "start_time",
    "duration",
    "velocity",
    "mute",
)


def _note_get(note, name, default=None):
    """Attribute-or-key read that works on both ``MidiNote`` and dict."""
    if isinstance(note, dict):
        return note.get(name, default)
    return getattr(note, name, default)


def _normalize_notes(raw):
    """Coerce a ``get_all_notes_extended`` return into a list.

    Live's Python surface returns a ``Clip.MidiNoteVector`` (iterable
    of ``MidiNote``). Test stubs may hand back a ``{"notes": [...]}``
    dict or a bare list. Return a plain list of whatever note objects
    came back, or ``None`` if unparseable.
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        inner = raw.get("notes")
        return list(inner) if inner is not None else None
    try:
        return list(raw)
    except TypeError:
        return None


class NoteEditProbe:
    """Drives by-id note-edit capability checks against a clip.

    Args:
        song: The Live ``Song``; ``song.view.detail_clip`` is the
            default target when ``clip_path`` is empty.
        emit: Callable ``(address, args)`` bound to the transport's
            ``send``; publishes ``NOTE_EDIT_RESULT_ADDRESS``.
        resolve_clip: Optional ``(clip_path) -> clip | None`` resolver.
            Defaults to a focused-clip lookup so the probe needs no
            path machinery to run; pass the real ``path_resolver``
            wrapper if a specific clip is wanted.
    """

    def __init__(self, song, emit, resolve_clip=None):
        self._song = song
        self._emit = emit
        self._resolve_clip = resolve_clip

    # --- handler ----------------------------------------------------------

    def handle_note_edit(self, args, source_addr):
        """``/looping/probe/note_edit [clip_path]`` entry point.

        Empty / missing ``clip_path`` ⇒ ``song.view.detail_clip``.
        Runs all four sub-probes and emits one result line.
        """
        clip_path = ""
        if args:
            try:
                clip_path = str(args[0])
            except Exception:  # pragma: no cover - defensive
                clip_path = ""

        clip = self._resolve(clip_path)
        if clip is None:
            self._emit_result(clip_path, 0, "no_clip (focus a MIDI clip)")
            return None

        if not self._is_midi(clip):
            self._emit_result(clip_path, 0, "not_midi_clip")
            return None

        # Snapshot for non-destructive restore. If we can't snapshot we
        # refuse to run — better no verdict than a mangled clip.
        snapshot = self._snapshot(clip)
        if snapshot is None:
            self._emit_result(clip_path, 0, "snapshot_failed")
            return None
        if len(snapshot) == 0:
            self._emit_result(
                clip_path, 0, "clip_empty (add at least one note first)",
            )
            return None

        verdicts: List[str] = []
        overall_ok = True
        try:
            # P0: read-only API introspection dumped to Log.txt. Doesn't
            # affect the verdict — it's how we learn the exact LOM types
            # so the write probes stop guessing. Runs first, before any
            # mutation.
            self._dump_note_api(clip)

            ok1, d1 = self._probe_note_id_present(clip)
            verdicts.append("P1_id_present=%s(%s)" % (_yn(ok1), d1))
            overall_ok = overall_ok and ok1

            ok2, d2 = self._probe_apply_pitch_by_id(clip)
            verdicts.append("P2_apply_pitch=%s(%s)" % (_yn(ok2), d2))
            overall_ok = overall_ok and ok2

            ok3, d3 = self._probe_add_returns_ids(clip)
            verdicts.append("P3_add_ids=%s(%s)" % (_yn(ok3), d3))
            overall_ok = overall_ok and ok3

            ok4, d4 = self._probe_remove_by_id(clip)
            verdicts.append("P4_remove_by_id=%s(%s)" % (_yn(ok4), d4))
            overall_ok = overall_ok and ok4
        except Exception as e:  # pragma: no cover - defensive
            verdicts.append("EXC=%s:%s" % (type(e).__name__, str(e)[:60]))
            overall_ok = False
        finally:
            restored = self._restore(clip, snapshot)
            verdicts.append("restore=%s" % _yn(restored))
            overall_ok = overall_ok and restored

        self._emit_result(clip_path, int(overall_ok), "; ".join(verdicts))
        return None

    # --- API introspection (read-only) ------------------------------------

    def _dump_note_api(self, clip) -> None:
        """Log the exact LOM note types to Log.txt. No writes.

        Two wrong guesses at the ``apply_note_modifications`` payload
        type cost two Live restarts. This dump answers, authoritatively
        and in one read-only run:

        - what type ``get_all_notes_extended()`` actually returns, and
          the type / attributes / a sample of the note objects inside;
        - the signature ``MidiNoteSpecification.__init__`` accepts
          (does it take ``note_id``? — P2 run 2 says no);
        - whatever ``apply_note_modifications.__doc__`` /
          ``__text_signature__`` reveals about its expected argument;
        - whether the read-back note objects are themselves writable
          (``note.pitch = x`` without raising) — the Permute-style
          read-mutate-writeback hinges on this.

        Everything is wrapped so a dump failure never blocks the probes.
        """
        log = logger.info
        log("NoteEditProbe DUMP === begin ===")

        # 1. Container + element types from a real read.
        try:
            raw = clip.get_all_notes_extended()
            log("DUMP gane() -> type=%s", type(raw).__name__)
            notes = _normalize_notes(raw)
            if notes:
                n0 = notes[0]
                log("DUMP note[0] type=%s class=%r",
                    type(n0).__name__, getattr(n0, "__class__", None))
                attrs = sorted(
                    a for a in dir(n0) if not a.startswith("__")
                )
                log("DUMP note[0] dir=%s", attrs)
                # Sample the field values so we see what's actually populated.
                sample = {}
                for a in ("note_id", "pitch", "start_time", "duration",
                          "velocity", "mute", "probability",
                          "velocity_deviation", "release_velocity"):
                    try:
                        sample[a] = getattr(n0, a)
                    except Exception as e:
                        sample[a] = "<raise %s>" % type(e).__name__
                log("DUMP note[0] values=%r", sample)
                # Is the read-back object writable in place?
                try:
                    cur = n0.pitch
                    n0.pitch = cur  # no-op assignment
                    log("DUMP note[0].pitch writable=YES (in-place ok)")
                except Exception as e:
                    log("DUMP note[0].pitch writable=NO (%s: %s)",
                        type(e).__name__, str(e)[:60])
        except Exception as e:
            log("DUMP gane() failed: %s: %s", type(e).__name__, str(e)[:80])

        # 2. MidiNoteSpecification constructor surface.
        try:
            spec_cls = _MIDI_NOTE_SPEC
            log("DUMP MidiNoteSpecification=%r", spec_cls)
            if spec_cls is not None and spec_cls is not dict:
                log("DUMP spec dir=%s",
                    sorted(a for a in dir(spec_cls)
                           if not a.startswith("__")))
                init = getattr(spec_cls, "__init__", None)
                log("DUMP spec.__init__ doc=%r",
                    getattr(init, "__doc__", None))
                log("DUMP spec.__doc__=%r",
                    str(getattr(spec_cls, "__doc__", ""))[:300])
                # Probe which kwargs the constructor accepts, one at a
                # time, without keeping any result (these are throwaway
                # objects, never added to the clip).
                for kw in ("note_id", "pitch", "start_time", "duration",
                           "velocity", "mute", "probability"):
                    base = dict(pitch=60, start_time=0.0, duration=0.25,
                                velocity=100.0)
                    if kw not in base:
                        base[kw] = 0
                    try:
                        spec_cls(**base)
                        log("DUMP spec accepts kwarg %r: YES", kw)
                    except Exception as e:
                        log("DUMP spec accepts kwarg %r: NO (%s)",
                            kw, type(e).__name__)
        except Exception as e:
            log("DUMP spec introspection failed: %s: %s",
                type(e).__name__, str(e)[:80])

        # 3. apply_note_modifications / get_notes_by_id signatures.
        for meth_name in ("apply_note_modifications", "get_notes_by_id",
                          "remove_notes_by_id", "add_new_notes"):
            try:
                meth = getattr(clip, meth_name, None)
                log("DUMP %s present=%s doc=%r",
                    meth_name, callable(meth),
                    str(getattr(meth, "__doc__", ""))[:200])
            except Exception as e:
                log("DUMP %s introspection failed: %s",
                    meth_name, type(e).__name__)

        log("NoteEditProbe DUMP === end ===")

    # --- sub-probes -------------------------------------------------------

    def _probe_note_id_present(self, clip) -> Tuple[bool, str]:
        """P1: read notes, confirm ``note_id`` is a real int."""
        notes = self._read(clip)
        if not notes:
            return False, "no_notes"
        first = notes[0]
        nid = _note_get(first, "note_id", None)
        if nid is None:
            return False, "note_id absent"
        # Live ids are ints that can exceed float32's 24-bit mantissa
        # over a long session — confirm we're seeing an int, not a
        # float-truncated value (the plan's decision-2 rationale).
        is_int = isinstance(nid, int) and not isinstance(nid, bool)
        return is_int, "id=%r type=%s" % (nid, type(nid).__name__)

    def _probe_apply_pitch_by_id(self, clip) -> Tuple[bool, str]:
        """P2: change the first note's pitch via apply_note_modifications.

        Run-2 finding: ``MidiNoteSpecification(note_id=...)`` is rejected
        — that class is for *new* notes, not modifications. So this run
        uses the **read-mutate-writeback** path Permute uses: read the
        notes Live returns, mutate the target object's ``pitch`` in
        place, and pass the read-back collection straight back to
        ``apply_note_modifications``. We pass the notes in the same form
        Live handed them to us, trying the most likely arg shapes in
        order and reporting exactly which (if any) worked.

        Shifts toward the middle of the range so we never clamp at 0/127.
        """
        raw = self._read_raw(clip)
        notes = _normalize_notes(raw)
        if not notes:
            return False, "no_notes"
        target = notes[0]
        nid = _note_get(target, "note_id", None)
        if nid is None:
            return False, "no id to key on"
        old_pitch = int(_note_get(target, "pitch", 60))
        new_pitch = old_pitch - 1 if old_pitch > 0 else old_pitch + 1

        # Mutate the read-back object in place. If the object's pitch is
        # read-only this raises — caught and reported, so we learn the
        # constraint rather than crash.
        try:
            target.pitch = new_pitch
        except _LOM_ERRORS as e:
            return False, "in-place pitch set raised %s:%s" % (
                type(e).__name__, str(e)[:45],
            )

        # Try the writeback in a few shapes, newest-API-first. Stop at
        # the first that doesn't raise; record which shape won.
        applied_via = None
        last_err = None
        for label, payload in (
            ("vector", raw),
            ("list", notes),
            ("dict", {"notes": notes}),
        ):
            try:
                clip.apply_note_modifications(payload)
                applied_via = label
                break
            except _LOM_ERRORS as e:
                last_err = "%s/%s:%s" % (
                    label, type(e).__name__, str(e)[:30],
                )
        if applied_via is None:
            return False, "apply raised (%s)" % last_err

        after = self._read(clip)
        if not after:
            return False, "re-read empty"
        match = _find_by_id(after, nid)
        if match is None:
            return False, "id %r vanished after apply" % nid
        got_pitch = int(_note_get(match, "pitch", -1))
        if got_pitch != new_pitch:
            return False, "applied via %s; pitch %d→%d but read %d" % (
                applied_via, old_pitch, new_pitch, got_pitch,
            )
        return True, "via %s; pitch %d→%d id stable" % (
            applied_via, old_pitch, new_pitch,
        )

    def _probe_add_returns_ids(self, clip) -> Tuple[bool, str]:
        """P3: add one note, confirm a real id comes back / is readable.

        Adds a single C4 note well past the existing material's end so
        it can't collide, captures whatever ``add_new_notes`` returns,
        then re-reads and confirms the new note carries a stable int
        id. The added note is removed again before returning (the
        snapshot restore would also catch it, but cleaning up here
        keeps each sub-probe independent).
        """
        before = self._read(clip)
        before_ids = {_note_get(n, "note_id", None) for n in (before or ())}

        # Park the probe note far to the right so it never overlaps.
        # Use the bare-tuple form ClipNotesComponent uses (proven to
        # work on the binding), not a dict wrapper.
        spec = self._make_add_spec(pitch=60, start=10000.0, dur=0.25, vel=100.0)
        try:
            ret = clip.add_new_notes((spec,))
        except _LOM_ERRORS as e:
            return False, "add raised %s:%s" % (
                type(e).__name__, str(e)[:50],
            )

        after = self._read(clip)
        if after is None:
            return False, "re-read failed"
        new_notes = [
            n for n in after
            if _note_get(n, "note_id", None) not in before_ids
        ]
        if len(new_notes) != 1:
            return False, "expected 1 new note, saw %d" % len(new_notes)
        new_id = _note_get(new_notes[0], "note_id", None)
        ret_desc = _describe_add_return(ret)

        # Clean up the probe note immediately.
        cleaned = self._try_remove_id(clip, new_id)
        is_int = isinstance(new_id, int) and not isinstance(new_id, bool)
        return is_int, "new_id=%r(%s) ret=%s cleanup=%s" % (
            new_id, type(new_id).__name__, ret_desc, _yn(cleaned),
        )

    def _probe_remove_by_id(self, clip) -> Tuple[bool, str]:
        """P4: confirm ``remove_notes_by_id`` exists and deletes by id.

        Adds a throwaway note, removes it by its id, confirms it's
        gone. Uses ``remove_notes_by_id`` specifically (not the
        extended-span remover the transpose path uses) because that's
        the surgical delete M4 needs.
        """
        remover = getattr(clip, "remove_notes_by_id", None)
        if not callable(remover):
            return False, "remove_notes_by_id absent"

        before = self._read(clip)
        before_ids = {_note_get(n, "note_id", None) for n in (before or ())}
        spec = self._make_add_spec(pitch=62, start=10001.0, dur=0.25, vel=100.0)
        try:
            clip.add_new_notes((spec,))
        except _LOM_ERRORS as e:
            return False, "setup add raised %s:%s" % (
                type(e).__name__, str(e)[:40],
            )
        mid = self._read(clip) or []
        added = [
            n for n in mid
            if _note_get(n, "note_id", None) not in before_ids
        ]
        if len(added) != 1:
            return False, "setup add saw %d new" % len(added)
        nid = _note_get(added[0], "note_id", None)

        try:
            remover([nid])
        except _LOM_ERRORS as e:
            return False, "remove raised %s:%s" % (
                type(e).__name__, str(e)[:50],
            )
        final = self._read(clip) or []
        still_there = _find_by_id(final, nid) is not None
        return (not still_there), (
            "id %r %s" % (nid, "still present!" if still_there else "removed")
        )

    # --- internals --------------------------------------------------------

    def _resolve(self, clip_path):
        if clip_path and self._resolve_clip is not None:
            try:
                return self._resolve_clip(clip_path)
            except Exception:  # pragma: no cover - defensive
                return None
        # Default: the focused clip.
        try:
            return self._song.view.detail_clip
        except _LOM_ERRORS:
            return None

    def _is_midi(self, clip) -> bool:
        try:
            return bool(clip.is_midi_clip)
        except _LOM_ERRORS:
            return False

    def _read_raw(self, clip):
        """Return the raw ``get_all_notes_extended()`` container, or None.

        P2's writeback needs the container in the *exact* form Live
        handed it back (the ``MidiNoteVector``), not a normalized list —
        the binding may only accept its own type. ``_read`` normalizes
        on top of this for everyone else.
        """
        try:
            return clip.get_all_notes_extended()
        except TypeError:
            # Older builds expose the arg-bearing form only; mirror
            # ClipNotesComponent's fallback.
            try:
                length = float(getattr(clip, "length", 0.0)) or float(1 << 14)
                return clip.get_all_notes_extended(0, 128, 0.0, length)
            except _LOM_ERRORS:
                return None
        except _LOM_ERRORS:
            return None

    def _read(self, clip):
        """Read notes, return a normalized list or ``None`` on raise."""
        return _normalize_notes(self._read_raw(clip))

    def _snapshot(self, clip) -> Optional[List[dict]]:
        notes = self._read(clip)
        if notes is None:
            return None
        snap = []
        for n in notes:
            snap.append({a: _note_get(n, a, None) for a in _SNAPSHOT_ATTRS})
        return snap

    def _restore(self, clip, snapshot) -> bool:
        """Rewrite the clip from the snapshot, fail-safe.

        ORDER MATTERS. The first version of this probe cleared the clip
        and *then* re-added — so when the re-add raised (it was passing
        dicts the binding rejects), the clip was left empty. A focused
        note actually vanished in testing (recovered via Live's undo).

        The fix: build every spec FIRST. Only if all specs build do we
        clear-and-rewrite. If spec-building raises, we never touch the
        clip — it keeps whatever notes it had, which is strictly safer
        than an empty clip. (Live's own undo is the final safety net,
        but we don't rely on it.)
        """
        try:
            specs = [
                self._make_add_spec(
                    pitch=int(n.get("pitch", 60) or 60),
                    start=float(n.get("start_time", 0.0) or 0.0),
                    dur=float(n.get("duration", 0.25) or 0.25),
                    vel=float(n.get("velocity", 100.0) or 100.0),
                    mute=bool(n.get("mute", False)),
                )
                for n in snapshot
            ]
        except _LOM_ERRORS as e:
            # Could not build the restore payload — leave the clip
            # untouched rather than risk emptying it.
            logger.warning(
                "NoteEditProbe: restore spec-build raised %s — clip left "
                "untouched (notes preserved)", e,
            )
            return False

        try:
            clip.remove_notes_extended(0, 128, -8192, 16384)
        except _LOM_ERRORS as e:
            logger.warning("NoteEditProbe: restore remove raised %s", e)
            return False
        try:
            clip.add_new_notes(tuple(specs))
        except _LOM_ERRORS as e:
            # Worst case: we cleared but couldn't re-add. Log loudly so
            # the operator knows to hit undo. With specs pre-built and
            # validated above, this should be unreachable in practice.
            logger.error(
                "NoteEditProbe: restore add raised %s AFTER clear — clip "
                "may be empty, use Live undo (Cmd-Z)", e,
            )
            return False
        return True

    def _try_remove_id(self, clip, nid) -> bool:
        remover = getattr(clip, "remove_notes_by_id", None)
        if not callable(remover):
            return False
        try:
            remover([nid])
            return True
        except _LOM_ERRORS:
            return False

    @staticmethod
    def _spec_class():
        """The ``MidiNoteSpecification`` class, or ``dict`` under tests.

        The direct Python binding's ``add_new_notes`` /
        ``apply_note_modifications`` reject plain dicts ("No registered
        converter ... from Python object of type str") — they require
        real ``Live.Clip.MidiNoteSpecification`` objects. (Permute gets
        away with dicts only because Max's ``LiveAPI.call`` serializes
        through a JSON bridge that Live re-hydrates; the in-process
        binding does no such conversion.) This mirrors
        ``ClipNotesComponent._build_spec`` exactly.
        """
        return _MIDI_NOTE_SPEC if _MIDI_NOTE_SPEC is not None else dict

    def _make_add_spec(self, pitch, start, dur, vel, mute=False):
        """A ``MidiNoteSpecification`` for add/modify, with id optional.

        Optional kwargs (probability / velocity_deviation /
        release_velocity) are omitted here — the probe only exercises
        the core five fields. Older Live builds that reject any kwarg
        would raise, which the caller turns into a sub-probe failure
        rather than a crash.
        """
        spec_cls = self._spec_class()
        return spec_cls(
            pitch=int(pitch),
            start_time=float(start),
            duration=float(dur),
            velocity=float(vel),
            mute=bool(mute),
        )

    def _make_modify_spec(self, note_id, pitch, start, dur, vel, mute=False):
        """A ``MidiNoteSpecification`` carrying ``note_id`` for modify.

        ``apply_note_modifications`` keys edits by ``note_id``; the spec
        must carry it. Under tests the factory is ``dict`` so the id is
        just a key.
        """
        spec_cls = self._spec_class()
        return spec_cls(
            note_id=int(note_id),
            pitch=int(pitch),
            start_time=float(start),
            duration=float(dur),
            velocity=float(vel),
            mute=bool(mute),
        )

    def _emit_result(self, clip_path, ok, detail):
        logger.info(
            "NoteEditProbe result: path=%s ok=%d detail=%s",
            clip_path or "<focus>", ok, detail,
        )
        self._emit(NOTE_EDIT_RESULT_ADDRESS, (clip_path, int(ok), detail))


# --- module helpers ------------------------------------------------------


def _yn(ok) -> str:
    return "Y" if ok else "N"


def _find_by_id(notes, nid):
    for n in notes:
        if _note_get(n, "note_id", None) == nid:
            return n
    return None


def _describe_add_return(ret) -> str:
    """Compact description of whatever ``add_new_notes`` returned.

    On Live's Python surface ``add_new_notes`` historically returned
    ``None`` (ids must be re-read), but newer builds may return a
    ``MidiNoteVector`` of the created notes. Capturing the shape tells
    M4 whether it can read ids straight off the return or must re-pull.
    """
    if ret is None:
        return "None"
    notes = _normalize_notes(ret)
    if notes is None:
        return type(ret).__name__
    ids = [_note_get(n, "note_id", None) for n in notes]
    return "%dnotes ids=%r" % (len(notes), ids[:3])
