# ADR-354: Simpler Slices, Property Cascades, and Auto-Trim to First Transient

## Status

**Accepted** — 2026-04-26.

## Context

Three Simpler-touching gaps surfaced together while iterating on the
Slicing-mode central view. Treating them as one decision — they share
a wire surface (`sample.*` properties), a UX promise (the loop brace
reflects what the user expects), and a Live 12 LOM quirk that bites
each of them in different ways.

### 1. Slice positions weren't on the wire

`Sample.slices` (Live 11+, list of int frame positions) wasn't in the
v3 property allowlist. The Slicing-mode brace had no way to draw slice
lines, leaving the canvas blank for what is the most distinctive
Slicing affordance. The list-of-int wire shape was new — the existing
`coerce_dict_to_json` lane (Compressor2 routing) already serialized
arbitrary iterables via `_jsonable`, but no allowlist row had
exercised it for a list-of-int, and no UI consumer had to
`JSON.parse` a list-shaped property value before.

### 2. Listener-less recompute attributes

Adding `sample.slices` to the allowlist exposed a Live 12 LOM quirk
documented in the existing `project_live12_groove_base_no_listener`
memory note: some attributes are listed as `observe`-able in the LOM
reference but `add_value_listener` never fires when their value
mutates. `Sample.slices` is one of these — Live recomputes the slice
list when the user changes `slicing_sensitivity` or enters Slicing
playback mode, but the listener attached to the `sample` container
sees nothing. The UI's first cold-read returns whatever the slice
list happened to be at subscribe time, then stays stale forever.

The previous workaround for `Groove.base` was a write-path echo: the
`set` handler manually emits `/property/value` after a successful
`setattr`. That handles the UI-write case but not the Live-side
mutation case (e.g., the user drags Simpler's SENS slider in Live's
own GUI). And `playback_mode` triggers `slices` recompute on a *later*
tick than the `setattr` returns, so an immediate re-read would catch
stale data anyway.

### 3. Captures and convert-to-Simpler always start at frame 0

Both the capture-to-Simpler auto-route and the clip-central-view
"convert" button drop a fresh sample into Simpler with `start_marker`
defaulting to 0. Captures routinely have ~100-300 ms of room tone
before the first hit; converted clips often have an attack envelope
after a quiet pre-roll. The user's first action on every loaded
Simpler is to drag the start brace to the first transient. This is
*always* the right move and is mechanical.

## Decision

**Three coordinated changes, shared scaffolding:**

### A. Waveform drawing: in/out-of-loop tinting and slice lines

The existing waveform render in `SimplerLoopControl` painted every
peak in a single orange (`#f97316`), with CSS overlay divs dimming
the *background track* outside the loop region. The waveform itself
sat above the overlays, so it read at full brightness everywhere —
the brace position carried the only "in/out" signal. Functional, but
when the user's finger covers a brace handle on the iPad, the
in-loop region effectively disappears.

The draw `$effect` now reads `displayStart` and `displayEnd` (both
`$derived`, so the effect re-runs on every brace drag — measured
~1 ms for 1024 fillRects on iPad Safari, well within budget). For
each peak bin, the bin's center x-position is compared against the
loop bounds; in-loop bins paint orange, out-of-loop bins paint
slate-grey at 55% alpha (`rgba(148, 163, 184, 0.55)`). The CSS dim
overlays remain — they handle the *underlying track color* — so the
visual is "muted-grey waveform on muted-grey track outside the loop;
orange waveform on orange-tinted track inside."

In Slicing mode the same in/out logic colors **slice lines**: a thin
vertical tick per `sample.slices` frame, mode-tinted accent inside
the loop (so active slices read distinctly), slate-grey outside.
Frames `<= 0` and `>= sampleLength` are skipped (the implicit
"first slice at sample head" would just paint over the left edge;
out-of-bounds frames are LOM noise).

The previous design comment ("re-runs NOT on brace drags") is
explicitly replaced — the per-drag redraw is correct given the new
in/out coloring. Documented inline so a future reader doesn't
"optimize" the dependency tracking back out.

### B. List-shaped property values via the existing JSON-string lane

Add `("OriginalSimpler", "sample.slices")` to
`PropertyComponent.ALLOWLIST` with `coerce_dict_to_json=True`,
`writable=False`. The existing `_jsonable` recursive serializer
already handles iterables and primitive ints, so `[0, 12345, 24690]`
JSON-stringifies to `"[0, 12345, 24690]"` with no new code path —
it's the same lane Compressor2 routing pairs use, just with a
different shape on the JS side.

