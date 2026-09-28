# ADR-355: Testing audit — manual checklist, scenario replay, and root-level pass-throughs

## Status

**Accepted** — 2026-04-28.

## Context

Two unrelated symptoms surfaced during the performance-audit work
(PR #379) that traced back to the same gap: we had no shared,
canonical answer to *"how do I know this build is fit to ship to a
gig?"* — only an unstated mix of `npm run test:run`, `pytest`, and
the operator's muscle memory.

### 1. The documented build-verification command didn't work

`CLAUDE.md` § Build Verification told humans and agents alike to run
`npm run test:run` from the repo root before considering a task
complete. That script only existed under `interface/package.json`;
running it from the root failed silently in some shells and
crashed in others. Several recent task closeouts had reported
"tests green" without ever running the suite — the command they
ran printed an `npm error Missing script` and they moved on.

### 2. The perf audit needed a regression harness

The audit (ADR-adjacent doc: `documentation/performance-audit.md`)
landed instrumentation that produces NDJSON dumps per pipeline
layer. To make any "X improved by Y%" claim land, every fix needs
a fixed input shape — otherwise diffs across runs are dominated by
session-to-session noise (which clip is selected, how many devices
are loaded, whether iPad is connected). The audit's methodology
section explicitly turns each fix into a four-step ritual: baseline
→ hypothesis → fix → re-measure with the same scenarios.

### 3. Pre-performance smoke had no checklist

A live-music tool has a hard ship gate the unit suites can't see:
"can the operator walk on stage in 90 minutes and trust this
build?" The bring-up path (bridge → interface → Live → iPad) and
the round-trips that have historically broken silently
(state/full, plugin hydration, clip/scene ops, capture, meters,
recovery) had no shared list. Each operator-or-agent reinvented
the smoke pass, and skipped sections under time pressure.

The unit suites (1278 pytest, 877 vitest at the time of writing)
do not cover any of these — they pin component behavior, not the
across-process contract that breaks when (e.g.) a port collides,
the surface fails to load, or the iPad reconnects mid-state-full.

## Decision

**Three coordinated additions, treated as one decision because they
share the "fit to ship" question and reinforce each other.**

### A. Root-level test pass-throughs

`package.json` at the repo root gains pass-through scripts so the
documented commands actually work:

```json
"test": "cd interface && npm run test",
"test:run": "cd interface && npm run test:run",
"test:coverage": "cd interface && npm run test:coverage"
```

The CLAUDE.md instructions stay unchanged — the surface they
reference now exists. Python tests (`pytest` from
`surface/`) remain a separate command, called out
explicitly in the testing section of CLAUDE.md so neither suite is
silently dropped.

### B. Manual test checklist (`documentation/manual-test-checklist.md`)

A 12-section checklist covering: pre-flight, bring-up, handshake,
tracks, devices+presets, transport+session, clips+scenes, capture,
master+meters, iPad-specific, recovery, perf smoke, tear-down. Each
section is bullet checkboxes the operator marks as they confirm.
Includes a scope-to-section table for partial passes after small
changes (UI-only → §1, §2, §affected, §11; bridge change → §1, §2,
§9–11; wire-protocol bump → all) and a failure-triage section
pointing at the three log files that own 95% of incident root
cause: `logs/bridge.log`, Live's `Log.txt`, browser DevTools.

The checklist is intentionally a checklist, not docs. It pairs with
the architecture/wire-protocol docs rather than restating them.

### C. Scenario replay harness as the regression-test framework for perf

`scripts/perf/scenario.mjs` defines four-and-a-half fixed traffic
shapes (idle, tempo-sweep, param-storm, clip-launch, track-storm)
that connect to the bridge and play a deterministic pattern.
`scripts/perf/analyze.mjs` aggregates the resulting NDJSON dumps
into per-address rates and integrated client fan-out. Together
they let a perf claim cite specific numbers at specific addresses
under a fixed input — the same way unit tests cite expected output
under fixed input. PR-review for any future perf fix should expect
before/after numbers from the matching scenario.

The `track-storm` scenario writes to a live Live set and prints a
loud warning that it leaves orphaned audio tracks; the others are
read-only against Live state.

### D. New pytest suites for the audit code itself

The two new modules added by the audit
(`perf_logging.py`, `perf_profiler.py`) ship with their own pytest
files (`tests/test_perf_logging.py`, `tests/test_perf_profiler.py`,
16 tests total). These pin specific hazards we hit during code
review: `bool` is a subclass of `int` so the bool arm of the byte
estimator must come first, the rate-coalescer must reset between
surface reloads under Live's embedded interpreter, and the
listener-fire counters must short-circuit cleanly when the env var
is unset.

## Consequences

**Positive:**
- The "tests green" gate documented in CLAUDE.md is now actually
  reachable from the repo root. Future agents can't silently skip
  it via a missing script.
- Performance changes have a regression-test contract that's at
  the same level of rigor as unit tests — fixed input, measured
  output, before/after diff. The audit doc references this loop
  in its Methodology section; PR review can hold the line.
- Pre-gig smoke has a single owner. New operators (and agents) get
  a known-good walk-through; experienced operators get a checklist
  to skim instead of re-deriving.
- The audit code is self-tested. A regression in the profiler's
  byte estimator or the rate-coalescer surfaces in CI, not three
  weeks later when someone re-runs the audit.

**Negative:**
- Two test commands instead of one (`npm run test:run` for TS,
  `pytest` for Python). The pass-through doesn't unify them — the
  Python suite needs Live's bundled interpreter shape and isn't a
  natural fit for the Node test runner. Documented explicitly
  rather than papered over.
- The manual checklist is human-time-dependent. ~10–15 min for a
  full pass; some operators will skip it under deadline pressure
  even with the scope-to-section guide. Mitigation: the checklist
  itself ranks sections by "what breaks silently" so partial
  passes hit the highest-leverage steps first.
- The replay scenarios run against a real bridge (and `track-storm`
  against a real Live set). They are not fully hermetic. Acceptable
  trade-off: the bug class the audit exists to find is precisely
  the cross-process kind that hermetic mocks would miss.

## Tags

`testing`, `regression-harness`, `manual-checklist`, `performance-audit`,
`pre-gig-smoke`, `pytest`, `vitest`, `ship-gate`
