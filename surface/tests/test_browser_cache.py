"""BrowserCache unit tests.

Covers:

- Cache miss → first call walks the tree; subsequent calls do not.
- O(1) lookup behaviour: tree walk is invoked exactly once per root,
  even across many lookups against that root.
- Ableton-native extension stripping: filesystem ``preset.adv`` →
  browser ``preset`` cache hit.
- Place resolution: longest-prefix wins; missing Place returns ``None``.
- Path outside any configured root returns ``None`` and never builds.
- Non-loadable leaves are not cached.
- ``_LOM_ERRORS`` shield: a raising children/name access is logged but
  doesn't propagate.
"""

from __future__ import annotations

import os
from typing import List, Optional

import pytest

from components.browser_cache import BrowserCache


class CountingBrowserItem:
    """A BrowserItem stub that tracks how often ``children`` is read.

    Lets the cache tests assert "tree walked exactly once per root",
    which is the whole point of the cache.
    """

    def __init__(self, name, is_loadable=False, children=None):
        self.name = name
        self.is_loadable = is_loadable
        self._children = list(children or [])
        self.children_reads = 0

    @property
    def children(self):
        self.children_reads += 1
        return list(self._children)

    def total_reads(self) -> int:
        """Sum reads on this node and every descendant."""
        n = self.children_reads
        for c in self._children:
            if isinstance(c, CountingBrowserItem):
                n += c.total_reads()
        return n


class StubBrowser:
    def __init__(self, user_library=None, user_folders=None):
        self.user_library = user_library
        self._user_folders = user_folders

    @property
    def user_folders(self):
        return self._user_folders


# --- helpers --------------------------------------------------------------


def _build_tree(layout):
    """Build a tree from a nested ``{name: {child_name: ... | True}}`` dict.

    Leaf value ``True`` means is_loadable; nested dict means a folder.
    """
    def make(name, value):
        if value is True:
            return CountingBrowserItem(name, is_loadable=True)
        children = [make(k, v) for k, v in value.items()]
        return CountingBrowserItem(name, is_loadable=False, children=children)

    root_name, root_value = next(iter(layout.items()))
    return make(root_name, root_value)


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def user_library_root():
    """User Library tree with a couple of presets at different depths.

    Layout:
        User Library/
            Looping Presets/
                Instruments/
                    preset       (is_loadable; .adv stripped)
                Effect Patches/
                    fx.aupreset  (is_loadable; .aupreset NOT stripped)
            Drums/
                kit              (is_loadable)
    """
    return _build_tree({
        "User Library": {
            "Looping Presets": {
                "Instruments": {"preset": True},
                "Effect Patches": {"fx.aupreset": True},
            },
            "Drums": {"kit": True},
        }
    })


@pytest.fixture
def cache(user_library_root, tmp_path):
    base = tmp_path / "UserLibrary"
    base.mkdir()
    return BrowserCache(
        browser=StubBrowser(user_library=user_library_root),
        user_library_base=str(base),
        places_roots={},
    )


# --- lookups --------------------------------------------------------------


def test_first_lookup_builds_cache_and_returns_item(cache, user_library_root, tmp_path):
    base = str(tmp_path / "UserLibrary")
    item = cache.lookup(os.path.join(base, "Drums", "kit"))
    assert item is not None
    assert item.name == "kit"
    # Tree was walked at least once.
    assert user_library_root.total_reads() >= 1


def test_second_lookup_does_not_rewalk(cache, user_library_root, tmp_path):
    base = str(tmp_path / "UserLibrary")
    cache.lookup(os.path.join(base, "Drums", "kit"))
    reads_after_build = user_library_root.total_reads()

    # Second lookup, same root — no new reads expected.
    cache.lookup(os.path.join(base, "Looping Presets", "Instruments", "preset"))
    assert user_library_root.total_reads() == reads_after_build


def test_ableton_native_extension_stripped(cache, tmp_path):
    """Filesystem ``preset.adv`` → browser ``preset`` (Live strips .adv)."""
    base = str(tmp_path / "UserLibrary")
    item = cache.lookup(
        os.path.join(base, "Looping Presets", "Instruments", "preset.adv")
    )
    assert item is not None
    assert item.name == "preset"


