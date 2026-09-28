"""sequencer_math — the ported Permute step arithmetic (permute ADR-020).

Pinned against the fat device's ``permute-sequencer.js`` /
``permute-constants.js`` so the surface engine lands on the same step at
the same tick.
"""

from __future__ import annotations

import pytest

from components import sequencer_math as sm


# --- rates ------------------------------------------------------------------


@pytest.mark.parametrize(
    "index,numer,expected",
    [
        (0, 4, 8 * 4 * 480),
        (1, 4, 4 * 4 * 480),
        (2, 4, 2 * 4 * 480),
        (3, 4, 4 * 480),
        (3, 3, 3 * 480),      # a bar in 3/4 is three beats
        (3, 5, 5 * 480),
        (0, 7, 8 * 7 * 480),
        (4, 4, 960),
        (5, 4, 480),
        (6, 4, 240),
        (7, 4, 120),
        (7, 3, 120),          # note-length rates ignore the numerator
    ],
)
def test_ticks_for_rate_enum_matches_permute_constants(index, numer, expected):
    assert sm.ticks_for_rate_enum(index, numer) == expected


def test_rate_enum_out_of_range_falls_back_to_quarter():
    assert sm.ticks_for_rate_enum(9, 4) == 480
    assert sm.ticks_for_rate_enum(-1, 4) == 480
    assert sm.ticks_for_rate_enum(None, 4) == 480
    assert sm.ticks_for_rate_enum("x", 4) == 480


def test_rate_enum_accepts_float_values_from_the_parameter():
    # ``Mute Rate`` reads back as a float (3.0); the enum is its int.
    assert sm.ticks_for_rate_enum(3.0, 4) == 1920
    assert sm.ticks_for_rate_enum(7.0, 4) == 120


def test_bad_numerator_defaults_to_four():
    assert sm.ticks_for_rate_enum(3, 0) == 4 * 480
    assert sm.ticks_for_rate_enum(3, None) == 4 * 480
    assert sm.ticks_for_rate_enum(3, "?") == 4 * 480


def test_rate_labels():
    assert [sm.rate_label(i) for i in range(8)] == [
        "8 bar", "4 bar", "2 bar", "1 bar", "1/2", "1/4", "1/8", "1/16",
    ]
    assert sm.rate_label(42) == "1/4"


# --- steps --------------------------------------------------------------------


def test_calculate_step_is_floor_div_mod_length():
    # 1/4 rate, 8 steps: one step per beat.
    assert sm.calculate_step(0, 480, 8) == 0
    assert sm.calculate_step(479.9, 480, 8) == 0
    assert sm.calculate_step(480, 480, 8) == 1
    assert sm.calculate_step(480 * 7, 480, 8) == 7
    assert sm.calculate_step(480 * 8, 480, 8) == 0
    assert sm.calculate_step(480 * 13, 480, 8) == 5


def test_calculate_step_honours_length():
    assert sm.calculate_step(480 * 5, 480, 4) == 1
    assert sm.calculate_step(480 * 5, 480, 1) == 0
    assert sm.calculate_step(480 * 5, 480, 6) == 5


def test_calculate_step_guards_bad_ticks_per_step():
    assert sm.calculate_step(1000, 0, 8) == 0
    assert sm.calculate_step(1000, -5, 8) == 0
    assert sm.calculate_step(1000, None, 8) == 0


def test_clamp_length():
    assert sm.clamp_length(8) == 8
    assert sm.clamp_length(8.0) == 8
    assert sm.clamp_length(0) == 1
    assert sm.clamp_length(-3) == 1
    assert sm.clamp_length(200) == 64
    assert sm.clamp_length(None) == 8
    assert sm.clamp_length("x") == 8


def test_step_start_ticks():
    assert sm.step_start_ticks(1000, 480) == 960
    assert sm.step_start_ticks(480, 480) == 480
    assert sm.step_start_ticks(0, 480) == 0
    assert sm.step_start_ticks(1000, 0) == 0.0


