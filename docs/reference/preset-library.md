# Preset library

How to organize the browser's library so the drill-down browser lists it and
the Python surface can load it.

The library is **the Places in Live's sidebar** under `paths.sidebarRoot`
(Looping's `documentation/browser-places.plan.md`). It replaced the vendor/type tree
(`<instrumentsBase>/<Vendor>/<Type>/…` plus a separate `Audio Samples`
tree) on 2026-09-24; paths from that tree live on in saved Sets and are read
through an alias map (§5).

Companion: [setup.md](setup.md) covers `constants.json` paths;
[extending-devices.md](extending-devices.md) covers adding new device views.

## 1. The Places

Each folder under `paths.sidebarRoot` that Live also lists in its browser
sidebar is a **Place**, and each Place is one button on the browser's rail —
after Recent, in Live's sidebar order, with Live's name. The order and the
list are read from Live's own `Library.cfg`, never from
`browser.user_folders` (which omits every Place inside the User Library).

```
<sidebarRoot>/                       # …/User Library/Looping Presets/Instruments/Sidebar
├── Drum/                            # a Place → rail button "Drum", role drum
│   ├── Kits/Acoustic/Plymouth Kit.adg
│   ├── Synth/Boomers/Boom.aupreset
│   └── Samples/                     # samples and clips (the switch's Simpler | Audio half)
│       └── Kicks/Kick 1.wav
├── Perc/
├── Bass/
├── FX/
├── Inst/
├── Key/
└── Synth/
```

**What a Place lists** — everything the browser can put on a track, each item
with a kind read from the file itself (`interface/src/lib/utils/placeKinds.ts`):

| File | Kind |
| --- | --- |
| `.aupreset` | A plug-in instrument or effect, read from the AU codes in the plist, with its plug-in, maker and whether that plug-in is installed (an uninstalled one is greyed, not hidden). |
| `.adg` / `.adv` | A Drum Rack, Instrument Rack, effect rack, or a single device, from the head of the gzipped XML. |
| `.amxd` | A Max instrument, audio effect or MIDI effect, from its header. |
| `.alc` | An audio clip (it carries a `SampleRef`) or a MIDI clip. |
| `.wav` `.aif` `.aiff` `.mp3` `.flac` `.m4a` `.ogg` | A sample. |

**The switch decides what you see.** The browser's top-bar
`Instrument | Simpler | Clip` switch is what you'll do with a pick — play it,
or let it play. Instrument shows a Place's presets (instruments, kits and
effects); Simpler its samples and audio clips, landing on a fresh Simpler;
Clip those plus its MIDI clips, landing as a clip. A MIDI clip has no audio
for a Simpler, so only Clip lists it. (Internally the modes are still
`midi | simpler | audio`.)
A Place's samples live in its `Samples` folder by convention; the switch opens
that folder directly.

**Presets must be real files.** The surface loads through Live's browser, and
Live's browser ignores symlinks. The Places hold APFS clones of the old tree
(no disk cost until one side changes); the only links left are 190 accapella
`.alc` clips, which the surface loads through their target
(`DeviceLoadComponent.resolve_clip_item`) because a clip's audio is found from
its own folder.

**Roles and colors.** A Place named for a role colors the track a load lands
on and records that role on it (ADR-399, protocol 3.7.0): Drum/Drums,
Bass, FX/Effects, Inst/Instrument(s), Key/Keys/Keyboard(s),
Perc/Percussion, Synth/Synths/Lead(s)/Pad(s). Any other name records
nothing unless `catalog.places.<Name>.role` says otherwise (§3). A sample or
clip is colored audio and records no role.

## 2. The catalog

Since 2026-09-26 the interface server builds the catalog itself, while it runs,
for the Places ticked in Settings (`interface/src/lib/server/places/service.ts`),
and serves it over `/api/places/*`. The ticks are saved in `logs/places.json`;
a Mac with nothing saved starts with the Places under `paths.sidebarRoot`
ticked. `catalog.source` picks the reader: `disk` (the scan below, the
default) or `index` (Live's own index, about a hundred times faster; the
disk scan stands in whenever the index cannot answer). A Place added in Live,
a tick, or an index write reaches every open page within seconds
(`/api/places/events`). `npm run generate-places` warms the cache by hand;
`npm run places:diff` compares the two readers. The disk scan measured
2026-09-24 on the rig: 26 s cold, 9.7 s forced with the per-file kind cache,
90,816 items in seven Places. The three files the browser reads:

