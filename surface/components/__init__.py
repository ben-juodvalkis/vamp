"""Looping surface v3 components.

Each module here owns one LOM subject area (session, tracks, devices,
clips, …) per the §5 breakdown in
Looping's ``documentation/archive/m4l-to-python/03-target-architecture.md``.

The package is intentionally thin: imports stay at submodule level so
``from .components.SessionComponent import SessionComponent`` doesn't
accidentally drag in framework modules for tests that don't need
them. Gate 2 ships the first entry (SessionComponent, tempo only);
later gates grow the set.
"""
