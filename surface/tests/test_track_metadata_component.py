"""TrackMetadataComponent unit tests — PR-5a.

Covers the eight-attribute track-metadata channel:

- Per-attribute listener attach on init; fire emits on the right
  ``/looping/v3/track/<attr>`` address with ``[trackPath, value]``.
- ``handle_set_*`` writes through to LOM; echo-suppression swallows
  the one subsequent self-fire; bool coerce for arm/mute/solo;
  validate-and-reject for out-of-range; bytes→utf-8 on strings.
- Path handling: malformed / not-found / ``"master"`` / ``"returns/0"``
  all reject with the right code without touching LOM.
- Generation gate: stale UI generation rejects; ui_gen omitted
  bypasses the check (backward-compat with senders that haven't
  wired it yet).
- Structural-change rebind: track leaves / joins the song mid-
  subscription; listeners follow.
- Multi-track fan-out: fire on track 2 only emits once with
  ``tracks/2`` — other tracks stay silent.
- Disconnect: detaches every listener, flips the idempotent guard,
  swallows late fires.

The stub LOM models one listener-slot per attribute per track (same
shape as ``test_session_component``'s ``StubSong``). Arm/mute/solo
carry Python ``bool`` on the LOM side, ``int`` on the wire — the
coerce-both-ways contract of ``_BOOL_ATTRS`` is exercised directly.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.GenerationComponent import GenerationComponent
from components.TrackMetadataComponent import (
    TrackMetadataComponent,
    V3_ERROR_ADDRESS,
    V3_ERROR_GENERATION_STALE,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_PATH_NOT_SUPPORTED,
    V3_ERROR_WRITE_REJECTED,
    V3_TRACK_ARM_ADDRESS,
    V3_TRACK_COLOR_ADDRESS,
    V3_TRACK_FOLD_STATE_ADDRESS,
    V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS,
    V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS,
    V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS,
    V3_TRACK_MUTE_ADDRESS,
    V3_TRACK_MUTE_TOGGLE_ADDRESS,
    V3_TRACK_NAME_ADDRESS,
    V3_TRACK_PAN_ADDRESS,
    V3_TRACK_SEND_ADDRESS,
    V3_TRACK_SET_FOLD_STATE_ADDRESS,
    V3_TRACK_SET_ROLE_ADDRESS,
    V3_TRACK_SOLO_ADDRESS,
    TRACK_ROLE_DATA_KEY,
    V3_TRACK_ROLE_ADDRESS,
)


# --- stub LOM --------------------------------------------------------------


class StubTrack:
    """Track with the 8 PR-5a attributes, each with one listener slot.

    Setting an attribute fires its listener synchronously — matches
    LOM's observable semantics. ``panning`` is the LOM attribute name
    for the wire's ``pan`` address (the ``_ATTR_PAN → "panning"``
    rename the component performs).
    """

    _ATTRS = (
        "name",
        "color",
        "arm",
        "mute",
        "solo",
        "panning",
        "input_routing_type",
        "input_routing_channel",
    )

    def __init__(
        self,
        name: str = "Track",
        color: int = 0,
        arm: bool = False,
        mute: bool = False,
        solo: bool = False,
        panning: float = 0.0,
        input_routing_type: str = "Ext. In",
        input_routing_channel: str = "1/2",
        arrangement_clips: tuple = (),
        is_foldable: bool = False,
        fold_state: bool = False,
    ):
        object.__setattr__(self, "_listeners", {a: None for a in self._ATTRS})
        object.__setattr__(self, "_values", {
            "name": name,
            "color": color,
            "arm": arm,
            "mute": mute,
            "solo": solo,
            "panning": panning,
            "input_routing_type": input_routing_type,
            "input_routing_channel": input_routing_channel,
        })
        # Channels that raise on write — used to exercise LOM-rejection.
        object.__setattr__(self, "_raise_on", set())
        # PR-7c: arrangement_clips observer — one listener slot per track,
        # same shape as the 8 metadata attrs. Tests drive fires via
        # ``set_arrangement_clips`` which both updates the value and
        # invokes the listener, mirroring LOM semantics. The list of
        # clips is opaque to the component (only len() matters).
        object.__setattr__(self, "_arrangement_clips", tuple(arrangement_clips))
        object.__setattr__(self, "_arrangement_clips_listener", None)
        # Toggle to simulate an older Live that lacks the observer API —
        # tests flip this before constructing TrackMetadataComponent to
        # exercise the graceful-skip path.
        object.__setattr__(
            self, "_expose_arrangement_clips_listener", True,
        )
        # Toggle to simulate arrangement_clips read raising (e.g.,
        # invalidated C++ handle) — the fire closure must swallow.
        object.__setattr__(self, "_raise_on_arrangement_clips_read", False)
        # ADR-410 group-track fields. Deliberately NOT in ``_ATTRS``:
        # Live exposes no ``add_fold_state_listener`` /
        # ``add_is_visible_listener``, so the stub must not either, or a
        # regression that reintroduces a per-track fold listener would
        # pass here and fail against real Live. ``fold_state`` RAISES on
        # a non-foldable track — verified against Live 12.4.5b8 — so the
        # stub raises too; a stub that returned False would hide the
        # guard the component depends on.
        object.__setattr__(self, "_is_foldable", bool(is_foldable))
        object.__setattr__(self, "_fold_state", bool(fold_state))

    def __getattr__(self, name):
        values = self.__dict__.get("_values")
        if values is not None and name in values:
            return values[name]
        if name == "is_foldable":
            return self.__dict__.get("_is_foldable", False)
        if name == "fold_state":
            if not self.__dict__.get("_is_foldable", False):
                raise RuntimeError("Track is not foldable")
            return self.__dict__.get("_fold_state", False)
        if name == "arrangement_clips":
            if self.__dict__.get("_raise_on_arrangement_clips_read"):
                raise RuntimeError("LOM read failed")
            return self.__dict__.get("_arrangement_clips", ())
        if name == "add_arrangement_clips_listener":
            if not self.__dict__.get("_expose_arrangement_clips_listener"):
                raise AttributeError(name)
            return self._add_arrangement_clips_listener
        if name == "remove_arrangement_clips_listener":
            if not self.__dict__.get("_expose_arrangement_clips_listener"):
                raise AttributeError(name)
            return self._remove_arrangement_clips_listener
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name == "fold_state":
            if not self.__dict__.get("_is_foldable", False):
                raise RuntimeError("Track is not foldable")
            object.__setattr__(self, "_fold_state", bool(value))
            return
        values = self.__dict__.get("_values")
        if values is None or name not in values:
            object.__setattr__(self, name, value)
            return
        if name in self.__dict__.get("_raise_on", set()):
            raise RuntimeError("LOM rejects {}={!r}".format(name, value))
        values[name] = value
        cb = self.__dict__["_listeners"][name]
        if cb is not None:
            cb()

    # LOM listener contract — one per attr ---------------------------------

    def _make_add(attr):  # noqa: N805 (helper factory)
        def add(self, cb):
            assert self._listeners[attr] is None, (
                "StubTrack supports one %s listener" % attr
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

    # Helper for tests: poke an "outside" fire without a new value.
    def fire(self, attr):
        cb = self._listeners[attr]
        if cb is not None:
            cb()

    # PR-7c — arrangement_clips observer. One listener slot; add raises
    # if already attached (matches LOM semantics: attaching twice from
    # the same binder is a bug).
    def _add_arrangement_clips_listener(self, cb):
        assert self.__dict__["_arrangement_clips_listener"] is None, (
            "StubTrack supports one arrangement_clips listener"
        )
        self.__dict__["_arrangement_clips_listener"] = cb

    def _remove_arrangement_clips_listener(self, cb):
        assert self.__dict__["_arrangement_clips_listener"] == cb, (
            "detaching unattached arrangement_clips listener"
        )
        self.__dict__["_arrangement_clips_listener"] = None

    def set_arrangement_clips(self, clips):
        """Update ``arrangement_clips`` and fire the listener (LOM-like)."""
        object.__setattr__(self, "_arrangement_clips", tuple(clips))
        cb = self.__dict__.get("_arrangement_clips_listener")
        if cb is not None:
            cb()

    def fire_arrangement_clips(self):
        cb = self.__dict__.get("_arrangement_clips_listener")
        if cb is not None:
            cb()


class StubSong:
    def __init__(self, tracks: List[StubTrack]):
        self._tracks = list(tracks)
        # ADR-410: ``visible_tracks`` is the only observable Live gives
        # us for a group fold. One listener slot, song-scoped.
        self._visible_tracks_listener = None

    @property
    def tracks(self):
        return list(self._tracks)

    def set_tracks(self, tracks: List[StubTrack]) -> None:
        self._tracks = list(tracks)

    def add_visible_tracks_listener(self, cb):
        assert self._visible_tracks_listener is None, (
            "StubSong supports one visible_tracks listener"
        )
        self._visible_tracks_listener = cb

    def remove_visible_tracks_listener(self, cb):
        assert self._visible_tracks_listener == cb, (
            "detaching unattached visible_tracks listener"
        )
        self._visible_tracks_listener = None

    def fire_visible_tracks(self):
        cb = self._visible_tracks_listener
        if cb is not None:
            cb()


# --- fixtures --------------------------------------------------------------


class EmitRecorder:
    """Captures ``(address, args)`` tuples emitted by the component."""

    def __init__(self):
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address: str, args) -> None:
        self.emissions.append((address, tuple(args)))

    def only(self, address: str) -> List[tuple]:
        return [payload for addr, payload in self.emissions if addr == address]

    def errors(self) -> List[tuple]:
        return self.only(V3_ERROR_ADDRESS)

    def clear(self):
        self.emissions.clear()


@pytest.fixture
def recorder():
    return EmitRecorder()


@pytest.fixture
def song():
    return StubSong(tracks=[StubTrack(name="T0"), StubTrack(name="T1")])


@pytest.fixture
def component(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    gen = GenerationComponent()
    c.set_generation(gen)
    yield c
    c.disconnect()


# --- init / listener attach -----------------------------------------------


def test_init_binds_listeners_on_every_regular_track(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    try:
        for track in song.tracks:
            for attr in (
                "name", "color", "arm", "mute", "solo", "panning",
                "input_routing_type", "input_routing_channel",
            ):
                assert track._listeners[attr] is not None
    finally:
        c.disconnect()


def test_external_name_change_emits_on_wire(component, song, recorder):
    song.tracks[0].name = "Renamed"
    pans = recorder.only(V3_TRACK_NAME_ADDRESS)
    assert pans == [("tracks/0", "Renamed")]


def test_external_color_change_emits_int_on_wire(component, song, recorder):
    song.tracks[1].color = 0xFF8800
    assert recorder.only(V3_TRACK_COLOR_ADDRESS) == [("tracks/1", 0xFF8800)]


def test_external_arm_change_emits_int_not_bool(component, song, recorder):
    song.tracks[0].arm = True
    (payload,) = recorder.only(V3_TRACK_ARM_ADDRESS)
    assert payload == ("tracks/0", 1)
    assert isinstance(payload[1], int) and not isinstance(payload[1], bool)


def test_external_mute_and_solo_and_pan_emit_on_right_addresses(
    component, song, recorder,
):
    song.tracks[0].mute = True
    song.tracks[1].solo = True
    song.tracks[0].panning = -0.5
    assert recorder.only(V3_TRACK_MUTE_ADDRESS) == [("tracks/0", 1)]
    assert recorder.only(V3_TRACK_SOLO_ADDRESS) == [("tracks/1", 1)]
    assert recorder.only(V3_TRACK_PAN_ADDRESS) == [("tracks/0", -0.5)]


def test_external_input_routing_emits_strings(component, song, recorder):
    song.tracks[0].input_routing_type = "Ext. In"
    song.tracks[0].input_routing_channel = "3/4"
    assert recorder.only(V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS) == [
        ("tracks/0", "Ext. In"),
    ]
    assert recorder.only(V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS) == [
        ("tracks/0", "3/4"),
    ]


def test_external_input_routing_reads_display_name_off_lom_object(
    component, song, recorder,
):
    # Live hands back RoutingType / RoutingChannel objects on read, not
    # strings. They carry the user-facing label on `.display_name`.
    class _Routing:
        def __init__(self, display):
            self.display_name = display

    song.tracks[0].input_routing_type = _Routing("Ext. In")
    song.tracks[0].input_routing_channel = _Routing("3/4")
    assert recorder.only(V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS) == [
        ("tracks/0", "Ext. In"),
    ]
    assert recorder.only(V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS) == [
        ("tracks/0", "3/4"),
    ]


# --- set round-trip + echo suppression ------------------------------------


def test_handle_set_name_writes_lom_and_suppresses_echo(
    component, song, recorder,
):
    component.handle_set_name(("tracks/0", "Foo"), source_addr=None)
    assert song.tracks[0].name == "Foo"
    # The fire the setattr triggered is the echo — must be swallowed.
    assert recorder.only(V3_TRACK_NAME_ADDRESS) == []
    # Subsequent external fire (different value) must NOT be swallowed.
    song.tracks[0].name = "Bar"
    assert recorder.only(V3_TRACK_NAME_ADDRESS) == [("tracks/0", "Bar")]


def test_handle_set_arm_coerces_int_1_to_lom_bool_true(
    component, song, recorder,
):
    component.handle_set_arm(("tracks/0", 1), source_addr=None)
    assert song.tracks[0].arm is True
    assert recorder.only(V3_TRACK_ARM_ADDRESS) == []


def test_handle_set_color_accepts_max_value(component, song, recorder):
    component.handle_set_color(("tracks/0", 0xFFFFFF), source_addr=None)
    assert song.tracks[0].color == 0xFFFFFF
    assert recorder.errors() == []


def test_handle_set_pan_accepts_int_zero(component, song, recorder):
    component.handle_set_pan(("tracks/0", 0), source_addr=None)
    assert song.tracks[0].panning == 0.0
    assert recorder.errors() == []


def test_handle_set_name_coerces_bytes_to_utf8(component, song, recorder):
    component.handle_set_name(
        ("tracks/0", "résumé".encode("utf-8")), source_addr=None,
    )
    assert song.tracks[0].name == "résumé"


# --- validate-and-reject (no LOM write on bad value) ----------------------


def test_handle_set_color_rejects_negative(component, song, recorder):
    component.handle_set_color(("tracks/0", -1), source_addr=None)
    assert song.tracks[0].color == 0  # unchanged
    errors = recorder.errors()
    assert len(errors) == 1
    addr, code, path, detail = errors[0]
    assert (addr, code, path) == (
        V3_TRACK_COLOR_ADDRESS, V3_ERROR_WRITE_REJECTED, "tracks/0",
    )


def test_handle_set_color_rejects_overflow(component, song, recorder):
    component.handle_set_color(("tracks/0", 0x1000000), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_color_accepts_whole_number_float(component, song, recorder):
    # The OSC bridge encodes JS numbers as float32, so RGB ints arrive as floats.
    component.handle_set_color(("tracks/0", 5420936.0), source_addr=None)
    assert song.tracks[0].color == 0x52B788
    assert recorder.errors() == []


def test_handle_set_color_rejects_fractional_float(component, song, recorder):
    component.handle_set_color(("tracks/0", 1.5), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_pan_rejects_out_of_range(component, song, recorder):
    component.handle_set_pan(("tracks/0", 2.0), source_addr=None)
    assert song.tracks[0].panning == 0.0
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_pan_rejects_nan(component, song, recorder):
    component.handle_set_pan(("tracks/0", float("nan")), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_arm_rejects_string_value(component, song, recorder):
    component.handle_set_arm(("tracks/0", "on"), source_addr=None)
    assert song.tracks[0].arm is False
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_name_rejects_empty(component, song, recorder):
    component.handle_set_name(("tracks/0", ""), source_addr=None)
    assert song.tracks[0].name == "T0"
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_name_rejects_too_long(component, song, recorder):
    component.handle_set_name(("tracks/0", "x" * 256), source_addr=None)
    assert song.tracks[0].name == "T0"
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


def test_handle_set_input_routing_lom_rejection_emits_invalid_routing(
    component, song, recorder,
):
    song.tracks[0]._raise_on.add("input_routing_type")
    component.handle_set_input_routing_type(
        ("tracks/0", "Bogus"), source_addr=None,
    )
    err = recorder.errors()[0]
    assert err[1] == V3_ERROR_WRITE_REJECTED
    assert err[3] == "invalid-routing"


# --- path handling --------------------------------------------------------


def test_path_malformed_rejects(component, recorder):
    # "tracks/abc" passes the regular-track prefix check but fails the
    # resolver's digit parse → MALFORMED → path-not-found on the wire.
    component.handle_set_name(("tracks/abc", "x"), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_FOUND


def test_path_without_tracks_prefix_rejects_not_supported(component, recorder):
    component.handle_set_name(("not a path", "x"), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_SUPPORTED


def test_path_not_found_rejects(component, recorder):
    component.handle_set_name(("tracks/99", "x"), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_FOUND


def test_path_master_rejects_not_supported(component, recorder):
    component.handle_set_name(("master", "x"), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_SUPPORTED


def test_path_returns_rejects_not_supported(component, recorder):
    component.handle_set_name(("returns/0", "x"), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_SUPPORTED


def test_missing_args_rejects(component, recorder):
    component.handle_set_name(("tracks/0",), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED


# --- generation gate ------------------------------------------------------


def test_stale_generation_rejects(component, song, recorder):
    # Advance surface gen; UI passes the prior one.
    component._generation.advance("test")
    component.handle_set_name(
        ("tracks/0", "Nope", 1), source_addr=None,
    )
    assert song.tracks[0].name == "T0"
    assert recorder.errors()[0][1] == V3_ERROR_GENERATION_STALE


def test_missing_generation_arg_bypasses_check(component, song, recorder):
    # No ui_gen → no stale check; LOM write still happens.
    component._generation.advance("test")
    component.handle_set_name(("tracks/0", "OK"), source_addr=None)
    assert song.tracks[0].name == "OK"
    assert recorder.errors() == []


def test_matching_generation_accepts(component, song, recorder):
    component._generation.advance("test")
    component.handle_set_name(
        ("tracks/0", "OK", component._generation.current),
        source_addr=None,
    )
    assert song.tracks[0].name == "OK"
    assert recorder.errors() == []


def test_generation_not_wired_rejects_with_surface_misconfigured(
    song, recorder,
):
    c = TrackMetadataComponent(song=song, emit=recorder)
    try:
        # No set_generation call — ui_gen arg should trip the guard.
        c.handle_set_name(("tracks/0", "X", 42), source_addr=None)
        err = recorder.errors()[0]
        assert err[1] == V3_ERROR_WRITE_REJECTED
        assert "misconfigured" in err[3]
    finally:
        c.disconnect()


# --- mute toggle ----------------------------------------------------------


def test_handle_mute_toggle_flips_false_to_true_and_suppresses_echo(
    component, song, recorder,
):
    assert song.tracks[0].mute is False
    component.handle_mute_toggle(("tracks/0",), source_addr=None)
    assert song.tracks[0].mute is True
    # The setattr fires the listener; suppression must swallow it.
    assert recorder.only(V3_TRACK_MUTE_ADDRESS) == []
    assert recorder.errors() == []


def test_handle_mute_toggle_flips_true_to_false(component, song, recorder):
    song.tracks[0].mute = True
    recorder.clear()
    component.handle_mute_toggle(("tracks/0",), source_addr=None)
    assert song.tracks[0].mute is False
    assert recorder.only(V3_TRACK_MUTE_ADDRESS) == []


def test_handle_mute_toggle_subsequent_external_change_still_emits(
    component, song, recorder,
):
    component.handle_mute_toggle(("tracks/0",), source_addr=None)
    # External flip after the toggle must NOT be swallowed.
    song.tracks[0].mute = False
    assert recorder.only(V3_TRACK_MUTE_ADDRESS) == [("tracks/0", 0)]


def test_handle_mute_toggle_targets_only_resolved_track(
    component, song, recorder,
):
    component.handle_mute_toggle(("tracks/1",), source_addr=None)
    assert song.tracks[0].mute is False
    assert song.tracks[1].mute is True


def test_handle_mute_toggle_missing_args_rejects(component, song, recorder):
    component.handle_mute_toggle((), source_addr=None)
    assert song.tracks[0].mute is False
    err = recorder.errors()[0]
    assert err[:3] == (V3_TRACK_MUTE_TOGGLE_ADDRESS, V3_ERROR_WRITE_REJECTED, "")


def test_handle_mute_toggle_master_rejects_not_supported(
    component, song, recorder,
):
    component.handle_mute_toggle(("master",), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_SUPPORTED


def test_handle_mute_toggle_returns_rejects_not_supported(
    component, song, recorder,
):
    component.handle_mute_toggle(("returns/0",), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_SUPPORTED


def test_handle_mute_toggle_malformed_path_rejects_not_found(
    component, recorder,
):
    component.handle_mute_toggle(("tracks/abc",), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_FOUND


def test_handle_mute_toggle_unknown_track_rejects_not_found(
    component, recorder,
):
    component.handle_mute_toggle(("tracks/99",), source_addr=None)
    assert recorder.errors()[0][1] == V3_ERROR_PATH_NOT_FOUND


def test_handle_mute_toggle_lom_rejection_emits_write_rejected(
    component, song, recorder,
):
    song.tracks[0]._raise_on.add("mute")
    component.handle_mute_toggle(("tracks/0",), source_addr=None)
    assert song.tracks[0].mute is False
    err = recorder.errors()[0]
    assert err[1] == V3_ERROR_WRITE_REJECTED
    assert err[2] == "tracks/0"
    # Suppression must be cleared so a future external mute fire emits.
    song.tracks[0]._raise_on.discard("mute")
    song.tracks[0].mute = True
    assert recorder.only(V3_TRACK_MUTE_ADDRESS) == [("tracks/0", 1)]


def test_handle_mute_toggle_after_disconnect_is_noop(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    recorder.clear()
    c.handle_mute_toggle(("tracks/0",), source_addr=None)
    assert song.tracks[0].mute is False
    assert recorder.emissions == []


# --- multi-track fan-out --------------------------------------------------


def test_fire_on_one_track_does_not_emit_for_others(component, song, recorder):
    song.tracks[1].name = "Just Track 1"
    emits = recorder.only(V3_TRACK_NAME_ADDRESS)
    assert emits == [("tracks/1", "Just Track 1")]


# --- structural change rebind --------------------------------------------


def test_structural_change_attaches_listener_for_new_track(
    component, song, recorder,
):
    new_track = StubTrack(name="T2")
    song.set_tracks(song.tracks + [new_track])
    component.on_structural_change()
    new_track.name = "Renamed T2"
    assert recorder.only(V3_TRACK_NAME_ADDRESS) == [("tracks/2", "Renamed T2")]


def test_structural_change_drops_departed_track_from_state(
    component, song, recorder,
):
    departed = song.tracks[1]
    song.set_tracks([song.tracks[0]])
    component.on_structural_change()
    # No detach record on _listeners targets the departed track.
    targets = [target for target, *_ in component._listeners]
    assert departed not in targets


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_listeners(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    for track in song.tracks:
        for attr in (
            "name", "color", "arm", "mute", "solo", "panning",
            "input_routing_type", "input_routing_channel",
        ):
            assert track._listeners[attr] is None


def test_disconnect_is_idempotent(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    c.disconnect()  # should not raise


def test_late_fire_after_disconnect_does_not_emit(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    # Grab the listener callback before disconnect so we can fire it
    # manually (simulating LOM racing the teardown).
    cb = song.tracks[0]._listeners["name"]
    c.disconnect()
    recorder.clear()
    cb()  # late fire — must be swallowed by the _disconnected guard
    assert recorder.emissions == []


# --- PR-7c: arrangement_clips read-only listener -------------------------


class _GenerationSpy:
    """Callable that records reason strings passed to advance_generation."""

    def __init__(self):
        self.calls: List[str] = []

    def __call__(self, reason: str) -> None:
        self.calls.append(reason)


def test_arrangement_clips_listener_attached_on_every_regular_track(
    song, recorder,
):
    c = TrackMetadataComponent(song=song, emit=recorder)
    try:
        for track in song.tracks:
            assert track.__dict__["_arrangement_clips_listener"] is not None
    finally:
        c.disconnect()


def test_arrangement_clips_fire_emits_focused_address_with_flag_1(
    song, recorder,
):
    gen = _GenerationSpy()
    c = TrackMetadataComponent(
        song=song, emit=recorder, advance_generation=gen,
    )
    try:
        song.tracks[0].set_arrangement_clips([object()])
        assert recorder.only(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS) == [
            ("tracks/0", 1),
        ]
        assert gen.calls == ["arrangement-clips-changed"]
    finally:
        c.disconnect()


def test_arrangement_clips_fire_emits_flag_0_when_empty(song, recorder):
    gen = _GenerationSpy()
    song.tracks[0].set_arrangement_clips([object()])
    c = TrackMetadataComponent(
        song=song, emit=recorder, advance_generation=gen,
    )
    try:
        # Now remove the clip — fire emits flag 0.
        song.tracks[0].set_arrangement_clips([])
        payloads = recorder.only(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS)
        assert payloads == [("tracks/0", 0)]
        assert gen.calls == ["arrangement-clips-changed"]
    finally:
        c.disconnect()


def test_arrangement_clips_fire_without_advance_generation_still_emits(
    song, recorder,
):
    c = TrackMetadataComponent(song=song, emit=recorder)
    try:
        song.tracks[0].set_arrangement_clips([object()])
        assert recorder.only(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS) == [
            ("tracks/0", 1),
        ]
    finally:
        c.disconnect()


def test_arrangement_clips_fire_on_one_track_is_isolated(song, recorder):
    gen = _GenerationSpy()
    c = TrackMetadataComponent(
        song=song, emit=recorder, advance_generation=gen,
    )
    try:
        song.tracks[1].set_arrangement_clips([object()])
        payloads = recorder.only(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS)
        assert payloads == [("tracks/1", 1)]
    finally:
        c.disconnect()


def test_arrangement_clips_read_error_swallowed_no_emit(song, recorder):
    gen = _GenerationSpy()
    c = TrackMetadataComponent(
        song=song, emit=recorder, advance_generation=gen,
    )
    try:
        song.tracks[0]._raise_on_arrangement_clips_read = True
        song.tracks[0].fire_arrangement_clips()
        assert recorder.only(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS) == []
        assert gen.calls == []
    finally:
        c.disconnect()


def test_arrangement_clips_missing_listener_method_is_graceful(recorder):
    track = StubTrack(name="Legacy")
    track._expose_arrangement_clips_listener = False
    song = StubSong(tracks=[track])
    c = TrackMetadataComponent(song=song, emit=recorder)
    try:
        # No listener attached; the component does not explode on init.
        assert track.__dict__["_arrangement_clips_listener"] is None
        # Nor on structural change.
        c.on_structural_change()
        assert track.__dict__["_arrangement_clips_listener"] is None
    finally:
        c.disconnect()


def test_arrangement_clips_rebinds_on_structural_change_for_new_track(
    song, recorder,
):
    gen = _GenerationSpy()
    c = TrackMetadataComponent(
        song=song, emit=recorder, advance_generation=gen,
    )
    try:
        new_track = StubTrack(name="T2")
        song.set_tracks(song.tracks + [new_track])
        c.on_structural_change()
        new_track.set_arrangement_clips([object()])
        assert recorder.only(V3_TRACK_HAS_ARRANGEMENT_CLIPS_ADDRESS) == [
            ("tracks/2", 1),
        ]
        assert gen.calls == ["arrangement-clips-changed"]
    finally:
        c.disconnect()


def test_disconnect_detaches_arrangement_clips_listener(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    for track in song.tracks:
        assert track.__dict__["_arrangement_clips_listener"] is None


def test_late_arrangement_clips_fire_after_disconnect_does_not_emit(
    song, recorder,
):
    gen = _GenerationSpy()
    c = TrackMetadataComponent(
        song=song, emit=recorder, advance_generation=gen,
    )
    # Grab the listener callback before disconnect (LOM can race teardown).
    cb = song.tracks[0].__dict__["_arrangement_clips_listener"]
    c.disconnect()
    recorder.clear()
    cb()
    assert recorder.emissions == []
    assert gen.calls == []


# --- fresh-wrapper StubSong (issue #399) ---------------------------------
#
# The plain ``StubSong`` above re-uses the same ``StubTrack`` instances
# across ``song.tracks`` reads, so identity-keyed bookkeeping accidentally
# works in tests but fails in Live's v3 framework (which hands out fresh
# wrappers per read — ADR-350). The fresh-wrapper fixtures below mimic
# Live's behavior so the structural-change rebind is exercised honestly:
# each read delivers new wrapper objects that delegate to the same
# underlying core. A listener attached through one wrapper must be
# detachable via any other wrapper that shares the same core.


class _FreshTrackWrapper:
    """Per-read wrapper around a ``StubTrack`` core.

    Every attribute access — values, listener add/remove,
    ``mixer_device`` (which itself yields a fresh wrapper), and
    ``arrangement_clips`` — delegates to the core. The wrapper has
    unique ``id()`` per instance, the hostile shape that broke
    ``id(track)``-keyed bookkeeping in the dead branch.
    """

    __slots__ = ("_core",)

    def __init__(self, core: StubTrack):
        object.__setattr__(self, "_core", core)

    def __getattr__(self, name):
        return getattr(self._core, name)

    def __setattr__(self, name, value):
        if name == "_core":
            object.__setattr__(self, name, value)
            return
        setattr(self._core, name, value)


class FreshWrapperSong:
    """``StubSong`` whose ``tracks`` returns fresh wrappers per read."""

    def __init__(self, cores: List[StubTrack]) -> None:
        self._cores = list(cores)

    @property
    def tracks(self):
        return [_FreshTrackWrapper(c) for c in self._cores]

    def set_cores(self, cores: List[StubTrack]) -> None:
        self._cores = list(cores)


@pytest.fixture
def fw_cores() -> List[StubTrack]:
    return [
        StubTrack(name="T0"),
        StubTrack(name="T1"),
        StubTrack(name="T2"),
    ]


@pytest.fixture
def fw_song(fw_cores) -> FreshWrapperSong:
    return FreshWrapperSong(fw_cores)


def test_fresh_wrappers_delete_in_middle_no_sibling_contamination(
    fw_song, fw_cores, recorder,
):
    """Issue #399 core regression: delete track 1, survivor at new index
    1 must emit on ``tracks/1`` only — never on its prior path
    ``tracks/2``, which would contaminate the UI's volume slider for
    the now-shifted track.
    """
    c = TrackMetadataComponent(song=fw_song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        recorder.clear()

        survivor = fw_cores[2]
        fw_song.set_cores([fw_cores[0], fw_cores[2]])
        c.on_structural_change()

        # Outside edit on the survivor (slider moved in Live).
        survivor.name = "Renamed"
        emits = recorder.only(V3_TRACK_NAME_ADDRESS)
        assert emits == [("tracks/1", "Renamed")], (
            "expected emit on new path tracks/1; "
            "stale closure on old path tracks/2 would contaminate"
        )
        # And nothing else got emitted under tracks/2.
        for path, _ in emits:
            assert path != "tracks/2"
    finally:
        c.disconnect()


def test_fresh_wrappers_no_structural_change_is_idempotent(
    fw_song, fw_cores, recorder,
):
    """Repeated ``on_structural_change()`` with no actual change does
    not leak listeners (no double-attach). The dead branch failed here:
    its ``id(track)``-keyed map never matched on subsequent reads, so
    every call appended a fresh listener and the stub's one-slot assert
    tripped. Detach-all-and-rebind makes this a non-issue.
    """
    c = TrackMetadataComponent(song=fw_song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        for _ in range(3):
            c.on_structural_change()
        # Each attr on each core has exactly one listener slot occupied.
        for core in fw_cores:
            for attr in (
                "name", "color", "arm", "mute", "solo", "panning",
                "input_routing_type", "input_routing_channel",
            ):
                assert core._listeners[attr] is not None, (
                    "attr %s on core slipped to None — leak/double-attach"
                    % attr
                )
            assert core.__dict__["_arrangement_clips_listener"] is not None
    finally:
        c.disconnect()


def test_fresh_wrappers_add_at_end_existing_tracks_keep_working(
    fw_song, fw_cores, recorder,
):
    new_core = StubTrack(name="T3")
    c = TrackMetadataComponent(song=fw_song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        recorder.clear()

        fw_song.set_cores(list(fw_cores) + [new_core])
        c.on_structural_change()

        # New track gets a listener and emits on tracks/3.
        new_core.name = "Renamed T3"
        assert ("tracks/3", "Renamed T3") in recorder.only(
            V3_TRACK_NAME_ADDRESS,
        )
        # Existing tracks still emit on their original paths.
        fw_cores[0].name = "Renamed T0"
        assert ("tracks/0", "Renamed T0") in recorder.only(
            V3_TRACK_NAME_ADDRESS,
        )
    finally:
        c.disconnect()


def test_fresh_wrappers_reorder_emits_on_new_paths_only(
    fw_song, fw_cores, recorder,
):
    """Reverse track order; each surviving core emits on its NEW path."""
    c = TrackMetadataComponent(song=fw_song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        recorder.clear()

        fw_song.set_cores(list(reversed(fw_cores)))  # [2, 1, 0]
        c.on_structural_change()

        # cores[0] now at index 2; cores[2] now at index 0.
        fw_cores[0].name = "Was T0"
        fw_cores[2].name = "Was T2"

        emits = recorder.only(V3_TRACK_NAME_ADDRESS)
        # Each fires once on its new path.
        assert ("tracks/2", "Was T0") in emits
        assert ("tracks/0", "Was T2") in emits
        # And no emit on the old paths for those cores.
        assert ("tracks/0", "Was T0") not in emits
        assert ("tracks/2", "Was T2") not in emits
    finally:
        c.disconnect()


# --- ROW 7c: handle_set_send — /looping/v3/track/send --------------------


class _SendParam:
    """Mirror of a ``DeviceParameter`` on ``mixer_device.sends[N]``.

    Minimal surface: ``value`` is a read/write float. Tests that
    expect LOM-reject flip ``_raise_on_set`` before invoking the
    handler.
    """

    def __init__(self, value: float = 0.0):
        self.value = value
        self._raise_on_set = False

    def __setattr__(self, name, value):
        if name == "value" and self.__dict__.get("_raise_on_set"):
            raise RuntimeError("LOM rejects sends.value=%r" % value)
        object.__setattr__(self, name, value)


class _Mixer:
    def __init__(self, sends):
        self.sends = tuple(sends)


def _attach_sends(track: StubTrack, num_sends: int = 2) -> list:
    """Attach ``mixer_device.sends`` to a StubTrack and return the list of
    send params so the test can mutate values and assert against them."""
    params = [_SendParam(value=0.0) for _ in range(num_sends)]
    object.__setattr__(track, "mixer_device", _Mixer(params))
    return params


def test_handle_set_send_writes_value_into_mixer(component, song, recorder):
    sends = _attach_sends(song.tracks[0], num_sends=2)
    component.handle_set_send(("tracks/0", 0, 0.75), source_addr=None)
    assert sends[0].value == pytest.approx(0.75)
    assert sends[1].value == pytest.approx(0.0)
    # Write-only wire — no emit path on success.
    assert recorder.only(V3_TRACK_SEND_ADDRESS) == []
    assert recorder.errors() == []


def test_handle_set_send_targets_specified_index_only(
    component, song, recorder,
):
    sends = _attach_sends(song.tracks[0], num_sends=3)
    component.handle_set_send(("tracks/0", 2, 1.0), source_addr=None)
    assert [s.value for s in sends] == [pytest.approx(0.0), pytest.approx(0.0), pytest.approx(1.0)]


def test_handle_set_send_targets_resolved_track_only(
    component, song, recorder,
):
    sends_0 = _attach_sends(song.tracks[0], num_sends=1)
    sends_1 = _attach_sends(song.tracks[1], num_sends=1)
    component.handle_set_send(("tracks/1", 0, 0.5), source_addr=None)
    assert sends_0[0].value == pytest.approx(0.0)
    assert sends_1[0].value == pytest.approx(0.5)


def test_handle_set_send_missing_args_rejects(component, song, recorder):
    _attach_sends(song.tracks[0], num_sends=1)
    component.handle_set_send(("tracks/0", 0), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    originating, code, _path, _detail = errors[0]
    assert originating == V3_TRACK_SEND_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED


def test_handle_set_send_non_integer_index_rejects(component, song, recorder):
    _attach_sends(song.tracks[0], num_sends=1)
    component.handle_set_send(("tracks/0", "oops", 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert "sendIndex" in detail


def test_handle_set_send_non_numeric_value_rejects(component, song, recorder):
    _attach_sends(song.tracks[0], num_sends=1)
    component.handle_set_send(("tracks/0", 0, "loud"), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert "value" in detail


def test_handle_set_send_master_rejects_not_supported(
    component, song, recorder,
):
    """Sends only exist on regular tracks; master must reject without
    touching LOM."""
    component.handle_set_send(("master", 0, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, path, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_SUPPORTED
    assert path == "master"


def test_handle_set_send_returns_rejects_not_supported(
    component, song, recorder,
):
    component.handle_set_send(("returns/0", 0, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, path, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_SUPPORTED
    assert path == "returns/0"


def test_handle_set_send_malformed_path_rejects_not_found(
    component, song, recorder,
):
    """Malformed ``tracks/<N>`` shapes pass the regular-track prefix
    guard but fail in ``resolve_track`` with ``MALFORMED`` → path-not-found.
    Fully-unrecognized prefixes (``master`` / ``returns/…``) are handled
    by ``_is_regular_track_path`` one layer up and reject with
    ``path-not-supported`` — see the master/returns tests above."""
    component.handle_set_send(("tracks/abc", 0, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_handle_set_send_unknown_track_rejects_not_found(
    component, song, recorder,
):
    component.handle_set_send(("tracks/99", 0, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, path, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/99"


def test_handle_set_send_index_out_of_range_rejects_not_found(
    component, song, recorder,
):
    _attach_sends(song.tracks[0], num_sends=2)
    component.handle_set_send(("tracks/0", 5, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, detail = errors[0]
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert "out of range" in detail


def test_handle_set_send_negative_index_rejects_not_found(
    component, song, recorder,
):
    _attach_sends(song.tracks[0], num_sends=2)
    component.handle_set_send(("tracks/0", -1, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_handle_set_send_lom_rejection_emits_write_rejected(
    component, song, recorder,
):
    sends = _attach_sends(song.tracks[0], num_sends=1)
    sends[0]._raise_on_set = True
    component.handle_set_send(("tracks/0", 0, 0.5), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert "sends[0] write raised" in detail


def test_handle_set_send_after_disconnect_is_noop(song, recorder):
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    sends = _attach_sends(song.tracks[0], num_sends=1)
    c.disconnect()
    recorder.clear()
    c.handle_set_send(("tracks/0", 0, 0.9), source_addr=None)
    assert sends[0].value == pytest.approx(0.0)
    assert recorder.emissions == []


def test_send_wire_address_is_stable():
    assert V3_TRACK_SEND_ADDRESS == "/looping/v3/track/send"


# --- ADR-410: group-track fold state ---------------------------------------
#
# Live 12.4.5b8, verified via /looping/probe/lom_introspect against a
# live set: ``Track`` has ``is_foldable`` / ``fold_state`` /
# ``is_grouped`` / ``group_track`` / ``is_visible``, but NO
# ``add_fold_state_listener`` and NO ``add_is_visible_listener``.
# ``Song.add_visible_tracks_listener`` DOES exist, so that song-scoped
# observable is the fold signal, and the write path echoes its own
# value (there is no per-track listener to do it).


@pytest.fixture
def group_song():
    """tracks/0 is a Group Track; tracks/1 and tracks/2 are regular."""
    return StubSong(tracks=[
        StubTrack(name="G", is_foldable=True, fold_state=False),
        StubTrack(name="T1"),
        StubTrack(name="T2"),
    ])


@pytest.fixture
def group_component(group_song, recorder):
    c = TrackMetadataComponent(song=group_song, emit=recorder)
    c.set_generation(GenerationComponent())
    yield c
    c.disconnect()


def test_fold_state_wire_addresses_are_stable():
    assert V3_TRACK_FOLD_STATE_ADDRESS == "/looping/v3/track/fold_state"
    assert V3_TRACK_SET_FOLD_STATE_ADDRESS == "/looping/v3/track/set/fold_state"


def test_init_seeds_fold_cache_without_emitting(group_song, recorder):
    """Cold start must not spam fold echoes — the T-record carries the
    initial value, this cache exists only to diff later fires."""
    c = TrackMetadataComponent(song=group_song, emit=recorder)
    try:
        assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == []
    finally:
        c.disconnect()


def test_visible_tracks_fire_emits_changed_fold_state(
    group_component, group_song, recorder,
):
    """The Live-side fold path: user folds the group in Live's UI, the
    only thing that fires is ``song.visible_tracks``."""
    recorder.clear()
    group_song.tracks[0].fold_state = True
    group_song.fire_visible_tracks()
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == [("tracks/0", 1)]


def test_visible_tracks_fire_dedups_unchanged_fold_state(
    group_component, group_song, recorder,
):
    """``visible_tracks`` also fires on plain track add/remove, so an
    unchanged fold state must not put anything on the wire."""
    recorder.clear()
    group_song.fire_visible_tracks()
    group_song.fire_visible_tracks()
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == []


def test_visible_tracks_fire_skips_non_foldable_tracks(
    group_component, group_song, recorder,
):
    """``fold_state`` raises on a regular track. If the walk read it
    unguarded, this fire would blow up instead of emitting nothing."""
    recorder.clear()
    group_song.fire_visible_tracks()
    assert recorder.errors() == []
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == []


def test_handle_set_fold_state_writes_and_echoes(
    group_component, group_song, recorder,
):
    recorder.clear()
    group_component.handle_set_fold_state(("tracks/0", 1), source_addr=None)
    assert group_song.tracks[0].fold_state is True
    # Write-path echo: no listener exists to produce one.
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == [("tracks/0", 1)]


def test_handle_set_fold_state_unfold_writes_false(
    group_component, group_song, recorder,
):
    group_song.tracks[0].fold_state = True
    recorder.clear()
    group_component.handle_set_fold_state(("tracks/0", 0), source_addr=None)
    assert group_song.tracks[0].fold_state is False
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == [("tracks/0", 0)]


def test_handle_set_fold_state_echo_suppresses_listener_duplicate(
    group_component, group_song, recorder,
):
    """Our own write updates the cache, so the ``visible_tracks`` fire
    Live raises in response is a dedup'd no-op rather than a second
    identical emit."""
    recorder.clear()
    group_component.handle_set_fold_state(("tracks/0", 1), source_addr=None)
    group_song.fire_visible_tracks()
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == [("tracks/0", 1)]


def test_handle_set_fold_state_on_regular_track_rejects(
    group_component, recorder,
):
    recorder.clear()
    group_component.handle_set_fold_state(("tracks/1", 1), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, path, detail = errors[0]
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/1"
    assert "not a group track" in detail
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == []


def test_handle_set_fold_state_master_rejects_not_supported(
    group_component, recorder,
):
    recorder.clear()
    group_component.handle_set_fold_state(("master", 1), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_SUPPORTED


def test_handle_set_fold_state_out_of_range_rejects_not_found(
    group_component, recorder,
):
    recorder.clear()
    group_component.handle_set_fold_state(("tracks/99", 1), source_addr=None)
    errors = recorder.errors()
    assert len(errors) == 1
    _, code, _, _ = errors[0]
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_handle_set_fold_state_bad_args_reject(group_component, recorder):
    recorder.clear()
    group_component.handle_set_fold_state(("tracks/0",), source_addr=None)
    group_component.handle_set_fold_state(("tracks/0", "yes"), source_addr=None)
    codes = [code for _, code, _, _ in recorder.errors()]
    assert codes == [V3_ERROR_WRITE_REJECTED, V3_ERROR_WRITE_REJECTED]


def test_handle_set_fold_state_after_disconnect_is_noop(
    group_song, recorder,
):
    c = TrackMetadataComponent(song=group_song, emit=recorder)
    c.set_generation(GenerationComponent())
    c.disconnect()
    recorder.clear()
    c.handle_set_fold_state(("tracks/0", 1), source_addr=None)
    assert group_song.tracks[0].fold_state is False
    assert recorder.emissions == []


def test_disconnect_detaches_visible_tracks_listener(group_song, recorder):
    c = TrackMetadataComponent(song=group_song, emit=recorder)
    c.disconnect()
    assert group_song._visible_tracks_listener is None
    # A late fire after detach must not reach the wire.
    recorder.clear()
    group_song.fire_visible_tracks()
    assert recorder.emissions == []


def test_structural_change_reseeds_fold_cache_on_index_shift(
    group_component, group_song, recorder,
):
    """Fold cache is keyed on ``tracks/<N>``. After an insert above the
    group, the same group lives at a new path — a stale cache would
    make the next real fold look unchanged and swallow the emit."""
    group_song.set_tracks([
        StubTrack(name="new"),
        group_song.tracks[0],
        group_song.tracks[1],
        group_song.tracks[2],
    ])
    group_component.on_structural_change()
    recorder.clear()
    group_song.tracks[1].fold_state = True
    group_song.fire_visible_tracks()
    assert recorder.only(V3_TRACK_FOLD_STATE_ADDRESS) == [("tracks/1", 1)]


# --- protocol 3.7.0: /looping/v3/track/set_role ----------------------------
#
# Role is NOT a LOM attribute — it lives in Live's per-track key-value
# store (`Track.set_data`), a shared namespace Ableton's own Push and
# Move firmware also write into. Hence its own handler rather than a
# ninth entry in the generic `_handle_set` machine, and hence the
# `looping.` key prefix.


class _StoreTrack(StubTrack):
    """StubTrack carrying Live 12's per-track key-value store."""

    def __init__(self, name="", raises=False, **kw):
        super().__init__(name=name, **kw)
        object.__setattr__(self, "data_store", {})
        object.__setattr__(self, "_data_raises", raises)

    def set_data(self, key, value):
        if self.__dict__["_data_raises"]:
            raise RuntimeError("no data store on this build")
        self.__dict__["data_store"][key] = value


