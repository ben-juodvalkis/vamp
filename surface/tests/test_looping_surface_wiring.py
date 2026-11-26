"""A whole ``LoopingSurface``, built without Live (``tests/support/surface_harness.py``).

The fixture ``fixtures/looping_surface_wiring.json`` is every ``add_handler``
the surface made, in order and with the method each address reaches, captured
from the code before ``__init__`` was split into ``_setup_*`` methods
(2026-11-25). The split must not add, drop, reorder or re-point a handler. A
deliberate wiring change updates the fixture in the same commit.
"""

from __future__ import annotations

import json
from pathlib import Path

from tests.support.surface_harness import build_surface

FIXTURE = Path(__file__).parent / "fixtures" / "looping_surface_wiring.json"


def _owner(fn) -> str:
    return "%s.%s" % (type(getattr(fn, "__self__", None)).__name__, getattr(fn, "__name__", "?"))


def test_the_surface_registers_the_recorded_handlers(monkeypatch):
    expected = json.loads(FIXTURE.read_text())
    _surface, udp = build_surface(monkeypatch)
    assert [[a, _owner(h)] for a, h in udp.handlers] == expected["handlers"]
    assert [_owner(h) for h in udp.drain_hooks] == expected["drain_hooks"]


def test_the_sequencer_rides_the_pump(monkeypatch):
    expected = json.loads(FIXTURE.read_text())
    surface, _udp = build_surface(monkeypatch)
    assert len(surface._drain_pump.tick_hooks) == expected["tick_hooks"]


def test_disconnect_tears_down_every_component_once_in_reverse(monkeypatch):
    surface, udp = build_surface(monkeypatch)
    owned = list(surface._components)
    names = {id(v): k for k, v in vars(surface).items()}
    calls = []
    for comp in owned:
        real = comp.disconnect
        comp.disconnect = lambda _c=comp, _r=real: (calls.append(names[id(_c)]), _r())

    surface.disconnect()

    assert calls == [names[id(c)] for c in reversed(owned)]
    # The drum pad-chain component sat inside the drum provider's guard and
    # was never released (2026-11-25).
    assert "_drum_pad_chain_component" in calls
    for name in calls:
        assert getattr(surface, name) is None, name
    assert udp.closed and surface._transport is None


def test_one_raising_component_does_not_strand_the_rest(monkeypatch):
    surface, _udp = build_surface(monkeypatch)
    victim = surface._sequencer_component

    def boom():
        raise RuntimeError("restore failed")

    victim.disconnect = boom
    lom = surface._lom_listeners
    surface.disconnect()
    assert lom._disconnected, "a raise mid-walk left LOMListeners attached"
    assert surface._sequencer_component is None


_ACCEPT_SEEDS = (
    "_session_component",
    "_session_settings_component",
    "_clip_properties_component",
    "_clip_notes_component",
    "_selected_track_component",
    "_device_commands_component",
    "_exclusive_arm_component",
    "_groove_pool_component",
    "_groove_component",
    "_playhead_component",
)


def _record_seeds(monkeypatch, surface, ran, raising=()):
    for attr in _ACCEPT_SEEDS:
        def seed(_a=attr):
            ran.append(_a)
            if _a in raising:
                raise RuntimeError("seed failed")
        monkeypatch.setattr(getattr(surface, attr), "emit_on_accept", seed)


def test_one_raising_accept_seed_does_not_skip_the_rest(monkeypatch):
    """Code review, 2026-11-25: one raising ``emit_on_accept`` used to skip
    every later seed (selected track, arm, playhead)."""
    surface, _udp = build_surface(monkeypatch)
    ran, trees = [], []
    _record_seeds(monkeypatch, surface, ran, raising=("_session_component",))
    monkeypatch.setattr(
        surface._v3_state_full_component, "emit_on_accept",
        lambda session_id=None, client_etag=None: trees.append((session_id, client_etag)),
    )

    surface._handshake_component._on_accept_state_full(session_id="s1", client_etag=7)

    assert trees == [("s1", 7)]
    assert ran == list(_ACCEPT_SEEDS)


def test_a_raising_resync_tree_still_reseeds_the_playhead(monkeypatch):
    surface, _udp = build_surface(monkeypatch)
    ran = []
    _record_seeds(monkeypatch, surface, ran)

    def boom(session_id=None, client_etag=None):
        raise RuntimeError("publish failed")

    monkeypatch.setattr(surface._v3_state_full_component, "emit_on_resync", boom)
    surface._devices_component._state_full_on_resync(session_id="s1", client_etag=None)

    assert ran == ["_playhead_component"]
