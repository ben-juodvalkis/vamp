# ADR-366: Random Start auto-prepend on Simpler creation

## Status
**Accepted** (2026-05-01)

## Context

`Vamp Devices/random-start/random-start.amxd` is a small Max for
Live MIDI utility that randomizes a downstream Simpler's `Sample Start`
parameter on each note-on. It's standalone — no Python-surface
dependency, no OSC bridge contact, self-resolves its target Simpler by
forward-scanning for `class_name == OriginalSimpler` on the parent
track. Drop it before a Simpler and one-shot samples turn into streams
of variations.

The two flows that *create* a Simpler in this codebase always land a
sample-backed Simpler the user is about to perform with:

- **Capture flow**: `loadCaptureIntoSimpler(filePath)` →
  `/looping/v3/simpler/replace_sample_onto_track [trackPath, filePath]`
  → `SimplerLoadComponent.handle_replace_sample_onto_track`. Lands a
  fresh Empty Simpler on a UI-prepared MIDI track and calls
  `simpler.replace_sample(file_path)` with the WAV looping-recorder
  just wrote.
- **Convert flow**: `sampleClipToSimpler()` →
  `/looping/v3/simpler/replace_sample [clipPath]` →
  `SimplerLoadComponent.handle_replace_sample`. Creates a new MIDI
  track adjacent to the source audio track and lands a Simpler
  holding that clip's underlying audio.

Both flows skip `prepare_for_preset` (where the Permute appender lives,
ADR ROW-6.x), so neither inherits any post-load device hooks. The
foot-pedal hold gesture creates an *audio* track and never lands a
Simpler — out of scope.

The user wants Random Start auto-prepended in exactly these two flows,
and a "RANDOM" knob in the Simpler central view driving its
`Random Amount` parameter.

## Decision

Auto-prepend Random Start in `SimplerLoadComponent` immediately after
`replace_sample` succeeds, idempotent across reuse, with a wire-entry
LRU dedupe that closes the bridge-broadcast double-fire. Add a
name-resolved `RANDOM` slider to `SimplerCentralView`.

### 1. Constants + browser reachability

`devices.randomStart.devicePath` in `constants.json` points at the
in-repo `.amxd`. Empty / missing disables the prepend silently;
Simpler load itself still succeeds.

`BrowserCache.lookup` only resolves paths under `userLibraryBase` or
under a registered Place. Rather than copy the `.amxd` into User
Library, we add the device's containing folder as a Place
(`paths.placesRoots["random-start"] = ".../random-start"`) — keeping
the in-repo file as the single source of truth. The Place's sidebar
display name in Ableton must exactly match the JSON key
(`BrowserCache._match_place` does `user_folders[display_name]`
descent).

### 2. Idempotent prepend in `_load_simpler_onto_track`

Both flow handlers converge on `_load_simpler_onto_track`. After the
sample swap, the helper:

1. Skips when `random_start_device_path` is empty or the resolver
   returns no `DeviceLoadComponent` (e.g. mid-init, Live <12.3.7).
2. Skips when `_track_has_random_start(track)` already finds a device
   named `random-start` on the chain (idempotent across reuse).
3. Calls `dlc.load_into_track(track, path)`, which appends.
4. Calls `song.move_device(last, track, 0)` to slide it to index 0
   so MIDI hits Random Start before reaching the Simpler. Random
   Start's own chain observer scans forward by class_name, so utility
   devices between it and the Simpler don't break the lock.
5. Forces `Random Amount = 0` on the freshly-prepended device — the
   `.amxd`'s `@_parameter_initial 50.` would otherwise drop the user
   into 50% randomization on every fresh capture. Best-effort write;
   LOM RuntimeError is swallowed (consistent with the existing
   Loop-on enable posture).

The post-load Simpler lookup changed from `track.devices[0]` to
`_find_simpler_with_replace_sample(track)` — iterate by capability
rather than chain index — because once Random Start lands at index 0,
the Simpler is at index 1+. Matching on the `replace_sample` attr is
the LOM-level invariant the rest of the code already relies on, so
the change is conservative.

### 3. Wire-entry dedupe

The bridge re-broadcasts every wire to all WS clients (Mac browser +
iPad), so a single user gesture lands as N identical Python handler
invocations. The 2026-04-30 Permute fix (LoopingSurface.py:1117–1123)
moved that work to Python so doubled UI follow-up loads vanished —
but here both calls are *already* in Python:
`/capture/file` broadcasts to both clients, each fires
`loadCaptureIntoSimpler` independently, each calls `prepareTrack`
(idempotent — same trackPath returned), each sends the
`replace_sample_onto_track` wire.

`_track_has_random_start` after-the-fact can't catch this:
`load_item` is async, the device isn't visible in `track.devices`
when call #2 checks. Both calls see an empty chain, both prepend.

Fix: in-flight dict `(track_path, file_path) → monotonic_ts` with a
10-second TTL, gated at the wire entry of each handler:

- `replace_sample` keys on `("clip", clip_path)` — the gesture's
  natural identity, before any LOM mutation.
- `replace_sample_onto_track` keys on `(track_path, file_path)`.

Same args within TTL → silent drop. Different file on the same track
is a legitimate retake and goes through. Gate sits before any LOM
work, so the second clip-flow call doesn't even create a duplicate
MIDI track.

