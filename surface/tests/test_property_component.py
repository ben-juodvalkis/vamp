"""PropertyComponent tests — PR-3.5.7 (v3 property channel).

Covers:

- ``handle_subscribe``: happy path attaches listener + emits cold-read,
  idempotent re-subscribe, unknown ``(class, prop)`` rejects with
  ``property-not-allowed``, missing container subscribes without
  listener and emits cold-read of ``None``, listener fire emits
  ``property/value`` with the captured ``(devicePath, name)``.
- ``handle_unsubscribe``: detaches listener, idempotent for unknown
  pairs, no-op when container vanished between attach and detach.
- ``handle_set``: writes through to LOM, generation-stale rejection,
  read-only rejection (``sample.length``), unknown allowlist
  rejection, bool-coerce for ``sample.warping`` (int 0/1 on the wire,
  Python bool on the LOM), surface-misconfigured rejection when
  generation isn't wired, LOM-rejection passthrough.
- ``on_structural_invalidate``: tears down dead-path subscriptions,
  preserves live-path ones.
- ``disconnect``: detaches all listeners, flips _disconnected so late
  fires are no-ops.

Stub LOM is the same family as test_devices_component_v3 — Simpler
and Drift devices stand in for real Live devices.
"""

from __future__ import annotations

from typing import List

import pytest

import json
import re

from components.PropertyComponent import (
    ALLOWLIST,
    PropertyComponent,
    PropertySpec,
    V3_ERROR_ADDRESS,
    V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED,
    V3_ERROR_DETAIL_PROPERTY_READ_ONLY,
    V3_ERROR_GENERATION_STALE,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_WRITE_REJECTED,
    V3_PROPERTY_SET_ADDRESS,
    V3_PROPERTY_SUBSCRIBE_ADDRESS,
    V3_PROPERTY_UNSUBSCRIBE_ADDRESS,
    V3_PROPERTY_VALUE_ADDRESS,
    _STRUCTURAL_PASS_DELAY_MS,
    _jsonable,
    _resolve_proxy_from_dict,
)
from components.GenerationComponent import GenerationComponent
from tests.test_lom_listeners import StubSong, StubTrack


# --- stub Simpler/Drift devices -------------------------------------------


_LISTENER_METHOD = re.compile(r"(add|remove)_(\w+)_listener")


class _PerAttrListeners:
    """Live's property-listener API, as measured on the rig (2026-09-27).

    Every observable LOM property has its own
    ``add_<attr>_listener`` / ``remove_<attr>_listener`` pair; there is no
    generic ``add_value_listener`` on a device or on ``Sample`` (only
    ``DeviceParameter`` has one, because its property is ``value``), and
    an unobservable property (``Sample.length``) has no pair at all.
    Subclasses name what is observable via ``_observable_attrs``.

    ``_listeners`` is every attached callback, ``_listener`` the only one
    (``None`` for zero or several), ``fire(attr)`` invokes one property's
    callbacks and ``fire()`` all of them.
    """

    _observable: tuple = ()

    def _observable_attrs(self):
        return self._observable

    def _slots(self) -> dict:
        slots = self.__dict__.get("_attr_listeners")
        if slots is None:
            slots = {}
            object.__setattr__(self, "_attr_listeners", slots)
        return slots

    def __getattr__(self, name):
        m = None if name.startswith("_") else _LISTENER_METHOD.fullmatch(name)
        if m is None or m.group(2) not in self._observable_attrs():
            raise AttributeError(name)
        verb, attr = m.group(1), m.group(2)
        slot = self._slots().setdefault(attr, [])

        def add(cb):
            # A second registration of the same cb is a no-op;
            # different cbs stack.
            if cb not in slot:
                slot.append(cb)

        def remove(cb):
            # Live raises on a stray detach; the stub asserts so tests
            # catch one.
            assert cb in slot, "remove of unattached %s cb" % attr
            slot.remove(cb)

        return add if verb == "add" else remove

    @property
    def _listeners(self) -> list:
        return [cb for slot in self._slots().values() for cb in slot]

    @property
    def _listener(self):
        cbs = self._listeners
        return cbs[0] if len(cbs) == 1 else None

    def listeners_for(self, attr: str) -> list:
        return list(self._slots().get(attr, ()))

    def fire(self, attr: str | None = None) -> None:
        # Snapshot first — a callback could mutate the listener list
        # (subscribe/unsubscribe in response to a fire).
        cbs = self._listeners if attr is None else self.listeners_for(attr)
        for cb in list(cbs):
            cb()


class StubLOMContainer(_PerAttrListeners):
    """Stand-in for ``device.sample`` — owns attrs and per-attr listeners.

    Every attr is observable except ``length``, which Live's ``Sample``
    has no listener for.
    """

    def __init__(self, **attrs):
        object.__setattr__(self, "_attrs", dict(attrs))

    def _observable_attrs(self):
        return set(self._attrs) - {"length"}

    def __getattr__(self, name):
        if not name.startswith("_") and name in self.__dict__.get("_attrs", {}):
            return self._attrs[name]
        return super().__getattr__(name)

    def __setattr__(self, name, value):
        self._attrs[name] = value


class _StubDevice(_PerAttrListeners):
    """A device whose direct properties are observed per attr.

    ``_device_listener`` is the one callback attached on the device
    itself (``None`` when none is).
    """

    @property
    def _device_listener(self):
        return self._listener


class StubSimpler(_StubDevice):
    """Simpler device with a ``sample`` sub-container + ``playback_mode``.

    ``class_name == "OriginalSimpler"`` is the allowlist key; the listener
    attaches on ``device`` for ``playback_mode`` and on ``device.sample``
    for the sample.* family.
    """

    _observable = ("playback_mode",)

    def __init__(
        self,
        playback_mode: int = 0,
        sample_kwargs: dict | None = None,
        sample: StubLOMContainer | None = None,
        class_name: str = "OriginalSimpler",
    ):
        self.class_name = class_name
        self._playback_mode = int(playback_mode)
        # Container-replaced listener (matches real Live's
        # ``add_sample_listener`` on Simpler — fires when ``self.sample``
        # is reassigned wholesale, e.g. on sample swap).
        self._sample_listener = None
        self.sample = (
            sample if sample is not None
            else StubLOMContainer(
                **(sample_kwargs or {
                    "warp_mode": 0, "warping": False,
                    "slicing_sensitivity": 0.5, "gain": 0.0,
                    "start_marker": 0.0, "end_marker": 1.0, "length": 100.0,
                })
            )
        )
        # Required by path_resolver; in real LOM these come from track.
        self.parameters = []

    def replace_sample(self, new_sample: StubLOMContainer) -> None:
        """Test helper: simulate Live's wholesale container replacement.

        Detaches the orphaned per-attr listener (Live silently does
        nothing — we mimic by clearing the slot), assigns the new
        container, and fires the device-level ``sample`` listener so
        PropertyComponent's safety net runs its rebind path.
        """
        # The old per-attr listener slot is now stranded; simulate that
        # by leaving the attached cb alone (real Live doesn't detach).
        # The rebind path forgets the old cb rather than detaching it
        # from the *new* container, which never had it.
        self.sample = new_sample
        if self._sample_listener is not None:
            self._sample_listener()

    def add_sample_listener(self, cb):
        assert self._sample_listener is None, (
            "device supports one sample listener"
        )
        self._sample_listener = cb

    def remove_sample_listener(self, cb):
        assert self._sample_listener is cb
        self._sample_listener = None

    @property
    def playback_mode(self):
        return self._playback_mode

    @playback_mode.setter
    def playback_mode(self, value):
        self._playback_mode = value
        self.fire("playback_mode")



