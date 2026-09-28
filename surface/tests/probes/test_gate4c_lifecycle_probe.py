"""LifecycleProbe unit tests.

Gate 4c's full verdict comes from a live operator-driven run —
song-change survival and quit-teardown cannot be simulated without
Live. What these tests *can* cover is the probe's own scaffolding:
snapshot shape, fire counter, disconnect idempotence, decorator
companion construction (with a stub base class), and the error
paths that keep the surface alive when the decorator binding fails.

The tests use the same ``StubSong`` shape ``test_session_component``
introduced; identical contract (``tempo`` attribute +
``add_tempo_listener`` / ``remove_tempo_listener``, setter fires the
listener synchronously).
"""

from __future__ import annotations

import pytest

from components.LifecycleProbe import (
    LifecycleDecoratorProbe,
    LifecycleProbe,
    PHASE_ACTIVE,
    PHASE_DISCONNECTED,
    PHASE_INIT,
    POKE_ADDRESS,
    QUERY_ADDRESS,
    SNAPSHOT_ADDRESS,
    TEARDOWN_ADDRESS,
)


# --- fakes ------------------------------------------------------------------


class StubSong:
    """Same shape as ``test_session_component.StubSong``, inlined.

    Kept local to this test module so the two probe test files stay
    self-contained; when a third gate needs it we extract into
    ``tests/support/`` rather than leaving the duplication to breed.
    """

    def __init__(self, tempo=120.0):
        self._tempo = float(tempo)
        self._listener = None

    @property
    def tempo(self):
        return self._tempo

    @tempo.setter
    def tempo(self, bpm):
        # LOM fires even on identical-value writes — see Gate 3
        # analysis. The probe relies on this for its ``poke`` handler.
        self._tempo = float(bpm)
        if self._listener is not None:
            self._listener()

    def add_tempo_listener(self, cb):
        if self._listener is not None:
            raise AssertionError("tempo listener already attached")
        self._listener = cb

    def remove_tempo_listener(self, cb):
        # ``==`` rather than ``is`` so bound methods compare
        # structurally (``self.x == self.x`` is True across attribute
        # accesses even though the method objects are distinct). This
        # mirrors LOM's own behaviour — the real Live API stores the
        # callback and finds it by equality.
        if self._listener != cb:
            raise AssertionError("removing unexpected tempo listener")
        self._listener = None


class EmitCapture:
    def __init__(self):
        self.events = []

    def __call__(self, address, args):
        self.events.append((address, tuple(args)))


# --- fixtures ---------------------------------------------------------------


@pytest.fixture
def song():
    return StubSong()


@pytest.fixture
def emit():
    return EmitCapture()


@pytest.fixture
def probe(song, emit):
    # song_id_getter is overridden to a deterministic value so tests
    # can assert the snapshot tuple exactly. Defaults would pick up
    # ``id(song)`` which is flaky across runs.
    return LifecycleProbe(
        song=song,
        emit=emit,
        song_id_getter=lambda: 42,
    )


# --- address / phase constants ---------------------------------------------


def test_address_constants_stable():
    # The driver script and the operator procedure in the module
    # docstring both encode these strings; freezing them here catches
    # silent renames. Same pattern as Gate 4a/4b probe tests.
    assert QUERY_ADDRESS == "/looping/probe/lifecycle_query"
    assert POKE_ADDRESS == "/looping/probe/lifecycle_poke"
    assert SNAPSHOT_ADDRESS == "/looping/probe/lifecycle_snapshot"
    assert TEARDOWN_ADDRESS == "/looping/probe/lifecycle_teardown"


def test_phase_codes_stable():
    # The driver reads these integer codes off the wire; shifting the
    # numbering would silently mis-colour the markdown table.
    assert PHASE_INIT == 0
    assert PHASE_ACTIVE == 1
    assert PHASE_DISCONNECTED == 2


# --- construction attaches a listener --------------------------------------


def test_construction_attaches_listener(song):
    # The StubSong above raises if a second listener is added; the
    # probe's own attach is the only one allowed. Constructing the
    # probe without raising is the assertion.
    LifecycleProbe(song=song, emit=lambda *a, **k: None)
    assert song._listener is not None


