"""WahPedalComponent tests.

Covers the two wah-pedal wires the Max patch emits:

- ``handle_engage`` (``/looping/v3/wah/engage``):
    * wah absent on selected track → load Wah.adg via the load closure
    * wah already loaded           → step Macro 2 (parameters[2]) to the
                                     next of the rack's chains (0↔127
                                     for a two-chain rack; falls back
                                     to that flip if chains < 2)
    * no selected track            → no-op (no load)
    * missing presetPath           → step still works, load skipped
- ``handle_freq`` (``/looping/v3/wah/freq [0-127]``):
    * cached macro                 → clamped write, no chain walk
    * out-of-range value           → clamped into the macro range
    * cold cache                   → resolve wah on selected track, write
    * stale cache (write raises)   → drop, re-resolve, write fresh
    * no wah / NaN                 → no-op
- Sweep-to-load: on a wah-less track a full expression-pedal rock (both
  ends of the CC range, either order, within ``sweepLoadMargin``) loads the
  rack at the head of the track's effects; a partial sweep never does, a load already in
  flight isn't stacked, and a selection change drops a half-sweep.
- Selection scoping (ADR-407 revision): a ``selected_track`` change drops
  the freq cache so the sweep re-targets the current track's wah (or starts
  a fresh sweep latch on a wah-less track) with no re-engage, and drops the
  load-in-flight guard.
- Two devices by track kind (ADR-445; MidiWheels since 2026-09-25): a MIDI
  track (``has_midi_input``) gets MidiWheels — engage loads it (and does
  nothing once it is there: no chains to step), freq sweeps its mod-wheel
  parameter, a full rock loads it — and an audio track the wah, exactly as
  before; a wah already on the track wins on either kind; no
  ``devices.midiWheels`` block means the wah everywhere; the load closure
  receives ``at_head`` per device (the wah's True, MidiWheels' False); a
  device-list change (``on_track_devices_changed``) drops the cache, the
  load guard and a half-sweep so a button-loaded wah takes the pedal over
  without a track switch.
- Config-driven ``freqMacroIndex`` + ``className``/``deviceName`` match.
- LOM raises are swallowed (never crash the surface).
- Selection listener is attached at init and detached on disconnect.
- Post-disconnect handlers are no-ops.

Value semantics mirror the surface's param write: the macro value is the
RAW device value clamped to ``[param.min, param.max]`` — a 0-127 CC lands
1:1 on a 0-127 macro.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import pytest

from components.MidiWheelsComponent import (
    CONFIG_KEY as MIDI_WHEELS_CONFIG_KEY,
    DEFAULT_CLASS_NAME as _WHEELS_CLASS_NAME,
    DEFAULT_DEVICE_NAME as _WHEELS_DEVICE_NAME,
)
from components.WahPedalComponent import (
    WahPedalComponent,
    V3_WAH_ENGAGE_ADDRESS,
    V3_WAH_FREQ_ADDRESS,
    _DEFAULT_WAH_CLASS_NAME,
    _DEFAULT_WAH_DEVICE_NAME,
)


# --- stubs ----------------------------------------------------------------


class StubParam:
    """A ``DeviceParameter`` slice: ``min`` / ``max`` / ``value``.

    ``raise_on_write`` simulates a torn-down handle so the freq re-resolve
    path can be exercised.
    """

    def __init__(self, value=0.0, minimum=0.0, maximum=127.0, raise_on_write=False):
        self.min = minimum
        self.max = maximum
        self._value = float(value)
        self._raise_on_write = raise_on_write
        self.writes: List[float] = []

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if self._raise_on_write:
            raise RuntimeError("stale param handle")
        self._value = float(v)
        self.writes.append(float(v))


class StubDevice:
    """An Audio Effect Rack slice: ``class_name`` / ``name`` / ``parameters``
    / ``chains``.

    ``parameters[0]`` is Device On; ``parameters[1..]`` are macros — matching
    Live's layout. Defaults to loaded-enabled (Device On = 1) with two chains
    (what the shipped ``Wah.adg`` carries), so the toggle macro steps 0↔127.
    ``chains=None`` simulates a rack whose chain list can't be read (the
    attribute is simply absent, so the LOM read raises).
    """

    def __init__(
        self,
        class_name=_DEFAULT_WAH_CLASS_NAME,
        name=_DEFAULT_WAH_DEVICE_NAME,
        freq_index=1,
        freq_param: Optional[StubParam] = None,
        device_on=1.0,
        toggle_index=2,
        toggle_value=0.0,
        chain_count=2,
    ):
        if chain_count is not None:
            self.chains = [object() for _ in range(chain_count)]
        self.class_name = class_name
        self.name = name
        # Device On + macros up to whichever of freq/toggle is higher.
        params = [StubParam(value=device_on, minimum=0.0, maximum=1.0)]
        while len(params) <= max(freq_index, toggle_index):
            params.append(StubParam(value=0.0, minimum=0.0, maximum=127.0))
        if freq_param is not None:
            params[freq_index] = freq_param
        params[toggle_index] = StubParam(
            value=toggle_value, minimum=0.0, maximum=127.0,
        )
        self.parameters = params
        self.canonical_parent = None  # set to the owning track in move tests


class StubView:
    """A ``song.view`` slice with a ``selected_track`` listener registry,
    mirroring Live's ``add/remove_selected_track_listener`` API."""

    def __init__(self, selected_track=None):
        self.selected_track = selected_track
        self.selected_track_listeners: List = []

    def add_selected_track_listener(self, cb):
        self.selected_track_listeners.append(cb)

    def remove_selected_track_listener(self, cb):
        self.selected_track_listeners.remove(cb)