# --- time -----------------------------------------------------------------------


def test_beats_to_ticks():
    assert sm.beats_to_ticks(1) == 480
    assert sm.beats_to_ticks(2.5) == 1200.0


def test_ticks_to_ms_at_tempo():
    assert sm.ticks_to_ms(480, 120) == pytest.approx(500.0)
    assert sm.ticks_to_ms(480, 60) == pytest.approx(1000.0)
    assert sm.ticks_to_ms(-240, 120) == pytest.approx(-250.0)
    assert sm.ticks_to_ms(480, 0) == pytest.approx(500.0)   # bad tempo → 120


def test_lookahead_ticks_scales_with_tempo_and_interval():
    # 10.8 ms at 111 BPM ≈ 9.6 ticks; at 180 BPM ≈ 15.6 ticks.
    assert sm.lookahead_ticks(0.0108, 111) == pytest.approx(9.59, abs=0.05)
    assert sm.lookahead_ticks(0.0108, 180) == pytest.approx(15.55, abs=0.05)
    assert sm.lookahead_ticks(0.0, 120) == 0.0
    assert sm.lookahead_ticks(0.01, 0) == 0.0


def test_lead_floors_at_a_32nd_when_the_tick_interval_is_shorter():
    # The measured pump period is ~10 ms — under 16 ticks at any working
    # tempo, so the 1/32 floor is what the engine actually leads by.
    for tempo in (60, 97.74, 120, 180):
        assert sm.lead_ticks(0.0108, tempo, 2880) == pytest.approx(60.0)
    # In ticks, so it scales with tempo: a 1/32 is 76.7 ms at 97.74 BPM
    # and 41.7 ms at 180.
    assert sm.ticks_to_ms(sm.lead_ticks(0.0108, 97.74, 2880), 97.74) == pytest.approx(76.7, abs=0.1)
    assert sm.ticks_to_ms(sm.lead_ticks(0.0108, 180, 2880), 180) == pytest.approx(41.7, abs=0.1)


def test_lead_rises_with_a_stalled_clock_above_the_floor():
    # A 40 ms interval (the EMA clamp ceiling) at 180 BPM is 57.6 ticks —
    # still under the floor; at 240 BPM it is 76.8 and wins.
    assert sm.lead_ticks(0.040, 180, 2880) == pytest.approx(60.0)
    assert sm.lead_ticks(0.040, 240, 2880) == pytest.approx(76.8, abs=0.05)


def test_lead_is_clamped_to_half_a_step():
    # Only the 1/16 rate (120-tick steps) is short enough for the clamp to
    # bite: the flip is held to a 1/32 early, not the full floor.
    assert sm.lead_ticks(0.0108, 120, 120) == pytest.approx(60.0)    # 1/16: exactly half
    assert sm.lead_ticks(0.0108, 120, 240) == pytest.approx(60.0)    # 1/8: a quarter-step
    assert sm.lead_ticks(0.0108, 120, 480) == pytest.approx(60.0)    # 1/4: an eighth-step
    # A stalled clock cannot push past half a step either.
    assert sm.lead_ticks(0.040, 240, 120) == pytest.approx(60.0)
    assert sm.lead_ticks(0.040, 240, 240) == pytest.approx(76.8, abs=0.05)


def test_lead_never_exceeds_the_gap_to_the_preceding_sixteenth():
    # The safety property the 1/32 floor buys: a note on the 1/16 before a
    # boundary must not be caught by the lead.
    for tps in (120, 240, 480, 960, 2880, 23040):
        assert sm.lead_ticks(0.0108, 120, tps) < 120


def test_lead_guards_a_bad_ticks_per_step():
    # The fat device's guard: a non-positive or junk step returns unclamped.
    assert sm.lead_ticks(0.0108, 120, 0) == pytest.approx(60.0)
    assert sm.lead_ticks(0.0108, 120, -5) == pytest.approx(60.0)
    assert sm.lead_ticks(0.0108, 120, None) == pytest.approx(60.0)
