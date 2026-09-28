"""SessionComponent unit tests.

Covers the Gate 2 tempo surface: listener attach on init, fire emits
``/looping/session/tempo``, ``handle_get_tempo`` returns the current
value, and ``disconnect`` detaches the listener and is idempotent.

The tests run against a stub song that mimics LOM's observer
contract (``tempo`` attribute + ``add_tempo_listener`` /
``remove_tempo_listener`` methods). This is the first stub LOM object
the surface tests use; later gates will extend the pattern to
``Track``, ``Device``, ``DeviceParameter`` via the same approach.
The stub fires the listener callback **synchronously** on a
``.set_tempo(bpm)`` call, which matches LOM's observable semantics
(setting the attribute triggers subscribers inline).
"""

from __future__ import annotations

import pytest

from components.SessionComponent import (
    SessionComponent,
    V3_SESSION_IS_PLAYING_ADDRESS,
    V3_SESSION_SONG_TIME_ADDRESS,
)


# The PR-5d attrs with their initial values. Keep in sync with
# SessionComponent.PR5D_ATTRS; tests import SessionComponent.PR5D_ATTRS
# directly for iteration-based tests.
PR5D_STUB_INITIAL = {
    "is_playing": False,
    "metronome": False,
    "session_record": False,
    "loop": False,
    "loop_start": 0.0,
    "loop_length": 16.0,
    "signature_numerator": 4,
    "signature_denominator": 4,
    "root_note": 0,
    "scale_name": "Major",
    "scale_mode": False,
    "groove_amount": 0.0,
    "clip_trigger_quantization": 4,  # Live's default: 1 Bar
}


class StubSong:
    """Minimal stand-in for ``Live.Song.Song`` with observables.

    Supports one listener per property (tempo + PR-5d attrs). The v3
    framework itself uses 1:1 listener:property pairs so single-slot
    per attribute is the right default. A setter for each PR-5d attr
    fires that attribute's listener synchronously on write; writes
    through ``.attr = value`` (handler path) and through the
    ``set_<attr>(val)`` helpers (external-change path) both fire.
    """

    def __init__(self, tempo: float = 120.0, **pr5d_overrides):
        self._tempo = float(tempo)
        self._listener = None  # tempo listener (Gate 2/3)

        # PR-5d state + listeners. Keyed by attr_name — NOT lom_attr,
        # because the stub owns the storage and maps lom_attr →
        # attr_name through ``_LOM_TO_STUB``. Done this way so the
        # SessionComponent calls ``add_<lom>_listener`` (which targets
        # the real LOM naming) while the test reads attrs by the same
        # stable name.
        self._pr5d_state = dict(PR5D_STUB_INITIAL)
        self._pr5d_state.update(pr5d_overrides)
        self._pr5d_listeners = {k: None for k in PR5D_STUB_INITIAL}

        # Method-call tracking for the three command verbs. Each call
        # appends one tuple so tests can assert call order + counts.
        self.method_calls: list = []

        # Song position (throttled channel, not a PR-5d row).
        self._current_song_time = 0.0
        self._song_time_listener = None

    @property
    def tempo(self) -> float:
        return self._tempo

    @tempo.setter
    def tempo(self, bpm):
        """Mimics LOM: assignment fires the listener synchronously.

        Real LOM debounces internally (we see this empirically at Gate
        2 — a 60Hz UI drag produces one settling fire), but for unit
        tests the synchronous-fire shape is the worst case for the
        suppression flag and the cleanest thing to reason about.
        ``SessionComponent.handle_set_tempo`` uses this setter; the
        Gate 2 helper ``set_tempo()`` below is retained for tests that
        simulate an *external* tempo change (e.g., user grabs the BPM
        display in Live directly, with no Python write in flight).
        """
        self._tempo = float(bpm)
        if self._listener is not None:
            self._listener()

    def set_tempo(self, bpm: float) -> None:
        """Alias for the setter — reads clearly in tests of external change."""
        self.tempo = bpm

    # Song position --------------------------------------------------------
    @property
    def current_song_time(self) -> float:
        return self._current_song_time

    def advance_song_time(self, beats: float) -> None:
        """External change: the transport moved, LOM fires the listener."""
        self._current_song_time = float(beats)
        if self._song_time_listener is not None:
            self._song_time_listener()

    def add_current_song_time_listener(self, cb):
        assert self._song_time_listener is None
        self._song_time_listener = cb

    def remove_current_song_time_listener(self, cb):
        assert self._song_time_listener == cb
        self._song_time_listener = None

    # LOM observer contract -----------------------------------------------
    def add_tempo_listener(self, cb):
        assert self._listener is None, "StubSong supports one tempo listener"
        self._listener = cb

    def remove_tempo_listener(self, cb):
        # Use == rather than `is`: SessionComponent passes a freshly-
        # bound ``self._on_tempo_changed`` on each call, and bound
        # methods to the same function+instance compare equal but are
        # not identical. LOM itself uses equality semantics.
        assert self._listener == cb, "detaching a listener that wasn't attached"
        self._listener = None

    def has_tempo_listener(self) -> bool:
        return self._listener is not None

    # PR-5d attr access --------------------------------------------------
    #
    # The handler writes via ``setattr(song, lom_attr, val)`` and reads
    # via ``getattr(song, lom_attr)``. ``__getattr__`` fires only on
    # miss so the explicit ``_tempo`` / ``_listener`` / ``_pr5d_*``
    # attrs resolve through normal lookup without recursion.
    # ``__setattr__`` is total — we intercept every assignment and
    # dispatch PR-5d names to the state dict + listener fire.

    def __getattr__(self, name: str):
        if name in PR5D_STUB_INITIAL:
            return self._pr5d_state[name]
        raise AttributeError(name)

    def __setattr__(self, name: str, value) -> None:
        if name.startswith("_") or name == "method_calls":
            object.__setattr__(self, name, value)
            return
        if name == "tempo":
            # Fall back to the property descriptor on the class.
            StubSong.tempo.fset(self, value)
            return
        if name in PR5D_STUB_INITIAL:
            self._pr5d_state[name] = value
            cb = self._pr5d_listeners.get(name)
            if cb is not None:
                cb()
            return
        # Unknown attr — let attribute-error surface, same as LOM would.
        object.__setattr__(self, name, value)

    # PR-5d listener contract — add_<attr>_listener / remove_<attr>_listener
    # need to exist as bound methods the component can call. Implement
    # them with ``__getattr__``-style dynamic dispatch so we don't have
    # to hand-roll 22 methods.

    def _make_add_listener(self, attr: str):
        def _add(cb):
            assert self._pr5d_listeners[attr] is None, (
                "StubSong supports one %s listener" % attr,
            )
            self._pr5d_listeners[attr] = cb
        return _add

    def _make_remove_listener(self, attr: str):
        def _remove(cb):
            assert self._pr5d_listeners[attr] == cb, (
                "detaching %s listener that wasn't attached" % attr,
            )
            self._pr5d_listeners[attr] = None
        return _remove

    def __getattribute__(self, name: str):
        # ``__getattribute__`` is called for EVERY attribute access —
        # keep the hot path cheap. We only dynamically produce
        # add/remove listener methods for PR-5d attrs; everything else
        # falls through to normal lookup.
        if (name.startswith("add_") or name.startswith("remove_")) \
                and name.endswith("_listener"):
            # The ``add_tempo_listener`` / ``remove_tempo_listener``
            # pair is defined as real methods above; don't shadow them.
            if "tempo" not in name:
                try:
                    state = object.__getattribute__(
                        self, "_pr5d_listeners",
                    )
                except AttributeError:
                    state = None
                if state is not None:
                    if name.startswith("add_"):
                        attr = name[len("add_"):-len("_listener")]
                        if attr in state:
                            return object.__getattribute__(
                                self, "_make_add_listener",
                            )(attr)
                    else:
                        attr = name[len("remove_"):-len("_listener")]
                        if attr in state:
                            return object.__getattribute__(
                                self, "_make_remove_listener",
                            )(attr)
        return object.__getattribute__(self, name)

    # PR-5d external-change helper — keeps tests symmetrical with the
    # ``set_tempo`` helper at the top of the class.
    def fire_external(self, attr: str, value) -> None:
        """Simulate a user edit in Live: write + fire listener."""
        setattr(self, attr, value)

    def has_listener(self, attr: str) -> bool:
        return self._pr5d_listeners.get(attr) is not None

    # PR-5d command verbs — three no-arg methods. Record call order so
    # tests can assert play/stop/continue were invoked correctly.
    def start_playing(self) -> None:
        self.method_calls.append(("start_playing",))

    def stop_playing(self) -> None:
        self.method_calls.append(("stop_playing",))

    def continue_playing(self) -> None:
        self.method_calls.append(("continue_playing",))


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def captured_emits():
    """Collects ``(address, args)`` tuples that the component sends."""
    return []


