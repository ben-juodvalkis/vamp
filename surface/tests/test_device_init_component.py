"""DeviceInitComponent tests — Phase 12 pr12-4.

Covers the Python port of the M4L pair
``scripts/device-initialization.js`` + the AU-plugin retry
chain in ``scripts/liveAPI-v6.js`` (``checkAuPluginsNeedRetry`` /
``scheduleAuPluginRetry``):

- **Init rules.** ``OriginalSimpler`` insert runs the hand-
  written 6-action rule (2 ``set_parameter``, 4 ``set_property``).
  All writes succeed → scoped ``emit_selection_change(path)`` fires
  once. Non-matching ``class_name`` → no writes, no emit. Unknown
  action type → warn + skip, no emit.
- **AU-plugin retry.** ``AuPluginDevice`` insert schedules 3
  retries at 400/800/1600ms. Fire with ``len(parameters) == 0``
  → no emit. Fire with populated params → scoped emit. Fire
  after epoch bump (simulates second AU insert on the same
  track) → bail without probing ``parameters``.
- **LOM-guard discipline.** Rule 9 says ``_LOM_ERRORS`` must
  swallow ``RuntimeError`` / ``AttributeError`` / ``TypeError``;
  test exercises each write path with a raising device and
  asserts no propagation.
- **Disconnect.** Disconnected component no-ops on
  ``on_device_added``, and scheduled retries no-op on fire.
"""

from __future__ import annotations

from typing import Callable, List, Optional, Tuple

import pytest

from components.DeviceInitComponent import (
    _AU_RETRY_DELAYS_MS,
    _INIT_RULES,
    DeviceInitComponent,
)


# --- stubs ----------------------------------------------------------------


class StubParam:
    def __init__(self, value=0.0):
        self.value = value


class StubSample:
    def __init__(self, warping=1):
        self.warping = warping


class StubDevice:
    """Mimics a Live ``Device``. ``parameters`` is a real list so
    the component's ``len(..)`` + index access works. ``sample`` is
    exposed for the dotted-path ``sample.warping`` action."""

    def __init__(
        self,
        class_name: str,
        name: str = "",
        parameters: Optional[List[StubParam]] = None,
        **extras,
    ):
        self.class_name = class_name
        self.name = name
        self.parameters = parameters if parameters is not None else []
        # set any additional properties the test wants to assert on
        for k, v in extras.items():
            setattr(self, k, v)


class StubTrack:
    def __init__(self, tid: int, name: str = ""):
        self._id = tid
        self.name = name


class StubSong:
    """Minimal ``song`` used only for ``compose_track_path`` stubbing."""

    def __init__(self, tracks: Optional[List[StubTrack]] = None, master=None):
        self._tracks = list(tracks or [])
        self.master_track = master

    @property
    def tracks(self):
        return list(self._tracks)


class FakeScheduler:
    """Captures ``schedule_delayed(delay_ms, fn)`` calls and lets
    tests fire them deterministically."""

    def __init__(self):
        self.calls: List[Tuple[int, Callable[[], None]]] = []

    def __call__(self, delay_ms, fn):
        self.calls.append((delay_ms, fn))

    def fire_all(self) -> None:
        """Fire all pending callbacks in FIFO order."""
        pending = self.calls
        self.calls = []
        for _, fn in pending:
            fn()

    def fire_first(self) -> None:
        _, fn = self.calls.pop(0)
        fn()


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[str]:
    return []


@pytest.fixture
def scheduler() -> FakeScheduler:
    return FakeScheduler()


@pytest.fixture
def path_map() -> dict:
    """Dict-keyed resolver: ``id(track) -> "tracks/N"``. Tests that
    want a specific path install it here."""
    return {}


@pytest.fixture
def resolver(path_map):
    def _resolve(song, track):
        return path_map.get(id(track))
    return _resolve


@pytest.fixture
def song() -> StubSong:
    return StubSong()


@pytest.fixture
def component(song, emits, scheduler, resolver) -> DeviceInitComponent:
    return DeviceInitComponent(
        song=song,
        emit_selection_change=lambda path: emits.append(path),
        schedule_delayed=scheduler,
        compose_track_path=resolver,
    )


# --- init rule: OriginalSimpler ------------------------------------------


