"""MidiPedalInput tests — ADR-422 USB-direct pedal MIDI.

Covers the plain-Python translator that replaces the two Max ctlin→OSC
bridges when the pedal port is assigned as the surface's MIDI Input:

- CC parsing: only 3-byte CC messages on owned controllers *and* the
  configured channel (10 → status 0xB9) match; other channels, notes,
  sysex and garbage fall through. ``channel: 0`` restores omni.
- Foot tap/hold state machine (the ``foot-trigger.js`` port):
    * release inside the threshold        → tap
    * scheduled check fires while held    → hold, release's tap suppressed
    * release past threshold, check late  → hold at release (clock check)
    * duplicate press / unmatched release → ignored
    * stale check from a previous press   → dropped (seq guard)
- Wah toe: the switch latches, so *either* edge across the 64 threshold
  fires engage once; a repeated same-side level does not.
- Wah expression: every value forwarded verbatim.
- Constants: wah CC remaps honored, invalid values fall back, custom
  ``osc.footTrigger.holdThresholdMs`` honored. The foot switch is a
  ``FootMapping`` (a user setting): ``midiPedals.footSwitchCC`` only seeds
  it, and a missing key is no foot switch.
- Foot modes: momentary (either polarity) and latching (every stomp taps).
- Learn: the next CC on any channel becomes the mapping; the release
  window tells momentary from latching; nothing heard times out.
- Resilience: raising callbacks / raising scheduler / missing scheduler
  never corrupt state; post-disconnect everything no-ops.

The timing here is exactly the logic ``foot-trigger.js`` owned in Max —
that file could never be unit-tested; this one is the reason the port
pays for itself.
"""

from __future__ import annotations

from typing import Callable, List, Tuple

import pytest

from components.midi_pedal_input import (
    LATCHING,
    MOMENTARY,
    FootMapping,
    MidiPedalInput,
    _DEFAULT_HOLD_THRESHOLD_MS,
    foot_mapping_from_constants,
    foot_mapping_from_dict,
)


# --- stubs ----------------------------------------------------------------


class FakeClock:
    """Injectable ``monotonic``: seconds, advanced manually."""

    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance_ms(self, ms: float) -> None:
        self.now += ms / 1000.0


class FakeScheduler:
    """Captures ``(delay_ms, fn)``; tests fire the checks explicitly."""

    def __init__(self) -> None:
        self.scheduled: List[Tuple[int, Callable[[], None]]] = []
        self.raises = False

    def __call__(self, delay_ms: int, fn: Callable[[], None]) -> None:
        if self.raises:
            raise RuntimeError("scheduler down")
        self.scheduled.append((delay_ms, fn))

    def fire_all(self) -> None:
        pending, self.scheduled = self.scheduled, []
        for _, fn in pending:
            fn()


class Recorder:
    def __init__(self) -> None:
        self.taps = 0
        self.holds = 0
        self.engages = 0
        self.freqs: List[int] = []

    def tap(self) -> None:
        self.taps += 1

    def hold(self) -> None:
        self.holds += 1

    def engage(self) -> None:
        self.engages += 1

    def freq(self, value: int) -> None:
        self.freqs.append(value)


# --- fixtures --------------------------------------------------------------


def make_constants(hold_ms: int = 500, **midi_pedals) -> dict:
    constants = {"osc": {"footTrigger": {"holdThresholdMs": hold_ms}}}
    if midi_pedals:
        constants["midiPedals"] = midi_pedals
    return constants


# The rig's foot switch: channel 10, CC 23, momentary.
RIG_FOOT = FootMapping(channel=10, cc=23)


@pytest.fixture()
def rig():
    clock = FakeClock()
    scheduler = FakeScheduler()
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(),
        on_foot_tap=recorder.tap,
        on_foot_hold=recorder.hold,
        on_wah_engage=recorder.engage,
        on_wah_freq=recorder.freq,
        schedule_delayed=scheduler,
        monotonic=clock,
        foot_mapping=RIG_FOOT,
    )
    return adapter, clock, scheduler, recorder


