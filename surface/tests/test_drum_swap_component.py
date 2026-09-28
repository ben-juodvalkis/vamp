"""DrumSwapComponent: the surface half of the similar-sound swap (ADR-439 phase 3).

The grid math the bridge addresses Live's pad SwapBars with, ``show_for_swap``
(select the rack, show the device chain, scroll a pad's row into view) and
``pad_names`` (each pad's instrument name and identity), against the Drum Rack
fakes shared with the virtual-macro and pad-chain tests.
"""

from __future__ import annotations

import json

import pytest

from components.DrumSwapComponent import (
    DEVICE_CHAIN_VIEW,
    ERR_BAD_ARGS,
    ERR_NO_PAD,
    ERR_NOT_A_KIT,
    ERR_NOT_TOP_LEVEL,
    ERR_REFUSED,
    SWAP_UNDO_MAX_MS,
    V3_DRUM_FINISH_SWAP_ACK_ADDRESS,
    V3_DRUM_PAD_NAMES_REPLY_ADDRESS,
    V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS,
    DrumSwapComponent,
    grid_index,
    scroll_for,
)
from tests.support.lom_fakes import (
    FakeDevice,
    FakeRackView,
    FakeSong,
    FakeTrack,
    drumcell,
    eq8,
    make_rack,
    pad,
    simpler,
)

RACK = "tracks/1/devices/0"


class ScrollingRackView(FakeRackView):
    """``DrumGroupDevice.view`` with ``drum_pads_scroll_position``: the lowest
    visible row of the 4x4 grid (Live's default kit view starts at row 9,
    notes 36-51, measured on the Memphis kit)."""

    def __init__(self, pad=None, scroll=9, refuse=False):
        super().__init__(pad)
        self._scroll = scroll
        self.refuse = refuse
        self.scroll_writes = []

    @property
    def drum_pads_scroll_position(self):
        return self._scroll

    @drum_pads_scroll_position.setter
    def drum_pads_scroll_position(self, value):
        if self.refuse:
            raise RuntimeError("drum_pads_scroll_position is read-only")
        self.scroll_writes.append(value)
        self._scroll = int(value)


class FakeApplicationView:
    def __init__(self, raises=False):
        self.shown = []
        self.raises = raises

    def show_view(self, name):
        if self.raises:
            raise RuntimeError("no such view")
        self.shown.append(name)


class FakeApplication:
    def __init__(self, raises=False):
        self.view = FakeApplicationView(raises)


def kit(scroll=9):
    """Memphis-shaped: a Drum Sampler on 36 named after its sample, a Simpler on
    38, a pad on 40 whose chain holds only an effect, a Drum Sampler on 52 (out
    of the default view), and Permute after the rack as on the rig."""
    kick = drumcell()
    kick.name = "Kick-SessionDry-Felt-Soft"
    rack = make_rack([pad(36, kick), pad(38, simpler()), pad(40, eq8()), pad(52, drumcell())])
    rack.view = ScrollingRackView(rack.drum_pads[36], scroll=scroll)
    track = FakeTrack([rack, FakeDevice("MxDeviceAudioEffect", name="Permute", type_=2)], name="Drums")
    song = FakeSong(tracks=[FakeTrack([FakeDevice("Operator")], name="Keys"), track])
    return song, track, rack, kick


@pytest.fixture
def emits():
    return []


def component(song, emits, application=None, schedule_delayed=None):
    return DrumSwapComponent(song=song, emit=lambda a, args: emits.append((a, tuple(args))),
                             application=application, schedule_delayed=schedule_delayed)


# --- grid math --------------------------------------------------------------------

def test_scroll_only_moves_when_the_row_is_out_of_view():
    assert scroll_for(36, 9) == 9          # row 9, the bottom row of 9..12
    assert scroll_for(51, 9) == 9          # row 12, the top row
    assert scroll_for(52, 9) == 10         # row 13: one row up, not a jump
    assert scroll_for(35, 9) == 8          # row 8: one row down
    assert scroll_for(0, 9) == 0
    assert scroll_for(127, 0) == 28        # never past the last full page


def test_grid_index_is_reading_order_with_the_highest_row_on_top():
    assert grid_index(48, 9) == 0          # top-left: row 12, first note
    assert grid_index(51, 9) == 3          # top-right
    assert grid_index(36, 9) == 12         # bottom-left
    assert grid_index(39, 9) == 15         # bottom-right
    assert grid_index(52, 9) == -1         # not showing
    assert grid_index(52, 10) == 0


