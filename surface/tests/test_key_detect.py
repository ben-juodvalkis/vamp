"""ADR-446: deterministic key detection, pure rules under pytest."""

from __future__ import annotations

import random

import pytest

from components.key_detect import (
    BAND_NO_KEY,
    BAND_PLAUSIBLE,
    BAND_SURE,
    BAND_UNSURE,
    FOLLOW_ADD,
    FOLLOW_CORRECT,
    LIVE_SCALE_NAMES,
    LIVE_SCALES,
    PITCH_CLASS_NAMES,
    bar_ticks,
    chord_root,
    detect,
    fingerprint,
    follow_decision,
    key_fits,
    quantize_clip,
)

# Set "2" as read from the rig on 2026-09-19 (85 BPM): role, loop, notes (pitch, start, duration).
RIG_SET_2 = [
    ("Memphis Studio + Plymouth", "drum", 0, 4, [
        (36, 0.0000, 0.2153),
        (36, 0.5190, 0.1877),
        (36, 2.0000, 0.2100),
        (36, 2.4914, 0.2374),
        (38, 1.0201, 0.2581),
        (38, 2.9925, 0.2500),
    ]),
    ("Trilian Brite", "bass", 0, 8, [
        (36, 0.0188, 1.9989),
        (39, 3.9405, 2.0804),
        (41, 5.9781, 1.8552),
        (44, 1.9403, 2.1591),
    ]),
    ("Autotack Pluck", "key", 0, 16, [
        (53, 12.0997, 1.8165),
        (55, 14.1153, 1.7503),
        (56, 10.0690, 1.6592),
        (58, 6.0188, 1.6618),
        (60, 0.0126, 3.6219),
        (60, 4.0698, 1.6383),
        (60, 8.0163, 6.0906),
        (62, 5.9705, 2.0983),
        (62, 14.0655, 1.8110),
        (63, 0.0319, 3.9895),
        (63, 8.0067, 4.0640),
        (65, 4.0421, 1.9215),
        (65, 11.9990, 2.2654),
        (67, 0.0291, 2.0072),
        (67, 6.0355, 4.0059),
        (68, 2.0391, 1.8606),
        (68, 4.0642, 1.8953),
    ]),
    ("Sub37 Ocarina of Mine", "synth", 0, 16, [
        (65, 10.5047, 0.5856),
        (67, 9.0279, 1.4959),
        (67, 10.9867, 0.3204),
        (67, 13.5230, 0.2997),
        (67, 14.0755, 1.6715),
        (70, 11.2533, 0.2819),
        (70, 11.7534, 1.7668),
        (70, 13.7703, 0.3399),
        (72, 1.5090, 0.2624),
        (72, 11.5102, 0.2915),
        (74, 0.5033, 0.2528),
        (74, 1.0254, 0.4876),
        (74, 8.0085, 1.0387),
        (75, 0.0018, 0.5236),
        (75, 0.7133, 0.4282),
        (75, 1.7327, 0.2957),
        (77, 2.9788, 0.8952),
        (77, 6.0012, 0.9850),
        (79, 2.0036, 0.9876),
        (79, 5.7637, 0.2321),
        (79, 6.9807, 1.0954),
        (82, 5.0425, 0.2639),
        (82, 5.5191, 0.2818),
        (84, 5.3050, 0.2763),
    ]),
]

