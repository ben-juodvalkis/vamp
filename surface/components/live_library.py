"""live_library — Live's own record of its library, read by the surface.

Onboarding.plan.md §4: the Places in Live's sidebar, its User Library and
its installed Packs all live in the newest ``Library.cfg`` under
``~/Library/Preferences/Ableton/<Live version>/``. Before 2026-09-26 the
surface knew a Place only when ``paths.placesRoots`` in the config named it,
and the User Library only through ``paths.userLibraryBase``; anything else
failed a load as ``not-in-browser``. Reading Live's file makes every Place
loadable by path with nothing typed into a config, and a load that names its
Place (``/looping/v3/track/prepare_for_preset``'s ``source`` and ``rel``,
protocol 3.11.0) needs no path at all.

The file is Live's undocumented format, read here as the interface reads it
(``interface/src/lib/server/libraryCfg.ts``): a missing attribute yields
nothing rather than a throw, and a file that cannot be read yields an empty
library. Measured on the home Mac on 2026-09-26: Live rewrites the file the
moment a Place is added, with Live running.

Also here: where this checkout's ``Vamp Devices`` folder is, derived
from this file's real path (the surface is symlinked into Live's Remote
Scripts folder from ``<repo>/surface``). Permute and
MidiWheels load from it, through the "Vamp Devices" Place when Live has one
and by path through any Place that holds it otherwise.
"""

from __future__ import annotations

import html
import logging
import os
import re
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("looping")

DEFAULT_PREFS_DIR = os.path.join(os.path.expanduser("~"), "Library", "Preferences", "Ableton")

# The sidebar Place this checkout's Max devices are expected under
# (onboarding.plan.md §6.3, §7 step 2). Live names a Place after its folder,
# so this is also the folder's name at the repo root (plan.md §8).
M4L_DEVICES_PLACE = "Vamp Devices"


class LiveLibrary:
    """What one ``Library.cfg`` says. Every path is absolute, no trailing slash."""

    __slots__ = ("cfg_file", "places", "user_library", "packs_folder", "packs")

    def __init__(
        self,
        cfg_file: Optional[str] = None,
        places: Optional[List[Tuple[str, str]]] = None,
        user_library: Optional[str] = None,
        packs_folder: Optional[str] = None,
        packs: Optional[List[Tuple[str, str]]] = None,
    ) -> None:
        self.cfg_file = cfg_file
        #: ``[(display name, path)]`` in the sidebar's order.
        self.places: List[Tuple[str, str]] = list(places or [])
        self.user_library = user_library
        self.packs_folder = packs_folder
        #: ``[(display name, path)]`` of the installed Packs.
        self.packs: List[Tuple[str, str]] = list(packs or [])

    def places_by_name(self) -> Dict[str, str]:
        """Display name → path. On a clash the first (the sidebar's higher) wins."""
        out: Dict[str, str] = {}
        for name, path in self.places:
            out.setdefault(name, path)
        return out

    def packs_by_name(self) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for name, path in self.packs:
            out.setdefault(name, path)
        return out


def _attr(tag: str, name: str) -> Optional[str]:
    m = re.search(r'\s%s="([^"]*)"' % re.escape(name), tag)
    return html.unescape(m.group(1)) if m else None


def _clean(path: str) -> str:
    return path.rstrip("/") or "/"


