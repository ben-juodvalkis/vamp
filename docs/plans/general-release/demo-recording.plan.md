# Automated Demos and Docs: Plan

**Goal:** a public gallery that shows Looping being used. Each feature gets a short clip:
the iPad interface on one side and **Live on the other, showing the result of the gesture**,
with captions, visible touches and Live's audio. Clips are recorded by a script from
scenario definitions, and a docs page per feature is generated from the same definitions.
Re-running it after a change refreshes the gallery.

**Status:** proposed 2026-09-23. Revised 2026-09-28 (below). **Phase 0 passed on
2026-09-28** on Ben's home Mac (`npm run demo:record`, `scripts/demo/`): `record-and-layer`
end to end, a 19 s side-by-side MP4 with finger circles, captions and Live's audio. Measured:
- ScreenCaptureKit records Live's window while it sits in **another Space**, not on screen:
  no fixed layout, no dedicated display needed.
- Per-app audio took Live's output directly (Live on the Mac's own output here; the RME on
  the rig is still to check).
- Live lists **Vamp Demo** as a MIDI input with Track on, untouched.
- Steps land within a few ms of their beat; the recorded clips match the phrase note for
  note.
- Not yet measured: the reset's time, and the rig.

**The `tour` scenario, 2026-09-28** (`npm run demo:record -- tour --yes`, 87 s): an empty set
to drums, bass and keys, loaded from the browser, recorded from the clip view (clip grid
hidden, FX grid shown), the kit filter, Key Follow, Reverb, Echo and Pedal from the FX grid,
Permute steps, and a mute. Three takes in a row came back the same. The composed frame
(`scripts/demo/design.mjs`) puts the interface in an iPad bezel beside a crop of Live's
window, with numbered chapters in a lower third and title and closing cards. Learned on
the way:
- The runner taps **folder tiles with a mouse-type pointer**. A touch tap opens the folder on
  finger-up, and the click Chromium synthesizes afterwards lands on the preset tile that
  appeared under the finger, loading it. Whether iPad Safari does the same is unchecked.
- **Stamp virtual-MIDI notes with the host time.** Live 12.4 recorded 0-stamped notes ("now")
  for an hour, then silently dropped every one.
- **Writing Live's key turns Key Follow off** (a hand-set key). The reset turns it back on
  over `/looping/v3/session/key_follow`, after the old tracks are gone.
- **Track 0 is never a load target** (`TrackPrepareComponent._decide`), so from Live's one
  empty track the first kit lands on track 2. The scenario deletes the empty track once the
  kit is in.
**Owner:** Ben.

**Related:**
- [README.md](README.md): the general release this gallery is for. [plan.md](plan.md) §8 lists
  the demo.
- `scripts/shot/README.md` (the screenshot and multitouch harnesses this builds on).
- `surface/CLAUDE.md` ("LOM probes").

**Decided (2026-09-23 discussion):**
1. **Side by side with Live.** The gallery shows the gesture and its result in Live, so
   gallery clips are recorded on the real rig, not the mock.
2. ~~**OBS is the recorder**~~, replaced 2026-09-28 by decision 5.
3. **An interface-only variant stays automatic.** The same scenarios run silently against the
   mock on GitHub, as a regression check and a fallback reference.
4. **The hero video (hands on the iPad) is filmed by hand.** No automation for that one.

**Decided (2026-09-28 discussion):**
5. **The recorder is a small Swift tool in the repo** (`scripts/demo/recorder/`), not OBS.
   It records Live's window and the interface's window through ScreenCaptureKit, picked by
   window, not by screen position, plus Live's own audio, into one file on one clock. ffmpeg
   lays out the side-by-side clip from settings in the repo. So a take is rebuilt from git
   alone: no OBS install, no scenes, crops or password living in OBS's settings, and no
   window that must sit at a fixed spot. The cost is a few hundred lines of Swift and no
   live preview.
6. **MIDI tracks first.** A looper records whatever comes in, and on the rig that is the
   guitar mic, so an unattended take would record the room. The first scenarios loop MIDI
   instead: the recorder also opens a virtual MIDI port, **Vamp Demo**, and the scenario
   plays its phrase into it, as a performer's keyboard would. The same notes every run, and
   no extra track on screen. Audio looping waits for a fixed audio source (open question 7).
