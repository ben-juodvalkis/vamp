# Live's index as the browser's catalog: measurements

**2026-09-26 · Live 12.4.15b4 (build 2026-09-17_a0ac16f342) · `Live-files-12300.db`, 1,957,376,000 bytes**

Read-only, on the rig, with Live not running. It answers
[onboarding.plan.md](onboarding.plan.md) §5, except the parts that change the library
(listed at the end). The database was opened with `sqlite3 -readonly` or `node:sqlite`
`readOnly: true`, never `immutable=1`. A read-only open touches the `-shm` sidecar, as
`similarSamples.ts` notes; the database file's own mtime stayed 2026-09-25 23:23:52.

Every query below runs as:

```sh
DB="$HOME/Library/Application Support/Ableton/Live Database/Live-files-12300.db"
sqlite3 -readonly -header -column "$DB" "<query>"
```

## 1. The index: tables and columns

`version` reads `12300 | 2` (schema, platform). Twenty tables (`.schema`):

| Table | Rows | What it holds |
|---|--:|---|
| `files` | 658,045 | The tree. `file_id, parent_id, name, file_type` (a fourcc: `adg `, `adv `, `aupr`, `amp ` for `.amxd`, `alc `, `wav `, `aiff`, `fldr`…), `subtype, file_kind, mod_date, file_size, aggr_id, colors, md_version, scanner_version, use_count, place_id, flags, device_type, device_arch, device_id, edit_source, edit_date, fe_version` |
| `ancestors` | 7,550,360 | Every (file, ancestor) pair, indexed both ways, so "everything under X" is one query |
| `places` | 109 | Live's own list of roots: `file_id, folder_kind, level, name` |
| `metadata` / `metadata_values` | 1,784,767 / 14,969 | `file_id, key, value_id` → `value`. The key is a fourcc: tags (`CKey`, `Keyw`, `IKey`, `UKey`, `HKey`), device facts (`DvId`, `DvTy`, `DvVP`…), pack info, audio file tags |
| `devices` / `file_devices` | 2,131 / 2,121,019 | Device identifiers, and which files use each |
| `keywords` | 1,037,805 | `file_id, keyw_id, is_auto` |
| `fe_values`, `fe_values_record` | 518,883, 1 | Similar-sounds vectors (ADR-440) |
| `vfolders`, `vfolder_patterns` | 94, 838 | Live's virtual browser folders |
| `search_aggregation*` (FTS4, 6 tables) | 658,045 | Browser search |

Four roots (`SELECT file_id, name FROM files WHERE parent_id = 0`): `/` (1, the
filesystem), `<packs>` (9085), `<plugins>` (113), `<keywords>` (19326).

`places.folder_kind`: 0 = Pack (82, Core Library included), 1 = User Library, 2 = Place
outside the User Library (9), 12 = Place inside it (12), 8 = Core Library devices
(`App-Resources/Builtin`), 10 = `<plugins>`, 4 = Current Project, 5 = two `Presets`
folders.

## 2. Live's Places

The newest `Library.cfg` by mtime is `Live 12.4.15b4/Library.cfg`, parsed with
`interface/src/lib/server/libraryCfg.ts` (`libraryPlaces`, `liveLibraryRoots`). 21 Places,
in sidebar order. `UL` = `/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library`.

