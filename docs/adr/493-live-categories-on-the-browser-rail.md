# ADR-493: Live's Categories on the Browser Rail

## Status
**Accepted** (2026-10-31). The browser half is interface only. The surface
half (presets filed under a device) needs a Live restart.

## Context
The rail had a button per ticked Place, the User Library or a Pack. Ben
asked for Live's own sidebar categories too: Sounds, Drums, Audio Effects,
Clips and the rest.

Measured on the rig (Live 12.4.25b1) through the surface's probes:

- `Live.Application.browser` exposes nine categories: `sounds`, `drums`,
  `instruments`, `audio_effects`, `midi_effects`, `max_for_live`,
  `plugins`, `clips` and `samples`. Modulators, Grooves, Tunings and
  Templates are in Live's sidebar but not on the API.
- Every item in a category carries its index row in its `uri`
  (`query:Sounds#Bass:FileId_129811`). A category is a query over the
  same database the Places catalog already reads (`Live-files-12300.db`),
  over the Packs (Core Library included) and the User Library with the
  Places inside it. A Place outside the User Library is left out. The
  `.alc` files under those roots are exactly the 5,257 Live's Clips lists.
- **Sounds is folder names.** `vfolders` names Sounds' 23 sub-folders
  (group 1) and `vfolder_patterns` the folder names that fall in each. A
  preset is in Sounds › Bass when the folder it sits in is one of Bass's
  ten patterns ("Bass", "Basses", "Synth Bass"…). That rule reproduces
  Sounds › Bass item for item, 973 of 973. Live 12's newer tags
  (`Sounds|Bass`) gave 1,739 and are not what this list uses.
- Drum Hits (group 3) works the same way. Our Kick has 1,937 items
  against Live's 1,599, with all of Live's included. The extra items are
  328 samples in User Library folders named "Kicks", which is one of
  Kick's own patterns but which Live's list passes over, plus 10 in Packs.
- Instruments and the effects list each device with its presets, but
  Live's list hid most Pack presets by a rule not found. Analog showed 398
  of 809 candidates, every one a User Library copy. Drums showed 1 of 568
  Pack kits.
- Walking a category through the API runs on Live's thread. The Places
  walk of `user_folders` once wedged the transport, and Samples is about
  600,000 files.

## Decision
- **Categories are built from Live's index, never through Live's
  thread** (`interface/src/lib/server/places/categoryScan.ts`):
  - **Sounds** and **Drums › Drum Hits** follow Live's folder-name rule.
  - **Drums › Kits** is every Drum Rack preset.
  - **Instruments**, **Audio Effects** and **MIDI Effects** group every
    preset under its own device (`files.device_id`, Live's name for the
    class).
  - **Max for Live** groups `.amxd` files by type.
  - **Clips** splits audio clips from MIDI clips.
  - Under each sub-folder come the root (the Pack, or User Library) and
    then the item's folders inside it. The depth cap rolls those up, and
    a root that is the only one collapses away.
- **Left out:** Samples (no list a finger can use) and Plug-ins (a
  plug-in is no file a load can name; its presets are in Sounds when
  their folder says so).
- **A category is a tickable source** like a Place (`SourceKind`
  `category`, key `category:<name>`, empty path). Settings → Places lists
  the categories in a group of their own, and a ticked one is a rail
  button after the Places. Drums colors as the drum role; the other
  categories record none.
- **It is built from the index even on a Mac whose Places come from the
  disk.** One read of the index serves every category: 116,000 rows,
  about 4 s cold, most of it the first read of plug-in preset files,
  which the shared kind cache then holds. It rebuilds only when a stamp
  over the roots moves: the count, newest id, newest write and total size
  of the files under them, 82 ms to compute. The stamp is looked at most
  every 30 s, so a take recorded into a project, which lands outside the
  roots, never rebuilds anything.
