# Looping Menu-Bar

A lightweight macOS menu-bar (status-bar) utility for the Looping live-looping
rig. It gives you a checkmark-per-setting dropdown to flip the app's runtime
toggles **without opening the web UI**, and it reflects **live** state — the
checkmarks stay correct when you change a setting from the web UI or from Live.

It runs standalone alongside `npm run dev` / `npm run ipad`; it does **not**
require a browser tab to be open.

```
● Bridge connected · ipad
────────────────────
✓ Auto-arm on selection
✓ Move volume knob
✓ Auto record + save-as
────────────────────
  Transport
✓ Metronome
────────────────────
  Quit                ⌘Q
```

## How it works

The app connects to the bridge WebSocket (`ws://localhost:8081` by default) and
speaks the **same JSON envelope the web UI uses** — it's a faithful port of
`buildWireMessage` / `dispatchInbound` from
`interface/src/lib/api/connection/WebSocketConnection.ts`. That gets us both
halves for free:

- **Writes** — tapping a row sends `/looping/v3/session/<toggle> [0|1]`.
  Checkmarks are **echo-confirmed, not optimistic**: the row flips when the
  surface's echo lands (~90ms — the menu has closed by then), so a write
  that never reached the surface (e.g. sent mid-set-load, when the old
  surface is torn down and the new one isn't up) leaves the checkmark
  visibly unchanged instead of silently lying until the next re-seed.
- **Live state** — on connect it runs the v3 handshake
  (`hello ["3.3.0"]`); the surface re-emits `auto_arm` + `move_volume_knob` on
  accept (wire-protocol §2.12), which seeds the primary checkmarks. It also
  fires the `…/query` addresses as a belt-and-suspenders seed. Every setting is
  bidirectional (§2.12: *"same address carries the write and the echo"*), so a
  change made anywhere — web UI, Live, this menu — echoes back and updates the
  checkmark.

Ports/timings are read from `config/constants.json` at runtime (the project's
single source of truth). Addresses are the wire contract and live in code
(`Wire.swift`), exactly as they do in the web UI's `v3Session.ts`.

### Settings exposed

| Row | Address | Seeded on connect? |
|-----|---------|--------------------|
| Auto-arm on selection | `/looping/v3/session/auto_arm` | ✅ accept re-emit + `/query` |
| Move volume knob | `/looping/v3/session/move_volume_knob` | ✅ accept re-emit + `/query` |
| Auto record + save-as | `/looping/v3/session/auto_capture` | ✅ accept re-emit + `/query` (value may lag until the first heartbeat's mode seed) |
| Metronome | `/looping/v3/session/metronome` | ⚠️ on first change only |

**Auto record + save-as** (`auto_capture`) gates the iPad-style
auto-record-on-play + save-as-on-stop behavior (wire-protocol §2.14). Its
default is **launch-mode-derived** on the surface — on under `npm run ipad`,
off under `npm run dev` — but it's a real override: turn it off during an
iPad set, or on during a dev session, and the surface honors it. The
override **survives set loads and Live restarts** — the bridge remembers
your last write and replays it over the rebuilt surface's mode re-seed
(ADR-405) — and resets to the mode default when `npm run dev`/`ipad`
restarts. The surface seeds the mode default only on the first heartbeat,
so right after connect the checkmark may briefly read off before the seed
lands (and may blink once right after a set load while the replay
corrects the re-seed).

### Connection status

The menu-bar icon is filled (`repeat.circle.fill`) when the bridge WebSocket is
up and hollow when it's down; the top menu row says the same, and appends the
launch mode — `Bridge connected · dev` / `· ipad`. If the menu-bar's socket is
open, the bridge (`npm run dev` / `ipad`) is running — that's the signal, plus
the bridge's `/bridge/ping` every 5s. Auto-reconnect uses the same exponential
backoff as the web UI (base → cap 30s), and a 12s silence watchdog force-closes
a wedged socket so reconnect fires.

The mode comes from `/bridge/server_mode [mode]`, which the bridge broadcasts to
WS clients on connect and on the ping cadence (wire-protocol §2.13). This was
added alongside this app — the UDP `/looping/v3/server/heartbeat` beacon that
carries `mode` never reaches WebSocket clients.

## Build & run

Requires macOS 13+ and a Swift toolchain (Xcode or Command Line Tools).

**Automatic** — `npm run dev` and `npm run ipad` now launch the menu bar as a
`concurrently` process (via `scripts/launch-menubar.sh`, exposed as
`npm run menubar`). The first build takes ~30s; after that it's instant. If the
machine has no Swift toolchain (or isn't macOS) the launcher prints one line and
idles, so it never breaks the dev run.

**Manual** — to run it on its own:

```bash
cd owner/menubar/LoopingMenuBar
swift run          # builds and launches the menu-bar agent (no Dock icon)
```

Or open it in Xcode: `xed .` (or `open Package.swift`), then Run.

The Dock icon is suppressed at runtime (`NSApp.setActivationPolicy(.accessory)`),
so `swift run` gives you a real menu-bar agent with no extra Info.plist. To
leave it running permanently, build a release binary and add it to **System
Settings → General → Login Items**, or archive it into a `.app` in Xcode.

### Pointing it at constants.json

Resolution order (first hit wins):

1. `LOOPING_CONFIG` — explicit path to a `constants.json`
2. `LOOPING_PROJECT_ROOT` — `<root>/config/constants.json`
3. `/Users/Shared/DevWork/GitHub/vamp/config/constants.json` (the rig default)
4. walk up from the current directory looking for `config/constants.json`

If none is found it falls back to the same inlined defaults the web UI uses
(port 8081, etc.), so it still runs. Launching via `swift run` from inside the
repo means step 4 finds it automatically.

## Verifying it works

### 1. Headless protocol check (no macOS/Ableton needed)

A dependency-free Node harness spins up a mock bridge and drives the exact
handshake → seed → toggle → echo → **cross-client sync** choreography this app
implements, using a JS twin of the Swift envelope logic:

```bash
cd owner/menubar
node verify/verify.mjs
```

Expected: `11 passed, 0 failed`, including *"web-UI client observes menu-bar
write"* and *"menu-bar observes web-UI write"* — the bidirectional proof — and
the `/bridge/batch` unwrap path.

### 2. Real end-to-end on your Mac

With the rig running:

```bash
npm run dev                         # bridge + interface + surface
# open http://localhost:3000 in a browser
cd owner/menubar/LoopingMenuBar && swift run
```

Then:

- Toggle **Auto-arm** from the menu bar → watch the web UI's auto-arm state
  flip (and confirm arm-follows-selection stops in Live).
- Toggle it back from the web UI (or change it in Live) → watch the menu-bar
  checkmark flip. That's the bidirectional sync end-to-end.
- Quit `npm run dev` → the icon goes hollow within ~12s; restart it → the app
  reconnects and re-seeds.

## Known limitations

- **Transport toggles (metronome / session record / loop) have no `/query`**,
  so they show unchecked until their first change (or a state emit) after
  connect. The two *primary* SessionSettings toggles seed correctly on connect.

## Layout

```
owner/menubar/
├── README.md
├── LoopingMenuBar/                     # SwiftPM package (the app)
│   ├── Package.swift
│   └── Sources/LoopingMenuBar/
│       ├── LoopingMenuBarApp.swift     # @main, MenuBarExtra + menu content
│       ├── AppState.swift              # observable model, taps -> writes
│       ├── BridgeClient.swift          # WebSocket lifecycle, handshake, reconnect
│       ├── OSCEnvelope.swift           # wire envelope (port of WebSocketConnection.ts)
│       ├── AppConfig.swift             # reads config/constants.json
│       └── Wire.swift                  # v3 addresses + Setting enum
└── verify/                             # dependency-free Node harness
    ├── envelope.mjs                    # JS twin of OSCEnvelope.swift
    ├── mock-bridge.mjs                 # raw-socket bridge/surface simulator
    └── verify.mjs                      # asserts the full choreography
```

> Self-contained by design: it reads `config/constants.json` but has no other
> coupling to the repo, so it lifts cleanly into a standalone sibling repo later
> (e.g. `git filter-repo --path owner/menubar`).