def test_au_preset_extension_kept(cache, tmp_path):
    """``.aupreset`` is not Ableton-native; the leaf keeps the suffix."""
    base = str(tmp_path / "UserLibrary")
    item = cache.lookup(
        os.path.join(base, "Looping Presets", "Effect Patches", "fx.aupreset")
    )
    assert item is not None
    assert item.name == "fx.aupreset"


def test_lookup_miss_returns_none(cache, tmp_path):
    base = str(tmp_path / "UserLibrary")
    item = cache.lookup(os.path.join(base, "Drums", "missing.adv"))
    assert item is None


def test_path_outside_known_roots_returns_none(cache):
    item = cache.lookup("/etc/passwd")
    assert item is None


def test_invalidate_forces_rebuild(cache, user_library_root, tmp_path):
    base = str(tmp_path / "UserLibrary")
    cache.lookup(os.path.join(base, "Drums", "kit"))
    reads_before = user_library_root.total_reads()
    cache.invalidate()
    cache.lookup(os.path.join(base, "Drums", "kit"))
    assert user_library_root.total_reads() > reads_before


# --- Places ---------------------------------------------------------------


def test_names_meet_the_way_live_writes_them(tmp_path):
    """Measured 2026-09-24: Live's browser shows a POSIX colon as a slash and
    an accent spelled with a combining mark (NFD on disk) as one character."""
    root = _build_tree({
        "User Library": {
            "Clips": {
                "Hicks' Farewell (F#) (3/4).alc": True,
                "Verrá Quel Di Di Lune (F).alc": True,
            },
            "Omni": {"Voilà.aupreset": True},
        }
    })
    base = tmp_path / "UserLibrary"
    base.mkdir()
    cache = BrowserCache(
        browser=StubBrowser(user_library=root),
        user_library_base=str(base),
        places_roots={},
    )
    colon = cache.lookup(os.path.join(str(base), "Clips", "Hicks' Farewell (F#) (3:4).alc"))
    accent = cache.lookup(os.path.join(str(base), "Clips", "Verrá Quel Di Di Lune (F).alc"))
    preset = cache.lookup(os.path.join(str(base), "Omni", "Voilà.aupreset"))
    assert colon is not None and colon.name == "Hicks' Farewell (F#) (3/4).alc"
    assert accent is not None and accent.name.startswith("Verrá")
    assert preset is not None


def test_place_lookup(tmp_path):
    """Path under a configured Place resolves through user_folders."""
    place_root = _build_tree({
        "permute": {
            "Permute": True,  # Live strips .amxd → "Permute"
        }
    })
    browser = StubBrowser(
        user_library=CountingBrowserItem("User Library", children=[]),
        user_folders=[place_root],
    )
    cache = BrowserCache(
        browser=browser,
        user_library_base=str(tmp_path / "UserLibrary"),
        places_roots={"permute": str(tmp_path / "permute_root")},
    )
    item = cache.lookup(str(tmp_path / "permute_root" / "Permute.amxd"))
    assert item is not None
    assert item.name == "Permute"


def test_longest_place_prefix_wins(tmp_path):
    """Two overlapping Places: the more specific one resolves the path."""
    inner_root = _build_tree({"inner": {"deep_preset": True}})
    outer_root = _build_tree({"outer": {"sub": {"shallow_preset": True}}})

    browser = StubBrowser(
        user_library=CountingBrowserItem("User Library", children=[]),
        user_folders=[inner_root, outer_root],
    )
    outer_fs = str(tmp_path / "library")
    inner_fs = str(tmp_path / "library" / "sub")  # nested
    cache = BrowserCache(
        browser=browser,
        user_library_base=str(tmp_path / "Other"),
        places_roots={"outer": outer_fs, "inner": inner_fs},
    )
    # Path under inner_fs must resolve through `inner`, not `outer`.
    item = cache.lookup(os.path.join(inner_fs, "deep_preset"))
    assert item is not None
    assert item.name == "deep_preset"


