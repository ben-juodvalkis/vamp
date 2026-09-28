"""ExclusiveArmComponent tests.

Covers:

- ``__init__`` attaches a ``selected_track`` listener on
  ``song.view`` and does *not* arm anything (seeding is
  ``emit_on_accept``'s job).
- Listener fires defer arm writes via ``schedule_delayed``
  (never inline) — required because Live forbids LOM writes
  from inside a notification callback. Test drives commits
  via ``FakeScheduler.fire_pending()``.
- Selection change arms new + disarms previously arm-by-us
  on commit.
- Master and return selections are no-ops (neither arm nor
  disarm). "Return" is simulated by handing the view a track
  not in ``song.tracks`` and not equal to ``master_track`` —
  the same shape ``SelectedTrackComponent`` uses for returns.
- Coalesce semantics: multiple listener fires in the same tick
  schedule a single commit; the latest target wins.
- User-override preservation: if user manually arms a third
  track, selecting elsewhere only touches the track we armed;
  the manually-armed track stays armed.
- ``emit_on_accept`` arms the currently-selected regular track
  on handshake *inline* (no defer — accept runs off an OSC
  handler, not a notification).
- ``disconnect`` detaches the listener and makes subsequent
  fires no-ops.
- LOM-guard: attach raising, selected_track read raising — all
  swallow.
"""

from __future__ import annotations

from typing import Callable, List, Optional, Tuple

import pytest

from components.ExclusiveArmComponent import ExclusiveArmComponent


class FakeScheduler:
    """Captures ``schedule_delayed`` calls and lets tests fire
    pending commits deterministically — no wall-clock dependency.
    Mirrors ``test_selected_track_component.FakeScheduler``."""

    def __init__(self):
        self.calls: List[Tuple[int, Callable[[], None]]] = []

    def __call__(self, delay_ms, fn):
        self.calls.append((delay_ms, fn))

    def fire_pending(self) -> None:
        """Run the most-recently-scheduled callback and pop it."""
        if not self.calls:
            raise AssertionError("no pending scheduled callback")
        _, fn = self.calls.pop()
        fn()

    def fire_all(self) -> None:
        """Run every scheduled callback in registration order."""
        while self.calls:
            _, fn = self.calls.pop(0)
            fn()

    @property
    def pending_count(self) -> int:
        return len(self.calls)


# --- stubs ----------------------------------------------------------------


class ArmableStubTrack:
    """Track with a mutable ``arm`` attribute.

    Cannot use ``test_lom_listeners.StubTrack`` — that one has no
    ``arm`` field. Mirrors the minimum surface the component
    touches: ``arm`` (read/write), identity (``is``-equal).
    """

    def __init__(self, tid: int, name: str = "", arm: bool = False):
        self.id = tid
        self.name = name
        self.arm = arm


class RaisingArmTrack(ArmableStubTrack):
    """Track whose ``arm`` setter raises. Exercises the LOM-guard
    path inside ``_arm`` / ``_disarm``."""

    def __init__(self, tid: int, name: str = ""):
        super().__init__(tid, name)
        self._arm_raises = True

    @property
    def arm(self):
        return False

    @arm.setter
    def arm(self, value):
        if getattr(self, "_arm_raises", False):
            raise RuntimeError("arm setter boom")


class ArmStubView:
    """``song.view`` shim. Distinct from
    ``test_selected_track_component.StubView``: supports
    multiple listeners (so a future integration test can
    attach both ``SelectedTrackComponent`` and
    ``ExclusiveArmComponent`` on the same view — Live's real
    behavior)."""

    def __init__(self, selected_track=None):
        self._selected_track = selected_track
        self._listeners: List = []

    @property
    def selected_track(self):
        return self._selected_track

    def set_selected_track(self, track) -> None:
        self._selected_track = track
        for cb in list(self._listeners):
            cb()

    def add_selected_track_listener(self, cb):
        self._listeners.append(cb)

    def remove_selected_track_listener(self, cb):
        self._listeners.remove(cb)

    def has_listener(self) -> bool:
        return bool(self._listeners)


class ArmStubSong:
    def __init__(
        self,
        tracks: Optional[List[ArmableStubTrack]] = None,
        master: Optional[ArmableStubTrack] = None,
        selected_track=None,
    ):
        self._tracks = list(tracks or [])
        self.master_track = master if master is not None else ArmableStubTrack(
            tid=9_999_999, name="Master",
        )
        self.view = ArmStubView(selected_track=selected_track)

    @property
    def tracks(self):
        return list(self._tracks)


class RaisingView:
    def __init__(self, attach_raises=False, read_raises=False):
        self._attach_raises = attach_raises
        self._read_raises = read_raises
        self.attach_attempts = 0

    @property
    def selected_track(self):
        if self._read_raises:
            raise RuntimeError("selected_track read boom")
        return None

    def add_selected_track_listener(self, cb):
        self.attach_attempts += 1
        if self._attach_raises:
            raise RuntimeError("attach boom")


