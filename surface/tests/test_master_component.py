"""MasterComponent unit tests — PR-5b.

Covers the five-attribute master metadata channel:

- Per-attribute listener attach on init: track-attr listeners on
  ``master_track`` (name, color, mute), mixer-attr listeners on
  ``master.mixer_device.<param>`` (volume, pan).
- Fire emits on the right ``/looping/v3/master/<attr>`` address with
  ``[value]`` — no trackPath arg (master is a singleton).
- ``handle_set_*`` writes through to LOM; the listener fire is NOT
  suppressed (the UI relies on the echo as its post-write signal —
  see module docstring "No echo suppression"); bool coerce for mute;
  validate-and-reject for out-of-range; bytes→utf-8 on name.
- Init emit: every attr's current LOM value is emitted once at
  ``__init__`` so the UI gets a seed value without waiting for a
  fader move (state/full does not carry master volume/pan).
- **Mandatory case** (per design §4 + ``project_live_lom_quirks``):
  the ``master.mute`` RuntimeError stub. Component must log WARNING
  once, not crash, and write returns ``write-rejected`` with detail
  ``"attribute-unavailable"``.
- Generation gate: stale UI generation rejects; ui_gen omitted
  bypasses the check.
- Disconnect: detaches every listener, idempotent, swallows late
  fires.

The stub LOM models track-attrs as direct attributes on the master
track (one listener slot per attr) and mixer-attrs as DeviceParameter
objects under ``mixer_device.{volume,panning}``.
"""

from __future__ import annotations

from typing import Callable, Dict, List, Optional, Tuple

import pytest

from components.GenerationComponent import GenerationComponent
from components.MasterComponent import (
    DETAIL_ATTRIBUTE_UNAVAILABLE,
    MasterComponent,
    V3_ERROR_ADDRESS,
    V3_ERROR_GENERATION_STALE,
    V3_ERROR_WRITE_REJECTED,
    V3_MASTER_COLOR_ADDRESS,
    V3_MASTER_MUTE_ADDRESS,
    V3_MASTER_NAME_ADDRESS,
    V3_MASTER_PAN_ADDRESS,
    V3_MASTER_VOLUME_ADDRESS,
)


# --- stub LOM --------------------------------------------------------------


class StubMixerParam:
    """One DeviceParameter slot — value + add/remove value listener.

    Setting ``.value`` fires the listener synchronously.
    """

    def __init__(self, value: float = 0.0) -> None:
        object.__setattr__(self, "_value", value)
        object.__setattr__(self, "_listener", None)
        object.__setattr__(self, "_raise_on_set", False)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if self._raise_on_set:
            raise RuntimeError("LOM rejects mixer write %r" % (v,))
        object.__setattr__(self, "_value", v)
        cb = self._listener
        if cb is not None:
            cb()

    def add_value_listener(self, cb: Callable[[], None]) -> None:
        assert self._listener is None, "stub mixer param: one listener slot"
        object.__setattr__(self, "_listener", cb)

    def remove_value_listener(self, cb: Callable[[], None]) -> None:
        assert self._listener == cb, "detaching unattached mixer listener"
        object.__setattr__(self, "_listener", None)


class StubMixer:
    def __init__(
        self,
        volume: float = 0.85,
        panning: float = 0.0,
    ) -> None:
        self.volume = StubMixerParam(volume)
        self.panning = StubMixerParam(panning)


