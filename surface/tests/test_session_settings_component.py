"""SessionSettingsComponent unit tests.

Covers the two runtime on/off toggles (``auto_arm``,
``move_volume_knob``) added 2026-04-22: init-emit at construction,
handler validate-and-reject, change-emit on set, no-change-still-emit
(mirrors PR-5d listener behavior), getters track current state,
emit_on_accept re-seeds both, disconnect silences further emits.

No LOM stub needed — the component is pure in-memory bools driven
by an ``emit`` closure.
"""

from __future__ import annotations

import pytest

from components.SessionSettingsComponent import (
    SessionSettingsComponent,
    V3_SESSION_AUTO_ARM_ADDRESS,
    V3_SESSION_AUTO_ARM_QUERY_ADDRESS,
    V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS,
    V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS,
    V3_SESSION_AUTO_CAPTURE_ADDRESS,
    V3_SESSION_KEY_FOLLOW_ADDRESS,
    V3_SESSION_KEY_FOLLOW_QUERY_ADDRESS,
)


@pytest.fixture
def emissions():
    return []


@pytest.fixture
def settings_file(tmp_path):
    """Isolated persistence path so tests never touch the repo's logs/ file."""
    return str(tmp_path / "session-settings.json")


@pytest.fixture
def component(emissions, settings_file):
    def emit(addr, args):
        emissions.append((addr, args))

    return SessionSettingsComponent(emit=emit, settings_path=settings_file)


def _emit(emissions, address):
    """Helper: return every (address, args) tuple for ``address``."""
    return [e for e in emissions if e[0] == address]


# --- init-emit ------------------------------------------------------------


def test_init_emits_both_defaults(emissions, component):
    """Cold init seeds UI with both defaults-on."""
    auto_arm_emits = _emit(emissions, V3_SESSION_AUTO_ARM_ADDRESS)
    knob_emits = _emit(emissions, V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS)
    assert auto_arm_emits == [(V3_SESSION_AUTO_ARM_ADDRESS, (1,))]
    assert knob_emits == [(V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, (1,))]


def test_init_getters_return_defaults(component):
    assert component.should_auto_arm() is True
    assert component.should_handle_move_volume_knob() is True


# --- handler: auto_arm ---------------------------------------------------


def test_handle_set_auto_arm_to_zero(emissions, component):
    emissions.clear()
    component.handle_set_auto_arm((0,), None)
    assert component.should_auto_arm() is False
    assert _emit(emissions, V3_SESSION_AUTO_ARM_ADDRESS) == [
        (V3_SESSION_AUTO_ARM_ADDRESS, (0,)),
    ]


def test_handle_set_auto_arm_to_one(emissions, component):
    component.handle_set_auto_arm((0,), None)
    emissions.clear()
    component.handle_set_auto_arm((1,), None)
    assert component.should_auto_arm() is True
    assert _emit(emissions, V3_SESSION_AUTO_ARM_ADDRESS) == [
        (V3_SESSION_AUTO_ARM_ADDRESS, (1,)),
    ]


def test_handle_set_auto_arm_same_value_still_emits(emissions, component):
    """No-op writes still echo — matches PR-5d listener semantics."""
    emissions.clear()
    component.handle_set_auto_arm((1,), None)
    assert _emit(emissions, V3_SESSION_AUTO_ARM_ADDRESS) == [
        (V3_SESSION_AUTO_ARM_ADDRESS, (1,)),
    ]


@pytest.mark.parametrize("bad", [2, -1, 99, "on", None, 0.5, float("nan")])
def test_handle_set_auto_arm_rejects_bad(emissions, component, bad):
    emissions.clear()
    component.handle_set_auto_arm((bad,), None)
    assert component.should_auto_arm() is True
    assert _emit(emissions, V3_SESSION_AUTO_ARM_ADDRESS) == []


def test_handle_set_auto_arm_empty_args(emissions, component):
    emissions.clear()
    component.handle_set_auto_arm((), None)
    assert component.should_auto_arm() is True
    assert _emit(emissions, V3_SESSION_AUTO_ARM_ADDRESS) == []


