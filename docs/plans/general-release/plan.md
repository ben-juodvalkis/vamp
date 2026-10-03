# General Release: What Remains

**Checked against `main` at `e426920` on 2026-09-26.** Five read-only reviews of the code, plus a
first run measured from a fresh clone. That run was in a Linux container, so it covers the Node
side only: no Live, no macOS.

**Sizes:** **S** is hours, **M** a day or two, **L** a project.

Where things stand overall is [README.md](README.md). The analysis behind most items is in
[audit.md](audit.md).

---

## 1. The browser and onboarding

The design is [onboarding.plan.md](onboarding.plan.md). What a stranger hits today:

- **Only Places inside one owner folder are listed.** The catalog keeps the Places under
  `paths.sidebarRoot`, the rig's `…/Looping Presets/Instruments/Sidebar`
  (`scripts/generate-places-catalog.ts`, `placesUnder`). A Place on `~/Music` or another drive
  never appears.
- **Only the User Library and hand-typed Places can load.** The surface finds a preset only under
  `paths.userLibraryBase` or a Place entered in `paths.placesRoots` as a name and an absolute path
  (`surface/components/browser_cache.py`). Anything else fails `not-in-browser`.
  Samples and clips escape this, because they load by file path.
- **The iPad's browser is frozen at build time.** `npm run ipad` copies the catalog into the
  build, and `vite preview` serves that copy. Five client files also compile machine values in.
- **Changes are noticed late.** The catalog is built when `npm run dev` or `npm run ipad` starts.
  The surface builds its lookup once per Live session and never retries a miss. It even records a
  Place that was missing at first use as built (`_build_root`), and only tests call
  `invalidate()`. A Place added mid-session needs a server restart to appear, and a set load or
  Live restart before anything in it loads.
- **With no Places, the browser is empty** apart from Recent. The skipped catalog is logged, not
  shown.

**Work:** onboarding.plan.md §6. About M–L, with one protocol bump and a Live restart.

## 2. A fresh clone that starts

**Done 2026-09-27**, but for the capture fallback folder. Measured on the Mac from a clean clone of the branch, its
owner paths rewritten to `/nonexistent/…` and its `abletonApp` to an app that isn't there:

| Step | Result |
|---|---|
| `npm run setup` | 9 s. Installs every dependency, links `Remote Scripts/Vamp` (into a scratch User Library for the test), runs the setup check, and says what's left: pick Vamp in Live, then `npm run dev` |
| The setup check (`npm run validate`, `dev`'s first step) | Passes. Node ✅, Live ✅ (the Beta in use, found from Live's preferences), the surface ✅; two warnings, both the owner's preset folders |
| `npm run build` | Passes, 18 s |

**What changed:**
- **`npm run setup`** replaces `install:all`: Node first (22.13+, for `node:sqlite`; `engines`
  says the same), then `npm install`, `install.sh`, and the check.
- **One setup check.** `validate:constants` is gone. The check fails only on Node, the
  dependencies or a config that doesn't parse; everything else is a warning with the fix. It
  doesn't load `config/constants.schema.json`: the schema accepts the example config, which
  fails the build.
- **Live is found** (`scripts/open-live.js`): `paths.abletonApp` when it's on this Mac, else the
  app whose version names Live's newest preferences folder, else the highest version.
- **The surface is linked as Vamp.** A `Looping` link into a `looping-surface` folder is removed,
  and the installer says to pick Vamp in its place.