# constants.midiPedals.channel is 1-16; the wire nibble is 0-15.
PEDAL_CHANNEL_INDEX = 9  # channel 10


def cc(controller: int, value: int, channel: int = PEDAL_CHANNEL_INDEX) -> tuple:
    return (0xB0 | channel, controller, value)


# --- parsing / matching -----------------------------------------------------


def test_matches_owned_ccs_only(rig):
    adapter, _, _, _ = rig
    assert adapter.matches(cc(23, 127))
    assert adapter.matches(cc(21, 127))
    assert adapter.matches(cc(20, 64))
    assert not adapter.matches(cc(24, 127))


def test_matches_configured_channel_only(rig):
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(20, 5))
    assert recorder.freqs == [5]
    # Same controller, every other channel: not ours, not swallowed.
    for channel in range(16):
        if channel == PEDAL_CHANNEL_INDEX:
            continue
        assert not adapter.matches(cc(20, 7, channel=channel))
        assert not adapter.handle_midi_bytes(cc(20, 7, channel=channel))
    assert recorder.freqs == [5]


def test_wrong_channel_does_not_drive_the_foot_machine(rig):
    # A press on the wrong channel must not leave the state machine
    # half-pressed — the following on-channel release is unmatched.
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127, channel=0))
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 0)


def test_custom_channel_honored():
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(channel=1),
        on_wah_freq=recorder.freq,
        monotonic=FakeClock(),
    )
    assert adapter.forwarded_channels() == (0,)
    adapter.handle_midi_bytes(cc(20, 5, channel=0))
    assert not adapter.matches(cc(20, 5, channel=PEDAL_CHANNEL_INDEX))
    assert recorder.freqs == [5]


def test_channel_zero_is_omni():
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(channel=0),
        on_wah_freq=recorder.freq,
        monotonic=FakeClock(),
    )
    assert adapter.forwarded_channels() == tuple(range(16))
    for channel in range(16):
        assert adapter.handle_midi_bytes(cc(20, channel, channel=channel))
    assert recorder.freqs == list(range(16))


@pytest.mark.parametrize("bad", [-1, 17, "10", 9.5, True])
def test_invalid_channel_falls_back(bad):
    adapter = MidiPedalInput(
        constants=make_constants(channel=bad),
        on_wah_freq=lambda v: None,
    )
    assert adapter.forwarded_channels() == (PEDAL_CHANNEL_INDEX,)


def test_default_channel_when_unset():
    adapter = MidiPedalInput(
        constants=make_constants(),
        on_wah_freq=lambda v: None,
    )
    assert adapter.forwarded_channels() == (PEDAL_CHANNEL_INDEX,)


@pytest.mark.parametrize(
    "midi_bytes",
    [
        (0x99, 23, 127),          # note-on, not CC
        (0xE9, 0, 64),            # pitch bend
        (0xB9, 23),               # short
        (0xB9, 23, 127, 0),       # long
        (0xF0, 0x7E, 0xF7),       # sysex-ish
        ("B9", 23, 127),          # non-int status
        None,                     # not a sequence
        5,                        # not a sequence
    ],
)
def test_non_cc_messages_fall_through(rig, midi_bytes):
    adapter, _, _, recorder = rig
    assert not adapter.matches(midi_bytes)
    assert not adapter.handle_midi_bytes(midi_bytes)
    assert (recorder.taps, recorder.holds, recorder.engages,
            recorder.freqs) == (0, 0, 0, [])


def test_forwarded_ccs_lists_owned_sorted(rig):
    adapter, _, _, _ = rig
    assert adapter.forwarded_ccs() == (20, 21, 23)


