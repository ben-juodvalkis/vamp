"""Client-declared ETag (protocol 3.5.0).

Before this, the surface decided whether to re-ship the tree from
``_last_checksums`` — what it *last sent*. That is the wrong question
twice over:

- **On reconnect.** The UI may have dropped state, so "I already sent
  you this" proves nothing. Hence ``accept`` and ``resync`` were
  excluded from the skip by design, and every iPad tab-wake re-shipped
  the whole tree.
- **With two UIs connected.** A Mac and an iPad hold independently-aged
  trees, and "last sent" is one client's history being used to answer
  the other's question.

The client declaring what it *holds* replaces that guess with a fact.
Declaring nothing still ships the tree, which is what keeps cold starts
and pre-3.5.0 UIs on exactly the old behaviour.

The gate for this work is ``test_reconnect_with_unchanged_tree_...``:
a reconnect against an untouched tree must transfer the marker and not
the tree.
"""

from __future__ import annotations

import pytest

from components.GenerationComponent import GenerationComponent
from components.HandshakeComponent import SUPPORTED_VERSIONS, HandshakeComponent
from components.V3StateFullComponent import (
    ETAG_PREFIX,
    V3_STATE_FULL_TREE_ADDRESS,
    V3_STATE_FULL_UNCHANGED_ADDRESS,
    V3StateFullComponent,
    extract_etag,
    parse_etag,
)
from tests.support.fake_stream import FakeStream
from tests.test_lom_listeners import StubSong, StubTrack


# --- parsing ---------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("etag:0x0f6edcf5", 0x0F6EDCF5),
    ("0x0f6edcf5", 0x0F6EDCF5),          # prefix already stripped
    ("etag:0X0F6EDCF5", 0x0F6EDCF5),     # case-insensitive
    ("  etag:0x1  ", 0x1),               # tolerant of whitespace
    ("etag:5", 5),                       # decimal accepted
])
def test_parse_etag_accepts(raw, expected):
    assert parse_etag(raw) == expected


@pytest.mark.parametrize("raw", [
    None, 42, b"etag:0x1", "", "etag:", "etag:zzz", "etag:0xnope",
    "etag:-1",              # negative can't be an int31 checksum
    "etag:0xFFFFFFFF",      # above int31 — a different scheme, not ours
])
def test_parse_etag_rejects(raw):
    """Unparseable must mean "declared nothing", never an exception.

    This parses a string a *client* chose, on Live's control thread.
    """
    assert parse_etag(raw) is None


def test_extract_etag_splits_the_token_out():
    remaining, etag = extract_etag(["3.5.0", "3.4.0", "etag:0x10"])
    assert remaining == ["3.5.0", "3.4.0"]
    assert etag == 0x10


def test_extract_etag_last_declaration_wins():
    _, etag = extract_etag(["etag:0x1", "etag:0x2"])
    assert etag == 0x2


def test_extract_etag_ignores_a_malformed_token_without_losing_versions():
    remaining, etag = extract_etag(["3.5.0", "etag:garbage"])
    assert remaining == ["3.5.0"]
    assert etag is None


def test_extract_etag_with_no_token():
    remaining, etag = extract_etag(["3.5.0"])
    assert remaining == ["3.5.0"]
    assert etag is None


def test_extract_etag_tolerates_empty_and_none():
    assert extract_etag([]) == ([], None)
    assert extract_etag(None) == ([], None)


# --- publisher -------------------------------------------------------------


@pytest.fixture
def song():
    return StubSong([StubTrack("Drums", 0)])


def _component(song, emits):
    """Component whose stream and UDP wire both land in ``emits``.

    Since 3.6.0 the tree only travels the stream while the marker
    still rides UDP, and these tests are about which of the two the
    surface chooses to send — not about transports. One list keeps
    them readable.
    """
    gen = GenerationComponent()
    gen.advance("bench")
    return V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=FakeStream(connected=True, sink=emits),
    )


def _addresses(emits):
    return [addr for addr, _ in emits]


def _current_checksum(emits):
    """Pull the ETag out of the last tree message's header."""
    trees = [args for addr, args in emits if addr == V3_STATE_FULL_TREE_ADDRESS]
    return trees[-1][2]


def test_reconnect_with_unchanged_tree_sends_the_marker_not_the_tree(song):
    """THE GATE.

    A reconnecting UI that declares the tree it holds, against a tree
    that has not changed, must receive the small marker — and no tree
    at all.
    """
    emits = []
    comp = _component(song, emits)

    # First connect: cold, declares nothing, gets the whole tree.
    comp.emit_on_accept()
    assert V3_STATE_FULL_TREE_ADDRESS in _addresses(emits)
    held = _current_checksum(emits)

    # Reconnect: same tree, and this time the UI says what it holds.
    emits.clear()
    comp.emit_on_accept(session_id="sess-1", client_etag=int(held, 16))

    assert _addresses(emits) == [V3_STATE_FULL_UNCHANGED_ADDRESS]
    reason, generation, session_id, checksum_hex = emits[0][1]
    assert reason == "accept"
    assert session_id == "sess-1"
    assert checksum_hex == held
    assert generation >= 1