class StubTrack:
    """A track slice: ``devices`` plus ``has_midi_input`` — False, an audio
    track, unless a test says otherwise (ADR-445 picks the rack by it)."""

    def __init__(self, devices=None, has_midi_input=False):
        self.devices = list(devices) if devices is not None else []
        self.has_midi_input = has_midi_input


class RaisingKindTrack(StubTrack):
    """A track whose ``has_midi_input`` read raises — a torn-down handle."""

    @property
    def has_midi_input(self):
        raise RuntimeError("LOM: torn-down track")

    @has_midi_input.setter
    def has_midi_input(self, _value):
        pass


class StubSong:
    def __init__(self, selected_track=None):
        self.view = StubView(selected_track=selected_track)
        self.move_calls: List[Tuple[object, object, int]] = []

    def move_device(self, device, parent, index):
        self.move_calls.append((device, parent, index))

    def select_track(self, track):
        """Change the selected track and fire the selection listeners — what
        Live does when the user (or the UI) selects a different track."""
        self.view.selected_track = track
        for cb in list(self.view.selected_track_listeners):
            cb()


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def constants():
    return {
        "devices": {
            "wah": {
                "presetPath": "/tmp/Wah.adg",
                "className": _DEFAULT_WAH_CLASS_NAME,
                "deviceName": _DEFAULT_WAH_DEVICE_NAME,
                "freqMacroIndex": 1,
                "toggleMacroIndex": 2,
            }
        }
    }


def _make_component(song, constants, loader=None):
    calls: List[Tuple[object, str]] = []
    at_head_calls: List[bool] = []

    def default_loader(track, preset_path, at_head=False, source="", rel=""):
        calls.append((track, preset_path))
        at_head_calls.append(at_head)
        return None  # success

    comp = WahPedalComponent(
        song=song,
        constants=constants,
        load_into_track=loader or default_loader,
    )
    comp.load_calls = calls  # type: ignore[attr-defined]
    comp.at_head_calls = at_head_calls  # type: ignore[attr-defined]
    return comp


# --- engage: load path ----------------------------------------------------


def test_engage_no_wah_loads_preset(constants):
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_engage_no_selected_track_is_noop(constants):
    song = StubSong(selected_track=None)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == []


def test_engage_missing_preset_path_skips_load(constants, monkeypatch):
    # No configured path and no checkout copy: nothing to load.
    from components import live_library
    monkeypatch.setattr(live_library, "WAH_REL", "no-such/Wah.adg")
    constants["devices"]["wah"].pop("presetPath")
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == []  # nothing to load, but no crash


def test_engage_load_failure_is_swallowed(constants):
    def failing_loader(track, preset_path, at_head=False, **kw):
        return "not-in-browser"

    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants, loader=failing_loader)

    comp.handle_engage((), source_addr=None)  # must not raise


# --- engage: step Macro 2 across the rack's chains (already loaded) --------