- **Owner hard-codes:** `bj.local` and `looping-studio` are gone (the page dials the host that
  served it; the dev banner prints this Mac's Bonjour name). The browser blocker is
  `paths.browserBlocker`, run only when set. `launch-ipad.command` runs from its own folder.
  `paths.projectRoot` is gone: nothing read it. The page's port stays 8081, compiled in, the same
  on every machine.
- **`cleanup.sh`** kills only listeners whose working directory is in this repo, and names the
  rest. `interface/.npmrc` is gone: npm ignores it under workspaces.

**Left:**
- **The capture fallback folder** in `capture-looping.js`, an owner path baked into the recorder
  device. It moves with the `captureRecorder` switch (§4), which needs the rig.
- ~~**The config itself** is still the owner's (§3)~~: done 2026-09-27. A clone runs the tracked
  general defaults; the owner's rig lays its `constants.local.json` over them.

## 3. Config

**Done 2026-09-27** (Ben chose a merge inside each loader). The tracked `config/constants.json`
is the general edition's working defaults: every switch off, no owner path, address, pedal map
or Places tuning. A Mac's own values go in `config/constants.local.json`, gitignored, laid over
it by every reader on the Mac:
- the bridge and the scripts through `interface/bridge/utils/constants.js`
- the interface server through `interface/src/lib/server/runtimeConfig.ts`
- the surface through `surface/config_loader.py`

Objects merge key by key; anything else replaces. The UI build still compiles the tracked file
alone, which holds only what every machine shares (the palette, gesture timing, rack macros).
`constants.json.example` is gone, and `sortPriority`, which nothing read, with it.

**Measured:** the rig's local file holds 26 settings, the tracked file 118. Merged, the two equal
the old tracked file in every setting (documentation and `sortPriority` aside), and the three
loaders produce byte-identical results. A missing value falls back cleanly: the User Library to
Live's `Library.cfg` (the surface used to normalize an empty setting to `.`), the Bonjour name to
the Mac's own, the input pair to `1/2`.

**Left:**
- The AX helper's bundle id is still the owner's, in the tracked file: it moves with the
  `axHelper` switch (§4), since a new id means granting Accessibility again.
- The TotalMix blocks stay tracked: inert while the switch is off, and the tests pin the
  measured channel map there.
- Another Mac of the owner's needs its own `constants.local.json`: nothing syncs it.

## 4. Owner-only subsystems

Each switch becomes a row in [toggles.md](../../reference/toggles.md) ("Feature switches") once it's wired,
following audit §7b.

| Switch | What a stranger hits today | Size |
|---|---|---|
| `menubar` (owner-only, 2026-09-26) | **Done 2026-09-27.** Off, neither start script builds or launches it; the rig's local file turns it on | S |
| `axHelper` (owner-only, 2026-09-27) | **Done 2026-09-27.** Off, the bridge dials no helper and the UI draws no Rev or Group, a held Drum Sampler pad steps the kit, and `npm run ipad` never opens Save As. On, they grey out with the reason while the helper is down or untrusted. The bundle id is the rig's, in its local file; the tracked one is neutral (`local.looping.ax-helper`) | S–M |
| `captureRecorder` (not a switch, 2026-09-27) | **Done 2026-09-27.** Every edition has it: the device needs only Max for Live. It rides `/bridge/features` always enabled; REC is greyed with `No recorder on Return A` until the device's once-a-second hello, a refused start shows in the error banner and turns Send A back down, and an unsaved set records into Live's own temp project, which the bridge hands the device (wire-protocol §2.15). The owner's fallback folder is gone | M |
| `pluginFx` | Tremolo (the owner's AU), Comb (Zebrify), Bass (Helix Native), Pitch (Helix), Guitar (TONE3000) and the Arpeggiator's Chance slider (`Note Chance.amxd`) are always drawn. A tap loads, fails `path-not-found`, and the tile goes back to a ghost with only a log line. The Pitch view is an empty `<div>` | S–M |

**Not switches:**
- **Skaka: nothing to do.** Its view appears only for an Instrument Rack whose first macro reads
  "Pattern N" (`instrumentService.ts`), not on plug-in detection as the audit said. Permute's
  mute lane works without the picker device: its gate packets go nowhere, harmlessly.
- **Permute.** The engine always runs, but the device still needs a Place in Live, which becomes
  an onboarding step. With loads that name the Place, one "Vamp Devices" Place covers both Permute
  and MidiWheels. Today Permute needs its own Place, because the longest configured root wins.
- **The default input** `11/12 Guitar Mic` (`audio.defaultInputChannel`). **Done 2026-09-27:**
  optional, unset in the tracked config, so a new audio track keeps Live's default input; the
  rig's local file keeps its `11/12 Guitar Mic`. It is not in `Vamp-Recorder.amxd` (measured 2026-09-27):
  the device's Audio From routing is saved in each set (`MxDInRoutable`), so a fresh insert
  already takes Live's default.

## 5. Failures a stranger can see

The swap pill's grey-with-a-reason is the model: a control that can't act says why. Today these
fail with nothing on screen:

- an FX tile with no preset file (§4)
- ~~Reverse, Group and Save As without the AX helper (§4)~~: done 2026-09-27, hidden when off and greyed with the reason when the helper is down
- ~~REC with no recorder device (§4)~~: done 2026-09-27, greyed with the reason until the device says hello
- **Guitar and Bass rename the track even when the load failed.** The rename is sent right after
  the load request, without waiting for the result (`fxGridStore.svelte.ts`).
- ~~Three Simpler flows leave an empty track when the Empty Simpler preset is missing~~: done
  2026-09-27, there is no preset any more (§6)
- **Permute's step edits** on a track without the device ask for it, wait 10 s for a load that
  can't happen, then drop the edits without a message (`sequencerStore.svelte.ts`).
- **A skipped catalog** is logged, not shown.

**Size:** S–M, mostly alongside §4 and §6.

## 6. Starter content

- **Stock tiles insert Live's own device:** done 2026-09-28 (protocol 3.12.0, needs a Live
  restart). The 20 tiles that are stock Live devices (Echo, Auto Filter, Compressor, Gate,
  Multiband Dynamics, Glue Compressor, Saturator, Variation (Beat Repeat), Channel EQ, Drum
  Buss, Pedal, Utility, Redux, Reverb (Hybrid Reverb), Phaser, Chorus, Arpeggiator, Random,
  Velocity and Chord) name no preset file: the tile sends `native:<class>` and its name, and
  the surface inserts the device by name, always, so every user gets it as their own Live
  default has it (Ben, 2026-09-28: trust each user's defaults). The owner's tuned presets are
  his Live defaults already. `install-device-defaults` is gone. `load_into_track` needed
  nothing: none of its callers loads a native tile. Still files: Digital (below), Pitch Hack
  and Chance (Max devices), Wah and Vocal (racks), and the plug-in tiles.
- **A Simpler without a preset:** done 2026-09-27. Record → Simpler, clip → Simpler, the
  browser's Simpler mode and capture insert a Simpler by name (this Mac's default Simpler, else
  Live's factory one) in place of any instrument the track came with; `Empty Simpler.adv` and
  `paths.emptySimplerPresetPath` are gone. Measured on the rig first: an inserted Simpler reads
  Classic and takes `replace_sample`.
- **Random Start without a preset:** done 2026-09-27. The Simpler's Random knob loads the
  checkout's own `random-start.amxd` through the "Vamp Devices" Place, like Permute and
  MidiWheels; `random-start.adv` isn't needed (it held the device's own defaults). The rig's
  local override is gone too.
- **`Digital.adg`,** re-saved (stock Shifter + Redux) (**S**).
- **A template set** with `Vamp-Recorder.amxd` on Return A, for capture (**M**, needs the rig).
- **Something to browse on day one:** Live's Packs and Core Library through Live's index. It
  covers all 82 Packs on the rig, and their presets carry Live's own role tags (measured
  2026-09-26, onboarding.plan.md §5). A starter library isn't needed for this.