@pytest.fixture
def make_component(captured_emits):
    """Factory: build a SessionComponent against a StubSong at a given tempo.

    PR-5d note: construction emits one seed per PR-5d attribute — 11
    emits on the wire before any test action. Most tests care about
    emits that happen *after* construction, so the factory clears
    ``captured_emits`` on the way out. Tests that specifically want
    to assert on the seed emits should not use this factory — they
    should build ``SessionComponent`` directly.
    """
    def _make(initial_tempo: float = 120.0):
        song = StubSong(tempo=initial_tempo)
        emit = lambda addr, args: captured_emits.append((addr, args))
        component = SessionComponent(song=song, emit=emit)
        captured_emits.clear()
        return song, component
    return _make


# --- attach / detach lifecycle --------------------------------------------


def test_attaches_listener_on_init(make_component):
    song, _component = make_component()
    assert song.has_tempo_listener()


def test_detach_is_idempotent(make_component):
    song, component = make_component()
    component.disconnect()
    assert not song.has_tempo_listener()
    # Second call must not raise, even though the listener is already
    # gone. LiveSurface.disconnect path expects this safety.
    component.disconnect()
    assert not song.has_tempo_listener()


def test_detach_tolerates_missing_remove_method(captured_emits):
    """If the song object is already gone, remove_* can raise; swallow."""
    class BrokenSong(StubSong):
        def remove_tempo_listener(self, cb):
            raise RuntimeError("song torn down")
    song = BrokenSong(tempo=120.0)
    component = SessionComponent(song=song, emit=lambda a, b: None)
    # Must not raise — log-and-continue semantics per SessionComponent.disconnect.
    component.disconnect()


# --- listener → observer emit ---------------------------------------------


def test_tempo_change_emits_observer_address(make_component, captured_emits):
    _song, _component = make_component(initial_tempo=120.0)
    _song.set_tempo(128.0)
    assert captured_emits == [("/looping/session/tempo", (128.0,))]


def test_multiple_tempo_changes_emit_in_order(make_component, captured_emits):
    song, _component = make_component(initial_tempo=120.0)
    for bpm in (121.0, 122.0, 123.5):
        song.set_tempo(bpm)
    assert captured_emits == [
        ("/looping/session/tempo", (121.0,)),
        ("/looping/session/tempo", (122.0,)),
        ("/looping/session/tempo", (123.5,)),
    ]


def test_tempo_read_error_is_swallowed(captured_emits):
    """If ``song.tempo`` read raises mid-fire, we log and return silently."""
    class ExplosiveSong(StubSong):
        def __init__(self):
            super().__init__(tempo=120.0)
            self._explode = False
        @property
        def tempo(self):
            if self._explode:
                raise RuntimeError("set closed mid-fire")
            return super().tempo
    song = ExplosiveSong()
    component = SessionComponent(song=song, emit=lambda a, b: captured_emits.append((a, b)))
    captured_emits.clear()  # discard PR-5d init-emits
    song._explode = True
    # Driving the listener manually rather than via set_tempo (which
    # would itself call .tempo and not help us here).
    component._on_tempo_changed()
    assert captured_emits == []