# --- show_for_swap ----------------------------------------------------------------

def test_show_for_the_kit_selects_the_rack_and_shows_the_chain(emits):
    song, track, rack, _ = kit()
    app = FakeApplication()
    component(song, emits, app).handle_show_for_swap(("req-1", RACK, -1), None)
    assert song.view.selected_track is track
    assert song.view.selected_devices == [rack]
    assert app.view.shown == [DEVICE_CHAIN_VIEW]
    assert rack.view.scroll_writes == []
    assert emits == [(V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS, ("req-1", 1, "", "", "tracks/1", 0, 9, -1))]


def test_show_for_a_pad_in_view_leaves_the_grid_where_it_is(emits):
    song, _, rack, _ = kit()
    component(song, emits).handle_show_for_swap(("req-2", RACK, 38), None)
    assert rack.view.scroll_writes == []
    assert emits[-1] == (V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS, ("req-2", 1, "", "", "tracks/1", 0, 9, 14))


def test_show_for_a_pad_out_of_view_scrolls_its_row_in(emits):
    song, _, rack, _ = kit()
    component(song, emits).handle_show_for_swap(("req-3", RACK, 52), None)
    assert rack.view.scroll_writes == [10]
    assert emits[-1] == (V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS, ("req-3", 1, "", "", "tracks/1", 0, 10, 0))


def test_show_for_a_pad_selects_it_so_the_device_view_shows_its_drum_sampler(emits):
    song, _, rack, _ = kit()
    assert rack.view.selected_drum_pad is rack.drum_pads[36]
    component(song, emits).handle_show_for_swap(("req-s", RACK, 52), None)
    assert rack.view.selected_drum_pad is rack.drum_pads[52]
    assert emits[-1][1][:2] == ("req-s", 1)


def test_show_for_the_kit_leaves_the_selected_pad_alone(emits):
    song, _, rack, _ = kit()
    component(song, emits).handle_show_for_swap(("req-k", RACK, -1), None)
    assert rack.view.selected_drum_pad is rack.drum_pads[36]


class RefusingSelectionView(ScrollingRackView):
    @property
    def selected_drum_pad(self):
        return self._pad

    @selected_drum_pad.setter
    def selected_drum_pad(self, pad):
        raise RuntimeError("Changes cannot be triggered by notifications")


def test_a_pad_selection_live_refuses_is_an_error_and_opens_no_undo_step(emits):
    song, _, rack, _ = kit()
    rack.view = RefusingSelectionView(rack.drum_pads[36])
    component(song, emits).handle_show_for_swap(("req-r", RACK, 38), None)
    assert emits[-1][1][:3] == ("req-r", 0, ERR_REFUSED)
    assert "selecting pad 38" in emits[-1][1][3]
    assert song.begins == 0


@pytest.mark.parametrize("args, code", [
    (("req", RACK), ERR_BAD_ARGS),
    (("req", RACK, "kick"), ERR_BAD_ARGS),
    (("req", "tracks/1/devices/0/pads/36/devices/0", -1), ERR_NOT_TOP_LEVEL),
    (("req", "tracks/0/devices/0", -1), ERR_NOT_A_KIT),
    (("req", RACK, 44), ERR_NO_PAD),             # no chain on 44
])
def test_show_for_swap_names_what_is_wrong(emits, args, code):
    song, _, _, _ = kit()
    component(song, emits).handle_show_for_swap(args, None)
    address, payload = emits[-1]
    assert address == V3_DRUM_SHOW_FOR_SWAP_ACK_ADDRESS
    assert payload[:3] == ("req", 0, code) and payload[4:] == ("", -1, -1, -1)


def test_a_grid_that_refuses_to_scroll_is_an_error_not_a_wrong_pad(emits):
    song, _, rack, _ = kit()
    rack.view.refuse = True
    component(song, emits).handle_show_for_swap(("req-4", RACK, 52), None)
    assert emits[-1][1][:3] == ("req-4", 0, ERR_REFUSED)


def test_show_view_raising_is_not_fatal(emits):
    song, _, _, _ = kit()
    component(song, emits, FakeApplication(raises=True)).handle_show_for_swap(("req-5", RACK, -1), None)
    assert emits[-1][1][:2] == ("req-5", 1)


# --- pad_names --------------------------------------------------------------------

def _names(emits):
    address, payload = emits[-1]
    assert address == V3_DRUM_PAD_NAMES_REPLY_ADDRESS and payload[1] == 1, payload
    assert len(payload) == 5 and payload[2:4] == ("", "")
    return json.loads(payload[4])["pads"]


