"""FootTriggerComponent tests — Phase 9 PR-9b.

Covers the two arg-free handlers the v8 module emits:

- ``handle_tap`` branches on highlighted_clip_slot state:
    * no slot               → no-op
    * empty slot            → slot.fire()
    * recording clip        → slot.fire() (end take, launch as a loop)
    * stopped clip          → slot.fire()
    * playing clip          → flip song.session_record
- ``handle_hold`` creates an audio track, names it, sets routing, arms.
- Constants override (test fixture) lets us pin the routing channel
  without touching the real constants.json.
- Routing object lookup via ``available_input_routing_channels``
  uses the ``display_name`` match path; missing match falls back to
  string assignment.
- LOM raises (highlighted_clip_slot, has_clip, fire, etc.) are
  swallowed with a log line — never crash the surface.
- Post-disconnect handler is a no-op for both addresses.

Why no timer mocking: the 500ms tap/hold decision runs upstream of
this component — in ``components/midi_pedal_input.py`` for the
USB-direct MIDI path (ADR-422; timing covered by
``test_midi_pedal_input.py``) and in ``owner/Max Patches/foot-trigger.js``
for the legacy OSC path. This component only sees the resolved
gesture; there is no time-dependent behaviour in it.
"""

from __future__ import annotations

from typing import Callable, List, Tuple
from unittest.mock import patch

import pytest

from components.FootTriggerComponent import (
    FootTriggerComponent,
    V3_FOOT_HOLD_ADDRESS,
    V3_FOOT_TAP_ADDRESS,
    _HOLD_RATE_LIMIT_SECS,
)


# --- stubs ----------------------------------------------------------------


class StubClip:
    def __init__(self, is_playing: bool = False, is_recording: bool = False):
        self.is_playing = is_playing
        self.is_recording = is_recording


class StubClipSlot:
    """Mirror Live's ``ClipSlot`` for the two attrs the component reads."""

    def __init__(self, has_clip: bool = False, clip=None):
        self.has_clip = has_clip
        self.clip = clip
        self.fire_calls = 0

    def fire(self):
        self.fire_calls += 1


class StubRouting:
    """A single ``available_input_routing_channels`` entry."""

    def __init__(self, display_name: str):
        self.display_name = display_name


class StubTrack:
    """Captures everything ``_configure_held_track`` writes."""

    def __init__(self, available=None):
        self.name = ""
        self.arm = False
        self.input_routing_channel = None
        self.available_input_routing_channels = (
            tuple(available) if available is not None else ()
        )


class StubView:
    def __init__(self, highlighted_clip_slot=None):
        self.highlighted_clip_slot = highlighted_clip_slot


class StubSong:
    """Mirror the slice of ``Song`` the component touches.

    ``create_audio_track`` appends a track built from the
    ``track_factory`` callable, simulating Live's "create + select"
    flow. ``session_record`` is a plain bool the component flips.
    """

    def __init__(
        self,
        view=None,
        tracks=None,
        session_record: bool = False,
        track_factory=None,
    ):
        self.view = view if view is not None else StubView()
        self.tracks = list(tracks) if tracks is not None else []
        self.session_record = session_record
        self.create_calls: List[int] = []
        self._track_factory = track_factory or (lambda: StubTrack())

    def create_audio_track(self, index: int) -> None:
        self.create_calls.append(index)
        self.tracks.append(self._track_factory())


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


@pytest.fixture
def constants():
    """Inline constants override; pins the routing channel and the
    sequencer device path for tests."""
    return {
        "audio": {"defaultInputChannel": "11/12 Guitar Mic"},
        "devices": {"sequencer": {"devicePath": "/tmp/Permute.amxd"}},
    }


def _make_component(
    emits, song, constants,
    schedule_delayed=None,
    load_preset=None,
):
    def emit(addr, args):
        emits.append((addr, args))

    return FootTriggerComponent(
        song=song, emit=emit, constants=constants,
        schedule_delayed=schedule_delayed,
        load_preset=load_preset,
    )


# --- tap branches ---------------------------------------------------------


def test_tap_no_highlighted_slot_is_noop(emits, constants):
    song = StubSong(view=StubView(highlighted_clip_slot=None))
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert emits == []
    assert song.session_record is False


def test_tap_empty_slot_fires(emits, constants):
    slot = StubClipSlot(has_clip=False)
    song = StubSong(view=StubView(highlighted_clip_slot=slot))
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 1
    assert song.session_record is False  # not toggled


