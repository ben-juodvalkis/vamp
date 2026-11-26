"""Temperature (permute ADR-015): the Permute engine's note swap.

Split out of ``SequencerComponent`` (code review, 2026-11-25). Two halves:

- **Pure functions** over a clip's notes — the base model a variation
  starts from (:func:`build_base_model`), a base pitch with the engine's
  octave on it (:func:`shifted`), a note-id → pitch signature
  (:func:`pitch_signature`) and the own-write test that tells our write
  from a user's edit (:func:`is_external_change`). No LOM, no state; a
  note is a ``MidiNote`` or a dict with the same fields.
- :class:`TemperatureMixin`, the engine's temperature methods, which
  ``SequencerComponent`` inherits so every ``_temp_*`` name stays where
  callers and tests find it. They lean on the host's ``_read_notes``,
  ``_apply_notes``, ``_settle_pads``, ``_counters``, ``_rng`` and
  ``_warn_once``.

Import relatively (``from .sequencer_temperature import …``).
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

from . import sequencer_shuffle as shuffle

logger = logging.getLogger("looping")

MIDI_PITCH_MAX = 127
#: Note fields kept in the temperature base model so a return to 0
#: restores the whole note, not just its pitch (permute ADR-015).
BASE_MODEL_FIELDS = (
    "pitch", "start_time", "duration", "velocity", "mute",
    "probability", "velocity_deviation", "release_velocity",
)


def note_id(note) -> Optional[int]:
    nid = getattr(note, "note_id", None)
    if nid is None and isinstance(note, dict):
        nid = note.get("note_id")
    try:
        return int(nid) if nid is not None else None
    except (TypeError, ValueError):
        return None


def note_pitch(note) -> Optional[int]:
    p = getattr(note, "pitch", None)
    if p is None and isinstance(note, dict):
        p = note.get("pitch")
    try:
        return int(p) if p is not None else None
    except (TypeError, ValueError):
        return None


def build_base_model(vec, pitch_deltas: Dict[int, int], pitch_applied: bool) -> Dict[int, dict]:
    """note id → the note's :data:`BASE_MODEL_FIELDS`, its pitch the true
    base: the pitch sequencer's per-note octave (``pitch_deltas``, while
    ``pitch_applied``) taken off. Notes without an id or a pitch are left
    out."""
    model: Dict[int, dict] = {}
    for note in vec:
        nid = note_id(note)
        pitch = note_pitch(note)
        if nid is None or pitch is None:
            continue
        entry = {}
        for field in BASE_MODEL_FIELDS:
            v = getattr(note, field, None)
            if v is None and isinstance(note, dict):
                v = note.get(field)
            if v is not None:
                entry[field] = v
        entry["pitch"] = pitch - (pitch_deltas.get(nid, 0) if pitch_applied else 0)
        model[nid] = entry
    return model


def shifted(pitch_deltas: Dict[int, int], pitch_applied: bool, nid: int, base_pitch) -> int:
    """``base_pitch`` as it should read on the clip now: plus the octave the
    engine holds on note ``nid``, clamped to MIDI."""
    delta = pitch_deltas.get(nid, 0) if pitch_applied else 0
    return max(0, min(MIDI_PITCH_MAX, int(base_pitch) + delta))


def pitch_signature(vec) -> Dict[int, int]:
    """note id → pitch, for every note carrying both."""
    sig: Dict[int, int] = {}
    for note in vec:
        nid, pitch = note_id(note), note_pitch(note)
        if nid is not None and pitch is not None:
            sig[nid] = pitch
    return sig


def is_external_change(vec, expected: Optional[Dict[int, int]]) -> bool:
    """A different id set, or a note repitched away from what we last
    wrote (``expected``), is the user's; an exact match is our own write.
    With nothing written yet every change is the user's."""
    if expected is None:
        return True
    sig = pitch_signature(vec)
    if len(sig) != len(expected):
        return True
    for nid, pitch in sig.items():
        if nid not in expected or expected[nid] != pitch:
            return True
    return False


