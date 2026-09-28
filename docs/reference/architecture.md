# Architecture

System topology, component responsibilities, and data flow for the
Looping system — a live looping environment for Ableton Live with an
iPad touch interface.

> **Consolidation complete.** The system went from three backends
> (AbletonOSC + Max-for-Live ES5 observer + Python Control Surface) to a
> single Python surface that owns every wire. The last Max observer
> carriers (`ableton/scripts/liveAPI-v6.js`, `AbletonOSC helper.amxd`) and
> their bridge port pair were deleted 2026-09-23, with the dead
> Omnisphere/NI preset-server and shell-helper ports (general-release
> audit Tier 0).

## 1. Topology

```
  ┌──────────────────────┐        WebSocket         ┌──────────────────────┐
  │  Browser / iPad      │◀────── port 8081 ──────▶│  Enhanced OSC Bridge │
  │  SvelteKit UI        │                          │  (Node.js)           │
  └──────────────────────┘                          └──────────┬───────────┘
                                                               │
                                                     UDP/OSC   │
                                                               ▼
  ┌──────────────────────┐                          ┌──────────────────────┐
  │  Ableton Live 12     │◀────── LOM (Python) ────│  Python Control      │
  │                      │                          │  Surface             │
  │  - Python Remote     │                          │  port 11020/11021    │
  │    Script slot       │                          │  (surface/)          │
  │  - Max Patches       │                          └──────────────────────┘
  │    (hardware I/O)    │
  └──────────────────────┘
```

Four processes, one machine:

1. **Browser / iPad** — SvelteKit app served from `interface/`. The
   user-facing surface; all UI state lives here.
2. **Enhanced OSC Bridge** — Node.js process in `interface/bridge/`.
   Translates WebSocket frames (browser) to UDP/OSC packets
   (everything else). Pure router; no business logic.
3. **Python Control Surface** — installed into Ableton's User
   Library as a Remote Script (see [setup.md](setup.md)). Runs
   inside Live; owns every LOM call on behalf of the UI. Source
   lives in `surface/`.
4. **Looping AX Helper** (ADR-439) — the one process that touches
   macOS Accessibility, for what the LOM cannot reach: Clip View's
   Reverse, the Save As dialog, Live's similar-sample swap buttons.
   A signed app bundle (`~/Applications/Looping AX Helper.app`, source
   in `owner/ax-helper/`) started by a LaunchAgent, holding the one
   Accessibility grant — trust belongs to the launcher's responsible
   process, so it cannot depend on which terminal started the bridge.
   The bridge dials its owner-only Unix socket
   (`axHelper.socketPath`); the surface never talks to it, because AX
   is serviced on Live's main thread, where the surface runs, and a
   surface handler waiting on a press would deadlock it.

## 2. Roles and responsibilities

### 2.1 The UI (browser / iPad)

- Renders every control (tracks, mixer, clips, device panels,
  browser, central display).
- Holds normalized application state in Svelte 5 runes stores.
- Emits OSC addresses over WebSocket; receives state updates the
  same way.
- Never talks to Live directly. Its only peer is the bridge.
- The interface server (SvelteKit, `vite dev` on :3000 or `vite preview`
  on :8889) also answers a few HTTP routes for what only the Mac's disk
  holds: `/api/sample-peaks` (waveforms), `/api/similar-samples` (Live's
  index, ADR-440) and, since 2026-09-26, `/api/places/*` — the browser's
  catalog, built at runtime by the Places service
  (`interface/src/lib/server/places/`) for the Places ticked in Settings,
  from Live's index or the disk, with `/api/places/events` (server-sent
  events) telling every open page when to refetch. Nothing on these routes
  touches Live's thread.

See [ui-architecture.md](ui-architecture.md) for the SvelteKit
layout (routes, stores, services, components).

### 2.2 The bridge

- Serves a WebSocket on `osc.webSocket.port` (8081) for browser
  clients.
- Serves multiple UDP port pairs, one per backend. See the port
  map below.
