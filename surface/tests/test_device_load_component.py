"""DeviceLoadComponent unit tests — pr6-2 skeleton through pr6-6 matrix.

Covers:

- pr6-2 — ``handle_load`` arg-count validation; ``disconnect``
  idempotence + silencing.
- pr6-3 — ``trackPath`` resolution (explicit + §3.2.1 empty-path →
  ``song.view.selected_track`` compat shim); ``devicePath`` shape
  validation + bounds-check against the resolved track's device
  chain; ``master/devices/<M>`` shape. Every error path emits
  exactly one ``/looping/v3/error`` with the right code + detail.
- pr6-4 — empty ``presetPath`` rejected; successful load descends
  ``browser.user_library`` by filesystem segments and invokes
  ``browser.load_item(item)`` exactly once on the resolved leaf;
  ``song.view.selected_track`` is set to the resolved track; each
  of the three ``_LOM_ERRORS`` classes (``RuntimeError``,
  ``AttributeError``, ``TypeError`` simulating
  ``Boost.Python.ArgumentError``) surfaces as ``load-failed``.
- pr6-6 — preset-class sweep across PR-6Pre's mix
  (`.adv` / native-`.adg` / plugin-`.adg` / `.aupreset`); auto-load
  internal-call path (no wire trip, mirrors pr6-8's outlet-0
  retarget shape `[trackPath, "", presetPath]`); order-of-operations
  guarantees around selection + append-devicePath co-use.
"""

from __future__ import annotations

import os
import tempfile
from typing import Dict, List, Optional, Tuple

import pytest

from components.DeviceLoadComponent import (
    DeviceLoadComponent,
    V3_DEVICE_LOAD_ADDRESS,
    V3_ERROR_ADDRESS,
    V3_ERROR_DEVICE_SLOT_INVALID,
    V3_ERROR_LOAD_FAILED,
    V3_ERROR_TRACK_NOT_FOUND,
)


# --- stubs ----------------------------------------------------------------


# A synthetic User Library root used by every test. Paths live under
# this prefix and must be materialized on disk (os.path.isfile gate)
# before being handed to the component.
USER_LIBRARY_BASE = None  # set by the ``user_library_tmp`` fixture


class StubBrowserItem:
    """Minimal ``BrowserItem`` — name + children + is_loadable."""

    def __init__(self, name, is_loadable=False, children=None):
        self.name = name
        self.is_loadable = is_loadable
        self.children = list(children or ())


class StubBrowser:
    """Browser stub exposing ``user_library`` + ``load_item``.

    Mirrors the real Live 12.3.7 ``Browser`` proxy: the only loader
    is ``load_item(BrowserItem)``; preset lookup is a tree descent
    from ``browser.user_library`` by child ``name``.

    ROW 4: optionally exposes ``user_folders`` — a list of
    ``BrowserItem``-shaped top-level Places.
    """

    def __init__(self, user_library=None, user_folders=None):
        self.user_library = user_library or StubBrowserItem("User Library")
        if user_folders is not None:
            self.user_folders = list(user_folders)
        self.calls: List[str] = []

    def load_item(self, item):  # noqa: D401
        self.calls.append(item.name)


def _make_user_library_tree(segments_by_leaf: Dict[str, Tuple[str, ...]]):
    """Build a ``StubBrowserItem`` tree from a ``{leaf: segments}`` map.

    The key is the loadable leaf name (e.g. ``preset.adv``); the value
    is the tuple of ancestor names descending from ``user_library``
    (exclusive) down to and including the leaf. Intermediate nodes
    are shared by reference when multiple leaves live under the same
    parent.
    """
    root = StubBrowserItem("User Library")
    for segments in segments_by_leaf.values():
        node = root
        for i, segment in enumerate(segments):
            is_leaf = i == len(segments) - 1
            existing = next(
                (c for c in node.children if c.name == segment), None,
            )
            if existing is None:
                existing = StubBrowserItem(
                    segment, is_loadable=is_leaf,
                )
                node.children.append(existing)
            node = existing
    return root


class LegacyBrowser:
    """Browser stub missing ``user_library`` entirely."""

    def load_item(self, item):
        raise AttributeError("legacy browser has no user_library")


class StubTrack:
    """Track with a fixed device list; no listeners needed for this row."""

    def __init__(self, devices: Optional[List[object]] = None):
        self.devices = list(devices or [])
        # Used by pr6-3's bounds-check guard — some tests flip to True
        # to exercise the _LOM_ERRORS branch around ``len(track.devices)``.
        self._raise_on_devices_read = False

    def __getattribute__(self, name):
        # When ``_raise_on_devices_read`` is flipped, simulate Live's
        # torn-down-wrapper RuntimeError for the ``devices`` attr.
        if name == "devices":
            raise_flag = object.__getattribute__(
                self, "_raise_on_devices_read",
            )
            if raise_flag:
                raise RuntimeError("LOM: torn-down track")
        return object.__getattribute__(self, name)


class StubSongView:
    """song.view stub — exposes ``selected_track`` only."""

    def __init__(self, selected_track=None):
        self.selected_track = selected_track


class StubSong:
    """Song stub with ``tracks``, ``master_track``, and ``view.selected_track``.

    Wide enough to satisfy ``path_resolver.resolve_track`` (reads
    ``song.tracks`` + ``song.master_track``) plus the empty-trackPath
    §3.2.1 compat shim (reads ``song.view.selected_track``).
    """

    def __init__(
        self,
        tracks: Optional[List[StubTrack]] = None,
        master_track: Optional[StubTrack] = None,
        selected_track=None,
    ):
        self._tracks = list(tracks or [])
        self.master_track = master_track
        self.view = StubSongView(selected_track=selected_track)

    @property
    def tracks(self):
        return list(self._tracks)


class EmitRecorder:
    """Captures ``(address, args)`` tuples emitted by the component."""

    def __init__(self):
        self.emissions: List[Tuple[str, tuple]] = []

    def __call__(self, address: str, args) -> None:
        self.emissions.append((address, tuple(args)))

    def only(self, address: str) -> List[tuple]:
        return [payload for addr, payload in self.emissions if addr == address]

    def errors(self) -> List[tuple]:
        return self.only(V3_ERROR_ADDRESS)


# --- fixtures --------------------------------------------------------------


# The canonical preset path every test uses unless otherwise noted.
# Layout under USER_LIBRARY_BASE: ``Looping Presets/Instruments/preset.adv``
_PRESET_SEGMENTS = ("Looping Presets", "Instruments", "preset.adv")


@pytest.fixture
def user_library_base(tmp_path):
    """Real on-disk User Library root + materialized preset file.

    The component's ``os.path.isfile`` gate requires actual files —
    every test path that points at a preset is created here so the
    gate passes. Other tests that want the gate to fail pass a path
    that was never materialized.
    """
    base = tmp_path / "UserLibrary"
    leaf = base.joinpath(*_PRESET_SEGMENTS)
    leaf.parent.mkdir(parents=True, exist_ok=True)
    leaf.write_bytes(b"")
    return str(base)


@pytest.fixture
def preset_path(user_library_base):
    return os.path.join(user_library_base, *_PRESET_SEGMENTS)


@pytest.fixture
def recorder() -> EmitRecorder:
    return EmitRecorder()


@pytest.fixture
def browser() -> StubBrowser:
    """Browser whose ``user_library`` tree mirrors ``_PRESET_SEGMENTS``."""
    tree = _make_user_library_tree({"preset": _PRESET_SEGMENTS})
    return StubBrowser(user_library=tree)


@pytest.fixture
def tracks() -> List[StubTrack]:
    # Two regular tracks; track 0 has two devices so bounds-check
    # scenarios can exercise legal / append / out-of-range indices.
    return [
        StubTrack(devices=[object(), object()]),
        StubTrack(devices=[]),
    ]


@pytest.fixture
def master_track() -> StubTrack:
    return StubTrack(devices=[object()])


@pytest.fixture
def song(tracks, master_track) -> StubSong:
    return StubSong(
        tracks=tracks,
        master_track=master_track,
        selected_track=tracks[0],
    )


@pytest.fixture
def component(song, browser, recorder, user_library_base) -> DeviceLoadComponent:
    c = DeviceLoadComponent(
        song=song, browser=browser, emit=recorder,
        user_library_base=user_library_base,
    )
    yield c
    c.disconnect()


# --- __init__ + browser-tree resolution -----------------------------------


def test_init_accepts_any_browser(song, recorder, user_library_base):
    """Init is stateless — it records its deps and does nothing else."""
    c = DeviceLoadComponent(
        song=song, browser=LegacyBrowser(), emit=recorder,
        user_library_base=user_library_base,
    )
    try:
        assert c is not None
    finally:
        c.disconnect()


