# ADR-440: Similar Sounds for Audio Clips

## Status
**Accepted** (2026-09-15; open findings in `documentation/swap-audit.md`).
The minimal form of ADR-439's deferred phase 4, for audio
clips: Live's own similarity index ranks, ADR-439's swap pill steps, and
a new surface verb, `clip/swap_file`, carries out each swap inside Live in one
undo step. Run in Live the same day (Verification). That run found that a swap
could start a stopped transport; the fix, which relaunches only while the
transport runs, was confirmed by hand once a restart had loaded it.

## Context

ADR-439 swaps a Drum Rack's samples by pressing Live's own swap buttons. The
request here was something minimal for audio clips. Everything below was
measured on Live 12.4.15b2 (Beta) and this machine's index, 2026-09-15.

### Live has no swap for a clip

- Every similarity-swap owner in the Live binary is a device or a device
  view. `ASimplerView`, `ADrumSamplerView`, `ADrumGroupDeviceView` and
  `ADrumGroupDevicePadView` carry `SimilaritySwapButton`; the
  `TSimilaritySwappable` callbacks sit on `LDrumSampler`, `ASamplerBase`,
  `ASimplerSampleManager`, `ADrumGroupDevice`, `ADrumGroupDevicePad` and
  `AGroupDevice`. None of the binary's 320 strings naming "similar" names a
  clip, so there is no button for the AX helper to press.
- `Live.Clip.Clip` offers `file_path` (read-only, with a listener), `crop` and
  the warp verbs, and no verb that changes a clip's file (`py_introspect`,
  regex `sample|replace|file|similar|swap|legato|crop|warp`). `ClipSlot` offers
  `create_audio_clip`, `delete_clip`, `duplicate_clip_to` and `fire`.

What is left is the index ADR-439 measured: `fe_values` in
`Live-files-12300.db`, where plain Euclidean distance reproduces Live's Show
Similar Files list. An implementation over Node's `node:sqlite` reproduced the
numpy ranking that matched Live's list — the top 20, in the same order.

### The index covers the files a clip plays

Audio files with a vector, by size: under 100 KB 99.9% (64,561 of 64,609),
100 KB–1 MB 98.8%, 1–5 MB 98.0%, 5–20 MB 71.7%, 20 MB and over 1.9% (37 of
1,919). Live-recorded takes: 277 of 463. The unsaved set's temporary project
is a Place in the index (`Current Project`). The rig's own audio track,
Shaker, holds four Apple Loops from Samples Organized, and all four carry a
vector.

### A drum loop's nearest files were one-shots

Live's list is everything indexed. For `Quarters.wav`, a 5.2 s drum loop, the
nearest audio files after one recording were ten hi-hat one-shots of
0.2–0.7 s: right for a pad, wrong for a clip slot. Live's index classifies
analyzed audio itself — `Type|One Shot` on 67.7% and `Type|Loop` on 22.1% of
the 227,818 vectorized audio files, neither on 9.2%. Among `Type|Loop` files
Quarters' nearest are loops, and the scan shrinks from 222,572 rows (664 ms)
to 45,167 (158 ms).

### The rig's clips carry names of their own

The Shaker track's clips are named "8ths", "16ths" and "16ths 2" after their
rhythm; only the `Quarters.wav` clip reads its file's stem. A clip read in Live
carries every setting a swap should keep — `warping`, `warp_mode`, `gain`,
`pitch_coarse`, `pitch_fine`, `looping`, `launch_mode`, `launch_quantization`,
`legato`, `velocity_amount`, `ram_mode`, `muted`, `color` all exist on
`Live.Clip.Clip` — while the interface can see and set only a few of them.

### A clip can read as playing while the transport is stopped

In the Verification run's first read, with `Song.is_playing` False, the Shaker
track's "8ths" clip read `Clip.is_playing` True. Launching a clip starts a
stopped transport, so a relaunch keyed on the clip's own flag would start the
set.

## Decision

1. **`/api/similar-samples?path=<abs>&limit=<n>`**, a SvelteKit route beside
   `/api/sample-peaks`, over the newest `Live-files-*.db` in
   `paths.liveDatabaseDir` (**the newest by mtime**, with the schema number as
   the tie-break — see the measurements below), opened read-only for each
   request — SQLite's `readOnly`, never `immutable=1`, which would read a stale
   snapshot while Live's indexer is writing. Answers are cached in a bounded
   LRU keyed by the database file, **its mtime**, the path and the limit, so an
   index pass invalidates them. The ranking is
   Live's — L2 over the stored vectors; `flags & 1`; a shared `file_kind` bit;
   one file per audio-content `hash`, the lowest `file_id`; the same extractor
   version — with two rules for a clip slot: **audio files only** (Live also
   lists the `.adg` / `.adv` presets that carry a vector), and **a reference
   tagged `Type|Loop` or `Type|One Shot` meets only files with the same tag**.
   A file no longer on disk is passed over. A path with no index row answers
   `not-indexed` and one with a row but no vector `no-vector`, both 404: facts
   the pill shows, not faults.