def test_engage_present_toggles_macro_from_0_to_127(constants):
    wah = StubDevice(toggle_value=0.0)
    track = StubTrack(devices=[wah])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert wah.parameters[2].value == 127.0  # 0 → 127
    assert wah.parameters[0].value == 1.0    # Device On untouched
    assert comp.load_calls == []             # already present — no reload


def test_engage_present_toggles_macro_from_127_to_0(constants):
    wah = StubDevice(toggle_value=127.0)
    track = StubTrack(devices=[wah])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert wah.parameters[2].value == 0.0    # 127 → 0


def test_engage_repeated_toggles_macro_back_and_forth(constants):
    wah = StubDevice(toggle_value=0.0)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)
    assert wah.parameters[2].value == 127.0
    comp.handle_engage((), source_addr=None)
    assert wah.parameters[2].value == 0.0
    comp.handle_engage((), source_addr=None)
    assert wah.parameters[2].value == 127.0


def test_engage_three_chains_steps_0_64_127_and_wraps(constants):
    """Three chains → three evenly-spaced macro steps, wrapping at the end."""
    wah = StubDevice(toggle_value=0.0, chain_count=3)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    seen = []
    for _ in range(4):
        comp.handle_engage((), source_addr=None)
        seen.append(wah.parameters[2].value)

    assert seen == [64.0, 127.0, 0.0, 64.0]


def test_engage_four_chains_steps_evenly_across_the_range(constants):
    """Four chains → 0 / 42 / 85 / 127. Even spacing (not a fixed 48-unit
    step) is what keeps each value inside its own chain-selector zone."""
    wah = StubDevice(toggle_value=0.0, chain_count=4)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    seen = []
    for _ in range(5):
        comp.handle_engage((), source_addr=None)
        seen.append(wah.parameters[2].value)

    assert seen == [42.0, 85.0, 127.0, 0.0, 42.0]


def test_engage_snaps_an_off_step_macro_to_the_next_step(constants):
    """A hand-dragged macro resumes from the nearest step, not from 0."""
    wah = StubDevice(toggle_value=80.0, chain_count=4)  # nearest step is 85
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert wah.parameters[2].value == 127.0


def test_engage_single_chain_falls_back_to_0_127_toggle(constants):
    """One chain has nothing to step through — keep the old flip."""
    wah = StubDevice(toggle_value=0.0, chain_count=1)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)
    assert wah.parameters[2].value == 127.0
    comp.handle_engage((), source_addr=None)
    assert wah.parameters[2].value == 0.0


def test_engage_unreadable_chains_falls_back_to_0_127_toggle(constants):
    """A raising ``chains`` read must not break the toe switch."""
    wah = StubDevice(toggle_value=0.0, chain_count=None)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert wah.parameters[2].value == 127.0


def test_engage_ignores_non_wah_rack(constants):
    """Another audio-effect rack on the track isn't mistaken for the wah."""
    other = StubDevice(name="Reverb Rack")
    track = StubTrack(devices=[other])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    # No wah found → it loads one rather than toggling the reverb.
    assert comp.load_calls == [(track, "/tmp/Wah.adg")]
    assert other.parameters[0].value == 1.0  # untouched


# --- freq -----------------------------------------------------------------


def test_freq_writes_cached_macro(constants):
    freq = StubParam(minimum=0.0, maximum=127.0)
    wah = StubDevice(freq_param=freq)
    track = StubTrack(devices=[wah])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    # Prime the cache via an engage (wah present → toggle Macro 2 + cache freq).
    comp.handle_engage((), source_addr=None)
    comp.handle_freq((64.0,), source_addr=None)

    assert freq.value == 64.0


def test_freq_clamps_above_max(constants):
    freq = StubParam(minimum=0.0, maximum=127.0)
    wah = StubDevice(freq_param=freq)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    # A toe-switch "on" value could accidentally be routed here; clamp protects.
    comp.handle_freq((200.0,), source_addr=None)

    assert freq.value == 127.0


def test_freq_cold_cache_resolves_from_selected_track(constants):
    freq = StubParam(minimum=0.0, maximum=127.0)
    wah = StubDevice(freq_param=freq)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    # No prior engage — cache is cold; freq must find the wah itself.
    comp.handle_freq((100.0,), source_addr=None)

    assert freq.value == 100.0


