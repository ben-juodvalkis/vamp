"""ClipPropertiesComponent unit tests (PR-5e1).

Covers the focus-scoped clip-property channel: one
``song.view.detail_clip`` listener (attached once at ``__init__``),
and on each focus change, detach the property listeners from the
previous clip and reattach them to the new one. Write handlers
resolve clipPath → clip via ``resolve_clip`` and apply LOM writes
directly; loop_start carries a start_marker side-effect.

Scaffolding
-----------

``StubSong`` / ``StubTrack`` from ``test_lom_listeners`` and
``StubClip`` / ``StubClipSlot`` from ``test_path_resolver`` give us
the positional grammar. To those we add two shims:

* ``ClipWithListeners`` — a ``StubClip`` subclass with
  add_/remove_<attr>_listener for each of the PR-5e1 attrs, plus
  ``.loop_start`` etc. attributes whose assignment fires the
  matching listener (mirrors LOM's observable-attr contract).

* ``StubView`` — carries ``detail_clip`` + the
  add_/remove_detail_clip_listener pair. Exposed on the song as
  ``song.view``.

The component reads ``song.view.detail_clip``, observes changes, and
emits via an ``emit(address, args)`` callable — we collect those into
a list for assertion.

Cases covered (≥20, by category):

* construction attaches detail_clip listener (1)
* init with focused clip seeds focused + 6 property emits (2)
* init with no focused clip emits focused="" only (1)
* focus change detaches old, attaches new (2)
* focus → null detaches only (1)
* focused clip deleted → None (1)
* arrangement-only clip has no resolvable path (1)
* 6 attr round-trips (6)
* loop_start side-effect writes start_marker (1)
* NaN / negative float rejection (2)
* warp_mode invalid/valid enum (2)
* looping int/bool coercion + reject (2)
* clipPath not string rejected (1)
* clipPath non-existent rejected (1)
* write to non-focused clip succeeds (1)
* emit_on_accept re-emits focused + 6 (1)
* disconnect idempotent, detaches both layers (2)
* LOM-touch guard swallows attach failure (1)
"""

from __future__ import annotations

import math
from typing import List, Optional

import pytest

from components.ClipPropertiesComponent import (
    ClipPropertiesComponent,
    V3_CLIP_FOCUSED_ADDRESS,
    V3_CLIP_PROPERTY_ADDRESS,
)
from tests.test_lom_listeners import StubTrack
from tests.test_path_resolver import StubClip, StubClipSlot


# --- stubs -----------------------------------------------------------------


_ATTRS = ("loop_start", "loop_end", "start_marker", "end_marker",
          "warp_mode", "looping", "pitch_coarse", "pitch_fine", "gain")