@pytest.fixture
def role_component(recorder):
    song = StubSong(tracks=[_StoreTrack(name="T0"), _StoreTrack(name="T1")])
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    yield c, song, recorder
    c.disconnect()


def test_set_role_writes_the_namespaced_key(role_component):
    c, song, rec = role_component
    c.handle_set_role(("tracks/0", "drum"), None)
    assert song.tracks[0].data_store == {TRACK_ROLE_DATA_KEY: "drum"}
    assert TRACK_ROLE_DATA_KEY == "looping.role", (
        "the store is shared with Push/Move — the prefix is load-bearing"
    )


def test_set_role_echoes_on_success(role_component):
    c, _song, rec = role_component
    c.handle_set_role(("tracks/0", "perc"), None)
    assert rec.only(V3_TRACK_ROLE_ADDRESS) == [("tracks/0", "perc")]
    assert rec.errors() == []


def test_set_role_touches_only_the_named_track(role_component):
    c, song, _rec = role_component
    c.handle_set_role(("tracks/1", "bass"), None)
    assert song.tracks[0].data_store == {}
    assert song.tracks[1].data_store == {TRACK_ROLE_DATA_KEY: "bass"}


def test_set_role_accepts_an_empty_role_as_a_clear(role_component):
    """A key cannot be deleted from Live's store, so "" is how a role is
    withdrawn — and the reader collapses "" and None to "no role"."""
    c, song, rec = role_component
    c.handle_set_role(("tracks/0", "drum"), None)
    c.handle_set_role(("tracks/0", ""), None)
    assert song.tracks[0].data_store == {TRACK_ROLE_DATA_KEY: ""}
    assert rec.errors() == []


