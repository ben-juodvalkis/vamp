# General-Release Audit: one codebase, two editions

**Date:** 2026-09-23 · **Tree:** `050623c2` (main) · **Status refreshed:** 2026-09-26 (`e426920`)

**The analysis behind the release plan.** Where things stand is [README.md](README.md), and what
remains is [plan.md](plan.md). Code and config cite this file's sections ("general-release audit
§7b"), so the numbering stays. The public name, once §11, is now [naming.md](naming.md).

**Question:** what does it take to offer Looping publicly without losing the bespoke rig? The
target is one codebase with two editions:

- The **general** edition runs on stock Ableton Live Suite and an iPad, with no third-party
  plug-ins and no special hardware.
- The **owner's rig** is the fully powered configuration of that same code.

**Method:** six read-only investigations covered audio and monitoring, controllers and pedals,
plug-ins and catalogs, content and views, install and platform, and the gating seams. The audit
lead then re-checked every headline claim against the files. **✓** marks a claim the lead
re-read. Everything else was read in code by an investigator unless it is tagged *(I)* for
inferred.

**Static analysis only.** No Live, no rig, no builds, no fresh-machine install. §9 lists what only
a clean machine can settle. The 2026-09-26 refresh re-checked the open items against the code and
measured a first run from a fresh clone, on the Node side (plan.md §2). Line numbers are from
2026-09-23 and have drifted in places.

---

## Verdict

**The engine is closer to general than it looks:**

- Core looping (session record, clip launch, track prep, mixing) runs entirely through the Python
  surface. It needs no Max patch, no plug-in and no hardware.
- Plug-in views already appear only when their plug-in, or its rack, is there (§6).
- Most hardware handlers sit idle when their hardware is absent.

**Four things stood between a stranger and a working first launch.** Where each stands:

| Finding, 2026-09-23 | 2026-09-26 |
|---|---|
| **1. Nothing the app loads ships with it.** The FX-grid presets, Empty Simpler, random-start and the Wah rack exist only in the owner's User Library; `.adv`/`.adg` are gitignored ✓. 88% of the instrument browser was plug-in presets. `npm run dev` on a fresh clone stopped at catalog generation ✓. Every FX tile fails `path-not-found`, even the stock ones, because the file check runs before the insert-by-name path ✓ | Still nothing ships (plan.md §6). The browser is on Live's Places, and a missing library now skips the catalog instead of stopping `dev`. A fresh clone stops earlier, at `validate` (plan.md §2) |
| **2. Configuration is one committed file describing the owner's machine:** 13 absolute paths, the Beta app name, LAN IPs, the TotalMix map, pedal CCs and an input name, with no override layer. Copying `constants.json.example` drops key paths ✓. Without `paths.userLibraryBase` every device load fails, and without `osc.webSocket.auth` WebSocket auth silently turns off ✓ | Unchanged (plan.md §3). The example is 39 settings behind, fails the build and listens on the wrong port. A missing auth block now logs a warning, but auth is still off |
| **3. Bespoke features have no off switch, and deleting their config crashes the bridge.** TotalMix config is read at `require` time ✓. Deleting `midiPedals` or `devices.wah` brings back built-in defaults. With the hardware absent, the TotalMix faders, the pitch/mod wheels and the capture REC button look alive and do nothing | Three switches are in: `totalmix`, `maxUtilityPatch` and `expressionPedal`. The foot switch is a setting with Learn, and the wheels need no Max (§7c–§7e). TotalMix config is read when used. Still to come: `menubar`, `axHelper`, `captureRecorder`, `pluginFx` (plan.md §4). REC still looks alive with no recorder |
| **4. The repo has publishing hazards.** It vendors Ableton's private-beta Extensions SDK under a license that forbids redistributing it ✓. The history carries about 190 MB (uncompressed) of vendor preset inventories and metadata ✓. Several UDP ports and two HTTP routes bypass the WebSocket auth on all network interfaces. `cleanup.sh` SIGKILLs any node or Python listener on 11 ports, machine-wide ✓ | The SDK and the extensions are out of the tree, but still in the history. Inbound UDP binds loopback, and the file routes answer only for library files. `cleanup.sh` still sweeps four ports, unscoped. The public repo is still to make (plan.md §7–§8) |

**None of this requires a rewrite.** The recommended shape (§7):

- A tracked **general base config**, plus the **owner's overlay**.
- A `features` block that switches each bespoke subsystem on or off, plus runtime detection of
  what's actually available.
- One `/bridge/features` message, so the UI hides what's off and greys out what's missing.
- A starter-content pack built from stock Suite devices.

**Since 2026-09-26, one more rule frames it:** the build holds code only, and everything about
the user's machine comes from the Mac at runtime ([onboarding.plan.md](onboarding.plan.md) §3).

---

## 1. Four ways to treat a bespoke thing

| Treatment | Meaning |
|---|---|
| **Delete** | Already dead on the rig. No switch needed. |
| **Owner-only** | Off in the general edition, and hidden from the UI. |
| **Configurable** | Useful to anyone with generic gear, such as any MIDI footswitch. Ships off, with settings. |
| **Ship** | The general edition needs content, or a replacement built from stock devices. |

---

## 2. Inventory

Effort is S (hours), M (a day or two) or L (a project). The "If absent today" columns describe
2026-09-23. A row marked **Done** has changed since, and [plan.md](plan.md) has what remains.

### Owner hardware