7. **Steps name a beat as well as a wait.** A wait on Live's state proves a step worked; a
   beat makes every run sound the same. A step can say "at bar 3" and the runner holds it
   until then, reading the song position off the page's own socket. Live's launch and record
   quantization absorb what jitter is left.

---

## 1. What it produces

**A clip per scenario, 1920×1080:**

```
┌───────────────────────────┬───────────────────────────┐
│  Looping interface        │  Live, cropped to where    │
│  (iPad Pro landscape,     │  the result appears        │
│  finger circles drawn)    │  (session slot, device     │
│        960 × 720          │  chain, Drum Rack…)        │
│                           │        960 × 720           │
├───────────────────────────┴───────────────────────────┤
│  Caption for the current step                  360 px │
└───────────────────────────────────────────────────────┘
```

- **Audio:** Live's output.
- **Captions:** a WebVTT sidecar, so the docs page can show, restyle or translate them. A
  burned-in copy for sharing elsewhere is optional (§8, question 5).
- **Poster frame** and a **metadata JSON** per clip: scenario id, title, duration, Live
  version, commit.

**A docs page per feature**, generated from the scenario and its clip:
- the title
- what it does, in one paragraph written in behavior terms
- what it needs: which feature switches, the general-release audit's §7b ids (the same ones
  `/bridge/features` publishes)
- the steps, the clip and a still

**Silent interface-only clips** from the mock, one per scenario, produced by GitHub on every
push (§5).

---

## 2. A scenario

A scenario is data plus a few named steps, not a script per feature. Fields:

| Field | Meaning |
|---|---|
| `id`, `title`, `blurb` | Identity and the paragraph for the docs page |
| `features` | What it needs beyond core looping, as the general-release audit's §7b switch ids (`axHelper`, `captureRecorder`, `totalmix`…); empty means core only. Named `features` to match the bridge's switches rather than a second vocabulary for the same thing. Rig-only scenarios are marked, and the general gallery skips them |
| `set` | Which demo set to start from (§4) |
| `camera` | Where Live looks: a view (`Session`, `Detail/DeviceChain`, …), a track or device to select, and a crop rectangle for Live's pane |
| `steps[]` | Each step: a gesture on the interface (tap / hold / drag / two fingers, with a selector), a caption, a **wait-for** condition on Live's real state, and a dwell |
| `result` | The final check on Live's state. A take whose check fails is kept for debugging and never published |

**Waits are on Live's state, never on timers.** "Clip in slot 3 is playing" is a read through
the LOM probe driver, polled with a timeout. That makes a clip end right after its result
appears, and it turns a gesture that silently did nothing into a failed take rather than a
published lie.

---

## 3. The runner, per scenario

