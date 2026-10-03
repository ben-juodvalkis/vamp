# UI architecture

> **Cleanup in flight (2026-04-21).** This doc reflects the
> Python-surface-only wire. The v3 store layer
> (`stores/v3/normalized.svelte.ts`) is the authoritative source for
> track / device / param state; legacy v6 stores remain for
> not-yet-migrated concerns (gesture browser state, FX grid,
> coordinators). Final pruning of v6 stores that duplicate v3 fields
> is tracked in
> Looping's `documentation/archive/m4l-to-python-v3/10-cleanup-plan.md`.

SvelteKit app, Svelte 5 runes throughout (`$state`, `$derived`,
`$effect`, `let { prop } = $props()` — **no legacy `$:` syntax**).
Tailwind 4 + shadcn-svelte for UI primitives.

Companion: [architecture.md](architecture.md) covers the process
topology; [wire-protocol.md](wire-protocol.md) covers the OSC
contract this UI speaks.

## 1. App entry

```
interface/src/
├── routes/
│   ├── +layout.svelte          # Root layout — theme, WebSocket, service init
│   └── +page.svelte            # Mounts lib/layouts/default/Layout.svelte,
│                               #   the main UI — 5-panel layout; flex column
│                               #   (optional transport header over the
│                               #   3-column row), rows carry explicit
│                               #   flex-grow so session mode can animate
│                               #   and collapse them (ADR-415)
└── lib/
    ├── actions/                # The pointer primitive — use:press, use:drag
    ├── api/                    # OSC client + WebSocket + handlers
    ├── stores/                 # Reactive state (v3 + v6)
    ├── services/               # Business logic, coordinators, adapters
    ├── components/v6/          # All UI components
    ├── config/                 # Device presets, FX grid layout
    ├── types/                  # TypeScript types
    └── utils/                  # Logger, watchdog, helpers
```

Access: Mac `http://localhost:3000` · iPad `http://192.168.100.1:3000`
(USB-C network bridge).

## 2. Data flow

```
     ┌─────────────────────────────────────────────────────────────┐
     │                        Component                             │
     │   $derived from store getters   +   event → store method    │
     └───────────┬─────────────────────────────────────┬───────────┘
                 │                                     │
                 │ reads                               │ writes
                 │                                     │
     ┌───────────▼─────────────┐     ┌─────────────────▼───────────┐
     │    stores/v3/*          │     │       simpleClient.ts        │
     │  normalized.svelte.ts   │     │   (send OSC to surface)      │
     │  meters / property /    │     └─────────────┬───────────────┘
     │  handshake              │                   │
     └───────────▲─────────────┘                   ▼
                 │                     ┌───────────────────────────┐
                 │ handler mutates     │   WebSocketConnection      │
                 │                     │   (bridge link + watchdog) │
     ┌───────────┴─────────────┐       └─────────────┬─────────────┘
     │    api/handlers/v3*.ts  │                     │
     │  v3StateFull / v3Param / │                    ▼
     │  v3Invalidate / ...     │◀──── WS message from bridge
     └─────────────────────────┘
```

Reads use derived getters on store objects; writes go through
`simpleClient.ts`. Incoming WS messages are dispatched by address in
`api/simpleClient.ts` to the matching handler under
`api/handlers/v3*.ts`. Handlers mutate the v3 store.

## 3. API layer (`lib/api/`)

| File                                       | Role |
| ------------------------------------------ | ---- |
| `simpleClient.ts`                          | Primary OSC client. Routes WS messages to handlers, manages WebSocket lifecycle, auto-initializes v3 session on connect. Listens for `bridge-resync` window event; fires `sendStateResync()` on visibility-resume (reconnect resync rides on the v3 handshake accept auto-emitting state/full). |
| `connection/WebSocketConnection.ts`        | WebSocket lifecycle. Exponential-backoff reconnect (1s → 30s cap). Liveness watchdog: expects any inbound frame within 12s; silent socket force-closed to trigger reconnect. Swallows `/bridge/ping` inbound and stamps `lastInboundTs`. Dispatches `bridge-resync` on every successful open. |
| `handlers/v3*.ts`                          | Per-address handlers — see table below. |
| `handlers/miscHandlers.ts`                 | `/bridge/ping`, `/bridge/status`, init. |

### 3.1 v3 handlers

| Handler                       | Owns |
| ----------------------------- | ---- |
| `v3Handshake.ts`              | `/looping/v3/handshake/accept` — writes `sessionId`, `generation` to handshake state. Triggers state/full subscription. **Retries `hello` every 2s until accepted, bounded at 8 (ADR-418)** — the hello crosses an unacknowledged UDP hop, and a drop meant no accept, so no state/full, so no tracks/meters/playheads while writes kept working. **Ignores accepts naming a version the UI never advertised**: accepts are broadcast to every client and clients negotiate independently (menubar sends `3.3.0`), while a genuine mismatch arrives on `/looping/v3/error`, never as an accept. |
| `v3StateFull.ts`              | `/looping/v3/state/full/{begin,chunk,end}` — chunked decoder. Parses T/D/P/S/C records into normalized store. Supports scoped bundles via `mergeSubtreeAtPath`. |
| `v3Invalidate.ts`             | `/looping/v3/state/invalidate` — drops cache entries rooted at each listed path, refreshes generation mirror. |
| `v3ParamValue.ts`             | `/looping/v3/param/value` — echo / listener fire. |
| `v3Property.ts`               | `/looping/v3/property/value` — device-property listener fire / subscribe-echo. |
| `v3Clip.ts`                   | `/looping/v3/clip/{created,removed,focused,property}` + `/clip/set/*` echoes. |
| `v3ClipGroove.ts`             | `/looping/v3/clip/groove/{has_groove,property}`. |
| `v3TrackMetadata.ts`          | `/looping/v3/tracks/{added,removed}`, track-level field updates (mute/solo/arm/volume/color/name). |
| `v3HasArrangementClips.ts`    | `/looping/v3/track/has_arrangement_clips`. |
| `v3MasterMetadata.ts`         | Master track volume + mixer state. |
| `v3Meter.ts`                  | High-frequency meter stream (separate store to keep the normalized store hot-path clean). |
| `v3SelectedTrack.ts`          | Echo of `song.view.selected_track` writes. |
| `v3SelectedScene.ts`          | Echo of `song.view.selected_scene` writes. |
| `v3Session.ts`                | Session-global fields (tempo, transport, metronome). |
| `v3SurfaceHello.ts`           | `/looping/v3/surface/hello` — detects Python Control Surface restart via `surfaceInstanceId` mismatch and clears session state. |

