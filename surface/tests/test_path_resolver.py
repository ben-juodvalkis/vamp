"""path_resolver unit tests — v3 path grammar + LOM lookup.

Covers parse rules (digit-only indices, no leading zeros except "0",
closed-enum segment names, empty-string / leading-slash / trailing-slash
rejection), lookup rules (O(1) list access, OK/NOT_FOUND/NOT_SUPPORTED/
MALFORMED status), and compose rules (inverse used by state/full
emission).

Reuses the ``StubSong`` / ``StubTrack`` / ``StubDevice`` / ``StubParam``
from ``test_lom_listeners.py`` to avoid duplicating the LOM shims.
"""

from __future__ import annotations

import pytest

from components.path_resolver import (
    ResolveStatus,
    clip_path_for,
    compose_clip_path,
    compose_device_path,
    compose_param_path,
    compose_scene_path,
    compose_slot_path,
    compose_track_path,
    resolve_clip,
    resolve_device,
    resolve_param,
    resolve_scene,
    resolve_slot,
    resolve_track,
)

from tests.test_lom_listeners import (
    StubDevice,
    StubParam,
    StubSong,
    StubTrack,
    make_device,
    make_param,
    make_track,
)


# --- stub slot for slotRef tests ------------------------------------------


class StubClip:
    """Minimal stand-in for ``Live.Clip``."""

    def __init__(self, cid=0, name=""):
        self.id = cid
        self.name = name


class StubClipSlot:
    """Minimal stand-in for ``Live.ClipSlot``.

    Pass a ``clip`` object to mark the slot occupied; leave it
    ``None`` to model an empty slot. ``has_clip`` derives from
    whether ``clip`` is not None so tests stay in sync with LOM
    behavior without a second flag to keep consistent.
    """

    def __init__(self, has_clip=False, clip=None):
        if has_clip and clip is None:
            # Back-compat with existing tests that only pass
            # ``has_clip=True`` — synthesize a placeholder clip so
            # ``slot.clip`` resolves too.
            clip = StubClip(cid=-1, name="auto")
        self._clip = clip
        self._has_clip_raises = False
        self._clip_raises = False

    @property
    def has_clip(self):
        if self._has_clip_raises:
            raise RuntimeError("has_clip is unavailable")
        return self._clip is not None

    @property
    def clip(self):
        if self._clip_raises:
            raise RuntimeError("clip read raised")
        return self._clip


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def song_basic():
    """A basic song: master + 2 regular tracks; each with one device +
    a few params. Enough to exercise every OK path."""
    master_dev = StubDevice(did=500, params=[
        StubParam(pid=401, name="m_a"),
        StubParam(pid=402, name="m_b"),
    ])
    master = StubTrack(tid=9_999_999, devices=[master_dev], name="Master")

    p_a0 = StubParam(pid=301, name="t0_d0_p0")
    p_a1 = StubParam(pid=302, name="t0_d0_p1")
    d_a0 = StubDevice(did=200, params=[p_a0, p_a1])
    t0 = StubTrack(tid=100, devices=[d_a0])

    p_b0 = StubParam(pid=310, name="t1_d0_p0")
    d_b0 = StubDevice(did=210, params=[p_b0])
    d_b1 = StubDevice(did=211, params=[StubParam(pid=311, name="t1_d1_p0")])
    t1 = StubTrack(tid=101, devices=[d_b0, d_b1])

    song = StubSong(tracks=[t0, t1], master=master)
    # Attach clip slots to t0 for slotRef tests.
    t0.clip_slots = [StubClipSlot(has_clip=True), StubClipSlot()]
    return song, master, t0, t1


# --- resolve_param: the hot path ------------------------------------------


def test_param_regular_track(song_basic):
    song, _m, t0, _t1 = song_basic
    r = resolve_param(song, "tracks/0/devices/0/params/1")
    assert r.ok
    assert r.obj is t0.devices[0].parameters[1]
    assert r.status is ResolveStatus.OK


def test_param_master_track(song_basic):
    song, master, _t0, _t1 = song_basic
    r = resolve_param(song, "master/devices/0/params/0")
    assert r.ok
    assert r.obj is master.devices[0].parameters[0]


