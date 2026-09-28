"""ServerPresenceComponent unit tests.

Covers the bridge-heartbeat-driven "is the dev server running?" gate:
starts absent, a heartbeat makes it present, presence lapses after the
grace window, ``mark_alive`` (used by the handshake-accept chain)
refreshes without a wire heartbeat, and disconnect freezes the
component so late fires / queries are no-ops.

The clock is injected so elapsed time is deterministic — no sleeping.
"""

from __future__ import annotations

import pytest

from components.ServerPresenceComponent import (
    ServerPresenceComponent,
    V3_SERVER_HEARTBEAT_ADDRESS,
    DEFAULT_GRACE_WINDOW_SECONDS,
    compose_auto_arm_gate,
    compose_key_follow_gate,
    compose_capture_gate,
)


class FakeClock:
    """Injectable monotonic clock. ``advance`` moves it forward."""

    def __init__(self, start: float = 1000.0):
        self._t = float(start)

    def __call__(self) -> float:
        return self._t

    def advance(self, seconds: float) -> None:
        self._t += float(seconds)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def component(clock):
    return ServerPresenceComponent(grace_window_s=6.0, now=clock)


# --- cold start -----------------------------------------------------------


def test_absent_before_first_heartbeat(component):
    """No heartbeat seen yet → server considered absent."""
    assert component.server_present() is False
    assert component.last_seen is None


def test_default_grace_window_when_unspecified(clock):
    c = ServerPresenceComponent(now=clock)
    c.handle_heartbeat((1, 0), ("127.0.0.1", 5))
    clock.advance(DEFAULT_GRACE_WINDOW_SECONDS - 0.01)
    assert c.server_present() is True
    clock.advance(0.02)
    assert c.server_present() is False


# --- heartbeat drives presence -------------------------------------------


def test_heartbeat_makes_present(component, clock):
    component.handle_heartbeat((1, 12345), ("127.0.0.1", 5))
    assert component.server_present() is True
    assert component.last_seen == clock()


def test_presence_lapses_after_grace_window(component, clock):
    component.handle_heartbeat((1, 0), ("127.0.0.1", 5))
    assert component.server_present() is True
    # Just inside the window: still present.
    clock.advance(6.0)
    assert component.server_present() is True
    # Past the window: absent.
    clock.advance(0.01)
    assert component.server_present() is False


def test_repeated_heartbeats_keep_present(component, clock):
    """A steady beat inside the window never lapses (quiet performance)."""
    for _ in range(10):
        component.handle_heartbeat((1, 0), ("127.0.0.1", 5))
        clock.advance(2.0)  # bridge default cadence — well inside grace
        assert component.server_present() is True


def test_recovers_after_lapse(component, clock):
    """Server gone then back: a fresh heartbeat re-establishes presence."""
    component.handle_heartbeat((1, 0), ("127.0.0.1", 5))
    clock.advance(100.0)  # server quit
    assert component.server_present() is False
    component.handle_heartbeat((2, 0), ("127.0.0.1", 5))  # server back
    assert component.server_present() is True


# --- mark_alive (handshake-accept path) ----------------------------------


def test_mark_alive_refreshes_without_wire_heartbeat(component, clock):
    """The accept chain calls mark_alive directly — no OSC message."""
    assert component.server_present() is False
    component.mark_alive()
    assert component.server_present() is True


def test_mark_alive_closes_the_restart_race(component, clock):
    """After a surface restart the component is absent; the handshake
    accept's mark_alive makes it present before the first post-restart
    heartbeat lands (the set-load / Live-restart recovery guarantee)."""
    # Fresh surface: no heartbeat yet.
    assert component.server_present() is False
    # Handshake accept fires (re-hello triggered by surface/hello).
    component.mark_alive()
    assert component.server_present() is True


# --- disconnect -----------------------------------------------------------


def test_disconnect_reports_absent(component):
    component.mark_alive()
    assert component.server_present() is True
    component.disconnect()
    assert component.server_present() is False


def test_heartbeat_after_disconnect_is_noop(component):
    component.disconnect()
    component.handle_heartbeat((1, 0), ("127.0.0.1", 5))
    assert component.last_seen is None
    assert component.server_present() is False


