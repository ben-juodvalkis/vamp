"""MutationComponent unit tests — per-address mutation fires.

Covers ``on_param_value_changed`` (the single v3 mutation address)
plus the per-param echo-suppression contract that ``DevicesComponent``
relies on. The component owns no LOM listeners directly; the
bookkeeper's discipline is covered separately in
``test_lom_listeners.py``.

``on_param_value_changed`` receives ``(parameter, canonical_path)``;
MutationComponent emits ``/looping/v3/param/value [path, value]``.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.LOMListeners import LOMListeners
from components.MutationComponent import (
    MutationComponent,
    V3_PARAM_DISPLAY_ADDRESS,
    V3_PARAM_VALUE_ADDRESS,
)
from tests.test_lom_listeners import (
    StubDevice, StubParam, StubSong, StubTrack, make_param,
)


class StubParamWithDisplay(StubParam):
    """StubParam with a controllable ``__str__`` for display-fire tests.

    Live's real ``DeviceParameter.__str__`` returns the GUI-formatted
    value (``"440 Hz"``, ``"-12.0 dB"``). The default StubParam has
    no ``__str__``; this subclass exposes a ``display`` slot that the
    test can update alongside ``set_value``.
    """

    def __init__(self, *args, display: str = "0.0", **kwargs):
        super().__init__(*args, **kwargs)
        self.display = display

    def __str__(self) -> str:
        return self.display

    def set_value_and_display(self, value: float, display: str) -> None:
        self.display = display
        self.set_value(value)


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def wired():
    """Build LOMListeners + mutation wired through ``set_mutation_callbacks``.

    Returns ``(listeners, mutation, song, t1, t2, emits)`` where ``emits``
    is a list the mutation appends ``(address, args)`` to.
    """
    p301 = StubParam(pid=301, name="macro1", value=0.25, min_v=0.0, max_v=1.0)
    p302 = StubParam(pid=302, name="macro2", value=64.0, min_v=0.0, max_v=127.0)
    d200 = StubDevice(did=200, params=[p301, p302], name="Rack",
                      class_name="AudioEffectRack")
    t1 = StubTrack(tid=100, devices=[d200], name="T1")

    p303 = StubParam(pid=303, name="gain", value=0.5)
    d201 = StubDevice(did=201, params=[p303], name="Utility",
                      class_name="Utility")
    t2 = StubTrack(tid=101, devices=[d201], name="T2")

    song = StubSong(tracks=[t1, t2])
    reg = LOMListeners(song=song)

    emits: List[Tuple[str, tuple]] = []
    mut = MutationComponent(listeners=reg, emit=lambda a, args: emits.append((a, args)))
    # Param value-listeners are attached during ``LOMListeners.__init__``;
    # the listener closures read ``self._on_param_value_changed`` at fire
    # time, so installing callbacks here takes effect without re-attach.
    reg.set_mutation_callbacks(
        on_param_value_changed=mut.on_param_value_changed,
    )
    return reg, mut, song, t1, t2, emits


# --- param value emit ------------------------------------------------------


def test_param_value_change_emits(wired):
    """A LOM value-change fire turns into one v3 param/value emit."""
    _reg, _mut, _song, t1, _t2, emits = wired
    t1.devices[0].parameters[0].set_value(0.75)
    v3_emits = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3_emits) == 1
    path, value = v3_emits[0][1]
    assert path == "tracks/0/devices/0/params/0"
    assert value == pytest.approx(0.75)


def test_param_value_emits_per_param_in_order(wired):
    """Two distinct params each fire one v3 emit independently."""
    _reg, _mut, _song, t1, _t2, emits = wired
    t1.devices[0].parameters[0].set_value(0.1)
    t1.devices[0].parameters[1].set_value(99.0)
    v3_emits = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3_emits) == 2
    assert v3_emits[0][1][0] == "tracks/0/devices/0/params/0"
    assert v3_emits[0][1][1] == pytest.approx(0.1)
    assert v3_emits[1][1][0] == "tracks/0/devices/0/params/1"
    assert v3_emits[1][1][1] == pytest.approx(99.0)


def test_param_value_nan_skipped(wired):
    """A NaN value never reaches the wire."""
    _reg, _mut, _song, t1, _t2, emits = wired
    t1.devices[0].parameters[0].set_value(float("nan"))
    assert emits == []


# --- suppression ------------------------------------------------------------


def test_suppression_consumes_one_fire(wired):
    """``arm_suppression`` swallows exactly the next fire for that param."""
    _reg, mut, _song, t1, _t2, emits = wired
    mut.arm_suppression(301)
    t1.devices[0].parameters[0].set_value(0.5)  # echo of arm — drop
    assert emits == []
    t1.devices[0].parameters[0].set_value(0.8)  # genuine fire — emit
    v3 = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3) == 1
    assert v3[0][1][1] == pytest.approx(0.8)


def test_suppression_per_param_keyed(wired):
    """Arming param 301 must not silence param 302's fire."""
    _reg, mut, _song, t1, _t2, emits = wired
    mut.arm_suppression(301)
    t1.devices[0].parameters[1].set_value(50.0)  # 302 — emits
    v3 = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3) == 1
    assert v3[0][1][0] == "tracks/0/devices/0/params/1"
    # 301's flag is still armed for its own next fire.
    t1.devices[0].parameters[0].set_value(0.4)
    v3 = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3) == 1  # still only 302's emit; 301 was swallowed


