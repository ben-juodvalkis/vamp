"""Load project constants from ``config/constants.json``.

The surface runs inside Live's embedded Python, loaded from a symlink
at ``<User Library>/Remote Scripts/Vamp`` (installed
by ``install.sh``) that points back at
``<repo>/surface/``. This module resolves that real
path and walks up to find ``<repo>/config/constants.json`` — the
single source of truth called out in the project CLAUDE.md — and lays
this Mac's ``config/constants.local.json`` over it when there is one.

Why not hardcode ports: the constants file is shared across Python,
Node.js (bridge), and Max/MSP. Hardcoding them in any one place
creates a silent drift hazard the bridge ↔ surface handshake cannot
survive.

Fallback: if ``constants.json`` can't be read (file missing, symlink
broken, unreadable), return a small dict of hardcoded defaults and
log an ERROR so the operator notices. A surface that silently binds
to a wrong port would be much harder to diagnose than one that binds
to a wrong port with a loud error in Log.txt.
"""

import json
import logging
import os

logger = logging.getLogger("looping")

# Hardcoded fallbacks. Only used if ``constants.json`` is unreachable.
# The values must match ``config/constants.json`` — drift here is a
# bug, but a loud one (the error log below ensures operator notice).
#
# Naming convention matches constants.json (bridge-centric):
# ``localPort`` is where the bridge binds (11021), ``remotePort`` is
# where the surface binds (11020). ``LoopingSurface.py`` handles the
# inversion — see the naming note there.
_FALLBACK = {
    "pythonSurface": {
        "localPort": 11021,
        "remotePort": 11020,
        "host": "127.0.0.1",
    },
}


def _find_constants_path():
    """Walk up from this file to find ``config/constants.json``.

    Returns the absolute path, or ``None`` if not found. Uses
    ``realpath`` so the symlink installed into the Remote Scripts
    directory resolves to the actual repo location.
    """
    here = os.path.dirname(os.path.realpath(__file__))
    # Expected repo layout:
    #   <repo>/surface/  <- `here`
    #   <repo>/config/constants.json     <- target
    # Walk up to 5 levels to be safe against minor reorgs.
    current = here
    for _ in range(5):
        candidate = os.path.join(current, "config", "constants.json")
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


def merge(base, local):
    """``base`` with ``local`` laid over it: dicts merge key by key, anything
    else replaces. The same merge as the bridge's
    ``interface/bridge/utils/constants.js``. Neither argument is modified."""
    if not isinstance(base, dict) or not isinstance(local, dict):
        return local
    out = dict(base)
    for key, value in local.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            out[key] = merge(base[key], value)
        else:
            out[key] = value
    return out


def load():
    """Return the constants dict — ``config/constants.json`` with this Mac's
    ``config/constants.local.json`` laid over it — falling back on read
    failure.

    The returned dict is guaranteed to include a ``pythonSurface``
    key with ``localPort`` / ``remotePort`` / ``host``. Callers that
    need other sections should not assume they exist without checking
    — the fallback is deliberately minimal.
    """
    path = _find_constants_path()
    if path is None:
        logger.error(
            "constants.json not found — using hardcoded fallback ports. "
            "Check that the Remote Scripts symlink still points at the "
            "repo (run surface/install.sh to repair).",
        )
        return {"osc": _FALLBACK}

    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (IOError, OSError, ValueError) as e:
        logger.error(
            "constants.json at %s failed to load (%s) — using fallback ports.",
            path, e,
        )
        return {"osc": _FALLBACK}

    # This Mac's differences, gitignored (general-release plan.md §3). A
    # local file that can't be read leaves the tracked defaults: logged
    # loudly, since the owner's rig then runs as the general edition.
    local_path = os.path.join(os.path.dirname(path), "constants.local.json")
    if os.path.isfile(local_path):
        try:
            with open(local_path, "r") as f:
                data = merge(data, json.load(f))
            logger.info("Laid %s over the constants", local_path)
        except (IOError, OSError, ValueError) as e:
            logger.error(
                "constants.local.json at %s failed to load (%s) — running on "
                "the tracked defaults alone.",
                local_path, e,
            )

    osc = data.get("osc", {})
    if "pythonSurface" not in osc:
        logger.error(
            "constants.json at %s has no osc.pythonSurface section — "
            "using fallback ports. Gate 1 requires this key; update "
            "config/constants.json.",
            path,
        )
        osc = dict(osc)
        osc["pythonSurface"] = _FALLBACK["pythonSurface"]
        data["osc"] = osc

    logger.info("Loaded constants from %s", path)
    return data


def feature_on(constants, feature_id):
    """Is ``constants.features.<feature_id>`` switched on?

    The surface's half of the bridge's ``readFeatureFlags``
    (``interface/bridge/utils/features.js``; general-release audit §7b):
    only an explicit ``true`` is on. ``false``, a missing entry, a
    missing ``features`` block or a non-boolean are all off, so deleting
    a switch never quietly brings a subsystem back. The surface reads
    each switch once, when it is built — flipping one needs the surface
    re-created (a set load or a Live restart), like any other constant.
    """
    features = constants.get("features") if isinstance(constants, dict) else None
    if not isinstance(features, dict):
        return False
    value = features.get(feature_id)
    if value is not None and not isinstance(value, bool):
        logger.warning(
            "features.%s=%r is not true or false; treated as off",
            feature_id, value,
        )
    return value is True
