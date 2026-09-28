"""BrowserProbe Places-tree tests (ROW 3 of 10-cleanup-plan.md).

Covers the scaffolding of the two new addresses — ``places_dump`` and
``places_load`` — against stub browsers that mimic the shape of
``Live.Browser.user_folders``. The real-API verdict comes from the
operator-driven run of ``owner/probes/places_probe_run.js`` on a live Ableton
session; these tests only lock in the handler behaviour.
"""

from __future__ import annotations

import logging

import pytest

from components.BrowserProbe import (
    BrowserProbe,
    PLACES_DUMP_ADDRESS,
    PLACES_DUMP_RESULT_ADDRESS,
    PLACES_LOAD_ADDRESS,
    PLACES_LOAD_RESULT_ADDRESS,
    PLACES_MAX_CHILDREN_PER_NODE,
    _collect_places_rows,
    _find_in_user_folders,
)


# --- stubs -----------------------------------------------------------------


class StubDevice:
    _next = 1000

    def __init__(self, name):
        self.name = name
        StubDevice._next += 1
        self._live_ptr = StubDevice._next


class StubTrack:
    def __init__(self, devices=None):
        self.devices = list(devices or ())

    def add_device(self, device):
        self.devices.append(device)


class StubView:
    def __init__(self, track):
        self.selected_track = track


class StubSong:
    def __init__(self, track):
        self.view = StubView(track)


class StubPlaceNode:
    """Tree node that mimics ``browser.user_folders`` leaves/nodes."""

    def __init__(self, name, children=None, is_loadable=False):
        self.name = name
        self.children = list(children or ())
        self.is_loadable = is_loadable


class PlacesBrowser:
    """Browser with a ``user_folders`` tree + ``load_item``.

    ``user_folders`` is iterable directly (matches the common Live
    shape); a separate test covers the ``.children``-wrapping variant.
    """

    def __init__(self, track, tops):
        self._track = track
        self.user_folders = list(tops)
        self.load_calls = []

    def load_item(self, item):
        self.load_calls.append(item)
        if "raise" in (item.name or ""):
            raise RuntimeError("simulated load error")
        if "silent" in (item.name or ""):
            return
        self._track.add_device(StubDevice("loaded(%s)" % item.name))


class BrowserMissingUserFolders:
    """Older Live build that doesn't expose user_folders at all."""

    def __init__(self, track):
        self._track = track


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def track():
    return StubTrack(devices=[StubDevice("existing")])


@pytest.fixture
def emits():
    return []


@pytest.fixture
def sync_schedule():
    return lambda delay_ms, fn: fn()


def _make_probe(browser, track, emits, schedule):
    return BrowserProbe(
        browser=browser,
        song=StubSong(track),
        emit=lambda addr, args: emits.append((addr, args)),
        schedule_delayed=schedule,
    )


# --- address constants -----------------------------------------------------


def test_places_address_constants_stable():
    assert PLACES_DUMP_ADDRESS == "/looping/probe/places_dump"
    assert PLACES_DUMP_RESULT_ADDRESS == "/looping/probe/places_dump_result"
    assert PLACES_LOAD_ADDRESS == "/looping/probe/places_load"
    assert PLACES_LOAD_RESULT_ADDRESS == "/looping/probe/places_load_result"


# --- places_dump -----------------------------------------------------------


def test_places_dump_missing_attr_emits_zero(track, emits, sync_schedule):
    probe = _make_probe(BrowserMissingUserFolders(track), track, emits, sync_schedule)
    probe.handle_places_dump((), None)
    assert len(emits) == 1
    addr, (exists, top_count, body, detail) = emits[0]
    assert addr == PLACES_DUMP_RESULT_ADDRESS
    assert exists == 0
    assert top_count == 0
    assert body == ""
    assert "no user_folders" in detail


def test_places_dump_empty_tree(track, emits, sync_schedule):
    browser = PlacesBrowser(track, tops=[])
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_places_dump((), None)
    _, (exists, top_count, body, detail) = emits[0]
    assert exists == 1
    assert top_count == 0
    assert body == ""
    assert detail == "ok"


