# ADR-396: Audio/MIDI as a per-browse top-bar switch (+ Perc as a first-class type)

## Status
**Accepted** (revises ADR-395)

## Context
ADR-395 made **Audio the source axis** over the drill-down browser's type
buttons: a persistent **rail toggle** (`browserModeStore.sourceMode`, a capsule
switch) re-skinned every type button between instrument presets and audio
samples. It also front-loaded an **empty MIDI-track prepare** on browser open
(`selectCategory` → `TrackPrepManager.prepareTrack`) for instrument types, giving
instant "a fresh track appeared" feedback — while audio and replace modes
deliberately skipped it.

Two frictions emerged in use:

- **The source axis lived on the rail, away from where you act.** You set
  MIDI-vs-audio once — globally and *persistently* — on a capsule in the left
  rail, then drilled into a type. But "instrument or sample?" is a per-browse
  question tied to the type you just opened, not a global mode. Persisting it
  meant the browser's content depended on a choice made in a previous session.
- **The up-front prepare paid for its feedback with real complexity:** a race
  between the pre-prep and the deferred audio-track create, guarded by
  `prepSkipped` / `hasPendingOrReadyPrep` / "don't start a second prepare" logic
  threaded through `selectCategory`, `ensureTrackPrepared`, and `TrackPrepManager`.

Separately, the preset library grew a **seventh top-level type — Perc**
(percussion: `perc.json` + `audio-clips-perc.json`), previously only a subfolder
inside Drum. It needed a rail button.

## Decision

**1. Audio/MIDI moves from the rail to the browser top bar, as a per-browse
switch.** The rail carries instrument *types* only. With a type open, the top bar
shows a `[MIDI | Audio]` segmented switch (`setSource`) driving the same
`browserModeStore.sourceMode`; when Audio is on, the existing `[Clip | Simpler]`
load-as switch appears beside it.

- **A fresh open always starts in MIDI.** Source is a per-browse choice:
  `tapRailCategory` resets `sourceMode` to `instruments` when the browser was
  closed. While it stays open, switching types keeps the current source (so you
  can sweep samples across types). A pending clip-replace forces Audio.
- **Empty-type handling moves off the rail.** Instead of greying rail buttons in
  audio mode, the top-bar **Audio** segment is `disabled` when the open type has
  no samples (`audioUnavailableForCurrent`, from `audio-clips-index.json`). The
  switch shows for type vendors only (not Recent/Scale).

**2. No up-front track prepare on browser open.** `selectCategory` calls
`skipPrepAndMarkReady()` for **every** source. Each load path preps its own track
at load time (`loadPresetWithVariant` → `prepareForPreset`): the instrument branch
creates/reuses a MIDI track, the audio clip/Simpler branches create theirs. This
drops the "empty MIDI track appears on open" feedback — an explicit, accepted
trade — and with it the pre-prep/deferred-create race and its guard logic.

**3. Perc is a first-class rail type.** Given `perc.json` + `audio-clips-perc.json`,
Perc is already in the generated types index, so it flows into `baseVendors`
automatically. Wiring: a `perc` colour in `constants.json` (`#f3722c`), and a rail
rearrange — **Drum** fills the group-1 slot the Audio capsule vacated, **Perc**
takes Drum's old group-2 lead. All three rail groups stay at three slots so they
keep aligning with the main content rows.

## Consequences

**Positive**
- The MIDI-vs-audio decision sits where you make it — in the open browser, next
  to the content — scoped to the browse rather than a global persisted mode.
- Removing up-front prepare is a net simplification (~140 fewer lines in
  `DrillDownBrowser.v6.svelte`, and the deletion of a genuine race class). **No
  Python changes.**
- Perc slotted in on data-only work already done; the UI cost was a colour + a
  rail rearrange. Both MIDI and Audio browse work for it out of the box.
- The clip-replace flow is preserved (forces Audio, shows the "Replace clip"
  pill; switching to MIDI cancels the pending replace).

**Negative / trade-offs**
- **No empty-track feedback on open.** Opening a type no longer shows a fresh
  track until you pick a preset. Accepted with the user.
- **`sourceMode` is still persisted by the store but reset on each fresh open by
  the component** — a slight split (the store's contract test still asserts
  persistence; the component owns the "fresh open = MIDI" behaviour). It reads as
  per-browse in practice.
- **Greying now depends on the open type,** not the whole rail — a sample-less
  type's Audio segment disables, but you only learn that after opening the type.
- ADR-395's rail-toggle/capsule decision and its up-front-prep exemption are
  superseded here. ADR-395 remains as historical record (per the ADR convention);
  current code and this ADR win where they differ.

## Tags
`browser`, `audio-samples`, `drill-down-browser`, `source-toggle`, `perc`,
`track-prep`, `svelte5`, `ui-architecture`
