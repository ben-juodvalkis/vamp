# Bridge - WebSocket↔OSC Gateway

Node.js server that routes messages between browser clients (WebSocket) and Ableton Live ecosystem (UDP/OSC).

> **Cleanup complete (2026-04-21).** Routing is driven by
> `backendScope` in `config/constants.json`. All `/looping/v3/*`
> traffic routes to the Python Control Surface (ports 11020/11021).
> AbletonOSC and Max4Live backends have been removed (ROW 11 of
> Looping's `documentation/archive/m4l-to-python-v3/10-cleanup-plan.md`).
> **2026-09-23 (general-release audit Tier 0):** the last legacy
> endpoints went too — the Max Observer (11002/11003, whose device
> `liveAPI-v6.js` had been a stub since ROW 6), the Omnisphere and NI
> preset servers (7400/7401, 7500/7501; the servers themselves were
> deleted 2025-11-23) and the shell helper (11006/11007, receiver deleted
> 2025-10-12). None had a UI sender. An address that matches no rule now
> routes to `'none'` and is logged and dropped.

## Architecture

```
Browser (WS:8081) ↔ enhanced-osc-bridge.js ↔ UDP Ports ↔ Python Surface / TotalMix / looping-recorder / MIDI converter
```

## Key Files

- `enhanced-osc-bridge.js` - Central orchestrator. Creates all UDP ports, WebSocket server, and message routing. Owns the ping heartbeat and dead-client reaper timers. Primary backend is the Python Control Surface.
- `transport/UDPPortManager.js` - Creates and manages UDP port pairs. `createUDPPorts` builds only the endpoints its config carries (the orchestrator leaves a switched-off feature's out); setup, open and close walk the ports it built rather than naming them, so a gated endpoint needs no guard in each
- `utils/features.js` - **Feature switches** (general-release audit §7b). Reads `constants.features` once at startup — only an explicit `true` is on; a missing switch, `false` or a non-boolean is off, and an unknown key or a non-boolean is logged. Tracks each enabled feature's `available` + `reason` (set by whoever can see the subsystem) and emits `change` only when one moves. Published as `/bridge/features [json]` — see Liveness below. `docs/reference/toggles.md` has the table of switches and what each does off
- `transport/WebSocketServer.js` - WebSocket server and client lifecycle. Intercepts `/bridge/client_log` messages and mirrors them into `logs/bridge.log`.
- `routing/messageRouter.js` - Routes OSC messages between endpoints based on address patterns
- *(`routing/RouterRegistry.js` was deleted in audit item 33's sibling, item 32. It held a per-client pattern-subscription table whose dispatcher, `route()`, had **zero callers** — so it compiled a regex per subscription, held a socket per client, and filtered nothing. Every client already receives every frame via the broadcast path. The only thing in the repo that ever sent `type: 'subscribe'` was the perf harness.)*
- `utils/logger.js` - Node.js logging (use this, not console.log)
- `utils/healthMonitor.js` - Silent-when-healthy monitor. Tracks per-client `bufferedAmount`, per-source meter-rate stalls, broadcast throw rate. Logs WARN/ERROR on anomaly onset + recovery only.
- `transport/SurfaceTcpClient.js` - **The bridge's end of the bridge↔surface TCP leg (2026-08-31).** Dials the surface's listener on `osc.pythonSurface.tcpPort` (11022) and redials with backoff after a Live restart — the reconnect logic is the whole reason the file is more than thirty lines, because UDP was connectionless and a Live restart was therefore invisible. Length-prefixed frames (`[4-byte BE length][OSC bytes]`); inbound frames go through the **same** `handleIncomingOSC` with the **same** `pythonSurface` source and the same middleware, so nothing downstream — capture taps, profiler, health monitor, UI — can tell which leg a message arrived on. `ECONNREFUSED` while Live is closed is the expected steady state and is logged at debug, not warn. If it never connects, the surface keeps emitting chunked UDP: degrading is safe by construction. **Do not add 11022 to `scripts/cleanup.sh`'s `PORTS`** — that sweep is `kill -9`, and the process holding 11022 is Ableton Live.
- `utils/broadcastBatcher.js` - Coalesces Surf→UI WS frames inside a short window (`BRIDGE_BATCH_WINDOW_MS`, default 10 ms). Multi-item windows ship as one `/bridge/batch` envelope; single-item windows pass through raw. Set `BRIDGE_BATCH_WINDOW_MS=0` to disable. Client-side disassembly lives in `WebSocketConnection.ts`.
- **UI→Surf batching (2026-08-31)** — the same `/bridge/batch` envelope now also arrives in the *other* direction, tagged `source: "ui"`. The UI coalesces every `send()` in one event-loop turn (`api/connection/outboundBatcher.ts`) and flushes on a microtask, which unlike the 10 ms broadcast window adds no latency to click input. `WebSocketServer.handleBatch` unpacks it and hands each inner message to `dispatchClientMessage` — the *same* function an unbatched frame goes through, so batched and unbatched writes cannot drift apart. Two rules the unpack loop must keep: **per-item try/catch** (a shared one lets the first failure discard the rest of the frame — the bug ableton-js #142 shipped and had to go back and fix), and **no nested envelopes** (unbounded recursion on our stack, driven by a client). Both are pinned by `outboundBatchUnpack.test.ts`, which routes through real `routeMessageToUDP` onto a recording UDP port.
- `utils/oscMessageUtils.js` - OSC message parsing and formatting

## Port Map (from config/constants.json)

| Port Pair (Send/Recv) | Endpoint |
|------------------------|----------|
| 11020/11021 | Python Control Surface (primary) |
| 7003/9003 | TotalMix mixer — Global OSC, remote controller 3 (ADR-423). Only while `features.totalmix` is on |
| 7002/7001 | TotalMix legacy — borrowed for ~1s at startup only (ADR-423). Only while `features.totalmix` is on |
| 11018/11019 | TotalMix Max for Live device (ADR-423). Only while `features.totalmix` is on |
| 11017/11016 | Looping Recorder M4L capture device |
| 11010 | Foot Trigger (input only) |
| 8081 | WebSocket (browser clients) |

## Important Notes

- All port numbers come from `config/constants.json` - never hardcode them
- **Every inbound UDP socket binds `127.0.0.1`** (`INBOUND_BIND_ADDRESS` in
  `transport/UDPPortManager.js`; 11021 since 2026-09-16, the rest since
  2026-09-23). The `message` handler drops osc.js's `rinfo`, so the bind is
  the only source check there is, and whatever the middleware does not
  consume reaches every WS client — on 0.0.0.0 one LAN datagram went around
  the HMAC gate. Every peer was measured to send to 127.0.0.1 from this Mac
  (Max `udpsend`s, TotalMix controller 3, the surface).
  `udpPortCoverage.test.ts` opens the real sockets and proves a datagram to the
  LAN address is dropped. The exception is `totalmixBootstrap.js`'s sub-second
  7001 socket, on all interfaces because TotalMix's controller 1 sends to
  `looping-studio-2.local`
- The bridge uses Bonjour/mDNS for iPad discovery on the local network
- Routing is driven by `osc.backendScope.pythonSurface` in `constants.json`:
  listed addresses (exact or `prefix/*` glob) go to the Python surface;
  `osc.backendScope.loopingRecorder` to the capture device. Anything else
  (a WS client's `/totalmix/*` included) routes to `'none'` and is logged and dropped by `routeMessageToUDP`.
- Uses CommonJS (`require`), not ES modules — `interface/bridge/package.json`
  carries no `"type"`, so it wins over `interface/`'s `"type": "module"`
- **ESLint's `no-undef` gates this directory and only this directory**
  (`eslint.config.mjs`, one rule; `npm run lint` by hand). Vitest runs it on
  every push (`bridgeLintGate.test.ts`, which also checks the config reaches
  every bridge file). This code has no type-checker (`checkJs: false`) and
  half of it no test, so an undeclared identifier in a handler would
  otherwise ship green

## Persistent Log File

`WARN` and `ERROR` messages are mirrored to **`logs/bridge.log`** at the repo root (gitignored). `DEBUG`/`INFO` stay console-only.

The bridge emits `Bridge process starting` on boot and `Bridge process exiting` on shutdown, so restarts triggered by `concurrently --restart-tries -1` (iPad mode) are visible as adjacent markers. `tail -f logs/bridge.log` to watch for death/restart cycles across sessions.

## Liveness and Self-Healing

The bridge + browser cooperate to detect and recover from the common "iPad Safari suspended the tab but the WebSocket still looks connected" failure mode:

- **Ping heartbeat** — bridge broadcasts `/bridge/ping [seq, ts]` every 5s. Silent on healthy, since clients swallow it in their WS onmessage handler.
- **Surface heartbeat** — Python's `_tick` (LoopingSurface) emits `/looping/v3/bridge/heartbeat [seq, monoMs]` at 1 Hz. The healthMonitor watches for >3s gaps (`tick-stall:<source>`) — distinct signal from `meter-stall`, since meters can wedge while the tick still runs (listener-dispatch starvation) or both can wedge together (tick starvation). Clients swallow it and dispatch a `surface-heartbeat` window event for the browser-side stall detector.
- **Server-presence heartbeat** — the bridge emits `/looping/v3/server/heartbeat [seq, epochMs, mode]` straight to the Python surface every `timing.serverPresence.heartbeatIntervalMs` (default 2s) while its process is alive — the direct encoding of "`npm run dev`/`ipad` is running". Sent unconditionally on the bridge's own clock (does **not** require a connected WS client). The 3rd arg `mode` (`"ipad"`/`"dev"`) comes from `LOOPING_SERVER_MODE`, set by the `dev:bridge` / `dev:bridge:ipad` npm scripts; it lets the surface tell the two launch modes apart. The surface's `ServerPresenceComponent` gates performance-only behaviors (arm-follows-selection) on this; a gap > `graceWindowMs` (default 6s) reads as "server gone", so a clean quit and a `kill -9` are handled identically. Bridge-originated, so it bypasses the WS→backend router and needs no `backendScope.pythonSurface` entry.
- **Feature switches (`/bridge/features`)** — `utils/features.js`'s snapshot, one JSON argument `{ <id>: { enabled, available, reason } }`, sent the same three ways as `/bridge/ax_helper`: once per client on connect (`WebSocketServer.handleConnection`, ahead of auth — which subsystems exist is layout, not the set), on every change (`features.on('change')` in `enhanced-osc-bridge.js`), and with the 5 s ping. The UI draws nothing for a feature until a snapshot names it, so this has to ride the first frames. No protocol bump: `/bridge/*` is outside v3 version negotiation.
- **Launch-mode beacon (`/bridge/server_mode`)** — the UDP server-presence heartbeat carries `mode` (`"dev"`/`"ipad"`) to the Python surface only; WS clients never see it. So the bridge separately broadcasts `/bridge/server_mode [mode]` to WS clients: once per client on connect (`WebSocketServer.handleConnection`, seeded from `LOOPING_SERVER_MODE` threaded through the WS-server config) and again on the 5s ping cadence for self-healing. Consumed by the `owner/menubar` utility to show dev vs ipad; the web UI ignores it. Mode is fixed for the process lifetime, so the on-connect send is authoritative and the periodic beat is belt-and-suspenders.
- **iPad-only save-as automation** — `handlers/liveSaveAs.js`. On `/looping/v3/session/save_as_request [tempo, sigNum, sigDen]` from the surface (fired on transport stop during `npm run ipad`), the bridge asks the AX helper for Live's native Save As dialog (`save_as_dialog`, ADR-439) with `NNN_YYYY-MM-DD_<tempo>bpm_<num>-<den>` already in its name field (counter persisted to `logs/save-as-counter.json`), leaving it open for the user to Enter/Escape. The helper presses Live's menu item and writes the name through Accessibility — no keystrokes, which on the rig never reached the panel's field. Bridge-terminated (not relayed to UI); re-checks `LOOPING_SERVER_MODE === 'ipad'` defensively. A helper that is down or untrusted is a named error in the log and costs no counter value; the tests pass a counter-file override so they never bump the rig's real counter (they used to).
- **Looping AX Helper client (ADR-439)** — `transport/AxHelperClient.js`. **Only while `features.axHelper` is on** (the owner's, general-release plan.md §4): off, the orchestrator builds no client at all and sends no `/bridge/ax_helper`, no Group or similar-swap handler (their addresses and Reverse answer `ax-helper-down`), and skips the iPad Save As; on, the feature is available while the helper's state is `ready`. The bridge never touches macOS Accessibility itself: trust belongs to the *launcher's* responsible process, so the osascript copies (`liveAxClick.js`, deleted, and the old Save As keystrokes) worked or silently no-op'd depending on which terminal started `npm run dev` — Claude's shells are untrusted, Terminal.app is. The helper (`owner/ax-helper`, a signed app bundle run by a LaunchAgent, `npm run install-ax-helper`) holds the one grant; this client dials its owner-only Unix socket (`axHelper.socketPath`), one JSON line each way, matches replies by id, redials with backoff, and polls `status` every `statusIntervalMs`. Its state — `ready` / `ax-untrusted` / `ax-helper-down` — goes to WS clients as `/bridge/ax_helper [state, detail]` on connect, on change and with the 5 s ping; a restart shorter than 1.5 s (the helper re-executes itself when a grant lands) never reads as down. Every request settles with a named `code`; `/cmd/clip/reverse` acks `[0, code, detail]`. **A config with no `axHelper.socketPath` gets a disabled stub, not a throw** — `createAxHelperClient` runs at `enhanced-osc-bridge.js`'s module top level, so a throw there killed the bridge before it opened a single port, and the example config of the time carried no `axHelper` block at all until 2026-09-16: the documented fresh install cost the whole rig rather than the three features the key belongs to. The stub is the client's shape with `state` permanently `ax-helper-down` and every `request` rejecting with that code, so no caller can tell it from a helper that is not running. Tests: `axHelperClient.test.ts` against a real socket.
- **Group Tracks gesture (ADR-439 research, 2026-09-19/20)** — `handlers/liveGroupTracks.js`. Live's LOM cannot group **or move** a track at all (no create-group call, no track-move call, `group_track`/`is_foldable`/`is_grouped` read-only), so this drives Live's real Accessibility surface directly, through the same AX helper client, techniques measured before trusting them. **Two shapes, depending on what the tapped tracks touch:** a brand-new group (nothing touches an existing one) builds the selection with a real click (`system_click`) per member, retried against a read-back of the header outline's `AXSelectedRows` count, then a real ⌘G (`system_key`) commits with no menu. Adding to an **existing** group is not a Group-Tracks command at all — it **drags** each new member's row onto the group's own rows (`system_drag`, ADR-439 phase 4, 2026-09-20: a held-button move through the same global HID event stream `system_click` uses, confirmed on the rig to add a flat member while the group keeps its own identity — same AX row, same name — completely untouched). This replaced an ungroup-then-⌘G-regroup dance: Live's own "Group Tracks" always **nests** rather than merging a touched group, so the first version ungrouped it first (the one exception to "no menu" — `show_menu` + `pick` "Ungroup Tracks", since ⇧⌘G through `system_key` was measured to fail 5 consecutive real attempts where the menu item then worked immediately) and rebuilt a fresh flat group via ⌘G — which worked, but a dissolved-and-recreated Group Track is a *different* LOM object, so anything on the *original* group's own device chain (a bus compressor, sends) did not survive the round trip. A drag never touches the group at all, so whatever is on its chain simply isn't in the blast radius. **One address, `/looping/v3/track/group [requestId, membersJson]`** (2026-09-20 rewrite) — the UI's hold-and-tap gesture (`groupGestureStore`) is entirely local while tracks are being tapped, no wire calls at all, and this fires exactly once with the whole finished member list when the gesture ends. The prior four-address version (`start`/`tap`/`commit`/`cancel`) clicked every tapped track into Live's real selection live, one Cmd-click per tap while the button was held, racing whatever the *next* tap or a concurrent commit/cancel did to the same server-side gesture record — reproduced on the rig as a crash (a `tap` reading the record as null mid-flight after a same-client `cancel` landed during its own `dumpRows()` await), which from the UI is what made tapping during group mode look like it was hijacking Ableton's real selection. Either shape ends by re-selecting a track explicitly, best-effort — but a different one each way: adding to an existing group lands back on the **anchor** (the track already selected when the gesture began, re-resolved fresh by name in case it was itself the one just dragged in), so folding a track into a bus doesn't yank the view over to the group; a brand-new group lands on the **group** itself (found by matching which tracks now nest under it), since there is no anchor to return to when the whole selection just became one new track. `system_drag` itself lives in the AX helper (`owner/ax-helper/looping_ax_helper/ax.py`'s `system_mouse_down`/`system_mouse_dragged`/`system_mouse_up`, `verbs.py`'s `_system_drag`): move to the source row's center, hold the button, interpolate over the same glide `hover` uses (not a teleport — an app deciding "is this a drag" from genuine incremental movement would not necessarily recognize a jump), release over the destination row, restore the cursor. Tests: `liveGroupTracks.test.ts` against a fake AX backend that actually simulates Live's click/drag/selection semantics (a `system_drag` really relocates a row into the target group's children, a `system_key` really builds a fresh flat group from the current selection).
  **Fullscreen false-positive (measured 2026-09-21):** every drag failed with `ax-action-failed: "Live has a panel or menu up; refusing to click blind"` whenever Live was in native macOS fullscreen (its own Space) — but never in a normal window. `_panel_is_up` (`verbs.py`) treats any `AXWindows` entry that isn't `AXMainWindow` as a stray panel; native fullscreen leaves a second, inert entry behind for as long as Live occupies its own Space — the pre-fullscreen frame, kept alive off-screen, reporting `AXSubrole "AXUnknown"` with no title — and that ghost was tripping the guard on every single check, panel or not. Fixed by excluding exactly that signature (`AXUnknown` + empty title) from the check; a real second window (an actual dialog/alert) still counts. Confirmed live via the helper's own `dump`/`panel_state` verbs against the fullscreened app before diagnosing further.
  **Record-mode bracket (2026-09-21).** A second, unrelated way a reposition can silently fail: Live's own "cannot move a track that is currently recording" modal, which fires whenever `song.record_mode` is on and the tracks about to move aren't already sitting together — which under `npm run ipad`'s auto-capture (§2.14) is the whole time the transport plays. `isContiguous`/`topLevelOrder` in `liveGroupTracks.js` decide, from a fresh `dumpRows()`, whether the ⌘G or the drag is actually about to reposition anything; only when it is does the bridge ask the surface's new `RecordSuspendComponent` (`/looping/v3/track/group/record_suspend` → `.../record_resume`, both request/reply) to turn `record_mode` off for the move and back on after — invisible to `PerformanceCaptureComponent`, which watches `is_playing`, never `record_mode` itself. An already-contiguous selection never engages the bracket at all, so grouping tracks that already sit together costs no recording gap; a scattered one costs a gap the length of one gesture. A surface that never answers the suspend (timeout or unreachable) degrades to "assume it was off" and the gesture still runs — this bracket is a nicety, never a blocker. The "only when not contiguous" rule was Ben's call, 2026-09-21, and only the ⌘G half of it has been reasoned through carefully; neither half has yet been measured against a real in-progress recording (that needs an actual take running to observe).
- **Similar-sound swap (ADR-439 phase 3)** — `handlers/drumSwapSimilar.js`. A WS client's `/looping/v3/drum/swap_similar [requestId, rackPath, scope, direction]` (`WebSocketServer`'s address-handler table; never routed to the surface) runs four hops, each answered before the next goes out: `/looping/v3/drum/show_for_swap` to the surface — select the rack and, for a pad, the pad, acked with the rack's `TrackView.Device[N]` — then the AX helper: for a kit, a `read` of the rack's ShowSwapBar (pressed when off) and a `press` of Live's own Swap All; for a pad, a `read` of `TrackView.Device[N].Device[K]` for K = 0–3 until one is titled with the pad's instrument name (else `swap-sampler-not-in-view`; a pad whose first instrument is not a Drum Sampler is `swap-not-a-drum-sampler` first), a `hover` over that Drum Sampler's waveform, where Live draws its swap buttons only under a pointer, and a `press` of its own Next / Previous. **The control is `read` before it is pressed** (2026-09-15): Live greys its own swap buttons out when its index holds no similarity embedding for the samples on those pads, so a disabled button answers as `swap-not-rankable` with a reason a performer can act on, instead of as an `ax-control-disabled` from a press that was never going to land — and **every kit swap ends with the rack's swap bar pressed off** in the `finally` — swapped or refused, turned on by this swap or found on (2026-09-16, the user's call; it replaced "put back only a bar we turned on for a swap that did not happen"). Hiding costs nothing Live needs: measured on the rig, a bar pressed off and on again kept both directions enabled (Live keeps its reference) and the next Swap All took 338 ms. A hide that fails is a warning, not a failed swap. A pad never goes through the rack grid's SwapBar buttons: Live plays the pad when those are pressed, and the Drum Sampler's own swap without a sound (heard on the rig, 2026-09-15). Then `/looping/v3/drum/pad_names` before and after, then `/looping/v3/drum/finish_swap` — the chains named after their old sample take the new name and the undo step `show_for_swap` opened closes, so the swap and the renames undo as one; it is sent from a `finally`, whatever happened once `show_for_swap` went out, because an undo step left open would swallow the performer's next edits. The surface replies are consumed in the `pythonSurface` middleware (the TCP leg's too) and never broadcast; `/looping/v3/drum/swap_similar/reply` goes to the requesting client only. `direction` is `next` or `prev`, one press per request; Live keeps its own reference sample. Swaps run one at a time across every rack, not per rack: each selects its own rack's track, so two at once would press each other's buttons. It lives in the bridge because the surface runs on Live's main thread and Live services an AX press on that same thread: a surface handler waiting on the helper would stall the press it waited for. `sendToSurface` tags every number (`i` / `f`) because osc.js sends a bare JS number as a float. **One 45 s deadline covers the whole swap** and each helper `read` gets an explicit 3 s (swap audit M3/M5): the surface expires the undo step at 60 s, and without either the hops only had their own ceilings — a read with no `timeoutMs` inherits `axHelper.requestTimeoutMs` (20 s) and this path can do three. Past the deadline the reply is `swap-timeout` and the `finally` still closes the step. **One swap per rack is in flight at a time** (`swap-busy`, M8): the queue is global, so a second request for the same rack does not race the first — it waits and then presses again on whatever the first left selected. Tests: `drumSwapSimilar.test.ts`.
- **auto_capture override memory (ADR-405)** — `handlers/autoCaptureOverride.js`. Live rebuilds the surface on every set load and the fresh surface re-seeds `auto_capture` from the launch mode within ~2s, wiping any user override. The bridge remembers the last WS-client write on `/looping/v3/session/auto_capture` (recorded in `WebSocketServer.routeMessageToUDP`) and, when a surface emit on that address disagrees (the post-set-load re-seed), replays the override straight to the surface UDP port with an explicit `i` type tag (the `pythonSurface` inbound middleware in `enhanced-osc-bridge.js`). Mismatch-triggered only, so it can't oscillate; with no client write recorded it never interferes. Net contract: an override survives set loads / Live restarts and resets to the mode default when this process restarts.
- **TotalMix monitor link (ADR-423)** — `handlers/totalmixLink.js` +
  `handlers/totalmixBootstrap.js`. The bridge owns the UDP conversation with
  the RME mixer and caches the last **dB** per channel for its process
  lifetime, so a client that has just started can adopt current levels by
  sending `/totalmix/hello`. **The set-load argument no longer applies:**
  `b679e56` stripped the TotalMix chain out of `Track Key Controls.amxd` and
  the hello now comes from `owner/Max Patches/Max Utility 1.0.maxpat`, a standalone
  patch Live does not tear down. The cache is still needed — Global OSC has no
  read verb, so a newly-opened patch has no other way to learn the levels —
  but the reason is "the mixer cannot be asked", not "the device was rebuilt".
  `autoCaptureOverride` above is still a genuine survives-a-set-load case. Inbound mixer traffic (including an
  811-address state dump) is filtered to five channels and re-emitted as
  `/looping/v3/totalmix/<channel>`; the Max patch's writes on
  `/totalmix/<channel>` (the `totalmixDevice` middleware) are clamped and
  translated to the mixer's own address space by `totalmixLink.toMixer`.
  Browsers only read: the header's faders, the one WS writer, went on
  2026-09-27. `main` is
  read-only. Global OSC has **no read verb** — and an argument-less message
  is a *write* of 1.0, not a query — so the cache is seeded once at startup
  by provoking a dump on the legacy controller, then that socket closes.
  Everything on this path is dB; `0..1` exists only to draw the UI fader.
  **All of it hangs off `features.totalmix` (general-release audit §7b):**
  off, `totalmixLink` is null — no link, no 9003/11019 sockets (their
  entries are left out of `OSC_CONFIG`), no inbound sources, no bootstrap,
  no TotalMix config read and no TotalMix log line. Neither handler reads
  constants.json at `require` any more: the orchestrator passes the
  `osc.totalmix*` blocks in (a test may omit them and get the file's), and
  on with a block missing logs one error and reports the feature
  unavailable instead of dying at startup. **Available** = the mixer has
  answered since the bridge started — the bootstrap's `onReply` (any OSC
  packet on 7001, a strip-name mismatch included) or any packet on 9003 in
  the `totalmix` middleware — and never goes back, since the mixer has no
  heartbeat. Until then the reason is `Waiting for TotalMix`, then
  `TotalMix not answering` once the bootstrap ends with no reply; that case
  logs ONE line (`no answer on controller 1`) where it logged a
  strip-name mismatch per channel.

  **WS clients get the same replay (2026-09-25).** Each browser client is
  sent one `/looping/v3/totalmix/<channel>` per cached channel as soon as it
  authenticates: from `handleAuth`'s success path, after the verdict, or on
  connect when the auth gate is off (`replayTotalMixToClient` in
  `transport/WebSocketServer.js`). Before this, a client heard levels only
  from the one startup bootstrap broadcast and from later changes, so an
  iPad that connected or reloaded after startup showed empty wells until a
  fader moved (the UI store is module-local). Levels are set data, so an
  unauthenticated client gets none, the same rule `broadcastToClients`
  applies. With no link there is no replay, which is what
  `features.totalmix` off relies on. Tests: `webSocketServerWiring.test.ts`.

- **Client liveness watchdog** — client expects any inbound frame within 12s; on silence it force-closes the socket, triggering reconnect.
- **Dead-client reaper** — if a client's `bufferedAmount` stays above **512KB** (`REAPER_BUFFER_THRESHOLD`) for two consecutive 10s ticks, the bridge calls `client.terminate()` to force a TCP RST. Without this, a suspended iPad's socket can sit forever.
- **`/bridge/client_log`** — the browser watchdog ([clientWatchdog.ts](../src/lib/utils/clientWatchdog.ts)) reports tab visibility changes, rAF stalls, and online/offline transitions here. WebSocketServer logs them to `bridge.log` so one file has both sides of the wire.
- **`bridge-resync` custom event** — fires on every WS (re)connect and on visibility-resume. Reconnect path refreshes state via the v3 handshake accept (auto-emits state/full); visibility path calls `sendStateResync()` explicitly.

- **Surf→UI is a BROADCAST, including handshake replies (ADR-418)** — the bridge routes by address and the surface's UDP reply carries no client identity, so every `/looping/v3/handshake/accept` reaches every connected client. Clients negotiate independently (web UI advertises `3.4.0`, the `owner/menubar` app `3.3.0`), so a client routinely receives accepts for versions it does not speak and must ignore them rather than treat one as its own handshake failing. Nothing here needs to change for that — it is a property callers must know about, not a bug in the router.

Anomaly log lines to look for: `Health anomaly:`, `Health recovered:`, `Reaping wedged client`, `Client log [warn]: visibility-change`, `WebSocket silent past threshold`, `Client log [error]: uncaught-error`, `Client log [error]: reactivity-stall`.

**Triage of a "frozen UI, but faders still reach Live"** (ADR-418): repeated `v3 handshake: no accept — resending hello` with no `handshake: accepted` means the hello is being lost on the UDP hop to the surface; a `reactivity-stall` (usually preceded by `uncaught-error`) means an error escaped a Svelte effect and wedged the client's effect scheduler. The two are indistinguishable on screen and distinguishable only here.