Update wire-protocol.md to rename "dict-shaped values ride as JSON
strings" to "dict- and list-shaped." UI consumers `JSON.parse` to a
typed array; cold-start fallback is `[]`.

### C. `cascade_to` with dual immediate + deferred re-emit

Add `cascade_to: Optional[Tuple[str, ...]]` to `PropertySpec`. On
listener fire AND on UI-write success, the new `_emit_cascades`
helper resolves each named target through its own allowlist entry
(so coercions still run), reads the LOM value, and emits a fresh
`/property/value` for it.

Wired wirings:

- `slicing_sensitivity` → `sample.slices`
  (synchronous recompute — immediate re-read returns fresh data)
- `playback_mode` → `sample.slices`
  (asynchronous recompute on Live's next tick — immediate re-read
  returns stale data)

To handle the asynchronous case without overengineering, the cascade
emits the read **twice**: once inline, once on a deferred tick via
the existing `LoopingSurface._schedule_delayed(150ms, ...)` adapter.
Worst case the deferred read returns the same value as the immediate
read and the UI re-renders identically — benign duplicate. Best case
the deferred read catches Live's later compute and fixes the
cold-start gap. PropertyComponent accepts `schedule_delayed=` as an
optional constructor arg; unit tests pass `None` and assert the
immediate path, plus one test passes a fake scheduler and asserts
the deferred call is registered.

### D. Auto-trim writes Simpler param 3, not `sample.start_marker`

Server-side first-transient detection lives in a new
`interface/src/routes/api/sample-peaks/transientDetector.js`,
imported by the route handler so the same buffer that produces
waveform peaks also produces a transient frame index in one pass.
Algorithm: 8 ms RMS-smoothed mono envelope, 10th-percentile noise
floor estimate from 4096 strided samples,
`thresh = max(noiseFloor * 6, 0.003)`, first crossing minus a 5 ms
lookback. Returns `0` for silent / too-short / noise-dominated
samples (those guards collectively prevent a marker landing on
material the user actually wants).

The `/api/sample-peaks` JSON response gains
`firstTransientFrame: number`; the existing mtime-keyed LRU cache
keeps the second fetch (the SimplerLoopControl waveform fetch) free.

UI orchestration in `clipOperations.ts`:

- Both `loadCaptureIntoSimpler(filePath)` and `sampleClipToSimpler()`
  call a new `armAutoStartMarker` helper after firing their
  respective `/looping/v3/simpler/replace_sample*` OSC.