# The Am Dm G C loop read from the rig on 2026-09-19 (Hollow Fretless bass, Marimba in inversions, Wavering Plunk melody):
# a musician hears A minor; the first vote ladder said D Dorian (ADR-446 addendum).
RIG_SET_AM = [
    ("Memphis Studio + Plymouth", "drum", 0, 8, [
        (36, 0.0000, 0.3933),
        (36, 0.9599, 0.5024),
        (36, 1.9839, 0.4083),
        (36, 2.9716, 0.4105),
        (36, 4.0000, 0.3713),
        (36, 5.0000, 0.4305),
        (36, 5.9390, 0.4134),
        (36, 6.9515, 0.3502),
    ]),
    ("Hollow Fretless", "bass", 0, 16, [
        (43, 8.0262, 1.5228),
        (45, 0.0000, 1.4992),
        (47, 15.5776, 0.4224),
        (48, 3.5165, 0.4220),
        (48, 12.0216, 1.5345),
        (48, 15.0261, 0.5965),
        (50, 4.0033, 1.5423),
        (50, 9.5000, 1.5523),
        (50, 13.5209, 0.5888),
        (50, 14.5413, 0.4907),
        (52, 14.0725, 0.5299),
        (55, 10.9462, 0.5986),
        (57, 3.0161, 0.5456),
        (57, 5.4770, 1.6092),
        (60, 1.5560, 1.4856),
        (62, 7.5198, 0.4631),
        (62, 11.5075, 0.5927),
        (64, 7.0234, 0.5632),
    ]),
    ("Marimba Cloth Hits", "key", 0, 16, [
        (60, 1.9969, 0.2197),
        (60, 3.0683, 0.2138),
        (62, 4.0671, 1.2678),
        (62, 5.6135, 0.4376),
        (62, 7.9802, 0.3826),
        (62, 9.5402, 0.3278),
        (62, 11.0670, 0.3435),
        (64, 1.9986, 0.1963),
        (64, 3.0721, 0.2042),
        (64, 12.5761, 0.2866),
        (64, 13.5652, 0.3337),
        (64, 14.0048, 0.5652),
        (64, 14.9743, 0.3158),
        (65, 4.0750, 1.2461),
        (65, 5.5998, 0.4120),
        (67, 7.9860, 0.3671),
        (67, 9.5363, 0.2983),
        (67, 11.0729, 0.3159),
        (67, 12.5585, 0.2846),
        (67, 13.6162, 0.0726),
        (69, 1.9831, 0.2511),
        (69, 3.0545, 0.2396),
        (69, 4.0573, 1.2933),
        (69, 5.6194, 0.4631),
        (71, 7.9841, 0.4005),
        (71, 9.5441, 0.3534),
        (71, 11.0708, 0.3749),
        (71, 14.0086, 0.5693),
        (71, 14.9605, 0.3964),
        (72, 12.5486, 0.3240),
        (72, 13.5357, 0.4710),
    ]),
    ("Wavering Plunk", "synth", 0, 16, [
        (62, 11.0344, 0.5533),
        (64, 10.0394, 1.0931),
        (64, 11.5543, 1.0833),
        (67, 9.5646, 0.4492),
        (69, 4.4759, 1.1695),
        (69, 8.0201, 0.5455),
        (69, 9.0485, 0.4807),
        (71, 8.5440, 0.5553),
        (72, 0.0000, 0.4843),
        (72, 3.5203, 0.9616),
        (74, 0.4961, 0.5004),
        (74, 2.0328, 0.1961),
        (74, 2.9943, 0.5142),
        (76, 0.9788, 0.4693),
        (76, 2.0171, 0.8515),
        (79, 1.4911, 0.5554),
    ]),
]


def _note(pitch, start, dur, mute=False):
    return {"pitch": pitch, "start_time": start, "duration": dur, "mute": mute}


def _clip(role, start, end, notes):
    return quantize_clip(role, start, end, [_note(*n) for n in notes])


def _rig_clips():
    return [_clip(role, s, e, notes) for _name, role, s, e, notes in RIG_SET_2]


# --- the rig's own set ---------------------------------------------------

def test_rig_set_is_c_minor_sure_with_eb_major_runner_up():
    r = detect(_rig_clips())
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"], r["band"]) == ("C", "Minor", BAND_SURE)
    assert (PITCH_CLASS_NAMES[r["runner_root"]], r["runner_scale"]) == ("F", "Dorian")
    assert r["gap"] == pytest.approx(2 / 3)
    assert r["pitch_classes"] == sum(1 << pc for pc in (0, 2, 3, 5, 7, 8, 10))