def test_unarm_suppression_restores_emit(wired):
    """``unarm_suppression`` clears the flag so the next fire emits."""
    _reg, mut, _song, t1, _t2, emits = wired
    mut.arm_suppression(301)
    mut.unarm_suppression(301)
    t1.devices[0].parameters[0].set_value(0.5)
    v3 = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3) == 1
    assert v3[0][1][1] == pytest.approx(0.5)


def test_arm_suppression_idempotent(wired):
    """Re-arming before any fire stays one-shot, not counter-style."""
    _reg, mut, _song, t1, _t2, emits = wired
    mut.arm_suppression(301)
    mut.arm_suppression(301)
    t1.devices[0].parameters[0].set_value(0.2)
    assert emits == []
    t1.devices[0].parameters[0].set_value(0.3)
    v3 = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3) == 1
    assert v3[0][1][1] == pytest.approx(0.3)


# --- v3 echo ----------------------------------------------------------------


def test_v3_param_value_echo_uses_canonical_path(wired):
    """v3 echo payload is (canonical_path, value) — per [04 §3.1]."""
    _reg, _mut, _song, t1, _t2, emits = wired
    t1.devices[0].parameters[0].set_value(0.42)
    v3 = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(v3) == 1
    path, value = v3[0][1]
    assert path == "tracks/0/devices/0/params/0"
    assert value == pytest.approx(0.42)


def test_v3_param_value_echo_suppressed_by_arm(wired):
    """Arming silences the v3 echo."""
    _reg, mut, _song, t1, _t2, emits = wired
    mut.arm_suppression(301)
    t1.devices[0].parameters[0].set_value(0.7)
    assert emits == []


# --- lifecycle -------------------------------------------------------------


def test_disconnect_silences_subsequent_fires(wired):
    """``disconnect`` must stop emits even if a late LOM fire lands."""
    _reg, mut, _song, t1, _t2, emits = wired
    mut.disconnect()
    emits.clear()
    t1.devices[0].parameters[0].set_value(0.99)
    assert emits == []


def test_disconnect_idempotent(wired):
    _reg, mut, _song, _t1, _t2, _emits = wired
    mut.disconnect()
    mut.disconnect()  # no exception


def test_disconnect_clears_suppression(wired):
    """Suppression dict empties on disconnect (memory hygiene)."""
    _reg, mut, _song, _t1, _t2, _emits = wired
    mut.arm_suppression(301)
    mut.arm_suppression(302)
    mut.disconnect()
    assert mut._suppress == {}


# --- emit error tolerance --------------------------------------------------