def test_handle_set_auto_arm_accepts_bool(emissions, component):
    emissions.clear()
    component.handle_set_auto_arm((False,), None)
    assert component.should_auto_arm() is False


# --- handler: move_volume_knob -------------------------------------------


def test_handle_set_move_volume_knob_to_zero(emissions, component):
    emissions.clear()
    component.handle_set_move_volume_knob((0,), None)
    assert component.should_handle_move_volume_knob() is False
    assert _emit(emissions, V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS) == [
        (V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, (0,)),
    ]


def test_handle_set_move_volume_knob_to_one(emissions, component):
    component.handle_set_move_volume_knob((0,), None)
    emissions.clear()
    component.handle_set_move_volume_knob((1,), None)
    assert component.should_handle_move_volume_knob() is True
    assert _emit(emissions, V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS) == [
        (V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, (1,)),
    ]


@pytest.mark.parametrize("bad", [2, -1, "off", None, 3.14])
def test_handle_set_move_volume_knob_rejects_bad(emissions, component, bad):
    emissions.clear()
    component.handle_set_move_volume_knob((bad,), None)
    assert component.should_handle_move_volume_knob() is True
    assert _emit(emissions, V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS) == []


# --- handler: auto_arm query (read-only, reply-to-sender) ----------------


def test_query_auto_arm_address_has_query_suffix():
    """The reply lands on the query address; clients must listen there.

    Symmetric with ``test_query_move_volume_knob_address_has_query_suffix`` —
    catches a future rename/typo on the auto_arm side.
    """
    assert V3_SESSION_AUTO_ARM_QUERY_ADDRESS == (
        V3_SESSION_AUTO_ARM_ADDRESS + "/query"
    )


def test_query_auto_arm_returns_default_tuple(emissions, component):
    """Query returns the current value as a 1-tuple for reply-to-sender."""
    emissions.clear()
    reply = component.handle_query_auto_arm((), object())
    assert reply == (1,)


def test_query_auto_arm_tracks_state(component):
    component.handle_set_auto_arm((0,), None)
    assert component.handle_query_auto_arm((), None) == (0,)
    component.handle_set_auto_arm((1,), None)
    assert component.handle_query_auto_arm((), None) == (1,)


def test_query_auto_arm_does_not_broadcast(emissions, component):
    """Query is read-only: no _emit broadcast, no state change.

    The reply rides the transport's return-tuple path (to source_addr),
    not the broadcast emit. So nothing lands in ``emissions`` and the
    value is untouched.
    """
    emissions.clear()
    before = component.should_auto_arm()
    component.handle_query_auto_arm((1,), None)  # arg ignored
    assert emissions == []
    assert component.should_auto_arm() is before


def test_query_auto_arm_ignores_args(component):
    """Args are presence-only; even a contradictory arg can't flip state."""
    component.handle_set_auto_arm((0,), None)
    # Arg says 1, but query must not write — value stays 0.
    assert component.handle_query_auto_arm((1,), None) == (0,)
    assert component.should_auto_arm() is False


def test_query_auto_arm_silent_after_disconnect(component):
    component.disconnect()
    assert component.handle_query_auto_arm((), None) is None


# --- handler: move_volume_knob query (read-only, reply-to-sender) ---------


def test_query_move_volume_knob_address_has_query_suffix():
    """The reply lands on the query address; clients must listen there."""
    assert V3_SESSION_MOVE_VOLUME_KNOB_QUERY_ADDRESS == (
        V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS + "/query"
    )


def test_query_move_volume_knob_returns_default_tuple(emissions, component):
    emissions.clear()
    assert component.handle_query_move_volume_knob((), object()) == (1,)


def test_query_move_volume_knob_tracks_state(component):
    component.handle_set_move_volume_knob((0,), None)
    assert component.handle_query_move_volume_knob((), None) == (0,)
    component.handle_set_move_volume_knob((1,), None)
    assert component.handle_query_move_volume_knob((), None) == (1,)


