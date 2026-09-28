"""Per-class device-property paths from ``data/device-configs.json``.

The Python surface needs to know which LOM properties to query for
each device class so the canonical state/full tree can carry the
per-device property set for each device type.
``data/device-configs.json`` is the single source of truth for that
mapping; the Python side reads the JSON directly at ``__init__``.

Why a separate module from ``config_loader.py``: that one resolves
``config/constants.json`` (port numbers, paths). This one resolves
``data/device-configs.json`` (per-class device properties). Same
walk-up pattern, different file, different consumer — keeping them
apart prevents one config's failure from masking the other's.

Fallback posture: if ``device-configs.json`` is unreachable or
malformed, return an empty mapping. The state/full publisher will
then emit ``prop_count=0`` for every device — same as a session
with no per-class properties configured. A loud ERROR in the log
flags the operator; the surface stays alive.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Dict, List, Optional

logger = logging.getLogger("looping")


def _find_device_configs_path() -> Optional[str]:
    """Walk up from this file to find ``data/device-configs.json``.

    Returns the absolute path, or ``None`` if not found. Mirrors
    ``config_loader._find_constants_path`` — the Remote Scripts
    symlink is resolved via ``realpath`` so we land in the real
    repo regardless of how the surface was installed.
    """
    here = os.path.dirname(os.path.realpath(__file__))
    # Expected repo layout:
    #   <repo>/surface/  <- `here`
    #   <repo>/data/device-configs.json  <- target
    current = here
    for _ in range(5):
        candidate = os.path.join(current, "data", "device-configs.json")
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


def load_property_paths_by_class() -> Dict[str, List[str]]:
    """Return ``{class_name: [property_path, …]}`` from the configs file.

    Each property's value in the JSON is a small object describing
    type/description; we only need the keys (the dotted LOM paths
    relative to the device, e.g. ``"sample.warp_mode"`` or
    ``"playback_mode"``). Returns an empty dict on any failure —
    the caller treats "no config" as "emit zero properties for
    every device."

    The mapping is class-name keyed (``Compressor2``, ``Simpler``,
    ``DrumGroupDevice``, …) — same key the M4L observer uses to
    look up `getDeviceProperties(className)`.
    """
    path = _find_device_configs_path()
    if path is None:
        logger.error(
            "device-configs.json not found — state/full will emit "
            "prop_count=0 for every device. Check repo layout / "
            "Remote Scripts symlink (run install.sh to repair).",
        )
        return {}

    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (IOError, OSError, ValueError) as e:
        logger.error(
            "device-configs.json at %s failed to load (%s) — "
            "state/full will emit prop_count=0 for every device.",
            path, e,
        )
        return {}

    if not isinstance(data, dict):
        logger.error(
            "device-configs.json at %s isn't a top-level object — "
            "got %s; emitting prop_count=0 for every device.",
            path, type(data).__name__,
        )
        return {}

    out: Dict[str, List[str]] = {}
    for class_name, config in data.items():
        if not isinstance(config, dict):
            continue
        properties = config.get("properties")
        if not isinstance(properties, dict) or not properties:
            continue
        # Property paths are the keys of the inner ``properties``
        # object. Insertion order is preserved (Python 3.7+) so the
        # wire order matches the JSON order — useful for byte-diff
        # tests against fixtures.
        paths = [str(k) for k in properties.keys()]
        if paths:
            out[str(class_name)] = paths

    logger.info(
        "device_property_loader: loaded property paths for %d classes from %s",
        len(out), path,
    )
    return out