def test_resync_with_unchanged_tree_sends_the_marker(song):
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    held = _current_checksum(emits)

    emits.clear()
    comp.emit_on_resync(session_id="sess-1", client_etag=int(held, 16))

    assert _addresses(emits) == [V3_STATE_FULL_UNCHANGED_ADDRESS]
    assert emits[0][1][0] == "resync"


def test_a_stale_etag_still_gets_the_whole_tree(song):
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()

    emits.clear()
    comp.emit_on_accept(session_id="sess-1", client_etag=0x1234)

    assert V3_STATE_FULL_TREE_ADDRESS in _addresses(emits)
    assert V3_STATE_FULL_UNCHANGED_ADDRESS not in _addresses(emits)


def test_no_etag_still_gets_the_whole_tree(song):
    """Cold start, and every pre-3.5.0 UI. Must be the old behaviour."""
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()

    emits.clear()
    comp.emit_on_accept()  # declares nothing

    assert V3_STATE_FULL_TREE_ADDRESS in _addresses(emits)
    assert V3_STATE_FULL_UNCHANGED_ADDRESS not in _addresses(emits)


def test_a_changed_tree_beats_a_matching_looking_etag(song):
    """The surface recomputes; it never takes the client's word for it."""
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    held = _current_checksum(emits)

    song.tracks[0].name = "Renamed"
    emits.clear()
    comp.emit_on_accept(session_id="sess-1", client_etag=int(held, 16))

    assert V3_STATE_FULL_TREE_ADDRESS in _addresses(emits)


def test_the_marker_is_smaller_than_the_tree(song):
    """Both are one message now; what the ETag saves is the payload.

    Before 3.6.0 this counted messages — a marker instead of N chunks.
    The tree ships as a single message either way now, so the saving
    is the ~390 KB of tree args behind the same four-arg header.
    """
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    tree_args = len(emits[0][1])
    held = _current_checksum(emits)

    emits.clear()
    comp.emit_on_accept(session_id="s", client_etag=int(held, 16))

    assert len(emits) == 1
    assert emits[0][0] == V3_STATE_FULL_UNCHANGED_ADDRESS
    assert len(emits[0][1]) < tree_args


def test_an_etag_hit_primes_the_memo_for_later_pushes(song):
    """A hit proves the tree is current, so record it.

    Otherwise the next structural fire would re-hash a tree we just
    established is unchanged.
    """
    emits = []
    comp = _component(song, emits)
    comp.emit_on_accept()
    held = _current_checksum(emits)
    comp._checksum_memo.clear()

    comp.emit_on_accept(session_id="s", client_etag=int(held, 16))
    assert len(comp._checksum_memo) == 1

    emits.clear()
    comp.on_structural_change()
    assert emits == [], "unchanged tree must not re-ship after an ETag hit"


def test_marker_emit_failure_does_not_raise(song):
    """Control-thread safety: a dead transport must not propagate."""
    def boom(addr, args):
        raise RuntimeError("socket gone")

    gen = GenerationComponent()
    gen.advance("bench")
    comp = V3StateFullComponent(
        song=song, emit=boom, generation_component=gen,
        stream=FakeStream(connected=True),
    )
    tree = comp._build_payload()
    from components.V3StateFullComponent import _compute_checksum
    comp.emit_on_accept(session_id="s", client_etag=_compute_checksum(tree))


def test_an_empty_tree_never_takes_the_etag_path(song):
    """An unresolvable/empty walk must ship, not claim "unchanged"."""
    emits = []
    comp = _component(StubSong([]), emits)
    comp.emit_on_accept(session_id="s", client_etag=0)
    assert V3_STATE_FULL_UNCHANGED_ADDRESS not in _addresses(emits)


# --- handshake integration -------------------------------------------------


def test_hello_strips_the_etag_before_negotiating_versions():
    """An ``etag:`` token must not be mistaken for a version.

    This is what lets a 3.4.0 surface ignore the token safely: it
    simply fails to intersect, which is the same outcome as stripping.
    """
    emits = []
    gen = GenerationComponent()
    hs = HandshakeComponent(
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        session_id_factory=lambda: "sess-1",
    )
    seen = {}
    hs.set_state_full_on_accept(
        lambda session_id=None, client_etag=None: seen.update(
            session_id=session_id, client_etag=client_etag
        )
    )

    hs.handle_hello(["3.5.0", "etag:0x0f6edcf5"], ("127.0.0.1", 1))

    accepts = [a for addr, a in emits if addr.endswith("/handshake/accept")]
    assert accepts, "must still negotiate a version"
    assert accepts[0][0] == "3.5.0"
    assert seen == {"session_id": "sess-1", "client_etag": 0x0F6EDCF5}