def test_rig_set_reasons_are_the_audit_trail():
    reasons = detect(_rig_clips())["reasons"]
    assert "bass downbeats C(8) D#(4) C(4) D#(4), first note C (2), lowest C (1)" in reasons
    assert "keys chord roots C(6) F(3) G(1) C(3) F(3) G(1)" in reasons
    assert "synth rests F (2 each), longest A# (1)" in reasons
    assert any(s.startswith("collections that fit: D# Major, C Minor, F Dorian") for s in reasons)
    assert reasons[-1].startswith("C Minor (sure, gap 67 %), runner-up F Dorian")


def test_drum_roles_never_vote_or_add_evidence():
    clips = _rig_clips() + [_clip("drum", 0.0, 4.0, [(36, 0.0, 0.2), (38, 1.0, 0.2), (42, 2.0, 0.2)])]
    assert detect(clips)["reasons"] == detect(_rig_clips())["reasons"]


# --- determinism ------------------------------------------------------------

def test_same_input_in_any_order_gives_the_same_line():
    base = detect(_rig_clips())
    for seed in range(5):
        rows = list(RIG_SET_2)
        random.Random(seed).shuffle(rows)
        clips = []
        for _name, role, s, e, notes in rows:
            notes = list(notes)
            random.Random(seed).shuffle(notes)
            clips.append(_clip(role, s, e, notes))
        assert detect(clips) == base


def test_offgrid_onsets_quantize_to_the_downbeat():
    early = _clip("bass", 0.0, 4.0, [(36, 0.02, 1.0), (43, 1.98, 1.0), (40, 3.01, 0.9)])
    exact = _clip("bass", 0.0, 4.0, [(36, 0.0, 1.0), (43, 2.0, 1.0), (40, 3.0, 0.9)])
    assert early == exact


# --- refusals ---------------------------------------------------------------

def test_nothing_launched_is_no_key():
    r = detect([])
    assert r["band"] == BAND_NO_KEY and r["root"] == -1 and r["scale"] == ""


def test_melody_alone_is_no_key():
    melody = _clip("synth", 0.0, 4.0, [(67, 0.0, 1.0), (70, 1.0, 1.0), (72, 2.0, 1.0), (74, 3.0, 1.0)])
    r = detect([melody])
    assert r["band"] == BAND_NO_KEY
    assert "no bass or keys vote cast: no key" in r["reasons"]


def test_two_pitch_classes_decide_by_the_votes():
    bass = _clip("bass", 0.0, 4.0, [(36, 0.0, 2.0), (43, 2.0, 2.0)])
    r = detect([bass])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"], r["band"]) == ("C", "Major", BAND_SURE)


def test_a_minor_third_pair_is_named_by_a_scale_that_holds_it():
    """Major where it fits, else the commonest scale on the root that does:
    B and D is B Minor, never B Major (which has D#)."""
    bass = _clip("bass", 0.0, 4.0, [(35, 0.0, 3.0), (38, 3.0, 1.0)])
    r = detect([bass])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("B", "Minor")


@pytest.mark.parametrize("role", ["bass", "key", "synth", ""])
def test_a_single_note_is_the_root_with_major_assumed(role):
    """The rig's loop brace held one B: that B is the root, whatever plays it."""
    one = _clip(role, 3.875, 7.875, [(35, 4.05, 3.34)])
    r = detect([one])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"], r["band"]) == ("B", "Major", BAND_SURE)
    assert "one pitch class: B is the root, Major assumed" in r["reasons"]
    assert key_fits((11, "Major"), r["fitted"])


def test_a_chordless_keys_part_votes_its_downbeat_notes():
    """An arpeggio has no two notes struck together; the note on each downbeat
    stands for the chord there, so a melody resting on G no longer decides."""
    arp = _clip("key", 0.0, 4.0, [(60, 0.0, 1.0), (64, 1.0, 1.0), (67, 2.0, 1.0), (72, 3.0, 1.0)])
    line = _clip("synth", 0.0, 4.0, [(74, 0.0, 1.0), (71, 1.0, 1.0), (67, 2.0, 1.0)])
    r = detect([arp, line])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Major")
    assert "keys downbeat notes C(6)" in r["reasons"]