class StubMasterTrack:
    """Master track with name/color/mute as observable attrs.

    Mirrors StubTrack from the PR-5a tests but with only the three
    track-family attrs (volume + pan are on mixer_device).
    """

    _ATTRS = ("name", "color", "mute")

    def __init__(
        self,
        name: str = "Master",
        color: int = 0,
        mute: bool = False,
        volume: float = 0.85,
        panning: float = 0.0,
        mute_raises: bool = False,
    ) -> None:
        object.__setattr__(self, "_listeners", {a: None for a in self._ATTRS})
        object.__setattr__(self, "_values", {
            "name": name,
            "color": color,
            "mute": mute,
        })
        object.__setattr__(self, "_raise_on", set())
        object.__setattr__(self, "_mute_raises", mute_raises)
        object.__setattr__(self, "mixer_device", StubMixer(volume, panning))

    def __getattr__(self, name):
        if name == "mute" and self.__dict__.get("_mute_raises"):
            raise RuntimeError("Main track has no 'mute' property!")
        values = self.__dict__.get("_values")
        if values is not None and name in values:
            return values[name]
        raise AttributeError(name)

    def __setattr__(self, name, value):
        values = self.__dict__.get("_values")
        if values is None or name not in values:
            object.__setattr__(self, name, value)
            return
        if name == "mute" and self.__dict__.get("_mute_raises"):
            raise RuntimeError("Main track has no 'mute' property!")
        if name in self.__dict__.get("_raise_on", set()):
            raise RuntimeError("LOM rejects {}={!r}".format(name, value))
        values[name] = value
        cb = self.__dict__["_listeners"][name]
        if cb is not None:
            cb()

    def _make_add(attr):  # noqa: N805
        def add(self, cb):
            assert self._listeners[attr] is None, (
                "StubMasterTrack supports one %s listener" % attr
            )
            self._listeners[attr] = cb
        return add

    def _make_remove(attr):  # noqa: N805
        def remove(self, cb):
            assert self._listeners[attr] == cb, (
                "detaching unattached %s listener" % attr
            )
            self._listeners[attr] = None
        return remove

    for _attr in _ATTRS:
        locals()["add_%s_listener" % _attr] = _make_add(_attr)
        locals()["remove_%s_listener" % _attr] = _make_remove(_attr)

    del _make_add, _make_remove, _attr


class StubSong:
    def __init__(self, master: StubMasterTrack) -> None:
        self.master_track = master


# --- fixtures --------------------------------------------------------------


class EmitRecorder:
    """Captures ``(address, args)`` tuples emitted by the component."""

    def __init__(self) -> None:
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address: str, args) -> None:
        self.emissions.append((address, tuple(args)))

    def only(self, address: str) -> List[tuple]:
        return [payload for addr, payload in self.emissions if addr == address]

    def errors(self) -> List[tuple]:
        return self.only(V3_ERROR_ADDRESS)

    def clear(self) -> None:
        self.emissions.clear()


@pytest.fixture
def recorder() -> EmitRecorder:
    return EmitRecorder()


@pytest.fixture
def master() -> StubMasterTrack:
    return StubMasterTrack()


@pytest.fixture
def song(master: StubMasterTrack) -> StubSong:
    return StubSong(master)


@pytest.fixture
def component(song: StubSong, recorder: EmitRecorder):
    c = MasterComponent(song=song, emit=recorder)
    gen = GenerationComponent()
    c.set_generation(gen)
    # Drop the init-emit seed so per-test assertions only see what the
    # test itself triggered. The dedicated init-emit test constructs
    # MasterComponent directly without using this fixture.
    recorder.clear()
    yield c
    c.disconnect()


# --- init / listener attach -----------------------------------------------


def test_init_binds_track_listeners(song: StubSong, recorder: EmitRecorder):
    c = MasterComponent(song=song, emit=recorder)
    try:
        for attr in ("name", "color", "mute"):
            assert song.master_track._listeners[attr] is not None
    finally:
        c.disconnect()


def test_init_binds_mixer_listeners(song: StubSong, recorder: EmitRecorder):
    c = MasterComponent(song=song, emit=recorder)
    try:
        assert song.master_track.mixer_device.volume._listener is not None
        assert song.master_track.mixer_device.panning._listener is not None
    finally:
        c.disconnect()


def test_init_emits_seed_value_for_each_attr(recorder):
    """Cold-start UI must get every attr's current LOM value once.

    state/full doesn't carry master volume or pan — the T record's
    columns stop at name/color/mute/solo/arm/capabilities. Without
    init-emit, the UI's $derived would fall back to 0.85 (volume) /
    0.0 (pan) until the user moved the fader. The seed emit closes
    that gap.
    """
    master = StubMasterTrack(
        name="MyMaster", color=0x123456, mute=True,
        volume=0.42, panning=-0.3,
    )
    song = StubSong(master)
    c = MasterComponent(song=song, emit=recorder)
    try:
        assert recorder.only(V3_MASTER_NAME_ADDRESS) == [("MyMaster",)]
        assert recorder.only(V3_MASTER_COLOR_ADDRESS) == [(0x123456,)]
        assert recorder.only(V3_MASTER_MUTE_ADDRESS) == [(1,)]
        assert recorder.only(V3_MASTER_VOLUME_ADDRESS) == [(0.42,)]
        assert recorder.only(V3_MASTER_PAN_ADDRESS) == [(-0.3,)]
    finally:
        c.disconnect()


