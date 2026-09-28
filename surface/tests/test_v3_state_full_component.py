"""V3StateFullComponent unit tests.

Covers the v3 state/full emitter:

- Exactly one ``state/full/tree`` message per publish, carrying a
  fixed four-arg header (reason, generation, etag, scope) followed by
  the flat record stream.
- ``reason`` is ``"accept"`` / ``"structural"`` / ``"resync"`` /
  ``"selection-change"`` depending on entry point.
- ``generation`` matches the GenerationComponent's current.
- T/D/P record layout matches the UI-side parser contract in
  [v3StateFull.ts parseV3TreeArgs] — tag, paths depth-first, child
  paths must descend from parent paths, etc.
- Master track emits first at path ``master``, then ``tracks/0``, …
- The ETag is a lowercase ``"0x"`` + 8 hex digits, and moves when the
  tree moves. It is **surface-local** since protocol 3.6.0 — no other
  implementation derives it, so there is no parity test here any more.
- An empty tree still emits a coherent message with a zero-length
  record stream.
- ``_build_payload`` failure degrades to empty-tree recovery rather
  than raising.
- ``disconnect`` is idempotent; post-disconnect ``on_structural_change``
  is a no-op.

Every component here is built with a ``FakeStream`` writing into the
same ``emits`` list the UDP ``emit`` uses. Since 3.6.0 ``state/full``
only travels the ordered stream — a component without one publishes
nothing — and one list keeps these tests about the emitter rather
than about transports.
"""

from __future__ import annotations

import pytest

from components.GenerationComponent import GenerationComponent
from components.V3StateFullComponent import (
    V3StateFullComponent,
    V3_STATE_FULL_TREE_ADDRESS,
    _HEADER_ARITY,
    _compute_checksum,
)
from tests.support.fake_stream import FakeStream
from tests.test_lom_listeners import (
    StubDevice,
    StubParam,
    StubSong,
    StubTrack,
)


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def emits():
    return []


@pytest.fixture
def song_two_tracks():
    """Two tracks + master. T1 has a Rack w/ two macros; T2 has a
    Utility w/ one gain param. Master carries no devices."""
    p0 = StubParam(pid=301, name="macro1", value=0.25, min_v=0.0, max_v=1.0)
    p1 = StubParam(pid=302, name="macro2", value=0.75, min_v=0.0, max_v=1.0)
    d0 = StubDevice(did=200, params=[p0, p1], name="Rack", class_name="DrumGroupDevice")
    t0 = StubTrack(tid=100, devices=[d0], name="Drums")

    p2 = StubParam(pid=303, name="gain", value=0.5, min_v=0.0, max_v=1.0)
    d1 = StubDevice(did=201, params=[p2], name="Utility", class_name="Utility")
    t1 = StubTrack(tid=101, devices=[d1], name="Bass")

    master = StubTrack(tid=9_000_001, devices=[], name="Master")
    song = StubSong(tracks=[t0, t1], master=master)
    return song


@pytest.fixture
def gen_component():
    g = GenerationComponent()
    # Advance once so the initial generation is 2 — tests can distinguish
    # "emitter read the current gen" from "emitter defaulted to INITIAL".
    g.advance("test-setup")
    return g


@pytest.fixture
def component(song_two_tracks, gen_component, emits):
    return V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )


# --- helpers ---------------------------------------------------------------


def _bundle(emits):
    """The one ``state/full/tree`` message a publish produces."""
    trees = [a for addr, a in emits if addr == V3_STATE_FULL_TREE_ADDRESS]
    assert len(trees) == 1, "expected exactly one tree message, got %d" % len(trees)
    return trees[0]


def _header(emits):
    """``(reason, generation, etag, scope)`` — positional, always present."""
    return tuple(_bundle(emits)[:_HEADER_ARITY])


def _tree_args(emits):
    """The flat record stream behind the header."""
    return list(_bundle(emits)[_HEADER_ARITY:])


# --- emission shape --------------------------------------------------------


def test_emit_on_accept_produces_one_tree_message(component, emits):
    component.emit_on_accept()
    assert [addr for addr, _ in emits] == [V3_STATE_FULL_TREE_ADDRESS]

    reason, generation, etag, scope = _header(emits)
    assert reason == "accept"
    assert isinstance(generation, int) and generation >= 1
    assert scope == "", "whole-song scope is the empty string"

    assert isinstance(etag, str)
    assert etag.startswith("0x")
    assert len(etag) == 2 + 8  # 0x + 8 hex digits
    assert etag[2:] == etag[2:].lower()

    assert _tree_args(emits), "a real tree must follow the header"


def test_emit_on_structural_change_reason(component, emits):
    component.on_structural_change()
    assert _header(emits)[0] == "structural"


def test_emit_on_resync_reason(component, emits):
    component.emit_on_resync()
    assert _header(emits)[0] == "resync"


def test_generation_read_from_generation_component(component, emits, gen_component):
    component.emit_on_accept()
    assert _header(emits)[1] == gen_component.current


def test_every_publish_is_exactly_one_message(component, emits):
    """The chunk counter went away with the chunks.

    Its job was letting the UI dedupe a replayed bundle and tolerate
    out-of-order chunk arrival. An ordered stream carrying the whole
    tree in one write makes both problems impossible to have.
    """
    component.emit_on_accept()
    assert len(emits) == 1
    emits.clear()

    # Issue #387: ``on_structural_change`` after an identical tree
    # short-circuits on the tree-equality guard, so use
    # ``emit_on_resync`` here — resync bypasses the short-circuit
    # because the UI just asked for a fresh tree.
    component.emit_on_resync()
    assert len(emits) == 1


# --- tree_args layout ------------------------------------------------------


def test_tree_args_start_with_master(component, emits):
    component.emit_on_accept()
    args = _tree_args(emits)
    # First record must be a T for master, at trackPath "master".
    assert args[0] == "T"
    assert args[1] == "master"


def test_tree_args_contain_all_tracks(component, emits):
    component.emit_on_accept()
    args = _tree_args(emits)
    # Find every T record's trackPath.
    track_paths = [args[i + 1] for i, a in enumerate(args) if a == "T"]
    assert track_paths == ["master", "tracks/0", "tracks/1"]


def test_tree_args_device_paths_under_tracks(component, emits):
    component.emit_on_accept()
    args = _tree_args(emits)
    # Every D record's devicePath must descend from the preceding T.
    current_track = None
    for i, a in enumerate(args):
        if a == "T":
            current_track = args[i + 1]
        elif a == "D":
            device_path = args[i + 1]
            assert current_track is not None
            assert device_path.startswith(current_track + "/devices/"), (
                "D %s not under T %s" % (device_path, current_track)
            )


def test_tree_args_param_paths_under_devices(component, emits):
    component.emit_on_accept()
    args = _tree_args(emits)
    current_device = None
    for i, a in enumerate(args):
        if a == "D":
            current_device = args[i + 1]
        elif a == "P":
            param_path = args[i + 1]
            assert current_device is not None
            assert param_path.startswith(current_device + "/params/")


def test_param_records_carry_typed_fields(component, emits):
    component.emit_on_accept()
    args = _tree_args(emits)
    # Find the first P record — the Rack's macro1 on tracks/0.
    first_p = args.index("P")
    # P record is: paramPath, name, displayName, min, max, value, unit (7 fields)
    path, name, display, min_v, max_v, value, unit = args[first_p + 1:first_p + 8]
    assert path == "tracks/0/devices/0/params/0"
    assert name == "macro1"
    assert display == "macro1"  # stubs use name as displayName fallback
    assert isinstance(min_v, float)
    assert isinstance(max_v, float)
    assert isinstance(value, float)
    assert min_v == 0.0
    assert max_v == 1.0
    assert value == 0.25
    assert unit == ""


