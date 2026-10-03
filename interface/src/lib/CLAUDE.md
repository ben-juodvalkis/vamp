# SvelteKit Core Library

Main application code for the looping interface. Uses **Svelte 5 runes** (`$state`, `$derived`, `$effect`) throughout - no legacy `$:` syntax.

## Directory Layout

| Directory | Purpose |
|-----------|---------|
| `actions/` | **The pointer primitive** (ADR-427) — `use:press` / `use:drag` plus the two pure state machines behind them. Every interaction on the performance surface goes through one of these |
| `components/v6/` | All UI components (has its own CLAUDE.md) |
| `stores/v6/` | Reactive state management with Svelte 5 runes (has its own CLAUDE.md) |
| `services/` | Business logic, adapters, coordinators (has its own CLAUDE.md) |
| `api/` | OSC client and WebSocket connection layer |
| `utils/` | Shared utilities (logger, performance, formatters) |
| `config/` | Device presets, FX grid layout, unified device configs |
| `types/` | TypeScript type definitions (device, osc) |
| `server/` | Server-only modules (SvelteKit refuses to bundle `$lib/server` into the page). `sampleRoots.ts` is the gate on `/api/sample-peaks` and `/api/similar-samples`: a sample file under the library, Live's own Places/packs/Core Libraries and Hybrid Reverb IRs (read from `Library.cfg` and `/Applications`), the capture folder, or a Live project — anything else is a 403 |

## Actions (`actions/`) — the pointer primitive

ADR-427. **Use these for every new interactive control.** Do not hand-roll
pointer handlers, do not use `onclick` on the performance surface, and
never read `touches[0]` (a lint gate fails the push if you do).

The invariant: *every interaction is owned by exactly one pointer,
identified by its `pointerId`, from the moment it starts to the moment it
ends.* No handler asks "where is the finger" — only "where is **my**
finger."

- `pressMachine.ts` / `dragMachine.ts` — **pure**, no DOM, no `window`,
  no timers. Every input carries its own `now` and a hold threshold is
  crossed by an explicit `tick()`, so a two-finger scenario is a table
  test. Open interactions live in a `Map<pointerId, …>`, so the
  concurrent case is the same code path as the single-finger one.
  `multiPointer` defaults to **false** — a second finger on the same
  button is a fumble, not a second press; independence *between* controls
  comes from each node owning its own machine.
- `press.ts` / `drag.ts` — the DOM wiring, and the three things that need
  a real node: **`touch-action` written onto the node the handler binds
  to** (the trap that broke mute — `.header-name` computed `auto`,
  nothing declared it, and touch-action does not inherit), the
  capture-vs-window choice, and teardown.

**Declare `touchAction` on the directive, never in the stylesheet.** One
author for the CSS policy and the handler it protects is the entire
structural point.

**Timing.** `fireOn: 'up'` (default) is the `click` replacement.
`fireOn: 'down'` is zero-latency and correct **only** alongside
`touch-action: none`, so no pan can start on the control and there is
nothing to abandon. On a `pan-x` control it means every row pan crossing
it acts then un-acts — audible, on mute.

**Binding.** `window` listeners by default (an element that can unmount
mid-gesture must not rely on capture; capture on a re-rendering subtree
drops `pointerup` on desktop Chrome). `binding: 'capture'` where the
target is a single stable element. `<Card>` and other components take the
action through `bind:ref` in an `$effect` — `use:` only applies to DOM
elements.

`useStripGestures` runs on `dragMachine` too, so there is one
implementation of the slop threshold and the axis commit. A press can
declare its cross axis inert (`DragInput.crossInert`, read at `down`):
travel along it still means "not a tap", but it no longer commits the
press to `cross` and locks the drag axis out — for the strip fader when
the row has nothing to scroll.

## API Layer (`api/`)