def test_freq_no_wah_is_noop(constants):
    song = StubSong(selected_track=StubTrack(devices=[]))
    comp = _make_component(song, constants)

    comp.handle_freq((50.0,), source_addr=None)  # must not raise


def test_freq_nan_is_noop(constants):
    freq = StubParam(minimum=0.0, maximum=127.0)
    wah = StubDevice(freq_param=freq)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_freq((float("nan"),), source_addr=None)

    assert freq.writes == []


def test_freq_stale_cache_re_resolves(constants):
    """A cached macro that raises on write is dropped and re-resolved."""
    stale = StubParam(minimum=0.0, maximum=127.0, raise_on_write=True)
    fresh = StubParam(minimum=0.0, maximum=127.0)

    wah_stale = StubDevice(freq_param=stale)
    track = StubTrack(devices=[wah_stale])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    # Prime cache to the stale param.
    comp.handle_engage((), source_addr=None)
    # Swap the track's wah for one with a live macro (simulates reload).
    track.devices = [StubDevice(freq_param=fresh)]

    comp.handle_freq((77.0,), source_addr=None)

    assert fresh.value == 77.0  # re-resolved and wrote the fresh macro


# --- config-driven index --------------------------------------------------


def test_custom_freq_macro_index(constants):
    constants["devices"]["wah"]["freqMacroIndex"] = 2
    freq = StubParam(minimum=0.0, maximum=127.0)
    # toggle_index=3 keeps the toggle macro off freq's index-2 slot.
    wah = StubDevice(freq_index=2, freq_param=freq, toggle_index=3)
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_freq((42.0,), source_addr=None)

    assert freq.value == 42.0


def test_negative_freq_index_writes_nothing(constants):
    """A misconfigured negative freqMacroIndex must not silently write
    params[-1] (the last parameter) — it resolves to no macro."""
    constants["devices"]["wah"]["freqMacroIndex"] = -1
    wah = StubDevice(freq_index=1)
    last = StubParam(minimum=0.0, maximum=127.0)
    wah.parameters[-1] = last  # params[-1] is what a bare `len > index` grabs
    song = StubSong(selected_track=StubTrack(devices=[wah]))
    comp = _make_component(song, constants)

    comp.handle_freq((64.0,), source_addr=None)

    assert last.writes == []  # negative index rejected, not written


# --- placement (ADR-094's intent, ADR-437's mechanism) ---------------------


def _appending_loader(store):
    """A load closure that simulates Live materializing the rack: appends a
    fresh wah to the track and records it in ``store['wah']``."""
    def loader(track, preset_path, at_head=False, **kw):
        wah = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
        wah.canonical_parent = track
        track.devices.append(wah)
        store["wah"] = wah
        return None
    return loader


def test_engage_load_never_moves_the_wah(constants):
    """ADR-437: the loader lands the wah at the head of the track's effects
    (``load_into_track(..., at_head=True)``); nothing is moved afterwards —
    undoing the move of a device Live had just loaded aborted Live. The
    rack is there when the load returns, so the next freq frame resolves it."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    store = {}
    comp = _make_component(song, constants, loader=_appending_loader(store))

    comp.handle_engage((), source_addr=None)   # loads
    assert store["wah"] in track.devices
    assert song.move_calls == []

    comp.handle_freq((64.0,), source_addr=None)  # resolves the fresh rack
    comp.handle_freq((70.0,), source_addr=None)
    assert song.move_calls == []
    assert comp._freq_param is store["wah"].parameters[1]


def test_present_wah_is_not_moved(constants):
    """A wah already on the track (not just loaded by the pedal) is left where
    the user put it — engage only toggles Macro 2."""
    wah = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[wah])
    wah.canonical_parent = track
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)
    comp.handle_freq((64.0,), source_addr=None)

    assert song.move_calls == []


def test_failed_load_leaves_a_later_wah_where_it_is(constants):
    """A load that fails changes nothing; a wah that later appears by other
    means is used where it is."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(
        song, constants, loader=lambda t, p, at_head=False, **kw: "not-in-browser",
    )

    comp.handle_engage((), source_addr=None)  # load fails → not armed

    later = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
    later.canonical_parent = track
    track.devices.append(later)
    comp.handle_freq((64.0,), source_addr=None)

    assert song.move_calls == []