def test_pad_names_reads_the_instrument_not_the_chain(emits):
    song, _, rack, kick = kit()
    rack.drum_pads[36].name = "Kick Plastic 90s"   # the chain's, stale after a swap
    component(song, emits).handle_pad_names(("req-6", RACK, "*"), None)
    pads = _names(emits)
    assert [p["note"] for p in pads] == [36, 38, 40, 52]
    assert pads[0] == {"note": 36, "name": "Kick-SessionDry-Felt-Soft", "class": "DrumCell", "ptr": kick._live_ptr}
    assert pads[1]["class"] == "OriginalSimpler"
    # effects only: no instrument, so the chain's name and no identity
    assert pads[2] == {"note": 40, "name": "Pad 40", "class": None, "ptr": None}


def test_pad_names_for_chosen_pads_only(emits):
    song, _, _, _ = kit()
    component(song, emits).handle_pad_names(("req-7", RACK, "38,52"), None)
    assert [p["note"] for p in _names(emits)] == [38, 52]


@pytest.mark.parametrize("notes", ["", "kick", "36,200"])
def test_pad_names_rejects_malformed_notes(emits, notes):
    song, _, _, _ = kit()
    component(song, emits).handle_pad_names(("req-8", RACK, notes), None)
    assert emits[-1] == (V3_DRUM_PAD_NAMES_REPLY_ADDRESS,
                         ("req-8", 0, ERR_BAD_ARGS, "notes must be '*' or comma-separated integers", ""))


def test_disconnected_component_answers_nothing(emits):
    song, _, _, _ = kit()
    comp = component(song, emits)
    comp.disconnect()
    comp.handle_show_for_swap(("req-9", RACK, -1), None)
    comp.handle_pad_names(("req-9", RACK, "*"), None)
    comp.handle_finish_swap(("req-9", RACK), None)
    assert emits == []


# --- finish_swap: chain names follow, inside one undo step ------------------------

def _finish(emits):
    address, payload = emits[-1]
    assert address == V3_DRUM_FINISH_SWAP_ACK_ADDRESS and payload[1] == 1 and len(payload) == 5, payload
    return json.loads(payload[4])


def named_kit():
    """kit() with each chain named after its instrument, the way Live names a
    pad a sample is dropped on."""
    song, _, rack, kick = kit()
    snare = rack.drum_pads[38].chains[0].devices[0]
    snare.name = "Snare-SessionDry-Stick-Hit-Soft"
    for note in (36, 38, 52):
        chain = rack.drum_pads[note].chains[0]
        chain.name = chain.devices[0].name
    return song, rack, kick, snare


def test_show_for_swap_opens_one_undo_step_and_a_refusal_opens_none(emits):
    song, _, _, _ = named_kit()
    comp = component(song, emits)
    comp.handle_show_for_swap(("req", RACK), None)
    assert song.begins == 0
    comp.handle_show_for_swap(("req", RACK, -1), None)
    assert (song.begins, song.ends) == (1, 0)


def test_finish_renames_the_chains_named_after_their_sample_inside_the_undo_step(emits):
    song, rack, kick, snare = named_kit()
    comp = component(song, emits)
    comp.handle_show_for_swap(("show", RACK, -1), None)
    kick.name = "Kick Felt Soft Dry Session"          # Live's swap renames the instruments
    snare.name = "Snare Stick Hit Soft Dry Session"
    comp.handle_finish_swap(("finish", RACK), None)
    assert _finish(emits) == {"open": True, "renamed": [36, 38], "kept": []}
    assert rack.drum_pads[36].chains[0].name == "Kick Felt Soft Dry Session"
    assert rack.drum_pads[38].chains[0].name == "Snare Stick Hit Soft Dry Session"
    assert rack.drum_pads[52].chains[0].name == "DrumCell"   # nothing swapped there
    assert (song.begins, song.ends) == (1, 1)


def test_a_chain_with_a_name_of_its_own_or_renamed_mid_swap_is_kept(emits):
    song, rack, kick, snare = named_kit()
    rack.drum_pads[36].chains[0].name = "606 Kick"      # the kit maker's name
    comp = component(song, emits)
    comp.handle_show_for_swap(("show", RACK, -1), None)
    kick.name = "Kick Felt Soft Dry Session"
    snare.name = "Snare Stick Hit Soft Dry Session"
    rack.drum_pads[38].chains[0].name = "Snare (mine)"  # renamed in Live while the swap ran
    comp.handle_finish_swap(("finish", RACK), None)
    assert _finish(emits) == {"open": True, "renamed": [], "kept": [36, 38]}
    assert rack.drum_pads[36].chains[0].name == "606 Kick"
    assert rack.drum_pads[38].chains[0].name == "Snare (mine)"