| Feature | For the performer | Needs | If absent today | General edition | Effort |
|---|---|---|---|---|---|
| **TotalMix monitor link** | Five monitor levels in the status strip and header | RME + TotalMix FX 2.10+, OSC controllers 1 and 3 configured, a channel map measured on one unit (`constants.json:169-213`) | Bridge starts, but logs 5 WARN lines every start (`totalmixBootstrap.js:143-153`). The status strip draws five empty bars forever (`TotalMixStrip.svelte:86-100`). **Header faders move under the finger and do nothing**, silently (`WebSocketServer.js:666-686`). Deleting the config blocks crashes the bridge ✓ | Owner-only. **Done 2026-09-25:** `features.totalmix` (§7c). Optional general stand-in: Phones → master cue, Main → master volume, via the surface *(I)* | S–M. The UDP endpoint list is hand-copied in 7 places; `udpPortCoverage.test.ts` asserts every `osc.*` pair is wired |
| **Max Utility patch** (standalone Max) | Move knobs and pads, CC 67 piano-pedal looper (the owner's, at home: kept, §7d), the device side of TotalMix. (The pitch/mod wheels left it 2026-09-25: next row) | Standalone Max.app, plus `node.script midi-hub.js` from the sibling `tag-midi-messages` repo ✓ (no copy in this repo) | Opened by both `npm run dev` ✓ (`package.json:74`) and `npm run ipad` ✓ (`setup-ipad.js:135-136`). **On a stranger's Mac:** it switches Max's audio on at load ✓ (`loadmess 1` → `ezdac~`, maxpat:200-210). Its bare `ctlin` hears CC 67 from every MIDI input ✓ (maxpat:1718), so **a digital piano's soft pedal fires looper taps and creates tracks** | Owner-only: don't open it. **Done 2026-09-25 (§7d)** | S (two launch sites) |
| **On-screen pitch/mod wheels** (10 instrument views) | Pitch bend and mod wheel | The Max patch above, with Max's MIDI port "a" routed into Live | The wheel animates and springs back; messages vanish at UDP 11004 (`messageRouter.js:194`) | **Done 2026-09-25: in the general edition, no switch.** The wheels drive `Vamp Devices/MidiWheels.amxd` (Mod Wheel → `ctlout 1`, Pitch Wheel → `xbendout`) through the surface's `MidiWheelsComponent`, which loads it on the selected MIDI track on the first touch (`/looping/v3/wheels/*`, wire-protocol §2.10.5). Suite runs it with no standalone Max; the `midiConverter` port and the bridge's `/midi/` route are gone. Needs only the "M4L devices" sidebar Place (Tier 2's relative paths cover its path). The moves record as arrangement automation, not into the track's MIDI clip | M |
| **Ableton Move** | Knob 1 = track volume, knob 2 = pad chain volume, pad hold focuses a pad, CC 75–78 = monitors | Move + the Max patch | Handlers stay idle. The "Move Knob" switch is still shown in three UIs (`SystemCentralView.svelte:202-208`, menubar `Wire.swift:25-26`, extension `panel.html:208-212`) | Owner-only. **Done 2026-09-25:** folded into `maxUtilityPatch`, which hides the switch (§7d) | S |
| **USB foot switch** | Tap walks record → close → play → overdub. Hold creates an armed audio track plus Permute | A *momentary* footswitch set as the Looping surface's Input | Idle with no Input. With a keyboard as Input, a channel-10 CC 23 crossing 64 fires taps and holds (`midi_pedal_input.py:223-237`, `FootTriggerComponent.py:221-228`). Deleting `midiPedals` restores the built-in defaults rather than disabling it (`midi_pedal_input.py:82-88`) | **Configurable:** enable flag, channel and CC settings, momentary/latching mode (a latching switch turns every first stomp into a hold), generic input for the hold. **Done 2026-09-26 (§7e):** a System-view setting with Learn, which detects the mode | S for the flag, M for the modes |
| **Expression pedal + toe switch** | Sweeps the Wah (audio tracks) or MidiWheels' mod wheel (MIDI tracks, since 2026-09-25 — the Expression Pedal rack before); the toe switch loads the device or steps the Wah's chains | Pedal hardware, plus `Wah.adg` (**its main chain is FX-Omnisphere** ✓) and, on MIDI tracks, `MidiWheels.amxd` in this repo (the on-screen wheels' device; `Expression Pedal.adg` is no longer loaded) | Idle without a pedal. A missing `.adg` gives a Log.txt warning, and every gesture retries. The Pedal view's Wah button gets `load-failed`. Its tooltip promises the pedal drives it, and there is no on-screen control (`PedalCentralView.svelte:123-127`) | **Configurable**, with stock rebuilds: an Auto Filter wah keeping Macro 1 = sweep, Macro 2 = chain selector. **2026-09-26: owner-only instead** (§7e): `features.expressionPedal`, off in a general edition; the rebuild is no longer planned | M (content plus installer) |
| **Default input "11/12 Guitar Mic"** | New audio tracks come up armed on the guitar/mic input | An interface whose input Live labels exactly that (also embedded in `looping-recorder.amxd`) | A name miss logs a warning, and the track keeps Live's default input (`TrackPrepareComponent.py:943-953`; foot hold at `FootTriggerComponent.py:585-602`) | **Configurable:** null means "leave Live's default". Open (plan.md §4) | S |

### Third-party plug-ins

| Feature | Needs | If absent today | General edition | Effort |
|---|---|---|---|---|
| Omnisphere/NI **preset-browser servers** (ports 7400–7501) | Nothing: both servers were deleted 2025-11-23 ✓ (36ca0327a) | The bridge still binds their ports and routes `/search`, `/status`, `/ni/*` to them (`enhanced-osc-bridge.js:108-117`, `messageRouter.js:119-148`). Removing the config crashes the bridge | **Delete.** Done 2026-09-23 (Tier 0, below) | S |
| Omnisphere and Komplete Kontrol **instrument views** | The AU plug-ins | They mount only when the plug-in is detected by name (`instrumentService.ts:141-146`) | Leave them; they already gate themselves. KK stays: the owner still uses it (2026-09-23) | S |
| **FX tiles and racks backed by plug-ins** | **Tremolo:** the owner's own JUCE AU (`Bjuo`/`Trmo` ✓). **Comb:** u-he Zebrify (`UHfX` ✓). **Smudge:** FabFilter Saturn 2 (`FabF` ✓). **Bass:** Helix Native. **Pitch:** `Pitch-Helix.adg`, Helix Native ✓. **`Guitar.adg`:** stock chain **plus a TONE3000 AU** ✓, with IRs from the owner's User Library (`Impulse Responses/Guitar Rig/…`) ✓ | A missing file gives `path-not-found`. A missing plug-in gives a placeholder device *(I)*. The Pitch view is an empty `<div>` (`PitchHelixCentralView.svelte:1`) | Owner-only: Tremolo, Comb, Smudge, Bass, Pitch, as `pluginFx` (plan.md §4). **Ship a stock rebuild:** Guitar (Amp + Cabinet). The Wah rebuild was dropped 2026-09-26 (§7e) | M |
| **Skaka Pattern Rack** view | Klevgrand Skaka AU, the repo Picker `.amxd`, and an owner sample | The view never appears; nothing breaks (`instrumentService.ts:171-181`) | Nothing to do. The view appears only for an Instrument Rack whose first macro reads "Pattern N": it keys on the macro, not on plug-in detection (corrected 2026-09-26). Optional: a stock "Pattern N" demo rack | S |
| Arpeggiator view's **Chance** slider | `Note Chance.amxd`, a third-party Max download in the User Library (`devicePresets.ts:359-375`) | The slider binds nothing | Owner-only, or hide the slider: part of `pluginFx` (plan.md §4) | S |

### Host integrations

| Feature | Needs | If absent today | General edition | Effort |
|---|---|---|---|---|
| **AX helper**: drum similar-swap, Reverse, Save As, Group gesture, auto-capture | uv, swiftc, macOS 13, and a login LaunchAgent under the owner's bundle id, with absolute uv/repo paths sealed into its signed Info.plist. A manual Accessibility grant. English menu titles (`targets.py:35,43-44`). Live 12.4's Swap All for kit swaps. The Group gesture sends real system-wide clicks and ⌘G | The swap pill greys out with a reason (`useInstrumentSwap.svelte.ts:109-121`), which is the right pattern. Reverse, Group and Save As only return error codes | Off by default, with an opt-in installer. "Off by profile" must be distinguishable from "helper down" (`AxHelperClient.js:366-367` makes them identical today). Open: `axHelper` (plan.md §4) | S to gate |
| **Clip similar-swap** | Live's own sample database, read through `node:sqlite` (`similar-samples/+server.ts:31`) | A 503 `no-database`, and the pill shows "unavailable". `engines` allows Node 20 ✓, which has no `node:sqlite` | On in both editions; raise the Node floor. Open (plan.md §2) | S |
| **Live extension** `looping-prefs` | Live Beta in Developer Mode, plus the vendored private-beta SDK | — | Deleted 2026-09-23 (§5.1) | S |
| **Menubar app** | Swift and macOS 13 (`Package.swift:14`) | Sits idle if Swift is missing (`launch-menubar.sh:27-34`) | Owner-only (decided 2026-09-26): a `menubar` switch at both launch sites (plan.md §4) | S |
| **AI melodic variations** | **Not on main** ✓ (branch `claude/ai-melodic-variations-live-we8hn5`). On that branch: Python 3.12, torch on Apple Silicon/macOS 14, and an 82.5 MB checkpoint licensed **CC-BY-NC-4.0** *(I)* | — | Settle the license question before it lands in an MIT tree | — |

### Repo Max for Live devices

| Feature | Needs | If absent today | General edition | Effort |
|---|---|---|---|---|
| **Permute** (added on every track prep) | Suite, plus a Live sidebar Place named exactly "Permute" pointing into the clone | No Place → `not-in-browser`, and prep continues without it. (The engine switch that defaulted off is gone: the engine always runs, 2026-09-26) | **Ship:** a first-run Place step and paths computed from the clone ([onboarding.plan.md](onboarding.plan.md)). The engine default is settled | S–M |
| **random-start** (added on every Simpler insert) | `random-start.adv` in the owner's User Library, wrapping the repo `.amxd` by absolute path ✓ | A warning only. The Simpler view's Random knob binds nothing | **Ship** a wrapper re-saved from the clone | S |
| **Capture recorder** (REC → WAV → new Simpler) | `looping-recorder.amxd` on Return A of the owner's default template, which is outside the repo | **REC latches "recording" on tap and never clears.** The clip-view REC also turns Send A to full on whatever the stranger's Return A holds ✓ (`RecordButton.svelte:54-62`). `/capture/error` has no UI handler. The unsaved-set fallback folder is a wrong hard-coded path (`capture-looping.js:40-41`) | **Ship** with a template set. Show REC only after the device has announced itself. `/capture/query` can't serve as that check: it replays the last file (`capture-looping.js:151-154`) | M |

### Content pipeline

**Superseded 2026-09-24 by the Places browser**
([../browser-places.plan.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/browser-places.plan.md)). The type catalogs, the samples
symlink farm (`paths.audioBrowserBase`) and the dead library keys (`omniLibraryOrder`,
`folderAbbreviations`) are gone. The browser reads the Places in Live's sidebar: one rail button
per Place, with each Place's presets and its `Samples` folder in one catalog
(`scripts/generate-places-catalog.ts`). A missing library skips the catalog with a warning, and
`npm run dev` goes on. A Place named for a role (Drum, Key, …) colors and records its loads; any
other gets its role from `catalog.places.<Name>.role`. `flattenFolders` and `keepNestingFolders`
are per-Place now.

What a general edition's browser still needs is [onboarding.plan.md](onboarding.plan.md): today
it lists only Places inside `paths.sidebarRoot`, and loads only from Places typed into config.

### Dead in both editions: delete first

- The **Omnisphere/NI server** ports and routes (above).
- **`osc.shellHelper`** (11007): its receiver was deleted in 5e16c2a00.
- **`osc.utilityMax`** (11012): nothing consumes it.
- **`config/trackTypes.json`** and its copy step: no reader since b5ec46cbd ✓, and 2 of its 3 preset
  paths don't exist.
- **`config/omnisphere-consolidation-rules.*`**: no importers.
- **70 stale legacy catalogs** in `interface/static/data` (79 MB of `omni-*`, `ni-*`,
  `melodic-*`…). The generator never cleans them, so they ship with the build, and the tracked
  `check-electric.js` requires one that's gone.
- **Move patches:** `move-hijack.maxpat`, `live_to_move.js`, `move_to_live.js`,
  `move sustain pedals.maxpat`. Nothing opens them.
- **Orphan devices with no consumer:** `Wah Param Smoother.amxd`, `shaker.amxd` (its buffer is
  hard-coded to `/Users/Music/shakers/…`), the Note Generator devices.
- **Loaded by nothing:** `Mastering.adg`, `Shakers.adg`, `Samples/`.
- The `shot:check` / `shot:golden` descriptions in `package.json`: the goldens were retired
  2026-08-31.

**Keep, owner-only:** the `maxObserver` routes, `liveAPI-v6.js` and AbletonOSC helper. On
2026-04-22 you chose to keep these as legacy.

**Your call:** `Track Key Controls.amxd` (mute-solo-control).
- It sits on the rig template's Return A, and no code talks to it.
- Its script creates a LiveAPI object per message and drops it, which is the pattern
  `surface/CLAUDE.md` records as crashing Live *(I)*.

> **Done 2026-09-23 (Tier 0).** Deleted: everything in the list above except the hand-use
> devices and racks, plus `liveAPI-v6.js`, `AbletonOSC helper.amxd` and the `maxObserver`
> port pair (the owner reversed the 2026-04-22 keep), and `ableton/extensions/` (§5.1). The
> stale catalogs and the extensions' untracked build output went to the Trash, not `rm`.
> `cleanup.sh`'s port sweep lost the dead 7400–7501, 9001/9002 and 11001 entries.
> **Kept by the owner's decision:** Komplete Kontrol (the view, the "custom e" transpose
> name, the glyph/glance entries — still in use), and the hand-use devices and racks
> (`Track Key Controls`, `Wah Param Smoother`, `shaker`, the Note Generators, `Mastering.adg`,
> `Shakers.adg`, `Samples/`). The two dead `flattenFolders` entries were removed rather than
> renamed: the folders are now "Damage Lite" and "Metal Lite", and flattening those would be a
> behavior change.

