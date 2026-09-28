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


def create_instance(c_instance):
    """Entry point Live calls when the surface is selected.

    ``c_instance`` is the opaque handle Live hands every Control
    Surface; it is passed through to the framework base class.
    """
    from .LoopingSurface import LoopingSurface

    return LoopingSurface(c_instance)