def test_init_emit_skips_attr_that_raises(recorder, caplog):
    """master.mute RuntimeError on read at init must not crash init.

    Other attrs still seed, the WARNING is logged once, and the
    component comes up partial — same posture as the listener-attach
    guard.
    """
    master = StubMasterTrack(mute_raises=True)
    song = StubSong(master)
    import logging
    with caplog.at_level(logging.WARNING, logger="looping"):
        c = MasterComponent(song=song, emit=recorder)
    try:
        # mute seed skipped, others present.
        assert recorder.only(V3_MASTER_MUTE_ADDRESS) == []
        assert len(recorder.only(V3_MASTER_NAME_ADDRESS)) == 1
        assert len(recorder.only(V3_MASTER_VOLUME_ADDRESS)) == 1
    finally:
        c.disconnect()


# --- external fires emit on wire (no trackPath) ---------------------------


def test_external_name_change_emits_with_value_only(
    component, master, recorder,
):
    master.name = "MyMaster"
    assert recorder.only(V3_MASTER_NAME_ADDRESS) == [("MyMaster",)]


def test_external_color_change_emits_int(component, master, recorder):
    master.color = 0xFF8800
    assert recorder.only(V3_MASTER_COLOR_ADDRESS) == [(0xFF8800,)]


def test_external_mute_change_emits_int_not_bool(
    component, master, recorder,
):
    master.mute = True
    (payload,) = recorder.only(V3_MASTER_MUTE_ADDRESS)
    assert payload == (1,)
    assert isinstance(payload[0], int) and not isinstance(payload[0], bool)


def test_external_volume_change_emits_float(component, master, recorder):
    master.mixer_device.volume.value = 0.42
    assert recorder.only(V3_MASTER_VOLUME_ADDRESS) == [(0.42,)]


def test_external_pan_change_emits_float(component, master, recorder):
    master.mixer_device.panning.value = -0.5
    assert recorder.only(V3_MASTER_PAN_ADDRESS) == [(-0.5,)]


# --- set round-trip (no echo suppression) ---------------------------------
#
# Per the module docstring: master writes do NOT suppress the self-fire.
# The UI surface for master volume/pan has no optimistic local update —
# the listener echo IS the post-write signal. Each handler test below
# asserts the LOM lands the value AND the fire emits on the wire.


def test_handle_set_name_writes_lom_and_emits_echo(
    component, master, recorder,
):
    component.handle_set_name(("Foo",), source_addr=None)
    assert master.name == "Foo"
    assert recorder.only(V3_MASTER_NAME_ADDRESS) == [("Foo",)]


def test_handle_set_volume_writes_mixer_param_and_emits_echo(
    component, master, recorder,
):
    component.handle_set_volume((0.5,), source_addr=None)
    assert master.mixer_device.volume.value == 0.5
    assert recorder.only(V3_MASTER_VOLUME_ADDRESS) == [(0.5,)]


def test_handle_set_pan_writes_mixer_param_and_emits_echo(
    component, master, recorder,
):
    component.handle_set_pan((-0.25,), source_addr=None)
    assert master.mixer_device.panning.value == -0.25
    assert recorder.only(V3_MASTER_PAN_ADDRESS) == [(-0.25,)]


def test_handle_set_mute_coerces_int_1_to_bool_true_and_emits_echo(
    component, master, recorder,
):
    component.handle_set_mute((1,), source_addr=None)
    assert master.mute is True
    assert recorder.only(V3_MASTER_MUTE_ADDRESS) == [(1,)]