def test_param_second_regular_track_second_device(song_basic):
    song, _m, _t0, t1 = song_basic
    r = resolve_param(song, "tracks/1/devices/1/params/0")
    assert r.ok
    assert r.obj is t1.devices[1].parameters[0]


def test_param_track_out_of_range(song_basic):
    song, *_ = song_basic
    r = resolve_param(song, "tracks/99/devices/0/params/0")
    assert r.status is ResolveStatus.NOT_FOUND


def test_param_device_out_of_range(song_basic):
    song, *_ = song_basic
    r = resolve_param(song, "tracks/0/devices/99/params/0")
    assert r.status is ResolveStatus.NOT_FOUND


def test_param_param_out_of_range(song_basic):
    song, *_ = song_basic
    r = resolve_param(song, "tracks/0/devices/0/params/99")
    assert r.status is ResolveStatus.NOT_FOUND


# --- parsing edge cases ---------------------------------------------------


def test_empty_path_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(song, "").status is ResolveStatus.MALFORMED


def test_leading_slash_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(
        song, "/tracks/0/devices/0/params/0",
    ).status is ResolveStatus.MALFORMED


def test_trailing_slash_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(
        song, "tracks/0/devices/0/params/0/",
    ).status is ResolveStatus.MALFORMED


def test_double_slash_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(
        song, "tracks//0/devices/0/params/0",
    ).status is ResolveStatus.MALFORMED


def test_non_digit_index_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(
        song, "tracks/abc/devices/0/params/0",
    ).status is ResolveStatus.MALFORMED


def test_leading_zero_index_malformed(song_basic):
    """Spec: no leading zero except "0" itself. "01" is malformed."""
    song, *_ = song_basic
    assert resolve_param(
        song, "tracks/01/devices/0/params/0",
    ).status is ResolveStatus.MALFORMED


def test_bare_zero_index_ok(song_basic):
    song, _m, t0, _t1 = song_basic
    r = resolve_param(song, "tracks/0/devices/0/params/0")
    assert r.ok


def test_unknown_segment_name_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(
        song, "xyzzy/0/devices/0/params/0",
    ).status is ResolveStatus.MALFORMED


def test_negative_index_malformed(song_basic):
    """No ``-1`` master sentinel in v3; ``master`` is its own segment."""
    song, *_ = song_basic
    assert resolve_param(
        song, "tracks/-1/devices/0/params/0",
    ).status is ResolveStatus.MALFORMED


def test_missing_params_suffix_malformed(song_basic):
    song, *_ = song_basic
    # Looks like a paramRef but stops at deviceRef.
    assert resolve_param(
        song, "tracks/0/devices/0",
    ).status is ResolveStatus.MALFORMED


def test_wrong_suffix_segment_malformed(song_basic):
    song, *_ = song_basic
    assert resolve_param(
        song, "tracks/0/devices/0/properties/0",
    ).status is ResolveStatus.MALFORMED


# --- NOT_SUPPORTED — grammar valid but Phase-1 defers ---------------------


def test_returns_not_supported(song_basic):
    """returns/<N>/... is grammar-reserved; Phase-1 rejects."""
    song, *_ = song_basic
    r = resolve_param(song, "returns/0/devices/0/params/0")
    assert r.status is ResolveStatus.NOT_SUPPORTED


def test_chains_not_supported(song_basic):
    """chains/<N>/devices/<M>/... is grammar-reserved; Phase-1 rejects."""
    song, *_ = song_basic
    r = resolve_param(song, "tracks/0/devices/0/chains/0/devices/0/params/0")
    assert r.status is ResolveStatus.NOT_SUPPORTED


def test_master_chains_not_supported(song_basic):
    song, *_ = song_basic
    r = resolve_param(song, "master/devices/0/chains/0/devices/0/params/0")
    assert r.status is ResolveStatus.NOT_SUPPORTED


# --- resolve_track ---------------------------------------------------------


def test_track_master(song_basic):
    song, master, *_ = song_basic
    r = resolve_track(song, "master")
    assert r.ok and r.obj is master