def test_t_record_has_nine_fields(component, emits):
    component.emit_on_accept()
    args = _tree_args(emits)
    first_t = 0  # master is first
    # T record (PR-7c pr7c-3, protocol 3.2.0): trackPath, name,
    # color:int, mute:int(0|1), solo:int, arm:int, hasMidiInput:int(0|1),
    # hasAudioInput:int(0|1), hasArrangementClips:int(0|1).
    # Doctrine: per-track stable capability flags belong on T (see [04 \u00a75.1]).
    (
        path,
        name,
        color,
        mute,
        solo,
        arm,
        has_midi_input,
        has_audio_input,
        has_arrangement_clips,
    ) = args[first_t + 1:first_t + 10]
    assert path == "master"
    assert isinstance(color, int)
    assert mute in (0, 1)
    assert solo in (0, 1)
    assert arm in (0, 1)
    # Master stub doesn't carry has_midi_input / has_audio_input — _safe_getattr
    # default is False, so the wire emits 0 for both. That matches v2's
    # behaviour where master never set the I/O flags either, and the UI's
    # path-derived trackType reads (0, 0) as "neither" \u2192 null.
    assert has_midi_input == 0
    assert has_audio_input == 0
    # Master cannot host arrangement clips; pr7c-3 emits literal 0 to
    # keep T arity uniform across master/regular/returns (single-arity
    # parser, no path-prefix branching).
    assert has_arrangement_clips == 0


def test_t_record_emits_io_flags_when_present(song_two_tracks, gen_component, emits):
    """Tracks that carry has_midi_input / has_audio_input attributes
    on the LOM (any non-master Live.Track.Track does) emit them on the
    T record. Verifies the four LOM cases: MIDI-only, audio-only,
    External Instrument (both), and the master fallback (neither)."""
    # Tag t0 as a MIDI track and t1 as an audio track.
    song_two_tracks.tracks[0].has_midi_input = True
    song_two_tracks.tracks[0].has_audio_input = False
    song_two_tracks.tracks[1].has_midi_input = False
    song_two_tracks.tracks[1].has_audio_input = True
    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_on_accept()
    args = _tree_args(emits)

    # Walk the T records in order: master, tracks/0, tracks/1.
    # Per ROW 6.5 2026-04-21, T arity is 10; field indices:
    # 7=hasMidiInput, 8=hasAudioInput, 9=hasArrangementClips, 10=volume.
    t_indices = [i for i, a in enumerate(args) if a == "T"]
    assert len(t_indices) == 3, "expected master + tracks/0 + tracks/1"
    paths_and_io = [
        (args[i + 1], args[i + 7], args[i + 8]) for i in t_indices
    ]
    assert paths_and_io == [
        ("master", 0, 0),       # master: neither
        ("tracks/0", 1, 0),     # MIDI track
        ("tracks/1", 0, 1),     # audio track
    ]


def test_t_record_external_instrument_emits_both_flags(
    song_two_tracks, gen_component, emits,
):
    """External Instrument tracks have both has_midi_input == 1 and
    has_audio_input == 1. The wire carries the raw LOM bits — UI-side
    derivation rules (treating MIDI as the dominant flag for view
    routing) live in selectedTrackStore.trackType, not here."""
    song_two_tracks.tracks[0].has_midi_input = True
    song_two_tracks.tracks[0].has_audio_input = True
    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_on_accept()
    args = _tree_args(emits)

    # tracks/0 is the External Instrument case.
    t_indices = [i for i, a in enumerate(args) if a == "T"]
    ext_inst_idx = next(i for i in t_indices if args[i + 1] == "tracks/0")
    assert args[ext_inst_idx + 7] == 1
    assert args[ext_inst_idx + 8] == 1


# --- T.hasArrangementClips (PR-7c pr7c-3) ---------------------------------


def test_t_record_master_has_arrangement_clips_zero(component, emits):
    """Master cannot host arrangement clips; the emitter writes a literal
    0 in the 9th field rather than reading ``master.arrangement_clips``
    (which doesn't exist on the LOM master). Keeps T arity uniform."""
    component.emit_on_accept()
    args = _tree_args(emits)
    t_indices = [i for i, a in enumerate(args) if a == "T"]
    master_idx = next(i for i in t_indices if args[i + 1] == "master")
    assert args[master_idx + 9] == 0


def test_t_record_regular_track_with_arrangement_clips_emits_one(
    gen_component, emits,
):
    """Regular tracks with len(track.arrangement_clips) > 0 emit
    ``hasArrangementClips=1`` on the T record."""
    t = StubTrack(tid=500, devices=[], name="T0")
    # Stub an arrangement_clips collection (list-like; emitter only
    # uses ``len()``).
    t.arrangement_clips = ("clip-handle",)
    master = StubTrack(tid=9_000_001, devices=[], name="Master")
    song = StubSong(tracks=[t], master=master)
    comp = V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_on_accept()
    args = _tree_args(emits)
    t_indices = [i for i, a in enumerate(args) if a == "T"]
    track_idx = next(i for i in t_indices if args[i + 1] == "tracks/0")
    assert args[track_idx + 9] == 1


def test_t_record_regular_track_without_arrangement_clips_emits_zero(
    gen_component, emits,
):
    """Empty ``arrangement_clips`` collection emits 0."""
    t = StubTrack(tid=500, devices=[], name="T0")
    t.arrangement_clips = ()
    master = StubTrack(tid=9_000_001, devices=[], name="Master")
    song = StubSong(tracks=[t], master=master)
    comp = V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_on_accept()
    args = _tree_args(emits)
    t_indices = [i for i, a in enumerate(args) if a == "T"]
    track_idx = next(i for i in t_indices if args[i + 1] == "tracks/0")
    assert args[track_idx + 9] == 0


def test_t_record_regular_track_arrangement_clips_read_raising_emits_zero(
    gen_component, emits,
):
    """A half-torn-down track whose ``arrangement_clips`` access raises
    (e.g. invalid C++ handle as TypeError per CLAUDE.md rule 9) must
    degrade to ``hasArrangementClips=0`` instead of aborting the
    walk."""

    class RaisingArrangementClipsTrack(StubTrack):
        @property
        def arrangement_clips(self):
            raise TypeError("Boost.Python.ArgumentError: dead handle")

    t = RaisingArrangementClipsTrack(tid=500, devices=[], name="T0")
    master = StubTrack(tid=9_000_001, devices=[], name="Master")
    song = StubSong(tracks=[t], master=master)
    comp = V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    # Must NOT raise.
    comp.emit_on_accept()
    args = _tree_args(emits)
    t_indices = [i for i, a in enumerate(args) if a == "T"]
    track_idx = next(i for i in t_indices if args[i + 1] == "tracks/0")
    assert args[track_idx + 9] == 0


def test_d_record_has_three_fields(component, emits):
    """ROW 5 (2026-04-21, protocol 3.3.0): D-record is
    ``[devicePath, name, className]`` — the legacyId field carried
    through closeout-0b as a side-table key for the M4L-served
    /looping/device/{select,move_appointed_*} handlers, all of which
    retired alongside this field."""
    component.emit_on_accept()
    args = _tree_args(emits)
    first_d = args.index("D")
    path, name, class_name = args[first_d + 1:first_d + 4]
    assert path == "tracks/0/devices/0"
    assert name == "Rack"
    assert class_name == "DrumGroupDevice"
    # Next slot should be the next record tag, not a stray int field.
    next_tag = args[first_d + 4]
    assert next_tag in {"T", "D", "P", "S", "C"}