def test_mark_alive_after_disconnect_is_noop(component):
    component.disconnect()
    component.mark_alive()
    assert component.last_seen is None


def test_disconnect_is_idempotent(component):
    component.disconnect()
    component.disconnect()
    assert component.server_present() is False


# --- handler contract -----------------------------------------------------


def test_handle_heartbeat_returns_none(component):
    """No reply — presence is arrival-time driven, not request/response."""
    assert component.handle_heartbeat((1, 0), ("127.0.0.1", 5)) is None


def test_address_constant_is_bridge_to_surface():
    """Distinct from the surface→bridge /looping/v3/bridge/heartbeat."""
    assert V3_SERVER_HEARTBEAT_ADDRESS == "/looping/v3/server/heartbeat"


# --- launch mode (3rd heartbeat arg) --------------------------------------


def test_mode_none_before_any_heartbeat(component):
    assert component.mode is None
    assert component.is_ipad_present() is False


def test_heartbeat_records_ipad_mode(component):
    component.handle_heartbeat((1, 0, "ipad"), ("127.0.0.1", 5))
    assert component.mode == "ipad"
    assert component.is_ipad_present() is True


def test_heartbeat_records_dev_mode(component):
    component.handle_heartbeat((1, 0, "dev"), ("127.0.0.1", 5))
    assert component.mode == "dev"
    # Present, but not ipad → ipad-gated behaviors stay off.
    assert component.server_present() is True
    assert component.is_ipad_present() is False


def test_two_arg_heartbeat_leaves_mode_untouched(component):
    """An older bridge sends only [seq, epochMs]; mode stays last-known."""
    component.handle_heartbeat((1, 0, "ipad"), ("127.0.0.1", 5))
    assert component.mode == "ipad"
    component.handle_heartbeat((2, 0), ("127.0.0.1", 5))  # legacy 2-arg
    assert component.mode == "ipad"  # unchanged
    assert component.is_ipad_present() is True


def test_is_ipad_present_false_when_lapsed(component, clock):
    component.handle_heartbeat((1, 0, "ipad"), ("127.0.0.1", 5))
    assert component.is_ipad_present() is True
    clock.advance(100.0)  # server quit
    assert component.is_ipad_present() is False


def test_mode_can_switch_dev_to_ipad(component):
    component.handle_heartbeat((1, 0, "dev"), ("127.0.0.1", 5))
    assert component.is_ipad_present() is False
    component.handle_heartbeat((2, 0, "ipad"), ("127.0.0.1", 5))
    assert component.is_ipad_present() is True


# --- on_first_mode callback (seeds SessionSettings.auto_capture) -----------


def test_on_first_mode_fires_once_with_mode(clock):
    seen = []
    c = ServerPresenceComponent(
        grace_window_s=6.0, now=clock, on_first_mode=seen.append,
    )
    c.handle_heartbeat((1, 0, "ipad"), ("127.0.0.1", 5))
    assert seen == ["ipad"]
    # Subsequent heartbeats (even mode switches) do not re-fire.
    c.handle_heartbeat((2, 0, "ipad"), ("127.0.0.1", 5))
    c.handle_heartbeat((3, 0, "dev"), ("127.0.0.1", 5))
    assert seen == ["ipad"]


def test_on_first_mode_not_fired_by_modeless_heartbeat(clock):
    """A legacy 2-arg heartbeat carries no mode → callback stays silent."""
    seen = []
    c = ServerPresenceComponent(
        grace_window_s=6.0, now=clock, on_first_mode=seen.append,
    )
    c.handle_heartbeat((1, 0), ("127.0.0.1", 5))
    assert seen == []
    # The first mode-carrying heartbeat then fires it.
    c.handle_heartbeat((2, 0, "dev"), ("127.0.0.1", 5))
    assert seen == ["dev"]


def test_on_first_mode_callback_error_does_not_break_heartbeat(clock):
    def boom(_mode):
        raise RuntimeError("seed failed")

    c = ServerPresenceComponent(
        grace_window_s=6.0, now=clock, on_first_mode=boom,
    )
    # Must not propagate — presence tracking still works.
    c.handle_heartbeat((1, 0, "ipad"), ("127.0.0.1", 5))
    assert c.is_ipad_present() is True


