"""SongChangeDetector unit tests — PR-3c session-load invalidation.

Closes the streak-blocking gap found in streak session 1 (2026-04-15):
File → Open rebinds ``application.get_document()`` to a new Song
object but does not fire our root ``tracks_changed`` listener. The
detector polls per tick and fires ``on_song_changed`` on identity
drift; this test module asserts its three-path behavior.

The integration-level assertion — "detector fires
``V3StateFullComponent.emit_structural()`` with a new generation
against the new song's tree" — is covered by composing the detector
with a ``V3StateFullComponent`` + ``GenerationComponent`` in
``test_emits_v3_state_full_structural_against_new_song``. That's the
regression test [CLAUDE.md:64](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/CLAUDE.md)
calls for: the bundle's ``reason`` is ``"structural"`` and the
generation advanced from the pre-change value.
"""

from __future__ import annotations

from typing import List

import pytest

from components.GenerationComponent import GenerationComponent
from components.SongChangeDetector import SongChangeDetector
from components.V3StateFullComponent import (
    V3StateFullComponent,
    V3_STATE_FULL_TREE_ADDRESS,
    _HEADER_ARITY,
)
from tests.support.fake_stream import FakeStream
from tests.test_lom_listeners import StubDevice, StubParam, StubSong, StubTrack


# --- unit behavior ---------------------------------------------------------


def test_check_with_same_song_does_not_fire():
    """Baseline: detector armed against a song; a tick with the same
    song must be a no-op. This is what every normal tick looks like
    between session loads."""
    song = object()
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: song,
        on_song_changed=lambda new: fires.append(new),
    )
    d.check()
    d.check()
    d.check()
    assert fires == []


def test_check_with_new_song_fires_once_with_new_song():
    """The load path: detector sees a different object and fires the
    callback exactly once with the new song as the sole argument. A
    follow-up tick against the same new song does NOT re-fire — the
    detector's last-seen id has advanced."""
    songs = [object()]
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: songs[-1],
        on_song_changed=lambda new: fires.append(new),
    )
    new_song = object()
    songs.append(new_song)
    d.check()
    assert fires == [new_song]
    # Same new song on next tick — no re-fire.
    d.check()
    assert fires == [new_song]


def test_check_fires_again_on_second_song_change():
    """User loads set A → set B → set C. Each boundary fires once."""
    songs = [object()]
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: songs[-1],
        on_song_changed=lambda new: fires.append(new),
    )
    second = object()
    songs.append(second)
    d.check()
    third = object()
    songs.append(third)
    d.check()
    assert fires == [second, third]


def test_constructor_none_getter_is_tolerated():
    """Fixture / framework robustness: a getter that returns None at
    construction must not crash. First real poll establishes the
    baseline without firing."""
    ref: List[object | None] = [None]
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: ref[0],
        on_song_changed=lambda new: fires.append(new),
    )
    # Arm with a real song via a subsequent poll — baseline set, no
    # fire. This mirrors the "surface came up before Live finished
    # loading its document" edge case.
    ref[0] = object()
    d.check()
    assert fires == []
    # Now change song; this is the first real drift and must fire.
    new = object()
    ref[0] = new
    d.check()
    assert fires == [new]


def test_getter_raising_does_not_crash_or_fire():
    """A raising getter (framework hiccup, torn-down transport) is
    swallowed; the callback does not fire with a bad value."""
    fires: List[object] = []

    def _raise():
        raise RuntimeError("simulated framework hiccup")

    d = SongChangeDetector(
        get_current_song=_raise,
        on_song_changed=lambda new: fires.append(new),
    )
    # Constructor swallowed the initial raise; check() also swallows.
    d.check()
    assert fires == []


def test_callback_raising_does_not_strand_detector():
    """A raising callback on a song-change must not crash the tick.
    The detector should log and carry on; the next real change still
    fires the (still-raising) callback."""
    songs = [object()]
    calls = {"n": 0}

    def _raising_callback(_):
        calls["n"] += 1
        raise RuntimeError("simulated callback failure")

    d = SongChangeDetector(
        get_current_song=lambda: songs[-1],
        on_song_changed=_raising_callback,
    )
    songs.append(object())
    d.check()
    assert calls["n"] == 1
    # Second change: still fires (detector did not latch a failure).
    songs.append(object())
    d.check()
    assert calls["n"] == 2


def test_identity_of_stabilizes_across_proxy_churn():
    """Regression for PR-3c's first live run: Live's
    ``application.get_document()`` returns a fresh Python proxy on
    every call, so ``id()`` storm-fires. The detector must accept an
    ``identity_of`` hook so production can key on a stable cookie
    (``_live_ptr``) instead.

    This test simulates the proxy churn: every ``get_current_song``
    call returns a different Python object that reports the same
    ``_live_ptr``. Expected: detector does NOT fire, because the
    stable identity hasn't changed."""
    class _Proxy:
        def __init__(self, ptr):
            self._live_ptr = ptr

    # Fresh proxy object per call (id() flips) but all proxies share
    # the same _live_ptr value.
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: _Proxy(ptr=0xCAFE),
        on_song_changed=lambda new: fires.append(new),
        identity_of=lambda s: s._live_ptr,
    )
    for _ in range(10):
        d.check()
    assert fires == []