- The helper subscribes a `property/value` watcher (new
  `addPropertyValueWatcher` side-channel on the v3Property handler)
  and waits for a `sample.file_path` echo matching the expected
  filePath (capture flow knows it; convert flow discovers via "first
  echo on a devicePath that didn't exist when we armed").
- On match, fetches `firstTransientFrame`, normalizes to 0..1
  against the post-load `sample.length`, and writes Simpler's
  **parameter 3 ("S Sample Start")** via `setParamValue`. Param 3 is
  what the brace in Classic mode reads from. **`sample.start_marker`
  is deliberately left at 0** (and defensively reset to 0 if a prior
  pass left it non-zero) so a subsequent mode switch to Slicing has
  a full sample range to sweep — same posture as the existing
  `setPlaybackMode` Slicing→Classic handoff.

Guards: frame=0 (no-op), peaks fetch fail, missing `sample.length`
echo, 3 s timeout with no qualifying file_path echo, race with
user-grabbed brace (non-zero `start_marker` echo before our write
suppresses the auto-write).

## Why param 3, not `sample.start_marker` (Simpler dual-coordinate gotcha)

This was the original mistake and is worth pinning explicitly because
*every* future contributor touching Simpler will trip on it:

In Classic playback mode the visual loop brace reads from the
SimplerDevice **parameters** (`parameters[3]` for start, normalized
0..1; `parameters[4]` for length). In Slicing mode it reads from the
**properties** (`sample.start_marker` and `sample.end_marker`, in
frames). The two coordinate systems are independent, and the
existing `setPlaybackMode` mode-switch code in `SimplerCentralView`
already navigates between them — a Slicing→Classic transition zeroes
the markers and writes the equivalent normalized values into params
3/4 so the brace stays put visually.

The auto-trim flow lands a sample in **Classic mode** (the default
for a fresh `replace_sample`). Writing `sample.start_marker` to a
non-zero frame moves the LOM-side start but **not** the visible
brace, because Classic-mode brace reads param 3. The first iteration
of this work wrote `sample.start_marker` and the brace stayed at 0;
the user had to flip to Slicing mode to see the marker honored. The
correct write is param 3.

## Consequences

### Positive

- Slicing mode shows slice lines that update live as the user drags
  SENS, switches `playback_mode`, or swaps the sample.
- Captures and convert-to-Simpler both land the brace at the first
  transient, eliminating a routine manual nudge. Trailing silence is
  preserved (end_marker untouched).
- The `cascade_to` mechanism is reusable. Any future allowlist row
  whose mutation triggers a sibling recompute that Live doesn't fire
  a listener for can declare its cascade in the spec without
  bespoke per-property handler code.
- The transient detector is colocated with the existing decode
  worker — one decode, two outputs, one cache.

### Negative / Trade-offs

- The deferred cascade re-emit costs one duplicate `property/value`
  per cascade target per source mutation in the *common* case where
  Live's recompute is synchronous. Wire bandwidth is negligible
  (~30 bytes per emit) and the UI applies a same-value update as a
  no-op, but it's measurable in test fixture sizes — note for
  fixture authors not to consider duplicate emits as a regression.
- The auto-trim guard list (frame=0, length-missing, race detection,
  timeout) is heuristic. A user who drags the brace within ~3 s of a
  capture lands in race-detection territory; if they drag *to* zero
  intentionally, the auto-trim fires anyway because the race
  detector only suppresses on non-zero echoes. This is the right
  trade-off — a user who *moves* the brace clearly cares about
  position; a user who happens to leave it at zero is the no-op
  case anyway.
- Param 3 vs start_marker is a Simpler-internal semantic that the
  rest of the codebase doesn't (and shouldn't) need to model. The
  invariant lives in a single place (the auto-trim helper + the
  existing `setPlaybackMode` mode-switch sync) — adding a third
  consumer would require lifting it into a shared utility.

### Operational

- Live must be **fully restarted** to pick up the
  `PropertyComponent.py` changes (per the existing
  `user_setup_ableton_paths` memory note — Live caches Remote Script
  bytecode until process exit).
- Per-file diff:
  - `surface/components/PropertyComponent.py` —
    `cascade_to` field on `PropertySpec`, `_emit_cascades` helper,
    optional `schedule_delayed` constructor arg, two new allowlist
    cascades.
  - `surface/LoopingSurface.py` — pass
    `_schedule_delayed` to `PropertyComponent`.
  - `interface/src/routes/api/sample-peaks/transientDetector.js`
    (new) — algorithm.
  - `interface/src/routes/api/sample-peaks/+server.ts` — call
    detector inline, append `firstTransientFrame` to response.
  - `interface/src/lib/api/handlers/v3Property.ts` —
    `addPropertyValueWatcher` side channel.
  - `interface/src/lib/services/clipOperations.ts` — `fetchTransientFrame`,
    `armAutoStartMarker`, and call-site wiring in capture + convert
    flows.
  - `interface/src/lib/components/v6/central/views/SimplerCentralView.svelte`
    — subscribe to `sample.slices`, JSON-parse to numeric array,
    pass to `SimplerLoopControl`. Pitch slider moved from col 2
    (left of brace) to col 9 (right of brace, between brace and
    TIME XY pad).
  - `interface/src/lib/components/v6/simpler/SimplerLoopControl.svelte`
    — `slices` prop, draw effect tracks `displayStart`/`displayEnd`
    so brace drags retint, in/out-of-loop coloring for both peaks
    and slice lines.

## Update — 2026-04-27 (production-build path bugs)

The original implementation worked under `npm run dev` but 500'd
under `npm run ipad` (which serves `vite preview` on port 8889).
Two production-only path bugs in `+server.ts`:

1. **`new Worker(new URL('./decodeWorker.js', import.meta.url))`** —
   resolves correctly under `vite dev` (which maps `import.meta.url`
   to source paths) but breaks in production: SvelteKit's adapter
   doesn't copy `decodeWorker.js` alongside the bundled
   `_server.ts.js`, so the Worker constructor throws ENOENT and
   every request returns a generic 500.

