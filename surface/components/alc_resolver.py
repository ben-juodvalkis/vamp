"""Resolve an Ableton Live Clip (``.alc``) to the audio file it references.

Pure stdlib — no Live API touches, testable in plain CPython.

An ``.alc`` is a gzipped XML clip file. It does **not** carry the audio
bytes; it carries a *reference* to an underlying ``.wav`` / ``.aif`` via a
``<SampleRef><FileRef>`` block. On the machines we target, factory-pack
clips store **no absolute path** — only:

- ``<Name Value="iphone 3.aif" />`` — the sample's leaf filename.
- a ``<RelativePath>`` list of ``<RelativePathElement Dir="..." />``.

The ``<RelativePath>`` often has two runs concatenated: the *real* relative
path (e.g. ``Samples/Coil Pickup``) followed by the pack's dead authoring
path (e.g. ``private/tmp/trunk/...``). We keep only the leading run and drop
the absolute-authoring tail (see ``_ABS_FALLBACK_ANCHORS``).

Because the exact climb depth from the ``.alc``'s own directory to the pack
root is pack-specific (a clip under ``Clips/Coil Loops`` references a sample
under ``<pack>/Samples/Coil Pickup``), we resolve by an **upward walk**:
starting at the ``.alc``'s directory and climbing toward the filesystem root,
try ``<ancestor>/<relpath>/<name>`` at each level and return the first that
exists on disk. Deterministic, no fuzzy filename matching.

If an absolute ``<Path Value="..."/>`` *is* present and points at a real
file, we trust it directly (some user/factory clips carry one).

**A pack clip copied out of its pack** (the browser's Places are APFS clones,
2026-09-24) has no pack above it to walk to. Its reference is relative to its
pack's root and names the pack (``<LivePackName>``), so the last resort is
``<packs root>/<LivePackName>/<relative path>/<name>`` under each installed
Packs folder the surface configured (``set_pack_roots``, from
``paths.abletonPacksBase``). Measured 2026-09-24 over the Places' 1,099 clips:
908 (Vinyl Classics, Retro Synths, Cyclic Waves, The Forge) resolved only
this way, and every Simpler load of one failed with ``no-file-path`` without
it; the same clips had resolved while they were links into their packs.
"""

from __future__ import annotations

import gzip
import os
import xml.etree.ElementTree as ET
from typing import Iterable, List, Optional

# Directory names that mark the start of a pack's dead absolute authoring
# path stored as relative elements (``/private/tmp/trunk/...``). Everything
# from the first of these onward is dropped from the relative path.
_ABS_FALLBACK_ANCHORS = frozenset({"private", "tmp", "trunk", "Users", "Volumes"})

# Bound the upward walk so a pathological input can't spin to ``/``.
_MAX_CLIMB = 24

# Installed Live Packs folders — ``<root>/<pack name>/…`` — searched for a pack
# clip the upward walk cannot place. Set once by the surface at startup.
_pack_roots: List[str] = []


def set_pack_roots(roots: Iterable[str]) -> None:
    """Configure the Packs folders a pack clip is resolved against."""
    global _pack_roots
    _pack_roots = [r for r in roots if isinstance(r, str) and r]


def _read_xml_text(alc_path: str) -> Optional[str]:
    """Return the decompressed XML text of an ``.alc``, or ``None``.

    ``.alc`` is gzip-compressed. Some very old / hand-edited clips are
    stored as plain XML; fall back to a raw read if gunzip fails.
    """
    try:
        with gzip.open(alc_path, "rb") as f:
            return f.read().decode("utf-8", "replace")
    except OSError:
        # Not gzip (or unreadable as gzip) — try plain XML.
        try:
            with open(alc_path, "rb") as f:
                return f.read().decode("utf-8", "replace")
        except OSError:
            return None


def _first_fileref(root: ET.Element) -> Optional[ET.Element]:
    """Return the first ``<FileRef>`` element under a ``<SampleRef>``.

    Falls back to the first ``<FileRef>`` anywhere if no ``SampleRef``
    wrapper is found (defensive against layout drift across Live versions).
    """
    for sample_ref in root.iter("SampleRef"):
        fr = sample_ref.find("FileRef")
        if fr is not None:
            return fr
    # Fallback: any FileRef.
    return next(iter(root.iter("FileRef")), None)