| # | Place | Path |
|--:|---|---|
| 1 | Instruments | `UL/Looping Presets/Instruments` |
| 2 | Audio Samples | `UL/Looping Presets/Audio Samples` |
| 3 | Simpler-Record | `/Users/Shared/DevWork/GitHub/Simpler-Record` |
| 4 | Samples Organized | `/Users/Shared/Music/Samples Organized` |
| 5 | CURRENT PROJECTS | `/Users/Shared/Music/Google Drive/Documents/CURRENT PROJECTS` |
| 6 | Desktop | `/Users/Music/Desktop` |
| 7 | Effect Patches | `UL/Looping Presets/Effect Patches` |
| 8 | Expansions | `/Users/Shared/Music/Soundbanks/Native Instruments/Expansions` |
| 9 | Looping Presets | `UL/Looping Presets` |
| 10 | Movement | `/Users/Shared/DevWork/GitHub/movement/device` |
| 11 | Permute | `/Users/Shared/DevWork/GitHub/Looping/ableton/M4L devices/Permute` |
| 12 | Ben Multisamples | `/Users/Shared/Music/Soundbanks/Ben Multisamples` |
| 13 | M4L devices | `/Users/Shared/DevWork/GitHub/Looping/ableton/M4L devices` |
| 14 | ------------- | `UL/Looping Presets/devices` |
| 15–21 | Drum, Perc, Bass, FX, Inst, Key, Synth | `UL/Looping Presets/Instruments/Sidebar/<name>` |

- **User Library:** `UL`.
- **Packs folder:** `/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs`.
- **Installed packs:** 81 `LibrarySliceInfo` entries.

The index's `places` table lists the same 21 Places (9 of kind 2, 12 of kind 12), the User
Library and 82 Packs: the 81 under the Packs folder plus Core Library inside the app.

## 3. Coverage

- **Index side:** for each root, the descendants of its folder through `ancestors`,
  counted by extension:
  ```sql
  SELECT f.name, f.file_type FROM ancestors a JOIN files f ON f.file_id = a.file_id
  WHERE a.ancestor_id = (SELECT file_id FROM places WHERE name = 'Drum' AND folder_kind = 12);
  ```
- **Disk side:** the walk rules of `scripts/generate-places-catalog.ts`. It skips dotfiles,
  `Icon\r` and `Ableton Folder Info`, and follows links; links are counted apart.
- **Audio** is `.wav .aif .aiff .mp3 .flac .m4a .ogg`, as in the catalog.

**Result:** for real files, the index and the disk agree kind for kind in every root, all
21 Places, the User Library and all 82 Packs. The table shows the index's counts, which
equal the disk's except where marked ⚠.

| Root | .adg | .adv | .aupreset | .amxd | .alc | audio | links on disk (not indexed) |
|---|--:|--:|--:|--:|--:|--:|--:|
| Instruments | 4,239 | 454 | 39,834 | 0 | 909 | 52,599 | 190 |
| Audio Samples | 0 | 0 | 0 | 0 | 1 | 549 | 53,148 |
| Simpler-Record | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| Samples Organized | 0 | 0 | 1 | 0 | 211 | 86,361 | 23,460 |
| CURRENT PROJECTS | 302 | 0 | 0 | 93 | 0 | 2,316 | 0 |
| Desktop | 3 | 0 | 0 | 2 | 0 | 1,235 | 0 |
| Effect Patches | 9 | 31 | 5 | 1 | 0 | 0 | 0 |
| Expansions | 0 | 0 | 0 | 0 | 0 | 94,721 | 0 |
| Looping Presets | 4,251 | 487 | 78,105 | 1 | 910 | 53,148 | 53,338 |
| Movement | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| Permute | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| Ben Multisamples | 233 | 171 | 0 | 0 | 0 | 228,801 | 0 |
| M4L devices | 0 | 0 | 0 | 12 | 0 | 0 | 0 |
| ------------- | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| Drum | 2,078 | 0 | 3,208 | 0 | 111 | 9,163 | 0 |
| Perc | 392 | 366 | 0 | 0 | 0 | 1,923 | 0 |
| Bass | 0 | 0 | 2,470 | 0 | 74 | 2,145 | 0 |
| FX | 222 | 0 | 4,714 | 0 | 0 | 12,747 | 0 |
| Inst | 1,015 | 24 | 6,015 | 0 | 353 | 22,190 | 190 |
| Key | 15 | 8 | 4,970 | 0 | 0 | 1,315 | 0 |
| Synth | 306 | 56 | 18,457 | 0 | 371 | 3,116 | 0 |
| **User Library** | 4,755 | 609 | 78,510 | 150 | 911 | 56,092 | 53,340 |
| Core Library devices (`App-Resources/Builtin`) ⚠ | 0 | 0 | 0 | 22 | 0 | 438 | 0 |
| **All 82 Packs** ⚠ | 6,708 | 5,181 | 0 | 420 | 4,662 | 43,287 | 0 |