class RaisingViewSong:
    def __init__(self, view):
        self.view = view
        self._tracks: List[ArmableStubTrack] = []
        self.master_track = ArmableStubTrack(tid=9_999_999, name="Master")

    @property
    def tracks(self):
        return list(self._tracks)


# --- init / listener attachment -------------------------------------------


def _make(song, scheduler=None):
    """Shorthand: construct with a FakeScheduler (default) or the
    caller's scheduler."""
    return ExclusiveArmComponent(
        song=song,
        schedule_delayed=scheduler if scheduler is not None else FakeScheduler(),
    )


def test_init_attaches_listener_on_song_view():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)

    comp = _make(song)

    assert comp.listener_attached is True
    assert song.view.has_listener() is True


def test_init_does_not_arm_anything():
    """Construction is a pure observer setup. Arming happens on
    either a listener fire (deferred) or ``emit_on_accept`` —
    never at __init__."""
    t0 = ArmableStubTrack(tid=100, name="t0", arm=False)
    song = ArmStubSong(tracks=[t0], selected_track=t0)

    _make(song)

    assert t0.arm is False


def test_init_does_not_schedule_anything():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    sched = FakeScheduler()

    _make(song, sched)

    assert sched.pending_count == 0


def test_init_attach_raise_swallowed():
    view = RaisingView(attach_raises=True)
    song = RaisingViewSong(view)

    comp = _make(song)

    assert comp.listener_attached is False
    assert view.attach_attempts == 1


# --- selection change -----------------------------------------------------


def test_listener_fire_does_not_write_inline():
    """Critical regression guard: the listener MUST NOT call
    ``setattr(track, 'arm', ...)`` synchronously. Live raises
    "Changes cannot be triggered by notifications" if we do.
    The listener must only schedule a deferred commit."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()  # inline arm via accept path is fine
    assert t0.arm is True

    song.view.set_selected_track(t1)

    # One commit is pending; nothing has been written yet.
    assert sched.pending_count == 1
    assert t0.arm is True  # not yet disarmed — commit hasn't run
    assert t1.arm is False  # not yet armed

    sched.fire_pending()

    assert t0.arm is False
    assert t1.arm is True
    assert comp.last_armed_track is t1


def test_selection_change_arms_new_and_disarms_previous():
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)

    # Seed the "previously arm-by-us" slot by accepting the initial
    # selection.
    comp.emit_on_accept()
    assert t0.arm is True
    assert comp.last_armed_track is t0

    song.view.set_selected_track(t1)
    sched.fire_pending()

    assert t1.arm is True
    assert t0.arm is False
    assert comp.last_armed_track is t1


def test_selection_change_without_previous_only_arms_new():
    """Listener fires before any handshake-seeded arm. First fire
    just arms the new track; there's no previous to disarm."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)

    song.view.set_selected_track(t1)
    sched.fire_pending()

    assert t1.arm is True
    assert t0.arm is False  # never armed by us
    assert comp.last_armed_track is t1


def test_repeat_selection_is_idempotent():
    """Live fires the listener twice on some operations (insert-
    track); a same-track re-fire must not re-arm (no harm) and
    must not disarm the track (regression guard)."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()
    assert t0.arm is True

    # Re-fire with the same selection — since same_track check
    # short-circuits before scheduling, no commits queue up.
    song.view.set_selected_track(t0)
    song.view.set_selected_track(t0)

    assert sched.pending_count == 0
    assert t0.arm is True
    assert comp.last_armed_track is t0


def test_coalesce_multiple_fires_schedule_single_commit():
    """Listener fires A→B→C inside one tick coalesce to one
    deferred commit that lands C (latest-wins)."""
    a = ArmableStubTrack(tid=100, name="A")
    b = ArmableStubTrack(tid=101, name="B")
    c = ArmableStubTrack(tid=102, name="C")
    song = ArmStubSong(tracks=[a, b, c], selected_track=a)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()  # arm A inline via accept
    assert a.arm is True

    song.view.set_selected_track(b)
    song.view.set_selected_track(c)

    # Only one commit scheduled despite two fires.
    assert sched.pending_count == 1
    # No writes yet — commit hasn't run.
    assert b.arm is False
    assert c.arm is False

    sched.fire_pending()

    # Latest-wins: C armed, A disarmed, B never touched.
    assert a.arm is False
    assert b.arm is False
    assert c.arm is True
    assert comp.last_armed_track is c


# --- master / return skips ------------------------------------------------


def test_master_selection_is_noop():
    t0 = ArmableStubTrack(tid=100, name="t0")
    master = ArmableStubTrack(tid=9_999_999, name="Master")
    song = ArmStubSong(
        tracks=[t0], master=master, selected_track=t0,
    )
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()
    assert t0.arm is True

    song.view.set_selected_track(master)

    # Master selection doesn't even schedule — the listener's
    # regularity check short-circuits before ``schedule_delayed``.
    assert sched.pending_count == 0
    assert master.arm is False
    assert t0.arm is True
    assert comp.last_armed_track is t0


def test_return_selection_is_noop():
    """Return tracks aren't in ``song.tracks`` and aren't master.
    Simulated by handing the view a track not in the tracks list."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    return_like = ArmableStubTrack(tid=500, name="A Reverb")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()
    assert t0.arm is True

    song.view.set_selected_track(return_like)

    assert sched.pending_count == 0
    assert return_like.arm is False
    assert t0.arm is True
    assert comp.last_armed_track is t0


