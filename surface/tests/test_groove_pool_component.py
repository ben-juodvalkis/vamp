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
    is_owned_by,
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
    # Rename landed as a claim: no track to name it by, so "Clip".
    assert g0.name == "Clip #" + path_hash(clip_path)
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


# --- orphan reclaim + mint (2026-09-29) -----------------------------------


class LinkedClip:
    """A clip in a slot, linking ``groove`` (or nothing). Reads back the
    raw LOM ``("id", N)`` shape; ``linked`` is the object last written."""

    def __init__(self, groove=None):
        self.linked = groove

    @property
    def groove(self):
        return ("id", id(self.linked) if self.linked is not None else 0)

    @groove.setter
    def groove(self, value):
        self.linked = value


class Slot:
    def __init__(self, clip=None):
        self.clip = clip
        self.has_clip = clip is not None


class Track:
    def __init__(self, *clips):
        self.clip_slots = [Slot(c) for c in clips]


class SongWithTracks(PoolStubSong):
    def __init__(self, pool, tracks):
        super().__init__(pool=pool)
        self.tracks = tracks


def _minting(pool, calls, name="Vamp Groove", err=None):
    """A minter that appends one groove to ``pool``, as the browser load does."""
    def mint():
        calls.append(1)
        if err:
            return err
        pool._grooves.append(StubGroove(name))
        return None
    return mint


def test_orphaned_claim_is_reclaimed_before_minting(captured_emits):
    """A ``Clip_*`` groove no clip links is reused; the minter is not called."""
    held = StubGroove("Clip_aaaaaaaa")
    orphan = StubGroove("Clip_bbbbbbbb")
    pool = StubGroovePool(grooves=[held, orphan])
    song = SongWithTracks(pool, [Track(LinkedClip(held), None)])
    calls = []
    c = GroovePoolComponent(song=song, emit=lambda *a: None, mint=_minting(pool, calls))

    clip = LinkedClip()
    got = c.assign_groove_to_clip(clip, "tracks/0/slots/1/clip")

    assert got is orphan
    assert orphan.name == "Clip #" + path_hash("tracks/0/slots/1/clip")
    assert clip.linked is orphan
    assert calls == []


def test_mints_when_every_groove_is_linked(captured_emits):
    held = StubGroove("Clip_aaaaaaaa")
    pool = StubGroovePool(grooves=[held])
    song = SongWithTracks(pool, [Track(LinkedClip(held), None)])
    calls = []
    c = GroovePoolComponent(song=song, emit=lambda *a: None, mint=_minting(pool, calls))

    clip = LinkedClip()
    got = c.assign_groove_to_clip(clip, "tracks/0/slots/1/clip")

    assert calls == [1]
    assert len(pool._grooves) == 2
    assert got is pool._grooves[1]
    assert got.name == "Clip #" + path_hash("tracks/0/slots/1/clip")
    assert clip.linked is got


def test_mints_into_an_empty_pool(captured_emits):
    """No template grooves at all — the general edition's case."""
    pool = StubGroovePool(grooves=[])
    song = SongWithTracks(pool, [Track(None)])
    calls = []
    c = GroovePoolComponent(song=song, emit=lambda *a: None, mint=_minting(pool, calls))

    clip = LinkedClip()
    got = c.assign_groove_to_clip(clip, "tracks/0/slots/0/clip")

    assert calls == [1]
    assert clip.linked is got


def test_failed_mint_raises_pool_exhausted(captured_emits):
    pool = StubGroovePool(grooves=[])
    song = SongWithTracks(pool, [Track(None)])
    calls = []
    c = GroovePoolComponent(
        song=song, emit=lambda *a: None,
        mint=_minting(pool, calls, err="not-in-browser"),
    )
    clip = LinkedClip()
    with pytest.raises(PoolExhausted):
        c.assign_groove_to_clip(clip, "tracks/0/slots/0/clip")
    assert clip.linked is None


def test_mint_that_does_not_grow_the_pool_raises_pool_exhausted(captured_emits):
    pool = StubGroovePool(grooves=[])
    song = SongWithTracks(pool, [Track(None)])
    c = GroovePoolComponent(song=song, emit=lambda *a: None, mint=lambda: None)
    with pytest.raises(PoolExhausted):
        c.assign_groove_to_clip(LinkedClip(), "tracks/0/slots/0/clip")


def test_inherit_copies_the_five_settings(captured_emits):
    class G(StubGroove):
        def __init__(self, name, **kw):
            super().__init__(name)
            self.base, self.timing_amount = kw.get("base", 2), kw.get("timing_amount", 0.0)
            self.quantization_amount = kw.get("quantization_amount", 0.0)
            self.random_amount = kw.get("random_amount", 0.0)
            self.velocity_amount = kw.get("velocity_amount", 0.0)

    shared = G("Swing 16ths 66", base=3, timing_amount=100.0,
               quantization_amount=20.0, random_amount=5.0, velocity_amount=40.0)
    free = G("unassigned-1")
    pool = StubGroovePool(grooves=[shared, free])
    c = _make_component(PoolStubSong(pool=pool), captured_emits)

    got = c.assign_groove_to_clip(LinkedClip(shared), "tracks/0/slots/0/clip", inherit=shared)

    assert got is free
    assert (free.base, free.timing_amount, free.quantization_amount,
            free.random_amount, free.velocity_amount) == (3, 100.0, 20.0, 5.0, 40.0)
    assert shared.name == "Swing 16ths 66"


def test_linked_elsewhere(captured_emits):
    g = StubGroove("Swing 16ths 66")
    a, b = LinkedClip(g), LinkedClip(g)
    pool = StubGroovePool(grooves=[g])
    song = SongWithTracks(pool, [Track(a, b)])
    c = _make_component(song, captured_emits)
    gid = id(g) & 0x7FFFFFFF
    assert c.linked_elsewhere(a, gid) is True
    b.groove = None
    assert c.linked_elsewhere(a, gid) is False


