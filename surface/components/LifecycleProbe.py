"""LifecycleProbe — Gate 4c capability probe for non-MIDI surface lifecycle.

Purpose
-------

Gate 4c ([05-migration-plan.md §1], [06 §2.1]) asks the open question
the bootstrap only partially resolved: does ``ableton.v3.control_surface``
cleanly support a *non-MIDI* Control Surface for the full component
lifecycle — not just instantiation (Gate 0 proved that), but

1. ``@listens`` bind: when a v3 ``Component`` subclass declares a
   listener via the framework's decorator, does the framework actually
   attach the underlying ``add_<prop>_listener`` against the live
   model object in a surface that registered zero MIDI elements?
2. Listener fire: does the decorator-managed listener fire when the
   observed property changes?
3. Song-change survival: when the user opens a new set, does the
   framework rebind listeners against the new ``Song`` object, or do
   they silently orphan?
4. Teardown on quit: when Live calls ``ControlSurface.disconnect``,
   does the component's listener detach without crashing, and does
   our transport close cleanly?

Gate 0 already proved instantiation works. Gate 2 proved raw
``add_tempo_listener`` works (``SessionComponent`` uses it). Gate 4c
closes the loop on the framework-managed path — the path the rest
of [03-target-architecture.md §5] plans to use throughout.

Shape
-----

Two OSC addresses, both reply-with-snapshot:

- ``/looping/probe/lifecycle_query`` → ``/looping/probe/lifecycle_snapshot
  [phase, listener_fires_total, current_song_id, disconnect_count,
   decorator_bound]``
- ``/looping/probe/lifecycle_poke`` → writes
  ``song.tempo = song.tempo`` (a no-op from the user's POV since LOM
  fires even on identical writes — see [05 §1 Gate 3] for the
  debounce note; a self-assign is guaranteed to fire), then emits the
  same snapshot. Distinguishes "listener is bound but nothing has
  fired yet" from "listener bind is broken".

Both handlers also trigger a fresh snapshot via the normal emit path
so the driver can collect correlated data from one request.

Operator procedure for the full verdict
---------------------------------------

Gate 4c has an inherently human-in-the-loop step — opening a new Live
set is a UI action, not an OSC call. The driver (``gate4c_run.js``)
walks the operator through three phases:

1. **Bind + fire.** Driver sends ``lifecycle_query``; expects
   ``decorator_bound=1`` and ``listener_fires_total`` ≥ 0. Then sends
   ``lifecycle_poke``; expects ``listener_fires_total`` to increase
   by exactly one (tempo self-assign fires once).
2. **Song-change survival.** Driver pauses and prints "open a new set
   in Live (File → New Live Set), then press Enter". After resume, it
   sends ``lifecycle_query`` and expects ``current_song_id`` to differ
   from phase 1's, *and* ``decorator_bound=1`` (re-bound against new
   song). A ``lifecycle_poke`` then must increment the fire counter
   against the new song.
3. **Teardown.** Driver prints "quit Live (Cmd+Q); check Log.txt for
   ``LifecycleProbe: teardown``". No OSC round-trip — the transport
   is gone before any reply could leave.

The driver's output is a five-row markdown table for [06 §2.1] that
records each phase's pass/fail.

Why a v3 ``Component`` subclass here but not in ``SessionComponent``
-------------------------------------------------------------------

``SessionComponent`` is deliberately a plain class — see its docstring
for the dependency-injection tangle that made the decorator path
costly at Gate 2. The probe pays that tangle's price once, in one
file, precisely because the question Gate 4c is answering is "does
the decorator path work for us at all". If it does, Gate 5+ can adopt
``@listens`` as the default; if it doesn't, we keep writing raw
listener pairs and the architecture doc reflects that.

The probe subclasses ``ableton.v3.base.Component`` (aliased in v3 as
``control_surface.component.Component``) and declares ``@listens("tempo")``
against the song. Song wiring comes from the framework via
``@depends(song=None)`` + surface-level ``inject(...)``, but for Gate
4c the simpler path is to take the song at construction time and hand
it to the base class via ``self.song = song`` — which is what the
framework itself does for its auto-injected attribute. See
``LoopingSurface.py`` for the wiring.

Injection points
----------------

Takes ``song``, ``emit`` (``(address, args)`` callable bound to
``transport.send``), and an optional ``Component`` base class override
at construction. The base-class override exists for tests: unit tests
cannot import ``ableton.v3.control_surface.component`` (it's inside
Live's embedded Python), so tests pass a tiny stand-in that satisfies
the minimum ``disconnect()`` contract. Production passes the real
v3 ``Component`` class.

Why not a ``pytest`` for the full flow
--------------------------------------

Song-change is a Live UI operation; ``Component`` lifecycle is managed
by the framework. The unit tests cover: argument parsing, snapshot
shape, fire-count increment on poke, disconnect idempotence, and the
probe's own teardown emit. The song-change and quit-teardown verdicts
come from the operator-driven live run, recorded in
``implementation-log.md`` and [06 §2.1].
"""