# --- ETag ------------------------------------------------------------------
#
# Protocol 3.6.0 retired the cross-language parity test that used to
# live here (a parallel Python reimplementation of the TS FNV-1a,
# asserted equal to the emitter's). The UI no longer computes anything
# to compare against — it stores this token and echoes it back — so
# there is no second implementation to agree with. See
# ``_compute_checksum``'s docstring for what is still required.


def test_the_etag_on_the_wire_matches_the_digest_of_the_payload(component, emits):
    """The header's token must describe the records behind it.

    A client declares this value back on reconnect and the surface
    compares it to a fresh walk, so a token that described a different
    tree would answer "unchanged" over stale data.
    """
    component.emit_on_accept()
    reason, generation, etag, scope = _header(emits)
    assert etag == "0x%08x" % _compute_checksum(_tree_args(emits))


def test_etag_on_wire_is_hex_string(component, emits):
    component.emit_on_accept()
    etag = _header(emits)[2]
    # Parseable as hex, and inside the int31 range ``parse_etag`` accepts.
    val = int(etag, 16)
    assert 0 <= val <= 0x7FFFFFFF


def test_checksum_changes_when_tree_changes(song_two_tracks, gen_component, emits):
    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_on_accept()
    first_etag = _header(emits)[2]
    emits.clear()

    # Mutate a param value — changes the float in the P record, should
    # change the ETag.
    song_two_tracks.tracks[0].devices[0].parameters[0].value = 0.999
    comp.on_structural_change()
    second_etag = _header(emits)[2]
    assert first_etag != second_etag


def test_etag_distinguishes_types():
    # Pre-3.6.0 the encoder had to hash ``1`` and ``1.0`` identically,
    # because JS has no separate int type and the TS mirror's
    # ``Number.isInteger`` would otherwise have diverged. With no
    # mirror left, ``repr`` keeps them apart — and the conservative
    # direction is the safe one: saying "different" about two trees
    # the wire renders alike costs a resend, nothing worse.
    assert _compute_checksum([1]) != _compute_checksum([1.0])
    assert _compute_checksum([1.5]) != _compute_checksum([1])
    assert _compute_checksum([1]) != _compute_checksum([True])
    assert _compute_checksum([1]) != _compute_checksum([False])
    assert _compute_checksum([1]) != _compute_checksum(["1"])
    assert _compute_checksum([1.0]) != _compute_checksum([1.5])


# --- payload shape ---------------------------------------------------------
#
# Protocol 3.6.0 deleted the splitter and the four tests that pinned
# it (empty tree -> one chunk, whole-track boundaries, splitting a
# 500-param device, totalChunks matching what was emitted). What they
# were protecting is that the record stream reaches the UI whole and
# in order; the ordered stream now provides that structurally, so what
# is left worth asserting is that the emitted payload is exactly the
# walk.


def test_the_payload_is_the_whole_walk_in_order(component, emits):
    component.emit_on_accept()
    assert _tree_args(emits) == component._build_payload()


def test_the_payload_starts_at_a_record_tag(component, emits):
    """The UI parses depth-first from the first arg after the header.

    An off-by-one in the header arity would show up here first, as a
    stray header field read as a record tag.
    """
    component.emit_on_accept()
    assert _tree_args(emits)[0] in ("T", "D", "P", "S", "C")


# --- error tolerance -------------------------------------------------------


