"""Looping — custom Control Surface.

Live loads this package by calling ``create_instance(c_instance)`` on
import, which builds the full surface: UDP transport (11020 in / 11021
out), the ``/looping/v3/*`` OSC router, and the components under
``components/``.

This docstring used to say the surface "does nothing beyond logging
that it loaded: no UDP bind, no components, no OSC router" — true of
the Gate 0 bootstrap it was written for, and never updated as the
gates landed. The migration is archived at
Looping's ``documentation/archive/m4l-to-python/``; the live contract is
``docs/reference/wire-protocol.md``.

The ``LoopingSurface`` import is deferred into ``create_instance`` so
that merely importing this package does not pull in
``ableton.v3.control_surface`` — which only exists inside Live's
embedded interpreter. That matters for two readers:

- pytest's test collection, which imports ancestor ``__init__.py``
  files while resolving rootdir package identity.
- any IDE / type checker running against a normal CPython.

Live calls ``create_instance`` after the import completes, so the
deferred import has no runtime cost in the DAW.
"""


import sys

# Reload without restarting Live (2026-10-01). Live imports this package
# once; re-selecting the surface in Settings (or File > Open) disconnects
# the instance and calls ``create_instance`` again, but every module is
# still in ``sys.modules``, so the new instance runs the old code. The
# ``/looping/probe/reload_on_reselect`` probe arms this flag; the next
# ``create_instance`` drops this package's submodules first, so the
# instance it builds imports the edited files.
#
# Purged here, never by the probe itself: the running instance imports
# some modules lazily (at call time), and a purge under it would mix old
# and new code in one instance. By the time ``create_instance`` runs,
# Live has already disconnected the old one.
#
# The flag lives in this module, which is never purged. A change to this
# file, to the transports' socket handling, or to ``disconnect`` still
# wants a full restart: the old teardown is what runs.
_reload_armed = False


def request_reload():
    """Arm a fresh import for the next ``create_instance``.

    Returns how many of this package's submodules are loaded now, which
    the probe reports so a caller can see the purge has work to do.
    """
    global _reload_armed
    _reload_armed = True
    return len(_submodule_names())


def _submodule_names():
    prefix = __name__ + "."
    return [name for name in list(sys.modules) if name.startswith(prefix)]


def _purge_submodules():
    """Drop this package's submodules from ``sys.modules``; return the count."""
    import importlib

    names = _submodule_names()
    for name in names:
        del sys.modules[name]
    importlib.invalidate_caches()
    return len(names)


def create_instance(c_instance):
    """Entry point Live calls when the surface is selected.

    ``c_instance`` is the opaque handle Live hands every Control
    Surface; it is passed through to the framework base class.
    """
    global _reload_armed
    if _reload_armed:
        _reload_armed = False
        import logging

        logging.getLogger("looping").info(
            "reload_on_reselect: purged %d modules; importing fresh", _purge_submodules()
        )

    from .LoopingSurface import LoopingSurface

    return LoopingSurface(c_instance)