def test_hello_without_an_etag_passes_none_through():
    emits = []
    hs = HandshakeComponent(
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=GenerationComponent(),
        session_id_factory=lambda: "sess-1",
    )
    seen = {}
    hs.set_state_full_on_accept(
        lambda session_id=None, client_etag=None: seen.update(
            session_id=session_id, client_etag=client_etag
        )
    )
    hs.handle_hello(["3.5.0"], ("127.0.0.1", 1))
    assert seen["client_etag"] is None


def test_hello_tolerates_a_pre_3_5_0_accept_hook():
    """A hook with the old zero-arg signature must still fire.

    Guards the wiring seam: a partially-updated surface should degrade
    to a full send, not raise on the control thread.
    """
    calls = []
    hs = HandshakeComponent(
        emit=lambda addr, args: None,
        generation_component=GenerationComponent(),
        session_id_factory=lambda: "sess-1",
    )
    hs.set_state_full_on_accept(lambda: calls.append("fired"))
    hs.handle_hello(["3.5.0", "etag:0x1"], ("127.0.0.1", 1))
    assert calls == ["fired"]


def test_a_hello_carrying_only_an_etag_is_a_version_mismatch():
    """Stripping the token must not accidentally produce an empty
    version list that reads as success."""
    emits = []
    hs = HandshakeComponent(
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=GenerationComponent(),
        session_id_factory=lambda: "sess-1",
    )
    hs.handle_hello(["etag:0x1"], ("127.0.0.1", 1))
    assert not [a for addr, a in emits if addr.endswith("/handshake/accept")]


def test_3_5_0_is_still_negotiable():
    """The ETag path landed in 3.5.0 and is unchanged by 3.6.0.

    3.6.0 took the highest slot when ``state/full`` collapsed to one
    message and 3.7.0 took it when the T record grew ``role`` (3.9.0 when
    it grew ``preset``); 3.5.0 stays in the tuple because that is a
    different question from whether a client can still negotiate it.
    """
    assert SUPPORTED_VERSIONS[0] == "3.11.0"
    assert "3.5.0" in SUPPORTED_VERSIONS


def test_etag_prefix_is_the_documented_token():
    assert ETAG_PREFIX == "etag:"


# --- resync handler --------------------------------------------------------


def _resync_component():
    """A DevicesComponent with a recording resync callback."""
    from components.DevicesComponent import DevicesComponent
    seen = []
    comp = DevicesComponent(song=None, emit=lambda a, b: None)
    comp.set_state_full_on_resync(
        lambda session_id=None, client_etag=None: seen.append(
            (session_id, client_etag)
        )
    )
    return comp, seen


def test_resync_passes_session_and_etag_through():
    comp, seen = _resync_component()
    comp.handle_v3_state_resync(["sess-1", "etag:0x0f6edcf5"], None)
    assert seen == [("sess-1", 0x0F6EDCF5)]


def test_resync_with_no_args_is_the_pre_3_5_0_shape():
    comp, seen = _resync_component()
    comp.handle_v3_state_resync([], None)
    assert seen == [(None, None)]


def test_resync_with_only_an_etag():
    comp, seen = _resync_component()
    comp.handle_v3_state_resync(["etag:0x10"], None)
    assert seen == [(None, 0x10)]


def test_resync_with_only_a_session_id():
    comp, seen = _resync_component()
    comp.handle_v3_state_resync(["sess-1"], None)
    assert seen == [("sess-1", None)]


def test_resync_tolerates_a_pre_3_5_0_callback():
    """Wiring seam, same as the accept hook."""
    from components.DevicesComponent import DevicesComponent
    calls = []
    comp = DevicesComponent(song=None, emit=lambda a, b: None)
    comp.set_state_full_on_resync(lambda: calls.append("fired"))
    comp.handle_v3_state_resync(["sess-1", "etag:0x1"], None)
    assert calls == ["fired"]


def test_resync_survives_a_raising_callback():
    from components.DevicesComponent import DevicesComponent
    comp = DevicesComponent(song=None, emit=lambda a, b: None)

    def boom(session_id=None, client_etag=None):
        raise RuntimeError("nope")

    comp.set_state_full_on_resync(boom)
    comp.handle_v3_state_resync(["sess-1", "etag:0x1"], None)  # must not raise