def test_build_payload_failure_emits_empty_tree(gen_component, emits):
    # Song where every read raises — e.g. disconnected LOM.
    class BrokenSong:
        @property
        def master_track(self):
            raise RuntimeError("song teardown race")

        @property
        def tracks(self):
            raise RuntimeError("song teardown race")

    comp = V3StateFullComponent(
        song=BrokenSong(),
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    # Should NOT raise.
    comp.emit_on_accept()
    reason, generation, etag, scope = _header(emits)
    assert reason == "accept"
    assert _tree_args(emits) == []  # empty tree
    # A coherent header still ships — the UI must be told the tree is
    # empty rather than left holding a stale one with no explanation.
    assert etag == "0x%08x" % _compute_checksum([])


def test_track_attribute_raising_does_not_abort_walk(gen_component, emits):
    """Live's master track raises ``RuntimeError("Main track has no
    'mute' property!")`` from inside attribute access on some builds,
    which bypasses ``getattr``'s ``default`` argument. The walk must
    survive — the track should emit with safe defaults rather than the
    whole payload collapsing to empty-tree recovery.
    """

    class RaisingMaster:
        name = "Master"
        color = 0

        @property
        def mute(self):
            raise RuntimeError("Main track has no 'mute' property!")

        @property
        def solo(self):
            raise RuntimeError("Main track has no 'solo' property!")

        @property
        def arm(self):
            raise RuntimeError("Main track has no 'arm' property!")

        @property
        def devices(self):
            return []

    class SongWithRaisingMaster:
        master_track = RaisingMaster()
        tracks: list = []

    comp = V3StateFullComponent(
        song=SongWithRaisingMaster(),
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_on_accept()
    args = _tree_args(emits)
    # Master T record must be present with default 0s for the raising
    # properties, not collapsed to empty-tree recovery. Trailing two
    # zeros are PR-3.5.3's hasMidiInput / hasAudioInput — master never
    # exposes them on the LOM, so _safe_getattr falls back to False \u2192 0.
    # The 10th arg is PR-7c pr7c-3's hasArrangementClips — master can't
    # host arrangement clips, so the emitter writes a literal 0.
    assert args[:10] == ["T", "master", "Master", 0, 0, 0, 0, 0, 0, 0]


def test_disconnect_idempotent(component):
    component.disconnect()
    component.disconnect()  # must not raise


def test_post_disconnect_on_structural_change_noops(component, emits):
    component.disconnect()
    component.on_structural_change()
    assert emits == []


# --- S/C records (pr7b-7) -------------------------------------------------


class _SlotStubClip:
    def __init__(
        self,
        name: str = "Loop 1",
        length: float = 4.0,
        color: int = 0xFF00FF,
        pitch: float = 0.0,
        is_recording: bool = False,
    ):
        self.name = name
        self.length = length
        self.color = color
        self.pitch = pitch
        self.is_recording = is_recording


class _SlotStubSlot:
    def __init__(
        self,
        has_clip: bool = False,
        clip: _SlotStubClip | None = None,
        is_playing: bool = False,
    ):
        self.has_clip = has_clip
        self.clip = clip if clip is not None else (
            _SlotStubClip() if has_clip else None
        )
        self.is_playing = is_playing


class _SlotsTrack(StubTrack):
    """StubTrack extended with ``clip_slots``."""

    def __init__(self, tid, devices=None, name="", slots=None):
        super().__init__(tid=tid, devices=devices or [], name=name)
        self.clip_slots = tuple(slots or ())


def _song_with_slots(slots_track_0, slots_track_1=None, master=None):
    from tests.test_lom_listeners import StubSong as _StubSong
    tracks = [slots_track_0]
    if slots_track_1 is not None:
        tracks.append(slots_track_1)
    return _StubSong(
        tracks=tracks,
        master=master if master is not None
        else StubTrack(tid=9_000_001, devices=[], name="Master"),
    )


def _make_component_with(song, emits, gen):
    return V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=FakeStream(connected=True, sink=emits),
    )


def _find_record(args, tag, path):
    """Return (index, arity-slice) for the record matching tag+path, or None."""
    # ADR-439 2026-09-15: T arity 14 -> 15 (preset). 3.7.0: 13 -> 14
    # (role). ADR-410 2026-07-27: T arity 10 -> 13 (isFoldable / foldState /
    # groupTrackIndex). ROW 6.5 2026-04-21: T arity 9 -> 10 (volume).
    # ROW 5: D arity 4 -> 3 (legacyId retired).
    arities = {"T": 15, "D": 3, "P": 7, "S": 2, "C": 5}
    i = 0
    while i < len(args):
        cur = args[i]
        if cur not in arities:
            i += 1
            continue
        arity = arities[cur]
        slc = args[i:i + 1 + arity]
        if cur == tag and len(slc) >= 2 and slc[1] == path:
            return slc
        i += 1 + arity
    return None


def test_s_record_emitted_per_slot_empty_state(gen_component, emits):
    """Empty slots emit S records with state=0 and no following C."""
    slots = [_SlotStubSlot(has_clip=False) for _ in range(3)]
    track = _SlotsTrack(tid=100, name="T0", slots=slots)
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    for idx in range(3):
        rec = _find_record(tree, "S", "tracks/0/slots/%d" % idx)
        assert rec is not None, "missing S for slot %d" % idx
        assert rec == ["S", "tracks/0/slots/%d" % idx, 0]

    # No C records in the tree — every slot empty.
    assert "C" not in tree


def test_s_record_has_clip_state_followed_by_c_record(gen_component, emits):
    """Populated slot → state=1 + C record with clip fields."""
    clip = _SlotStubClip(
        name="Intro", length=8.0, color=0x00FF00, pitch=60.0,
    )
    slots = [_SlotStubSlot(has_clip=True, clip=clip)]
    track = _SlotsTrack(tid=100, name="T0", slots=slots)
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    s = _find_record(tree, "S", "tracks/0/slots/0")
    assert s == ["S", "tracks/0/slots/0", 1]

    c = _find_record(tree, "C", "tracks/0/slots/0/clip")
    assert c == ["C", "tracks/0/slots/0/clip", "Intro", 8.0, 0x00FF00, 60.0]


def test_s_record_playing_state(gen_component, emits):
    """``slot.is_playing`` True → state=2."""
    slots = [_SlotStubSlot(has_clip=True, is_playing=True)]
    track = _SlotsTrack(tid=100, name="T0", slots=slots)
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    s = _find_record(tree, "S", "tracks/0/slots/0")
    assert s == ["S", "tracks/0/slots/0", 2]


def test_s_record_recording_state_wins_over_playing(gen_component, emits):
    """``clip.is_recording`` precedence: recording beats playing."""
    clip = _SlotStubClip(is_recording=True)
    slots = [_SlotStubSlot(has_clip=True, clip=clip, is_playing=True)]
    track = _SlotsTrack(tid=100, name="T0", slots=slots)
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    s = _find_record(tree, "S", "tracks/0/slots/0")
    assert s == ["S", "tracks/0/slots/0", 3]


def test_master_track_emits_no_s_records(gen_component, emits, song_two_tracks):
    """Master has no clip_slots — the existing song_two_tracks fixture
    confirms no S records are emitted under ``master/``."""
    comp = _make_component_with(song_two_tracks, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    # No S record under master/.
    for i, v in enumerate(tree):
        if v == "S":
            assert not str(tree[i + 1]).startswith("master"), (
                "master produced an S record: %r" % tree[i:i + 3]
            )


def test_s_and_c_appear_after_track_devices_depth_first(gen_component, emits):
    """Design §2.7: per-track order is T → D-P → D-P … → S → C.
    S records must appear after every D/P for the track, not
    interleaved."""
    p = StubParam(pid=301, name="gain", value=0.5, min_v=0.0, max_v=1.0)
    d = StubDevice(did=200, params=[p], name="Utility", class_name="Utility")
    clip = _SlotStubClip(name="X")
    slots = [_SlotStubSlot(has_clip=True, clip=clip)]
    track = _SlotsTrack(tid=100, devices=[d], name="T0", slots=slots)
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    # First S index must come after the last P index for this track.
    p_indices = [i for i, v in enumerate(tree) if v == "P"]
    s_indices = [i for i, v in enumerate(tree) if v == "S"]
    assert p_indices and s_indices
    assert min(s_indices) > max(p_indices)


def test_s_c_walk_survives_slot_has_clip_raising(gen_component, emits):
    """Half-torn-down slot: ``has_clip`` raises ``TypeError``. The
    walk degrades to state=0 + no C record and continues to
    subsequent slots."""

    class RaisingSlot:
        @property
        def has_clip(self):
            raise TypeError("C++ handle invalid")

    track = _SlotsTrack(
        tid=100, name="T0",
        slots=[RaisingSlot(), _SlotStubSlot(has_clip=False)],
    )
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    # Slot 0 emitted state=0 despite the raise.
    s0 = _find_record(tree, "S", "tracks/0/slots/0")
    assert s0 == ["S", "tracks/0/slots/0", 0]
    # Slot 1 still walked.
    s1 = _find_record(tree, "S", "tracks/0/slots/1")
    assert s1 == ["S", "tracks/0/slots/1", 0]
    # No C records.
    assert "C" not in tree


def test_s_c_walk_survives_clip_slots_raising(gen_component, emits):
    """``track.clip_slots`` itself raising is caught — the walk
    emits the track's T/D/P then zero S records and moves on."""

    class RaisingClipSlotsTrack(StubTrack):
        @property
        def clip_slots(self):
            raise RuntimeError("torn down")

    track = RaisingClipSlotsTrack(tid=100, devices=[], name="T0")
    song = _song_with_slots(track)

    comp = _make_component_with(song, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    # No S records — the raise short-circuits the slot section.
    assert "S" not in tree
    # But T record is intact.
    t = _find_record(tree, "T", "tracks/0")
    assert t is not None


def test_checksum_changes_when_s_record_state_changes(
    gen_component, emits,
):
    """Moving a slot from empty to has_clip must change the ETag.

    Guards against an S record being silently dropped from the digest,
    which would let a reconnecting client keep a tree whose clip
    presence is wrong."""
    track_empty = _SlotsTrack(
        tid=100, name="T0", slots=[_SlotStubSlot(has_clip=False)],
    )
    comp_empty = _make_component_with(
        _song_with_slots(track_empty), emits, gen_component,
    )
    comp_empty.emit_on_accept()
    etag_empty = _header(emits)[2]

    emits.clear()
    track_full = _SlotsTrack(
        tid=100, name="T0", slots=[_SlotStubSlot(has_clip=True)],
    )
    comp_full = _make_component_with(
        _song_with_slots(track_full), emits, gen_component,
    )
    comp_full.emit_on_accept()
    etag_full = _header(emits)[2]

    assert etag_empty != etag_full


# --- Phase 12 pr12-2: scoped emit_selection_change ------------------------


def test_emit_selection_change_regular_track_reason_and_scope(
    component, emits,
):
    """Scoped emit for ``tracks/1`` produces ``reason='selection-change'``
    and carries the scope in the header's 4th slot."""
    component.emit_selection_change("tracks/1")
    reason, _gen, _etag, scope = _header(emits)
    assert reason == "selection-change"
    assert scope == "tracks/1"


def test_emit_selection_change_master_reason_and_scope(component, emits):
    """Master path emits with scope='master'."""
    component.emit_selection_change("master")
    header = _header(emits)
    assert header[0] == "selection-change"
    assert header[3] == "master"


def test_emit_selection_change_payload_is_single_track(component, emits):
    """A scoped bundle must carry exactly one T record — the scoped
    track — and no other tracks'. This is the whole point: the
    per-selection wire economy win vs. whole-song emit_structural."""
    component.emit_selection_change("tracks/1")
    args = _tree_args(emits)

    track_paths = [args[i + 1] for i, a in enumerate(args) if a == "T"]
    assert track_paths == ["tracks/1"]

    # Every D and P descends from tracks/1, not tracks/0 or master.
    for i, a in enumerate(args):
        if a in ("D", "P"):
            path = args[i + 1]
            assert path.startswith("tracks/1/"), (
                "scoped walk leaked non-scoped path: %s" % path
            )


def test_emit_selection_change_master_payload_is_master_only(
    component, emits,
):
    """Master scope walks master_track only."""
    component.emit_selection_change("master")
    args = _tree_args(emits)

    track_paths = [args[i + 1] for i, a in enumerate(args) if a == "T"]
    assert track_paths == ["master"]


def test_emit_selection_change_etag_covers_only_the_scoped_payload(
    component, emits,
):
    """The header's ETag must describe the subtree it shipped.

    The ETag store is keyed per scope on the UI side, so a scoped
    bundle carrying the whole-song digest would let a client claim to
    hold a subtree it never received.
    """
    component.emit_selection_change("tracks/0")
    scoped_args = _tree_args(emits)
    assert _header(emits)[2] == "0x%08x" % _compute_checksum(scoped_args)

    emits.clear()
    component.emit_on_accept()
    assert _header(emits)[2] != "0x%08x" % _compute_checksum(scoped_args)


def test_emit_selection_change_unresolvable_scope_suppresses_emission(
    component, emits,
):
    """Returns, out-of-range, malformed paths emit nothing — no
    begin/chunk/end reaches the wire. The caller's contract is
    'best-effort, silent on unresolved'; a broken bundle would be
    worse than silence."""
    component.emit_selection_change("returns/0")
    assert emits == []

    component.emit_selection_change("tracks/99")
    assert emits == []

    component.emit_selection_change("tracks/0/devices/0")
    assert emits == []

    component.emit_selection_change("")
    assert emits == []


def test_emit_selection_change_disconnected_is_noop(component, emits):
    """Post-disconnect scoped emit is silently dropped, matching the
    other ``emit_*`` entry points."""
    component.disconnect()
    component.emit_selection_change("tracks/0")
    assert emits == []


def test_whole_song_publishes_carry_an_empty_scope(component, emits):
    """Non-scoped publishes (accept/structural/resync) say so with the
    empty string, not by omitting the argument.

    Pre-3.6.0 the scope rode an optional 5th ``begin`` arg and a
    whole-song bundle was recognised by its length. The header is
    fixed-arity now precisely so the parser never has to infer meaning
    from how many args arrived.
    """
    component.emit_on_accept()
    assert _header(emits)[3] == ""

    # Note: ``on_structural_change`` after an identical-tree publish
    # short-circuits on the unchanged-tree guard added for issue #387.
    # To exercise the header on a structural emit we drop the memo first.
    component._checksum_memo.clear()
    emits.clear()
    component.on_structural_change()
    assert _header(emits)[3] == ""

    # ``resync`` bypasses the short-circuit — no clear needed.
    emits.clear()
    component.emit_on_resync()
    assert _header(emits)[3] == ""


def test_emit_selection_change_master_track_read_failure_suppresses(
    gen_component, emits,
):
    """If ``song.master_track`` raises while resolving ``master``
    scope, the emission is suppressed (same contract as
    unresolvable path) — no half-bundle on the wire."""

    class RaisingMasterSong:
        """Bare song stand-in — master_track raises, tracks empty.

        Deliberately NOT a StubSong subclass: StubSong's ``__init__``
        writes ``self.master_track = ...`` which collides with a
        ``@property`` defined on the subclass (no setter).
        """

        def __init__(self):
            self._tracks = []

        @property
        def tracks(self):
            return list(self._tracks)

        @property
        def master_track(self):
            raise RuntimeError("master torn down")

    comp = V3StateFullComponent(
        song=RaisingMasterSong(),
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
    )
    comp.emit_selection_change("master")
    assert emits == []


def test_emit_selection_change_generation_from_component(
    component, emits, gen_component,
):
    """Scoped emit reads ``generation_component.current`` — same
    contract as whole-song emit, so UIs can correlate the scoped
    bundle against generation-bearing events."""
    component.emit_selection_change("tracks/0")
    assert _header(emits)[1] == gen_component.current


# --- issue #387: unchanged-tree short-circuit + debounce -------------------


def test_identical_structural_emits_skip_after_first(component, emits):
    """Three back-to-back ``on_structural_change`` calls with no
    underlying tree change must produce exactly one message on the
    wire — the tree-equality short-circuit catches republishes of an
    unchanged tree (issue #387 selection-change x3 pattern)."""
    component.on_structural_change()
    assert len(emits) == 1

    component.on_structural_change()
    component.on_structural_change()

    # The two follow-up structural fires walked the tree, found it
    # unchanged, and skipped the emit.
    assert len(emits) == 1


def test_identical_selection_change_skips_after_first(component, emits):
    """Same short-circuit applies to scoped ``selection-change``
    emits — the exact pattern from issue #387 where Omnisphere
    hydration fired three identical scoped republishes."""
    component.emit_selection_change("tracks/0")
    assert len(emits) == 1

    component.emit_selection_change("tracks/0")
    component.emit_selection_change("tracks/0")

    assert len(emits) == 1


def test_short_circuit_is_per_scope(component, emits):
    """Whole-song and scoped trees are memoised independently —
    a whole-song emit must not suppress a scoped emit and vice
    versa. They sit in different cache slots."""
    component.on_structural_change()
    assert len(emits) == 1

    component.emit_selection_change("tracks/0")
    # The scoped walk produces a different tree (one track only) so
    # it must emit its own message.
    assert len(emits) == 2


def test_resync_bypasses_checksum_short_circuit(component, emits):
    """``resync`` is a UI-initiated request for a fresh tree; it must
    always emit even when the tree is unchanged."""
    component.emit_on_accept()
    after_accept = len(emits)

    component.emit_on_resync()
    # resync emitted begin + chunk(s) + end despite identical tree.
    assert len(emits) > after_accept


def test_accept_bypasses_checksum_short_circuit(component, emits):
    """``accept`` is a post-handshake state-delivery; the just-
    connected UI may have empty state, so the bundle must always
    fire even if a previous ``accept`` shipped the same tree."""
    component.emit_on_accept()
    after_first = len(emits)

    component.emit_on_accept()
    assert len(emits) > after_first


def test_set_song_clears_checksum_cache(component, emits, song_two_tracks):
    """A song rebind invalidates the per-scope checksum cache so the
    post-rebind structural emit fires even if the new tree happens
    to checksum-match the old one."""
    component.on_structural_change()
    pre_count = len(emits)

    component.set_song(song_two_tracks)
    component.on_structural_change()

    # set_song cleared the cache, so the second structural emitted.
    assert len(emits) > pre_count


def test_disconnect_clears_pending_state(song_two_tracks, gen_component, emits):
    """``disconnect`` clears pending coalescing state so a delayed
    callback firing after teardown is a clean no-op."""
    fired: list = []

    def fake_schedule(delay_ms, fn):
        fired.append(fn)

    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
        schedule_delayed=fake_schedule,
    )
    comp.on_structural_change()
    assert len(fired) == 1
    assert emits == [], "debounced — nothing on the wire yet"

    comp.disconnect()

    # The previously-scheduled callback now fires; it must not emit.
    fired[0]()
    assert emits == []


def test_debounce_collapses_burst(song_two_tracks, gen_component, emits):
    """When ``schedule_delayed`` is wired, multiple rapid
    ``on_structural_change`` calls schedule exactly one trailing-
    edge fire. The first arms the timer; subsequent calls update
    the pending reason without re-arming."""
    scheduled: list = []

    def fake_schedule(delay_ms, fn):
        scheduled.append((delay_ms, fn))

    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
        schedule_delayed=fake_schedule,
    )
    comp.on_structural_change()
    comp.on_structural_change()
    comp.on_structural_change()

    # Three fires, one trailing-edge schedule.
    assert len(scheduled) == 1
    assert emits == []

    # Fire the trailing edge — produces exactly one bundle.
    scheduled[0][1]()
    assert _header(emits)[0] == "structural"


def test_debounce_per_scope_independent(song_two_tracks, gen_component, emits):
    """Each scope has its own pending entry — a whole-song fire and
    a scoped fire schedule independent trailing-edge callbacks."""
    scheduled: list = []

    def fake_schedule(delay_ms, fn):
        scheduled.append(fn)

    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
        schedule_delayed=fake_schedule,
    )
    comp.on_structural_change()
    comp.emit_selection_change("tracks/0")
    comp.emit_selection_change("tracks/1")

    # Three distinct scopes (None, tracks/0, tracks/1) → three timers.
    assert len(scheduled) == 3


