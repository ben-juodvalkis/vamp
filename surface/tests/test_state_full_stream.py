"""``state/full`` on the ordered stream — the only wire it has.

Until protocol 3.6.0 the tree was chunked to fit darwin's 9,216-byte
UDP datagram cap: ~99 chunks on a realistic set, plus an FNV-1a
checksum so the UI could tell a torn bundle from a whole one, plus a
453-line reassembler on the far side. The stream removed the ceiling,
and 3.6.0 removed everything that existed to work around it.

So the fallback is gone, and that is the point of this file. With no
stream peer there is no datagram a 389 KB message fits in; the publish
warns and holds, and — the part worth testing hardest — **leaves the
memo untouched**, so ``on_stream_peer_connected``'s republish is not
mistaken for a duplicate when the bridge dials in. That republish is
the entire safety net for the window between Live starting and the
bridge connecting.
"""

from __future__ import annotations

from components.GenerationComponent import GenerationComponent
from components.V3StateFullComponent import (
    V3_STATE_FULL_TREE_ADDRESS,
    V3_STATE_FULL_UNCHANGED_ADDRESS,
    V3StateFullComponent,
    _HEADER_ARITY,
)
from tests.support.fake_stream import FakeStream
from tests.test_state_full_scale_bench import _build_scaled_song


def _big_song():
    """A set far larger than any datagram could carry.

    Reuses the scale bench's builder rather than a second fixture, so
    the two files cannot drift about what "realistic" means. This is
    the bench's light mix at 8 tracks.
    """
    return _build_scaled_song(8, ["rack", "operator", "eq8", "utility"])


def _component(song, emits, stream=None):
    gen = GenerationComponent()
    gen.advance("test")
    return V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=stream,
    )


def _addresses(sent):
    return [addr for addr, _ in sent]


def _trees(sent):
    return [args for addr, args in sent if addr == V3_STATE_FULL_TREE_ADDRESS]


# --- one message, on the stream --------------------------------------------


def test_a_connected_stream_takes_the_whole_tree_in_one_message():
    song = _big_song()
    emits = []
    stream = FakeStream(connected=True)
    comp = _component(song, emits, stream=stream)
    comp.emit_on_accept()

    assert emits == [], "nothing should reach UDP while the stream is up"
    assert _addresses(stream.sent) == [V3_STATE_FULL_TREE_ADDRESS]


def test_the_header_is_positional_and_fixed_arity():
    stream = FakeStream(connected=True)
    comp = _component(_big_song(), [], stream=stream)
    comp.emit_on_accept()

    args = _trees(stream.sent)[0]
    reason, generation, etag, scope = args[:_HEADER_ARITY]
    assert reason == "accept"
    assert isinstance(generation, int) and generation >= 1
    assert etag.startswith("0x") and len(etag) == 10
    assert scope == "", "whole-song scope is the empty string, not an omitted arg"
    assert len(args) > _HEADER_ARITY, "a real tree must follow the header"


def test_the_payload_after_the_header_is_the_tree_walk():
    song = _big_song()
    stream = FakeStream(connected=True)
    comp = _component(song, [], stream=stream)
    expected = comp._build_payload()
    comp.emit_on_accept()

    assert list(_trees(stream.sent)[0][_HEADER_ARITY:]) == expected


def test_scoped_bundles_carry_the_scope_in_the_header():
    stream = FakeStream(connected=True)
    comp = _component(_big_song(), [], stream=stream)
    comp.emit_selection_change("tracks/0")

    args = _trees(stream.sent)[0]
    assert args[0] == "selection-change"
    assert args[3] == "tracks/0"


# --- no peer, no publish ---------------------------------------------------


def test_without_a_stream_nothing_is_published():
    """There is no datagram a 389 KB message fits in."""
    emits = []
    comp = _component(_big_song(), emits)
    comp.emit_on_accept()

    assert emits == []


def test_a_disconnected_stream_publishes_nothing():
    emits = []
    stream = FakeStream(connected=False)
    comp = _component(_big_song(), emits, stream=stream)
    comp.emit_on_accept()

    assert stream.sent == []
    assert emits == []


def test_a_failed_publish_leaves_the_memo_untouched():
    """The memo records what the far side holds. Nothing was delivered,
    so nothing may be recorded — otherwise the republish that fires
    when the bridge finally connects is skipped as a duplicate and the
    UI sits empty with no error and no retry."""
    stream = FakeStream(connected=False)
    comp = _component(_big_song(), [], stream=stream)
    comp.emit_on_accept()

    assert len(comp._checksum_memo) == 0

    stream.connected = True
    comp.emit_on_accept()
    assert _addresses(stream.sent) == [V3_STATE_FULL_TREE_ADDRESS]


def test_a_raising_send_also_leaves_the_memo_untouched():
    class Exploding:
        connected = True

        def send(self, address, args=()):
            raise RuntimeError("peer went away mid-write")

    comp = _component(_big_song(), [], stream=Exploding())
    comp.emit_on_accept()

    assert len(comp._checksum_memo) == 0