# --- sweep-to-load --------------------------------------------------------


def test_full_sweep_on_wah_less_track_loads_the_wah(constants):
    """Rocking the expression pedal heel-to-toe summons the rack — the toe
    switch is no longer the only way in."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_freq((127.0,), source_addr=None)
    assert comp.load_calls == []          # one end only — not yet
    comp.handle_freq((0.0,), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_full_sweep_loads_in_either_direction(constants):
    """Toe-to-heel counts the same as heel-to-toe."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_partial_sweep_never_loads(constants):
    """A wide-but-incomplete rock must not summon anything — that's the
    whole reason the gesture is safe to leave armed."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    for value in (10.0, 60.0, 118.0, 60.0, 10.0, 118.0):
        comp.handle_freq((value,), source_addr=None)

    assert comp.load_calls == []


def test_sweep_tolerates_a_pedal_short_of_the_rails(constants):
    """Real pots stop a hair inside 0/127 — `sweepLoadMargin` covers that."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_freq((2.0,), source_addr=None)
    comp.handle_freq((125.0,), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_sweep_margin_is_configurable(constants):
    """margin 0 demands literal 0 and 127."""
    constants["devices"]["wah"]["sweepLoadMargin"] = 0
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_freq((1.0,), source_addr=None)
    comp.handle_freq((126.0,), source_addr=None)
    assert comp.load_calls == []

    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)
    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_sweep_does_not_stack_a_second_load_while_one_is_in_flight(constants):
    """A load whose rack is not visible yet (the loader here appends
    nothing) must not be stacked by a fast rock-back."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)   # loads
    comp.handle_freq((0.0,), source_addr=None)     # still materializing
    comp.handle_freq((127.0,), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_sweep_does_not_fire_when_the_track_already_has_a_wah(constants):
    """With a wah present the sweep is just a sweep."""
    freq = StubParam(minimum=0.0, maximum=127.0)
    track = StubTrack(devices=[StubDevice(freq_param=freq)])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)

    assert comp.load_calls == []
    assert freq.writes == [0.0, 127.0]


def test_half_sweep_is_dropped_by_a_selection_change(constants):
    """One end seen on track A must not combine with the other end on
    track B and drop a rack onto the track you just moved to."""
    track_a = StubTrack(devices=[])
    track_b = StubTrack(devices=[])
    song = StubSong(selected_track=track_a)
    comp = _make_component(song, constants)

    comp.handle_freq((0.0,), source_addr=None)
    song.select_track(track_b)
    comp.handle_freq((127.0,), source_addr=None)

    assert comp.load_calls == []


def test_sweep_load_never_moves_the_wah(constants):
    """A sweep-loaded wah is placed by the loader exactly as an engage-loaded
    one; no move follows (ADR-437)."""
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    store = {}
    comp = _make_component(song, constants, loader=_appending_loader(store))

    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)   # loads
    assert store["wah"] in track.devices
    assert song.move_calls == []

    comp.handle_freq((64.0,), source_addr=None)    # resolves the fresh rack
    assert song.move_calls == []


# --- selection scoping (ADR-407 revision) ---------------------------------


def test_selected_track_listener_attached_on_init(constants):
    """The component registers exactly one selection listener at init."""
    song = StubSong(selected_track=StubTrack(devices=[]))
    _make_component(song, constants)

    assert len(song.view.selected_track_listeners) == 1


def test_selection_change_retargets_freq_to_new_track(constants):
    """The sweep follows selection: after switching tracks the expression
    pedal drives the NEW track's wah and leaves the old one untouched — no
    re-engage required."""
    freq_a = StubParam(minimum=0.0, maximum=127.0)
    track_a = StubTrack(devices=[StubDevice(freq_param=freq_a)])
    freq_b = StubParam(minimum=0.0, maximum=127.0)
    track_b = StubTrack(devices=[StubDevice(freq_param=freq_b)])

    song = StubSong(selected_track=track_a)
    comp = _make_component(song, constants)

    # Engage + sweep on A → A's macro is cached and written.
    comp.handle_engage((), source_addr=None)
    comp.handle_freq((64.0,), source_addr=None)
    assert freq_a.value == 64.0

    # Switch to B (fires the listener) and sweep — without re-engaging.
    song.select_track(track_b)
    comp.handle_freq((100.0,), source_addr=None)

    assert freq_b.value == 100.0     # new track's wah driven
    assert freq_a.writes == [64.0]   # old track's wah NOT re-touched


def test_selection_change_to_wahless_track_makes_freq_noop(constants):
    """Switching to a track with no wah scopes the pedal to nothing — the
    old track's wah is not swept. This is the pollution the revision fixes."""
    freq_a = StubParam(minimum=0.0, maximum=127.0)
    track_a = StubTrack(devices=[StubDevice(freq_param=freq_a)])
    track_b = StubTrack(devices=[])  # no wah

    song = StubSong(selected_track=track_a)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)
    comp.handle_freq((64.0,), source_addr=None)
    assert freq_a.value == 64.0

    song.select_track(track_b)
    comp.handle_freq((100.0,), source_addr=None)  # B has no wah → no-op

    assert freq_a.writes == [64.0]  # A left untouched after navigating away