def test_debounce_falls_back_inline_on_scheduler_failure(
    song_two_tracks, gen_component, emits,
):
    """If ``schedule_delayed`` raises, the publish must still happen
    — the emit degrades to inline rather than getting dropped."""

    def broken_schedule(delay_ms, fn):
        raise RuntimeError("scheduler down")

    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
        schedule_delayed=broken_schedule,
    )
    comp.on_structural_change()
    assert _header(emits)[0] == "structural"


def test_debounce_accept_bypasses_scheduler(
    song_two_tracks, gen_component, emits,
):
    """``accept`` and ``resync`` must emit immediately even when
    debounce is wired — the UI is actively waiting on the bundle."""
    scheduled: list = []

    def fake_schedule(delay_ms, fn):
        scheduled.append(fn)

    comp = V3StateFullComponent(
        song=song_two_tracks,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen_component,
        stream=FakeStream(connected=True, sink=emits),
        schedule_delayed=fake_schedule,
    )
    comp.emit_on_accept()
    assert scheduled == []  # not debounced
    assert _header(emits)[0] == "accept"

    emits.clear()
    comp.emit_on_resync()
    assert scheduled == []
    assert _header(emits)[0] == "resync"


# --- ADR-410: group-track fields on the T record ---------------------------
#
# T arity 10 -> 13: isFoldable, foldState, groupTrackIndex (offsets
# 10/11/12 in the record slice, i.e. slc[11]/slc[12]/slc[13] once the
# tag is counted).