def test_path_outside_user_library_base_errors(
    component, browser, recorder,
):
    """Paths outside ``user_library_base`` → ``load-failed / not-in-browser``.

    ``os.path.isfile`` passes (file exists); the descent-prefix check
    rejects because the hint is not under the configured base.
    """
    with tempfile.NamedTemporaryFile(suffix=".adv", delete=False) as f:
        outside_path = f.name
    try:
        component.handle_load(
            args=("tracks/0", "", outside_path), source_addr=None,
        )
    finally:
        os.unlink(outside_path)
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert path == outside_path
    assert detail == "not-in-browser"
    assert browser.calls == []


def test_path_not_on_disk_errors(component, browser, recorder):
    """Non-existent path → ``load-failed / path-not-found`` (no walker call)."""
    component.handle_load(
        args=("tracks/0", "", "/tmp/does-not-exist-NONCE.adv"),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert detail == "path-not-found"
    assert browser.calls == []


def test_path_on_disk_but_not_in_browser_tree_errors(
    song, recorder, tmp_path,
):
    """File exists under base but the browser tree doesn't have it.

    This is the "stale catalog" case — UI knows about a preset the
    browser doesn't expose yet (maybe indexing lagged, or the file
    was added after surface init). Must surface ``not-in-browser``.
    """
    base = tmp_path / "UserLibrary"
    leaf = base / "Orphan" / "uncatalogued.adv"
    leaf.parent.mkdir(parents=True, exist_ok=True)
    leaf.write_bytes(b"")

    browser = StubBrowser(
        user_library=_make_user_library_tree(
            {"other": ("Other", "other.adv")},
        ),
    )
    c = DeviceLoadComponent(
        song=song, browser=browser, emit=recorder,
        user_library_base=str(base),
    )
    try:
        c.handle_load(
            args=("tracks/0", "", str(leaf)), source_addr=None,
        )
    finally:
        c.disconnect()
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert detail == "not-in-browser"
    assert browser.calls == []


# --- handle_load arg-count validation -------------------------------------


def test_handle_load_rejects_zero_args(component, recorder):
    component.handle_load(args=(), source_addr=None)
    errs = recorder.errors()
    assert len(errs) == 1
    address, code, path, detail = errs[0]
    assert address == V3_DEVICE_LOAD_ADDRESS
    assert code == V3_ERROR_LOAD_FAILED
    assert path == ""
    assert "expected 3" in detail
    assert "got 0" in detail


def test_handle_load_rejects_one_arg(component, recorder):
    component.handle_load(args=("tracks/0",), source_addr=None)
    errs = recorder.errors()
    assert len(errs) == 1
    _address, code, _path, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert "got 1" in detail


def test_handle_load_rejects_two_args(component, recorder):
    component.handle_load(
        args=("tracks/0", ""), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert "got 2" in detail


def test_handle_load_rejects_four_args(component, recorder, preset_path):
    component.handle_load(
        args=("tracks/0", "", preset_path, "extra"),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert "got 4" in detail


# --- trackPath resolution -------------------------------------------------


def test_tracks_n_happy_path_emits_nothing(
    component, browser, recorder, preset_path,
):
    component.handle_load(
        args=("tracks/0", "", preset_path), source_addr=None,
    )
    assert recorder.emissions == []
    # Browser invoked with the resolved leaf item (name == filename).
    assert browser.calls == ["preset.adv"]


def test_master_happy_path_emits_nothing(
    component, browser, recorder, preset_path,
):
    component.handle_load(
        args=("master", "", preset_path), source_addr=None,
    )
    assert recorder.emissions == []
    assert browser.calls == ["preset.adv"]


def test_empty_track_path_rejected(
    component, browser, recorder, preset_path,
):
    """Empty ``trackPath`` → ``track-not-found / empty-path`` (2026-04-26).

    The pre-2026-04-26 behaviour fell back to ``song.view.selected_track``
    when ``trackPath`` was empty. That fallback caused instrument loads
    to land on the previously-selected (occupied) track during the
    ``/looping/v3/selected_track`` echo lag — the catastrophic
    "wrong-track load" bug. Loads now require an explicit, valid
    ``trackPath``; the bug is structurally impossible.
    """
    component.handle_load(
        args=("", "", preset_path), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    address, code, path, detail = errs[0]
    assert address == V3_DEVICE_LOAD_ADDRESS
    assert code == V3_ERROR_TRACK_NOT_FOUND
    assert path == ""
    assert detail == "empty-path"
    assert browser.calls == []


def test_malformed_track_path_errors(component, recorder, preset_path):
    component.handle_load(
        args=("xyzzy", "", preset_path), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_TRACK_NOT_FOUND
    assert path == "xyzzy"
    assert detail == "malformed-path"


def test_not_found_track_path_errors(component, recorder, preset_path):
    """Grammar-valid but index out of range → track-not-found."""
    component.handle_load(
        args=("tracks/99", "", preset_path), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_TRACK_NOT_FOUND
    assert path == "tracks/99"
    assert detail == ""


def test_returns_track_path_maps_to_track_not_found(
    component, recorder, preset_path,
):
    """``returns/<N>`` is grammar-valid but NOT_SUPPORTED — map to
    ``track-not-found`` with detail ``"not-supported"`` per §3.5 (no
    separate ``path-not-supported`` wire code on this handler).
    """
    component.handle_load(
        args=("returns/0", "", preset_path), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_TRACK_NOT_FOUND
    assert path == "returns/0"
    assert detail == "not-supported"


# --- devicePath validation ------------------------------------------------


def test_device_path_shape_mismatch_errors(component, recorder, preset_path):
    """``tracks/0/slots/0`` is not a deviceRef — reject as shape."""
    component.handle_load(
        args=("tracks/0", "tracks/0/slots/0", preset_path),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert path == "tracks/0/slots/0"
    assert detail == "shape"


def test_device_path_wrong_segment_count_errors(
    component, recorder, preset_path,
):
    component.handle_load(
        args=("tracks/0", "tracks/0/devices", preset_path),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert detail == "shape"


def test_device_path_out_of_range_errors(component, recorder, preset_path):
    """Track 0 has 2 devices → index 99 is strictly out of range."""
    component.handle_load(
        args=("tracks/0", "tracks/0/devices/99", preset_path),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert path == "tracks/0/devices/99"
    assert detail == "99"


def test_device_path_append_index_accepted(component, recorder, preset_path):
    """Append position: ``<M> == len(track.devices)`` is legal."""
    component.handle_load(
        args=("tracks/0", "tracks/0/devices/2", preset_path),
        source_addr=None,
    )
    assert recorder.emissions == []


def test_device_path_non_digit_index_errors(component, recorder, preset_path):
    component.handle_load(
        args=("tracks/0", "tracks/0/devices/x", preset_path),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert detail == "x"


def test_device_path_master_shape_accepted(component, recorder, preset_path):
    """``master/devices/<M>`` is a valid shape (design §3.3)."""
    component.handle_load(
        args=("master", "master/devices/0", preset_path),
        source_addr=None,
    )
    assert recorder.emissions == []


def test_device_path_master_out_of_range_errors(
    component, recorder, preset_path,
):
    component.handle_load(
        args=("master", "master/devices/5", preset_path),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, path, detail = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert path == "master/devices/5"
    assert detail == "5"


def test_device_path_read_error_surfaces_slot_invalid(
    component, tracks, recorder, preset_path,
):
    """Torn-down track wrapper: ``len(track.devices)`` raises
    ``RuntimeError`` — caught by ``_LOM_ERRORS``, emitted as
    ``device-slot-invalid`` with ``devices-read-failed``.
    """
    tracks[0]._raise_on_devices_read = True
    component.handle_load(
        args=("tracks/0", "tracks/0/devices/0", preset_path),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert detail == "devices-read-failed"


# --- pr6-4: load call + exception mapping ---------------------------------


def test_empty_preset_path_errors_and_never_touches_browser(
    component, browser, song, recorder,
):
    """Empty ``presetPath`` → ``load-failed`` / ``empty-preset-path``.

    Rejected BEFORE track resolution and selection assignment so a
    hopeless call can't shift the user's selected track. Browser
    must never be invoked; ``song.view.selected_track`` must stay at
    the fixture default (tracks[0]).
    """
    original_selection = song.view.selected_track
    component.handle_load(
        args=("tracks/1", "", ""), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    address, code, path, detail = errs[0]
    assert address == V3_DEVICE_LOAD_ADDRESS
    assert code == V3_ERROR_LOAD_FAILED
    assert path == ""
    assert detail == "empty-preset-path"
    assert browser.calls == []
    assert song.view.selected_track is original_selection


def test_happy_path_invokes_browser_once_with_resolved_item(
    component, browser, recorder, preset_path,
):
    component.handle_load(
        args=("tracks/0", "", preset_path),
        source_addr=None,
    )
    assert recorder.emissions == []
    assert browser.calls == ["preset.adv"]


def test_happy_path_sets_selected_track_to_resolved_track(
    component, browser, song, tracks, recorder, preset_path,
):
    """Design §3.4: target track becomes selection before load."""
    # Fixture starts with tracks[0] selected; load onto tracks[1].
    component.handle_load(
        args=("tracks/1", "", preset_path),
        source_addr=None,
    )
    assert recorder.emissions == []
    assert song.view.selected_track is tracks[1]
    assert browser.calls == ["preset.adv"]


def test_master_path_sets_selection_to_master_track(
    component, browser, song, master_track, recorder, preset_path,
):
    component.handle_load(
        args=("master", "", preset_path),
        source_addr=None,
    )
    assert recorder.emissions == []
    assert song.view.selected_track is master_track


class _RaisingBrowser:
    """Browser whose ``load_item`` raises a configurable exception.

    Mirrors the real ``Browser`` proxy (12.3.7+): ``user_library``
    tree is resolved normally via ``_resolve_browser_item``, and the
    final ``load_item(item)`` is where the exception surfaces. A
    prebuilt tree mirroring ``_PRESET_SEGMENTS`` makes the descent
    succeed so the handler actually reaches the ``try/except`` block
    the test is exercising.
    """

    def __init__(self, exc: BaseException):
        self._exc = exc
        self.calls: list = []
        self.user_library = _make_user_library_tree(
            {"preset": _PRESET_SEGMENTS},
        )

    def load_item(self, item):
        self.calls.append(item.name)
        raise self._exc


@pytest.mark.parametrize(
    "exc,cls_name",
    [
        (RuntimeError("lom torn-down"), "RuntimeError"),
        (AttributeError("missing attr"), "AttributeError"),
        # ``Boost.Python.ArgumentError`` is a ``TypeError`` subclass;
        # using a plain ``TypeError`` is sufficient coverage for the
        # ``_LOM_ERRORS`` guard per CLAUDE.md merge-gate rule (9).
        (TypeError("Boost.Python.ArgumentError shape"), "TypeError"),
    ],
)
def test_lom_errors_map_to_load_failed(
    song, recorder, exc, cls_name, preset_path, user_library_base,
):
    raising = _RaisingBrowser(exc)
    c = DeviceLoadComponent(
        song=song, browser=raising, emit=recorder,
        user_library_base=user_library_base,
    )
    try:
        c.handle_load(
            args=("tracks/0", "", preset_path),
            source_addr=None,
        )
    finally:
        c.disconnect()
    errs = recorder.errors()
    assert len(errs) == 1
    address, code, path, detail = errs[0]
    assert address == V3_DEVICE_LOAD_ADDRESS
    assert code == V3_ERROR_LOAD_FAILED
    assert path == preset_path
    assert detail.startswith(cls_name + ":")
    # The browser was invoked exactly once with the resolved leaf
    # item before raising — the ``try`` block reached the load call.
    assert raising.calls == ["preset.adv"]


def test_load_failed_detail_truncates_long_messages(
    song, recorder, preset_path, user_library_base,
):
    """``detail`` caps the exception message at 120 chars (design §3.5)."""
    long_msg = "x" * 500
    raising = _RaisingBrowser(RuntimeError(long_msg))
    c = DeviceLoadComponent(
        song=song, browser=raising, emit=recorder,
        user_library_base=user_library_base,
    )
    try:
        c.handle_load(
            args=("tracks/0", "", preset_path),
            source_addr=None,
        )
    finally:
        c.disconnect()
    errs = recorder.errors()
    assert len(errs) == 1
    _, _, _, detail = errs[0]
    # "RuntimeError: " prefix (14 chars) + 120 message chars = 134.
    assert len(detail) == len("RuntimeError: ") + 120
    assert detail.startswith("RuntimeError: ")


def test_selection_assignment_failure_maps_to_load_failed(
    song, browser, recorder, preset_path, user_library_base,
):
    """Torn-down ``song.view`` wrapper: selected_track setter raises.

    Design §3.4 selection assignment is inside the same ``try`` as
    the load call; a failure there must still surface as
    ``load-failed`` and prevent the browser invocation.
    """

    class ExplodingView:
        @property
        def selected_track(self):
            return None

        @selected_track.setter
        def selected_track(self, value):
            raise RuntimeError("LOM: torn-down view wrapper")

    song.view = ExplodingView()
    c = DeviceLoadComponent(
        song=song, browser=browser, emit=recorder,
        user_library_base=user_library_base,
    )
    try:
        c.handle_load(
            args=("tracks/0", "", preset_path),
            source_addr=None,
        )
    finally:
        c.disconnect()
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert detail.startswith("RuntimeError:")
    # Load never fires because the selection setter blew up first.
    assert browser.calls == []


# --- disconnect -----------------------------------------------------------


def test_disconnect_is_idempotent(component):
    component.disconnect()
    component.disconnect()  # must not raise


def test_disconnect_silences_subsequent_handle_load(component, recorder):
    component.disconnect()
    component.handle_load(args=(), source_addr=None)
    assert recorder.errors() == []


# --- pr6-6: preset-class sweep --------------------------------------------

# One ``(label, segments)`` entry per Live preset class the surface is
# expected to handle. Each entry becomes a real file on disk under the
# tmp User Library root plus a matching ``StubBrowserItem`` tree leaf,
# so the descent resolver hits the same ``is_loadable`` leaf the UI
# would point at. The component does not branch on extension; the
# sweep asserts round-trip invariance: whatever the UI sends, the
# descent walks it, and the browser stub sees exactly one
# ``load_item(<leaf>)`` call.
_PRESET_CLASSES = [
    # (label, segments)
    ("native-adv",
     ("Factory Packs", "Core Library", "Samples", "Bell Plate Long.adv")),
    ("native-adg",
     ("Factory Packs", "Core Library", "Instruments", "Crotales.adg")),
    ("plugin-adg",
     ("Presets", "Instruments", "Rack", "BBCorts 01.adg")),
    ("aupreset-1",
     ("Presets", "Instruments", "AudioUnit", "Big Boomer Atmo.aupreset")),
    ("aupreset-2",
     ("Presets", "Instruments", "AudioUnit",
      "Acoustic - Ennio's New Sheriff.aupreset")),
    ("plugin-adv",
     ("Presets", "Instruments", "Beads in the Bowls.aupreset")),
]


@pytest.fixture
def sweep_fixture(song, recorder, tmp_path):
    """Materialize every ``_PRESET_CLASSES`` leaf on disk + in the tree.

    Returns ``(component, browser, base, entries)`` where ``entries``
    is ``[(label, full_path, leaf_name), ...]`` in the same order as
    ``_PRESET_CLASSES``. Tests parametrized over classes pick one
    entry by label; the sequential test walks every entry in order.
    """
    base = tmp_path / "UserLibrary"
    entries = []
    segments_map = {}
    for label, segments in _PRESET_CLASSES:
        leaf_path = base.joinpath(*segments)
        leaf_path.parent.mkdir(parents=True, exist_ok=True)
        leaf_path.write_bytes(b"")
        segments_map[label] = segments
        entries.append((label, str(leaf_path), segments[-1]))
    tree = _make_user_library_tree(segments_map)
    browser = StubBrowser(user_library=tree)
    component = DeviceLoadComponent(
        song=song, browser=browser, emit=recorder,
        user_library_base=str(base),
    )
    yield component, browser, str(base), entries
    component.disconnect()


@pytest.mark.parametrize(
    "label",
    [label for label, _ in _PRESET_CLASSES],
)
def test_preset_class_round_trips_cleanly(sweep_fixture, recorder, label):
    """Every preset class in PR-6Pre's mix resolves + loads cleanly.

    The stub records the leaf ``BrowserItem.name`` the handler passed
    to ``browser.load_item``; no coercion, no rewrite, no extension-
    based branching. If a future regression ever routed by extension
    this sweep would catch it.
    """
    component, browser, _base, entries = sweep_fixture
    match = next(entry for entry in entries if entry[0] == label)
    _, full_path, leaf_name = match
    component.handle_load(
        args=("tracks/0", "", full_path), source_addr=None,
    )
    assert recorder.emissions == []
    assert browser.calls == [leaf_name]


def test_preset_class_sweep_sequential_on_one_component(
    sweep_fixture, recorder,
):
    """Back-to-back loads across classes accumulate cleanly.

    Guards against latent state between calls (the component is
    stateless by design — this pins it). Loading every preset class
    in a row on the same component must invoke the browser exactly
    once per call with the resolved leaf name, no errors.
    """
    component, browser, _base, entries = sweep_fixture
    leaf_names = []
    for _label, full_path, leaf_name in entries:
        component.handle_load(
            args=("tracks/0", "", full_path), source_addr=None,
        )
        leaf_names.append(leaf_name)
    assert recorder.emissions == []
    assert browser.calls == leaf_names


# --- pr6-6: auto-load internal-call path ----------------------------------

# pr6-8 retargets M4L's outlet-1 ``/looping/devices/addfile`` auto-load
# triggers to outlet-0 ``/looping/v3/device/load`` with the shape
# ``(trackPath, "", presetPath)`` — same handler, no special-case.
# These tests pin that the handler treats an "auto-load" call
# indistinguishably from a UI-driven call: same arg tuple, same side
# effects, same silent-success contract.


def test_auto_load_shape_invokes_same_handler_path(
    component, browser, song, tracks, recorder, preset_path,
):
    """Auto-load outlet-0 shape lands on the same code path.

    Mirrors the pr6-8 retarget: M4L emits
    ``(trackPath, "", presetPath)`` on outlet 0 via the v3 address;
    the Python handler processes it exactly like a UI sender would.
    """
    # Simulates M4L auto-loading a preset onto a freshly-created track.
    component.handle_load(
        args=("tracks/1", "", preset_path),
        source_addr=None,
    )
    assert recorder.emissions == []
    assert browser.calls == ["preset.adv"]
    # Selection shift is visible — same as UI-driven loads (§3.4).
    assert song.view.selected_track is tracks[1]


def test_auto_load_then_ui_load_share_component_state(
    song, recorder, tmp_path, tracks, master_track,
):
    """Auto-load followed by a UI load: no shared-state interference.

    The component holds no per-call state, so an auto-load on
    track 1 followed by a UI load on track 0 must both land cleanly
    with the correct selection at the end.
    """
    base = tmp_path / "UserLibrary"
    first_segments = ("Auto", "autoloaded.adg")
    second_segments = ("Tap", "user-tap.aupreset")
    for segs in (first_segments, second_segments):
        leaf = base.joinpath(*segs)
        leaf.parent.mkdir(parents=True, exist_ok=True)
        leaf.write_bytes(b"")
    tree = _make_user_library_tree(
        {"first": first_segments, "second": second_segments},
    )
    browser = StubBrowser(user_library=tree)
    c = DeviceLoadComponent(
        song=song, browser=browser, emit=recorder,
        user_library_base=str(base),
    )
    try:
        c.handle_load(
            args=(
                "tracks/1", "", str(base.joinpath(*first_segments)),
            ),
            source_addr=None,
        )
        c.handle_load(
            args=(
                "tracks/0", "", str(base.joinpath(*second_segments)),
            ),
            source_addr=None,
        )
    finally:
        c.disconnect()
    assert recorder.emissions == []
    assert browser.calls == [
        "autoloaded.adg",
        "user-tap.aupreset",
    ]
    assert song.view.selected_track is tracks[0]


def test_auto_load_on_empty_track_with_append_device_path(
    component, browser, song, tracks, recorder, preset_path,
):
    """Auto-load with explicit append devicePath.

    A future caller (e.g. M4L's track-creation flow once it carries
    a device index) might send an explicit ``tracks/<N>/devices/<M>``
    at the append position. Track 1 is empty in the fixture, so
    ``devices/0`` is the append slot — must succeed.
    """
    component.handle_load(
        args=(
            "tracks/1",
            "tracks/1/devices/0",
            preset_path,
        ),
        source_addr=None,
    )
    assert recorder.emissions == []
    assert browser.calls == ["preset.adv"]
    assert song.view.selected_track is tracks[1]


# --- pr6-6: order-of-operations pins --------------------------------------


def test_empty_preset_path_rejected_before_track_resolution(
    component, browser, song, recorder,
):
    """Empty ``presetPath`` short-circuits before track resolution.

    A bad trackPath combined with an empty presetPath must surface
    the presetPath error (``load-failed`` / ``empty-preset-path``),
    not the trackPath error — presetPath check runs first per
    ``handle_load``'s step order. This protects against a hopeless
    call accidentally flagging the wrong diagnostic to the UI.
    """
    original_selection = song.view.selected_track
    component.handle_load(
        args=("tracks/99", "", ""), source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, detail = errs[0]
    assert code == V3_ERROR_LOAD_FAILED
    assert detail == "empty-preset-path"
    assert browser.calls == []
    # Selection also untouched — the early exit runs before §3.4.
    assert song.view.selected_track is original_selection


def test_invalid_device_path_rejected_before_selection_shift(
    component, browser, song, recorder, preset_path,
):
    """Bad ``devicePath`` aborts before ``selected_track`` is set.

    Protects the user's visible selection from drifting on a call
    that can't succeed. ``_validate_device_path`` returns ``False``
    and ``handle_load`` returns early — the selection-set +
    ``load_item`` block in the same ``try`` never runs.
    """
    original_selection = song.view.selected_track
    component.handle_load(
        args=(
            "tracks/0",
            "tracks/0/devices/99",
            preset_path,
        ),
        source_addr=None,
    )
    errs = recorder.errors()
    assert len(errs) == 1
    _, code, _, _ = errs[0]
    assert code == V3_ERROR_DEVICE_SLOT_INVALID
    assert browser.calls == []
    assert song.view.selected_track is original_selection


# --- load_clip_new_track (.alc → browser-created track) --------------------

# Live's Browser creates its OWN track when loading an .alc clip. These
# stubs model that: load_item appends a new track to song.tracks.


class _StubTrack2:
    """Track with a stable _live_ptr so before/after diff works."""

    _next = 1000

    def __init__(self):
        _StubTrack2._next += 1
        self._live_ptr = _StubTrack2._next


class _AlcSong:
    def __init__(self, tracks=None):
        self._tracks = list(tracks or [])

    @property
    def tracks(self):
        return list(self._tracks)

    def _append(self, t):
        self._tracks.append(t)


class _AlcBrowser:
    """Browser exposing a loadable .alc under ``packs``; load_item appends
    a new track to the song (mimicking Live creating a clip's track)."""

    def __init__(self, song, alc_leaf=None, creates_track=True, raises=False):
        self._song = song
        self._creates = creates_track
        self._raises = raises
        self.user_library = StubBrowserItem("User Library")
        item = StubBrowserItem(alc_leaf, is_loadable=True) if alc_leaf else None
        self.packs = StubBrowserItem("Packs", children=[item] if item else [])
        self.loaded = None

    def load_item(self, item):
        if self._raises:
            raise RuntimeError("boom")
        self.loaded = item
        if self._creates:
            self._song._append(_StubTrack2())


def _make_alc_component(browser, song, recorder, base):
    return DeviceLoadComponent(
        song=song, browser=browser, emit=recorder, user_library_base=base,
    )


def test_load_clip_new_track_returns_created_track(recorder, user_library_base, tmp_path):
    alc = tmp_path / "01_LowFi Shuffle.alc"
    alc.write_bytes(b"\x1f\x8b")
    pre = [_StubTrack2(), _StubTrack2()]
    song = _AlcSong(pre)
    browser = _AlcBrowser(song, alc_leaf=alc.name, creates_track=True)
    c = _make_alc_component(browser, song, recorder, user_library_base)

    track, err = c.load_clip_new_track(str(alc))
    assert err is None
    assert track is not None
    # The returned track is the newly-appended one, not a pre-existing.
    assert track._live_ptr not in {t._live_ptr for t in pre}
    assert browser.loaded is not None
    c.disconnect()


def test_load_clip_new_track_not_in_browser(recorder, user_library_base, tmp_path):
    alc = tmp_path / "ghost.alc"
    alc.write_bytes(b"\x1f\x8b")
    song = _AlcSong([_StubTrack2()])
    browser = _AlcBrowser(song, alc_leaf=None)  # unresolvable
    c = _make_alc_component(browser, song, recorder, user_library_base)

    track, err = c.load_clip_new_track(str(alc))
    assert track is None
    assert err == "not-in-browser"
    c.disconnect()


def test_load_clip_new_track_path_not_found(recorder, user_library_base):
    song = _AlcSong([_StubTrack2()])
    browser = _AlcBrowser(song, alc_leaf="x.alc")
    c = _make_alc_component(browser, song, recorder, user_library_base)

    track, err = c.load_clip_new_track("/nope/missing.alc")
    assert track is None
    assert err == "path-not-found"
    c.disconnect()


def test_load_clip_new_track_no_track_created(recorder, user_library_base, tmp_path):
    # load_item resolves + runs but Live created no track — surfaced, not silent.
    alc = tmp_path / "x.alc"
    alc.write_bytes(b"\x1f\x8b")
    song = _AlcSong([_StubTrack2()])
    browser = _AlcBrowser(song, alc_leaf=alc.name, creates_track=False)
    c = _make_alc_component(browser, song, recorder, user_library_base)

    track, err = c.load_clip_new_track(str(alc))
    assert track is None
    assert err == "no-new-track"
    c.disconnect()


def test_load_clip_new_track_follows_a_symlink_into_a_place(recorder, user_library_base, tmp_path):
    """Live's browser lists no symlink: a clip linked into the User Library
    is in the browser only at its target, here inside a Place. Measured
    2026-09-24: the 190 accapella links all answered ``not-in-browser``."""
    place_root = tmp_path / "Samples Organized"
    real = place_root / "Accapellas" / "Clips" / "Apron (D).alc"
    real.parent.mkdir(parents=True)
    real.write_bytes(b"\x1f\x8b")
    link = os.path.join(user_library_base, "Looping Presets", "Audio Samples", "Apron (D).alc")
    os.makedirs(os.path.dirname(link), exist_ok=True)
    os.symlink(str(real), link)

    song = _AlcSong([_StubTrack2()])
    browser = _AlcBrowser(song, alc_leaf=None)
    leaf = StubBrowserItem("Apron (D)", is_loadable=True)  # Live strips ".alc"
    browser.user_folders = [
        StubBrowserItem("Samples Organized", children=[
            StubBrowserItem("Accapellas", children=[StubBrowserItem("Clips", children=[leaf])]),
        ]),
    ]
    c = DeviceLoadComponent(
        song=song, browser=browser, emit=recorder, user_library_base=user_library_base,
        places_roots={"Samples Organized": os.path.realpath(str(place_root))},
    )

    track, err = c.load_clip_new_track(link)
    assert err is None
    assert track is not None
    assert browser.loaded is leaf
    c.disconnect()


def test_load_clip_new_track_load_item_raises(recorder, user_library_base, tmp_path):
    alc = tmp_path / "x.alc"
    alc.write_bytes(b"\x1f\x8b")
    song = _AlcSong([_StubTrack2()])
    browser = _AlcBrowser(song, alc_leaf=alc.name, raises=True)
    c = _make_alc_component(browser, song, recorder, user_library_base)

    track, err = c.load_clip_new_track(str(alc))
    assert track is None
    assert "boom" in err
    c.disconnect()


# --- pad-targeted loads: devicePath names a drum pad (issue #491, 3.8.0) --------

from components.DeviceLoadComponent import (
    PAD_PLACEMENT_TIMEOUT_S,
)
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


class _Clock:
    """The placement deadline's clock, advanced by hand."""

    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now


def _pad_rig(tmp_path, ticks=None, clock=None, head_presets=None):
    """A Drum Rack on track 0 whose pad 36 holds a DrumCell; a User Library
    with a loadable ``Reverb.adv``; a browser whose ``load_item`` lands the
    preset wherever the test says — on the chain, on the track (Live's
    way), nowhere, or ``"later"``: on the track only once the test calls
    ``browser.arrive()``. ``ticks`` collects what the component schedules
    on the fast tick; ``None`` leaves it with no tick to wait on."""
    rack = make_rack([FakePad(36, [FakeChain([drumcell()], name="Kick")])])
    track = FakeTrack([rack], "Drums")
    song = FakeSong(tracks=[track])
    preset_dir = tmp_path / "User Library" / "Effects"
    preset_dir.mkdir(parents=True)
    preset = preset_dir / "Reverb.adv"
    preset.write_bytes(b"x")
    item = StubBrowserItem("Reverb.adv", is_loadable=True)
    lib = StubBrowserItem("User Library", children=[StubBrowserItem("Effects", children=[item])])

    class LandingBrowser(StubBrowser):
        def __init__(self):
            super().__init__(user_library=lib)
            # "live": where Live 12.4.15b2 puts it — the chain when the
            # track's insert mode sits beside the selection at load time,
            # the track otherwise (ADR-437). The others force a landing.
            self.land = "live"
            self.landed_type = 2
            self.rack = rack
            self.track = track
            self.mode_at_load = None

        def load_item(self, item):
            self.calls.append(item.name)
            view = getattr(self.track, "view", None)   # an older Live has none
            self.mode_at_load = view.device_insert_mode if view is not None else None
            dev = FakeDevice("Hybrid", [FakeParam("Dry/Wet", 0.3)], type_=self.landed_type, name="Reverb")
            land = self.land
            if land == "live":
                # Live's rule (ADR-437): in the default mode the load goes to
                # the track (after the top-level device holding the selection);
                # with the mode beside the selection it lands next to the
                # selected device — inside its chain, or on the track before
                # (mode 1) / after (mode 2) it.
                sel = song.view.selected_devices[-1] if song.view.selected_devices else None
                mode = view._mode if view is not None else 0
                if mode == 0 or sel is None:
                    land = "track"
                elif sel in self.track.devices:
                    dev.canonical_parent = self.track
                    at = self.track.devices.index(sel) + (1 if mode == 2 else 0)
                    self.track.devices.insert(at, dev)
                    return
                else:
                    land = "chain"
            if land == "chain":
                self.rack.drum_pads[36].chains[0].insert(len(self.rack.drum_pads[36].chains[0].devices), dev)
            elif land == "track":
                self._land_on_track(dev)
            elif land == "later":
                self.later = dev
            # "nowhere": the preset never appears

        def _land_on_track(self, dev):
            # Live's own placement (ADR-430, measured 2026-09-11): a
            # browser load lands after the selected device — an audio
            # effect behind the rack — but a MIDI effect goes to the
            # track's HEAD, ahead of the rack, whose path shifts until the
            # move. The fake used to append both.
            dev.canonical_parent = self.track
            if self.landed_type == 4:
                self.track.devices.insert(0, dev)
            else:
                self.track.devices.append(dev)

        def arrive(self):
            """Live shows the preset on the track, a tick after the load."""
            self._land_on_track(self.later)

    browser = LandingBrowser()
    rec = EmitRecorder()
    comp = DeviceLoadComponent(
        song=song,
        browser=browser,
        emit=rec,
        user_library_base=str(tmp_path / "User Library"),
        schedule_tick=(lambda fn: ticks.append(fn)) if ticks is not None else None,
        clock=clock if clock is not None else _Clock(),
        head_preset_paths=head_presets,
    )
    return comp, song, rack, browser, rec, str(preset)


def test_pad_load_selects_the_pad_and_the_chains_last_device_then_loads(tmp_path):
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path)
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert browser.calls == ["Reverb.adv"]
    assert song.view.selected_track is song.tracks[0]
    assert rack.view.selected_drum_pad is rack.drum_pads[36]
    assert song.view.selected_devices == [rack.drum_pads[36].chains[0].devices[0]]
    # Landed on the chain: nothing to move, nothing on the error wire.
    assert song.moves == []
    assert rec.errors() == []
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert (song.begins, song.ends) == (0, 0)


def test_pad_load_sets_the_insert_mode_beside_the_selection_for_the_load_and_puts_it_back(tmp_path):
    """ADR-437: with the track's device insert mode beside the selected
    device, Live lands the browser load in the pad's chain itself — no
    move, and an undo that is Live's own "Insert Device"."""
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path)
    view = song.tracks[0].view
    assert view.device_insert_mode is True            # Live's default mode
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert browser.mode_at_load is False               # beside the selection while loading
    assert view.modes == [2, 0]                        # set for the load, put back after
    assert view.device_insert_mode is True
    assert song.moves == [] and rec.errors() == []
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]


def test_pad_load_leaves_an_insert_mode_that_already_sits_beside_the_selection(tmp_path):
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path)
    view = song.tracks[0].view
    view.device_insert_mode = 1                        # a Push "insert left"
    view.modes.clear()
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert view.modes == []                            # not touched
    assert browser.mode_at_load is False
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert song.moves == [] and rec.errors() == []


def test_pad_load_without_an_insert_mode_property_falls_back_to_the_move(tmp_path):
    """An older Live has no ``device_insert_mode``: the load lands on the
    track, as before, and the inline look moves it."""
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path)
    del song.tracks[0].view
    browser.land = "track"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert len(song.moves) == 1
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert rec.errors() == []


def _with_permute(track):
    permute = FakeDevice("MxDeviceAudioEffect", [], type_=2, name="Permute")
    permute.canonical_parent = track
    track.devices.append(permute)
    return permute


def test_track_load_at_head_lands_ahead_of_the_first_audio_effect(tmp_path):
    """ADR-437, the wah's placement: the track's first audio effect is
    selected and the insert mode set to "left of the selection" for the
    load, then put back; nothing is moved."""
    comp, song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    track = song.tracks[0]
    permute = _with_permute(track)
    assert comp.load_into_track(track, preset, at_head=True) is None
    assert [d.name for d in track.devices] == [" 606 + 808", "Reverb", "Permute"]
    assert song.view.selected_devices == [permute]
    assert track.view.modes == [1, 0] and track.view.device_insert_mode is True
    assert song.moves == [] and rec.errors() == []


def test_track_load_at_head_on_a_track_without_effects_appends(tmp_path):
    comp, song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    track = song.tracks[0]                                    # the rack alone
    assert comp.load_into_track(track, preset, at_head=True) is None
    assert [d.name for d in track.devices] == [" 606 + 808", "Reverb"]
    assert song.view.selected_devices == [] and track.view.modes == []
    assert rec.errors() == []


def test_track_load_at_head_forces_left_when_the_mode_already_sits_beside_the_selection(tmp_path):
    comp, song, _rack, _browser, _rec, preset = _pad_rig(tmp_path)
    track = song.tracks[0]
    _with_permute(track)
    track.view.device_insert_mode = 2                         # a Push "insert right"
    track.view.modes.clear()
    assert comp.load_into_track(track, preset, at_head=True) is None
    assert [d.name for d in track.devices] == [" 606 + 808", "Reverb", "Permute"]
    assert track.view.modes == [1]                            # written, not put back: it was not the default


def test_track_load_at_head_without_the_property_loads_where_live_puts_it(tmp_path):
    comp, song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    track = song.tracks[0]
    _with_permute(track)
    del track.view
    assert comp.load_into_track(track, preset, at_head=True) is None
    assert [d.name for d in track.devices] == [" 606 + 808", "Permute", "Reverb"]
    assert song.moves == [] and rec.errors() == []


def test_track_load_without_at_head_appends_as_before(tmp_path):
    comp, song, _rack, _browser, _rec, preset = _pad_rig(tmp_path)
    track = song.tracks[0]
    _with_permute(track)
    assert comp.load_into_track(track, preset) is None
    assert [d.name for d in track.devices] == [" 606 + 808", "Permute", "Reverb"]
    assert track.view.modes == [] and song.view.selected_devices == []


def test_a_wire_load_of_a_head_preset_lands_ahead_of_the_first_audio_effect(tmp_path):
    """ADR-445: the Pedal view's Wah button goes through ``device/load``; a
    preset named in ``head_preset_paths`` (the wah) is placed as the pedal's
    own load places it — first audio effect selected, insert mode left of
    the selection for the call, put back after — so both doors land it in
    one place. Nothing is moved (ADR-437)."""
    comp, song, _rack, _browser, rec, preset = _pad_rig(tmp_path, head_presets=[preset_of(tmp_path)])
    track = song.tracks[0]
    permute = _with_permute(track)
    comp.handle_load(["tracks/0", "", preset], None)
    assert [d.name for d in track.devices] == [" 606 + 808", "Reverb", "Permute"]
    assert song.view.selected_devices == [permute]
    assert track.view.modes == [1, 0] and track.view.device_insert_mode is True
    assert song.moves == [] and rec.errors() == []


def test_a_wire_load_of_any_other_preset_appends_as_before(tmp_path):
    comp, song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    track = song.tracks[0]
    _with_permute(track)
    comp.handle_load(["tracks/0", "", preset], None)
    assert [d.name for d in track.devices] == [" 606 + 808", "Permute", "Reverb"]
    assert track.view.modes == [] and song.view.selected_devices == []
    assert rec.errors() == []


def test_loads_at_head_matches_by_normalized_path(tmp_path):
    comp, _song, _rack, _browser, _rec, preset = _pad_rig(tmp_path, head_presets=[preset_of(tmp_path)])
    assert comp.loads_at_head(preset)
    assert comp.loads_at_head(preset.replace("/Effects/", "/Effects//"))
    assert not comp.loads_at_head(preset + ".bak")
    assert not comp.loads_at_head("")
    bare, *_ = _pad_rig(tmp_path / "bare")                  # no head presets named
    assert not bare.loads_at_head(preset)


def preset_of(tmp_path):
    """The rig's preset path, before the rig exists — ``_pad_rig`` writes it
    at this location."""
    return str(tmp_path / "User Library" / "Effects" / "Reverb.adv")


def test_the_insert_mode_is_put_back_when_load_item_raises(tmp_path):
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path, [])

    def boom(_item):
        raise RuntimeError("no load")

    browser.load_item = boom
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert song.tracks[0].view.modes == [2, 0]
    assert [e[1] for e in rec.errors()] == ["load-failed"]


def test_pad_load_moves_a_preset_that_landed_on_the_track_into_the_chain_at_once(tmp_path):
    """ADR-437: the look happens the moment ``load_item`` returns — no
    tick is scheduled, the move is inside the same handler. No undo group
    around the pair: grouping them aborted Live's undo on the rig."""
    ticks = []
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path, ticks)
    browser.land = "track"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert ticks == []
    assert len(song.moves) == 1
    device, parent, index = song.moves[0]
    assert device.name == "Reverb" and parent is rack.drum_pads[36].chains[0] and index == 1
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]
    assert rec.errors() == []
    assert (song.begins, song.ends) == (0, 0)


def test_pad_load_moves_a_midi_effect_that_landed_on_the_track_to_the_chains_head(tmp_path):
    ticks = []
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path, ticks)
    browser.land = "track"
    browser.landed_type = 4  # a MIDI effect
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    # Live puts a MIDI effect at the track's head, ahead of the rack; the
    # inline move takes it straight into the chain, ahead of the DrumCell,
    # so the rack's path never shifts past the handler (it did for the
    # 100–200 ms the deferred check used to wait — ADR-430's follow-up).
    assert ticks == []
    _device, parent, index = song.moves[0]
    assert parent is rack.drum_pads[36].chains[0] and index == 0
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["Reverb", "DrumCell"]
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]
    assert rec.errors() == []


def test_pad_load_waits_a_tick_for_a_preset_live_has_not_shown_yet(tmp_path):
    """A newcomer that is not on the track when ``load_item`` returns is
    looked for again on every fast tick until it is placed."""
    ticks = []
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path, ticks)
    browser.land = "later"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert song.moves == [] and len(ticks) == 1
    ticks.pop()()                     # still nothing: look again next tick
    assert song.moves == [] and len(ticks) == 1
    assert rec.errors() == []
    browser.arrive()
    ticks.pop()()
    assert len(song.moves) == 1 and ticks == []
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]
    assert rec.errors() == []
    assert (song.begins, song.ends) == (0, 0)


def test_pad_load_gives_up_at_the_deadline(tmp_path):
    ticks = []
    clock = _Clock()
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path, ticks, clock)
    browser.land = "nowhere"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    for _ in range(5):                # a few ticks short of the deadline
        clock.now += 0.011
        ticks.pop()()
        assert rec.errors() == [] and len(ticks) == 1
    clock.now += PAD_PLACEMENT_TIMEOUT_S
    ticks.pop()()
    assert ticks == []
    errors = rec.errors()
    assert len(errors) == 1
    _, code, path, detail = errors[0]
    assert code == "load-failed" and path == preset
    assert detail == "landed-nowhere;scope=tracks/0/devices/0/pads/36"
    assert (song.begins, song.ends) == (0, 0)


def test_pad_load_with_no_tick_to_wait_on_reports_a_missing_preset_at_once(tmp_path):
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path)   # no ticks
    browser.land = "nowhere"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert [e[1] for e in rec.errors()] == ["load-failed"]
    assert rec.errors()[0][3] == "landed-nowhere;scope=tracks/0/devices/0/pads/36"
    assert (song.begins, song.ends) == (0, 0)


def test_disconnect_drops_a_pending_pad_load_and_its_tick_is_inert(tmp_path):
    ticks = []
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path, ticks)
    browser.land = "nowhere"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert len(ticks) == 1
    comp.disconnect()
    ticks.pop()()                     # the stale tick is inert: no look, no error
    assert rec.errors() == [] and ticks == []
    assert (song.begins, song.ends) == (0, 0)


