"""GrooveComponent unit tests (PR-5e2).

Focus-scoped groove-property channel. Mirrors the shape of
``test_clip_properties_component.py`` but swaps in:

* a ``GrooveWithListeners`` stub (5 amount attrs instead of the 6
  clip attrs)
* a ``GrooveStubSong`` that also carries a ``groove_pool`` with the
  session's grooves so ``_resolve_groove_for_clip`` can walk it
* a shared ``GroovePoolComponent`` wired in via constructor injection

Cases:

* init attaches detail_clip listener (1)
* init with focused clip + groove emits has_groove=true + 5 amounts (1)
* init with focused grooveless clip emits has_groove=false only (1)
* focus change to grooved clip: rebinds + has_groove=true + 5 (1)
* focus change to grooveless clip: has_groove=false only (1)
* focused-clip delete → has_groove=false + pool return (1)
* listener fires on base/amount change → property emit (1)
* invalid base (e.g. 0 or 4) rejected (1)
* out-of-range float rejected (1)
* NaN rejected (1)
* write to non-focused grooved clip writes, no echo (1)
* assign-on-first-write against grooveless clip claims + emits (1)
* pool-exhausted on first write emits /looping/v3/error (1)
* emit_on_accept re-emits has_groove + 5 amounts (1)
* emit_on_accept with no focus is a no-op (1)
* disconnect detaches amount + detail_clip listeners, idempotent (1)
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional

import pytest

from components.GroovePoolComponent import (
    BLANK_NAME,
    GroovePoolComponent,
    path_hash,
)
from components.GrooveComponent import (
    GrooveComponent,
    V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
    V3_CLIP_GROOVE_PROPERTY_ADDRESS,
    V3_CLIP_GROOVE_SET_BASE_ADDRESS,
    V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS,
    V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
    V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
    V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS,
    V3_ERROR_ADDRESS,
)
from tests.test_lom_listeners import StubTrack
from tests.test_path_resolver import StubClip, StubClipSlot


# --- stubs ----------------------------------------------------------------


_AMOUNT_ATTRS = (
    "base", "timing_amount", "quantization_amount",
    "random_amount", "velocity_amount",
)


class GrooveWithListeners:
    """Groove stub with per-attr observable contract.

    Mirrors ``ClipWithListeners`` from
    ``test_clip_properties_component.py``: assigning one of the 5
    observable amount attrs fires its listener synchronously. The
    name is also mutable (``GroovePoolComponent`` renames it).
    """

    def __init__(self, name: str = "unassigned-0", **initial):
        defaults = {
            "base": 2, "timing_amount": 50.0,
            "quantization_amount": 0.0, "random_amount": 0.0,
            "velocity_amount": 0.0,
        }
        defaults.update(initial)
        object.__setattr__(self, "_attr_state", dict(defaults))
        object.__setattr__(
            self, "_attr_listeners", {a: None for a in _AMOUNT_ATTRS},
        )
        object.__setattr__(self, "name", name)

    def __getattr__(self, name):
        if name in _AMOUNT_ATTRS:
            return self._attr_state[name]
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name in _AMOUNT_ATTRS:
            self._attr_state[name] = value
            cb = self._attr_listeners.get(name)
            if cb is not None:
                cb()
            return
        object.__setattr__(self, name, value)

    def __getattribute__(self, name):
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
            assert self._attr_listeners[attr] is None
            self._attr_listeners[attr] = cb
        return _add

    def _make_remover(self, attr):
        def _remove(cb):
            assert self._attr_listeners[attr] == cb
            self._attr_listeners[attr] = None
        return _remove

    def listener_count(self) -> int:
        return sum(1 for cb in self._attr_listeners.values() if cb is not None)


class GrooveBackedClip(StubClip):
    """Clip stub with a settable ``groove`` tuple ``("id", N)``.

    Tests use ``_link_groove(g)`` to point the clip at ``g`` (with
    ``N = id(g)``) or ``_unlink_groove()`` to return the tuple
    ``("id", 0)`` that means "no groove."
    """

    def __init__(self, cid=0, name=""):
        super().__init__(cid=cid, name=name)
        self._groove_id = 0

    @property
    def groove(self):
        return ("id", self._groove_id)

    @groove.setter
    def groove(self, value):
        # ``GroovePoolComponent.assign_groove_to_clip`` writes the
        # groove *object* here, not a tuple — mirror LOM's acceptance
        # of both shapes.
        if isinstance(value, tuple) and len(value) == 2:
            self._groove_id = int(value[1])
        else:
            self._groove_id = id(value)

    def _link_groove(self, groove) -> None:
        self._groove_id = id(groove)

    def _unlink_groove(self) -> None:
        self._groove_id = 0


class GrooveObjectBackedClip(StubClip):
    """Clip stub whose ``groove`` property returns the groove OBJECT.

    Mirrors the ``ableton.v3`` wrapper shape: ``clip.groove`` returns
    the ``Groove.Groove`` object directly (with ``_live_ptr``
    identity) instead of the raw LOM ``("id", N)`` tuple. This is
    what real Live 12 exposes through v3; the old tuple-only stub
    hid a bug where ``_groove_id_of`` returned ``None`` for a real
    groove and re-claimed a fresh pool slot on every write.
    """

    def __init__(self, cid=0, name=""):
        super().__init__(cid=cid, name=name)
        self._groove = None

    @property
    def groove(self):
        return self._groove

    @groove.setter
    def groove(self, value):
        self._groove = value

    def _link_groove(self, groove) -> None:
        self._groove = groove

    def _unlink_groove(self) -> None:
        self._groove = None


class StubView:
    """``song.view`` shim with detail_clip + listener."""

    def __init__(self, detail_clip=None):
        self._detail_clip = detail_clip
        self._listener = None

    @property
    def detail_clip(self):
        return self._detail_clip

    def set_detail_clip(self, clip) -> None:
        self._detail_clip = clip
        if self._listener is not None:
            self._listener()

    def add_detail_clip_listener(self, cb):
        assert self._listener is None
        self._listener = cb

    def remove_detail_clip_listener(self, cb):
        assert self._listener == cb
        self._listener = None

    def has_listener(self) -> bool:
        return self._listener is not None


class StubGroovePool:
    def __init__(self, grooves: Optional[List[GrooveWithListeners]] = None):
        self._grooves = list(grooves or [])
        self._listener = None

    @property
    def grooves(self):
        return list(self._grooves)

    def set_grooves(self, grooves):
        self._grooves = list(grooves)
        if self._listener is not None:
            self._listener()

    def add_grooves_listener(self, cb):
        assert self._listener is None
        self._listener = cb

    def remove_grooves_listener(self, cb):
        assert self._listener == cb
        self._listener = None


class GrooveStubSong:
    """Session song with tracks + view + groove_pool."""

    def __init__(
        self,
        tracks: Optional[List[StubTrack]] = None,
        master: Optional[StubTrack] = None,
        detail_clip=None,
        groove_pool: Optional[StubGroovePool] = None,
    ):
        self._tracks = list(tracks or [])
        self.master_track = master if master is not None else StubTrack(
            tid=9_999_999, name="Master",
        )
        if not hasattr(self.master_track, "clip_slots"):
            self.master_track.clip_slots = []
        self.view = StubView(detail_clip=detail_clip)
        self.groove_pool = groove_pool if groove_pool is not None \
            else StubGroovePool()

    @property
    def tracks(self):
        return list(self._tracks)


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def captured_emits():
    return []


@pytest.fixture
def session_with_groove():
    """t0/slot0 = c0 (grooved via g0); t0/slot1 = c1 (grooveless).

    g0 is the only claimed groove; g_free is an available pool slot;
    g_other is an unrelated preset (``Swing16``).
    """
    g0 = GrooveWithListeners(
        name="Clip_" + path_hash("tracks/0/slots/0/clip"),
        base=2, timing_amount=25.0,
        quantization_amount=10.0, random_amount=5.0,
        velocity_amount=50.0,
    )
    g_free = GrooveWithListeners(name="unassigned-1")
    g_other = GrooveWithListeners(name="Swing16")
    pool = StubGroovePool(grooves=[g0, g_free, g_other])

    c0 = GrooveBackedClip(cid=500, name="c0")
    c0._link_groove(g0)
    c1 = GrooveBackedClip(cid=501, name="c1")

    t0 = StubTrack(tid=100, name="t0")
    t0.clip_slots = [StubClipSlot(clip=c0), StubClipSlot(clip=c1)]

    song = GrooveStubSong(tracks=[t0], groove_pool=pool)
    return {
        "song": song, "pool": pool,
        "t0": t0, "c0": c0, "c1": c1,
        "g0": g0, "g_free": g_free, "g_other": g_other,
    }


def _make(song, captured_emits):
    """Construct PoolComponent + GrooveComponent sharing a captured emits list."""
    emit = lambda addr, args: captured_emits.append((addr, args))
    pool_comp = GroovePoolComponent(song=song, emit=emit)
    groove = GrooveComponent(song=song, emit=emit, pool=pool_comp)
    return pool_comp, groove


def _prop_emits(emits, name: Optional[str] = None):
    hits = [e for e in emits if e[0] == V3_CLIP_GROOVE_PROPERTY_ADDRESS]
    if name is None:
        return hits
    return [e for e in hits if e[1][1] == name]


# --- construction ---------------------------------------------------------


def test_attaches_detail_clip_listener_on_init(captured_emits):
    song = GrooveStubSong()
    _pc, _gc = _make(song, captured_emits)
    assert song.view.has_listener()


def test_init_focused_grooved_clip_emits_has_groove_and_amounts(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, _gc = _make(env["song"], captured_emits)

    has_emits = [
        e for e in captured_emits
        if e[0] == V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS
    ]
    assert has_emits == [
        (V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
         ("tracks/0/slots/0/clip", 1)),
    ]
    # 5 amount emits, one per attr, with seeded values.
    names = {e[1][1] for e in _prop_emits(captured_emits)}
    assert names == set(_AMOUNT_ATTRS)
    assert env["g0"].listener_count() == 5


def test_init_focused_grooveless_clip_emits_has_groove_false(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c1"]            # grooveless
    _pc, _gc = _make(env["song"], captured_emits)

    assert (V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
            ("tracks/0/slots/1/clip", 0)) in captured_emits
    assert _prop_emits(captured_emits) == []


# --- focus change ---------------------------------------------------------


def test_focus_change_to_grooveless_emits_has_groove_false(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, _gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    env["song"].view.set_detail_clip(env["c1"])
    # Old groove's amount listeners are gone.
    assert env["g0"].listener_count() == 0
    # has_groove=false for the new focused clipPath.
    assert (V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
            ("tracks/0/slots/1/clip", 0)) in captured_emits
    assert _prop_emits(captured_emits) == []


def test_focused_clip_deleted_returns_groove_and_emits_false(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, _gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    # Simulate Live deleting the focused clip: slot reports no clip
    # and detail_clip transitions to something else (None here).
    env["t0"].clip_slots[0]._clip = None
    env["song"].view.set_detail_clip(None)

    # Pool entry was renamed back to unassigned-<idx>.
    assert env["g0"].name.startswith("unassigned-")
    # has_groove=false emitted for the deleted clipPath.
    assert (V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
            ("tracks/0/slots/0/clip", 0)) in captured_emits


# --- listener-fired property emit ----------------------------------------


def test_amount_listener_fires_property_emit(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, _gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    env["g0"].timing_amount = 42.0

    assert _prop_emits(captured_emits, "timing_amount") == [
        (V3_CLIP_GROOVE_PROPERTY_ADDRESS,
         ("tracks/0/slots/0/clip", "timing_amount", 42.0)),
    ]


# --- write validation -----------------------------------------------------


def test_set_base_rejects_out_of_range(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    env["g0"].__setattr__("base", 2)  # seed

    gc.handle_set_base(
        args=("tracks/0/slots/0/clip", 0),
        source_addr=None,
    )
    gc.handle_set_base(
        args=("tracks/0/slots/0/clip", 4),
        source_addr=None,
    )
    assert env["g0"].base == 2  # unchanged


def test_set_float_rejects_out_of_range(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    env["g0"].__setattr__("timing_amount", 25.0)

    gc.handle_set_timing_amount(
        args=("tracks/0/slots/0/clip", 120.0),
        source_addr=None,
    )
    gc.handle_set_timing_amount(
        args=("tracks/0/slots/0/clip", -0.5),
        source_addr=None,
    )
    assert env["g0"].timing_amount == 25.0


def test_set_float_rejects_nan(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    env["g0"].__setattr__("random_amount", 5.0)

    gc.handle_set_random_amount(
        args=("tracks/0/slots/0/clip", float("nan")),
        source_addr=None,
    )
    assert env["g0"].random_amount == 5.0


# --- write to non-focused clip -------------------------------------------


def test_write_to_non_focused_grooved_clip_writes_no_echo(
    session_with_groove, captured_emits,
):
    """A second grooved clip c2 on t0/slot2; focus stays on c0. A write
    to c2 lands on c2's groove but fires no echo (no listener)."""
    env = session_with_groove
    g2 = GrooveWithListeners(
        name="Clip_" + path_hash("tracks/0/slots/2/clip"),
        timing_amount=10.0,
    )
    env["pool"]._grooves.append(g2)
    c2 = GrooveBackedClip(cid=502, name="c2")
    c2._link_groove(g2)
    env["t0"].clip_slots.append(StubClipSlot(clip=c2))

    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    gc.handle_set_timing_amount(
        args=("tracks/0/slots/2/clip", 77.0),
        source_addr=None,
    )
    assert g2.timing_amount == 77.0
    # No listener is attached to g2 (focus never moved there).
    assert g2.listener_count() == 0
    assert _prop_emits(captured_emits) == []