## 4. Store layer

Two store families:

### 4.1 v3 stores (`lib/stores/v3/`)

The authoritative reflection of the wire contract. These are what
handlers mutate and what components read for track / device / param
state.

| Store                            | Purpose |
| -------------------------------- | ------- |
| `normalized.svelte.ts`           | Track / device / param tree. Path-keyed maps: `trackByPath`, `deviceByPath`, `paramByPath`. Carries `generation` mirror, `sessionId`, `lastChunkGen`. Exposes `mergeSubtreeAtPath` for scoped `state/full` bundles. |
| `meters.svelte.ts`               | Per-track meter levels. Separate store so 30 Hz meter updates don't churn the normalized tree. |
| `propertySubscriptions.svelte.ts`| Active `property/subscribe` set. Survives reconnects — re-subscribed after `handshake/accept`. **A device replaced at a live path is the surface's problem, not this table's:** subscriptions are keyed `(devicePath, propertyName)` and every consumer's `$effect` keys on the path string, so a preset load in replace-instrument mode changes nothing here and nothing re-subscribes. The surface re-binds its half onto the newcomer and pushes fresh values — see the `property/subscribe` row in `wire-protocol.md` §2. `releaseUnderPath` is wired to `state/invalidate`'s paths tail, which the surface has never populated, so it does not run in production. |
| `handshakeState.svelte.ts`       | Handshake lifecycle (idle / sent / accepted / error), chosen version, error code for banner display. |

### 4.2 v6 stores (`lib/stores/v6/`)

Pre-migration stores that still own concerns not yet pulled into the
v3 normalized tree. They read values from v3 where shared.

