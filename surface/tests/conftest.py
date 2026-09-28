"""Shared pytest configuration for the surface test suite.

Intentionally minimal while §0.1 scaffolding is the only thing here.
As the bootstrap gates land, this file will grow shared fixtures for
the stub-then-real Control Surface target.
"""

import sys
from pathlib import Path

# The surface package root, so `from components.X import Y` resolves whether
# pytest is invoked from the repo root, from surface/, or by
# the pre-push hook's venv python. Without it, only the second of those works
# — which is why the documented `cd surface && pytest` was the
# only invocation that ran.
_SURFACE_ROOT = str(Path(__file__).resolve().parent.parent)
if _SURFACE_ROOT not in sys.path:
    sys.path.insert(0, _SURFACE_ROOT)


import pytest


@pytest.fixture(autouse=True)
def _no_machine_live_library(monkeypatch):
    """No test reads this Mac's own Library.cfg. DeviceLoadComponent reads
    Live's Places from it when a test passes no ``library``, and a Place on
    the machine then shadows the test's own: the rig's "Samples Organized"
    broke test_load_clip_new_track_follows_a_symlink_into_a_place, which
    passed on a Mac without that Place. A test that wants Places passes them."""
    import components.DeviceLoadComponent as dlc
    from components.live_library import LiveLibrary

    monkeypatch.setattr(dlc, "read_live_library", lambda *a, **k: LiveLibrary())
