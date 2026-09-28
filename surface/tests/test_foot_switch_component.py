"""FootSwitchComponent tests — the foot switch as a user setting.

- The seed: ``midiPedals.footSwitchCC`` when nothing is saved; nothing
  when neither is there (no default CC).
- A saved setting replaces the seed whole and survives re-creation.
- On / Off hand the router the mapping or nothing, and re-claim the CCs.
- On with nothing learned starts a learn.
- Learn: listening → learned (saved, on) or → timeout; cancel.
- Heard: the first CC of the mapping flips the state's last field.
- Wire shape: ``[enabled, channel, cc, mode, learn, heard]``.
"""

from __future__ import annotations

import json

import pytest

from components.FootSwitchComponent import (
    FootSwitchComponent,
    V3_FOOT_SWITCH_ADDRESS,
)
from components.midi_pedal_input import (
    LATCHING,
    FootMapping,
    MidiPedalInput,
)


class Scheduler:
    def __init__(self) -> None:
        self.scheduled = []

    def __call__(self, delay_ms, fn) -> None:
        self.scheduled.append((delay_ms, fn))

    def fire(self, delay_ms) -> None:
        pending, self.scheduled = self.scheduled, []
        for ms, fn in pending:
            if ms == delay_ms:
                fn()
            else:
                self.scheduled.append((ms, fn))


def cc(controller, value, channel_index=9):
    return (0xB0 | channel_index, controller, value)


class Rig:
    def __init__(self, tmp_path, constants=None, saved=None):
        self.path = tmp_path / "foot-switch.json"
        if saved is not None:
            self.path.write_text(json.dumps(saved))
        self.sent = []
        self.rebuilds = 0
        self.taps = 0
        self.scheduler = Scheduler()
        self.router = MidiPedalInput(
            constants=constants or {},
            on_foot_tap=self._tap,
            on_foot_hold=lambda: None,
            on_foot_heard=lambda: self.component.on_foot_heard(),
            schedule_delayed=self.scheduler,
        )
        self.component = FootSwitchComponent(
            emit=lambda address, args: self.sent.append((address, args)),
            constants=constants or {},
            router=self.router,
            request_midi_rebuild=self._rebuild,
            settings_path=str(self.path),
        )

    def _tap(self):
        self.taps += 1

    def _rebuild(self):
        self.rebuilds += 1

    @property
    def state(self):
        states = [args for address, args in self.sent
                  if address == V3_FOOT_SWITCH_ADDRESS]
        return states[-1]

    def saved(self):
        return json.loads(self.path.read_text())

    def stomp(self, controller=23, channel_index=9):
        self.router.handle_midi_bytes(cc(controller, 127, channel_index))
        self.router.handle_midi_bytes(cc(controller, 0, channel_index))


RIG_CONSTANTS = {"midiPedals": {"channel": 10, "footSwitchCC": 23}}


def test_no_seed_and_nothing_saved_is_no_foot_switch(tmp_path):
    rig = Rig(tmp_path)
    assert rig.state == (0, 0, -1, "", "idle", 0)
    assert rig.router.foot_mapping is None
    assert not rig.path.exists()


def test_seeded_from_midi_pedals(tmp_path):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    assert rig.state == (1, 10, 23, "momentary", "idle", 0)
    rig.stomp()
    assert rig.taps == 1
    assert rig.state[5] == 1  # heard


def test_saved_setting_wins_over_the_seed(tmp_path):
    saved = {
        "enabled": True,
        "mapping": {"channel": 1, "cc": 64, "mode": LATCHING, "pressHigh": True},
    }
    rig = Rig(tmp_path, constants=RIG_CONSTANTS, saved=saved)
    assert rig.state == (1, 1, 64, LATCHING, "idle", 0)
    assert rig.router.foot_mapping == FootMapping(1, 64, LATCHING)


def test_saved_off_stays_off(tmp_path):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS, saved={
        "enabled": False, "mapping": {"channel": 10, "cc": 23},
    })
    assert rig.state[:3] == (0, 10, 23)
    assert rig.router.foot_mapping is None