def test_observer_address_is_a_class_constant():
    """Catch accidental renames of the public wire contract."""
    assert SessionComponent.TEMPO_OBSERVER_ADDRESS == "/looping/session/tempo"


# --- /live/song/get/tempo handler -----------------------------------------


def test_get_tempo_returns_current_value(make_component):
    song, component = make_component(initial_tempo=120.0)
    song.set_tempo(135.5)
    # source_addr is not used by this handler — pass None to catch any
    # accidental reliance on it.
    reply = component.handle_get_tempo(args=(), source_addr=None)
    assert reply == (135.5,)


def test_get_tempo_reply_is_float(make_component):
    """AbletonOSC sends tempo as f32; handler must match that wire shape."""
    _song, component = make_component(initial_tempo=96)  # int initial
    reply = component.handle_get_tempo(args=(), source_addr=None)
    assert isinstance(reply[0], float)


# --- /live/song/set/tempo handler -----------------------------------------
#
# Write round-trip — no echo suppression. The listener's emit is what
# advances the UI tempo readout, so swallowing it leaves a dragged
# control stuck. Same "trust the listener echo" pattern as the PR-5d
# attrs. Covers: (a) happy-path write + emit, (b) reject paths (no
# write, no emit), (c) int/float coercion of the two UI writer shapes,
# (d) drag-burst settle — every fire emits.


def test_set_tempo_writes_and_emits_echo(make_component, captured_emits):
    """Happy path: handler writes; listener fires and emits the new value."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(128.0,), source_addr=None)
    assert song.tempo == 128.0
    # No suppression — UI store only updates from this echo.
    assert captured_emits == [("/looping/session/tempo", (128.0,))]


def test_set_tempo_accepts_int_arg(make_component, captured_emits):
    """``SystemCentralView.svelte`` sends int; handler must coerce."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(96,), source_addr=None)
    assert song.tempo == 96.0
    assert captured_emits == [("/looping/session/tempo", (96.0,))]


def test_set_tempo_accepts_float_arg(make_component, captured_emits):
    """``SessionHeaderV6.svelte`` sends float; handler must accept it."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(128.5,), source_addr=None)
    assert song.tempo == 128.5
    assert captured_emits == [("/looping/session/tempo", (128.5,))]


def test_set_tempo_rejects_below_min(make_component, captured_emits):
    """AbletonOSC-matching behaviour: <20 is dropped, not clamped."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(19.9,), source_addr=None)
    assert song.tempo == 120.0  # unchanged
    assert captured_emits == []  # no write → no listener fire


def test_set_tempo_rejects_above_max(make_component, captured_emits):
    """AbletonOSC-matching behaviour: >999 is dropped, not clamped."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(1000.0,), source_addr=None)
    assert song.tempo == 120.0
    assert captured_emits == []


def test_set_tempo_rejects_nan(make_component, captured_emits):
    """NaN compares false to all bounds; explicit NaN check guards LOM."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(float("nan"),), source_addr=None)
    assert song.tempo == 120.0
    assert captured_emits == []


def test_set_tempo_accepts_boundaries(make_component):
    """20.0 and 999.0 inclusive — matches LOM's property range."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(20.0,), source_addr=None)
    assert song.tempo == 20.0
    component.handle_set_tempo(args=(999.0,), source_addr=None)
    assert song.tempo == 999.0


def test_set_tempo_empty_args_is_noop(make_component, captured_emits):
    """Malformed OSC with no args: log and drop, no write."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(), source_addr=None)
    assert song.tempo == 120.0
    assert captured_emits == []


