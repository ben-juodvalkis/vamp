"""BrowserProbe unit tests.

``Live.Browser`` only exists inside Live's embedded Python, so these
tests cannot call the real API. What they *can* cover is the probe's
scaffolding: argument parsing, the ``dir(browser)`` one-shot dump,
the device-chain snapshot + diff, and the three load-outcome shapes
the risk doc names (silent-success, silent-failure, exception).

The stub browser deliberately mimics two versions of Live's API at
once:

- ``LoadAtPathBrowser`` exposes ``load_item_at_path``, the method the
  spec names. The probe should prefer this branch when present.
- ``TraverseBrowser`` exposes only ``.children``-bearing tree roots
  and ``load_item``. The probe should fall back to traversal.

Both branches are tested against the same chain-diff logic so the
probe's verify pass is exercised end-to-end.
"""

from __future__ import annotations

import logging

import pytest

from components.BrowserProbe import (
    BrowserProbe,
    LOAD_ADDRESS,
    RESULT_ADDRESS,
    _chain_device_ids,
    _walk_for_name,
)


# --- stubs -----------------------------------------------------------------


class StubDevice:
    """Minimal LOM ``Device`` stand-in. Only needs an ``.id`` equivalent."""

    _next = 1

    def __init__(self, name):
        self.name = name
        # ``_live_ptr`` is what LOM actually exposes as the object id;
        # the probe coerces via ``int(...)``. An incrementing int
        # keeps chain-diff tests readable.
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


class StubBrowserItem:
    """Tree node. ``children`` may be empty for leaves."""

    def __init__(self, name, children=None):
        self.name = name
        self.children = list(children or ())


class LoadAtPathBrowser:
    """Browser that exposes ``load_item_at_path`` (spec-named path).

    The handler pushes a named device onto the selected track on
    success, raises on paths it doesn't know, and silently no-ops on
    the ``vst3`` sentinel to simulate the silent-failure case from
    [06 §1.2].
    """

    def __init__(self, track):
        self._track = track
        self.load_calls = []

    def load_item_at_path(self, path):
        self.load_calls.append(path)
        if "raise" in path:
            raise RuntimeError("simulated plugin load error")
        if "silent" in path:
            return  # VST3-style silent failure
        self._track.add_device(StubDevice("loaded(%s)" % path))


class TraverseBrowser:
    """Browser with no ``load_item_at_path`` — probe must traverse.

    Exposes the named trees the probe looks at (``sounds``,
    ``instruments``, etc.) plus ``load_item(item)``.
    """

    def __init__(self, track, tree):
        self._track = track
        # Attach the tree under a single root for the probe to find.
        self.instruments = tree
        self.load_calls = []

    def load_item(self, item):
        self.load_calls.append(item)
        if "raise" in (item.name or ""):
            raise RuntimeError("simulated load_item error")
        if "silent" in (item.name or ""):
            return
        self._track.add_device(StubDevice("loaded(%s)" % item.name))


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def track():
    # Start with one pre-existing device so chain-diff asserts only
    # catch the *new* arrival, not the initial state.
    return StubTrack(devices=[StubDevice("existing")])


@pytest.fixture
def emits():
    """Capture every ``(address, args)`` the probe emits."""
    recorded = []
    return recorded


@pytest.fixture
def sync_schedule():
    """Fire the scheduled callback synchronously so tests can assert inline.

    Real ``ControlSurface.schedule_message`` defers by ticks; tests
    don't need (or want) that temporal gap, and running the callback
    inline means pytest failures point directly at the probe logic
    rather than at a timing race.
    """
    return lambda delay_ms, fn: fn()


def _make_probe(browser, track, emits, schedule):
    return BrowserProbe(
        browser=browser,
        song=StubSong(track),
        emit=lambda addr, args: emits.append((addr, args)),
        schedule_delayed=schedule,
    )


# --- address constants -----------------------------------------------------


def test_address_constants_stable():
    # These strings are what the driver script (and any external
    # operator script) encodes. Freezing them in the test prevents
    # silent rename breakage.
    assert LOAD_ADDRESS == "/looping/probe/browser_load"
    assert RESULT_ADDRESS == "/looping/probe/browser_result"


# --- arg parsing / bad input ----------------------------------------------


def test_missing_args_logs_and_noops(track, emits, sync_schedule, caplog):
    probe = _make_probe(LoadAtPathBrowser(track), track, emits, sync_schedule)
    with caplog.at_level(logging.WARNING, logger="looping"):
        assert probe.handle_browser_load((), None) is None
        assert probe.handle_browser_load(("adv",), None) is None
    assert emits == []
    assert any("expected (asset_class, hint)" in m for m in caplog.messages)


def test_no_selected_track_emits_failure(track, emits, sync_schedule):
    probe = _make_probe(LoadAtPathBrowser(track), track, emits, sync_schedule)
    # Blow away selection to simulate "user has no track focused".
    probe._song.view.selected_track = None
    probe.handle_browser_load(("adv", "irrelevant.adv"), None)
    assert len(emits) == 1
    addr, args = emits[0]
    assert addr == RESULT_ADDRESS
    assert args[0] == "adv"
    assert args[1] == 0  # ok=False
    assert "no_selected_track" in args[2]


# --- load_item_at_path branch ---------------------------------------------


def test_load_at_path_success_emits_ok(track, emits, sync_schedule):
    probe = _make_probe(LoadAtPathBrowser(track), track, emits, sync_schedule)
    probe.handle_browser_load(("adv", "/path/to/Preset.adv"), None)
    assert len(emits) == 1
    addr, (asset_class, ok, detail) = emits[0]
    assert addr == RESULT_ADDRESS
    assert asset_class == "adv"
    assert ok == 1
    assert "load_item_at_path" in detail
    assert "added=1" in detail