def test_identity_of_fires_when_stable_cookie_changes():
    """Complement to the above: when ``_live_ptr`` actually changes
    (new Song object), the detector fires exactly once with the new
    proxy."""
    class _Proxy:
        def __init__(self, ptr):
            self._live_ptr = ptr

    ptr_box = [0xCAFE]
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: _Proxy(ptr=ptr_box[0]),
        on_song_changed=lambda new: fires.append(new),
        identity_of=lambda s: s._live_ptr,
    )
    d.check()  # no change
    assert fires == []
    ptr_box[0] = 0xBEEF
    d.check()
    assert len(fires) == 1
    assert fires[0]._live_ptr == 0xBEEF


def test_identity_of_raising_is_swallowed():
    """A raising identity function must not crash the tick."""
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: object(),
        on_song_changed=lambda new: fires.append(new),
        identity_of=lambda s: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    d.check()
    assert fires == []


def test_disconnect_silences_subsequent_checks():
    """After disconnect, even a drifted song does not fire. Mirrors
    the pattern other components use for teardown safety."""
    songs = [object()]
    fires: List[object] = []
    d = SongChangeDetector(
        get_current_song=lambda: songs[-1],
        on_song_changed=lambda new: fires.append(new),
    )
    d.disconnect()
    songs.append(object())
    d.check()
    assert fires == []


# --- integration: detector + V3StateFullComponent + GenerationComponent ----


def _build_song(track_names):
    """Helper — produce a small but non-trivial song shape."""
    tracks = []
    for idx, name in enumerate(track_names):
        p = StubParam(pid=300 + idx, name="gain", value=0.5,
                      min_v=0.0, max_v=1.0)
        d = StubDevice(did=200 + idx, params=[p],
                       name="Utility", class_name="Utility")
        tracks.append(StubTrack(tid=100 + idx, devices=[d], name=name))
    master = StubTrack(tid=9_000_001, devices=[], name="Master")
    return StubSong(tracks=tracks, master=master)


def test_emits_v3_state_full_structural_against_new_song():
    """Regression test for PR-3c: when the detector observes a song
    change, the composed handler must (a) advance generation and
    (b) emit a v3 ``state/full/tree`` with ``reason="structural"``.
    The emitted tree walks the NEW song — tracks in the new set's
    names must appear in the tree_args."""
    song_a = _build_song(["A-drums", "A-bass"])
    song_b = _build_song(["B-drums", "B-bass", "B-synth"])
    current_song = {"s": song_a}

    emits: List[tuple] = []

    def _emit(addr, args):
        emits.append((addr, args))

    gen = GenerationComponent()
    # Advance once so we can see a further advance on song-change.
    gen.advance("test-setup")
    pre_gen = gen.current

    v3 = V3StateFullComponent(
        song=current_song["s"],
        emit=_emit,
        generation_component=gen,
        # The tree only leaves over the stream since 3.6.0; the fake
        # writes into the same list so the assertions below are
        # unchanged.
        stream=FakeStream(connected=True, sink=emits),
    )

    def _on_song_changed(new_song):
        v3.set_song(new_song)
        gen.advance("song-changed")
        v3.emit_structural()

    d = SongChangeDetector(
        get_current_song=lambda: current_song["s"],
        on_song_changed=_on_song_changed,
    )

    # No drift yet — ticks are no-ops.
    d.check()
    assert emits == []

    # Swap song; next check fires the handler.
    current_song["s"] = song_b
    d.check()

    # Generation advanced.
    assert gen.current == pre_gen + 1

    # Bundle landed with reason="structural" and carries the new
    # generation.
    trees = [a for addr, a in emits if addr == V3_STATE_FULL_TREE_ADDRESS]
    assert len(trees) == 1, (
        "expected exactly one tree emission on song change, "
        "got %d" % len(trees)
    )
    reason, generation, _etag, scope = trees[0][:_HEADER_ARITY]
    assert reason == "structural"
    assert generation == gen.current
    assert scope == ""

    # Tree reflects the NEW song — B-synth appears, A-drums does not.
    # Walk the record stream for the track-name string at index 2 of
    # each T record.
    chunk_args: List = list(trees[0][_HEADER_ARITY:])
    # Find all T records' names (tag, path, name, color, mute, solo,
    # arm, hasMidiInput, hasAudioInput, hasArrangementClips, volume,
    # isFoldable, foldState, groupTrackIndex, role) — PR-3.5.3 bumped T
    # arity 6->8; PR-7c pr7c-3 bumped 8->9; ROW 6.5 bumped 9->10 (added
    # volume); ADR-410 bumped 10->13 (group fields); 3.7.0 bumped
    # 13->14 (role); 3.9.0 bumped 14->15 (preset, ADR-439).
    # closeout-0b bumped D arity 3->4 (added legacyId); ROW 5 shrank
    # D arity 4->3 again (legacyId retired). Step = 1 (tag) + arity.
    seen_names = []
    i = 0
    while i < len(chunk_args):
        if chunk_args[i] == "T":
            seen_names.append(chunk_args[i + 2])
            i += 16  # tag + 15 fields (preset added at protocol 3.9.0)
        elif chunk_args[i] == "D":
            i += 4
        elif chunk_args[i] == "P":
            i += 8
        else:
            # Unexpected tag — break rather than miswalk.
            break
    assert "B-synth" in seen_names
    assert "A-drums" not in seen_names
