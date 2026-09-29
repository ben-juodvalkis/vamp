"""BrowserCache — O(1) filesystem-path → BrowserItem lookups.

The pre-cache implementation in :mod:`DeviceLoadComponent` walked
``browser.user_library`` (or ``browser.user_folders[Place]``) segment
by segment on every ``/looping/v3/device/load`` call. On large
libraries that descent took hundreds of milliseconds — a synchronous
freeze on Live's main thread that the user felt as a UI hitch every
time they tapped to load an instrument.

This helper does the descent **once per root**, building a
``{segments_tuple → BrowserItem}`` map on first access. Subsequent
lookups are dict reads. The cache is keyed on the segment names as
Live exposes them in the browser; the lookup side accepts a
filesystem path and tries both the literal leaf filename and the
Ableton-native stem-stripped form (Live strips ``.amxd`` / ``.adv``
/ ``.adg`` / ``.als`` / ``.alc`` from display names).

No global "browser changed" listener exists in Live's public API.
The cache is built lazily on first miss and reused; since 2026-09-26
(onboarding.plan.md §6.4) a miss rebuilds the root once more, at most
every ``REBUILD_COOLDOWN_S``, so a file saved into a Place mid-session
loads once Live's browser lists it, and a Place added in Live is found
on its next use rather than never. A surface restart (which happens on
``File → Open`` per ``architecture.md §7``) rebuilds everything.

Roots (2026-09-26): the User Library (from ``paths.userLibraryBase`` and
from Live's own ``Library.cfg``), every sidebar Place Live lists
(``live_library``), the ``paths.placesRoots`` entries an older config
still carries, and every installed Pack under ``browser.packs``. A load
that names its Place (``lookup_named``: ``place:<name>`` / ``library`` /
``pack:<name>`` plus the path inside it) skips the root matching.
"""

from __future__ import annotations

import logging
import os
import time
import unicodedata
from typing import Callable, Dict, List, Optional, Tuple

from .live_library import LiveLibrary

logger = logging.getLogger("looping")

#: A root is walked again after a miss no more often than this.
REBUILD_COOLDOWN_S = 10.0

SOURCE_LIBRARY = "library"
SOURCE_PLACE_PREFIX = "place:"
SOURCE_PACK_PREFIX = "pack:"


def browser_name(segment: str) -> str:
    """A file-system name as Live's browser writes it.

    Measured 2026-09-24 on Live 12.4.15b4, loading every linked accapella
    clip: the browser shows a POSIX colon as a slash (the Cocoa display
    convention — ``Hicks' Farewell (F#) (3:4).alc`` reads ``(3/4)``) and an
    accent spelled on disk as a base letter plus a combining mark (NFD,
    ``Verra\\u0301``) as the composed character (NFC, ``Verrá``). Both missed
    the cache and answered ``not-in-browser``: 5 of the 45,415 loadable
    files in the Places, two of them Omnisphere presets. Keys and lookups
    both go through this, so the two sides always meet.
    """
    return unicodedata.normalize("NFC", segment).replace(":", "/")


# Tuple of exceptions every LOM touch must catch. ``TypeError`` covers
# ``Boost.Python.ArgumentError`` (TypeError subclass) raised when a
# C++ handle is torn down — see CLAUDE.md merge-gate rule (9).
_LOM_ERRORS: Tuple[type, ...] = (RuntimeError, AttributeError, TypeError)


# Ableton-native extensions Live strips from BrowserItem display names.
# ``.aupreset`` / ``.vstpreset`` / ``.fxp`` are kept verbatim by Live, so
# they don't appear here.
_ABLETON_NATIVE_EXTS = frozenset({".amxd", ".adv", ".adg", ".als", ".alc"})


# Hard cap on cached entries per root. Even very heavy User Libraries
# have <50k loadable presets in practice; this guards against a
# pathological tree (cycles, infinite generators) eating memory.
_MAX_ENTRIES_PER_ROOT = 200_000

# Hard cap on walk recursion depth. Real User Library nesting is
# typically <8 levels; 64 leaves headroom for unusual layouts while
# protecting against cycles or a malformed LOM tree blowing Python's
# 1000-frame default stack with a bare ``RecursionError`` (which is
# *not* a member of ``_LOM_ERRORS``, so it would propagate past our
# guards and surface as a Live crash).
_MAX_WALK_DEPTH = 64