1. **Preflight** (refuse to start and say why):
   - Live is running and its main window is **not a modal dialog**. A dialog stops Live's
     control thread, and the surface then drops every write while the UI looks alive. Check
     via the AX helper's `dump`: main window `subrole == "AXDialog"`.
   - The display is **awake and unlocked**. Screen capture needs it, and a locked screen
     blocks window-level Accessibility and an Apple-event quit of Live.
   - Exactly **one bridge** is running (two fight over the surface's TCP slot).
   - The recorder is built and has Screen Recording permission.
   - The demo set is loaded.
   - The runner keeps the display awake for the run (`caffeinate`).
2. **Reset:**
   - Reload the scenario's set, answering Live's save sheet with Don't Save through the AX
     helper.
   - Or, tried first in Phase 0, **build the set through the LOM**: create the scenario's MIDI
     tracks, insert stock devices by name (`track.insert_device`), set tempo and quantization,
     delete everything else. No `.als` in the repo, no save sheet, and only stock devices by
     construction (§4).
   - Wait for the surface handshake and the first full state.
   - Measure the reset time in Phase 0. If it's slow, group scenarios that share a set.
3. **Camera:** point Live at the result, using wires that exist today:
   - `/looping/v3/view/focus [viewName]` (`ViewComponent`: Session, Arranger, Detail,
     Detail/Clip, Detail/DeviceChain, Browser)
   - `/looping/v3/track/select`
   - `/looping/v3/device/select`
   - or the probe driver's `set song view.selected_track ← {"$ref": "tracks[N]"}`

   The crop on Live's pane is the compositor's, set per scenario.
4. **Record:**
   - Start the recorder on Live's window, the interface's window and Live's audio.
   - Play the steps into the interface, each at its beat (decision 7). Taps and two-finger
     gestures go through CDP `Input.dispatchTouchEvent` (the `Fingers` class from
     `scripts/shot/multitouch.mjs`), so the finger overlay sees real touches.
   - Play the scenario's MIDI phrase into the recorder's **Vamp Demo** port.
   - Set each step's caption as it plays.
   - Wait on each step's condition.
   - After the result check passes and the dwell elapses, stop recording.
5. **Post:**
   - ffmpeg lays out the side-by-side clip from the recorder's one file.
   - Trim to the first gesture minus a beat.
   - Two-pass `loudnorm` on the audio, encoded with `aac_at`.
   - Write the VTT from the step timestamps, the poster frame and the metadata.
   - Output goes to `screenshots/demos/<scenario>/`, which is gitignored.

**Live reads and writes from the runner:**
- `node owner/probes/lom_probe_driver.js '<json>'` for reads and setup. The
  driver sometimes exits SIGSEGV after printing valid JSON, so parse its stdout regardless.
- The `osc` package, straight to 11020, for raw wires.

**The interface pane:**
- The runner launches its own **headed** Chromium through the repo's `playwright`, as an `--app`
  window (no browser chrome) sized to 1366×1024 CSS pixels. The recorder finds it by its
  process, wherever it sits. `--force-device-scale-factor` sets how many screen pixels that
  takes, so it fits beside Live on a small display.
- It points at the real interface **by IP**, `http://127.0.0.1:8889` (or `:3000` under
  `npm run dev`). A `localhost` origin
  tries `looping-studio.local` first and stalls about 20 s (see `scripts/shot/README.md`,
  `--no-mock`).
- **Finger circles** are drawn by an overlay the runner injects with `addInitScript`, fed from
  pointer events. No app code changes, and none in normal use.

---

## 4. Content: the demo sets

- **The general gallery uses a set built from stock Live Suite content** (Core Library and
  official Packs). What viewers see should be what they'd get, which is the general edition.
- **Rig extras** (the pedal gestures, TotalMix, plug-in views) are separate scenarios marked
  rig-only, recorded from a set with your content. They're shown in their own section, or not
  at all.
- Where the sets live is open (§8). `.als` files are gzipped XML and record absolute sample
  paths, so a set in the repo must reference only content every Live Suite install has.

---

## 5. Where it runs and how it starts

**The gallery clips need your Mac with Live**, so they cannot run on GitHub.

- **On demand:** `npm run demo:record [--scenario <id>]`. Preflight gates it, then it runs
  unattended at roughly a minute per scenario. Leave the Mac alone while it runs: the runner
  owns the browser window, Live's window must not move, and AX-driven steps such as the Group
  gesture move the real pointer.
- **Nightly (optional):** a scheduled job that runs only when preflight passes and otherwise
  logs why it skipped.
- **Later:** a spare Mac as a dedicated demo machine, which removes the "leave it alone"
  constraint.
- During a run, turn on **Do Not Disturb** and use a **dedicated Space or display**. A screen
  recording captures whatever appears there.

**The interface-only clips run on GitHub.** The repo has no build or test workflow today, only
the two Claude review workflows. Add one that on every push to `main`:
- boots the mock stack the shot harness uses
- runs every scenario's interface half with Playwright's `recordVideo`
- fails if a scenario's steps no longer find their targets
- uploads the clips

The Live-side waits are skipped there; the mock's inbound recorder (`startMockSurface`'s
`onInbound`) checks what reached the surface instead.

---

## 6. Publishing

