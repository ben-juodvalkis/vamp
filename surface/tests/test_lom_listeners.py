"""LOMListeners unit tests.

Covers the Phase 1 Commit A listener-bookkeeper surface: LOM listener
lifecycle (root ``tracks`` + per-track ``devices`` + per-param
``value``), the structural-change fan-out, the mutation callbacks
(``on_device_added``, ``on_device_removed``, ``on_param_value_changed``),
and the ``track_id_for`` reverse lookup used by ``MutationComponent``.

The forward-map surface (``resolve_param`` / ``resolve_legacy_param``
/ ``device_params``) that pre-existed Commit A retired with the class
rename; the v2 wire handlers in ``DevicesComponent`` now walk the
LOM inline. Tests for that walk live in ``test_devices_component.py``.

Uses a small stub LOM — one property-settable attribute per LOM object
that fires listeners synchronously on change, same pattern as
``test_session_component.py``'s ``StubSong``.
"""

from __future__ import annotations

from typing import List

import pytest

from components.LOMListeners import (
    LOMListeners,
    MASTER_TRACK_ID,
    _safe_int_id,
)


# --- stub LOM --------------------------------------------------------------


class StubParam:
    """Minimal stand-in for ``Live.DeviceParameter``."""

    def __init__(self, pid: int, name: str = "", value: float = 0.0,
                 min_v: float = 0.0, max_v: float = 1.0):
        self.id = pid
        self.name = name
        self.value = float(value)
        self.min = float(min_v)
        self.max = float(max_v)
        self._value_listener = None

    def add_value_listener(self, cb):
        assert self._value_listener is None, (
            "StubParam supports one value listener"
        )
        self._value_listener = cb

    def remove_value_listener(self, cb):
        assert self._value_listener == cb
        self._value_listener = None

    def has_value_listener(self) -> bool:
        return self._value_listener is not None

    def fire_value_change(self) -> None:
        if self._value_listener is not None:
            self._value_listener()

    def set_value(self, v: float) -> None:
        """Assign and fire — what real LOM does for any value write."""
        self.value = float(v)
        self.fire_value_change()


class StubDevice:
    def __init__(self, did: int, params: List[StubParam] | None = None,
                 name: str = "", class_name: str = "",
                 live_ptr: int | None = None):
        self.id = did
        self.name = name
        self.class_name = class_name
        self.parameters = list(params or [])
        # ``_live_ptr`` is still load-bearing for LOMListeners param
        # identity, GrooveComponent pool matching, and
        # SongChangeDetector (see docstrings in each). Default to ``did``
        # so existing fixtures get a deterministic non-zero value; pass
        # ``live_ptr`` explicitly to decouple from ``did`` for mask
        # tests. (D-record emission of ``_live_ptr`` retired in ROW 5
        # 2026-04-21 — protocol 3.3.0.)
        self._live_ptr = did if live_ptr is None else live_ptr


class StubTrack:
    """Track with a mutable devices list and a devices-listener slot."""

    def __init__(self, tid: int, devices: List[StubDevice] | None = None,
                 name: str = ""):
        self.id = tid
        self.name = name
        self._devices = list(devices or [])
        self._devices_listener = None

    @property
    def devices(self):
        return list(self._devices)

    def set_devices(self, devices: List[StubDevice]) -> None:
        """Replace the device list and fire the listener."""
        self._devices = list(devices)
        if self._devices_listener is not None:
            self._devices_listener()

    def add_devices_listener(self, cb):
        assert self._devices_listener is None, (
            "StubTrack supports one devices listener"
        )
        self._devices_listener = cb

    def remove_devices_listener(self, cb):
        assert self._devices_listener == cb
        self._devices_listener = None

    def has_devices_listener(self) -> bool:
        return self._devices_listener is not None


class StubSong:
    """Song with a mutable tracks list + master_track + tracks-listener."""

    def __init__(self, tracks: List[StubTrack] | None = None,
                 master: StubTrack | None = None):
        self._tracks = list(tracks or [])
        self.master_track = master if master is not None else StubTrack(
            tid=9_999_999, name="Master",
        )
        self._tracks_listener = None

    @property
    def tracks(self):
        return list(self._tracks)

    def set_tracks(self, tracks: List[StubTrack]) -> None:
        self._tracks = list(tracks)
        if self._tracks_listener is not None:
            self._tracks_listener()

    def add_tracks_listener(self, cb):
        assert self._tracks_listener is None
        self._tracks_listener = cb

    def remove_tracks_listener(self, cb):
        assert self._tracks_listener == cb
        self._tracks_listener = None

    def has_tracks_listener(self) -> bool:
        return self._tracks_listener is not None


# --- factories -------------------------------------------------------------


def make_param(pid, name="p"):
    return StubParam(pid=pid, name=name)


def make_device(did, params_spec):
    return StubDevice(did=did, params=[make_param(p) for p in params_spec])


def make_track(tid, devices_spec, name=""):
    return StubTrack(
        tid=tid,
        devices=[make_device(did, params) for did, params in devices_spec],
        name=name,
    )


# --- initial build: walk helpers & diagnostics ----------------------------


def test_initial_build_resolve_track_helpers():
    t1 = make_track(100, [(200, [301, 302])])
    t2 = make_track(101, [(201, [303])])
    song = StubSong(tracks=[t1, t2])

    reg = LOMListeners(song=song)

    # Master resolves at the ``-1`` sentinel; regulars via their LOM id.
    assert reg.resolve_track(MASTER_TRACK_ID) is song.master_track
    assert reg.resolve_track(100) is t1
    assert reg.resolve_track(101) is t2
    # Devices are addressable globally via ``(track, device, chain_idx)``.
    assert reg.resolve_device(200) == (t1, t1.devices[0], 0)
    assert reg.resolve_device(201) == (t2, t2.devices[0], 0)