def test_selection_change_clears_pending_move_to_top(constants):
    """Loading a wah then navigating away before it resolves abandons the
    move-to-top, so a hand-placed wah on the newly-selected track isn't
    yanked to chain position 0."""
    track_a = StubTrack(devices=[])
    song = StubSong(selected_track=track_a)
    store = {}
    comp = _make_component(song, constants, loader=_appending_loader(store))

    comp.handle_engage((), source_addr=None)  # loads onto A, arms move-to-top

    # Navigate to B, which already carries its own (hand-placed) wah.
    wah_b = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track_b = StubTrack(devices=[wah_b])
    wah_b.canonical_parent = track_b
    song.select_track(track_b)

    comp.handle_freq((64.0,), source_addr=None)  # resolves B's wah

    assert song.move_calls == []  # B's wah left where the user placed it


# --- lifecycle ------------------------------------------------------------


def test_disconnect_detaches_selected_track_listener(constants):
    song = StubSong(selected_track=StubTrack(devices=[]))
    comp = _make_component(song, constants)

    comp.disconnect()

    assert song.view.selected_track_listeners == []


def test_disconnect_makes_handlers_noop(constants):
    freq = StubParam(minimum=0.0, maximum=127.0)
    wah = StubDevice(freq_param=freq)
    track = StubTrack(devices=[wah])
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.disconnect()
    comp.handle_engage((), source_addr=None)
    comp.handle_freq((64.0,), source_addr=None)

    assert comp.load_calls == []
    assert freq.writes == []


# --- two devices by track kind (ADR-445; MidiWheels since 2026-09-25) ------

_WHEELS_PATH = "/tmp/Vamp Devices/MidiWheels.amxd"


def _with_midi_wheels(constants):
    """Name the MIDI-track device the way constants.json does."""
    constants["devices"][MIDI_WHEELS_CONFIG_KEY] = {
        "devicePath": _WHEELS_PATH,
        "className": _WHEELS_CLASS_NAME,
        "deviceName": _WHEELS_DEVICE_NAME,
        "modParamIndex": 1,
        "pitchParamIndex": 2,
    }
    return constants


def _midi_wheels(**kw):
    """MidiWheels: Device On, Mod Wheel, Pitch Wheel — no chains."""
    kw.setdefault("class_name", _WHEELS_CLASS_NAME)
    kw.setdefault("name", _WHEELS_DEVICE_NAME)
    kw.setdefault("chain_count", None)
    return StubDevice(**kw)


def test_midi_track_engage_loads_midi_wheels_not_the_wah(constants):
    track = StubTrack(devices=[], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == [(track, _WHEELS_PATH)]
    # A MIDI effect goes where Live puts it — ahead of the instrument — so
    # the head-of-the-audio-effects placement is the wah's alone.
    assert comp.at_head_calls == [False]


def test_wah_load_lands_at_the_head_of_the_effects(constants):
    track = StubTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]
    assert comp.at_head_calls == [True]