class _GroupTrack(StubTrack):
    """StubTrack with the ADR-410 group fields.

    ``fold_state`` raises unless ``is_foldable`` — the same shape real
    Live has (verified 12.4.5b8). The emitter must read it through
    ``_safe_getattr``, which swallows that raise; a regression to a
    plain ``getattr(track, "fold_state", False)`` would still pass
    because getattr's default doesn't catch a raising property, so the
    stub raises rather than omitting the attribute to make the
    difference observable.
    """

    def __init__(self, tid, devices=None, name="", is_foldable=False,
                 fold_state=False, group_track=None):
        super().__init__(tid=tid, devices=devices or [], name=name)
        self.is_foldable = is_foldable
        self._fold_state = fold_state
        self.group_track = group_track

    @property
    def fold_state(self):
        if not self.is_foldable:
            raise RuntimeError("Track is not foldable")
        return self._fold_state


def _group_song(tracks):
    from tests.test_lom_listeners import StubSong as _StubSong
    return _StubSong(
        tracks=tracks,
        master=StubTrack(tid=9_000_001, devices=[], name="Master"),
    )


def test_t_record_carries_group_fields_for_a_folded_group(
    gen_component, emits,
):
    group = _GroupTrack(tid=100, name="G", is_foldable=True, fold_state=True)
    child = _GroupTrack(tid=101, name="C", group_track=group)
    comp = _make_component_with(_group_song([group, child]), emits,
                                gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    g = _find_record(tree, "T", "tracks/0")
    assert g is not None
    assert (g[11], g[12], g[13]) == (1, 1, -1)

    c = _find_record(tree, "T", "tracks/1")
    assert c is not None
    # Not foldable, not folded, parented to the group at index 0.
    assert (c[11], c[12], c[13]) == (0, 0, 0)


def test_t_record_fold_state_read_survives_raising_property(
    gen_component, emits,
):
    """A regular track's ``fold_state`` raises. The T record must still
    emit (as 0) rather than aborting the walk mid-record."""
    plain = _GroupTrack(tid=100, name="P")
    comp = _make_component_with(_group_song([plain]), emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    t = _find_record(tree, "T", "tracks/0")
    assert t is not None
    assert (t[11], t[12], t[13]) == (0, 0, -1)


def test_t_record_group_index_for_ungrouped_track_is_minus_one(
    gen_component, emits, song_two_tracks,
):
    comp = _make_component_with(song_two_tracks, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)
    for path in ("tracks/0", "tracks/1", "master"):
        rec = _find_record(tree, "T", path)
        assert rec is not None, path
        assert rec[13] == -1, path


def test_t_record_group_index_resolves_by_lom_identity_not_position(
    gen_component, emits,
):
    """``group_track`` hands back a Track object, and Live mints a fresh
    wrapper per read — the index has to come from ``_safe_int_id``
    (ADR-350), never from an ``is`` comparison. A separate stub object
    carrying the *same* id must still resolve."""
    group = _GroupTrack(tid=100, name="G", is_foldable=True)
    # Distinct object, same LOM identity — what Live actually hands back.
    same_group_other_wrapper = _GroupTrack(tid=100, name="G",
                                           is_foldable=True)
    child = _GroupTrack(tid=101, name="C",
                        group_track=same_group_other_wrapper)
    comp = _make_component_with(_group_song([group, child]), emits,
                                gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    c = _find_record(tree, "T", "tracks/1")
    assert c is not None
    assert c[13] == 0


def test_emitted_t_record_has_fifteen_fields(
    gen_component, emits, song_two_tracks,
):
    """T arity is 15 on the wire (``preset``, 3.9.0), counted off the wire.

    This used to be a three-way agreement — emitter, splitter arity
    table, UI parser — and the splitter's copy is gone with the
    splitter. The UI parser's copy is not: ``parseTrackRecord`` reads
    13 fields and a mismatch makes it read the *next* record's tag as
    a group index, then bail on the whole tree. Count the fields here
    rather than trusting either side's constant.
    """
    comp = _make_component_with(song_two_tracks, emits, gen_component)
    comp.emit_on_accept()
    tree = _tree_args(emits)

    first_t = tree.index("T")
    fields = 0
    i = first_t + 1
    while i < len(tree) and tree[i] not in ("T", "D", "P", "S", "C"):
        fields += 1
        i += 1
    assert fields == 15


# --- protocol 3.7.0: role on the T record ----------------------------------
#
# The first T field that is not a LOM *attribute* — it is a value this
# system wrote via `Track.set_data` and is reading back. Everything else
# on T degrades to a default when Live raises; this must too, because
# `get_data` is a Live 12 API and a T record that aborts takes the whole
# tree with it.


class _RoleTrack(StubTrack):
    """StubTrack with Live 12's per-track key-value store."""

    def __init__(self, tid, name="", store=None, raises=False):
        super().__init__(tid=tid, devices=[], name=name)
        self._store = dict(store or {})
        self._raises = raises

    def get_data(self, key, default_value):
        if self._raises:
            raise RuntimeError("no data store on this build")
        return self._store.get(key, default_value)


def _role_of(emits):
    """The 14th T field — role — off the first T record."""
    tree = _tree_args(emits)
    return tree[tree.index("T") + 14]


def _role_song(track):
    return StubSong(tracks=[track], master=StubTrack(tid=9_000_001, name="Master"))


def test_t_record_carries_a_persisted_role(gen_component, emits):
    track = _RoleTrack(100, "Drums", {"looping.role": "drum"})
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    # master emits first, so read the second T.
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    assert tree[t_indices[1] + 14] == "drum"


def test_t_record_role_is_empty_when_never_set(gen_component, emits):
    track = _RoleTrack(100, "Drums", {})
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    assert tree[t_indices[1] + 14] == ""


def test_t_record_role_reads_a_cleared_key_as_no_role(gen_component, emits):
    """There is no way to DELETE a key from Live's store — writing
    ``None`` stores ``None``, and ``get_data`` then returns it instead
    of the default. Both must collapse to "no role" or a cleared track
    reads as the literal string "None"."""
    track = _RoleTrack(100, "Drums", {"looping.role": None})
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    assert tree[t_indices[1] + 14] == ""


def test_t_record_survives_a_track_with_no_data_store(gen_component, emits):
    """A pre-12 Live has no ``get_data`` at all. The T record must still
    emit — an exception here would abort the walk and empty the tree."""
    track = StubTrack(tid=100, devices=[], name="Drums")  # no get_data
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    assert len(t_indices) == 2, "both tracks must still be in the tree"
    assert tree[t_indices[1] + 14] == ""


def test_t_record_survives_a_raising_data_store(gen_component, emits):
    track = _RoleTrack(100, "Drums", raises=True)
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    assert tree[t_indices[1] + 14] == ""


def test_role_change_moves_the_etag(gen_component, emits):
    """A role write must invalidate the memo, or the republish that
    carries it is skipped as an unchanged tree."""
    track = _RoleTrack(100, "Drums", {})
    comp = _make_component_with(_role_song(track), emits, gen_component)
    comp.emit_on_accept()
    before = _header(emits)[2]

    emits.clear()
    track._store["looping.role"] = "drum"
    comp.on_structural_change()
    assert emits, "a changed role must ship"
    assert _header(emits)[2] != before


# --- protocol 3.9.0: preset on the T record (ADR-439) -------------------------
#
# The path the last prepare_for_preset load recorded under `looping.preset`,
# the reference the swap control steps from — while the track still holds the
# instrument that load left. Same store and the same total read as the role,
# one field after it.

_OMNI_2 = "/Presets/Omni/FX/Choral FX Octave Fall 2.aupreset"
_EVO_02 = "/Presets/Ableton/Evo/Evo 02 - Subtle Long Wave.adv"


class _PresetTrack(_RoleTrack):
    """A track with the data store and a device chain."""

    def __init__(self, tid, name="", store=None, devices=(), raises=False):
        super().__init__(tid, name, store, raises=raises)
        self._devices = list(devices)


def _dev(did, class_name, name, type_=1):
    """A device ``Device.type`` reads: 1 instrument, 2 audio effect, 4 MIDI effect."""
    device = StubDevice(did=did, name=name, class_name=class_name)
    device.type = type_
    return device


def _record(path, class_name, name):
    return {"looping.preset": {"path": path, "instrument": {"class": class_name, "name": name}}}


def _preset_field(emits):
    """The 15th T field — preset — off the track's T record (master emits first)."""
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    return tree[t_indices[1] + 15]


def _preset_after_accept(track, emits, gen_component):
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    return _preset_field(emits)


def test_t_record_carries_the_preset_while_the_track_holds_its_instrument(gen_component, emits):
    track = _PresetTrack(100, "Keys", {
        "looping.role": "key",
        **_record(_OMNI_2, "AuPluginDevice", "Omnisphere"),
    }, devices=[_dev(200, "AuPluginDevice", "Omnisphere"), _dev(201, "MxDeviceAudioEffect", "Permute", type_=2)])
    _make_component_with(_role_song(track), emits, gen_component).emit_on_accept()
    tree = _tree_args(emits)
    t_indices = [i for i, a in enumerate(tree) if a == "T"]
    assert tree[t_indices[1] + 14] == "key"
    assert tree[t_indices[1] + 15] == _OMNI_2


@pytest.mark.parametrize("devices", [
    # Live's undo walked back past the load, to the kit the track started with.
    [_dev(200, "DrumGroupDevice", "Memphis Studio + Plymouth")],
    # A load onto a device of its own class, undone: the same MultiSampler,
    # renamed back (measured on the rig, 2026-09-15).
    [_dev(200, "MultiSampler", "Evo 01 - Subtle Sul Tasto")],
    # The instrument deleted; Permute is all that is left.
    [_dev(201, "MxDeviceAudioEffect", "Permute", type_=2)],
], ids=["another-class", "same-class-renamed", "instrument-gone"])
def test_t_record_preset_is_empty_once_the_track_no_longer_holds_its_instrument(gen_component, emits, devices):
    track = _PresetTrack(100, "Keys", _record(_EVO_02, "MultiSampler", "Evo 02 - Subtle Long Wave"), devices=devices)
    assert _preset_after_accept(track, emits, gen_component) == ""


def test_the_check_reads_past_effects_on_either_side_of_the_instrument(gen_component, emits):
    track = _PresetTrack(100, "Keys", _record(_EVO_02, "MultiSampler", "Evo 02 - Subtle Long Wave"), devices=[
        _dev(199, "MidiArpeggiator", "Arpeggiator", type_=4),
        _dev(200, "MultiSampler", "Evo 02 - Subtle Long Wave"),
        _dev(201, "MxDeviceAudioEffect", "Permute", type_=2),
    ])
    assert _preset_after_accept(track, emits, gen_component) == _EVO_02


def test_the_check_cannot_see_inside_a_plugin(gen_component, emits):
    """The documented limit, pinned so it is not mistaken for a bug. Undoing an
    Omnisphere patch change leaves the same device under the same name (35 undo
    steps on the rig, none of them touched it), so the record still reads as
    held while the plug-in plays the patch before it."""
    track = _PresetTrack(100, "Keys", _record(_OMNI_2, "AuPluginDevice", "Omnisphere"),
                         devices=[_dev(200, "AuPluginDevice", "Omnisphere")])
    assert _preset_after_accept(track, emits, gen_component) == _OMNI_2


def test_a_record_whose_load_left_no_instrument_holds_only_while_there_is_none(gen_component, emits):
    record = {"looping.preset": {"path": "/Guitar.adg", "instrument": None}}
    effects_only = _PresetTrack(100, "Guitar", record, devices=[_dev(200, "AudioEffectGroupDevice", "Guitar", type_=2)])
    assert _preset_after_accept(effects_only, emits, gen_component) == "/Guitar.adg"

    emits.clear()
    with_instrument = _PresetTrack(100, "Guitar", record, devices=[_dev(200, "Operator", "Operator")])
    assert _preset_after_accept(with_instrument, emits, gen_component) == ""


@pytest.mark.parametrize("store, raises, holds", [
    ({}, False, True),                                                        # never recorded
    ({"looping.preset": None}, False, True),                                  # "cleared": the store has no delete
    ({}, True, True),                                                         # a Live whose store raises
    ({"looping.preset": _OMNI_2}, False, True),                               # a bare path, as 3.9.0 first wrote it
    ({"looping.preset": {"path": _OMNI_2}}, False, False),                    # no instrument beside it
    ({"looping.preset": {"path": "", "instrument": None}}, False, False),
    ({"looping.preset": {"path": 7, "instrument": None}}, False, False),
    ({"looping.preset": {"path": _OMNI_2, "instrument": "Omnisphere"}}, False, True),
], ids=["unset", "cleared", "store-raises", "bare-path", "no-instrument-key", "empty-path", "non-str-path",
        "instrument-not-a-record"])
def test_t_record_preset_is_empty_when_unset_cleared_unreadable_or_malformed(gen_component, emits, store, raises, holds):
    devices = [_dev(200, "AuPluginDevice", "Omnisphere")] if holds else []
    track = _PresetTrack(100, "Keys", store, devices=devices, raises=raises)
    assert _preset_after_accept(track, emits, gen_component) == ""


def test_t_record_preset_is_empty_when_the_chain_cannot_be_read(gen_component, emits):
    """Unreadable is not "no instrument": a record whose load left none must
    not read as held off a chain nothing could read."""
    class _TornTrack(_PresetTrack):
        @property
        def devices(self):
            raise RuntimeError("chain torn down")

    track = _TornTrack(100, "Guitar", {"looping.preset": {"path": "/Guitar.adg", "instrument": None}})
    assert _preset_after_accept(track, emits, gen_component) == ""


def test_preset_change_moves_the_etag(gen_component, emits):
    """A recorded preset must invalidate the memo like a role does, or the
    structural republish after a folder-next load is skipped as unchanged."""
    track = _PresetTrack(100, "Keys", {}, devices=[_dev(200, "AuPluginDevice", "Omnisphere")])
    comp = _make_component_with(_role_song(track), emits, gen_component)
    comp.emit_on_accept()
    before = _header(emits)[2]

    emits.clear()
    track._store.update(_record(_OMNI_2, "AuPluginDevice", "Omnisphere"))
    comp.on_structural_change()
    assert emits, "a changed preset must ship"
    assert _header(emits)[2] != before
    assert _preset_field(emits) == _OMNI_2


def test_a_rename_under_an_unchanged_record_republishes_it_empty(gen_component, emits):
    """Live's undo of a same-class load renames the instrument back and touches
    neither the store nor the device list. The walk the name listener asks for
    must carry "" (ADR-439 addendum)."""
    evo = _dev(200, "MultiSampler", "Evo 02 - Subtle Long Wave")
    track = _PresetTrack(100, "Keys", _record(_EVO_02, "MultiSampler", "Evo 02 - Subtle Long Wave"), devices=[evo])
    comp = _make_component_with(_role_song(track), emits, gen_component)
    comp.emit_on_accept()
    assert _preset_field(emits) == _EVO_02

    emits.clear()
    evo.name = "Evo 01 - Subtle Sul Tasto"
    comp.on_structural_change()
    assert _preset_field(emits) == ""


# --- pad-scoped bundles: reason pad-chain, scope a pad path (issue #491) ------

from components.GenerationComponent import GenerationComponent as _Gen
from tests.support.lom_fakes import (
    FakeChain,
    FakeDevice,
    FakePad,
    FakeParam,
    FakeSong,
    FakeTrack,
    drumcell,
    make_rack,
)


def _pad_component(emits):
    reverb = FakeDevice(
        "Hybrid",
        [FakeParam("Device On", 1.0, 0, 1, quantized=True), FakeParam("Dry/Wet", 0.3)],
        type_=2, name="Reverb",
    )
    rack = make_rack([
        FakePad(36, [FakeChain([drumcell(), reverb])]),
        FakePad(37, [FakeChain([drumcell()])]),
    ])
    song = FakeSong(tracks=[FakeTrack([rack], "Drums")])
    gen = _Gen()
    gen.advance("test-setup")
    comp = V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=FakeStream(connected=True, sink=emits),
    )
    return comp, rack, reverb


def test_pad_bundle_carries_the_chains_effects_under_the_pad_path(emits):
    comp, _, reverb = _pad_component(emits)
    comp.emit_pad_chain("tracks/0/devices/0/pads/36")
    reason, generation, etag, scope = _header(emits)
    assert reason == "pad-chain"
    assert scope == "tracks/0/devices/0/pads/36"
    args = _tree_args(emits)
    # The instrument at index 0 is skipped; the Reverb keeps its chain index.
    assert args[0:4] == ["D", "tracks/0/devices/0/pads/36/devices/1", "Reverb", "Hybrid"]
    assert args[4:12] == [
        "P", "tracks/0/devices/0/pads/36/devices/1/params/0", "Device On", "Device On", 0.0, 1.0, 1.0, "",
    ]
    assert args[12:20] == [
        "P", "tracks/0/devices/0/pads/36/devices/1/params/1", "Dry/Wet", "Dry/Wet", 0.0, 1.0, 0.3, "",
    ]
    assert len(args) == 20
    assert "T" not in args


def test_pad_bundle_for_a_pad_with_only_its_instrument_is_empty_but_sent(emits):
    comp, _, _ = _pad_component(emits)
    comp.emit_pad_chain("tracks/0/devices/0/pads/37")
    assert _header(emits)[3] == "tracks/0/devices/0/pads/37"
    assert _tree_args(emits) == []


def test_pad_bundle_for_an_unresolvable_pad_emits_nothing(emits):
    comp, _, _ = _pad_component(emits)
    comp.emit_pad_chain("tracks/0/devices/0/pads/40")   # no chain
    comp.emit_pad_chain("tracks/3/devices/0/pads/36")   # no track
    comp.emit_pad_chain("tracks/0/devices/0/pads/36/devices/1")  # not a pad path
    assert emits == []


def test_pad_bundle_whose_build_raises_is_suppressed_not_sent_empty(emits, monkeypatch):
    """An empty pad bundle means "every effect gone" and the UI empties the
    pad on it; a failed build must not be mistaken for that answer."""
    comp, _, _ = _pad_component(emits)

    def boom(scope):
        raise RuntimeError("boom")

    monkeypatch.setattr(comp, "_build_scoped_payload", boom)
    comp.emit_pad_chain("tracks/0/devices/0/pads/36")
    assert emits == []


def test_pad_bundle_is_never_memo_suppressed(emits):
    """A bundle answers a subscription: a client that dropped its pad map
    must get the same records again, unchanged tree or not."""
    comp, _, _ = _pad_component(emits)
    comp.emit_pad_chain("tracks/0/devices/0/pads/36")
    comp.emit_pad_chain("tracks/0/devices/0/pads/36")
    trees = [a for addr, a in emits if addr == V3_STATE_FULL_TREE_ADDRESS]
    assert len(trees) == 2
    assert trees[0][2] == trees[1][2]  # same etag, sent twice


def test_a_track_scoped_bundle_still_suppresses_an_unresolvable_scope(emits):
    comp, _, _ = _pad_component(emits)
    comp.emit_selection_change("tracks/7")
    assert emits == []


def test_pad_bundle_follows_a_chain_edit(emits):
    comp, rack, _ = _pad_component(emits)
    delay = FakeDevice("Delay", [FakeParam("Device On", 1.0)], type_=2, name="Delay")
    rack.drum_pads[36].chains[0].insert(1, delay)
    comp.emit_pad_chain("tracks/0/devices/0/pads/36")
    args = _tree_args(emits)
    d_paths = [args[i + 1] for i, tag in enumerate(args) if tag == "D"]
    assert d_paths == ["tracks/0/devices/0/pads/36/devices/1", "tracks/0/devices/0/pads/36/devices/2"]
    assert args[args.index("D") + 2] == "Delay"