@pytest.mark.parametrize("raw", ["not json", "[]", '{"enabled": "yes"}'])
def test_unreadable_save_falls_back_to_the_seed(tmp_path, raw):
    (tmp_path / "foot-switch.json").write_text(raw)
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    assert rig.state[:3] == (1, 10, 23)


def test_off_and_on(tmp_path):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    before = rig.rebuilds
    rig.component.handle_set_enabled((0,), None)
    assert rig.state[0] == 0
    assert rig.router.foot_mapping is None
    assert rig.rebuilds == before + 1
    assert rig.saved() == {
        "enabled": False,
        "mapping": {"channel": 10, "cc": 23, "mode": "momentary",
                    "pressHigh": True},
    }
    rig.stomp()
    assert rig.taps == 0
    rig.component.handle_set_enabled((1,), None)
    rig.stomp()
    assert rig.taps == 1
    # A second Off persists across re-creation.
    rig.component.handle_set_enabled((0,), None)
    again = Rig(tmp_path, constants=RIG_CONSTANTS)
    assert again.state[0] == 0


@pytest.mark.parametrize("bad", [(), (2,), (0.5,), ("1",)])
def test_bad_writes_rejected(tmp_path, bad):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    sent = len(rig.sent)
    rig.component.handle_set_enabled(bad, None)
    rig.component.handle_learn(bad, None)
    assert len(rig.sent) == sent
    assert rig.state[0] == 1


def test_on_with_nothing_learned_starts_learn(tmp_path):
    rig = Rig(tmp_path)
    rig.component.handle_set_enabled((1,), None)
    assert rig.state[0] == 0
    assert rig.state[4] == "listening"
    assert rig.router.learning


def test_learn_success_saves_and_turns_on(tmp_path):
    rig = Rig(tmp_path)
    before = rig.rebuilds
    rig.component.handle_learn((1,), None)
    assert rig.rebuilds == before + 1  # claim every CC
    assert rig.state[4] == "listening"
    rig.stomp(controller=64, channel_index=0)
    assert rig.state == (1, 1, 64, "momentary", "idle", 0)
    assert rig.rebuilds == before + 2  # back to the one CC
    assert rig.taps == 0  # teaching it fired nothing
    assert rig.saved()["mapping"]["cc"] == 64
    rig.stomp(controller=64, channel_index=0)
    assert rig.taps == 1
    assert rig.state[5] == 1


def test_learn_latching(tmp_path):
    rig = Rig(tmp_path)
    rig.component.handle_learn((1,), None)
    rig.router.handle_midi_bytes(cc(80, 127))
    rig.scheduler.fire(1500)
    assert rig.state[:4] == (1, 10, 80, LATCHING)


def test_learn_timeout(tmp_path):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    rig.component.handle_learn((1,), None)
    rebuilds = rig.rebuilds
    rig.scheduler.fire(10000)
    assert rig.state == (1, 10, 23, "momentary", "timeout", 0)
    assert rig.rebuilds == rebuilds + 1
    rig.stomp()  # the old mapping is untouched
    assert rig.taps == 1


def test_learn_cancel(tmp_path):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    rig.component.handle_learn((1,), None)
    rig.component.handle_learn((0,), None)
    assert rig.state[4] == "idle"
    assert not rig.router.learning
    rig.stomp()
    assert rig.taps == 1


def test_emit_on_accept_and_disconnect(tmp_path):
    rig = Rig(tmp_path, constants=RIG_CONSTANTS)
    sent = len(rig.sent)
    rig.component.emit_on_accept()
    assert len(rig.sent) == sent + 1
    rig.component.handle_learn((1,), None)
    rig.component.disconnect()
    rig.component.disconnect()
    assert not rig.router.learning
    sent = len(rig.sent)
    rig.component.emit_on_accept()
    rig.component.handle_set_enabled((0,), None)
    assert len(rig.sent) == sent