def test_parse_owned_and_dispatch_single_parse_api(rig):
    # The surface parses once (parse_owned) and hands the pair to
    # dispatch — no re-parse on the hot path.
    adapter, _, _, recorder = rig
    assert adapter.parse_owned(cc(20, 42)) == (PEDAL_CHANNEL_INDEX, 20, 42)
    assert adapter.parse_owned(cc(24, 42)) is None       # unowned CC
    assert adapter.parse_owned(cc(20, 42, channel=3)) is None  # wrong ch
    assert adapter.parse_owned((0x99, 23, 127)) is None  # not a CC
    adapter.dispatch(PEDAL_CHANNEL_INDEX, 20, 42)
    assert recorder.freqs == [42]
    adapter.dispatch(PEDAL_CHANNEL_INDEX, 24, 42)  # unowned: no-op, no raise
    adapter.dispatch(3, 20, 42)  # wrong channel: no-op
    assert recorder.freqs == [42]
    adapter.disconnect()
    adapter.dispatch(PEDAL_CHANNEL_INDEX, 20, 43)  # post-disconnect: no-op
    assert recorder.freqs == [42]


def test_gesture_without_callback_releases_its_cc():
    adapter = MidiPedalInput(
        constants=make_constants(),
        on_foot_tap=None,
        on_foot_hold=None,
        on_wah_engage=None,
        on_wah_freq=lambda v: None,
        foot_mapping=RIG_FOOT,
    )
    # Foot + toe unwired → their CCs not owned; expression still is.
    assert adapter.forwarded_ccs() == (20,)
    assert not adapter.matches(cc(23, 127))
    assert not adapter.handle_midi_bytes(cc(23, 127))


# --- foot tap/hold ----------------------------------------------------------


def test_quick_press_release_is_tap(rig):
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(200)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (1, 0)
    # The now-stale check must not turn into a phantom hold.
    scheduler.fire_all()
    assert (recorder.taps, recorder.holds) == (1, 0)


def test_check_fires_hold_while_held_and_suppresses_tap(rig):
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    assert scheduler.scheduled and scheduler.scheduled[0][0] == 500
    clock.advance_ms(500)
    scheduler.fire_all()
    assert (recorder.taps, recorder.holds) == (0, 1)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 1)


def test_late_check_release_past_threshold_is_hold(rig):
    # Scheduler tick granularity (~100ms) can land the check *after* a
    # 500-600ms press has already released; the release-time clock
    # check keeps the boundary exact.
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(550)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 1)
    scheduler.fire_all()  # late check → seq/pressed guards → no double
    assert (recorder.taps, recorder.holds) == (0, 1)


def test_release_at_exact_threshold_is_hold(rig):
    # The release-time clock check is ``>=`` — a press that lasts
    # exactly the threshold is a hold, matching the scheduled check
    # (which would fire at that same instant with the pedal still
    # down) rather than falling to tap on the boundary.
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(500)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 1)
    scheduler.fire_all()  # late check: no double-fire
    assert (recorder.taps, recorder.holds) == (0, 1)


def test_duplicate_press_ignored(rig):
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    adapter.handle_midi_bytes(cc(23, 127))  # bounce / repeated CC
    assert len(scheduler.scheduled) == 1
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (1, 0)


def test_unmatched_release_ignored(rig):
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 0)


def test_stale_check_does_not_hold_the_next_press(rig):
    # press #1 → tap → press #2; press #1's check fires inside press
    # #2's window and must be dropped by the seq guard.
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 0))
    stale = scheduler.scheduled.pop(0)
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(100)
    stale[1]()
    assert (recorder.taps, recorder.holds) == (1, 0)
    # press #2's own check still delivers its hold.
    clock.advance_ms(400)
    scheduler.fire_all()
    assert (recorder.taps, recorder.holds) == (1, 1)


def test_foot_press_threshold_is_64(rig):
    # Standard MIDI switch convention: >=64 presses, below releases.
    adapter, clock, _, recorder = rig
    adapter.handle_midi_bytes(cc(23, 64))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 63))
    assert recorder.taps == 1


def test_foot_low_nonzero_off_value_releases(rig):
    # Pedals that send e.g. 126 on / 1 off: the 1 must read as a
    # release, not as a second press that latches the switch down.
    adapter, clock, _, recorder = rig
    adapter.handle_midi_bytes(cc(23, 126))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 1))
    assert (recorder.taps, recorder.holds) == (1, 0)
    # ...and the next press is still live (not stuck pressed).
    adapter.handle_midi_bytes(cc(23, 126))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 1))
    assert recorder.taps == 2