# --- composed capture gate (auto_capture toggle) --------------------------
#
# The gate moved off ServerPresence onto SessionSettings.auto_capture
# (2026-07-06 capture toggle). The ipad/dev distinction now lives in that
# toggle's *default seed* (exercised in test_session_settings_component.py),
# not in this gate — so here we just verify the gate reads the toggle.


class _FakeCaptureSetting:
    def __init__(self, on: bool):
        self._on = on

    def should_auto_capture(self) -> bool:
        return self._on


def test_capture_gate_true_when_setting_on():
    assert compose_capture_gate(_FakeCaptureSetting(True)) is True


def test_capture_gate_false_when_setting_off():
    assert compose_capture_gate(_FakeCaptureSetting(False)) is False


def test_capture_gate_false_when_settings_none():
    """Teardown guard: dropped settings never captures."""
    assert compose_capture_gate(None) is False


# --- composed gate (LoopingSurface._should_auto_arm_in_performance) --------
#
# The gate wired into ExclusiveArmComponent is
# ``compose_auto_arm_gate(session_settings, server_presence)``.
# LoopingSurface can't be imported under test (needs Live's
# ``ableton.v3.control_surface``), so the composition lives in this free
# function and is truth-tabled here. LoopingSurface's method is a thin
# ``getattr`` wrapper that feeds ``None`` for a dropped component.


class _FakeSettings:
    def __init__(self, on: bool):
        self._on = on

    def should_auto_arm(self) -> bool:
        return self._on


class _FakePresence:
    def __init__(self, present: bool):
        self._present = present

    def server_present(self) -> bool:
        return self._present


def test_gate_true_only_when_both_true():
    """Arm only when the user opted in AND the server is present."""
    assert compose_auto_arm_gate(_FakeSettings(True), _FakePresence(True)) is True


def test_gate_false_when_auto_arm_off():
    """Manual override wins even while the server is up."""
    assert compose_auto_arm_gate(_FakeSettings(False), _FakePresence(True)) is False


def test_gate_false_when_server_absent():
    """Server down → quiet even with auto_arm on (production / cleanup)."""
    assert compose_auto_arm_gate(_FakeSettings(True), _FakePresence(False)) is False


def test_gate_false_when_both_off():
    assert compose_auto_arm_gate(_FakeSettings(False), _FakePresence(False)) is False


def test_gate_false_when_settings_none():
    """Teardown guard: a dropped settings component never arms."""
    assert compose_auto_arm_gate(None, _FakePresence(True)) is False


def test_gate_false_when_presence_none():
    """Teardown guard: a dropped presence component never arms — the
    specific 'flips to True when presence is None' regression."""
    assert compose_auto_arm_gate(_FakeSettings(True), None) is False


def test_gate_false_when_both_none():
    assert compose_auto_arm_gate(None, None) is False


def test_gate_short_circuits_before_presence_when_auto_arm_off():
    """auto_arm off returns False without touching presence — so the
    manual override holds even if presence would raise."""

    class _Boom:
        def server_present(self):  # pragma: no cover - must not run
            raise AssertionError("presence must not be consulted")

    assert compose_auto_arm_gate(_FakeSettings(False), _Boom()) is False



# --- key Follow gate (ADR-447) ----------------------------------------------


class _FollowSettings:
    def __init__(self, on):
        self.on = on

    def should_follow_key(self):
        return self.on


class _Presence:
    def __init__(self, present):
        self.present = present

    def server_present(self):
        return self.present


@pytest.mark.parametrize("toggle, present, expected", [
    (True, True, True),
    (True, False, False),   # bare Live: the key is never rewritten
    (False, True, False),
    (False, False, False),
])
def test_key_follow_needs_the_toggle_and_the_server(toggle, present, expected):
    assert compose_key_follow_gate(_FollowSettings(toggle), _Presence(present)) is expected


def test_key_follow_gate_reads_false_in_teardown():
    assert compose_key_follow_gate(None, _Presence(True)) is False
    assert compose_key_follow_gate(_FollowSettings(True), None) is False
