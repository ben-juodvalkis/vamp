"""ClipsComponent skeleton tests — Phase 7 PR-7b pr7b-2.

Covers the skeleton shape: arg-count validation, error emission shape,
slot-resolve helper's error taxonomy, and ``disconnect`` idempotence.

The actual launch/stop/delete/duplicate LOM calls and the per-slot
``has_clip`` listeners land in pr7b-3 … pr7b-5. Tests for those
behaviors grow alongside the implementation — this file asserts the
skeleton contract and nothing more.
"""

from __future__ import annotations

from typing import List, Tuple

import pytest

from components.ClipsComponent import (
    ClipsComponent,
    V3_CLIP_CREATED_ADDRESS,
    V3_CLIP_DELETE_ADDRESS,
    V3_CLIP_DUPLICATE_ADDRESS,
    V3_CLIP_DUPLICATE_REGION_ADDRESS,
    V3_CLIP_FOCUS_ADDRESS,
    V3_CLIP_LAUNCH_ADDRESS,
    V3_CLIP_LOAD_FILE_ADDRESS,
    V3_CLIP_REMOVED_ADDRESS,
    V3_CLIP_SET_COLOR_ADDRESS,
    V3_CLIP_STOP_ADDRESS,
    V3_CLIP_TRIGGERED_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_CLIP_NOT_MIDI,
    V3_ERROR_CLIP_NOT_PRESENT,
    V3_ERROR_DUPLICATE_REJECTED,
    V3_ERROR_LAUNCH_FAILED,
    V3_ERROR_LOAD_FAILED,
    V3_ERROR_NO_EMPTY_SLOT,
    V3_ERROR_PATH_NOT_FOUND,
    V3_ERROR_PATH_NOT_SUPPORTED,
    V3_ERROR_SLOT_NOT_FOUND,
    V3_ERROR_WRITE_REJECTED,
)


# --- stub song ------------------------------------------------------------


class StubClip:
    def __init__(self, is_midi: bool = True):
        self.is_playing = False
        self.is_recording = False
        # ROW 8: ``duplicate_loop`` + ``is_midi_clip`` surface on the
        # clip object; audio clips reject the call. ``_duplicate_loop_raises``
        # lets tests inject a torn-down-handle style exception.
        self.is_midi_clip = is_midi
        self.duplicate_loop_calls = 0
        self._duplicate_loop_raises = None
        self._is_midi_clip_raises = None
        # Color attribute for set_color tests. ``_color_raises`` lets a
        # test inject a torn-down-handle style exception on assignment.
        self.color = 0
        self._color_raises = None

    def __getattribute__(self, name):
        # Allow a raising ``is_midi_clip`` to exercise the
        # ``_LOM_ERRORS`` branch in handle_duplicate_region without
        # tripping on the flag itself.
        if name == "is_midi_clip":
            raises = object.__getattribute__(self, "_is_midi_clip_raises")
            if raises is not None:
                raise raises
        return object.__getattribute__(self, name)

    def __setattr__(self, name, value):
        # Allow a raising ``color`` assignment to exercise the
        # ``_LOM_ERRORS`` branch in handle_set_color. Bypasses for the
        # private flag itself so tests can install the trap.
        if name == "color":
            raises = self.__dict__.get("_color_raises")
            if raises is not None:
                raise raises
        object.__setattr__(self, name, value)

    def duplicate_loop(self):
        if self._duplicate_loop_raises is not None:
            raise self._duplicate_loop_raises
        self.duplicate_loop_calls += 1


class StubClipSlot:
    def __init__(self, has_clip: bool = False):
        self.has_clip = has_clip
        self.clip = StubClip() if has_clip else None
        self.fired = 0
        self._fire_raises = None
        self.delete_called = 0
        self._delete_raises = None
        self._has_clip_raises = None
        # has_clip listener plumbing for pr7b-5.
        self._has_clip_listeners: List = []
        self._add_listener_raises = None
        self._remove_listener_raises = None
        # is_triggered listener plumbing — the launch-queued channel.
        # Deliberately its own set of traps: a Live build (or a stub)
        # can support one listener and not the other.
        self.is_triggered = False
        self._is_triggered_listeners: List = []
        self._add_is_triggered_raises = None
        self._remove_is_triggered_raises = None
        self._is_triggered_raises = None
        # load_file plumbing: tracks calls + optional raise for the
        # create_audio_clip LOM shim.
        self.created_audio_clips: List[str] = []
        self._create_audio_clip_raises = None

    def __getattribute__(self, name):
        # Allow a raising ``has_clip`` to exercise _slot_has_clip_safe.
        if name == "has_clip":
            raises = object.__getattribute__(self, "_has_clip_raises")
            if raises is not None:
                raise raises
        if name == "is_triggered":
            raises = object.__getattribute__(self, "_is_triggered_raises")
            if raises is not None:
                raise raises
        return object.__getattribute__(self, name)

    def add_is_triggered_listener(self, cb):
        if self._add_is_triggered_raises is not None:
            raise self._add_is_triggered_raises
        self._is_triggered_listeners.append(cb)

    def remove_is_triggered_listener(self, cb):
        if self._remove_is_triggered_raises is not None:
            raise self._remove_is_triggered_raises
        if cb in self._is_triggered_listeners:
            self._is_triggered_listeners.remove(cb)

    def fire_is_triggered_listeners(self):
        """Test helper: simulate Live firing the is_triggered listeners."""
        for cb in list(self._is_triggered_listeners):
            cb()

    def add_has_clip_listener(self, cb):
        if self._add_listener_raises is not None:
            raise self._add_listener_raises
        self._has_clip_listeners.append(cb)

    def remove_has_clip_listener(self, cb):
        if self._remove_listener_raises is not None:
            raise self._remove_listener_raises
        if cb in self._has_clip_listeners:
            self._has_clip_listeners.remove(cb)

    def fire_has_clip_listeners(self):
        """Test helper: simulate Live firing the has_clip listeners."""
        for cb in list(self._has_clip_listeners):
            cb()

    def fire(self):
        if self._fire_raises is not None:
            raise self._fire_raises
        self.fired += 1

    def delete_clip(self):
        if self._delete_raises is not None:
            raise self._delete_raises
        self.delete_called += 1
        self.has_clip = False
        self.clip = None

    def create_audio_clip(self, file_path: str):
        if self._create_audio_clip_raises is not None:
            raise self._create_audio_clip_raises
        self.created_audio_clips.append(file_path)
        self.has_clip = True
        self.clip = StubClip(is_midi=False)


class StubTrack:
    def __init__(self, n_slots: int = 4):
        self.clip_slots = tuple(StubClipSlot() for _ in range(n_slots))
        self.stop_all_called = 0
        self._stop_all_raises = None
        self.duplicate_calls: List[int] = []
        self._duplicate_raises = None

    def stop_all_clips(self):
        if self._stop_all_raises is not None:
            raise self._stop_all_raises
        self.stop_all_called += 1

    def duplicate_clip_slot(self, src_idx: int):
        if self._duplicate_raises is not None:
            raise self._duplicate_raises
        self.duplicate_calls.append(src_idx)
        # Mimic Live: destination slot (src_idx + 1) now has a copy.
        if src_idx + 1 < len(self.clip_slots):
            dest = self.clip_slots[src_idx + 1]
            src = self.clip_slots[src_idx]
            dest.has_clip = src.has_clip
            dest.clip = StubClip() if src.has_clip else None


class StubMasterTrack:
    """Master has no slots — ``resolve_slot`` on ``master/slots/<N>``
    returns MALFORMED (grammar requires ``tracks/<N>``)."""

    pass


