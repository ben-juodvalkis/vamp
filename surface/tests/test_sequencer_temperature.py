"""Temperature's pure half (permute ADR-015): the base model, the octave on
a base pitch, the pitch signature and the own-write test."""

from types import SimpleNamespace

from components.sequencer_temperature import (
    BASE_MODEL_FIELDS,
    build_base_model,
    is_external_change,
    pitch_signature,
    shifted,
)


def _note(nid, pitch, **kw):
    return SimpleNamespace(note_id=nid, pitch=pitch, start_time=kw.get("start", 0.0),
                           duration=0.25, velocity=100.0, mute=False)


def test_base_model_takes_the_held_octave_off():
    vec = [_note(1, 72), _note(2, 50)]
    model = build_base_model(vec, {1: 12}, pitch_applied=True)
    assert model[1]["pitch"] == 60 and model[2]["pitch"] == 50
    assert set(model[1]) <= set(BASE_MODEL_FIELDS)
    assert build_base_model(vec, {1: 12}, pitch_applied=False)[1]["pitch"] == 72


def test_base_model_reads_dict_notes_and_skips_notes_without_an_id():
    vec = [{"note_id": 3, "pitch": 40, "velocity": 90.0}, {"pitch": 41}, SimpleNamespace(note_id=None, pitch=1)]
    assert build_base_model(vec, {}, False) == {3: {"pitch": 40, "velocity": 90.0}}


def test_shifted_adds_the_octave_and_clamps_to_midi():
    assert shifted({1: 12}, True, 1, 60) == 72
    assert shifted({1: 12}, False, 1, 60) == 60
    assert shifted({1: 12}, True, 1, 120) == 127
    assert shifted({}, True, 1, -3) == 0


def test_pitch_signature_and_the_own_write_test():
    vec = [_note(1, 60), _note(2, 62)]
    assert pitch_signature(vec) == {1: 60, 2: 62}
    assert is_external_change(vec, None) is True                 # nothing written yet
    assert is_external_change(vec, {1: 60, 2: 62}) is False      # exactly our write
    assert is_external_change(vec, {1: 60, 2: 64}) is True       # repitched away from it
    assert is_external_change(vec, {1: 60}) is True              # a note added
    assert is_external_change(vec, {1: 60, 3: 62}) is True       # a different id set