def test_original_simpler_applies_all_actions_and_emits(
    component, emits, scheduler, path_map,
):
    """Happy path: insert OriginalSimpler → all 6 actions land
    → scoped emit fires once with the track's path."""
    # 35 parameters so index 5 and 34 are in range.
    params = [StubParam() for _ in range(35)]
    device = StubDevice(
        class_name="OriginalSimpler",
        parameters=params,
        playback_mode=99,
        retrigger=99,
        slicing_playback_mode=99,
        sample=StubSample(warping=1),
    )
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"

    component.on_device_added(track, device, 0)

    # Init-rule application is deferred to the next control-thread tick
    # (Live refuses mutations from inside ``on_device_added``
    # notifications). Exactly one scheduled fire enqueued.
    assert len(scheduler.calls) == 1
    scheduler.fire_all()

    # Parameter writes.
    assert params[5].value == 1
    assert params[34].value == 1
    # Property writes.
    assert device.playback_mode == 0
    assert device.retrigger == 0
    assert device.sample.warping == 0
    assert device.slicing_playback_mode == 2
    # Single scoped emit.
    assert emits == ["tracks/0"]
    # No AU retries for a Simpler.
    assert scheduler.calls == []


def test_non_matching_class_name_runs_nothing(
    component, emits, scheduler,
):
    """A device not in the rule table and not AuPluginDevice →
    no writes, no retries, no emit."""
    device = StubDevice(class_name="Reverb", parameters=[StubParam()])
    track = StubTrack(tid=1)
    component.on_device_added(track, device, 0)
    assert emits == []
    assert scheduler.calls == []


def test_unknown_action_type_skipped(component, emits, path_map, monkeypatch):
    """An action with a bogus ``type`` is skipped; if it was the
    only action, no emit fires (no writes succeeded)."""
    monkeypatch.setitem(
        _INIT_RULES, "OriginalSimpler",
        {"description": "bogus only", "actions": [{"type": "sing_song"}]},
    )
    device = StubDevice(class_name="OriginalSimpler", parameters=[])
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"
    component.on_device_added(track, device, 0)
    assert emits == []


def test_set_parameter_out_of_range_fails_gracefully(
    emits, scheduler, resolver, song, path_map, monkeypatch,
):
    """An index past ``len(parameters)`` returns False without
    raising. If every action fails, no emit fires."""
    # Replace the rule with a single set_parameter at index 999.
    monkeypatch.setitem(
        _INIT_RULES, "OriginalSimpler",
        {"description": "one oob", "actions": [
            {"type": "set_parameter", "index": 999, "value": 1},
        ]},
    )
    component = DeviceInitComponent(
        song=song,
        emit_selection_change=lambda p: emits.append(p),
        schedule_delayed=scheduler,
        compose_track_path=resolver,
    )
    device = StubDevice(class_name="OriginalSimpler", parameters=[StubParam()])
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"
    component.on_device_added(track, device, 0)
    scheduler.fire_all()
    assert emits == []


def test_set_property_raises_lom_error_swallowed(
    emits, scheduler, resolver, song, path_map, monkeypatch,
):
    """A property setter that raises ``RuntimeError`` is caught by
    the ``_LOM_ERRORS`` guard — neighboring successful writes still
    emit on completion."""
    class Bomb:
        def __setattr__(self, k, v):
            if k == "playback_mode":
                raise RuntimeError("LOM boom")
            object.__setattr__(self, k, v)

    monkeypatch.setitem(
        _INIT_RULES, "OriginalSimpler",
        {"description": "mixed", "actions": [
            {"type": "set_property", "path": "playback_mode", "value": 0},
            {"type": "set_property", "path": "retrigger", "value": 0},
        ]},
    )

    device = Bomb()
    device.class_name = "OriginalSimpler"
    device.name = ""
    device.parameters = []
    device.retrigger = 99

    component = DeviceInitComponent(
        song=song,
        emit_selection_change=lambda p: emits.append(p),
        schedule_delayed=scheduler,
        compose_track_path=resolver,
    )
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"
    # Must not raise.
    component.on_device_added(track, device, 0)
    scheduler.fire_all()
    # retrigger still got written.
    assert device.retrigger == 0
    # ≥1 write succeeded → emit fires.
    assert emits == ["tracks/0"]


def test_null_path_skips_emit(component, emits, path_map, scheduler):
    """Track that ``compose_track_path`` can't resolve (returns) →
    no emit even if writes succeeded."""
    params = [StubParam() for _ in range(35)]
    device = StubDevice(
        class_name="OriginalSimpler",
        parameters=params,
        playback_mode=99,
        retrigger=99,
        slicing_playback_mode=99,
        sample=StubSample(warping=1),
    )
    track = StubTrack(tid=1)
    # path_map is empty → resolver returns None
    component.on_device_added(track, device, 0)
    scheduler.fire_all()
    # Writes still happened (they don't depend on path).
    assert params[5].value == 1
    # But no emit.
    assert emits == []


# --- AU-plugin retry -----------------------------------------------------