- **`install-device-defaults` asks before it writes** (**S**). It replaces Live-wide defaults, so
  every Echo a user drops in Live changes, not just the app's.

## 7. Security

- **The trust model: device pairing** (Ben, 2026-09-30; **M**). Anyone on the same network who
  can open the page can drive Live: `/api/ws-auth` answers any caller, and the WebSocket checks
  no origin. Through the AX helper that includes real clicks and a ⌘G on the Mac (it ships off
  since 2026-09-27, §4). Decided: the cable and the Mac are trusted, a device on Wi-Fi pairs once
  with a code or an Allow, on by default. The design is
  [security.plan.md](security.plan.md). The README and [SECURITY.md](../../../SECURITY.md) state
  today's model (2026-09-30).
- **Delete `/api/ws-auth`'s salt-less branch: done 2026-09-30.** A request with no salt is a 400.
- **Auth on unless explicitly off: done 2026-09-30.** Only `auth.enabled: false` turns the gate
  off; a missing block or an unreadable config keeps it on. The same day the bridge started
  refusing a browser page from another origin (security.plan.md).
- **Stop copying the whole config into the served static folder** (**S**; it falls out of the
  runtime move). Any browser on the LAN can read it at `/config/constants.json`.
- **The rig.** Audit §5.3's pf rule covers the Max and TotalMix receivers, which can't bind
  loopback: 7001–7003, 11016, 11018 and 11030. (11004 went with the Max patch's wheel section on
  2026-09-25.) It needs `sudo` and a check from a second device.
