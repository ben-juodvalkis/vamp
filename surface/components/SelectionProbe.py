"""SelectionProbe — capability probe for bidirectional note selection.

Purpose
-------

The clip-view-mirror wants note selection to round-trip: tapping a note
in the editor selects it in Live's piano roll, and Live's own selection
reflects back into the editor. That needs a LOM surface for note
selection on the focused clip — most likely ``Clip.View`` (the per-clip
view object, distinct from ``song.view``). Before designing a wire for
it (a select write + a selection listener + echo handling), confirm
empirically what Live 12.4 actually exposes.

This is a **read-only introspection probe** — it does NOT mutate the
clip's notes or its selection. It dumps the relevant LOM surfaces to
``Log.txt`` and returns a compact verdict so we can decide the wire
shape from facts, not docs. Mirrors NoteEditProbe's shape (one OSC
address, ephemeral-port reply) but answers different questions.

Questions answered
------------------

Q1. Does the focused clip expose a ``view`` object, and what selection-
    related attributes/methods does it carry? (``selected_notes``,
    ``select_notes_by_id``, ``selected_notes_changed`` listener, etc.)
Q2. What does reading the current selection return — a vector of
    MidiNote? IDs? Empty when nothing selected?
Q3. Is there a selection-changed listener to attach (the Surf→UI half
    of a round-trip)? Check ``add_selected_notes_listener`` /
    ``add_..._has_listener`` shapes on the clip view.
Q4. Is there a by-id select call (the UI→Surf half)?

Shape
-----

One OSC address ``/looping/probe/selection [clip_path]`` (empty ⇒
``song.view.detail_clip``) → ``/looping/probe/selection_result
[clip_path, ok, detail]``. ``ok=1`` means "a usable selection surface
was found"; ``detail`` is a ``;``-joined report of each question.

Throwaway, like NoteEditProbe — no UI consumer, not in backendScope.
Delete once the selection-sync milestone records its verdict.
"""

from __future__ import annotations

import logging
from typing import Tuple

logger = logging.getLogger("looping")

_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)

SELECTION_ADDRESS = "/looping/probe/selection"
SELECTION_RESULT_ADDRESS = "/looping/probe/selection_result"

# Selection-related names we hunt for on the clip and its view object.
_CANDIDATE_VIEW_ATTRS = (
    "selected_notes",
    "select_notes_by_id",
    "select_all_notes",
    "selected_notes_changed",
    "add_selected_notes_listener",
    "remove_selected_notes_listener",
    "selected_notes_has_listener",
)
_CANDIDATE_CLIP_ATTRS = (
    "view",
    "get_selected_notes_extended",
    "selected_notes",
)


def _present(obj, name) -> str:
    """Return a compact presence/type tag for ``obj.name`` without calling."""
    try:
        val = getattr(obj, name)
    except _LOM_ERRORS as e:
        return "<raise %s>" % type(e).__name__
    if callable(val):
        return "method"
    return "attr:%s" % type(val).__name__


