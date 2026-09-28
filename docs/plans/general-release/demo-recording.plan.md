# Automated Demos and Docs: Plan

**Goal:** a public gallery that shows Looping being used. Each feature gets a short clip:
the iPad interface on one side and **Live on the other, showing the result of the gesture**,
with captions, visible touches and Live's audio. Clips are recorded by a script from
scenario definitions, and a docs page per feature is generated from the same definitions.
Re-running it after a change refreshes the gallery.

**Status:** proposed 2026-09-23. Nothing built yet.
**Owner:** Ben.

**Related:**
- [README.md](README.md): the general release this gallery is for. [plan.md](plan.md) §8 lists
  the demo.
- `scripts/shot/README.md` (the screenshot and multitouch harnesses this builds on).
- `surface/CLAUDE.md` ("LOM probes").

**Decided (2026-09-23 discussion):**
1. **Side by side with Live.** The gallery shows the gesture and its result in Live, so
   gallery clips are recorded on the real rig, not the mock.
2. **OBS is the recorder**, driven by the scenario runner over its WebSocket API (built into
   OBS since v28).
3. **An interface-only variant stays automatic.** The same scenarios run silently against the
   mock on GitHub, as a regression check and a fallback reference.
4. **The hero video (hands on the iPad) is filmed by hand.** No automation for that one.

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
   - OBS is up with its WebSocket enabled.
   - The demo set is loaded.
   - The runner keeps the display awake for the run (`caffeinate`).
2. **Reset:**
   - Reload the scenario's set, answering Live's save sheet with Don't Save through the AX
     helper.
   - Wait for the surface handshake and the first full state.
   - Measure the reload time in Phase 0. If it's slow, group scenarios that share a set.
3. **Camera:** point Live at the result, using wires that exist today:
   - `/looping/v3/view/focus [viewName]` (`ViewComponent`: Session, Arranger, Detail,
     Detail/Clip, Detail/DeviceChain, Browser)
   - `/looping/v3/track/select`
   - `/looping/v3/device/select`
   - or the probe driver's `set song view.selected_track ← {"$ref": "tracks[N]"}`

   Then set the crop on Live's pane in OBS.
4. **Record:**
   - Start recording in OBS.
   - Play the steps into the interface. Two-finger gestures go through CDP
     `Input.dispatchTouchEvent`, reusing the `Fingers` class from `scripts/shot/multitouch.mjs`
     with a `hasTouch` context. Drags go through `page.mouse`.
   - Set each step's caption as it plays.
   - Wait on each step's condition.
   - After the result check passes and the dwell elapses, stop recording.
5. **Post:**
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
  window (no browser chrome) sized to 1366×1024 CSS pixels, at a fixed screen position that
  OBS captures.
- It points at the real interface **by IP**, `http://127.0.0.1:8889`. A `localhost` origin
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
- OBS captures Live's window and the Chromium `--app` window side by side, at stable positions.
- **Audio:** does OBS's application audio capture take Live's output directly, or does it need
  the RME loopback as an input device? Pick whichever is clean. Application capture is
  preferred, because it would also work on a stranger's Mac.
- **OBS from Node:** connect with a password, start and stop recording, set a scene item's
  crop, update a text source.
- **Timings:** how long a set reload takes; the latency from gesture to visible result in
  Live.
- **One hand-written scenario end to end** ("launch a clip"), producing the side-by-side MP4
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

---

## 9. Risks

- **Live's layout drifts** (window size, zoom, theme, a Live update), which breaks crops.
  Mitigation: pin the display resolution, Live's window size and theme. Phase 3's AX-frame
  crops replace fixed rectangles.
- **Live timing isn't deterministic.** Mitigation: waits on state, not sleeps, and a failed
  check fails the take.
- **A modal dialog mid-run** stops Live's control thread. Mitigation: check it at preflight
  and between scenarios.
- **Permissions:** OBS needs Screen Recording, and application audio capture may need more. The
  OBS WebSocket password is kept gitignored, the way `config/.ws-secret` is.
- **What's on screen is published.** Mitigation: a dedicated Space or display, Do Not Disturb,
  and a review step before anything goes public.