def test_selection_change_from_master_to_regular_arms_new():
    """Selection path master → t0: t0 arms, no previous to disarm."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    master = ArmableStubTrack(tid=9_999_999, name="Master")
    song = ArmStubSong(
        tracks=[t0], master=master, selected_track=master,
    )
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()  # on master — no-op

    assert t0.arm is False
    assert comp.last_armed_track is None

    song.view.set_selected_track(t0)
    sched.fire_pending()

    assert t0.arm is True
    assert comp.last_armed_track is t0


# --- user-override preservation -------------------------------------------


def test_user_manual_arm_survives_selection_change():
    """User arms track C manually via the mixer. Then selection
    moves from A to B. Only A (what we armed) is disarmed; C is
    left alone."""
    a = ArmableStubTrack(tid=100, name="A")
    b = ArmableStubTrack(tid=101, name="B")
    c = ArmableStubTrack(tid=102, name="C")
    song = ArmStubSong(tracks=[a, b, c], selected_track=a)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()
    assert a.arm is True
    assert comp.last_armed_track is a

    # User manually arms C (not via selection — e.g. tap on mixer).
    c.arm = True

    song.view.set_selected_track(b)
    sched.fire_pending()

    # A (what we armed) is disarmed; C (user's manual arm) untouched.
    assert a.arm is False
    assert b.arm is True
    assert c.arm is True
    assert comp.last_armed_track is b


# --- emit_on_accept -------------------------------------------------------


def test_accept_arms_regular_selected_track():
    """Accept path is inline — runs off an OSC handler, not a LOM
    notification, so no deferral needed."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)

    comp.emit_on_accept()

    assert t0.arm is True
    assert comp.last_armed_track is t0
    # Accept must not schedule a deferred commit.
    assert sched.pending_count == 0


def test_accept_on_master_is_noop():
    master = ArmableStubTrack(tid=9_999_999, name="Master")
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(
        tracks=[t0], master=master, selected_track=master,
    )
    comp = _make(song)

    comp.emit_on_accept()

    assert master.arm is False
    assert t0.arm is False
    assert comp.last_armed_track is None


def test_accept_on_return_is_noop():
    t0 = ArmableStubTrack(tid=100, name="t0")
    return_like = ArmableStubTrack(tid=500, name="A Reverb")
    song = ArmStubSong(tracks=[t0], selected_track=return_like)
    comp = _make(song)

    comp.emit_on_accept()

    assert return_like.arm is False
    assert t0.arm is False
    assert comp.last_armed_track is None


def test_accept_twice_on_same_track_is_idempotent():
    """Handshake may re-seed on reconnect. Re-accepting the same
    selection must not flip-flop arm."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    comp = _make(song)

    comp.emit_on_accept()
    comp.emit_on_accept()

    assert t0.arm is True
    assert comp.last_armed_track is t0


# --- disconnect -----------------------------------------------------------


def test_disconnect_detaches_listener():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    comp = _make(song)

    comp.disconnect()

    assert comp.listener_attached is False
    assert song.view.has_listener() is False


def test_disconnect_is_idempotent():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    comp = _make(song)

    comp.disconnect()
    comp.disconnect()  # no raise


def test_listener_fire_after_disconnect_is_noop():
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    comp = _make(song)
    comp.emit_on_accept()
    assert t0.arm is True

    comp.disconnect()

    # Should not fire after detach (we removed ourselves). But defend
    # against a spurious fire — the disconnect guard must swallow.
    comp._on_selected_track_changed()

    assert t0.arm is True  # unchanged
    assert t1.arm is False


def test_commit_after_disconnect_is_noop():
    """A deferred commit that fires after disconnect must not
    write. Edge case: selection changes, we schedule, user closes
    set before the tick boundary — commit fires on a disconnected
    component."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()
    assert t0.arm is True

    song.view.set_selected_track(t1)
    assert sched.pending_count == 1

    comp.disconnect()
    sched.fire_pending()  # commit runs post-disconnect

    assert t0.arm is True  # not disarmed
    assert t1.arm is False  # not armed