def test_track_regular(song_basic):
    song, _m, t0, _t1 = song_basic
    r = resolve_track(song, "tracks/0")
    assert r.ok and r.obj is t0


def test_track_out_of_range(song_basic):
    song, *_ = song_basic
    assert resolve_track(song, "tracks/42").status is ResolveStatus.NOT_FOUND


def test_track_trailing_segments_malformed(song_basic):
    """Calling resolve_track on a deviceRef is a mis-call; malformed."""
    song, *_ = song_basic
    r = resolve_track(song, "tracks/0/devices/0")
    assert r.status is ResolveStatus.MALFORMED


# --- resolve_device --------------------------------------------------------


def test_device_regular(song_basic):
    song, _m, t0, _t1 = song_basic
    r = resolve_device(song, "tracks/0/devices/0")
    assert r.ok and r.obj is t0.devices[0]


def test_device_master(song_basic):
    song, master, *_ = song_basic
    r = resolve_device(song, "master/devices/0")
    assert r.ok and r.obj is master.devices[0]


def test_device_missing_devices_keyword_malformed(song_basic):
    song, *_ = song_basic
    r = resolve_device(song, "tracks/0/items/0")
    assert r.status is ResolveStatus.MALFORMED


# --- resolve_slot ---------------------------------------------------------


def test_slot_regular(song_basic):
    song, _m, t0, _t1 = song_basic
    r = resolve_slot(song, "tracks/0/slots/0")
    assert r.ok and r.obj is t0.clip_slots[0]


def test_slot_out_of_range(song_basic):
    song, *_ = song_basic
    r = resolve_slot(song, "tracks/0/slots/99")
    assert r.status is ResolveStatus.NOT_FOUND


def test_slot_on_master_not_found(song_basic):
    """Master has no clip slots; passing master/slots/0 is NOT_FOUND."""
    song, master, *_ = song_basic
    master.clip_slots = []
    r = resolve_slot(song, "master/slots/0")
    assert r.status is ResolveStatus.NOT_FOUND


def test_slot_malformed_suffix(song_basic):
    song, *_ = song_basic
    r = resolve_slot(song, "tracks/0/clips/0")
    assert r.status is ResolveStatus.MALFORMED


# --- resolve_scene --------------------------------------------------------


class StubScene:
    """Minimal stand-in for ``Live.Scene``.

    Scene resolution is purely positional — nothing in the resolver
    touches scene attributes — so an ``id`` marker is enough for
    identity assertions in tests.
    """

    def __init__(self, sid=0, name=""):
        self.id = sid
        self.name = name


def test_resolve_scene_ok(song_basic):
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1), StubScene(sid=2), StubScene(sid=3)]
    r = resolve_scene(song, "scenes/1")
    assert r.ok and r.obj is song.scenes[1]


def test_resolve_scene_zero_index(song_basic):
    """scenes/0 is the first scene, not a sentinel."""
    song, *_ = song_basic
    song.scenes = [StubScene(sid=10)]
    r = resolve_scene(song, "scenes/0")
    assert r.ok and r.obj is song.scenes[0]


def test_resolve_scene_out_of_bounds(song_basic):
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1)]
    r = resolve_scene(song, "scenes/5")
    assert r.status is ResolveStatus.NOT_FOUND


def test_resolve_scene_negative_index_malformed(song_basic):
    """Negative indices are rejected at parse time as MALFORMED."""
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1)]
    r = resolve_scene(song, "scenes/-1")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_non_integer_malformed(song_basic):
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1)]
    r = resolve_scene(song, "scenes/abc")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_leading_zero_malformed(song_basic):
    """Consistent with the grammar: "01" is malformed, "0" is fine."""
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1), StubScene(sid=2)]
    r = resolve_scene(song, "scenes/01")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_wrong_segment_malformed(song_basic):
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1)]
    r = resolve_scene(song, "scene/0")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_track_prefixed_malformed(song_basic):
    """Scenes are song-scoped — a track prefix is not a sceneRef."""
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1)]
    r = resolve_scene(song, "tracks/0/scenes/0")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_trailing_segment_malformed(song_basic):
    song, *_ = song_basic
    song.scenes = [StubScene(sid=1)]
    r = resolve_scene(song, "scenes/0/clip")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_empty_path_malformed(song_basic):
    song, *_ = song_basic
    r = resolve_scene(song, "")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_missing_index_malformed(song_basic):
    song, *_ = song_basic
    r = resolve_scene(song, "scenes/")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_scene_empty_scene_list(song_basic):
    """Valid grammar, index 0, but song has zero scenes → NOT_FOUND."""
    song, *_ = song_basic
    song.scenes = []
    r = resolve_scene(song, "scenes/0")
    assert r.status is ResolveStatus.NOT_FOUND