def test_named_place_inside_the_user_library_skips_user_folders(tmp_path, caplog):
    """The rig's Sidebar Places are folders inside the User Library, which
    Live does not list in ``user_folders``: a load naming one resolves through
    the User Library by path, without searching (and warning about) the
    Places first."""
    base = str(tmp_path / "UserLibrary")
    library = _build_tree({"User Library": {"Sidebar": {"Drum": {"Kits": {"909.adg": True}}}}})

    class NoPlaces(StubBrowser):
        @property
        def user_folders(self):
            raise AssertionError("user_folders read for a Place inside the User Library")

    cache = BrowserCache(
        browser=NoPlaces(user_library=library),
        user_library_base=base,
        places_roots={"Drum": os.path.join(base, "Sidebar", "Drum")},
    )
    item = cache.lookup_named("place:Drum", "Kits/909.adg")
    assert item is not None and item.name == "909.adg"
    assert "not found in browser.user_folders" not in caplog.text


def test_missing_place_returns_none(tmp_path):
    browser = StubBrowser(
        user_library=CountingBrowserItem("User Library", children=[]),
        user_folders=[],  # configured Place not present in sidebar
    )
    cache = BrowserCache(
        browser=browser,
        user_library_base=str(tmp_path / "UserLibrary"),
        places_roots={"permute": str(tmp_path / "permute_root")},
    )
    item = cache.lookup(str(tmp_path / "permute_root" / "Permute.amxd"))
    assert item is None


# --- robustness -----------------------------------------------------------


def test_lom_error_in_children_does_not_propagate(tmp_path):
    """A raising ``children`` access aborts the walk for that subtree
    but doesn't crash the caller. Everything cached up to that point
    stays usable."""
    class RaisingChildItem(CountingBrowserItem):
        @property
        def children(self):
            raise RuntimeError("torn down")

    bad_subtree = RaisingChildItem("Bad", is_loadable=False)
    good_leaf = CountingBrowserItem("good", is_loadable=True)
    folder = CountingBrowserItem("Folder", children=[bad_subtree, good_leaf])
    root = CountingBrowserItem("User Library", children=[folder])

    base = str(tmp_path / "UserLibrary")
    cache = BrowserCache(
        browser=StubBrowser(user_library=root),
        user_library_base=base,
        places_roots={},
    )
    # The good leaf is still findable.
    item = cache.lookup(os.path.join(base, "Folder", "good"))
    assert item is not None
    assert item.name == "good"


def test_non_loadable_leaf_not_returned(cache, tmp_path):
    """A path matching a folder (non-loadable) returns ``None``."""
    base = str(tmp_path / "UserLibrary")
    item = cache.lookup(os.path.join(base, "Drums"))
    assert item is None


def test_walk_depth_cap_prunes_subtree_without_recursionerror(tmp_path, caplog):
    """A tree deeper than ``_MAX_WALK_DEPTH`` must be pruned with a WARN
    rather than blowing Python's ~1000-frame default stack.
    ``RecursionError`` is not in ``_LOM_ERRORS``, so without the cap it
    would propagate past ``_build_root`` and crash Live."""
    from components.browser_cache import _MAX_WALK_DEPTH

    # Build a single chain ``L0 → L1 → ... → L<depth>`` with a loadable
    # leaf at the bottom. Anything past the cap should be pruned.
    overshoot = _MAX_WALK_DEPTH + 5
    leaf = CountingBrowserItem("deep_leaf", is_loadable=True)
    node = leaf
    # Build from bottom up.
    for i in range(overshoot, 0, -1):
        node = CountingBrowserItem("L%d" % i, is_loadable=False, children=[node])
    root = CountingBrowserItem(
        "User Library", is_loadable=False, children=[node],
    )

    base = tmp_path / "UserLibrary"
    base.mkdir()
    cache = BrowserCache(
        browser=StubBrowser(user_library=root),
        user_library_base=str(base),
        places_roots={},
    )

    import logging
    with caplog.at_level(logging.WARNING, logger="looping"):
        # Lookup against any path under the root forces the walk; the
        # exact path doesn't matter — we're asserting the walk completes.
        cache.lookup(os.path.join(str(base), "L1"))

    # Cap-exceeded WARN was emitted (proves the cap fired, not just that
    # we got lucky and stayed under Python's recursion limit).
    assert any(
        "max walk depth" in rec.message for rec in caplog.records
    ), "Expected 'max walk depth' WARN; got: %r" % [r.message for r in caplog.records]

    # And the deep leaf is unreachable (its ancestor was pruned past the cap).
    deep = cache.lookup(os.path.join(
        str(base), *("L%d" % i for i in range(1, overshoot + 1)), "deep_leaf",
    ))
    assert deep is None