# --- write-path echo for listener-less attrs (Live 12 ``base``) ----------


def test_write_base_emits_write_path_echo_without_listener(
    session_with_groove, captured_emits,
):
    """Live 12 exposes no ``add_base_listener`` on Groove, so the
    fire path never delivers a ``base`` echo after a UI write.
    The write handler must emit the property itself when the focus-
    matched groove has no ``base`` listener attached, so the UI's
    radio group receives its RX update."""
    env = session_with_groove
    g0 = env["g0"]
    # Drop the base listener slot so ``add_base_listener`` raises
    # AttributeError — matching Live 12's Groove object.
    del g0._attr_listeners["base"]

    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    gc.handle_set_base(
        args=("tracks/0/slots/0/clip", 3),
        source_addr=None,
    )

    assert g0.base == 3
    base_emits = _prop_emits(captured_emits, "base")
    assert base_emits == [
        (V3_CLIP_GROOVE_PROPERTY_ADDRESS,
         ("tracks/0/slots/0/clip", "base", 3)),
    ]


# --- assign-on-first-write ------------------------------------------------


def test_first_write_on_grooveless_focused_claims_and_emits(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c1"]            # grooveless
    _pc, gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    gc.handle_set_quantization_amount(
        args=("tracks/0/slots/1/clip", 30.0),
        source_addr=None,
    )
    # Pool's first unassigned-* (g_free) is now claimed.
    assert env["g_free"].name.endswith(" #" + path_hash("tracks/0/slots/1/clip"))
    # Clip now points at that groove and the write landed.
    assert env["g_free"].quantization_amount == 30.0
    # has_groove=true emitted on first-write.
    assert (V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
            ("tracks/0/slots/1/clip", 1)) in captured_emits
    # 5 amount emits delivered for the freshly-assigned groove.
    names = {e[1][1] for e in _prop_emits(captured_emits)}
    assert names == set(_AMOUNT_ATTRS)


def test_pool_exhausted_emits_v3_error_and_does_not_persist(
    captured_emits,
):
    """Only one pool entry, claimed by a clip that still links it, and
    no minter → first write on a different clip triggers
    pool-exhausted."""
    g0 = GrooveWithListeners(name="Clip_abcdef00")
    pool = StubGroovePool(grooves=[g0])

    t0 = StubTrack(tid=100, name="t0")
    c0 = GrooveBackedClip(cid=500, name="c0")
    c0._link_groove(g0)                                  # not orphaned
    c1 = GrooveBackedClip(cid=501, name="c1")            # grooveless
    t0.clip_slots = [StubClipSlot(clip=c0), StubClipSlot(clip=c1)]
    song = GrooveStubSong(tracks=[t0], groove_pool=pool)
    song.view._detail_clip = c1
    _pc, gc = _make(song, captured_emits)
    captured_emits.clear()

    gc.handle_set_timing_amount(
        args=("tracks/0/slots/1/clip", 42.0),
        source_addr=None,
    )

    err_emits = [e for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert len(err_emits) == 1
    addr, args = err_emits[0]
    # Originating address + closed-enum code + clipPath + detail.
    assert args[0] == V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS
    assert args[1] == "pool-exhausted"
    assert args[2] == "tracks/0/slots/1/clip"
    # Nothing was persisted onto the lone pool entry.
    assert g0.timing_amount == 50.0  # default seed unchanged


def test_second_write_on_assigned_focused_clip_does_not_reseed_or_reclaim(
    session_with_groove, captured_emits,
):
    """Regression for live-validation Bugs A + B.

    After first-write assigns a groove, subsequent writes to the
    same focused clip must:

      * NOT re-emit ``has_groove=true`` + 5 amount seeds on every
        tick (Bug A — identity check used Python ``is`` against a
        fresh LOM proxy, so it always flagged "new groove").
      * NOT re-enter ``assign_groove_to_clip`` and claim a second
        pool slot (Bug B — ``_groove_id_of`` and ``_groove_matches_id``
        disagreed on 31-bit masking, so the resolve walk never
        found the just-claimed groove).

    Together these produced a "pool drain + UI stomp" storm where
    dragging the shuffle slider emitted a flurry of
    ``quantization_amount=0`` seeds that clobbered the user's Q value
    and drained the pool until ``pool-exhausted`` fired.
    """
    env = session_with_groove
    env["song"].view._detail_clip = env["c1"]            # grooveless
    _pc, gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    # First write: claims g_free, rename + link, emits seeds.
    gc.handle_set_quantization_amount(
        args=("tracks/0/slots/1/clip", 30.0),
        source_addr=None,
    )
    assert env["g_free"].quantization_amount == 30.0
    first_write_emit_count = len(captured_emits)
    assert first_write_emit_count >= 6  # has_groove + 5 amounts
    # After first write the pool is exhausted of unassigned slots
    # (g_free was the only one tagged ``unassigned-*``).
    captured_emits.clear()

    # Capture the identity of the groove claimed on first write.
    claimed_name = env["g_free"].name

    # Second write on the SAME focused clip: must only land on the
    # same groove and must emit NOTHING synchronously (the LOM
    # listener on ``timing_amount`` will fire the one expected
    # property echo, but `_apply_amount_write` itself must not
    # re-seed the bundle).
    gc.handle_set_timing_amount(
        args=("tracks/0/slots/1/clip", 42.0),
        source_addr=None,
    )
    # Same groove — no second claim.
    assert env["g_free"].name == claimed_name
    assert env["g_free"].timing_amount == 42.0

    # No re-seed: no has_groove echo, no 5-bundle re-emit.
    has_groove_reseeds = [
        e for e in captured_emits
        if e[0] == V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS
    ]
    assert has_groove_reseeds == []

    # Only the one listener-driven property emit is allowed through
    # (``timing_amount`` changed → LOM listener fires → single
    # emit). Any extra /property emits would indicate the re-seed
    # bundle came through.
    prop_emits = _prop_emits(captured_emits)
    assert len(prop_emits) == 1
    assert prop_emits[0][1][1] == "timing_amount"
    assert prop_emits[0][1][2] == 42.0


# --- emit_on_accept -------------------------------------------------------


def test_emit_on_accept_with_focus_reemits_has_and_amounts(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    captured_emits.clear()

    gc.emit_on_accept()

    assert (V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
            ("tracks/0/slots/0/clip", 1)) in captured_emits
    names = {e[1][1] for e in _prop_emits(captured_emits)}
    assert names == set(_AMOUNT_ATTRS)


def test_emit_on_accept_with_no_focus_is_noop(captured_emits):
    song = GrooveStubSong()
    _pc, gc = _make(song, captured_emits)
    captured_emits.clear()

    gc.emit_on_accept()
    assert captured_emits == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_all_and_is_idempotent(
    session_with_groove, captured_emits,
):
    env = session_with_groove
    env["song"].view._detail_clip = env["c0"]
    _pc, gc = _make(env["song"], captured_emits)
    assert env["g0"].listener_count() == 5
    assert env["song"].view.has_listener()

    gc.disconnect()
    assert env["g0"].listener_count() == 0
    assert not env["song"].view.has_listener()
    # Second call is a no-op.
    gc.disconnect()
    assert env["g0"].listener_count() == 0


# --- v3-wrapper groove shape (regression for live-validation bug) --------


def test_v3_wrapper_groove_object_shape_second_write_no_reclaim(
    captured_emits,
):
    """Regression for PR-5e2 live-validation bug.

    On real Live 12 the ``ableton.v3`` wrapper returns ``clip.groove``
    as the Groove OBJECT (with ``_live_ptr``), not the raw
    ``("id", N)`` tuple. The prior ``_groove_id_of`` assumed the
    tuple shape and on the object path blew up trying to take
    ``len()``, returned ``None``, and the assign path re-claimed a
    fresh pool slot on every amount write — draining the pool and
    clobbering the UI with repeated has_groove/amount bundles.

    This test mirrors that wrapper shape with
    ``GrooveObjectBackedClip`` (groove getter returns the object)
    and ``_live_ptr``-carrying grooves.
    """
    g_free = GrooveWithListeners(name="unassigned-1")
    g_other = GrooveWithListeners(name="Swing16")
    # Give both pool grooves stable _live_ptrs so _safe_int_id
    # returns a real identity — matches the v3 wrapper world.
    g_free._live_ptr = 0x1001
    g_other._live_ptr = 0x1002
    pool = StubGroovePool(grooves=[g_free, g_other])

    c1 = GrooveObjectBackedClip(cid=501, name="c1")   # grooveless
    t0 = StubTrack(tid=100, name="t0")
    t0.clip_slots = [StubClipSlot(clip=c1)]
    song = GrooveStubSong(tracks=[t0], groove_pool=pool)
    song.view._detail_clip = c1

    _pc, gc = _make(song, captured_emits)
    captured_emits.clear()

    # First write: grooveless clip claims g_free. After this, the
    # clip's groove property returns the Groove OBJECT, not a tuple.
    gc.handle_set_quantization_amount(
        args=("tracks/0/slots/0/clip", 30.0),
        source_addr=None,
    )
    assert c1._groove is g_free          # linked via object setter
    assert g_free.quantization_amount == 30.0
    claimed_name = g_free.name
    captured_emits.clear()

    # Second write: must resolve via _live_ptr on the Groove object
    # — NOT claim a second pool slot.
    gc.handle_set_timing_amount(
        args=("tracks/0/slots/0/clip", 42.0),
        source_addr=None,
    )
    assert c1._groove is g_free          # same groove, no reclaim
    assert g_free.name == claimed_name
    assert g_free.timing_amount == 42.0

    # No re-seed: no has_groove bundle, only the single listener-
    # driven timing_amount echo.
    has_groove_reseeds = [
        e for e in captured_emits
        if e[0] == V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS
    ]
    assert has_groove_reseeds == []
    prop_emits = _prop_emits(captured_emits)
    assert len(prop_emits) == 1
    assert prop_emits[0][1][1] == "timing_amount"
    assert prop_emits[0][1][2] == 42.0

    # g_other stays pristine — the bug would have renamed it too.
    assert g_other.name == "Swing16"


# --- a groove that is someone else's (2026-09-29) --------------------------


def _two_clips_on(groove, g_free):
    c0 = GrooveBackedClip(cid=500, name="c0")
    c1 = GrooveBackedClip(cid=501, name="c1")
    c0._link_groove(groove)
    c1._link_groove(groove)
    t0 = StubTrack(tid=100, name="t0")
    t0.clip_slots = [StubClipSlot(clip=c0), StubClipSlot(clip=c1)]
    pool = StubGroovePool(grooves=[groove, g_free])
    return GrooveStubSong(tracks=[t0], groove_pool=pool), c0, c1


def test_write_on_a_shared_default_groove_claims_one_of_its_own(captured_emits):
    """Live 12.1 puts its default groove on every new MIDI clip. A write
    must move only the clip it names: that clip takes a free groove,
    starting from the shared one's settings, and the shared one keeps
    its own."""
    shared = GrooveWithListeners(
        name="Swing 16ths 66", base=3, timing_amount=100.0,
        quantization_amount=0.0, random_amount=0.0, velocity_amount=0.0,
    )
    g_free = GrooveWithListeners(name="unassigned-1")
    song, c0, c1 = _two_clips_on(shared, g_free)
    song.view._detail_clip = c1
    _pc, gc = _make(song, captured_emits)

    gc.handle_set_quantization_amount(
        args=("tracks/0/slots/1/clip", 30.0), source_addr=None,
    )

    assert shared.quantization_amount == 0.0
    assert shared.name == "Swing 16ths 66"
    assert g_free.name.endswith(" #" + path_hash("tracks/0/slots/1/clip"))
    assert c1.groove == ("id", id(g_free))
    assert c0.groove == ("id", id(shared))
    # Inherited, then the write on top.
    assert (g_free.base, g_free.timing_amount, g_free.quantization_amount) == (3, 100.0, 30.0)


def test_write_on_a_preset_only_this_clip_links_stays_in_place(captured_emits):
    """A preset the user put on one clip keeps its pattern: written in place."""
    preset = GrooveWithListeners(name="MPC 16 Swing-62")
    g_free = GrooveWithListeners(name="unassigned-1")
    c1 = GrooveBackedClip(cid=501, name="c1")
    c1._link_groove(preset)
    t0 = StubTrack(tid=100, name="t0")
    t0.clip_slots = [StubClipSlot(clip=None), StubClipSlot(clip=c1)]
    song = GrooveStubSong(tracks=[t0], groove_pool=StubGroovePool(grooves=[preset, g_free]))
    song.view._detail_clip = c1
    _pc, gc = _make(song, captured_emits)

    gc.handle_set_timing_amount(args=("tracks/0/slots/1/clip", 42.0), source_addr=None)

    assert preset.timing_amount == 42.0
    assert c1.groove == ("id", id(preset))
    assert g_free.name == "unassigned-1"


def test_duplicate_sharing_the_originals_claim_takes_its_own(captured_emits):
    """A duplicated clip links the original's ``Clip_<hash>``; writing the
    copy must not move the original."""
    original = GrooveWithListeners(
        name="Clip_" + path_hash("tracks/0/slots/0/clip"), timing_amount=10.0,
    )
    g_free = GrooveWithListeners(name="unassigned-1")
    song, c0, c1 = _two_clips_on(original, g_free)
    song.view._detail_clip = c1
    _pc, gc = _make(song, captured_emits)

    gc.handle_set_timing_amount(args=("tracks/0/slots/1/clip", 70.0), source_addr=None)

    assert original.timing_amount == 10.0
    assert g_free.timing_amount == 70.0
    assert c1.groove == ("id", id(g_free))

    # The original still writes its own groove in place.
    gc.handle_set_timing_amount(args=("tracks/0/slots/0/clip", 20.0), source_addr=None)
    assert original.timing_amount == 20.0


# --- the groove chooser: set/file + the file echo (2026-09-29) --------------

from components.GrooveComponent import (  # noqa: E402
    V3_CLIP_GROOVE_FILE_ADDRESS,
    V3_CLIP_GROOVE_SET_FILE_ADDRESS,
)


def _file_emits(emits):
    return [e[1] for e in emits if e[0] == V3_CLIP_GROOVE_FILE_ADDRESS]


def _chooser_song(*grooves, linked=None):
    """One track "Bass", clip in slot 1 (scene 2), linking ``linked``."""
    clip = GrooveBackedClip(cid=601, name="c")
    if linked is not None:
        clip._link_groove(linked)
    track = StubTrack(tid=100, name="Bass")
    track.clip_slots = [StubClipSlot(clip=None), StubClipSlot(clip=clip)]
    pool = StubGroovePool(grooves=list(grooves))
    song = GrooveStubSong(tracks=[track], groove_pool=pool)
    song.view._detail_clip = clip
    return song, clip, pool


def _make_minting(song, pool, captured_emits, calls):
    """Pool + GrooveComponent whose minter loads a file as Live does: a new
    entry named after it, Timing 100 and the rest 0."""
    def mint(pattern=None):
        calls.append(pattern)
        if pattern == "Missing":
            return "not-in-browser"
        pool._grooves.append(GrooveWithListeners(
            name=pattern or "Vamp Groove", base=3, timing_amount=100.0 if pattern else 0.0,
        ))
        return None
    emit = lambda addr, args: captured_emits.append((addr, args))
    pool_comp = GroovePoolComponent(song=song, emit=emit, mint=mint)
    return pool_comp, GrooveComponent(song=song, emit=emit, pool=pool_comp)


CLIP = "tracks/0/slots/1/clip"


def test_set_file_on_a_clip_with_no_groove_loads_the_file_and_is_heard(captured_emits):
    song, clip, pool = _chooser_song()
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)
    captured_emits.clear()

    gc.handle_set_file(args=(CLIP, "Swing 16ths 57"), source_addr=None)

    # An empty pool takes the blank first (Auto Load Groove, below).
    assert calls == [None, "Swing 16ths 57"]
    g = pool._grooves[-1]
    assert g.name == "Bass 2 · Swing 16ths 57 #" + path_hash(CLIP)
    assert clip.groove == ("id", id(g))
    assert (g.timing_amount, g.quantization_amount, g.random_amount, g.velocity_amount) == (100.0, 0.0, 0.0, 0.0)
    assert _file_emits(captured_emits)[-1] == (CLIP, "Swing 16ths 57")


def test_set_file_keeps_the_clips_amounts_and_frees_the_groove_it_left(captured_emits):
    own = GrooveWithListeners(
        name="Bass 2 · Swing 8ths 61 #" + path_hash(CLIP),
        quantization_amount=40.0, timing_amount=30.0, random_amount=5.0, velocity_amount=20.0,
    )
    song, clip, pool = _chooser_song(own, linked=own)
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)

    gc.handle_set_file(args=(CLIP, "Swing 16ths 57"), source_addr=None)

    new = pool._grooves[-1]
    assert clip.groove == ("id", id(new))
    assert (new.quantization_amount, new.timing_amount, new.random_amount, new.velocity_amount) == (40.0, 30.0, 5.0, 20.0)
    # The file's own base (its grid) stays.
    assert new.base == 3
    assert own.name == "unassigned-0 · Swing 8ths 61"


def test_set_file_reuses_a_free_groove_of_that_pattern_only(captured_emits):
    other = GrooveWithListeners(name="unassigned-0 · Swing 8ths 61")
    plain = GrooveWithListeners(name="unassigned-1")
    same = GrooveWithListeners(name="unassigned-2 · Swing 16ths 57")
    song, clip, pool = _chooser_song(other, plain, same)
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)

    gc.handle_set_file(args=(CLIP, "Swing 16ths 57"), source_addr=None)

    assert calls == []
    assert clip.groove == ("id", id(same))
    assert other.name == "unassigned-0 · Swing 8ths 61"
    assert plain.name == "unassigned-1"