def test_accept_after_disconnect_is_noop():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    comp = _make(song)

    comp.disconnect()
    comp.emit_on_accept()

    assert t0.arm is False


# --- LOM guards -----------------------------------------------------------


def test_read_raise_during_fire_swallowed():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    comp = _make(song)

    class BrokenView:
        @property
        def selected_track(self):
            raise RuntimeError("read boom")

    comp._view = BrokenView()

    comp._on_selected_track_changed()  # must not raise


def test_arm_setattr_raise_swallowed():
    good = ArmableStubTrack(tid=100, name="ok")
    bad = RaisingArmTrack(tid=101, name="raises")
    song = ArmStubSong(tracks=[good, bad], selected_track=good)
    sched = FakeScheduler()
    comp = _make(song, sched)
    comp.emit_on_accept()
    assert good.arm is True

    # Selection moves to the track whose setter raises.
    song.view.set_selected_track(bad)
    sched.fire_pending()

    # good gets disarmed (its setattr doesn't raise).
    assert good.arm is False
    # The bad setter raised, was swallowed. last_armed_track still
    # advanced to ``bad`` — we consider the intent fulfilled; a future
    # fire can retry on a newly-selected track.
    assert comp.last_armed_track is bad


# --- SessionSettings auto_arm gate (2026-04-22) -------------------------


def test_auto_arm_disabled_selection_change_is_noop():
    """With the SessionSettings auto_arm gate OFF, a selection change
    must commit silently — no arm write, no disarm write, no
    ``_last_armed_track`` update. The user's current arm state is left
    untouched so they can manually arm tracks without ExclusiveArm
    undoing it on the next selection fire."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()
    comp = ExclusiveArmComponent(
        song=song,
        schedule_delayed=sched,
        should_auto_arm=lambda: False,
    )

    song.view.set_selected_track(t1)
    sched.fire_pending()

    assert t0.arm is False  # untouched
    assert t1.arm is False  # not armed
    assert comp.last_armed_track is None


def test_auto_arm_disabled_emit_on_accept_is_noop():
    t0 = ArmableStubTrack(tid=100, name="t0")
    song = ArmStubSong(tracks=[t0], selected_track=t0)
    comp = ExclusiveArmComponent(
        song=song,
        schedule_delayed=FakeScheduler(),
        should_auto_arm=lambda: False,
    )

    comp.emit_on_accept()

    assert t0.arm is False
    assert comp.last_armed_track is None


def test_auto_arm_toggle_flip_respected_at_commit_time():
    """The getter is pulled at commit time, not ctor time — flipping
    the toggle between listener fire and deferred commit changes the
    outcome. (Real-world example: user disables auto-arm mid-selection-
    burst; the pending commit sees the new state.)"""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()

    gate = {"on": True}
    comp = ExclusiveArmComponent(
        song=song,
        schedule_delayed=sched,
        should_auto_arm=lambda: gate["on"],
    )

    song.view.set_selected_track(t1)
    assert sched.pending_count == 1  # deferral scheduled regardless
    gate["on"] = False
    sched.fire_pending()

    assert t1.arm is False  # commit saw the flip, skipped the arm


def test_auto_arm_default_getter_preserves_legacy_behavior():
    """No ``should_auto_arm`` arg → default ``lambda: True`` — the
    component arms as before."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)
    sched = FakeScheduler()
    comp = ExclusiveArmComponent(
        song=song,
        schedule_delayed=sched,
        # no should_auto_arm
    )

    song.view.set_selected_track(t1)
    sched.fire_pending()

    assert t1.arm is True
    assert comp.last_armed_track is t1


def test_schedule_delayed_raise_clears_commit_flag():
    """If ``schedule_delayed`` itself raises, the commit flag must
    clear so a later selection change can retry. We don't commit
    inline (that's the whole point of deferring) — the change is
    dropped, but the component remains responsive."""
    t0 = ArmableStubTrack(tid=100, name="t0")
    t1 = ArmableStubTrack(tid=101, name="t1")
    song = ArmStubSong(tracks=[t0, t1], selected_track=t0)

    def raising_scheduler(delay_ms, fn):
        raise RuntimeError("scheduler boom")

    comp = ExclusiveArmComponent(
        song=song, schedule_delayed=raising_scheduler,
    )
    comp.emit_on_accept()
    assert t0.arm is True

    song.view.set_selected_track(t1)  # must not raise

    # No write happened (deferred commit couldn't be scheduled).
    assert t1.arm is False
    # The flag cleared — a follow-up fire with a working scheduler
    # would be able to schedule. We don't assert retry behavior here
    # since the scheduler is hard-broken; the guarantee we need is
    # "no stuck state".
    assert comp._commit_scheduled is False