| Store                            | Purpose |
| -------------------------------- | ------- |
| `selectedTrackStore.svelte.ts`   | Selected-track-scoped accessors (devices-on-selected, current-param list). Reads from v3 normalized; UI components bind here rather than deriving from normalized directly. |
| `clipStateStore.svelte.ts`       | Clip playback state / recording status / loop positions. |
| `clipPropertiesStore.svelte.ts`  | Focused-clip properties (loop/markers/warp_mode/looping/pitch_coarse + M2 `pitchFine`/`gain`). Fed by `/looping/v3/clip/property` echoes (focus-scoped); `clearAll()` on focus change wipes the v3-owned fields. Optimistic writes apply here then send `clip/set/*` (ADR-358). |
| `clipEditorStore.svelte.ts`      | Single boolean for the manual device↔clip-editor toggle (clip-view-mirror M1, decision 8). `ClipCentralView` shows `ClipEditorView` when `active`, else the button rail. Never auto-flips on focus. |
| `focusedNotesStore.svelte.ts`    | Id-keyed note map for the central editor's focused clip (clip-view-mirror M3/M4, ADR-382). Fed by `clipRichNotesService`. `reconcile()` (fresh rich pull replaces the map), `optimisticAdd/Modify/Remove`, `nextTempId`/`swapTempId`. `clearAll()` on focus change (session). |
| `clipGrooveStore.svelte.ts`      | Groove timing + quantization. |
| `sequencerStore.svelte.ts`       | Permute pattern state (mute / pitch steps, lengths, rates, chance, temperature) read from `paramByPath`; controls addressed by **role** and resolved to parameters by **name** through `config/permuteLayout.ts` (ADR-429) — never by index. **Follows the pad scope (ADR-435):** while a pad is held or latched on the selected track's Drum Rack the store is that pad's Permute (the one in its chain, by class and name), the ghost is the pad without one and the first edit loads one into the pad; `scope` / `temperatureInert` say so. |
| `browserModeStore.svelte.ts`     | Preset browser mode: open / persistent / lock, replace modes, scale, and the MIDI \| Simpler \| Audio switch (`sourceMode` × `audioLoadTarget`, persisted). |
| `browserNavigationStore.svelte.ts`| Folder navigation, breadcrumbs, and each rail button's remembered location per half of the switch. |
| `centralDisplayStore.svelte.ts`  | Which device detail view is showing. |
| `fxGridStore.svelte.ts`          | FX grid device loading, ghost devices, parameters. **One slot table per pad scope since issue #491 (2026-09-10):** `getSlot` / `loadDevice` / `storePendingParam` take a `scope` — a pad path — and then match against the pad's chain (`selectedTrackStore.padDevices`, which stands in from `vm.padFx` presence before the pad's records land), send `device/load` with the pad as its target, and drain pending values into the device that arrives ON THE PAD (`checkLoadingCompletion` reads the scope off the arriving device's path, so a track-level Reverb cannot complete a pad-scope Reverb load). A `load-failed` carrying `;scope=` resets that scope alone. Slot state is never cleared on release — a load outlives a hold. |
| `drumPadScope.svelte.ts`         | Which Drum Rack pads are held or latched, the one scoped-write rule every virtual-macro writer shares (ADR-428), and since issue #491 the **pane** — the device type the Drum Rack view shows for the scoped pad, whose lifetime is the scope's. **ADR-436:** a hold lifted while a finger is still down on a control keeps its scope until that finger lifts — a write gesture never changes target mid-drag, and the tile stays lit because it is still the target. Window pointer listeners in the capture phase feed it; momentary, never a latch. See `stores/v6/CLAUDE.md`. |
| `fxSlotStore.svelte.ts`          | Individual FX slot states. |
| `currentInstrumentStore.svelte.ts`| Current instrument type on selected track. |
| `recentInstrumentsStore.svelte.ts`| Recently loaded instruments. |
| `captureStore.svelte.ts`         | Recording / capture state. |
| `slotRegistry.svelte.ts`         | Maps device slots to definitions. |
| `uiPrefsStore.svelte.ts`         | Persistent UI display toggles (localStorage), all default-off and carrying no Live state. ADR-415/416 add the three section toggles — `sessionMode`, `showCentralView` and `showFxGrid` (the last two default **on**, so they read inverted from storage) — plus `showTransportHeader`, `flipLayout` and `showDrumPads` (the Drum Rack view's pad column, default **on**, and the one row that is not a whole section). All seven are set from the **Sections card** in `SystemCentralView`, as seven identical rows in screen order (Header · Solo · Clips · View · Pads · FX · Flip). See `docs/reference/toggles.md`. |
| `sceneWindowStore.svelte.ts`     | The single shared scene-scroll window for session mode (ADR-415) — every track's `SlotGrid` column plus the `SceneRail` — or, when the full grid is hidden, the clip view's `MiniSessionGrid` — read one offset, which is what keeps their rows aligned and scrolling together. `renderedRows` (`min(sceneCount, 4)`) is the divisor both use to turn their section into a row pitch, so a set with fewer scenes than the window draws taller rows rather than dead space. Offset is in scene **rows** (float mid-drag, snapped on release); `sceneCount` derives from the widest `track.slots` map; clamped on read as well as write so deleting scenes can't strand it. Resets on `bridge-resync`. |
| `v3ErrorBannerStore.svelte.ts`   | Toast / banner state for `/looping/v3/error` events. |

### 4.3 Store pattern

```typescript
// Store pattern — exported reactive state behind getters
let selectedTrack = $state(0);
let devices = $state<Device[]>([]);
let currentDevice = $derived(devices[0]);

function selectTrack(index: number) {
  selectedTrack = index;
}

export const trackStore = {
  get selectedTrack() { return selectedTrack; },
  get devices() { return devices; },
  selectTrack,
};
```

Rules:
- `$state` is module-local, exposed via getters.
- `$derived` computations live next to the state they derive from.
- No mutation outside the store module.
- Stores use `.svelte.ts` extension so the compiler wires runes.

## 5. Services (`lib/services/`)

Business logic, no Svelte dependency except coordinators.

### 5.1 Core services

| Service                  | Purpose |
| ------------------------ | ------- |
| `instrumentService.ts`   | Identifies instrument types (drumrack, wavetable, omnisphere, …) from device info. Every `DrumGroupDevice` is `drumrack` since ADR-428 — the view picks its own profile from the surface's `vm.members` census. |
| `drumVirtualMacros.ts`| UI side of the Drum Rack virtual macros (ADR-428): the `vm.*` names, the `vm.members` census parser, the kit profile (`full` / `simpler` / `sampler` / `rack-macros` / `pitch-only` / macro grid, by dominant pad class), per-function state (`live` / `held` / `none` / `unknown`), writability, and the pad-grid layout helpers (`padTileLabels`, `padColorCss`, `padGridNotes` — the playing clip's pads, Live's selected pad and every held pad — `padGridShape`, which stacks four down a column before starting a second, and `padGridCell`, which places each column bottom-up). `profileFunctions` says which functions a profile draws — `gain` is on all of them but the macro grid. Shared by the Drum Rack view and `clipTranspose` (the FX-grid `InstrumentControl` was the third reader until ADR-438 deleted it). |
| `clipTranspose.ts`| Pitch shifting by track / instrument type: Drum Racks through `vm.pitch` (never note-shifted), instrument racks by a name-resolved macro, audio clips via `pitch_coarse`. |
| `clipOperations.ts`      | Clip recording, looping, timing operations — wraps `/looping/v3/clip/*` addresses. |
| `trackPreparation.ts`    | New track setup via `/looping/v3/track/prepare_for_preset`, routing, initialization. |
| `deviceMoveService.ts`   | Device reorder on a track's chain. |
| `trackCommands.ts`       | UI-initiated track-metadata writes with optimistic store apply (volume / master-volume / name / mute / solo). See §5.2. |

### 5.2 UI-write commands and optimistic store apply

Every UI-initiated value write — `track/{volume,name,mute,solo}`,
`master/volume`, `param/set`, `property/set` — applies to the v3
store **before** emitting OSC. The store is the single source of
truth; components read it via `$derived` and never maintain a
parallel optimistic field.

The pattern is load-bearing because the surface arms one-shot **echo
suppression** per UI write to keep the wire quiet during fast drags.
Without the local apply, the store never sees what the UI just
sent — drags display the right value via per-component optimistic
state, then snap back to the load-time store value when that
optimistic state clears (issue #399 follow-up).

Implementation lives in two places:

- **Track metadata**: `services/trackCommands.ts` exports
  `setTrackVolume`, `setTrackVolumeByIndex`, `setMasterVolume`,
  `setTrackName`, `setTrackMute`, `setTrackSolo`. Each pairs
  `applyTrackMetadata` / `applyMasterMetadata` with the matching
  `send`.
- **Params and properties**: `selectedTrackStore.setParamValue` and
  `setPropertyValue` (in `lib/stores/v6/selectedTrackStore.svelte.ts`)
  do the same shape for `/looping/v3/param/set` and
  `/looping/v3/property/set`. `setParamValue` additionally **arms**
  the path before applying — see ADR-359.

Components call commands; they don't `send` directly for value
writes. **Reconciliation:** outside edits (Live → UI) and rare LOM
rejections bypass suppression and arrive via the standard listener
echo, which calls the same apply path — the store reconciles.
State/full bundles also re-hydrate values on the T-record.

**Param reads (ADR-359, 2026-04-29).** FX components read parameter
values via `selectedTrackStore.paramValueArmed(path)`, which returns
the UI-armed value during a drag's round-trip and the v3 store value
otherwise. Component-local `$state` shadows for parameter display are
gone; the read is a pure `$derived` against the store. The arm makes
lossy-quantization round-trips not flicker (the store-level mirror of
the surface's echo suppression). Pre-load FX-grid gestures land in the
store via `fxGridStore`'s new-device hook, which fires synchronously
inside `reconcileDevices` on every new-device insert and seeds the
just-arrived `ParamRecord`s with the user's intent before any reactive
consumer can observe them — closing the snap-back race the prior
`slot.pendingParams` + `checkLoadingCompletion` flow had on every
ghost-tap-load. See `lib/stores/v3/paramArming.svelte.ts` for the
primitives (`armParam`, `armSpeculative`, `consumeSpeculative`,
`reconcileEcho`).

**Control wires** (`track/{select,delete}`, `clip/launch`, etc.)
have no value-write semantics and don't follow this pattern; they
fire and forget. `docs/reference/wire-protocol.md` §4.4 documents
the contract from the wire side; ADR-358 covers the design
rationale and the dead-end attempts that preceded it.

### 5.3 Coordinators (`.svelte.ts`)

Use runes to bridge service logic with reactive UI state.

| Coordinator                            | Purpose |
| -------------------------------------- | ------- |
| `instrumentDisplayCoordinator.svelte.ts`| Syncs instrument selection with central display. |
| `clipDisplayCoordinator.svelte.ts`     | Syncs clip state with visualization. |

### 5.3a The swap pill (ADR-439 / ADR-440)

One control, three sources, **two shapes** (2026-09-16). `SwapControl.svelte`
is two half-pill buttons under one centered name, each with its own press
(ADR-427), in either orientation:

- **Flat** (`orientation="horizontal"`) — one touch row tall, as wide as the
  group of controls it heads; the **left half steps back, the right half
  steps next**. A view places it over its leading group through
  `HostedSwapPill`, which claims the `swapHost` context `CentralDisplay`
  provides. Drift, Instrument Rack, Meld, Omnisphere, Operator, Sampler,
  Simpler, Wavetable and every Drum Rack kit (and a pad's effect pane) do. A
  flat pill narrower than 6.5rem draws its arrows and no name.
- **Column** (the default) — stood on its end down the left of the view,
  `--height-touch` (44 px) wide, the name reading bottom-to-top; the **top half
  steps next, the bottom half back**. `CentralDisplay` draws it only while no
  view has claimed `swapHost`: Collision, Electric, Pattern Rack, the audio
  clip view.

A tap from one flat-pill view to another claims the new pill before the old
one's teardown releases, in one flush, and Svelte hands a teardown the values
from before that flush. So `SwapHost` counts claims in a plain field and only
writes the count into `$state`: a `claims -= 1` that read the signal got the
pre-claim value, wrote 0, and drew the column beside the flat pill after
every such tap (2026-09-16; `SwapControl.test.ts` switches two hosted pills).

`.swap-name` spans both halves with `pointer-events: none` in either shape, so
a press on the name reaches the half under it; without that declaration the
control is dead everywhere except two thin strips, which is what
`drumrack-swap-pressed` in `npm run shot:tour -- central` guards.

What fills it depends on the view. Two hooks pick the source and own the press:

| Module | Owns |
| --- | --- |
| `central/useInstrumentSwap.svelte.ts` | Which of the three services the selected track's view uses, and the pill's label, enabled/working/error state. |
| `central/useClipSwap.svelte.ts` | The same for the clip view, over the focused audio clip. |
| `services/similarSwap.svelte.ts` | **Drum Racks.** `/looping/v3/drum/swap_similar` to the bridge, which drives Live's own Swap All / a pad's Drum Sampler arrows through the AX helper. Kit- or pad-scoped. Swaps serialize across every rack. |
| `services/presetSwap.svelte.ts` | **Everything else with a preset.** Folder-next: the neighbor of `TrackRecord.preset` in its Place's folder, loaded by `prepare_for_preset`. No AX helper involved. |
| `services/presetSwapCatalog.ts` | Where a recorded preset sits in its Place's folder. The path is read through the Places **alias map** first (a record from before the Places names the old vendor tree), then the Place whose folder holds it answers the exact leaf, so a path no Place holds costs no catalog fetch at all. |
| `services/clipSimilarSwap.svelte.ts` | **Audio clips.** `/api/similar-samples` ranks Live's own index, then `/looping/v3/clip/swap_file` puts the neighbor in the slot keeping the clip's settings. Answers are cached server-side; `sync` short-circuits on `ready`, `loading` **and** `unavailable`. |
| `services/swapErrors.ts` | A refusal is transient: a reason is held 6 s keyed by path, then the name returns, and `bridge-resync` flushes them all. Keyed positionally, so a deleted track cannot hand a different rack a stale label. |

The codes a performer can meet are phrases on the pill, not codes:
`swap-at-the-end` (the kit sits on its reference — Live greys that one
direction), `swap-not-rankable` (Live's index holds no embedding for these
samples), `swap-busy`, `ax-helper-down` / `ax-untrusted` (the helper is not
installed or not trusted — see INSTALLATION.md Step 9a).

### 5.4 Adapters (`services/adapters/`)

Preset browser strategies — each implements a common `BrowserAdapter`
interface.

| Adapter                      | Purpose |
| ---------------------------- | ------- |
| `browserAdapter.ts`          | Base interface. |
| `placesAdapter.ts`           | A Place in Live's sidebar (`place:<id>`, `/api/places/<id>.json`, built at runtime by the Mac's Places service): its presets, or its samples and clips, by the browse switch's kind filter. The browser's only catalog since the browser-places cutover (2026-09-24), which deleted the vendor, type-first and audio-clips adapters. |
| `recentInstrumentsAdapter.ts`| Recently used instruments and samples, read through the Places alias map. |
| `index.ts`                   | Adapter registry: Recent or a Place. |

Multi-root browsing (post-ROW 4): the surface's `DeviceLoadComponent`
reads `paths.placesRoots` from `constants.json` and walks each root
via `browser.user_folders`. Permute (`Vamp Devices/Permute/Permute.amxd`
in this repo, the `Vamp Devices` Place) is reachable via `browser.load_item`
directly rather than needing a filesystem loader.

### 5.5 Lifecycle

`services/serviceCleanup.ts` wires service init / teardown into
`+layout.svelte`.

## 6. Components (`lib/components/v6/`)

Organized by functional area. Touch-optimized for iPad Safari —
all interactions must work with touch.

| Directory       | Purpose |
| --------------- | ------- |
| `browser/`      | **DrillDownBrowser** (ADR-391) — one-layer-per-tap preset browsing over Live's sidebar Places (Recent + one rail button per Place), a MIDI \| Simpler \| Audio switch, and the scale picker. |
| `central/`      | **CentralDisplay** — main content area. `viewRegistry.ts` maps device types to view components; `views/` has 40+ device-specific views. **Groups inside a view are separated by `central/SectionDivider.svelte`, not fenced in a card (ADR-433)** — see §6.3. `views/ClipEditorView.svelte` is the clip-view-mirror editor canvas (M1–M4): piano-roll/waveform mirror of the focused clip with grid+axes, DOM notes, waveform, 30 Hz playhead, draggable loop braces (dedicated handle elements, own pointer listeners), and audio pitch/gain sliders. **M3/M4 (ADR-382):** MIDI notes from the rich, id-carrying channel (`focusedNotesStore` ← `clipRichNotesService`); a select/draw toggle, per-note move/resize, tap-select→Delete, draw-to-add, all optimistic with `notes/changed` reconcile (own-write echo suppressed). Toggled in/out by `ClipCentralView` via `clipEditorStore`. **`ClipCentralView`'s control rail grows 9 → 10 columns** for `session/MiniSessionGrid` when the full clip grid is off (`uiPrefsStore.miniSessionActive`), and the mini takes the **leading** one at the rail's own pitch — as wide as every other column, and read before the controls that act on the clip it names; the nine existing columns are placed by explicit `grid-column` and shift one right while it is up. Coordinate + gesture math in `lib/utils/clip/`. **Clip type comes from `selectedTrackStore.trackType`, not `clipPropertiesStore.clipType`** (the latter is null for the focused clip on the v3 channel). **`views/DrumRackCentralView.svelte` is one view for every `DrumGroupDevice` (ADR-428):** it reads the surface's `vm.members` census and renders the virtual-macro controls (DrumCell kits), the Simpler or Sampler row, one control per pad-rack macro name on a kit of nested Instrument Racks, the pad-class card + Trnsp on any other native class, or `DrumRackMacroGrid` (plugin-hosted pads). Beside them sits `views/DrumPadGrid.svelte` — the pads in play (the clip's, Live's selection, anything held), stacked four to a column and reading bottom-up, where holding a pad scopes every control to it **and lends them its chain colour** — switchable from the Sections card's **PADS** row; and at the row's end a **Gain** slider on every profile but the macro grid. States, profiles and the pad grid in `components/v6/CLAUDE.md`. |
| `device-panel/` | **FX Grid** — 11-slot effects grid on twelve columns (Echo, Reverb, EQ, …). Has its own CLAUDE.md with tap-to-load patterns. Every cell is placed explicitly: Squash and Gain are full-height columns on every track; MIDI adds Rand Oct and Variation full height, audio puts the Guitar full height at the far left with `BassControl` over Variation, and master takes `OttControl` in Rand Oct's place (ADR-438 and its addendum). The instrument slider and the clip-pitch tile were deleted with that cut and the Guitar tile moved into `PedalCentralView`; the track strip's device band opens instrument views now. |
| `layout/`       | **Main Layout** — TracksPanelV6 (left), MiddlePanelV6 (center), DevicesPanelV6 (right). TracksPanelV6's row is a grid so an open Group Track can draw a "panhandle" — an arm out of the top-right of its own strip, reaching over its members. The group's strip stays full height and the arm is part of its outline — it matches the strip's field (wash + meter-well `::before`) and follows it through the selection highlight, so the whole ⌐ perimeter selects as one shape; the member strips start below the arm with a gap (ADR-413). |
| `tracks/`       | **TrackStrip** — track display/control, volume meters, mini sequencer. Mute, the group fold arm and the per-track stop button run on `use:press` (ADR-427): mute fires at **finger-down** with `touch-action: none` and `momentaryPress.ts`'s momentary-release rule; solo is two fingers on the Card (a chord in `useStripGestures`, same rule; the Solo button went 2026-10-01); the stop cell and the fold arm keep `pan-x` and fire on release. The ADR-384 gesture machine lives in `composables/useStripGestures.svelte.ts` (vertical-dominant drag / horizontal-dominant row scroll / tap), run by the strip Card and — in session mode — by a second, independent instance in the clip grid. **Session view (ADR-415):** `SlotGrid` + `SlotCell` render a track's clip slots, but they are mounted by **`TracksPanelV6`, not by `TrackStrip`** — the grid is a second row inside that panel's single horizontal scroller, so one `scrollLeft` keeps a clip column from ever drifting out from under its strip, and the grid gets a full third of the main area rather than a fraction of the strips' third. (An earlier draft hung a `SlotGrid` off each strip as a Card sibling; ADR-415 records why that was dropped.) Being outside every strip's Card is still what keeps a grid drag from reaching the volume fader. `SceneRail.svelte` is the sidebar twin, sharing `sceneWindowStore`. Cell state derivation is a pure function in `TrackStrip/utils/slotCellState.ts`; what a cell tap DOES lives in `composables/slotActions.ts`, shared with the FX grid's `MiniSessionGrid` so a cell cannot mean two different things. |
| `clips/`        | **Loop Control** — clip recording/playback, sequencer grids, mute/pitch sequencers, quantize/groove. |
| `midi/`         | **MIDI Controls** — pitch/mod wheels. |
| `controls/`     | **Misc Controls** — record button, rack variation chooser, velocity range. |
| `parameters/`   | **Parameter Controls** — drag action handlers. |
| `simpler/`      | **Simpler Device** — Simpler-specific controls. |
| `session/`      | **Session Management** — `SessionHeaderV6` (optional slim transport header, ADR-415: transport, STOP ALL, drag-tempo, time signature, metronome), reset, `V3ErrorBanner`. **`MiniSessionGrid`** is the clip grid in miniature for the layouts that hide the full one: the *selected* track's column in the **leading**, full-height column of **`ClipCentralView`**'s control rail — one column at that rail's own pitch, as wide as every fader and button beside it, and read before them — gated by `uiPrefsStore.miniSessionActive` (MINI on · CLIPS off — plus the clip view actually being the one on screen, which the host answers by rendering). It sits beside Chance, Temp and Shuffle because everything else in that rail is already about the clip you are looking at; what the rail could not say was *which* clip, and with CLIPS off nothing on screen could. It mounts the same `SlotGrid` and routes taps through the same `tracks/composables/slotActions` as `TracksPanelV6`, so a cell cannot come to mean one thing there and another here — which matters because a body tap aims the **foot pedal**. It shares `sceneWindowStore` with the full grid, and runs the two window effects `SceneRail` owns (persisting the offset clamp, `ensureRowVisible` on the selected scene) for the layouts where the rail is unmounted. Its own row pitch is its box ÷ (`renderedRows` + 1), the same recipe the grid and the rail each use on their own section, and its stop button takes that pitch minus the gap as its flex **basis** (a `height` there loses to the basis, which is how it came to draw a gap taller than the cells above it). No title row: the track's name above the cells repeated what the strips and the cells' own ink already say. (The **CLIPS / VIEW / FX** section switches used to live here as `SessionLayoutToggles`; they are now rows of the Sections card in `SystemCentralView`, beside Solo, Header and Mini.) |
| `looping/`      | **Performance Viz** — meter visualization. |
| `debug/`        | **Dev Tools** — OSC tester. |

### 6.1 Component conventions

- Bind to store getters via `$derived`:
  ```svelte
  <script>
    import { trackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
    let selected = $derived(trackStore.selectedTrack);
    let devices  = $derived(trackStore.devices);
  </script>
  ```
- Events mutate store methods or go through `simpleClient.sendOsc()`.
  Never reach into another component's DOM.
- Props are typed: `let { trackIndex, onRelease }: { trackIndex: number; onRelease?: () => void } = $props();`
- Tailwind utility classes for everything visual; no CSS modules.
- shadcn-svelte for primitives (button, card, input, badge, sheet,
  dialog). Add new ones via `npx shadcn-svelte@latest add <name>`.

### 6.2 Input: one pointer primitive (`lib/actions/`, ADR-427)

Every interaction on the performance surface goes through `use:press`
(discrete) or `use:drag` (continuous). The invariant they exist to hold:

> Every interaction is owned by exactly one pointer, identified by its
> `pointerId`, from the moment it starts to the moment it ends. No
> handler ever asks "where is the finger" — only "where is *my* finger."

| File | Role |
| ---- | ---- |
| `pressMachine.ts` | Pure. One discrete press per `pointerId`: `down` / `hold` / `release` with an explicit reason (`up`, `cancel`, `teardown`, `slop`). |
| `dragMachine.ts` | Pure. One continuous drag per `pointerId`: slop threshold + axis commit. Also what `useStripGestures` runs on, so there is one implementation of both. |
| `press.ts` | `use:press`. |
| `drag.ts` | `use:drag`. |

**Why actions rather than composables.** An action attaches to a DOM
node, so its state is per-node automatically; it owns its own teardown,
which is what stops a strip unmounting mid-press from leaving a track
soloed with nothing left to undo it; and it writes `touch-action` onto
the same node it binds the handler to, so the CSS policy and the handler
cannot drift apart. They drifted apart once: `.header-name` computed
`touch-action: auto` (nothing declared it, and touch-action does not
inherit), which inside a horizontally-scrolling panel let the browser
claim the gesture and suppress the click mute rode on.

**The machines are pure** — no DOM, no `window`, no timers. Every input
carries its own `now`, and a hold threshold is crossed by an explicit
`tick()`. That makes a two-finger scenario a table test, and it is also
the only way the synthetic harness can drive them: it runs its preview
hidden, where `requestAnimationFrame` never fires and `setTimeout` is
throttled.

**Capture vs window listeners.** Both are correct; pick per control and
say why in a comment. `setPointerCapture` where the target is a single
stable element — the browser routes the pointer for you. Window listeners
with explicit `pointerId` filtering where the element can unmount or
re-render mid-gesture, which on this surface is most of them (capturing
on a reactive component whose subtree re-renders drops `pointerup` on
desktop Chrome and the gesture never releases). `window` is the default.

**Timing policy.** `fireOn: 'up'` is the `click` replacement and the
default. `fireOn: 'down'` is zero-latency, and the rule for when it is
allowed is:

> Fire at finger-down wherever the control sets `touch-action: none`
> **and** has no drag meaning of its own, and nothing beneath it does
> either. Otherwise fire on release.

Solo always qualifies. **Mute qualifies conditionally** (ADR-427 addenda
1–3): the release-wait exists only to let a row pan begin on a track
name, so `TracksPanelV6` observes whether the row can actually scroll —
13 tracks fit a 1062px panel at 1366×1024 — and hands each strip a
`rowScrolls` flag. Below fourteen tracks mute is `touch-action: none` and
fires at finger-down (measured 103ms → 0); at fourteen and up it goes
back to `pan-x` and release.

**Both toggles are momentary**: tap latches, hold past
`MOMENTARY_HOLD_MS` (300) and the release restores the captured pre-press
state. The shared rule is `TrackStrip/utils/momentaryPress.ts`. On the
release-firing branch the momentary toggle fires at the hold threshold
rather than at down — by 300ms with no cancel the press is definitively
not a pan.

The per-track stop cell and the group fold arm keep `pan-x` and keep
firing on release, where the wait really does buy the pan. The master
card fires on release for a different reason: it has a volume drag
underneath, and a down-fire would re-select it on every fader move.

Never fire at down on a `pan-x` control: every row pan crossing it would
act and then un-act, which on mute is an audible dropout.

**Two enforcement points, because a codebase with 106 `onclick`s grows a
107th:**

- `npm run check:touch` (`scripts/check-touch-dialects.mjs`) bans
  `touches[0]` / `changedTouches[0]` anywhere in `lib`, and `onclick`
  under `components/v6/{tracks,layout,session,clips,controls}`. It masks
  comments and strings, so the components' own notes about the dialects
  they used to speak don't trip it. Vitest runs it on every push
  (`touchDialects.test.ts`).
- `npm run multitouch` (`scripts/shot/multitouch.mjs`) replays concurrent
  CDP touch streams against the real UI on the mock stack and asserts on
  what reached the surface. `npm run multitouch:webkit` runs the tap-only
  subset on a second engine; the concurrency scenarios are skipped there,
  because WebKit has no multi-finger input.

Neither is evidence about **iOS**, which layers its own gesture
recognizers on top of WebKit — `docs/reference/manual-test-checklist.md`
§13 is that half.

`central/views/**` is deliberately out of the gate's scope: those are
one-at-a-time device editing panels where a click is honest, and a gate
that failed on 80 sites nobody has a reason to change is a gate everybody
passes with `--no-verify`.

### 6.3 Grouping inside a central view (`central/SectionDivider.svelte`, ADR-433)

A central view is a 1366 × ~660 band, and almost every one of them holds
more than one logical part. **Separate them with a hairline; do not fence
them in a card.**

```svelte
import SectionDivider from '../SectionDivider.svelte';
…
<SectionDivider orientation="vertical" ink={device.color.primary} />
```

- `orientation` — `vertical` between columns (the common case in a wide,
  short band), `horizontal` between stacked rows.
- `ink` — optional. Pass the device's scheme primary where the seam
  divides one **device** from another (the Arpeggiator's four, the Drum
  Rack's pads from its controls). Leave it neutral where it divides two
  parts of the same device (Squash from its Compressor).
- The rule **fades at both ends**, so it reads as a seam rather than as
  another box edge — every control here is already a bordered box, and a
  full-strength line among them just looks like a third column of frames.
- It carries **no text**, and needs no wrapper: `flex: 0 0 auto`,
  `align-self: stretch`.

**Naming a group.** Most groups need no name — the seam plus the device's
own ink already says where the boundary is. Where one does, the name is a
**centred, upright eyebrow at the top of the group**: 0.75rem, weight
700, `text-align: center`, in the group's ink. Never rotated up the rule,
never left-aligned (left, it sits over the group's first control rather
than over the group).

**Seams in a grid** need a track, not just an element: add an `auto`
column (or row) and renumber. `repeat(9, 1fr)` becomes
`repeat(5, 1fr) auto repeat(3, 1fr) auto 1fr` — an `auto` track is the
hairline's own width, so the content columns still divide the rest
evenly. `ClipCentralView` and `SystemCentralView` carry literal
`grid-column` tables (a `calc()` on a grid line is not reliable in iPad
Safari), and the seams are numbered in them like any other column —
including in `ClipCentralView`'s `.outer.has-mini` fork.

**Why not a card.** A bordered, titled box costs a border, a radius, a
fill and the padding to keep the inner boxes off its edge: roughly 20px
of a 660px band per card, plus the title's line, taken straight off the
controls. Five views had grown one independently by September 2026;
ADR-433 records what each cost and what replaced it. A group that
genuinely needs to read as an **object** rather than as a set of controls
may still keep a frame — the Drum Rack's kit-class readout does.

`SectionDivider` carries its own flat-grammar fork (§8.1): a solid
`--line-strong` hairline rather than a fading one.

## 7. Config (`lib/config/`)

- `fxGridLayout.ts` — maps the 11 FX slot positions (`fx1`, `fx3`–`fx12`;
  `fx2` retired with the Guitar tile) to device types and Svelte
  components and explicit grid cells, on a **twelve-column** grid (ADR-438
  addendum). Squash and Gain are full-height columns; on MIDI so are Rand
  Oct and Variation, and on audio the Guitar is a full-height column at the
  far left with the Bass over Variation. `fx1` holds Rand Oct on MIDI, the
  Bass on audio and OTT on master, the last two mounted by `FXGrid` from
  their own slot keys. The Drum Buss is the `fx6` tile since ADR-431 (its Boom + Comp
  view is `device/drum`); the Saturator and, since ADR-438, the Guitar
  live inside the Pedal view.
- `devicePresets.ts` — device definitions with parameter names and
  ranges.
- `permuteLayout.ts` — the thin Permute's 38 pattern controls by role →
  long parameter name: the contract with
  `Vamp Devices/Permute/Permute.amxd` and the surface engine
  (ADR-429). `sequencerStore` resolves indices by name at runtime.

Class names and per-device metadata live in `devicePresets.ts`
(`expectedClassName`, effects and virtual devices) and
`services/instrumentService.ts` (`KNOWN_INSTRUMENT_CLASSES`).
`data/device-configs.json` is Python-only and no longer a class-name
map (stripped 2026-09-02 — see `data/CLAUDE.md`); parameter indices are
literals in the views, verified at runtime
(`docs/reference/extending-devices.md` §5).

## 8. Utils (`lib/utils/`)

| Util                     | Purpose |
| ------------------------ | ------- |
| `logger.ts`              | Centralized logging (DEBUG / INFO / WARN / ERROR / NONE). Always use this — never raw `console.log`. |
| `clientWatchdog.ts`      | Reports tab-visibility changes, rAF stalls, online/offline to the bridge via `/bridge/client_log`. Dispatches `bridge-resync` on visibility-resume. Started from `+layout.svelte` after WebSocket connect. **Also reports `uncaught-error` / `unhandled-rejection` (message, stack, source) and `reactivity-stall` (ADR-418)** — an error thrown inside a Svelte effect permanently wedges the effect scheduler, so reactivity dies app-wide while DOM handlers keep firing, and that stack is the only record of which component did it. The stall probe is a plain interval ticking a counter that an `$effect` in `+layout.svelte` echoes back; counters not clocks, so a throttled background tab can't false-positive. `reportBoundaryError()` logs `boundary-error` for errors a `<svelte:boundary>` swallowed, which never reach `window.onerror` (ADR-419). |
| `freeze-detector.ts`     | Detects UI freezes. |
| `reactive-monitor.ts`    | Monitors Svelte reactivity. |
| `parameterLookup.ts`     | Maps parameter IDs to values/ranges. |
| `sliderThrottle.ts`      | Rate-limits slider updates to prevent OSC floods. |
| `presetPath.ts`           | **What a preset's file path means, in one place** — shared with the Places catalog generator, which imports it. `folderSlug` is the generator's name → id / file-name rule (a Place's `place:<id>`); `aliasPresetPath` reads a path recorded before the Places through the alias map into its Sidebar copy; `presetCategory` / `libraryCategoryOfPreset` read a path's category folder (a Sidebar path's Place, or an old path's type folder) for track coloring's no-Place fallback and the strip's device band. Dependency-free, because the generator runs it under `tsx`. |
| `clip/clipEditorGeometry.ts` | Pure beats↔px / pitch↔px / zoom / pan / clamp math for `ClipEditorView` (no Svelte, no DOM). Unit-tested. |
| `clip/clipGesture.ts`    | Pure gesture helpers for the editor: `hitTestRange`, `snapToGrid`, `applyLoopDrag` (clamped loop-edge math), `clamp`, `pxDeltaToBeats`. The reusable muscle M4 note drag/resize will share. Also `loopBraceGridBeats` — the right sidebar loop brace's snap grid, picked by the clip's length (bars over 4 bars, half bars up to 4, quarter bars up to 2; the beat in 3/4). Unit-tested. |

### 8.1 Theme and the flat grammar (`stores/theme.ts`, `app.css`, `utils/paintTokens.ts`)

One axis is live; the other is frozen:

- **Theme** — polarity. `.dark` / `.light` on `<html>` (localStorage `theme`; `system` follows `prefers-color-scheme`). Every `dark:` Tailwind variant and `.dark`/`.light` token block keys off this.
- **Skin** — **frozen**. There is one skin, **Hybrid**, and it is no longer a choice: `data-skin="hybrid"` and `data-grammar="flat"` are hard-coded on `<html>` in `app.html`, so there is no store, no localStorage key and no FOUC window for the look. `data-skin` selects the **palette** token block; `data-grammar="flat"` switches on the **flat grammar** (Ableton Live 12's visual rulebook: 2px radii, dark 1px borders, no shadow/glow/wash, black text on colour, orange = ON, green = playing, red = rec, blue = selected). Hybrid is that grammar with the app's own cooler grey ladder, track inks clamped into a solid-fill envelope (`TRACK_INK`), and the device family keeping its colour on FX tiles. Token blocks live at the foot of `app.css` (`.dark[data-skin="hybrid"]` / `.light[data-skin="hybrid"]`, plus the `--flat-*` role tokens); components carry `:global([data-grammar="flat"]) …` overrides for what tokens can't express; Tailwind utilities get the `flat:` variant (`@custom-variant flat`). `paintTokens()` indexes by polarity alone; `trackInk()`/`deviceInk()` take a polarity argument that is **accepted and ignored** — the envelope is shared across dark and light.

  The retired **GRATICULE** skin was the base layer, and its token block is still there under bare `.dark` / `.light` because Hybrid is written as a delta over it. Retiring it removed the choice, not the CSS. See Looping's `documentation/archive/graticule-skin.md` — including the four device-family accents the cut exposed as split-brain. (A Live-palette skin — hex lifted verbatim from Live's `Themes/*.ask` files — was prototyped and removed earlier in favour of Hybrid; it lives in git history at `a48daf80` and would be one more token block.)

**Flat-grammar cookbook** — the rules every component override follows (scope: `:global([data-grammar="flat"])` in a component `<style>`, `[data-grammar="flat"] …` in `app.css`, or the `flat:` Tailwind variant):

**Flat-grammar cookbook** — the rules every component override follows (scope: `:global([data-grammar="flat"])` in a component `<style>`, `[data-grammar="flat"] …` in `app.css`, or the `flat:` Tailwind variant; palette forks under `[data-skin="hybrid"]`; **nothing outside those scopes may change** — Graticule must stay bit-identical under `npm run shot -- <view> --diff`):

| Concern | Flat rule |
| --- | --- |
| Surfaces | panels `var(--card)`; detail/device views `var(--popover)`; wells/fields `var(--surface-well)`; page `var(--background)`. No colour washes (`color-mix(ink N%, …)` backgrounds → solid surface; the ink moves to text / fill / arc). |
| Edges | `1px solid var(--line-strong)`; radius `2px` (`var(--radius-sm)`); **no** `box-shadow`, glow, `text-shadow`, `backdrop-filter`, gradients (except meter VU ramps). Use `var(--edge-light)` / `var(--well-shadow)` (both `none` under flat) instead of the inset literals. |
| Toggle / button | OFF: `background: var(--surface-well); border: 1px solid var(--line-strong); color: var(--foreground)`. ON: `background: var(--phosphor); color: var(--flat-on-fg)`; on `.light` keep `border-color: var(--line-strong)`. Prefer the shared `.physical-button` / `.device-segmented` classes (already flat). |
| State inks | rec `var(--act-rec)`, play `var(--act-play)`, quant/monitor `var(--act-quant)`/`var(--act-monitor)`, solo `var(--act-solo)` (+ `var(--flat-solo-fg)`), selection `var(--flat-selection)` + `var(--flat-selection-fg)`; ON fills carry `var(--flat-on-fg)`. |
| Text | `text-transform: none; letter-spacing: 0`; weights ≤ 500–600 (`var(--font-medium)`); body `var(--foreground)`, secondary `var(--muted-foreground)`, tertiary `var(--fg-tertiary)`. Author labels **mixed-case** (`title="Pitch"`); a component's own rule may still upper-case them (`text-transform: uppercase`) — the flat block sets `none`. |
| Value fills | device / track ink (the family keeps its voice). Ghost fills `var(--flat-disabled-fg)`. |
| Handles / grips | `var(--flat-handle)`, square. |
| Disabled | `opacity: 1; color: var(--flat-disabled-fg)` on the same field (never opacity dims). |
| Overlays | `var(--scrim)` / `var(--scrim-strong)` (background-alpha under flat), never `rgba(0,0,0,…)`. Playhead `var(--playhead)`. |
| Canvas paint | `paintTokens()` / `trackInk()` / `deviceInk()` only — they are token-aware; no literals. |
| Inline `style=` colours | lift into a `--custom-prop` set inline and read by the class (`style="--x: {expr}"` + `.cls { color: var(--x) }`), then the flat rule overrides normally. No `!important` in the flat scope. |
| Tailwind literals | `text-green-500`-style chrome → tokenise (`var(--act-play)`); `rounded-*` / `shadow-*` are inlined by `@theme inline` — override the class under the flat scope. |



## 9. Adding a new device view

1. Create the view component in `components/v6/central/views/`.
2. Register it in `components/v6/central/viewRegistry.ts`.
3. If it's an FX device, add a control in `components/v6/device-panel/`
   (see `device-panel/CLAUDE.md`).
4. Add device config in `lib/config/devicePresets.ts` if parameters
   need custom ranges or display names.
5. If the view has more than one logical part, separate them with
   `central/SectionDivider.svelte` (§6.3) — a hairline, not a card — and
   name a group only where the seam and the device's ink do not already
   say what it is.
6. If the LOM class emits properties beyond params (e.g.
   `sample.warp_mode` on Simpler), extend the surface's property
   allowlist — see [extending-devices.md](extending-devices.md).
7. Decide whether the device may live **inside a drum pad's chain**
   (issue #491): set `padScoped: true` on its preset and the tile and
   the view follow a held pad for free — they resolve through the
   `fxScope` context (`central/fxScope.ts`) and never switch the
   top-level view themselves (`services/deviceViewRouter.svelte.ts`
   routes a tap to the Drum Rack view's pane under a scope). Nothing
   in the view changes: it queries its slot through `useFxGridSlot`,
   which reads the scope.

## 10. Testing

Tests live in `interface/src/__tests__/`. Helpers:
- `mockOSC.ts` — message factories.
- `testFixtures.ts` — mock data.
- `storeTestUtils.ts` — async store helpers.
- Component render tests mount a real view against the real v3 store
  with `@testing-library/svelte` (`DrumRackCentralView.test.ts`,
  `OperatorCentralView.test.ts`, 2026-09-07). `vite.config.ts` aliases
  the bare `svelte` entry to its client build for vitest — without it
  `mount()` throws `lifecycle_function_unavailable`.

Commands:

```bash
npm run test           # Watch mode
npm run test:run       # Single run (CI)
npm run test:coverage  # With coverage
```

## 11. Troubleshooting: cache-related reactivity

If `$derived` stops working or the UI won't update:

```bash
npm run cleanup    # Clears .svelte-kit and .vite caches
```

All main dev commands (`npm run dev`, `npm run ipad`) run this
automatically. This fixes Svelte 5 reactivity tracking corruption
that occasionally survives HMR.