- `simpleClient.ts` - Primary OSC client. Routes messages to handlers, manages WebSocket lifecycle, auto-initializes V6 session on connection. Listens for the `bridge-resync` window event and fires `sendStateResync()` on visibility-resume (reconnect resync is covered by the v3 handshake accept emitting state/full).
- `handlers/v3Handshake.ts` - Retries `hello` every 2s until accepted (bounded at 8): it crosses an unacknowledged UDP hop to the surface, and a drop left the UI with no `state/full` — no tracks, meters or playheads — while writes kept working, which reads as a frozen UI whose faders still reach Live. Ignores accepts naming a version the UI never advertised, because accepts are **broadcast** to every client and clients negotiate independently (the UI sends `3.10.0`, the menubar `3.3.0`); a genuine mismatch arrives on `/looping/v3/error`, never as an accept. See ADR-418.
- `connection/WebSocketConnection.ts` - WebSocket lifecycle, message buffering, exponential-backoff reconnect (1s → cap 30s), liveness watchdog. Swallows `/bridge/ping` inbound and stamps `lastInboundTs`; force-closes a silent socket after 12s so reconnect fires. Dispatches `bridge-resync` on every successful open. **Outbound writes are coalesced** (2026-08-31): `send()` queues into `outboundBatcher` and one frame leaves per event-loop turn. `buildOutboundFrame` decides raw-vs-envelope — a lone write still ships raw, so the common case is unchanged on the wire. `deliverOutbound` owns the "is the socket open, and if not where do these go" question, which is why the batcher itself knows nothing about sockets. `flushOutboxNow()` forces a synchronous drain (tests; production shouldn't need it).
- `handlers/v3StateFull.ts` - **Protocol 3.6.0.** Parses `/looping/v3/state/full/tree` — the whole canonical tree in one message, `[reason, generation, etag, scope, ...tree_args]` with a **fixed, positional** four-arg header (`scope` is `''` for whole-song, never omitted). Replaced `begin → chunk… → end` plus a 453-line `v3StateFullReassembler.ts`: the chunk buffer, the completeness check and the FNV-1a integrity checksum all existed to survive darwin's 9,216-byte UDP cap, which the ordered TCP leg retired. What it still owns: header validation, the scoped-vs-whole-song apply route (`mergeSubtreeAtPath` vs `replaceTree`), and a `(generation, etag)` dedupe key that `accept`/`resync` are exempt from. `awaitNextStateFullEnd` went with the reassembler — it fenced against *asynchronous* reassembly and had no production callers. **Protocol 3.7.0** grew the T record to 14 fields, appending `role` — see `services/CLAUDE.md`. **Protocol 3.8.0** (issue #491) added the `pad-chain` reason: a bundle scoped to one drum pad's path carrying only the D/P records of that pad's effects, applied to the store's separate `padDevices` map by `mergePadChain` and never deduped (every `vm.padChain.<note>` cold read is answered with one). **Protocol 3.9.0** (ADR-439) grew the T record to 15 fields, appending `preset` — the path the last `prepare_for_preset` load recorded under `looping.preset`, carried while the track still holds the instrument that load left (`''` after Live's undo or a hot-swap), which the instrument views' swap control steps from; `/looping/v3/track/preset` is its mid-session echo (`v3TrackMetadata.ts`), and both `normalized.svelte.ts` equality checks compare it, or a preset change alone would be dropped as "unchanged".
- `api/handlers/stateFullEtagStore.ts` - **Protocol 3.5.0.** Bounded (32-entry LRU), in-memory, per-scope record of the ETag the last `state/full` this client successfully applied carried. `sendHandshakeHello` / `sendStateResync` declare it as an `etag:0x…` token; the surface answers `state/full/unchanged` when it recomputes the same value, so a reconnect against an untouched set transfers one small message instead of the tree. **The token is opaque here** — since 3.6.0 the UI never computes it, only stores and echoes it, so it is a surface-local value and not a cross-language contract. Two invariants: **record only after a clean apply** (a bundle that failed to parse must leave no entry), and **dropping the tree drops the claim** — `resetForSurfaceRestart` / `resetTree` call `clearHeldEtags` from inside the store, because the alternative failure is a UI that sits permanently empty with no error and no retry. Deliberately not persisted across reloads for the same reason.
- `connection/outboundBatcher.ts` - Queue mechanics for the above, and the mirror of the bridge's `utils/broadcastBatcher.js`: same `/bridge/batch` envelope, same single-item passthrough, opposite direction. Flushes on a **microtask**, not a timed window — a microtask runs at the end of the current synchronous turn, so it merges only writes that were already leaving together and costs zero latency. (The bridge's Surf→UI batcher can afford its 10 ms window because meters are not click input; its own docstring calls out adding window latency to click input as a regression.) The motivating burst is `trackColoring.applyAutoColorOnPrepareAck`, which sends the track colour plus one message per clip — a preset load onto an 8-clip track was 9 frames. `schedule` is injectable so tests can drive "one turn" explicitly instead of relying on microtask timing.
- `handlers/` - Message handlers split by source. `v3ClipLifecycle.ts` consumes `/looping/v3/clip/created` + `/clip/removed` (the surface's per-slot `has_clip` listener): it flips the slot in the normalized store immediately — the grid paints has/has-not, and a clip added or deleted in Live used to change nothing on screen, since the companion `state/invalidate` carries no paths — then debounces one `state/resync` (300ms) for the name/length only a `state/full` carries. V3 handlers (`v3*.ts`) cover the Python-surface wire contract (track metadata, clip, param, handshake, state/full, meter, etc.). The legacy `/looping/session/tempo` wire lands in `v3Session.ts` alongside the v3 attrs. `miscHandlers.ts` covers ping/pong, init, and bridge status — including `/bridge/features`, the bridge's feature switches (general-release audit §7b), into `stores/bridgeStatus.svelte.ts`: `feature(id)` / `isFeatureOn(id)` / `unavailableReason(id)`. A feature no snapshot has named reads as off, so a control gated on one draws nothing until the bridge's first frames land; an identical snapshot (the 5 s beacon) is dropped rather than re-assigned. `v3PermuteStep.ts` handles `/looping/v3/permute/step` — Permute's sequencer step position, which is telemetry and deliberately does **not** ride `param/value`/`paramByPath` (ADR-406). `v3DrumPadHold.ts` handles `/looping/v3/drum/pad_hold [rackPath, note, held]` — a Drum Rack pad held on the Move (ADR-432), pressed and released on `drumPadScope` as an external hold; the same module registers an `onHandshakeAccepted` hook that drops every external hold on an accept (`v3Handshake.ts` imports no store).

## Config (`config/`)

- `fxGridLayout.ts` - Maps 11 FX slot positions to device types, Svelte components and explicit grid cells on a **twelve**-column grid (ADR-438 addendum). `cellFor(slot, kind)` moves the Bass and Variation on audio; `SQUASH_CELL` and `AUDIO_GUITAR_CELL` place the two tiles with no entry. MIDI: Rand Oct, Variation, Squash and Gain are full-height columns. Audio: the Guitar full height at the far left, the Bass over Variation. `FXGrid.svelte` mounts fx1 per track type: Rand Oct on MIDI, Bass on audio, OTT on master. The instrument slider and the clip-pitch tile left with ADR-438; on MIDI the Guitar is the Pedal view's last column
- `devicePresets.ts` - Device definitions with parameter names and ranges
- `permuteLayout.ts` - The thin Permute's 38 pattern controls by role (16 steps a lane since ADR-443; `PERMUTE_MAX_STEPS` is the length cap the Permute view and step grid read): long names (the contract with `Vamp Devices/Permute/Permute.amxd` and the surface engine), the positional fallback, the device defaults, and `resolvePermuteLayout()` — the one resolver every reader and the reset go through (ADR-429). `findPermute(records)` is the one finder (class + name, the pair the surface's engine discovers by) for a track's chain and, since ADR-435, a pad's

## Utils (`utils/`)

- `logger.ts` - Centralized logging (DEBUG/INFO/WARN/ERROR/NONE). Always use this, never raw `console.log`
- `freeze-detector.ts` - Detects UI freezes
- `clientWatchdog.ts` - Reports tab visibility changes, rAF stalls, and online/offline transitions to the bridge via `/bridge/client_log`. Dispatches `bridge-resync` on visibility-resume. Started from `+layout.svelte` after WebSocket connect. Also reports `uncaught-error`/`unhandled-rejection` with stacks, and `reactivity-stall` — a counter the `+layout.svelte` probe `$effect` echoes back, so a wedged Svelte effect scheduler is distinguishable from a quiet wire (ADR-418)
- `parameterLookup.ts` - Maps parameter IDs to values/ranges
- `sliderThrottle.ts` - Rate-limits slider updates to prevent OSC floods
- `presetPath.ts` - **What a preset's file path means, read in one place.** `folderSlug` is the Places catalog generator's id rule (a Place's rail id `place:<id>` and its `<id>.json`); the Places service's disk scan (`$lib/server/places/diskScan.ts`) imports it. `aliasPresetPath` reads a path recorded before the Places (`<instrumentsBase>/<Vendor>/<Type>/…`, still in saved Sets and Recent) through the alias map into its Sidebar copy — Recent and the swap pill's lookup read every recorded path through it. The category readers: **`presetCategory`** is the reading of a path's category for track coloring when no Place is behind the load (a Recent entry outside every Place; a load from a Place carries its Place's role instead) — the category FOLDER, which for a Sidebar path (`Sidebar/<Place>/…`) is the Place, since the Places are named for the roles, and for an off-library path the deepest folder naming one (`categoryFromPresetPath`). Deepest-first was the whole rule from 2026-08-28 to 2026-09-18 and read the wrong category for 13,504 of 44,577 library preset files (every Omnisphere Drum preset sat under `Omni/Drum/Synth/…`); roles and colors written in that window stay in saved Sets until the track is next loaded through the app. `libraryCategoryOfPreset` is the same folder with the folders below it, for the strip's device band. `typeIdForPresetPath` and `brandFromPresetPath` went with the type catalogs at the cutover (2026-09-24). **Dependency-free**: no `$config` / `$lib` imports, because the generator runs it under `tsx`
- `waveformPaint.ts` - **The one canvas routine behind every `/api/sample-peaks` waveform** — `ClipPreview` (strip + session grid), `ClipEditorView` and `SimplerLoopControl`. Geometry is in TIME: `span` is the clip time the peaks array covers (the file's `fileStartBeats`/`fileEndBeats` off `playing_slot` / `clip/sample`, `peakSpan` falling back to `[0, length]` when unknown), `view` the time the canvas shows (`clipViewWindow`: `[loopStart, loopEnd]` whether or not the clip loops — with looping off Live reports the start/end markers there, measured, while `end_marker` itself read beats on an unwarped take — else the whole file, else `[0, length]`; the store's `visibleWindow` and the MIDI lanes use it too, so the playhead, the notes and the waveform share one window), and each bar lands where its own slice of time falls. Each view picked its own slice before, and two assumed the file spans `[0, clip.length]` — wrong for a looping clip, whose `length` is the loop's (a 28-beat take looping 16..24 reads 8), so the strip drew nothing. `perceptual` amplitude for the clip views, `linear` for Simpler. `BrowserPresetWaveform`'s baked thumbnails are a different look and stay on their own
- `waveformThumbnail.ts` - Isomorphic base64/int8 codec for baked sample and clip waveform thumbnails (ADR-401). Shared by the Places catalog generator (`scripts/audioThumbnailCache.ts`, encodes) and the browser tile (`BrowserPresetWaveform.svelte`, decodes). `THUMB_BINS`/`THUMB_VERSION` are the format contract

## Entry Points

- `routes/+layout.svelte` - Root layout: theme, WebSocket connection, service init
- `routes/+page.svelte` - Main UI with 5-panel layout (browser, tracks, middle, central display, right sidebar)

## Conventions

- Components write to Live through the named commands in `services/` (`trackCommands`, `clipCommands`, `sessionCommands`, `deviceParams` …), never `simpleClient.ts` directly; `npm run check:writes` fails on a component that imports it. The services send through `simpleClient.ts`
- See `interface/CLAUDE.md` for tech stack conventions (Svelte 5 runes, Tailwind 4, shadcn-svelte)