def test_long_vote_listings_are_capped():
    stabs = [(60 + (i % 2) * 3, i * 0.25, 0.25) for i in range(64)] + [(55, i * 0.25, 0.25) for i in range(64)]
    keys = _clip("key", 0.0, 16.0, stabs)
    bass = _clip("bass", 0.0, 64.0, [(36, 0.0, 64.0)])
    r = detect([bass, keys])
    line = next(x for x in r["reasons"] if x.startswith("keys chord roots"))
    assert "… +" in line and len(line) < 300

def test_unset_role_alone_is_no_key_but_counts_beside_a_bass():
    unset = _clip("", 0.0, 4.0, [(60, 0.0, 1.0), (64, 1.0, 1.0), (67, 2.0, 1.0)])
    assert detect([unset])["band"] == BAND_NO_KEY
    bass = _clip("bass", 0.0, 4.0, [(36, 0.0, 4.0)])
    r = detect([unset, bass])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Major")


# --- the musical rules ------------------------------------------------------

def test_relative_major_and_minor_are_told_apart_by_the_bass():
    keys = _clip("key", 0.0, 8.0, [
        (60, 0.0, 4.0), (63, 0.0, 4.0), (67, 0.0, 4.0),   # C D# G
        (65, 4.0, 4.0), (68, 4.0, 4.0), (72, 4.0, 4.0),   # F G# C
    ])
    bass_c = _clip("bass", 0.0, 8.0, [(36, 0.0, 4.0), (41, 4.0, 4.0)])
    bass_eb = _clip("bass", 0.0, 8.0, [(39, 0.0, 4.0), (44, 4.0, 4.0)])
    c = detect([keys, bass_c])
    eb = detect([keys, bass_eb])
    assert (PITCH_CLASS_NAMES[c["root"]], c["scale"]) == ("C", "Minor")
    assert (PITCH_CLASS_NAMES[eb["root"]], eb["scale"]) == ("D#", "Major")


def test_short_loops_repeat_inside_the_longest_one():
    one_bar_bass = _clip("bass", 0.0, 4.0, [(36, 0.0, 4.0)])
    four_bar_keys = _clip("key", 0.0, 16.0, [
        (64, 0.0, 4.0), (67, 0.0, 4.0), (71, 0.0, 4.0),     # E G B on bar 1
        (64, 4.0, 4.0), (67, 4.0, 4.0), (71, 4.0, 4.0),     # bar 2
        (64, 8.0, 4.0), (67, 8.0, 4.0), (71, 8.0, 4.0),     # bar 3
        (62, 12.0, 4.0), (67, 12.0, 4.0), (71, 12.0, 4.0),  # D G B on bar 4
    ])
    r = detect([one_bar_bass, four_bar_keys])
    # C on all four downbeats: 8 + 4 x 3 + first 2 + lowest 1 = 23; E chord roots 6 + 3 + 3 = 12, G 3.
    assert r["votes"][0] == 23 and r["votes"][4] == 12 and r["votes"][7] == 3
    assert "harmonic cycle 16 beats" in r["reasons"]


def test_seven_note_scale_is_preferred_over_the_pentatonic_it_contains():
    bass = _clip("bass", 0.0, 4.0, [(36, 0.0, 1.0), (43, 1.0, 1.0), (48, 2.0, 1.0), (46, 3.0, 1.0)])
    keys = _clip("key", 0.0, 4.0, [(60, 0.0, 4.0), (63, 0.0, 4.0), (65, 0.0, 4.0)])
    r = detect([bass, keys])  # C D# F G A#: a minor pentatonic
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Minor")
    assert (0, "Minor Pentatonic") in r["candidates"]


def test_notes_outside_the_loop_are_dropped_and_muted_notes_count():
    """A muted note is Permute's gate on this rig: part of the loop's harmony."""
    plain = _clip("bass", 0.0, 4.0, [(36, 0.0, 4.0), (43, 1.0, 1.0)])
    noisy = quantize_clip("bass", 0.0, 4.0, [
        _note(36, 0.0, 4.0), _note(41, 5.0, 1.0), _note(43, 1.0, 1.0, mute=True),
    ])
    assert noisy == plain