class StubDrift(_StubDevice):
    """Drift device with ``voice_mode_index`` direct attribute."""

    _observable = ("voice_mode_index",)

    def __init__(self, voice_mode_index: int = 0, class_name: str = "Drift"):
        self.class_name = class_name
        self._voice_mode_index = int(voice_mode_index)
        self.parameters = []

    @property
    def voice_mode_index(self):
        return self._voice_mode_index

    @voice_mode_index.setter
    def voice_mode_index(self, value):
        self._voice_mode_index = int(value)
        self.fire("voice_mode_index")



class StubReadOnlySimpler(StubSimpler):
    """Simpler whose ``sample.length`` write raises — defensive RO guard.

    Tests the "LOM rejected even though our allowlist marks it
    writable" path. In production the allowlist marks length read-only
    so this is belt-and-braces.
    """


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits():
    return []


@pytest.fixture
def generation():
    return GenerationComponent()


@pytest.fixture
def song_with_simpler_and_drift():
    """Two regular tracks, one Simpler and one Drift in slot 0."""
    simpler = StubSimpler(playback_mode=1)
    drift = StubDrift(voice_mode_index=2)
    t0 = StubTrack(tid=100, devices=[simpler])
    t1 = StubTrack(tid=101, devices=[drift])
    song = StubSong(tracks=[t0, t1])
    return song, simpler, drift


@pytest.fixture
def component(song_with_simpler_and_drift, emits, generation):
    song, _s, _d = song_with_simpler_and_drift
    comp = PropertyComponent(
        song=song,
        emit=lambda a, args: emits.append((a, args)),
    )
    comp.set_generation(generation)
    return comp


# --- handle_subscribe -----------------------------------------------------


def test_subscribe_attaches_and_cold_reads(component, song_with_simpler_and_drift, emits):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"),
        source_addr=None,
    )
    # Cold-read echo lands.
    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "playback_mode", 1),
    ) in emits
    # Listener attached on the device (playback_mode listener_path == "").
    assert simpler._device_listener is not None


def test_subscribe_sample_uses_container_listener(
    component, song_with_simpler_and_drift, emits,
):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"),
        source_addr=None,
    )
    # Container listener attached, not device listener.
    assert simpler.sample._listener is not None
    assert simpler._device_listener is None
    # Cold-read carries int 0 (False → 0 via bool coerce).
    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "sample.warping", 0),
    ) in emits


def test_subscribe_idempotent(component, song_with_simpler_and_drift, emits):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    first_listener = simpler._device_listener
    emits.clear()
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    # Same listener (no second attach).
    assert simpler._device_listener is first_listener
    # Cold-read still fires (so a UI second-reader gets a value).
    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "playback_mode", 1),
    ) in emits


def test_subscribe_unknown_pair_rejects_property_not_allowed(component, emits):
    component.handle_subscribe(
        args=("tracks/0/devices/0", "is_active"),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[0] == V3_PROPERTY_SUBSCRIBE_ADDRESS
        and args[1] == V3_ERROR_WRITE_REJECTED
        and args[4] == V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED
        for (a, args) in emits
    )


def test_subscribe_path_not_found(component, emits):
    component.handle_subscribe(
        args=("tracks/9/devices/0", "playback_mode"),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[0] == V3_PROPERTY_SUBSCRIBE_ADDRESS
        and args[1] == V3_ERROR_PATH_NOT_FOUND
        for (a, args) in emits
    )


def test_subscribe_with_no_sample_emits_none_cold_read(component, song_with_simpler_and_drift, emits):
    _song, simpler, _drift = song_with_simpler_and_drift
    simpler.sample = None
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"),
        source_addr=None,
    )
    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "sample.warping", None),
    ) in emits


# --- listener fire emits the canonical-path-captured pair ----------------


def test_fire_emits_property_value(component, song_with_simpler_and_drift, emits):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warp_mode"), source_addr=None,
    )
    emits.clear()
    simpler.sample.warp_mode = 3
    simpler.sample.fire()
    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "sample.warp_mode", 3),
    ) in emits


def test_fire_for_warping_coerces_bool_to_int(component, song_with_simpler_and_drift, emits):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"), source_addr=None,
    )
    emits.clear()
    simpler.sample.warping = True
    simpler.sample.fire()
    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "sample.warping", 1),
    ) in emits


# --- handle_unsubscribe ---------------------------------------------------


def test_unsubscribe_detaches(component, song_with_simpler_and_drift, emits):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    assert simpler._device_listener is not None
    component.handle_unsubscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    assert simpler._device_listener is None


def test_unsubscribe_unknown_pair_is_noop(component, emits):
    # No subscription state for this pair — should not raise, no error.
    component.handle_unsubscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    assert all(a != V3_ERROR_ADDRESS for (a, _args) in emits)


# --- handle_set -----------------------------------------------------------


def test_set_writes_through(component, song_with_simpler_and_drift, generation):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_set(
        args=("tracks/0/devices/0", "playback_mode", 2, generation.current),
        source_addr=None,
    )
    assert simpler._playback_mode == 2


def test_set_playback_mode_float_rounds_to_int(
    component, song_with_simpler_and_drift, generation,
):
    """ADR-002 followup-a-fix: wire-side floats round to int for
    integer-typed LOM attributes. The browser/OSC path can deliver
    a typed-int as float (`2.0`); LOM rejects float-where-int-expected.
    """
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_set(
        args=("tracks/0/devices/0", "playback_mode", 2.0, generation.current),
        source_addr=None,
    )
    assert simpler._playback_mode == 2
    assert isinstance(simpler._playback_mode, int)


def test_set_drift_voice_mode_float_rounds_to_int(
    component, song_with_simpler_and_drift, generation,
):
    _song, _s, drift = song_with_simpler_and_drift
    component.handle_set(
        args=("tracks/1/devices/0", "voice_mode_index", 5.0, generation.current),
        source_addr=None,
    )
    assert drift._voice_mode_index == 5
    assert isinstance(drift._voice_mode_index, int)


def test_set_warping_coerces_int_to_bool(component, song_with_simpler_and_drift, generation):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_set(
        args=("tracks/0/devices/0", "sample.warping", 1, generation.current),
        source_addr=None,
    )
    assert simpler.sample.warping is True
    assert isinstance(simpler.sample.warping, bool)


def test_set_drift_voice_mode(component, song_with_simpler_and_drift, generation):
    _song, _s, drift = song_with_simpler_and_drift
    component.handle_set(
        args=("tracks/1/devices/0", "voice_mode_index", 5, generation.current),
        source_addr=None,
    )
    assert drift._voice_mode_index == 5


def test_set_read_only_rejects(component, song_with_simpler_and_drift, emits, generation):
    component.handle_set(
        args=("tracks/0/devices/0", "sample.length", 9.9, generation.current),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[1] == V3_ERROR_WRITE_REJECTED
        and args[4] == V3_ERROR_DETAIL_PROPERTY_READ_ONLY
        for (a, args) in emits
    )


def test_set_generation_stale_rejects(component, song_with_simpler_and_drift, emits, generation):
    generation.advance("test")  # surface gen now > 0
    component.handle_set(
        args=("tracks/0/devices/0", "playback_mode", 2, 0),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[1] == V3_ERROR_GENERATION_STALE
        for (a, args) in emits
    )


def test_set_unknown_pair_rejects(component, emits, generation):
    component.handle_set(
        args=("tracks/0/devices/0", "is_active", 0, generation.current),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[1] == V3_ERROR_WRITE_REJECTED
        and args[4] == V3_ERROR_DETAIL_PROPERTY_NOT_ALLOWED
        for (a, args) in emits
    )


def test_set_misconfigured_when_no_generation(song_with_simpler_and_drift, emits):
    song, *_ = song_with_simpler_and_drift
    comp = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    comp.handle_set(
        args=("tracks/0/devices/0", "playback_mode", 2, 0),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[1] == V3_ERROR_WRITE_REJECTED
        and "misconfigured" in args[4]
        for (a, args) in emits
    )