def test_a_load_item_that_raises_on_the_pad_path_reports_and_opens_no_undo_step(tmp_path):
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path, [])

    def boom(_item):
        raise RuntimeError("no load")

    browser.load_item = boom
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    errors = rec.errors()
    assert len(errors) == 1 and errors[0][1] == "load-failed"
    assert errors[0][3].startswith("RuntimeError: no load") and errors[0][3].endswith(";scope=tracks/0/devices/0/pads/36")
    assert (song.begins, song.ends) == (0, 0)


def test_the_browser_pad_load_opens_no_undo_step(tmp_path):
    """Grouping the browser load with the move in one ``begin/end_undo_step``
    made Live abort on the first undo of the pair (``Fatal Error:
    ADeleteAction::Do``, rig, 2026-09-14): the pair stays Live's own two
    entries."""
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path, [])
    browser.land = "track"
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert [d.name for d in rack.drum_pads[36].chains[0].devices] == ["DrumCell", "Reverb"]
    assert rec.errors() == []
    assert (song.begins, song.ends) == (0, 0)


def test_the_fake_refuses_a_midi_effect_behind_the_instrument_as_live_does(tmp_path):
    """The rule the head-index test leans on is enforced by the fake, so a
    loader that appended a MIDI effect would be refused here as on the rig."""
    _comp, song, rack, _browser, _rec, _preset = _pad_rig(tmp_path)
    random = FakeDevice("MidiRandom", [], type_=4, name="Random")
    song.tracks[0].devices.append(random)
    random.canonical_parent = song.tracks[0]
    chain = rack.drum_pads[36].chains[0]
    with pytest.raises(RuntimeError):
        song.move_device(random, chain, len(chain.devices))  # behind the DrumCell
    assert [d.name for d in chain.devices] == ["DrumCell"]  # nothing moved
    song.move_device(random, chain, 0)  # ahead of it: fine
    assert [d.name for d in chain.devices] == ["Random", "DrumCell"]