def test_handle_set_color_accepts_max_value(component, master, recorder):
    component.handle_set_color((0xFFFFFF,), source_addr=None)
    assert master.color == 0xFFFFFF
    assert recorder.errors() == []


def test_handle_set_name_coerces_bytes_to_utf8(
    component, master, recorder,
):
    component.handle_set_name(("résumé".encode("utf-8"),), source_addr=None)
    assert master.name == "résumé"


# --- validate-and-reject (no LOM write on bad value) ----------------------


def test_handle_set_volume_rejects_above_one(component, master, recorder):
    component.handle_set_volume((1.5,), source_addr=None)
    assert master.mixer_device.volume.value == 0.85  # unchanged
    err = recorder.errors()[0]
    assert err[0] == V3_MASTER_VOLUME_ADDRESS
    assert err[1] == V3_ERROR_WRITE_REJECTED
    assert err[2] == "master"


def test_handle_set_volume_rejects_negative(component, master, recorder):
    component.handle_set_volume((-0.1,), source_addr=None)
    assert master.mixer_device.volume.value == 0.85
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_volume_rejects_nan(component, master, recorder):
    component.handle_set_volume((float("nan"),), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_pan_rejects_out_of_range(component, master, recorder):
    component.handle_set_pan((2.0,), source_addr=None)
    assert master.mixer_device.panning.value == 0.0
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_color_rejects_negative(component, master, recorder):
    component.handle_set_color((-1,), source_addr=None)
    assert master.color == 0
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_color_rejects_overflow(component, master, recorder):
    component.handle_set_color((0x1000000,), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_color_accepts_whole_number_float(component, master, recorder):
    # The OSC bridge encodes JS numbers as float32, so RGB ints arrive as floats.
    component.handle_set_color((5420936.0,), source_addr=None)
    assert master.color == 0x52B788
    assert recorder.errors() == []


def test_handle_set_color_rejects_fractional_float(component, master, recorder):
    component.handle_set_color((1.5,), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_mute_rejects_string_value(component, master, recorder):
    component.handle_set_mute(("on",), source_addr=None)
    assert master.mute is False
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_name_rejects_empty(component, master, recorder):
    component.handle_set_name(("",), source_addr=None)
    assert master.name == "Master"
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_name_rejects_too_long(component, master, recorder):
    component.handle_set_name(("x" * 256,), source_addr=None)
    assert master.name == "Master"
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_missing_args_rejects(component, recorder):
    component.handle_set_name((), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


# --- master.mute RuntimeError guard (mandatory case, design §4) -----------


def test_master_mute_runtime_error_on_listener_attach_does_not_crash(
    recorder, caplog,
):
    """Component constructs cleanly even when ``add_mute_listener`` raises.

    Live 12 raises ``RuntimeError`` from ``add_mute_listener`` because
    accessing the property is gated; the stub mirrors that. Component
    must log WARNING once (not flood) and leave the other listeners
    intact. The volume + pan + name + color paths must still work.
    """

    class MuteAttachRaisesMaster(StubMasterTrack):
        def add_mute_listener(self, cb):
            raise RuntimeError("Main track has no 'mute' property!")

    master = MuteAttachRaisesMaster()
    song = StubSong(master)

    import logging
    with caplog.at_level(logging.WARNING, logger="looping"):
        c = MasterComponent(song=song, emit=recorder)
    try:
        # Other listeners attached fine.
        assert master._listeners["name"] is not None
        assert master._listeners["color"] is not None
        assert master.mixer_device.volume._listener is not None
        # Drop init-emit seed before testing the post-init fire.
        recorder.clear()
        # Name fire still works.
        master.name = "OK"
        assert recorder.only(V3_MASTER_NAME_ADDRESS) == [("OK",)]
        # Warning logged exactly once for the mute attach failure
        # (the _warn_once dedup keys by (attr, context) so the
        # subsequent init-emit "initial-read" path also dedups).
        mute_warnings = [r for r in caplog.records
                         if r.levelno == logging.WARNING and "mute" in r.message]
        assert len(mute_warnings) >= 1
    finally:
        c.disconnect()


def test_master_mute_runtime_error_on_write_returns_attribute_unavailable(
    recorder, caplog,
):
    """**Mandatory case.**

    LOM raises RuntimeError on the setattr → component must NOT crash,
    must emit ``write-rejected`` with detail ``"attribute-unavailable"``
    on ``/looping/v3/error``, and must log WARNING exactly once even
    if the user drags through repeated failures.
    """
    master = StubMasterTrack(mute_raises=True)
    song = StubSong(master)
    import logging
    with caplog.at_level(logging.WARNING, logger="looping"):
        c = MasterComponent(song=song, emit=recorder)
        c.set_generation(GenerationComponent())
        try:
            recorder.clear()
            caplog.clear()

            c.handle_set_mute((1,), source_addr=None)

            errors = recorder.errors()
            assert len(errors) == 1
            addr, code, path, detail = errors[0]
            assert (addr, code, path) == (
                V3_MASTER_MUTE_ADDRESS,
                V3_ERROR_WRITE_REJECTED,
                "master",
            )
            assert detail == DETAIL_ATTRIBUTE_UNAVAILABLE

            # Drag scenario: 5 more writes, all rejected, only ONE log.
            for _ in range(5):
                c.handle_set_mute((1,), source_addr=None)
            mute_warnings = [
                r for r in caplog.records
                if r.levelno == logging.WARNING and "mute" in r.message
            ]
            assert len(mute_warnings) == 1
        finally:
            c.disconnect()


# --- generation gate ------------------------------------------------------


def test_stale_generation_rejects(component, master, recorder):
    component._generation.advance("test")
    component.handle_set_name(("Nope", 1), source_addr=None)
    assert master.name == "Master"
    assert recorder.errors()[0][1] == V3_ERROR_GENERATION_STALE


def test_missing_generation_arg_bypasses_check(component, master, recorder):
    component._generation.advance("test")
    component.handle_set_name(("OK",), source_addr=None)
    assert master.name == "OK"
    assert recorder.errors() == []


def test_matching_generation_accepts(component, master, recorder):
    component._generation.advance("test")
    component.handle_set_name(
        ("OK", component._generation.current), source_addr=None,
    )
    assert master.name == "OK"
    assert recorder.errors() == []


def test_generation_not_wired_rejects_with_surface_misconfigured(
    song, recorder,
):
    c = MasterComponent(song=song, emit=recorder)
    try:
        c.handle_set_name(("X", 42), source_addr=None)
        err = recorder.errors()[0]
        assert err[1] == V3_ERROR_WRITE_REJECTED
        assert "misconfigured" in err[3]
    finally:
        c.disconnect()


def test_bad_generation_arg_rejects(component, master, recorder):
    component.handle_set_name(("X", "not-an-int"), source_addr=None)
    assert master.name == "Master"
    err = recorder.errors()[0]
    assert err[1] == V3_ERROR_WRITE_REJECTED


# --- LOM rejection at write-time (non-mute path) --------------------------


def test_mixer_lom_rejection_emits_write_rejected(
    component, master, recorder,
):
    master.mixer_device.volume._raise_on_set = True
    component.handle_set_volume((0.5,), source_addr=None)
    err = recorder.errors()[0]
    assert err[1] == V3_ERROR_WRITE_REJECTED
    # Non-mute RuntimeError → "attribute-unavailable" detail (the
    # generic LOM-rejected branch only fires for non-(RuntimeError|
    # AttributeError) exceptions; RuntimeError gets the
    # attribute-unavailable label).
    assert err[3] == DETAIL_ATTRIBUTE_UNAVAILABLE


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_all_listeners(song, recorder):
    c = MasterComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    for attr in ("name", "color", "mute"):
        assert song.master_track._listeners[attr] is None
    assert song.master_track.mixer_device.volume._listener is None
    assert song.master_track.mixer_device.panning._listener is None


def test_disconnect_is_idempotent(song, recorder):
    c = MasterComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    c.disconnect()  # must not raise


def test_late_fire_after_disconnect_does_not_emit(song, recorder):
    c = MasterComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    cb = song.master_track._listeners["name"]
    c.disconnect()
    recorder.clear()
    cb()  # late fire — must be swallowed by the _disconnected guard
    assert recorder.emissions == []