What only one side has:

- **Links: disk only.** The index lists no symlinks, as Live's browser shows none (ADR-440).
  The User Library has 53,340 linked files: 53,148 in the old Audio Samples folder (e.g.
  `Audio Samples/Bass/Amplified Funk/Bass[100] D HamBone 1.wav`) and the 190 accapella
  clip links in Inst. Samples Organized has
  23,460.
- **Devices inside `Ableton Folder Info`: index only.** 40 `.amxd` in 11 Packs (CV Tools 10,
  Creative Extensions 8, Inspired by Nature 7…), e.g.
  `CV Tools/CV Instruments/CV Instrument/Ableton Folder Info/CV Instrument.amxd`, and 20 in
  Core Library's devices, e.g. `Devices/MIDI Effects/Note Echo/Ableton Folder Info/Note Echo.amxd`.
  Today's scan skips those folders on purpose.
- **Names with a slash.** In 38 Samples Organized files the name matches only once `/` is
  read as `:`. The index stores `Loops/Sampled Loops/Vocal/B 12/8 Choir hit.aif` where the
  disk has `B 12:8 Choir hit.aif`, and `(3/4)` for `Hicks' Farewell (F#) (3:4).alc`. They
  are the same 38 files on both sides.
- **Stale rows: index only.** The index still holds the Core Library of the Suite app
  (`/Applications/Ableton Live 12 Suite.app/…/Core Library`), which is not a current Place.
  It lies outside every root in `places`.