def test_pad_load_refuses_a_pad_that_is_not_on_the_named_track(tmp_path):
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path)
    song.tracks.append(FakeTrack([], "Other"))
    comp.handle_load(["tracks/1", "tracks/0/devices/0/pads/36", preset], None)
    assert browser.calls == []
    errors = rec.errors()
    assert len(errors) == 1
    _, code, path, detail = errors[0]
    assert code == "device-slot-invalid" and path == preset
    assert detail.startswith("pad-not-on-track") and detail.endswith(";scope=tracks/0/devices/0/pads/36")


def test_pad_load_reports_a_refused_move_with_the_scope(tmp_path):
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path)
    browser.land = "track"
    song.raise_on.add("move")
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    errors = rec.errors()
    assert len(errors) == 1
    assert errors[0][1] == "load-failed"
    assert errors[0][3].startswith("move_device raised: RuntimeError")
    assert errors[0][3].endswith(";scope=tracks/0/devices/0/pads/36")
    assert (song.begins, song.ends) == (0, 0)


def test_pad_load_rejects_a_pad_that_does_not_resolve(tmp_path):
    comp, _song, _rack, browser, rec, preset = _pad_rig(tmp_path)
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/40", preset], None)
    assert browser.calls == []
    errors = rec.errors()
    assert len(errors) == 1
    assert errors[0][1] == "device-slot-invalid"
    # The path is the preset, as on every load error — the UI's slot reset
    # matches on it — and the pad rides the scope.
    assert errors[0][2] == preset
    assert errors[0][3].startswith("path-not-found")
    assert errors[0][3].endswith(";scope=tracks/0/devices/0/pads/40")