def test_compose_scene_path():
    assert compose_scene_path(0) == "scenes/0"
    assert compose_scene_path(42) == "scenes/42"


def test_compose_scene_roundtrip(song_basic):
    """Compose + resolve is identity for every in-song scene."""
    song, *_ = song_basic
    song.scenes = [StubScene(sid=i) for i in range(4)]
    for idx in range(len(song.scenes)):
        path = compose_scene_path(idx)
        r = resolve_scene(song, path)
        assert r.ok and r.obj is song.scenes[idx]


# --- compose_* (inverse) --------------------------------------------------


def test_compose_track_master(song_basic):
    song, master, *_ = song_basic
    assert compose_track_path(song, master) == "master"


def test_compose_track_regular(song_basic):
    song, _m, t0, t1 = song_basic
    assert compose_track_path(song, t0) == "tracks/0"
    assert compose_track_path(song, t1) == "tracks/1"


def test_compose_track_unreachable(song_basic):
    """A track not in song.tracks / master returns None."""
    song, *_ = song_basic
    orphan = StubTrack(tid=777, name="Orphan")
    assert compose_track_path(song, orphan) is None


def test_compose_device(song_basic):
    song, master, t0, _t1 = song_basic
    assert compose_device_path(song, master, 0) == "master/devices/0"
    assert compose_device_path(song, t0, 0) == "tracks/0/devices/0"


def test_compose_param(song_basic):
    song, master, t0, _t1 = song_basic
    assert compose_param_path(song, master, 0, 1) == "master/devices/0/params/1"
    assert compose_param_path(song, t0, 0, 0) == "tracks/0/devices/0/params/0"


def test_compose_roundtrip_with_resolve(song_basic):
    """Compose + resolve is identity for every in-song param."""
    song, master, t0, t1 = song_basic
    for track in (master, t0, t1):
        for di, device in enumerate(track.devices):
            for pi, _param in enumerate(device.parameters):
                path = compose_param_path(song, track, di, pi)
                assert path is not None
                r = resolve_param(song, path)
                assert r.ok, f"compose/resolve mismatch for {path}"
                assert r.obj is track.devices[di].parameters[pi]


# --- resolve_clip ---------------------------------------------------------


@pytest.fixture
def song_with_clips():
    """Song + tracks where t0 slot 0 holds a clip, t0 slot 1 is empty,
    and t1 slot 0 holds a clip — enough to exercise OK / empty /
    reverse-lookup paths."""
    master = StubTrack(tid=9_999_999, name="Master")

    t0 = StubTrack(tid=100, name="t0")
    c0 = StubClip(cid=500, name="clip_t0_s0")
    t0.clip_slots = [
        StubClipSlot(clip=c0),
        StubClipSlot(),  # empty slot
    ]

    t1 = StubTrack(tid=101, name="t1")
    c1 = StubClip(cid=501, name="clip_t1_s0")
    t1.clip_slots = [StubClipSlot(clip=c1)]

    song = StubSong(tracks=[t0, t1], master=master)
    return song, master, t0, t1, c0, c1


def test_resolve_clip_ok(song_with_clips):
    song, _m, t0, _t1, c0, _c1 = song_with_clips
    r = resolve_clip(song, "tracks/0/slots/0/clip")
    assert r.status is ResolveStatus.OK
    assert r.obj is c0


def test_resolve_clip_ok_other_track(song_with_clips):
    song, _m, _t0, _t1, _c0, c1 = song_with_clips
    r = resolve_clip(song, "tracks/1/slots/0/clip")
    assert r.ok and r.obj is c1


