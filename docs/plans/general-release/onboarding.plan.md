# The Browser and Onboarding: Plan

**Goal:** a stranger ticks any of their Places, wherever each one lives, and the iPad's browser
follows what they tick and what changes in Live, with no rebuild and no config file to edit.

**Status:** proposed 2026-09-26, and the direction agreed with Ben the same day. Live's index was
measured on the Mac the same day, and it can be the catalog's source (§5). **Being built on the
`places` branch since the same day:** all of §6 and the diff of §10 are in (see §6 and §10 for
what each did); what remains is §10's rig checks.
**Owner:** Ben.

**Related:**
- [README.md](README.md): the release this is part of.
- [plan.md](plan.md) §1–§3: the evidence for §1 below, the fresh-clone run, and config.
- [../browser-places.plan.md](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/browser-places.plan.md): the Places browser (done 2026-09-24).
  Its Phase 0 measured what Live reports about Places.

---

## 1. Why

The Places browser works on the rig because every Place it shows lives in one folder inside the
User Library. For anyone else:

- **The list.** Only Places inside `paths.sidebarRoot` appear. The root exists to keep Desktop,
  Downloads and the dev repos off the rail, which checkboxes do better.
- **Loading.** The surface resolves a preset only under `paths.userLibraryBase` or a Place typed
  into `paths.placesRoots` as a name and an absolute path. Anything else fails `not-in-browser`.
  Samples and clips escape this, because they load by file path.
- **The build.** On the iPad the catalog is the copy made at build time, and five client files
  compile machine values in (§3).
- **Freshness.** The catalog is built when the server starts, and the surface builds its lookup
  once per Live session. A Place added mid-session needs a server restart to appear and a Live
  restart to load.

## 2. Decided (2026-09-26)

1. **Any Place, anywhere.** Onboarding reads Live's preferences for every Place and shows a
   checkbox for each, whatever folder or drive it lives on: its name and icon as Live shows
   them, with the folder underneath in small type.
2. **What starts ticked.** For a new user, the User Library and every Pack (the Core Library
   included) start ticked, so the browser shows Live's own content from the first launch.
   Every other Place starts unticked, and so does a Place added later, since most people's
   Places include Desktop and Downloads.
   **On the rig, nothing changes** (Ben, 2026-09-26). On a Mac with nothing saved and a
   `sidebarRoot` set, exactly the Places inside it are ticked, and the User Library and the
   Packs are not: Ben browses no Packs. The foot switch seeds its CC the same way. §10 lists
   what has to hold.
3. **The build holds code only** (§3).
4. **One app.** Onboarding is a first-run page of the same web app, opened on the Mac first.
   Afterward the same settings live in **Settings**, a full-page view opened from a gear in the
   master track's central view ([plan.md](plan.md) §11).
5. **Lean on Live's own records** (§4). The measurement (§5) says Live's index can be the
   catalog's source, with today's disk scan as the fallback.

## 3. The runtime rule

**The build holds code only. Everything about the user's machine and choices comes from the Mac
while it runs.**

Most of the app already works this way. Live's state, the feature switches (`/bridge/features`),
the session toggles and the foot-switch setting all arrive over the connection, which is why
switching editions needs no iPad rebuild. What the iPad build still bakes in:

| Baked in | Where |
|---|---|
| The browser's catalog | Was `interface/static/data/places/`, a build input. **Since 2026-09-26** the interface server builds it at runtime and serves `/api/places/*` (§6, row 1) |
| Machine values in client code | Were `useTrackDevice.svelte.ts` and `trackColoring.ts` (`paths.instrumentsBase`), `devicePresets.ts` (`paths.effectPresetsBase`, `paths.placesRoots.Permute`), `totalmixScale.ts` (the TotalMix range). **Since 2026-09-26** they arrive over `/bridge/machine` (`machineStore`); `vendors` stays compiled, being the role palette, the same on every machine |
| Config in server routes | Were `sampleRoots.ts` and the `similar-samples` and `sample-peaks` routes, compiled into the server build. **Since 2026-09-26** they read the file when they run (`$lib/server/runtimeConfig.ts`) |
| The whole config file | Was copied by `scripts/copy-constants.js` into `static/config/`, where any browser on the LAN could read it. **Gone 2026-09-26** |