def test_places_dump_encodes_tree(track, emits, sync_schedule):
    # Shape: one Place named "permute" with a single loadable
    # ``.amxd`` leaf inside — matches the user's actual sidebar.
    permute_leaf = StubPlaceNode("Permute.amxd", is_loadable=True)
    permute_place = StubPlaceNode("permute", children=[permute_leaf])
    samples_place = StubPlaceNode("samples", children=[])
    browser = PlacesBrowser(track, tops=[permute_place, samples_place])

    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_places_dump((), None)

    _, (exists, top_count, body, detail) = emits[0]
    assert exists == 1
    assert top_count == 2
    rows = body.split("\n")
    # Depth 0 entries for each Place, depth 1 for the leaf.
    assert "0\tpermute\t0" in rows
    assert "1\tPermute.amxd\t1" in rows
    assert "0\tsamples\t0" in rows


def test_places_dump_handles_iteration_error(track, emits, sync_schedule):
    class BrokenIter:
        @property
        def user_folders(self):
            raise RuntimeError("LOM said no")

    probe = _make_probe(BrokenIter(), track, emits, sync_schedule)
    probe.handle_places_dump((), None)
    _, (exists, top_count, body, detail) = emits[0]
    assert exists == 0
    assert "read_error" in detail


# --- places_load -----------------------------------------------------------


def test_places_load_missing_arg_noops(track, emits, sync_schedule, caplog):
    browser = PlacesBrowser(track, tops=[])
    probe = _make_probe(browser, track, emits, sync_schedule)
    with caplog.at_level(logging.WARNING, logger="looping"):
        probe.handle_places_load((), None)
    assert emits == []
    assert any("expected (hint,)" in m for m in caplog.messages)


def test_places_load_not_found(track, emits, sync_schedule):
    browser = PlacesBrowser(track, tops=[StubPlaceNode("permute", children=[])])
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_places_load(("MissingDevice.amxd",), None)
    assert len(emits) == 1
    addr, (ok, detail) = emits[0]
    assert addr == PLACES_LOAD_RESULT_ADDRESS
    assert ok == 0
    assert "not_found" in detail


def test_places_load_success_emits_ok(track, emits, sync_schedule):
    leaf = StubPlaceNode("Permute.amxd", is_loadable=True)
    browser = PlacesBrowser(
        track,
        tops=[StubPlaceNode("permute", children=[leaf])],
    )
    probe = _make_probe(browser, track, emits, sync_schedule)
    # Hint is a filesystem-shaped path; probe should match on tail.
    probe.handle_places_load(
        ("/Users/Shared/DevWork/GitHub/permute/Permute.amxd",), None,
    )
    assert len(emits) == 1
    addr, (ok, detail) = emits[0]
    assert addr == PLACES_LOAD_RESULT_ADDRESS
    assert ok == 1
    assert "added=1" in detail
    assert browser.load_calls == [leaf]


def test_places_load_silent_failure(track, emits, sync_schedule):
    leaf = StubPlaceNode("silent.amxd", is_loadable=True)
    browser = PlacesBrowser(track, tops=[StubPlaceNode("x", children=[leaf])])
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_places_load(("silent.amxd",), None)
    _, (ok, detail) = emits[0]
    assert ok == 0
    assert "chain_unchanged" in detail


def test_places_load_raises_emits_error(track, emits, sync_schedule):
    leaf = StubPlaceNode("raise.amxd", is_loadable=True)
    browser = PlacesBrowser(track, tops=[StubPlaceNode("x", children=[leaf])])
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_places_load(("raise.amxd",), None)
    _, (ok, detail) = emits[0]
    assert ok == 0
    assert "load_item raised" in detail


def test_places_load_no_selected_track(track, emits, sync_schedule):
    browser = PlacesBrowser(track, tops=[])
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe._song.view.selected_track = None
    probe.handle_places_load(("anything",), None)
    _, (ok, detail) = emits[0]
    assert ok == 0
    assert "no_selected_track" in detail


# --- helpers --------------------------------------------------------------


def test_collect_places_rows_depth_cap():
    # Build a chain 10 deep so the cap trips.
    deepest = StubPlaceNode("leaf10")
    node = deepest
    for i in range(9, 0, -1):
        node = StubPlaceNode("n%d" % i, children=[node])
    rows = []
    _collect_places_rows(node, depth=0, rows=rows)
    # At least one ``...`` marker row indicates the cap engaged.
    assert any("\t...\t0" in r for r in rows)


def test_collect_places_rows_children_cap():
    many = [StubPlaceNode("child%d" % i) for i in range(PLACES_MAX_CHILDREN_PER_NODE + 5)]
    top = StubPlaceNode("top", children=many)
    rows = []
    _collect_places_rows(top, depth=0, rows=rows)
    assert any("... (" in r and "more)" in r for r in rows)


def test_find_in_user_folders_returns_none_when_missing():
    assert _find_in_user_folders(object(), "anything") is None