2. **`fileURLToPath(new URL('../../../../../', import.meta.url))`**
   for the `constants.json` lookup — the five-level walk was
   calibrated for the source-tree layout. In the production build
   the file is several levels deeper, so the same walk lands in
   `.svelte-kit/output/config/constants.json` (doesn't exist)
   instead of repo-root `config/constants.json`.

Fixes:

- **Drop the worker pool**, decode inline. The single-user iPad
  concurrency profile (1-2 in flight) doesn't justify the build-
  bundling fragility. If concurrency ever grows back, prefer Vite's
  `?worker` import pattern (which the bundler tracks) over the
  `new URL(..., import.meta.url)` form.
- **Replace `fs.readFile(constants.json)` with a build-time JSON
  import** — `import constants from '../../../../../config/constants.json'`,
  the established pattern across `devicePresets.ts`,
  `vendorStateManager.ts`, etc. Vite resolves at build time and
  bundles the value into a chunk; no runtime fs read.

The waveform endpoint comment block in `+server.ts` documents both
traps in-line so future contributors don't reintroduce either.

## Update — 2026-07-07 (two latent auto-trim field bugs)

The auto-trim design (decision D) was correct, but two bugs in it kept
the write from ever firing on real captures. Both surfaced together
when driving the record→Simpler flow live; neither had test coverage
(the `armAutoStartMarker` guard logic was untested — that's how they
slipped in). Symptom for both: the brace stays at 0, no error.

### 1. Transient detection window was too small (0.2s → 3s)

`+server.ts` fed only the first `TRANSIENT_WINDOW_SECONDS = 0.2s` of
audio to `findFirstTransient` on the **streaming PCM path** (Path A,
WAV/AIFF — ADR-362). Detection over the first 0.2s alone returns `0`
(the frame-0 guard) whenever the actual first hit is later than that.

Measured against the real capture library, pre-roll before the first
transient is routinely **0.3–0.8s and occasionally >1.5s** (count-in
latency, a breath before the first note). So 0.2s dropped the majority
of real captures — auto-trim appeared "broken" because it only ever
fired on the handful of captures with <0.2s of lead-in.

Widened to **3.0s**, which covers every observed capture with margin
and matches `AUTO_TRIM_TIMEOUT_MS` (there's no point detecting past the
window the watcher itself waits on). The window only sizes a
pre-allocated per-channel buffer (`transientChannels`); streaming cost
is unchanged (the peaks pass reads the whole file regardless). The
full-decode path (Path B, compressed audio) already ran the detector
over the entire buffer and was never affected.

### 2. Discover-by-echo guard dropped the echo on reused Simpler slots

The capture flow passes `expectedFilePath` (the exact WAV path from
`/capture/file`), so the watcher's `value !== expectedFilePath` check
already uniquely identifies the correct `sample.file_path` echo. But a
*second* guard — "only accept devicePaths that didn't exist at arm
time" (the discover-by-echo heuristic) — ran unconditionally and
rejected the echo whenever the target Simpler slot already existed.

`replace_sample_onto_track` **reuses** a MIDI track's existing Simpler
across successive captures (the sample is swapped in place), so on
every capture after the first, the target devicePath (e.g.
`tracks/1/devices/1`) was already in `knownDevicePathsAtArmTime` and
the one qualifying echo got filtered out → 3s timeout → no write. The
original comment reasoned that successive captures land at *new* slots
(devices/2, devices/3…); in practice they land back on the same slot.

Fix: the newness heuristic now applies **only** when there's no
`expectedFilePath` to match on (the convert flow, which has neither
filePath nor devicePath). When the exact path is known, path-matching
is strictly more precise and the newness check is skipped. This is why
the *first* capture of a session could work (genuinely new slot) while
every repeat silently failed.

Per-file diff:
- `interface/src/routes/api/sample-peaks/+server.ts` —
  `TRANSIENT_WINDOW_SECONDS` 0.2 → 3.0, comment updated.
- `interface/src/lib/services/clipOperations.ts` — gate the
  discover-by-echo guard on `!expectedFilePath`; refresh the
  `loadCaptureIntoSimpler` comment that had reasoned about new slots.

## Tags

`simpler`, `property-cascade`, `transient-detection`, `auto-trim`,
`live-12-lom-quirks`, `wire-protocol`