def test_set_file_to_the_pattern_it_is_on_changes_nothing(captured_emits):
    own = GrooveWithListeners(name="Bass 2 · Swing 16ths 57 #" + path_hash(CLIP), timing_amount=12.0)
    song, clip, pool = _chooser_song(own, linked=own)
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)
    captured_emits.clear()

    gc.handle_set_file(args=(CLIP, "Swing 16ths 57"), source_addr=None)

    assert calls == []
    assert clip.groove == ("id", id(own))
    assert own.timing_amount == 12.0
    assert _file_emits(captured_emits) == [(CLIP, "Swing 16ths 57")]


def test_set_file_leaves_a_shared_groove_alone(captured_emits):
    """Live's default groove on two clips: the tapped one moves, the other
    keeps it, and the shared groove keeps its name."""
    shared = GrooveWithListeners(name="Swing 16ths 66", timing_amount=100.0)
    song, c0, c1 = _two_clips_on(shared, GrooveWithListeners(name="unassigned-9"))
    song.view._detail_clip = c1
    calls = []
    _pc, gc = _make_minting(song, song.groove_pool, captured_emits, calls)

    gc.handle_set_file(args=("tracks/0/slots/1/clip", "Swing 16ths 57"), source_addr=None)

    assert shared.name == "Swing 16ths 66"
    assert c0.groove == ("id", id(shared))
    assert c1.groove != ("id", id(shared))