The other compiled-in values (gesture timing, meter opacity, rack macro ranges, pattern labels)
are the same on every machine and can stay.

What the rule buys:
- A tick on the iPad takes effect in seconds, and so does a Place added in Live.
- No setting needs a rebuild, so the System view is never stale.
- The UI build needs only the tracked defaults, which narrows the config question
  ([plan.md](plan.md) §3).
- The UI can ship prebuilt. A stranger skips the build (52 s measured), which is also the step
  the example config breaks today.

## 4. Live's three records

| Question | Live's record | How we'd read it | Notes |
|---|---|---|---|
| Which Places exist, with their names, icons and order | Its preferences, `Library.cfg` | `interface/src/lib/server/libraryCfg.ts` already parses it | The scripting interface's `browser.user_folders` omits every Place inside the User Library (4 of the rig's 14 in Phase 0), so it can't supply the list. The index's own `places` table lists every Place, but not in the sidebar's order |
| What's in them | Its index, `Live-files-<schema>.db` | Read-only SQLite on the Mac, as similar sounds already does (`interface/src/routes/api/similar-samples/`) | A tree of every file Live's browser shows, with roots for the filesystem, `<packs>`, `<plugins>` and `<keywords>`, Live's tags, and an `ancestors` table that makes "everything under this folder" one query. About 2 GB on the rig. **Measured (§5):** it matches the disk kind for kind in every Place, the User Library and all 82 Packs, and lists the rig's seven Places in about 0.1 s. It lists no symlinks, as Live's browser shows none (ADR-440) |
| Loading | Its browser | The surface descends `browser.user_folders[Place]` or `browser.user_library` by path | Walking a whole root costs Live's thread about a second (the User Library's 87,628 entries, Phase 0), so walks stay limited to loads |

What reading the index gives (measured, §5):
- No disk scan of our own, and nothing on Live's thread.
- **Packs and the Core Library** as more checkboxes in the same list, so a stranger's browser
  isn't empty on day one. Their presets carry Live's own tags (`Sounds|Bass` on 873,
  `Sounds|Pad` on 731, `Drums|Drum Kit` on 640…), which give them roles.
- **Roles for the user's own Places keep coming from their names.** None of the rig's 5,364
  presets in its User Library carries a tag.
- **Plug-in presets name their plug-in,** and the index knows whether it's installed. That
  replaces reading 8 KB of every `.aupreset`.
- A browser that stays current: when the indexer writes, the Mac re-reads it and the iPad
  refreshes. How soon Live writes is one of the tests left (§5).
- A list of exactly what Live indexed, and so of what it can load.

**The catch:** the index is Live's private format. Its file name carries a schema number, and
the rig already holds Live 11 files named differently from Live 12's. Similar sounds already
depends on it, but the browser must not go blank after a Live update. **Today's disk scan stays
as the fallback** whenever the database is missing, its `version` isn't `12300`, or a column we
read is gone.

**Rules for reading it** (from the measurement):
1. **Take the roots from Live's preferences** (or the index's `places`), never the whole tree.
   The tree still holds the Core Library of another Live app on the rig, which isn't a Place.
2. **Links don't appear,** in Live's browser or its index. On the rig that includes the 190
   acapella clips in the Inst Place, which today's browser shows and loads through their
   targets, as well as the old Audio Samples folder and part of Samples Organized. The 190 were
   removed from Inst (§10).
3. **A `/` in an index name is a `:` on disk.** Map it back when building a path the surface
   loads.
4. **Devices inside `Ableton Folder Info`** are Live's device bundles: show the device and hide
   the folder.

What stays ours: the ticks, the touch layout (depth caps, flattening, roles, the Samples split),
greying a plug-in preset whose plug-in is missing, and Recent.

## 5. Measured

**Done 2026-09-26** on the rig, read-only, by a Claude session on the Mac (Live 12.4.15b4, with
Live not running). The numbers and the queries are in
[live-index-measurements.md](live-index-measurements.md). In short:

1. **Coverage is exact.** For real files the index and the disk agree kind for kind in all 21 of
   the rig's Places, the User Library and all 82 Packs, the Core Library included. Only links
   are missing, as they are from Live's browser.