2. **The clip view carries the pill** for a focused audio clip: the clip's
   file name between ‹ and ›. The list is the clip's file and then up to 50
   neighbors, computed once per file and wrapping at its ends, like
   folder-next, so the way back is the other half. A file changed by other
   means starts a new list.
3. **A step is one request that Live carries out:**
   `/looping/v3/clip/swap_file [requestId, clipPath, filePath]`, handled by
   `ClipsComponent.handle_swap_file` and answered on
   `/looping/v3/clip/swap_file/reply [requestId, ok, code, detail]` — fixed
   arity, never the error channel. Every check comes first — the file is on
   disk, the slot holds an audio clip, it is not recording — so a refusal
   changes nothing. Then, inside one undo step: delete the clip; create the new
   one from the file; write the old clip's settings (the list above, `warping`
   before `gain`); keep its name when that was not its file's stem; fire the
   slot when the old clip was playing or queued **and the transport is
   running**, since a clip can read as playing after a stop; and set
   `detail_clip` when it was the clip Live showed, because deleting the
   focused clip empties the clip view. A file Live will not load puts the old
   file back with the same settings and answers `load-failed`. Everything the new clip did
   **not** get is named in an `ok` reply (`not kept: gain`) — a setting Live
   refused on the write, one whose *read* on the old clip raised so it could
   not be carried at all (swap audit M14), and equally `name`, `launch` or
   `focus`, since `_keep_on_new_clip` appends those to the same list. So
   `not kept: focus` is a legitimate detail and "a setting" undersold it.
4. **While a step is in flight, the pill ignores what the slot reads.** The
   clip view re-reads the slot when its focus empties and returns, and what it
   reads meanwhile is the old file, the step's own, or a cached answer older
   than both. Every step ends by dropping the interface's cached file for the
   slot, whatever Live answered.
5. **What a different file cannot share stays Live's default:** loop and
   start/end markers, warp markers.

## Consequences

- A surface verb, a route, a service, a hook and a mount in `CentralDisplay`.
  The verb loads only after a full Live restart.
- **A swap books as one undo step** (measured): one undo puts the old clip
  back whole, its loop points included. Stepping back on the pill is another
  swap, not an undo — it brings back the file and the carried settings, not
  the loop points or warp markers that went with the deleted clip.
- The settings come off the old clip in Live, exact, including those the
  interface cannot see or set (launch settings, RAM mode, color).
- While the transport runs, a playing clip relaunches at its launch
  quantization, so a swap mid-phrase leaves a gap of up to one quantum
  (unmeasured). With the transport stopped, the new clip stays stopped.
- The first read of a reference costs 158–187 ms of the preview server's event
  loop for a tagged file and about 660 ms for an untagged one. The bridge,
  which fans out meters, is a separate process. One request per reference,
  none per step.
- Live's candidate scope stays: Quarters' nearest file is a take recorded in
  another project. A take over about 20 MB usually has no vector and cannot
  step.
- The route reads any absolute path a LAN client names and answers with the
  indexed paths near it — the exposure the code-quality audit records for
  `/api/sample-peaks`.
- `node:sqlite` prints an ExperimentalWarning once per server process on
  Node 24.7.