class TemperatureMixin:
    """The engine's temperature methods (see the module docstring)."""

    def _temperature(self, inst) -> float:
        try:
            return max(0.0, min(1.0, float(inst.values.get("temperature") or 0.0)))
        except (TypeError, ValueError):
            return 0.0

    def _on_temperature_changed(self, inst) -> None:
        """The slider moved: 0 → hot captures + varies, hot → 0 restores;
        a change while hot only shapes the next variation."""
        new = self._temperature(inst)
        was = inst.temperature_last
        inst.temperature_last = new
        if inst.pad_note is not None:
            return  # inert on a pad (ADR-435): one pitch has nothing to swap
        cs = inst.clip_state
        if cs is None or not cs.is_midi:
            return
        if was <= 0.0 < new:
            self._temp_enable(inst, cs)
        elif was > 0.0 >= new:
            self._temp_restore(inst, cs, with_octave=True)

    def _temp_start(self, inst) -> None:
        """Transport start / clip arrival with a hot slider: capture the
        clip (if not yet) and write a variation."""
        inst.temperature_last = self._temperature(inst)
        cs = inst.clip_state
        if inst.pad_note is not None or cs is None or not cs.is_midi or inst.temperature_last <= 0.0:
            return
        self._temp_enable(inst, cs)

    def _temp_enable(self, inst, cs) -> None:
        if cs.base_model is None:
            vec = self._read_notes(inst, cs.clip)
            if vec is None:
                return
            cs.base_model = self._build_base_model(cs, vec)
            cs.expected = None
            self._temp_attach(inst, cs)
        self._temp_variation(inst, cs)

    def _temp_variation(self, inst, cs) -> None:
        """A fresh variation from the base: every known note back to its
        base pitch (plus its octave), then a new swap over those only."""
        temperature = self._temperature(inst)
        if cs.base_model is None or temperature <= 0.0:
            return
        vec = self._read_notes(inst, cs.clip)
        if vec is None:
            return
        prev = self._pitch_signature(vec)
        base_notes = []
        for note in vec:
            nid = self._note_id(note)
            base = cs.base_model.get(nid) if nid is not None else None
            if base is None:
                continue  # an overdub not yet folded in: never swapped
            note.pitch = self._shifted(cs, nid, base["pitch"])
            base_notes.append(note)
        pattern = shuffle.generate_swap_pattern(base_notes, temperature, self._rng)
        shuffle.apply_swap_pattern(base_notes, pattern)
        self._settle_pads(inst, cs, vec, prev)
        if self._apply_notes(inst, cs, vec):
            self._counters["temp_variations"] += 1

    def _temp_restore(self, inst, cs, with_octave: bool = True) -> None:
        """Rewrite the base model verbatim (its octave kept while a pitch
        step holds it, unless ``with_octave`` is False — the stop path,
        which puts back the true base) and drop the model."""
        self._temp_detach(cs)
        model, cs.base_model, cs.expected = cs.base_model, None, None
        cs.temp_variation_pending = False
        cs.temp_notes_changed = False
        if not model:
            return
        vec = self._read_notes(inst, cs.clip)
        if vec is None:
            return
        prev = self._pitch_signature(vec)
        changed = False
        for note in vec:
            nid = self._note_id(note)
            base = model.get(nid) if nid is not None else None
            if base is None:
                continue
            target = self._shifted(cs, nid, base["pitch"]) if with_octave else int(base["pitch"])
            if self._note_pitch(note) != target:
                note.pitch = target
                changed = True
        if self._settle_pads(inst, cs, vec, prev):
            changed = True
        if changed and not self._apply_notes(inst, cs, vec):
            return
        if not with_octave:
            cs.pitch_deltas = {}
            cs.pitch_applied = False
            cs.pitch_shift = 0

    def _service_temperature(self, inst) -> None:
        """Deferred halves of the clip observers (they fire in a
        notification): a loop jump → a fresh variation; a ``notes``
        change → tell our own write from a user edit by content."""
        cs = inst.clip_state
        if cs is None or cs.base_model is None:
            return
        if self._temperature(inst) <= 0.0:
            return
        if cs.temp_notes_changed:
            cs.temp_notes_changed = False
            vec = self._read_notes(inst, cs.clip)
            if vec is not None and self._is_external_change(vec, cs.expected):
                self._temp_rebaseline(inst, cs, vec)
                cs.temp_variation_pending = False
                return
        if cs.temp_variation_pending:
            cs.temp_variation_pending = False
            self._temp_variation(inst, cs)

    def _temp_rebaseline(self, inst, cs, vec) -> None:
        """The user edited the clip while hot: untouched notes (still at
        the pitch our last swap left them) go back to base first, the
        edited and added notes define the new composition, then a fresh
        variation keeps playback hot."""
        expected = cs.expected or {}
        model = cs.base_model or {}
        for note in vec:
            nid = self._note_id(note)
            if nid is None:
                continue
            base = model.get(nid)
            exp = expected.get(nid)
            if base is not None and exp is not None and self._note_pitch(note) == exp:
                note.pitch = self._shifted(cs, nid, base["pitch"])
        cs.base_model = self._build_base_model(cs, vec)
        cs.expected = None
        self._counters["temp_rebaselines"] += 1
        logger.debug("SequencerComponent: %s re-baselined from a user edit", inst.device_path)
        self._temp_variation(inst, cs)









    def _temp_attach(self, inst, cs) -> None:
        clip = cs.clip

        def _on_loop_jump(cs=cs):
            cs.temp_variation_pending = True

        def _on_notes(cs=cs):
            cs.temp_notes_changed = True

        for attr, cb in (("loop_jump", _on_loop_jump), ("notes", _on_notes)):
            cs.temp_listeners.add(
                clip, attr, cb,
                on_error=lambda e, attr=attr: self._warn_once(
                    inst.device_path, "temp:" + attr, "add_%s_listener raised: %s" % (attr, e),
                ),
                on_missing=lambda attr=attr: self._warn_once(
                    inst.device_path, "temp:" + attr, "clip has no add_%s_listener" % attr,
                ),
            )

    def _temp_detach(self, cs) -> None:
        cs.temp_listeners.clear()

    def _build_base_model(self, cs, vec) -> Dict[int, dict]:
        return build_base_model(vec, cs.pitch_deltas, cs.pitch_applied)

    @staticmethod
    def _shifted(cs, nid: int, base_pitch) -> int:
        """A base pitch as it should read on the clip now: plus the octave
        this engine holds on that note, clamped to MIDI."""
        return shifted(cs.pitch_deltas, cs.pitch_applied, nid, base_pitch)

    @staticmethod
    def _pitch_signature(vec) -> Dict[int, int]:
        return pitch_signature(vec)

    @staticmethod
    def _is_external_change(vec, expected: Optional[Dict[int, int]]) -> bool:
        return is_external_change(vec, expected)