class ClipWithListeners(StubClip):
    """``StubClip`` + per-attr observable contract.

    Real ``Live.Clip`` fires listeners synchronously on setattr; we
    match that shape so tests can drive a LOM change by assigning
    the attribute. Writes also bypass the fire when desired via
    ``_silent_set`` — used for direct state prep in fixtures.
    """

    def __init__(self, cid=0, name="", **initial):
        super().__init__(cid=cid, name=name)
        defaults = {
            "loop_start": 0.0, "loop_end": 4.0,
            "start_marker": 0.0, "end_marker": 4.0,
            "warp_mode": 0, "looping": 1,
            "pitch_coarse": 0, "pitch_fine": 0, "gain": 1.0,
        }
        defaults.update(initial)
        # Bypass our __setattr__ so we don't fire listeners for
        # seed values (no listeners yet anyway, but keeps intent
        # explicit).
        object.__setattr__(self, "_attr_state", dict(defaults))
        object.__setattr__(self, "_attr_listeners", {a: None for a in _ATTRS})
        object.__setattr__(self, "_attach_raises_for", set())

    def __getattr__(self, name):
        if name in _ATTRS:
            return self._attr_state[name]
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name in _ATTRS:
            self._attr_state[name] = value
            cb = self._attr_listeners.get(name)
            if cb is not None:
                cb()
            return
        object.__setattr__(self, name, value)

    def _silent_set(self, name, value):
        self._attr_state[name] = value

    def __getattribute__(self, name):
        # Dynamic add_/remove_<attr>_listener methods — one per PR-5e1
        # attr. Real LOM exposes these per observable property; we
        # mirror only the attrs the component uses.
        if (name.startswith("add_") or name.startswith("remove_")) \
                and name.endswith("_listener"):
            try:
                listeners = object.__getattribute__(self, "_attr_listeners")
            except AttributeError:
                listeners = None
            if listeners is not None:
                prefix_len = 4 if name.startswith("add_") else 7
                attr = name[prefix_len:-len("_listener")]
                if attr in listeners:
                    if name.startswith("add_"):
                        return self._make_adder(attr)
                    return self._make_remover(attr)
        return object.__getattribute__(self, name)

    def _make_adder(self, attr):
        def _add(cb):
            if attr in self._attach_raises_for:
                raise RuntimeError("add_%s_listener blocked by test" % attr)
            assert self._attr_listeners[attr] is None, (
                "ClipWithListeners supports one %s listener" % attr,
            )
            self._attr_listeners[attr] = cb
        return _add

    def _make_remover(self, attr):
        def _remove(cb):
            assert self._attr_listeners[attr] == cb, (
                "detaching %s listener that wasn't attached" % attr,
            )
            self._attr_listeners[attr] = None
        return _remove

    def has_listener(self, attr: str) -> bool:
        return self._attr_listeners.get(attr) is not None

    def listener_count(self) -> int:
        return sum(1 for cb in self._attr_listeners.values() if cb is not None)


class StubView:
    """``song.view`` shim with detail_clip + listener."""

    def __init__(self, detail_clip=None):
        self._detail_clip = detail_clip
        self._listener = None

    @property
    def detail_clip(self):
        return self._detail_clip

    def set_detail_clip(self, clip) -> None:
        """Change focus and fire the listener."""
        self._detail_clip = clip
        if self._listener is not None:
            self._listener()

    def add_detail_clip_listener(self, cb):
        assert self._listener is None, "one detail_clip listener"
        self._listener = cb

    def remove_detail_clip_listener(self, cb):
        assert self._listener == cb
        self._listener = None

    def has_listener(self) -> bool:
        return self._listener is not None


class ClipStubSong:
    """Song with session-view tracks + a view with detail_clip.

    Different shape from ``test_lom_listeners.StubSong`` because
    ``ClipPropertiesComponent`` needs ``song.view`` + the per-track
    ``clip_slots``. Borrows ``StubTrack`` to keep the tracks-level
    contract consistent.
    """

    def __init__(self, tracks: Optional[List[StubTrack]] = None,
                 master: Optional[StubTrack] = None,
                 detail_clip=None):
        self._tracks = list(tracks or [])
        self.master_track = master if master is not None else StubTrack(
            tid=9_999_999, name="Master",
        )
        # Master needs clip_slots for clip_path_for walk to terminate.
        if not hasattr(self.master_track, "clip_slots"):
            self.master_track.clip_slots = []
        self.view = StubView(detail_clip=detail_clip)

    @property
    def tracks(self):
        return list(self._tracks)


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def captured_emits():
    """``(address, args)`` tuples emitted by the component."""
    return []


@pytest.fixture
def song_with_two_clips():
    """Session with t0/slot0 = c0, t0/slot1 = c1, t1/slot0 = c2."""
    t0 = StubTrack(tid=100, name="t0")
    t1 = StubTrack(tid=101, name="t1")
    c0 = ClipWithListeners(cid=500, name="c0")
    c1 = ClipWithListeners(cid=501, name="c1", loop_start=2.0, loop_end=6.0)
    c2 = ClipWithListeners(cid=502, name="c2")
    t0.clip_slots = [StubClipSlot(clip=c0), StubClipSlot(clip=c1)]
    t1.clip_slots = [StubClipSlot(clip=c2)]
    song = ClipStubSong(tracks=[t0, t1])
    return song, t0, t1, c0, c1, c2