def test_hold_without_scheduler_resolves_at_release():
    clock = FakeClock()
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(),
        on_foot_tap=recorder.tap,
        on_foot_hold=recorder.hold,
        schedule_delayed=None,
        monotonic=clock,
        foot_mapping=RIG_FOOT,
    )
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(700)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 1)


def test_raising_scheduler_degrades_to_release_time_hold(rig):
    adapter, clock, scheduler, recorder = rig
    scheduler.raises = True
    adapter.handle_midi_bytes(cc(23, 127))  # schedule raises, swallowed
    clock.advance_ms(700)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 1)
    # And a short press still taps.
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (1, 1)


def test_custom_hold_threshold_honored():
    clock = FakeClock()
    scheduler = FakeScheduler()
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(hold_ms=300),
        on_foot_tap=recorder.tap,
        on_foot_hold=recorder.hold,
        schedule_delayed=scheduler,
        monotonic=clock,
        foot_mapping=RIG_FOOT,
    )
    adapter.handle_midi_bytes(cc(23, 127))
    assert scheduler.scheduled[0][0] == 300
    clock.advance_ms(350)
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (0, 1)


# --- wah toe ----------------------------------------------------------------


def test_toe_fires_engage_on_both_edges(rig):
    """The toe switch latches — one press flips it 0↔127 — so every edge is
    a press. Edging on the high side alone ate every second press."""
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(21, 127))
    assert recorder.engages == 1
    adapter.handle_midi_bytes(cc(21, 0))    # the next physical press
    assert recorder.engages == 2
    adapter.handle_midi_bytes(cc(21, 127))
    assert recorder.engages == 3


def test_toe_level_repeat_is_not_a_new_edge(rig):
    """A pedal that streams its state must still engage once per change."""
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(21, 127))
    adapter.handle_midi_bytes(cc(21, 127))
    adapter.handle_midi_bytes(cc(21, 127))
    assert recorder.engages == 1
    adapter.handle_midi_bytes(cc(21, 0))
    adapter.handle_midi_bytes(cc(21, 0))
    assert recorder.engages == 2


def test_toe_low_value_at_rest_does_not_engage(rig):
    """First message low, with the switch already released: no edge, so a
    pedal that announces its resting state on connect stays silent."""
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(21, 0))
    assert recorder.engages == 0


def test_toe_threshold_is_64(rig):
    adapter, _, _, recorder = rig
    adapter.handle_midi_bytes(cc(21, 63))   # still low — no edge from rest
    assert recorder.engages == 0
    adapter.handle_midi_bytes(cc(21, 64))   # crosses into high
    assert recorder.engages == 1
    adapter.handle_midi_bytes(cc(21, 63))   # back below — the other edge
    assert recorder.engages == 2


# --- wah expression ---------------------------------------------------------


def test_expression_forwards_every_value(rig):
    adapter, _, _, recorder = rig
    for value in (0, 1, 64, 127, 127):
        adapter.handle_midi_bytes(cc(20, value))
    assert recorder.freqs == [0, 1, 64, 127, 127]


def test_expression_and_foot_are_independent(rig):
    adapter, clock, _, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))
    adapter.handle_midi_bytes(cc(20, 42))   # sweep during a foot press
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 0))
    assert recorder.freqs == [42]
    assert recorder.taps == 1


# --- constants --------------------------------------------------------------


def test_cc_remap_honored():
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(wahToeSwitchCC=81, wahExpressionCC=1),
        on_foot_tap=recorder.tap,
        on_foot_hold=recorder.hold,
        on_wah_engage=recorder.engage,
        on_wah_freq=recorder.freq,
        monotonic=FakeClock(),
        foot_mapping=FootMapping(channel=10, cc=80),
    )
    assert adapter.forwarded_ccs() == (1, 80, 81)
    assert not adapter.matches(cc(23, 127))
    adapter.handle_midi_bytes(cc(81, 127))
    assert recorder.engages == 1