- **Each item names its own root.** `source` is `library` or
  `pack:<name>`, with `placePath` set to that root, so a load names its
  root and the path inside it (protocol 3.11.0). The category's index
  entry carries no `source` of its own, so the browser keeps each item's.
  Lookups that find a Place by folder (Recent's role, the swap pill) skip
  a source with no path.
- **The surface walks into a device** (`BrowserCache._walk`). Live lists
  a device's presets as its children (`is_device`). Before this, the walk
  stopped at any loadable item, so a preset filed under its device never
  loaded by path: Creative Extensions cached 69 entries, and Core
  Library's `Devices/Audio Effects/Echo/Clean Delay/8DotBall.adv` was out
  of reach. Measured after a reload: 296 entries in Creative Extensions.
  `6th Gear Plantation.adv` (Sounds › Bass) loaded onto a new track, and
  `8DotBall.adv` (Audio Effects › Echo) loaded onto that track's chain.

## Addendum: categories first, the Packs as one button (2026-10-31)
Ben asked for the categories above the Places, and for one tick for every
installed Pack in place of one per Pack.

- **Order.** `librarySources` lists the categories, then `Packs`, then the
  Places and the User Library, and the rail follows. The Places take their
  ids first, as before, so a Place named "Drums" keeps `drums` and the
  category is numbered.
- **Packs** (`category:Packs`, `scanPacks`) holds a folder per installed
  Pack (83 on the rig, Core Library included), each holding the Pack's own
  tree as `scanIndexPlace` reads it, nested four deep. Each item names its
  Pack for the load. It is 60,402 items and 30 MB, so each Pack is served
  as a file of its own (`packs~<slug>.json`, `BuiltCatalog.parts`) behind
  an `external` stub that keeps its `kinds`. The button opens on 21 KB,
  and a Pack's file loads when it is tapped (Core Library 3.5 MB). The
  browser already fills an `external` folder wherever it sits.
- **Packs are no longer sources of their own.** Settings has no Packs
  group; the one Packs row sits with the categories.
- **A device's folder is `dfld` in Live's index**, not `fldr`. The index
  scan read only `fldr`, so it dropped every Pack device and the presets
  filed under it: Creative Extensions › Instruments came out empty. The
  scan now reads both (catalog format 7). Measured with Live running: a
  Poli preset (Packs › Creative Extensions), a Big Band Essentials 2 kit
  (Drums › Kits) and Core Library's Echo preset `8DotBall` each loaded
  onto a new track or its chain through the surface.

## Addendum: off the server's thread, opened on demand (2026-10-31)
Review of the above found three costs on the Mac's server, and one worry
on Live's side, which measured fine.

- **The build runs in a child** (`scripts/scan-categories.ts`, low
  priority, spawned as the thumbnail bake is). The server keeps serving the
  catalogs it has and swaps the new ones in when the child lands. Measured
  with Sounds, Drums and Packs ticked: `/api/places/list` answered in
  0.004–0.15 s through the build and 0.73 s at the swap, against 4–6 s
  blocked before. Tests and tools build inline (`categoriesInline`).
- **Every category is split by top-level folder**, as the Packs are. The
  Drums button opens on 4 KB (14 MB whole), Sounds on 5 KB; Drums › Kick
  is 860 KB and Kits 2.3 MB when tapped.
- **A part's thumbnails bake once it is opened** (`openedParts`,
  `partsBaked`): the Packs' 43,000 samples and Drums' 12,000 are no work
  until someone taps in. Measured: Drums › Kick and › Snare took their
  waveforms within a minute of being opened, while › Clap stayed bare
  until it was.
- **The surface's walk of a big Pack is fast.** Big Band Essentials 2's
  4,337 entries took 33 ms (Log.txt: track created 11:05:08.524, cache
  built .557). That load's 9 s went to Live creating the track, with
  "Audio queue timeout" lines every 3 s while the Mac's screen was locked.

## Consequences
- The rail grows by one button per ticked category, and its bands share
  out the extra. With all eight ticked (the seven and Packs) beside the
  rig's seven Places, Recent makes sixteen buttons.
- Instruments and the effects show more than Live does (all of a Pack's
  presets), and Drum Hits shows more than Live does (the "Kicks" folders
  above). Sounds and Clips match Live.
- Until Live restarts with the new surface, a pick under a device in a
  Pack (most Instruments and Audio Effects items) answers `load-failed`.

## Tags
`browser`, `places`, `live-index`, `browser-cache`
