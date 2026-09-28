"""sequencer_shuffle — the ported temperature swap pattern (permute ADR-020)."""

from __future__ import annotations

import random

from components import sequencer_shuffle as sh


def notes(pitches, starts=None):
    starts = starts or list(range(len(pitches)))
    return [{"pitch": p, "start_time": float(s), "note_id": i + 1} for i, (p, s) in enumerate(zip(pitches, starts))]


def test_fisher_yates_is_a_permutation_and_reproducible():
    items = list(range(10))
    a = sh.fisher_yates_shuffle(items, random.Random(7))
    b = sh.fisher_yates_shuffle(items, random.Random(7))
    assert sorted(a) == items and a == b and a != items


def test_no_pattern_below_two_notes():
    assert sh.generate_swap_pattern([], 1.0) == []
    assert sh.generate_swap_pattern(notes([60]), 1.0) == []


def test_any_temperature_above_zero_forms_at_least_one_group():
    for seed in range(40):
        pattern = sh.generate_swap_pattern(notes([60, 62, 64, 65, 67]), 0.05, random.Random(seed))
        assert pattern, seed
        assert all(len(g["indices"]) >= 2 for g in pattern)


def test_groups_never_overlap_and_are_temporally_adjacent():
    ns = notes([60, 62, 64, 65, 67, 69, 71, 72], starts=[3, 0, 1, 2, 7, 4, 5, 6])
    order = sorted(range(len(ns)), key=lambda i: ns[i]["start_time"])
    for seed in range(30):
        pattern = sh.generate_swap_pattern(ns, 1.0, random.Random(seed))
        seen = set()
        for g in pattern:
            idx = g["indices"]
            assert not (seen & set(idx))
            seen |= set(idx)
            positions = sorted(order.index(i) for i in idx)
            assert positions == list(range(positions[0], positions[0] + len(positions)))
            assert sorted(g["shuffled"]) == sorted(idx)


def test_group_sizes_follow_the_temperature_bands():
    ns = notes(list(range(60, 84)))
    cold = sh.generate_swap_pattern(ns, 0.2, random.Random(1))
    assert all(len(g["indices"]) == 2 for g in cold)
    warm = sh.generate_swap_pattern(ns, 0.5, random.Random(2))
    assert all(len(g["indices"]) in (2, 3) for g in warm)
    hot = sh.generate_swap_pattern(ns, 0.95, random.Random(3))
    assert all(2 <= len(g["indices"]) <= 5 for g in hot)
    assert any(len(g["indices"]) > 3 for g in hot)


def test_apply_swap_pattern_permutes_pitches_within_groups():
    ns = notes([60, 62, 64, 65])
    pattern = [{"indices": [0, 1], "shuffled": [1, 0]}, {"indices": [2, 3], "shuffled": [3, 2]}]
    changed = sh.apply_swap_pattern(ns, pattern)
    assert [n["pitch"] for n in ns] == [62, 60, 65, 64] and changed == 4
    # Applying the pattern again is not cumulative on a fresh base.
    ns2 = notes([60, 62, 64, 65])
    sh.apply_swap_pattern(ns2, pattern)
    assert [n["pitch"] for n in ns2] == [62, 60, 65, 64]


def test_apply_swap_pattern_keeps_the_pitch_multiset_and_tolerates_bad_indices():
    ns = notes([60, 64, 67, 72, 76])
    pattern = sh.generate_swap_pattern(ns, 1.0, random.Random(11))
    sh.apply_swap_pattern(ns, pattern)
    assert sorted(n["pitch"] for n in ns) == [60, 64, 67, 72, 76]
    assert sh.apply_swap_pattern(ns, [{"indices": [0, 99], "shuffled": [99, 0]}]) == 0
    assert sh.apply_swap_pattern(ns, []) == 0


def test_attribute_notes_are_supported():
    class N:
        def __init__(self, p, s):
            self.pitch, self.start_time = p, s

    ns = [N(60, 0.0), N(72, 1.0)]
    sh.apply_swap_pattern(ns, [{"indices": [0, 1], "shuffled": [1, 0]}])
    assert (ns[0].pitch, ns[1].pitch) == (72, 60)