**The first cut sent the steps from the interface** — `clip/load_file`, the
setters for the settings the interface can see, `clip/launch`, `clip/focus` —
and confirmed each step by polling the slot's file. It needed no Live restart,
but a swap took several undo steps, it could carry three settings (and none
while the clip view's store sat at its reset values), and it could not put the
old file back. It was replaced before landing.

## Verification (2026-09-15)

- Surface: `tests/test_clips_swap_file.py`, 18 passed — the order of Live's
  calls inside the one undo step, every setting carried, the name rule, the
  relaunch only while the transport runs, the refocus, the put-back, refusals
  that touch nothing, and an unexpected raise that still closes the step and
  answers. The whole surface suite: 2,558 passed. Ruff adds no rule categories
  to `ClipsComponent.py` or beside the sibling clip tests; the transport fix
  leaves its counts unchanged.
- Interface: full suite 2,421 passed (158 files); `check:types` no new errors
  (53 baselined); lint, `check:wire` and `check:touch` clean; `npm run build`
  passes.
- Live's real index, through the built preview server: `African Seed Caxixi
  02.aiff` → 200 in 186 ms, `Loop`, 42,883 candidates, the nearest a 2.7 s
  shaker from a Hits folder that Live tags as a loop, then Caxixi 06 and the
  Seed Shaker loops; `Quarters.wav` → 200 in 158 ms, all loops; an unindexed
  file and a 20 MB+ voice memo → 404 in 2 ms; a relative path → 400.
- The interface under the shot mock, with the page's socket piped so the pipe
  could play the surface as `handle_swap_file` reads — the focus emptied and
  restored, then the reply by request id, and deliberately no clip
  created/removed events, so the interface's cached file for the slot stayed
  stale: the MIDI clip view draws no pill; the audio clip view draws `African
  Seed Caxixi 02` and passes the layout check; every step landed on the file it
  sent, in 31–38 ms; a press answered `load-failed` showed `load-failed` in
  place of the name and stayed on the old file; two steps back returned to the
  clip's own file. The first run of that script, with a looser check, passed a
  real bug — a stale cached read during a step started a new list and threw the
  pill back to the clip's first file — which decision 4 fixes.
- **Live, through the bridge.** A script sent the verb over the bridge's
  WebSocket and read Live through the surface's probe driver, on the Shaker
  track's third clip ("16ths", `Jacaranda Shaker 01.aiff`), focused, with the
  transport stopped. The reply came back ok in 42 ms. The slot held `Jacaranda
  Shaker 04.aiff` under the name "16ths", with all thirteen settings equal to
  the run's own baseline read (warp mode 6, gain 0.4 and color 16725558 among
  them) and the new file's own loop end: 4.0, where the old clip read 8.0. The
  clip was not launched, the transport stayed stopped, and Live showed the new
  clip. One `song.undo()` answered `Undo Custom Action` and put back the old
  file, the name, the loop end of 8.0 and every setting. The run's first read
  had found the clip that reads as playing with the transport stopped
  (Context), so the script refused a playing or queued clip rather than start
  the set — which is how the transport rule in decision 3 came about.
- **The transport rule, by hand.** Restarts before the fix reached `main`
  loaded the old surface, and on those a swap still triggered the clip. Live
  started again at 15:38:53 and compiled `ClipsComponent.py` from the fixed
  source (the `.pyc` header's source mtime matched the file); on that run the
  user swapped by hand and confirmed the fix works.

**Not yet measured in Live:** a relaunch while the transport runs and the gap
it leaves, a file Live will not load, and Live naming a created clip after its
file's stem (the swapped clip kept a name of its own).

## Measured on the rig (2026-09-15, swap audit §5)

Against the live index — `Live-files-12300.db`, 1.6 GB, 468,465 vectors,
`Ableton Index` holding it open in WAL mode. All of these are the numbers the
swap audit's M9 / M24 and its SQLite Lows asked for.

| What | Number |
|---|---|
| One scan, `Type|One Shot` reference | **1.27 s** over 325,340 candidates |
| One scan, untagged reference | **1.38 s** over 402,089 candidates |
| Three identical requests, before the cache | 1.295 / 1.263 / 1.271 s — **no reuse** |
| The same repeat, after it | 1.267 s, then **1.5 ms** |
| `limit=200` body, before the cap | **200 absolute paths, 41,879 bytes** |
| The same request, after it | **24 paths, 4,797 bytes** |
| `fe_values` rows with a NULL `hash` | **0** of 468,465 |
| Files tagged both `Type|Loop` and `Type|One Shot` | **0** |
| `Type|Loop` / `Type|One Shot` / neither | 64,969 / 370,887 / 32,828 (7.0% untagged) |
| `files` rows with `parent_id = 0` | **4**, and none is a file: `/`, `<keywords>`, `<packs>`, `<plugins>` |
| `Live-files-*.db` in the folder | 11; newest by mtime (`-12300`) is also the highest schema number |

Three of the audit's Low findings are **not reachable on this library** and
were retired rather than coded around: no NULL hash exists, so `String(null)`
collapses nothing; no file carries both sound-type tags, so that fall-through
to "meets everything" never fires — though 7.0% of vectors carry *neither*
tag, which reaches the same branch by a different route and is the case the
1.38 s above measures; and the newest database by mtime is the highest schema
number today, so ordering by number is a latent bug rather than a live one
(kept, and fixed by ordering on mtime, because this machine already holds Live
11's `-47/-48/-53` beside Live 12's five-digit names — the scheme is not
monotonic across major versions).

**The route enumerates the library, and that is why `limit` is capped.** This
is not the `/api/sample-peaks` finding: that route reads back a path you
already named, this one hands you paths you did not know. One valid reference —
any audio file Live has indexed — returned up to 200 absolute paths on the
user's disk to any client that can reach port 3000/8889, each of them a valid
next reference, and the body's `candidates` count reports the size of the
library besides. The ceiling is now 24. It is a reduction in exposure, not a
fix: the route is unauthenticated by design, like the rest of the LAN
interface, and the real boundary is the network the iPad is on.

**A read-only open still writes the sidecars.** Three places said the database
is "never written to" — `similarSamples.ts`, `constants.schema.json` and this
ADR's decision 1. A read-only open of a checkpointed WAL database provably
creates its `-shm` and `-wal`, which is correct and must stay: a WAL reader
needs the `-shm`, and `immutable=1` would read a stale snapshot while Live is
writing. The wording is corrected in all three; the open is unchanged.

## References

- ADR-439 (similar-sound swap; the pill addendum), ADR-415
  (`clip/sample/get`), ADR-360 and ADR-362 (`/api/sample-peaks`).
- Memory notes `project_similarity_db_facts`,
  `project_no_python_similarity_hook`, `project_live_undo_per_parameter_write`.

## Tags
`similarity`, `audio-clip`, `swap`, `clip-view`, `live-index`, `sqlite`,
`python-surface`