def test_set_role_rejects_short_args_without_writing(role_component):
    c, song, rec = role_component
    c.handle_set_role(("tracks/0",), None)
    assert song.tracks[0].data_store == {}
    assert len(rec.errors()) == 1


def test_set_role_rejects_master(role_component):
    """Master carries no instrument, so it carries no rail."""
    c, _song, rec = role_component
    c.handle_set_role(("master", "drum"), None)
    assert rec.only(V3_TRACK_ROLE_ADDRESS) == []
    assert rec.errors() and rec.errors()[0][1] == V3_ERROR_PATH_NOT_SUPPORTED


def test_set_role_rejects_an_out_of_range_track(role_component):
    c, _song, rec = role_component
    c.handle_set_role(("tracks/99", "drum"), None)
    assert rec.only(V3_TRACK_ROLE_ADDRESS) == []
    assert rec.errors() and rec.errors()[0][1] == V3_ERROR_PATH_NOT_FOUND


def test_set_role_reports_a_missing_data_store_rather_than_raising(recorder):
    """`set_data` is a Live 12 API. On an older build the write must come
    back as an error, not an exception on the control thread — the UI
    then degrades to the catalog fallback it used before 3.7.0."""
    song = StubSong(tracks=[_StoreTrack(name="T0", raises=True)])
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        c.handle_set_role(("tracks/0", "drum"), None)
        assert recorder.only(V3_TRACK_ROLE_ADDRESS) == []
        assert recorder.errors() and recorder.errors()[0][1] == V3_ERROR_WRITE_REJECTED
    finally:
        c.disconnect()