def test_tap_stopped_clip_fires(emits, constants):
    clip = StubClip(is_playing=False)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(view=StubView(highlighted_clip_slot=slot))
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 1
    assert song.session_record is False


def test_tap_playing_clip_toggles_session_record_on(emits, constants):
    clip = StubClip(is_playing=True)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=False,
    )
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 0  # didn't fire when toggling
    assert song.session_record is True


def test_tap_playing_clip_toggles_session_record_off(emits, constants):
    clip = StubClip(is_playing=True)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=True,
    )
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert song.session_record is False


def test_tap_recording_clip_fires_to_end_the_take(emits, constants):
    """A recording clip also reports ``is_playing``, so this case only
    reaches ``fire()`` if ``is_recording`` is branched on FIRST. Firing
    is what ends the take and launches it as a loop — the second press
    of the looper cycle."""
    clip = StubClip(is_playing=True, is_recording=True)
    slot = StubClipSlot(has_clip=True, clip=clip)
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=False,
    )
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 1
    assert song.session_record is False  # overdub is the NEXT press


def test_tap_unreadable_is_recording_falls_back_to_overdub(emits, constants):
    """Losing the flag must not kill the gesture — a raising
    ``is_recording`` degrades to the playing branch rather than
    aborting the tap."""

    class NoRecordingFlagClip:
        is_playing = True

        @property
        def is_recording(self):
            raise RuntimeError("torn-down handle")

    slot = StubClipSlot(has_clip=True, clip=NoRecordingFlagClip())
    song = StubSong(
        view=StubView(highlighted_clip_slot=slot),
        session_record=False,
    )
    comp = _make_component(emits, song, constants)

    comp.handle_tap((), source_addr=None)

    assert slot.fire_calls == 0
    assert song.session_record is True


# --- hold branches --------------------------------------------------------


def test_hold_creates_named_armed_routed_track(emits, constants):
    routing = StubRouting("11/12 Guitar Mic")
    other = StubRouting("1/2")

    def factory():
        return StubTrack(available=[other, routing])

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants)

    comp.handle_hold((), source_addr=None)

    assert song.create_calls == [-1]
    assert len(song.tracks) == 1
    new_track = song.tracks[0]
    assert new_track.name == "Audio"
    assert new_track.arm is True
    # Routing object lookup matched on display_name.
    assert new_track.input_routing_channel is routing


def test_hold_falls_back_to_string_when_no_match(emits, constants):
    other = StubRouting("9/10 Synth")

    def factory():
        return StubTrack(available=[other])

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants)

    comp.handle_hold((), source_addr=None)

    new_track = song.tracks[0]
    # No display_name match → string fallback.
    assert new_track.input_routing_channel == "11/12 Guitar Mic"


def test_hold_with_empty_available_uses_string_fallback(emits, constants):
    def factory():
        return StubTrack(available=[])

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants)

    comp.handle_hold((), source_addr=None)

    new_track = song.tracks[0]
    assert new_track.input_routing_channel == "11/12 Guitar Mic"


def test_hold_uses_constants_input_channel(emits):
    """Override constants — routing channel comes from the dict."""
    routing = StubRouting("Virtual A")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = _make_component(
        emits, song,
        constants={"audio": {"defaultInputChannel": "Virtual A"}},
    )

    comp.handle_hold((), source_addr=None)

    assert song.tracks[0].input_routing_channel is routing


def test_hold_keeps_lives_input_when_no_channel_is_set(emits):
    """No ``audio.defaultInputChannel`` (the general edition): the new
    track keeps whatever input Live gave it — no guessed "1/2"."""
    routing = StubRouting("1/2")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants={})

    comp.handle_hold((), source_addr=None)

    assert song.tracks[0].input_routing_channel is None
    assert song.tracks[0].name == "Audio"


# --- LOM-error fail-soft --------------------------------------------------


class _RaisesOnRead:
    """Descriptor-ish stand-in that raises when read."""

    def __init__(self, exc):
        self._exc = exc

    def __get__(self, instance, owner):
        raise self._exc


class _SongWithRaisingView:
    """Song whose ``view.highlighted_clip_slot`` raises a LOM error."""

    class _View:
        @property
        def highlighted_clip_slot(self):
            raise RuntimeError("LOM torn down")

    view = _View()
    session_record = False
    tracks: list = []


def test_tap_swallows_lom_error_on_view_read(emits, constants):
    comp = _make_component(emits, _SongWithRaisingView(), constants)
    # Should not raise; logs WARNING and returns.
    comp.handle_tap((), source_addr=None)
    assert emits == []