- **The `@claude` GitHub workflows: removed 2026-09-30** (Ben). Both failed for want of a
  `CLAUDE_CODE_OAUTH_TOKEN` secret, and the comment one had no author check of its own.

## 8. Publishing

- **`vamp` is the living repo, not a snapshot** (Ben, 2026-09-27). From the cutover every
  change, the rig's included, lands in `vamp`. `Looping` is frozen as it stands, private, as the
  history: nothing is culled from it. `vamp` is built by bringing over what's live, and starts
  with fresh history, which also leaves behind the Extensions SDK tarballs deleted on 2026-09-23
  and about 190 MB of vendor inventories. See "The `vamp` repo" below.
- **A dedicated secret scanner on `vamp`'s first commit.** A pattern search of the tree and the reachable
  history found nothing, but no scanner is installed here.
- **The license: done 2026-09-28.** MIT, © 2025–2026 Ben Juodvalkis; `interface/` and
  `interface/bridge/` carry `"license": "MIT"`, and `THIRD-PARTY-NOTICES.md` carries
  shadcn-svelte's MIT notice for the components in `interface/src/lib/components/ui/`.
- **Third-party content: settled 2026-09-28 (Ben).** The recorder's Max files
  (`M4L.gain2~.maxpat`, `BrowseRouting.maxpat`, `RoutingObjects.maxpat`) and the Skaka picker and
  rack are fine to publish. The Cycling '74 scrape `lom-reference.md` is gone: what the rig
  measured beyond it moved to `docs/reference/live-api-measurements.md`, and the code cites that
  or Cycling '74's pages. The favicon is the app's own icon, not the Svelte logo. The stray
  `Note Generator 3.0.amxd` and `data/ableton-devices.json` stayed behind in Looping.
- **The user docs: rewritten 2026-09-28.** README.md, INSTALLATION.md (the one install path),
  CONTRIBUTING.md, CHANGELOG.md (restarted for Vamp), the bug-report template and
  `docs/reference/setup.md` now state Live 12.4 Suite, macOS 13 and Node 22.13+, drop AbletonOSC,
  the Omnisphere/NI browsers and the dead links, treat the AX helper as the owner's, and state the
  LAN trust model.
- **Renames to Vamp:** [naming.md](naming.md) §4. Live lists the surface as Vamp since 2026-09-27; nothing else is renamed yet.
- **Versions and CI.** There are no tags. The root and bridge say 1.0.0, the interface 0.0.1,
  and the wire protocol is 3.10.0. There's no CI either: the gate is the local pre-push hook, and
  a public repo that takes pull requests needs one.
- **The demo:** [demo-recording.plan.md](demo-recording.plan.md), not started.

### The `vamp` repo

**Done 2026-09-27; the rig moved 2026-09-28.** `vamp` (`ben-juodvalkis/vamp`, public since
2026-09-28) was built from Looping's `dbae35ae` with `git archive`, with fresh history, and every
change lands here now. `Looping` is frozen at that commit as the history; its checkout stays on
disk because old Live sets and the Skaka rack point into it. Links to what stayed behind point at
that commit on GitHub.

```
vamp/
  README.md  INSTALLATION.md  LICENSE  CHANGELOG.md  CLAUDE.md
  interface/     the web app and the bridge (the v6/ and v3/ levels kept, for now)
  surface/       the Python control surface (was ableton/looping-surface/)
  Vamp Devices/  what the app loads by itself: Permute, MidiWheels, Random Start, the recorder
                 and the one abstraction the recorder uses. The one Place a user adds in Live
  owner/         the owner's rig, off by default: ax-helper/, menubar/, Max Patches/, the
                 Skaka picker and rack, Lock Move Knobs (mute-solo-control/), the
                 Modulation Test prototype, and the rig probes (probes/, was the surface's tools/)
  config/  scripts/  data/
  docs/
    reference/   architecture, wire protocol, toggles, the LOM, UI architecture, extending
                 devices, the preset library, setup, the rig smoke test
    plans/       general-release/ and clip-automation-warp.plan.md
    adr/         all 327; the next is 454
```