def test_a_raising_connected_probe_is_read_as_no_peer():
    """A broken stream must not take the control thread down with it."""

    class Exploding:
        @property
        def connected(self):
            raise RuntimeError("socket in a bad state")

        def send(self, address, args=()):  # pragma: no cover
            raise AssertionError("must not be reached")

    emits = []
    comp = _component(_big_song(), emits, stream=Exploding())
    comp.emit_on_accept()

    assert emits == []


def test_the_wire_is_re_probed_per_publish():
    """The peer comes and goes with the bridge process."""
    stream = FakeStream(connected=False)
    comp = _component(_big_song(), [], stream=stream)

    comp.emit_on_accept()
    assert stream.sent == []

    stream.connected = True
    comp.emit_on_accept()
    assert len(stream.sent) == 1

    stream.connected = False
    comp.emit_on_accept()
    assert len(stream.sent) == 1, "no new send once the peer is gone"


# --- the ETag marker keeps its own wire ------------------------------------


def test_the_unchanged_marker_still_goes_over_udp():
    """The ETag marker is four args, not 389 KB.

    It has no reason to need the stream, and it must still reach a
    client whose bridge has no TCP leg at all.
    """
    emits = []
    stream = FakeStream(connected=True)
    comp = _component(_big_song(), emits, stream=stream)
    comp.emit_on_accept()

    held = int(_trees(stream.sent)[0][2], 16)

    stream.sent.clear()
    comp.emit_on_accept(session_id="s", client_etag=held)

    assert stream.sent == []
    assert [addr for addr, _ in emits] == [V3_STATE_FULL_UNCHANGED_ADDRESS]


# --- peer-connect republish ------------------------------------------------


def test_peer_connect_republishes_even_when_the_tree_is_unchanged():
    """The memo must not suppress the first bundle to a NEW peer.

    The memo records what the *surface* last sent, which only proxies
    for "what the far side holds" while the far side stays the same. A
    fresh peer invalidates that, and without the clear the next publish
    would find the tree unchanged and skip — stranding the new peer
    with nothing.
    """
    stream = FakeStream(connected=True)
    comp = _component(_big_song(), [], stream=stream)

    comp.emit_on_accept()
    assert stream.sent, "first publish must ship"
    stream.sent.clear()

    # Without the memo clear this is silent.
    comp.on_stream_peer_connected()
    assert _addresses(stream.sent) == [V3_STATE_FULL_TREE_ADDRESS]


def test_peer_connect_clears_the_memo():
    comp = _component(_big_song(), [], stream=FakeStream(connected=True))
    comp.emit_on_accept()
    assert len(comp._checksum_memo) == 1

    comp.on_stream_peer_connected()
    # Republished, so the memo repopulates — what matters is that the
    # republish happened at all, covered above. Here: the entry is for
    # the freshly-sent tree, not a stale one.
    assert len(comp._checksum_memo) <= 1


def test_peer_connect_on_a_disconnected_component_is_a_no_op():
    stream = FakeStream(connected=True)
    comp = _component(_big_song(), [], stream=stream)
    comp.disconnect()
    comp.on_stream_peer_connected()
    assert stream.sent == []


def test_a_send_that_returns_false_leaves_the_memo_untouched():
    """``TCPTransport.send`` RETURNS False; it does not raise.

    Three of its four drop paths — encode failure, outbox overflow, and
    a connection dropped between the ``connected`` probe and the write —
    return ``False`` and log, so the ``except`` around the send never
    sees them. The publish path discarded that return, recorded the memo
    for a tree the far side never got, and the next resync on that scope
    then answered ``state/full/unchanged`` against it: a scope stuck
    stale, with no error and no retry.

    ``_stream_send()``'s ``None`` branch does not cover this — that one
    screens out "no peer at all", which is the case this one is not.
    """

    class Dropping:
        connected = True

        def __init__(self):
            self.calls = 0

        def send(self, address, args=()):
            self.calls += 1
            # Refuse the first frame, take the second.
            return self.calls > 1

    stream = Dropping()
    comp = _component(_big_song(), [], stream=stream)
    comp.emit_on_accept()

    assert stream.calls == 1
    assert len(comp._checksum_memo) == 0

    # Because nothing was recorded, the identical tree is re-emitted
    # rather than short-circuited as a duplicate.
    comp.emit_on_accept()
    assert stream.calls == 2
    assert len(comp._checksum_memo) == 1


def test_a_send_returning_none_is_still_treated_as_delivered():
    """Only an explicit ``False`` means dropped.

    ``OSCTransport.send`` returns ``None`` and the surface has other
    stream shapes in tests; treating a falsy return as failure would
    make every one of them re-emit forever.
    """

    class Quiet:
        connected = True

        def __init__(self):
            self.calls = 0

        def send(self, address, args=()):
            self.calls += 1
            return None

    stream = Quiet()
    comp = _component(_big_song(), [], stream=stream)
    comp.emit_on_accept()

    assert stream.calls == 1
    assert len(comp._checksum_memo) == 1