def test_a_note_just_before_the_loop_end_is_the_next_downbeat_played_early():
    """Onsets snap on the loop's circle: 3.875 (a 32nd early, a banker's-rounding
    tie) and 3.98 both land on tick 0 instead of being lost."""
    for t in (3.875, 3.98):
        q = quantize_clip("bass", 0.0, 4.0, [_note(36, t, 1.0)])
        assert q is not None and q["notes"] == [(36, 0, 1)], t


def test_a_zero_weight_role_is_left_out_entirely():
    """An fx clip (trigger notes for an effect rack) neither votes nor stretches
    the harmonic cycle: bass + fx reads exactly like the bass alone."""
    bass = _clip("bass", 0.0, 4.0, [(45, 1.0, 1.0), (48, 2.0, 1.0), (52, 3.0, 1.0)])
    fx = _clip("fx", 0.0, 16.0, [(60, 0.0, 0.25), (60, 2.0, 0.25)])
    alone, with_fx = detect([bass]), detect([bass, fx])
    assert with_fx == alone
    assert not any(line.startswith("fx ") for line in with_fx["reasons"])

def test_empty_or_inverted_loop_is_no_clip():
    assert quantize_clip("bass", 0.0, 0.0, [_note(36, 0.0, 1.0)]) is None
    assert quantize_clip("bass", 4.0, 2.0, [_note(36, 0.0, 1.0)]) is None
    assert quantize_clip("bass", 0.0, 4.0, []) is None


# --- the scale table --------------------------------------------------------

def test_scale_table_matches_lives_vocabulary():
    assert len(LIVE_SCALES) == 35
    assert LIVE_SCALE_NAMES[:4] == ("Major", "Minor", "Dorian", "Mixolydian")
    assert dict(LIVE_SCALES)["Major"] == (0, 2, 4, 5, 7, 9, 11)
    for name, intervals in LIVE_SCALES:
        assert intervals[0] == 0 and list(intervals) == sorted(set(intervals)), name
        assert all(0 <= i < 12 for i in intervals), name


# --- the Am Dm G C loop, and the three rules it taught ------------------

def _am_clips():
    return [_clip(role, s, e, notes) for _name, role, s, e, notes in RIG_SET_AM]


def test_am_loop_reads_a_minor_not_d_dorian():
    """Same seven notes as D Dorian. The marimba plays its A minor chords as
    C-E-A and its G chords as D-G-B, so the old "lowest note is the root" rule
    voted C and D and never A; the loop sits on A minor at its top and the
    line comes to rest on A."""
    r = detect(_am_clips())
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("A", "Minor")
    assert r["band"] == "plausible"
    assert (PITCH_CLASS_NAMES[r["runner_root"]], r["runner_scale"]) == ("G", "Mixolydian")
    reasons = r["reasons"]
    assert "bass downbeats A(8) D(4) G(4) C(4), first note A (2), lowest G (1)" in reasons
    assert "keys chord roots A(1) A(1) D(3) D(1) G(3) G(1) G(1) C(1) C(1) E(1) E(1)" in reasons
    assert "synth rests A E (2 each), longest A (1)" in reasons
    assert "tonic votes: A 15, G 10, D 8, C 6, E 4, F 0, B 0" in reasons


@pytest.mark.parametrize("pitches, root", [
    ([48, 52, 57], 9),      # C-E-A: A minor in first inversion → A
    ([50, 55, 59], 7),      # D-G-B: G major in second inversion → G
    ([60, 64, 67], 0),      # C-E-G → C
    ([62, 65, 69], 2),      # D-F-A → D
    ([52, 59], 4),          # a bare fifth → its lower note
    ([60, 65, 67], 0),      # C-F-G: two fifths, no thirds → the lowest
    ([59, 62, 65], 11),     # B-D-F: no fifth, two thirds → the lowest
    ([64], 4),              # a single note is its own root
])
def test_chord_root_by_stacking(pitches, root):
    assert chord_root(pitches) == root