- `index.json` — the Places in order, each with its role, icon, per-kind
  counts and catalog file, plus the alias map (§5).
- `<id>.json` — one Place's tree (`<id>` is the Place's name, lowercased,
  punctuation → `-`).
- `<id>-samples.json` — that Place's `Samples` folder, fetched the first time
  it is opened (Inst's samples with their waveform thumbnails are ~24 MB; the
  rest of Inst is 2.7 MB).

Folder and item order is baked alphabetical at generation. Waveform
thumbnails for samples and clips are baked too (ADR-401,
`ui.browser.audioWaveforms`).

## 3. Shaping a Place — `constants.json → catalog`

```json
"catalog": {
  "maxFolderDepth": 2,
  "places": {
    "Bass": { "flattenFolders": ["Bass/Acoustic"] },
    "Perc": { "flattenFolders": ["Perc/NI Expansions", "Perc/NI"] }
  }
}
```

- **`maxFolderDepth`** caps nesting: a folder at the cap (root folders are
  depth 1) absorbs every preset below it, de-duped by name, and the browser
  re-groups the flattened list under headers by origin folder (ADR-403). A
  Place's `Samples` folder is exempt and keeps full nesting.
- **`places.<Name>`** tunes one Place, keyed by its sidebar name:
  `maxFolderDepth` (overrides the global), `flattenFolders` (ADR-408 —
  collapse a branch whatever its depth; paths are `<Place>/<folder>`, and a
  wrong one is a silent no-op, so check the `[FlattenFolder]` lines of the
  generation log), `keepNestingFolders` (ADR-420 — exempt a branch from the
  cap; breadcrumb label chains; wins over a flatten entry), and `role` (the
  track role a load from the Place records; `null` for none).

## 4. Adding presets or a Place

1. Put the files in a Place (a new folder under `<sidebarRoot>` for a new
   Place). Presets anywhere inside it; samples and clips under its `Samples/`.
2. A new Place: add the folder to Live's browser sidebar (**Places → Add
   Folder…**). The rail follows Live's sidebar order, so drag it where you
   want its button.
