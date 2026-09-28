# Manual Test Checklist

Pre-performance smoke ritual + post-major-change verification. Run
through it before a session if you've made non-trivial changes; cherry-
pick the section that matches what you touched if you've made small
ones. Designed to be done in one sitting (~10–15 min for the full pass).

This file is intentionally a checklist, not docs — it pairs with:

- `docs/reference/architecture.md` — process topology
- `docs/reference/wire-protocol.md` — OSC contract
- `documentation/performance-audit.md` — instrumentation + perf flow
- `docs/reference/setup.md` — install + iPad config

Mark a box as you confirm. If a step fails, file the symptom and which
log line surfaced it; don't carry on past a failure unless it's clearly
unrelated to what you're testing.

---

## 0 · Pre-flight

- [ ] Working tree clean (`git status` empty) or all in-flight changes are intentional
- [ ] `config/constants.json` paths point at the local Live install / User Library
- [ ] Ports free: `lsof -i :8081 -i :11020 -i :11021` returns nothing stale
- [ ] `logs/` directory writable, old `bridge.log` archived if you want a clean run

## 1 · Bring-up

- [ ] `npm run dev` starts cleanly — bridge, interface, browser all open
- [ ] Bridge log shows `Bridge process starting` then `WebSocket-OSC Bridge ready`
- [ ] Live opens; the **Looping** control surface is selected in Preferences → Link/MIDI (load it manually if needed)
- [ ] `Heartbeat probe from … args=()` appears in Live's `Log.txt` within ~5 s of the surface loading
- [ ] Browser at `http://localhost:3000` shows the connection badge as connected
- [ ] iPad at `http://192.168.100.1:3000` (or `bj.local:3000`) connects within ~5 s
- [ ] DevTools console shows `V6 session system initialized`

**Exit criterion:** all four endpoints (bridge, interface, Mac browser, iPad) reach a steady state with no `WARN`/`ERROR` lines in `logs/bridge.log`.

## 2 · Handshake + state/full

- [ ] First page load: a single `state/full begin → chunks → end` lands; tracks render
- [ ] Reload the page: a fresh `state/full` lands again; UI re-populates
- [ ] Quit Live and reopen with the surface still selected: surface emits `surface_hello`, UI repopulates
- [ ] `bridge.log` does **not** contain `tick-stall` or `meter-stall` anomalies during bring-up

## 3 · Tracks