def test_load_at_path_silent_failure_emits_unchanged(track, emits, sync_schedule):
    # This is the VST3 scenario [06 §1.2] calls out: ``load_item``
    # returns cleanly but nothing lands on the chain. The probe must
    # distinguish this from a hard exception.
    probe = _make_probe(LoadAtPathBrowser(track), track, emits, sync_schedule)
    probe.handle_browser_load(("vst3", "/path/to/silent-plugin.vst3"), None)
    assert len(emits) == 1
    addr, (asset_class, ok, detail) = emits[0]
    assert ok == 0
    assert "chain_unchanged" in detail


def test_load_at_path_raises_emits_error(track, emits, sync_schedule):
    probe = _make_probe(LoadAtPathBrowser(track), track, emits, sync_schedule)
    probe.handle_browser_load(("au", "/path/to/raise-plugin.component"), None)
    assert len(emits) == 1
    _, (asset_class, ok, detail) = emits[0]
    assert ok == 0
    # The error-branch detail carries the Live-side exception message
    # so the operator can see *why* the load failed without needing
    # to fish it out of Log.txt manually.
    assert "simulated plugin load error" in detail


# --- traversal branch ------------------------------------------------------


def test_traverse_branch_used_when_load_at_path_missing(track, emits, sync_schedule):
    # Build a shallow tree with a matching leaf named "Operator".
    tree = StubBrowserItem(
        "instruments-root",
        children=[
            StubBrowserItem("Synths", children=[
                StubBrowserItem("Analog", children=[]),
                StubBrowserItem("Operator", children=[]),
            ]),
        ],
    )
    browser = TraverseBrowser(track, tree)
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_browser_load(("native", "Operator"), None)
    assert len(emits) == 1
    _, (_, ok, detail) = emits[0]
    assert ok == 1
    assert "load_item" in detail
    # Traversal actually found and called load_item with the matching node.
    assert len(browser.load_calls) == 1
    assert browser.load_calls[0].name == "Operator"


def test_traverse_branch_not_found_emits_error(track, emits, sync_schedule):
    tree = StubBrowserItem("instruments-root", children=[
        StubBrowserItem("Synths", children=[StubBrowserItem("Analog", [])]),
    ])
    browser = TraverseBrowser(track, tree)
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_browser_load(("native", "NotAThing"), None)
    assert len(emits) == 1
    _, (_, ok, detail) = emits[0]
    assert ok == 0
    assert "not_found" in detail


def test_traverse_tail_matches_on_filename(track, emits, sync_schedule):
    # The driver often passes a full path for User Library assets;
    # the probe must match on the last path component.
    tree = StubBrowserItem("user-library-root", children=[
        StubBrowserItem("Looping Presets", children=[
            StubBrowserItem("Effect Patches", children=[
                StubBrowserItem("AutoPanLegacy.adv", children=[]),
            ]),
        ]),
    ])
    browser = TraverseBrowser(track, tree)
    probe = _make_probe(browser, track, emits, sync_schedule)
    probe.handle_browser_load(
        ("adv", "/abs/path/Looping Presets/Effect Patches/AutoPanLegacy.adv"),
        None,
    )
    assert emits[0][1][1] == 1


# --- dir() one-shot dump --------------------------------------------------


def test_dir_dumped_once_across_calls(track, emits, sync_schedule, caplog):
    # We can't interrogate the real browser's dir() from pytest, but
    # we *can* verify the probe only logs it on the first call. A
    # second identical call should not produce a second dir line —
    # six back-to-back driver invocations would flood Log.txt
    # otherwise.
    probe = _make_probe(LoadAtPathBrowser(track), track, emits, sync_schedule)
    with caplog.at_level(logging.INFO, logger="looping"):
        probe.handle_browser_load(("adv", "/p/a.adv"), None)
        probe.handle_browser_load(("adv", "/p/b.adv"), None)
    dir_lines = [m for m in caplog.messages if "dir(browser)" in m]
    assert len(dir_lines) == 1


# --- helpers ---------------------------------------------------------------


def test_chain_device_ids_tuple_of_ints():
    track = StubTrack(devices=[StubDevice("a"), StubDevice("b")])
    ids = _chain_device_ids(track)
    assert isinstance(ids, tuple)
    assert all(isinstance(i, int) for i in ids)
    assert len(ids) == 2
    assert ids[0] != ids[1]


def test_walk_for_name_matches_on_stem_when_extension_stripped():
    # The ``.amxd`` case from the first live run: target is
    # ``Audio Interface Detectors.amxd``, Browser shows
    # ``Audio Interface Detectors`` (extension stripped for display
    # under ``max_for_live``). Probe should still find it.
    leaf = StubBrowserItem("Audio Interface Detectors", [])
    root = StubBrowserItem("max-for-live-root", [leaf])
    assert _walk_for_name(root, "Audio Interface Detectors.amxd") is leaf


def test_walk_for_name_matches_when_target_is_stem():
    # Reverse case: target passed without extension, Browser leaf
    # shows extension intact. Rare but trivially free to cover.
    leaf = StubBrowserItem("Preset.adv", [])
    root = StubBrowserItem("root", [leaf])
    assert _walk_for_name(root, "Preset") is leaf


def test_walk_for_name_respects_max_depth():
    # Build a chain deeper than max_depth to make sure we truncate
    # rather than descend forever. 10 levels > default 8.
    leaf = StubBrowserItem("deep", [])
    node = leaf
    for i in range(10):
        node = StubBrowserItem("layer-%d" % i, [node])
    assert _walk_for_name(node, "deep", max_depth=8) is None
    assert _walk_for_name(node, "deep", max_depth=20) is leaf