def test_hold_no_track_after_create_logs_and_returns(emits, constants):
    # Factory returns nothing — simulate Live failing to actually
    # append. Component should log + return without exception.
    song = StubSong(track_factory=lambda: None)
    # Override create to not actually append:
    song.create_audio_track = lambda idx: song.create_calls.append(idx)

    comp = _make_component(emits, song, constants)
    comp.handle_hold((), source_addr=None)

    assert song.create_calls == [-1]
    assert song.tracks == []


# --- inline Permute append (2026-04-30) ----------------------------------
#
# The previous design re-emitted ``/looping/v3/track/created`` after the
# hold-create configure tick, and the UI ran ``loadSequencerAndAwait``
# in response. The bridge broadcasts every OSC message to all connected
# WS clients, so when both Mac and iPad were open each fired a
# ``/looping/v3/device/load`` and the audio track ended up with two
# Permutes appended. The component now calls ``load_preset`` directly —
# single authoritative initiator for the gesture, single load.


def test_hold_calls_load_preset_with_sequencer_path(emits, constants):
    """After hold-create + configure, the component calls load_preset
    with the new track's index and the sequencer devicePath."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    load_calls: List[Tuple[int, str]] = []

    def load_preset(track_index, preset_path):
        load_calls.append((track_index, preset_path))

    comp = _make_component(emits, song, constants, load_preset=load_preset)

    comp.handle_hold((), source_addr=None)

    assert load_calls == [(0, "/tmp/Permute.amxd")]


def test_hold_emits_no_track_created(emits, constants):
    """The legacy ``/looping/v3/track/created`` re-emit was removed —
    the bridge would broadcast it to every WS client, causing each to
    fire a duplicate Permute load. The address must not appear."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = _make_component(
        emits, song, constants,
        load_preset=lambda i, p: None,
    )

    comp.handle_hold((), source_addr=None)

    addresses = [addr for addr, _args in emits]
    assert "/looping/v3/track/created" not in addresses


def test_hold_load_preset_runs_from_deferred_tick(emits, constants):
    """With schedule_delayed wired, the Permute load fires inside the
    scheduled callback — not the synchronous create path. Live's
    audio-track template needs to settle before the device-chain
    write."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    pending: List[Callable[[], None]] = []
    load_calls: List[Tuple[int, str]] = []

    def schedule(delay, fn):
        pending.append(fn)

    comp = _make_component(
        emits, song, constants,
        schedule_delayed=schedule,
        load_preset=lambda i, p: load_calls.append((i, p)),
    )

    comp.handle_hold((), source_addr=None)

    # Load is queued on the deferred tick.
    assert load_calls == []
    assert song.tracks[0].name == ""  # configure hasn't run either

    for fn in pending:
        fn()

    assert load_calls == [(0, "/tmp/Permute.amxd")]
    assert song.tracks[0].name == "Audio"


def test_hold_load_preset_failure_is_swallowed(emits, constants):
    """A raising load_preset must not abort configure or propagate.
    The user still got name/route/arm even if Permute fails to load."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    def boom(track_index, preset_path):
        raise RuntimeError("device load down")

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants, load_preset=boom)

    # Must not propagate.
    comp.handle_hold((), source_addr=None)
    assert song.tracks[0].name == "Audio"
    assert song.tracks[0].arm is True