def test_query_move_volume_knob_does_not_broadcast(emissions, component):
    emissions.clear()
    before = component.should_handle_move_volume_knob()
    component.handle_query_move_volume_knob((0,), None)  # arg ignored
    assert emissions == []
    assert component.should_handle_move_volume_knob() is before


def test_query_move_volume_knob_silent_after_disconnect(component):
    component.disconnect()
    assert component.handle_query_move_volume_knob((), None) is None


# --- emit_on_accept -------------------------------------------------------


def test_emit_on_accept_re_seeds_all(emissions, component):
    component.handle_set_auto_arm((0,), None)
    component.handle_set_move_volume_knob((0,), None)
    component.handle_set_auto_capture((0,), None)
    emissions.clear()
    component.emit_on_accept()
    assert emissions == [
        (V3_SESSION_AUTO_ARM_ADDRESS, (0,)),
        (V3_SESSION_MOVE_VOLUME_KNOB_ADDRESS, (0,)),
        (V3_SESSION_AUTO_CAPTURE_ADDRESS, (0,)),
        (V3_SESSION_KEY_FOLLOW_ADDRESS, (1,)),
    ]


# --- auto_capture: toggle + mode-derived default --------------------------


def test_auto_capture_cold_default_is_off(emissions, component):
    """Before the mode is known, capture defaults OFF (dev-safe)."""
    assert component.should_auto_capture() is False
    assert _emit(emissions, V3_SESSION_AUTO_CAPTURE_ADDRESS) == [
        (V3_SESSION_AUTO_CAPTURE_ADDRESS, (0,)),
    ]


def test_handle_set_auto_capture_to_one(emissions, component):
    emissions.clear()
    component.handle_set_auto_capture((1,), None)
    assert component.should_auto_capture() is True
    assert _emit(emissions, V3_SESSION_AUTO_CAPTURE_ADDRESS) == [
        (V3_SESSION_AUTO_CAPTURE_ADDRESS, (1,)),
    ]


def test_query_auto_capture_returns_state(component):
    assert component.handle_query_auto_capture((), None) == (0,)
    component.handle_set_auto_capture((1,), None)
    assert component.handle_query_auto_capture((), None) == (1,)


def test_seed_ipad_turns_capture_on(emissions, component):
    """First heartbeat reveals ipad → default flips ON (and emits)."""
    emissions.clear()
    component.seed_auto_capture_default(True)
    assert component.should_auto_capture() is True
    assert _emit(emissions, V3_SESSION_AUTO_CAPTURE_ADDRESS) == [
        (V3_SESSION_AUTO_CAPTURE_ADDRESS, (1,)),
    ]


def test_seed_dev_keeps_capture_off_without_emit(emissions, component):
    """dev seed matches the cold default → no change, no redundant emit."""
    emissions.clear()
    component.seed_auto_capture_default(False)
    assert component.should_auto_capture() is False
    assert _emit(emissions, V3_SESSION_AUTO_CAPTURE_ADDRESS) == []


def test_user_override_survives_later_mode_seed(component):
    """User forces capture ON, then an ipad→dev seed lands late: the
    deliberate override must win over the mode default."""
    component.handle_set_auto_capture((1,), None)  # user forces ON
    component.seed_auto_capture_default(False)      # dev seed arrives late
    assert component.should_auto_capture() is True  # override survives


def test_user_override_off_survives_ipad_seed(component):
    """Symmetric: user forces OFF during ipad, seed must not turn it on."""
    component.handle_set_auto_capture((0,), None)   # user forces OFF
    component.seed_auto_capture_default(True)        # ipad seed
    assert component.should_auto_capture() is False


def test_second_seed_is_ignored(component):
    """Only the first seed commits; a contradictory second one no-ops."""
    component.seed_auto_capture_default(True)
    component.seed_auto_capture_default(False)
    assert component.should_auto_capture() is True


