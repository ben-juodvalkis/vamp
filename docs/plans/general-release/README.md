# Vamp: The General Release

Start here. Everything about releasing Looping to the public, as **Vamp**, is in this folder.

## The goal

One codebase, two editions:

- **The general edition:** stock Ableton Live 12.4 Suite on a Mac, played from an iPad, with no
  third-party plug-ins and no special hardware.
- **The owner's rig:** the same code with every owner-only subsystem switched on.

"Looping" stays the internal name for the wire namespace, folders and files
([naming.md](naming.md)).

## Where we are

Checked against `main` at `dd4a89e` on 2026-09-27, with the config layering (plan.md §3).
[plan.md](plan.md) has the detail.

| Area | State |
|---|---|
| Dead code and devices | **Done** 2026-09-23 (audit §2, "Dead") |
| Owner-only subsystems | **5 of 7 behind switches:** `totalmix`, `maxUtilityPatch` (with the Move folded in), `expressionPedal`, `menubar` and `axHelper` (Reverse, Group, Save As and the held pad's similar samples go with it). Still to come: `captureRecorder`, `pluginFx` |
| Anyone's hardware | **Done.** The foot switch is a setting with Learn, in Settings since 2026-09-26. The on-screen wheels drive `MidiWheels.amxd`, with no standalone Max |
| The browser | **Done.** On Live's Places since 2026-09-24. Since 2026-09-26: any Place, the User Library or a Pack, ticked in Settings; the catalog built on the Mac while it runs from Live's index (`catalog.source`; the disk scan is the fallback), served at runtime and refreshed within seconds. Loads name their Place (protocol 3.11.0), and machine values reach clients over `/bridge/machine`. Every rig check in [onboarding.plan.md](onboarding.plan.md) §10 passed |
| A fresh clone | **Starts** (2026-09-27). `npm run setup` installs, links the surface into Live as Vamp and runs the setup check, which guides instead of failing. Measured from a clone whose owner paths point nowhere: it finishes with two warnings, both the owner's preset folders. Open: the owner's config (§3) and the capture fallback folder (§4) (plan.md §2) |
| Config | **Layered** (2026-09-27). The tracked file is the general edition's defaults, every switch off; a Mac's own values go in its gitignored `constants.local.json`, which the bridge, the server, the scripts and the surface lay over it. The rig's local file reproduces its old config exactly. The build compiles only the shared defaults; clients get a Mac's values over `/bridge/machine` (plan.md §3) |
| Starter content | Nothing ships yet (plan.md §6) |
| Network | **Done:** inbound UDP binds loopback, and the file routes answer only for library files. **Open:** the LAN trust model (plan.md §7) |
| Publishing | The Extensions SDK is out of the tree, but still in the history. Live lists the surface as Vamp since 2026-09-27. The public repo, license, docs and the other renames are open (plan.md §8) |
| Rig checks outstanding | The Move's TotalMix monitor knobs; foot-switch Learn with the USB pedal (plan.md §9) |

## How it's being solved

1. **Feature switches for owner-only subsystems** (`config/constants.json` → `features`). Off:
   hidden. On but not answering: greyed out, with the reason. What each switch does today is in
   [toggles.md](../../reference/toggles.md) ("Feature switches").
2. **Settings, not switches, for anyone's gear.** The foot switch is learned in the System view.
3. **The build holds code only.** Everything about the user's machine and choices comes from the
   Mac while it runs, the way Live's state and the feature switches already do, so nothing a
   user sets needs a rebuild. *(Agreed 2026-09-26.)*
4. **Lean on Live's own records:** its preferences for which Places exist, its index for what's
   in them, its browser for loading. *(Agreed 2026-09-26, and measured the same day: Live's
   index covers everything the browser shows, about ten times faster than our own scan.)*
5. **One app.** Onboarding is a first-run page of the same web app, opened on the Mac first.
   Afterward the same settings live in **Settings**, a full-page view opened from a gear in the
   master track's central view.

## What's next, in order

Live's index was measured on the Mac on 2026-09-26 ([live-index-measurements.md](live-index-measurements.md)).
Four follow-up tests need Ben at the Mac, because they change the library
(onboarding.plan.md §5). Nothing below waits on them.

1. **Settings** (plan.md §11): **done 2026-09-26.** The master track's view keeps Transport,
   Follow Key and Sections; a gear opens the full-page Settings with the setup cards, the
   features, the Places, and the connection.
2. **The browser and onboarding core:** any Place, anywhere, ticked in Settings; a catalog
   built from Live's index and served at runtime; loads that name the Place. **Done
   2026-09-26, the first-run checklist and the rig checks in onboarding.plan.md §10 included.**
3. **A fresh clone that starts:** one install command, and a setup check that guides instead of
   failing (plan.md §2). **Done 2026-09-27**, but for the capture fallback folder, which moves
   with the `captureRecorder` switch.
4. **The remaining switches,** with visible reasons wherever something can't run (plan.md §4–§5).
5. **Starter content:** stock tiles insert Live's own device (plan.md §6). The Simpler needs no
   preset since 2026-09-27.
6. **Security:** the trust model, plus two small fixes (plan.md §7).
7. **Publish:** the fresh public repo, license, docs and renames, then the clean-machine test and
   the demo (plan.md §8–§9).

## Decisions

**Made:**
- **2026-09-23:** delete the dead weight (Komplete Kontrol kept), and delete the Live
  extensions.
- **2026-09-25:** the public name is Vamp. The Max Utility patch is owner-only, with the Move
  folded in. The on-screen wheels move to `MidiWheels.amxd`.
- **2026-09-26:** the expression pedal is owner-only (no stock Wah rebuild), the foot switch is a
  setting with Learn, and Permute's engine always runs.
- **2026-09-26:** the menubar app is owner-only, like TotalMix.
- **2026-09-27:** the AX helper is owner-only too: a stranger gets no Reverse, Group, iPad Save
  As or held-pad similar samples, and runs one process fewer.
- **2026-09-26:** the browser takes any Place, anywhere. Places are picked with checkboxes,
  whatever folder or drive each lives on. A Place added later appears unticked, and the rig is
  seeded from today's folder so it doesn't change.
- **2026-09-26:** the build holds code only, onboarding lives in the same app, and we lean on
  Live's own records. Measured the same day: the browser's catalog comes from Live's index,
  with today's disk scan as the fallback.
- **2026-09-26:** a full-page Settings, opened from a gear in the master track's view, takes
  Auto-Arm, Auto Rec, the Move Knob, Appearance and the Foot Switch. Transport, Follow Key and
  Sections stay in the view, for now (plan.md §11).
- **2026-09-26:** a new user starts with the User Library and every Pack ticked. On the rig
  nothing changes: its seven Places stay ticked, and the User Library and Packs stay off
  (onboarding.plan.md §2, §10).

- **2026-09-27:** the config is layered by a merge inside each loader: the tracked file is the
  general defaults, and each Mac's gitignored `constants.local.json` holds its differences
  (plan.md §3).
- **2026-09-27:** `vamp` is the living repo from the cutover on, not a snapshot. `Looping` is
  frozen as it stands, as the history; `vamp` starts fresh, leaner and reorganized (plan.md §8,
  "The `vamp` repo").

**Open, for Ben:**
- The trust model on shared Wi-Fi (plan.md §7).
- Which plug-in tiles a stranger sees, and whether stock tiles insert Live's device when no
  preset exists (plan.md §4, §6).
- The `vamp` repo: its layout, whether the owner's parts ship in it, when to cut over, and
  whether the `@claude` workflows go (plan.md §7–§8).
- Ownership of the third-party Max files and the Skaka rack (plan.md §8).
- A USPTO search, and a domain ([naming.md](naming.md)).

## The documents

| Document | What it is |
|---|---|
| [plan.md](plan.md) | Everything that remains, checked against the code, with sizes |
| [onboarding.plan.md](onboarding.plan.md) | The browser and onboarding design: the runtime rule, Places anywhere, Live's records, staying fast |
| [live-index-measurements.md](live-index-measurements.md) | What Live's index holds and how fast it reads, measured on the Mac on 2026-09-26 |
| [audit.md](audit.md) | The 2026-09-23 audit: the inventory and analysis behind the plan. Code and config cite its sections ("general-release audit §7b"), so its numbering stays |
| [naming.md](naming.md) | The public name, domains, and what to rename when |
| [demo-recording.plan.md](demo-recording.plan.md) | The demo gallery (not started) |
| [../browser-places.plan.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/browser-places.plan.md) | The Places browser (done 2026-09-24). Its Phase 0 measured what Live reports about Places |
| [../toggles.md](../../reference/toggles.md) | What each feature switch does today |