def test_resolve_clip_empty_slot_is_not_present(song_with_clips):
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/0/slots/1/clip")
    assert r.status is ResolveStatus.CLIP_NOT_PRESENT


def test_resolve_clip_slot_out_of_range(song_with_clips):
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/0/slots/99/clip")
    assert r.status is ResolveStatus.NOT_FOUND


def test_resolve_clip_track_out_of_range(song_with_clips):
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/99/slots/0/clip")
    assert r.status is ResolveStatus.NOT_FOUND


def test_resolve_clip_missing_trailing_clip_malformed(song_with_clips):
    """Bare slotRef is not a clipRef — caller should use resolve_slot."""
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/0/slots/0")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_clip_wrong_trailing_segment_malformed(song_with_clips):
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/0/slots/0/clips")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_clip_wrong_slots_segment_malformed(song_with_clips):
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/0/scenes/0/clip")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_clip_malformed_index(song_with_clips):
    song, *_ = song_with_clips
    r = resolve_clip(song, "tracks/0/slots/abc/clip")
    assert r.status is ResolveStatus.MALFORMED


def test_resolve_clip_empty_path_malformed(song_with_clips):
    song, *_ = song_with_clips
    assert resolve_clip(song, "").status is ResolveStatus.MALFORMED


def test_resolve_clip_returns_not_supported(song_with_clips):
    song, *_ = song_with_clips
    # returns/* is grammar-reserved but Phase-1 defers; the track
    # segment resolver reports NOT_SUPPORTED before the suffix check.
    r = resolve_clip(song, "returns/0/slots/0/clip")
    assert r.status is ResolveStatus.NOT_SUPPORTED


def test_resolve_clip_has_clip_raises_treated_as_empty(song_with_clips):
    """Live 12 quirk: slot.has_clip can raise. Treat as empty, don't propagate."""
    song, _m, t0, _t1, _c0, _c1 = song_with_clips
    t0.clip_slots[0]._has_clip_raises = True
    r = resolve_clip(song, "tracks/0/slots/0/clip")
    assert r.status is ResolveStatus.CLIP_NOT_PRESENT


def test_resolve_clip_clip_attr_raises(song_with_clips):
    song, _m, t0, _t1, _c0, _c1 = song_with_clips
    t0.clip_slots[0]._clip_raises = True
    r = resolve_clip(song, "tracks/0/slots/0/clip")
    assert r.status is ResolveStatus.CLIP_NOT_PRESENT


# --- compose_slot_path / compose_clip_path --------------------------------


def test_compose_slot_path(song_with_clips):
    song, _m, t0, _t1, _c0, _c1 = song_with_clips
    assert compose_slot_path(song, t0, 0) == "tracks/0/slots/0"
    assert compose_slot_path(song, t0, 1) == "tracks/0/slots/1"


def test_compose_slot_path_unreachable_track_none(song_with_clips):
    song, *_ = song_with_clips
    orphan = StubTrack(tid=777, name="Orphan")
    assert compose_slot_path(song, orphan, 0) is None


def test_compose_clip_path(song_with_clips):
    song, _m, t0, t1, _c0, _c1 = song_with_clips
    assert compose_clip_path(song, t0, 0) == "tracks/0/slots/0/clip"
    assert compose_clip_path(song, t1, 0) == "tracks/1/slots/0/clip"


def test_compose_clip_path_roundtrip_with_resolve(song_with_clips):
    """compose_clip_path → resolve_clip identity for occupied slots."""
    song, _m, t0, t1, c0, c1 = song_with_clips
    p0 = compose_clip_path(song, t0, 0)
    r0 = resolve_clip(song, p0)
    assert r0.ok and r0.obj is c0
    p1 = compose_clip_path(song, t1, 0)
    r1 = resolve_clip(song, p1)
    assert r1.ok and r1.obj is c1


# --- clip_path_for (reverse lookup) ---------------------------------------


def test_clip_path_for_occupied(song_with_clips):
    song, _m, _t0, _t1, c0, c1 = song_with_clips
    assert clip_path_for(song, c0) == "tracks/0/slots/0/clip"
    assert clip_path_for(song, c1) == "tracks/1/slots/0/clip"