def test_construction_initial_fire_count_zero(probe, emit):
    # No emit on construction — the snapshot is only sent on query
    # or poke. The fire counter starts at zero.
    assert emit.events == []
    probe.handle_query((), None)
    _addr, args = emit.events[-1]
    assert args[1] == 0  # fires


# --- query handler ---------------------------------------------------------


def test_query_emits_snapshot_on_snapshot_address(probe, emit):
    probe.handle_query((), None)
    assert len(emit.events) == 1
    addr, args = emit.events[0]
    # Query replies on SNAPSHOT_ADDRESS, not on QUERY_ADDRESS. This is
    # the contract the driver depends on to route its subscriber.
    assert addr == SNAPSHOT_ADDRESS
    assert len(args) == 5


def test_query_accepts_any_args(probe, emit):
    # Handler signature tolerates args for transport compatibility;
    # the driver sends an empty args list but a defensive tolerance
    # costs nothing and matches the Gate 4a/4b handler shape.
    probe.handle_query((1, "ignored", 3.14), None)
    assert len(emit.events) == 1


def test_query_snapshot_shape_five_positional(probe, emit):
    probe.handle_query((), None)
    _addr, args = emit.events[0]
    phase, fires, song_id, disconnect_count, decorator_bound = args
    assert phase == PHASE_INIT
    assert fires == 0
    assert song_id == 42
    assert disconnect_count == 0
    assert decorator_bound == 0  # set_decorator_bound not called yet


def test_query_reports_decorator_bound_after_flag(probe, emit):
    probe.set_decorator_bound(True)
    probe.handle_query((), None)
    _addr, args = emit.events[-1]
    assert args[4] == 1
    probe.set_decorator_bound(False)
    probe.handle_query((), None)
    _addr, args = emit.events[-1]
    assert args[4] == 0


# --- poke handler ----------------------------------------------------------


def test_poke_increments_fire_count(probe, emit):
    probe.handle_poke((), None)
    # The poke writes a tiny delta then restores — two writes, two
    # listener fires. The exact count matters less than "non-zero
    # and stable", but locking it in catches accidental changes to
    # the poke shape. See LifecycleProbe.handle_poke for why a
    # two-write nudge replaced the original self-assign (Gate 4c
    # live run: identical-value writes didn't fire the real LOM
    # tempo listener, contradicting the Gate 3 analysis
    # assumption).
    assert len(emit.events) == 1
    _addr, args = emit.events[-1]
    assert args[1] == 2  # fires: delta + restore
    assert args[0] == PHASE_ACTIVE


def test_poke_fires_per_call_are_stable(probe, emit):
    # Each poke is a two-write dance (delta + restore), so three
    # pokes produce six fires. The absolute number isn't magical —
    # what matters is that it's deterministic per call. If this
    # ever drifts, the driver's phase-1 "fireDelta ≥ 1" check still
    # passes but the implementation has changed underneath and the
    # log entry should be updated.
    probe.handle_poke((), None)
    probe.handle_poke((), None)
    probe.handle_poke((), None)
    _addr, args = emit.events[-1]
    assert args[1] == 6


def test_poke_survives_song_read_failure(song, emit):
    # If the song object raises when reading tempo (torn down mid-
    # flight), the probe should log and still emit a snapshot so the
    # driver sees state rather than timing out.
    class BrokenSong(StubSong):
        @property
        def tempo(self):
            raise RuntimeError("song torn down")

    broken = BrokenSong()
    # Attach listener manually — ``BrokenSong.tempo`` raises on read,
    # but add_tempo_listener still works.
    probe = LifecycleProbe(
        song=broken, emit=emit, song_id_getter=lambda: 7,
    )
    probe.handle_poke((), None)
    # Emit still lands; fires is zero because the self-assign never
    # succeeded.
    assert len(emit.events) == 1
    _addr, args = emit.events[-1]
    assert args[1] == 0


# --- teardown --------------------------------------------------------------