def parse_library_cfg(xml: str, cfg_file: Optional[str] = None) -> LiveLibrary:
    """Parse a ``Library.cfg``'s text."""
    places: List[Tuple[str, str]] = []
    for m in re.finditer(r"<UserFolderInfo\b[^>]*>", xml):
        path = _attr(m.group(0), "Path")
        if not path or not path.startswith("/"):
            continue
        name = _attr(m.group(0), "DisplayName") or os.path.basename(_clean(path))
        places.append((name, _clean(path)))
    packs: List[Tuple[str, str]] = []
    for m in re.finditer(r"<LibrarySliceInfo\b[^>]*>", xml):
        path = _attr(m.group(0), "Path")
        if not path or not path.startswith("/"):
            continue
        name = _attr(m.group(0), "DisplayName") or os.path.basename(_clean(path))
        packs.append((name, _clean(path)))
    user_library = None
    project = re.search(r"<LibraryProject\b[^>]*>([\s\S]*?)</LibraryProject>", xml)
    if project:
        d = re.search(r'<ProjectPath\s+Value="([^"]*)"', project.group(1))
        n = re.search(r'<ProjectName\s+Value="([^"]*)"', project.group(1))
        if d and n:
            candidate = os.path.join(html.unescape(d.group(1)), html.unescape(n.group(1)))
            if candidate.startswith("/"):
                user_library = _clean(candidate)
    packs_folder = None
    pf = re.search(r'<PreferredFactoryPacksInstallationPath\s+Value="([^"]*)"', xml)
    if pf:
        p = html.unescape(pf.group(1))
        if p.startswith("/"):
            packs_folder = _clean(p)
    return LiveLibrary(cfg_file, places, user_library, packs_folder, packs)


def newest_library_cfg(prefs_dir: str = DEFAULT_PREFS_DIR) -> Optional[str]:
    """The ``Library.cfg`` Live wrote last, by mtime: the Live in use."""
    try:
        names = os.listdir(prefs_dir)
    except OSError:
        return None
    newest, newest_mtime = None, float("-inf")
    for name in names:
        f = os.path.join(prefs_dir, name, "Library.cfg")
        try:
            mtime = os.stat(f).st_mtime
        except OSError:
            continue
        if mtime > newest_mtime:
            newest, newest_mtime = f, mtime
    return newest


def read_live_library(prefs_dir: str = DEFAULT_PREFS_DIR) -> LiveLibrary:
    """The newest ``Library.cfg``, parsed; an empty library when none reads."""
    f = newest_library_cfg(prefs_dir)
    if not f:
        logger.warning("live_library: no Library.cfg under %r", prefs_dir)
        return LiveLibrary()
    try:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            lib = parse_library_cfg(fh.read(), f)
    except OSError as e:
        logger.warning("live_library: %r unreadable: %s", f, e)
        return LiveLibrary(f)
    logger.info(
        "live_library: %r — %d Places, user library %r, %d Packs",
        f, len(lib.places), lib.user_library, len(lib.packs),
    )
    return lib


def repo_root() -> str:
    """This checkout's root, through the Remote Scripts symlink."""
    here = os.path.dirname(os.path.realpath(__file__))
    # <repo>/surface/components
    return os.path.normpath(os.path.join(here, "..", ".."))


def m4l_devices_root() -> str:
    """``<repo>/Vamp Devices``, where Permute, MidiWheels and Random Start live."""
    return os.path.join(repo_root(), M4L_DEVICES_PLACE)


#: The devices the surface loads on its own, relative to the Vamp Devices folder.
SEQUENCER_REL = os.path.join("Permute", "Permute.amxd")
MIDI_WHEELS_REL = "MidiWheels.amxd"
RANDOM_START_REL = os.path.join("random-start", "random-start.amxd")
#: The groove minted into the Groove Pool when a clip needs one of its own.
GROOVE_REL = os.path.join("Grooves", "Vamp Groove.agr")


def m4l_source() -> str:
    """The ``source`` a load of a repo device names."""
    return "place:" + M4L_DEVICES_PLACE


def device_path(rel: str, configured: Optional[str] = None) -> str:
    """The absolute path of a repo device: a configured path when the config
    still carries one (``devices.<name>.devicePath``, verbatim, as before
    2026-09-26), else the checkout's own copy when it exists, else ''."""
    if isinstance(configured, str) and configured:
        return configured
    derived = os.path.join(m4l_devices_root(), rel)
    return derived if os.path.isfile(derived) else ""
