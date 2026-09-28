"""GroovePoolComponent unit tests (PR-5e2).

Covers the song-scoped groove pool bookkeeping: the
``groove_pool.grooves`` listener, the ``path_hash`` helper, and the
``find_unassigned_groove`` / ``assign_groove_to_clip`` /
``return_groove_to_pool`` verbs per
[phase-5-pr5e2-design.md §2, §6, §8].

Cases:

* ``path_hash`` is deterministic + 8 hex chars (1)
* construction attaches pool.grooves listener (1)
* init with missing groove_pool warns-once, no crash (1)
* ``find_unassigned_groove`` returns the first unassigned,
  skips ``Clip_*`` and preset names (1)
* ``find_unassigned_groove`` returns None on full pool (1)
* ``assign_groove_to_clip`` renames then links (order matters) (1)
* ``assign_groove_to_clip`` raises ``PoolExhausted`` on full pool
  and leaves the clip untouched (1)
* ``return_groove_to_pool`` renames the matching ``Clip_<hash>``
  back to ``unassigned-<idx>`` (1)
* ``return_groove_to_pool`` returns False when tag not found (1)
* ``return_groove_to_pool`` preserves pool index in new name (1)
* ``disconnect`` detaches the listener; idempotent (1)
"""

from __future__ import annotations

from typing import List, Optional

import pytest

from components.GroovePoolComponent import (
    GroovePoolComponent,
    PoolExhausted,
    path_hash,
)


# --- stubs ----------------------------------------------------------------


class StubGroove:
    """Minimal stand-in for ``Live.Groove`` with a mutable name."""

    def __init__(self, name: str):
        self.name = name


class StubGroovePool:
    """``song.groove_pool`` shim with a mutable grooves list + listener."""

    def __init__(self, grooves: Optional[List[StubGroove]] = None):
        self._grooves = list(grooves or [])
        self._listener = None
        self._read_raises = False

    @property
    def grooves(self):
        if self._read_raises:
            raise RuntimeError("grooves read raised")
        return list(self._grooves)

    def set_grooves(self, grooves: List[StubGroove]) -> None:
        self._grooves = list(grooves)
        if self._listener is not None:
            self._listener()

    def add_grooves_listener(self, cb):
        assert self._listener is None, "one grooves listener"
        self._listener = cb

    def remove_grooves_listener(self, cb):
        assert self._listener == cb
        self._listener = None

    def has_listener(self) -> bool:
        return self._listener is not None


class PoolStubSong:
    """Song with just a ``groove_pool`` attribute."""

    def __init__(self, pool: Optional[StubGroovePool] = None):
        if pool is None:
            pool = StubGroovePool()
        self.groove_pool = pool


class StubClip:
    """Very small clip — only needs ``groove`` settable for link step."""

    def __init__(self):
        self.groove = None


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def captured_emits():
    return []


def _make_component(song, captured_emits):
    emit = lambda addr, args: captured_emits.append((addr, args))
    return GroovePoolComponent(song=song, emit=emit)


# --- path_hash ------------------------------------------------------------


def test_path_hash_deterministic_and_8_hex():
    h1 = path_hash("tracks/0/slots/0/clip")
    h2 = path_hash("tracks/0/slots/0/clip")
    assert h1 == h2
    assert len(h1) == 8
    assert all(c in "0123456789abcdef" for c in h1)
    # Different paths produce different hashes (at the practical scale
    # collisions are negligible).
    assert path_hash("tracks/0/slots/1/clip") != h1


# --- construction --------------------------------------------------------


def test_attaches_grooves_listener_on_init(captured_emits):
    pool = StubGroovePool()
    song = PoolStubSong(pool=pool)
    _c = _make_component(song, captured_emits)
    assert pool.has_listener()


def test_init_with_missing_groove_pool_survives(captured_emits):
    """Song without a groove_pool attr must not crash construction."""

    class NoPoolSong:
        @property
        def groove_pool(self):
            raise AttributeError("no groove_pool on stub")

    song = NoPoolSong()
    c = _make_component(song, captured_emits)
    # Listener never attached; verbs are still safely callable.
    assert c.find_unassigned_groove() is None
    assert c.return_groove_to_pool("x") is False