Same-shape solution as `TrackPrepareComponent`'s `request_id` LRU
(`_LRU_TTL_SECONDS=30`, `_LRU_MAX_ENTRIES=64`); we use a shorter TTL
(10s) because the dedupe window only needs to span the WS broadcast
fan-out, not a UI retransmit window.

### 4. UI slider, name-resolved

`SimplerCentralView.svelte` resolves the device + param by `name`,
not by chain-index, so the binding survives reorders / utility
inserts:

```ts
let randomStartDevice = $derived(
  selectedTrackStore.devicesByPath.find((d) => d.name === 'random-start'),
);
let randomAmountParamPath = $derived.by(() => {
  for (const p of randomStartDevice?.params.values() ?? []) {
    if (p.name === 'Random Amount') return p.paramPath;
  }
  return undefined;
});
```

Knob renders only when both are present. User deletes Random Start
manually → knob disappears; auto-prepend only fires at
Simpler-creation time, not on selection.

Bottom-row grid bumped from 6 → 7 cols across all three layout
permutations (Classic non-warping, Classic warping, Slice) with
RANDOM as the rightmost column. Range is 0–100 to match the `.amxd`'s
`live.numbox @_parameter_range 0. 100.` declaration.

### 5. Name-literal alignment

The `device.name` Live exposes for an `.amxd` is the **filename
basename** when the patch doesn't set a friendly name via
`live.thisdevice`. For this device that's `random-start` (lowercase,
hyphen) — *not* `Random Start` (the friendly form in the README). The
Python idempotency check and the UI lookup both match the runtime
literal:

```python
RANDOM_START_DEVICE_NAME = "random-start"
```

```ts
const RANDOM_START_DEVICE_NAME = 'random-start';
```

Comments on both sides flag this as load-bearing. If the `.amxd` is
ever rebuilt with an explicit `device.name` override, both literals
must move together. Same trap the existing
`feedback_default_name_matches_adv_filename` memory documented for
preset `defaultName` — same root cause (Live's runtime device name is
the basename, not the LOM class label or sidebar / file system display
name).

## Consequences

### Positive

- Capture and convert flows produce a ready-to-perform Simpler with
  randomized retriggering one knob away. No manual device drop
  required.
- Idempotent + dedupe-gated: re-running either flow on the same track
  with the same file is a no-op; legitimate retakes (different file
  on the same track) still go through.
- UI binding is reorder-proof: utility insertions between Random
  Start and Simpler don't break the knob, and the knob auto-hides
  if the user deletes the device manually.
- `Random Amount = 0` on prepend keeps fresh captures inert until the
  user opts in, avoiding the surprise of 50% randomization out of
  the gate.
- No new wire addresses, no protocol bump. Random Start parameters
  ship through the existing `state/full` tree; the slider writes via
  the existing `/looping/v3/param/set`.

### Negative

- Two name literals (`random-start`) live in load-bearing positions
  on Python and UI sides. A future Max patch rebuild that sets
  `live.thisdevice` to `"Random Start"` (friendly form) will break
  both unless updated. Mitigation: comment on both literals flags
  the dependency and the verification path (compare to a state/full
  dump).
- Place-based browser reachability requires the user to add a
  sidebar Place in Ableton manually, with the JSON key matching the
  display name exactly. A different machine without the Place
  configured won't auto-prepend (it'll hit `not-in-browser`). Cost
  is a one-time setup step per workstation; the alternative
  (copying the `.amxd` into User Library) splits the source of truth.
- The `(track_path, file_path)` LRU lives in component memory.
  Disconnect clears it; a hot-reload of `LoopingSurface` would
  reset it to empty, briefly opening the dedupe window. Bounded
  blast radius — a duplicate during reload is one extra device, not
  a runaway.
- Cold-read fallback on the slider is `0`, but the LOM value will
  arrive milliseconds later carrying whatever's actually on the
  device. There's a single-frame visual flicker possible if the LOM
  comes back non-zero; acceptable for a control that the user is
  about to drag anyway.

## Validation

- Full Python suite green: 1443 / 1443.
- New tests in `test_simpler_load_component.py` (48 / 48):
  - Clip-flow + capture-flow happy paths with prepend.
  - Idempotency when Random Start already on the track.
  - Path-empty + resolver-None disable paths.
  - Browser-miss + `move_device` raise tolerance (no wire emit).
  - Capture-flow dedupe (same args dropped, retake passes).
  - Clip-flow dedupe (no duplicate MIDI track on second call).
  - TTL expiry releases the dedupe lock.
  - `disconnect` clears in-flight state.
  - Zero-on-prepend + LOM-raise tolerance for the Random Amount write.
- Production build green (`npm run build`).
- Full TS suite: 1022 / 1022.
- `npm run check`: no new errors introduced; the 6 pre-existing
  errors are unrelated.
- In-Live validation: REC TO SIMPLER → captured WAV → MIDI track
  ends up `[random-start, Simpler]`, slider renders at 0, dragging
  the slider audibly randomizes start position on subsequent notes.

## Tags
`random-start`, `simpler`, `capture`, `convert`, `m4l`, `idempotent`,
`broadcast-double-fire`, `dedupe`, `lru`, `places`, `browser-cache`,
`device-name-literal`, `replace-sample-onto-track`, `replace-sample`