def test_top_of_the_loop_outweighs_one_other_bar():
    # Bass A on bar 1, D on bars 2, 3 and 4 over an A minor pad: A 8+2 vs D 12 by downbeats,
    # but the lowest note and the pad's roots keep it A.
    bass = _clip("bass", 0.0, 16.0, [(45, 0.0, 4.0), (50, 4.0, 4.0), (50, 8.0, 4.0), (50, 12.0, 4.0)])
    pad = _clip("key", 0.0, 16.0, [(57, 0.0, 16.0), (60, 0.0, 16.0), (64, 0.0, 16.0)])
    r = detect([bass, pad])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("A", "Minor")


def test_a_line_votes_only_where_it_rests():
    bass = _clip("bass", 0.0, 4.0, [(36, 0.0, 4.0)])
    line = _clip("synth", 0.0, 4.0, [(64, 0.0, 0.5), (67, 0.5, 0.5), (71, 1.0, 1.0)])  # E G B, rest after B
    r = detect([bass, line])
    assert "synth rests B (2 each), longest B (1)" in r["reasons"]
    assert r["votes"][11] == 3 and r["votes"][4] == 0 and r["votes"][7] == 0


# --- chromatic passing tones (ADR-446 addendum) -------------------------------

def _white_key_pad():
    # C E G | F A C | G B D | C E G — every white key, roots C F G C.
    return _clip("key", 0.0, 16.0, [
        (60, 0.0, 4.0), (64, 0.0, 4.0), (67, 0.0, 4.0),
        (65, 4.0, 4.0), (69, 4.0, 4.0), (72, 4.0, 4.0),
        (67, 8.0, 4.0), (71, 8.0, 4.0), (74, 8.0, 4.0),
        (60, 12.0, 4.0), (64, 12.0, 4.0), (67, 12.0, 4.0),
    ])


def test_a_brief_passing_tone_never_enters_the_set():
    """One beat of F# into G in a C major loop stays under the 2 % presence
    floor: the set is the seven white keys and nothing needs dropping."""
    bass = _clip("bass", 0.0, 16.0, [
        (36, 0.0, 4.0), (41, 4.0, 3.0), (42, 7.0, 1.0), (43, 8.0, 4.0), (36, 12.0, 4.0),
    ])
    r = detect([bass, _white_key_pad()])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Major")
    assert "pitch classes present: C D E F G A B" in r["reasons"]
    assert not any(line.startswith("passing tones") for line in r["reasons"])


def test_a_chromatic_walk_up_does_not_break_the_key():
    """Two beats of F# leaning into G in a C major loop count as present:
    eight pitch classes, no seven-note scale holds them. The weakest is
    dropped and named."""
    bass = _clip("bass", 0.0, 16.0, [
        (36, 0.0, 4.0), (41, 4.0, 2.0), (42, 6.0, 2.0), (43, 8.0, 4.0), (36, 12.0, 4.0),
    ])
    r = detect([bass, _white_key_pad()])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Major")
    assert "passing tones dropped: F#" in r["reasons"]
    assert r["pitch_classes"] & (1 << 6)  # the F# still counts as having sounded


def test_two_passing_tones_are_dropped_weakest_first():
    bass = _clip("bass", 0.0, 16.0, [
        (36, 0.0, 2.0), (37, 2.0, 2.0),  # C, then two beats of C#
        (41, 4.0, 2.0), (42, 6.0, 2.0),  # F, then two beats of F#
        (43, 8.0, 4.0), (36, 12.0, 4.0),
    ])
    r = detect([bass, _white_key_pad()])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Major")
    assert "passing tones dropped: C# F#" in r["reasons"]