def test_set_lom_rejection_emits_write_rejected(
    song_with_simpler_and_drift, emits, generation,
):
    """Defensive RO guard: even if allowlist permits, LOM raise → write-rejected."""

    class RaisingContainer(StubLOMContainer):
        def __setattr__(self, name, value):
            if name == "warp_mode" and isinstance(value, int):
                raise RuntimeError("LOM rejected: out of enum range")
            super().__setattr__(name, value)

    raising = RaisingContainer(warp_mode=0)
    raising_simpler = StubSimpler(sample=raising)
    song, _s, drift = song_with_simpler_and_drift
    song._tracks[0]._devices[0] = raising_simpler  # type: ignore[attr-defined]

    comp = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    comp.set_generation(generation)
    comp.handle_set(
        args=("tracks/0/devices/0", "sample.warp_mode", 99, generation.current),
        source_addr=None,
    )
    assert any(
        a == V3_ERROR_ADDRESS
        and args[1] == V3_ERROR_WRITE_REJECTED
        and "lom rejected" in args[4]
        for (a, args) in emits
    )


# --- on_structural_invalidate ---------------------------------------------


def test_structural_invalidate_tears_down_dead_path(
    component, song_with_simpler_and_drift,
):
    song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    assert simpler._device_listener is not None
    # The device is gone — the path resolves to nothing at all.
    song._tracks[0].set_devices([])

    component.on_structural_invalidate()

    # Old subscription torn down.
    assert ("tracks/0/devices/0", "playback_mode") not in component._subscriptions
    # Old listener detached on the previous device.
    assert simpler._device_listener is None


def test_structural_invalidate_rebinds_a_replaced_device(
    component, song_with_simpler_and_drift, emits,
):
    """A preset load in replace-instrument mode leaves a *different*
    device at the same path.

    The subscription has to follow it. Tearing it down here instead
    stranded the UI: its path string never changed, so its subscription
    ``$effect`` never re-ran and it never re-subscribed, while a
    ``state/invalidate`` carries no paths to tell it otherwise — the
    surface's half gone, the UI's half held, the old device's values on
    screen for good.
    """
    song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    assert simpler._device_listener is not None
    new_simpler = StubSimpler(playback_mode=7)
    song._tracks[0].set_devices([new_simpler])
    emits.clear()

    component.on_structural_invalidate()

    key = ("tracks/0/devices/0", "playback_mode")
    assert key in component._subscriptions
    # Bound to the newcomer, listening on it, off the one it replaced.
    assert component._subscriptions[key][0] is new_simpler
    assert new_simpler._device_listener is not None
    assert simpler._device_listener is None
    # And the UI is told the new value rather than left on the old one.
    assert (
        V3_PROPERTY_VALUE_ADDRESS, ("tracks/0/devices/0", "playback_mode", 7),
    ) in emits


def test_structural_invalidate_moves_the_container_net_to_the_newcomer(
    component, song_with_simpler_and_drift, emits,
):
    """The container-replaced safety net is keyed by path and holds the
    device, so a rebind has to move it too — left on the replaced device
    it would never fire again, and ``_ensure_container_listener`` would
    skip its own key as already-installed."""
    song, simpler, _drift = song_with_simpler_and_drift
    for name in ("sample.warping", "sample.gain"):
        component.handle_subscribe(
            args=("tracks/0/devices/0", name), source_addr=None,
        )
    assert simpler._sample_listener is not None
    new_simpler = StubSimpler(
        sample_kwargs={
            "warp_mode": 0, "warping": True,
            "slicing_sensitivity": 0.5, "gain": 3.0,
            "start_marker": 0.0, "end_marker": 1.0, "length": 100.0,
        },
    )
    song._tracks[0].set_devices([new_simpler])
    emits.clear()

    component.on_structural_invalidate()

    assert new_simpler._sample_listener is not None
    assert simpler._sample_listener is None
    # Both rows followed the device, and both carry the newcomer's values.
    for name, value in (("sample.warping", 1), ("sample.gain", 3.0)):
        assert ("tracks/0/devices/0", name) in component._subscriptions
        assert (
            V3_PROPERTY_VALUE_ADDRESS, ("tracks/0/devices/0", name, value),
        ) in emits


def test_structural_invalidate_drops_a_row_the_newcomer_does_not_carry(
    component, song_with_simpler_and_drift, emits,
):
    """A Drum Rack replaced by a Wavetable really has no ``vm.members``.
    Here: a Simpler replaced by a Drift, which has no ``playback_mode``.
    That subscription is dead, and the ``None`` clears the stale value
    instead of leaving the old device's on screen."""
    song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    song._tracks[0].set_devices([StubDrift(voice_mode_index=1)])
    emits.clear()

    component.on_structural_invalidate()

    assert ("tracks/0/devices/0", "playback_mode") not in component._subscriptions
    assert simpler._device_listener is None
    assert (
        V3_PROPERTY_VALUE_ADDRESS, ("tracks/0/devices/0", "playback_mode", None),
    ) in emits


def test_structural_pass_waits_out_the_state_full_debounce():
    """The rebind's fresh ``property/value`` must land *after* the
    ``state/full`` carrying the device it belongs to — the UI replaces a
    device record wholesale when its class changes, and a value that
    arrived first would be wiped by it. Pinned so the two constants
    cannot drift apart."""
    from components.V3StateFullComponent import _STATE_FULL_DEBOUNCE_MS

    assert _STRUCTURAL_PASS_DELAY_MS > _STATE_FULL_DEBOUNCE_MS


def test_structural_pass_is_deferred_and_coalesced(
    song_with_simpler_and_drift, emits, generation,
):
    """With a scheduler wired, a burst of structural changes costs one
    re-resolve, and it runs on the scheduler rather than inline."""
    song, simpler, _drift = song_with_simpler_and_drift
    scheduled: list = []
    comp = PropertyComponent(
        song=song,
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)),
    )
    comp.set_generation(generation)
    comp.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    new_simpler = StubSimpler(playback_mode=7)
    song._tracks[0].set_devices([new_simpler])

    comp.on_structural_invalidate()
    comp.on_structural_invalidate()
    comp.on_structural_invalidate()

    # One armed pass, at the delay that clears the state/full debounce,
    # and nothing has moved yet.
    assert [ms for ms, _fn in scheduled] == [_STRUCTURAL_PASS_DELAY_MS]
    assert comp._subscriptions[("tracks/0/devices/0", "playback_mode")][0] is simpler

    scheduled[0][1]()

    assert comp._subscriptions[("tracks/0/devices/0", "playback_mode")][0] is new_simpler
    # And the flag cleared, so the next structural change arms again.
    comp.on_structural_invalidate()
    assert len(scheduled) == 2


def test_structural_invalidate_preserves_live_path(
    component, song_with_simpler_and_drift,
):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    component.on_structural_invalidate()
    # Subscription preserved (same device at same path).
    assert ("tracks/0/devices/0", "playback_mode") in component._subscriptions
    assert simpler._device_listener is not None


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_all_listeners(
    component, song_with_simpler_and_drift, emits,
):
    _song, simpler, drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"), source_addr=None,
    )
    component.handle_subscribe(
        args=("tracks/1/devices/0", "voice_mode_index"), source_addr=None,
    )
    assert simpler.sample._listener is not None
    assert drift._device_listener is not None

    component.disconnect()

    assert simpler.sample._listener is None
    assert drift._device_listener is None
    # Late fires are no-ops post-disconnect.
    emits.clear()
    # Direct ``_safe_emit`` short-circuits on _disconnected.
    component._safe_emit(V3_PROPERTY_VALUE_ADDRESS, ("x", "y", 0))
    assert emits == []


# --- allowlist sanity ------------------------------------------------------


def test_allowlist_contains_documented_simpler_keys():
    """Day-one allowlist matches ADR-002 §Context."""
    expected_simpler_keys = {
        "playback_mode",
        "slicing_playback_mode",
        "sample.warp_mode",
        "sample.warping",
        "sample.slicing_sensitivity",
        "sample.gain",
        "sample.start_marker",
        "sample.end_marker",
        "sample.length",
        "sample.file_path",
        "sample.slices",
    }
    actual = {prop for (cls, prop) in ALLOWLIST if cls == "OriginalSimpler"}
    assert actual == expected_simpler_keys