- **`<packs>`** holds 93 pack records with no children. 80 match an installed pack folder
  by name. 13 don't (e.g. `Beatseeker by Andrew Robertson`, `Kapture by Plastikman and
  Liine`): packs Live knows that aren't installed here. The files of installed packs sit in
  the filesystem tree, under the Packs folder.

## 4. Tags

Tag values are `Group|Value[|Sub]` strings. Eleven groups, counted across all files:

```sql
SELECT substr(mv.value, 1, instr(mv.value, '|') - 1) AS grp, count(DISTINCT m.file_id) AS files
FROM metadata m JOIN metadata_values mv ON mv.id = m.value_id
WHERE instr(mv.value, '|') > 0 AND mv.value NOT LIKE 'AUv2::%' GROUP BY grp ORDER BY files DESC;
```

| Group | Files | .adg/.adv presets |
|---|--:|--:|
| Type | 488,731 | 2,424 |
| Drums | 317,703 | 2,649 |
| Sounds | 171,919 | 6,886 |
| Character | 14,136 | 5,821 |
| Devices | 4,105 | 3,331 |
| Clips | 3,495 | 0 |
| Genres | 3,454 | 247 |
| Key | 2,738 | 0 |
| Creator | 1,010 | 0 (plug-ins) |
| Grooves | 478 | 0 |
| Tunings | 302 | 0 |

The preset counts in this table include the stale Suite Core Library. The source table
below excludes it.

**Presets with at least one tag:** 12,672 of 21,220 `.adg`/`.adv` presets. By source
(`places` joined through `ancestors`):

| Source | Presets | Tagged |
|---|--:|--:|
| The 81 installed Packs | 8,631 | 6,504 |
| Core Library (Beta app) | 3,258 | 3,084 |
| Suite app's Core Library (stale, not a Place) | 3,258 | 3,084 |
| User Library, and every Place in it (Drum 2,078, Inst 1,039, Perc 758…) | 5,364 | **0** |
| Ben Multisamples, CURRENT PROJECTS, Desktop | 709 | **0** |

**Role-like tags exist,** on Pack and Core Library presets only. Presets per second-level
tag, subtypes folded in (`Sounds|Bass` includes `Sounds|Bass|Synth Bass`):

| Tag | Presets | Tag | Presets |
|---|--:|---|--:|
| Sounds\|Ambience & FX | 903 | Drums\|Drum Kit | 640 |
| Sounds\|Bass | 873 | Drums\|Percussion | 601 |
| Sounds\|Piano & Keys | 859 | Drums\|Cymbal | 350 |
| Sounds\|Pad | 731 | Drums\|Tom | 271 |
| Sounds\|Lead | 655 | Drums\|Hihat | 251 |
| Sounds\|Mallets | 386 | Drums\|Snare | 232 |

`Drums|Kick` exists (91 presets as a tag of its own, 37,893 files counting samples). The
query that counts these by second-level tag is
`/tmp/live-index-probe/role-tags.sql` on the rig. It is the table's query with `WHERE
f.file_type IN (1633969965, 1633973805)` (`adg `, `adv `) and an ancestor in `places`.

## 5. Plug-ins

`<plugins>` holds three folders (`AUv2`, `VST`, `VST3`) and 1,010 plug-in rows
(`file_type` `plug`): 362 AUv2, 324 VST and 324 VST3.

- **Each row** carries `device_type` (1 instrument, 2 effect), `device_arch` (4 AU, 8 VST,
  16 VST3) and `device_id`. For an AU the id is its component triple as decimal fourccs:
  `device:au:instr:<manufacturer>:<subtype>:<type>`.
- **Metadata:** `DvTy` (Instrument), `DvVP` (`AUv2::Spectrasonics`) and `Keyw`
  (`Creator|Spectrasonics`).

**It says which are installed, through `flags`.** Checked against the AU codes in every
installed component's `Info.plist` (253 AU codes from the 235 components in
`/Library/…/Components` and `~/Library/…/Components`):

| AUv2 rows | Count | Component on disk |
|---|--:|---|
| `flags = 3` | 251 | yes |
| `flags = 3` | 26 | no: all `AUv2::Apple`, system AUs outside the plug-ins folders |
| `flags = 19` (bit 16 set) | 85 | no, none of them |

VST and VST3 rows carry `flags` 3, 19 and 531 too, but weren't checked against disk.

**Presets name their plug-in.** Each `.aupreset` row carries the same `device_id` as its
plug-in's row: 78,501 of 78,513, with 12 having none. All 78,501 point at a `flags = 3`
row whose component is installed. That replaces today's 8 KB read of each `.aupreset` and
the `Info.plist` scan.

```sql
SELECT p.device_id, p.flags FROM files p JOIN ancestors a ON a.file_id = p.file_id
WHERE a.ancestor_id = 19323 AND p.file_type = 1886156135;            -- AUv2 plug-ins
SELECT name, device_id FROM files WHERE file_type = 1635086450;       -- .aupreset
```

`Live-plugins-1.db` (258 KB, 2026-09-16) is the plug-in scanner's cache: `plugin_modules`
(974 plug-in files, with `path`, `scanstate`, `fingerprint`), `plugin_domains` (974, with
`enabled`) and `plugins` (854, with `dev_identifier`, `name`, `vendor`, `version`,
`scanstate`). It is a WAL database whose `-shm`/`-wal` Live removes on quit. `sqlite3
-readonly` refuses it without them; `node:sqlite` `readOnly: true` opens it and creates the
two empty helpers itself. Both were measured on a copy in `/tmp`, so Live's folder wasn't
touched. The files index answered the question without it.

## 6. Speed

**Listing every row under the roots** (id, parent, name, type), warm OS cache. The coverage
pass had just read these pages; a cold read after a reboot wasn't measured.

| Roots | Rows | node:sqlite, rows + tree by parent (3 runs) | sqlite3 CLI (2 runs) |
|---|--:|---|---|
| One large Place: Ben Multisamples | 232,494 | 251–260 ms | 0.22 s |
| The seven Sidebar Places | 101,704 | 103–105 ms | 0.10 s |
| All 82 Packs (Core Library included) | 67,135 | 73–76 ms | 0.06–0.07 s |

```sql
SELECT f.file_id, f.parent_id, f.name, f.file_type FROM ancestors a JOIN files f ON f.file_id = a.file_id
WHERE a.ancestor_id IN (SELECT file_id FROM places
  WHERE folder_kind = 12 AND level = 3 AND name IN ('Drum','Perc','Bass','FX','Inst','Key','Synth'));
