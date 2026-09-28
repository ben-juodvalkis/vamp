# ADR-348: Permute load policy lives in the UI layer

## Status
**Accepted**

## Context

Every new track in this project gets a Permute (sequencer) device.
Before this ADR, the "load Permute on every new track" policy was
expressed three times:

- `ableton/looping-surface/components/TrackCreateComponent.py` —
  fired the load synchronously after `create_*_track` returned, gated
  by `devices.sequencer.autoLoadOnTrackCreation` in `constants.json`.
- `surface/components/FootTriggerComponent.py` —
  fired the same load via the same shared `load_preset` closure on
  the deferred-configure tick, gated by the same flag.
- A reuse-path hatch on `TrackCreateComponent.handle_ensure_devices`
  (wire `/looping/v3/track/ensure_devices`) for tracks that came back
  empty without Permute.

The flag was true in production and never flipped. The "policy" was a
fossilized decision repeated across components, with three places to
edit if it ever needed to change. There were also two ordering bugs
the duplication couldn't fix:

1. **Permute landed before the instrument.** Python loaded Permute
   immediately on create; the UI then loaded the user's instrument
   preset, which appended to the right. Result: Permute was leftmost
   in the device chain. The user wanted it last.
2. **Reuse-path race.** `ensure_devices` was a fire-and-forget on a
   reused MIDI track, so Permute might land before the instrument
   load that immediately followed.

Adding "wait for instrument echo, then load Permute" inside Python
would have meant inventing a cross-component "device-loaded" signal
and re-implementing the v3 store's structural reconciliation on the
Python side. The UI already has both: `awaitNextStateFullEnd` for
structural fences and `v3Store.tracks[*].devices` for device-presence
reads.

## Decision

The "load Permute on every new track" policy lives in the UI layer
(`interface/src/lib/services/trackPreparation.ts`). Python emits
creation acks; the UI runs the post-create device load.

### Where the load happens

| Trigger                          | Where Permute loads                                         |
|----------------------------------|-------------------------------------------------------------|
| UI creates audio track           | End of `prepareTrack('audio')`                              |
| UI creates MIDI track + preset   | Inside `loadPreset()`, after the instrument echo lands      |
| UI reuses empty audio track      | Inside `prepareTrack`, after select (idempotent — no-op if present) |
| UI reuses empty MIDI track       | Implicit — `loadPreset()` runs the same post-instrument load |
| Foot-pedal hold-to-create-audio  | Global listener on `/looping/v3/track/created` with `origin === 'foot-trigger'` |

### Wire contract

`/looping/v3/track/created` grew an optional third arg:

```
/looping/v3/track/created [type:str, trackIndex:int, origin?:str]
```

- Missing `origin` → UI-initiated create. The local listener inside
  `prepareTrack()` consumes the ack to capture its track index.
- `origin === 'foot-trigger'` → hardware-gesture create. The global
  listener registered by `initFootTriggerCreateListener()` runs
  `loadSequencerAndAwait(trackIndex)`.

The local listener filters out any ack that carries an `origin`, so
foot-pedal acks can't hijack a UI-initiated `prepareTrack` waiter.

### Echo-driven sequencing

`loadSequencerAndAwait` and the post-instrument step inside
`loadPreset()` both use `awaitNextStateFullEnd(timeout, ['structural'])`
to wait for Live's device-listener to publish the new chain into
`v3Store.tracks[trackPath].devices`. The MIDI-preset path snapshots
device paths *before* sending the load, then polls the structural
echoes until a new device appears, only then loading Permute. Result:
Permute is rightmost in the chain by construction, not by hope.

### Removed

- `devices.sequencer.autoLoadOnTrackCreation` (the flag, schema,
  every test that exercised it).
- `TrackCreateComponent`'s `_resolve_device`, `_fire_load`,
  `_resolve_ensure_target`, `_safe_device_name`, `_expected_name`,
  `_has_device_matching` helpers and the auto-load branch in
  `_handle_create`.
- `TrackCreateComponent.handle_ensure_devices` and the
  `/looping/v3/track/ensure_devices` wire registration in
  `LoopingSurface.py`.
- `FootTriggerComponent`'s `_resolve_sequencer`, `_fire_sequencer_load`,
  `_load_preset` constructor arg, and `_sequencer_path` /
  `_sequencer_enabled` fields.
- `LoopingSurface`'s docstring claim that the shared `load_preset`
  closure is used by the foot-pedal and track-create paths (it's now
  used only by `SimplerLoadComponent`'s clip→Simpler flow).

### Kept

- `devices.sequencer.devicePath` in `constants.json` — the UI reads
  it to know what to load.
- The shared `load_preset` closure in `LoopingSurface.py` — still
  load-bearing for `SimplerLoadComponent`'s clip-to-Simpler flow,
  which drops Empty Simpler before `replace_sample`.

## Consequences

### Positive

- One place to change the policy. Adding "load Permute and Saturator"
  is one edit in `trackPreparation.ts`, not three across two
  languages.
- Permute lands rightmost by construction. The UI can wait for the
  instrument's device-record to appear before sending the Permute
  load — Python had no comparable signal.
- `~150 lines of Python plumbing removed` (auto-load branches,
  ensure_devices, helper methods, six tests for behavior the UI now
  owns).
- `constants.json` schema is one bool simpler.
- The `/looping/v3/track/created` wire is now self-describing about
  *who* created the track, which makes it usable as a building block
  for future non-UI creators (e.g. a MIDI mapping that creates tracks
  on demand) without re-litigating the policy.

### Negative

- The wire grew an optional arg. UI consumers had to learn to filter
  on it; the local listener in `prepareTrack` now ignores any ack
  with an `origin` value to avoid hijacking.
- Foot-pedal track creation now requires the UI to be running and
  connected. In practice the UI is always connected when the
  foot-pedal is in use (the project has no headless mode), so this is
  not a regression — but it is a new dependency at the layer
  boundary. If Permute *must* load even when the UI is asleep, this
  needs revisiting.
- Echo-driven sequencing has a budget (4s for Permute, 6s for the
  instrument echo). On a wedged surface the UI logs a warning and
  proceeds; the foot-pedal track may end up without Permute. The
  prior fire-and-forget Python path had the same failure mode
  silently — this version surfaces it.

## Tags

`policy-consolidation`, `track-create`, `permute`, `wire-contract`,
`foot-trigger`, `python-surface`, `ui-orchestration`