class StubSongView:
    """``song.view`` shim for ``handle_focus``.

    Both attributes are plain assignment targets in Live; the
    ``_raises`` traps let a test exercise the LOM-error branches
    independently, since the handler treats the highlight as
    best-effort and the detail_clip write as the real one.
    """

    def __init__(self):
        self.highlighted_clip_slot = None
        self.detail_clip = None
        self._highlight_raises = None
        self._detail_clip_raises = None

    def __setattr__(self, name, value):
        if name == "highlighted_clip_slot":
            raises = self.__dict__.get("_highlight_raises")
            if raises is not None:
                raise raises
        elif name == "detail_clip":
            raises = self.__dict__.get("_detail_clip_raises")
            if raises is not None:
                raise raises
        object.__setattr__(self, name, value)


class StubSong:
    def __init__(self, n_tracks: int = 2, slots_per_track: int = 4):
        self.tracks = tuple(
            StubTrack(slots_per_track) for _ in range(n_tracks)
        )
        self.master_track = StubMasterTrack()
        self.return_tracks = ()
        self.view = StubSongView()


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def emits() -> List[Tuple[str, tuple]]:
    return []


@pytest.fixture
def advance_calls() -> List[str]:
    return []


@pytest.fixture
def component(emits, advance_calls):
    song = StubSong()

    def emit(addr, args):
        emits.append((addr, args))

    def advance(reason):
        advance_calls.append(reason)

    return ClipsComponent(song=song, emit=emit, advance_generation=advance)


# --- arg-count validation -------------------------------------------------


@pytest.mark.parametrize(
    "address,handler_name,bad_args,expected_detail",
    [
        (V3_CLIP_LAUNCH_ADDRESS, "handle_launch", (), "expected 1, got 0"),
        (V3_CLIP_LAUNCH_ADDRESS, "handle_launch", ("a", "b"), "expected 1, got 2"),
        (V3_CLIP_STOP_ADDRESS, "handle_stop", (), "expected 1, got 0"),
        (V3_CLIP_DELETE_ADDRESS, "handle_delete", ("a", "b"), "expected 1, got 2"),
        (V3_CLIP_DUPLICATE_ADDRESS, "handle_duplicate", ("only-one",), "expected 2, got 1"),
        (V3_CLIP_DUPLICATE_ADDRESS, "handle_duplicate", (), "expected 2, got 0"),
    ],
)
def test_bad_arg_count_emits_write_rejected(
    component, emits, address, handler_name, bad_args, expected_detail,
):
    handler = getattr(component, handler_name)
    handler(args=bad_args, source_addr=None)
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, path, detail = payload
    assert originating == address
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == ""
    assert detail == "arg-count: " + expected_detail


def test_correct_arg_count_does_not_emit_arg_count_error(component, emits):
    """Correct arg counts never trigger the ``arg-count: expected …``
    branch. Individual handlers may still emit semantic errors
    (empty-slot delete → ``clip-not-present``, empty-src duplicate
    → ``clip-not-present``); those are covered in dedicated tests
    below. Here we only assert the arg-count branch stays quiet."""
    component.handle_launch(args=("tracks/0/slots/0",), source_addr=None)
    component.handle_stop(args=("tracks/0",), source_addr=None)
    component.handle_delete(args=("tracks/0/slots/0",), source_addr=None)
    component.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/1"),
        source_addr=None,
    )
    for _addr, payload in emits:
        _orig, _code, _path, detail = payload
        assert not detail.startswith("arg-count:")


# --- resolve-slot helper --------------------------------------------------


def test_resolve_slot_or_error_ok(component, emits):
    """OK returns the LOM object and emits nothing."""
    slot = component._resolve_slot_or_error(
        V3_CLIP_LAUNCH_ADDRESS,
        "tracks/0/slots/2",
    )
    assert slot is not None
    assert isinstance(slot, StubClipSlot)
    assert emits == []


def test_resolve_slot_or_error_oob_emits_slot_not_found(component, emits):
    """Out-of-bounds slot index → ``slot-not-found`` on the wire."""
    result = component._resolve_slot_or_error(
        V3_CLIP_LAUNCH_ADDRESS,
        "tracks/0/slots/99",
    )
    assert result is None
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, path, _detail = payload
    assert originating == V3_CLIP_LAUNCH_ADDRESS
    assert code == V3_ERROR_SLOT_NOT_FOUND
    assert path == "tracks/0/slots/99"


def test_resolve_slot_or_error_malformed_emits_write_rejected(component, emits):
    """Malformed slotPath → ``write-rejected`` (a grammar failure
    doesn't match any slot-specific code; the generic write-rejected
    is correct per the design table)."""
    result = component._resolve_slot_or_error(
        V3_CLIP_DELETE_ADDRESS,
        "not-a-path",
    )
    assert result is None
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_resolve_slot_or_error_master_slots_not_found(component, emits):
    """``master/slots/<N>`` parses (``master`` is a valid trackRef)
    but master has no ``clip_slots`` → the resolver reports NOT_FOUND,
    which the component surfaces as ``slot-not-found``. Documents the
    behavior so a future refactor that tightens master-path rejection
    has to re-decide the wire code explicitly."""
    result = component._resolve_slot_or_error(
        V3_CLIP_LAUNCH_ADDRESS,
        "master/slots/0",
    )
    assert result is None
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


# --- error-emit shape -----------------------------------------------------


def test_emit_error_uses_four_arg_shape(component, emits):
    """Component emits ``/looping/v3/error [origAddr, code, path, detail]``
    exactly — 4 args, not 3 or 5. Mirrors DevicesComponent /
    DeviceLoadComponent."""
    component._emit_error(
        V3_CLIP_LAUNCH_ADDRESS,
        "some-code",
        path="tracks/0/slots/0",
        detail="because",
    )
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    assert len(payload) == 4
    assert payload == (
        V3_CLIP_LAUNCH_ADDRESS,
        "some-code",
        "tracks/0/slots/0",
        "because",
    )


def test_emit_survives_transport_exception(component, emits):
    """A raising emit hook does not escape the component. Same
    defensive pattern as every other v3 component."""
    def raising_emit(addr, args):
        raise RuntimeError("transport boom")

    song = StubSong()
    comp = ClipsComponent(
        song=song,
        emit=raising_emit,
        advance_generation=lambda r: None,
    )
    # Must not raise.
    comp._emit_error(V3_CLIP_LAUNCH_ADDRESS, "x", path="", detail="")


# --- bytes coercion -------------------------------------------------------


def test_bytes_slot_path_coerced(component, emits):
    """OSC may deliver args as bytes; handlers must decode before
    passing to the resolver. Arg-count check accepts a bytes arg
    without error; the slotPath coercion happens inside the handler."""
    component.handle_launch(args=(b"tracks/0/slots/1",), source_addr=None)
    # No arg-count error.
    assert emits == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_blocks_handlers(component, emits):
    component.disconnect()
    component.handle_launch(args=("tracks/0/slots/0",), source_addr=None)
    component.handle_stop(args=("tracks/0",), source_addr=None)
    component.handle_delete(args=("tracks/0/slots/0",), source_addr=None)
    component.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/1"),
        source_addr=None,
    )
    assert emits == []


def test_disconnect_blocks_emit_error(component, emits):
    component.disconnect()
    component._emit_error(V3_CLIP_LAUNCH_ADDRESS, "x", path="", detail="")
    assert emits == []


def test_disconnect_idempotent(component):
    component.disconnect()
    component.disconnect()
    component.disconnect()  # no-raise


# --- launch ---------------------------------------------------------------


def test_launch_populated_slot_fires_clip(component, emits):
    """Happy path: slot has a clip, ``slot.fire()`` is invoked once,
    no error emitted."""
    song = component._song
    # Populate slot 1 on track 0.
    slot = song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    component.handle_launch(args=("tracks/0/slots/1",), source_addr=None)

    assert slot.fired == 1
    assert emits == []


def test_launch_empty_slot_still_fires_no_error(component, emits):
    """Design §2.1: empty-slot launch matches Live UX. The component
    calls ``slot.fire()`` unconditionally; Live decides whether that's
    a record-into-armed start or a silent no-op. Either way, no error
    on the wire."""
    component.handle_launch(args=("tracks/0/slots/0",), source_addr=None)

    slot = component._song.tracks[0].clip_slots[0]
    assert slot.fired == 1
    assert emits == []