# --- find_unassigned_groove ----------------------------------------------


def test_find_unassigned_returns_first_and_skips_claims(captured_emits):
    g0 = StubGroove("Clip_abc12345")          # v3 claim
    g1 = StubGroove("Clip_9999")              # legacy M4L claim
    g2 = StubGroove("FunkySwing")             # preset name
    g3 = StubGroove("unassigned-3")           # <-- target
    g4 = StubGroove("unassigned-4")
    pool = StubGroovePool(grooves=[g0, g1, g2, g3, g4])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)

    assert c.find_unassigned_groove() is g3


def test_find_unassigned_returns_none_when_exhausted(captured_emits):
    g0 = StubGroove("Clip_abc12345")
    g1 = StubGroove("MPC_Swing")
    pool = StubGroovePool(grooves=[g0, g1])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)

    assert c.find_unassigned_groove() is None


# --- assign_groove_to_clip -----------------------------------------------


def test_assign_renames_then_links(captured_emits):
    g0 = StubGroove("unassigned-0")
    pool = StubGroovePool(grooves=[g0])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)
    clip = StubClip()
    clip_path = "tracks/0/slots/0/clip"

    returned = c.assign_groove_to_clip(clip, clip_path)

    assert returned is g0
    # Rename landed with the Clip_<hash> form.
    assert g0.name == "Clip_" + path_hash(clip_path)
    # Link landed: clip.groove now points at the groove object.
    assert clip.groove is g0


def test_assign_raises_pool_exhausted_and_leaves_clip_clean(captured_emits):
    pool = StubGroovePool(grooves=[StubGroove("Clip_ffffff00")])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)
    clip = StubClip()
    clip_path = "tracks/9/slots/9/clip"

    with pytest.raises(PoolExhausted) as exc:
        c.assign_groove_to_clip(clip, clip_path)
    # Exception carries the originating clipPath for UI routing.
    assert exc.value.clip_path == clip_path
    # No link side-effect.
    assert clip.groove is None


# --- return_groove_to_pool ------------------------------------------------


def test_return_renames_matching_tag_back_to_unassigned(captured_emits):
    clip_path = "tracks/0/slots/0/clip"
    target_tag = "Clip_" + path_hash(clip_path)
    g0 = StubGroove("unassigned-0")
    g1 = StubGroove(target_tag)                # <-- the one to return
    g2 = StubGroove("Clip_deadbeef")
    pool = StubGroovePool(grooves=[g0, g1, g2])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)

    returned = c.return_groove_to_pool(clip_path)

    assert returned is True
    # Index 1 in the pool → name carries that index.
    assert g1.name == "unassigned-1"
    # Siblings untouched.
    assert g0.name == "unassigned-0"
    assert g2.name == "Clip_deadbeef"


def test_return_returns_false_when_tag_not_found(captured_emits):
    pool = StubGroovePool(grooves=[
        StubGroove("unassigned-0"),
        StubGroove("Clip_otherpath"),
    ])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)

    # This path was never assigned a groove.
    assert c.return_groove_to_pool("tracks/5/slots/5/clip") is False


def test_return_preserves_pool_index_in_new_name(captured_emits):
    """New ``unassigned-<idx>`` name uses current pool position, not 0."""
    clip_path = "tracks/2/slots/3/clip"
    target = "Clip_" + path_hash(clip_path)
    pool = StubGroovePool(grooves=[
        StubGroove("unassigned-0"),
        StubGroove("unassigned-1"),
        StubGroove("Clip_oldclaim"),
        StubGroove(target),                    # index 3
    ])
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)

    assert c.return_groove_to_pool(clip_path) is True
    assert pool._grooves[3].name == "unassigned-3"


# --- disconnect ----------------------------------------------------------


def test_disconnect_detaches_listener_and_is_idempotent(captured_emits):
    pool = StubGroovePool()
    song = PoolStubSong(pool=pool)
    c = _make_component(song, captured_emits)
    assert pool.has_listener()

    c.disconnect()
    assert not pool.has_listener()
    # Second call is a no-op.
    c.disconnect()
    assert not pool.has_listener()