def test_allowlist_contains_documented_drift_key():
    actual = {prop for (cls, prop) in ALLOWLIST if cls == "Drift"}
    assert actual == {"voice_mode_index"}


def test_allowlist_contains_documented_hybrid_reverb_keys():
    """Followup-a (2026-04-16): 5 scalar properties on Hybrid Reverb."""
    expected = {
        "ir_category_index",
        "ir_file_index",
        "ir_attack_time",
        "ir_decay_time",
        "ir_size_factor",
    }
    actual = {prop for (cls, prop) in ALLOWLIST if cls == "Hybrid"}
    assert actual == expected


def test_hybrid_reverb_props_are_writable_scalar():
    """All 5 ir_* are writable, no bool coercion (no bool-shaped one)."""
    for key in (
        "ir_category_index",
        "ir_file_index",
        "ir_attack_time",
        "ir_decay_time",
        "ir_size_factor",
    ):
        spec = ALLOWLIST[("Hybrid", key)]
        assert spec.writable is True
        assert spec.coerce_bool_to_int is False
        assert spec.listener_path == ""


def test_simpler_keys_use_lom_class_name_not_display_name():
    """ADR-002 followup-a-fix: Live's class_name is ``OriginalSimpler``,
    not the display-name ``Simpler``. The 2026-04-16 Playwright
    validation showed every Simpler subscribe + set rejecting because
    the allowlist was keyed on the display name. Pin the actual
    runtime key so a future rename doesn't silently regress.
    """
    assert ("OriginalSimpler", "playback_mode") in ALLOWLIST
    assert ("Simpler", "playback_mode") not in ALLOWLIST


def test_sample_length_is_read_only():
    assert ALLOWLIST[("OriginalSimpler", "sample.length")].writable is False


def test_sample_file_path_is_read_only():
    spec = ALLOWLIST[("OriginalSimpler", "sample.file_path")]
    assert spec.writable is False
    assert spec.listener_path == "sample"
    assert spec.attr_name == "file_path"
    # No coercion — strings ride the wire as-is.
    assert spec.coerce_bool_to_int is False
    assert spec.coerce_to_int is False
    assert spec.coerce_dict_to_json is False


def test_warping_coerces_bool_to_int():
    assert ALLOWLIST[("OriginalSimpler", "sample.warping")].coerce_bool_to_int is True


# --- container-replaced (Simpler.sample swap) safety net -----------------


def test_subscribe_installs_sample_container_listener(
    component, song_with_simpler_and_drift, emits,
):
    """Subscribing to a sample.* property attaches a device-level
    `add_sample_listener` so a wholesale ``device.sample`` swap can
    re-bind the per-attr listeners.
    """
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    assert simpler._sample_listener is not None


def test_playback_mode_does_not_install_sample_listener(
    component, song_with_simpler_and_drift,
):
    """Properties whose listener_path is empty (direct device attrs)
    don't need the container-replaced safety net.
    """
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"),
        source_addr=None,
    )
    assert simpler._sample_listener is None


def test_sample_swap_rebinds_listeners_and_emits_fresh_values(
    component, song_with_simpler_and_drift, emits,
):
    """Live's wholesale ``device.sample`` replacement on sample swap
    leaves the per-attr listener stranded on the dead container. The
    container-replaced safety net must re-walk + re-attach against the
    new container and emit fresh ``property/value`` for every affected
    subscription.
    """
    _song, simpler, _drift = song_with_simpler_and_drift
    # Subscribe to two sample.* properties so we can verify both rebind.
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"),
        source_addr=None,
    )
    old_sample = simpler.sample
    # ``warping`` has its own listener; ``length`` has none in Live, so
    # the swap's re-read is the only way a new length reaches the UI.
    assert len(old_sample.listeners_for("warping")) == 1
    assert old_sample.listeners_for("length") == []

    # Simulate a sample swap: Live replaces ``device.sample`` wholesale.
    new_sample = StubLOMContainer(
        warp_mode=4, warping=True,
        slicing_sensitivity=0.7, gain=0.3,
        start_marker=10.0, end_marker=200.0, length=300.0,
    )
    emits.clear()
    simpler.replace_sample(new_sample)

    # The per-attr listener is re-attached on the *new* container.
    assert len(new_sample.listeners_for("warping")) == 1
    assert len(new_sample._listeners) == 1

    # Fresh values emitted for both subscribed sample.* properties.
    emitted_values = {
        (args[1], args[2])  # (property_name, value)
        for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    }
    assert ("sample.length", 300.0) in emitted_values
    # ``sample.warping`` is bool-coerced to int (1 → True).
    assert ("sample.warping", 1) in emitted_values


def test_sample_swap_to_none_emits_none_and_keeps_subscriptions(
    component, song_with_simpler_and_drift, emits,
):
    """If the replacement leaves ``device.sample is None`` (preset with
    no sample slot), the rebind path emits ``None`` for each affected
    subscription and marks the listener noop. The subscription stays so
    the next swap to a real container re-attaches.
    """
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    emits.clear()
    # Replace with None — listener still fires (sample listener captures
    # any container change including to None in real Live; we mimic).
    simpler.sample = None
    if simpler._sample_listener is not None:
        simpler._sample_listener()

    assert (
        V3_PROPERTY_VALUE_ADDRESS,
        ("tracks/0/devices/0", "sample.length", None),
    ) in emits
    # Subscription kept (key still in component._subscriptions).
    assert ("tracks/0/devices/0", "sample.length") in component._subscriptions


def test_unsubscribe_drops_container_listener_when_last_consumer(
    component, song_with_simpler_and_drift,
):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    assert simpler._sample_listener is not None

    component.handle_unsubscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    # Last sample.* consumer gone → container listener detached.
    assert simpler._sample_listener is None


def test_unsubscribe_keeps_container_listener_while_other_consumer_present(
    component, song_with_simpler_and_drift,
):
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"),
        source_addr=None,
    )
    assert simpler._sample_listener is not None

    component.handle_unsubscribe(
        args=("tracks/0/devices/0", "sample.length"),
        source_addr=None,
    )
    # Other sample.* sub still active → container listener stays.
    assert simpler._sample_listener is not None


def test_two_sample_props_same_container_fire_independently(
    component, song_with_simpler_and_drift, emits,
):
    """Two sample.* properties on the same ``device.sample`` each attach
    to their own per-attr listener, and a change to one emits that
    property alone — Live fires ``gain``'s listener, not ``warping``'s.
    """
    _song, simpler, _drift = song_with_simpler_and_drift
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.gain"),
        source_addr=None,
    )
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.warping"),
        source_addr=None,
    )
    assert len(simpler.sample.listeners_for("gain")) == 1
    assert len(simpler.sample.listeners_for("warping")) == 1

    emits.clear()
    simpler.sample.gain = 0.5
    simpler.sample.fire("gain")

    addrs = [args for (addr, args) in emits if addr == V3_PROPERTY_VALUE_ADDRESS]
    assert addrs == [("tracks/0/devices/0", "sample.gain", 0.5)]


# --- PR-3.5.7-impl-followup-b: dict-shaped property transport ----------

class _StubRoutingProxy:
    """Attribute-shaped stand-in for a Live ``Track.RoutingType`` proxy.

    Real LOM exposes routing entries as proxy objects with
    ``identifier`` and ``display_name`` attributes (not dicts). Tests
    use this class directly so ``_resolve_proxy_from_dict`` sees the
    same ``getattr`` surface it sees in Live.
    """

    def __init__(self, identifier, display_name):
        self.identifier = identifier
        self.display_name = display_name

    def __eq__(self, other):
        if isinstance(other, _StubRoutingProxy):
            return (
                self.identifier == other.identifier
                and self.display_name == other.display_name
            )
        return NotImplemented

    def __repr__(self):
        return "_StubRoutingProxy(%r, %r)" % (self.identifier, self.display_name)