def test_disconnect_emits_teardown(probe, emit):
    probe.handle_poke((), None)  # fires=2 (delta + restore)
    emit.events.clear()
    probe.disconnect()
    # Two events in teardown order: the teardown marker with the
    # final fire count, and no final snapshot (disconnect's job is
    # detach + record, not snapshot).
    teardown_events = [e for e in emit.events if e[0] == TEARDOWN_ADDRESS]
    assert len(teardown_events) == 1
    _addr, args = teardown_events[0]
    assert args == (2,)


def test_disconnect_idempotent(probe, emit):
    probe.disconnect()
    first_count = len(emit.events)
    probe.disconnect()
    # Second disconnect is a no-op — no new emits, no double-detach
    # on the stub (which would raise).
    assert len(emit.events) == first_count


def test_disconnect_detaches_listener(probe, song):
    assert song._listener is not None
    probe.disconnect()
    assert song._listener is None


def test_disconnect_swallows_detach_failure(song, emit):
    # If the song has been torn down out from under us, removing the
    # listener can raise. ``disconnect`` should log and carry on so
    # the teardown emit still lands.
    probe = LifecycleProbe(song=song, emit=emit, song_id_getter=lambda: 1)
    song._listener = None  # simulate song gone mid-flight
    probe.disconnect()
    # Teardown emit still happened despite detach raising.
    assert any(e[0] == TEARDOWN_ADDRESS for e in emit.events)


def test_snapshot_after_disconnect_reports_phase(song, emit):
    # A query after disconnect would be unusual (the driver sends
    # phase 3 via the operator, not OSC) but the snapshot should
    # report PHASE_DISCONNECTED if it somehow happens. Reuses the
    # same probe after disconnect to exercise the branch.
    probe = LifecycleProbe(song=song, emit=emit, song_id_getter=lambda: 1)
    probe.disconnect()
    emit.events.clear()
    probe.handle_query((), None)
    _addr, args = emit.events[-1]
    assert args[0] == PHASE_DISCONNECTED
    assert args[3] == 1  # disconnect_count


# --- LifecycleDecoratorProbe -----------------------------------------------


class FakeComponent:
    """Stand-in for ``ableton.v3.control_surface.component.Component``.

    Only needs to accept the kwargs v3's ``__init__`` accepts and
    expose a ``disconnect`` method. The real framework does much
    more — listener management, layer dispatch, etc. — but the
    probe's construction is what we're testing here; the real
    binding is Gate 4c's live-run concern.
    """

    def __init__(self, name=None, parent=None, register_component=True,
                 song=None, layer=None, is_enabled=True, is_private=False):
        self.name = name
        self.song = song
        self.disconnected = False

    def disconnect(self):
        self.disconnected = True


class FakeListensDescriptor:
    """Stand-in for the descriptor ``@listens("prop")`` produces.

    The real v2 decorator returns a ``Slot``-like object with a
    ``.subject`` setter that triggers LOM attach. For unit tests we
    just record the declared property name and remember the subject
    that was assigned, so the tests can assert the probe wired it
    the way the framework expects.
    """

    def __init__(self, property_name, fn):
        self.property_name = property_name
        self.fn = fn
        self.subject = None


def fake_listens_factory(property_name):
    """Stand-in for ``ableton.v2.base.listens``.

    Matches the factory shape ``@listens("tempo")`` uses: takes the
    property name and returns a decorator that wraps the method.
    """
    def decorator(fn):
        return FakeListensDescriptor(property_name, fn)
    return decorator


def test_decorator_probe_constructs_cleanly(song):
    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=FakeComponent,
        listens_factory=fake_listens_factory,
    )
    # The inner component got a name and a song via the v3
    # ``__init__`` signature the stub mimics.
    assert probe._inner.song is song
    assert probe._inner.name == "LifecycleDecoratorProbe"


def test_decorator_probe_wires_subject_on_descriptor(song):
    # The production path sets ``_on_tempo.subject = song``. The fake
    # descriptor records this; assert it happened.
    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=FakeComponent,
        listens_factory=fake_listens_factory,
    )
    descriptor = probe._inner._on_tempo
    assert descriptor.property_name == "tempo"
    assert descriptor.subject is song