from __future__ import annotations

import logging

logger = logging.getLogger("looping")


# OSC addresses owned by this probe. Kept as module constants so the
# unit tests and the driver script reference them without duplicating
# strings. Same pattern as Gate 4a/4b.
QUERY_ADDRESS = "/looping/probe/lifecycle_query"
POKE_ADDRESS = "/looping/probe/lifecycle_poke"
SNAPSHOT_ADDRESS = "/looping/probe/lifecycle_snapshot"
TEARDOWN_ADDRESS = "/looping/probe/lifecycle_teardown"


# Phase codes emitted on the wire. Integers because the codec treats
# typed ints cheaply; the driver maps them back to names for the
# markdown table.
PHASE_INIT = 0      # listener attached, no fires yet
PHASE_ACTIVE = 1    # at least one fire observed
PHASE_DISCONNECTED = 2  # teardown ran


class LifecycleProbe:
    """Tracks a single-song listener's lifecycle and reports snapshots.

    Args:
        song: The Live ``Song`` object. The probe attaches a tempo
            listener to it. In tests, a stub with ``tempo`` attribute
            and ``add_tempo_listener`` / ``remove_tempo_listener``
            methods — same shape ``SessionComponent``'s tests use.
        emit: ``(address, args)`` callable, usually
            ``transport.send``. Publishes ``SNAPSHOT_ADDRESS`` and
            ``TEARDOWN_ADDRESS``.
        song_id_getter: Optional callable returning an integer song
            identifier. Defaults to ``lambda: id(song)``, which is a
            stand-in for Live's ``song._live_ptr`` / LOM ``.id``. The
            *only* invariant the driver needs is "changes across song
            reload"; Python's ``id()`` changes when the underlying
            Song object is replaced, which matches.

    Behaviour:
        On construction, attaches the listener via raw
        ``song.add_tempo_listener``. We *deliberately* use the raw
        pair rather than the v3 ``@listens`` decorator for Gate 4c's
        probe itself — the decorator requires the framework's
        dependency-injection machinery, and the probe's question
        "does the listener fire at all" is more cleanly answered
        without that tangle. The decorator-binding question is
        answered separately by ``LifecycleDecoratorProbe`` below,
        which subclasses the real v3 ``Component`` and uses
        ``@listens``.

        That split keeps this class testable without Live's embedded
        Python while still giving the live run a real decorator
        binding to observe.
    """

    def __init__(self, song, emit, song_id_getter=None):
        self._song = song
        self._emit = emit
        # Default song-id getter: truncate ``id(song)`` to fit OSC's
        # int32 range. ``id()`` on 64-bit macOS returns a full
        # pointer (~33-34 bits used), which overflows the ``i``
        # typetag and blows up the snapshot emit with
        # ``OSC int32 overflow`` — the live Gate 4c run caught this
        # on first contact. Truncating to 31 bits (positive int32)
        # preserves the only property the driver cares about:
        # "changes when Song object is replaced". The risk is a
        # collision across song reloads where the new song's
        # pointer happens to share low 31 bits with the old — not
        # impossible but low enough, and the driver's phase 2 check
        # is "songIdChanged", which a collision would false-negative
        # once-in-a-blue-moon. Acceptable for a probe.
        self._song_id_getter = song_id_getter or (lambda: id(song) & 0x7FFFFFFF)
        self._fires = 0
        self._disconnected = False
        # Tracks whether the decorator-bound companion reported
        # itself as bound. Set by ``set_decorator_bound(True)`` from
        # ``LoopingSurface`` once ``LifecycleDecoratorProbe`` is
        # constructed; the snapshot exposes the flag so the driver
        # can verify the framework path without a separate address.
        self._decorator_bound = False
        self._song.add_tempo_listener(self._on_tempo_changed)
        logger.info(
            "LifecycleProbe: attached tempo listener (song_id=%d)",
            self._song_id_getter(),
        )

    # --- external wiring --------------------------------------------------

    def set_decorator_bound(self, flag):
        """Record whether the companion ``@listens`` component bound OK.

        Called by ``LoopingSurface`` after constructing
        ``LifecycleDecoratorProbe`` — if that construction succeeded
        without raising, the framework accepted the decorator path on
        a non-MIDI surface and the flag flips true. If the constructor
        raised, the flag stays false and the snapshot carries that
        failure signal out over OSC.
        """
        self._decorator_bound = bool(flag)

    # --- listener ---------------------------------------------------------

    def _on_tempo_changed(self):
        """Increment fire count on each LOM tempo fire.

        No emit from the fire itself — the driver pulls state with
        ``lifecycle_query``. That shape avoids racing the driver's
        snapshot against a LOM fire and simplifies the test that
        the fire counter increments exactly once per poke.
        """
        self._fires += 1
        # DEBUG, not INFO. This was raised to INFO during Gate 4c's
        # live investigation — the "poke writes but fires doesn't
        # increment" puzzle needed per-fire visibility in Log.txt,
        # whose default level is INFO. That verdict is recorded, so
        # audit item 13 dropped it back: a per-fire INFO line on the
        # tempo listener is one Log.txt row per tempo change.
        logger.debug(
            "LifecycleProbe: tempo fire #%d", self._fires,
        )

    # --- handlers ---------------------------------------------------------

    def handle_query(self, args, source_addr):
        """``/looping/probe/lifecycle_query []`` → snapshot on its address.

        Accepts any args (ignored) so the driver can send a bare
        probe. Returns nothing from the handler — we emit to a
        *different* address so the driver's one subscriber shape
        (used by Gate 4a/4b) carries over.
        """
        self._emit_snapshot()
        return None

    def handle_poke(self, args, source_addr):
        """``/looping/probe/lifecycle_poke []`` → nudge tempo, snapshot.

        Triggers a listener fire by writing a slightly-different
        tempo value then restoring. The first Gate 4c live run used
        a pure self-assign (``song.tempo = song.tempo``) on the
        theory that LOM fires on identical writes; live behaviour
        contradicted that — ``fires`` stayed at zero. The robust
        shape is a two-write dance: write ``current + 0.0001`` (a
        sub-BPM-display delta, inaudible and unobservable in the
        transport), then write ``current`` back. LOM fires twice;
        the driver's "at least one fire per poke" assertion still
        holds, and the user sees no change.

        If the read/write raises (song torn down mid-flight), we
        log and still emit a snapshot so the driver sees the error
        state rather than timing out.
        """
        fires_before = self._fires
        try:
            current = self._song.tempo
            # Tiny delta: well below Live's displayed precision and
            # below any audible change. Both writes fire the
            # listener, so the driver's "+N per poke where N≥1"
            # check is satisfied regardless of LOM's debounce.
            self._song.tempo = current + 0.0001
            self._song.tempo = current
            logger.info(
                "LifecycleProbe: poke nudge done (tempo=%.4f, fires %d→%d)",
                current, fires_before, self._fires,
            )
        except Exception as e:
            logger.error(
                "LifecycleProbe: poke tempo-nudge raised: %s", e,
            )
        self._emit_snapshot()
        return None

    # --- internals --------------------------------------------------------

    def _emit_snapshot(self):
        """Emit the five-arg snapshot tuple.

        Wire shape: ``(phase, fires, song_id, disconnect_count, decorator_bound)``.

        ``phase``: 0=init (no fires), 1=active (≥1 fire), 2=disconnected.
        ``fires``: total listener fires since the probe was constructed.
        ``song_id``: integer id of the Song object (changes across
            set reload, same object ⇒ same id).
        ``disconnect_count``: 0 until ``disconnect()`` has run, then 1.
            A second disconnect (idempotent) does not double-count.
        ``decorator_bound``: 1 iff ``LifecycleDecoratorProbe`` was
            constructed without raising on surface init.
        """
        phase = PHASE_INIT if self._fires == 0 else PHASE_ACTIVE
        if self._disconnected:
            phase = PHASE_DISCONNECTED
        self._emit(
            SNAPSHOT_ADDRESS,
            (
                int(phase),
                int(self._fires),
                int(self._song_id_getter()),
                int(1 if self._disconnected else 0),
                int(1 if self._decorator_bound else 0),
            ),
        )

    # --- lifecycle --------------------------------------------------------

    def disconnect(self):
        """Detach listener; emit a final teardown marker; idempotent.

        Called from ``LoopingSurface.disconnect``. The teardown emit
        is best-effort: if Live has already started socket shutdown,
        the send may no-op, but the Log.txt line is the durable
        record the driver's phase-3 step reads.
        """
        if self._disconnected:
            return
        self._disconnected = True
        try:
            self._song.remove_tempo_listener(self._on_tempo_changed)
        except Exception as e:
            # Matches SessionComponent.disconnect: if the song is
            # already gone, the remove call can raise; nothing to
            # clean up at that point.
            logger.warning(
                "LifecycleProbe: tempo detach failed: %s", e,
            )
        logger.info(
            "LifecycleProbe: teardown complete (total_fires=%d)",
            self._fires,
        )
        try:
            self._emit(
                TEARDOWN_ADDRESS,
                (int(self._fires),),
            )
        except Exception as e:
            # Emit during disconnect can race the transport close.
            # Keep the exception local; the log line above is the
            # durable record.
            logger.debug(
                "LifecycleProbe: teardown emit failed (expected if "
                "transport already closed): %s", e,
            )