- Routes inbound OSC messages by address pattern to the right UDP
  port (see [`routing/messageRouter.js`](../../interface/bridge/routing/messageRouter.js)).
  The primary backend is the Python Control Surface; the others
  (MIDI converter, TotalMix, the looping-recorder device) handle
  specialized traffic they own. An address no rule matches is logged
  and dropped.
- Owns the ping heartbeat, client liveness watchdog, and dead-
  client reaper. These cooperate with the browser's reconnect
  logic to recover from iPad Safari tab suspension.
- Logs WARN/ERROR to `logs/bridge.log`; DEBUG/INFO stay console-
  only.

See [`interface/bridge/CLAUDE.md`](../../interface/bridge/CLAUDE.md)
for file-level detail.

### 2.3 The Python Control Surface

- Subclasses `ableton.v3.control_surface.ControlSurface` and binds
  a UDP socket on `osc.pythonSurface.remotePort` (11020).
- Drains its inbound socket on every Live tick via
  `schedule_message` — handlers run synchronously on the main
  thread, so LOM access is safe.
- Owns every LOM read, listener, and write on the UI's behalf.
- Composed of ~30 `Component` subclasses in
  `surface/components/`, each responsible for one
  slice of the LOM surface (tracks, clips, devices, master,
  session, meters, handshake, etc.).
- Emits the v3 wire protocol (see [wire-protocol.md](wire-protocol.md)).

Why a Python surface and not AbletonOSC + Max:
- **Identity stability.** v3 addresses LOM objects by *positional
  path* (`tracks/0/devices/1/params/2`), not by C++ pointer id.
  Preset reload, plugin reconfig, and device reorder stop
  producing stale-id bugs. Max's LiveAPI exposes `_live_ptr`
  values that rotate on re-walk; AbletonOSC's model shares the
  same hazard at a different layer.
- **One place for LOM rules.** Live-12-specific quirks
  (`master.mute` raises RuntimeError; `Groove.base` has no
  listener; AU-plugin parameters hydrate post-insertion) all get
  handled in one codebase with shared error-handling patterns
  (`_LOM_ERRORS` tuple).
- **Testability.** Components are plain Python classes with
  injected `song` / `emit` / `schedule_delayed` dependencies;
  1000+ pytest tests run without Live. Max's ES5 JavaScript and
  AbletonOSC's scoped registration are both harder to isolate.

### 2.4 Max patches — hardware I/O only

Max lives only at the hardware edge, and since ADR-422 the pedals
don't need even that: with the pedal plugged in over USB and its port
assigned as the Looping control surface's MIDI **Input** in Live's
preferences, the surface's own `MidiPedalInput`
(`surface/components/midi_pedal_input.py`) receives
the CCs directly. The USB pedal sends everything on **MIDI channel
10**: trigger switch **CC 23** (incl. the 500ms tap/hold timer), wah
toe switch **CC 21**, wah expression **CC 20**. The foot switch is a user
setting learned from the System view (`FootSwitchComponent`, persisted to
`logs/foot-switch.json`; `midiPedals.footSwitchCC` only seeds it); the wah
CCs live in `constants.midiPedals` and are claimed only while
`features.expressionPedal` is on. Only those exact channel + CC pairs are
claimed — other traffic on the port falls through to the framework. What the
expression pedal drives depends on the kind of track under the selection
(ADR-445): the wah on an audio track, **MidiWheels** (the on-screen wheels'
device, its mod wheel) on a MIDI track, a wah already on the track winning
on either —
`docs/reference/toggles.md` has the rule, `surface/CLAUDE.md` the component.
The Max paths below stay for the owner's rig, in the standalone Max Utility
patch, which opens only while `features.maxUtilityPatch` is on
(`scripts/open-max-patch.js`). Its CC 67 chain is the home-studio
piano-pedal looper: the patch's `ctlin` hears every input on every channel,
so a piano's pedal taps and holds with nothing else plugged in. Both routes
call the same Python gesture handlers:

- **[owner/Max Patches/foot-trigger.js](../Max%20Patches/foot-trigger.js)** —
  reads the foot-switch input, applies a 500ms tap/hold timer, and
  sends `/looping/v3/foot/tap` or `/looping/v3/foot/hold` directly
  to the Python surface (UDP 11020). No bridge hop.
- **[owner/Max Patches/midi-remap.js](../Max%20Patches/midi-remap.js)** —
  remaps external MIDI controller inputs before they reach Live's
  MIDI routing. (This one genuinely needs Max: it re-injects MIDI
  into Live's track routing, which a control surface script can't.)

Everything else — device observation, track metadata, clip
properties, loop control, browser loading, track creation — is on
the Python side.

## 3. Port map

From [config/constants.json](../../config/constants.json). All ports
are 127.0.0.1 unless noted. **Every UDP port the bridge receives on binds
`127.0.0.1`** (2026-09-23, `INBOUND_BIND_ADDRESS` in `UDPPortManager.js`):
whatever the middleware does not consume reaches every WS client, and the
handler takes no `rinfo`, so the bind is the only source check there is —
on `0.0.0.0` one datagram from any LAN host went around the WebSocket auth
gate. Beyond loopback: 8081, 3000 and 8889 (for the iPad) and the
sub-second 7001 bootstrap below. The surface's own 11020 and 11022 bind
`pythonSurface.host`, 127.0.0.1.

| Send / Recv | Endpoint | Purpose |
|---|---|---|
| 11021 / 11020 | **Python Control Surface** | Primary backend. Bridge sends to 11020, surface replies to 11021. 11021 was the first port moved to `127.0.0.1` (2026-09-16): `session/save_as_request` is bridge-terminated straight into the AX helper, so a `0.0.0.0` bind let any LAN host drive Live and Accessibility with one datagram. |
| 7003 / 9003 | TotalMix FX (Global OSC) | **Only while `features.totalmix` is on** — true on the rig; off, the bridge binds none of the three TotalMix pairs, runs no bootstrap and reads no `osc.totalmix*` block (general-release audit §7b, `docs/reference/toggles.md`). **The bridge now talks to the mixer directly** (ADR-423), on OSC remote controller 3 in Global OSC mode; controller 1 keeps its legacy configuration so the cutover is reversible by one dropdown. Bridge → 7003 writes, mixer → 9003 changes plus an 811-address dump when TotalMix enables the controller. Every value is **dB**. Requires TotalMix FX 2.10+. ⚠️ There is no read verb, and an argument-less message is a *write of 1.0*, not a query. |
| 7002 / 7001 | TotalMix FX (legacy) | Borrowed for well under a second at bridge startup and then released, to seed the level cache — Global OSC cannot be asked for current state and its dump fires on TotalMix's schedule, not the bridge's. A busy port degrades to an empty cache rather than failing. The one bridge UDP socket on all interfaces: TotalMix's controller 1 sends to `looping-studio-2.local`, which resolves to the LAN address as well as loopback. |
| 11018 / 11019 | TotalMix M4L device | Bridge ↔ the Max for Live monitor device. The device sends `/totalmix/hello` on load and receives the cached levels back; its `live.gain~` faders and the wire both carry dB. |
| 11017 / 11016 | Looping Recorder | Bridge ↔ the `looping-recorder` M4L capture device. Opened, routed and scope-mapped by the bridge (`enhanced-osc-bridge.js:128`, `WebSocketServer.js:348`). |
| 11030 (output only) | **Permute mute gate** → Max | **Not a bridge port.** The surface sends `/looping/permute/gate <trackIndex> <open>` from its own socket straight to a `udpreceive` inside a Max device on that track — the outbound twin of the foot-trigger row below, and the only wire in this table the bridge never sees. It exists so a device can gate **what it plays** instead of the surface writing a parameter, which costs one Live undo step per step transition. Receivers fail **open** after ~2.5 s of silence. Sole receiver today: the `Skaka Metronome Picker` inside the Skaka Metronome Rack. |
| 11010 | Foot Trigger (input only) | Legacy/reserved. The Max foot chain fires straight at 11020; the USB-direct path (ADR-422) uses no OSC port at all — the pedal CCs arrive on the surface's MIDI input. |
| 8081 | WebSocket | Browser clients. |
| — (Unix socket) | Looping AX Helper | `axHelper.socketPath` (`~/Library/Application Support/Looping/ax-helper.sock`), owner-only. The bridge dials it; one JSON line each way (ADR-439). Deliberately not a TCP port: whoever can connect can press anything in Live. |
| 3000 | HTTP (dev) | SvelteKit dev server. |