@pytest.mark.parametrize("bad", [-1, 128, "67", 12.5, True, None])
def test_invalid_wah_cc_falls_back(bad):
    adapter = MidiPedalInput(
        constants=make_constants(wahToeSwitchCC=bad),
        on_wah_engage=lambda: None,
    )
    assert adapter.forwarded_ccs() == (21,)


def test_missing_constants_sections_use_wah_defaults_and_no_foot():
    # The wah keeps its rig defaults (it only runs behind
    # features.expressionPedal); the foot switch has none.
    adapter = MidiPedalInput(
        constants={},
        on_foot_tap=lambda: None,
        on_wah_engage=lambda: None,
        on_wah_freq=lambda v: None,
    )
    assert adapter.forwarded_ccs() == (20, 21)
    assert adapter.foot_mapping is None
    assert not adapter.matches(cc(23, 127))
    assert adapter._hold_threshold_ms == _DEFAULT_HOLD_THRESHOLD_MS


def test_colliding_ccs_first_registration_wins():
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(wahExpressionCC=20),
        on_foot_tap=recorder.tap,
        on_wah_freq=recorder.freq,
        monotonic=FakeClock(),
        foot_mapping=FootMapping(channel=10, cc=20),
    )
    assert adapter.forwarded_ccs() == (20,)
    adapter.handle_midi_bytes(cc(20, 127))
    adapter.handle_midi_bytes(cc(20, 0))
    assert recorder.taps == 1
    assert recorder.freqs == []


# --- resilience -------------------------------------------------------------


def test_raising_callbacks_do_not_corrupt_state(rig):
    adapter, clock, _, recorder = rig
    booms = {"n": 0}

    def boom() -> None:
        booms["n"] += 1
        raise RuntimeError("component exploded")

    adapter._on_foot_tap = boom
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 0))   # tap raises, swallowed
    assert booms["n"] == 1
    # State machine still coherent: next gesture works.
    adapter._on_foot_tap = recorder.tap
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 0))
    assert recorder.taps == 1

    def boom_freq(value: int) -> None:
        raise RuntimeError("freq exploded")

    adapter._on_wah_freq = boom_freq
    adapter.handle_midi_bytes(cc(20, 64))  # swallowed
    adapter._on_wah_freq = recorder.freq
    adapter.handle_midi_bytes(cc(20, 65))
    assert recorder.freqs == [65]


def test_disconnect_silences_everything(rig):
    adapter, clock, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))  # pending hold check
    adapter.disconnect()
    adapter.disconnect()  # idempotent
    clock.advance_ms(500)
    scheduler.fire_all()  # pending check no-ops
    assert not adapter.handle_midi_bytes(cc(23, 0))
    assert not adapter.handle_midi_bytes(cc(21, 127))
    assert not adapter.handle_midi_bytes(cc(20, 64))
    assert (recorder.taps, recorder.holds, recorder.engages,
            recorder.freqs) == (0, 0, 0, [])


# --- foot mapping (a user setting) -------------------------------------------


def test_foot_seed_from_constants():
    assert foot_mapping_from_constants(
        make_constants(channel=10, footSwitchCC=23),
    ) == FootMapping(channel=10, cc=23)
    # No footSwitchCC → no foot switch, not a default CC.
    assert foot_mapping_from_constants(make_constants(channel=10)) is None
    assert foot_mapping_from_constants({}) is None


@pytest.mark.parametrize("bad", [-1, 128, "67", 12.5, True, None])
def test_invalid_seed_cc_is_no_foot_switch(bad):
    assert foot_mapping_from_constants(make_constants(footSwitchCC=bad)) is None


@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        {"channel": 17, "cc": 23},
        {"channel": 10, "cc": 128},
        {"channel": 10, "cc": 23, "mode": "toggle"},
        {"channel": 10, "cc": 23, "pressHigh": 1},
        {"channel": True, "cc": 23},
    ],
)
def test_malformed_saved_mapping_rejected(data):
    assert foot_mapping_from_dict(data) is None