class StubCompressor(_StubDevice):
    """Compressor device with dict-valued routing properties.

    Mirrors Live 12's Compressor2 LOM: ``available_input_routing_types``
    is a read-only *list of proxy objects* (``Track.RoutingType``);
    ``input_routing_type`` is the currently-selected proxy. Both fire
    a value listener on the device itself (listener_path="").

    A setter on ``input_routing_type`` simulates Live's behaviour:
    Live rejects plain dicts (the attribute is typed as a proxy), so
    the setter validates and raises ``RuntimeError`` on non-proxy
    assignments. ``_resolve_proxy_from_dict`` in PropertyComponent
    does the dict→proxy lookup before the setattr.
    """

    _observable = ("available_input_routing_types", "input_routing_type")

    def __init__(
        self,
        available=None,
        current=None,
        class_name: str = "Compressor2",
    ):
        self.class_name = class_name
        self._available = available or [
            _StubRoutingProxy(0, "Ext. In"),
            _StubRoutingProxy(1, "1-MIDI"),
        ]
        self._current = (
            current if current is not None else _StubRoutingProxy(0, "Ext. In")
        )
        self.parameters = []

    @property
    def available_input_routing_types(self):
        return list(self._available)

    @property
    def input_routing_type(self):
        return self._current

    @input_routing_type.setter
    def input_routing_type(self, value):
        # Live 12 LOM only accepts proxy objects here — a dict write
        # silently no-ops in the real LOM, but we raise to catch
        # any regression where PropertyComponent hands setattr a dict.
        if not isinstance(value, _StubRoutingProxy):
            raise RuntimeError(
                "input_routing_type requires a RoutingType proxy, got %r"
                % (value,)
            )
        self._current = value
        self.fire("input_routing_type")



@pytest.fixture
def song_with_compressor():
    compressor = StubCompressor()
    t0 = StubTrack(tid=200, devices=[compressor])
    song = StubSong(tracks=[t0])
    return song, compressor


@pytest.fixture
def compressor_component(song_with_compressor, emits, generation):
    song, _c = song_with_compressor
    comp = PropertyComponent(
        song=song,
        emit=lambda a, args: emits.append((a, args)),
    )
    comp.set_generation(generation)
    return comp


def test_compressor_dict_props_in_allowlist():
    """Both routing entries present, flag set, exclusivity holds."""
    avail = ALLOWLIST[("Compressor2", "available_input_routing_types")]
    assert avail.coerce_dict_to_json is True
    assert avail.writable is False  # read-only per LOM
    assert avail.coerce_bool_to_int is False
    assert avail.coerce_to_int is False

    current = ALLOWLIST[("Compressor2", "input_routing_type")]
    assert current.coerce_dict_to_json is True
    assert current.writable is True
    assert current.coerce_bool_to_int is False
    assert current.coerce_to_int is False


def test_property_spec_rejects_dict_plus_scalar_coercion():
    """The amendment's mutual-exclusion guard fires at construct time."""
    with pytest.raises(ValueError, match="mutually exclusive"):
        PropertySpec(
            listener_path="", attr_name="x", writable=True,
            coerce_dict_to_json=True, coerce_to_int=True,
        )
    with pytest.raises(ValueError, match="mutually exclusive"):
        PropertySpec(
            listener_path="", attr_name="x", writable=True,
            coerce_dict_to_json=True, coerce_bool_to_int=True,
        )


def test_subscribe_dict_prop_emits_json_string(
    compressor_component, song_with_compressor, emits,
):
    """Cold-read of a dict-shaped property lands as a JSON string."""
    component = compressor_component
    _song, compressor = song_with_compressor
    component.handle_subscribe(
        args=("tracks/0/devices/0", "input_routing_type"),
        source_addr=None,
    )
    # Listener attached on the device (listener_path="").
    assert compressor._device_listener is not None
    # Cold-read emits — value is a JSON string that round-trips.
    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(value_emits) == 1
    device_path, prop_name, raw = value_emits[0]
    assert device_path == "tracks/0/devices/0"
    assert prop_name == "input_routing_type"
    assert isinstance(raw, str)
    assert json.loads(raw) == {"identifier": 0, "display_name": "Ext. In"}


def test_subscribe_available_types_read_only_still_cold_reads(
    compressor_component, emits,
):
    """``available_input_routing_types`` is RO but still subscribable."""
    compressor_component.handle_subscribe(
        args=("tracks/0/devices/0", "available_input_routing_types"),
        source_addr=None,
    )
    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(value_emits) == 1
    _dp, _pn, raw = value_emits[0]
    payload = json.loads(raw)
    # Live 12 returns a bare list of RoutingType proxies; _jsonable
    # serializes each proxy to its {identifier, display_name} dict.
    assert payload == [
        {"identifier": 0, "display_name": "Ext. In"},
        {"identifier": 1, "display_name": "1-MIDI"},
    ]


def test_set_dict_prop_decodes_json_and_writes_lom(
    compressor_component, song_with_compressor, emits, generation,
):
    """``/property/set`` of a JSON string resolves to a RoutingType proxy.

    The wire carries a plain dict ``{identifier, display_name}``;
    ``_resolve_proxy_from_dict`` walks ``available_input_routing_types``
    and picks the matching proxy by ``identifier`` before setattr.
    Live's LOM rejects dict-typed writes for proxy attributes — this
    test pins that the resolver happens before the write.
    """
    _song, compressor = song_with_compressor
    wire_value = json.dumps({"identifier": 1, "display_name": "1-MIDI"})
    compressor_component.handle_set(
        args=(
            "tracks/0/devices/0",
            "input_routing_type",
            wire_value,
            generation.current,
        ),
        source_addr=None,
    )
    # LOM received a proxy with matching fields, not the bare dict.
    assert isinstance(compressor._current, _StubRoutingProxy)
    assert compressor._current.identifier == 1
    assert compressor._current.display_name == "1-MIDI"


def test_set_dict_prop_bad_json_rejects(
    compressor_component, emits, generation,
):
    """Malformed JSON on a dict-flagged property → write-rejected."""
    compressor_component.handle_set(
        args=(
            "tracks/0/devices/0",
            "input_routing_type",
            "{not: valid json}",
            generation.current,
        ),
        source_addr=None,
    )
    errors = [
        args for (addr, args) in emits if addr == V3_ERROR_ADDRESS
    ]
    assert len(errors) == 1
    err = errors[0]
    assert err[0] == V3_PROPERTY_SET_ADDRESS
    assert err[1] == V3_ERROR_WRITE_REJECTED
    assert "bad json value" in err[4]


def test_set_available_types_read_only_rejects(
    compressor_component, emits, generation,
):
    """RO dict prop rejects with ``property-read-only``, same as sample.length."""
    compressor_component.handle_set(
        args=(
            "tracks/0/devices/0",
            "available_input_routing_types",
            "[]",
            generation.current,
        ),
        source_addr=None,
    )
    errors = [
        args for (addr, args) in emits if addr == V3_ERROR_ADDRESS
    ]
    assert any(
        e[1] == V3_ERROR_WRITE_REJECTED
        and e[4] == V3_ERROR_DETAIL_PROPERTY_READ_ONLY
        for e in errors
    )


def test_set_dict_prop_unknown_identifier_rejects(
    compressor_component, song_with_compressor, emits, generation,
):
    """A decoded dict whose identifier isn't in the vector → write-rejected."""
    _song, compressor = song_with_compressor
    # Identifier 99 doesn't exist in the stub's available list.
    wire_value = json.dumps({"identifier": 99, "display_name": "Nope"})
    compressor_component.handle_set(
        args=(
            "tracks/0/devices/0",
            "input_routing_type",
            wire_value,
            generation.current,
        ),
        source_addr=None,
    )
    errors = [
        args for (addr, args) in emits if addr == V3_ERROR_ADDRESS
    ]
    assert len(errors) == 1
    err = errors[0]
    assert err[0] == V3_PROPERTY_SET_ADDRESS
    assert err[1] == V3_ERROR_WRITE_REJECTED
    assert "no matching proxy" in err[4]
    # LOM state unchanged — identifier still 0 (Ext. In).
    assert compressor._current.identifier == 0


