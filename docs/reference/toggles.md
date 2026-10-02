# Toggles & Gated Behaviors

A map of everything in the system that turns on/off based on a **user
switch**, an **automatic condition**, or a **combination** of both. Use
this to answer "why did (or didn't) X happen just now?". Whether a whole
bespoke subsystem exists on this machine (the TotalMix monitor link, the
Max Utility patch, the expression pedal) is a coarser, config-level switch: see "Feature switches" below.

Two kinds of switch appear throughout:

- **Manual toggles** — user-set flags (`auto_arm`, `move_volume_knob`,
  `auto_capture`, `key_follow`) on the surface
  (`SessionSettingsComponent`). `auto_arm` / `move_volume_knob` default
  **on** and **persist** across set loads / Live restarts
  (`logs/session-settings.json`); `key_follow` (ADR-447) is **on at every surface
  start and not persisted** — a lock, the surface's own when a hand sets the key
  included, lasts until Live restarts or a set loads; `auto_capture` defaults to the
  **launch mode** (ipad→on, dev→off) and a user override is held by the
  **bridge** for its process lifetime (ADR-405) — it survives set loads and
  Live restarts, and resets to the mode default when `npm run dev`/`ipad`
  restarts. See "Manual toggles" below.
- **Automatic conditions** — runtime facts the surface derives:
  - `server_present()` — is a bridge (`npm run dev`/`ipad`) alive? (heartbeat within the grace window)
  - `is_ipad_present()` — is that bridge specifically `npm run ipad`? (heartbeat `mode == "ipad"`)

Some behaviors compose the two. The composition helpers are pure,
testable free functions in
`surface/components/ServerPresenceComponent.py`:

| Helper | Condition | Gates |
|---|---|---|
| `compose_auto_arm_gate(settings, presence)` | `auto_arm` **AND** `server_present()` | arm-follows-selection |
| `compose_capture_gate(settings)` | `auto_capture` (default seeded from `is_ipad_present()`) | auto-record + save-as |

Gates are **pulled at the moment a behavior would fire** (never cached),
so flipping a switch or quitting the server takes effect immediately.

---

## The behaviors