def test_midi_track_full_sweep_loads_midi_wheels(constants):
    track = StubTrack(devices=[], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((0.0,), source_addr=None)
    assert comp.load_calls == []
    comp.handle_freq((127.0,), source_addr=None)

    assert comp.load_calls == [(track, _WHEELS_PATH)]


def test_midi_track_freq_sweeps_the_mod_wheel(constants):
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[rack], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((90.0,), source_addr=None)
    comp.handle_freq((91.0,), source_addr=None)

    assert rack.parameters[1].writes == [90.0, 91.0]
    assert comp.load_calls == []


def test_midi_track_engage_on_present_midi_wheels_does_nothing(constants):
    """MidiWheels has no chain selector: a toe press on a track that already
    has it neither loads a second copy nor touches the pitch wheel."""
    rack = _midi_wheels(toggle_value=8192.0)
    track = StubTrack(devices=[rack], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    for _ in range(3):
        comp.handle_engage((), source_addr=None)

    assert rack.parameters[2].writes == []
    assert rack.parameters[1].writes == []
    assert comp.load_calls == []


def test_engage_still_binds_the_sweep_to_present_midi_wheels(constants):
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[rack], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_engage((), source_addr=None)
    comp.handle_freq((33.0,), source_addr=None)

    assert rack.parameters[1].writes == [33.0]


def test_a_midi_wheels_the_screen_loaded_is_the_pedals_too(constants):
    """One device per track: a MidiWheels the on-screen wheels loaded (same
    class + name) is what the pedal finds — it never loads a second."""
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    track.devices.append(rack)          # the wheels' first touch loaded it
    comp.on_track_devices_changed(track)
    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)   # a full rock
    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == []
    assert rack.parameters[1].writes == [0.0, 127.0]


def test_a_wah_on_a_midi_track_wins_over_the_midi_wheels(constants):
    """Rule 1: a wah already on the track is what the pedal drives — that is
    how a wah gets onto a synth (the Pedal view's button loads it)."""
    wah = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[rack, wah], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((40.0,), source_addr=None)
    comp.handle_engage((), source_addr=None)

    assert wah.parameters[1].writes == [40.0]
    assert wah.parameters[2].writes == [127.0]
    assert rack.parameters[1].writes == [] and rack.parameters[2].writes == []


def test_midi_track_without_a_midi_wheels_block_gets_the_wah(constants):
    """No ``devices.midiWheels`` in constants: the pre-ADR-445 rig, the wah
    on every track."""
    track = StubTrack(devices=[], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]
    assert comp.at_head_calls == [True]


def test_audio_track_ignores_the_midi_wheels_config(constants):
    """Both gestures on an audio track still summon the wah, block or no
    block. (Two components: a load in flight guards the sweep, as ever.)"""
    track = StubTrack(devices=[], has_midi_input=False)
    song = StubSong(selected_track=track)
    constants = _with_midi_wheels(constants)

    by_toe = _make_component(song, constants)
    by_toe.handle_engage((), source_addr=None)
    assert by_toe.load_calls == [(track, "/tmp/Wah.adg")]
    assert by_toe.at_head_calls == [True]

    by_rock = _make_component(song, constants)
    by_rock.handle_freq((0.0,), source_addr=None)
    by_rock.handle_freq((127.0,), source_addr=None)
    assert by_rock.load_calls == [(track, "/tmp/Wah.adg")]
    assert by_rock.at_head_calls == [True]


def test_midi_wheels_on_an_audio_track_is_not_the_pedals(constants):
    """MidiWheels is a MIDI-track thing: on an audio track the pedal looks
    for the wah, so a stray MidiWheels there is neither swept nor
    stepped — engage loads the wah."""
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[rack], has_midi_input=False)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((50.0,), source_addr=None)
    comp.handle_engage((), source_addr=None)

    assert rack.parameters[1].writes == [] and rack.parameters[2].writes == []
    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_a_raising_has_midi_input_reads_as_an_audio_track(constants):
    track = RaisingKindTrack(devices=[])
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_engage((), source_addr=None)  # must not raise

    assert comp.load_calls == [(track, "/tmp/Wah.adg")]