**One Place for the devices** (Ben, 2026-09-27). Everything the app loads by itself goes through
one Place, loaded by name: `place:Vamp Devices` + the path inside (`live_library.M4L_DEVICES_PLACE`,
`devicePresets.ts`'s `source`). A Place is named after its folder, so the folder is `Vamp Devices`.
Only a user's devices go in it; the owner's live in `owner/`.

**The ADRs.** The three un-numbered files became 451–453 (the plan counted four; the fourth was
`CLAUDE.md`). Of each duplicate pair the one nothing cites was renumbered: 111 → 448
(name-based transpose), 133 → 449 (duplicate-track prevention, whose header had said ADR-095),
182 → 450 (Simpler sample gain).

**Stayed behind in `Looping`:** both archives (but the rig smoke test), the finished audits
(code quality, color, swap), the finished plans (`browser-places`, `clip-view-mirror`,
`current-project/`), `locks/`, `data/ableton-devices.json` and its copy in
`interface/static/data/`, `simpler-test.js`, `scripts/symbol-refs.js`, the Note Generators
(Ben, 2026-09-27), and, decided from what loads them (nothing): `Wah Param Smoother.amxd`,
`Modwheel Sender.amxd`, `shaker/` and `Abstractions/track-control-ui.maxpat`.

**Where the tree differed from this plan (the tree won):** `docs/reference/setup.md`, which no
list named; `data/`, which comes over but for `ableton-devices.json`; the devices the plan didn't
name, decided from what loads them (`manydeferlows.maxpat` to `Vamp Devices/`, Track Key Controls (since replaced by Lock Move Knobs)
and Modulation Test to `owner/`); three un-numbered ADRs, not four.

**Decided (Ben, 2026-09-27):** `owner/` ships in `vamp`, switched off, with no private overlay
repo; the `v6/` and `v3/` levels stay for now; fresh history.

**Checked:** gitleaks 8.30.1 over the tree found no leaks. The gate passed in `vamp` before
the first push (svelte-check, vitest, both pytest suites, the build); the surface's pytest counts
match Looping's exactly (2883 passed, 4 skipped).

**The rig, moved 2026-09-28:**
- `npm run setup` relinked `Remote Scripts/Vamp` to `vamp/surface`, with no warnings. The rig's
  gitignored state came over byte-identical: `config/constants.local.json`, `config/.ws-secret`,
  `logs/session-settings.json`, `logs/places.json`, `logs/save-as-counter.json`, `.env`, the
  Claude launch config and the thumbnail caches. There was no `logs/foot-switch.json` to copy.
- Live's Places: `Vamp Devices` added, `Permute` and `M4L devices` removed (Ben, by hand;
  confirmed in `Library.cfg`, 19 Places; `-------------` went too).
- Live's log after the restart names only vamp paths for the config, the session settings and
  the three devices, and none of Looping's. Permute, MidiWheels and Random Start each loaded
  through `user_folders['Vamp Devices']` on scratch tracks, deleted after.
- The AX helper was rebuilt from `owner/ax-helper` and stayed trusted for Accessibility (same
  signing identity). The menubar app builds from `owner/menubar`.
- `npm run ipad` serves from `vamp`, and a fresh page authenticates and shows the set.
- Claude's memory was copied to `vamp`'s project folder.

**Still pointing into `Looping`:** the Skaka rack and the User Library's symlinks to the picker
(an edit to `owner/Skaka Metronome Picker/` reaches the rig once the rack is re-saved from this
folder); the Max Utility patch if Max still has Looping's copy open; any old set.

**The `@claude` workflows are gone** (Ben, 2026-09-30; §7). The repo has no GitHub Actions.

## 9. Checks on the rig and a clean Mac (Ben)

- **TotalMix** (audit §7c): the Move's monitor knobs still reach the mixer. (The header's
  faders were removed on 2026-09-27.)
- **The foot switch** (audit §7e): Learn with the USB pedal, how long Live takes to start
  delivering its CCs, and whether the rig's seeded CC 23 still taps and holds.
- **The four follow-up tests** in onboarding.plan.md §5. Each changes the library: saving a
  preset with Live running, adding a Place, loading from a Pack, disabling a VST.
- **A clean macOS user account with the release build of Live 12.4 Suite** (audit §9): the whole
  install, timed. It's the most informative single check. Live 12.4 is out, and free to Live 12
  owners; the rig has only run betas.