def test_seed_after_disconnect_is_noop(emissions, component):
    component.disconnect()
    emissions.clear()
    component.seed_auto_capture_default(True)
    assert component.should_auto_capture() is False
    assert emissions == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_silences_further_emits(emissions, component):
    component.disconnect()
    emissions.clear()
    component.handle_set_auto_arm((0,), None)
    component.emit_on_accept()
    assert emissions == []


def test_disconnect_freezes_set_handler_state(component):
    """After disconnect, set handlers must not mutate in-memory state.

    Previously the emit was silenced but the value still changed — an
    inconsistent contract vs. the query handlers (which return None on
    disconnect). Both set handlers now guard on ``_disconnected``.
    """
    assert component.should_auto_arm() is True
    assert component.should_handle_move_volume_knob() is True
    component.disconnect()
    component.handle_set_auto_arm((0,), None)
    component.handle_set_move_volume_knob((0,), None)
    assert component.should_auto_arm() is True
    assert component.should_handle_move_volume_knob() is True


def test_disconnect_is_idempotent(component):
    component.disconnect()
    component.disconnect()
    # No raise.


# --- independence --------------------------------------------------------


def test_toggles_are_independent(component):
    """Flipping one doesn't affect the other."""
    component.handle_set_auto_arm((0,), None)
    assert component.should_auto_arm() is False
    assert component.should_handle_move_volume_knob() is True
    component.handle_set_move_volume_knob((0,), None)
    assert component.should_auto_arm() is False
    assert component.should_handle_move_volume_knob() is False
    component.handle_set_auto_arm((1,), None)
    assert component.should_auto_arm() is True
    assert component.should_handle_move_volume_knob() is False


# --- persistence across surface teardown (set load / Live restart) --------
#
# Live reconstructs the whole Control Surface on set load, so a fresh
# component must reload the user's last auto_arm / move_volume_knob from disk.
# auto_capture is deliberately NOT persisted — it re-seeds from launch mode.


def _new(emissions, settings_file):
    def emit(addr, args):
        emissions.append((addr, args))
    return SessionSettingsComponent(emit=emit, settings_path=settings_file)


def test_auto_arm_persists_across_new_instance(settings_file):
    c1 = _new([], settings_file)
    c1.handle_set_auto_arm((0,), None)  # user turns it off
    # New surface (set load): a fresh instance reads the persisted value.
    c2 = _new([], settings_file)
    assert c2.should_auto_arm() is False


def test_move_volume_knob_persists_across_new_instance(settings_file):
    c1 = _new([], settings_file)
    c1.handle_set_move_volume_knob((0,), None)
    c2 = _new([], settings_file)
    assert c2.should_handle_move_volume_knob() is False


def test_defaults_on_when_no_persisted_file(settings_file):
    """Fresh install (no file) → both default on."""
    c = _new([], settings_file)
    assert c.should_auto_arm() is True
    assert c.should_handle_move_volume_knob() is True


def test_auto_capture_not_persisted_reseeds_by_mode(settings_file):
    """auto_capture override does NOT survive a new instance — it re-seeds
    from the launch mode each init (dev↔ipad switch shouldn't reuse a stale
    cross-mode value)."""
    c1 = _new([], settings_file)
    c1.seed_auto_capture_default(True)         # ipad session → ON
    c1.handle_set_auto_capture((0,), None)     # user forces OFF this session
    assert c1.should_auto_capture() is False
    # New surface: back to cold default, then re-seeds from whatever mode says.
    c2 = _new([], settings_file)
    assert c2.should_auto_capture() is False   # cold default before seed
    c2.seed_auto_capture_default(True)         # ipad again → ON (not the stale OFF)
    assert c2.should_auto_capture() is True


def test_persist_survives_corrupt_file(settings_file):
    with open(settings_file, "w") as f:
        f.write("not json{")
    c = _new([], settings_file)  # must not raise
    assert c.should_auto_arm() is True         # falls back to defaults
    assert c.should_handle_move_volume_knob() is True