-- one Place:  WHERE folder_kind = 2 AND name = 'Ben Multisamples'
-- all Packs:  WHERE folder_kind = 0
```

**Today's disk scan** of the seven Sidebar Places, same machine, load 2.2:

- `FORCE=1 npm run generate-places`: **10.5 s**. The catalog took 6.5 s; all 53,606
  thumbnails came from the peaks cache and none were decoded.
- The warm run right after: **1.1 s**. The inputs were unchanged (fingerprint 639 ms).

The documented cold build with no caches is ~26 s; it wasn't re-measured here.

## 7. Freshness (read-only evidence only)

| File | Last written |
|---|---|
| `Live-files-12300.db` | 2026-09-25 23:23:52 |
| `Live 12.4.15b4/Library.cfg` | 2026-09-25 23:23:51 |
| `Live 12.4.15b4/Preferences.cfg` | 2026-09-25 23:23:51 |
| Live's `Log.txt`: `Begin OnQuit` | 23:23:51.268 |
| Live's `Log.txt`: `GlobalExit(): End` | 23:23:52.644 |

All three files were last written during the same quit. The newest `mod_date` the index
records is 2026-09-25 15:55:13 (`SELECT datetime(max(mod_date), 'unixepoch', 'localtime')
FROM files`).

None of this says whether Live writes `Library.cfg` when a Place is added, or how soon the
indexer lists a newly saved preset. Both need a change to the library (below).

## Recommendation

**Use Live's index as the catalog's source, and keep the disk scan as the fallback.**

- **Coverage** is exact for everything Live's browser shows.
- **Speed:** listing everything takes 0.1 s for the rig's seven Places and 0.07 s for all
  Packs, against 10.5 s forced and 1.1 s warm for today's scan.
- **Plug-ins:** the index already knows each preset's plug-in and whether it's installed.

Keep the disk scan for when the database is missing, `version` isn't 12300, or a column
we read is gone.

Rules the index needs:

1. **Roots come from `Library.cfg`** (or `places`), never from the whole tree: the tree
   still holds the Suite app's Core Library.
2. **Links don't appear,** in Live's browser or in the index. On the rig that is the old
   Audio Samples folder and 23,460 files in Samples Organized. In the seven Sidebar Places it
   is the 190 acapella clip links in Inst (§3's table), which today's browser shows and loads
   through their targets. They get rebuilt as real clips first (onboarding.plan.md §10).
3. **Map `/` in index names back to `:`** when building a path the surface loads.
4. **Devices in `Ableton Folder Info`** are Live's device bundles. Show them as the device
   and hide the folder.

**Roles:** Live's tags give roles to Pack and Core Library presets (`Sounds|Bass` 873,
`Sounds|Pad` 731, `Drums|Drum Kit` 640…). The rig's own presets carry none, so roles for
user Places keep coming from their names. Packs can start in the list on day one, with
roles from tags.

### Tests that still need Ben at the Mac (they change the library)

1. **Save a preset into a Place with Live running.** Poll read-only for its row
   (`SELECT file_id FROM files WHERE name = '<file>'`): how many seconds until the index
   lists it, and whether `-wal` grows while Live runs.
2. **Add a Place in Live.** Does `Library.cfg`'s mtime change at once or only on quit, and
   does `places` gain it mid-session?
3. **Load an item from a Pack** through the surface by path (plan §5.5).
4. **Remove or disable a VST plug-in and rescan.** Does bit 16 of `flags` flip, as it does
   for AU?
