#!/usr/bin/env python3
"""Slice a raw OSC tap NDJSON log into per-flow JSON fixtures.

The bridge's OSC tap (interface/bridge/utils/oscTap.js) writes one
JSON object per line — every observed OSC message — into a single
session file. This tool chops that raw log at flow boundaries and
writes per-flow JSON fixtures into tests/fixtures/flows/.

Usage:

    cd surface && python ../owner/probes/slice_fixtures.py tests/fixtures/raw/<session>.ndjson

Flow boundaries are marked by lines the operator inserts into the log
by hitting a bridge endpoint (TODO — not yet wired) or, for now, by
supplying them in a companion `<session>.boundaries.json` file of the
shape:

    [
      {"flow": "connect-to-live", "start_ts": 0, "end_ts": 4200},
      {"flow": "create-audio-track", "start_ts": 4200, "end_ts": 5800},
      ...
    ]

Where timestamps are the `ts` field of the first/last message in each
flow (inclusive start, exclusive end). If no boundaries file is
present, the slicer emits one fixture per input file with the session
name as the flow name — useful for quick one-flow captures.

No external dependencies; run with the system Python.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional


def _read_ndjson(path: Path) -> List[dict]:
    out: List[dict] = []
    with path.open() as f:
        for i, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"[slice] skipped line {i}: {e}", file=sys.stderr)
    return out


def _read_boundaries(raw_path: Path) -> Optional[List[dict]]:
    bpath = raw_path.with_suffix(".boundaries.json")
    if not bpath.exists():
        return None
    with bpath.open() as f:
        return json.load(f)


def _slice(messages: List[dict], boundaries: List[dict]) -> Dict[str, List[dict]]:
    flows: Dict[str, List[dict]] = {}
    for b in boundaries:
        name = b["flow"]
        start = b["start_ts"]
        end = b["end_ts"]
        flows[name] = [m for m in messages if start <= m.get("ts", 0) < end]
    return flows


def _write_fixture(out_dir: Path, flow: str, messages: List[dict], captured_at: str) -> Path:
    safe = flow.replace("/", "_").replace(" ", "-")
    path = out_dir / f"{safe}.json"
    payload = {
        "flow": flow,
        "captured_at": captured_at,
        "messages": messages,
    }
    with path.open("w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    return path


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("raw", type=Path, help="raw NDJSON tap log")
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output dir (default: <raw>/../../flows)",
    )
    args = p.parse_args(argv)

    raw_path: Path = args.raw
    if not raw_path.exists():
        print(f"[slice] {raw_path} does not exist", file=sys.stderr)
        return 2

    out_dir: Path = args.out or (raw_path.parent.parent / "flows")
    out_dir.mkdir(parents=True, exist_ok=True)

    messages = _read_ndjson(raw_path)
    if not messages:
        print(f"[slice] {raw_path} had no messages", file=sys.stderr)
        return 1

    captured_at = raw_path.stem  # e.g. "2026-04-12"

    boundaries = _read_boundaries(raw_path)
    if boundaries is None:
        flow_name = raw_path.stem
        path = _write_fixture(out_dir, flow_name, messages, captured_at)
        print(f"[slice] wrote {path} ({len(messages)} messages)")
        return 0

    flows = _slice(messages, boundaries)
    for flow, msgs in flows.items():
        path = _write_fixture(out_dir, flow, msgs, captured_at)
        print(f"[slice] wrote {path} ({len(msgs)} messages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