def test_set_dict_prop_matches_by_display_name_fallback(
    compressor_component, song_with_compressor, emits, generation,
):
    """Missing identifier → fallback to display_name match."""
    _song, compressor = song_with_compressor
    wire_value = json.dumps({"display_name": "1-MIDI"})
    compressor_component.handle_set(
        args=(
            "tracks/0/devices/0",
            "input_routing_type",
            wire_value,
            generation.current,
        ),
        source_addr=None,
    )
    assert isinstance(compressor._current, _StubRoutingProxy)
    assert compressor._current.identifier == 1


def test_resolve_proxy_from_dict_picks_by_identifier():
    """Unit test the resolver in isolation — identifier wins."""
    class _Target:
        available = [
            _StubRoutingProxy(0, "Ext. In"),
            _StubRoutingProxy(1, "1-MIDI"),
        ]

    proxy = _resolve_proxy_from_dict(
        _Target(), "available",
        {"identifier": 1, "display_name": "WRONG"},
    )
    assert isinstance(proxy, _StubRoutingProxy)
    assert proxy.identifier == 1


def test_resolve_proxy_from_dict_falls_back_to_display_name():
    """Identifier missing → display_name match still resolves."""
    class _Target:
        available = [
            _StubRoutingProxy(0, "Ext. In"),
            _StubRoutingProxy(1, "1-MIDI"),
        ]

    proxy = _resolve_proxy_from_dict(
        _Target(), "available", {"display_name": "Ext. In"},
    )
    assert proxy is not None
    assert proxy.identifier == 0


def test_resolve_proxy_from_dict_no_match_returns_none():
    class _Target:
        available = [_StubRoutingProxy(0, "Ext. In")]

    assert _resolve_proxy_from_dict(
        _Target(), "available", {"identifier": 42},
    ) is None


def test_resolve_proxy_from_dict_non_dict_returns_none():
    class _Target:
        available = [_StubRoutingProxy(0, "Ext. In")]

    assert _resolve_proxy_from_dict(_Target(), "available", "nope") is None
    assert _resolve_proxy_from_dict(_Target(), "available", 42) is None


def test_property_spec_rejects_resolve_vector_without_dict_coerce():
    """``resolve_via_vector`` requires ``coerce_dict_to_json`` to be set."""
    with pytest.raises(ValueError, match="resolve_via_vector requires"):
        PropertySpec(
            listener_path="", attr_name="x", writable=True,
            resolve_via_vector="some_vector",
        )


def test_compressor_input_routing_type_spec_has_resolver():
    """Pin the allowlist: the write-side resolver is wired for Compressor2."""
    spec = ALLOWLIST[("Compressor2", "input_routing_type")]
    assert spec.resolve_via_vector == "available_input_routing_types"


def test_dict_prop_fire_emits_json_string(
    compressor_component, song_with_compressor, emits,
):
    """LOM fire after a subscribe → ``property/value`` carries JSON string."""
    _song, compressor = song_with_compressor
    compressor_component.handle_subscribe(
        args=("tracks/0/devices/0", "input_routing_type"),
        source_addr=None,
    )
    emits.clear()
    # Simulate a Live-side selection change — the LOM setter requires
    # a RoutingType proxy (see StubCompressor.input_routing_type.setter);
    # the listener fires synchronously, then the fire callback emits.
    compressor.input_routing_type = _StubRoutingProxy(1, "1-MIDI")
    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(value_emits) == 1
    _dp, _pn, raw = value_emits[0]
    assert json.loads(raw) == {"identifier": 1, "display_name": "1-MIDI"}


# --- _jsonable LOM-proxy coverage (2026-04-21 followup-b-fix) -------------
#
# Live's real ``available_input_routing_types`` returns a
# ``Track.RoutingTypeVector`` of ``Track.RoutingType`` proxies — not a
# Python list of dicts. Both are iterable and expose ``display_name`` +
# ``identifier`` attributes, but ``json.dumps(default=str)`` mis-
# serialized them as ``"<Track.RoutingTypeVector object at 0x...>"``
# repr strings, which ``parsePropertyValue`` couldn't decode. These
# tests pin the proxy-handling path with duck-typed stand-ins.


class _RoutingTypeProxy:
    """Attribute-based stand-in for ``Track.RoutingType``."""

    def __init__(self, identifier, display_name):
        self.identifier = identifier
        self.display_name = display_name


class _RoutingTypeVectorProxy:
    """Iterable stand-in for ``Track.RoutingTypeVector`` — not a list."""

    def __init__(self, items):
        self._items = list(items)

    def __iter__(self):
        return iter(self._items)


def test_jsonable_routing_type_proxy():
    """A ``RoutingType`` proxy → ``{identifier, display_name}`` dict."""
    proxy = _RoutingTypeProxy(identifier=1, display_name="1-MIDI")
    assert _jsonable(proxy) == {"identifier": 1, "display_name": "1-MIDI"}


def test_jsonable_routing_type_vector_proxy():
    """A ``RoutingTypeVector`` proxy → list of proxy dicts."""
    vector = _RoutingTypeVectorProxy([
        _RoutingTypeProxy(0, "Ext. In"),
        _RoutingTypeProxy(1, "1-MIDI"),
    ])
    assert _jsonable(vector) == [
        {"identifier": 0, "display_name": "Ext. In"},
        {"identifier": 1, "display_name": "1-MIDI"},
    ]


def test_jsonable_passes_scalars_and_dicts_through():
    """Primitives and dict-of-primitives round-trip unchanged."""
    assert _jsonable(None) is None
    assert _jsonable(42) == 42
    assert _jsonable(3.14) == 3.14
    assert _jsonable("x") == "x"
    assert _jsonable(True) is True
    assert _jsonable({"a": 1, "b": "two"}) == {"a": 1, "b": "two"}