- [ ] Track count in UI matches `song.tracks` in Live
- [ ] Click a track → it becomes the selected track (Live's selection follows)
- [ ] ~~Press **+ Audio** on the central display~~ — **STALE**: no + Audio / + MIDI buttons in current UI; track creation is foot-pedal gesture or preset browser load only
- [ ] ~~Press **+ MIDI** → new MIDI track appears~~ — **STALE**: see above
- [ ] Delete a track from Live's UI → UI tree updates within a frame, no orphan rows
- [ ] Foot-pedal hold gesture (or simulate via `/looping/v3/foot/hold`) creates a track + loads default preset
- [ ] Track rename in Live propagates to UI; rename in UI propagates to Live

## 4 · Devices + presets

- [ ] Tap a device slot → preset browser opens with the right vendor/category
- [ ] Load a built-in Ableton instrument → device appears, parameters populate
- [ ] Load an Omnisphere or other AU preset → device appears with `[Device On]` first, then full param list within ~750 ms (post-add reconciler)
- [ ] Drag a parameter slider → value updates locally instantly + Live's value follows within a frame
- [ ] Pointer up → final value matches what the slider shows (no drift from throttle)
- [ ] Reorder devices in Live → UI tree updates; param paths still resolve correctly
- [ ] Remove a device → UI drops the device row + the param-value listeners detach without `WARN` log spam (occasional `DEBUG: stale handle` is fine)
- [ ] **Drum Rack virtual macros (ADR-428):** on an *unmapped* DrumCell
      kit every control on the view (FX pad + its type button, Time XY,
      Start, Gain, Trnsp) moves the pads and one Edit → Undo in Live
      reverts the whole gesture; on a still-*mapped* kit the held
      controls wear the `macro` badge and are inert; a Simpler kit shows
      the Simpler row (Time pad + Trnsp), a Sampler kit the Sampler row,
      a kit of nested Instrument Racks one slider per pad-rack macro
      name, and any other native class the pad-class card + Trnsp; the
      FX-grid Pitch slider and the clip view's ±12 buttons move
      `vm.pitch` on a rack (never the notes) and a kit whose pads are
      tuned differently stays tuned after a move
- [ ] **The pad grid and hold-to-scope (rebuilt 2026-09-09):** the grid
      draws **only the pads in play** — the playing clip's, Live's
      selected pad, anything held — in their chain colours, flashing as
      the playhead crosses them. They stack four down a column and then
      start a second, **lowest note at the foot**, and the tiles fill the
      height (one pad on its own is one full-height tile). With nothing
      playing there is exactly one tile: a pad the clip does not play and
      Live has not selected cannot be reached from here at all, which is
      the deliberate cost of dropping the paged sixteen-tile grid — check
      that selecting a pad in Live's own rack brings it onto the grid.
      Holding a pad selects it in Live and scopes every control — the
      FX-grid Pitch slider included — to that pad, **and the controls
      take that pad's colour** while the Drum and Squash tiles keep
      theirs; lifting returns both. **A held or latched pad wears the ON
      ring** (2026-09-10): the phosphor, with a hairline of the pad's
      text colour inside it — check it on a white pad, where the old
      frame was a bare black outline. **A quick TAP latches instead**
      (same 300ms split as Solo and mute): the pad stays scoped with
      nothing on the glass, tapping it again lets go, tapping another
      moves the latch, and holding a third over a latch returns to the
      latch rather than the kit. Two pads held: the last pressed is
      the number on the control, the other moves by the same delta.
      **PADS** off in the Sections card hides the grid, gives the
      controls its width, and per-pad editing goes with it
- [ ] **Effects on a pad (issue #491, 2026-09-10):** hold or tap a pad
      and the FX grid becomes the pad's — the scope chip names it, the
      grid wears its frame, every tile reads ghost where the pad's chain
      has no such effect and active where it has one — every tile,
      Gtr, Rand Oct and Drum included (2026-09-11). A first DRAG on a
      ghost tile loads that effect INTO the pad
      (confirm in Live's rack: the device sits in the pad's chain, after
      its instrument, as ONE undo step — the insert-by-name path; if
      Edit → Undo first leaves it on the track, the default for that
      device is not the preset: `npm run install-device-defaults --
      --check`). Rand Oct into a pad lands BEFORE the pad's instrument
      and the kit's controls keep working on that pad; Gtr lands after
      it. A tap on a tile opens that effect's view for the pad
      inside the Drum Rack view, under a chip with the pad's name and a
      way back; the pane goes with the hold. Dragging the pad's tile
      moves the pad's copy alone — the track's device of the same kind
      does not move. Lift, and the grid is the track's again
- [ ] **The grid itself (ADR-431, 2026-09-10):** row 1 reads Pitch ·
      Gtr · EQ · Filter · Pedal · **Drum** · Squash-over-Gain; the Drum
      tile is the Drum Buss (transients across, dry/wet up), opens a
      view with the Comp switch and the Boom pad, and under a held pad is
      that pad's Drum Buss (a drag on the ghost tile loads one into the
      kick's chain); Squash and Gain share
      the last column half-height each; the Saturator's XY and its four
      faders are inside the Pedal view; no rail rides beside the Drum
      Rack view any more. A load from any of these tiles onto the track
      must NOT move Live's track selection
- [ ] **Filter (2026-09-09):** the Filter pad sweeps cutoff across and
      resonance up on every kit shape, and **turns the filter on without
      ever turning it off** — sweep cutoff all the way down and the pads
      go silent rather than jumping wide open. A nested-rack or Operator
      kit ghosts it. Confirm on a SAMPLER kit specifically: `F On` is
      measured but `Filter Freq` / `Filter Res` are inferred from
      Simpler's naming, so if the pad ghosts on a Sampler kit that is the
      binding to fix
- [ ] **Gain (2026-09-08):** one slider per kit shape moves how loud the
      pads are — each pad's `Volume` on DrumCell / Simpler / Sampler
      kits, each pad's *chain* volume on a kit of nested Instrument
      Racks — and the kit keeps its balance (a kit built with the kick
      louder than the hats still is after a drag). Held pads scope it
      like every other control. A plugin-hosted kit draws no Gain

## 5 · Transport + session

- [ ] Play/stop button mirrors Live's transport state both ways
- [ ] Tempo slider in UI changes Live's BPM; dragging Live's tempo changes the UI
- [ ] Metronome toggle works both ways
- [ ] Time signature numerator/denominator round-trip
- [ ] Loop start/length round-trip
- [ ] Scale root / mode / name round-trip
- [ ] Groove amount round-trip

## 6 · Clips + scenes

- [ ] Click an empty clip slot on the armed track → records a new clip; clip-state turns red then green
- [ ] Click a playing clip → stops it; state goes back to stopped
- [ ] Delete clip → slot returns to empty
- [ ] Duplicate clip → second slot fills with same content
- [ ] Duplicate region (MIDI only) → clip's loop length doubles in place
- [ ] Launch a scene → every track's slot at that index fires
- [ ] Stop a scene → per-track stops fire (no clip launches stuck "queued")
- [ ] **TrackClipView** (ADR-360): each strip's clip view renders the
      content of the highlighted (or first non-empty) slot — even before
      anything plays — in the track color. Tapping the view selects the
      track and opens Central View detail
- [ ] Launch a clip → playhead line sweeps the visible region; transport
      stop → playhead freezes immediately
- [ ] Drag a loop brace on a playing clip → strip's visible window
      updates without waiting for the next slot change
- [ ] Move Live's clip-slot highlight on a *stopped* track → strip
      retargets to the new slot's content
- [ ] Permute device on a track: when its mute sequencer's current step
      is muted, the strip greys out; when unmuted, color returns. Verify
      independently per track (strips are NOT linked to selection)
- [ ] **Seq Engine (ADR-429):** with the thin Permute on the track and
      Behavior → Seq Engine ON, pitch / mute steps land on the beat (step
      lights on the strip via `/looping/v3/permute/step`); a drum-rack
      pitch step moves every pad +12 and back; Seq Engine OFF restores
      pitch, mutes and temperature. With it OFF a fat Permute's own steps
      still light the strip

## 7 · Capture

- [ ] Press **Capture** while playing → red press state shows instantly (no 300 ms hold-detect lag)
- [ ] On release: capture file appears in the configured directory
- [ ] Captured audio loads back into the source track as a clip on next launch

## 8 · Master + meters

- [ ] Master volume slider round-trips
- [ ] Master mute round-trips
- [ ] Master color/name round-trip
- [ ] Master meters animate during playback (both L and R)
- [ ] Per-track meters animate; idle tracks show 0
- [ ] Hide the meter view → meter messages still arrive on the wire (current bridge behavior; flagged as a perf finding) but UI cost stays low
- [ ] Stop transport → meters return to 0 within ~1 s, don't latch
- [ ] **Sections card** (tap the Main strip): the seven switches —
      Header · Solo · Clips · View · Pads · FX · Flip — each add or
      remove what they name, survive a reload, and every combination is
      legal. Two columns of four; a switch is comfortably finger-sized
      at the default three sections. VIEW hides its own control: a tap
      on the Main strip, on any strip's Clip or Permute section, or a
      long press on a grid cell brings it back

## 9 · iPad-specific

- [ ] Touch interactions feel local (no perceived lag on knob/slider drag)
- [ ] Switch tabs / lock screen for ~30 s → return → UI reconnects via `bridge-resync`, state is current
- [ ] Toggle Wi-Fi briefly → reconnect happens, no permanent disconnect
- [ ] No `Reaping wedged client` lines in `bridge.log` after a normal session
- [ ] No `Health anomaly: ws-buffer:` lines after sustained use

## 10 · Recovery scenarios

- [ ] `kill` the bridge process while UI is connected → UI shows disconnect, reconnects within 30 s once bridge restarts (concurrently auto-restarts in iPad mode)
- [ ] Quit Live mid-session → UI surfaces `tick-stall` after ~3 s, then reconnects clean once Live is back
- [ ] Trigger a Python-side error (e.g. malformed `/looping/v3/param/set`) → `/looping/error` lands; UI shows it; bridge keeps running
- [ ] On reconnect: state/full re-emits, no double-listener leak (verify by checking `param-value` rate in surface profile is stable, not stepped up)

## 11 · Performance smoke

Use the audit instrumentation; details in `documentation/performance-audit.md`.

- [ ] Set `BRIDGE_PROFILE=1` and (in Live's launch env) `LOOPING_SURFACE_PROFILE=1`, restart the stack
- [ ] Idle for 30 s with one client connected:
  - [ ] `node scripts/perf/scenario.mjs idle 30000` shows no surprise inbound (only meters + heartbeat)
  - [ ] `analyze.mjs` reports tick gap < 50 ms, listener fires near zero
- [ ] Tempo sweep:
  - [ ] `node scripts/perf/scenario.mjs tempo-sweep 5000` runs without UI freeze
  - [ ] Outbound rate is exactly 60/s (1 per frame, not higher)
- [ ] Param storm:
  - [ ] `node scripts/perf/scenario.mjs param-storm 5000` runs without UI freeze
  - [ ] Inbound `/looping/v3/param/value` echoes do not exceed outbound count
- [ ] Open `http://localhost:3000/?perf=1` and drag a slider:
  - [ ] Top reactive sources show one or two stores updating at ~60 Hz, not 100s of stores firing
  - [ ] No source above 200/s steady-state
- [ ] After the run, `tail logs/bridge.log` shows zero `Health anomaly:` lines

## 12 · Tear-down

- [ ] `Ctrl-C` the dev runner → `Bridge process exiting` logged with exit code 0
- [ ] Live's `Log.txt` shows `Looping surface disconnecting` then `transport closed`
- [ ] Ports `8081`, `11020`, `11021` free again (no `TIME_WAIT` zombies blocking restart)
- [ ] If you turned profilers on: `logs/bridge-profile.ndjson` and `logs/surface-profile.ndjson` exist and contain at least one record from the run

## 13 · Multitouch (WebKit only)

**This section exists because nothing else can answer it.** The pointer
program (ADR-427) is proved three ways already — the state machines by
unit tests, the wiring by `npm run multitouch` (real Chromium touch input
against the real components), and single-touch portability by
`npm run multitouch:webkit` on a second engine. **None of them is iOS
Safari**, which layers its own gesture recognizers — double-tap zoom,
scroll momentum, touch-delay heuristics — on top of WebKit, and WebKit
under Playwright cannot hold or drag a finger at all, let alone two. So
every item below is a claim only an iPad can settle. Keep the two apart
when you report a result: "the harness passes" is not "it works on the
iPad".

Run it as a fullscreen PWA at 1366×1024 landscape, with a set of at least
eight tracks so the strips row overflows and can actually pan.

### 13.1 Two fingers, two actions

- [ ] Press two different track **names** at once → **both** tracks mute,
      and both mute at **finger-down**, before either hand lifts. (This is
      the headline: on `onclick` iOS synthesized one click per gesture and
      only one muted.)
- [ ] Press two different **Solo** buttons at once → both light.
      Release them in the *opposite* order → both stay latched.
- [ ] Press two **stop** cells in the session grid at once → both stop.
- [ ] Fire two **clip cells'** action strips at once → two clips launch.
- [ ] Press **play** and **metronome** together → both act.

### 13.2 One hand holds, the other works

- [ ] Hold a **Solo** and tap a different strip's name → that strip
      mutes; the Solo is unaffected and stays down.
- [ ] Hold a **Solo** past ~300 ms and release → it un-solos (momentary).
      Hold it while the other hand mutes, then release → still momentary.
- [ ] Hold a **mute** past ~300 ms and release → the track un-mutes
      (momentary, ADR-427 addendum 3). On a ≤13-track set the mute
      starts at touch-down; on a 14+ set it starts at the 300 ms
      threshold instead — a tap is unchanged either way.
- [ ] Tap a mute briefly → it latches, one write, no restore.
- [ ] Start a **volume drag** on one strip; with the other hand mute a
      different strip; keep dragging → the fader keeps tracking **your
      dragging finger**, the mute lands on its own track.
- [ ] Drag the **tempo** digit in the transport header while the other
      hand taps a track name → the tempo follows the digit's finger only.
      (Under `touches[0]` it jumped to the other hand.)
- [ ] Drag a **loop brace** while the other hand holds anything at all →
      the brace follows its own finger. Same for the Simpler sample
      brace, the velocity range brace and the quantize slider.

### 13.3 `touch-action`, which only the device really tests

- [ ] Pan the strips row **starting on the Clip or Permute area** of a
      strip → the row scrolls, nothing mutes, no fader moves.
- [ ] Pan the strips row **starting on a track name**, on a set of **13
      tracks or fewer** → the track mutes and the row does not scroll.
      Expected: below fourteen tracks the row cannot scroll at all, so
      the name band spends nothing keeping a pan it cannot have
      (ADR-427 addendum 2).
- [ ] The same on a set of **14+ tracks** → the row scrolls and the
      track does **not** mute. This is the branch where the wait earns
      its keep.
- [ ] On a set of **13 tracks or fewer**, push a strip's volume with a
      thumb whose first movement leans **sideways** → the fader moves.
      On **14+** tracks the same start pans the row instead (2026-09-25).
- [ ] Start a volume drag with the finger on a **volume tick**, half off
      the strip's edge, or just **between** two strips → the nearer
      strip's fader moves. The gutter used to reach no strip at all.
- [ ] Pan the strips row starting on a **stop** cell or a **group fold
      arm** → the row scrolls, nothing fires.
- [ ] Pan starting on a **Solo** button → nothing scrolls (Solo owns the
      gesture) and solo toggles as normal.
- [ ] Double-tap anywhere on the performance surface → **no zoom**.
- [ ] Two-finger pinch on the strips → no page zoom, no control acts on
      it.

### 13.4 Interruption

- [ ] Hold a **Solo** and, without releasing, fold a group so the strip
      unmounts under your finger → the track does **not** stay soloed.
      (This is the failure that silences every other track mid-set.)
- [ ] Start a volume drag and pull down the iOS notification shade
      mid-drag → the fader stops where it was; nothing runs away.
- [ ] Press a track name and slide off it before lifting, on a set of
      ≤13 tracks → the track mutes at touch-down and stays muted; there
      is nothing to abandon to.

### 13.5 Feedback under the finger

- [ ] Press the **stop** button under the mini session grid (clip view,
      leading column) → it visibly acknowledges the press before the clip
      actually stops. A stop is quantized, so without the mark a press
      that landed looks exactly like one that missed.
- [ ] Press a **clip cell** and a **scene button** → same acknowledgement,
      same weight.

### 13.6 Regressions worth a second look

- [ ] Drag the **master fader** → it must **not** also select master and
      swap the central view when you let go.
- [ ] Drag a control in the right-hand clip rail → the central view must
      not switch on release.

---

## 14 · The swap pill, by hand (ADR-439, ADR-440)

**This section exists because nothing else can answer it either.** The pill's
states are shot by `npm run shot:tour -- central` and its press is a gate step
there (`drumrack-swap-pressed`), but a headless Chromium at 1366×1024 is not a
finger on glass, and the pill now comes in **two shapes** — lying flat over a
view's first group (one touch row tall, split left/right) in most instrument
views and every Drum Rack, and standing as a column down the left edge
(44 px wide, split top/bottom) elsewhere. Neither shape has been touched by
hand. Every item below needs the iPad and a running Live.

Prerequisite: `npm run install-ax-helper` done and Accessibility granted, or
every press answers `ax-helper-down` (INSTALLATION.md Step 9a).

**Reaching it**

- [ ] A flat-pill view (Drift, Wavetable, Operator, Meld, Omnisphere,
      Instrument Rack, Sampler, Simpler): the pill lies over the view's first
      group, reading the preset name left to right, an arrow at each end.
- [ ] Drum Rack view, any kit: flat, over the pads (a DrumCell kit: over pads,
      Gain, Trnsp and Start), reading the kit's name — or only arrows, where
      the pad column is too narrow for a name.
- [ ] A column view (Collision, Electric, Pattern Rack): the left-hand column,
      reading bottom-to-top.
- [ ] Clip view, an audio clip focused: the column, reading the clip's sample.
- [ ] A MIDI clip: no pill.

**Under a finger** — the half you press is the half that steps, and the name
spans both halves with `pointer-events: none`, so a press in the middle must
still reach the half under it. Do each on **a flat pill** (a Drum Rack, and one
instrument view) **and on a column** (the audio clip view):

- [ ] Flat: right half → steps **next**; left half → steps **back**.
- [ ] Column: top half → steps **next**; bottom half → steps **back**.
- [ ] Dead centre, on the name → steps whichever half the finger is on, never
      nothing. (Without `pointer-events: none` the control is dead everywhere
      except two thin strips — that is what the CSS gate in the tour guards.)
- [ ] A flat pill over a single pad column, showing arrows only: both arrows
      still press.
- [ ] A press with the finger arriving at an angle, or rolling slightly: still
      one step, never two.

**What a press must not do**

- [ ] Live's view does not jump anywhere the press did not ask for: the track
      it selects is the pill's own, and the grid does not scroll to another pad.
- [ ] One Cmd-Z undoes the swap whole — samples and chain names together.
- [ ] Press again before the first finishes: the second is refused with a
      reason on the pill (`swap-busy`), the first still completes, and Live
      swaps once.

**When it refuses** — each must read as a phrase on the pill, not a code, and
must clear on its own after ~6 s:

- [ ] A freshly loaded kit, pressing **back**: `swap-at-the-end`.
- [ ] A kit Live's index has not featured: `swap-not-rankable`.
- [ ] Helper stopped (`npm run install-ax-helper -- --uninstall`, or quit the
      agent): `ax-helper-down`, and the pill is dimmed and will not press.
- [ ] A multisampled kit (32 Pad Kit Jazz): refused, not silently unchanged.

**The half no harness models at all**

- [ ] Run it as the fullscreen PWA, not in Safari: the standalone app gets
      ~24 pt less height, and the pill is full-height by design.

---

## When you don't need the full pass

| Change scope | Sections to run |
|---|---|
| UI-only component change | 1, 2, the section that owns the component, 11 |
| Gesture / pointer-handling change | 1, 2, **13**, plus the section that owns the control. `npm run multitouch` first — it is faster and it fails with citations — then 13 for what only WebKit answers |
| Swap pill / similar-sound swap change | 1, 2, **14**, plus 4 for a Drum Rack and 5 for a clip. `npm run shot:tour -- central` first — it shoots every pill state and gates the press — then 14 for what only a finger answers |
| New OSC address | 1, 2, the section that uses it, 10 |
| Drum Rack virtual macro / sequencer engine change | 1, 2, 4, 6, 11 — on the saved test set: a mapped and an unmapped kit of each pad class, a thin Permute on one of them |
| Python surface refactor | 1, 2, 3–8, 11 |
| Bridge change | 1, 2, 9, 10, 11 |
| Wire-protocol version bump | All sections |
| Perf fix | 11 only, twice — before + after, with `analyze.mjs` diff |

## Failure triage

If a step fails, the first three places to look:

1. `logs/bridge.log` — `WARN`/`ERROR` since the last `Bridge process starting`. The healthMonitor names the failure mode (`tick-stall`, `meter-stall`, `ws-buffer`, `broadcast-failures`).
2. Live's `Log.txt` — surface-side exceptions. Search for `LOMListeners:`, `MetersComponent:`, or the component name you suspect.
3. Browser DevTools console — UI-side handler errors and `bridge-resync` events. Switch to `localStorage.setItem('LOG_LEVEL', 'DEBUG')` and reload for verbose output.

If none of those show anything, run the matching scenario from `scripts/perf/` with profilers on; the dumps usually surface what manual observation missed.