3. Tick it in Settings (the gear in the System view). The rail follows within
   seconds. A file added to a ticked Place is listed once Live's index has
   it, with the index source; with the disk source, on the next rebuild (a
   tick, a change at the Place's top level, or `POST /api/places/rebuild`).
4. **A file added while Live is running loads after the next set load or a
   Live restart.** The surface walks Live's browser once per surface lifetime
   (`BrowserCache`; Live has no browser-changed signal), and a set load
   rebuilds the surface.

## 5. Paths from before the Places — the alias map

A track records the preset its last load came from (`looping.preset`,
protocol 3.9.0), and Recent keeps paths too. Everything recorded before
2026-09-24 names the old tree. The one-time copy that filled the Sidebar
wrote a manifest of every old path and its new one
(`<sidebarRoot>/.looping-places-manifest.json.gz`, read by
`scripts/placesManifest.ts`), and the catalog turns it into alias rules in
`places/index.json` (`<instrumentsBase>/Omni/Drum/` → `<sidebarRoot>/Drum/`,
plus exact entries for renamed collisions). The swap pill and Recent read
every recorded path through it (`presetPath.aliasPresetPath`), so an old Set's
Omnisphere drum steps through the Drum Place, and an old Recent entry shows
and loads as its copy. Keep the manifest.

## 6. Places outside the User Library (`placesRoots`)

The Sidebar is inside the User Library, which the surface resolves from
`paths.userLibraryBase`. A root **outside** the User Library needs an entry in
`paths.placesRoots`, keyed by the Place's sidebar display name:

```json
"paths": {
  "placesRoots": {
    "Permute": "/Users/Shared/DevWork/GitHub/vamp/Vamp Devices/Permute",
    "Samples Organized": "/Users/Shared/Music/Samples Organized"
  }
}
```

Given an absolute path such as
`/Users/Shared/DevWork/GitHub/vamp/Vamp Devices/Permute/Permute.amxd`,
the surface (`DeviceLoadComponent` → `BrowserCache`):

1. Matches the path's prefix against every root in `paths.placesRoots`
   (longest match wins) → Place display name `"Permute"`.
2. Finds the `browser.user_folders` entry whose `name == "Permute"`.
3. Walks that Place once into a `{segments → BrowserItem}` cache and looks up
   the remaining segments (Live strips `.amxd` / `.adv` / `.adg` / `.alc` from
   display names, shows a `:` in a file name as `/`, and composes accents).
4. Calls `browser.load_item` on the item.

**Permute needs no entry since 2026-09-26.** Its load names its Place
(`place:Vamp Devices` + `Permute/Permute.amxd`, `devicePresets.ts`), and the
surface finds Live's Places in Live's own `Library.cfg`. `placesRoots` is
honored when an older config still carries it. `Samples Organized` is there
for the Sidebar's clip links, whose targets live in it.

To add one, add the row above, then in Live **Places → Add Folder…** on the
same folder, and check the display name matches the key.

Live's User Library itself can live anywhere; the surface's install script
(`surface/install.sh`) finds it by parsing `Library.cfg`. See
[setup.md §5](setup.md#5-install-the-python-control-surface).

## 7. The native tiles use Live's device defaults

Live keeps a per-device *user default* under the User Library —
`Defaults/Audio Effects/<display name>.adv`, `Defaults/MIDI Effects/…` —
and applies it whenever that device is created by name: from Live's own
browser, and from the LOM's `insert_device` (measured 2026-09-10 on
12.4.15b2). Since protocol 3.12.0 (2026-09-28) the 20 FX-grid tiles that
are single native devices (`native: true` in `devicePresets.ts`) name no
preset file: the surface inserts the device **by name** into a drum pad's
chain or onto the track, in one call, with one undo step and no selection
change, and renames it to the tile's name (a Hybrid Reverb becomes
`Reverb`). Each user gets the device as their own default has it, else
Live's factory settings. To change what a tile loads, change the device's
default in Live (right-click its title bar → Save as Default Preset).
Racks, plug-in presets and Max devices are files, and load through the
browser from `paths.effectPresetsBase` or the Vamp Devices Place.

## 8. Troubleshooting

### 8.1 The rail shows only Recent

Nothing is ticked in Settings, or the Mac's server is not answering
`/api/places/index.json`. Open Settings (the gear in the System view) and tick
the Places; `npm run places:diff` and `npm run generate-places` report what the
server would build.

### 8.2 A Place is missing, or in the wrong place on the rail

The rail is Live's sidebar: a folder under the Sidebar that Live does not list
is not a Place (unless `Library.cfg` cannot be read, when every folder under
the Sidebar stands in, A→Z). Add it in Live, or move it in Live's sidebar,
then regenerate. The generator reads the newest `Library.cfg`, which Live
writes when a Place changes.

### 8.3 A preset loads with `load-failed` / `not-in-browser`

Look at `detail` in the `/looping/v3/error` reply:

- **`empty-preset-path`** — the UI sent a blank path.
- **`not-in-browser`** with a `BrowserCache: … not found in … cache` warning
  in Log.txt — Live's browser does not list the file. Either it was added
  after the surface walked the browser (load a set or restart Live, §4), it is
  a symlink (Live's browser ignores those — make it a real file), or a
  `placesRoots` Place is missing from Live's sidebar (§6).
- **an exception class (`RuntimeError`, `AttributeError`, `TypeError`)** —
  Live's `browser.load_item` raised. Usually the file moved or was renamed
  since the catalog was built; the Mac rebuilds it within seconds of the change, so reload the page.

### 8.4 Permute doesn't show up

`Permute.amxd` lives in this repo under `Vamp Devices/Permute/` (the
thin sequencer device, permute ADR-020; the standalone permute repo is
frozen). The surface reaches it through the `Vamp Devices` Place: the repo's
`Vamp Devices/` folder must be a Place in Live's sidebar, under that name.