**Why port 8081 and not 8080:** system-level interference on 8080
causes WebSocket RSV1 protocol errors on some macOS builds.

## 4. Message flow: slider round-trip

A typical user gesture — drag a device parameter slider — touches
every layer:

```
 UI gesture
    │
    │   /looping/v3/param/set [path="tracks/0/devices/1/params/2",
    │                          value=0.3, generation=7]
    ▼
 WebSocket (port 8081)
    │
    ▼
 Bridge: routing/messageRouter.js
    │   - backendScope matches /looping/v3/* → 'pythonSurface'
    │
    ▼
 UDP to port 11020
    │
    ▼
 Python surface: LoopingSurface._tick
    │   - drains socket, dispatches by address
    │
    ▼
 DevicesComponent.handle_set_param_v3
    │   1. parse path via path_resolver → (track, device, param)
    │   2. generation check: ui=7 vs surf=7 → accept
    │   3. arm suppression (per-param, one-shot)
    │   4. parameter.value = 0.3
    │
    ▼
 LOM fires the param's value listener (armed by LOMListeners)
    │   - suppression consumes the echo; no wire emit
    │
    ─ write round-trip ends here; no reply on the happy path ─

 Outside edit of the same parameter (user turns a knob in Live):
    │
    ▼
 LOM value listener fires
    │   - suppression not armed → emit
    │
    ▼
 MutationComponent.on_param_value_changed
    │
    ▼
 /looping/v3/param/value [path, value]  ── via UDP 11021 ──
                                              │
                                              ▼
                                          Bridge → WebSocket
                                              │
                                              ▼
                                          UI handler → normalized store
                                              │
                                              ▼
                                          Svelte $derived updates slider
```

Key properties:
- **Identity is the path.** No pointer id is ever on the wire.
- **Writes are optimistic, echo-suppressed.** The UI shows the
  new value immediately; the surface swallows its own listener
  echo.
- **Outside edits flow naturally.** LOM listeners fire the same
  way; `MutationComponent` routes them onto `/looping/v3/param/value`.