def test_set_role_after_disconnect_is_a_noop(role_component):
    c, song, rec = role_component
    c.disconnect()
    rec.clear()
    c.handle_set_role(("tracks/0", "drum"), None)
    assert song.tracks[0].data_store == {}
    assert rec.emissions == []


def test_set_role_takes_no_generation_argument(role_component):
    """Deliberately ungated: a role is recorded BY the load that just
    happened, on the prepare-ack path where a generation advance is
    already in flight. A third arg must not be mistaken for one."""
    c, song, rec = role_component
    c.handle_set_role(("tracks/0", "drum", 999_999), None)
    assert song.tracks[0].data_store == {TRACK_ROLE_DATA_KEY: "drum"}
    assert rec.errors() == []


def test_set_role_address_matches_wire_contract():
    assert V3_TRACK_SET_ROLE_ADDRESS == "/looping/v3/track/set_role"
    assert V3_TRACK_ROLE_ADDRESS == "/looping/v3/track/role"


# --- role validation (ADR-425) ---------------------------------------------


def test_valid_roles_match_constants_json():
    """``VALID_TRACK_ROLES`` mirrors ``constants.json`` vendors.types.

    The tuple is duplicated in the component rather than threaded
    through ``config_loader`` — one check does not justify the coupling
    — so this is what stops the copy drifting. The scale bench's arity
    table drifted twice for want of exactly this.
    """
    import json
    import os

    from components.TrackMetadataComponent import VALID_TRACK_ROLES
    from config_loader import _find_constants_path

    path = _find_constants_path()
    assert path and os.path.isfile(path), "constants.json not found"
    with open(path, encoding="utf-8") as fh:
        constants = json.load(fh)

    assert set(VALID_TRACK_ROLES) == set(constants["vendors"]["types"].keys())


