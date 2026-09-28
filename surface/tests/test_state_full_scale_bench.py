"""One-off scale benchmark for V3 state/full emission.

Simulates a 20-track / 4-devices-per-track session with realistic
param counts (macros, operator-sized, filter/utility). Measures
``_build_payload`` and the ETag digest, and prints record counts,
tree size, and per-stage timings.

The chunk-count and per-chunk-byte columns retired with protocol
3.6.0: the tree leaves as one message over the ordered stream, so
there is nothing left to split and no datagram ceiling to respect.

Run with:  pytest tests/test_state_full_scale_bench.py -s
"""

from __future__ import annotations

import time
from typing import List

from components.GenerationComponent import GenerationComponent
from components.V3StateFullComponent import (
    V3StateFullComponent,
    _compute_checksum,
)
from tests.support.fake_stream import FakeStream
from tests.test_lom_listeners import (
    StubDevice,
    StubParam,
    StubSong,
    StubTrack,
)


def _make_device(did: int, kind: str) -> StubDevice:
    """kind ∈ {'rack','operator','utility','eq8'} — realistic param counts."""
    if kind == "rack":
        params = [StubParam(pid=did * 1000 + i, name="Macro %d" % i,
                            value=0.25, min_v=0.0, max_v=1.0)
                  for i in range(8)]
        return StubDevice(did=did, params=params, name="Drum Rack",
                          class_name="DrumGroupDevice")
    if kind == "operator":
        params = [StubParam(pid=did * 1000 + i,
                            name="Op Param %d" % i,
                            value=0.5, min_v=0.0, max_v=1.0)
                  for i in range(195)]
        return StubDevice(did=did, params=params, name="Operator",
                          class_name="Operator")
    if kind == "utility":
        params = [StubParam(pid=did * 1000 + i,
                            name="U %d" % i,
                            value=0.5, min_v=0.0, max_v=1.0)
                  for i in range(6)]
        return StubDevice(did=did, params=params, name="Utility",
                          class_name="Utility")
    if kind == "eq8":
        params = [StubParam(pid=did * 1000 + i,
                            name="EQ %d" % i,
                            value=0.5, min_v=0.0, max_v=1.0)
                  for i in range(48)]
        return StubDevice(did=did, params=params, name="EQ Eight",
                          class_name="Eq8")
    raise ValueError(kind)


def _build_scaled_song(num_tracks: int, device_mix: List[str]) -> StubSong:
    """device_mix: list of 4 kinds to place on every track."""
    tracks: List[StubTrack] = []
    next_id = 1
    for t_idx in range(num_tracks):
        devices = []
        for kind in device_mix:
            devices.append(_make_device(next_id, kind))
            next_id += 1
        tracks.append(StubTrack(tid=10_000 + t_idx, devices=devices,
                                name="Track %d" % t_idx))
    master = StubTrack(tid=9_000_001, devices=[], name="Master")
    return StubSong(tracks=tracks, master=master)