| Behavior | Fires when | Gate | Owner |
|---|---|---|---|
| **Arm-follows-selection** — selecting a track arms it (and disarms the previously auto-armed one) | track selection changes | `auto_arm` **AND** `server_present()` | `ExclusiveArmComponent` |
| **Foot-pedal hold → new track arm** — pedal-hold creates an audio track and arms it | foot `hold` gesture | `auto_arm` only | `FootTriggerComponent` |
| **Foot switch → tap / hold** — the MIDI foot switch on the Looping surface's Input fires the foot gestures | a press of the learned CC | the **foot switch** setting (Settings, behind the gear in the System view: on/off + Learn; `logs/foot-switch.json`); with nothing learned and no `midiPedals.footSwitchCC` seed there is none. A latching switch taps on every stomp and never holds | `FootSwitchComponent` → `MidiPedalInput` |
| **Expression pedal → which rack** — the pedal's sweep and toe switch drive (and summon: toe press or full heel-to-toe rock) the **Wah** on an audio track, **MidiWheels** (its mod wheel; the Expression Pedal rack until 2026-09-25) on a MIDI track — the same device the on-screen wheels load, so one per track; a wah already on the track wins on either kind — the Pedal view's Wah button puts one on a synth track, its hold takes it off (ADR-445) | `/looping/v3/wah/{engage,freq}` gesture | automatic: `track.has_midi_input` + which rack the track carries; `devices.expressionPedal` present in `constants.json` (absent → the wah on every track, as before ADR-445) | `WahPedalComponent` |
| **UI track create/prepare → arm** — loading a preset onto a new track arms it | track prepare/create | `auto_arm` only | `TrackPrepareComponent` |
| **Move volume-knob** — Ableton Move encoder sets selected-track volume | `volume_relative` msg | `move_volume_knob` only | `SelectedTrackComponent` |
| **Move drum-chain knob** — second Move encoder sets the selected drum-pad chain's volume on the selected track's drum rack (ADR-412) | `drum_chain/volume_relative` msg | `move_volume_knob` only | `SelectedTrackComponent` |
| **Auto-record on play** — arm arrangement record when transport starts | transport start | `auto_capture` (default: ipad→on, dev→off) | `PerformanceCaptureComponent` |
| **Save-as on stop** — pop Live's Save As dialog when transport stops | transport stop | `auto_capture` (default: ipad→on, dev→off) | `PerformanceCaptureComponent` → bridge |
| **Start-marker rewind on stop** — park the Arrangement start marker one bar before `song.last_event_time` (floored to a bar line) so the next Play continues the take instead of restarting at bar 1 | transport stop | ownership (`_armed_by_us`) — this component armed the take | `PerformanceCaptureComponent` |
| **The key follows the loops** — `KeyDetectComponent` re-runs the ADR-446 key analysis whenever what is playing changes (a launch, a stop, a delete, a finished take, a moved loop, a note edit — `PlayheadComponent`'s change hook) and writes per `follow_decision`: a key the loops' notes are outside of is replaced; a fitting key stays after a stop or an edit and moves after a new loop on a sure answer, or a plausible one when the key is not Follow's own (ADR-447). | one coalesced pass ~300 ms after a launch, stop or take, ~1.5 s after note changes | `key_follow` only (default **on**; a key picked from the interface, or changed inside Live with no redo waiting, turns it off) | `KeyDetectComponent` |
| **Permute engine** — the surface runs every thin Permute device's two step sequencers (pitch / mute / chance / temperature on the playing clip) and emits their step lights (permute ADR-020); since ADR-435 also a Permute inside a Drum Rack pad's chain, which drives that pad alone (per-pad octave, its own notes' mute and chance, Temperature inert) and composes with the track's | every drain-pump tick while the transport runs | none — always on (the `sequencer_engine` switch went 2026-09-26) | `SequencerComponent` |
| **Permute mute gate** — the mute lane's state goes straight to a `udpreceive` inside a Max device on that track (`/looping/permute/gate`, `osc.permuteGate` 11030), so a device can gate what it *plays* instead of the surface writing a parameter and putting an undo step on Live's stack per transition. Track-level Permutes only; receivers fail **open** after ~2.5 s of silence, and the surface re-states it every second | mute-lane transition, every restore, 1 s heartbeat | `osc.permuteGate` present in `constants.json` (absent → never spoken, every receiver opens) | `SequencerComponent` → `Skaka Metronome Picker` |
| **Metronome pattern auto-pick** — the Skaka Metronome Rack's pattern follows the tempo and meter (16th below 110, 8th below 130, quarter otherwise, 6/4 in 3/4 or 6/4 above 160; both bounds exclusive) | tempo or meter change | macro 1 on **Auto** (picker state 0) — the four pattern cells force instead | `skaka_pattern_pick.js` inside the rack's **Skaka Metronome Picker** (M4L), NOT the surface or the interface |

Note the deliberate split on `auto_arm`: only **arm-follows-selection**
also requires the server to be up. The foot pedal, UI prepare, and
move-knob are hardware/explicit performance gestures — they honor the
manual `auto_arm` switch but not server presence.

The three capture behaviors gate on the single `auto_capture` toggle. Its
**default** is the launch mode — seeded from `is_ipad_present()` on the
first heartbeat (ipad→on, dev→off), so out of the box they fire under
`npm run ipad` and stay silent under `npm run dev`, as before. But the
toggle is overridable from any client (web UI or the `owner/menubar`
utility): a dev session can force capture on, an ipad set can force it off.
An override **holds across set loads and Live restarts** — the bridge
remembers the last client write and replays it over a rebuilt surface's
mode re-seed (ADR-405) — and resets to the mode default when the dev/ipad
script restarts. Because the gate is only checked on the **play edge**,
cleanup on stop is ownership-based — a take armed while the toggle was on
is always disarmed, offered for save, and has the start marker rewound
even if the toggle flipped off mid-take.

---

## Manual toggles (SessionSettingsComponent)

In-memory bools, wire shape `[0|1]`. Set from the UI (or any client),
queryable, and re-seeded to a fresh UI on handshake.

| Toggle | Set address | Query address | Default | Persisted? | Getter |
|---|---|---|---|---|---|
| `auto_arm` | `/looping/v3/session/auto_arm` | `…/auto_arm/query` | on | ✅ disk | `should_auto_arm()` |
| `move_volume_knob` | `/looping/v3/session/move_volume_knob` | `…/move_volume_knob/query` | on | ✅ disk | `should_handle_move_volume_knob()` |
| `auto_capture` | `/looping/v3/session/auto_capture` | `…/auto_capture/query` | launch mode (ipad→on, dev→off) | ✅ bridge-lifetime (ADR-405) | `should_auto_capture()` |
| foot switch | `/looping/v3/session/foot_switch/enabled` (and `…/learn`) | — (state on `/looping/v3/session/foot_switch`) | seeded from `midiPedals.footSwitchCC`, else **none** | ✅ disk, `logs/foot-switch.json` | `FootSwitchComponent`, not `SessionSettingsComponent` |

**Persistence.** Live reconstructs the whole Control Surface on every set
load, so a naive in-memory toggle resets each time. `auto_arm` and
`move_volume_knob` are therefore persisted to
`<repo>/logs/session-settings.json` (written on change, reloaded on
`__init__`) — a user override survives set loads and Live restarts. A
missing/corrupt file falls back to the defaults (both on); if the repo root
can't be located the component runs in-memory-only.

`auto_capture` is deliberately **not** persisted to disk on the surface: it
re-seeds from the launch mode on every init
(`SessionSettingsComponent.seed_auto_capture_default`, driven by
`ServerPresenceComponent`'s `on_first_mode` callback — ipad→on, dev→off), so
switching dev↔ipad resets it to the mode default rather than silently
reusing a stale cross-mode value. Before the first heartbeat it reads `off`
(dev-safe). Surface-side, a user write commits and holds until the next
surface teardown; the mode seed can't clobber a deliberate override.

Because a set load *is* a surface teardown, the surface alone would reset
an override on every set load — so the **bridge** carries it across
(ADR-405, `interface/bridge/handlers/autoCaptureOverride.js`): it remembers
the last WS-client write on the set address for its process lifetime and,
whenever the surface emits a conflicting value (the fresh surface's mode
re-seed arrives ~2s after a set load), writes the remembered value back.
The replay lands as a normal user write, committing the rebuilt toggle.
Net semantics: an `auto_capture` override survives set loads and Live
restarts and resets to the mode default exactly when the dev/ipad script
restarts — which also keeps the original dev↔ipad staleness guarantee,
since switching modes means restarting the script.

---

## UI display toggles (uiPrefsStore, browser-only)

Persisted localStorage flags that shape the **surface layout only** —
they carry no Live state, never reach the wire, and are per-browser (an
iPad and a Mac can differ). Read via `uiPrefsStore`; nothing on the
surface knows they exist.

| Toggle | Storage key | Default | Gates | Set from |
|---|---|---|---|---|
| `sessionMode` | `uiPrefsStore.sessionMode` | off | Session clip-grid section — main-area section 2, scene rail in the matching sidebar row (ADR-415/416) | **CLIPS** button, SystemCentralView → Sections card |
| `showFxGrid` | `uiPrefsStore.showFxGrid` | **on** | FX-grid section — main-area section 4, clip loop brace in the matching sidebar row | **FX** button, SystemCentralView → Sections card |
| `showTransportHeader` | `uiPrefsStore.showTransportHeader` | off | Slim transport header across the top (tempo, transport, STOP ALL, time signature, metronome). **Independent of the section toggles** — any combination is legal | SystemCentralView → Sections card |

**No longer switches (Ben, 2026-09-26):** the central view
(`showCentralView`, was VIEW), the flipped stack (`flipLayout`, FLIP,
ADR-421), the Drum Rack view's pad column (`showDrumPads`, PADS) and the
strips' device band (`showDeviceBand`, INST). All four were default on,
and each is now always on: `uiPrefsStore` still answers them, with
`true`, so the layout code reads them unchanged, and an older install's
stored `'0'` is ignored. The Sections card lists Header · FX · Clips,
top to bottom, the order they sit on the screen. The Solo row (and the
per-strip Solo button it showed) went 2026-10-01: two fingers on a strip
solo it.

### The section stack (ADR-416)

CLIPS and FX are independent switches on a fixed stack of sections,
top to bottom (unflipped): **track strips** and the **central view**
(both always on) · clip grid · FX grid, in their stack order strips ·
clip grid · central view · FX grid. A toggle adds or removes a whole
section and the visible ones split the height evenly — from two sections
to four. Nothing swaps places, and every combination is legal. The
default is CLIPS off, so a fresh install lands on the familiar three:
strips, central view, FX grid.

`showFxGrid` defaults **on**, so it reads inverted from storage: only an
explicit `'0'` turns it off.

### Flip (ADR-421)

`flipLayout` reverses the stack's **order** and nothing else: FX grid on
top, central view, clip grid, track strips against the bottom edge of the
screen — where, on a 12.9" iPad on a stand, the hands actually are. The
right sidebar takes the same reversal, so master · scene rail · quantize
· loop brace still line up row for row with the main area. Inside each
strip only the name band moves (to the foot of the card); Clip stays above Permute, because that pair is a
reading order rather than a stack.

Order-only is what makes it cheap: `flex-direction: column-reverse` (and
one `order: 1`) leave every flex share, gap and measured row pitch
ADR-415/416 depends on exactly as they were, so nothing has to be
re-derived and a capture with the switch off is bit-identical to the
pre-flip build. Five things deliberately stay put — the Solo button, the
clip grid's stop row, the scene rail's footer, the transport header and
each card's own top-edge treatments — see the ADR for why each one. The
TotalMix strip is no longer a row of that sidebar section at all: it
rides inside the master column's key block (2026-08-31), which puts it
under the key band on the very bottom edge under the flip, and leaves
the master fader the same two thirds every track card takes.

Scene rows and clip-grid rows never mirror: scene order is music, not
chrome.

### The mini session column

The mini session column is not a fourth section — it lives **inside**
the central view's, so it never changes `visibleSectionCount` and never
resizes the scene window. `ClipCentralView`'s control rail grows from 9
columns to 10 and gives the extra one — the **leading** column — to
`MiniSessionGrid`: the **selected** track's clip column, rendered by the
same `SlotGrid` the full grid uses, with a per-track stop button in the
same extra row the full grid gives its stop row. It takes the rail's own
pitch, exactly as wide as every fader and button column beside it: it is
a column of that rail, not an annex on its edge. It reads first because
the subject comes before what acts on it — every other column in the rail
acts on the clip this one names. The nine existing columns are placed by
explicit `grid-column` and shift one to the right while it is up, so
their left-to-right order is untouched.

Its stop button must be **exactly one cell tall**, which means the flex
*basis*, not a `height`: in a flex column the basis is the main size, so
a full-pitch basis beside a `pitch - gap` height silently won and drew
the stop a gap taller than every slot above it (92px against 88px cells
at 1366x1024). The full grid's stop row was always right; only the mini
had the bug.

**Why the clip view.** Everything else in that rail is already about the
clip you are looking at — Chance, Temp and Shuffle shape it, REC and
Delete replace it, Loop X2 and the transpose pair edit it. What the rail
could not say was *which* clip: the selection lived a section away in the
grid, or, with CLIPS off, nowhere at all. The mini answers that and makes
it changeable in the same place. The FX grid was the other candidate and
lost on exactly that test: a rack of insert effects on the track has no
claim on which clip is selected.

**It has no switch of its own.** `uiPrefsStore.miniSessionActive` is
simply `!sessionMode` — full grid up, or clips in miniature, never
neither. It did have a `showMiniSession` pref, and the only layout that
pref could buy was "no clips visible anywhere", which is not a layout
anyone wants; it was retired along with its storage key (a stored `'0'`
from an older install is now ignored, pinned by a test). The negation
rather than "always" is load-bearing twice over: with CLIPS on the mini
would repeat a column already drawn under its own strip, and both would
be driving the one shared `sceneWindowStore` window. That window is
also why exactly one of `SceneRail` and `MiniSessionGrid` is ever mounted
— the two effects the rail owns (persisting the offset clamp and keeping
the pedal's row on screen) have to run in either layout, so the mini runs
them for the layouts it owns.

The getter deliberately says nothing about `showCentralView` or about
which central view is selected. Those decide whether the *host* is on
screen, and the host answers that by rendering or not; folding them in
would make the getter claim to mean "is it visible", which it cannot know
(the central section can be on while the view showing is Reverb).

Cell gestures are shared code, not a lookalike:
`components/v6/tracks/composables/slotActions` is called by both
`TracksPanelV6` and the mini. A cell body aims the **foot pedal**, so a
mini that aimed it differently would be worse than no mini at all.

MINI shows as a plain row in the Sections card even in the layouts where
it is moot (CLIPS on) rather than greying out — a control that dims as
you flip its neighbours is harder to read than one that simply remembers
what you asked for.

**Where the switches live.** The **Sections** list in the master-track
central view (`SystemCentralView`), three rows ordered the way the things
they control sit down the flipped screen: Header (top edge) · FX · Clips. Each row says its name and its
state (an On/Off chip), the Settings page's grammar (2026-09-26).

They started at the foot of the *right* sidebar, but every row over there
is level with a main-area section, so they always had to ride inside one;
in the CLIPS-only layout the only row left was the scene rail's footer,
which is exactly one scene-row pitch and could not hold them beside STOP
ALL once the window grew to 8 rows. They then spent a while at the top of
the browser rail (left sidebar), sharing the record button's slot.

The central view is always on, so nothing has to bring it back (a VIEW
switch once lived inside the section it hid, and three gestures turned it
back on; they went with it).

**The scene window scales with the count.** The clip grid's section is
`1/N` of the height, so switching sections off makes it taller — and
`sceneWindowStore` spends that height on more scenes rather than taller
cells: **4 sections → 4 scene rows, 3 → 6, 2 → 8**. The mapping is
`visibleCountForSections()` (pure, tested), fed by
`uiPrefsStore.visibleSectionCount`; the grid and the scene rail both read
the one derived `visibleCount`, so they cannot disagree. Row pitch stays
~48–56px on a 1024px-tall iPad across every configuration.

One automatic condition composes with these: opening the clip editor
(`clipEditorStore.active`) turns `showCentralView` **on** if it is off,
so the editor is visible when it opens. It is **edge-triggered on the
open** — hiding the section again while the editor is still open stands,
and closing the editor never turns anything back on.

---

The getters are handed to the gated components as callables, so they
never read a stale snapshot.

**On the UI side all four are bidirectional.** They mirror into
`session.svelte.ts` (`_autoArmEnabled` / `_moveVolumeKnobEnabled` /
`_autoCaptureEnabled`, fed by `v3Session.ts`), are read locally by
`trackArming.ts` to skip the UI-side arm send when `auto_arm` is off,
**and are written back** from the **Behavior** card in
`SystemCentralView` — the master track's central view, reached by
tapping the master strip. The first three are the same addresses the
`owner/menubar` utility uses, so the two surfaces are interchangeable and
each sees the other's flip via the echo.

**There is no `sequencer_engine` switch any more (2026-09-26).** It was a
switch-over gate between the old fat Permute, which carried its own engine
in Max, and the thin one (`Vamp Devices/Permute/`), which has no code
and is played by the surface's `SequencerComponent`. The engine now always
runs and the fat device's step ingest is gone, so a set still holding a fat
Permute must have it swapped for the thin one — with both, the same clip is
shifted and muted twice.

Those writes are **echo-confirmed, not optimistic** (unlike the
metronome button beside them, which is a LOM attr Live answers for).
These are surface-side bools with no LOM round trip: a write sent
mid-set-load — old surface torn down, new one not yet up — reaches
nobody, and an optimistic flip would leave the button claiming a
behavior changed when it didn't. Same reasoning as the menu-bar app's
checkmarks; the echo lands in ~90ms.

---

## Feature switches (config/constants.json → `features`)

The coarsest switch in the system: whether a bespoke subsystem exists on
this machine at all, so one codebase runs as the owner's rig and as a
general edition on stock Live Suite (`docs/plans/general-release/audit.md`
§7b). Read **once, at bridge start** (`interface/bridge/utils/features.js`),
so flipping one takes a bridge restart and never an iPad rebuild; every
client hears the snapshot as `/bridge/features` (wire-protocol §2.13) on
connect, on change and with the 5 s ping.

- **Only an explicit `true` is on.** A missing switch, `false`, or a value
  that is not a boolean is off; a non-boolean or an unknown key is logged
  rather than dropped. This is deliberately the opposite of the older
  blocks, where deleting `midiPedals` or `devices.wah` brings back built-in
  defaults instead of turning the subsystem off.
- **Enabled, then available.** Off: the UI draws nothing for it. On but
  not yet available: drawn greyed out and inert, saying why — the swap
  pill's grey-with-a-reason. On and available: live. A feature the bridge
  has not named reads as off in the UI (`bridgeStatus.feature()`), so a
  Mac without the hardware never flashes its controls.

| Switch | Off | On — unavailable until | Readers |
|---|---|---|---|
| `totalmix` | No TotalMix sockets (9003, 11019) and no startup bootstrap on 7001; no `osc.totalmix*` block is read; nothing about a mixer is logged. No status-strip mirror. | TotalMix answers on either OSC controller: the startup bootstrap's read of controller 1, or any packet on Global OSC (controller 3). The reason reads `Waiting for TotalMix` until the bootstrap ends, then `TotalMix not answering`; `TotalMix config missing` when the switch is on and an `osc.totalmix*` block is not. Once available it stays so: the mixer sends no heartbeat, so its going away cannot be seen. | `enhanced-osc-bridge.js` (link, ports, bootstrap); `bridgeStatus.isFeatureOn` / `unavailableReason` in `+page.svelte` |
| `maxUtilityPatch` | Neither `npm run dev` (`open:max`) nor `npm run ipad` opens `owner/Max Patches/Max Utility 1.0.maxpat`, so standalone Max never starts: no Move knobs or pad hold, no Move → TotalMix knobs, no CC 67 piano-pedal looper, no SoftStep/EV-1 remap. Settings (behind the gear in the System view) draws no **Move Knob** switch. The on-screen pitch/mod wheels do **not** hang off it: since 2026-09-25 they drive the `MidiWheels.amxd` device through the surface (`/looping/v3/wheels/*`), with no standalone Max and no switch. | Never: the bridge cannot see the patch (its only packet toward the bridge is the TotalMix device's hello), so on reads as available, as it did before the switch. | `scripts/open-max-patch.js` (both launch sites); `SettingsPage` |
| `menubar` | Neither `npm run dev` nor `npm run ipad` builds or launches the menu-bar app (`owner/menubar`): `scripts/launch-menubar.sh` exits at once, and `setup-ipad.js` never calls it. Nothing else changes: the app only mirrors toggles the System view has. | Never: the app is only ever a client, so on reads as available. | `scripts/launch-menubar.sh`, `scripts/setup-ipad.js` |
| `axHelper` | The bridge builds no helper client, dials nothing and sends no `/bridge/ax_helper`; a stray Reverse, Group or swap request is answered `ax-helper-down`; `npm run ipad` never opens Live's Save As dialog. The clip view draws no **Rev** (to Simpler takes the column) and no **Group** (Dup Trk takes the column), and a held Drum Sampler pad's pill steps the kit instead of Live's similar samples. | The helper is connected and trusted. Greyed out meanwhile, with `AX helper not running` or `AX helper needs Accessibility`; unlike the others it goes back when the helper does. | `enhanced-osc-bridge.js`; `ClipCentralView`, `useInstrumentSwap` |
| `expressionPedal` | The surface claims neither of the wah's CCs (`midiPedals.wahToeSwitchCC` / `wahExpressionCC`), so they reach Live like any other MIDI on the port; the `/looping/v3/wah/*` OSC wires stay. The Pedal view draws no **Wah** column. The foot switch is **not** part of it: that is a user setting (below, "Foot switch"). Read by the surface too (`config_loader.feature_on`), once, when it is built. | Never: the pedal reaches the surface as MIDI the bridge never sees, so on reads as available. | `LoopingSurface._setup_midi_pedal_input`; `PedalCentralView` |

Still to come (`docs/plans/general-release/plan.md` §4): `pluginFx`, a
row here once it is wired. The capture recorder is **not** a switch (decided
2026-09-27): every edition has it, since it needs only Max for Live. It rides
`/bridge/features` as `captureRecorder`, always enabled, so REC greys out
with `No recorder on Return A` until the device says hello
(`interface/bridge/handlers/captureRecorder.js`, wire-protocol §2.15).
Two names from §7b's first list will not become switches: the Skaka view
already appears only for a rack whose first macro reads "Pattern N", and
Permute's Place becomes an onboarding step. (`move` folded into
`maxUtilityPatch`: the Move reaches the surface only through the patch.
`footSwitch` never became a switch: any MIDI foot switch is anyone's, so it is
a user setting with Learn — below.) The tracked `config/constants.json`
leaves every switch off; the rig's `config/constants.local.json` turns them
on.

### Foot switch — a user setting, not a feature switch (2026-09-26)

The Settings page's **Foot Switch** card (behind the gear in the System view): on/off, what it is (`CC 23 · Ch 10`,
`· Latch` for a latching switch), a dot filled once the pedal has been heard,
and **Learn**. Learn takes the next CC on the Looping surface's MIDI Input as
the switch and tells momentary (tap and hold) from latching (tap only); nothing
within 10 s says to set the pedal as Looping's Input in Live's MIDI settings —
the one step the app cannot take. The surface owns it (`FootSwitchComponent`),
persists it to `logs/foot-switch.json`, and seeds it from
`midiPedals.footSwitchCC` only when nothing is saved; with neither there is no
foot switch at all.

---

## Catalog-generation flags (config/constants.json → `catalog`)

They shape the Places catalog the Places service builds
(`interface/src/lib/server/places/service.ts`; before 2026-09-26
`scripts/generate-places-catalog.ts`, which `npm run dev` / `npm run ipad`
re-ran on every start). The tuning is part of each catalog's stamp, so an
edit lands on the next rebuild the service runs (a tick, a `Library.cfg`
change, an index write with the index source, or `POST /api/places/rebuild`),
not on reload. `source` picks the reader, `disk` or `index`.

| Flag | Default | Shapes |
|---|---|---|
| `maxFolderDepth` | 2 | Folder-nesting cap in every Place (ADR-392/403): a folder at the cap absorbs everything below it, and the browser re-groups the flattened presets under their origin folders. A Place's `Samples` folder is exempt and keeps full nesting. |
| `places.<Name>` | Bass and Perc carry `flattenFolders` | Per-Place tuning, keyed by the Place's sidebar name: `maxFolderDepth` (overrides the global), `flattenFolders` (ADR-408, collapse a branch below the cap; paths are `<Place>/<folder>`), `keepNestingFolders` (ADR-420, exempt a branch from it; breadcrumb label chains; a keep entry wins over a flatten entry and the cap), and `role` (the track role and color a load from the Place records; by default read from the Place's name, `null` for none). |

The type catalogs' flags — `groupVariants`, `flattenAudioVendor`,
`mergeAudioIntoInstruments`, `oversizeLeafWarn`, `skipVendorFolders` and the
vendor-qualified global `flattenFolders` / `keepNestingFolders` — went with them
at the browser-places cutover (2026-09-24). The Places catalog never groups
files by base name, so a tile is always one file, and the **folder-hold →
random preset** gesture (`adapter.getRandomPreset`, a uniform pick over the
folder subtree) is the only random pick.

---

## Session / transport toggles (SessionComponent)

Live song attributes that are **both observed** (emit on change) **and
UI-settable** (`handle_set_*`). These are direct pass-throughs to Live —
no gate. Full list in `wire-protocol.md`; the toggle-shaped ones:

| Attr | Address |
|---|---|
| `metronome` | `/looping/v3/session/metronome` |
| `session_record` (Session overdub) | `/looping/v3/session/session_record` |
| `loop` | `/looping/v3/session/loop` |
| `is_playing` | `/looping/v3/session/is_playing` |
| `scale_mode` | `/looping/v3/session/scale_mode` |

Transport is also driveable by write-only commands (no observer):
`play_cmd`, `stop_cmd`, `continue_cmd` under `/looping/v3/session/`.

The **foot pedal tap** toggles `session_record` (overdub) directly when a
*playing* clip is highlighted. A *recording* one fires instead, which ends
the take and launches it as a loop — see `FootTriggerComponent` for the
full branch (a recording clip also reports `is_playing`, so the order of
those two checks is what makes the cycle work).

---

## The server-presence signal (the thing most gates read)

`ServerPresenceComponent` turns the bridge's
`/looping/v3/server/heartbeat [seq, epochMs, mode]` into runtime
predicates:

- `server_present()` — a heartbeat landed within `graceWindowMs`
  (default 6s). Presence-based, so a clean quit and a `kill -9` both just
  stop the beat and lapse the window — no goodbye event needed.
- `is_ipad_present()` — present **and** `mode == "ipad"`. The bridge
  stamps `mode` from `LOOPING_SERVER_MODE`, set by the npm scripts
  (`dev:bridge` → `dev`, `dev:bridge:ipad` → `ipad`).

Presence is also refreshed on every handshake accept, so set-load /
Live-restart recovery is instant rather than heartbeat-cadence-delayed.

See `wire-protocol.md` §2.12–2.14 for the wire details and
`interface/bridge/CLAUDE.md` for the bridge side.