- **Generation guards structural drift.** If the UI's generation
  lags the surface (preset reload bumped the device's param
  count), the write rejects with `generation-stale`; the UI waits
  for the in-flight `state/invalidate` or `state/full` to catch
  up, then retries if the gesture is still live. See
  [wire-protocol.md §4](wire-protocol.md#4-generation-numbering).

## 5. The Python surface internals

### 5.1 Component layout

One `Component` per slice of the LOM surface. Representative set:

| Component | Owns |
|---|---|
| `HandshakeComponent` | `/looping/v3/handshake/hello` + `accept`. Versions: `3.8.0` down to `3.0.0`. |
| `SurfaceHelloComponent` | One-shot `/looping/v3/surface/hello` on `__init__` — UI detects surface restart (File → Open recycles the surface). |
| `GenerationComponent` | Monotonic `int32` advanced on every structural change. |
| `InvalidationComponent` | Emits `/looping/v3/state/invalidate` on generation advance. |
| `V3StateFullComponent` | Whole-tree emission — one `state/full/tree` message over the TCP leg (protocol 3.6.0; there is no UDP fallback). Scoped bundles for selection-change, and since 3.8.0 for one drum pad's chain (`reason="pad-chain"`, scope the pad path — the answer to a `vm.padChain.<note>` cold read, D/P records only). |
| `LOMListeners` | Attach/detach per-track `devices` listeners + per-param `value` listeners. Sole owner of listener lifecycle. |
| `MutationComponent` | Routes listener fires onto `/looping/v3/param/value`; arms/unarms echo suppression. |
| `DevicesComponent` | `param/set`, `param/query`, `state/resync`. |
| `PropertyComponent` | `/looping/v3/property/*` — subscribe/set/unsubscribe for allowlisted per-device properties (Simpler `sample.*`, Drift `voice_mode_index`, Hybrid Reverb IR fields, Compressor sidechain routing). |
| `DrumVirtualMacroComponent` | The Drum Rack's whole-kit gesture (ADR-428): the provider behind the computed `vm.*` property rows — fifteen musical functions (`fx1`, `fx2`, `fxType`, `attack`, `decay`, `start`, `pitch`; the Sampler row's `release`, `sustain`, `oscAmount`, `oscCoarse`, `pitchEnvAmount`, `pitchEnvAttack`, `spread`; `gain`; and the filter pair `filterFreq` / `filterRes`) plus the open-ended `vm.macro.<name>` family on a kit of nested Instrument Racks, bound per pad-instrument class by parameter **name** and fanned out `min + t·(max−min)` through each member's LOM range (`gain` is the one whose member need not be a device parameter: on a nested-rack pad it is the pad's own chain volume) (a still-mapped pipeline kit writes its legacy macro instead), one fan-out per drain pass, one undo step per gesture; the `vm.members` census; per-pad pitch offsets seeded from the kit and reconciled on every read-back (kit-move rule, 400 ms stale-read window — ADR-429); the sequencer's octave shift term (`set_sequencer_shift`). State follows the rack across a path move (`rebind`). |
| `DebugComponent` | `/looping/protocol/version` for the handshake, plus the debug-only `/looping/probe/*` LOM probes (`lom_introspect`, `lom_invoke`, `lom_set`, `song_time_probe`) — see `surface/CLAUDE.md` §"LOM probes". Not part of the UI contract. |
| `DeviceLoadComponent` | `/looping/v3/device/load` — a native single-device `.adv` whose Live user default is byte-identical to it is **inserted by name** (`Track.insert_device` / `Chain.insert_device`, renamed to the preset's basename, one undo step; `npm run install-device-defaults` keeps the defaults equal to the presets); everything else resolves `.amxd`/`.adv`/`.adg`/`.als`/`.alc` filesystem paths to `BrowserItem`s via `BrowserCache` (O(1) lookup, lazy per-root build) and loads through the browser. A pad path as `devicePath` (3.8.0, `…/devices/N/pads/<note>`) targets that pad's chain; a browser load that lands on the track is moved into the chain on a later tick. Empty `trackPath` rejected (no fallback). |
| `BrowserCache` | Per-root `path → BrowserItem` map. Lazy-builds the User Library and each Place tree on first lookup; subsequent loads are dict reads. |
| `TrackPrepareComponent` | `/looping/v3/track/prepare_for_preset` — atomic create-or-reuse + (audio) routing/arm + preset load in one Live tick. Server-authoritative reuse decision; LRU on `request_id` for retransmit idempotency. |
| `DeviceCommandsComponent` | `/looping/v3/device/{select,move_to_top,move_to_end}`. |
| `DeviceInitComponent` | Simpler-type init rules + AU-plugin post-insertion parameter-population retry (400/800/1600ms). |
| `TrackMetadataComponent` | name/color/mute/solo/arm/pan/volume/input-routing + mute-toggle + send on every regular track. |
| `MasterComponent` | Master track: volume/name/color/pan/mute. |
| `MetersComponent` | 60 FPS meter stream on `/looping/v3/{track,master}/meter`. |
| `SessionComponent` | tempo/transport/metronome/loop/signature/scale/play-stop-continue commands. |
| `ClipsComponent` | launch/stop/delete/duplicate/duplicate_region + per-slot `has_clip` listeners. Also `clip/sample/get` (ADR-415) — the per-slot sample-path pull the session clip grid uses to draw waveforms in slots that aren't playing, since `playing_slot` only ever covers one slot per track. |
| `ScenesComponent` | scene launch/stop + `scenes` listener. |
| `ClipPropertiesComponent` | loop_start/loop_end/start_marker/end_marker/warp_mode/looping/pitch_coarse on the focused clip. |
| `ClipNotesComponent` | MIDI clip note transpose. |
| `SequencerComponent` | The Permute engine (ADR-429, permute ADR-020): runs the two step sequencers of every thin `Permute` device off the drain pump's Timer (92.8 Hz, lookahead one tick), reads the pattern by parameter name from the existing value listeners, applies pitch (drum shift term / notes / `pitch_coarse` by class), mute, chance and the temperature base model to the playing clip, restores on stop / toggle OFF / removal / disconnect, and emits `/looping/v3/permute/step` itself. Gated by the persisted `sequencer_engine` toggle (default off). `/looping/probe/sequencer_stats` reports lag and counters. |
| `GrooveComponent` + `GroovePoolComponent` | Per-clip groove amounts + pool auto-assign. |
| `SelectedTrackComponent` | Observe `song.view.selected_track`, write `view.selected_track` and `view.highlighted_clip_slot`, Move-encoder relative volume, and the Move pad hold (ADR-432): `/looping/v3/move/pad_hold [note, held]` from the Max Utility patch → the pad Live selected on the selected track's Drum Rack → `/looping/v3/drum/pad_hold [rackPath, padNote, held]` to the interface, which scopes that pad as if a finger held its tile. |
| `ExclusiveArmComponent` | Arm-follows-selection side effect. |
| `FootTriggerComponent` | `/looping/v3/foot/{tap,hold}` — tap toggles session record; hold creates + arms + auto-loads Permute on an audio track. |
| `ViewComponent` | `/looping/v3/view/focus`. |

Full list: see [LoopingSurface.py](../../surface/LoopingSurface.py).

### 5.2 Lifecycle

```
Live loads the Remote Script
    │
    ▼
LoopingSurface.__init__
    │   1. super().__init__ with a minimal Specification
    │      (empty ElementsBase — we're headless OSC-only)
    │   2. Load constants.json; bind UDP on pythonSurface.remotePort
    │   3. Construct components in dependency order:
    │      transport → Session → SessionSettings → ServerPresence →
    │      PerformanceCapture → Devices → Generation →
    │      Invalidation → Handshake → SurfaceHello → View →
    │      DeviceCommands → Debug → V3StateFull → DeviceInit →
    │      Mutation → DrumVirtualMacro → Property → TrackMetadata →
    │      Master → Meters → Playhead → Sequencer → ClipProperties →
    │      SelectedTrack → ExclusiveArm → GroovePool → Groove →
    │      Clips → ClipNotes → FootTrigger → WahPedal → TrackCreate →
    │      SimplerLoad → Scenes → DeviceLoad → TrackPrepare
    │      (order read off `LoopingSurface.__init__`, 2026-09-07 —
    │      the provider must precede Property, the engine the pump)
    │   4. Attach LOM listeners; rebind composite on structural change
    │   5. Schedule _tick on every Live tick
    │
    ▼
_tick (every Live tick, ~100 Hz)
    │   - drain inbound UDP socket
    │   - dispatch each message by address
    │   - emit 1 Hz bridge heartbeat on /looping/v3/bridge/heartbeat
    │
    ▼
disconnect (called by Live on quit / slot switch / File → Open)
    │   - tear down components (detaches listeners)
    │   - close UDP transport (critical — avoids bytecode-cache
    │     "Address already in use" on slot re-select)
```

### 5.3 Handshake and state delivery

Cold start:

```
UI connects WebSocket
    ▼
UI: /looping/v3/handshake/hello [versions=["3.8.0", ...]]
    ▼
Surface picks highest common version
    ▼
Surface: /looping/v3/handshake/accept [version, sessionId, generation]
    ▼
Surface emits state/full/tree reason="accept"
    ▼
SessionComponent emits its song-scoped seeds (metronome, loop, scale, …)
    ▼
ClipPropertiesComponent + SelectedTrackComponent + GrooveComponent
emit their focused-clip seeds
    ▼
UI builds normalized tree; renders
```

Reconnect is just another handshake — the second `accept` produces
a second `state/full`. The UI does **not** issue `/state/resync`
on reconnect; accept already brought the tree.

**The hello is retried (ADR-418).** It crosses an unacknowledged UDP
hop to reach the surface, and the surface drains that socket only on a
Live tick — so a tick stall plus a full buffer loses it. A lost hello
means no accept, so no `state/full`, so no tracks / meters / playheads,
while writes keep working (fire-and-forget). The UI therefore resends
`hello` every 2s until accepted, bounded at 8 tries. Both sides must
tolerate the repeat: a client may see several accepts, and the surface
several hellos from one client.

**Accepts are broadcast.** The bridge routes by address, and the
surface's reply carries no client identity, so every accept reaches
every client — and clients negotiate independently (web UI `3.4.0`,
menubar `3.3.0`). A client ignores accepts naming a version it never
advertised; a real mismatch arrives on `/looping/v3/error`, never as an
accept. See [wire-protocol.md §5.3a–5.3b](wire-protocol.md#53a-hello-delivery-is-unreliable--the-ui-retries-adr-418).

### 5.4 Structural changes

Inserting/deleting/reordering a track or device:

1. Live's LOM fires the relevant structural listener
   (`song.tracks`, `track.devices`, etc.).
2. `LOMListeners` fans this to the structural composite callback
   registered by `LoopingSurface.__init__`.
3. Composite advances `GenerationComponent`, which drives
   `InvalidationComponent` to emit `state/invalidate`.
4. Composite emits `V3StateFullComponent.on_structural_change` —
   a fresh `state/full/tree` with the new tree.
5. `PropertyComponent.on_structural_invalidate` tears down
   subscriptions whose `devicePath` went away.
6. `TrackMetadataComponent.on_structural_change` +
   `MetersComponent.on_structural_change` +
   `ClipsComponent.rebind` re-attach per-track listeners against
   the new track set.

The ordering matters: generation advance → `invalidate` →
`state/full` → per-component rebind. The UI sees `invalidate`
before any echo from the post-structural tree.

### 5.5 Selection-change: scoped state/full

When `song.view.selected_track` changes:

1. `SelectedTrackComponent` coalesces (50ms window) to avoid
   fanning out on rapid multi-step selections.
2. On commit, it calls `V3StateFullComponent.emit_selection_change(trackPath)`.
3. The emitter walks only that track's subtree and sends
   `state/full/tree reason="selection-change" scope="tracks/<N>"`.
4. The UI applies via `mergeSubtreeAtPath` — subtree merge, not
   whole-tree wipe, so sibling tracks are preserved.

`DeviceInitComponent` uses the same emit path when its Simpler
init rules or AU-plugin retry successfully change device state.

**Selection is an object on Live's side and a position on the wire.**
`song.view.selected_track` fires only when the selected *object*
changes, so removing a track *below* the selection re-indexes it
silently — the same track is still selected, it has only slid down a
slot, and the UI's `tracks/<N>` mirror is left one too high. Since
2026-08-31 `SelectedTrackComponent.on_structural_change` runs from the
structural-change composite, recomputes the path and re-emits
`/looping/v3/selected_track` when it moved. This covers every reshape
of `song.tracks` — a delete made in Live
itself, an insert above the selection — not just UI-initiated ones.

## 6. Liveness and self-healing

Two independent heartbeats with complementary signals:

- **Bridge → browser** — `/bridge/ping [seq, ts]` every 5s. Silent
  on healthy; browsers swallow it and stamp `lastInboundTs`. The
  client watchdog force-closes the socket if no inbound frame
  arrives within 12s, triggering reconnect.
- **Surface → UI** — `/looping/v3/bridge/heartbeat [seq, monoMs]`
  at 1 Hz, emitted from `LoopingSurface._tick`. The bridge's
  `healthMonitor` watches for gaps >3s (`tick-stall:<source>`).
  Distinct from meter-stall: meters can wedge without the tick
  wedging (listener-dispatch starvation), or both can wedge
  together (tick starvation).

Client recovery:
- **`bridge-resync`** is a browser-side CustomEvent fired on every
  WebSocket reopen and on tab-visibility resume. Reconnect path
  relies on handshake-accept to re-seed state/full; visibility
  path calls `sendStateResync()` explicitly.
- **Handshake retry** — the one recovery the above cannot provide,
  because it is what *starts* a session. See §5.3 and ADR-418.

Two freezes look identical from the driver's seat — display dead,
faders still reaching Live — and are told apart from `bridge.log`
alone (ADR-418):

| Log signal | Cause |
|---|---|
| no `handshake: accepted`, repeated `no accept — resending hello` | the hello is being lost on the UDP hop |
| `reactivity-stall` (+ a preceding `uncaught-error`) | an error escaped a Svelte effect and wedged the effect scheduler |
| `boundary-error` | a `<svelte:boundary>` contained a render error — that subtree degraded, the app kept running (ADR-419) |

The second is a Svelte 5 property worth knowing: an error thrown
inside any effect escapes `Batch.process()`, and the scheduler's
cleanup restores `is_flushing` but not `queued_root_effects`,
`current_batch`, or the root effect's `CLEAN` bit. Every later
`schedule_effect()` then bails as "already scheduled" against a queue
nothing will drain, so reactivity dies app-wide until reload while DOM
event handlers keep firing. `clientWatchdog` reports these signals. ADR-419 is the first
confirmed instance: a duplicate `{#each}` key in one drum clip's
MIDI preview froze the whole instrument. Clip previews now render
inside a `<svelte:boundary>`, so a render error costs one strip's
graphic rather than app-wide reactivity.
- **Dead-client reaper** — if a client's WebSocket `bufferedAmount`
  stays above 1MB for two consecutive 10s ticks, the bridge calls
  `client.terminate()` to force a TCP RST. Without this, a
  suspended iPad's socket can sit forever.

## 7. Surface restart detection

`File → Open` in Live tears down and reconstructs the entire
Python Control Surface (observed on Live 12.3.7). The bridge's
WebSocket to the UI stays alive across this; without a signal the
UI would continue addressing the prior session.

`SurfaceHelloComponent` emits `/looping/v3/surface/hello
[surfaceInstanceId, protocolVersion, timestamp]` exactly once at
every `ControlSurface.__init__`. The UI compares the instanceId to
its last-seen value:

- **First connect** — record it, no side effect.
- **Same instanceId** — no-op.
- **Different instanceId** — clear generation + session state,
  re-handshake. The new `accept` brings a fresh state/full.

See [wire-protocol.md §8.6](wire-protocol.md#86-surface-instance-advertisement-surfacehello).

## 8. What lives where

| Concern | Lives in |
|---|---|
| User gestures, rendering, normalized UI state | `interface/src/` (SvelteKit, Svelte 5 runes) |
| WebSocket↔UDP routing, liveness | `interface/bridge/` (Node.js) |
| Every LOM read, listener, write | `surface/` (Python Remote Script) |
| Hardware foot-switch + MIDI remap | `owner/Max Patches/` (Max v8 JavaScript) |
| Single source of truth for ports, paths, timing | `config/constants.json`, read at run time by server modules (`$lib/server/runtimeConfig.ts`) |
| Which Places are cataloged | `logs/places.json`, written by the Places service from Settings |
| Device parameter/property config | `data/device-configs.json` |

## 9. Next

- [wire-protocol.md](wire-protocol.md) — the contract on the UDP
  and WebSocket wire.
- [ui-architecture.md](ui-architecture.md) — how the SvelteKit
  side is organized.
- [lom-reference.md](lom-reference.md) — Live Object Model
  reference the Python surface is written against.
- [setup.md](setup.md) — install, iPad network, common problems.