def test_emit_failure_swallowed(wired):
    """An emit exception must not propagate up the LOM listener path."""
    reg, _mut, _song, t1, _t2, _emits = wired

    def boom(_a, _args):
        raise RuntimeError("transport closed")

    bad_mut = MutationComponent(listeners=reg, emit=boom)
    reg.set_mutation_callbacks(
        on_param_value_changed=bad_mut.on_param_value_changed,
    )
    # Fire — must not raise.
    t1.devices[0].parameters[0].set_value(0.42)


# --- display-value hot path ------------------------------------------------
#
# `mark_hot(path)` opts a path into companion `param/display` emits on
# every subsequent listener fire (until the TTL expires). The hot map
# is what `DevicesComponent.handle_set_param_v3` calls into when a
# UI-driven param/set lands.


@pytest.fixture
def wired_with_display():
    """Same shape as ``wired`` but using StubParamWithDisplay.

    Returns ``(listeners, mutation, song, t1, t2, emits)`` with t1's
    first device using StubParamWithDisplay so ``str(parameter)`` is
    deterministic.
    """
    p301 = StubParamWithDisplay(pid=301, name="cutoff", value=0.5,
                                min_v=0.0, max_v=1.0, display="440 Hz")
    p302 = StubParamWithDisplay(pid=302, name="reso", value=0.25,
                                min_v=0.0, max_v=1.0, display="-12.0 dB")
    d200 = StubDevice(did=200, params=[p301, p302], name="Filter",
                      class_name="AutoFilter2")
    t1 = StubTrack(tid=100, devices=[d200], name="T1")

    p303 = StubParamWithDisplay(pid=303, name="gain", value=0.5,
                                display="0.5")
    d201 = StubDevice(did=201, params=[p303], name="Utility",
                      class_name="Utility")
    t2 = StubTrack(tid=101, devices=[d201], name="T2")

    song = StubSong(tracks=[t1, t2])
    reg = LOMListeners(song=song)

    emits: List[Tuple[str, tuple]] = []
    mut = MutationComponent(listeners=reg, emit=lambda a, args: emits.append((a, args)))
    reg.set_mutation_callbacks(
        on_param_value_changed=mut.on_param_value_changed,
    )
    return reg, mut, song, t1, t2, emits


def test_display_emits_when_path_is_hot(wired_with_display):
    """``mark_hot`` + value-change → one ``param/display`` carrying str()."""
    _reg, mut, _song, t1, _t2, emits = wired_with_display
    path = "tracks/0/devices/0/params/0"
    mut.mark_hot(path)
    t1.devices[0].parameters[0].set_value_and_display(0.6, "880 Hz")
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert len(display_emits) == 1
    emit_path, emit_str = display_emits[0][1]
    assert emit_path == path
    assert emit_str == "880 Hz"


def test_no_display_emit_when_path_not_hot(wired_with_display):
    """Without ``mark_hot``, idle fires never compute or emit display."""
    _reg, _mut, _song, t1, _t2, emits = wired_with_display
    t1.devices[0].parameters[0].set_value_and_display(0.6, "880 Hz")
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert display_emits == []
    # value emit still went out — display gating is independent.
    value_emits = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    assert len(value_emits) == 1


def test_display_per_path_isolation(wired_with_display):
    """Hot on path A does not enable display emits for path B."""
    _reg, mut, _song, t1, _t2, emits = wired_with_display
    mut.mark_hot("tracks/0/devices/0/params/0")
    t1.devices[0].parameters[1].set_value_and_display(0.3, "-6.0 dB")
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert display_emits == []


def test_display_bypasses_suppression(wired_with_display):
    """Suppressed value echo MUST still emit ``param/display``.

    The suppression only protects against numeric-value echo loops
    (the UI already has the optimistic value). The formatted string
    is genuinely new data — without this, drag-driven writes (which
    are always suppressed) would never surface a display string.
    """
    _reg, mut, _song, t1, _t2, emits = wired_with_display
    path = "tracks/0/devices/0/params/0"
    mut.mark_hot(path)
    mut.arm_suppression(301)
    t1.devices[0].parameters[0].set_value_and_display(0.6, "880 Hz")
    value_emits = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert value_emits == []  # suppressed as expected
    assert len(display_emits) == 1
    assert display_emits[0][1] == (path, "880 Hz")