2. **Tags.** Pack and Core Library presets carry Live's role-like tags (`Sounds|Bass`,
   `Sounds|Pad`, `Drums|Drum Kit`…). The rig's own presets carry none.
3. **Speed.** Listing everything under the seven Sidebar Places takes about 0.1 s, a
   232,000-file Place 0.25 s, and all 82 Packs 0.07 s. Today's scan of the seven Places takes
   10.5 s forced and 1.1 s when nothing changed. These were read with a warm disk cache; a
   first read after a reboot wasn't measured.
4. **Plug-ins.** The index says which plug-ins are installed (checked for AU), and every
   plug-in preset names its plug-in.

**Recommendation:** Live's index as the catalog's source, with the disk scan as the fallback. It
matches the direction agreed on 2026-09-26.

**Still to test, with Ben at the Mac,** because each one changes the library:
1. Save a preset into a Place with Live running. How many seconds until the index lists it, and
   which file changes: the database or its `-wal`?
2. Add a Place in Live. Does `Library.cfg` change at once or only when Live quits, and does the
   index's `places` gain it mid-session? If neither, the surface reports new Places itself.
   **Answered on the home Mac, 2026-09-26** (Live 12.4.15b1, Ben adding seven Places while Live
   ran): `Library.cfg` was rewritten at once, and the index's `places` table listed the seven,
   with all 235 of their files, within the minute. The service polls both.
3. Load an item from a Pack through the surface by path.
4. Remove or disable a VST plug-in and rescan. Does its installed flag flip, as it does for AU?

The core work (§6) can start without these. They decide how freshness (§6, item 4) is watched.

## 6. The work, after §5