def test_pad_load_of_a_preset_missing_on_disk_carries_the_scope(tmp_path):
    comp, _song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    missing = os.path.join(os.path.dirname(preset), "Missing.adv")
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", missing], None)
    assert rec.errors() == [
        (V3_DEVICE_LOAD_ADDRESS, "load-failed", missing, "path-not-found;scope=tracks/0/devices/0/pads/36"),
    ]


def test_pad_load_of_a_preset_the_browser_lacks_carries_the_scope(tmp_path):
    comp, _song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    ghost = os.path.join(os.path.dirname(preset), "Ghost.adv")
    with open(ghost, "wb") as f:
        f.write(b"x")   # on disk, in no browser tree
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", ghost], None)
    assert rec.errors() == [
        (V3_DEVICE_LOAD_ADDRESS, "load-failed", ghost, "not-in-browser;scope=tracks/0/devices/0/pads/36"),
    ]


def test_track_level_load_errors_carry_no_scope(tmp_path):
    comp, _song, _rack, _browser, rec, preset = _pad_rig(tmp_path)
    missing = os.path.join(os.path.dirname(preset), "Missing.adv")
    comp.handle_load(["tracks/0", "", missing], None)
    assert rec.errors() == [(V3_DEVICE_LOAD_ADDRESS, "load-failed", missing, "path-not-found")]