def test_midi_wheels_block_without_a_path_still_drives_a_present_device(constants, monkeypatch):
    """Like the wah: no ``devicePath`` and no MidiWheels.amxd in the checkout
    (the derived path, 2026-09-26) disables the load leg only."""
    from components import live_library
    monkeypatch.setattr(live_library, "m4l_devices_root", lambda: "/nonexistent/Vamp Devices")
    constants = _with_midi_wheels(constants)
    constants["devices"][MIDI_WHEELS_CONFIG_KEY].pop("devicePath")
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    empty = StubTrack(devices=[], has_midi_input=True)
    with_rack = StubTrack(devices=[rack], has_midi_input=True)
    song = StubSong(selected_track=empty)
    comp = _make_component(song, constants)

    comp.handle_engage((), source_addr=None)          # nothing to load
    assert comp.load_calls == []

    song.select_track(with_rack)
    comp.handle_freq((12.0,), source_addr=None)
    assert rack.parameters[1].writes == [12.0]


def test_device_list_change_retargets_the_pedal_without_a_selection_change(constants):
    """The Pedal view's Wah button loads a wah onto the synth track the pedal
    is already sweeping; the device-list change drops the cached rack macro
    and the next frame drives the wah (rule 1) — no track switch needed."""
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[rack], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((10.0,), source_addr=None)
    assert rack.parameters[1].writes == [10.0]

    wah = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track.devices.append(wah)                          # the button's load
    comp.handle_freq((11.0,), source_addr=None)        # still cached
    assert rack.parameters[1].writes == [10.0, 11.0]

    comp.on_track_devices_changed(track)               # LOMListeners fanout
    comp.handle_freq((12.0,), source_addr=None)

    assert wah.parameters[1].writes == [12.0]
    assert rack.parameters[1].writes == [10.0, 11.0]


def test_device_list_change_hands_the_pedal_back_when_the_wah_goes(constants):
    wah = StubDevice(freq_param=StubParam(minimum=0.0, maximum=127.0))
    rack = _midi_wheels(freq_param=StubParam(minimum=0.0, maximum=127.0))
    track = StubTrack(devices=[rack, wah], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((10.0,), source_addr=None)
    assert wah.parameters[1].writes == [10.0]

    track.devices.remove(wah)                          # the button's hold
    comp.on_track_devices_changed(track)
    comp.handle_freq((20.0,), source_addr=None)

    assert rack.parameters[1].writes == [20.0]
    assert wah.parameters[1].writes == [10.0]


def test_device_list_change_drops_a_half_sweep_and_the_load_guard(constants):
    track = StubTrack(devices=[], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))

    comp.handle_freq((0.0,), source_addr=None)         # one end latched
    comp.on_track_devices_changed(track)
    comp.handle_freq((127.0,), source_addr=None)       # the other alone
    assert comp.load_calls == []

    comp.handle_freq((0.0,), source_addr=None)         # a whole rock loads
    assert comp.load_calls == [(track, _WHEELS_PATH)]
    comp.handle_freq((127.0,), source_addr=None)
    comp.handle_freq((0.0,), source_addr=None)         # guard: no second load
    assert comp.load_calls == [(track, _WHEELS_PATH)]

    comp.on_track_devices_changed(track)               # the walk decides now
    comp.handle_freq((127.0,), source_addr=None)
    comp.handle_freq((0.0,), source_addr=None)
    assert comp.load_calls == [(track, _WHEELS_PATH)] * 2


def test_device_list_change_after_disconnect_is_a_noop(constants):
    track = StubTrack(devices=[], has_midi_input=True)
    song = StubSong(selected_track=track)
    comp = _make_component(song, _with_midi_wheels(constants))
    comp.disconnect()

    comp.on_track_devices_changed(track)               # must not raise
    comp.handle_freq((0.0,), source_addr=None)
    comp.handle_freq((127.0,), source_addr=None)

    assert comp.load_calls == []


def test_addresses_are_stable():
    assert V3_WAH_ENGAGE_ADDRESS == "/looping/v3/wah/engage"
    assert V3_WAH_FREQ_ADDRESS == "/looping/v3/wah/freq"


def test_wah_path_falls_back_to_the_checkout(tmp_path, monkeypatch):
    # No configured path: the checkout's Vamp Devices/Wah/Wah.adg.
    from components import live_library
    from components.WahPedalComponent import wah_preset_path
    wah = tmp_path / "Wah" / "Wah.adg"
    wah.parent.mkdir()
    wah.write_bytes(b"")
    monkeypatch.setattr(live_library, "m4l_devices_root", lambda: str(tmp_path))
    assert wah_preset_path({}) == str(wah)
    assert wah_preset_path({"presetPath": "/x/Wah.adg"}) == "/x/Wah.adg"