def test_set_tempo_bad_arg_type_is_noop(make_component, captured_emits):
    """Arg that can't coerce to float: log and drop, don't raise."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=("fast",), source_addr=None)
    assert song.tempo == 120.0
    assert captured_emits == []


def test_set_tempo_reject_does_not_swallow_next_external_change(
    make_component, captured_emits,
):
    """After a rejected write, a genuine external change still emits."""
    song, component = make_component(initial_tempo=120.0)
    component.handle_set_tempo(args=(1500.0,), source_addr=None)  # rejected
    # External change — e.g., user drags Live's BPM display directly.
    song.set_tempo(128.0)
    assert captured_emits == [("/looping/session/tempo", (128.0,))]


def test_set_tempo_returns_none(make_component):
    """``set/*`` is fire-and-forget; returning a tuple would auto-reply."""
    _song, component = make_component(initial_tempo=120.0)
    result = component.handle_set_tempo(args=(128.0,), source_addr=None)
    assert result is None


def test_set_tempo_burst_writes_emit_each_echo(make_component, captured_emits):
    """Simulate a UI drag: many writes in a row; every echo emits.

    Real LOM debounces so only the last write's listener fires; our
    StubSong fires synchronously on every write (worst case). Either
    way, the UI must see the echo of the latest accepted write so the
    readout follows the drag — that's the whole point of removing the
    suppression flag. Final song.tempo is the last written value, and
    the final emit matches it.
    """
    song, component = make_component(initial_tempo=120.0)
    writes = (121.0, 122.0, 123.0, 124.5, 125.0, 128.0)
    for bpm in writes:
        component.handle_set_tempo(args=(bpm,), source_addr=None)
    assert song.tempo == 128.0
    assert captured_emits == [
        ("/looping/session/tempo", (bpm,)) for bpm in writes
    ]


def test_set_tempo_assignment_error_does_not_emit(captured_emits):
    """If ``song.tempo = ...`` raises, the handler swallows it and no
    listener fires (so no emit). Guards the torn-down-song case."""
    class ExplodingSetSong(StubSong):
        # Override __setattr__ rather than the property — StubSong's
        # own __setattr__ bypasses subclass property overrides by
        # calling the base ``StubSong.tempo.fset`` directly.
        def __setattr__(self, name, value):
            if name == "tempo":
                raise RuntimeError("song torn down")
            super().__setattr__(name, value)

    song = ExplodingSetSong(tempo=120.0)
    component = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    # Drop construction-time PR-5d init emits — we only care about
    # what (if anything) the failed write produces.
    captured_emits.clear()
    component.handle_set_tempo(args=(128.0,), source_addr=None)
    assert captured_emits == []
    assert song.tempo == 120.0  # unchanged because setter raised


# =========================================================================
# PR-5d: 11 song-scoped attrs + 3 command verbs.
#
# Coverage strategy:
# - attach/init-emit: confirm every attr gets a listener and seeds once at
#   construction. Done at the class level (``_PR5D_ATTRS``) so adding a row
#   to the table automatically picks up coverage.
# - listener → emit: simulate an external change via ``fire_external`` and
#   verify the wire address + encoded args.
# - write handlers: happy-path write, bad args (empty / wrong type / NaN),
#   out-of-range reject. Each wire_type has distinct boundary behaviour, so
#   each gets its own suite.
# - commands: invocation path, args ignored, missing-method swallow.
# - disconnect: idempotent, detaches every attr.
# =========================================================================


V3 = "/looping/v3/session"

# Expected (address, wire_args) seed per PR-5d attr when StubSong carries
# its ``PR5D_STUB_INITIAL`` defaults. Keeps the init-emit assertion
# declarative; bool stub defaults encode to 0.
EXPECTED_INIT_EMITS = [
    (V3 + "/is_playing", (0,)),
    (V3 + "/metronome", (0,)),
    (V3 + "/session_record", (0,)),
    (V3 + "/loop", (0,)),
    (V3 + "/loop_start", (0.0,)),
    (V3 + "/loop_length", (16.0,)),
    (V3 + "/signature_num", (4,)),
    (V3 + "/signature_den", (4,)),
    (V3 + "/scale_root", (0,)),
    (V3 + "/scale_name", ("Major",)),
    (V3 + "/scale_mode", (0,)),
    (V3 + "/groove_amount", (0.0,)),
    (V3 + "/clip_trigger_quantization", (4,)),
]


# --- attach / init-emit ---------------------------------------------------


def test_pr5d_attaches_every_listener(captured_emits):
    """Every row in ``_PR5D_ATTRS`` lands a single listener on the song."""
    song = StubSong()
    _ = SessionComponent(song=song, emit=lambda a, b: None)
    # StubSong storage is keyed on the LOM attr name — some rows use a
    # different wire label (signature_num vs signature_numerator).
    for _attr_name, lom_attr, _wire, _addr in SessionComponent.PR5D_ATTRS:
        assert song.has_listener(lom_attr), (
            "PR-5d lom_attr %r did not get a listener attached" % lom_attr
        )


def test_pr5d_emits_one_seed_per_attr_on_init(captured_emits):
    """11 seed emits (+ none for tempo) land on the wire at construction."""
    song = StubSong()
    _ = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    # Order matches ``_PR5D_ATTRS`` iteration. The song-position seed
    # rides at the END (it is not a PR-5d row — see the song_time tests
    # below), so the pinned prefix is unchanged by its arrival.
    pr5d_emits = [
        (addr, args) for addr, args in captured_emits
        if addr != V3_SESSION_SONG_TIME_ADDRESS
    ]
    assert pr5d_emits == EXPECTED_INIT_EMITS
    assert captured_emits[-1][0] == V3_SESSION_SONG_TIME_ADDRESS


def test_pr5d_seed_reflects_stub_overrides(captured_emits):
    """Init-emit reads LOM state — overrides propagate to the wire."""
    song = StubSong(
        is_playing=True,
        metronome=True,
        loop_start=8.0,
        loop_length=32.0,
        signature_numerator=3,
        signature_denominator=8,
        root_note=5,
        scale_name="Minor",
    )
    _ = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    emits_by_addr = dict(captured_emits)
    assert emits_by_addr[V3 + "/is_playing"] == (1,)
    assert emits_by_addr[V3 + "/metronome"] == (1,)
    assert emits_by_addr[V3 + "/loop_start"] == (8.0,)
    assert emits_by_addr[V3 + "/loop_length"] == (32.0,)
    assert emits_by_addr[V3 + "/signature_num"] == (3,)
    assert emits_by_addr[V3 + "/signature_den"] == (8,)
    assert emits_by_addr[V3 + "/scale_root"] == (5,)
    assert emits_by_addr[V3 + "/scale_name"] == ("Minor",)


def test_pr5d_listener_attach_failure_is_per_attr(captured_emits):
    """A single attach failure should not block other attrs."""
    song = StubSong()
    # Monkey-patch: drop ``add_metronome_listener`` so it fails the
    # ``callable(add)`` gate. Other attrs remain.
    original_getattr = StubSong.__getattribute__
    def fake_getattribute(self, name):
        if name == "add_metronome_listener":
            raise AttributeError(name)
        return original_getattr(self, name)
    song.__class__ = type(
        "StubSongNoMetronome", (StubSong,),
        {"__getattribute__": fake_getattribute},
    )
    component = SessionComponent(song=song, emit=lambda a, b: None)
    # Every attr except metronome must have a listener stashed.
    attached = set(component._pr5d_listeners)
    expected = {a for a, *_ in SessionComponent.PR5D_ATTRS} - {"metronome"}
    assert attached == expected


# --- listener → emit ------------------------------------------------------


def test_is_playing_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("is_playing", True)
    assert captured_emits == [(V3 + "/is_playing", (1,))]


def test_metronome_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("metronome", True)
    song.fire_external("metronome", False)
    assert captured_emits == [
        (V3 + "/metronome", (1,)),
        (V3 + "/metronome", (0,)),
    ]


def test_session_record_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("session_record", True)
    assert captured_emits == [(V3 + "/session_record", (1,))]


def test_loop_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("loop", True)
    assert captured_emits == [(V3 + "/loop", (1,))]


def test_loop_start_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("loop_start", 4.5)
    assert captured_emits == [(V3 + "/loop_start", (4.5,))]


def test_loop_length_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("loop_length", 32.0)
    assert captured_emits == [(V3 + "/loop_length", (32.0,))]


def test_signature_num_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("signature_numerator", 7)
    assert captured_emits == [(V3 + "/signature_num", (7,))]


def test_signature_den_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("signature_denominator", 8)
    assert captured_emits == [(V3 + "/signature_den", (8,))]


def test_scale_root_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("root_note", 7)
    assert captured_emits == [(V3 + "/scale_root", (7,))]


def test_scale_name_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("scale_name", "Dorian")
    assert captured_emits == [(V3 + "/scale_name", ("Dorian",))]


def test_scale_mode_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("scale_mode", True)
    assert captured_emits == [(V3 + "/scale_mode", (1,))]


def test_groove_amount_change_emits(make_component, captured_emits):
    song, _component = make_component()
    song.fire_external("groove_amount", 0.42)
    assert captured_emits == [(V3 + "/groove_amount", (0.42,))]


def test_listener_fire_swallows_read_error(make_component, captured_emits):
    """If ``getattr(song, lom_attr)`` raises, warn-once and drop the fire."""
    song, component = make_component()
    # Find the metronome listener callback and drive it after breaking the attr.
    cb = component._pr5d_listeners["metronome"]
    def _bad_getattr(self, name):
        if name == "metronome":
            raise RuntimeError("LOM closed mid-fire")
        return super(StubSong, self).__getattribute__(name)
    song.__class__ = type(
        "StubSongExplodingMetronome", (StubSong,),
        {"__getattribute__": _bad_getattr},
    )
    cb()  # drive the listener manually
    assert captured_emits == []


# --- write handlers: bool01 ----------------------------------------------


@pytest.mark.parametrize(
    "handler_name,lom_attr,address",
    [
        ("handle_set_is_playing", "is_playing", V3 + "/is_playing"),
        ("handle_set_metronome", "metronome", V3 + "/metronome"),
        ("handle_set_session_record", "session_record", V3 + "/session_record"),
        ("handle_set_loop", "loop", V3 + "/loop"),
        ("handle_set_scale_mode", "scale_mode", V3 + "/scale_mode"),
    ],
)
def test_bool01_handler_writes_and_echoes(
    make_component, captured_emits, handler_name, lom_attr, address,
):
    """Write 1 → LOM becomes True, listener fires, wire carries 1."""
    song, component = make_component()
    handler = getattr(component, handler_name)
    handler(args=(1,), source_addr=None)
    assert getattr(song, lom_attr) is True
    # No echo suppression — the listener fires and the wire carries it.
    assert captured_emits == [(address, (1,))]


@pytest.mark.parametrize(
    "handler_name,lom_attr",
    [
        ("handle_set_is_playing", "is_playing"),
        ("handle_set_metronome", "metronome"),
        ("handle_set_session_record", "session_record"),
        ("handle_set_loop", "loop"),
        ("handle_set_scale_mode", "scale_mode"),
    ],
)
def test_bool01_handler_writes_zero(
    make_component, captured_emits, handler_name, lom_attr,
):
    song, component = make_component()
    # Start from True so writing 0 produces a visible state change.
    setattr(song, lom_attr, True)
    captured_emits.clear()
    getattr(component, handler_name)(args=(0,), source_addr=None)
    assert getattr(song, lom_attr) is False


@pytest.mark.parametrize(
    "handler_name,lom_attr",
    [
        ("handle_set_is_playing", "is_playing"),
        ("handle_set_metronome", "metronome"),
    ],
)
def test_bool01_handler_rejects_non_01_int(
    make_component, captured_emits, handler_name, lom_attr,
):
    """Any int that isn't 0 or 1 is rejected — UI bug vs silent rounding."""
    song, component = make_component()
    before = getattr(song, lom_attr)
    getattr(component, handler_name)(args=(7,), source_addr=None)
    assert getattr(song, lom_attr) == before
    assert captured_emits == []


def test_bool01_handler_rejects_string(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_metronome(args=("on",), source_addr=None)
    assert song.metronome is False
    assert captured_emits == []


def test_bool01_handler_empty_args_is_noop(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_is_playing(args=(), source_addr=None)
    assert song.is_playing is False
    assert captured_emits == []


# --- write handlers: loop_start / loop_length ----------------------------


def test_loop_start_accepts_positive(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_start(args=(8.5,), source_addr=None)
    assert song.loop_start == 8.5
    assert captured_emits == [(V3 + "/loop_start", (8.5,))]


def test_loop_start_accepts_zero(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_start(args=(0.0,), source_addr=None)
    assert song.loop_start == 0.0


def test_loop_start_rejects_negative(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_start(args=(-1.0,), source_addr=None)
    assert song.loop_start == 0.0  # unchanged
    assert captured_emits == []


def test_loop_start_rejects_nan(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_start(args=(float("nan"),), source_addr=None)
    assert captured_emits == []


def test_loop_length_accepts_positive(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_length(args=(32.0,), source_addr=None)
    assert song.loop_length == 32.0
    assert captured_emits == [(V3 + "/loop_length", (32.0,))]


def test_loop_length_rejects_zero(make_component, captured_emits):
    """loop_length must be strictly positive — zero would break Live's loop."""
    song, component = make_component()
    component.handle_set_loop_length(args=(0.0,), source_addr=None)
    assert song.loop_length == 16.0  # unchanged
    assert captured_emits == []


def test_loop_length_rejects_negative(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_length(args=(-4.0,), source_addr=None)
    assert song.loop_length == 16.0
    assert captured_emits == []


def test_loop_length_rejects_nan(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_length(args=(float("nan"),), source_addr=None)
    assert captured_emits == []


def test_loop_start_rejects_bad_arg_type(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_start(args=("eight",), source_addr=None)
    assert song.loop_start == 0.0
    assert captured_emits == []


def test_loop_start_empty_args_is_noop(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_loop_start(args=(), source_addr=None)
    assert captured_emits == []


# --- write handlers: signature_num / signature_den ------------------------


def test_signature_num_accepts_valid(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_signature_num(args=(7,), source_addr=None)
    assert song.signature_numerator == 7


def test_signature_num_accepts_boundaries(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_signature_num(args=(1,), source_addr=None)
    assert song.signature_numerator == 1
    component.handle_set_signature_num(args=(99,), source_addr=None)
    assert song.signature_numerator == 99


def test_signature_num_rejects_zero(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_signature_num(args=(0,), source_addr=None)
    assert song.signature_numerator == 4


def test_signature_num_rejects_above_max(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_signature_num(args=(100,), source_addr=None)
    assert song.signature_numerator == 4


def test_signature_num_rejects_bad_type(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_signature_num(args=("four",), source_addr=None)
    assert song.signature_numerator == 4


def test_signature_den_accepts_valid_denominators(
    make_component, captured_emits,
):
    song, component = make_component()
    for den in (1, 2, 4, 8, 16):
        component.handle_set_signature_den(args=(den,), source_addr=None)
        assert song.signature_denominator == den


def test_signature_den_rejects_non_power_of_two(make_component, captured_emits):
    """Live rejects 3, 5, 6, 7, ... with a warning box — reject on wire."""
    song, component = make_component()
    for den in (0, 3, 5, 6, 7, 9, 32):
        component.handle_set_signature_den(args=(den,), source_addr=None)
        assert song.signature_denominator == 4


# --- write handlers: scale_root -------------------------------------------


def test_scale_root_accepts_boundaries(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_root(args=(0,), source_addr=None)
    assert song.root_note == 0
    component.handle_set_scale_root(args=(11,), source_addr=None)
    assert song.root_note == 11


def test_scale_root_rejects_below(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_root(args=(-1,), source_addr=None)
    assert song.root_note == 0


def test_scale_root_rejects_above(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_root(args=(12,), source_addr=None)
    assert song.root_note == 0


def test_scale_root_rejects_bad_type(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_root(args=("C",), source_addr=None)
    assert song.root_note == 0


# --- write handlers: scale_name -------------------------------------------


def test_scale_name_accepts_short_string(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_name(args=("Dorian",), source_addr=None)
    assert song.scale_name == "Dorian"
    assert captured_emits == [(V3 + "/scale_name", ("Dorian",))]


def test_scale_name_rejects_empty_string(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_name(args=("",), source_addr=None)
    assert song.scale_name == "Major"  # unchanged


def test_scale_name_rejects_too_long(make_component, captured_emits):
    song, component = make_component()
    too_long = "X" * 65
    component.handle_set_scale_name(args=(too_long,), source_addr=None)
    assert song.scale_name == "Major"


def test_scale_name_rejects_non_string(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_name(args=(7,), source_addr=None)
    assert song.scale_name == "Major"


def test_scale_name_accepts_lives_longest_name_and_refuses_a_long_stranger(make_component, captured_emits):
    """Membership in Live's 35 names is the whole guard (ADR-446): a 64-char
    stranger is refused, the longest real name goes through."""
    song, component = make_component()
    component.handle_set_scale_name(args=("X" * 64,), source_addr=None)
    assert song.scale_name == "Major"
    component.handle_set_scale_name(args=("Phrygian Dominant",), source_addr=None)
    assert song.scale_name == "Phrygian Dominant"


# --- command handlers -----------------------------------------------------


def test_play_cmd_invokes_start_playing(make_component):
    song, component = make_component()
    component.handle_play_cmd(args=(), source_addr=None)
    assert song.method_calls == [("start_playing",)]


def test_stop_cmd_invokes_stop_playing(make_component):
    song, component = make_component()
    component.handle_stop_cmd(args=(), source_addr=None)
    assert song.method_calls == [("stop_playing",)]


def test_continue_cmd_invokes_continue_playing(make_component):
    song, component = make_component()
    component.handle_continue_cmd(args=(), source_addr=None)
    assert song.method_calls == [("continue_playing",)]


def test_play_cmd_ignores_extra_args(make_component):
    """Commands are fire-and-forget — extra args on the wire are discarded."""
    song, component = make_component()
    component.handle_play_cmd(args=(1, 2, 3), source_addr=None)
    assert song.method_calls == [("start_playing",)]


def test_play_cmd_returns_none(make_component):
    _song, component = make_component()
    assert component.handle_play_cmd(args=(), source_addr=None) is None


def test_command_missing_method_is_swallowed(captured_emits):
    """If ``song.start_playing`` doesn't exist, warn and drop."""
    class NoPlaySong(StubSong):
        start_playing = None  # not callable
    song = NoPlaySong()
    component = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    # Must not raise.
    component.handle_play_cmd(args=(), source_addr=None)


def test_command_method_raise_is_swallowed(captured_emits):
    class RaisingSong(StubSong):
        def start_playing(self):
            raise RuntimeError("torn down")
    song = RaisingSong()
    component = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    # Must not raise.
    component.handle_play_cmd(args=(), source_addr=None)


# --- write handlers: groove_amount (float in [0.0, 1.0]) ------------------


def test_groove_amount_accepts_zero(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(0.0,), source_addr=None)
    assert song.groove_amount == 0.0


def test_groove_amount_accepts_one(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(1.0,), source_addr=None)
    assert song.groove_amount == 1.0
    assert captured_emits == [(V3 + "/groove_amount", (1.0,))]


def test_groove_amount_accepts_midrange(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(0.5,), source_addr=None)
    assert song.groove_amount == 0.5
    assert captured_emits == [(V3 + "/groove_amount", (0.5,))]


def test_groove_amount_rejects_negative(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(-0.1,), source_addr=None)
    assert song.groove_amount == 0.0
    assert captured_emits == []


def test_groove_amount_rejects_above_one(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(1.5,), source_addr=None)
    assert song.groove_amount == 0.0
    assert captured_emits == []


def test_groove_amount_rejects_nan(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(float("nan"),), source_addr=None)
    assert song.groove_amount == 0.0
    assert captured_emits == []


def test_groove_amount_rejects_bad_arg_type(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=("half",), source_addr=None)
    assert song.groove_amount == 0.0
    assert captured_emits == []


def test_groove_amount_empty_args_is_noop(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_groove_amount(args=(), source_addr=None)
    assert song.groove_amount == 0.0
    assert captured_emits == []


# --- write handlers: clip_trigger_quantization (int enum 0..13) -----------
#
# Live's global launch quantization. 0 = None, 13 = 1/32; the stub
# starts at 4 ("1 Bar", Live's own default).


CTQ = V3 + "/clip_trigger_quantization"


@pytest.mark.parametrize("value", [0, 1, 4, 7, 13])
def test_ctq_accepts_every_in_range_value(
    make_component, captured_emits, value,
):
    song, component = make_component()
    component.handle_set_clip_trigger_quantization(
        args=(value,), source_addr=None,
    )
    assert song.clip_trigger_quantization == value
    # Listener attached → exactly one echo, from the listener, and the
    # write-echo fallback stays inert.
    assert captured_emits == [(CTQ, (value,))]


@pytest.mark.parametrize("value", [-1, 14, 99])
def test_ctq_rejects_out_of_range(make_component, captured_emits, value):
    """Out-of-range rejects rather than clamping — no silent 1/32 park."""
    song, component = make_component()
    component.handle_set_clip_trigger_quantization(
        args=(value,), source_addr=None,
    )
    assert song.clip_trigger_quantization == 4  # unchanged
    assert captured_emits == []


def test_ctq_rejects_bad_arg_type(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_clip_trigger_quantization(
        args=("1 Bar",), source_addr=None,
    )
    assert song.clip_trigger_quantization == 4
    assert captured_emits == []


def test_ctq_empty_args_is_noop(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_clip_trigger_quantization(args=(), source_addr=None)
    assert song.clip_trigger_quantization == 4
    assert captured_emits == []


def test_ctq_external_change_emits(make_component, captured_emits):
    """A user changing the transport-bar dropdown in Live reaches the UI."""
    song, component = make_component()
    song.fire_external("clip_trigger_quantization", 9)
    assert captured_emits == [(CTQ, (9,))]


# --- listener-less fallback (_ECHO_ON_WRITE) ------------------------------
#
# Live 12 exposes attrs that are observable on paper and listener-less
# in practice (Groove.base, Track.fold_state). These two tests pin the
# fallback that keeps the control usable if clip_trigger_quantization
# turns out to be one of them.


@pytest.fixture
def listenerless_ctq(monkeypatch, captured_emits):
    """Build a component against a song with no CTQ listener slot."""
    song = StubSong()
    real_getattribute = StubSong.__getattribute__

    def _no_ctq_listener(self, name):
        if name == "add_clip_trigger_quantization_listener":
            raise AttributeError(name)
        return real_getattribute(self, name)

    monkeypatch.setattr(StubSong, "__getattribute__", _no_ctq_listener)
    component = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    return song, component


def test_ctq_seeds_even_without_a_listener(listenerless_ctq, captured_emits):
    """Seed skips attrs whose listener failed — except _ECHO_ON_WRITE ones."""
    _song, _component = listenerless_ctq
    assert (CTQ, (4,)) in captured_emits


def test_ctq_write_echoes_when_listenerless(listenerless_ctq, captured_emits):
    """No listener means no fire — the write handler publishes instead."""
    song, component = listenerless_ctq
    captured_emits.clear()
    component.handle_set_clip_trigger_quantization(args=(9,), source_addr=None)
    assert song.clip_trigger_quantization == 9
    assert captured_emits == [(CTQ, (9,))]


def test_ctq_rejected_write_does_not_echo_when_listenerless(
    listenerless_ctq, captured_emits,
):
    song, component = listenerless_ctq
    captured_emits.clear()
    component.handle_set_clip_trigger_quantization(args=(42,), source_addr=None)
    assert song.clip_trigger_quantization == 4
    assert captured_emits == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_every_pr5d_listener(make_component):
    song, component = make_component()
    component.disconnect()
    for _attr_name, lom_attr, *_ in SessionComponent.PR5D_ATTRS:
        assert not song.has_listener(lom_attr), (
            "PR-5d lom_attr %r still has a listener after disconnect" % lom_attr
        )


def test_disconnect_is_idempotent_for_pr5d(make_component):
    _song, component = make_component()
    component.disconnect()
    # Second call must not raise even though every listener is gone.
    component.disconnect()


# --- emit_on_accept (cold-start gap fix, 2026-04-18) --------------------
#
# Found during PR-5d live validation: init-emit fires at surface
# ``__init__``, long before the UI connects on cold-start. State/full
# (which IS re-emitted on handshake accept) is track-scoped and does
# not carry song attrs. So ``emit_on_accept`` closes the gap by
# re-emitting every PR-5d attr plus tempo on the accept path.


def test_emit_on_accept_reemits_every_pr5d_attr(make_component, captured_emits):
    """One packet per PR-5d attr, plus tempo — 12 total on accept."""
    _song, component = make_component(initial_tempo=128.0)
    component.emit_on_accept()
    # Tempo first (legacy address), then 11 PR-5d in table order.
    assert captured_emits[0] == ("/looping/session/tempo", (128.0,))
    assert captured_emits[1:] == EXPECTED_INIT_EMITS


def test_emit_on_accept_reflects_live_state_at_call_time(
    make_component, captured_emits,
):
    """Reads current LOM values — not cached from ``__init__``."""
    song, component = make_component()
    # Simulate Live-side changes that happened while UI was offline.
    setattr(song, "metronome", True)
    setattr(song, "is_playing", True)
    setattr(song, "signature_numerator", 3)
    captured_emits.clear()
    component.emit_on_accept()
    emits_by_addr = dict(captured_emits)
    assert emits_by_addr[V3 + "/metronome"] == (1,)
    assert emits_by_addr[V3 + "/is_playing"] == (1,)
    assert emits_by_addr[V3 + "/signature_num"] == (3,)


def test_emit_on_accept_idempotent_safe_to_call_twice(
    make_component, captured_emits,
):
    _song, component = make_component()
    component.emit_on_accept()
    first_count = len(captured_emits)
    component.emit_on_accept()
    # Second call emits the same packets — fine. Re-accept after an
    # idle-timeout reconnect should re-seed the UI cleanly.
    assert len(captured_emits) == 2 * first_count


def test_emit_on_accept_tempo_read_error_swallowed(
    make_component, captured_emits, monkeypatch,
):
    """Tempo read failure during on_accept must not block the 11 PR-5d re-emits."""
    song, component = make_component()
    # Break only the tempo getter after construction so __init__'s
    # tempo read succeeds. Mirrors the torn-down-song case — LOM
    # attribute-access raising RuntimeError mid-session — without
    # forcing a real Song teardown.
    raise_on_tempo = {"armed": False}
    original_tempo = type(song).tempo

    def _bad_get(self):
        if raise_on_tempo["armed"]:
            raise RuntimeError("tempo gone")
        return original_tempo.fget(self)

    monkeypatch.setattr(
        type(song), "tempo",
        property(_bad_get, original_tempo.fset),
        raising=True,
    )
    raise_on_tempo["armed"] = True
    component.emit_on_accept()
    # Tempo skipped; all 11 PR-5d emits still present.
    assert captured_emits == EXPECTED_INIT_EMITS


def test_disconnect_prevents_later_emits(make_component, captured_emits):
    """After disconnect, external changes do not fire through emit.

    Real LOM would have detached the listener and the callback wouldn't
    fire at all. The stub detaches too, so this is a belt-and-braces
    check that ``_disconnected`` inside the closure short-circuits if
    anything did slip through.
    """
    song, component = make_component()
    component.disconnect()
    # StubSong's detach clears the listener slot, so fire_external
    # has nothing to call — captured_emits stays empty either way.
    song.fire_external("metronome", True)
    assert captured_emits == []


# ---------------------------------------------------------------------------
# Song position (`/looping/v3/session/song_time`)
#
# Nothing on the v3 wire carried song position before this, so the UI's
# transport header sat on its store's cold-start zero and showed a frozen
# `1.1.0` for the whole session. The channel is deliberately NOT a PR-5d
# row: `current_song_time` fires on every LOM tick while the transport
# runs, so it carries its own throttle, and these pin that it is the
# throttle — not the listener — doing the limiting.
# ---------------------------------------------------------------------------

# Ahead of any real `time.monotonic()` (which the construction seed
# stamps): a fake clock BEHIND it makes every later fire look like it
# landed inside the throttle window.
FAKE_NOW = 1e9


def _song_time_emits(emits):
    return [args for addr, args in emits if addr == V3_SESSION_SONG_TIME_ADDRESS]


def test_song_time_seeds_once_at_construction(captured_emits):
    """A UI connecting to a STOPPED transport still learns where it is."""
    song = StubSong(tempo=120.0)
    song._current_song_time = 6.5
    SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    assert _song_time_emits(captured_emits) == [(6.5,)]


def test_song_time_emits_on_transport_movement(
    make_component, captured_emits, monkeypatch
):
    song, _component = make_component()
    # Past the construction seed's window, or the throttle eats this.
    monkeypatch.setattr(
        "components.SessionComponent.time.monotonic", lambda: FAKE_NOW,
    )
    song.advance_song_time(4.25)
    assert _song_time_emits(captured_emits) == [(4.25,)]


def test_song_time_throttles_a_burst_to_one_emit(
    make_component, captured_emits, monkeypatch
):
    """LOM fires this continuously; the wire must not carry every tick."""
    song, _component = make_component()
    # Freeze the clock so every fire lands inside one window.
    monkeypatch.setattr(
        "components.SessionComponent.time.monotonic", lambda: FAKE_NOW,
    )
    for beat in (1.0, 1.1, 1.2, 1.3, 1.4):
        song.advance_song_time(beat)
    assert len(_song_time_emits(captured_emits)) <= 1


def test_song_time_resumes_after_the_window_elapses(
    make_component, captured_emits, monkeypatch
):
    song, _component = make_component()
    clock = {"now": FAKE_NOW}
    monkeypatch.setattr(
        "components.SessionComponent.time.monotonic", lambda: clock["now"],
    )
    song.advance_song_time(1.0)
    clock["now"] += 1.0  # well past the 100ms window
    song.advance_song_time(2.0)
    assert _song_time_emits(captured_emits)[-1] == (2.0,)
    assert len(_song_time_emits(captured_emits)) == 2


def test_song_time_listener_is_detached_on_disconnect(make_component):
    song, component = make_component()
    component.disconnect()
    assert song._song_time_listener is None


def test_song_time_absent_listener_does_not_block_construction(captured_emits):
    """A Live build without the observable still boots everything else."""
    class NoSongTimeSong(StubSong):
        add_current_song_time_listener = None

    song = NoSongTimeSong(tempo=120.0)
    component = SessionComponent(
        song=song, emit=lambda a, b: captured_emits.append((a, b)),
    )
    assert _song_time_emits(captured_emits) == []
    # The PR-5d seeds still went out.
    assert any(
        addr == V3_SESSION_IS_PLAYING_ADDRESS for addr, _ in captured_emits
    )
    component.disconnect()


# --- ADR-446: scale_name is validated against Live's vocabulary -------------

def test_set_scale_name_accepts_one_of_lives_names(make_component, captured_emits):
    song, component = make_component()
    component.handle_set_scale_name(("Dorian",), None)
    assert song.scale_name == "Dorian"


def test_set_scale_name_rejects_a_name_live_would_silently_replace(make_component, captured_emits):
    """Live answers an unknown scale name by switching to Major without
    raising (measured on 12.4.15b3), so the surface refuses it instead."""
    song, component = make_component()
    component.handle_set_scale_name(("Not A Scale",), None)
    assert song.scale_name == "Major"
    assert captured_emits == []