def test_clip_path_for_arrangement_only_none(song_with_clips):
    """A clip not in any slot — typical arrangement clip — yields None."""
    song, *_ = song_with_clips
    orphan = StubClip(cid=999, name="arrangement-only")
    assert clip_path_for(song, orphan) is None


def test_clip_path_for_none_input(song_with_clips):
    song, *_ = song_with_clips
    assert clip_path_for(song, None) is None


def test_clip_path_for_skips_empty_slots(song_with_clips):
    """Reverse lookup ignores empty slots — don't match on
    has_clip=False even if .clip happens to compare equal."""
    song, _m, t0, _t1, c0, _c1 = song_with_clips
    # Put c0 in a slot AND leave that same slot marked empty —
    # tests that the guard goes through has_clip not just `is`.
    t0.clip_slots.append(StubClipSlot())
    assert clip_path_for(song, c0) == "tracks/0/slots/0/clip"


def test_clip_path_for_has_clip_raises_handled(song_with_clips):
    """A slot whose has_clip raises is treated as empty during walk."""
    song, _m, t0, _t1, c0, _c1 = song_with_clips
    # Mark the slot that holds c0 as raising — lookup should return
    # None (no other slot holds c0 in this fixture).
    t0.clip_slots[0]._has_clip_raises = True
    assert clip_path_for(song, c0) is None


# --- drum pad chains: pads/<note>/devices/<M> (issue #491, protocol 3.8.0) ---

from components.path_resolver import (
    compose_chain_device_path,
    compose_pad_path,
    compose_param_path_under,
    is_pad_scoped,
    resolve_pad,
)
from tests.support.lom_fakes import (
    FakeChain,
    FakeDevice,
    FakePad,
    FakeParam,
    FakeSong,
    FakeTrack,
    drumcell,
    make_rack,
)


def _pad_song():
    """Track 0 carries a Drum Rack whose pad 36 holds a DrumCell and a
    Reverb, whose pad 37 holds a nested Drum Rack with a pad of its own,
    and whose pad 40 has no chain; track 1 carries a plain Simpler."""
    reverb = FakeDevice("Hybrid", [FakeParam("Device On", 1.0), FakeParam("Dry/Wet", 0.3)], type_=2, name="Reverb")
    inner = make_rack([FakePad(60, [FakeChain([drumcell()])])])
    rack = make_rack([
        FakePad(36, [FakeChain([drumcell(), reverb])]),
        FakePad(37, [FakeChain([inner])]),
    ])
    simpler = FakeDevice("OriginalSimpler", [FakeParam("Device On", 1.0)])
    song = FakeSong(tracks=[FakeTrack([rack], "Drums"), FakeTrack([simpler], "Keys")])
    return song, rack, reverb, inner


def test_pad_device_resolves_through_the_chain():
    song, rack, reverb, _ = _pad_song()
    r = resolve_device(song, "tracks/0/devices/0/pads/36/devices/1")
    assert r.status is ResolveStatus.OK and r.obj is reverb
    r = resolve_param(song, "tracks/0/devices/0/pads/36/devices/1/params/1")
    assert r.status is ResolveStatus.OK and r.obj is reverb.parameters[1]


def test_pad_grammar_recurses_through_a_nested_rack():
    song, _, _, inner = _pad_song()
    r = resolve_device(song, "tracks/0/devices/0/pads/37/devices/0")
    assert r.status is ResolveStatus.OK and r.obj is inner
    r = resolve_device(song, "tracks/0/devices/0/pads/37/devices/0/pads/60/devices/0")
    assert r.status is ResolveStatus.OK and r.obj.class_name == "DrumCell"


def test_pad_grammar_not_found_cases():
    song, _, _, _ = _pad_song()
    # No chain at that note.
    assert resolve_device(song, "tracks/0/devices/0/pads/40/devices/0").status is ResolveStatus.NOT_FOUND
    # A device the chain does not have.
    assert resolve_device(song, "tracks/0/devices/0/pads/36/devices/5").status is ResolveStatus.NOT_FOUND
    # The device under pads/ is not a Drum Rack.
    assert resolve_device(song, "tracks/1/devices/0/pads/36/devices/0").status is ResolveStatus.NOT_FOUND
    assert resolve_param(song, "tracks/0/devices/0/pads/36/devices/1/params/9").status is ResolveStatus.NOT_FOUND