def test_pad_load_on_an_empty_chain_skips_the_device_select(tmp_path):
    comp, song, rack, browser, rec, preset = _pad_rig(tmp_path)
    rack.drum_pads[36].chains[0].devices.clear()
    comp.handle_load(["tracks/0", "tracks/0/devices/0/pads/36", preset], None)
    assert song.view.selected_devices == []
    assert browser.calls == ["Reverb.adv"]
    assert rec.errors() == []


def test_track_level_load_is_unchanged_by_the_pad_path(tmp_path):
    comp, song, _rack, browser, rec, preset = _pad_rig(tmp_path)
    comp.handle_load(["tracks/0", "", preset], None)
    assert browser.calls == ["Reverb.adv"]
    assert song.view.selected_devices == []
    assert rec.errors() == []


# --- insert by name (issue #491 follow-up, 2026-09-10; 3.12.0) -------------
#
# A tile that names a native device (``native:<class>``, the tile's name as
# ``rel``) is inserted by display name — into the pad's chain or onto the
# track — so the user's own default for it applies, renamed to the tile's
# name inside one undo step, and never touches a file, the browser or
# Live's selection. A preset FILE of a native device loads through the
# browser like any other file.

import gzip

PAD = "tracks/0/devices/0/pads/36"


def _adv(device_class: str, user_name: str = "") -> bytes:
    """A minimal gzipped device preset the way Live writes one: the device
    class is the first element under ``<Ableton>``."""
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4">\n'
        '\t<%s Id="0">\n\t\t<LomId Value="0" />\n\t\t<UserName Value="%s" />\n\t</%s>\n</Ableton>\n'
        % (device_class, user_name, device_class)
    )
    return gzip.compress(xml.encode("utf-8"))