def test_au_plugin_schedules_three_retries(component, scheduler):
    """AuPluginDevice insert schedules 3 retries at the canonical
    400/800/1600ms cadence."""
    device = StubDevice(class_name="AuPluginDevice", parameters=[])
    track = StubTrack(tid=1)
    component.on_device_added(track, device, 0)
    delays = [d for d, _ in scheduler.calls]
    assert tuple(delays) == _AU_RETRY_DELAYS_MS


def test_au_retry_empty_params_no_emit(
    component, emits, scheduler, path_map,
):
    """First retry fires while ``parameters`` is still empty →
    no emit (the AU plugin still hasn't populated)."""
    device = StubDevice(class_name="AuPluginDevice", parameters=[])
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/3"
    component.on_device_added(track, device, 0)

    scheduler.fire_first()  # 400ms
    assert emits == []


def test_au_retry_populated_params_emits_scope(
    component, emits, scheduler, path_map,
):
    """Retry fires after the AU plugin has populated its param
    list → scoped emit fires for the track."""
    device = StubDevice(class_name="AuPluginDevice", parameters=[])
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/3"
    component.on_device_added(track, device, 0)

    # Populate the parameter list between schedule and fire.
    device.parameters = [StubParam(), StubParam(), StubParam()]

    scheduler.fire_first()  # 400ms retry wins
    assert emits == ["tracks/3"]

    # The remaining retries also fire scoped emits — params stay
    # populated, and the component leaves dedup to the UI.
    scheduler.fire_all()
    assert emits == ["tracks/3", "tracks/3", "tracks/3"]


def test_au_retry_epoch_bump_cancels_inflight(
    component, emits, scheduler, path_map,
):
    """Second AU plugin added to the same track bumps the epoch
    → the first round's retries no-op on fire."""
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"

    device1 = StubDevice(class_name="AuPluginDevice", parameters=[StubParam()])
    component.on_device_added(track, device1, 0)
    assert len(scheduler.calls) == 3  # three retries pending

    # A second AuPlugin on the same track bumps the epoch.
    device2 = StubDevice(class_name="AuPluginDevice", parameters=[])
    component.on_device_added(track, device2, 1)
    assert len(scheduler.calls) == 6  # 3 new retries on top

    # Firing the first 3 (the inflight round-1 closures) must NOT
    # emit — their captured epoch is stale.
    for _ in range(3):
        scheduler.fire_first()
    assert emits == []


def test_au_retry_device_removed_between_schedule_and_fire(
    component, emits, scheduler, path_map,
):
    """If the device went away (``parameters`` read raises) we
    swallow and skip the emit instead of crashing the tick."""
    class RaisingParams:
        def __len__(self):
            raise RuntimeError("device removed")

    class RaisingDevice:
        def __init__(self):
            self.class_name = "AuPluginDevice"
            self.name = ""
            self.parameters = RaisingParams()

    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"
    component.on_device_added(track, RaisingDevice(), 0)
    scheduler.fire_first()
    assert emits == []


def test_disconnect_noop_on_on_device_added(component, emits, scheduler):
    """After ``disconnect``, a device-added signal is ignored."""
    component.disconnect()
    device = StubDevice(
        class_name="OriginalSimpler",
        parameters=[StubParam() for _ in range(35)],
        playback_mode=99, retrigger=99, slicing_playback_mode=99,
        sample=StubSample(warping=1),
    )
    component.on_device_added(StubTrack(tid=1), device, 0)
    assert emits == []
    assert scheduler.calls == []


def test_disconnect_noop_on_scheduled_init_rule(
    component, emits, scheduler, path_map,
):
    """Init rules are scheduled to the next control-thread tick; if
    ``disconnect`` lands between schedule and fire, the deferred
    callback must not touch the device."""
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"
    params = [StubParam() for _ in range(35)]
    device = StubDevice(
        class_name="OriginalSimpler",
        parameters=params,
        playback_mode=99, retrigger=99, slicing_playback_mode=99,
        sample=StubSample(warping=1),
    )
    component.on_device_added(track, device, 0)
    assert len(scheduler.calls) == 1

    component.disconnect()
    scheduler.fire_all()
    # No writes, no emit.
    assert params[5].value == 0.0
    assert device.playback_mode == 99
    assert emits == []


def test_disconnect_noop_on_scheduled_retry(
    component, emits, scheduler, path_map,
):
    """Retries scheduled before disconnect must no-op when they
    fire afterwards."""
    track = StubTrack(tid=1)
    path_map[id(track)] = "tracks/0"
    device = StubDevice(
        class_name="AuPluginDevice",
        parameters=[StubParam(), StubParam()],
    )
    component.on_device_added(track, device, 0)
    assert len(scheduler.calls) == 3

    component.disconnect()
    scheduler.fire_all()
    assert emits == []