- **Site:** a static page per feature plus an index, generated from scenario metadata and the
  media. **GitHub Pages** is the natural public home, which ties into the general-release
  audit's repo decision ([audit.md](audit.md) §5.2: a fresh public repo).
- **Media stays out of the main repo's history.** Clips are megabytes each. Use the public
  repo's `gh-pages` branch or a separate media repo. GitHub Pages allows 1 GB per site and
  100 MB per file, which is enough for short clips. The hero video goes on a video host.
- **Review before going public:** the generated page can be published privately first (for
  example as a claude.ai artifact) and checked.

---

## 7. Phases

**Phase 0: measure on the rig before building anything.**
- The recorder captures Live's window and the Chromium `--app` window by window, with
  neither needing a fixed position. Does it still capture a window that is partly covered?
- **Audio:** does ScreenCaptureKit's per-app capture take Live's output directly, including
  when Live plays through the RME rather than the Mac's default output? If not, fall back to
  a Core Audio process tap, then to the RME loopback as an input device. Per-app capture is
  preferred, because it would also work on a stranger's Mac.
- **MIDI:** does Live see the recorder's **Vamp Demo** port with Track input on, or must it be
  ticked once in Live's MIDI settings?
- **Timings:** how long a reset takes; the latency from gesture to visible result in Live.
- **One hand-written scenario end to end** (`record-and-layer`: record a MIDI loop on one
  track, close it, record a second on another track over it), producing the side-by-side MP4
  with sound and finger circles. That's the go/no-go for the design.

**Phase 1: scenario format and runner.** Preflight, reset, camera, steps, waits, record, post.
Three scenarios.

**Phase 2: the gallery.**
- Six scenarios (§8, question 1).
- The docs-page generator.
- Local preview and a private review copy.

**Phase 3: automation and polish.**
- The GitHub workflow for interface-only clips.
- The nightly trigger.
- **Highlight boxes** on Live's pane: the AX helper's `dump`/`read` return element frames, so
  the control that changed can be outlined.
- The hand-filmed hero video.

---

## 8. Open questions

1. **Which six scenarios first?** Candidates, with what Live's pane shows:

   | # | Gesture | Live's pane shows |
   |---|---|---|
   | 1 | Record a loop (REC) | The slot recording, then looping |
   | 2 | Launch clips and a scene | The session grid playing |
   | 3 | Load an instrument from the browser | The new track and its device |
   | 4 | An FX grid tile | The device landing in the chain, knobs moving |
   | 5 | Drum pads: hold a pad, move a kit control | That pad's parameters moving |
   | 6 | Similar-sound swap (needs the AX helper) | The pads' samples changing |
   | 7 | Key Follow | Live's key and scale changing as clips play |
   | 8 | Permute | Steps running, notes muting and transposing |
   | 9 | Group gesture (needs the AX helper) | Tracks folding into a group |
2. **Demo content:** a stock set for the gallery, with rig extras separate? (Recommended.)
3. **Where the public site lives:** depends on the general-release repo decision.
4. **Recording location:** a dedicated Space or display on your Mac, or a spare Mac?
5. **Captions:** a sidecar file only, or also burned in?
6. **Interface-only clips:** publish them, or keep them as test artifacts only?
7. **Audio looping:** where a fixed audio source comes from (decision 6). Likely a source
   track playing a fixed phrase, fed inside Live into the looping track, with its own output
   silenced. It has to fit how Auto-Arm and the pedal's hold set a track's input, and it puts
   an extra strip on screen.

---

## 9. Risks

- **Live's layout drifts** (window size, zoom, theme, a Live update), which breaks crops.
  Mitigation: pin the display resolution, Live's window size and theme. Phase 3's AX-frame
  crops replace fixed rectangles.
- **Live timing isn't deterministic.** Mitigation: waits on state, not sleeps, and a failed
  check fails the take.
- **A modal dialog mid-run** stops Live's control thread. Mitigation: check it at preflight
  and between scenarios.
- **Permissions:** the recorder needs Screen Recording, granted to the app that launches it
  (Terminal, or Claude). Per-app audio capture may need more.
- **What's on screen is published.** Mitigation: a dedicated Space or display, Do Not Disturb,
  and a review step before anything goes public.