def test_persist_ignores_non_bool_values(settings_file):
    import json as _json
    with open(settings_file, "w") as f:
        _json.dump({"auto_arm": "yes", "move_volume_knob": 0}, f)
    c = _new([], settings_file)
    # Non-bool per-key → ignored, that key keeps its default (on).
    assert c.should_auto_arm() is True
    assert c.should_handle_move_volume_knob() is True


def test_no_persist_when_path_unresolvable(monkeypatch):
    """settings_path=None + unresolvable repo root → in-memory only, no raise."""
    import components.SessionSettingsComponent as mod
    monkeypatch.setattr(mod, "_find_repo_logs_path", lambda *a, **k: None)
    c = SessionSettingsComponent(emit=lambda a, b: None)  # settings_path=None
    c.handle_set_auto_arm((0,), None)  # must not raise despite no file
    assert c.should_auto_arm() is False


def test_retired_sequencer_engine_key_is_ignored(settings_file):
    # 2026-09-26: the switch is gone (the engine always runs). A file an
    # older surface wrote still loads, and the next write drops the key.
    import json as _json
    with open(settings_file, "w") as f:
        _json.dump({"auto_arm": False, "sequencer_engine": True}, f)
    c = SessionSettingsComponent(emit=lambda a, b: None, settings_path=settings_file)
    assert c.should_auto_arm() is False
    c.handle_set_auto_arm((1,), None)
    with open(settings_file) as f:
        assert "sequencer_engine" not in _json.load(f)


# --- key_follow (ADR-447) ---------------------------------------------------


def test_key_follow_defaults_on_and_init_emits_one(emissions, component):
    assert component.should_follow_key() is True
    assert _emit(emissions, V3_SESSION_KEY_FOLLOW_ADDRESS) == [
        (V3_SESSION_KEY_FOLLOW_ADDRESS, (1,)),
    ]


def test_key_follow_set_echoes_and_is_not_persisted(emissions, component, settings_file):
    """A lock lasts until the surface is re-created: a Live restart or a set
    load begins with Follow on again."""
    import json as _json
    component.handle_set_key_follow((0,), None)
    assert component.should_follow_key() is False
    assert _emit(emissions, V3_SESSION_KEY_FOLLOW_ADDRESS)[-1] == (
        V3_SESSION_KEY_FOLLOW_ADDRESS, (0,),
    )
    component.handle_set_auto_arm((0,), None)  # something else writes the file
    with open(settings_file) as f:
        assert "key_follow" not in _json.load(f)
    rebuilt = SessionSettingsComponent(emit=lambda a, args: None, settings_path=settings_file)
    assert rebuilt.should_follow_key() is True


def test_a_settings_file_that_still_says_locked_is_ignored(tmp_path):
    """The afternoon's persisted lock must not keep Follow off after this change."""
    import json as _json
    path = tmp_path / "session-settings.json"
    path.write_text(_json.dumps({"auto_arm": True, "key_follow": False}))
    comp = SessionSettingsComponent(emit=lambda a, args: None, settings_path=str(path))
    assert comp.should_follow_key() is True

def test_key_follow_rejects_non_bool01(emissions, component):
    before = component.should_follow_key()
    for bad in ((2,), ("1",), (), (float("nan"),)):
        component.handle_set_key_follow(bad, None)
    assert component.should_follow_key() is before


def test_key_follow_query_replies_to_asker_without_broadcast(emissions, component):
    n = len(_emit(emissions, V3_SESSION_KEY_FOLLOW_ADDRESS))
    assert component.handle_query_key_follow((), None) == (1,)
    assert len(_emit(emissions, V3_SESSION_KEY_FOLLOW_ADDRESS)) == n


def test_key_follow_is_re_emitted_on_accept(emissions, component):
    emissions.clear()
    component.emit_on_accept()
    assert (V3_SESSION_KEY_FOLLOW_ADDRESS, (1,)) in emissions