| # | What | Size |
|---|---|---|
| 1 | **Build the catalog from Live's index** (§4's rules, the disk scan as the fallback), and serve it at runtime from the Mac, so it is no longer a build input. **Done 2026-09-26:** `interface/src/lib/server/places/` (`service.ts`, `indexScan.ts`, `diskScan.ts`) serves `/api/places/index.json`, `<id>.json` and `<id>-samples.json` in the shapes the browser already read; `catalog.source` picks the reader, `disk` by default until §10's rig checks pass; the catalog left the iPad build and `npm run dev` | M |
| 2 | **The Places list.** The Mac reads Live's preferences and publishes every Place with its tick, and any client can tick one. The ticks are saved on the Mac, as the foot switch is. A tick catalogs that Place, and clients refetch. **Done 2026-09-26:** `/api/places/list` and `PUT /api/places/ticks`, `logs/places.json`, the Places card in Settings with a checkbox per sidebar Place, the User Library and each Pack | M |
| 3 | **Loads name the Place:** "this Place, this path inside it". `paths.placesRoots` and the Permute and M4L-devices paths leave config, and one "Vamp Devices" Place covers both Permute and MidiWheels. A wire change: a protocol bump and a Live restart. **Done 2026-09-26, protocol 3.11.0:** `prepare_for_preset` and `device/load` take optional `source` (`place:<name>` / `library` / `pack:<name>`) and `rel` args; the surface reads every Place, the User Library and the Packs from Live's own `Library.cfg` (`components/live_library.py`, `BrowserCache.lookup_named`), so a path-only load resolves anywhere too; Permute and MidiWheels are found in the checkout the surface runs from and loaded through the "Vamp Devices" Place. The three config keys are gone (an older config's are honored). **Needs a Live restart** | M |
| 4 | **Freshness.** Watch the index (or the folders) and Live's preferences, and refresh. The surface retries a missed lookup once, and looks again for a Place that was missing at first use. **Done 2026-09-26:** on the Mac, a 2 s poll of `Library.cfg`, the index's `-wal` and the ticks file rebuilds the ticked Places (index builds on any index write; disk builds on a tick, a `Library.cfg` change, a change at the Place's top level or `POST /api/places/rebuild`) and pushes a version over `/api/places/events`; the page re-reads the rail and the open level, keeping every button's folder position and adapter. On the surface, a miss walks the root once more, no more often than every 10 s (`REBUILD_COOLDOWN_S`), so a file Live has listed since loads, and a Place absent at first use is found on its next | S–M |
| 5 | **Machine values over the wire.** The five client files get theirs from the Mac, the server routes read config when they run, and the whole-config copy into `static/` goes. **Done 2026-09-26:** `/bridge/machine` (paths and the TotalMix range, beside `/bridge/features`), `machineStore.svelte.ts`, `{effectPresetsBase}` templates in `devicePresets.ts` resolved at send time, `runtimeConfig.ts` for the three server modules, `copy-constants.js` deleted | S |
| 6 | **Onboarding and Settings** (§7; [plan.md](plan.md) §11): the Places, and the features with why any is unavailable. **Done 2026-09-26** (plan.md §11): Settings, the Places card, the Features card, and the first-run checklist (§7, `FirstRunCard.svelte`), which Settings opens by itself while the Mac has saved no ticks (`/api/places/list` says `firstRun`) and whose Done saves the ticks as they stand | M |

About M–L in all, with one Live restart.

## 7. Onboarding, step by step

`npm run dev` already opens the Mac's browser. On a first run it opens Settings in its
first-run mode ([plan.md](plan.md) §11), and each step ticks itself when the app sees it done:

1. **Live has Vamp as a Control Surface.** The surface's handshake proves it.
2. **The "Vamp Devices" folder is a Place in Live.** Permute and the on-screen wheels load from
   it.
3. **Pick your Places,** with the checkboxes (§2).
4. **A foot switch, if you have one:** Learn, as the Foot Switch card already does.
5. **What's on:** the feature list, with the reason anything is unavailable.

Then the page gives the address to open on the iPad. The steps only the Mac can do (installing,
Live's settings, adding a Place in Live, granting Accessibility) are explained there. None of
them means typing into a config file.

**Built 2026-09-26** as `FirstRunCard.svelte`, across the top of Settings while
`/api/places/list` says `firstRun`: step 1 reads the handshake, step 2 the listing's
`m4lDevices` (the Place of this checkout's `Vamp Devices`, or a Place that holds it),
step 3 the ticks, step 4 the foot switch (optional), step 5 points at the Features card, and the
last step is the page's own address. **Done** saves the ticks as they stand, which ends the first
run. `npm run shot:tour -- settings` photographs it (`settings-first-run`).

## 10. Nothing changes for the rig

The disk scan stays `catalog.source`'s default until these pass on the rig. Each is a check for a
later session there; nothing here was run on the rig yet.

- [x] **The diff on the home Mac** (2026-09-26): `npm run places:diff` over the seven sample
      Places (235 files copied from the rig's Sidebar): 0 differences, index 3 ms against disk
      15 ms with a warm kind cache. The plug-in patch names the index lacks are read from the
      file once and kept in the shared kind cache.
- [x] **The baseline on the rig, before flipping anything** (2026-09-26): with `logs/places.json`
      absent the seven Sidebar Places are ticked by the seed and nothing else is (21 Places, 81
      Packs and the User Library off); the server answers `index.json` 5 s after start. The same
      absent file opens the first-run checklist over the interface, which `main` does not.
- [x] **The diff on the rig** (2026-09-26): 10,113 differences at first, 0 after three fixes
      (a flattened duplicate kept in the disk's order, accented names in the disk's spelling, a
      plug-in preset Live's indexer could not parse read from the file), but for Inst's 190
      acapella links. Index 1.2 s against disk 1.8 s for the seven Places' 90,816 items.
- [x] **The acapella links** (Ben, 2026-09-26): removed from Inst rather than rebuilt. The 190
      links (98 Live 8/9 XML clips, 92 in the old binary format) went to the Trash with a list of
      each link and its target; the originals stay in Samples Organized. `places:diff` over the
      seven Places is then identical: index 1.4 s against disk 3.3 s.
- [x] **Flip `catalog.source` to `index`** (2026-09-26): the first index build read all seven
      Places from the index in 1.4 s, none falling back to the disk, every thumbnail reused. An
      index write that changes nothing in a ticked Place (a WAV saved to the Desktop) still
      rebuilds them, ~1.8 s of the server's thread, but keeps the served catalogs: no version bump,
      the same ETags, no thumbnail pass.
- [x] **A load through the surface on the home Mac** (2026-09-26, Live 12.4.15b1 restarted on
      protocol 3.11.0): the real page against the real bridge and Live, a tap on Drum → Ableton →
      32 Pad Kit Jazz sent `prepare_for_preset` with `place:Drum` and `Ableton/32 Pad Kit Jazz.adg`,
      the surface built `user_folders['Drum']` (44 entries) and the kit landed on track 2 with the
      role `drum` recorded. Permute followed it: this Mac has no "Vamp Devices" Place, so the named
      lookup missed and the path resolved through the `ableton` Place, as designed.
- [x] **Loads from every Place through the surface on the rig** (2026-09-26, a scratch set): one
      preset from each of the seven, each sent with `place:<Place>` and its path, each landed on
      the prepped track. Every named lookup missed ("Place 'Drum' not found in
      browser.user_folders"; the seven sit inside the User Library, while "Vamp Devices", outside
      it, was found) and resolved by path through the User Library, as loads did before 3.11.0.

## 8. Open questions

- **A huge Place,** such as a whole sample drive, is slow to catalog the first time. Show how
  many files it holds before it's ticked?
- **Two Places with the same name:** the catalog numbers them, but the surface looks a Place up
  by name.
- **No index yet** (Live never opened, or still indexing): the disk scan answers.
- **What the iPad shows while the Mac rescans** a Place.

## 9. Staying fast

The browser must feel no slower than today's, and nothing in it may cost Live's own thread.

- **The iPad keeps what it reads.** Today it fetches the list of Places once and each Place's
  catalog the first time it's opened, then browses folders from memory (`placesAdapter.ts`).
  That stays: the Mac hands it the same kind of ready-made list. What's new is who writes the
  list, and that the Mac says when a Place's list changed, so the iPad refetches only that Place.
- **The iPad's cache is warmed, its memory is not.** After the rail appears the page fetches every
  ticked Place's files in idle time and drops the bodies (`warmPlacesCache`), so a first open, or a
  switch back to a Place, is a 304 and a parse rather than a transfer mid-set. The browser holds the
  last three Places' trees (`keepRecent`), so a return to one draws with no request, and reads a
  Place's file from Safari's copy before asking the Mac, which it then does in the background: a
  100,000-item library costs three Places' memory rather than the whole library's (2026-09-26).
- **Nothing in browsing reaches Live's thread.** The Mac reads Live's index as a file, as similar
  sounds already does. The surface works only on a load, and once its lookup table is built a
  load's lookup is a single step.
- **The Mac reads only what changed.** It re-reads the index when Live's indexer has written, and
  only for ticked Places, then keeps the result. Until a new list is ready, the iPad keeps
  showing the last one.
- **Measured** (§5): listing the rig's seven Places from Live's index takes about 0.1 s, against
  10.5 s for today's forced scan and 1.1 s when nothing changed. That was with a warm disk
  cache; a first read after a reboot is still to measure.
- **Targets,** each measured before and after with `scripts/perf/`:
  - opening a folder the iPad has already loaded: no network wait, as today
  - a Place's first open: no slower than today
  - a newly ticked Place, or a preset Live has just indexed, on the iPad within a few seconds,
    without blocking anything
  - the server's start: no slower than today's warm start

## 10. The rig must not change

Ben's browser has to look and behave exactly as it does today (Ben, 2026-09-26). Build the
index-based catalog side by side with today's, and switch over only once they match, as the
Places browser did (its UI ran behind a switch before its cutover).

- **A baseline first, on the rig:** today's catalog files for the seven Sidebar Places, a
  screenshot of the rail and of each Place, and a few loads per Place, noting what lands in
  Live.
- **The same catalog from the index,** item for item: the same buttons in the same order, the
  same names, roles and colors, the same kinds under Instrument | Simpler | Clip, the same
  plug-in greying, the Samples split, and the folder rules (depth caps, flatten, keep-nesting).
  Diff the two programmatically. Switch over at zero differences, or with each remaining one
  explained to Ben first.
- **The 190 acapella links in Inst are gone** (Ben, 2026-09-26): Live's index lists no links, so
  an index-only catalog would have dropped them, and they were removed from the Place instead of
  rebuilt. The originals stay in Samples Organized.
- **The same loads:** the baseline items land in Live as they did.
- **Config:** the rig's `constants.json` keeps working. `sidebarRoot` seeds the ticks once, and
  nothing is edited by hand.