class SelectionProbe:
    """Read-only introspection of the note-selection LOM surface."""

    def __init__(self, song, emit, resolve_clip=None):
        self._song = song
        self._emit = emit
        self._resolve_clip = resolve_clip

    def handle_selection_probe(self, args, source_addr):
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

        verdicts = []
        ok = False
        try:
            ok = self._dump_and_verdict(clip, verdicts)
        except Exception as e:  # pragma: no cover - defensive
            verdicts.append("EXC=%s:%s" % (type(e).__name__, str(e)[:60]))
            ok = False

        self._emit_result(clip_path, int(ok), "; ".join(verdicts))
        return None

    def _dump_and_verdict(self, clip, verdicts) -> bool:
        log = logger.info
        log("SelectionProbe DUMP === begin ===")

        # Q1: clip-level selection surface.
        clip_hits = {}
        for name in _CANDIDATE_CLIP_ATTRS:
            tag = _present(clip, name)
            clip_hits[name] = tag
            log("DUMP clip.%s -> %s", name, tag)
        verdicts.append(
            "clip:" + ",".join(
                "%s=%s" % (n, clip_hits[n]) for n in _CANDIDATE_CLIP_ATTRS
            )
        )

        # Full clip dir, filtered for anything select/note-ish — the
        # write counterpart to get_selected_notes_extended (if any) lives
        # on Clip, not Clip.View (the view dir had no note selection).
        try:
            clip_dir = sorted(a for a in dir(clip) if not a.startswith("__"))
            clip_selectish = [
                a for a in clip_dir
                if "select" in a.lower()
            ]
            log("DUMP clip selection-ish=%s", clip_selectish)
            # Also report notes-extended family + apply (the edit surface
            # that might accept a selection flag).
            notes_family = [
                a for a in clip_dir
                if "note" in a.lower()
            ]
            log("DUMP clip notes-family=%s", notes_family)
            verdicts.append("clip_selectish=%s" % (clip_selectish,))
        except _LOM_ERRORS as e:
            log("DUMP clip dir raised %s", type(e).__name__)

        # Q1/Q3/Q4: the clip view object.
        view = None
        try:
            view = clip.view
        except _LOM_ERRORS as e:
            verdicts.append("clip.view=<raise %s>" % type(e).__name__)
        if view is not None:
            log("DUMP clip.view type=%s", type(view).__name__)
            full_dir = sorted(
                a for a in dir(view)
                if not a.startswith("__")
            )
            log("DUMP clip.view dir=%s", full_dir)
            # Anything with 'select' or 'note' in the name is interesting.
            interesting = [
                a for a in full_dir
                if "select" in a.lower() or "note" in a.lower()
            ]
            log("DUMP clip.view selection-ish=%s", interesting)
            view_hits = {}
            for name in _CANDIDATE_VIEW_ATTRS:
                tag = _present(view, name)
                view_hits[name] = tag
                log("DUMP clip.view.%s -> %s", name, tag)
            verdicts.append(
                "view:" + ",".join(
                    "%s=%s" % (n, view_hits[n])
                    for n in _CANDIDATE_VIEW_ATTRS
                )
            )
            verdicts.append("view_selectish=%s" % (interesting,))

            # Q2: read current selection (read-only) if exposed.
            for reader in ("selected_notes",):
                try:
                    cur = getattr(view, reader, None)
                    if cur is not None:
                        as_list = list(cur)
                        log(
                            "DUMP clip.view.%s -> %d notes (type=%s)",
                            reader, len(as_list), type(cur).__name__,
                        )
                        if as_list:
                            n0 = as_list[0]
                            log(
                                "DUMP selected[0] note_id=%r pitch=%r",
                                getattr(n0, "note_id", "<none>"),
                                getattr(n0, "pitch", "<none>"),
                            )
                        verdicts.append(
                            "selected_count=%d" % len(as_list)
                        )
                except _LOM_ERRORS as e:
                    log("DUMP read %s raised %s", reader, type(e).__name__)

        log("SelectionProbe DUMP === end ===")

        # Verdict: usable if the view exposes any select-ish surface.
        usable = view is not None and any(
            "select" in a.lower() for a in interesting
        ) if view is not None else False
        return usable

    def _resolve(self, clip_path):
        if clip_path and self._resolve_clip is not None:
            try:
                return self._resolve_clip(clip_path)
            except Exception:  # pragma: no cover - defensive
                return None
        try:
            return self._song.view.detail_clip
        except _LOM_ERRORS:
            return None

    def _is_midi(self, clip) -> bool:
        try:
            return bool(clip.is_midi_clip)
        except _LOM_ERRORS:
            return False

    def _emit_result(self, clip_path, ok, detail):
        logger.info(
            "SelectionProbe result: path=%s ok=%d detail=%s",
            clip_path or "<focus>", ok, detail,
        )
        self._emit(SELECTION_RESULT_ADDRESS, (clip_path, int(ok), detail))