def test_is_owned_by():
    path = "tracks/0/slots/0/clip"
    assert is_owned_by("Clip_" + path_hash(path), path)
    assert is_owned_by("Clip_12345", path)                  # legacy M4L claim
    assert not is_owned_by("Clip_" + path_hash("tracks/0/slots/1/clip"), path)
    assert not is_owned_by("Swing 16ths 66", path)
    assert not is_owned_by("unassigned-3", path)
    assert not is_owned_by(None, path)


# --- names that carry the pattern (2026-09-29) ------------------------------

from components.GroovePoolComponent import (  # noqa: E402
    claim_name,
    free_name,
    parse_groove_name,
    pattern_of,
)


def test_parse_groove_name():
    h = path_hash("tracks/0/slots/0/clip")
    assert parse_groove_name("Bass 3 · Swing 16ths 57 #" + h) == ("claim", "Swing 16ths 57", h)
    assert parse_groove_name("Bass 3 #" + h) == ("claim", None, h)
    assert parse_groove_name("Clip_" + h) == ("claim", None, h)
    assert parse_groove_name("Clip_12345") == ("claim", None, "12345")
    assert parse_groove_name("unassigned-4") == ("free", None, None)
    assert parse_groove_name("unassigned-4 · Swing 8ths 61") == ("free", "Swing 8ths 61", None)
    assert parse_groove_name("Swing 16ths 66") == ("other", "Swing 16ths 66", None)
    assert parse_groove_name(None) == ("other", None, None)
    assert pattern_of("Clip #" + h) is None


def test_claim_name_reads_and_cleans_its_label():
    path = "tracks/0/slots/0/clip"
    h = path_hash(path)
    assert claim_name("Keys  1", "Swing 16ths 57", path) == "Keys 1 · Swing 16ths 57 #" + h
    assert claim_name("A·B #2", None, path) == "A B 2 #" + h
    assert claim_name("", None, path) == "Clip #" + h
    assert parse_groove_name(claim_name("x · y", "Swing 16ths 57", path)).pattern == "Swing 16ths 57"
    assert free_name(7, "Swing 16ths 57") == "unassigned-7 · Swing 16ths 57"


def test_is_owned_by_the_new_names():
    path = "tracks/0/slots/0/clip"
    assert is_owned_by("Bass 1 · Swing 16ths 57 #" + path_hash(path), path)
    assert is_owned_by("Bass 1 #" + path_hash(path), path)
    assert not is_owned_by("Bass 2 #" + path_hash("tracks/0/slots/1/clip"), path)
    assert not is_owned_by("unassigned-1 · Swing 16ths 57", path)


class NamedTrack(Track):
    def __init__(self, name, *clips):
        super().__init__(*clips)
        self.name = name


def test_claim_is_named_for_track_and_scene(captured_emits):
    free = StubGroove("unassigned-0")
    pool = StubGroovePool(grooves=[free])
    song = SongWithTracks(pool, [NamedTrack("Drums", None, None, None)])
    c = GroovePoolComponent(song=song, emit=lambda *a: None)
    c.assign_groove_to_clip(LinkedClip(), "tracks/0/slots/2/clip")
    assert free.name == "Drums 3 #" + path_hash("tracks/0/slots/2/clip")


def test_an_orphan_of_another_pattern_is_not_reused(captured_emits):
    orphan = StubGroove("Keys 1 · Swing 8ths 61 #aaaaaaaa")
    pool = StubGroovePool(grooves=[orphan])
    song = SongWithTracks(pool, [NamedTrack("Bass", None)])
    calls = []

    def mint(pattern=None):
        calls.append(pattern)
        pool._grooves.append(StubGroove(pattern or "Vamp Groove"))

    c = GroovePoolComponent(song=song, emit=lambda *a: None, mint=mint)
    got = c.assign_groove_to_clip(LinkedClip(), "tracks/0/slots/0/clip")
    assert calls == [None] and got is not orphan
    got2 = c.assign_groove_to_clip(LinkedClip(), "tracks/0/slots/0/clip", pattern="Swing 8ths 61")
    assert got2 is orphan and calls == [None]


def test_not_strict_falls_back_to_the_default(captured_emits):
    free = StubGroove("unassigned-0")
    pool = StubGroovePool(grooves=[free])
    song = SongWithTracks(pool, [NamedTrack("Bass", None)])
    c = GroovePoolComponent(song=song, emit=lambda *a: None, mint=lambda pattern=None: "not-in-browser")
    got = c.assign_groove_to_clip(LinkedClip(), "tracks/0/slots/0/clip", pattern="My Groove", strict=False)
    assert got is free and free.name == "Bass 1 #" + path_hash("tracks/0/slots/0/clip")
    with pytest.raises(PoolExhausted):
        c.assign_groove_to_clip(LinkedClip(), "tracks/0/slots/0/clip", pattern="My Groove")


def test_return_and_release_keep_the_pattern(captured_emits):
    path = "tracks/0/slots/0/clip"
    a = StubGroove("x")
    claimed = StubGroove("Bass 1 · Swing 16ths 57 #" + path_hash(path))
    pool = StubGroovePool(grooves=[a, claimed])
    c = _make_component(PoolStubSong(pool=pool), captured_emits)
    assert c.return_groove_to_pool(path) is True
    assert claimed.name == "unassigned-1 · Swing 16ths 57"

    claimed.name = "Bass 1 · Swing 8ths 61 #" + path_hash(path)
    assert c.release(claimed) is True
    assert claimed.name == "unassigned-1 · Swing 8ths 61"
