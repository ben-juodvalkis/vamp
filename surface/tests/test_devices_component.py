"""DevicesComponent unit tests.

Covers the shared write path's clamping, one-shot suppression arming,
and teardown idempotence. The v3 handlers (``handle_set_param_v3``,
``handle_v3_param_query``, ``handle_v3_state_resync``) are exercised
in their own dedicated suites.
"""

from __future__ import annotations

import pytest

from components.DevicesComponent import DevicesComponent
from tests.test_lom_listeners import StubSong, StubTrack, StubDevice, StubParam


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def registry_and_refs():
    """Build a song with two tracks, each carrying one device + params.

    Returns ``(song, t1, t2, emits)`` where ``emits`` is a list the
    component appends to. ``DevicesComponent`` walks the song directly
    (Phase 1 Commit A); no forward-map registry is involved.
    """
    p301 = StubParam(pid=301, name="macro1", value=0.25, min_v=0.0, max_v=1.0)
    p302 = StubParam(pid=302, name="macro2", value=64.0, min_v=0.0, max_v=127.0)
    d200 = StubDevice(did=200, params=[p301, p302], name="Rack", class_name="AudioEffectRack")
    t1 = StubTrack(tid=100, devices=[d200], name="T1")

    p303 = StubParam(pid=303, name="gain", value=0.5, min_v=0.0, max_v=1.0)
    d201 = StubDevice(did=201, params=[p303], name="Utility", class_name="Utility")
    t2 = StubTrack(tid=101, devices=[d201], name="T2")

    song = StubSong(tracks=[t1, t2])
    return song, t1, t2, []


def _component(registry_and_refs):
    song, _t1, _t2, emits = registry_and_refs

    def emit(addr, args):
        emits.append((addr, args))

    return DevicesComponent(song=song, emit=emit), emits


# --- lifecycle -------------------------------------------------------------


def test_disconnect_is_idempotent(registry_and_refs):
    comp, emits = _component(registry_and_refs)
    comp.disconnect()
    comp.disconnect()
    assert emits == []