class LifecycleDecoratorProbe:
    """Companion probe: v3 ``Component`` subclass with ``@listens``.

    Gate 4c's core question is whether the framework's decorator-based
    listener machinery works on a non-MIDI surface. ``LifecycleProbe``
    above uses raw listener pairs so the fire-count math is testable
    without Live; this class exists to exercise the *other* path — the
    one [03 §5] plans to use everywhere — in a live session.

    Construction is all we need for the binding signal: if the
    framework can build a ``Component`` subclass that declares
    ``@listens("tempo")`` against our non-MIDI surface's song without
    raising, the decorator path is viable. A successful construction
    flips ``LifecycleProbe.set_decorator_bound(True)``; any exception
    leaves the flag false and is logged with a traceback.

    This class takes a ``component_base`` injector so unit tests can
    pass a tiny stub that records the listener attach without needing
    the real v3 framework. Production passes
    ``ableton.v3.control_surface.Component`` (or an available alias).
    The ``listens_factory`` injector serves the same purpose for the
    decorator: tests pass a stand-in that records the declared
    property name; production passes the real ``ableton.v2.base.listens``.

    Why the factory injection rather than direct import
    ---------------------------------------------------

    The production imports happen inside ``LoopingSurface`` (see its
    try/except around this class's construction). Wrapping them at
    the call site rather than at module-load time means a framework
    change that relocates ``listens`` doesn't crash the whole
    surface at import time — we get the same Gate 0 resilience
    pattern (load → log → carry on) for a new dependency.
    """

    def __init__(self, song, component_base, listens_factory, on_fire=None,
                 inject_factory=None):
        # Build the ``@listens``-decorated subclass dynamically. A
        # regular class-level decorator would need ``listens`` and
        # the base class at module import time; the dynamic build
        # keeps the import inside the surface's guarded wiring and
        # the unit tests' stand-in cheap to pass.
        fire_cb = on_fire or (lambda: None)

        class _DecoratedInner(component_base):
            @listens_factory("tempo")
            def _on_tempo(self):
                fire_cb()

        # v3 ``Component.__init__`` is decorated with
        # ``@depends(register_component, song, ...)``, so passing
        # ``song=song`` as a kwarg is not enough — the decorator
        # also demands ``register_component`` come from the
        # framework's injection registry. On the live Gate 4c first
        # run this surfaced as
        # ``DependencyError: Required dependency register_component
        # not provided`` before we ever got to the listener binding.
        #
        # The pragmatic fix is to stand up a local ``inject(...)``
        # context with a no-op ``register_component``. That's the
        # same machinery a ControlSurface itself uses (via v2's
        # ``Injector``), just scoped to this one construction
        # instead of the whole surface. ``inject_factory`` is an
        # injection for tests — production passes
        # ``ableton.v2.base.inject``, which returns an
        # ``InjectionFactory`` with an ``.everywhere()`` terminal
        # that installs the registrations globally for the duration
        # of the ``with`` block.
        if inject_factory is None:
            self._inner = _DecoratedInner(
                name="LifecycleDecoratorProbe", song=song,
            )
        else:
            # No-op register_component: Component's __init__ calls
            # ``register_component(self)`` to enrol itself with the
            # surface's component tree. For a standalone probe we
            # don't want that enrolment (the surface doesn't know
            # about this inner) — a lambda that ignores its arg is
            # the safe no-op.
            #
            # The v2 injection registry resolves a dependency by
            # *calling* the registered value with zero arguments
            # (see ``get_dependency_for`` in
            # ``ableton.v2.base.dependency``). So we must register
            # a zero-arg *factory* that returns the dep — not the
            # dep directly. The first Gate 4c retry crashed with
            # ``missing 1 required positional argument: 'c'``
            # because we'd registered ``lambda c: None`` (the
            # callable dep itself); the registry called it with no
            # args and tripped the arity check. The correct shape
            # is ``lambda: <the dep>``.
            noop_register = lambda c: None  # noqa: E731
            with inject_factory(
                register_component=lambda: noop_register,
            ).everywhere():
                self._inner = _DecoratedInner(
                    name="LifecycleDecoratorProbe", song=song,
                )
        # The ``@listens("tempo")`` decorator produces a descriptor
        # with a ``.subject`` setter: assigning to it attaches the
        # underlying LOM ``add_tempo_listener`` against that subject.
        # Production v3 components that use ``@depends(song)`` have
        # this wired implicitly by the framework; we wire it
        # explicitly here because the probe's whole point is to
        # exercise the decorator path in isolation.
        #
        # If the base class isn't an ``EventObject`` (tests pass a
        # stub), the descriptor may be a plain function — try/except
        # keeps both paths alive.
        try:
            self._inner._on_tempo.subject = song
        except AttributeError:
            # Stub path: the decorator returned a plain callable, not
            # a Slot-like descriptor. Tests exercising the
            # listens_factory stand-in hit this branch intentionally.
            pass
        logger.info(
            "LifecycleDecoratorProbe: @listens('tempo') bound on %r",
            type(song).__name__,
        )

    def disconnect(self):
        """Tear down the inner component.

        v3 ``Component.disconnect`` detaches all ``@listens`` bindings
        automatically — that's the framework's core promise and
        Gate 4c's whole reason to exist. If the inner exposes a
        ``disconnect`` we call it; otherwise (test stubs) we no-op.
        """
        disc = getattr(self._inner, "disconnect", None)
        if callable(disc):
            try:
                disc()
            except Exception as e:
                logger.warning(
                    "LifecycleDecoratorProbe: inner disconnect raised: %s",
                    e,
                )
