"""Fixture-replay harness skeleton.

Replays per-flow JSON fixtures from `tests/fixtures/flows/` against a
target object that exposes `send(address, args)` and `recv()`. Today
the target is the in-process `StubTarget` in `tests/support/`; at
Gate 0 it swaps for a real Python Control Surface bound to ports
11020/11021.

Fixture schema (one file per flow):

    {
      "flow": "<human-readable flow name>",
      "captured_at": "<ISO-8601 date>",
      "messages": [
        {"ts": 0, "dir": "out", "target": "pythonSurface",
         "address": "/looping/v2/...", "args": [...]},
        {"ts": 12, "dir": "in", "address": "/looping/v2/...",
         "args": [...]},
        ...
      ]
    }

Per §0.1 of the migration plan, this file exists primarily to prove
the harness wiring works end-to-end. Once real fixtures are captured,
they drop into `tests/fixtures/flows/` and `test_replay_all_flows`
picks them up automatically.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

import pytest

from tests.support.stub_target import StubTarget

FLOWS_DIR = Path(__file__).parent / "fixtures" / "flows"


def _load_fixture(path: Path) -> Dict:
    with path.open() as f:
        return json.load(f)


def _replay(fixture: Dict, target: StubTarget) -> List[dict]:
    """Walk a fixture's messages in order, driving the target.

    Returns the list of inbound messages that were delivered to the
    caller (what a real UI would have seen). Outbound messages land
    in `target.sent` for inspection.
    """
    delivered: List[dict] = []
    for msg in fixture["messages"]:
        direction = msg["dir"]
        if direction == "out":
            target.send(msg["address"], msg.get("args", []))
        elif direction == "in":
            popped = target.recv()
            assert popped is not None, (
                f"fixture expected an inbound message at ts={msg.get('ts')}"
                f" but stub queue was empty"
            )
            delivered.append(popped)
        else:
            raise ValueError(f"unknown dir: {direction!r}")
    return delivered


def _discover_fixtures() -> List[Path]:
    if not FLOWS_DIR.exists():
        return []
    return sorted(FLOWS_DIR.glob("*.json"))


class TestHarnessSelfCheck:
    """Exercises the harness against a synthetic fixture.

    Guards against the harness itself regressing while real fixtures
    are being captured. Uses a hand-built dict, not a file.
    """

    def test_outbound_is_recorded(self):
        fixture = {
            "flow": "self-check/outbound",
            "captured_at": "2026-04-12",
            "messages": [
                {"ts": 0, "dir": "out", "target": "pythonSurface",
                 "address": "/looping/v2/ping", "args": [1]},
                {"ts": 5, "dir": "out", "target": "pythonSurface",
                 "address": "/looping/v2/pong", "args": ["x"]},
            ],
        }
        stub = StubTarget.from_fixture(fixture["messages"])
        _replay(fixture, stub)
        assert [m.address for m in stub.sent] == [
            "/looping/v2/ping", "/looping/v2/pong",
        ]
        assert stub.sent[0].args == (1,)

    def test_inbound_is_drained_in_order(self):
        fixture = {
            "flow": "self-check/inbound",
            "captured_at": "2026-04-12",
            "messages": [
                {"ts": 0, "dir": "in",
                 "address": "/looping/v2/track/created",
                 "args": ["t1"]},
                {"ts": 3, "dir": "in",
                 "address": "/looping/v2/track/created",
                 "args": ["t2"]},
            ],
        }
        stub = StubTarget.from_fixture(fixture["messages"])
        delivered = _replay(fixture, stub)
        assert [d["args"][0] for d in delivered] == ["t1", "t2"]
        assert stub.remaining_inbound() == 0

    def test_mixed_directions(self):
        fixture = {
            "flow": "self-check/mixed",
            "captured_at": "2026-04-12",
            "messages": [
                {"ts": 0, "dir": "out", "target": "pythonSurface",
                 "address": "/looping/v2/track/create",
                 "args": ["audio"]},
                {"ts": 4, "dir": "in",
                 "address": "/looping/v2/track/created",
                 "args": ["t1", "audio"]},
            ],
        }
        stub = StubTarget.from_fixture(fixture["messages"])
        delivered = _replay(fixture, stub)
        assert len(stub.sent) == 1
        assert len(delivered) == 1
        assert delivered[0]["address"] == "/looping/v2/track/created"

    def test_unknown_direction_raises(self):
        fixture = {
            "flow": "self-check/bad-dir",
            "captured_at": "2026-04-12",
            "messages": [
                {"ts": 0, "dir": "sideways",
                 "address": "/looping/v2/nope", "args": []},
            ],
        }
        with pytest.raises(ValueError, match="unknown dir"):
            _replay(fixture, StubTarget.from_fixture(fixture["messages"]))


@pytest.mark.parametrize(
    "fixture_path",
    _discover_fixtures(),
    ids=lambda p: p.stem,
)
def test_replay_all_flows(fixture_path: Path):
    """Replay every committed fixture against the stub target.

    Skipped if no fixtures are present yet (expected during §0.1,
    before any flows have been captured).
    """
    fixture = _load_fixture(fixture_path)
    assert "messages" in fixture, f"{fixture_path.name} missing 'messages'"
    stub = StubTarget.from_fixture(fixture["messages"])
    _replay(fixture, stub)


def test_flows_dir_exists():
    """Flows dir exists and is discoverable, even if empty."""
    assert FLOWS_DIR.exists() and FLOWS_DIR.is_dir()
