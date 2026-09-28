# Setup

The details behind [INSTALLATION.md](../../INSTALLATION.md), which is the install path to follow,
and more troubleshooting.

Companion: [architecture.md](architecture.md) covers what you're
wiring up; [preset-library.md](preset-library.md) covers preset
organization.

## 1. Prerequisites

### Required

- **macOS** 13.0 (Ventura) or later
- **Node.js** 22.13+ (`node:sqlite`; `engines` in `package.json` says the same) —
  [nodejs.org](https://nodejs.org/)
- **Ableton Live 12.4 Suite**

### Optional

- **iPad** with USB-C or Wi-Fi — the touch interface
- For the owner's AX helper only (`features.axHelper`, §5): **`uv`** and **`swiftc`**
  (`xcode-select --install`); `scripts/install-ax-helper.sh` hard-exits without either

## 2. Quick start (experienced users)

```bash
git clone https://github.com/ben-juodvalkis/vamp.git
cd vamp
npm run setup

# Your Mac's own settings, if any: config/constants.local.json (§4)

npm run dev
```

Then in Live: **Settings → Link, Tempo & MIDI → Control Surface →
Vamp**, and add this checkout's `Vamp Devices` folder as a Place. Output stays **None**; Input
too, unless a pedal is on USB (§5, USB pedal).

If validation passes and Live's log shows
`INFO:looping: - Looping surface init`, skip to §7 for iPad.

## 3. Install dependencies

```bash
npm run setup
```

Checks Node, installs the root project and both workspaces (the interface and the bridge),
links the surface into Live (§5) and runs the setup check (§6).

## 4. Your own settings (optional)

`config/constants.json` is tracked and works as it is: the defaults every Mac
shares. A Mac's own values go in `config/constants.local.json`, gitignored,
which the bridge, the interface server, the scripts and the surface all lay
over the tracked file (`config/CLAUDE.md`). Objects merge key by key, so it
holds only what differs:

```json
{
  "audio": { "defaultInputChannel": "3/4" },
  "network": { "ipad": { "usbc": "192.168.100.1" } }
}
```

Nothing has to be set. Live is found from its own preferences, the User
Library and the Packs from Live's `Library.cfg`, and the Places are ticked in
Settings. Restart `npm run dev`, and Live for the surface, after an edit.

## 5. Install the Python Control Surface

```bash
./surface/install.sh
```

Symlinks `surface/` into Live's **User Library →
Remote Scripts → Vamp** so edits to the source take effect after
a full Live restart.

The script finds the User Library by parsing `Library.cfg` under
`~/Library/Preferences/Ableton/Live <version>/`. Override with:

```bash
LOOPING_USER_LIBRARY="/path/to/User Library" ./surface/install.sh
```

After install, in Live:

1. **Preferences → Link/Tempo/MIDI → Control Surface**
2. Pick **Vamp** in any empty Control Surface slot.
3. **Input** and **Output** both stay **None** (the surface talks
   UDP, not MIDI) — *unless* the foot/wah pedal is plugged in over
   USB (next step).
4. Check `~/Library/Preferences/Ableton/Live <version>/Log.txt` for:
   ```
   INFO:looping: - Looping surface init
   ```

### USB pedal (optional, ADR-422)

With a pedal on USB, the surface reads its MIDI directly. The **foot switch** is a setting:
point the surface's Input at the pedal (steps 1–3), then **Settings → General → Foot Switch →
Learn** records its channel, CC and whether it is momentary or latching
(`logs/foot-switch.json`). The rest of this section is the owner's **expression pedal and wah**,
which exist only while `features.expressionPedal` is on:

1. In the **Vamp** Control Surface row, set **Input** to the
   pedal's USB MIDI port. **Output** stays **None**.
2. In the MIDI Ports list below, turn that input port's **Track** and
   **Remote** switches **off** — otherwise the expression CC leaks
   into armed tracks / Live's MIDI mapping.
3. Don't leave a Max patch listening to the same port, or every press
   fires twice.
4. The map is the Mac's own, in `config/constants.local.json` → `midiPedals`
   (`channel`, `wahToeSwitchCC`, `wahExpressionCC`; the owner's rig uses channel 10 and CCs
   21 / 20), then restart Live. Set `channel: 0` to listen on all 16 channels if you
   don't know what the pedal transmits on.
5. Verify in `Log.txt`: `MidiPedalInput: ready (channel=10, …)` on
   init, and `src='midi:pedal-input'` lines when pressing the pedal.
   If init looks right but presses log nothing, the pedal is almost
   certainly on another channel — flip to `channel: 0` to confirm
   before hunting elsewhere.
6. What the expression pedal drives depends on the selected track
   (ADR-445): the **Wah** (`Looping Presets/Effect Patches/Wah.adg`) on
   an audio track, **MidiWheels** (`Vamp Devices/MidiWheels.amxd`,
   the device the on-screen pitch/mod wheels drive; the pedal sweeps its
   mod wheel) on a MIDI track. Both paths are in `config/constants.json` →
   `devices.wah` / `devices.midiWheels`; remove the second block and every
   track gets the wah (and the on-screen wheels do nothing). MidiWheels
   loads through the **Vamp Devices** sidebar Place — see below. A wah already on a track wins — the Pedal central view's
   Wah button puts one on a synth track, and holding it takes it off.

Uninstall: `rm "<User Library>/Remote Scripts/Vamp"`.

### Looping AX Helper (ADR-439) — owner-only

Only while `features.axHelper` is on in `config/constants.local.json`; off, the bridge dials no
helper and the UI draws none of its controls.

```bash
npm run install-ax-helper
```

Builds and signs `~/Applications/Looping AX Helper.app` — a small launcher
that runs `owner/ax-helper` through uv — and loads its LaunchAgent, so it
starts at login. It is the one process allowed to drive Live's UI through
macOS Accessibility: Clip View's Reverse, the Save As dialog on transport
stop, Live's similar-sample swap buttons. Accessibility trust belongs to the
app that launched a process, so this works whichever terminal started
`npm run dev`; without it those controls report a named error
(`ax-helper-down`, `ax-untrusted`) instead of doing anything.

The first start shows the system prompt: switch **Looping AX Helper** on in
System Settings › Privacy & Security › Accessibility. The helper notices
within five seconds and restarts itself. The grant is tied to the app's
bundle id and its signing certificate (the first "Apple Development"
identity in the keychain, or `LOOPING_AX_SIGN_IDENTITY`), so a reinstall
keeps it; an ad-hoc signed build would need a fresh grant every time.

`-- --status` prints the agent's state and the tail of `logs/ax-helper.log`;
`-- --uninstall` removes app and agent (the System Settings entry stays until
you remove it there). With the helper running, Live's tree can be inspected
from any shell, no trust of its own needed:
`(cd owner/ax-helper && .venv/bin/python -m looping_ax_helper.client dump '{"match": "TapTempo"}')`.

**While the screen is locked, Live shows Accessibility no windows**
(measured): every AX-driven control reports `ax-no-main-window` until it is
unlocked.

## 6. Validate and run

```bash
npm run validate
```

Expected:

```
🔍 Checking setup...

✅ Node 24.7.0
⚪ No config/constants.local.json: the general edition's settings. A Mac's own go there.
✅ Live: Ableton Live 12 Suite 12.4.2 (last used)
✅ Control surface: …/User Library/Remote Scripts/Vamp

✅ Setup looks right.
```

Start everything:

```bash
npm run dev
```

This:
1. Runs the setup check.
2. Stops this checkout's old dev servers and frees their ports (build caches kept).
3. Starts the OSC bridge (port 8081 WS + UDP pairs — see
   [architecture.md](architecture.md#5-port-map)).
4. Starts SvelteKit at <http://localhost:3000>. Its server builds the browser's catalog from
   Live's index as it runs.
5. Opens the page and Ableton Live (and, with their switches on, the owner's Max patch and
   menu-bar app). The first run opens Settings as a checklist.

Live's log should show `Looping surface init` and the bridge log
(`logs/bridge.log`) should show `Bridge process starting` with no
errors.

## 7. iPad connection

### 7.1 USB-C (recommended)

```bash
npm run ipad
```

Builds the production interface and starts a preview server on
**port 8889**, bound to `0.0.0.0` so the iPad can reach it.

**It does not configure any networking.** Nothing in `scripts/` or
`owner/` calls `networksetup`, `ifconfig` or `route` — this doc claimed
otherwise, and the claim sent people looking for a script that has never
existed. The USB-C link is a **one-time manual step** in System Settings
→ Network → the iPad's USB interface: set it to Manual with IP
`192.168.100.1` / mask `255.255.255.0`. macOS remembers it, which is why
the setup appears to happen by itself on every run after the first. Auto-opens a status page at
<http://localhost:8890/> with the URLs to paste into iPad Safari.

Ableton Live launches immediately, in parallel with the build, so its
cold start overlaps the build rather than queueing behind it. The
catalog scan and the Vite build are both
fingerprint-gated: when nothing has changed they're skipped outright.
Measured on a Mac against the real preset library, that is **~32s for a
cold start vs ~12s once both gates hit**. Editing a Svelte source rebuilds
only the interface (~23s); touching a preset rebuilds only the catalog.
Force a full rebuild with `FORCE=1 npm run ipad`.

On the iPad:
1. Connect via USB-C cable.
2. Trust the computer if prompted.
3. Open Safari to **http://192.168.100.1:8889** — `npm run ipad` serves
   the production preview on 8889 (`package.json` `preview:ipad`), not the
   3000 that `npm run dev` uses.
4. Green connection dot = WebSocket connected + tracks flowing.

### 7.2 WiFi

```bash
# Find your Mac's WiFi IP, e.g. 192.168.1.42
ipconfig getifaddr en0
```

On the iPad open Safari to **http://<mac-ip>:8889** under `npm run ipad`, or
**http://<mac-ip>:3000** under `npm run dev`. Settings → Connection shows the address.

WiFi works but USB-C is lower-latency and survives network churn —
prefer it for live performance.

### 7.3 iPad Safari settings

- **Add to Home Screen** for quick access.
- **Hide toolbar** by tapping the screen (full-screen looks better).
- **Landscape** — the layout targets landscape.
- **Do Not Disturb** to prevent notification interruptions.

## 8. Daily development

```bash
npm run dev          # Start everything (bridge + interface + surface-ready Live)
npm run ipad         # Same, built for production iPad
npm run update       # Rebuild UI only, keep bridge + surface alive
npm run build        # Production build
npm run test:run     # Unit tests
npm run cleanup      # Kill dev servers + clear reserved ports (keeps build caches)
npm run cleanup:caches  # ...and nuke .svelte-kit / .vite / scripts/.cache
```

## 9. Troubleshooting

### 9.1 `config/constants.json not found`

It is tracked, so the checkout lost it: `git checkout config/constants.json`.
Your own settings are in `config/constants.local.json`, which git ignores.

### 9.2 `Path doesn't exist` errors

A path in your `config/constants.local.json` points nowhere. The setup check (`npm run validate`)
names it.

### 9.3 `Ableton not found`

```bash
ls -d /Applications/Ableton\ Live*
```

Put the exact path in `paths.abletonApp`.

### 9.4 Live loads the surface but UI shows no tracks

Most common cause: Live is running, the surface bound its UDP port,
but the bridge isn't forwarding. Check:

```bash
lsof -i :11020    # Should show the surface listening
lsof -i :8081     # Should show the bridge's WS server
tail -f logs/bridge.log
```

Look for `Bridge process starting` and no `ERROR` entries. If the
bridge died, check `grep "Bridge process exiting" logs/bridge.log`
and read the warning line immediately before it.

### 9.5 Surface fails to load with `Address already in use`

Live caches Remote Script bytecode. After changing
`osc_transport.py` or `LoopingSurface.__init__`, quit Live fully
(not just re-select the surface) and restart.

### 9.6 `Preset browser is empty`

The rail shows one button per Place ticked in **Settings → Places**; the Places themselves are
Live's own (its sidebar, the User Library, the Packs, read from `Library.cfg`). An empty rail
(Recent alone) means nothing is ticked, or no catalog was built.

```bash
# What the server builds for each ticked Place, and whether Live's index and the disk agree
npm run places:diff

# The Places the server lists, in Live's order
curl -s http://localhost:3000/api/places/index.json | head -c 600
```

A Place added in Live appears in Settings unticked within seconds.

### 9.7 Port already in use

```bash
lsof -i :3000     # SvelteKit
lsof -i :8081     # Bridge WebSocket
lsof -i :11020    # Python surface listen port
lsof -i :11021    # Python surface send port

kill -9 <PID>
```

If killing the bridge under `npm run dev`, do it via Ctrl-C on the
parent `concurrently` process — killing the bridge standalone leaves
a half-working dev setup.

### 9.8 macOS permission errors

**System Settings → Privacy & Security → Files and Folders** — grant
your terminal access. Restart the terminal afterward.

### 9.9 iPad can't reach the Mac

USB-C:
- Try a different cable (must be data-capable, not charge-only).
- On iPad: Settings → General → About → confirm it sees the Mac.
- Restart `npm run ipad` to refresh the network config.

WiFi:
- Both devices on the same network.
- Some WiFi networks block device-to-device traffic; try a mobile
  hotspot.

### 9.10 `$derived` stops working or UI won't update

```bash
npm run cleanup:caches
```

Clears `.svelte-kit`, `.vite` and the startup fingerprint stamps.
Svelte 5 reactivity tracking occasionally corrupts across HMR.

Note the `:caches` suffix — plain `npm run cleanup` only kills
servers and clears ports. Build caches are kept by default so the
`npm run ipad` staleness gates can hit; nuking them on every launch
is what used to make every start pay a full rebuild.

### 9.11 Bridge dies mid-session

```bash
tail -f logs/bridge.log
grep "process exiting" logs/bridge.log
```

`concurrently` auto-restarts it; the log tells you why it died.

### 9.12 `npm run ipad` exits immediately with `Segmentation fault: 11`

```
✅ Configuration valid!
sh: line 1: 79885 Segmentation fault: 11  npm run validate
```

Nothing starts — no Live, no servers, no status page. The validation itself
*passed*; npm crashed on the way out, and because the chain is
`validate && cleanup && setup-ipad`, the `&&` never fires.

Just run it again. This is an npm/node teardown crash, not a
configuration problem: observed twice in seven launches, but **zero times in
20 consecutive runs of `npm run validate` on its own** — it only appeared when
relaunching over a still-running instance, and system memory was 94% free at
the time. Shutting the previous instance down and waiting a moment before
relaunching avoids it.

Worth knowing before a performance: a failed launch here is silent and total.
Check that the status page actually came up rather than assuming the launch took.

## 10. Next steps

- [architecture.md](architecture.md) — how the pieces fit together.
- [wire-protocol.md](wire-protocol.md) — the OSC contract.
- [ui-architecture.md](ui-architecture.md) — SvelteKit layout.
- [preset-library.md](preset-library.md) — preset organization.
- [extending-devices.md](extending-devices.md) — adding a new device
  to the surface + UI.