def test_hold_skips_load_when_no_load_preset_closure(emits, constants):
    """Older Live builds without DeviceLoadComponent (12.3.7 capability
    gate) hand us ``None``; the gesture still creates + configures the
    track but skips the Permute step with a WARN."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants, load_preset=None)

    comp.handle_hold((), source_addr=None)

    assert song.tracks[0].name == "Audio"
    assert song.tracks[0].arm is True


def test_hold_skips_load_when_constants_missing_sequencer(emits, monkeypatch):
    """No devices.sequencer.devicePath and no Permute.amxd in the checkout
    (the derived path, 2026-09-26) skips the load with a WARN rather than
    crashing."""
    from components import live_library
    monkeypatch.setattr(live_library, "m4l_devices_root", lambda: "/nonexistent/Vamp Devices")
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    load_calls: List[Tuple[int, str]] = []

    comp = _make_component(
        emits, song,
        constants={"audio": {"defaultInputChannel": "11/12 Guitar Mic"}},
        load_preset=lambda i, p: load_calls.append((i, p)),
    )

    comp.handle_hold((), source_addr=None)

    assert load_calls == []
    assert song.tracks[0].name == "Audio"


# --- hold rate limit (5 s) -----------------------------------------------


def test_hold_rate_limited_on_rapid_repeat(emits, constants):
    """Second hold within 5 s is dropped; track created only once."""
    song = StubSong()
    comp = _make_component(emits, song, constants)

    t0 = 1000.0
    with patch("components.FootTriggerComponent.time") as mock_time:
        mock_time.monotonic.return_value = t0
        comp.handle_hold((), source_addr=None)

        mock_time.monotonic.return_value = t0 + _HOLD_RATE_LIMIT_SECS - 0.1
        comp.handle_hold((), source_addr=None)

    assert song.create_calls == [-1]  # only one track created


def test_hold_allowed_after_rate_limit_expires(emits, constants):
    """Hold is accepted once ≥ 5 s have elapsed since the last one."""
    song = StubSong()
    comp = _make_component(emits, song, constants)

    t0 = 1000.0
    with patch("components.FootTriggerComponent.time") as mock_time:
        mock_time.monotonic.return_value = t0
        comp.handle_hold((), source_addr=None)

        mock_time.monotonic.return_value = t0 + _HOLD_RATE_LIMIT_SECS
        comp.handle_hold((), source_addr=None)

    assert song.create_calls == [-1, -1]  # two tracks created


def test_hold_first_call_never_rate_limited(emits, constants):
    """Fresh component: first hold is always accepted (no prior timestamp)."""
    song = StubSong()
    comp = _make_component(emits, song, constants)

    with patch("components.FootTriggerComponent.time") as mock_time:
        mock_time.monotonic.return_value = 0.0  # worst case: monotonic starts at 0
        comp.handle_hold((), source_addr=None)

    assert song.create_calls == [-1]


# --- disconnect -----------------------------------------------------------


def test_disconnect_makes_handlers_noop(emits, constants):
    slot = StubClipSlot(has_clip=False)
    song = StubSong(view=StubView(highlighted_clip_slot=slot))
    comp = _make_component(emits, song, constants)

    comp.disconnect()
    comp.handle_tap((), source_addr=None)
    comp.handle_hold((), source_addr=None)

    assert slot.fire_calls == 0
    assert song.create_calls == []


def test_disconnect_is_idempotent(emits, constants):
    song = StubSong()
    comp = _make_component(emits, song, constants)

    comp.disconnect()
    comp.disconnect()  # no exception


# --- address constants exposed on the class -------------------------------


def test_address_constants_match_module_constants():
    assert FootTriggerComponent.V3_FOOT_TAP_ADDRESS == V3_FOOT_TAP_ADDRESS
    assert FootTriggerComponent.V3_FOOT_HOLD_ADDRESS == V3_FOOT_HOLD_ADDRESS
    assert V3_FOOT_TAP_ADDRESS == "/looping/v3/foot/tap"
    assert V3_FOOT_HOLD_ADDRESS == "/looping/v3/foot/hold"


# --- SessionSettings auto_arm gate (2026-04-22) --------------------------


def test_hold_skips_arm_when_auto_arm_disabled(emits, constants):
    """With the gate off, the hold gesture still creates + names +
    routes the new track, just doesn't flip ``arm=True``. The track
    sits at whatever Live's audio-track template seeded it at."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = FootTriggerComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        constants=constants,
        schedule_delayed=None,
        should_auto_arm=lambda: False,
    )

    comp.handle_hold((), source_addr=None)

    new_track = song.tracks[0]
    assert new_track.name == "Audio"  # name still set
    assert new_track.input_routing_channel is routing  # routing still set
    assert new_track.arm is False  # arm skipped


def test_hold_arms_when_auto_arm_enabled(emits, constants):
    """Explicit default-getter wiring still arms — regression guard
    that the new arg doesn't silently break legacy behavior."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = FootTriggerComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        constants=constants,
        schedule_delayed=None,
        should_auto_arm=lambda: True,
    )

    comp.handle_hold((), source_addr=None)

    assert song.tracks[0].arm is True


def test_hold_default_getter_preserves_legacy_behavior(emits, constants):
    """No ``should_auto_arm`` arg → default ``lambda: True`` → legacy
    arm-on-hold behavior."""
    routing = StubRouting("11/12 Guitar Mic")

    def factory():
        return StubTrack(available=[routing])

    song = StubSong(track_factory=factory)
    comp = _make_component(emits, song, constants)  # no getter

    comp.handle_hold((), source_addr=None)

    assert song.tracks[0].arm is True