def test_initial_build_diagnostics_counts():
    t1 = make_track(100, [(200, [301, 302])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert reg.track_count == 2   # master + t1
    assert reg.device_count == 1
    assert reg.param_count == 2


def test_stale_handles_resolve_to_none():
    song = StubSong(tracks=[make_track(100, [(200, [301])])])
    reg = LOMListeners(song=song)
    assert reg.resolve_track(999) is None
    assert reg.resolve_device(999) is None


def test_master_track_walk_includes_its_devices():
    master_dev = make_device(500, [401])
    master = StubTrack(tid=9_999_999, devices=[master_dev], name="Master")
    song = StubSong(tracks=[], master=master)
    reg = LOMListeners(song=song)
    assert reg.resolve_device(500) == (master, master_dev, 0)


# --- listener lifecycle ----------------------------------------------------


def test_tracks_listener_attached_on_init():
    song = StubSong(tracks=[])
    reg = LOMListeners(song=song)
    assert song.has_tracks_listener()
    reg.disconnect()


def test_per_track_devices_listener_attached():
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert t1.has_devices_listener()
    reg.disconnect()


# --- devices mutations -----------------------------------------------------


def test_track_devices_change_exposes_new_device():
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)

    new_device = make_device(250, [350, 351])
    t1.set_devices([t1.devices[0], new_device])

    assert reg.resolve_device(200) is not None  # old device still there
    assert reg.resolve_device(250) == (t1, new_device, 1)


def test_track_devices_change_removes_departed_device():
    t1 = make_track(100, [(200, [301, 302]), (250, [350])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert reg.resolve_device(250) is not None

    # Remove the second device.
    t1.set_devices([t1.devices[0]])

    assert reg.resolve_device(250) is None
    # The surviving device is still reachable.
    assert reg.resolve_device(200) is not None


def test_track_devices_change_updates_chain_index():
    d200 = make_device(200, [301])
    d250 = make_device(250, [350])
    t1 = StubTrack(tid=100, devices=[d200, d250])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert reg.resolve_device(200)[2] == 0
    assert reg.resolve_device(250)[2] == 1

    # Swap order — walk should see the new chain_idx.
    t1.set_devices([d250, d200])
    assert reg.resolve_device(250)[2] == 0
    assert reg.resolve_device(200)[2] == 1


# --- tracks mutations ------------------------------------------------------


def test_tracks_changed_exposes_new_track():
    song = StubSong(tracks=[])
    reg = LOMListeners(song=song)
    assert reg.resolve_track(100) is None

    t1 = make_track(100, [(200, [301])])
    song.set_tracks([t1])

    assert reg.resolve_track(100) is t1
    assert reg.resolve_device(200) is not None


def test_tracks_changed_removes_deleted_track():
    t1 = make_track(100, [(200, [301])])
    t2 = make_track(101, [(201, [302])])
    song = StubSong(tracks=[t1, t2])
    reg = LOMListeners(song=song)

    song.set_tracks([t2])  # delete t1

    assert reg.resolve_track(100) is None
    assert reg.resolve_device(200) is None
    # t2 survives
    assert reg.resolve_track(101) is t2
    assert reg.resolve_device(201) is not None


def test_tracks_changed_preserves_master():
    song = StubSong(tracks=[make_track(100, [])])
    reg = LOMListeners(song=song)
    master_before = reg.resolve_track(MASTER_TRACK_ID)
    song.set_tracks([])
    assert reg.resolve_track(MASTER_TRACK_ID) is master_before


def test_tracks_changed_attaches_devices_listener_on_new_track():
    """After a tracks rebuild, the new track's devices listener is live."""
    song = StubSong(tracks=[])
    reg = LOMListeners(song=song)
    t1 = make_track(100, [(200, [301])])
    song.set_tracks([t1])
    # Mutate t1's devices; the new per-track devices listener must fire.
    new_device = make_device(250, [350])
    t1.set_devices([t1.devices[0], new_device])
    assert reg.resolve_device(250) is not None


# --- track_id_for ----------------------------------------------------------


def test_track_id_for_master_is_sentinel():
    song = StubSong(tracks=[])
    reg = LOMListeners(song=song)
    assert reg.track_id_for(song.master_track) == MASTER_TRACK_ID


def test_track_id_for_regular_is_live_ptr_masked():
    t1 = make_track(100, [])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert reg.track_id_for(t1) == _safe_int_id(t1)


def test_track_id_for_unknown_track_returns_none():
    song = StubSong(tracks=[])
    reg = LOMListeners(song=song)
    stray = make_track(999, [])
    assert reg.track_id_for(stray) is None


def test_track_id_for_after_disconnect_returns_none():
    t1 = make_track(100, [])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    reg.disconnect()
    assert reg.track_id_for(t1) is None
    assert reg.track_id_for(song.master_track) is None


# --- disconnect ------------------------------------------------------------


def test_disconnect_detaches_all_listeners():
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert song.has_tracks_listener()
    assert t1.has_devices_listener()

    reg.disconnect()

    assert not song.has_tracks_listener()
    assert not t1.has_devices_listener()


def test_disconnect_silences_resolves():
    song = StubSong(tracks=[make_track(100, [(200, [301])])])
    reg = LOMListeners(song=song)
    reg.disconnect()
    assert reg.resolve_track(100) is None
    assert reg.resolve_device(200) is None


def test_disconnect_is_idempotent():
    song = StubSong(tracks=[make_track(100, [(200, [301])])])
    reg = LOMListeners(song=song)
    reg.disconnect()
    # Must not raise on second call.
    reg.disconnect()


def test_listener_fire_after_disconnect_is_ignored():
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    reg.disconnect()
    # Even if a stale fire sneaks through before Live tears down the
    # object graph, the listener bookkeeper must stay quiet.
    reg._on_tracks_changed()   # direct, shouldn't do anything
    assert reg.resolve_track(100) is None


# --- int32 masking ---------------------------------------------------------


def test_safe_int_id_masks_to_31_bits():
    class Obj:
        _live_ptr = None
        id = 0xFFFFFFFFFFFF
    assert _safe_int_id(Obj()) == 0xFFFFFFFFFFFF & 0x7FFFFFFF


def test_safe_int_id_prefers_live_ptr():
    class Obj:
        _live_ptr = 42
        id = 99
    assert _safe_int_id(Obj()) == 42


def test_safe_int_id_handles_missing():
    assert _safe_int_id(object()) is None


def test_safe_int_id_handles_none_id():
    class Obj:
        _live_ptr = None
        id = None
    assert _safe_int_id(Obj()) is None


# --- robustness: broken LOM -------------------------------------------------


def test_tracks_read_failure_is_tolerated():
    class ExplodingSong(StubSong):
        @property
        def tracks(self):
            raise RuntimeError("gone")

    song = ExplodingSong(tracks=[])
    # Construction must not blow up; master still registered + listener attached.
    reg = LOMListeners(song=song)
    assert reg.track_count == 1  # master only
    reg.disconnect()


def test_master_track_read_failure_is_tolerated():
    class NoMasterSong(StubSong):
        @property
        def master_track(self):
            raise RuntimeError("gone")
        @master_track.setter
        def master_track(self, value):
            pass  # swallow the StubSong.__init__ assignment

    song = NoMasterSong(tracks=[make_track(100, [])])
    reg = LOMListeners(song=song)
    assert reg.resolve_track(MASTER_TRACK_ID) is None
    assert reg.resolve_track(100) is not None


# --- walk-mode self-heal (PR-4g behaviour, preserved in Commit A) ----------


def test_walk_mode_self_heals_when_song_populates_silently():
    """A silent song mutation (no listener fire) is picked up by the next
    resolve because the resolver walks the live LOM.
    """
    song = StubSong(tracks=[])
    reg = LOMListeners(song=song)
    assert reg.resolve_device(200) is None  # baseline: nothing to find

    # Populate the song directly, bypassing ``set_tracks`` (no listener
    # fires). Every subsequent resolve walks the new tree.
    new_track = make_track(100, [(200, [301, 302])])
    song._tracks = [new_track]

    assert reg.resolve_device(200) == (new_track, new_track.devices[0], 0)
    assert reg.resolve_track(100) is new_track


def test_walk_mode_unknown_id_returns_none_silently():
    """A miss is a silent ``None`` — no rebuild, no callback, no churn."""
    song = StubSong(tracks=[make_track(100, [(200, [301])])])
    reg = LOMListeners(song=song)

    structural_changes = [0]
    reg.set_on_structural_change(
        lambda: structural_changes.__setitem__(0, structural_changes[0] + 1),
    )

    # Fire a slew of stale-id queries — the shape a set-reload produces
    # when the UI holds stale paramIds. None trigger the
    # structural-change callback.
    for stale_id in range(9000, 9100):
        assert reg.resolve_device(stale_id) is None
        assert reg.resolve_track(stale_id) is None
    assert structural_changes[0] == 0


# --- structural-change callback --------------------------------------------


def test_structural_change_fires_on_tracks_mutation():
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)

    count = [0]
    reg.set_on_structural_change(lambda: count.__setitem__(0, count[0] + 1))

    song.set_tracks([t1, make_track(400, [(500, [601])])])
    assert count[0] == 1


def test_structural_change_fires_on_device_mutation():
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)

    count = [0]
    reg.set_on_structural_change(lambda: count.__setitem__(0, count[0] + 1))

    new_dev = make_device(250, [350])
    t1.set_devices([t1.devices[0], new_dev])
    assert count[0] >= 1


class _NamedDevice(StubDevice):
    """StubDevice with Live's ``name`` observation. ``rename`` is a
    preset loaded onto a device of its own class: the name changes and
    the track's device list does not."""

    def __init__(self, did, params=None, name=""):
        super().__init__(did=did, params=params, name=name,
                         class_name="DrumGroupDevice")
        self.name_listeners: list = []

    def add_name_listener(self, cb):
        self.name_listeners.append(cb)

    def remove_name_listener(self, cb):
        self.name_listeners.remove(cb)

    def rename(self, name):
        self.name = name
        for cb in list(self.name_listeners):
            cb()


def test_structural_change_fires_on_device_rename():
    """A kit loaded into the Drum Rack already on the track keeps the
    device and changes only its name — the republish has to come from
    the name, or the D record keeps the old kit's name."""
    rack = _NamedDevice(200, [make_param(301)], name="808 Core Kit")
    t1 = StubTrack(tid=100, devices=[rack])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    count = [0]
    reg.set_on_structural_change(lambda: count.__setitem__(0, count[0] + 1))

    rack.rename("Hybrid - Beyond the Outer Rim + BigRoom")

    assert count[0] == 1
    assert len(rack.name_listeners) == 1
    reg.disconnect()


def test_device_name_listener_keyed_by_lom_id_not_wrapper():
    """Live hands out a fresh wrapper per read: a second wrapper of the
    same device must not attach a second listener, or one rename would
    fire the republish once per walk that had seen the device."""
    rack = _NamedDevice(200, [make_param(301)], name="Kit")
    t1 = StubTrack(tid=100, devices=[rack])
    reg = LOMListeners(song=StubSong(tracks=[t1]))

    rewrapped = _NamedDevice(999, name="Kit")
    rewrapped._live_ptr = rack._live_ptr
    rewrapped.name_listeners = rack.name_listeners
    reg._bind_device_name_listener(rewrapped)

    assert len(rack.name_listeners) == 1
    reg.disconnect()


def test_device_name_listener_detached_on_remove_and_disconnect():
    gone = _NamedDevice(200, [make_param(301)], name="Old Kit")
    kept = _NamedDevice(210, [make_param(302)], name="Reverb")
    t1 = StubTrack(tid=100, devices=[gone, kept])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    count = [0]
    reg.set_on_structural_change(lambda: count.__setitem__(0, count[0] + 1))

    t1.set_devices([kept])
    count[0] = 0
    assert gone.name_listeners == []
    assert len(kept.name_listeners) == 1

    kept.rename("Big Reverb")
    assert count[0] == 1

    reg.disconnect()
    assert kept.name_listeners == []


# --- mutation callback wiring ----------------------------------------------


def _build_with_mutation_callbacks():
    """Helper: LOMListeners with three mutation callbacks pre-wired.

    Returns ``(listeners, song, t1, calls)`` where ``calls`` is a dict of
    lists keyed by ``"added"``, ``"removed"``, ``"value"`` — each entry
    is the callback's args for inspection.

    Commit A signature: ``on_param_value_changed`` receives
    ``(parameter, canonical_path)``; we log the pair directly.
    """
    t1 = make_track(100, [(200, [301, 302])])
    song = StubSong(tracks=[t1])
    calls = {"added": [], "removed": [], "value": []}
    reg = LOMListeners(
        song=song,
        on_device_added=lambda track, device, idx: calls["added"].append(
            (track, device, idx),
        ),
        on_device_removed=lambda track, did: calls["removed"].append(
            (track, did),
        ),
        on_param_value_changed=lambda parameter, canonical_path: (
            calls["value"].append((parameter, canonical_path, parameter.value))
        ),
    )
    return reg, song, t1, calls


def test_set_mutation_callbacks_replaces_callbacks():
    """The param value-listener closures read callbacks at fire time, so
    ``set_mutation_callbacks`` takes effect without re-attaching any
    listener."""
    reg, _song, t1, calls = _build_with_mutation_callbacks()
    new_calls = {"added": [], "removed": [], "value": []}
    reg.set_mutation_callbacks(
        on_device_added=lambda t, d, i: new_calls["added"].append((t, d, i)),
        on_device_removed=lambda t, d: new_calls["removed"].append((t, d)),
        on_param_value_changed=lambda parameter, path: (
            new_calls["value"].append((parameter, path, parameter.value))
        ),
    )
    p = t1.devices[0].parameters[0]
    p.set_value(0.42)
    assert calls["value"] == []  # original callback unhooked
    assert len(new_calls["value"]) == 1
    param, path, value = new_calls["value"][0]
    assert param is p
    # Regular track index 0, device chain 0, param index 0.
    assert path == "tracks/0/devices/0/params/0"
    assert value == pytest.approx(0.42)


def test_param_listeners_attached_on_init():
    """Param value-listeners are always attached at ``__init__``; the
    callback dispatch is read at fire time."""
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    assert t1.devices[0].parameters[0].has_value_listener() is True
    reg.disconnect()


def test_param_listener_attached_on_init_when_callback_present():
    _reg, _song, t1, _calls = _build_with_mutation_callbacks()
    assert t1.devices[0].parameters[0].has_value_listener() is True
    assert t1.devices[0].parameters[1].has_value_listener() is True


def test_evict_device_detaches_param_listeners():
    """Removing a device must detach its params' value-listeners."""
    _reg, _song, t1, _calls = _build_with_mutation_callbacks()
    p = t1.devices[0].parameters[0]
    assert p.has_value_listener() is True
    t1.set_devices([])  # diff → evict → detach
    assert p.has_value_listener() is False


def test_disconnect_detaches_all_param_listeners():
    _reg, _song, t1, _calls = _build_with_mutation_callbacks()
    params = list(t1.devices[0].parameters)
    _reg.disconnect()
    for p in params:
        assert p.has_value_listener() is False


def test_device_added_callback_fires_on_insert():
    """Inserting a new device fires exactly one add for the new device.

    When callbacks are installed via ``__init__`` (the helper here), the
    initial walk does NOT fire ``on_device_added`` for pre-existing
    devices (``fire_added_for_existing=False``) — that initial
    population is the caller's job (state publish). We clear ``calls``
    defensively and isolate the post-init delta from the mutation.
    """
    _reg, _song, t1, calls = _build_with_mutation_callbacks()
    calls["added"].clear()
    new_dev = StubDevice(did=210, params=[make_param(401)], name="C",
                         class_name="Compressor2")
    t1.set_devices([t1.devices[0], new_dev])
    assert len(calls["added"]) == 1
    track, device, idx = calls["added"][0]
    assert track is t1
    assert device is new_dev
    assert idx == 1


def test_device_removed_callback_fires_on_evict():
    _reg, _song, t1, calls = _build_with_mutation_callbacks()
    t1.set_devices([])
    assert calls["removed"] == [(t1, 200)]


def test_device_swap_fires_remove_then_add():
    _reg, _song, t1, calls = _build_with_mutation_callbacks()
    new_dev = StubDevice(did=220, params=[make_param(402)], name="EQ",
                         class_name="Eq8")
    t1.set_devices([new_dev])
    assert (t1, 200) in calls["removed"]
    assert any(d is new_dev for _t, d, _i in calls["added"])


# --- device name listeners (ADR-439 addendum) --------------------------------
#
# A preset loaded onto a device of its own class keeps the device and renames
# it, and Live's undo and redo only rename it back: no ``devices`` fire
# (measured on the rig, 2026-09-15). The rename is the structural change.


class NamedStubDevice(StubDevice):
    """StubDevice with Live's ``name`` listener pair; one listener at most."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._name_listener = None

    def add_name_listener(self, cb):
        assert self._name_listener is None, "one name listener per device"
        self._name_listener = cb

    def remove_name_listener(self, cb):
        assert self._name_listener == cb
        self._name_listener = None

    def has_name_listener(self) -> bool:
        return self._name_listener is not None

    def rename(self, name: str) -> None:
        self.name = name
        if self._name_listener is not None:
            self._name_listener()


def _named_track(tid, did, name, pid):
    return StubTrack(tid=tid, devices=[
        NamedStubDevice(did=did, params=[make_param(pid)], name=name, class_name="MultiSampler"),
    ])


def _count_structural(reg):
    count = [0]
    reg.set_on_structural_change(lambda: count.__setitem__(0, count[0] + 1))
    return count


def test_a_device_renamed_in_place_is_a_structural_change():
    t1 = _named_track(100, 200, "Evo 01 - Subtle Sul Tasto", 301)
    reg = LOMListeners(song=StubSong(tracks=[t1]))
    count = _count_structural(reg)
    assert t1.devices[0].has_name_listener()

    t1.devices[0].rename("Evo 02 - Subtle Long Wave")  # the device list never changes
    assert count[0] == 1
    reg.disconnect()


def test_a_device_inserted_later_is_watched_and_one_that_leaves_is_not():
    t1 = _named_track(100, 200, "Operator", 301)
    reg = LOMListeners(song=StubSong(tracks=[t1]))
    count = _count_structural(reg)
    old = t1.devices[0]
    new = NamedStubDevice(did=210, params=[make_param(401)], name="Omnisphere", class_name="AuPluginDevice")

    t1.set_devices([new])
    assert new.has_name_listener()
    assert not old.has_name_listener()
    fired = count[0]
    new.rename("Omnisphere (renamed)")
    assert count[0] == fired + 1


def test_a_device_moved_to_another_track_stays_watched():
    """A move fires both tracks' ``devices`` listeners; the source's must not
    strip the listener from a device that is still in the song."""
    t1 = _named_track(100, 200, "Reverb", 301)
    t2 = StubTrack(tid=101, devices=[])
    reg = LOMListeners(song=StubSong(tracks=[t1, t2]))
    device = t1.devices[0]

    t2.set_devices([device])  # the destination reports first ...
    t1.set_devices([])        # ... then the source
    assert device.has_name_listener()
    reg.disconnect()
    assert not device.has_name_listener()


def test_a_deleted_track_releases_its_devices_name_listeners():
    t1 = _named_track(100, 200, "Operator", 301)
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    device = t1.devices[0]
    song.set_tracks([])
    assert not device.has_name_listener()
    reg.disconnect()


def test_disconnect_releases_name_listeners_and_a_late_rename_is_ignored():
    t1 = _named_track(100, 200, "Operator", 301)
    reg = LOMListeners(song=StubSong(tracks=[t1]))
    count = _count_structural(reg)
    device = t1.devices[0]
    queued = device._name_listener
    reg.disconnect()
    assert not device.has_name_listener()
    queued()  # a fire already on its way when the surface went away
    assert count[0] == 0


def test_walking_a_device_again_does_not_listen_to_its_name_twice():
    """The parameters-listener rebind walks a device a second time;
    ``NamedStubDevice`` refuses a second name listener."""
    t1 = _named_track(100, 200, "Operator", 301)
    reg = LOMListeners(song=StubSong(tracks=[t1]))
    count = _count_structural(reg)
    reg._attach_value_listeners_for_device(track=t1, device=t1.devices[0], chain_idx=0)
    t1.devices[0].rename("Operator (renamed)")
    assert count[0] == 1
    reg.disconnect()


def test_post_construction_callbacks_skip_init_fires():
    """Mirror the LoopingSurface flow: callbacks installed after init.

    The ``__init__`` build runs against ``None`` callbacks → no device-
    add replay for pre-existing devices. A subsequent
    ``set_mutation_callbacks`` simply changes the target the already-
    attached value-listener closures dispatch to.
    """
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])
    reg = LOMListeners(song=song)
    calls = {"added": [], "removed": [], "value": []}
    reg.set_mutation_callbacks(
        on_device_added=lambda t, d, i: calls["added"].append(i),
        on_device_removed=lambda t, d: calls["removed"].append(d),
        on_param_value_changed=lambda parameter, path: (
            calls["value"].append((path, parameter.value))
        ),
    )
    # No add fires from init — silent.
    assert calls["added"] == []
    # The value-listener attached at __init__ now dispatches through
    # the freshly-installed callback.
    t1.devices[0].parameters[0].set_value(0.42)
    assert len(calls["value"]) == 1
    path, value = calls["value"][0]
    assert path == "tracks/0/devices/0/params/0"
    assert value == pytest.approx(0.42)


def test_canonical_path_for_master_track_param():
    """Master track params use the ``master/...`` segment, not ``tracks/-1``."""
    master_dev = make_device(500, [401])
    master = StubTrack(tid=9_999_999, devices=[master_dev], name="Master")
    song = StubSong(tracks=[], master=master)
    calls = {"value": []}
    reg = LOMListeners(
        song=song,
        on_param_value_changed=lambda parameter, path: (
            calls["value"].append((path, parameter.value))
        ),
    )
    master_dev.parameters[0].set_value(0.9)
    assert len(calls["value"]) == 1
    path, value = calls["value"][0]
    assert path == "master/devices/0/params/0"
    assert value == pytest.approx(0.9)
    reg.disconnect()


def test_callback_exception_does_not_break_rebuild():
    """A raising callback must be logged-and-swallowed, not propagated."""
    t1 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t1])

    def boom(*_a, **_k):
        raise RuntimeError("listener exploded")

    reg = LOMListeners(
        song=song,
        on_device_added=boom,
        on_device_removed=boom,
        on_param_value_changed=boom,
    )
    # Adding a device — must not raise even though the callback throws.
    new_dev = StubDevice(did=210, params=[make_param(401)], name="X",
                         class_name="X")
    t1.set_devices([t1.devices[0], new_dev])
    # Param value change — same posture.
    t1.devices[0].parameters[0].set_value(0.8)


# --- regression: Live returns fresh wrappers from song.tracks --------------
#
# In real Live, ``list(song.tracks)`` can return a fresh Python wrapper
# around the same LOM track on each read — ``a is b`` is False even when
# both objects refer to the same underlying track (the ``_live_ptr`` is
# identical, because that's the stable LOM identity). Identity-by-``is``
# breaks whenever the caller passes a track object from one read and
# the matcher iterates a fresh read to find it.
#
# The 2026-04-14 v3 round-trip harness surfaced this: at surface init,
# ``_attach_value_listeners_for_device`` calls ``_track_segment_for`` to
# compute a canonical path; ``_iter_all_tracks`` yields wrapper A,
# ``_safe_tracks_list`` inside ``_track_segment_for`` returns wrapper B
# with the same ``_live_ptr``. ``a is b`` → False → "unreachable track"
# warning → zero value-listeners attached. Fix: compare by
# ``_safe_int_id`` (which reads ``_live_ptr``), not ``is``.


class _FreshWrapperTrack:
    """Track that exposes a stable ``_live_ptr`` but re-wraps each call.

    Models Live's behaviour: the underlying LOM track is one object, but
    ``list(song.tracks)`` may hand back a newly-allocated Python wrapper
    each time. We simulate this by keeping one "canonical" StubTrack for
    listener machinery and returning ``_FreshWrapperTrack`` proxies from
    ``song.tracks`` that share the canonical's ``_live_ptr``.
    """

    def __init__(self, canonical: "StubTrack"):
        self._canonical = canonical
        self._live_ptr = _safe_int_id(canonical)
        # Mirror every attribute the walker reads. ``devices`` and the
        # listener ops delegate to the canonical so the rest of the
        # walker sees one consistent state.
        self.name = canonical.name
        self.id = canonical.id

    @property
    def devices(self):
        return self._canonical.devices

    def add_devices_listener(self, cb):
        return self._canonical.add_devices_listener(cb)

    def remove_devices_listener(self, cb):
        return self._canonical.remove_devices_listener(cb)


class _FreshWrapperSong:
    """Song whose ``tracks`` read returns fresh wrappers each call."""

    def __init__(self, canonical_tracks: List[StubTrack],
                 master: StubTrack | None = None):
        self._canonical = list(canonical_tracks)
        self.master_track = master if master is not None else StubTrack(
            tid=9_999_999, name="Master",
        )
        self._tracks_listener = None

    @property
    def tracks(self):
        # Each read allocates new wrapper objects — ``is`` comparisons
        # against a prior read will fail, but ``_live_ptr`` will match.
        return [_FreshWrapperTrack(t) for t in self._canonical]

    def add_tracks_listener(self, cb):
        self._tracks_listener = cb

    def remove_tracks_listener(self, cb):
        self._tracks_listener = None


def test_listener_attaches_when_song_tracks_rewraps_each_read():
    """Regression: param-value listeners must attach even when
    ``song.tracks`` re-wraps between the walker's two reads.

    Before the fix this test saw zero value-listeners attached; the
    walker fell through ``_track_segment_for``'s ``is`` comparisons and
    hit the "unreachable track" early-return on every track.
    """
    canon = make_track(100, [(200, [301, 302])])
    song = _FreshWrapperSong(canonical_tracks=[canon])

    calls: list[tuple[object, str]] = []
    LOMListeners(
        song=song,
        on_param_value_changed=lambda parameter, canonical_path: (
            calls.append((parameter, canonical_path))
        ),
    )

    # Post-init both params should have a value-listener attached via
    # the canonical track's devices.
    p1, p2 = canon.devices[0].parameters
    assert p1.has_value_listener()
    assert p2.has_value_listener()

    # And firing one must deliver a canonical path, not None.
    p1.set_value(0.42)
    assert len(calls) == 1
    _, path = calls[0]
    assert path == "tracks/0/devices/0/params/0"


def test_track_id_for_returns_id_across_wrapper_rewrap():
    """``track_id_for`` compares by LOM identity, not Python ``is``."""
    canon = make_track(100, [])
    song = _FreshWrapperSong(canonical_tracks=[canon])
    reg = LOMListeners(song=song)

    # Ask about a fresh wrapper, not the canonical object.
    fresh_wrapper = song.tracks[0]
    assert fresh_wrapper is not canon  # sanity: really a different object

    assert reg.track_id_for(fresh_wrapper) == _safe_int_id(canon)


def test_same_lom_track_helper_behaviour():
    """``_same_lom_track`` helper: None-safe, identity fast path, id fallback."""
    from components.LOMListeners import _same_lom_track

    canon = make_track(100, [])
    other = make_track(101, [])

    # None-safety
    assert _same_lom_track(None, canon) is False
    assert _same_lom_track(canon, None) is False
    assert _same_lom_track(None, None) is False

    # Identity fast path
    assert _same_lom_track(canon, canon) is True

    # Id fallback: two wrappers with the same _live_ptr
    a = _FreshWrapperTrack(canon)
    b = _FreshWrapperTrack(canon)
    assert a is not b
    assert _same_lom_track(a, b) is True

    # Different LOM tracks
    assert _same_lom_track(canon, other) is False


# --- stale-handle error classifier ----------------------------------------
#
# ADR-004 §4: Live 12.3.x raises ``Boost.Python.ArgumentError`` (a
# ``TypeError`` subclass) with "did not match C++ signature" in the
# message when a LOM wrapper's underlying C++ object has gone away.
# The ``_is_stale_handle_error`` helper lets the detach paths
# distinguish "listener already torn down on the LOM side" (debug
# noise only) from genuine remove-listener bugs (real warnings).


def test_is_stale_handle_error_boost_python_shape():
    from components.LOMListeners import _is_stale_handle_error

    # The exact TypeError boost::python raises on stale handles.
    exc = TypeError(
        "Python argument types in\n"
        "    DeviceParameter.remove_value_listener(DeviceParameter, "
        "function)\n"
        "did not match C++ signature:\n"
        "    remove_value_listener(TPyHandle<ATimeableValue>, "
        "boost::python::api::object)"
    )
    assert _is_stale_handle_error(exc) is True


def test_is_stale_handle_error_only_tpyhandle_substring():
    """Either marker is enough — message shape changes between Live versions."""
    from components.LOMListeners import _is_stale_handle_error

    # Only the signature marker.
    assert _is_stale_handle_error(RuntimeError(
        "listener call did not match C++ signature foo",
    )) is True

    # Only the handle type marker.
    assert _is_stale_handle_error(TypeError(
        "bad TPyHandle conversion",
    )) is True


def test_is_stale_handle_error_rejects_ordinary_errors():
    """Regular listener-bug TypeErrors / RuntimeErrors don't match."""
    from components.LOMListeners import _is_stale_handle_error

    assert _is_stale_handle_error(
        TypeError("remove_value_listener() takes 1 positional argument"),
    ) is False
    assert _is_stale_handle_error(
        RuntimeError("listener not found"),
    ) is False
    assert _is_stale_handle_error(ValueError("oops")) is False


def test_is_stale_handle_error_none_safe():
    """Pathological ``exc`` whose ``__str__`` raises must not propagate."""
    from components.LOMListeners import _is_stale_handle_error

    class _Bad(Exception):
        def __str__(self):
            raise RuntimeError("str explodes")

    assert _is_stale_handle_error(_Bad()) is False


class _StaleHandleParam(StubParam):
    """StubParam whose ``remove_value_listener`` raises the Live stale-handle error."""

    def remove_value_listener(self, cb):
        raise TypeError(
            "Python argument types in\n"
            "    DeviceParameter.remove_value_listener(DeviceParameter, "
            "function)\n"
            "did not match C++ signature:\n"
            "    remove_value_listener(TPyHandle<ATimeableValue>, "
            "boost::python::api::object)"
        )


def test_detach_param_value_listener_suppresses_stale_handle(caplog):
    """Stale-handle exception is classified and dropped to DEBUG."""
    import logging

    # A device whose param's underlying C++ object has "gone away".
    stale_param = _StaleHandleParam(pid=9991)
    stale_device = StubDevice(did=777, params=[stale_param])
    track = StubTrack(tid=100, devices=[stale_device])
    song = StubSong(tracks=[track])

    with caplog.at_level(logging.WARNING, logger="looping"):
        reg = LOMListeners(song=song)
        # Trigger detach by removing the device from its chain.
        track.set_devices([])

        warning_messages = [
            r.getMessage() for r in caplog.records
            if r.levelno >= logging.WARNING
        ]
        # No WARNING-level noise for the stale handle.
        assert not any(
            "remove_value_listener failed" in m for m in warning_messages
        ), f"unexpected warning logs: {warning_messages}"
    reg.disconnect()


class _NormalRemoveFailsParam(StubParam):
    """StubParam whose remove_value_listener raises a non-stale error."""

    def remove_value_listener(self, cb):
        raise RuntimeError("listener not registered")


def test_detach_param_value_listener_preserves_real_warning(caplog):
    """Non-stale errors still log at WARNING — real bugs must stay visible."""
    import logging

    param = _NormalRemoveFailsParam(pid=9992)
    device = StubDevice(did=778, params=[param])
    track = StubTrack(tid=100, devices=[device])
    song = StubSong(tracks=[track])

    with caplog.at_level(logging.WARNING, logger="looping"):
        reg = LOMListeners(song=song)
        track.set_devices([])

        warning_messages = [
            r.getMessage() for r in caplog.records
            if r.levelno >= logging.WARNING
        ]
        assert any(
            "remove_value_listener failed" in m and "9992" in m
            for m in warning_messages
        ), f"expected real warning, got: {warning_messages}"
    reg.disconnect()


# --- delayed post-device-add reconciler -----------------------------------
#
# ADR-004: Live 12.3.x does not reliably fire
# ``device.add_parameters_listener`` when an AU plugin (Omnisphere,
# Kontakt, etc.) finishes hydrating its parameter list after
# insertion. The post-add reconciler compensates: at +750ms after
# every device add, compare the current param count against the
# at-add-time snapshot and, if it grew, re-bind value-listeners and
# fire structural-change so state/full re-emits with the full list.


class _ManualScheduler:
    """Records (delay_ms, callback) tuples; fires them on demand.

    Mirrors the shape of ``LoopingSurface._schedule_delayed`` but
    holds callbacks in a list so tests can assert on scheduling and
    control the firing order deterministically.
    """

    def __init__(self):
        self.pending: list[tuple[int, callable]] = []

    def __call__(self, delay_ms: int, fn) -> None:
        self.pending.append((int(delay_ms), fn))

    def fire_all(self) -> None:
        """Fire every pending callback in scheduling order, then clear."""
        pending = self.pending
        self.pending = []
        for _delay_ms, fn in pending:
            fn()


class _HydratingDevice(StubDevice):
    """StubDevice whose parameter list grows after a call to ``hydrate()``.

    Simulates an AU plugin (Omnisphere) whose parameter list exposes
    just ``[Device On]`` at insertion and grows to the full mapped
    set once the plugin finishes booting.
    """

    def __init__(self, did, initial_params, post_hydrate_params):
        super().__init__(
            did=did,
            params=list(initial_params),
            class_name="AuPluginDevice",
        )
        self._post_hydrate_params = list(post_hydrate_params)

    def hydrate(self):
        self.parameters = list(self._post_hydrate_params)


def test_post_add_reconciler_fires_structural_on_param_growth():
    """Newly-added plugin hydrates mid-flight; reconciler re-emits state/full."""
    # Start with one [Device On]-like param, will grow to 5 params.
    initial = [StubParam(pid=9001)]
    post = initial + [StubParam(pid=p) for p in (9002, 9003, 9004, 9005)]
    plugin = _HydratingDevice(
        did=500, initial_params=initial, post_hydrate_params=post,
    )
    track = StubTrack(tid=100, devices=[])
    song = StubSong(tracks=[track])

    scheduler = _ManualScheduler()
    structural_fires: list[int] = []
    reg = LOMListeners(
        song=song,
        on_structural_change=lambda: structural_fires.append(1),
        schedule_delayed=scheduler,
    )

    # Insert the plugin — LOM fires the devices-listener, which
    # schedules the post-add reconciler at +750ms.
    track.set_devices([plugin])

    # Exactly one reconciler scheduled, at the +750ms horizon.
    assert len(scheduler.pending) == 1
    delay, _fn = scheduler.pending[0]
    assert delay == 750

    # Before the reconciler fires, simulate the plugin finishing boot:
    # the parameter list grows from 1 to 5.
    structural_fires.clear()
    plugin.hydrate()

    scheduler.fire_all()

    # Reconciler fired ``on_structural_change`` once, and the newly-
    # visible params now have value-listeners attached.
    assert structural_fires == [1]
    for pid in (9002, 9003, 9004, 9005):
        param = next(p for p in plugin.parameters if p.id == pid)
        assert param.has_value_listener(), (
            f"expected value-listener attached on hydrated param {pid}"
        )
    reg.disconnect()


def test_post_add_reconciler_no_op_when_count_unchanged():
    """Non-plugin devices (param count stable) don't trigger a re-emit."""
    stable = StubDevice(did=501, params=[StubParam(pid=p) for p in (9100, 9101)])
    track = StubTrack(tid=100, devices=[])
    song = StubSong(tracks=[track])

    scheduler = _ManualScheduler()
    structural_fires: list[int] = []
    reg = LOMListeners(
        song=song,
        on_structural_change=lambda: structural_fires.append(1),
        schedule_delayed=scheduler,
    )

    # Count the structural fire at device-add so we can isolate the
    # reconciler's contribution.
    track.set_devices([stable])
    pre_fire_count = len(structural_fires)
    assert len(scheduler.pending) == 1

    # No hydration happened — param list stayed at 2.
    scheduler.fire_all()

    # Reconciler detected no growth; no extra structural-change fire.
    assert len(structural_fires) == pre_fire_count
    reg.disconnect()


def test_post_add_reconciler_epoch_guard_swap_race():
    """Rapid preset-swap: only the most-recent reconciler runs."""
    initial = [StubParam(pid=9200)]
    post = initial + [StubParam(pid=9201), StubParam(pid=9202)]
    plugin = _HydratingDevice(
        did=502, initial_params=initial, post_hydrate_params=post,
    )
    track = StubTrack(tid=100, devices=[])
    song = StubSong(tracks=[track])

    scheduler = _ManualScheduler()
    structural_fires: list[int] = []
    reg = LOMListeners(
        song=song,
        on_structural_change=lambda: structural_fires.append(1),
        schedule_delayed=scheduler,
    )

    # First add — schedules one reconciler.
    track.set_devices([plugin])
    # Simulate the churn: remove then re-add the same Python object
    # before the first reconciler fires.
    track.set_devices([])
    track.set_devices([plugin])

    # Two reconcilers pending (the first one is now stale — its epoch
    # has been superseded by the third add).
    assert len(scheduler.pending) == 2

    structural_fires.clear()
    plugin.hydrate()
    scheduler.fire_all()

    # Only the most-recent reconciler's epoch matches; it fires once.
    # The earlier one no-ops.
    assert structural_fires == [1]
    reg.disconnect()


def test_post_add_reconciler_skipped_when_device_already_gone():
    """If the device was removed before the reconciler fires, no crash."""
    plugin = _HydratingDevice(
        did=503,
        initial_params=[StubParam(pid=9300)],
        post_hydrate_params=[
            StubParam(pid=9300), StubParam(pid=9301),
        ],
    )
    track = StubTrack(tid=100, devices=[])
    song = StubSong(tracks=[track])

    scheduler = _ManualScheduler()
    structural_fires: list[int] = []
    reg = LOMListeners(
        song=song,
        on_structural_change=lambda: structural_fires.append(1),
        schedule_delayed=scheduler,
    )

    track.set_devices([plugin])
    # Remove it before the reconciler fires.
    track.set_devices([])
    # Reset counter so we can see whether the reconciler fired
    # spuriously.
    structural_fires.clear()

    # Reconciler fires; should find its epoch stale (the remove
    # dropped the epoch entry) and no-op.
    scheduler.fire_all()

    assert structural_fires == []
    reg.disconnect()


def test_post_add_reconciler_no_op_when_schedule_delayed_not_wired():
    """Opt-out: surfaces/tests that don't pass schedule_delayed still work."""
    plugin = _HydratingDevice(
        did=504,
        initial_params=[StubParam(pid=9400)],
        post_hydrate_params=[
            StubParam(pid=9400), StubParam(pid=9401),
        ],
    )
    track = StubTrack(tid=100, devices=[])
    song = StubSong(tracks=[track])

    reg = LOMListeners(song=song)
    # Should not raise even though there's no scheduler.
    track.set_devices([plugin])
    reg.disconnect()


def test_post_add_reconciler_disconnect_cancels_pending():
    """Disconnect before the reconciler fires — pending callback no-ops."""
    plugin = _HydratingDevice(
        did=505,
        initial_params=[StubParam(pid=9500)],
        post_hydrate_params=[
            StubParam(pid=9500), StubParam(pid=9501),
        ],
    )
    track = StubTrack(tid=100, devices=[])
    song = StubSong(tracks=[track])

    scheduler = _ManualScheduler()
    structural_fires: list[int] = []
    reg = LOMListeners(
        song=song,
        on_structural_change=lambda: structural_fires.append(1),
        schedule_delayed=scheduler,
    )

    track.set_devices([plugin])
    assert len(scheduler.pending) == 1

    # The set_devices call above fires one structural-change at
    # device-add. Clear before testing the reconciler in isolation.
    structural_fires.clear()

    reg.disconnect()
    plugin.hydrate()
    # Firing after disconnect must be a no-op — ``_disconnected`` guard.
    scheduler.fire_all()
    assert structural_fires == []


# --- canonical paths survive structural change (audit item 22) --------------
#
# Canonical paths embed POSITIONAL indices. The listener closures used to
# capture the path at bind time, and nothing re-bound them, so after a track
# or chain reorder every parameter echoed under the index it had when it was
# first seen. The UI applies `param/value` by path, so the wrong track's
# parameter took the value — and only a full state/full republish repainted
# the tree, which does not undo the mis-applied leaf.
#
# Same bug class as Issue #399 in TrackMetadataComponent, fixed there by
# rebinding. Here the closure reads `_param_paths` at fire time instead.


def _reg_recording_paths(song):
    seen = []
    reg = LOMListeners(
        song=song,
        on_param_value_changed=lambda parameter, path: seen.append(path),
    )
    return reg, seen


def test_param_path_follows_a_track_reorder():
    t0 = make_track(100, [(200, [301])])
    t1 = make_track(101, [(201, [302])])
    song = StubSong(tracks=[t0, t1])
    reg, seen = _reg_recording_paths(song)

    t0.devices[0].parameters[0].set_value(0.1)
    assert seen == ["tracks/0/devices/0/params/0"]

    # Drag t0 below t1. Live fires `tracks_changed`; no parameter moved
    # device or chain, only the track index beneath it.
    song.set_tracks([t1, t0])
    seen.clear()

    t0.devices[0].parameters[0].set_value(0.2)
    assert seen == ["tracks/1/devices/0/params/0"], (
        "parameter echoed under its pre-reorder track index"
    )

    seen.clear()
    t1.devices[0].parameters[0].set_value(0.3)
    assert seen == ["tracks/0/devices/0/params/0"]


def test_param_path_follows_a_device_chain_reorder():
    t0 = make_track(100, [(200, [301]), (201, [302])])
    song = StubSong(tracks=[t0])
    reg, seen = _reg_recording_paths(song)

    first, second = t0.devices[0], t0.devices[1]
    second.parameters[0].set_value(0.1)
    assert seen == ["tracks/0/devices/1/params/0"]

    # Drag the second device to the head of the chain.
    t0.set_devices([second, first])
    seen.clear()

    second.parameters[0].set_value(0.2)
    assert seen == ["tracks/0/devices/0/params/0"], (
        "parameter echoed under its pre-reorder chain index"
    )

    seen.clear()
    first.parameters[0].set_value(0.3)
    assert seen == ["tracks/0/devices/1/params/0"]


def test_recompute_keeps_a_path_it_cannot_re_derive():
    """A device reading as paramless for a tick must not silence the echo.

    `recompute_param_paths` overwrites what it finds and leaves the rest
    alone. Dropping an entry instead would mean `_on_value_changed` reads
    None and returns without emitting — a silent parameter, which is worse
    than a briefly stale path that the next structural fire corrects.
    """
    t0 = make_track(100, [(200, [301])])
    song = StubSong(tracks=[t0])
    reg, seen = _reg_recording_paths(song)
    param = t0.devices[0].parameters[0]
    pid = _safe_int_id(param)
    assert reg._param_paths[pid] == "tracks/0/devices/0/params/0"

    t0.devices[0].parameters = []
    reg.recompute_param_paths()

    assert reg._param_paths[pid] == "tracks/0/devices/0/params/0"
    param.set_value(0.5)
    assert seen == ["tracks/0/devices/0/params/0"]