def test_subscribe_available_types_serializes_lom_proxies(emits, generation):
    """End-to-end: LOM proxies cold-read as a JSON list of dicts.

    This is the bug found in the wild on 2026-04-21 — the previous
    ``json.dumps(default=str)`` emitted a repr string and the UI saw
    "No sidechain sources available" despite a subscribed device.
    """
    class _ProxyCompressor(_StubDevice):
        _observable = ("available_input_routing_types", "input_routing_type")
        class_name = "Compressor2"
        parameters = []

        def __init__(self):
            self._current = _RoutingTypeProxy(0, "Ext. In")
            self._available = _RoutingTypeVectorProxy([
                _RoutingTypeProxy(0, "Ext. In"),
                _RoutingTypeProxy(1, "1-MIDI"),
            ])

        @property
        def available_input_routing_types(self):
            return self._available

        @property
        def input_routing_type(self):
            return self._current


    compressor = _ProxyCompressor()
    song = StubSong(tracks=[StubTrack(tid=201, devices=[compressor])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)

    component.handle_subscribe(
        args=("tracks/0/devices/0", "available_input_routing_types"),
        source_addr=None,
    )
    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(value_emits) == 1
    _dp, _pn, raw = value_emits[0]
    assert isinstance(raw, str)
    assert json.loads(raw) == [
        {"identifier": 0, "display_name": "Ext. In"},
        {"identifier": 1, "display_name": "1-MIDI"},
    ]

    emits.clear()
    component.handle_subscribe(
        args=("tracks/0/devices/0", "input_routing_type"),
        source_addr=None,
    )
    current_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(current_emits) == 1
    _dp, _pn, raw = current_emits[0]
    assert json.loads(raw) == {"identifier": 0, "display_name": "Ext. In"}


# --- Simpler sample.slices (list-of-int → JSON-string lane) --------------
#
# ``Sample.slices`` is read-only on the LOM and exposed as a list of int
# frame positions (Live 11+). The wire reuses the existing
# ``coerce_dict_to_json`` lane so list-of-int rides as a JSON string.
# These tests pin the cold-read serialization shape — the UI side
# (SimplerLoopControl) ``JSON.parse``s the string and renders vertical
# lines on the slicing-mode waveform canvas.


def test_simpler_slices_in_allowlist():
    """Allowlist row pinned: read-only + dict-coerce flag set."""
    spec = ALLOWLIST[("OriginalSimpler", "sample.slices")]
    assert spec.writable is False
    assert spec.coerce_dict_to_json is True
    assert spec.coerce_to_int is False
    assert spec.coerce_bool_to_int is False
    assert spec.listener_path == "sample"
    assert spec.attr_name == "slices"


def test_subscribe_slices_emits_json_list_of_int(emits, generation):
    """Cold-read of ``sample.slices`` lands as a JSON-string list-of-int."""
    sample = StubLOMContainer(slices=[0, 12345, 24690, 37035])
    simpler = StubSimpler(sample=sample)
    song = StubSong(tracks=[StubTrack(tid=300, devices=[simpler])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)

    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.slices"),
        source_addr=None,
    )
    # Listener lands on the sample container, not the device — same
    # shape as sample.warp_mode / sample.start_marker.
    assert sample._listener is not None
    assert simpler._device_listener is None

    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(value_emits) == 1
    device_path, prop_name, raw = value_emits[0]
    assert device_path == "tracks/0/devices/0"
    assert prop_name == "sample.slices"
    assert isinstance(raw, str)
    assert json.loads(raw) == [0, 12345, 24690, 37035]


def test_slices_fire_after_resample_emits_fresh_json(emits, generation):
    """Listener fire after slices recompute → new JSON list on the wire."""
    sample = StubLOMContainer(slices=[0, 1000])
    simpler = StubSimpler(sample=sample)
    song = StubSong(tracks=[StubTrack(tid=301, devices=[simpler])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.slices"),
        source_addr=None,
    )
    emits.clear()
    # Live recomputes slices on sensitivity change / sample swap; mimic
    # by mutating the attr and firing the container listener.
    sample.slices = [0, 500, 1000, 1500]
    sample.fire()

    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    assert len(value_emits) == 1
    _dp, _pn, raw = value_emits[0]
    assert json.loads(raw) == [0, 500, 1000, 1500]


def test_playback_mode_cascade_schedules_deferred_reread(emits, generation):
    """Switching to Slicing mode triggers a deferred slice re-emit so the
    UI catches Live's later-tick compute (the very first switch otherwise
    leaves the canvas blank until the user wiggles SENS).
    """
    sample = StubLOMContainer(slices=[])
    simpler = StubSimpler(playback_mode=0, sample=sample)
    song = StubSong(tracks=[StubTrack(tid=305, devices=[simpler])])
    scheduled: List = []
    component = PropertyComponent(
        song=song,
        emit=lambda a, args: emits.append((a, args)),
        schedule_delayed=lambda delay_ms, fn: scheduled.append((delay_ms, fn)),
    )
    component.set_generation(generation)
    component.handle_set(
        args=(
            "tracks/0/devices/0", "playback_mode",
            2, generation.current,
        ),
        source_addr=None,
    )
    # Immediate cascade emit fires (with empty slices, the pre-compute state).
    immediate_slices = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS and args[1] == "sample.slices"
    ]
    assert len(immediate_slices) == 1
    assert json.loads(immediate_slices[0][2]) == []
    # Deferred re-emit was scheduled at 150ms.
    assert len(scheduled) == 1
    delay, deferred_fn = scheduled[0]
    assert delay == 150
    # Simulate Live having computed slices by the time the deferred tick fires.
    sample.slices = [0, 4500, 9000]
    emits.clear()
    deferred_fn()
    deferred_slices = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS and args[1] == "sample.slices"
    ]
    assert len(deferred_slices) == 1
    assert json.loads(deferred_slices[0][2]) == [0, 4500, 9000]


def test_slicing_sensitivity_cascades_to_slices_on_fire(emits, generation):
    """Live's slices listener doesn't fire on sensitivity change — the
    cascade re-emits ``sample.slices`` whenever ``slicing_sensitivity``'s
    listener fires. Without this, the UI never sees the new slice list.
    """
    sample = StubLOMContainer(
        slicing_sensitivity=0.5, slices=[0, 1000, 2000],
    )
    simpler = StubSimpler(sample=sample)
    song = StubSong(tracks=[StubTrack(tid=303, devices=[simpler])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    # Subscribe sensitivity (slices subscription is independent — the
    # cascade should still fire for it even if the UI hasn't subscribed).
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.slicing_sensitivity"),
        source_addr=None,
    )
    emits.clear()
    # Live-side change: sensitivity drops, slice list shrinks.
    sample.slicing_sensitivity = 0.2
    sample.slices = [0, 2000]
    sample.fire()

    value_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS
    ]
    # First emit is the sensitivity itself (its own listener fire);
    # second is the cascaded slices read.
    sens_emits = [a for a in value_emits if a[1] == "sample.slicing_sensitivity"]
    slice_emits = [a for a in value_emits if a[1] == "sample.slices"]
    assert len(sens_emits) == 1
    assert sens_emits[0][2] == 0.2
    assert len(slice_emits) == 1
    assert json.loads(slice_emits[0][2]) == [0, 2000]