def test_set_file_that_cannot_load_is_an_error_and_moves_nothing(captured_emits):
    own = GrooveWithListeners(name="Bass 2 · Swing 8ths 61 #" + path_hash(CLIP))
    song, clip, pool = _chooser_song(own, linked=own)
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)
    captured_emits.clear()

    gc.handle_set_file(args=(CLIP, "Missing"), source_addr=None)

    assert clip.groove == ("id", id(own))
    errors = [e[1] for e in captured_emits if e[0] == V3_ERROR_ADDRESS]
    assert errors == [(V3_CLIP_GROOVE_SET_FILE_ADDRESS, "pool-exhausted", CLIP, "No groove file Missing")]


@pytest.mark.parametrize("bad", ["", "  ", "a/b", "x #12345678", "a · b", 5])
def test_set_file_rejects_a_bad_name(captured_emits, bad):
    song, clip, pool = _chooser_song()
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)
    gc.handle_set_file(args=(CLIP, bad), source_addr=None)
    assert calls == [] and clip.groove == ("id", 0)


def test_focus_echoes_the_file_the_groove_holds(captured_emits):
    own = GrooveWithListeners(name="Bass 2 · SP 1200 8ths 71 #" + path_hash(CLIP))
    song, clip, pool = _chooser_song(own, linked=own)
    _pc, gc = _make(song, captured_emits)
    assert _file_emits(captured_emits)[-1] == (CLIP, "SP 1200 8ths 71")

    captured_emits.clear()
    gc.emit_on_accept()
    assert _file_emits(captured_emits) == [(CLIP, "SP 1200 8ths 71")]