---

## 3. Starter content for the general edition

**Where it lives:**
- A small tracked `content/` folder in the repo. The files are kilobytes, but `.gitignore:13-14`
  needs a negation for them.
- An installer copies it into `<User Library>/Vamp Presets/` ([naming.md](naming.md)). The owner's
  rig keeps `Looping Presets/`.
- The browser cache only resolves the User Library or configured Places (`browser_cache.py:111-128`).
- Content installed while Live runs won't resolve until the surface reloads
  (`browser_cache.py:204-208`) *(I)*.

**Rule for every item: re-save it from a clean Live, don't copy the owner's file.** The owner's
files embed his paths. For example, `Reverb.adv` points its impulse responses into
`/Applications/Ableton Live 12 Beta.app/…`.

### Tier 1: core flows break without these

1. **The 20 single-device FX presets**, all rebuildable from stock Suite:

   | Group | Presets |
   |---|---|
   | Delay, filter, dynamics | Echo, Auto Filter, Compressor, Gate, Multiband Dynamics, Glue Compressor |
   | Color and character | Saturator, Variation (Beat Repeat), Channel EQ, Drum Buss, Pedal, Utility, Redux |
   | Space and modulation | Reverb (Hybrid Reverb), Phaser, Chorus |
   | MIDI effects | Random, Arpeggiator, Velocity, Chord |

   The file stem must equal the tile's `defaultName`.

   **An alternative removes this tier:** allow a *file-less* insert-by-name for stock devices, by
   moving the file check at `DeviceLoadComponent.py:558`.
   - A general-edition tile would then insert Live's factory device.
   - The owner's tuned settings would become an optional preset pack instead of a prerequisite.

   Recommended. It's M, and it deletes most of the content problem.