def test_saved_mapping_round_trips():
    mapping = FootMapping(channel=3, cc=64, mode=LATCHING, press_high=True)
    assert foot_mapping_from_dict(mapping.to_dict()) == mapping


def test_foot_switch_has_its_own_channel():
    # The foot on channel 1 while the wah stays on channel 10.
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(),
        on_foot_tap=recorder.tap,
        on_wah_freq=recorder.freq,
        monotonic=FakeClock(),
        foot_mapping=FootMapping(channel=1, cc=23),
    )
    assert adapter.forwarded_pairs() == ((0, 23), (PEDAL_CHANNEL_INDEX, 20))
    assert not adapter.matches(cc(23, 127))  # channel 10: not the foot
    adapter.handle_midi_bytes(cc(23, 127, channel=0))
    adapter.handle_midi_bytes(cc(23, 0, channel=0))
    assert recorder.taps == 1


def test_omni_foot_overlaps_every_channel():
    recorder = Recorder()
    adapter = MidiPedalInput(
        constants=make_constants(wahExpressionCC=23),
        on_foot_tap=recorder.tap,
        on_wah_freq=recorder.freq,
        foot_mapping=FootMapping(channel=0, cc=23),
    )
    # The wah's (ch 10, CC 23) overlaps the omni foot: first one wins.
    assert adapter.forwarded_pairs() == tuple((ch, 23) for ch in range(16))


def test_set_foot_mapping_remaps_and_resets(rig):
    adapter, _, scheduler, recorder = rig
    adapter.handle_midi_bytes(cc(23, 127))  # press in flight
    adapter.set_foot_mapping(FootMapping(channel=10, cc=64))
    scheduler.fire_all()  # the old press's hold check is stranded
    assert recorder.holds == 0
    assert not adapter.matches(cc(23, 0))
    adapter.handle_midi_bytes(cc(64, 127))
    adapter.handle_midi_bytes(cc(64, 0))
    assert recorder.taps == 1
    adapter.set_foot_mapping(None)
    assert adapter.forwarded_ccs() == (20, 21)
    assert not adapter.matches(cc(64, 127))


def test_invalid_mapping_is_no_foot_switch(rig):
    adapter, _, _, _ = rig
    adapter.set_foot_mapping(FootMapping(channel=10, cc=200))
    assert adapter.foot_mapping is None
    assert adapter.forwarded_ccs() == (20, 21)


def test_press_low_switch(rig):
    # A normally-closed switch sends low on press and high on release.
    adapter, clock, _, recorder = rig
    adapter.set_foot_mapping(FootMapping(10, 23, MOMENTARY, press_high=False))
    adapter.handle_midi_bytes(cc(23, 0))
    clock.advance_ms(100)
    adapter.handle_midi_bytes(cc(23, 127))
    assert (recorder.taps, recorder.holds) == (1, 0)


def test_latching_switch_taps_on_every_stomp_and_never_holds(rig):
    adapter, clock, scheduler, recorder = rig
    adapter.set_foot_mapping(FootMapping(10, 23, LATCHING))
    adapter.handle_midi_bytes(cc(23, 127))
    clock.advance_ms(2000)
    scheduler.fire_all()
    adapter.handle_midi_bytes(cc(23, 127))  # level repeat: not a stomp
    adapter.handle_midi_bytes(cc(23, 0))
    assert (recorder.taps, recorder.holds) == (2, 0)
    assert scheduler.scheduled == []


def test_heard_fires_once_per_mapping():
    heard = []
    adapter = MidiPedalInput(
        constants=make_constants(),
        on_foot_tap=lambda: None,
        on_foot_heard=lambda: heard.append(1),
        foot_mapping=RIG_FOOT,
    )
    adapter.handle_midi_bytes(cc(23, 127))
    adapter.handle_midi_bytes(cc(23, 0))
    assert heard == [1]
    adapter.set_foot_mapping(RIG_FOOT)
    adapter.handle_midi_bytes(cc(23, 127))
    assert heard == [1, 1]