def _native_rig(track_devices=None):
    """A kit on track 0 (pad 36 = one DrumCell) and a browser that must
    never be asked."""
    rack = make_rack([FakePad(36, [FakeChain([drumcell()], name="Kick")])])
    track = FakeTrack([rack] if track_devices is None else track_devices, "Drums")
    song = FakeSong(tracks=[track])
    browser = StubBrowser(user_library=StubBrowserItem("User Library", children=[]))
    rec = EmitRecorder()
    comp = DeviceLoadComponent(song=song, browser=browser, emit=rec, user_library_base="")
    return comp, song, rack, browser, rec


def _native(target: str, device_class: str, name: str):
    return ["tracks/0", target, "", "native:" + device_class, name]


def test_pad_load_inserts_a_native_device_by_name():
    comp, song, rack, browser, rec = _native_rig()
    comp.handle_load(_native(PAD, "Delay", "Delay"), None)
    chain = rack.drum_pads[36].chains[0]
    assert chain.inserts == [("Delay", None)]
    assert [d.name for d in chain.devices] == ["DrumCell", "Delay"]
    # No browser, no selection change, no move, nothing on the error wire.
    assert browser.calls == []
    assert song.view.selected_track is None and song.view.selected_devices == []
    assert song.moves == []
    assert rec.errors() == []
    # One undo step around the whole thing.
    assert (song.begins, song.ends) == (1, 1)


def test_inserted_device_is_renamed_to_the_tile_name():
    # The Reverb tile is a Hybrid Reverb: Live inserts it as "Hybrid Reverb",
    # the tile (and every existing set) knows it as "Reverb".
    comp, _song, rack, browser, _rec = _native_rig()
    comp.handle_load(_native(PAD, "Hybrid", "Reverb"), None)
    chain = rack.drum_pads[36].chains[0]
    assert chain.inserts == [("Hybrid Reverb", None)]
    assert [(d.class_name, d.name) for d in chain.devices][1] == ("Hybrid", "Reverb")
    assert browser.calls == []


def test_no_name_keeps_lives_display_name():
    comp, song, _rack, _browser, rec = _native_rig()
    comp.handle_load(_native("", "PhaserNew", ""), None)
    assert [d.name for d in song.tracks[0].devices][1] == "Phaser-Flanger"
    assert rec.errors() == []


def test_track_load_inserts_by_name_too():
    comp, song, _rack, browser, _rec = _native_rig()
    comp.handle_load(_native("", "Delay", "Delay"), None)
    track = song.tracks[0]
    assert track.inserts == [("Delay", None)]
    assert [d.name for d in track.devices] == [" 606 + 808", "Delay"]
    assert browser.calls == []
    assert song.view.selected_track is None  # a browser load would have had to select the track