@pytest.mark.parametrize("path", [
    "tracks/0/devices/0/pads/36",              # a pad is a container, not a device
    "tracks/0/devices/0/pads/36/params/0",     # params hang off a device
    "tracks/0/devices/0/pads/128/devices/0",   # note out of range
    "tracks/0/devices/0/pads/x/devices/0",
    "tracks/0/devices/0/pads/036/devices/0",
    "tracks/0/devices/0/pads/",
])
def test_pad_grammar_malformed_cases(path):
    song, _, _, _ = _pad_song()
    assert resolve_device(song, path).status is ResolveStatus.MALFORMED


def test_chains_stay_reserved_beside_pads():
    song, _, _, _ = _pad_song()
    assert resolve_device(song, "tracks/0/devices/0/chains/0/devices/0").status is ResolveStatus.NOT_SUPPORTED
    assert resolve_param(song, "tracks/0/devices/0/pads/36/devices/1/chains/0/devices/0/params/0").status is ResolveStatus.NOT_SUPPORTED


def test_resolve_pad_answers_rack_pad_and_chain():
    song, rack, _, _ = _pad_song()
    r = resolve_pad(song, "tracks/0/devices/0/pads/36")
    assert r.status is ResolveStatus.OK
    assert r.obj.rack is rack and r.obj.note == 36
    assert r.obj.pad is rack.drum_pads[36]
    assert r.obj.chain is rack.drum_pads[36].chains[0]
    assert r.obj.rack_path == "tracks/0/devices/0"
    assert resolve_pad(song, "tracks/0/devices/0/pads/40").status is ResolveStatus.NOT_FOUND
    assert resolve_pad(song, "tracks/1/devices/0/pads/36").status is ResolveStatus.NOT_FOUND
    assert resolve_pad(song, "tracks/0/devices/0").status is ResolveStatus.MALFORMED
    assert resolve_pad(song, "tracks/0/devices/0/pads/36/devices/1").status is ResolveStatus.MALFORMED
    assert resolve_pad(song, "tracks/9/devices/0/pads/36").status is ResolveStatus.NOT_FOUND
    # Four segments that end in a pad — `pads/` hangs off a DEVICE, never a
    # track — and a bare track: malformed, not "no such pad" (2026-09-12;
    # the length guard used to let the first through to an index error).
    assert resolve_pad(song, "tracks/1/pads/36").status is ResolveStatus.MALFORMED
    assert resolve_pad(song, "tracks/1").status is ResolveStatus.MALFORMED
    assert resolve_pad(song, "").status is ResolveStatus.MALFORMED


def test_pad_lookup_scans_when_the_list_is_not_note_indexed():
    """``drum_pads`` is note-indexed on the rig; a rack that lists only its
    populated pads still resolves by the pad's own ``note``."""
    song, rack, reverb, _ = _pad_song()
    rack.drum_pads = [p for p in rack.drum_pads if p.chains]
    r = resolve_device(song, "tracks/0/devices/0/pads/36/devices/1")
    assert r.status is ResolveStatus.OK and r.obj is reverb


def test_pad_path_composition_and_predicate():
    assert compose_pad_path("tracks/1/devices/0", 38) == "tracks/1/devices/0/pads/38"
    assert compose_chain_device_path("tracks/1/devices/0/pads/38", 1) == "tracks/1/devices/0/pads/38/devices/1"
    assert compose_param_path_under("tracks/1/devices/0/pads/38/devices/1", 4) == "tracks/1/devices/0/pads/38/devices/1/params/4"
    assert is_pad_scoped("tracks/1/devices/0/pads/38")
    assert is_pad_scoped("tracks/1/devices/0/pads/38/devices/1/params/4")
    assert not is_pad_scoped("tracks/1/devices/0")
    assert not is_pad_scoped("")