class BrowserCache:
    """Filesystem-path → BrowserItem cache, built lazily per root.

    Args:
        browser: The Live ``Application.Browser`` object. Reads
            ``user_library`` and ``user_folders``; never mutated.
        user_library_base: Filesystem root for ``browser.user_library``
            (already normalized + trailing-sep-stripped by the caller).
        places_roots: ``{display_name: fs_root}`` — already filtered and
            normalized by the caller. Maps Place sidebar names to their
            filesystem roots; used to resolve paths outside User Library.
    """

    def __init__(
        self,
        browser,
        user_library_base: str,
        places_roots: Dict[str, str],
        library: Optional[LiveLibrary] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._browser = browser
        self._user_library_base = user_library_base
        self._library = library or LiveLibrary()
        self._clock = clock
        # Live's own Places first (the sidebar), then an older config's
        # entries where they add a name Live's file lacks.
        merged: Dict[str, str] = dict(self._library.places_by_name())
        for name, root in places_roots.items():
            merged.setdefault(name, root)
        self._places_roots = {
            name: os.path.normpath(root).rstrip(os.sep)
            for name, root in merged.items() if root
        }
        self._packs: Dict[str, str] = {
            name: os.path.normpath(root).rstrip(os.sep)
            for name, root in self._library.packs_by_name().items() if root
        }
        bases: List[str] = []
        for b in (user_library_base, self._library.user_library):
            if b:
                nb = os.path.normpath(b).rstrip(os.sep)
                if nb not in bases:
                    bases.append(nb)
        self._user_library_bases = bases

        # Per-root cache: ``segments_tuple → BrowserItem``. Populated by
        # :meth:`_build_root` on first access for that root. ``_built``
        # tracks completion so we don't rebuild after a successful walk
        # (and so a build error doesn't cause infinite retries);
        # ``_built_at`` is when, for the miss-rebuild cooldown.
        self._caches: Dict[str, Dict[Tuple[str, ...], object]] = {}
        self._built: Dict[str, bool] = {}
        self._built_at: Dict[str, float] = {}

        logger.info(
            "BrowserCache: ready (user_library=%r, places=%r, packs=%d)",
            self._user_library_bases, sorted(self._places_roots.keys()), len(self._packs),
        )

    # --- public API -------------------------------------------------------

    def lookup(self, preset_path: str) -> Optional[object]:
        """Return the loadable ``BrowserItem`` for ``preset_path``, or ``None``.

        Determines which root the path belongs to (User Library or one
        of the configured Places), builds that root's cache lazily on
        first call, then does an O(1) dict lookup. Returns ``None`` on
        any miss (root not configured, leaf not in browser, build
        failed) — the caller emits the wire error.
        """
        norm = os.path.normpath(preset_path)

        # A path inside the User Library resolves through the library, even
        # when a Place holds it: ``user_folders`` omits a Place inside the
        # User Library (browser-places plan, Phase 0; on the rig all seven
        # Sidebar Places missed there), so asking it first only cost a
        # failed search and three warnings a load. Any other Place, a Pack's
        # subfolder included, resolves through the Place.
        match = self._match_place(norm)
        base = self._match_user_library(norm)
        if match is not None and base is None:
            display_name, fs_root = match
            tail = norm[len(fs_root) + 1:]
            return self._lookup_in_root(
                "user_folders[%r]" % display_name, tail, preset_path, place=display_name,
            )
        if base is not None:
            tail = norm[len(base) + 1:]
            return self._lookup_in_root("user_library", tail, preset_path)

        pack = self._match_pack(norm)
        if pack is not None:
            pack_name, fs_root = pack
            tail = norm[len(fs_root) + 1:]
            return self._lookup_in_root(
                "packs[%r]" % pack_name, tail, preset_path, pack=pack_name,
            )

        logger.warning(
            "BrowserCache: preset path outside the User Library "
            "(%r not under %r), no matching Place in %r and no Pack — "
            "unsupported root",
            norm, self._user_library_bases, sorted(self._places_roots.keys()),
        )
        return None

    def lookup_named(self, source: str, rel: str) -> Optional[object]:
        """The loadable ``BrowserItem`` at ``rel`` inside ``source`` — a load
        that names its Place (protocol 3.11.0): ``place:<name>``,
        ``library`` or ``pack:<name>``. ``None`` on a miss, as ``lookup``.
        """
        tail = rel.strip("/")
        if not tail:
            return None
        if source == SOURCE_LIBRARY:
            return self._lookup_in_root("user_library", tail, rel)
        if source.startswith(SOURCE_PLACE_PREFIX):
            name = source[len(SOURCE_PLACE_PREFIX):]
            root = self._places_roots.get(name)
            # A Place inside the User Library is not in ``user_folders`` (the
            # rig's seven Sidebar Places all missed there, "Vamp Devices"
            # outside it did not): go straight to the User Library by path.
            if root and self._match_user_library(root):
                return self.lookup(os.path.join(root, tail))
            item = self._lookup_in_root("user_folders[%r]" % name, tail, rel, place=name)
            if item is not None:
                return item
            # Not in ``user_folders``: one Live no longer lists. By path,
            # through whatever root holds it.
            return self.lookup(os.path.join(root, tail)) if root else None
        if source.startswith(SOURCE_PACK_PREFIX):
            name = source[len(SOURCE_PACK_PREFIX):]
            return self._lookup_in_root("packs[%r]" % name, tail, rel, pack=name)
        logger.warning("BrowserCache: unknown source %r", source)
        return None

    def root_path(self, source: str) -> Optional[str]:
        """The folder a ``source`` names on disk, or ``None``."""
        if source == SOURCE_LIBRARY:
            return self._user_library_bases[0] if self._user_library_bases else None
        if source.startswith(SOURCE_PLACE_PREFIX):
            return self._places_roots.get(source[len(SOURCE_PLACE_PREFIX):])
        if source.startswith(SOURCE_PACK_PREFIX):
            return self._packs.get(source[len(SOURCE_PACK_PREFIX):])
        return None

    def has_place(self, name: str) -> bool:
        """Whether Live's sidebar (or the config) lists a Place of this name."""
        return name in self._places_roots

    def invalidate(self) -> None:
        """Drop every cached root. Next ``lookup`` rebuilds on demand.

        Currently only called by tests; left public so a future
        browser-changed signal (if Live ever exposes one) can wire in
        without touching call sites.
        """
        self._caches.clear()
        self._built.clear()
        self._built_at.clear()

    # --- internal: lookup -------------------------------------------------

    def _match_user_library(self, norm_path: str) -> Optional[str]:
        best: Optional[str] = None
        for base in self._user_library_bases:
            if norm_path.startswith(base + os.sep) and (best is None or len(base) > len(best)):
                best = base
        return best

    def _match_pack(self, norm_path: str) -> Optional[Tuple[str, str]]:
        best: Optional[Tuple[str, str]] = None
        for name, root in self._packs.items():
            if norm_path.startswith(root + os.sep) and (best is None or len(root) > len(best[1])):
                best = (name, root)
        return best

    def _match_place(self, norm_path: str) -> Optional[Tuple[str, str]]:
        """Return ``(display_name, fs_root)`` for the Place owning ``norm_path``.

        Exact-prefix match against ``fs_root + os.sep``. Returns the
        longest match if multiple Places overlap, so a specific Place
        wins over a generic parent.
        """
        best: Optional[Tuple[str, str]] = None
        for display_name, fs_root in self._places_roots.items():
            if norm_path.startswith(fs_root + os.sep):
                if best is None or len(fs_root) > len(best[1]):
                    best = (display_name, fs_root)
        return best

    def _lookup_in_root(
        self,
        root_label: str,
        tail: str,
        original_path: str,
        place: Optional[str] = None,
        pack: Optional[str] = None,
    ) -> Optional[object]:
        if not self._built.get(root_label):
            self._build_root(root_label, place, pack)

        segments = tuple(browser_name(s) for s in tail.split(os.sep) if s)
        if not segments:
            logger.warning(
                "BrowserCache: empty segment list for %r [root=%s]",
                original_path, root_label,
            )
            return None

        item = self._find(root_label, segments)
        if item is not None:
            return item

        # A miss: Live may have listed the file (or the Place) since this
        # root was walked. Walk it once more, no more often than the
        # cooldown, and look again (onboarding.plan.md §6.4).
        built_at = self._built_at.get(root_label, 0.0)
        if self._clock() - built_at >= REBUILD_COOLDOWN_S:
            logger.info(
                "BrowserCache: %r missed in %s; walking it again",
                original_path, root_label,
            )
            self._build_root(root_label, place, pack)
            item = self._find(root_label, segments)
            if item is not None:
                return item

        logger.warning(
            "BrowserCache: %r not found in %s cache (%d entries)",
            original_path, root_label, len(self._caches.get(root_label, {})),
        )
        return None

    def _find(self, root_label: str, segments: Tuple[str, ...]) -> Optional[object]:
        cache = self._caches.get(root_label, {})
        item = cache.get(segments)
        if item is not None:
            return item
        # Stem-stripped leaf: Live strips Ableton-native extensions from
        # BrowserItem display names. The cache stores keys as Live
        # exposes them, so we need to strip the leaf's extension if it
        # matches an Ableton-native suffix.
        base, ext = os.path.splitext(segments[-1])
        if ext.lower() in _ABLETON_NATIVE_EXTS:
            return cache.get(segments[:-1] + (base,))
        return None

    # --- internal: build --------------------------------------------------

    def _build_root(self, root_label: str, place: Optional[str], pack: Optional[str] = None) -> None:
        """Populate the cache for ``root_label``.

        ``place`` is the Place display name when ``root_label`` is a
        ``user_folders[...]`` key, ``pack`` the Pack's when it is a
        ``packs[...]`` key, both ``None`` for the User Library root.
        """
        # Mark built up-front so a partial walk doesn't trigger infinite
        # retries on the same broken tree. A second load against a missed
        # path will still see ``None`` and surface the wire error — until
        # the cooldown passes and ``_lookup_in_root`` walks once more.
        self._built[root_label] = True
        self._built_at[root_label] = self._clock()
        self._caches[root_label] = {}

        root_node = self._resolve_root_node(root_label, place, pack)
        if root_node is None:
            return

        cache = self._caches[root_label]
        try:
            self._walk(root_node, (), cache, root_label)
        except _LOM_ERRORS as e:
            logger.warning(
                "BrowserCache: walk of %s raised: %s: %s",
                root_label, type(e).__name__, e,
            )

        logger.info(
            "BrowserCache: built %s with %d entries",
            root_label, len(cache),
        )

    def _resolve_root_node(self, root_label: str, place: Optional[str], pack: Optional[str] = None):
        """Return the top-level browser node for the root, or ``None``."""
        if pack is not None:
            return self._find_top(getattr(self._browser, "packs", None), pack, "packs")
        if place is None:
            try:
                node = self._browser.user_library
            except _LOM_ERRORS as e:
                logger.warning(
                    "BrowserCache: browser.user_library raised %s: %s",
                    type(e).__name__, e,
                )
                return None
            if node is None:
                logger.warning("BrowserCache: browser.user_library is None")
            return node

        # Place root — find the matching top-level entry by display name.
        try:
            user_folders = self._browser.user_folders
        except _LOM_ERRORS as e:
            logger.warning(
                "BrowserCache: browser.user_folders raised %s: %s",
                type(e).__name__, e,
            )
            return None
        if user_folders is None:
            logger.warning(
                "BrowserCache: browser.user_folders is None (Place %r "
                "configured but sidebar exposes nothing)", place,
            )
            return None

        try:
            for top in user_folders:
                try:
                    if top.name == place:
                        return top
                except _LOM_ERRORS:
                    continue
        except _LOM_ERRORS as e:
            logger.warning(
                "BrowserCache: iterating user_folders raised %s: %s",
                type(e).__name__, e,
            )
            return None

        logger.warning(
            "BrowserCache: Place %r not found in browser.user_folders",
            place,
        )
        return None

    def _find_top(self, root, name: str, what: str):
        """The child of ``root`` (``browser.packs``…) named ``name``, or ``None``."""
        if root is None:
            logger.warning("BrowserCache: browser.%s is None (%r asked for)", what, name)
            return None
        try:
            for top in list(root.children or ()):
                try:
                    if top.name == name:
                        return top
                except _LOM_ERRORS:
                    continue
        except _LOM_ERRORS as e:
            logger.warning(
                "BrowserCache: iterating browser.%s raised %s: %s", what, type(e).__name__, e,
            )
            return None
        logger.warning("BrowserCache: %r not found in browser.%s", name, what)
        return None

    def _walk(
        self,
        node,
        prefix: Tuple[str, ...],
        cache: Dict[Tuple[str, ...], object],
        root_label: str,
        depth: int = 0,
    ) -> None:
        """DFS-walk ``node``, recording every loadable leaf in ``cache``.

        ``prefix`` is the segment path from root to ``node`` (not
        including ``node`` itself for the root call).

        We do not recurse past loadable leaves: in Live's tree, a
        loadable item is the addressable unit. Devices like Drum Racks
        contain inner chains/devices but those aren't reachable through
        the User Library descent path (and aren't the target of a
        filesystem-keyed load).
        """
        if len(cache) >= _MAX_ENTRIES_PER_ROOT:
            return
        if depth > _MAX_WALK_DEPTH:
            logger.warning(
                "BrowserCache: max walk depth (%d) exceeded at %r "
                "[root=%s] — pruning subtree (possible cycle or malformed "
                "LOM browser entry)",
                _MAX_WALK_DEPTH, prefix, root_label,
            )
            return

        try:
            children = list(node.children or ())
        except _LOM_ERRORS as e:
            logger.warning(
                "BrowserCache: children access raised at %r [root=%s]: "
                "%s: %s", prefix, root_label, type(e).__name__, e,
            )
            return

        for child in children:
            try:
                name = child.name
            except _LOM_ERRORS:
                continue
            if not name:
                continue

            child_prefix = prefix + (unicodedata.normalize("NFC", name),)

            try:
                is_loadable = bool(child.is_loadable)
            except _LOM_ERRORS:
                is_loadable = False

            if is_loadable:
                cache[child_prefix] = child
                continue

            self._walk(child, child_prefix, cache, root_label, depth + 1)
            if len(cache) >= _MAX_ENTRIES_PER_ROOT:
                logger.warning(
                    "BrowserCache: %s exceeded entry cap (%d) — "
                    "halting walk", root_label, _MAX_ENTRIES_PER_ROOT,
                )
                return