2. **`Empty Simpler.adv`.** Without it, record → Simpler, clip → Simpler and browser Simpler mode
   all fail with `empty-simpler-preset-unconfigured`. The capture and browser flows also leave an
   empty prepared track behind.
3. **Permute wiring.** A first-run "add the Permute Place" step, `placesRoots.Permute` and
   `devices.sequencer.devicePath` derived from the clone. (`sequencer_engine`'s default is settled:
   the switch is gone and the engine always runs, 2026-09-26.) With loads that name the Place,
   one "M4L devices" Place covers Permute and MidiWheels
   ([onboarding.plan.md](onboarding.plan.md) §6).
4. **An instrument source:** a small starter library, or Live's Packs and Core Library through
   Live's index ([onboarding.plan.md](onboarding.plan.md) §4). Without one, the browser is empty.

### Tier 2: specific features

5. **`random-start.adv`**, re-saved from the clone, for the Simpler Random knob.
6. **Stock rebuilds with the same names and macro layout:**
   - `Guitar.adg`: Amp + Cabinet instead of TONE3000, and no Guitar Rig IRs.
   - `Wah.adg`: dropped 2026-09-26. The wah is owner-only (§7e).
   - `Digital.adg`: Shifter + Redux, re-saved.
   - `Expression Pedal.adg`: dropped 2026-09-25. MidiWheels replaced it.
7. **A Live Set template** with `looping-recorder.amxd` on Return A, for capture.

---

## 4. Machine-specific values and the install path

### 4a. Where the owner's machine is baked in

About 28 tracked code and config files carry roughly 84 owner-specific values. Docs carry another
109, mostly ADRs. The ones that matter:

| Where | What |
|---|---|
| `config/constants.json` | 13 absolute paths (15 by 2026-09-26), `Ableton Live 12 Beta.app`, LAN and USB-C IPs, the bundle id, the input name, the TotalMix map, pedal CCs |
| `package.json` ✓ | `open -a 'Ableton Live 12 Beta'` and `bj.local` in `open:browser`, the `dev` launch leg |
| `interface/vite.config.ts` ✓ | `bj.local`, `bj-2.local`, `bj-3.local` allowed hosts |
| `interface/src/lib/api/connection/WebSocketConnection.ts:23,27` ✓ | Port 8081 and hostname `looping-studio`, hard-coded outside constants |
| Preset and device files | Owner repo paths inside `random-start.adv`, `Expression Pedal.adg` and the Skaka rack ✓. `/Users/Music/…` inside `shaker.amxd`. Interface channel names inside `looping-recorder.amxd` |
| Max JS | Values copied by hand, which nothing checks for drift: `foot-trigger.js:49`, `move_pad_hold.js:40`, the Skaka picker, the recorder ports |
| `launch-ipad.command:2`, `setup-ipad.js:70`, `AppConfig.swift:13,121`, `capture-looping.js:40-41` | Owner paths. `setup-ipad.js:70` launches a browser-blocker from another repo |