- **The rest of audit §9:** a Mac with only Live's bundled Max, older Live versions, and a
  non-English Live under the AX helper.

## 10. Small defects found on the way

- Every bridge stop logs `Shutdown step failed … wsService?.destroy is not a function`
  (`enhanced-osc-bridge.js`). bonjour-service's `Service` has `stop()`, not `destroy()`.
- The bridge's warning "WebSocket auth disabled — 8081 accepts any LAN client" names 8081
  whatever the port.
- `interface/vite.config.ts` says the service worker is active on the iPad. The production worker
  is a 608-byte stub that unregisters itself.
- `DeviceLoadComponent.py` describes a "12.3.7 capability gate" in `__init__` that doesn't exist.
- `LoopingSurface.py` logs `unsupported-root` for a load the component answers `not-in-browser`.
- `deviceMoveService.ts` and `WahPedalComponent.py` still mention `Expression Pedal.adg`, which
  nothing loads.
- Two `constants.json` notes are wrong. The Wah is "moved to chain position 0", but it's placed
  there, never moved. `pinnedFirst` claims to order sorted lists, but nothing reads it.
- The shot tour's layout check fails on the System view (`npm run shot:tour -- central --only
  system`): the Transport label sits 18 px from the top where the rule wants 16, and one divider
  is 2 px off.

## 11. Settings: a full-page view from the master track

**Asked for by Ben, 2026-09-26. Built the same day on the `places` branch.** A tap on the master
strip opens the System view in the central panel. Before the split it was one row: Transport,
then Behavior, then Appearance over Foot Switch, then Sections. Now it is Transport (with a gear
in its corner), Follow Key, and Sections (`SystemCentralView.svelte`; `npm run shot:tour --
central --only system` photographs it), and the gear opens `settings/SettingsPage.svelte`, a
full-page view mounted by `+page.svelte` and opened through `settingsStore`
(`npm run shot:tour -- settings` photographs its three states). Behavior (Auto-Arm, Auto Rec, the
Move Knob while `features.maxUtilityPatch` is on), Appearance and Foot Switch moved there on their
old addresses; Places, Features (each on, off or unavailable with the bridge's reason) and
Connection (Live's surface and the handshake, the protocol, the address to open on the iPad) are
new. The first-run mode reads the store's `firstRun`, which the Places work sets from the Mac.

**The split** (decided with Ben on 2026-09-26, "for now"):
- **The master track's central view, the System view, keeps what you play with:** Transport
  (tempo, time signature, launch quantization and the Click), Follow Key, and all of Sections
  (Header, Solo, Inst, Clips, View, Pads, FX, Flip). A small gear icon in its corner opens
  Settings.
- **Settings is a full-page modal for setup:**
  - Behavior: Auto-Arm, Auto Rec, and the Move Knob (owner-only, with the Max patch)
  - Appearance: the theme
  - Foot Switch: on/off and Learn
  - New with onboarding: the Places list; the features, each on, off, or unavailable and why;
    and the connection (the bridge, Live's surface, the address to open on the iPad)
- **Settings doubles as onboarding.** On a first run the same modal opens by itself as the
  checklist in [onboarding.plan.md](onboarding.plan.md) §7. After that, the gear opens it.

**How:**
- Build on the existing dialog component (`interface/src/lib/components/ui/dialog`), with a
  lucide gear icon.
- Every address and echo stays as it is: the cards move, the wire doesn't.
- `SystemCentralView`'s tests follow the cards, and the shot tour gains `settings` states beside
  `system`.
- The View switch can hide the central view, and the gear with it. A tap on the master strip
  already brings the view back ([toggles.md](../../reference/toggles.md)), so Settings stays two taps away.
- UI only: an iPad rebuild, and no Live restart.

**Polished 2026-09-26 (Ben, on the `settings-polish` branch):** Settings became a sidebar of
General, Places and Connection (Setup first on a first run), Places grouped with the ticked first
and the Packs folded, and the address to open on the iPad read from the Mac's own network
(`/api/network`) instead of the page's `localhost`. The System view lost VIEW, PADS, FLIP and INST
(all four now always on), keeps Header · FX · Clips · Solo, and its gear moved to the view's
top-right corner.

**Size:** M. It doesn't wait on the Live-index measurement, so it can come first.