def test_a_pad_swap_follows_only_that_pad(emits):
    song, rack, kick, snare = named_kit()
    comp = component(song, emits)
    comp.handle_show_for_swap(("show", RACK, 38), None)
    kick.name = "Kick Felt Soft Dry Session"            # out of scope
    snare.name = "Snare Stick Hit Soft Dry Session"
    comp.handle_finish_swap(("finish", RACK), None)
    assert _finish(emits)["renamed"] == [38]
    assert rack.drum_pads[36].chains[0].name == "Kick-SessionDry-Felt-Soft"


def test_finish_with_nothing_open_touches_nothing(emits):
    song, _, _, _ = named_kit()
    comp = component(song, emits)
    comp.handle_finish_swap(("finish", RACK), None)
    assert _finish(emits) == {"open": False, "renamed": [], "kept": []}
    assert song.ends == 0
    comp.handle_finish_swap(("finish",), None)
    assert emits[-1] == (V3_DRUM_FINISH_SWAP_ACK_ADDRESS,
                         ("finish", 0, ERR_BAD_ARGS, "expected [requestId, rackPath]", ""))


def test_a_second_show_closes_the_stale_undo_step_first(emits):
    song, _, _, _ = named_kit()
    comp = component(song, emits)
    comp.handle_show_for_swap(("show-1", RACK, -1), None)
    comp.handle_show_for_swap(("show-2", RACK, 38), None)
    assert (song.begins, song.ends) == (2, 1)
    comp.handle_finish_swap(("finish", RACK), None)
    assert (song.begins, song.ends) == (2, 2)


def test_an_abandoned_swap_closes_its_undo_step_on_the_timer_and_only_its_own(emits):
    song, _, _, _ = named_kit()
    scheduled = []
    comp = component(song, emits, schedule_delayed=lambda ms, fn: scheduled.append((ms, fn)))
    comp.handle_show_for_swap(("show-1", RACK, -1), None)
    comp.handle_finish_swap(("finish-1", RACK), None)
    comp.handle_show_for_swap(("show-2", RACK, -1), None)
    assert [ms for ms, _ in scheduled] == [SWAP_UNDO_MAX_MS, SWAP_UNDO_MAX_MS]
    scheduled[0][1]()                                   # the finished swap's timer: nothing of its own left
    assert song.ends == 1
    scheduled[1][1]()                                   # the abandoned swap's
    assert song.ends == 2
    comp.handle_finish_swap(("finish-2", RACK), None)
    assert _finish(emits)["open"] is False


def test_disconnect_closes_an_open_undo_step(emits):
    song, _, _, _ = named_kit()
    comp = component(song, emits)
    comp.handle_show_for_swap(("show", RACK, -1), None)
    comp.disconnect()
    assert (song.begins, song.ends) == (1, 1)


def test_a_refused_undo_step_still_follows_the_names(emits):
    song, rack, kick, _ = named_kit()
    song.raise_on = {"begin"}
    comp = component(song, emits)
    comp.handle_show_for_swap(("show", RACK, -1), None)
    assert emits[-1][1][:2] == ("show", 1)
    kick.name = "Kick Felt Soft Dry Session"
    comp.handle_finish_swap(("finish", RACK), None)
    assert _finish(emits)["renamed"] == [36]
    assert rack.drum_pads[36].chains[0].name == "Kick Felt Soft Dry Session"
    assert song.ends == 0


def test_a_chain_live_already_renamed_with_its_instrument_is_neither_renamed_nor_kept(emits):
    # A pad's own swap button renames the chain too (measured on pads 36 and
    # 51): the finish finds it following already.
    song, rack, kick, _ = named_kit()
    comp = component(song, emits)
    comp.handle_show_for_swap(("show", RACK, 36), None)
    kick.name = "Kick Felt Soft Dry Session"
    rack.drum_pads[36].chains[0].name = "Kick Felt Soft Dry Session"
    comp.handle_finish_swap(("finish", RACK), None)
    assert _finish(emits) == {"open": True, "renamed": [], "kept": []}
    assert song.ends == 1