def test_three_chromatic_extras_are_too_many():
    bass = _clip("bass", 0.0, 16.0, [
        (36, 0.0, 2.0), (37, 2.0, 2.0), (41, 4.0, 2.0), (42, 6.0, 2.0),
        (43, 8.0, 2.0), (44, 10.0, 2.0), (36, 12.0, 4.0),
    ])
    r = detect([bass, _white_key_pad()])
    assert r["band"] == BAND_NO_KEY
    assert "no Live scale contains those notes: no key" in r["reasons"]


def test_an_exact_octatonic_set_is_still_named_not_trimmed():
    # C Half-whole Dim.: C Db Eb E Gb G A Bb — a pad holding all eight over a C bass.
    pad = _clip("key", 0.0, 4.0, [(p, 0.0, 4.0) for p in (60, 61, 63, 64, 66, 67, 69, 70)])
    bass = _clip("bass", 0.0, 4.0, [(36, 0.0, 4.0)])
    r = detect([bass, pad])
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"]) == ("C", "Half-whole Dim.")
    assert not any(line.startswith("passing tones") for line in r["reasons"])


# --- the bar follows the time signature --------------------------------------

@pytest.mark.parametrize("num, den, ticks", [
    (4, 4, 16), (3, 4, 12), (6, 8, 12), (7, 8, 14), (2, 2, 16), (5, 16, 5), (12, 8, 24),
    (4, 3, 16), (0, 4, 16), ("x", 4, 16), (None, None, 16),
])
def test_bar_ticks(num, den, ticks):
    assert bar_ticks(num, den) == ticks


def test_a_six_eight_bass_votes_on_both_of_its_downbeats():
    # C for the first 6/8 bar; G on beat 3 (the second 6/8 downbeat), E on
    # beat 4 (where a 4/4 grid would put it).
    bass = _clip("bass", 0.0, 6.0, [(36, 0.0, 3.0), (43, 3.0, 1.0), (40, 4.0, 2.0)])
    keys = _clip("key", 0.0, 6.0, [(60, 0.0, 6.0), (64, 0.0, 6.0), (67, 0.0, 6.0)])
    six_eight = detect([bass, keys], bar=bar_ticks(6, 8))
    four_four = detect([bass, keys])
    assert "bass downbeats C(8) G(4), first note C (2), lowest C (1)" in six_eight["reasons"]
    assert "bass downbeats C(8) E(4), first note C (2), lowest C (1)" in four_four["reasons"]


# --- what Follow compares -----------------------------------------------------

def test_the_fingerprint_is_blind_to_octave_and_mute_and_sees_pitch_class():
    base = quantize_clip("bass", 0.0, 4.0, [_note(36, 0.0, 2.0), _note(43, 2.0, 2.0)])
    octave = quantize_clip("bass", 0.0, 4.0, [_note(48, 0.0, 2.0), _note(43, 2.0, 2.0, mute=True)])
    moved = quantize_clip("bass", 0.0, 4.0, [_note(36, 0.0, 2.0), _note(44, 2.0, 2.0)])
    assert fingerprint(base) == fingerprint(octave)
    assert fingerprint(base) != fingerprint(moved)
    assert fingerprint(None) == ()


def test_key_fits():
    c_minor = sum(1 << pc for pc in (0, 2, 3, 5, 7, 8, 10))
    assert key_fits((0, "Minor"), c_minor)
    assert key_fits((3, "Major"), c_minor)            # the relative major holds the same notes
    assert not key_fits((0, "Major"), c_minor)
    assert not key_fits((0, "Not A Scale"), c_minor)
    assert not key_fits(None, c_minor)
    assert not key_fits((-1, ""), c_minor)


def _answer(root, scale, band, fitted_pcs=(0, 2, 3, 5, 7, 8, 10)):
    return {"band": band, "root": root, "scale": scale, "fitted": sum(1 << pc for pc in fitted_pcs)}