def test_display_ttl_expires(wired_with_display, monkeypatch):
    """A hot entry past its TTL stops emitting display until re-marked."""
    import components.MutationComponent as mc

    _reg, mut, _song, t1, _t2, emits = wired_with_display
    path = "tracks/0/devices/0/params/0"

    fake_now = [1000.0]

    def now():
        return fake_now[0]

    monkeypatch.setattr(mc.time, "monotonic", now)

    mut.mark_hot(path)  # expires at 1000 + HOT_TTL_SEC (=0.75)
    fake_now[0] = 1000.5  # well within window
    t1.devices[0].parameters[0].set_value_and_display(0.6, "first")
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert len(display_emits) == 1
    assert display_emits[0][1][1] == "first"

    fake_now[0] = 1001.0  # past expiry
    t1.devices[0].parameters[0].set_value_and_display(0.7, "second")
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert len(display_emits) == 1  # no new display emit
    # entry was lazily swept on the second fire.
    assert path not in mut._hot_paths


def test_mark_hot_refreshes_ttl(wired_with_display, monkeypatch):
    """A second ``mark_hot`` resets the expiry — drag traffic stays alive."""
    import components.MutationComponent as mc

    _reg, mut, _song, _t1, _t2, _emits = wired_with_display
    path = "tracks/0/devices/0/params/0"

    fake_now = [1000.0]
    monkeypatch.setattr(mc.time, "monotonic", lambda: fake_now[0])

    mut.mark_hot(path)
    first_expiry = mut._hot_paths[path]
    fake_now[0] = 1000.4
    mut.mark_hot(path)
    second_expiry = mut._hot_paths[path]
    assert second_expiry > first_expiry


def test_mark_hot_empty_path_noop(wired_with_display):
    """Empty string is a no-op — symmetry with the rest of the component."""
    _reg, mut, _song, _t1, _t2, _emits = wired_with_display
    mut.mark_hot("")
    assert mut._hot_paths == {}


def test_str_failure_does_not_block_value_emit(wired_with_display):
    """A param whose ``__str__`` raises must not break the value path.

    Live's __str__ can raise on torn-down handles (preset reload mid-fire);
    skip the display emit but let the value emit go through.
    """
    _reg, mut, _song, t1, _t2, emits = wired_with_display
    path = "tracks/0/devices/0/params/0"

    class BoomStr:
        def __str__(self):
            raise RuntimeError("torn-down handle")

    # Override display attribute so __str__ raises through .display lookup.
    p = t1.devices[0].parameters[0]

    def boom_str(self):
        raise RuntimeError("torn-down handle")

    # Patch the instance's class method only for this param.
    # (Subclass override avoids polluting other tests.)
    orig_cls = p.__class__
    p.__class__ = type("BoomParam", (orig_cls,), {"__str__": boom_str})

    try:
        mut.mark_hot(path)
        p.set_value(0.6)
    finally:
        p.__class__ = orig_cls

    value_emits = [e for e in emits if e[0] == V3_PARAM_VALUE_ADDRESS]
    display_emits = [e for e in emits if e[0] == V3_PARAM_DISPLAY_ADDRESS]
    assert len(value_emits) == 1
    assert value_emits[0][1] == (path, pytest.approx(0.6))
    assert display_emits == []  # str() failed, swallowed


def test_disconnect_clears_hot_paths(wired_with_display):
    """Hot map empties on disconnect (memory hygiene + late-fire safety)."""
    _reg, mut, _song, _t1, _t2, _emits = wired_with_display
    mut.mark_hot("tracks/0/devices/0/params/0")
    mut.mark_hot("tracks/0/devices/0/params/1")
    mut.disconnect()
    assert mut._hot_paths == {}


def test_mark_hot_after_disconnect_noop(wired_with_display):
    """Late ``mark_hot`` after disconnect is a no-op (race posture)."""
    _reg, mut, _song, _t1, _t2, _emits = wired_with_display
    mut.disconnect()
    mut.mark_hot("tracks/0/devices/0/params/0")
    assert mut._hot_paths == {}
