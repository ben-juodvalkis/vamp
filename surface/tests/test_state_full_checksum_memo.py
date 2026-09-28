"""``_ChecksumMemo`` + ETag-digest tests.

The memo replaced a bare ``Dict[scope, int]`` of last-emitted
checksums. Three things had to stay true through that swap and one
thing got strictly better:

- an emit that fails must not be recorded, or the retry that fixes the
  UI gets suppressed,
- clearing on song-change / disconnect still happens,
- a memoised publish puts the same ETag on the wire as the cold one,
- and the short-circuit now compares *trees* rather than 31-bit
  hashes, so a hash collision can no longer suppress a real update.

Protocol 3.6.0 changed what the digest is *for*. It used to be a
cross-language integrity checksum, mirrored byte-for-byte in
``v3StateFull.ts`` and recomputed there over a reassembled bundle;
those byte-level encoding tests lived here. The tree now arrives as
one message and the UI never recomputes anything — it stores the token
and echoes it back — so the digest is surface-local and only two
properties are still required of it. Those two are what the first
section tests now.
"""

from __future__ import annotations

import pytest

from components.GenerationComponent import GenerationComponent
from components.V3StateFullComponent import (
    V3_STATE_FULL_TREE_ADDRESS,
    V3StateFullComponent,
    _ChecksumMemo,
    _compute_checksum,
)
from tests.support.fake_stream import FakeStream
from tests.test_lom_listeners import StubSong, StubTrack


# --- what is still required of the digest ----------------------------------


def test_the_digest_is_stable_within_a_process():
    """The ETag check is ``client_etag == checksum``, so the same tree
    must digest the same way for as long as a client might hold it."""
    tree = ["T", "tracks/0", "Drums", 1.0, True, 0.25, -7]
    first = _compute_checksum(tree)
    for _ in range(5):
        assert _compute_checksum(list(tree)) == first


def test_different_trees_digest_differently():
    """A collision answers "unchanged" to a client whose tree is stale,
    which is silent corruption. These are the near-misses worth
    pinning; the general case is a 1-in-2^31 argument, not a test."""
    base = ["T", "tracks/0", "Drums", 0.5]
    variants = [
        ["T", "tracks/0", "Drums", 0.6],       # value changed
        ["T", "tracks/0", "Drum", 0.5],        # name changed
        ["T", "tracks/1", "Drums", 0.5],       # path changed
        ["T", "tracks/0", "Drums"],            # field dropped
        ["T", "tracks/0", "Drums", 0.5, ""],   # field added
        ["tracks/0", "T", "Drums", 0.5],       # order changed
    ]
    digests = {_compute_checksum(base)}
    for v in variants:
        d = _compute_checksum(v)
        assert d not in digests, "collision with %r" % (v,)
        digests.add(d)


def test_the_digest_distinguishes_types():
    """``repr`` carries the type, so ``1`` and ``1.0`` differ.

    The pre-3.6.0 encoder had to force these together, because JS has
    no separate int type and the TS mirror's ``Number.isInteger`` would
    have diverged. With no mirror there is nothing to agree with, and
    the conservative direction is the safe one: reporting "different"
    for two trees the wire would render alike only costs a resend.
    """
    assert _compute_checksum([1]) != _compute_checksum([1.0])
    assert _compute_checksum([True]) != _compute_checksum([1])
    assert _compute_checksum(["1"]) != _compute_checksum([1])


def test_checksum_is_non_negative_int31():
    """Must fit an OSC int32 without going negative — and ``parse_etag``
    rejects anything outside that range as "a different scheme"."""
    for tree in ([], ["x"], list(range(500)), ["é" * 200], [object()]):
        assert 0 <= _compute_checksum(tree) <= 0x7FFFFFFF


# --- memo behaviour --------------------------------------------------------


def test_miss_on_empty_memo():
    memo = _ChecksumMemo()
    assert memo.lookup(None, ["a"]) is None


def test_hit_returns_the_recorded_checksum():
    memo = _ChecksumMemo()
    memo.record(None, ["a", 1], 12345)
    assert memo.lookup(None, ["a", 1]) == 12345


def test_hit_matches_on_value_not_identity():
    """A fresh walk builds a new list each time — equality is the test."""
    memo = _ChecksumMemo()
    memo.record(None, ["a", 1], 999)
    assert memo.lookup(None, ["a"] + [1]) == 999


def test_miss_when_the_tree_changed():
    memo = _ChecksumMemo()
    memo.record(None, ["a", 1], 999)
    assert memo.lookup(None, ["a", 2]) is None


def test_scopes_are_independent():
    memo = _ChecksumMemo()
    memo.record(None, ["whole"], 1)
    memo.record("tracks/0", ["scoped"], 2)
    assert memo.lookup(None, ["whole"]) == 1
    assert memo.lookup("tracks/0", ["scoped"]) == 2
    assert memo.lookup("tracks/0", ["whole"]) is None