def _value(el: Optional[ET.Element]) -> Optional[str]:
    """Read a Live ``<Tag Value="..."/>`` attribute, or ``None``."""
    if el is None:
        return None
    v = el.get("Value")
    return v if v else None


def _relative_dirs(file_ref: ET.Element) -> List[str]:
    """Return the leading ``RelativePathElement`` dirs, dropping the
    absolute-authoring fallback run (``private/tmp/trunk/...``)."""
    dirs: List[str] = []
    rel = file_ref.find("RelativePath")
    if rel is None:
        return dirs
    for elem in rel.findall("RelativePathElement"):
        name = elem.get("Dir")
        if not name:
            continue
        if name in _ABS_FALLBACK_ANCHORS:
            break  # start of the dead absolute path — stop here
        dirs.append(name)
    return dirs


def resolve_alc(alc_path: str, pack_roots: Optional[Iterable[str]] = None) -> Optional[str]:
    """Resolve an ``.alc`` clip to the absolute path of its audio sample.

    Returns the audio file path (verified to exist on disk) or ``None`` if
    the ``.alc`` can't be parsed or the sample can't be located.

    Resolution order:
    1. An absolute ``<Path Value>`` in the ``FileRef``, if it exists on disk.
    2. Upward walk: ``<ancestor>/<rel dirs>/<name>`` from the ``.alc``'s own
       directory climbing toward root, first hit wins.
    3. A pack clip: ``<packs root>/<LivePackName>/<rel dirs>/<name>`` under
       each of ``pack_roots`` (default: the roots ``set_pack_roots`` gave).
    """
    if not alc_path or not os.path.isfile(alc_path):
        return None

    xml_text = _read_xml_text(alc_path)
    if not xml_text:
        return None

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    file_ref = _first_fileref(root)
    if file_ref is None:
        return None

    name = _value(file_ref.find("Name"))
    if not name:
        return None

    # 1) Trust an absolute path if one is present and real.
    abs_path = _value(file_ref.find("Path"))
    if abs_path and os.path.isabs(abs_path) and os.path.isfile(abs_path):
        return abs_path

    # 2) Upward walk of the relative tail — from the folder the clip really
    #    sits in first. A symlinked clip's reference is relative to its
    #    target, not to the link (measured 2026-09-24: 0 of the 190 linked
    #    accapella clips resolved from the link's folder, 79 from the
    #    target's); the link's own folder is still tried after.
    rel_dirs = _relative_dirs(file_ref)
    rel_tail = os.path.join(*rel_dirs, name) if rel_dirs else name

    starts = [os.path.dirname(os.path.realpath(alc_path))]
    link_dir = os.path.dirname(os.path.abspath(alc_path))
    if link_dir != starts[0]:
        starts.append(link_dir)
    for start in starts:
        found = _walk_up(start, rel_tail)
        if found:
            return found

    # 3) A pack clip that no longer sits inside its pack: its installed copy.
    pack = _value(file_ref.find("LivePackName"))
    if pack and pack not in (".", "..") and "/" not in pack and os.sep not in pack:
        for root in (_pack_roots if pack_roots is None else pack_roots):
            candidate = os.path.normpath(os.path.join(root, pack, rel_tail))
            if os.path.isfile(candidate):
                return candidate

    return None


def _walk_up(base: str, rel_tail: str) -> Optional[str]:
    """First ``<ancestor>/<rel_tail>`` that exists, climbing from ``base``."""
    for _ in range(_MAX_CLIMB):
        candidate = os.path.normpath(os.path.join(base, rel_tail))
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(base)
        if parent == base:  # reached filesystem root
            break
        base = parent
    return None


def is_alc(path: str) -> bool:
    """True if ``path`` is an Ableton Live Clip by extension."""
    return path.lower().endswith(".alc")