# --- learn --------------------------------------------------------------------


class LearnResult:
    def __init__(self) -> None:
        self.learned: List[FootMapping] = []
        self.timeouts = 0

    def on_learned(self, mapping: FootMapping) -> None:
        self.learned.append(mapping)

    def on_timeout(self) -> None:
        self.timeouts += 1


def start(adapter) -> LearnResult:
    result = LearnResult()
    adapter.start_learn(result.on_learned, result.on_timeout)
    return result


def test_learn_forwards_every_cc_and_owns_them(rig):
    adapter, _, _, _ = rig
    start(adapter)
    assert adapter.learning
    assert len(adapter.forwarded_pairs()) == 16 * 128
    assert adapter.matches(cc(99, 127, channel=4))
    assert not adapter.matches((0x94, 60, 100))  # notes still fall through


def test_learn_momentary(rig):
    adapter, _, scheduler, recorder = rig
    adapter.set_foot_mapping(None)
    result = start(adapter)
    adapter.handle_midi_bytes(cc(64, 127, channel=2))
    adapter.handle_midi_bytes(cc(1, 30, channel=2))  # another control: ignored
    adapter.handle_midi_bytes(cc(64, 127, channel=2))  # repeat: ignored
    adapter.handle_midi_bytes(cc(64, 0, channel=2))
    assert result.learned == [FootMapping(3, 64, MOMENTARY, True)]
    assert not adapter.learning
    scheduler.fire_all()  # the window and timeout checks are stale
    assert result.learned == [FootMapping(3, 64, MOMENTARY, True)]
    assert result.timeouts == 0
    # Pressing to teach fired no gesture.
    assert (recorder.taps, recorder.holds) == (0, 0)


def test_learn_press_low(rig):
    adapter, _, _, _ = rig
    result = start(adapter)
    adapter.handle_midi_bytes(cc(64, 0, channel=2))
    adapter.handle_midi_bytes(cc(64, 127, channel=2))
    assert result.learned == [FootMapping(3, 64, MOMENTARY, False)]


def test_learn_latching_when_no_release_in_the_window(rig):
    adapter, _, scheduler, _ = rig
    result = start(adapter)
    adapter.handle_midi_bytes(cc(80, 127))
    # The window check (scheduled at the first CC) ends it as latching.
    window = [fn for ms, fn in scheduler.scheduled if ms == 1500]
    assert len(window) == 1
    window[0]()
    assert result.learned == [FootMapping(10, 80, LATCHING, True)]
    scheduler.fire_all()
    assert result.timeouts == 0


def test_learn_times_out_when_nothing_is_heard(rig):
    adapter, _, scheduler, _ = rig
    result = start(adapter)
    assert [ms for ms, _ in scheduler.scheduled] == [10000]
    scheduler.fire_all()
    assert result.timeouts == 1
    assert result.learned == []
    assert not adapter.learning
    assert adapter.forwarded_ccs() == (20, 21, 23)  # back to the mapping


def test_stop_learn_cancels_without_a_callback(rig):
    adapter, _, scheduler, recorder = rig
    result = start(adapter)
    adapter.handle_midi_bytes(cc(80, 127))
    adapter.stop_learn()
    adapter.stop_learn()  # idempotent
    scheduler.fire_all()
    assert (result.learned, result.timeouts) == ([], 0)
    # The old mapping is still live.
    adapter.handle_midi_bytes(cc(23, 127))
    adapter.handle_midi_bytes(cc(23, 0))
    assert recorder.taps == 1


def test_restarting_learn_strands_the_first_session(rig):
    adapter, _, scheduler, _ = rig
    first = start(adapter)
    second = start(adapter)
    scheduler.fire_all()
    assert first.timeouts == 0
    assert second.timeouts == 1


def test_disconnect_ends_learn(rig):
    adapter, _, scheduler, _ = rig
    result = start(adapter)
    adapter.disconnect()
    scheduler.fire_all()
    assert not adapter.learning
    assert result.timeouts == 0