def test_record_snapshots_the_tree():
    """Mutating the caller's list afterwards must not corrupt the memo.

    ``_build_payload`` returns a fresh list today, so aliasing would be
    safe right now — this pins the isolation so it stays safe if that
    ever changes.
    """
    memo = _ChecksumMemo()
    tree = ["a", 1]
    memo.record(None, tree, 42)
    tree.append("mutated")
    assert memo.lookup(None, ["a", 1]) == 42
    assert memo.lookup(None, tree) is None


def test_clear_drops_everything():
    memo = _ChecksumMemo()
    memo.record(None, ["a"], 1)
    memo.clear()
    assert memo.lookup(None, ["a"]) is None
    assert len(memo) == 0


def test_eviction_bounds_the_memo():
    """Scope keys are track paths; a long session keeps minting them."""
    memo = _ChecksumMemo(max_scopes=3)
    for i in range(10):
        memo.record("tracks/%d" % i, [i], i)
    assert len(memo) == 3
    # Oldest gone, newest kept.
    assert memo.lookup("tracks/0", [0]) is None
    assert memo.lookup("tracks/9", [9]) == 9


def test_lookup_refreshes_recency():
    """A hot scope must survive churn on cold ones."""
    memo = _ChecksumMemo(max_scopes=2)
    memo.record(None, ["whole"], 1)
    memo.record("tracks/0", ["a"], 2)
    # Touch the whole-song entry so it is no longer the oldest.
    assert memo.lookup(None, ["whole"]) == 1
    memo.record("tracks/1", ["b"], 3)
    assert memo.lookup(None, ["whole"]) == 1
    assert memo.lookup("tracks/0", ["a"]) is None


def test_re_recording_a_scope_does_not_grow_it():
    memo = _ChecksumMemo(max_scopes=4)
    for i in range(10):
        memo.record(None, [i], i)
    assert len(memo) == 1


# --- integration through the component -------------------------------------


def _component(song, emits):
    """Component wired so *everything* it sends lands in ``emits``.

    Since 3.6.0 ``state/full`` only leaves over the stream, so a
    component built without one publishes nothing. The fake stream
    writes into the same list the UDP ``emit`` does, which keeps these
    tests about the memo rather than about transports.
    """
    gen = GenerationComponent()
    gen.advance("bench")
    return V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=FakeStream(connected=True, sink=emits),
    )


@pytest.fixture
def song():
    return StubSong([StubTrack("Drums", 0)])


def test_repeat_structural_publish_short_circuits(song):
    emits = []
    comp = _component(song, emits)
    comp.on_structural_change()
    assert emits, "first publish must ship"
    emits.clear()
    comp.on_structural_change()
    assert emits == [], "unchanged tree must not re-ship"


def test_accept_still_ships_an_unchanged_tree(song):
    """The UI is actively waiting on ``accept`` and may have dropped state.

    The memo must make this *cheaper*, not silent.
    """
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    emits.clear()
    comp.emit_on_accept()
    trees = [e for e in emits if e[0] == V3_STATE_FULL_TREE_ADDRESS]
    assert len(trees) == 1


def test_resync_still_ships_an_unchanged_tree(song):
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    emits.clear()
    comp.emit_on_resync()
    assert [e for e in emits if e[0] == V3_STATE_FULL_TREE_ADDRESS]


def test_checksum_is_stable_across_the_memo(song):
    """A memoised publish must put the same ETag on the wire.

    The client stores this token and declares it back; a memo hit that
    shipped a different one would make every reconnect a full send.
    """
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    first = [a for addr, a in emits if addr == V3_STATE_FULL_TREE_ADDRESS][0]
    emits.clear()
    comp.emit_on_accept()
    second = [a for addr, a in emits if addr == V3_STATE_FULL_TREE_ADDRESS][0]
    assert first[2] == second[2]


def test_a_failed_emit_is_not_recorded(song):
    """A send that raised must leave the memo untouched so the retry ships.

    Recording on a failed emit would strand the UI holding a stale
    tree with nothing to correct it.
    """
    emits = []
    calls = {"n": 0}

    class Flaky:
        connected = True

        def send(self, addr, args=()):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("socket gone")
            emits.append((addr, args))

    gen = GenerationComponent()
    gen.advance("bench")
    comp = V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=Flaky(),
    )
    comp.on_structural_change()
    assert len(comp._checksum_memo) == 0, "failed emit must not be memoised"

    emits.clear()
    comp.on_structural_change()
    assert emits, "the retry must ship rather than short-circuit"


def test_song_change_clears_the_memo(song):
    emits = []
    comp = _component(song, emits)
    comp.on_structural_change()
    assert len(comp._checksum_memo) == 1
    comp.set_song(StubSong([StubTrack("Bass", 0)]))
    assert len(comp._checksum_memo) == 0


def test_disconnect_releases_the_retained_trees(song):
    """The snapshots are the only real memory this component holds."""
    emits = []
    comp = _component(song, emits)
    comp.on_structural_change()
    assert len(comp._checksum_memo) == 1
    comp.disconnect()
    assert len(comp._checksum_memo) == 0


def test_a_real_change_still_ships(song):
    emits = []
    comp = _component(song, emits)
    comp.on_structural_change()
    emits.clear()
    song.tracks[0].name = "Renamed"
    comp.on_structural_change()
    assert emits, "a changed tree must ship"