def test_focus_echoes_no_file_for_no_groove_or_an_old_claim(captured_emits):
    song, clip, pool = _chooser_song()
    _make(song, captured_emits)
    assert _file_emits(captured_emits)[-1] == (CLIP, "")

    captured_emits.clear()
    old = GrooveWithListeners(name="Clip_" + path_hash(CLIP))
    song, clip, pool = _chooser_song(old, linked=old)
    _make(song, captured_emits)
    assert _file_emits(captured_emits)[-1] == (CLIP, "")


def test_leaving_a_shared_core_groove_keeps_its_pattern(captured_emits):
    """A Q write on a clip sharing Live's default groove claims a groove of
    the same file, so the swing it plays and the lit tile stay."""
    shared = GrooveWithListeners(name="Swing 16ths 66", timing_amount=100.0)
    song, c0, c1 = _two_clips_on(shared, GrooveWithListeners(name="unassigned-9"))
    song.view._detail_clip = c1
    calls = []
    _pc, gc = _make_minting(song, song.groove_pool, captured_emits, calls)

    gc.handle_set_quantization_amount(args=("tracks/0/slots/1/clip", 30.0), source_addr=None)

    assert calls == ["Swing 16ths 66"]
    mine = song.groove_pool._grooves[-1]
    assert mine.name == "t0 2 · Swing 16ths 66 #" + path_hash("tracks/0/slots/1/clip")
    assert mine.quantization_amount == 30.0


