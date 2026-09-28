# Drill-Down Browser

Full-screen, one-layer-per-tap instrument/preset browser (ADR-391). Replaced the
old Miller-column `UnifiedGestureBrowser` + its gesture stack (deleted 2026-07-03).
Touch-first (iPad Safari).

## Interaction model

- **Persistent left rail** (faithful to the old `VendorButtonGrid` look): the
  Record button (whole slot — the CLIPS/VIEW/FX section switches passed through here and now live in SystemCentralView's Sections card),
  then **Recent and one button per Place** in Live's sidebar order, matte slabs
  with coloured outline + ink label (see *The Places* below). `railBands` splits
  them over three bands — as evenly as they go, the later bands taking the
  extra — so the bands keep dividing the column into equal thirds, each level
  with a main content row; with today's seven Places that is Recent · Drum /
  Perc · Bass · FX / Inst · Key · Synth, the old type rail button for button.
  Record is a rounded **rectangle** here (`shape="rect"`), not the shared
  component's default circle: in a band slot the circle rule sizes off the short
  axis and throws away most of the 120px width. Tapping a Place opens + drills
  in. While open, the Record slot swaps to a red **X** that closes.
- **A rail tap resumes that button's last location; tapping the Place that's
  already open on screen restarts at its root.** The reset gesture is unchanged
  (it's how you get back to the top from deep inside — and tapping the open Place
  at its root still closes); what's new is that every *other* tap resumes instead
  of re-walking the tree — from a closed browser, from the scale picker, or from
  a different Place, whose tree isn't on screen to be reset. `restore` is just
  `!isSameOpen`. Memory is per rail *button* and per half of the switch
  (`rememberedPathKey(buttonId, isAudioSource)` in `browserNavigationStore`): a
  Place keeps one vendorId whichever half it shows, and a preset path means
  nothing among its samples. Simpler and Audio share one memory (same samples,
  same folders). Written
  by `rememberCurrentPath()` on every navigation — `enterFolder`, `goToCrumb`,
  and the root-reset arm of `selectCategory` (backing out to the root *is* your
  new location) — so it survives both the X and the post-load auto-close.
  Session-lived, not persisted: it tracks where you were during a set. The
  root-reset arm can therefore only ever clear the memory of the Place you were
  looking at. `selectCategory(vendor, {restore})` carries the split;
  a restored non-root path preps its landing-pad track exactly as `enterFolder`
  would (ADR-397 — otherwise a resumed browser is the one place you can stand on
  a preset grid with no fresh track waiting), and `loadCurrentLevel` verifies the
  first restored level: a level with no folders *and* no presets means the
  catalog moved under the memory, so it's forgotten and the browser falls back to
  the root.
- **One three-way top-bar switch: `[Instrument | Simpler | Clip]` (ADR-397, revises
  ADR-395/396; kept for the Places, Ben 2026-09-24: "could the header be the same
  as it used to be?"; relabeled from MIDI | Simpler | Audio 2026-09-25 — play it,
  or let it play. The mode ids stay `midi | simpler | audio`).** With a Place open, the top bar carries a single segmented
  switch (`browserModeStore.browseMode`, a projection over `sourceMode` ×
  `audioLoadTarget` — see the stores note): **Instrument** (`midi`) → the Place's
  presets (→ MIDI track); **Simpler** → its samples and audio clips, a pick lands
  on a fresh Simpler (→ MIDI track); **Clip** (`audio`) → the same plus its MIDI
  clips, a pick lands as a clip (an `.alc` makes its own track — a MIDI clip's is
  still silent, plan §5 follow-ups). The switch and the Lock share the bar's right half as four equal cells,
  three segments and the lock, the lock pinned to the last cell so it holds its
  place with no switch beside it (2026-09-14, user's call: "they should be able
  to take up like half of the width"). The switch is a **kind filter**
  (`PlacesAdapter.setKindFilter`, set on every level load; the groups are
  `$lib/utils/placeKinds`'s, via `groupsForMode`): Instrument shows instruments,
  kits and effects, Simpler samples and clips, Clip those and `midi-clips`, and a folder is kept or dropped from its `kinds` counts
  without descending. `setBrowseMode` drives it: presets↔samples restarts at the
  Place's root (`selectCategory`); Simpler↔Clip keeps the same samples + place and
  only re-preps for the new track kind. Among samples a Place's root holds only
  its `Samples` folder, which the level loader opens directly (`openLoneFolder`),
  so Simpler and Clip land among the samples in one tap. The mode **persists
  across opens** (ADR-397) — a fresh open resumes the last Instrument/Simpler/Clip
  choice (`sourceMode` / `audioLoadTarget` in `localStorage`), it does *not* reset
  to Instrument; a pending clip-replace still forces Clip. Switching Places keeps the
  current mode so you can sweep samples across Places — unless the next Place has
  nothing for that segment: one with **no samples** greys Simpler
  (`simplerUnavailableForCurrent`) and Clip unless it has MIDI clips
  (`clipUnavailableForCurrent`), one with **no presets** greys Instrument
  (`midiUnavailableForCurrent`), both from the index's per-kind counts before any
  catalog is read, and opening such a Place flips the switch to a segment it can fill
  (never mid-replace — `tapRailCategory` refuses a Place with nothing of the
  replace's half). The switch shows for Places only (not Recent/Scale).
- **Track prep fires when the mode is committed — first drill *or* switch tap
  (ADR-397).** `selectCategory` marks ready without prepping (bare type-select
  shouldn't spawn a track); `preprepForCurrentMode` then runs from `enterFolder`
  (each drill from a Place's root) and from `setBrowseMode` (every switch tap),
  creating the landing-pad track so the pick reuses it (Python create-or-reuse) —
  restoring the "a fresh track appears" feedback. **Prep is liberal on purpose:**
  redundant calls are cheap because `_decide` reuses an existing empty track and
  only creates a fresh one once the prepped track has been dirtied — so a
  locked-open browser gets a new track for each new instrument, no dedup flag
  needed. **MIDI + Simpler** prep a MIDI track and reuse cleanly; **Audio**
  deliberately does *not* pre-prep (Live's Browser always makes its own track for an
  `.alc` clip — `TrackPrepareComponent._handle_alc_prepare` — so a pre-prepped empty
  audio track would strand an auto-armed track). Audio keeps prepping at load time.
  Folder-less Place roots and Recent fall back to load-time prep.
- **Replace modes force their source + hide the browse switch.** Both are opened
  from a **tap on the swap pill's name** (ADR-442 — it moved there from
  ClipCentralView's column-9 Replace Inst / Replace clip buttons, and is a tap
  rather than that column's 800ms hold) and pin the swap to an existing
  track, so the switch is replaced by a status pill (flipping to a sample source
  would ignore the pin and spawn a new track):
  - *Replace-audio-clip* (`openAudioBrowserForReplace`, audio clips) forces
    **Audio**, shows a **"Replace clip"** pill, and the next pick routes through
    `replaceAudioClip` (clip-into-slot, no track prep). Opened by the clip
    pill's square (`useClipSwap.open`), pinned to the **focused** clip's slot —
    the same clip the pill itself steps. Switching to MIDI cancels
    the pending replace. Raw samples work; `.alc`-into-an-existing-slot is a known
    limitation (ADR-395).
  - *Replace-instrument* (`openForReplace`, MIDI clips) — opened by the
    instrument pill's square (`useInstrumentSwap.open`), pinned to the selected
    track — forces **MIDI** (ADR-397 —
    it must, now the mode persists across opens), shows a **"Replace inst"** pill,
    and the pick loads via `prepareForPreset(replaceTrackPath)` — swap in place, no
    new track. `preprepForCurrentMode` skips its landing-pad prep in both replace
    modes.
  - **It opens ON the track's own patch, not where you were last (ADR-441).**
    The hold freezes the track's recorded patch (`TrackRecord.preset`) beside
    the pin and `openForReplace` carries both; `revealReplaceTarget` then asks
    `presetSiblings` — the swap pill's own lookup — for the catalog leaf holding
    it — through the Places alias map, so a patch recorded before the Places
    lands on its copy — and lands there, that tile wearing the `.loaded`
    outline.
    `selectCategory(vendor, {at})` is the third arm beside `restore` and the
    root reset: land HERE and remember it as this button's location. The path
    needs no `pendingRestoreKey` verification — it came out of the same catalog
    file the adapter is about to read the level from.
    **The lookup is not awaited**: a cold `/api/places/<id>.json` is multi-MB, so
    the browser expands where it was and re-skins when the folder resolves
    (`revealToken` guards a slow read against a newer open, and a mode dropped
    meanwhile — a different track selected — cancels it). Keyed on replace mode
    *arming*, not on the browser expanding, so a **locked** browser that is
    already persistent gets the same landing.
    When nothing resolves (no record, a path no Place holds) the open still
    **re-skins a pane that was among samples back to the Place's presets**:
    `openForReplace` flips the switch to MIDI, and the level-load effect then
    reloads the same (samples) path with the preset filter — an empty screen
    under the "Replace inst" pill. A Place keeps one vendorId in both halves,
    so the pane itself records which half it was loaded in (`paneAmongSamples`,
    set when a level commits and read when the replace arms, before the flip's
    reload lands). The rule told a sample pane by its vendorId (`audio-clips`)
    before the Places, which a Place never changes, so from the Phase 4 switch
    until the cutover it never fired. That whole three-way decision is
    `replaceLanding` in `drillDownModel` — pure and table-tested, because both
    of its wrong answers are decisions, not plumbing.
  - **The replace-instrument pin's lifetime is the browser's, and the lock
    decides how long that is.** Unlocked it is one-shot — `handlePostLoad`
    closes the browser and the close drops the pin. Locked, the browser stays
    open and so does the pin, *deliberately*: that is the audition-in-place
    mode, where pick after pick swaps the instrument on the same track. Nothing
    in the load path special-cases replace.
    **`handleClose()` is what clears the pin, so every close must go through
    it** (an earlier auto-close set `isExpanded = false` directly, leaving the
    pin armed behind a browser that looked shut, so the next open kept swapping
    onto the old track). Replace-audio-clip clears its own target inside
    `tryReplaceAudioClip`.
    **Since the close is now optimistic it happens BEFORE the load's awaits**,
    so `commitPresetLoad` captures the pin's value — and every other
    browser-state read — up front. That ordering is load-bearing: read the pin
    after `handlePostLoad()` and you get `null`, and the swap silently becomes
    a new track.
  - **Selecting a different track cancels an armed replace-instrument** (the
    `selectedTrackStore.selectedTrackPath` effect). The pin is a path frozen at
    arm time, not a live read, so once the performer moves on it means nothing —
    and a *locked* browser would otherwise keep swapping onto the track they
    left. Cancelling reverts the status pill to the browse switch, so the mode
    change is visible. A replace load resolves to the pinned track and echoes
    that selection, which matches the pin and leaves the mode armed.
  - `commitPresetLoad` is the shared load tail behind **both** the card tap
    (`loadPreset`) and the folder long-press random pick (`loadRandomFromFolder`),
    so the pin applies identically. The random pick used to inline its own copy
    that never passed `replaceTrackPath` — while armed, it silently ignored
    replace mode and prepped a separate track.
- **One layer per screen (strict).** Folder tiles → deeper folders → preset tiles;
  a level with subfolders shows folders only, a leaf shows presets (`screenKind`).
- **Depth-cap-flattened presets are re-grouped by origin folder (ADR-403).** The
  generator's `capFolderDepth` (`scripts/catalogShape.ts`) collapses folders past `catalog.maxFolderDepth`
  into one flat list but each preset keeps its physical `path`; the browser
  recovers the lost subfolder per preset at render time (`groupPresetsByOrigin`)
  and renders headed sections — calm sticky header (folder name + count +
  hairline), loose bucket (presets directly in the folder) first with no header.
  Tile geometry inside sections comes from `computeGroupedGridLayout`, which
  shares `computeGridLayout`'s scoring so grouped tiles are **identical** to
  plain-grid tiles once the content scrolls. A leaf with nothing to recover
  (single bucket) renders the plain grid, unchanged. `currentPath` is matched
  inside `preset.path` as an ordered non-contiguous subsequence anchored from the
  right — elided single-child wrappers (generator `collapseSingleChains`) and
  name collisions can't mis-bucket a preset; unmatchable paths fail soft into
  the loose bucket.
- **Small sections pack side-by-side into row-bands (ADR-409).** A screen full of
  1–2-tile sections used to strand each on its own full-width row (dead space).
  `packGroupedSections(groups, cols)` bins the sections into bands before render:
  a **big** section (tile count > `cols`, i.e. more than one row) gets its own
  full-width band (`kind:'full'`, windowed exactly as before); **small** sections
  (≤ `cols`) pack greedily left-to-right into a shared one-tile-row band
  (`kind:'packed'`) until the next would overflow `cols`. Each packed cell keeps
  its own header (name + count, wraps to 2 lines in narrow cells; no hairline).
  **Cell gap = the tile gap (12px), not the section gap** — so every tile across
  every row lands on the same column pitch and columns line up between full and
  packed rows. Tile size is unchanged (fixed `--tile-w` px columns = the solver's
  `tileWidth`), preserving tile parity. A packed band is one tile row tall by
  construction, so it maps 1:1 onto a single windowing section — **ADR-404 row
  windowing is untouched**; only the partitioning into bands is new.
- **Breadcrumb** across the top = orientation + fast-travel (tap a segment to jump
  up). No "Browser" root label. Among samples it reads "Drum / Samples / …": the
  Place's `Samples` folder is a real folder of the Place.
- **Hold a folder → load a random preset** from it (`adapter.getRandomPreset`, a
  uniform pick over the whole subtree). **Lock** keeps the browser open
  after a load; otherwise it closes once the pick has been read (below).
  - `HOLD_TO_RANDOM_MS` is **500ms**. It was 200ms — a bare tap/press
    discriminator — and at that length a progress bar is a flicker, so it wore a
    charge *ring* instead. 500ms is long enough to be read as a gauge, so it now
    takes the **same rising `.hold-fill`** as ClipCentralView's 800ms Delete /
    Replace Inst / Dup Trk gates. One hold idiom across the app rather than two.
  - **The pick is rolled at pointerdown, not at the fire** (`pickRandomFor`), so
    its name can show on the tile *while the bar is still climbing*. That is what
    makes the 500ms a decision rather than a wait: you read what you're about to
    get and can still back out by lifting off early. The fire **awaits that same
    promise** rather than rolling again — the name you read is always the preset
    you get. On a cold `/api/places/<id>.json` the name may not arrive before the
    fire, and the tile just goes straight to `.picked`; that is the only case
    where the pick is unreadable in advance.
    Speculating on every folder press costs one catalog read that a drill-in
    needs anyway and is cached thereafter. An aborted press discards its pick
    unused — `pickRandomFor` attaches a label-only `.then().catch()` purely so
    that discard can't surface as an unhandled rejection; the real error still
    reaches `loadRandomFromFolder`, which awaits the pick and owns the banner.
  - **Charge** (`.folder-tile.charging`): mounts a `.hold-fill` that climbs the
    tile bottom-to-top over exactly the hold window (duration bound inline from
    `HOLD_TO_RANDOM_MS`, so motion and timer cannot drift) and lands full on the
    fire. `forwards`, so the filled look survives the async pick instead of
    dropping back for a frame. The label carries `z-index: 1` so the rising fill
    passes behind it rather than swallowing it. Three labels compete on the tile,
    most-committed first: the post-fire reveal (`pickedName`), the speculative
    pick showing mid-climb (`chargingName`), then the folder's own name.
    `clearCharge()` retires the fill and the speculative label together — they
    must never outlive each other, or a tile is left named after a preset it
    never loaded.
    The charge **outlives the finger**: `endFolderPress` clears it only when
    the press ended *before* the fire. Releasing the moment the bar completes
    is the normal way to use the gesture — the fill topping out is the cue to
    let go — and the pick may still be awaiting a cold catalog fetch, so
    clearing on release would empty the tile before the reveal lands.
    `cancelFolderPress` (`pointerleave`/`pointercancel`) follows the same rule —
    past the fire the pick is committed and still owns the tile, and a finger
    drifting off a tile edge mid-hold is ordinary on iPad, not an abort.
    The catch this creates: re-pressing a tile that is still charging assigns
    `chargingFolder` the value it already holds, which toggles no class and
    would leave a `forwards` fill parked at its end state — so that one path
    (and only that one) nulls it and re-arms on the next frame.
  - **Press token** (`pressToken`): `getRandomPreset` awaits a possibly-cold
    `/api/places/<id>.json`, so a press can resolve long after the finger moved on.
    Hold A past the fire, release, press B, and A's late resolution would wipe
    B's charge and label the screen with A's pick. Every visual write in
    `loadRandomFromFolder` is gated on still owning the newest press; the
    *load* is not, because A was genuinely held past its fire and a random pick
    is what that asks for. Same guard `loadCurrentLevel` uses (`navToken`).
  - **Reveal** (`.folder-tile.picked`): the held tile takes the preset grammar
    and its label becomes the preset that loaded, for `PRESET_REVEAL_MS` (750ms,
    declared in the component beside `HOLD_TO_RANDOM_MS`). **This is the payoff
    of the gesture** — a random pick is the one choice you cannot know in
    advance — so on the random path, and only there, the browser waits out this
    window before closing (`handlePostLoad(PRESET_REVEAL_MS)`). One constant
    governs both the tile's reveal and the close, so they can't drift apart.
    Tapping a preset tile still closes instantly: you picked it, you know what
    it was. Any navigation retires the reveal: `loadCurrentLevel` clears both
    states.
  - **Hold a section header → a random preset from that section** (2026-09-24,
    the user's call). The grouped screen's headers (ADR-403, full-width and
    packed alike — one `sectionHead` snippet) take the same gesture: the same
    `HOLD_TO_RANDOM_MS` fill climbing the header, the pick in the header's name
    slot (count hidden) while it climbs and through the reveal, and the same
    `loadRandomFromFolder` → `commitPresetLoad(preset, PRESET_REVEAL_MS)` tail,
    so lock, replace mode and the linger behave identically. Three differences,
    each forced:
    - **The roll is the section's own presets, not `adapter.getRandomPreset`.**
      Past the depth cap a section's folder is not a node in the catalog tree,
      and `getRandomPreset` falls back to the PARENT when a path doesn't
      resolve — asking it would pick from the whole flattened screen. The
      section is already in memory, so the roll is synchronous and never cold.
    - **The pick lights its own tile while the bar climbs**
      (`chargingPresetPath`: the candidate wears `.loaded` in place of the tile
      actually loaded, so one ring is on screen; a lift before the fire hands
      it back). On iPad the finger holding the header covers the header's
      label — the tile is the readable half.
    - **`use:press` (ADR-427), not the folder tile's hand-rolled handlers:**
      `onDown` rolls and charges, `onHold` fires, and a release before the hold,
      a pan the browser claims, or 12px of travel aborts. A tap on a header
      still does nothing. The packed cell's header is `position: relative`
      (was `static`) so the fill anchors to it rather than the band.
- **Optimistic close.** A committed pick closes the browser without waiting for
  Live. `commitPresetLoad` closes first and awaits afterwards.
  **Two different waits, and only one of them is dead weight.** Waiting on LIVE
  is: the answer is already committed and the track strip reports it. Waiting on
  the USER is not — hence the random path's 750ms linger above. `handlePostLoad`
  takes an optional delay for exactly that; everything else passes none.
  What makes that safe rather than merely fast:
  - **Nothing is cancelled.** The browser is a sidebar that COLLAPSES; it never
    unmounts, so the awaits run to completion behind a closed browser.
  - **Every browser-state read is hoisted above the close** (replace pin, audio
    load target, vendor). Reading any of them afterwards gets post-close values.
  - **The confirmation moved to the track strip** (`presetLandingStore`), which
    can report after the browser is gone. Two phases: `markPending` at commit —
    the strip glows, dims behind a scrim, spins a ring, and shows the incoming
    preset name; `markLanded` on the prepare ack — one flare that decays as the
    real name arrives from Live. Pending is only reachable when the target track
    *already exists* (replace mode's pin, or the pre-prepped landing pad); a load
    that creates its own track has no strip to mark until the ack, and goes
    straight to landed.
  - **Failure got louder, because it had to.** It used to announce itself by
    ABSENCE — a nack closed instantly while a success held open for 750ms, so
    "vanished without naming anything" *was* the error message. Once both
    outcomes close instantly that signal dies, so both catch blocks now clear the
    pending strip and raise `v3ErrorBannerStore` (`preset-load-failed`), the one
    surface that outlives the close. **Do not remove that banner call** without
    replacing it: nothing else distinguishes a failed load from a good one.

- **A preset tile is one file.** The Places catalog never groups files that
  share a base name, and the loader's random variant pick is gone — tapping a
  tile loads *that* file, every time. `Rock Kit 1` / `Rock Kit 2` are two
  squares. (The type catalogs' `×N` grouped-variant badge went with them.)
- Cross-column drag is gone (no columns). Scale/Key mode is opened externally via
  `browserModeStore.isScalePersistent`, not a rail button.
- Key mode carries a **Detect key** button in the bar controls (ADR-446): it sends
  `/looping/v3/session/scale/detect [1]`, the surface reads the launched clips,
  decides the key by votes and sets it, and the answer (`session.scaleDetected`)
  draws a *Detected* strip above the roots — key, band, `· set`, the runner-up as
  a one-tap alternative, the vote ladder as the strip's tooltip and, since the
  iPad has none, unfolded under the strip by a tap on the heading. The strip is
  forgotten on close and on a surface restart (a set load), and `· set` shows
  only while Live's key is still the one the detection wrote. Beside Detect,
  **Following / Locked** (ADR-447) toggles `/looping/v3/session/key_follow`:
  while following, the surface re-detects and sets the key whenever what is
  playing changes. A pick here locks the key without this component saying
  so: the surface turns Follow off when a `scale_root` / `scale_name` write
  arrives from any client (a pick of the key already set included). The
  runner-up chip sends one root, one name and one mode (`applyKey`).
  Turning Follow back on runs a pass immediately. The reasons list is keyed
  by position — two clips can say the same line. The Master
  strip's key band does the same on a 600 ms hold, without the browser.

## The Places (browser-places plan)

The browser's library is Live's sidebar Places under `paths.sidebarRoot`
(Looping's `documentation/browser-places.plan.md`): the only catalog since the cutover
(2026-09-24), which removed the type catalogs, their rail, the `audio-clips`
source and the Phase 4 switch that chose between them.

- **The rail** is Recent + one button per Place in `places/index.json` (Live's
  sidebar order, read from `Library.cfg` by `scripts/generate-places-catalog.ts`),
  split into the rail's three bands by `drillDownModel.railBands` (plan §2: as
  evenly as they go, later bands taking the extra; Record always leads the first).
  **Today's seven Places draw the old type rail exactly: `shot places` vs `shot
  default` from `origin/main`, 0 of 5,595,136 px, max delta 0 (2026-09-24, before
  the cutover).** A band scrolls only past the 44px touch floor (`.places-rail`),
  which eight buttons never reach. A Place's button is colored by its role
  (`vendors.types[role]`). No Places catalog on the machine → Recent alone.
- **Place buttons are `place:<id>` vendorIds** (`placeVendorId`), the same id for
  the rail button and the adapter, so `selectedVendorId` and `currentVendorId`
  agree for every button. Their path memory keeps one spot among presets and one
  among samples.
- **Loading goes by what the item is**: a sample or clip follows the switch —
  Simpler onto a fresh Simpler, Audio as a clip — and anything else loads as an
  instrument. **Prep** follows the switch: a MIDI track unless it says Audio. A
  replace-clip pick in a Place must be sample-like (`tryReplaceAudioClip`).
- **Tiles**: a plug-in preset names its plug-in under its name; a plug-in that
  is not installed, or an effect, is **greyed and disabled**, with "Not
  installed" / "Effect" on its face (the iPad has no tooltips). The stacked label
  (`.has-plugin`, column flex) applies only to tiles that carry one.
- **Coloring**: a preset from a Place carries its Place's role (`Preset.role`,
  stamped by the adapter) and passes it to `trackColoring` as `placeRole` — the
  answer outright, since a Place's `<Place>/<folders>/…` path would be read
  wrong by shape. A sample or clip from a Place is colored audio and records no
  role (`audio: true`), as the audio source's always were.
- **Recent reads through the alias map** (`recentThroughAliases`): an entry
  recorded in the old vendor tree shows and loads as its Sidebar copy, and one
  whose file lies in a Place takes that Place's role.
- **Loads of Sidebar paths need Live to have been restarted since the copy**:
  the surface's `BrowserCache` walks the User Library once per surface lifetime.

## Component layout

| File | Role |
|------|------|
| `DrillDownBrowser.v6.svelte` | The whole browser. Rail + breadcrumb bar + stage; category/folder/preset/scale rendering; load/random/close handlers (`loadPreset` and `loadRandomFromFolder` share one `commitPresetLoad` tail, so the replace-mode pin applies to both); the adaptive-grid `ResizeObserver`. Renders `controls/RecordButton.svelte` in the rail. **Preset grids are row-windowed (ADR-404):** only the viewport's rows (±3 overscan) are in the DOM — rAF-gated `onscroll` + `computeVisibleWindow`/`computeGroupedVisibleWindow`, padding spacers keep scroll geometry pixel-identical, `overflow-anchor: none` on both scrollers. Leaf listings are fetched **uncapped** (`getPresets(…, Infinity)` — the old default limit silently hid audio files past 200). Folder grids stay unwindowed (counts bounded by catalog structure). |
| `BrowserPresetWaveform.svelte` | **Audio sample tile waveform (ADR-401).** Presentational canvas behind a preset tile's label (`z-index:0`, `pointer-events:none`). Prefers the **baked thumbnail** on the preset (`preset.peaks`, decoded via `$lib/utils/waveformThumbnail`, zero network), else lazily live-fetches full peaks from `clipWaveformService`. Both paths are **IntersectionObserver-gated** so a folder of hundreds of tiles only decodes/fetches the handful on screen — the browser is the one surface rendering *many* waveforms at once. Renders **unipolar** (bottom-anchored, 256 bins, gentler 0.85 curve, pixel-snapped columns — no seams), unlike the bipolar-with-playhead strip/Simpler; decoded-PCM thumbnails carry RMS rather than min/max (ADR-401 Revised). Rendered per-tile in `DrillDownBrowser` only when `ui.browser.audioWaveforms` is on **and** the tile is an audio file type (so instrument tiles never draw). |

## Utils (`utils/`)

Pure/stateless helpers, unit-tested under `src/__tests__/unit/utils/`:

| File | Role |
|------|------|
| `drillDownModel.ts` | **Pure.** `screenKind` (folders vs presets vs categories), `buildCrumbs` / `pathForCrumb` (breadcrumb math), `replaceLanding` (ADR-441 — what a replace-instrument open does with its catalog answer: `land` on the patch's folder, `reskin` a pane that was among samples back to the Place's presets, or `none`), `railBands` (the rail's three bands over Recent + the Places), `computeGridLayout` — the shared adaptive tile-grid solver (picks column count for comfortable, roughly-square, fully-packed tiles that fill the stage and scroll only when they'd shrink below the min tap size) — plus the ADR-403 pair: `groupPresetsByOrigin` (recovers each flattened preset's origin subfolder from its `path`, right-anchored non-contiguous match of `currentPath`; loose bucket first, named groups alpha) and `computeGroupedGridLayout` (sectioned variant of the grid solver, identical scoring/weights so grouped tiles match plain-grid tiles exactly in the scrolling regime), `packGroupedSections` (ADR-409 — bins sections into `full`/`packed` row-bands so small sections share a row; big sections keep their own), and the ADR-404 windowing set: `computeVisibleWindow` / `computeGroupedVisibleWindow` (row window + spacer pads from the solver's exact geometry; grouped variant also collapses whole off-screen sections and always keeps a partially-visible section's sticky header renderable) with `windowsEqual` / `groupedWindowsEqual` (skip state writes when the window didn't move). Tested — including the invariant that windowed DOM height equals full-render height at every scroll position. |
| `presetLoader.ts` | Preset load orchestration: `TrackPrepManager`, `loadPresetWithVariant`, `loadAudioClipFromPath`, `replaceAudioClip`. A sample or clip picked in a Place is colored audio with no role (`audio: true`); a preset passes its Place's role (`placeRole`); a Recent sample replay is colored from its own path. **Prep on commit (ADR-397):** `selectCategory` marks ready without prepping; `preprepForCurrentMode` preps a landing-pad track for MIDI/Simpler modes (`prepareTrack('instrument')`) on each drill-from-root (`enterFolder`) and each switch tap (`setBrowseMode`) — liberal by design, since Python's create-or-reuse reuses an empty track and only creates a fresh one once the prepped one is dirtied. Audio mode + folder-less roots + Recent still prep at load time. `loadTarget` (the Simpler vs Audio arm of the browse switch) branches a picked sample: `clip` → `loadAudioClipFromPath` (raw → `prepareForPreset('audio','')` + `clip/load_file`; `.alc` → `prepareForPreset('audio', alcPath)`, Browser creates the clip's track, metadata preserved — ADR-394) then adds to Recent; `simpler` → `loadCaptureIntoSimpler` (a Simpler inserted on a fresh MIDI track; auto-adds to Recent). Recent audio entries carry `loadTarget` so re-selection replays them identically. |
| `vendorModel.ts` | **Pure.** Vendor lookups (`findVendorById` / `findVendorByVendorId`), `BrowserVendor`, `VENDOR_BUTTON_INDEX_OFFSET`, `SPECIAL_BUTTON_TYPES`. Tested. |
| *(deleted)* `revealController.ts` | Held the reveal-then-close timer. Retired with the optimistic close — there is no delay left to own, and its `scrollPresetIntoView` had already been dead (it queried an attribute nothing emits; see the code-quality audit). `PRESET_REVEAL_MS` moved into the component beside `HOLD_TO_RANDOM_MS`. |

## Stores

`stores/v6/browserNavigationStore` (per-vendor nav state, `currentPath`,
`loadedPresetPath`; `selectedVendorId` = rail *button*, `currentVendorId` = the
vendorId the adapter keys on — the same id for every button since the Places;
plus the per-button path memory `rememberPath` / `getRememberedPath` /
`forgetPath`, keyed by the exported `rememberedPathKey` and cleared with the nav
state), `browserModeStore` (persistent / replace / scale / lock + `sourceMode`
and `audioLoadTarget`, both persisted and resumed on each open — ADR-397, no
MIDI reset; `replaceInstrumentPresetPath` is the pinned track's patch at arm
time, which is where a replace opens — ADR-441). The top-bar `[MIDI | Simpler |
Audio]` switch reads/writes these two via the `browseMode` projection (`get
browseMode` / `setBrowseMode`): `midi`↔instruments, `simpler`↔audio+simpler,
`audio`↔audio+clip — one control over two orthogonal fields (ADR-397).
(`browserGestureStore` was gesture-only and was deleted with the old browser.)

## Grid layout

`computeGridLayout` is the single source of truth for BOTH folder and preset grids.
The component measures the stage (`ResizeObserver`) and feeds width/height/count +
comfort constraints; the solver returns `{ columns, rows, scrolls, tileWidth,
tileHeight }`, applied via `--cols` / `--tile-h`.

Two comfort profiles live in the component: `FOLDER_COMFORT` (`minTile` 150,
`minTileHeight` 110) for the folder grid, and the denser `PRESET_COMFORT`
(`minTile` 112, `minTileHeight` 78) for preset grids — a leaf can hold thousands
of patches, so scan density beats tile size there. Both use `targetAspect` 1.5.
The preset floors are what `.preset-tile`'s tighter padding and `.tile-name`'s
`clamp()` floor are sized against; move one and re-check the others.

## Ordering

Folder + preset order is **baked alphabetical at generation time** in
`scripts/generate-places-catalog.ts` (ADR-391) — the runtime adapter reads key
order as-is, no runtime sort. The Places themselves are in Live's sidebar order.

## Rules

- **Touch-first.** Rail taps fire on `pointerdown` + `touch-action: manipulation`
  (kills the iPad tap delay). The close X closes on `onclick` (after the full tap)
  and consumes its own pointer events so it can never fall through and start a
  recording.
- Config/timings come from `$config/constants.json` and the module consts; don't
  hardcode duplicates.
- Use `$lib/utils/logger`, never `console.log`.