def test_slicing_sensitivity_cascades_on_ui_write(emits, generation):
    """A UI-side ``set`` of sensitivity also cascades a fresh slices
    emit, mirroring the fire path. Without this, an iPad SENS drag
    would never refresh slice lines (Live's cascade-on-write is also
    listener-less for ``slices``).
    """
    sample = StubLOMContainer(
        slicing_sensitivity=0.5, slices=[0, 1000, 2000],
    )
    simpler = StubSimpler(sample=sample)
    song = StubSong(tracks=[StubTrack(tid=304, devices=[simpler])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    component.handle_set(
        args=(
            "tracks/0/devices/0", "sample.slicing_sensitivity",
            0.9, generation.current,
        ),
        source_addr=None,
    )
    # Mimic Live's recompute (test stub doesn't auto-update slices on
    # sensitivity write — real Live does).
    sample.slices = [0, 500, 1000, 1500, 2000]
    # Now look for a cascaded slices emit. The cascade reads slices
    # *after* the LOM accepted the write; we manually update slices
    # before checking emits to confirm the cascade reads fresh.
    # Re-trigger by sending another set so the cascade fires post-
    # update of slices in the stub.
    emits.clear()
    component.handle_set(
        args=(
            "tracks/0/devices/0", "sample.slicing_sensitivity",
            0.91, generation.current,
        ),
        source_addr=None,
    )
    slice_emits = [
        args for (addr, args) in emits
        if addr == V3_PROPERTY_VALUE_ADDRESS and args[1] == "sample.slices"
    ]
    assert len(slice_emits) == 1
    assert json.loads(slice_emits[0][2]) == [0, 500, 1000, 1500, 2000]


def test_slices_set_rejects_with_property_read_only(emits, generation):
    """``sample.slices`` is RO; writes reject without touching LOM."""
    sample = StubLOMContainer(slices=[0, 1000])
    simpler = StubSimpler(sample=sample)
    song = StubSong(tracks=[StubTrack(tid=302, devices=[simpler])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)

    component.handle_set(
        args=(
            "tracks/0/devices/0", "sample.slices",
            "[0, 2000]", generation.current,
        ),
        source_addr=None,
    )
    # LOM never written.
    assert sample.slices == [0, 1000]
    # Error emitted with the read-only detail.
    assert any(
        a == V3_ERROR_ADDRESS
        and args[0] == V3_PROPERTY_SET_ADDRESS
        and args[1] == V3_ERROR_WRITE_REJECTED
        and args[4] == V3_ERROR_DETAIL_PROPERTY_READ_ONLY
        for (a, args) in emits
    )


# ---------------------------------------------------------------------------
# ADR-350: identity under Live's per-read wrapper layer
# ---------------------------------------------------------------------------


class _FreshDeviceWrapper:
    """A per-read proxy over a device core, with a stable ``_live_ptr``.

    Models Live's v3 framework, which builds a fresh Python proxy on every
    property read. Two reads for one LOM device therefore fail ``is`` while
    agreeing on ``_live_ptr`` — the shape that made the old
    ``r.obj is device`` check in ``on_structural_invalidate`` always false,
    pruning every subscription on every structural change.

    Shaped after ``test_track_metadata_component._FreshTrackWrapper``.
    """

    __slots__ = ("_core",)

    def __init__(self, core):
        object.__setattr__(self, "_core", core)

    @property
    def _live_ptr(self):
        # Stable per underlying device, independent of proxy instance.
        return id(self._core)

    def __getattr__(self, name):
        return getattr(self._core, name)

    def __setattr__(self, name, value):
        setattr(self._core, name, value)


class _FreshDeviceTrack:
    """Delegates to a StubTrack but hands out a NEW device proxy per read."""

    __slots__ = ("_core",)

    def __init__(self, core):
        object.__setattr__(self, "_core", core)

    @property
    def devices(self):
        return [_FreshDeviceWrapper(d) for d in self._core.devices]

    def __getattr__(self, name):
        return getattr(self._core, name)

    def __setattr__(self, name, value):
        setattr(self._core, name, value)


def test_structural_invalidate_survives_fresh_wrappers(emits, generation):
    """The ADR-350 regression, on the real code path.

    ``test_structural_invalidate_preserves_live_path`` above cannot catch this:
    its stubs return the same object on every read, so ``is`` happens to work.
    Serving a fresh proxy per read — stable ``_live_ptr``, new identity — is
    what Live actually does, and it is what broke the check in production.
    """
    simpler = StubSimpler(playback_mode=1)
    core = StubTrack(tid=100, devices=[simpler])
    song = StubSong(tracks=[_FreshDeviceTrack(core)])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)

    # Sanity: the fixture really does hand back distinct objects.
    assert song.tracks[0].devices[0] is not song.tracks[0].devices[0]

    component.handle_subscribe(
        args=("tracks/0/devices/0", "playback_mode"), source_addr=None,
    )
    assert ("tracks/0/devices/0", "playback_mode") in component._subscriptions

    component.on_structural_invalidate()

    # Same LOM device at the same path: the subscription must survive even
    # though the resolver handed back a different Python object.
    assert ("tracks/0/devices/0", "playback_mode") in component._subscriptions
    assert simpler._device_listener is not None


# --- per-attr listener pairs (Log.txt, 2026-09-27) -------------------------
#
# Every subscription used to attach through ``target.add_value_listener``,
# which Live's devices and ``Sample`` do not have: 820 warnings in Log.txt,
# and every property delivered its cold read and never a change. Measured on
# the rig: each allowlisted property has its own ``add_<attr>_listener`` /
# ``remove_<attr>_listener`` pair, except ``Sample.length``, which has none.


class _AllowlistDevice(_StubDevice):
    """A device carrying every allowlisted direct property of its class."""

    def __init__(self, class_name: str, attrs: dict, sample=None):
        self.__dict__.update(attrs)
        self.class_name = class_name
        self.parameters = []
        if sample is not None:
            self.sample = sample
        self._observable = tuple(attrs)


def _allowlist_device(class_name: str) -> _AllowlistDevice:
    rows = [s for (c, _p), s in ALLOWLIST.items() if c == class_name and not s.computed]
    sample_attrs = {s.attr_name: 1 for s in rows if s.listener_path == "sample"}
    return _AllowlistDevice(
        class_name,
        {s.attr_name: 1 for s in rows if s.listener_path == ""},
        sample=StubLOMContainer(**sample_attrs) if sample_attrs else None,
    )


_LOM_ROWS = sorted(k for k, s in ALLOWLIST.items() if not s.computed)


@pytest.mark.parametrize("key", _LOM_ROWS, ids=["%s/%s" % k for k in _LOM_ROWS])
def test_every_lom_property_listens_through_its_own_listener_pair(
    key, emits, generation,
):
    class_name, prop = key
    spec = ALLOWLIST[key]
    device = _allowlist_device(class_name)
    song = StubSong(tracks=[StubTrack(tid=300, devices=[device])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    target = device.sample if spec.listener_path == "sample" else device
    path = "tracks/0/devices/0"

    component.handle_subscribe(args=(path, prop), source_addr=None)
    assert [a for (addr, a) in emits if addr == V3_PROPERTY_VALUE_ADDRESS] == [
        (path, prop, component._read_value(device, path, spec)),
    ]

    if prop == "sample.length":
        # Not observable in Live: cold read only, nothing attached.
        assert target._listeners == []
    else:
        assert len(target.listeners_for(spec.attr_name)) == 1
        assert target._listeners == target.listeners_for(spec.attr_name)
        emits.clear()
        target.fire(spec.attr_name)
        assert (path, prop) in {
            a[:2] for (addr, a) in emits if addr == V3_PROPERTY_VALUE_ADDRESS
        }

    component.handle_unsubscribe(args=(path, prop), source_addr=None)
    assert target._listeners == []


def test_disconnect_detaches_each_property_from_its_own_pair(emits, generation):
    """Several properties on one device and its sample, torn down together."""
    device = _allowlist_device("OriginalSimpler")
    song = StubSong(tracks=[StubTrack(tid=301, devices=[device])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    for prop in ("playback_mode", "slicing_playback_mode",
                 "sample.start_marker", "sample.length", "sample.slices"):
        component.handle_subscribe(args=("tracks/0/devices/0", prop), source_addr=None)
    assert sorted(device._slots()) == ["playback_mode", "slicing_playback_mode"]
    assert len(device.sample._listeners) == 2

    component.disconnect()
    assert device._listeners == []
    assert device.sample._listeners == []


def test_a_target_offering_only_add_value_listener_is_not_listened_to(emits, generation):
    """The old generic call must never come back: a target with only
    ``add_value_listener`` gets no listener, and still cold-reads."""
    class _GenericOnly:
        class_name = "Drift"
        parameters = []
        voice_mode_index = 3

        def add_value_listener(self, cb):
            raise AssertionError("add_value_listener is not Live's API here")

    song = StubSong(tracks=[StubTrack(tid=302, devices=[_GenericOnly()])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    component.handle_subscribe(
        args=("tracks/0/devices/0", "voice_mode_index"), source_addr=None,
    )
    assert emits == [
        (V3_PROPERTY_VALUE_ADDRESS, ("tracks/0/devices/0", "voice_mode_index", 3)),
    ]
    component.handle_unsubscribe(
        args=("tracks/0/devices/0", "voice_mode_index"), source_addr=None,
    )


def test_a_sample_marker_moved_in_live_reaches_the_ui(emits, generation):
    """The auto-trim race detector and the start-marker brace depend on
    this: a change made in Live, after the cold read, emits the new value."""
    device = _allowlist_device("OriginalSimpler")
    song = StubSong(tracks=[StubTrack(tid=303, devices=[device])])
    component = PropertyComponent(
        song=song, emit=lambda a, args: emits.append((a, args)),
    )
    component.set_generation(generation)
    component.handle_subscribe(
        args=("tracks/0/devices/0", "sample.start_marker"), source_addr=None,
    )
    emits.clear()

    device.sample.start_marker = 4410
    device.sample.fire("start_marker")

    assert emits == [
        (V3_PROPERTY_VALUE_ADDRESS, ("tracks/0/devices/0", "sample.start_marker", 4410)),
    ]