def test_set_file_takes_a_user_groove_by_its_prefixed_name(captured_emits):
    """``User: Swing 16`` is the user's own file: the claim and the echo carry
    the prefix, so it never passes for the Core Library's groove of that name."""
    core_free = GrooveWithListeners(name="unassigned-0 · Swing 16")
    song, clip, pool = _chooser_song(core_free)
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)
    captured_emits.clear()

    gc.handle_set_file(args=(CLIP, "User: Swing 16"), source_addr=None)

    assert calls == ["User: Swing 16"]
    g = pool._grooves[-1]
    assert g.name == "Bass 2 · User: Swing 16 #" + path_hash(CLIP)
    assert core_free.name == "unassigned-0 · Swing 16"
    assert _file_emits(captured_emits)[-1] == (CLIP, "User: Swing 16")


# --- Live's Auto Load Groove box (2026-09-29) --------------------------------


def test_the_first_groove_in_an_empty_pool_is_a_blank_one(captured_emits):
    """Live ticks Auto Load Groove on the groove loaded into an empty pool:
    that one is the blank, every amount 0, and the clip's groove goes in
    second."""
    song, clip, pool = _chooser_song()
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)

    gc.handle_set_file(args=(CLIP, "Swing 16ths 57"), source_addr=None)

    assert calls == [None, "Swing 16ths 57"]
    blank, real = pool._grooves
    assert blank.name == BLANK_NAME
    assert (blank.quantization_amount, blank.timing_amount,
            blank.random_amount, blank.velocity_amount) == (0.0, 0.0, 0.0, 0.0)
    assert clip.groove == ("id", id(real))


