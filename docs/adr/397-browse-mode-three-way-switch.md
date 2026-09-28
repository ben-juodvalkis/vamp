# ADR-397: One persisted three-way browse switch + prep on commit

## Status
**Accepted** (revises ADR-396)

## Context
ADR-396 moved Audio/MIDI to the browser top bar as a per-browse switch, reset it
to MIDI on every open, and dropped the up-front track prepare that used to fire on
browser open. Three rough edges remained:

- **Two switches for what is really one choice.** The top bar carried a
  `[MIDI | Audio]` source switch and — only when Audio was on — a second
  `[Clip | Simpler]` load-as switch beside it. But the three meaningful outcomes
  (instrument preset, sample→Simpler, sample→clip) are a single decision the
  performer makes once per browse. Splitting it across two controls (one of which
  appears/disappears) made a one-tap choice into a two-step one, and the second
  switch's meaning ("what does a picked sample become?") was easy to miss.
- **The mode reset on every open.** ADR-396 made a fresh open always start in
  MIDI. In practice the performer wants their last MIDI/Simpler/Audio choice to
  survive closing and reopening the browser — the choice is a working preference,
  not a per-open default.
- **No track prepare at all.** ADR-396 removed the up-front prepare to kill the
  race between it and the deferred audio-track create. That also removed the "a
  fresh track appears" feedback the performer relied on. The prepare was removed
  because *on open* the track kind wasn't known — but it *is* known the moment the
  mode is committed: either by drilling into a folder or by tapping the switch.

## Decision

**1. Collapse the two switches into one `[MIDI | Simpler | Audio]` switch.** The
three segments map onto the two existing store fields
(`sourceMode` × `audioLoadTarget`) via a `browseMode` projection on
`browserModeStore`:

| Segment | `sourceMode` | `audioLoadTarget` | Browses | Track |
|---------|--------------|-------------------|---------|-------|
| MIDI    | instruments  | —                 | instrument presets | MIDI |
| Simpler | audio        | simpler           | audio samples | MIDI |
| Audio   | audio        | clip              | audio samples | audio |

`sourceMode` / `audioLoadTarget` stay the persisted source of truth (their
contract test is unchanged); `browseMode` / `setBrowseMode` are the derived label
the component reads and writes. `setBrowseMode` re-skins the pane only when it
crosses the instruments↔samples boundary (MIDI↔Simpler/Audio); Simpler↔Audio keep
the same sample content and drill position and only flip the track kind. The
Simpler and Audio segments disable for a type with no samples
(`audioUnavailableForCurrent`). The switch shows for instrument *type* vendors only.

**2. The mode persists across opens.** `tapRailCategory` no longer resets to MIDI
on a fresh open — it resumes the persisted `sourceMode` / `audioLoadTarget`
(already in `localStorage`). A sample-less type still falls back to MIDI for that
browse. **The replace flows pin their own mode** so persistence can't open them
wrong: `openAudioBrowserForReplace` forces Audio and `openForReplace` forces MIDI
(a resumed sample mode would ignore the replace pin and spawn a new track). Each
also hides the browse switch behind a status pill so the mode can't be flipped
mid-swap.

**3. Prepare the landing-pad track when the mode is committed — on the first drill
*or* a switch tap.** `selectCategory` still marks ready without prepping (tapping a
type just to browse its folders shouldn't spawn a track). `preprepForCurrentMode`
then fires from two places:

- **`enterFolder`, on each drill from the type root** — drilling commits the track
  kind. This is the common path and needs no switch interaction.
- **`setBrowseMode`, on every switch tap** — choosing a mode commits it too.

Both create the track via `prepareTrack`, and the eventual pick reuses it through
Python's server-authoritative create-or-reuse (`TrackPrepareComponent._decide` →
REUSE_EMPTY). **Prep is deliberately liberal:** redundant calls are cheap because
`_decide` reuses an existing empty track and only *creates* a fresh one once the
prepped track has been dirtied (instrument loaded + clip recorded). So a
locked-open browser gets a fresh track for each new instrument, and we don't need
a dedup flag (which would starve exactly that workflow).

- **MIDI and Simpler** prep a **MIDI** track (`prepareTrack('instrument')`). Both
  reuse it cleanly: the instrument load and `loadCaptureIntoSimpler` each re-prep
  an empty MIDI track, which Python coalesces onto the prepped one (single-flight
  per-trackType queue).
- **Audio deliberately does NOT pre-prep.** Live's Browser always creates its own
  track for an `.alc` clip and ignores any prepared slot
  (`TrackPrepareComponent._handle_alc_prepare`), so a pre-prepped empty audio
  track would be stranded beside the clip's — and, auto-armed, would pass live
  input. Audio keeps prepping at load time. Chosen with the user over accepting the
  stray track or adding a Python cleanup-delete.
- Folder-less type roots and Recent keep their load-time prep.

## Consequences

**Positive**
- One control, one tap, for a single decision, and the decision sticks across
  opens — it reads as a working mode, not a per-open default.
- The fresh-track feedback is back for the common instrument and Simpler paths, at
  the earliest point the track kind is known (drill or switch), and — because the
  mode is committed by then — without the open-time race ADR-396 removed.
- Liberal re-prep + Python reuse means the locked-open multi-load workflow (load →
  record → pick another) gets a correct fresh track each time, with no bookkeeping.
- The `browseMode` projection keeps the two persisted fields as the source of
  truth, so nothing downstream (load paths, replace mode, the store contract test)
  changes.

**Negative / trade-offs**
- **Audio mode gets no pre-prep.** Its landing track still appears only when you
  pick a clip. Accepted as the price of never stranding an armed audio track on an
  `.alc` pick.
- **Redundant preps.** Tapping the switch and then drilling (or drilling from root
  after a load) issues an extra `prepare_for_preset`. Each is a cheap reuse, not a
  new track — an accepted cost of never *missing* a prep.
- A sample-less type browsed while the persisted mode is audio falls back to MIDI
  and persists that — so a sample-less type can reset the remembered sample mode.
  Rare in practice (every type currently has samples).
- `browseMode` is a projection, not a stored value, so it can't be persisted
  independently of the two fields it derives from — intentional (there's no fourth
  combination to represent).

## Tags
`browser`, `drill-down-browser`, `audio-samples`, `source-toggle`, `track-prep`,
`browse-mode`, `persistence`, `svelte5`, `ui-architecture`