def test_set_role_rejects_an_unknown_role(role_component):
    """Live's store has no delete, so a bad value would persist forever."""
    c, song, rec = role_component
    c.handle_set_role(("tracks/0", "percussion"), None)

    assert rec.errors(), "an unknown role must be refused, not written"
    assert rec.only(V3_TRACK_ROLE_ADDRESS) == []
    assert song.tracks[0].data_store == {}, "nothing may reach the store"


def test_set_role_accepts_every_known_role(role_component):
    from components.TrackMetadataComponent import VALID_TRACK_ROLES

    c, _song, rec = role_component
    for role in VALID_TRACK_ROLES:
        rec.clear()
        c.handle_set_role(("tracks/0", role), None)
        echoed = rec.only(V3_TRACK_ROLE_ADDRESS)
        assert echoed and echoed[0][1] == role, "role %r must be accepted" % role


def test_set_role_allows_clearing(role_component):
    """``""`` is how a client says "no role" — it must not be refused."""
    c, _song, rec = role_component
    c.handle_set_role(("tracks/0", ""), None)

    assert rec.only(V3_TRACK_ROLE_ADDRESS)
    assert rec.errors() == []


# --- echo suppression across a structural change ---------------------------
#
# ``_suppress[(path, attr)]`` is armed BEFORE the LOM write and popped by
# the listener fire the write is expected to produce. Live only fires on an
# actual CHANGE, so a write that sets the value the track already holds
# arms the flag and never spends it.
#
# ``StubTrack`` cannot show that on its own: its ``__setattr__`` fires the
# listener unconditionally, so every armed flag is always popped and the
# whole failure mode is invisible. That is the same shape as the
# ``_FreshDeviceWrapper`` note in this file — the stub is more forgiving
# than Live, and the forgiving part is exactly where the bug lives. Hence a
# faithful variant below rather than an assertion on the real stub.