@pytest.mark.parametrize("current, answer, event, owned, write, why", [
    # nothing to go on
    ((0, "Major"), _answer(-1, "", BAND_NO_KEY), FOLLOW_ADD, False, False, "no key in what is playing: kept C Major"),
    # the answer is already set
    ((0, "Minor"), _answer(0, "Minor", BAND_SURE), FOLLOW_ADD, True, False, "C Minor already set"),
    # a key the loops' notes are outside of is replaced by any answer, on any event
    ((0, "Major"), _answer(0, "Minor", BAND_UNSURE), FOLLOW_CORRECT, True, True,
     "C Major does not fit what is playing: wrote C Minor"),
    # a fitting key stays after a stop, a delete or an edit
    ((3, "Major"), _answer(0, "Minor", BAND_SURE), FOLLOW_CORRECT, True, False, "kept D# Major: it still fits"),
    # a new loop moves a fitting key on a sure answer
    ((3, "Major"), _answer(0, "Minor", BAND_SURE), FOLLOW_ADD, True, True, "wrote C Minor (sure)"),
    # a plausible answer moves a key nobody owns (Live's default, the set's)...
    ((3, "Major"), _answer(0, "Minor", BAND_PLAUSIBLE), FOLLOW_ADD, False, True, "wrote C Minor (plausible)"),
    # ...but not Follow's own: relative keys do not trade places on every loop
    ((3, "Major"), _answer(0, "Minor", BAND_PLAUSIBLE), FOLLOW_ADD, True, False,
     "kept D# Major: it still fits, and C Minor is only plausible"),
    ((3, "Major"), _answer(0, "Minor", BAND_UNSURE), FOLLOW_ADD, False, False,
     "kept D# Major: it still fits, and C Minor is only unsure"),
    # an unreadable key is replaced
    (None, _answer(0, "Minor", BAND_PLAUSIBLE), FOLLOW_CORRECT, False, True,
     "no key does not fit what is playing: wrote C Minor"),
])
def test_follow_decision(current, answer, event, owned, write, why):
    assert follow_decision(answer, current, event, owned) == (write, why)


# --- one vocabulary on both sides of the wire ---------------------------------

def test_scale_names_match_the_interfaces_list():
    """The picker offers ``SCALE_NAMES`` and the surface refuses any name not in
    ``LIVE_SCALE_NAMES``: one spelling drift and a tap is silently refused."""
    import pathlib
    import re
    ts = pathlib.Path(__file__).resolve().parents[2] / "interface/src/lib/data/scales.ts"
    if not ts.exists():
        pytest.skip("no interface checkout beside the surface")
    block = ts.read_text().split("export const SCALE_NAMES = [", 1)[1].split("] as const", 1)[0]
    assert tuple(re.findall(r"'([^']+)'", block)) == LIVE_SCALE_NAMES


# A C drone under a keys line F# G F# A# A (Sustain Oct bass, OrganSaw keys),
# read from the rig 2026-09-19: no third sounds, so C Dorian #4 and C Lydian
# Dominant both hold the notes; the commoner one is the answer.
RIG_SET_C_DRONE = [
    ("Sustain Oct", "bass", 0.0, 2.0, [
        (60, 0.0688, 1.5763),
    ]),
    ("OrganSaw Cathedral", "key", 0.0, 8.0, [
        (78, 0.0000, 1.0367),
        (79, 1.0212, 0.9245),
        (78, 2.0026, 1.1749),
        (82, 3.0959, 0.9316),
        (81, 4.0226, 1.2937),
    ]),
]


def test_a_drone_with_the_mode_left_open_names_the_commoner_scale():
    clips = [_clip(role, s, e, notes) for _name, role, s, e, notes in RIG_SET_C_DRONE]
    r = detect(clips)
    assert (PITCH_CLASS_NAMES[r["root"]], r["scale"], r["band"]) == ("C", "Lydian Dominant", "sure")
    assert any(line.startswith("collections that fit: G Harmonic Minor, C Dorian #4") for line in r["reasons"])


def test_scale_preference_names_every_live_scale_once():
    from components.key_detect import SCALE_PREFERENCE
    assert sorted(SCALE_PREFERENCE) == sorted(LIVE_SCALE_NAMES)
    assert SCALE_PREFERENCE[:6] == ("Major", "Minor", "Dorian", "Mixolydian", "Lydian", "Phrygian")