def test_a_midi_effect_goes_after_the_leading_midi_effects():
    arp = FakeDevice("MidiArpeggiator", [], type_=4, name="Arpeggiator")
    inst = FakeDevice("OriginalSimpler", [], type_=1, name="Simpler")
    fx = FakeDevice("Delay", [], type_=2, name="Delay")
    comp, song, _rack, _browser, _rec = _native_rig(track_devices=[arp, inst, fx])
    comp.handle_load(_native("", "MidiRandom", "Random"), None)
    track = song.tracks[0]
    assert track.inserts == [("Random", 1)]
    assert [d.name for d in track.devices] == ["Arpeggiator", "Random", "Simpler", "Delay"]


def test_an_unknown_class_is_refused_and_touches_nothing():
    comp, song, _rack, browser, rec = _native_rig()
    comp.handle_load(_native("", "NoSuchDevice", "Mystery"), None)
    assert song.tracks[0].inserts == []
    assert browser.calls == []
    assert (song.begins, song.ends) == (0, 0)
    assert rec.errors() == [(
        "/looping/v3/device/load", "load-failed", "native:NoSuchDevice", "unknown-device: NoSuchDevice",
    )]


def test_an_insert_that_returns_nothing_fails_with_the_pad_scope():
    """Live hands back the device it inserted; nothing back means nothing
    went in. The error names the load's source, which the UI's slot reset
    matches, and the pad scope."""
    comp, song, rack, browser, rec = _native_rig()
    chain = rack.drum_pads[36].chains[0]
    chain.insert_returns_none = True
    comp.handle_load(_native(PAD, "Delay", "Delay"), None)
    assert chain.inserts == [("Delay", None)]
    assert [d.name for d in chain.devices] == ["DrumCell"]
    assert browser.calls == []
    assert rec.errors() == [(
        "/looping/v3/device/load", "load-failed", "native:Delay", "insert-refused;scope=" + PAD,
    )]
    assert (song.begins, song.ends) == (1, 1)  # the step still closes


def test_a_begin_undo_step_that_raises_does_not_stop_the_insert():
    comp, song, rack, browser, rec = _native_rig()
    song.raise_on.add("begin")
    comp.handle_load(_native(PAD, "Delay", "Delay"), None)
    chain = rack.drum_pads[36].chains[0]
    assert [d.name for d in chain.devices] == ["DrumCell", "Delay"]
    assert browser.calls == []
    assert rec.errors() == []
    assert (song.begins, song.ends) == (0, 0)  # no step was opened, so none is closed


def test_a_refused_insert_fails_and_closes_the_undo_step():
    comp, song, _rack, browser, rec = _native_rig()
    song.tracks[0].refuse_insert = True
    comp.handle_load(_native("", "Delay", "Delay"), None)
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]
    assert browser.calls == []
    assert (song.begins, song.ends) == (1, 1)
    assert [e[3] for e in rec.errors()] == ["insert-refused"]


def test_a_refused_rename_removes_the_insert_and_fails():
    """A device left under Live's display name matches no tile — the slot
    would time out and the next drag insert a second copy."""
    comp, song, _rack, browser, rec = _native_rig()
    song.tracks[0].refuse_rename = True
    comp.handle_load(_native("", "Hybrid", "Reverb"), None)
    assert song.tracks[0].inserts == [("Hybrid Reverb", None)]
    assert [d.name for d in song.tracks[0].devices] == [" 606 + 808"]   # the insert is gone again
    assert browser.calls == []
    assert (song.begins, song.ends) == (1, 1)
    assert [e[3] for e in rec.errors()] == ["insert-refused"]


def test_a_non_lom_raise_inside_the_insert_still_closes_the_undo_step():
    comp, song, _rack, _browser, _rec = _native_rig()
    song.tracks[0].insert_raises = ValueError("not a LOM error")
    with pytest.raises(ValueError):
        comp.handle_load(_native("", "Delay", "Delay"), None)
    assert (song.begins, song.ends) == (1, 1)


def test_a_native_preset_file_loads_through_the_browser(tmp_path):
    """A user's own preset of a native device is that preset: it is never
    swapped for the device's default."""
    rack = make_rack([FakePad(36, [FakeChain([drumcell()], name="Kick")])])
    song = FakeSong(tracks=[FakeTrack([rack], "Drums")])
    lib_dir = tmp_path / "User Library"
    (lib_dir / "Effects").mkdir(parents=True)
    preset = lib_dir / "Effects" / "My Delay.adv"
    preset.write_bytes(_adv("Delay"))
    item = StubBrowserItem(preset.name, is_loadable=True)
    browser = StubBrowser(user_library=StubBrowserItem(
        "User Library", children=[StubBrowserItem("Effects", children=[item])],
    ))
    comp = DeviceLoadComponent(song=song, browser=browser, emit=EmitRecorder(), user_library_base=str(lib_dir))
    comp.handle_load(["tracks/0", "", str(preset)], None)
    assert song.tracks[0].inserts == []
    assert browser.calls == ["My Delay.adv"]


# --- the User Library without paths.userLibraryBase ------------------------
#
# paths.userLibraryBase is a Mac's own setting (constants.local.json,
# general-release plan.md §3). A clone without it takes the User Library
# Live's Library.cfg names; before, an empty setting normalized to "." and
# the insert-by-name default check looked for "./Defaults/…".


def test_user_library_base_falls_back_to_lives_library(recorder):
    from components.live_library import LiveLibrary

    c = DeviceLoadComponent(
        song=None, browser=StubBrowser(), emit=recorder, user_library_base="",
        library=LiveLibrary(user_library="/Volumes/Audio/User Library"),
    )
    assert c._user_library_base == "/Volumes/Audio/User Library"
    c.disconnect()


def test_configured_user_library_base_wins(recorder):
    from components.live_library import LiveLibrary

    c = DeviceLoadComponent(
        song=None, browser=StubBrowser(), emit=recorder,
        user_library_base="/Users/Shared/Lib/User Library/",
        library=LiveLibrary(user_library="/Volumes/Audio/User Library"),
    )
    assert c._user_library_base == "/Users/Shared/Lib/User Library"
    c.disconnect()


def test_no_user_library_anywhere_is_empty_not_dot(recorder):
    from components.live_library import LiveLibrary

    c = DeviceLoadComponent(
        song=None, browser=StubBrowser(), emit=recorder, user_library_base="",
        library=LiveLibrary(),
    )
    assert c._user_library_base == ""
    c.disconnect()


# --- load_core_groove: the groove chooser (2026-09-29) ---------------------


def test_load_groove_by_name_loads_a_core_library_file(song, recorder, user_library_base):
    groove = StubBrowserItem("Swing 16ths 57.agr", is_loadable=True)
    core = StubBrowserItem("Core Library", children=[
        StubBrowserItem("Grooves", children=[
            StubBrowserItem("Swing", children=[StubBrowserItem("Basic", children=[groove])]),
        ]),
    ])
    browser = StubBrowser()
    browser.packs = StubBrowserItem("Packs", children=[core])
    c = DeviceLoadComponent(song=song, browser=browser, emit=recorder, user_library_base=user_library_base)
    try:
        assert c.load_groove_by_name("Swing 16ths 57") is None
        assert browser.calls == ["Swing 16ths 57.agr"]
        assert c.load_groove_by_name("Swing 16ths 99").startswith("not-in-browser")
        assert c.load_groove_by_name("a/b").startswith("bad-groove-name")
        assert browser.calls == ["Swing 16ths 57.agr"]
    finally:
        c.disconnect()


def test_load_groove_by_name_loads_a_user_groove_from_the_user_library(song, recorder, user_library_base):
    """``User: Swing 16`` is the User Library's ``Grooves/Swing 16.agr``, not
    the Core Library's file of that name."""
    mine = StubBrowserItem("Swing 16.agr", is_loadable=True)
    theirs = StubBrowserItem("Swing 16.agr", is_loadable=True)
    browser = StubBrowser(user_library=StubBrowserItem("User Library", children=[
        StubBrowserItem("Grooves", children=[mine]),
    ]))
    browser.packs = StubBrowserItem("Packs", children=[StubBrowserItem("Core Library", children=[
        StubBrowserItem("Grooves", children=[theirs]),
    ])])
    loaded = []
    browser.load_item = loaded.append
    c = DeviceLoadComponent(song=song, browser=browser, emit=recorder, user_library_base=user_library_base)
    try:
        assert c.load_groove_by_name("User: Swing 16") is None
        assert c.load_groove_by_name("Swing 16") is None
        assert loaded == [mine, theirs]
        assert c.load_groove_by_name("User: Nope").startswith("not-in-browser")
    finally:
        c.disconnect()