# --- class_name guard ----------------------------------------------------


def test_class_name_attribute_error_swallowed(component, emits, scheduler):
    """A device whose ``class_name`` read raises is simply ignored."""
    class NoClassName:
        @property
        def class_name(self):
            raise AttributeError("no class_name on this proxy")
        parameters = []
        name = ""

    component.on_device_added(StubTrack(tid=1), NoClassName(), 0)
    assert emits == []
    assert scheduler.calls == []


def test_class_name_non_string_ignored(component, emits):
    """Non-string ``class_name`` (e.g. None) is skipped cleanly."""
    device = StubDevice(class_name="", parameters=[])
    device.class_name = None  # override
    component.on_device_added(StubTrack(tid=1), device, 0)
    assert emits == []


# --- rule lookup fallback ------------------------------------------------


def test_lookup_prefers_class_plus_name(
    emits, scheduler, resolver, song, path_map, monkeypatch,
):
    """``class_name:device_name`` rule overrides the bare
    ``class_name`` rule (mirrors the M4L ``getDeviceInitialization``
    fallback order)."""
    params = [StubParam() for _ in range(5)]
    monkeypatch.setitem(
        _INIT_RULES, "AuPluginDevice:Omnisphere 2",
        {"actions": [
            {"type": "set_parameter", "index": 0, "value": 42},
        ]},
    )
    try:
        component = DeviceInitComponent(
            song=song,
            emit_selection_change=lambda p: emits.append(p),
            schedule_delayed=scheduler,
            compose_track_path=resolver,
        )
        device = StubDevice(
            class_name="AuPluginDevice",
            name="Omnisphere 2",
            parameters=params,
        )
        track = StubTrack(tid=1)
        path_map[id(track)] = "tracks/0"
        component.on_device_added(track, device, 0)
        # Two schedules: one for the init-rule deferral (delay=0)
        # and three for the AU-plugin retry chain (400/800/1600).
        assert len(scheduler.calls) == 1 + len(_AU_RETRY_DELAYS_MS)
        # Fire only the init-rule deferral (first in FIFO).
        scheduler.fire_first()
        assert params[0].value == 42
        assert emits == ["tracks/0"]
        # AU retry chain still pending.
        assert len(scheduler.calls) == len(_AU_RETRY_DELAYS_MS)
    finally:
        del _INIT_RULES["AuPluginDevice:Omnisphere 2"]


# --- Pass 2: ensure_random_start (ADR-378) --------------------------------


def test_ensure_random_start_called_for_original_simpler(
    song, emits, scheduler, resolver,
):
    """When an OriginalSimpler is added, the deferred ensure_random_start
    callable is scheduled (delay=0, same tick as init rules)."""
    calls = []
    component = DeviceInitComponent(
        song=song,
        emit_selection_change=lambda p: emits.append(p),
        schedule_delayed=scheduler,
        compose_track_path=resolver,
        ensure_random_start=lambda track: calls.append(track),
    )
    device = StubDevice(class_name="OriginalSimpler")
    track = StubTrack(tid=1)
    component.on_device_added(track, device, 0)

    # Two delay=0 schedules: one for init rules, one for random start.
    assert len(scheduler.calls) == 2
    assert all(delay == 0 for delay, _ in scheduler.calls)

    # Fire both; ensure_random_start should have been called with the track.
    scheduler.fire_all()
    assert calls == [track]


def test_ensure_random_start_not_called_for_non_simpler(
    song, emits, scheduler, resolver,
):
    """ensure_random_start is not scheduled for non-Simpler devices."""
    calls = []
    component = DeviceInitComponent(
        song=song,
        emit_selection_change=lambda p: emits.append(p),
        schedule_delayed=scheduler,
        compose_track_path=resolver,
        ensure_random_start=lambda track: calls.append(track),
    )
    device = StubDevice(class_name="AuPluginDevice")
    track = StubTrack(tid=1)
    component.on_device_added(track, device, 0)

    scheduler.fire_all()
    assert calls == []


def test_ensure_random_start_none_does_not_raise(
    component, scheduler,
):
    """When ensure_random_start is not supplied (default None), an
    OriginalSimpler insertion schedules only the init-rule deferral."""
    device = StubDevice(class_name="OriginalSimpler")
    track = StubTrack(tid=1)
    component.on_device_added(track, device, 0)

    # Only the init-rule deferral — no random start schedule.
    assert len(scheduler.calls) == 1
    scheduler.fire_all()  # must not raise