def test_launch_oob_slot_emits_slot_not_found(component, emits):
    component.handle_launch(args=("tracks/0/slots/99",), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_launch_fire_raises_emits_launch_failed(component, emits):
    """LOM-raise guard: ``slot.fire()`` throws → ``launch-failed``
    with the exception class + truncated message in ``detail``."""
    slot = component._song.tracks[0].clip_slots[2]
    slot._fire_raises = RuntimeError("live busy")

    component.handle_launch(args=("tracks/0/slots/2",), source_addr=None)

    assert slot.fired == 0
    assert len(emits) == 1
    _addr, payload = emits[0]
    orig, code, path, detail = payload
    assert orig == V3_CLIP_LAUNCH_ADDRESS
    assert code == V3_ERROR_LAUNCH_FAILED
    assert path == "tracks/0/slots/2"
    assert "RuntimeError" in detail
    assert "live busy" in detail


def test_launch_fire_typeerror_caught(component, emits):
    """``Boost.Python.ArgumentError`` is a ``TypeError`` subclass —
    Live raises it when a C++ handle is torn down. The ``_LOM_ERRORS``
    tuple must catch it. Exercised with a stub that raises
    ``TypeError`` directly."""
    slot = component._song.tracks[0].clip_slots[3]
    slot._fire_raises = TypeError("C++ handle invalid")

    component.handle_launch(args=("tracks/0/slots/3",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_LAUNCH_FAILED
    assert "TypeError" in detail


# --- stop -----------------------------------------------------------------


def test_stop_track_calls_stop_all_clips(component, emits):
    component.handle_stop(args=("tracks/1",), source_addr=None)

    assert component._song.tracks[1].stop_all_called == 1
    # Other track untouched.
    assert component._song.tracks[0].stop_all_called == 0
    assert emits == []


def test_stop_idempotent_no_playing_clip(component, emits):
    """Track with no playing clip — LOM call is still invoked; it's
    a no-op at the Live layer. Component doesn't pre-check."""
    component.handle_stop(args=("tracks/0",), source_addr=None)
    component.handle_stop(args=("tracks/0",), source_addr=None)

    assert component._song.tracks[0].stop_all_called == 2
    assert emits == []


def test_stop_master_track_accepted(component, emits):
    """Master is a valid trackRef. The stub master has no
    ``stop_all_clips`` method (masters don't need one since they
    have no slots), so the call raises ``AttributeError`` which is
    caught by ``_LOM_ERRORS`` and surfaces as ``write-rejected``.
    Documents the behavior — a real Live master would accept the
    call as a no-op."""
    component.handle_stop(args=("master",), source_addr=None)

    # Either a clean accept or a write-rejected — in the stub it's
    # the latter (no ``stop_all_clips`` on StubMasterTrack), but the
    # resolver itself accepted ``master`` as a valid track.
    if emits:
        _addr, payload = emits[0]
        _orig, code, _path, _detail = payload
        assert code == V3_ERROR_WRITE_REJECTED


def test_stop_unknown_track_emits_path_not_found(component, emits):
    component.handle_stop(args=("tracks/99",), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "tracks/99"


def test_stop_malformed_track_emits_write_rejected(component, emits):
    component.handle_stop(args=("not-a-path",), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_stop_returns_track_not_supported(component, emits):
    """Return tracks are NOT_SUPPORTED at the resolver layer
    (Phase 1 doesn't ship returns). Maps to ``path-not-supported``."""
    from components.ClipsComponent import V3_ERROR_PATH_NOT_SUPPORTED

    component.handle_stop(args=("returns/0",), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_PATH_NOT_SUPPORTED


def test_stop_raise_emits_write_rejected(component, emits):
    """LOM-raise guard: a torn-down track's ``stop_all_clips`` throws
    → write-rejected with the exception class in ``detail``."""
    component._song.tracks[0]._stop_all_raises = RuntimeError("torn down")

    component.handle_stop(args=("tracks/0",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0"
    assert "RuntimeError" in detail
    assert "torn down" in detail


# --- delete ---------------------------------------------------------------


def test_delete_populated_slot_calls_delete_clip(component, emits):
    slot = component._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    component.handle_delete(args=("tracks/0/slots/1",), source_addr=None)

    assert slot.delete_called == 1
    assert slot.has_clip is False
    assert emits == []


def test_delete_empty_slot_emits_clip_not_present(component, emits):
    """Empty slot → ``clip-not-present`` without touching
    ``delete_clip`` (which would be a no-op on Live but a waste
    and a confusing log line)."""
    slot = component._song.tracks[0].clip_slots[0]
    # Populated? No. (Default StubClipSlot has_clip=False.)

    component.handle_delete(args=("tracks/0/slots/0",), source_addr=None)

    assert slot.delete_called == 0
    _addr, payload = emits[0]
    orig, code, path, _detail = payload
    assert orig == V3_CLIP_DELETE_ADDRESS
    assert code == V3_ERROR_CLIP_NOT_PRESENT
    assert path == "tracks/0/slots/0"


def test_delete_oob_emits_slot_not_found(component, emits):
    component.handle_delete(args=("tracks/0/slots/99",), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_delete_raises_emits_write_rejected(component, emits):
    slot = component._song.tracks[0].clip_slots[2]
    slot.has_clip = True
    slot.clip = StubClip()
    slot._delete_raises = RuntimeError("busy")

    component.handle_delete(args=("tracks/0/slots/2",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0/slots/2"
    assert "RuntimeError" in detail
    assert "busy" in detail


def test_delete_has_clip_typeerror_treated_as_empty(component, emits):
    """Half-torn-down slot: ``has_clip`` raises ``TypeError``
    (Boost.Python.ArgumentError). ``_slot_has_clip_safe`` returns
    False, so the handler surfaces ``clip-not-present`` — no crash."""
    slot = component._song.tracks[0].clip_slots[3]
    slot._has_clip_raises = TypeError("C++ handle invalid")

    component.handle_delete(args=("tracks/0/slots/3",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_PRESENT


# --- is_triggered (launch queued) -----------------------------------------


def test_attaches_is_triggered_listener_per_slot(component):
    slots = sum(len(t.clip_slots) for t in component._song.tracks)
    assert len(component._is_triggered_listeners) == slots


def test_is_triggered_fire_emits_both_edges(component, emits):
    slot = component._song.tracks[1].clip_slots[2]

    slot.is_triggered = True
    slot.fire_is_triggered_listeners()
    slot.is_triggered = False
    slot.fire_is_triggered_listeners()

    assert emits == [
        (V3_CLIP_TRIGGERED_ADDRESS, ("tracks/1/slots/2", 1)),
        (V3_CLIP_TRIGGERED_ADDRESS, ("tracks/1/slots/2", 0)),
    ]


def test_is_triggered_does_not_advance_generation(component, advance_calls):
    """Queued-ness is telemetry, not structure — a generation bump
    here would invalidate the whole tree on every clip launch."""
    slot = component._song.tracks[0].clip_slots[0]
    slot.is_triggered = True
    slot.fire_is_triggered_listeners()
    assert advance_calls == []


def test_is_triggered_read_raise_emits_false(component, emits):
    """A torn-down slot reads as 'not queued' — the harmless
    direction: the UI's blink just stops."""
    slot = component._song.tracks[0].clip_slots[0]
    slot._is_triggered_raises = TypeError("C++ handle invalid")

    slot.fire_is_triggered_listeners()

    assert emits == [(V3_CLIP_TRIGGERED_ADDRESS, ("tracks/0/slots/0", 0))]


def test_is_triggered_empty_slot_still_reports(component, emits):
    """The case that needs the signal most: an empty slot queued to
    record has no clip to observe, which is why the listener is
    slot-scoped rather than clip-scoped."""
    slot = component._song.tracks[0].clip_slots[3]
    assert slot.has_clip is False
    slot.is_triggered = True
    slot.fire_is_triggered_listeners()
    assert emits == [(V3_CLIP_TRIGGERED_ADDRESS, ("tracks/0/slots/3", 1))]


def test_disconnect_detaches_is_triggered_listeners(component):
    slot = component._song.tracks[0].clip_slots[0]
    assert len(slot._is_triggered_listeners) == 1

    component.disconnect()

    assert component._is_triggered_listeners == {}
    assert slot._is_triggered_listeners == []


def test_rebind_reattaches_is_triggered_listeners(component):
    slots = sum(len(t.clip_slots) for t in component._song.tracks)
    component.rebind()
    assert len(component._is_triggered_listeners) == slots
    # Exactly one listener per slot after a rebind — a leak here would
    # double every emit.
    assert all(
        len(s._is_triggered_listeners) == 1
        for t in component._song.tracks
        for s in t.clip_slots
    )


def test_is_triggered_fire_after_disconnect_is_silent(component, emits):
    component.disconnect()
    # Callback held by a test, as Live could still fire one in flight.
    component._on_is_triggered_changed(
        component._song.tracks[0].clip_slots[0], "tracks/0/slots/0",
    )
    assert emits == []


# --- focus ----------------------------------------------------------------
#
# The long-press gesture in the session grid. The load-bearing contract
# is the negative one: focusing must never fire the slot.


def test_focus_populated_slot_sets_view_without_firing(component, emits):
    slot = component._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    component.handle_focus(args=("tracks/0/slots/1",), source_addr=None)

    assert component._song.view.detail_clip is slot.clip
    assert component._song.view.highlighted_clip_slot is slot
    # The whole point of the gesture.
    assert slot.fired == 0
    # Focus answers on clip/focused via the detail_clip listener — this
    # handler emits nothing of its own.
    assert emits == []


def test_focus_empty_slot_emits_clip_not_present(component, emits):
    slot = component._song.tracks[0].clip_slots[0]

    component.handle_focus(args=("tracks/0/slots/0",), source_addr=None)

    assert component._song.view.detail_clip is None
    assert slot.fired == 0
    _addr, payload = emits[0]
    orig, code, path, _detail = payload
    assert orig == V3_CLIP_FOCUS_ADDRESS
    assert code == V3_ERROR_CLIP_NOT_PRESENT
    assert path == "tracks/0/slots/0"


def test_focus_oob_slot_emits_slot_not_found(component, emits):
    component.handle_focus(args=("tracks/0/slots/99",), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_focus_bad_arg_count_emits_write_rejected(component, emits):
    component.handle_focus(args=(), source_addr=None)
    _addr, payload = emits[0]
    orig, code, _path, detail = payload
    assert orig == V3_CLIP_FOCUS_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert "expected 1, got 0" in detail


def test_focus_highlight_raise_still_sets_detail_clip(component, emits):
    """The highlight is cosmetic — losing it must not cost the focus,
    which is the thing the clip view actually reads."""
    slot = component._song.tracks[0].clip_slots[2]
    slot.has_clip = True
    slot.clip = StubClip()
    component._song.view._highlight_raises = RuntimeError("no session view")

    component.handle_focus(args=("tracks/0/slots/2",), source_addr=None)

    assert component._song.view.detail_clip is slot.clip
    assert emits == []


def test_focus_detail_clip_raise_emits_write_rejected(component, emits):
    slot = component._song.tracks[0].clip_slots[2]
    slot.has_clip = True
    slot.clip = StubClip()
    component._song.view._detail_clip_raises = RuntimeError("busy")

    component.handle_focus(args=("tracks/0/slots/2",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0/slots/2"
    assert "RuntimeError" in detail


def test_focus_has_clip_typeerror_treated_as_empty(component, emits):
    slot = component._song.tracks[0].clip_slots[3]
    slot._has_clip_raises = TypeError("C++ handle invalid")

    component.handle_focus(args=("tracks/0/slots/3",), source_addr=None)

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_PRESENT


def test_focus_disconnect_short_circuits(component, emits):
    slot = component._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()
    component.disconnect()

    component.handle_focus(args=("tracks/0/slots/1",), source_addr=None)

    assert component._song.view.detail_clip is None
    assert emits == []


# --- duplicate ------------------------------------------------------------


def test_duplicate_happy_path_calls_duplicate_clip_slot(component, emits):
    """Src populated, dest empty, dest = src+1 on same track →
    ``Track.duplicate_clip_slot(src_idx)``."""
    track = component._song.tracks[0]
    src = track.clip_slots[1]
    src.has_clip = True
    src.clip = StubClip()

    component.handle_duplicate(
        args=("tracks/0/slots/1", "tracks/0/slots/2"),
        source_addr=None,
    )

    assert track.duplicate_calls == [1]
    assert emits == []


def test_duplicate_cross_track_emits_path_not_supported(component, emits):
    """Same-track-only. Cross-track dest → ``path-not-supported``."""
    src = component._song.tracks[0].clip_slots[1]
    src.has_clip = True
    src.clip = StubClip()

    component.handle_duplicate(
        args=("tracks/0/slots/1", "tracks/1/slots/2"),
        source_addr=None,
    )

    assert component._song.tracks[0].duplicate_calls == []
    _addr, payload = emits[0]
    orig, code, _path, _detail = payload
    assert orig == V3_CLIP_DUPLICATE_ADDRESS
    assert code == V3_ERROR_PATH_NOT_SUPPORTED


def test_duplicate_non_adjacent_dest_emits_duplicate_rejected(
    component, emits,
):
    """Dest must be src+1. Skip-ahead rejects with
    ``duplicate-rejected / destination-not-next-slot``."""
    src = component._song.tracks[0].clip_slots[0]
    src.has_clip = True
    src.clip = StubClip()

    component.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/2"),
        source_addr=None,
    )

    assert component._song.tracks[0].duplicate_calls == []
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_DUPLICATE_REJECTED
    assert "destination-not-next-slot" in detail


def test_duplicate_empty_source_emits_clip_not_present(component, emits):
    """Source has no clip → nothing to duplicate."""
    # Both slots empty by default.
    component.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/1"),
        source_addr=None,
    )

    assert component._song.tracks[0].duplicate_calls == []
    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_PRESENT
    assert path == "tracks/0/slots/0"


def test_duplicate_destination_occupied_emits_duplicate_rejected(
    component, emits,
):
    """Dest already has a clip → ``duplicate-rejected /
    destination-occupied`` (Live would overwrite silently; v3
    surfaces this as a reject so the UI can confirm)."""
    track = component._song.tracks[0]
    src = track.clip_slots[0]
    src.has_clip = True
    src.clip = StubClip()
    dest = track.clip_slots[1]
    dest.has_clip = True
    dest.clip = StubClip()

    component.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/1"),
        source_addr=None,
    )

    assert track.duplicate_calls == []
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_DUPLICATE_REJECTED
    assert "destination-occupied" in detail


def test_duplicate_malformed_source_emits_write_rejected(component, emits):
    component.handle_duplicate(
        args=("not-a-path", "tracks/0/slots/1"),
        source_addr=None,
    )
    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "not-a-path"


def test_duplicate_malformed_dest_emits_write_rejected(component, emits):
    component.handle_duplicate(
        args=("tracks/0/slots/0", "garbage"),
        source_addr=None,
    )
    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "garbage"


def test_duplicate_lom_raise_emits_duplicate_rejected(component, emits):
    """``Track.duplicate_clip_slot`` throws → ``duplicate-rejected``
    with the exception class + truncated message in ``detail``."""
    track = component._song.tracks[0]
    src = track.clip_slots[0]
    src.has_clip = True
    src.clip = StubClip()
    track._duplicate_raises = RuntimeError("live refused")

    component.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/1"),
        source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, path, detail = payload
    assert code == V3_ERROR_DUPLICATE_REJECTED
    assert path == "tracks/0/slots/0"
    assert "RuntimeError" in detail
    assert "live refused" in detail


# --- handle_duplicate_region (ROW 8) -------------------------------------


def test_duplicate_region_bad_arg_count_emits_write_rejected(component, emits):
    component.handle_duplicate_region(args=(), source_addr=None)
    assert len(emits) == 1
    addr, payload = emits[0]
    assert addr == V3_ERROR_ADDRESS
    originating, code, _path, detail = payload
    assert originating == V3_CLIP_DUPLICATE_REGION_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert detail.startswith("arg-count:")


def test_duplicate_region_happy_path_calls_clip_duplicate_loop(component, emits):
    slot = component._song.tracks[0].clip_slots[0]
    slot.has_clip = True
    slot.clip = StubClip(is_midi=True)
    component.handle_duplicate_region(
        args=("tracks/0/slots/0",), source_addr=None,
    )
    assert slot.clip.duplicate_loop_calls == 1
    assert emits == []


def test_duplicate_region_empty_slot_emits_clip_not_present(component, emits):
    slot = component._song.tracks[0].clip_slots[3]
    slot.has_clip = False
    slot.clip = None
    component.handle_duplicate_region(
        args=("tracks/0/slots/3",), source_addr=None,
    )
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, path, _detail = payload
    assert originating == V3_CLIP_DUPLICATE_REGION_ADDRESS
    assert code == V3_ERROR_CLIP_NOT_PRESENT
    assert path == "tracks/0/slots/3"


def test_duplicate_region_audio_clip_emits_clip_not_midi(component, emits):
    slot = component._song.tracks[0].clip_slots[0]
    slot.has_clip = True
    slot.clip = StubClip(is_midi=False)
    component.handle_duplicate_region(
        args=("tracks/0/slots/0",), source_addr=None,
    )
    assert slot.clip.duplicate_loop_calls == 0
    assert len(emits) == 1
    _addr, payload = emits[0]
    originating, code, path, _detail = payload
    assert originating == V3_CLIP_DUPLICATE_REGION_ADDRESS
    assert code == V3_ERROR_CLIP_NOT_MIDI
    assert path == "tracks/0/slots/0"


def test_duplicate_region_is_midi_clip_raise_is_clip_not_present(component, emits):
    """Torn-down clip handle during ``is_midi_clip`` read surfaces as
    ``clip-not-present`` — matches the ``handle_delete`` convention."""
    slot = component._song.tracks[0].clip_slots[0]
    slot.has_clip = True
    slot.clip = StubClip(is_midi=True)
    slot.clip._is_midi_clip_raises = RuntimeError("gone")
    component.handle_duplicate_region(
        args=("tracks/0/slots/0",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, detail = payload
    assert code == V3_ERROR_CLIP_NOT_PRESENT
    assert "is_midi_clip raised" in detail


def test_duplicate_region_duplicate_loop_raise_is_write_rejected(component, emits):
    slot = component._song.tracks[0].clip_slots[0]
    slot.has_clip = True
    slot.clip = StubClip(is_midi=True)
    slot.clip._duplicate_loop_raises = RuntimeError("live refused")
    component.handle_duplicate_region(
        args=("tracks/0/slots/0",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "duplicate_loop raised" in detail
    assert "RuntimeError" in detail


def test_duplicate_region_malformed_path_emits_write_rejected(component, emits):
    component.handle_duplicate_region(args=("nope",), source_addr=None)
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_duplicate_region_master_path_is_slot_not_found(component, emits):
    """Master has no slots — resolver reports NOT_FOUND, surfaced as
    ``slot-not-found`` per the shared _SLOT_RESOLVE_ERROR_MAP."""
    component.handle_duplicate_region(
        args=("master/slots/0",), source_addr=None,
    )
    _addr, payload = emits[0]
    _originating, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_duplicate_region_disconnect_short_circuits(component, emits):
    slot = component._song.tracks[0].clip_slots[0]
    slot.has_clip = True
    slot.clip = StubClip(is_midi=True)
    component.disconnect()
    component.handle_duplicate_region(
        args=("tracks/0/slots/0",), source_addr=None,
    )
    assert slot.clip.duplicate_loop_calls == 0
    assert emits == []


# --- has_clip listener (pr7b-5) ------------------------------------------


def test_init_attaches_has_clip_listener_per_slot(component):
    """Every slot on every regular track gets one ``has_clip``
    listener at component init. 2 tracks × 4 slots = 8 listeners."""
    for track in component._song.tracks:
        for slot in track.clip_slots:
            assert len(slot._has_clip_listeners) == 1
    # Bookkeeping reflects the same count.
    assert len(component._has_clip_listeners) == 8


def test_has_clip_fire_emits_created_when_populated(
    component, emits, advance_calls,
):
    """Listener fires, slot reads as populated → generation advances
    with reason ``clip-created`` and ``/clip/created`` emits."""
    slot = component._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    slot.fire_has_clip_listeners()

    assert advance_calls == ["clip-created"]
    assert emits == [(V3_CLIP_CREATED_ADDRESS, ("tracks/0/slots/1",))]


def test_has_clip_fire_emits_removed_when_empty(
    component, emits, advance_calls,
):
    """Listener fires, slot reads as empty → ``/clip/removed`` +
    ``clip-removed`` generation advance."""
    slot = component._song.tracks[1].clip_slots[2]
    # default has_clip=False

    slot.fire_has_clip_listeners()

    assert advance_calls == ["clip-removed"]
    assert emits == [(V3_CLIP_REMOVED_ADDRESS, ("tracks/1/slots/2",))]


def test_has_clip_burst_coalesced_by_generation(
    component, emits, advance_calls,
):
    """Design §2.5: no explicit debounce — each listener fire emits.
    The generation counter's own coalesce lives at the
    state/invalidate scheduler, not here. Verify the component
    faithfully emits one message per fire."""
    slot0 = component._song.tracks[0].clip_slots[0]
    slot1 = component._song.tracks[0].clip_slots[1]
    slot0.has_clip = True
    slot1.has_clip = True

    slot0.fire_has_clip_listeners()
    slot1.fire_has_clip_listeners()

    assert len(emits) == 2
    assert len(advance_calls) == 2


def test_has_clip_fire_typeerror_treated_as_removed(
    component, emits, advance_calls,
):
    """Half-torn-down slot: ``has_clip`` raises ``TypeError`` during
    the fire-path read. ``_slot_has_clip_safe`` returns False, so the
    handler treats this as ``clip-removed`` — wire stays clean."""
    slot = component._song.tracks[0].clip_slots[3]
    slot._has_clip_raises = TypeError("C++ handle invalid")

    slot.fire_has_clip_listeners()

    assert advance_calls == ["clip-removed"]
    assert emits == [(V3_CLIP_REMOVED_ADDRESS, ("tracks/0/slots/3",))]


def test_add_has_clip_change_callback_dispatches_after_wire_emit(
    component, emits, advance_calls,
):
    """Registered callbacks run synchronously on every has_clip flip,
    after the wire emit. Receives ``(slot_path, has_clip)``."""
    fanout: list = []
    component.add_has_clip_change_callback(
        lambda path, has: fanout.append((path, has)),
    )

    slot_create = component._song.tracks[0].clip_slots[1]
    slot_create.has_clip = True
    slot_create.clip = StubClip()
    slot_create.fire_has_clip_listeners()

    slot_remove = component._song.tracks[1].clip_slots[2]
    slot_remove.fire_has_clip_listeners()  # default has_clip=False

    assert fanout == [
        ("tracks/0/slots/1", True),
        ("tracks/1/slots/2", False),
    ]
    # Wire emits still produced — fanout is additive.
    assert emits == [
        (V3_CLIP_CREATED_ADDRESS, ("tracks/0/slots/1",)),
        (V3_CLIP_REMOVED_ADDRESS, ("tracks/1/slots/2",)),
    ]


def test_has_clip_callback_exception_does_not_block_others(
    component, emits, advance_calls,
):
    """A raising callback must not prevent later callbacks from firing
    or interrupt the wire emit ordering."""
    fanout: list = []

    def boom(path, has):
        raise RuntimeError("explode")

    component.add_has_clip_change_callback(boom)
    component.add_has_clip_change_callback(
        lambda path, has: fanout.append((path, has)),
    )

    slot = component._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()
    slot.fire_has_clip_listeners()

    assert fanout == [("tracks/0/slots/1", True)]


def test_disconnect_clears_has_clip_callbacks(component, emits):
    """``disconnect`` drops the callback list so a stray fire-path
    invocation can't reach external observers after teardown."""
    fanout: list = []
    component.add_has_clip_change_callback(
        lambda path, has: fanout.append((path, has)),
    )
    component.disconnect()
    # No public API to fire post-disconnect (slots' listeners are
    # detached), but verify the list is empty for defense-in-depth.
    assert component._has_clip_callbacks == []


def test_rebind_detaches_old_listeners_and_reattaches(component):
    """Structural change: ``rebind`` must detach every old listener
    and reattach a fresh set. Verified by counting listeners on the
    stub before + after rebind."""
    old_slot = component._song.tracks[0].clip_slots[0]
    assert len(old_slot._has_clip_listeners) == 1

    component.rebind()

    # Still exactly one — the old was detached, a new one attached.
    assert len(old_slot._has_clip_listeners) == 1
    assert len(component._has_clip_listeners) == 8


def test_rebind_picks_up_new_tracks(component, emits, advance_calls):
    """After ``rebind`` with an expanded song, new tracks' slots get
    listeners. Simulates a track-add event."""
    # Extend the song's tracks.
    song = component._song
    new_track = StubTrack(n_slots=4)
    song.tracks = song.tracks + (new_track,)

    component.rebind()

    assert len(component._has_clip_listeners) == 12  # 3 tracks × 4 slots
    for slot in new_track.clip_slots:
        assert len(slot._has_clip_listeners) == 1

    # New track's listener fires the correct path.
    new_track.clip_slots[0].has_clip = True
    new_track.clip_slots[0].fire_has_clip_listeners()
    assert emits[-1] == (V3_CLIP_CREATED_ADDRESS, ("tracks/2/slots/0",))


def test_disconnect_detaches_all_slot_listeners(component):
    component.disconnect()
    for track in component._song.tracks:
        for slot in track.clip_slots:
            assert slot._has_clip_listeners == []
    assert component._has_clip_listeners == {}


def test_disconnected_listener_fire_is_silent(
    component, emits, advance_calls,
):
    """Listener fires after disconnect should not touch the wire.
    The detach in ``disconnect`` should prevent this outright, but
    we also guard inside ``_on_has_clip_changed`` against a stray
    fire that slips through Live's teardown race."""
    slot = component._song.tracks[0].clip_slots[0]
    # Capture the callback before disconnect.
    assert slot._has_clip_listeners
    stale_cb = slot._has_clip_listeners[0]

    component.disconnect()

    # Invoke the stale callback directly — simulates a Live fire
    # during teardown.
    stale_cb()

    assert emits == []
    assert advance_calls == []


def test_disconnect_survives_remove_raise(component):
    """A torn-down C++ slot can raise on ``remove_has_clip_listener``.
    ``disconnect`` must survive and still clear bookkeeping so a
    subsequent surface restart doesn't leak."""
    slot = component._song.tracks[0].clip_slots[2]
    slot._remove_listener_raises = RuntimeError("C++ handle invalid")

    component.disconnect()

    # Bookkeeping cleared even though one detach raised.
    assert component._has_clip_listeners == {}


def test_advance_generation_exception_does_not_block_emit(
    component, emits,
):
    """Defensive: if ``advance_generation`` throws (unexpected, but
    cheap to guard), the component still emits ``/clip/created``
    so the UI isn't starved of the structural event."""
    def boom(reason):
        raise RuntimeError("generation component torn down")

    song = StubSong()
    comp = ClipsComponent(
        song=song, emit=lambda a, x: emits.append((a, x)),
        advance_generation=boom,
    )
    slot = song.tracks[0].clip_slots[0]
    slot.has_clip = True

    # Must not raise.
    slot.fire_has_clip_listeners()

    assert len(emits) == 1
    assert emits[0][0] == V3_CLIP_CREATED_ADDRESS


def test_init_survives_slot_without_listener_method(emits, advance_calls):
    """If a stub slot lacks ``add_has_clip_listener`` (older Live or
    partial mock), init logs and moves on — no crash, and the rest
    of the walk still attaches."""

    class SlotNoListener:
        has_clip = False

    class TrackMixedSlots:
        def __init__(self):
            self.clip_slots = (
                SlotNoListener(),
                StubClipSlot(),  # this one has the API
            )

    class SongMixed:
        def __init__(self):
            self.tracks = (TrackMixedSlots(),)
            self.master_track = StubMasterTrack()
            self.return_tracks = ()

    comp = ClipsComponent(
        song=SongMixed(),
        emit=lambda a, x: emits.append((a, x)),
        advance_generation=lambda r: advance_calls.append(r),
    )
    # Only the one real StubClipSlot got bookkept.
    assert len(comp._has_clip_listeners) == 1
    assert "tracks/0/slots/1" in comp._has_clip_listeners


# --- burst / integration (pr7b-11) ---------------------------------------


def test_has_clip_burst_20_events_emits_20_in_order(component, emits, advance_calls):
    """pr7b-11 stress: a burst of 20 has_clip toggles produces exactly
    20 emits and 20 generation advances, ordering preserved. Coalesce
    is not the component's job (per design: 'no explicit debounce' —
    see _has_clip_burst_coalesced_by_generation); this guards against
    silent drops and out-of-order delivery under volume.
    """
    slots = component._song.tracks[0].clip_slots

    for i in range(20):
        slot = slots[i % len(slots)]
        slot.has_clip = (i % 2 == 0)
        slot.fire_has_clip_listeners()

    assert len(emits) == 20
    assert len(advance_calls) == 20
    # Reasons alternate based on has_clip state at fire time.
    expected_reasons = [
        "clip-created" if (i % 2 == 0) else "clip-removed"
        for i in range(20)
    ]
    assert advance_calls == expected_reasons


def test_clip_fire_flows_through_generation_to_invalidation(emits):
    """pr7b-11 integration: wire ClipsComponent → GenerationComponent →
    InvalidationComponent and confirm 1:1 slot-fire → invalidate with
    monotonic generation numbers. This is the contract the scheduler
    layer above relies on — one has_clip event produces one
    ``/looping/v3/state/invalidate`` carrying the new generation.
    """
    from components.GenerationComponent import GenerationComponent
    from components.InvalidationComponent import (
        InvalidationComponent,
        V3_STATE_INVALIDATE_ADDRESS,
    )

    song = StubSong()

    def emit(addr, args):
        emits.append((addr, args))

    gen = GenerationComponent()
    InvalidationComponent(generation_component=gen, emit=emit)
    ClipsComponent(song=song, emit=emit, advance_generation=gen.advance)

    # Fire 20 has_clip events across slots.
    for i in range(20):
        slot = song.tracks[0].clip_slots[i % 4]
        slot.has_clip = (i % 2 == 0)
        slot.fire_has_clip_listeners()

    invalidates = [e for e in emits if e[0] == V3_STATE_INVALIDATE_ADDRESS]
    clip_events = [
        e for e in emits
        if e[0] in (V3_CLIP_CREATED_ADDRESS, V3_CLIP_REMOVED_ADDRESS)
    ]

    assert len(clip_events) == 20
    assert len(invalidates) == 20

    # Each invalidate carries (generation, reason). Generations must be
    # strictly monotonic — no drops, no duplicates.
    generations = [payload[0] for _addr, payload in invalidates]
    assert generations == sorted(generations)
    assert len(set(generations)) == 20

    # Reasons are passed through unchanged.
    reasons = [payload[1] for _addr, payload in invalidates]
    expected = [
        "clip-created" if (i % 2 == 0) else "clip-removed"
        for i in range(20)
    ]
    assert reasons == expected


# --- load_file ------------------------------------------------------------


@pytest.fixture
def existing_audio_file(tmp_path):
    """Create a fake audio file on disk. The load_file handler
    pre-checks ``os.path.isfile`` before calling into the LOM, so the
    test needs a real inode to avoid a ``path-not-found`` short-circuit.
    Extension doesn't matter — the handler is extension-agnostic; only
    the UI layer enforces audio-vs-preset discrimination."""
    f = tmp_path / "fake.wav"
    f.write_bytes(b"RIFF____WAVEfmt ")  # minimal bytes; never actually read
    return str(f)


def test_load_file_explicit_slot_creates_audio_clip(
    component, emits, existing_audio_file,
):
    """Happy path with an explicit empty slot — create_audio_clip fires
    with the file path, no errors emit."""
    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/1", existing_audio_file),
        source_addr=None,
    )
    slot = component._song.tracks[0].clip_slots[1]
    assert slot.created_audio_clips == [existing_audio_file]
    assert emits == []


def test_load_file_explicit_slot_replaces_existing_clip(
    component, emits, existing_audio_file,
):
    """Slot already holds a clip — handler deletes first, then creates
    the new audio clip. Mirrors the UI's "replace audio clip" gesture."""
    slot = component._song.tracks[0].clip_slots[2]
    slot.has_clip = True
    slot.clip = StubClip(is_midi=False)

    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/2", existing_audio_file),
        source_addr=None,
    )

    assert slot.delete_called == 1
    assert slot.created_audio_clips == [existing_audio_file]
    assert emits == []


def test_load_file_auto_picks_first_empty_slot(
    component, emits, existing_audio_file,
):
    """Empty slotPath → surface picks the first empty slot on trackPath.
    This is the "drop audio onto selected track, no specific slot" path
    that trackPreparation.loadPreset() exercises."""
    # Fill slots 0 and 1 — handler should pick slot 2.
    for idx in (0, 1):
        s = component._song.tracks[0].clip_slots[idx]
        s.has_clip = True
        s.clip = StubClip(is_midi=False)

    component.handle_load_file(
        args=("tracks/0", "", existing_audio_file),
        source_addr=None,
    )

    assert component._song.tracks[0].clip_slots[2].created_audio_clips == [
        existing_audio_file,
    ]
    # First-two slots untouched.
    for idx in (0, 1):
        assert component._song.tracks[0].clip_slots[idx].created_audio_clips == []
    assert emits == []


def test_load_file_no_empty_slot_emits_no_empty_slot(
    component, emits, existing_audio_file,
):
    """Every slot on track full + empty slotPath → no-empty-slot."""
    for slot in component._song.tracks[0].clip_slots:
        slot.has_clip = True
        slot.clip = StubClip(is_midi=False)

    component.handle_load_file(
        args=("tracks/0", "", existing_audio_file),
        source_addr=None,
    )

    assert len(emits) == 1
    _addr, payload = emits[0]
    orig, code, path, _detail = payload
    assert orig == V3_CLIP_LOAD_FILE_ADDRESS
    assert code == V3_ERROR_NO_EMPTY_SLOT
    assert path == "tracks/0"


def test_load_file_missing_file_emits_path_not_found(component, emits):
    """Filesystem pre-check: non-existent file short-circuits before
    any LOM touch. Stale UI catalog entries fail in microseconds."""
    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/0", "/nope/missing.wav"),
        source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_PATH_NOT_FOUND
    assert path == "/nope/missing.wav"


def test_load_file_empty_file_path_emits_write_rejected(component, emits):
    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/0", ""),
        source_addr=None,
    )
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "empty filePath" in detail


def test_load_file_both_paths_empty_emits_write_rejected(
    component, emits, existing_audio_file,
):
    component.handle_load_file(
        args=("", "", existing_audio_file),
        source_addr=None,
    )
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_load_file_oob_slot_emits_slot_not_found(
    component, emits, existing_audio_file,
):
    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/99", existing_audio_file),
        source_addr=None,
    )
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_load_file_unknown_track_emits_path_not_found(
    component, emits, existing_audio_file,
):
    """Empty slotPath + unknown trackPath → track resolver emits
    path-not-found. Exercises the trackPath-only branch's resolver
    error mapping."""
    component.handle_load_file(
        args=("tracks/99", "", existing_audio_file),
        source_addr=None,
    )
    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_PATH_NOT_FOUND


def test_load_file_create_raises_emits_load_failed(
    component, emits, existing_audio_file,
):
    """LOM-raise guard: torn-down slot's ``create_audio_clip`` throws
    → load-failed with the exception class in ``detail``."""
    slot = component._song.tracks[0].clip_slots[0]
    slot._create_audio_clip_raises = RuntimeError("torn down")

    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/0", existing_audio_file),
        source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, path, detail = payload
    assert code == V3_ERROR_LOAD_FAILED
    assert path == existing_audio_file
    assert "RuntimeError" in detail


def test_load_file_arg_count_mismatch_emits_write_rejected(component, emits):
    component.handle_load_file(args=("a", "b"), source_addr=None)
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "expected 3, got 2" in detail


def test_load_file_disconnect_blocks_handler(
    component, emits, existing_audio_file,
):
    component.disconnect()
    component.handle_load_file(
        args=("tracks/0", "tracks/0/slots/0", existing_audio_file),
        source_addr=None,
    )
    assert emits == []
    assert component._song.tracks[0].clip_slots[0].created_audio_clips == []


# --- wire-address constants ----------------------------------------------


def test_wire_addresses_are_stable():
    """Address rename guard. Changing these is a wire-contract event
    and must be coordinated with constants.json + the UI."""
    assert V3_CLIP_LAUNCH_ADDRESS == "/looping/v3/clip/launch"
    assert V3_CLIP_STOP_ADDRESS == "/looping/v3/clip/stop"
    assert V3_CLIP_DELETE_ADDRESS == "/looping/v3/clip/delete"
    assert V3_CLIP_DUPLICATE_ADDRESS == "/looping/v3/clip/duplicate"
    assert V3_CLIP_DUPLICATE_REGION_ADDRESS == "/looping/v3/clip/duplicate_region"
    assert V3_CLIP_LOAD_FILE_ADDRESS == "/looping/v3/clip/load_file"
    assert V3_CLIP_SET_COLOR_ADDRESS == "/looping/v3/clip/set/color"
    assert V3_CLIP_CREATED_ADDRESS == "/looping/v3/clip/created"
    assert V3_CLIP_REMOVED_ADDRESS == "/looping/v3/clip/removed"
    assert V3_ERROR_ADDRESS == "/looping/v3/error"


# --- set color ------------------------------------------------------------


def _populate_clip(component, track_idx: int, slot_idx: int) -> StubClip:
    """Test helper: install a clip on the given slot, return it."""
    slot = component._song.tracks[track_idx].clip_slots[slot_idx]
    slot.has_clip = True
    slot.clip = StubClip()
    return slot.clip


def test_set_color_writes_clip_color(component, emits):
    """Happy path — clip color is assigned, no error emit."""
    clip = _populate_clip(component, 0, 1)

    component.handle_set_color(
        args=("tracks/0/slots/1/clip", 0xE63946), source_addr=None,
    )

    assert clip.color == 0xE63946
    assert emits == []


def test_set_color_accepts_zero(component, emits):
    """0 is the canonical "uncolored" value Live uses for default
    tracks; must round-trip without rejection."""
    clip = _populate_clip(component, 0, 0)
    clip.color = 0xFF0000  # start non-zero so we can see the write

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", 0), source_addr=None,
    )

    assert clip.color == 0
    assert emits == []


def test_set_color_accepts_max_value(component, emits):
    """0xFFFFFF (white) is the inclusive upper bound."""
    clip = _populate_clip(component, 1, 2)

    component.handle_set_color(
        args=("tracks/1/slots/2/clip", 0xFFFFFF), source_addr=None,
    )

    assert clip.color == 0xFFFFFF
    assert emits == []


def test_set_color_rejects_negative(component, emits):
    clip = _populate_clip(component, 0, 0)

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", -1), source_addr=None,
    )

    assert clip.color == 0  # unchanged
    _addr, payload = emits[0]
    orig, code, path, detail = payload
    assert orig == V3_CLIP_SET_COLOR_ADDRESS
    assert code == V3_ERROR_WRITE_REJECTED
    assert path == "tracks/0/slots/0/clip"
    assert "out of range" in detail


def test_set_color_rejects_overflow(component, emits):
    clip = _populate_clip(component, 0, 0)

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", 0x1000000), source_addr=None,
    )

    assert clip.color == 0
    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "out of range" in detail


def test_set_color_rejects_non_int(component, emits):
    """Strings, None — non-numeric types reject with write-rejected."""
    _populate_clip(component, 0, 0)

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", "red"), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "expected int" in detail


def test_set_color_rejects_fractional_float(component, emits):
    """Non-integer floats (e.g. 1.5) reject with write-rejected."""
    _populate_clip(component, 0, 0)

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", 1.5), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "non-integer float" in detail


def test_set_color_accepts_whole_number_float(component, emits):
    """Whole-number floats (e.g. 5420936.0) are accepted and coerced to int.
    The OSC bridge encodes JS numbers as float32, so this is the wire format."""
    _populate_clip(component, 0, 0)

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", 5420936.0), source_addr=None,
    )

    assert len(emits) == 0  # no error


def test_set_color_rejects_bool(component, emits):
    """``True``/``False`` are technically ``int`` subclasses; a wire
    delivering a bool here is mis-dispatch and must reject."""
    _populate_clip(component, 0, 0)

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", True), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_set_color_empty_slot_emits_clip_not_present(component, emits):
    """clipPath resolves to a slot that exists but has no clip → the
    typed ``clip-not-present`` code, never a generic write-rejected."""
    component.handle_set_color(
        args=("tracks/0/slots/0/clip", 0xE63946), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, path, _detail = payload
    assert code == V3_ERROR_CLIP_NOT_PRESENT
    assert path == "tracks/0/slots/0/clip"


def test_set_color_oob_slot_emits_slot_not_found(component, emits):
    component.handle_set_color(
        args=("tracks/0/slots/99/clip", 0xE63946), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_SLOT_NOT_FOUND


def test_set_color_malformed_path_emits_write_rejected(component, emits):
    """Missing trailing ``/clip`` → MALFORMED → write-rejected."""
    component.handle_set_color(
        args=("tracks/0/slots/0", 0xE63946), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, _detail = payload
    assert code == V3_ERROR_WRITE_REJECTED


def test_set_color_setattr_raises_emits_write_rejected(component, emits):
    """Live raising on ``clip.color = …`` (torn-down handle, etc.)
    surfaces as write-rejected with the exception class in detail."""
    clip = _populate_clip(component, 0, 1)
    clip._color_raises = RuntimeError("handle invalid")

    component.handle_set_color(
        args=("tracks/0/slots/1/clip", 0xE63946), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert "RuntimeError" in detail
    assert "handle invalid" in detail


def test_set_color_disconnected_no_op(component, emits):
    clip = _populate_clip(component, 0, 0)
    component.disconnect()

    component.handle_set_color(
        args=("tracks/0/slots/0/clip", 0xE63946), source_addr=None,
    )

    assert clip.color == 0
    assert emits == []


def test_set_color_bad_arg_count(component, emits):
    """1 arg → write-rejected with arg-count detail."""
    component.handle_set_color(
        args=("tracks/0/slots/0/clip",), source_addr=None,
    )

    _addr, payload = emits[0]
    _orig, code, _path, detail = payload
    assert code == V3_ERROR_WRITE_REJECTED
    assert detail.startswith("arg-count:")


# --- Live's clip panel follows the clip in play ---------------------------


class StubAppView:
    def __init__(self):
        self.shown: List[str] = []

    def show_view(self, name):
        self.shown.append(name)


class StubApp:
    def __init__(self):
        self.view = StubAppView()


@pytest.fixture
def ticks() -> list:
    return []


@pytest.fixture
def app() -> StubApp:
    return StubApp()


@pytest.fixture
def revealing(emits, app, ticks):
    """A component wired to Live's clip panel, with a next-tick queue
    the test runs by hand (a has_clip notification must not write)."""
    return ClipsComponent(
        song=StubSong(), emit=lambda a, b: emits.append((a, b)),
        advance_generation=lambda r: None,
        application=app, schedule_next_tick=ticks.append,
    )


def _run_ticks(ticks):
    while ticks:
        ticks.pop(0)()


def _record_into(slot):
    slot.has_clip = True
    slot.clip = StubClip()
    slot.fire_has_clip_listeners()


def test_reveal_slot_focuses_the_clip_and_shows_clip_view(revealing, app):
    slot = revealing._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    revealing.reveal_slot(slot)

    assert revealing._song.view.detail_clip is slot.clip
    assert app.view.shown == ["Detail/Clip"]


def test_reveal_slot_on_empty_slot_changes_nothing(revealing, app):
    revealing.reveal_slot(revealing._song.tracks[0].clip_slots[0])

    assert revealing._song.view.detail_clip is None
    assert app.view.shown == []


def test_focus_shows_clip_view(revealing, app):
    slot = revealing._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    revealing.handle_focus(args=("tracks/0/slots/1",), source_addr=None)

    assert app.view.shown == ["Detail/Clip"]


def test_recording_into_a_launched_empty_slot_shows_the_take(revealing, app, ticks):
    slot = revealing._song.tracks[1].clip_slots[2]

    revealing.handle_launch(args=("tracks/1/slots/2",), source_addr=None)
    _record_into(slot)
    # Not from inside Live's notification.
    assert app.view.shown == []
    _run_ticks(ticks)

    assert revealing._song.view.detail_clip is slot.clip
    assert app.view.shown == ["Detail/Clip"]


def test_clip_appearing_in_the_highlighted_slot_is_shown(revealing, app, ticks):
    """The pedal records into the highlighted slot without a launch wire."""
    slot = revealing._song.tracks[0].clip_slots[3]
    revealing._song.view.highlighted_clip_slot = slot

    _record_into(slot)
    _run_ticks(ticks)

    assert revealing._song.view.detail_clip is slot.clip
    assert app.view.shown == ["Detail/Clip"]


def test_clip_appearing_elsewhere_is_left_alone(revealing, app, ticks):
    revealing._song.view.highlighted_clip_slot = revealing._song.tracks[0].clip_slots[0]

    _record_into(revealing._song.tracks[1].clip_slots[1])
    _run_ticks(ticks)

    assert revealing._song.view.detail_clip is None
    assert app.view.shown == []


def test_duplicate_shows_the_copy(revealing, app, ticks):
    track = revealing._song.tracks[0]
    src = track.clip_slots[0]
    src.has_clip = True
    src.clip = StubClip()

    revealing.handle_duplicate(
        args=("tracks/0/slots/0", "tracks/0/slots/1"), source_addr=None,
    )
    track.clip_slots[1].fire_has_clip_listeners()
    _run_ticks(ticks)

    assert revealing._song.view.detail_clip is track.clip_slots[1].clip
    assert app.view.shown == ["Detail/Clip"]


def test_launching_a_clip_that_exists_asks_for_no_reveal(revealing, app, ticks):
    """Only an empty slot's launch waits for a clip; the grid's select
    already showed a clip that was there."""
    slot = revealing._song.tracks[0].clip_slots[1]
    slot.has_clip = True
    slot.clip = StubClip()

    revealing.handle_launch(args=("tracks/0/slots/1",), source_addr=None)

    assert revealing._reveal_on_create is None
