# Vamp Without a Clone: the Installer Plan

**Written 2026-10-31**, at Ben's request ("what would it look like to just distribute an
installer … rather than having people clone the repo"). A plan: nothing here is built yet.
Everything in §2 was read from the code on `main` at `5012d1c`.

## 1. What a new user would do

Today ([INSTALLATION.md](../../../INSTALLATION.md)):

1. Install Node 22.13+, then `git clone`, then `npm run setup` (links the Live control surface).
2. In Live: pick **Vamp** as a Control Surface, restart Live, add `Vamp Devices` as a Place.
3. `npm run dev` or `npm run ipad` in a Terminal, kept open.
4. Open the address in Safari on the iPad, add it to the Home Screen, pair with the code in Live's
   status bar. Vamp for iPad over the cable needs Xcode and a signing team.

With the installer:

1. **Download `Vamp.dmg`** from the site, drag **Vamp** to Applications, open it.
2. Vamp puts its pieces in place itself, and its menu (and Settings on the Mac) is a checklist:
   in Live, pick **Vamp** as a Control Surface and restart Live; add the **Vamp Devices** folder
   it shows as a Place. Both tick themselves when done.
3. **Get Vamp for iPad from the App Store**, plug the iPad in, type the code the Mac shows in its
   menu bar (ADR-494). Or open the address in Safari, as now.

No Node, no git, no Terminal. Updates arrive by themselves. The two Live steps stay manual
(§5): nothing outside Live may change its control surfaces or Places while it runs.

## 2. What runs today, and what it assumes

| Piece | What it is | What it assumes about the repo |
|---|---|---|
| **The page server** | SvelteKit, served by `vite preview` on :8889 (`npm run ipad`) | The custom adapter `vamp-preview` writes nothing (`interface/svelte.config.js`): the build runs inside the checkout's `node_modules`, **465 MB** of development packages. `vite.config.ts` passes `/bridge-socket` upgrades to the bridge (ADR-488) |
| **The bridge** | Node, `interface/bridge/`, on 8081/8890 | `config/` beside it (`utils/constants.js`: `CONFIG_DIR` is `../../../config`), `config/.ws-secret` (`utils/wsSecret.js`), `logs/` at the repo root (`utils/logger.js`, `handlers/liveSaveAs.js`) |
| **Their supervision** | `scripts/setup-ipad.js` under `concurrently`, itself run by Vamp for Mac (ADR-490) | `npm`, a login shell's `PATH`, the checkout as working directory |
| **Server state** | `interface/src/lib/server/runtimeConfig.ts: repoRoot()` and 7 callers | Writes into the checkout: `logs/places.json`, `logs/grooves.json`, `scripts/.cache/` (catalogs, thumbnails, kind cache), `config/.paired-devices.json`. Reads `scripts/open-live.js` and `Vamp Devices/` from it |
| **Child processes** | the thumbnail bake and the category build (`scripts/bake-thumbnails.ts`, `scripts/scan-categories.ts`) | Run as TypeScript through `node_modules/tsx`, from the checkout |
| **The Live control surface** | Python, `surface/` (47 MB, 31 MB of it the test venv) | `npm run setup` symlinks it into `<User Library>/Remote Scripts/Vamp` (`surface/install.sh`, which finds the User Library from Live's `Library.cfg`). It then finds everything else by walking up from its real path: `config_loader.py` (`config/constants.json`), `SessionSettingsComponent.py` and `FootSwitchComponent.py` (`logs/`), `components/live_library.py` (`Vamp Devices/`) |
| **Vamp Devices** | The app's utility devices (the effects left it on 2026-11-01, ADR-498) | A Live Place named exactly "Vamp Devices" pointing at the checkout's folder |
| **Vamp for Mac** | the menu-bar app (ADR-490/494) | The `repoRoot` default `install-mac-app.sh` records; it rebuilds itself from the checkout when its code changes |
| **Vamp for iPad** | the native shell (ADR-488/494) | Nothing about the Mac's files: it only needs Vamp for Mac at the other end of the cable |

Already done for the general edition: owner-only subsystems sit behind `features` switches, off
by default (README, "Where we are"); the build holds code only and machine values arrive at
runtime; the config is layered (`constants.json` + `constants.local.json`); the notarized Mac
lane (`fastlane mac notarized`, hardened runtime) and the TestFlight/App Store lanes exist,
never run.

## 3. The options

1. **Vamp for Mac becomes the installer (recommended).** One notarized `Vamp.dmg`: the app
   carries a Node runtime, the built page server and bridge, the control surface and
   `Vamp Devices`, sets them in place on first launch, and updates itself with Sparkle (the
   standard Mac updater, EdDSA-signed). The app that supervises Vamp already exists; it gains
   the files it supervises.
2. **A `.pkg` installer** (`productbuild`) that copies the same files and runs a post-install
   script. Simpler to make, but no self-update (each release is a new download), an installer
   that needs an admin password, and the same §4 work underneath.
3. **Homebrew or `npx vamp`.** Least work, but the user installs Node and opens Terminal: for
   developers only. Worth keeping as the second path (the clone stays for development anyway).

**Not possible: the Mac App Store.** The app must write into Live's User Library (the control
surface), open usbmuxd's socket (the cable) and run Node: none of which the App Sandbox allows.
Vamp for Mac ships from the site, signed with Developer ID and notarized, as most audio tools do.