def _make_component(song, captured_emits):
    emit = lambda addr, args: captured_emits.append((addr, args))
    return ClipPropertiesComponent(song=song, emit=emit)


# --- construction / detail_clip listener ----------------------------------


def test_attaches_detail_clip_listener_on_init(captured_emits):
    song = ClipStubSong()
    _c = _make_component(song, captured_emits)
    assert song.view.has_listener()


def test_init_with_no_focused_clip_emits_focused_empty(captured_emits):
    song = ClipStubSong()
    _c = _make_component(song, captured_emits)
    # Only the focused-null emit; no property emits.
    assert captured_emits == [(V3_CLIP_FOCUSED_ADDRESS, ("",))]


def test_init_with_focused_clip_seeds_focused_plus_six(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0  # bypass setter — no listener yet
    _c = _make_component(song, captured_emits)
    # First emit is focused path; then one property emit per attr.
    assert captured_emits[0] == (
        V3_CLIP_FOCUSED_ADDRESS, ("tracks/0/slots/0/clip",),
    )
    prop_emits = [e for e in captured_emits[1:]
                  if e[0] == V3_CLIP_PROPERTY_ADDRESS]
    assert len(prop_emits) == len(_ATTRS)
    names = {e[1][1] for e in prop_emits}
    assert names == set(_ATTRS)


# --- focus-change detach/reattach -----------------------------------------


def test_focus_change_detaches_old_attaches_new(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    assert c0.listener_count() == len(_ATTRS)
    captured_emits.clear()

    song.view.set_detail_clip(c1)
    # Old clip: all 6 listeners detached. New clip: all 6 attached.
    assert c0.listener_count() == 0
    assert c1.listener_count() == len(_ATTRS)
    # Emits: focused (new path) + 6 property values.
    assert captured_emits[0] == (
        V3_CLIP_FOCUSED_ADDRESS, ("tracks/0/slots/1/clip",),
    )
    prop_emits = [e for e in captured_emits[1:]
                  if e[0] == V3_CLIP_PROPERTY_ADDRESS]
    assert len(prop_emits) == len(_ATTRS)


def test_focus_change_to_different_track(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    captured_emits.clear()

    song.view.set_detail_clip(c2)
    # New path is on track 1 slot 0.
    assert captured_emits[0] == (
        V3_CLIP_FOCUSED_ADDRESS, ("tracks/1/slots/0/clip",),
    )
    assert c0.listener_count() == 0
    assert c2.listener_count() == len(_ATTRS)


def test_focus_cleared_detaches_all(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    captured_emits.clear()

    song.view.set_detail_clip(None)
    assert c0.listener_count() == 0
    # Only a focused-empty emit; no property emits.
    assert captured_emits == [(V3_CLIP_FOCUSED_ADDRESS, ("",))]


def test_arrangement_only_clip_yields_no_path(
    song_with_two_clips, captured_emits,
):
    """A clip not in any session slot -> clip_path_for returns None."""
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    captured_emits.clear()

    orphan = ClipWithListeners(cid=999, name="orphan")
    song.view.set_detail_clip(orphan)
    # clip_path_for returns None -> focused="", no property emits,
    # no listeners attached to orphan.
    assert captured_emits == [(V3_CLIP_FOCUSED_ADDRESS, ("",))]
    assert orphan.listener_count() == 0


# --- listener fires → property emit ---------------------------------------


def test_loop_start_change_emits_property(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    captured_emits.clear()

    c0.loop_start = 1.5
    assert captured_emits == [(
        V3_CLIP_PROPERTY_ADDRESS,
        ("tracks/0/slots/0/clip", "loop_start", 1.5),
    )]


def test_warp_mode_change_emits_int(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    captured_emits.clear()

    c0.warp_mode = 3
    assert captured_emits == [(
        V3_CLIP_PROPERTY_ADDRESS,
        ("tracks/0/slots/0/clip", "warp_mode", 3),
    )]


def test_looping_change_emits_0_or_1(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    _c = _make_component(song, captured_emits)
    captured_emits.clear()

    c0.looping = 0
    c0.looping = 1
    assert captured_emits == [
        (V3_CLIP_PROPERTY_ADDRESS,
         ("tracks/0/slots/0/clip", "looping", 0)),
        (V3_CLIP_PROPERTY_ADDRESS,
         ("tracks/0/slots/0/clip", "looping", 1)),
    ]


# --- write handlers -------------------------------------------------------


def test_set_loop_start_writes_and_applies_start_marker_side_effect(
    song_with_two_clips, captured_emits,
):
    """loop_start write must also set start_marker (M4L parity)."""
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    captured_emits.clear()

    c.handle_set_loop_start(
        args=("tracks/0/slots/0/clip", 2.5),
        source_addr=None,
    )
    assert c0.loop_start == 2.5
    assert c0.start_marker == 2.5


def test_set_loop_end_writes(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c.handle_set_loop_end(
        args=("tracks/0/slots/0/clip", 8.0),
        source_addr=None,
    )
    assert c0.loop_end == 8.0


def test_set_end_marker_writes(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c.handle_set_end_marker(
        args=("tracks/0/slots/0/clip", 12.0),
        source_addr=None,
    )
    assert c0.end_marker == 12.0


def test_set_warp_mode_valid_writes(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    for mode in (0, 1, 2, 3, 4, 6):
        c.handle_set_warp_mode(
            args=("tracks/0/slots/0/clip", mode),
            source_addr=None,
        )
        assert c0.warp_mode == mode


def test_set_warp_mode_invalid_rejected(
    song_with_two_clips, captured_emits,
):
    """warp_mode=5 is reserved; handler rejects silently."""
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("warp_mode", 0)
    c.handle_set_warp_mode(
        args=("tracks/0/slots/0/clip", 5),
        source_addr=None,
    )
    assert c0.warp_mode == 0  # unchanged
    c.handle_set_warp_mode(
        args=("tracks/0/slots/0/clip", 99),
        source_addr=None,
    )
    assert c0.warp_mode == 0


def test_set_looping_coerces_truthy_int(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c.handle_set_looping(
        args=("tracks/0/slots/0/clip", 1),
        source_addr=None,
    )
    assert c0.looping is True
    c.handle_set_looping(
        args=("tracks/0/slots/0/clip", 0),
        source_addr=None,
    )
    assert c0.looping is False


def test_set_looping_rejects_nonbool01(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("looping", 1)
    c.handle_set_looping(
        args=("tracks/0/slots/0/clip", 2),
        source_addr=None,
    )
    assert c0.looping == 1  # unchanged — still seed value
    c.handle_set_looping(
        args=("tracks/0/slots/0/clip", "yes"),
        source_addr=None,
    )
    assert c0.looping == 1


def test_set_pitch_coarse_writes_value(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_coarse", 0)
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", 12),
        source_addr=None,
    )
    assert c0.pitch_coarse == 12
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", -24),
        source_addr=None,
    )
    assert c0.pitch_coarse == -24


def test_set_pitch_coarse_accepts_boundary_values(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_coarse", 0)
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", 48),
        source_addr=None,
    )
    assert c0.pitch_coarse == 48
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", -48),
        source_addr=None,
    )
    assert c0.pitch_coarse == -48


def test_set_pitch_coarse_rejects_out_of_range(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_coarse", 7)
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", 49),
        source_addr=None,
    )
    assert c0.pitch_coarse == 7  # unchanged — no clamp
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", -49),
        source_addr=None,
    )
    assert c0.pitch_coarse == 7


def test_set_pitch_coarse_rejects_non_integer(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_coarse", 3)
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", "seven"),
        source_addr=None,
    )
    assert c0.pitch_coarse == 3
    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", None),
        source_addr=None,
    )
    assert c0.pitch_coarse == 3


def test_set_pitch_coarse_emits_on_listener_fire(
    song_with_two_clips, captured_emits,
):
    """Writing pitch_coarse on the focused clip fires the listener,
    which emits ``/looping/v3/clip/property``."""
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    captured_emits.clear()

    c.handle_set_pitch_coarse(
        args=("tracks/0/slots/0/clip", 5),
        source_addr=None,
    )
    prop_emits = [e for e in captured_emits
                  if e[0] == V3_CLIP_PROPERTY_ADDRESS
                  and e[1][1] == "pitch_coarse"]
    assert prop_emits == [
        (V3_CLIP_PROPERTY_ADDRESS, ("tracks/0/slots/0/clip",
                                     "pitch_coarse", 5)),
    ]


# --- pitch_fine (M2 — clip-view-mirror) -----------------------------------


def test_set_pitch_fine_writes_and_boundaries(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_fine", 0)
    c.handle_set_pitch_fine(
        args=("tracks/0/slots/0/clip", 25), source_addr=None,
    )
    assert c0.pitch_fine == 25
    # Boundaries: -50 and 49 accepted.
    c.handle_set_pitch_fine(
        args=("tracks/0/slots/0/clip", 49), source_addr=None,
    )
    assert c0.pitch_fine == 49
    c.handle_set_pitch_fine(
        args=("tracks/0/slots/0/clip", -50), source_addr=None,
    )
    assert c0.pitch_fine == -50


def test_set_pitch_fine_rejects_out_of_range(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_fine", 3)
    c.handle_set_pitch_fine(
        args=("tracks/0/slots/0/clip", 50), source_addr=None,
    )
    assert c0.pitch_fine == 3  # unchanged — no clamp
    c.handle_set_pitch_fine(
        args=("tracks/0/slots/0/clip", -51), source_addr=None,
    )
    assert c0.pitch_fine == 3


def test_set_pitch_fine_rejects_non_integer(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("pitch_fine", 3)
    c.handle_set_pitch_fine(
        args=("tracks/0/slots/0/clip", "twelve"), source_addr=None,
    )
    assert c0.pitch_fine == 3


# --- gain (M2 — clip-view-mirror) -----------------------------------------


def test_set_gain_writes_value(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("gain", 1.0)
    c.handle_set_gain(
        args=("tracks/0/slots/0/clip", 0.5), source_addr=None,
    )
    assert c0.gain == 0.5


def test_set_gain_clamps_out_of_range(
    song_with_two_clips, captured_emits,
):
    """gain is a continuous fader → clamp, not reject (unlike pitch)."""
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("gain", 0.5)
    c.handle_set_gain(
        args=("tracks/0/slots/0/clip", 1.5), source_addr=None,
    )
    assert c0.gain == 1.0  # clamped to max
    c.handle_set_gain(
        args=("tracks/0/slots/0/clip", -0.3), source_addr=None,
    )
    assert c0.gain == 0.0  # clamped to min


def test_set_gain_rejects_nan_and_non_float(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("gain", 0.5)
    c.handle_set_gain(
        args=("tracks/0/slots/0/clip", float("nan")), source_addr=None,
    )
    assert c0.gain == 0.5  # unchanged
    c.handle_set_gain(
        args=("tracks/0/slots/0/clip", "loud"), source_addr=None,
    )
    assert c0.gain == 0.5


def test_set_gain_emits_on_listener_fire(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    captured_emits.clear()
    c.handle_set_gain(
        args=("tracks/0/slots/0/clip", 0.25), source_addr=None,
    )
    prop_emits = [e for e in captured_emits
                  if e[0] == V3_CLIP_PROPERTY_ADDRESS
                  and e[1][1] == "gain"]
    assert prop_emits == [
        (V3_CLIP_PROPERTY_ADDRESS, ("tracks/0/slots/0/clip", "gain", 0.25)),
    ]


# --- gain under a Permute mute step ----------------------------------------


class FakePermute:
    """``SequencerComponent``'s two gain hooks, keyed by clip identity."""

    def __init__(self):
        self.homes = {}
        self.adopted = []

    def hold(self, clip, home):
        self.homes[id(clip)] = home

    def held_gain(self, clip):
        return self.homes.get(id(clip))

    def adopt_gain(self, clip, value, rezero=False):
        if id(clip) not in self.homes:
            return False
        self.homes[id(clip)] = value
        self.adopted.append((value, rezero))
        return True


CLIP0 = "tracks/0/slots/0/clip"


def _gain_emits(captured_emits):
    return [e[1][1:] for e in captured_emits
            if e[0] == V3_CLIP_PROPERTY_ADDRESS
            and e[1][1] in ("gain", "gain_display")]


def _with_permute(song, captured_emits, permute):
    emit = lambda addr, args: captured_emits.append((addr, args))
    return ClipPropertiesComponent(song=song, emit=emit, permute=permute)


def test_gain_goes_out_with_lives_own_label(song_with_two_clips, captured_emits):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    object.__setattr__(c0, "gain_display_string", "-6.0 dB")
    song.view._detail_clip = c0
    c = _with_permute(song, captured_emits, FakePermute())
    captured_emits.clear()
    c.handle_set_gain(args=(CLIP0, 0.25), source_addr=None)
    assert _gain_emits(captured_emits) == [("gain", 0.25), ("gain_display", "-6.0 dB")]


def test_a_held_clip_echoes_the_gain_the_step_puts_back(song_with_two_clips, captured_emits):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    object.__setattr__(c0, "gain_display_string", "-inf dB")
    song.view._detail_clip = c0
    permute = FakePermute()
    c = _with_permute(song, captured_emits, permute)
    captured_emits.clear()
    permute.hold(c0, 0.4)
    c0.gain = 0.0                                   # the mute step's write
    assert _gain_emits(captured_emits) == [("gain", 0.4)]   # no "-inf dB"
    assert permute.adopted == []


def test_a_gain_set_on_a_held_clip_goes_to_the_step_not_the_clip(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    permute = FakePermute()
    c = _with_permute(song, captured_emits, permute)
    permute.hold(c0, 0.4)
    c0._silent_set("gain", 0.0)
    captured_emits.clear()
    c.handle_set_gain(args=(CLIP0, 0.7), source_addr=None)
    assert c0.gain == 0.0
    assert permute.adopted == [(0.7, False)]
    assert _gain_emits(captured_emits) == [("gain", 0.7)]


def test_a_gain_edited_in_live_on_a_held_clip_is_adopted(song_with_two_clips, captured_emits):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    object.__setattr__(c0, "gain_display_string", "2.0 dB")
    song.view._detail_clip = c0
    permute = FakePermute()
    c = _with_permute(song, captured_emits, permute)
    permute.hold(c0, 0.4)
    captured_emits.clear()
    c0.gain = 0.6                                   # a hand on Live's knob
    assert permute.adopted == [(0.6, True)]
    assert _gain_emits(captured_emits) == [("gain", 0.6), ("gain_display", "2.0 dB")]


def test_focusing_a_held_clip_shows_the_gain_the_step_puts_back(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    permute = FakePermute()
    _c = _with_permute(song, captured_emits, permute)
    permute.hold(c1, 0.3)
    c1._silent_set("gain", 0.0)
    captured_emits.clear()
    song.view.set_detail_clip(c1)
    assert _gain_emits(captured_emits) == [("gain", 0.3)]


def test_a_refused_gain_write_puts_the_fader_back(song_with_two_clips, captured_emits):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips

    class Refusing(ClipWithListeners):
        def __setattr__(self, name, value):
            if name == "gain":
                raise RuntimeError("gain refused")
            super().__setattr__(name, value)

    c9 = Refusing(cid=509, name="c9", gain=0.4)
    song.tracks[0].clip_slots[0] = StubClipSlot(clip=c9)
    song.view._detail_clip = c9
    c = _with_permute(song, captured_emits, FakePermute())
    captured_emits.clear()
    c.handle_set_gain(args=(CLIP0, 0.9), source_addr=None)
    assert _gain_emits(captured_emits) == [("gain", 0.4)]


def test_set_float_rejects_nan(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("loop_end", 4.0)
    c.handle_set_loop_end(
        args=("tracks/0/slots/0/clip", float("nan")),
        source_addr=None,
    )
    assert c0.loop_end == 4.0  # unchanged


def test_set_float_rejects_negative(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("loop_start", 0.0)
    c.handle_set_loop_start(
        args=("tracks/0/slots/0/clip", -1.0),
        source_addr=None,
    )
    assert c0.loop_start == 0.0


def test_set_rejects_nonstring_clippath(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c0._silent_set("loop_start", 0.0)
    c.handle_set_loop_start(
        args=(12345, 1.0),  # not a string
        source_addr=None,
    )
    assert c0.loop_start == 0.0  # no write


def test_set_rejects_nonexistent_clippath(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    c = _make_component(song, captured_emits)
    # Resolver returns NOT_FOUND for this -> no-op.
    c.handle_set_loop_start(
        args=("tracks/99/slots/99/clip", 1.0),
        source_addr=None,
    )
    # No exception, and c0 untouched.
    assert c0.loop_start == 0.0


def test_write_to_non_focused_clip_succeeds(
    song_with_two_clips, captured_emits,
):
    """Writes accept any resolvable clipPath, not just focused."""
    song, _t0, _t1, c0, c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0  # c0 focused
    c = _make_component(song, captured_emits)
    captured_emits.clear()

    # Target c1 which is NOT focused.
    c.handle_set_loop_end(
        args=("tracks/0/slots/1/clip", 99.0),
        source_addr=None,
    )
    # Write landed on c1.
    assert c1.loop_end == 99.0
    # No listener on c1 -> no echo emit. (c1 has no attached listeners.)
    prop_emits = [e for e in captured_emits
                  if e[0] == V3_CLIP_PROPERTY_ADDRESS]
    assert prop_emits == []


# --- emit_on_accept -------------------------------------------------------


def test_emit_on_accept_with_focus_reemits_focused_plus_six(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    captured_emits.clear()

    c.emit_on_accept()
    assert captured_emits[0] == (
        V3_CLIP_FOCUSED_ADDRESS, ("tracks/0/slots/0/clip",),
    )
    prop_emits = [e for e in captured_emits[1:]
                  if e[0] == V3_CLIP_PROPERTY_ADDRESS]
    assert len(prop_emits) == len(_ATTRS)


def test_emit_on_accept_with_no_focus_only_emits_empty_focused(
    captured_emits,
):
    song = ClipStubSong()
    c = _make_component(song, captured_emits)
    captured_emits.clear()

    c.emit_on_accept()
    assert captured_emits == [(V3_CLIP_FOCUSED_ADDRESS, ("",))]


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_all(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    assert c0.listener_count() == len(_ATTRS)
    assert song.view.has_listener()

    c.disconnect()
    assert c0.listener_count() == 0
    assert not song.view.has_listener()


def test_disconnect_is_idempotent(
    song_with_two_clips, captured_emits,
):
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    song.view._detail_clip = c0
    c = _make_component(song, captured_emits)
    c.disconnect()
    # Second call must not raise even though listeners are already gone.
    c.disconnect()
    assert c0.listener_count() == 0


# --- LOM-touch guard ------------------------------------------------------


def test_attach_failure_swallowed(
    song_with_two_clips, captured_emits,
):
    """If add_<attr>_listener raises, we warn-once and move on."""
    song, _t0, _t1, c0, _c1, _c2 = song_with_two_clips
    c0._attach_raises_for = {"loop_start"}
    song.view._detail_clip = c0
    # No exception; construction completes with (len(_ATTRS) - 1) listeners
    # (the blocked one didn't attach).
    _c = _make_component(song, captured_emits)
    assert c0.listener_count() == len(_ATTRS) - 1
    assert not c0.has_listener("loop_start")
    assert c0.has_listener("loop_end")