def _run_scenario(label: str, song: StubSong) -> None:
    emits: list = []
    gen = GenerationComponent()
    gen.advance("bench")
    # A connected stream, because since 3.6.0 that is the only wire
    # ``state/full`` has — without one the publish warns and holds and
    # the end-to-end timings below would measure nothing.
    stream = FakeStream(connected=True, sink=emits)
    comp = V3StateFullComponent(
        song=song,
        emit=lambda addr, args: emits.append((addr, args)),
        generation_component=gen,
        stream=stream,
    )

    # Warm JIT-ish caches, then time the two phases separately.
    comp._build_payload()

    t0 = time.perf_counter()
    tree_args = comp._build_payload()
    t1 = time.perf_counter()
    checksum = _compute_checksum(tree_args)
    t3 = time.perf_counter()

    # End-to-end emit via the public path. This is the *cold* path:
    # the memo is empty, so it walks and folds.
    emits.clear()
    t4 = time.perf_counter()
    comp.emit_on_accept()
    t5 = time.perf_counter()
    cold_messages = len(emits)

    # Repeat publish against an unchanged tree — the case the memo
    # exists for, and the one a reconnect actually hits. ``accept``
    # bypasses the skip short-circuit by design (the UI is waiting on
    # it), so this still ships the whole tree; what it must NOT do is
    # re-fold a tree we already hashed.
    emits.clear()
    t6 = time.perf_counter()
    comp.emit_on_accept()
    t7 = time.perf_counter()

    # And the skip path: a structural fire on an unchanged tree, which
    # short-circuits before touching the wire at all.
    emits.clear()
    t8 = time.perf_counter()
    comp.on_structural_change()
    t9 = time.perf_counter()
    skipped = not emits

    # Count records by tag.
    tag_counts = {"T": 0, "D": 0, "P": 0, "S": 0, "C": 0}
    i = 0
    # Arities per [04 §5]. These drifted once already — T grew 9 -> 13
    # (ADR-410) and D shrank 4 -> 3 (ROW 5) without this copy moving,
    # so the walk bailed on the first record and the bench reported
    # "T=1 D=0 P=0" for years.
    # This copy has now drifted TWICE: T grew 9 -> 13 (ADR-410) and D
    # shrank 4 -> 3 (ROW 5) without it moving, and then T grew 13 -> 14
    # (role, 3.7.0) in the same breath as the first fix. Both times the
    # walk bailed on the first record and the bench cheerfully printed
    # "T=1 D=0 P=0" for a 41,755-element tree.
    #
    # The number is not really the bug — a duplicated constant drifting
    # is inevitable. The bug is that it drifted **silently**, so the
    # assertion below is the actual fix: a mismatched arity now fails
    # the bench instead of quietly reporting nonsense.
    # 3.9.0 (ADR-439) grew T 14 -> 15 (preset), moved here in the same commit.
    arity = {"T": 15, "D": 3, "P": 7, "S": 2, "C": 5}
    while i < len(tree_args):
        tag = tree_args[i]
        if tag in tag_counts:
            tag_counts[tag] += 1
            i += 1 + arity[tag]
        else:
            break

    assert i == len(tree_args), (
        "record walk consumed %d of %d tree_args — an arity in this "
        "table no longer matches the emitter. The counts below would be "
        "nonsense; fix the table rather than trusting them." % (
            i, len(tree_args),
        )
    )

    print("\n=== %s ===" % label)
    print("  records:       T=%d D=%d P=%d S=%d C=%d"
          % (tag_counts["T"], tag_counts["D"], tag_counts["P"],
             tag_counts["S"], tag_counts["C"]))
    print("  tree_args:     %d elements" % len(tree_args))
    print("  messages:      %d (one state/full/tree per publish)" % cold_messages)
    print("  timings (ms):")
    print("    _build_payload:      %.2f" % ((t1 - t0) * 1000))
    print("    _compute_checksum:   %.2f" % ((t3 - t1) * 1000))
    print("    emit_on_accept cold:  %.2f" % ((t5 - t4) * 1000))
    print("    emit_on_accept memo:  %.2f  (unchanged tree, still ships)"
          % ((t7 - t6) * 1000))
    print("    structural skipped:   %.2f  (short-circuit, wire silent: %s)"
          % ((t9 - t8) * 1000, skipped))
    print("  etag: 0x%08x" % (checksum & 0xFFFFFFFF))


def test_scale_bench_20x4_light():
    """20 tracks, 4 light devices each (rack+utility+eq8+utility)."""
    song = _build_scaled_song(20, ["rack", "utility", "eq8", "utility"])
    _run_scenario("20 tracks × 4 devices (light: rack/utility/eq8/utility)", song)


def test_scale_bench_20x4_heavy():
    """20 tracks, 4 devices each, one Operator per track (worst-case-ish)."""
    song = _build_scaled_song(20, ["operator", "rack", "eq8", "utility"])
    _run_scenario("20 tracks × 4 devices (heavy: operator/rack/eq8/utility)", song)


def test_scale_bench_20x4_pathological():
    """20 tracks, 4 Operators each (pathological ceiling)."""
    song = _build_scaled_song(20, ["operator"] * 4)
    _run_scenario("20 tracks × 4 Operators (pathological)", song)


def test_scale_bench_baseline_3x1():
    """Baseline: 3 tracks, 1 device each — comparable to prior measurement."""
    song = _build_scaled_song(3, ["rack"])
    _run_scenario("3 tracks × 1 rack (baseline)", song)