## 4. The work, in order

Each phase leaves the rig working: the checkout keeps running exactly as now (§6).

### Phase 1: one data folder (the bulk of it)

Everything Vamp **writes** moves to one folder, `VAMP_DATA` — `~/Library/Application
Support/Vamp` when installed, the checkout's own `config/` + `logs/` + `scripts/.cache/` when run
from a clone (so nothing moves on the rig):

| Writer | Today | After |
|---|---|---|
| Interface server | `repoRoot()` + 7 callers | `dataDir()` beside `repoRoot()` in `runtimeConfig.ts`; `repoRoot()` kept for code the bundle carries (`Vamp Devices/`, `scripts/open-live.js`), renamed `appRoot()` |
| Bridge | `CONFIG_DIR`, `wsSecret.js`, `logger.js`, `liveSaveAs.js`, `bridgeProfiler.js` | the same `VAMP_DATA`, passed by environment from whoever starts it |
| Control surface | walks up from its real path | reads one file the installer writes beside it, `Remote Scripts/Vamp/vamp-paths.json` (`{data, devices}`), and walks up only when it is absent (the rig's symlink) |
| Vamp for Mac | `VampLog`, `repoRoot` default | the same two folders, from the app bundle when there is no `repoRoot` |
| Config | `config/constants.json` + local | defaults inside the app; the user's `constants.local.json` in `VAMP_DATA` |

**Done when** a test run with `VAMP_DATA` pointing at an empty folder writes nothing into the
checkout (`git status` clean) and the rig, with no variable set, writes where it does today.
**Size:** 2–3 days. Most of it is the 15 or so call sites and their tests; the surface half
needs a Live restart to check.

### Phase 2: a server that stands alone

- **Build with `@sveltejs/adapter-node`** instead of the no-op adapter, so the page server is a
  plain Node program (`build/index.js`) with its own small dependency set, not `vite preview`.
- **One entry, `vamp-server`**, starts the bridge and the page server in one process with their
  restart rule, replacing `concurrently` for the installed app (the clone keeps
  `npm run dev` / `ipad`). The `/bridge-socket` pass-through moves from `vite.config.ts` into it.
- **The two child scripts become built JavaScript** (`bake-thumbnails`, `scan-categories`), run
  with the same Node, no `tsx`.
- **Bundle and prune:** esbuild the bridge and the server entry; ship only runtime dependencies.
  Measure the result (the target is tens of MB, not 465).

**Done when** `node vamp-server.js` from a folder holding only the build serves the iPad page,
drives Live and passes the gate's page-load check. **Size:** 2 days.

### Phase 3: Node inside the app

- Ship the official Node 22 LTS binaries inside `Vamp.app/Contents/Resources/`, **both arm64 and
  x86_64** (Ben, 2026-10-31: Intel Macs are supported), joined into one universal binary with
  `lipo` as Vamp for Mac itself is: ~200 MB uncompressed, ~80 MB in the dmg.
- Sign the Node binary with the hardened runtime and the one entitlement V8 needs
  (`com.apple.security.cs.allow-jit`); add its license to `THIRD-PARTY-NOTICES.md`.
- Vamp for Mac's `Supervisor` runs `vamp-server` with that Node when installed, and
  `npm run ipad` from the checkout when it has a `repoRoot` (the rig, and anyone developing).

**Size:** 1 day, plus the notarization round trips.

### Phase 4: first launch sets up, updates keep it current

- **The control surface:** copy the bundle's `surface/` (without its venv and tests) to
  `<User Library>/Remote Scripts/Vamp`, the User Library found from Live's `Library.cfg` as
  `surface/install.sh` finds it (ported to Swift), with `vamp-paths.json` beside it. A
  symlink there (the rig's) is left alone.
- **Vamp Devices, optional (Ben, 2026-10-31):** the install ships a folder of utility devices —
  Permute, MidiWheels, the recorder ([capture.plan.md](capture.plan.md)), random-start and the
  groove. The effect tiles' devices are not part of the package (ADR-498, 2026-11-01): a tile
  loads its file by name from the user's effects folder (Settings → Places), and is refused with
  a banner when the file is not there. **The user picks where it goes (Ben, 2026-11-01):**
  first launch offers `~/Music/Vamp/Vamp Devices` or a folder inside their User Library, and
  copies it there; the app remembers the choice, so an update refreshes the devices in the same
  place. Either way the folder is added to Live's Places by the user. Vamp works
  without it: **adding it to Live's Places is what turns those features on**, and while it is
  not a Place they are not shown. The server already knows whether the Place exists (the
  listing's `m4lDevices`), and the bridge's feature switches already turn controls off with a
  reason; the devices become a feature of their own.

  | Device | While the Place is missing |
  |---|---|
  | Permute | New tracks get none; the Permute view and the strip's step rows are not shown |
  | MidiWheels | The on-screen wheels are not shown |
  | The recorder | REC is not shown |
  | random-start | A Simpler loads without the Random knob, silently |
  | Vamp Groove | The groove chooser offers the Core Library's grooves only |

  Hidden in the performance views, but not hidden from the person: Settings → Places says
  "Add the Vamp Devices folder to Live's Places to turn on Permute, the wheels and Capture",
  and ticks itself when it is there. **To check in Live:** whether a Place added while Live
  runs reaches the surface at once, or only after a restart (the rig's notes say fixing a Place
  needed one). If it needs the restart, the instructions order it: add the folder, pick the
  control surface, restart Live once.
- **The checklist** becomes Vamp for Mac's too: the menu says what is left (control surface
  picked, Place added, iPad paired), from the same signals `firstRunSteps.ts` reads, and opens
  Settings on the Mac for the rest.
- **Updates with Sparkle 2:** an appcast on the site, EdDSA-signed. An update that changes the
  surface copies it again and says "restart Live to finish updating" in the menu (Live loads a
  control surface once). The fingerprint self-rebuild (ADR-490) stays for a checkout only.
- **A QR code for Safari** (Ben, 2026-10-31: yes): the menu shows the iPad's address as a QR
  code, so an iPad without Vamp for iPad opens the page by pointing its camera at the Mac.
  Core Image's `CIQRCodeGenerator`, no dependency.
- **Uninstall:** a menu item that removes the copied surface and asks before deleting
  `VAMP_DATA`; then the app goes to the Trash as usual.

**Size:** 2 days.

### Phase 5: signing and the dmg

- `fastlane mac notarized` grows into `fastlane mac release`: build, sign the app and everything
  inside it (Node, any native module), notarize, staple, wrap in a dmg with an Applications
  link, sign the appcast entry, upload.
- **First run of the lane needs Ben:** the Developer ID certificate in the keychain and the
  App Store Connect key (`ASC_KEY_*`), as the iPad lanes already need.

**Size:** 1 day, mostly waiting on Apple.

### Phase 6: Vamp for iPad on the App Store

- `fastlane ios beta` to TestFlight first, for Ben and any testers.
- App Review: the app does nothing without a Mac running Vamp, so the review notes need the demo
  video (`AppStore/vamp-review-demo.mp4`, made for this) and a sentence on the pairing code.
- The listing says what the Mac needs and links to the dmg.

**Size:** a day of work, plus Apple's review.

### Phase 7: the docs

The README and INSTALLATION.md split into two paths: **download** (the dmg, the App Store, the
two Live steps) and **develop** (the clone, as now). The README's "there's no app to install" goes.

## 5. What stays manual, and why

- **Picking Vamp as a Control Surface** and **restarting Live.** Live keeps its control surfaces
  in its preferences and reads them at startup; writing them from outside, or while it runs,
  would race Live's own writes. The checklist explains it and ticks itself on the handshake.
- **Adding the Vamp Devices Place.** Measured 2026-09-26: Live rewrites `Library.cfg` itself
  when a Place is added, at once, while it runs (`liveLibrary.ts`). Editing that file from
  outside would race it the same way. The checklist ticks itself when the Place appears. The
  step is optional (Phase 4: without it, Vamp runs with those features hidden). It stays
  wherever the user puts the folder, the User Library included (Ben, 2026-11-01).
- **Not the recorder on Return A:** that step goes with [capture.plan.md](capture.plan.md).

## 6. The rig is not touched

- A checkout keeps running as now: `npm run dev`, `npm run ipad`, Vamp for Mac from the Dock with
  its `repoRoot`, the surface's symlink, data in the repo. Every phase's "done when" includes
  the rig's own start.
- The installed app never overwrites a symlinked surface or a `Vamp Devices` Place that points
  into a checkout, and says so in its checklist.
- Owner-only subsystems stay behind their switches, off in the general edition (`features`).

## 7. Testing it

- **A clean macOS user account** on a second Mac, or a separate account on this one, with Live
  12.4 Suite installed and nothing else: no Node, no Xcode, no Homebrew. (Not Docker: macOS
  apps do not run in it, and it is not to run on this Mac.)
- The run: download the dmg, open it, follow the checklist, play a loop from the iPad; then
  install an update and check the surface follows; then uninstall and check nothing is left
  but what the user chose to keep.
- The gate gains a step that builds the standalone server (Phase 2) and loads its page, so a
  change that breaks the bundle fails before a release.

## 8. Open questions for Ben

1. ~~Intel Macs?~~ **Yes** (Ben, 2026-10-31): the app and its Node are universal (Phase 3).
2. ~~Where should `Vamp Devices` live?~~ **The user chooses** (Ben, 2026-11-01): their own
   folder (`~/Music/Vamp/`, the default) or the User Library; they add it as a Place either way.
3. ~~Price and terms?~~ **Free** (Ben, 2026-11-01), for Vamp for Mac and Vamp for iPad.
4. ~~Update channel?~~ **One stable feed** (Ben, 2026-11-01); testers use TestFlight for the iPad.
5. ~~A QR code of the Safari address in the menu?~~ **Yes** (Ben, 2026-10-31; Phase 4).

## 9. Order and size

| Phase | Size | Needs Ben |
|---|---|---|
| 1 One data folder | 2–3 days | a Live restart to check the surface half |
| 2 Standalone server | 2 days | no |
| 3 Node in the app | 1 day | no |
| 4 First launch and updates | 2 days | a Live restart; the site for the appcast |
| 5 Signing and the dmg | 1 day + Apple | the Developer ID certificate, the API key |
| 6 Vamp for iPad on the App Store | 1 day + review | App Store Connect; the listing |
| 7 Docs | half a day | no |

About two working weeks, Phases 1–3 first: each is useful on its own (a clean data folder; a
lean server the rig can run too) and none needs Apple.

## 10. Where it stands (2026-11-01, branch `installer`)

- **Phase 1, done** (ADR-499): the three folders, `VAMP_APP_ROOT` / `VAMP_DATA` /
  `VAMP_DEVICES` for the bridge and the server, `vamp-paths.json` for a copied surface,
  `VampPaths` in Vamp for Mac. The surface's `data/device-configs.json` joined them in Phase 4.
- **Phase 2, done:** `npm run build:server` → `dist/vamp/`, 19.5 MB, with
  `THIRD-PARTY-LICENSES.md` for what the bundles take in. Run isolated on shifted ports: page,
  host check, socket pass-through, child scripts, places list all answered.
- **Phase 3, done:** the supervisor runs the app's Node on `vamp-server.mjs` when installed;
  `scripts/package-mac-app.sh` assembles `dist/Vamp.app` (243 MB unpacked: Node v22.23.4 is
  217 MB of it), app and Node both arm64 + x86_64, Node signed with the hardened runtime and
  V8's two entitlements (ad-hoc until Phase 5). The app's own Node ran the app's own server on
  both chips (x86_64 under Rosetta), on shifted ports: page, places list, socket to the bridge
  in `ipad` mode, clean stop. Opened from Finder in a separate macOS account, it worked (Ben,
  2026-11-01).
- **Phase 4, done** (ADR-500): first launch asks where Vamp Devices goes and copies it,
  copies the surface with `vamp-paths.json`, says what Live still needs; a menu checklist that
  ticks itself; REC, the wheels and Permute hidden while Vamp Devices is not a Place; QR code;
  Uninstall; Sparkle (prebuilt and pinned, `scripts/fetch-sparkle.sh`), the feed the latest
  GitHub release's `appcast.xml`. Not yet done: the Live check, whether a Place added while
  Live runs reaches the surface at once.
- **Phase 5, done:** `scripts/release-mac.sh` → `dist/Vamp-1.0.dmg` (96 MB), Developer ID,
  notarized by Apple (accepted), stapled, Gatekeeper "Notarized Developer ID"; and
  `dist/appcast.xml`, EdDSA-signed. Sparkle's key is a file in
  `~/Library/Application Support/Vamp Release/` (back it up). Not yet published: the GitHub
  release `v1.0` with both files is Ben's call.
- **Phase 6:** Vamp for iPad is submitted to the App Store (Ben, 2026-11-01).
- **Phase 7, done:** README and INSTALLATION open with the download
  (`releases/latest/download/Vamp.dmg`, a name every release carries beside `Vamp-<version>.dmg`)
  and keep the clone as "From the code". The link works once the `v1.0` release is published.