class _FiresOnChangeOnlyTrack(StubTrack):
    """A StubTrack with Live's actual fire rule: no change, no fire."""

    def __setattr__(self, name, value):
        values = self.__dict__.get("_values")
        if values is not None and name in values and values[name] == value:
            # Live's listener is a CHANGE listener. Setting the value it
            # already holds is a no-op all the way down — no fire.
            return
        StubTrack.__setattr__(self, name, value)


def test_idempotent_write_leaves_the_flag_armed_this_is_the_precondition():
    """Not the bug — the state the bug needs. Pinned so it can't drift."""
    song = StubSong(tracks=[_FiresOnChangeOnlyTrack(name="T0")])
    c = TrackMetadataComponent(song=song, emit=EmitRecorder())
    c.set_generation(GenerationComponent())
    try:
        # The track is already called "T0"; writing "T0" changes nothing,
        # so Live never fires and the flag is never spent.
        c.handle_set_name(("tracks/0", "T0"), source_addr=None)
        assert c._suppress.get(("tracks/0", "name")) is True
    finally:
        c.disconnect()


def test_structural_change_clears_stale_echo_suppression():
    """A flag armed for a fire that never came must not outlive the walk.

    Fails against the pre-fix component: ``on_structural_change`` rebuilt
    every listener and dropped ``_fold_states`` but never touched
    ``_suppress``, so the stale flag swallowed the next genuine fire — and
    because the key is a PATH, after a delete it swallowed it on a
    DIFFERENT track.
    """
    t0 = _FiresOnChangeOnlyTrack(name="T0")
    t1 = _FiresOnChangeOnlyTrack(name="T1")
    recorder = EmitRecorder()
    song = StubSong(tracks=[t0, t1])
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        c.handle_set_name(("tracks/0", "T0"), source_addr=None)
        assert c._suppress.get(("tracks/0", "name")) is True

        # Delete track 0. T1 is now tracks/0 — the path the stale flag
        # is keyed on.
        song.set_tracks([t1])
        c.on_structural_change()
        assert c._suppress == {}

        recorder.clear()
        t1.name = "Renamed in Live"
        assert recorder.only(V3_TRACK_NAME_ADDRESS) == [
            ("tracks/0", "Renamed in Live"),
        ]
    finally:
        c.disconnect()


def test_structural_change_does_not_disturb_a_live_suppression():
    """The clear is not free — say plainly what it costs.

    A flag armed by a write whose fire has not landed *yet* is dropped
    too, so that echo reaches the wire as if it were external. That is
    one redundant emit of a value the UI already shows, against a
    permanently blinded attribute — and in practice the fire is
    synchronous with the setattr, so the window is empty.
    """
    t0 = _FiresOnChangeOnlyTrack(name="T0")
    recorder = EmitRecorder()
    song = StubSong(tracks=[t0])
    c = TrackMetadataComponent(song=song, emit=recorder)
    c.set_generation(GenerationComponent())
    try:
        # A real change: the stub fires synchronously, so the flag is
        # spent before on_structural_change can see it.
        c.handle_set_name(("tracks/0", "Changed"), source_addr=None)
        assert c._suppress == {}
        c.on_structural_change()
        assert c._suppress == {}
    finally:
        c.disconnect()