def test_decorator_probe_on_fire_callback_runs(song):
    # The real @listens descriptor fires its wrapped function when
    # the subject emits. Our stub doesn't simulate firing (that would
    # require re-implementing the v2 slot machinery), but the fn is
    # stored and can be invoked directly to prove the wiring carried
    # the closure through.
    fires = []
    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=FakeComponent,
        listens_factory=fake_listens_factory,
        on_fire=lambda: fires.append(1),
    )
    # Invoke the stored method the way the real decorator would.
    descriptor = probe._inner._on_tempo
    descriptor.fn(probe._inner)
    assert fires == [1]


def test_decorator_probe_disconnect_delegates_to_inner(song):
    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=FakeComponent,
        listens_factory=fake_listens_factory,
    )
    probe.disconnect()
    assert probe._inner.disconnected is True


def test_decorator_probe_disconnect_tolerates_no_disconnect_method(song):
    # A minimalist stand-in without a disconnect method should not
    # crash the teardown path.
    class BareStub:
        def __init__(self, **kwargs):
            pass

    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=BareStub,
        listens_factory=fake_listens_factory,
    )
    # Should not raise.
    probe.disconnect()


class FakeInjectionFactory:
    """Stand-in for ``ableton.v2.base.inject``.

    Records the registrations and exposes an ``.everywhere()`` method
    that returns a context manager. Mirrors the real v2 injection
    surface: ``inject(key=val).everywhere()`` produces something that
    installs ``key=val`` for the duration of its ``with`` block. Our
    fake just records that the ``with`` body ran while the
    registrations were active so the production-path test has an
    assertion target.
    """

    def __init__(self):
        self.calls = []
        self.active = False

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        factory = self

        class _Everywhere:
            def __enter__(_):
                factory.active = True
                return factory

            def __exit__(_, *a):
                factory.active = False
                return False

        class _Terminal:
            def everywhere(_):
                return _Everywhere()

        return _Terminal()


def test_decorator_probe_uses_inject_factory_when_provided(song):
    # Production path: the inject_factory is ``ableton.v2.base.inject``
    # and wraps the construction so the framework's
    # ``@depends(register_component, ...)`` decorator on
    # ``Component.__init__`` resolves. The live Gate 4c first run
    # crashed here with DependencyError; this test locks in the
    # wire-the-inject-context behaviour so a refactor can't
    # silently drop it.
    fake = FakeInjectionFactory()
    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=FakeComponent,
        listens_factory=fake_listens_factory,
        inject_factory=fake,
    )
    # The inject factory was called exactly once with a
    # ``register_component`` no-op.
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert "register_component" in call
    assert callable(call["register_component"])
    # v2's dependency registry resolves a dep by *calling* the
    # registered value with zero args. So the registered value must
    # be a zero-arg factory that returns the actual dep callable.
    # The second Gate 4c retry crashed because we'd registered the
    # dep itself (``lambda c: None``), which the registry then
    # called with no args — arity error. Lock in the factory shape.
    resolved = call["register_component"]()
    assert callable(resolved)
    # And the resolved dep should tolerate the one-arg call the
    # framework's Component.__init__ makes: register_component(self).
    resolved(object())  # should not raise
    # The inner component constructed successfully.
    assert probe._inner.song is song


def test_decorator_probe_tolerates_non_descriptor_stub(song):
    # If the listens_factory returns a plain function (not a
    # descriptor), the ``.subject = song`` line raises AttributeError.
    # The probe catches this and continues — exercised here with a
    # callable-returning stand-in.
    def plain_listens(prop):
        def deco(fn):
            return fn  # plain callable, no .subject setter
        return deco

    # Should not raise.
    probe = LifecycleDecoratorProbe(
        song=song,
        component_base=FakeComponent,
        listens_factory=plain_listens,
    )
    # Inner still built with the song; we just couldn't wire the
    # decorator's subject in this stub-only path.
    assert probe._inner.song is song