Test fixtures carry another 27 hits. They're plain strings, or they skip when the file is missing,
so they should pass on another Mac *(I)*.

### 4b. How config is loaded, and why there's no override today

- **Four loader families, and none merges two sources.**
  - The Python surface walks up to `config/constants.json` (`config_loader.py:45-66`) and falls back
    to built-in ports.
  - The bridge reads the file in 5 places, three of them at `require` time (`enhanced-osc-bridge.js`,
    `messageRouter.js`, `WebSocketServer.js`; recounted 2026-09-26). TotalMix's two read on demand
    since §7c.
  - The UI **compiles the config into the build**: 15 `$config` imports. So a config change needs an
    iPad rebuild. The runtime rule ([onboarding.plan.md](onboarding.plan.md) §3) moves the
    machine-specific ones out.
  - The menubar and AX helper read environment variables and then fall back to the owner's path.
- **Nothing derives `paths.userLibraryBase` from Live's `Library.cfg`.** Only `install.sh:78-114`
  parses Library.cfg, and only to place the Remote Script symlink. (Since then
  `interface/src/lib/server/libraryCfg.ts` reads it too, for the file routes' roots and the
  Places' order.)
- **The docs contradict each other on the example file.**
  - Copy it: `config/CLAUDE.md:30`, `setup.md:42,69`, and the fix hints printed by three scripts.
  - Don't copy it: `README.md:77-80`, `INSTALLATION.md:102-111`, `CONTRIBUTING.md:54-59`,
    `.gitignore:45-49`.
- **The only guard, `constantsExample.test.ts`, checks just `osc.*` and the Permute Place.**
- **The validators check very little.** `validate-setup.js` checks 4 required keys and
  `validate-constants.js` checks 2 paths. Neither loads `constants.schema.json`, which
  `config/CLAUDE.md:26` says it does.

### 4c. Install steps a stranger faces today, in order

| # | Step | Required? | How |
|---|---|---|---|
| 1 | Node (`.nvmrc` pins 24.7.0) | required | manual |
| 2 | `npm run install:all` (also sets git hooks) | required | automated |
| 3 | Edit the tracked `constants.json`: 3 repo paths, the library paths, the input name | required | manual |
| 4 | Provide preset content. (Since the Places cutover, a missing library skips the catalog instead of exiting 1) | required | manual |
| 5 | `surface/install.sh` (no npm script runs it), then a full Live restart | required | run by hand |
| 6 | Pick "Looping" as a Control Surface in Live's Settings | required | manual |
| 7 | Add the sidebar Places "Permute" and "M4L devices". "Samples Organized" is owner-only | optional (needs Suite) | manual; nothing automates it |
| 8 | `npm run install-device-defaults` (rewrites Live-wide defaults) | optional | automated |
| 9 | AX helper install, plus the Accessibility grant | optional | build automated, grant manual |
| 10 | `npm run dev` or `npm run ipad` | required | automated |
| 11 | iPad over USB-C: a static 192.168.100.1/24, set by hand (`setup.md:290-296`) | optional | manual |
| 12 | Pedals, Max patch, TotalMix, Skaka (the extension was deleted) | owner-only | manual |

Measured 2026-09-26: on a fresh clone, `npm run dev` stops at its first step, `validate`, until
step 3 is done (plan.md §2).

### 4d. Real version floors

| Dependency | Real floor |
|---|---|
| **Live** | **Live 12.4 Suite for the general edition.** The code has no runtime version check. By feature: 12.2 for `device_insert_mode` (guarded), 12.3 for `insert_device` (falls back to the browser), and **12.4 for `replace_sample`**, without which clip → Simpler and capture fail (`SimplerLoadComponent.py:11,490`). Suite is needed for Permute, capture and random-start. Without Max for Live, core looping still works. The owner has only ever run 12.4.x betas. 12.4 has since been released, a free update for Live 12 |
| **macOS** | 13, for the AX helper and the menubar |
| **Node** | `engines` says `^20.19 \|\| >=22.12`, but the clip similar-swap needs `node:sqlite`, which is 22.13+ *(I, exact minor)*. `.nvmrc` pins 24.7 |
| **Python** | 3.12, for the AX helper. The surface runs on Live's own Python |

---

## 5. Publishing hazards: fix before the repo is public

### 5.1 Ableton Extensions SDK tarballs

**Four private-beta SDK and CLI tarballs are tracked ✓**, under
`ableton/extensions/*/vendor/*-1.0.0-beta.0.tgz`.

**The license inside forbids sharing them.**
- It forbids distributing "the Extensions SDK or parts of it outside of your application".
- It treats pre-release material as confidential ✓.

**Fix:**
- Remove them from the public tree.
- Keep the extension owner-only.
- Document where a developer gets the SDK.

They're in the history too, which is one reason for §5.2.

> **Done 2026-09-23.** The owner chose to delete `ableton/extensions/` outright (both
> extensions and the four tarballs); ADR-389 is marked retired. History still carries them.

### 5.2 Git history

**What's in it:**
- 3,787 commits in a 101 MB pack ✓.
- The largest blobs are vendor preset inventories: a 150 MB Komplete Kontrol inventory JSON, the
  18.7 MB Omnisphere metadata, and old 20–30 MB catalogs ✓.
- Owner paths throughout.

**Credential scan:** the whole history was searched for GitHub tokens (`ghp_`, `github_pat_`),
Anthropic (`sk-ant-`), AWS (`AKIA`) and Slack (`xoxb-`) key prefixes, and private-key headers.
**0 hits** ✓. A dedicated scanner is still worth one run before publishing.

**Options, ranked:**
1. **A new public repo from a squashed snapshot, made canonical; archive this one as history.
   Recommended.** It doesn't rewrite anything you already have. The public repo is created as
   `vamp` ([naming.md](naming.md) §3).
2. **Rewrite this repo with `git filter-repo`.** Every hash changes, and it goes against the
   plain-merge, no-rewrite way you work in this repo.
3. **A one-way sanitized mirror.** That's two trees, and two trees drift, which is exactly what you
   want to avoid.

### 5.3 Network exposure

This matters more on a stranger's LAN, or on venue Wi-Fi.

- **The inbound UDP ports bound `0.0.0.0`** ✓ (`UDPPortManager.js:27-112`; fixed, see Status
  below). The one exception was the surface reply port, 11021, closed to `127.0.0.1` earlier. What
  arrived on the others was relayed to every WebSocket client, bypassing the HMAC auth. For
  example:
  - One `/capture/file <path>` datagram to 11017 makes every client create a track and load that
    file.
  - `/totalmix/*` sent to 11019 reaches the mixer.
- **`/api/sample-peaks` read any absolute path it was given**, with no root check and no
  `hooks.server.ts` ✓ (fixed, see Status below). `/api/similar-samples` is also outside the auth.
- **Both servers listen on `0.0.0.0`** ✓ (`package.json:72,80`).
- **Fix:** bind loopback where the peer is local, restrict the file routes to library roots, and
  state the LAN trust model in the README.
- **Status, 2026-09-23: the first two are done.** Every inbound socket in `UDPPortManager.js`
  binds `127.0.0.1`; every peer was measured sending to 127.0.0.1, and only TotalMix's
  sub-second bootstrap socket on 7001 stays on all interfaces. Both file routes now answer only
  for a sample file (by extension) under the library, Live's own Places, packs and Core Libraries,
  the capture folder, or a Live project, and 403 anything else (`$lib/server/sampleRoots.ts`).
  `placesRoots` alone would have refused real traffic, so the list is read from Live's own
  `Library.cfg`. The servers stay on `0.0.0.0` for the iPad. The README trust model is still open,
  and so (found 2026-09-26) is `/api/ws-auth` handing the raw secret to any request without a
  salt (plan.md §7).
- **The other end of those conversations can't be bound to loopback** (measured 2026-09-23):
  - **Max's `udpreceive` has no bind address.** The Max 9.1.5 refpage (the same in standalone Max
    and in Live's bundled copy) documents only a port and a "full-packet" symbol argument. The
    shared `udpreceiver` in the Max binary is port-only (`binding to port %d`). The only
    address-taking methods (`sethost`) belong to `udpsend`. In a scratch patch in the running Max,
    `udpreceive N`, `udpreceive N 127.0.0.1`, `@host`, `@bind` and `@address` all bound `*:N`,
    and a probe sent to the LAN address reached every one of them. `udpreceive N 127.0.0.1` is a
    trap: it switches the object to raw `FullPacket` output and still listens on every interface.
    `mxj net.udp.recv` is port-only too.
  - **Max for Live runs inside Live.** With the rig's set open, `lsof` showed the Live process
    itself holding `*:11016` (the `looping-recorder` commands, `/capture/start` and the rest) and
    `*:11030` (the Permute gate). No separate Max process was running. Standalone Max, with the
    Max Utility patch open, holds `*:11018` and `*:11004` (the 11004 wheel section was deleted
    2026-09-25). Those four are every `udpreceive` left in the repo, now that Tier 0 has deleted
    the AbletonOSC helper and `move-hijack`.
  - **TotalMix FX 2.10b4 has no bind option.** Each OSC controller is one `OSCSETTINGS` struct
    (in use, own port, remote port, `char remoteHost[1000]`, flags). Its only address is where
    TotalMix *sends*, and it listens on `*:7002` and `*:7003`. Any LAN host can set mixer levels
    directly, around the bridge's dB clamp, phones included. Its network remote server
    (`NetRemoteEnable`) is off.
  - This Mac filters nothing inbound: the Application Firewall is off, and pf has only Apple's
    anchors.
- **Options, ranked:**
  1. **A pf rule on the exact ports. Recommended.** It's the only filter that reaches Live's
     in-process M4L sockets without touching Live's other networking (Link). It also covers
     TotalMix and the 7001 bootstrap, and it doesn't care which process owns a port:
     `block drop in quick on ! lo0 proto udp from any to any port { 7001 7002 7003 11016
     11018 11030 }` (11004 went with the wheel section, 2026-09-25). `pfctl -n` parses it. It
     is not loaded or tested:
     that needs `sudo` (an anchor in `/etc/pf.conf` plus a LaunchDaemon running `pfctl -e`, since
     macOS boots with pf off). Local traffic uses `lo0` and is untouched. It has to be checked
     from a second device, and the port list has to track `constants.json`.
  2. **The Application Firewall, set to block incoming for TotalMix and standalone Max.** It's a
     System Settings toggle, but it can't cover 11016/11030 without blocking Live, which takes
     Link with it.
  3. **Accept it and document the trust model**, and perform over the USB-C link with Wi-Fi off,
     which leaves the iPad as the only peer.

### 5.4 The machine outside the repo

- **`cleanup.sh` SIGKILLs other projects' servers.** On every start it SIGKILLs any node or Python
  process listening on 3000, 8081, 8889, 8890, 9001, 9002, 7400, 7401, 7500, 7501 or 11001,
  whoever owns it ✓ (`cleanup.sh:68,96,139`). A stranger's own dev server on :3000 dies on every
  `npm run dev`. The process sweep just above it already restricts itself to this repo's cwd
  (`:127-130`), so apply the same filter to the ports. Tier 0 dropped the dead ports; 3000, 8081,
  8889 and 8890 are still swept, unscoped (2026-09-26).
- **`install-device-defaults` changes Live's defaults for every set.** It backs them up, but it
  should be opt-in, with a prompt.
- **The Max patch's CC-67 listener and audio start** (§2) happened to anyone who ran `npm run dev`.
  Fixed 2026-09-25: nothing opens the patch unless `features.maxUtilityPatch` is on (§7d).

### 5.5 Licensing

- The repo is MIT ✓.
- The variation branch's model is non-commercial *(I)*.
- Vendored Max content (for example `Vamp Devices/Abstractions`) was **not** checked for
  third-party authorship.
- **2026-09-26:** some Max files in the recorder look like Ableton's own, `lom-reference.md` says
  it was scraped from Cycling '74's docs, and the Skaka rack hosts a commercial AU (plan.md §8).

---

## 6. What's solid: don't "fix" these

- **Core looping** has no Max or hardware dependency. Auto-capture uses the AX helper, not Max
  (`PerformanceCaptureComponent.py:10-15`).
- **Plug-in views gate themselves.** Omnisphere and Komplete Kontrol mount only on detection
  (`instrumentService.ts`), and the Skaka view only for a rack whose first macro reads
  "Pattern N". They need no flag.
- **The swap pill's grey-with-a-reason** (`useInstrumentSwap.svelte.ts:109-121`) is the model for
  "enabled but unavailable".
- **"Remove the block and it's off" already works in the surface** for `permuteGate`,
  `midiWheels` (the `expressionPedal` block until 2026-09-25), `randomStart` and `sequencer` (`LoopingSurface.py:1503-1511,1945-1956`;
  `WahPedalComponent.py:155-159`; `TrackPrepareComponent.py:974-975`). The bridge is where that
  convention breaks.
- **The browser rail follows whatever catalogs exist**, and empty catalogs don't error.
- **Hardware handlers are event-driven**, so absent hardware costs nothing.

---

## 7. The mechanism: one codebase, two editions

### 7a. Config layering

This is the structural decision. Options, ranked:

1. **A tracked general base, plus the owner's overlay. Recommended.**
   - `config/constants.json` becomes the general edition's complete, working defaults.
   - Machine paths are derived at launch: the User Library from `Library.cfg`, the repo root from
     the clone.
   - Only the owner's differences go in the overlay: paths, hardware maps, all features on,
     library tuning.
   - Track the overlay as `config/profiles/owner.json`. It stays recoverable, and it doubles as a
     worked example for anyone with an RME interface. A gitignored one-liner, `config/local.json`,
     picks which overlay applies.
   - One merge script, run by `dev`, `ipad` and the installers, writes a gitignored
     `constants.effective.json`. Every loader reads that file.
   - Because only differences live in the overlay, the base can't rot the way the example did.
2. **Deep-merge inside each loader.** No generated file, but the merge gets written in Python,
   Node, the UI build, Swift and about 15 scripts.
3. **Keep the example as the general edition.** That's two full files to keep in step, which is
   the drift you want to avoid, and the example is already 71 keys behind.

**Not decided yet** (2026-09-25). One gap in option 1 as written: the merge is run by `dev`, `ipad`
and the installers, but the UI **compiles** `$config/constants.json` in (15 imports under
`interface/src`), so `npm run build`, `test:run`, `check:types` and `npm run shot` read the config
too. On a fresh clone a gitignored `constants.effective.json` would not exist for any of them.
Either every one of those runs the merge first (a `pre*` script each, and the pre-push hook), or the
`$config` alias resolves through a small Vite plugin that merges the base and the overlay as the
build reads them, leaving the generated file to the readers outside Vite (the bridge, Python,
Swift, the scripts). The second keeps a fresh clone building with no extra step. The feature
switches do not wait on this: a switch is one key wherever the file comes from, and the UI learns
it over the wire (§7c).

**2026-09-26:** the runtime rule ([onboarding.plan.md](onboarding.plan.md) §3) takes the UI build
out of this question. The build keeps only defaults that are the same on every machine, so only
the Mac-side readers need the overlay (plan.md §3).

### 7b. The `features` block

Call it **`features`**, not "profile": "profile" already means drum-kit profiles
(`DrumRackCentralView.svelte:70`) and perf profiling. One explicit switch per subsystem, as it
stands on 2026-09-26:

| Group | Switches |
|---|---|
| Owner hardware | `totalmix` (done, §7c); `maxUtilityPatch` (done, §7d, with `move` folded in) |
| Pedals | `expressionPedal` (done, §7e). `footSwitch` became a user setting with Learn instead (§7e) |
| Host integrations | `axHelper`; `menubar` (owner-only, decided 2026-09-26). `liveExtension` was here: Tier 0 deleted the extension (§5.1) |
| Repo Max devices | `captureRecorder`. `permute` became an onboarding step instead: its engine always runs, and its device needs a Place |
| Plug-in content | `pluginFx`. `skaka` needs none: its view appears only for a rack whose first macro reads "Pattern N" |

The four still to come are in plan.md §4.

**How a switch is wired** (built with `totalmix`, and followed by each one since):
- **Config:** one boolean under `features`. Only an explicit `true` is on, and a typo'd key or a
  non-boolean is logged (`interface/bridge/utils/features.js`).
- **Surface:** `config_loader.feature_on(constants, feature_id)`. Skip building a disabled
  component; the existing "component may be missing" guards absorb that.
- **Bridge:** read the flags once, and gate ports, handlers and routes on them. Read a
  subsystem's config when it's used, not at `require` time, so a disabled feature needs no config
  block at all.
- **Wire:** `/bridge/features` = `{id: {enabled, available, reason}}` on connect, on change and
  with the 5-second ping (wire-protocol §2.13). `/bridge/*` sits outside version negotiation, so
  it needs no protocol bump.
- **UI:** `bridgeStatus.feature()`, `isFeatureOn()` and `unavailableReason()`. Off → hidden. On
  but unavailable → greyed out, with the reason. A feature the bridge hasn't named reads as off.
- **FX grid:** keep the 12-column ruler, and draw disabled tiles as ghosts. The TotalMix strip
  repeats that ruler by hand (`fxGridLayout.ts`), so removing a tile would break the layout.
- **Detection:** AX helper status, a non-empty TotalMix level cache, and plug-in detection by
  name. Capture needs a new hello from the device.
- **Harness:** `features` in the shot scene, mock and tours (`DEFAULT_FEATURES`; the views
  `general` and `totalmix-down`).

### 7c. Pilot: TotalMix

**Done 2026-09-25** (PR #516). With `features.totalmix` off, the bridge binds none of the TotalMix
ports, runs no bootstrap and reads no `osc.totalmix*` block, and the UI draws no monitor strip
and no header faders. On, they are greyed out and inert, with the reason, until TotalMix answers
on either OSC controller. The TotalMix modules read their config when called, not at `require`,
so the switch on with a block missing logs one error instead of crashing. `UDPPortManager`'s
setup, open and close walk the ports it built, retiring three hand-kept lists. The shot scene
seeds TotalMix in dB (it seeded 0–1, so every capture drew five full bars). Behavior in detail:
[toggles.md](../../reference/toggles.md).

- **Measured on the rig:** switch on, the bootstrap seeded all five levels 1.8 s after start;
  off, neither port bound and nothing was logged about a mixer.
- **Fixed on the way (PR #517):** the bridge now replays its cached levels to each client once
  it authenticates, so a reloaded iPad no longer shows empty wells.
- **Still to check on the rig:** the header faders drive the mixer, and the Move's monitor knobs
  still reach it.

### 7d. Second switch: the Max Utility patch

**Done 2026-09-25** (PR #522). `features.maxUtilityPatch` decides whether anything opens
`owner/Max Patches/Max Utility 1.0.maxpat`: `npm run dev` and `npm run ipad` both go through
`scripts/open-max-patch.js`. Off, standalone Max never starts, so no audio is switched on at load
and there is no omni `ctlin`: a stranger's piano cannot fire looper taps.
- **`move` folded in.** The Move reaches the surface only through this patch. Off, the System
  view draws no Move Knob switch.
- **The CC 67 chain stays.** It is the owner's home-studio piano-pedal looper (ADR-422 addendum).
- **The wheels don't hang off it.** They moved to `MidiWheels.amxd` the same day (§2), and the
  patch's `udpreceive 11004` wheel section was deleted.
- The bridge can't see the patch, so the switch reads available whenever it's on.

### 7e. The pedals: a switch for the wah, a setting for the foot switch

**Done 2026-09-26.** The wah is the owner's: its main chain is FX-Omnisphere, and only the
owner's expression pedal plays it. So it is **`features.expressionPedal`**, the first switch the
surface reads. Off, the surface claims neither wah CC and the Pedal view draws no Wah column. A
MIDI foot switch is anyone's, so it became a System-view setting with **Learn**, owned by
`FootSwitchComponent` and persisted to `logs/foot-switch.json`:
- Learn takes the next CC on the surface's Input and tells momentary (tap and hold) from latching
  (tap only). This fixes §2's "a latching switch turns every first stomp into a hold".
- If nothing arrives in 10 s, the card says to set the pedal as Looping's Input in Live, the one
  step the app can't do.
- `midiPedals.footSwitchCC` only seeds the setting on a machine with nothing saved, so the rig is
  unchanged. With no seed and nothing saved there is no foot switch, which closes §2's hazard of
  a keyboard firing looper taps.

**Still to check on the rig:** Learn with the USB pedal, including how long
`request_rebuild_midi_map` takes to start delivering CCs and whether forwarding all 2,048
channel/CC pairs during a learn is harmless; and that the rig's seeded CC 23 still taps and
holds.

---

## 8. Docs vs. code (the code wins)

Re-checked 2026-09-26. The rewrite is plan.md §8.

- **`README.md`,** all still wrong: Node 18+, Live 11 or 12 and macOS 12; the Omnisphere/NI
  browsers and a `preset-browsers/` folder; AbletonOSC credited; "no network configuration" for
  USB-C, which contradicts `setup.md`; six links to deleted docs.
- **`INSTALLATION.md`,** still wrong: Node 18; Live 11; copying the example "throws at import
  (config.devices.wah)"; `placesRoots.permute` pointed at a sibling repo (the key is `Permute`, and
  the folder is inside this repo); `${PROJECT_ROOT}` placeholders that nothing expands; no
  `install-device-defaults`; five links to missing docs. Fixed: macOS 13 and the Places, and
  "presets optional" now matches the code.
- **`docs/reference/setup.md`,** still wrong: the "AbletonOSC is still in the tree" banner; the
  keys `abletonBuiltinDevices` and `samplesBase`; Omnisphere/NI as options; `:3000` in the Wi-Fi
  section. Fixed: the build caches, and 8889 for `npm run ipad`.
- **`config/CLAUDE.md`,** still wrong: it says to copy the example, and that `validate:constants`
  checks the schema, which it never loads. Fixed: `omnisphere-consolidation-rules`.
- **`docs/reference/preset-library.md`:** fixed, rewritten for the Places.
- **`constants.json` notes:** the `liveAPI-v6` note is gone. Still wrong: the Wah is "moved to
  chain position 0", but the code places it there and never moves it; `pinnedFirst` claims to
  order sorted lists, but nothing reads it.
- **Root `CLAUDE.md`:** fixed.
- **Still describing deleted features:** `CHANGELOG.md`'s 1.0.0 (AbletonOSC, the Omnisphere/NI
  browsers), the bug-report template (the AbletonOSC version, a missing setup guide), and
  `CONTRIBUTING.md`'s links to missing docs.

---

## 9. What only a clean machine can settle

- Does `open "Max Utility 1.0.maxpat"` do anything on a Mac with only Live's bundled Max?
- Do Core Library and Pack samples have similarity vectors, so the clip swap works?
- How do Live 12.2 and 12.3 behave (below `replace_sample`), and how does a non-Beta 12.4 behave?
  (12.4 has since been released.)
- A non-English Live UI under the AX helper.
- Whether the Omnisphere view's parameter indices hold on someone else's Omnisphere.
- **The whole install on a clean macOS user account with stock Suite.** This is the most
  informative single check. It turns §4c from a reading into a measured list, with a real
  first-run time.
- **Added 2026-09-26:** the onboarding measurements ([onboarding.plan.md](onboarding.plan.md)
  §5): what Live's index lists, and when Live writes `Library.cfg`.

---

## 10. Ranked plan

Superseded on 2026-09-26 by [plan.md](plan.md). The tiers as they stood that day:

| Tier | What | State, 2026-09-26 |
|---|---|---|
| 0 | Delete the dead weight | Done 2026-09-23 (§2) |
| 1 | Layered config and the `features` registry | Three switches done (§7c–§7e), four to come (plan.md §4). Layering open (plan.md §3) |
| 2 | A first run a stranger can survive | Open, and reshaped around onboarding (plan.md §1–§2, [onboarding.plan.md](onboarding.plan.md)) |
| 3 | Starter content | Open (plan.md §6) |
| 4 | Publish, including the demo video | Open. The SDK tarballs are out of the tree (plan.md §7–§8) |

---

## 11. The public name

Moved to [naming.md](naming.md) on 2026-09-26.
