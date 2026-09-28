# Looping Surface

The Python Control Surface. It is the **sole live backend** between the
SvelteKit interface and Ableton Live — it replaced `liveAPI-v6.js` and
AbletonOSC, both of which are gone or inert.

**Status: complete and in production.** 49 components / ~68k LOC in this
directory own track metadata, the master track, meters, transport, clip
properties, grooves, device and preset loading, foot- and wah-pedal
gestures, track selection, track creation, and device-state observation.
UDP is bound (11020 in / 11021 out), the OSC router dispatches the whole
`/looping/v3/*` surface, and `pytest` covers it.

*(This block used to read "§0.1 fixture harness + Gate 0 bootstrap … no
UDP, no components, no OSC router yet". That described the first commit
of the migration; every gate after it landed without the status line
being touched.)*

The migration that produced it is archived at
[Looping's documentation/archive/m4l-to-python/](https://github.com/ben-juodvalkis/Looping/tree/dbae35ae/documentation/archive/m4l-to-python);
the live contract is [docs/reference/wire-protocol.md](../docs/reference/wire-protocol.md)
and the topology is [docs/reference/architecture.md](../docs/reference/architecture.md).

## Installing into Live

Symlink this directory into Live's User Library Remote Scripts folder:

```bash
./surface/install.sh
```

Then: Live → Preferences → Link/Tempo/MIDI → pick `Looping` in any
empty Control Surface slot. Input and Output stay `None`. Check
Live's log file for the line `Looping surface init` to confirm the
script loaded. AbletonOSC and the Max4Live observer stay enabled
alongside — the Python surface is additive throughout the migration.

## Layout

```
surface/
├── __init__.py                   — exposes create_instance (Gate 0)
├── LoopingSurface.py             — ControlSurface subclass (Gate 0)
├── install.sh                    — symlink into Remote Scripts/Vamp/
├── tests/
│   ├── conftest.py                — pytest shared config
│   ├── support/
│   │   └── stub_target.py         — in-process stub replacing the real surface until Gate 0
│   ├── fixtures/
│   │   ├── flows/                 — per-flow JSON fixtures (committed, contract)
│   │   ├── baseline/              — observer-count CSV baseline (committed)
│   │   └── raw/                   — raw NDJSON captures (gitignored, session-local)
│   ├── probes/                    — Gate 4a/4b/4c probes (added at bootstrap)
│   └── test_fixture_replay.py     — replay harness (stub target until Gate 0)
```

The rig probes that drive a running Live (`slice_fixtures.py` among them)
are in `owner/probes/`.

The scope-partition test is in vitest, not pytest, because the router
it exercises is Node.js. It lives at
[interface/src/__tests__/unit/bridge/scopePartition.test.ts](../interface/src/__tests__/unit/bridge/scopePartition.test.ts)
and runs with the rest of the interface suite via `npm run test:run`.

## Running the tests

```bash
# Python replay harness
cd surface
pytest -v

# Node scope-partition test (from repo root)
npm run test:run -- scopePartition
```

The harness currently replays against a stub target (no Python
surface exists yet). Once Gate 0 lands, the stub swaps for the real
surface bound to ports 11020/11021.

Both suites also run as a pre-push git hook. Activate once per clone:

```bash
git config core.hooksPath .githooks
```

The hook (`.githooks/pre-push`) runs vitest and pytest before every
`git push`; a failure aborts the push. Skip for a single push with
`git push --no-verify`. There is no CI equivalent — see the
2026-04-12 entry in
[implementation-log.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python/implementation-log.md)
for the reasoning.

## Capturing a fixture

The bridge has an OSC tap at
[interface/bridge/utils/oscTap.js](../interface/bridge/utils/oscTap.js)
that is off by default. To record:

```bash
OSC_TAP_FILE=surface/tests/fixtures/raw/$(date +%Y-%m-%d).ndjson npm run dev
```

Exercise the UI flows you want captured, stop the bridge, then slice:

```bash
python owner/probes/slice_fixtures.py \
    surface/tests/fixtures/raw/<date>.ndjson
```

Slicer reads the raw log, chops it at flow boundaries, and writes
per-flow JSON files into `tests/fixtures/flows/`. The raw file stays
ignored by git; the sliced fixtures are committed as contract
artifacts.

## Flows to capture

These are the UI flows the success-criteria list in
[01-prd.md §success-criteria](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python/01-prd.md)
calls out. Each should produce one fixture file under
`tests/fixtures/flows/`. Capture opportunistically — one raw NDJSON
session can cover several flows, and the slicer chops them apart.

- `connect-to-live` — bridge starts, tracks and devices populate.
- `tempo-signature-metronome-loop` — read + write of the four session
  properties.
- `create-audio-track` — name/arm/volume immediately post-create (no
  race).
- `create-midi-track` — same, midi variant.
- `delete-track` — observer cleanup, no leaked listeners.
- `select-track-with-devices` — full chain + parameter values arrive
  within one frame.
- `load-preset-into-fx-slot` — parameter values appear; AU plugins
  initialise.
- `clip-create-delete-duplicate` — clip ops including loop-region
  duplicate.
- `clip-transpose-and-sample-to-simpler` — note transpose; clip → simpler.
- `root-note-scale-mode` — observe and set.
- `sequencer-permute` — state read/write plus mute/pitch step updates.
- `session-reset` — delete all tracks, delete master devices.
- `device-move-then-parameter-write` — edge case that exercises the
  id-addressed write guarantee.

The list is prose, not a committed manifest file: the fixtures
themselves are the contract, and capturing them in any order is fine.

## See also

- [05-migration-plan.md §0.1](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python/05-migration-plan.md) — prerequisites this scaffolding fulfils.
- [04-wire-protocol.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python/04-wire-protocol.md) — address catalog the scope-partition test walks.
- [implementation-log.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python/implementation-log.md) — running narrative.