def test_no_blank_when_the_pool_has_grooves(captured_emits):
    other = GrooveWithListeners(name="unassigned-0 · Swing 8ths 61")
    song, _clip, pool = _chooser_song(other)
    calls = []
    _pc, gc = _make_minting(song, pool, captured_emits, calls)

    gc.handle_set_file(args=(CLIP, "Swing 16ths 57"), source_addr=None)

    assert calls == ["Swing 16ths 57"]
    assert all(g.name != BLANK_NAME for g in pool._grooves)


def test_a_clip_on_the_blank_reads_as_no_groove_and_a_write_leaves_it_alone(captured_emits):
    """Live puts every new clip on the blank. Vamp shows none, and a write
    takes the clip a groove of its own; the blank stays at 0."""
    blank = GrooveWithListeners(
        name=BLANK_NAME, timing_amount=0.0, quantization_amount=0.0,
        random_amount=0.0, velocity_amount=0.0,
    )
    song, clip, pool = _chooser_song(blank, linked=blank)
    _pc, gc = _make_minting(song, pool, captured_emits, [])
    captured_emits.clear()

    gc.handle_set_timing_amount(args=(CLIP, 40.0), source_addr=None)

    assert blank.timing_amount == 0.0
    assert blank.name == BLANK_NAME
    own = pool._grooves[-1]
    assert own is not blank
    assert clip.groove == ("id", id(own))
    assert own.timing_amount == 40.0
