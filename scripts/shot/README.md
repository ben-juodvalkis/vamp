# scripts/shot — headless screenshots of the interface

Take a picture of the UI with **no Ableton Live, no Python surface, no
bridge and no iPad**:

```bash
npm run shot -- session
# → screenshots/session.png
```

Built for the case where the person driving the work is on a phone and
the Mac with Live on it is somewhere else. A remote session can now see
what a layout change actually looks like instead of reasoning about CSS
in the dark.

## What the mock can show

The mock surface is not just a tree dump — it answers the pulls a session
grid makes, so the states that matter are capturable:

| Signal | How | Note |
|---|---|---|
| Clip content (MIDI) | answers `clip/notes/get` with a deterministic phrase derived from the clipPath | never random: a `--diff` compares byte for byte |
| Audio vs MIDI | answers `clip/sample/get` (`isAudioClip` from the scene's track kind) | a cell draws NOTHING until this reply lands, whatever else it knows |
| Song position | the scene's `session` block carries a STATIC `/looping/v3/session/song_time` (6.5 beats → `2.3.3` in 4/4) | static on purpose: a moving value would land every capture on a different frame |
| Playing / recording | emits `track/playing_slot` for every clip the scene marks `SLOT.playing` / `SLOT.recording`, after each `state/full` | without it the grid demotes those slots to plain chips — `deriveSlotCellState` treats a snapshot transport state as stale unless the live channel confirms it |
| Device properties | answers `property/subscribe` per device first (`scene.deviceProperties[devicePath]`, filled from a device entry's `properties` in `scene.mjs`), then by name (`scene.properties`, then `PROPERTY_DEFAULTS`); echoes `property/set` as `property/value` | the Drum Rack view reads its seven controls as `vm.*` virtual macros plus the `vm.members` census (ADR-428) and would sit at rest without an answer; the defaults put every control off-centre so a shot shows them alive. Per-device answers are what let the two fixture kits differ: **Drums** carries an unmapped DrumCell kit (everything live), **Jazz** (track 8) a still-mapped Simpler kit, which the view renders as the Simpler row — the Time pad and a Trnsp slider badged "31/32 macro"; **Ethnic** (track 9) a kit of nested Instrument Racks, rendered as the rack-macros profile — a slider per pad-rack macro name, Pitch Attack + Pitch Amount as one XY pad, Trnsp in the Transpose macro's place, Room reaching 20 of 32 pads; **Autumn** (track 10) a Sampler kit, rendered as the sampler profile — the Sampler row: Osc, Pitch and Time pads, Decay / Sustain / Spread and Trnsp. A per-device `null` is the surface's `nil` for a function the kit has no member for. Since 2026-09-08 each census also lists its **pads** (`kitPads`), which is what the pad grid on the left of every Drum Rack view draws, and pad 38 answers its own `vm.pad.38.*` rows per kit. Since 2026-09-09 the grid draws only **the pads in play** — the playing clip's, Live's selected pad, anything held — stacked four to a column, so *which* tiles exist depends on the track: **Jazz** (track 8) has no clip playing and is selected on 38, which is why `--hold '.pad-tile[data-note="38"]'` photographs the controls re-adjusting to a held pad **there**; on **Drums** that selector times out, and correctly — that track's clip is playing (36 · 50 · 54 · 56 · 57 · 59 · 62 · 63 under the synthetic scene, its Kick selected) and there is no tile 38 to hold. Hold a note the grid actually draws. The pad grid itself is switchable: seed `uiPrefsStore.showDrumPads` `'0'` (a view in `views.mjs`, or a `--click` on the Sections card's PADS row) to shoot the controls at full width. Every fixture census also answers **`gain`** — a member per pad on the three instrument kits, and on **Ethnic** the pads' own chain volumes, which is the only fixed function that kit answers besides pitch |
| Track selection | answers `track/select` with `selected_track` | a `--click '[data-track-index="8"]'` selects that track — but the strip's centre is its Permute section, so the click opens the sequencer view, not the instrument's. Use `--click '[data-track-index="8"] [data-section="device"]'` instead — the strip's device band, which selects the track AND opens that instrument's view in one tap; that is how the Jazz (8) and Ethnic (9) Drum Rack views are shot. It was a tap on the FX grid's instrument tile until 2026-09-15, when that tile left the grid with the ten-column cut |
| Key Follow (ADR-447) | echoes `session/key_follow` 0/1 | drives the picker's Following / Locked button and the lock on the Master strip's key band |
| Key detection (ADR-446) | answers `session/scale/detect` with the rig set's `scale/detected` line (C Minor, sure, gap 67 %, runner-up F Dorian); `apply=1` also echoes `scale_root` / `scale_name` / `scale_mode` | what the picker's Detected strip photographs: `--click '.key-band' --click '.detect-btn'` |
| Drum pad chains (issue #491) | answers `vm.padFx` from the scene's `padRacks` table (every Drum Rack's census pads, each with its instrument, plus the effects a device entry's `padChains` puts after it — `{ 38: ['Reverb'] }`), a `vm.padChain.<note>` subscribe with the pad's presence entry AND a pad-scoped `state/full/tree` (reason `pad-chain`), and a pad-targeted `device/load` by inserting the preset's device where the surface would put it — a MIDI effect (`Random`, `Chord`, … typed 4 off the class table) after the chain's leading MIDI effects and ahead of the instrument, anything else at the end (`padChainOrder`, 2026-09-11; before that every load appended, a Rand Oct behind the kick) — advancing the generation (a pathless `state/invalidate`) and re-emitting presence and the bundle | **Jazz** (track 8) pad 38 carries a Reverb and, since ADR-435, a Permute of its own (so its tile wears a step strip, and holding it makes the strip's Permute section and the Permute view that pad's), **Drums** (track 0) pad 50 a Delay. Hold or tap a pad tile and the FX grid becomes the pad's: `--hold '.pad-tile[data-note="38"]'` on Jazz shows the scope chip and frame with the Reverb tile active and every other tile ghost (since 2026-09-11 every tile may live on a pad, Gtr and Rand Oct included); tap the tile instead (`--click '.pad-tile[data-note="38"]'`, which latches) and then `--click '.device-control:has-text("Reverb")'` to open that effect's view for the pad inside the Drum Rack view (`[data-vm-pane="reverb"]`); `--drag '.device-control:has-text("Delay")'` under the latch loads a Delay INTO the pad — a tile loads on its first DRAG frame, never on a tap (ADR-167), so this is a `--drag`, not a `--click` — and the tile goes loading → active as the mock answers, with the pane showing the Delay view for the pad. Device names follow the preset FILE (`Delay.adv` → Delay) and classes the `DEVICE_CLASS_NAMES` table, which since 2026-09-10 carries the classes Live really reports for the app's presets (`Reverb` → `Hybrid`, `Auto Filter` → `AutoFilter2`, …): before that every fixture Reverb and Filter tile read ghost while the track plainly carried one |

Audio clips answer with an empty `filePath`: there is no real file to read
peaks from here, so an audio cell draws its chip and no waveform. MIDI is
the covered half.

**Animations.** A recording clip's cell pulses and a queued launch blinks, so a
capture lands on a different frame every run. `npm run shot -- … --reduced-motion`
emulates `prefers-reduced-motion: reduce`, which the app already answers by
keeping the mark and dropping the animation. Pass it on both sides of any
`--diff`.

## What it replaces

The old process was: be at the Mac, `npm run dev`, have Live open with a
set loaded, drive Playwright MCP against `localhost:3000`, and read the
PNG out of `.playwright-mcp/`. Four preconditions, three of them
physical. This harness has none of them.

```
before:  Mac + Live + bridge + Playwright MCP  ─▶  PNG
after:   node scripts/shot/shot.mjs            ─▶  PNG
```

## How it works

`shot.mjs` stands up three things and tears them down again:

1. **`mock-surface.mjs`** — a WebSocket server that speaks enough of the
   [v3 wire protocol](../../docs/reference/wire-protocol.md) to replace the
   bridge, the Python control surface and Live all at once: handshake (§5), a
   single-chunk `state/full` bundle (§2.2), resync (§2.4), and the liveness
   beats the client watchdog expects. It takes `:8081` when that is free and a
   free ephemeral port when a real bridge already holds it — either way the
   page's socket is **routed** to it (see "Shooting while the rig is running").
2. **A web server.** By default **`vite dev` on `:5174`**, left running
   between runs so the next one finds it warm (see "The dev server"); with
   `--prod`, **a production preview server** (`vite preview` on `:4173`),
   built first if there's no build yet — never one this run did not start
   (see "If the preview port is taken"), and gone when the run ends (see
   "When a run ends, its preview ends with it").
3. **Chromium**, at iPad Pro landscape viewport (1366×1024 @2×), with
   the view's `localStorage` prefs seeded *before* first paint so the
   capture is never mid-transition.

The UI is not modified or aware of any of this — it performs the same
handshake it always does and gets the answers it always gets.

## The dev server (the default since 2026-09-26)

Every capture used to drive the production build, and `vite preview` shows the
LAST build, so each edit-and-look round began with `npm run build`: 41 s of a
~60 s round on a Linux container, the captures themselves the other 10–20.
Now `shot`, `shot:tour` and `multitouch` drive `vite dev`:

| | cold (first run of a session) | warm |
|---|---|---|
| `npm run shot -- default` | ~40 s | **8 s** |
| `npm run shot:tour -- central --only system --only fx-pedal` (5 states) | 58 s | **21 s** |
| the old way, build + tour | ~60 s | ~60 s |

- **It stays up.** The first run starts it detached (output in
  `scripts/.cache/shot-dev-server.log`, pid in `shot-dev-server.json`) and
  every later run reuses it; vite's watcher keeps it on the current source.
  `npm run shot:stop` stops it. A server on `:5174` that this checkout did not
  start is refused, as the preview always was (`SHOT_DEV_PORT` moves it).
- **A cold server compiles the app on its first load** (~30 s), so each run
  loads the page once before its captures (`warmPage`), and every capture
  settles from the moment the page reaches the mock, not from `load`.
- **It is pixel-identical to the build.** `shot -- default --fixture-data`
  under `--prod` and under the dev server: 0 of 5,595,136 px differ. So a
  `--diff` pair is valid whichever server took each side.
- **`--prod`** is still there for the shipped bundle itself (minification, the
  PWA service worker, code splitting). It photographs the last build.
- `vite.config.ts` pre-bundles `devalue`: found mid-load, it made vite reload
  the page in the middle of the first capture.

## Shooting while the rig is running

**Nothing to stop, and nothing to configure.** `npm run shot`,
`npm run shot:tour` and `npm run multitouch` all work with `npm run dev` or
`npm run ipad` up and Live open. Measured on this Mac with the bridge live:
the 35-state central tour came back 35/35, layout-checked, in 75 s, and
`logs/bridge.log` grew by **0 bytes** — the captured page never spoke to the
bridge at all.

How, and why it needs saying: the port the client dials is **compiled into
the page** (`WebSocketConnection.ts`), so a mock that simply moves off it
moves only the server, and the page keeps dialling :8081 — a running bridge,
whose answers are the live Ableton set. That capture comes back looking
perfectly plausible, which is what made it dangerous. So the two halves are
done together and never apart:

1. the mock takes a **free ephemeral port** when :8081 is busy, and
2. every Playwright context **routes** the page's socket to it
   (`context.routeWebSocket`), with `route.connectToServer()` deliberately
   never called — there is no socket to :8081 to leak through. Nothing the
   page does can reach the bridge: not a watchdog force-close, not the
   reconnect backoff walking to the next candidate URL.

Three consequences worth knowing:

- **A capture whose page never reached the mock is refused**, rather than
  written. That is the loud version of the old trap: zero mock clients means
  the picture is of whatever else answered.
- **Do not bind :8081 by hand.** `SHOT_MOCK_PORT` is refused for this reason,
  and the reason is not the one you would guess: on macOS a second bind to
  `127.0.0.1:8081` **succeeds** while the bridge holds `*:8081` (BSD lets a
  specific address coexist with a wildcard one) and then *wins* every loopback
  connection — so a bind probe reports the port free with a bridge plainly
  running, and the old harness quietly took over the rig's own loopback
  traffic for the length of a run. Detection is a connect probe.
- **`--interactive` only routes the window the harness opened.** A browser
  *you* open at the printed URL dials :8081 and gets the real bridge. The
  harness says so when it happens.

### Building for a shot while `npm run ipad` is up

Only with `--prod`: by default the harness drives its own dev server and
builds nothing, which sidesteps this entirely. Under `--prod` a tour
photographs the **last production build**, so a source change means
`npm run build` first — and that is the one thing to be careful about here.
`npm run ipad`'s `vite preview` on :8889 serves `interface/.svelte-kit/output`
and indexes those files at startup, so a build in the same checkout swaps
chunks out from under the server the iPad is using. **Build in a git worktree**
in that situation (the harness resolves everything relative to its own
checkout, so a worktree run is self-contained — that is how these runs were
taken). Under `npm run dev` there is nothing to avoid: vite dev on :3000
recompiles from source and a main-checkout build does not disturb it.

### If the preview port is taken

The run stops before it builds or launches anything:

```
Error: :4173 is already answering — held by PID 56146 (node …/vite preview --port 4173 …) in /Users/…/.claude/worktrees/other/interface.
  A preview server this run did not start would be driven as if it were this
  checkout's build. Stop it, or move this run: SHOT_PREVIEW_PORT=<free port>.
```

Kill the holder it names, or give this run its own port
(`SHOT_PREVIEW_PORT=4273 npm run shot -- …`). The move is deliberately not
automatic: a leftover preview server from an earlier run is worth hearing
about, and with several sessions shooting from their own worktrees at once,
the one on :4173 is usually somebody else's build.

This used to fail silently, and the README said otherwise. `startPreview`
passed `--strictPort` but discarded vite's output and never watched it exit,
then polled until the port *answered* — so when the port was held, vite's
bind failure vanished and the poll was answered by the other server. Measured
2026-09-24: a probe ran to completion against another session's preview and
reported "nothing happened" for a change that worked. Now there are two
guards (`stack.mjs`): a connect probe refuses a held port up front (a
connect, not a bind — on macOS a `127.0.0.1` bind succeeds beside a
`*:4173` listener), and `waitForOwnServer` accepts only a server that its
own child announced — vite's `Local: http://127.0.0.1:<port>/` line — so a
server that takes the port between the probe and the bind fails the run as
well: vite exits, and the exit is reported with vite's own error text.
`shotFixtures.test.ts` holds both.

### When a run ends, its preview ends with it

Every harness stops its preview on the way out (`stopPreview` in
`stack.mjs`), and nothing of it is left: the port is free and
`pgrep -f 'vite preview'` finds nothing. `stopPreview` sends SIGTERM (vite's
preview closes its server and exits on it), then SIGKILL if the server is
still there 5 s later, then destroys the child's stdout and stderr, so nothing
the server started can hold the harness's own process open.

Until 2026-09-25 that was only true on the Mac. The preview was
`npx vite preview`, and the teardown killed the `npx` it got back. On Linux
that is three processes. Measured in a Node 22 / npm 10 Debian container,
the shape of a cloud session:

```
node scripts/shot/shot.mjs default --fixture-data
  npm exec vite preview --port 4173 --host 127.0.0.1 --strictPort
    sh -c vite preview --port 4173 --host 127.0.0.1 --strictPort
      node /work/node_modules/.bin/vite preview --port 4173 --host 127.0.0.1 --strictPort
```

Debian's `sh` is dash, which forks the command rather than exec'ing it. The
kill reached `npx`, npm passed it to `sh`, `sh` died without passing it on,
and vite was reparented to PID 1, still serving :4173 and still holding the
stdout/stderr pipes the harness reads it through. A pipe keeps its reader's
event loop alive for as long as any process holds the other end, so
`npm run shot` printed `[shot] wrote …` and then never exited (still running
20 s later, when the measurement killed it). `shot:tour`, which ends in
`process.exit()`, did exit, and left vite on the port, so the next run refused
to start; `multitouch` ends the same way. On macOS `sh` is bash, which execs a
lone command: two processes, the kill reached vite, and none of it showed.

Now `startPreview` runs vite itself. It is the `node_modules/.bin/vite` that
`npx` found (the same upward walk from `interface/`), started with the
harness's own node, so the child IS the server. Running that path, rather
than `vite/bin/vite.js`, keeps the command line reading
`…/.bin/vite preview --port N`, which is what `pgrep`/`pkill -f 'vite preview'`
match and what the "held by" message above prints. Measured after the change,
on the Mac and in the container:

| Run | After its last line | Left on the port |
|---|---|---|
| `shot -- default --fixture-data` | exit 0.17 s (Mac), 0.09 s (Linux) — was: hung, Linux | nothing — was: vite, PPID 1, Linux |
| `shot:tour -- central` | exit 0.16 s (Mac), 0.07 s (Linux) | nothing — was: vite, PPID 1, Linux |
| `multitouch` | exit 0.20 s (Mac), 0.02 s (Linux) | nothing |
| `shot` with a `--click` that times out | exit 1 (Linux) | nothing |

The preview stays in the harness's process group on purpose. A Ctrl-C at the
terminal signals the whole group, so the preview dies even when the run
never reaches its teardown: measured mid-tour on both platforms, exit 130 and
the port free. `detached: true` with a group kill was the other candidate fix,
and it would have lost exactly that. A SIGTERM sent to the harness alone is
covered too once Chromium is up, because Playwright's own handler closes the
browser instead of letting the process die, and the run falls through to its
teardown (measured mid-tour on both platforms: exit 1, port free). What still
leaves a preview behind is a harness that dies without running any
JavaScript: `kill -9` (measured: vite reparented to PID 1, :4173 still
answering) and, by the same mechanism though not measured, a SIGTERM that
lands before Chromium has launched and Playwright's handler exists. The next
run then refuses the port and names the PID; kill that PID.

`shotFixtures.test.ts` holds it. There is no `npx` spawn, and every harness
calls `stopPreview`. A server that ignores SIGTERM gets SIGKILL. The pipes
close even while a process the child started still holds them: with the two
`destroy()` calls removed, that test fails with "not within 1000 ms".

## Proving a change is visually inert

There is no committed baseline any more — the golden-image guard was retired
on 2026-08-31 (see Looping's `documentation/archive/golden-images.md`, and
Looping's `documentation/archive/graticule-skin.md` for the single-skin cut that removed
its reason to exist). What it measured is still available on demand, against a
baseline you choose: see **Pixel diffs** below.

The determinism that made those diffs worth quoting all stayed — the fixture
catalogs, `--reduced-motion`, and the Chromium raster flags in `shot.mjs`. Under
the mock there is no live data, so two captures of identical code are
bit-identical and any non-zero diff is a real change.

## Views

A view is a named layout, so you can ask for one in three words from a
phone. `npm run shot:list`:

| View           | What you get                                       |
| -------------- | -------------------------------------------------- |
| `default`      | As shipped — strips, central view, FX grid          |
| `session`      | Session mode on: clip grid under the strips         |
| `session-only` | Strips + clip grid + central view, FX grid off      |
| `central`      | Strips + central view — the emptiest layout         |
| `full`         | All four sections + transport header + solo buttons |
| `header`       | Transport header on, with the rig's TotalMix faders |
| `general`      | `header` with TotalMix switched off (the general edition) |
| `totalmix-down` | `header` with TotalMix on but not answering: faders greyed, saying why |

Every view captures the **flipped** stack (ADR-421): FX grid on top,
track strips against the bottom edge, each track's name at the foot of
its own strip. The central view, the flip, the Drum Rack's pad column and
the strips' device band have had no switch since 2026-09-26.

Views live in [`views.mjs`](views.mjs) as `uiPrefsStore` localStorage
keys. Add one there rather than growing the flag surface. A view can also
carry `features`, which replaces the scene's bridge switches
(`/bridge/features`, general-release audit §7b) for the ids it names —
that is how `general` and `totalmix-down` differ from `header`. The mock
sends the rig's switches (every one on and answering) when a scene names
none, and the UI draws nothing for a feature until they arrive. A tour
state takes `features` the same way it takes `axHelper`.

## Tours — many states, one boot

```bash
npm run shot:tour -- central            # every central view → screenshots/tour/central/
npm run shot:tour -- --list             # tours and their states
npm run shot:tour -- central --only drumrack --only fx-pedal
npm run shot:tour -- central --full     # whole viewport instead of the crop
npm run shot:tour -- settings           # the full-page Settings behind the System view's gear, the first-run checklist included → screenshots/tour/settings/
```

`npm run shot` stands the whole stack up for ONE picture — preview server,
Chromium, mock — which is ~15 s a capture. `tour.mjs` starts the preview
server and Chromium once and then, per state, starts a **fresh mock** and a
**fresh browser context**: a click that selects a track or loads a device
changes the mock, and one state must not inherit what the last did to it.
Each state is a view plus the steps that reach its screen (the same
click / drag / hold steps `shot` performs, shared through
`screenshot-page.mjs`) and an optional crop. The run ends with
`contact.png` — every state in a labelled grid — and the `contact.html` it
was rendered from.

A tour always serves the committed catalog fixtures (`--real-data` to opt
out): it is a comparison set, so two runs of the same code should agree.
Like `shot`, it photographs the **last build** — `npm run build` first.

Tours are `TOURS` in [`views.mjs`](views.mjs). The `central` tour's
selectors lean on the default scene's track order (the table above
`TOURS`), and on two hooks the app keeps for exactly this:
`[data-section="device"]` (the track strip's device band, which selects the
track and opens its instrument's view together — it replaced the FX grid's
instrument tile on 2026-09-15) and `[data-debug="master-card"]`. One state
takes two hops for the same reason: `fx-guitar` opens the Pedal view and
then clicks `.guitar-column`, because the Guitar tile lives there now. Instruments the
default scene has no track for (Collision, Electric, Meld, Omnisphere,
Sampler, Simpler, both Instrument Rack views) are reached by **swapping**:
an `inst-*` state names a `swap`, and `scene.mjs`'s `swapDevice` puts that
instrument on the FM track in Operator's place before the mock starts. A
swap without params keeps Operator's, so a view that binds by name draws
ghosted — those states are for layout, not values.

**Every state is layout-checked** ([`layout.mjs`](layout.mjs), ADR-434),
measured off the page before the shutter: each section divider must have
the view's `--central-gap` on both sides, and the content must sit
`--central-inset` from the frame on all four sides (overlays — anything
absolutely positioned — don't count, and every box is cut to the overflow
that clips it, so a name ellipsised in its column is measured where it is
drawn rather than at its full length). A violation prints under the state
with the element at fault and fails the run; the pictures are still
written. A state centred on one axis on purpose says so
(`layout: { centered: 'x' }`, the Utility view). `--no-layout` skips it.
It does not judge the gap between two controls with no divider between
them, or spacing inside one control.

## Scenes

A **scene** is the frozen Live-set snapshot the mock replays: tracks,
devices, parameter values, clip names, slot states. Two sources, one
format:

- **Synthetic** (default) — [`scene.mjs`](scene.mjs) builds a plausible
  nine-track looping set. Zero setup, works anywhere, invented values.
- **Captured** — on the Mac, with `npm run dev` running and a set open:

  ```bash
  npm run shot:capture -- my-set          # → scripts/shot/scenes/my-set.json
  npm run shot -- session --scene scripts/shot/scenes/my-set.json
  ```

  A capture is a real photograph of a real set — your plugin names, your
  200-parameter racks, your clip layout — replayable forever on any
  machine. Scenes are tens of KB of JSON and **are** committed. The PNGs
  they produce are gitignored.

Doing one capture per interesting set is the highest-leverage thing you
can do for future remote sessions.

## Options

```
npm run shot -- <view> [options]

  --list                 Available views
  --out <path>           Output file (default screenshots/<view>.png)
  --viewport <WxH>       Default 1366x1024 (iPad Pro landscape)
  --scale <n>            Device pixel ratio (default 2)
  --theme <dark|light>   Default dark
  --scene <default|path> Fixture to replay
  --url <url>            Shoot an already-running server instead of booting one
  --no-mock              Don't start the mock (talk to a real bridge). The only
                         mode with no socket route: the page dials :8081 on
                         the host that served it, so the real bridge answers.
                         With the mock (i.e. by default) the route answers
                         instead, and the bridge may stay up — see "Shooting
                         while the rig is running".
  --wait <ms>            Settle time before capture (default 2500)
  --fixture-data         Serve /data/*.json from scripts/shot/fixtures/data
                         instead of the generated preset catalogs (always,
                         rather than only as a 404 fallback). Required for any
                         --diff you intend to cite.
  --full-page            Whole scrollable page
  --click <selector>     Click before capturing (repeatable, in order)
  --hold <selector>      Press and stay pressed through the capture
  --hold-ms <ms>         Dwell while held before capturing (default 450)
  --drag <selector>      Press, move by --drag-by in steps, release
                         (repeatable, in order, after the clicks) — what
                         loads a ghost FX tile, which a tap never does
  --drag-by <dx,dy>      The drag's travel in CSS px (default 24,-24)
  --diff <png>           Pixel-diff the capture against an existing PNG
  --interactive          Leave the stack up, print the URL, don't capture
```

## Holding a gesture

`--click` is down-and-up inside one frame, so it can't show what any of
the interface's *press-timed* gestures look like. Those are everywhere —
a browser folder picks a random preset at 200ms, ClipCentralView's
Delete / Replace Inst / Dup Trk fire at 800ms, RecordButton and solo at
300ms — and all of them arm on `pointerdown`. `--hold` presses and keeps
the button down across the screenshot, so `:active` and every armed timer
are live in the captured frame:

```bash
npm run shot -- default \
  --click 'button.category-button:has-text("Synth")' \
  --hold '.folder-tile' --hold-ms 450
```

Dwell longer than the gesture's threshold to capture what it turned into,
shorter to capture the build-up.

## Pixel diffs

`--diff` is the "prove this change is visually inert" tool ADR-415 used
by hand:

```bash
git stash && npm run shot -- session --out screenshots/before.png
git stash pop && npm run build
npm run shot -- session --diff screenshots/before.png
# → 0/5595136 px differ (0.0000%), max channel delta 0
```

**A preview server left over from the first capture now stops the
second one** (see "If the preview port is taken"). It used to be photographed
instead: the recipe above rebuilds between shots, which re-hashes every
asset filename, and a leftover server keeps serving the old `index.html`,
whose asset URLs then 404 — the capture came back unstyled and empty ("No
tracks in session") and diffed at 100%, which read like a catastrophic
regression rather than the artifact it was. Kill the PID the error names
(or `pkill -f "vite preview"`) and run again. Since 2026-09-25 a run takes its
preview with it when it ends cleanly, on an error such as a bad `--click`
selector, or on a Ctrl-C; `kill -9` is what still leaves one (see "When a run
ends, its preview ends with it").

Against the real stack that comparison has a noise floor — meters and
playheads animate, so two captures of identical code differ by a few
dozen pixels. Under the mock there is no live data, so identical code
gives a **bit-identical** capture and any non-zero diff is a real
change. That makes the number worth trusting — but only with
`--fixture-data`. Without it the capture reads the generated preset
catalogs, and on a machine that has a big one they are still parsing at
the 2500 ms shutter: measured, two runs of identical code differed by 18
px @ Δ36, and the same pair with `--fixture-data` differed by 0. Pass the
flag on both sides of any comparison you intend to cite.

`diff.mjs` also runs standalone: `node scripts/shot/diff.mjs a.png b.png`.

## Known gaps

- **A capture is a macOS render.** `app.css` §2.7 commits to `--font-sans:
  ui-sans-serif, system-ui, …` — *"pure system, zero vendored bytes"* — so the
  render depends on SF Pro being the system font. Vendoring a woff2 would make
  captures portable at the cost of changing the typeface of the instrument
  itself on the iPad, i.e. changing the product to suit its harness. **Decided
  2026-08-30: keep the system stack.** Consequence: a `--diff` is only meaningful
  between two captures taken on the *same* machine. Off a Mac the same code
  differs wholesale — measured at up to 40.1% of pixels, with 96% of the
  differing pixels *outside* the browser rail, so it is font reflow rather than
  the missing catalog below. (The retired golden baseline carried a hard
  `darwin` guard for this reason; see
  Looping's `documentation/archive/golden-images.md`.)
- **Raster determinism is bought with Chromium flags, not with a bigger
  timeout.** The interface lays cards out on fractional pixel boundaries (the
  key/scale card sits at `top=693.344, h=266.656`), and that geometry is
  bit-stable across reloads — measured six times, identical to three decimals —
  so the edge pixels that used to differ between runs were Chromium rounding
  the same layout two ways, not a settle race. Raising the settle time does not
  fix it; `LAUNCH_ARGS` in `screenshot-page.mjs` does (`--force-color-profile=srgb`,
  `--disable-lcd-text`, `--run-all-compositor-stages-before-draw`,
  `--disable-partial-raster`, `--disable-skia-runtime-opts`, plus what
  `--deterministic-mode` used to add). With those, three consecutive 14-capture
  runs came back **42/42 bit-identical** — 0 px, Δ 0.

  **`--deterministic-mode` itself is gone (2026-09-25), because it made Linux
  screenshots impossible.** It is a headless-shell meta flag that adds four
  switches, the run-all-stages flag, and `--enable-begin-frame-control`, which
  makes the compositor wait for BeginFrames sent over DevTools. Playwright never
  sends one, so with Playwright's own browser on Linux (Chrome Headless Shell
  151, Playwright 1.62.1) every `page.screenshot` timed out, even on a bare
  `<h1>` page; that one switch alone reproduces it. The Mac never saw it, since
  Chromium documents begin-frame control as "headless shell only, not supported
  on MacOS yet", and a full Chromium (the harness's `/opt/pw-browsers/chromium`
  fallback, which is how a cloud session got its captures) ignores it. The four
  other switches are now listed by name. Measured on the Mac: the new set against
  the old across the 38-state central tour and four `--fixture-data
  --reduced-motion` shots came back identical except `clip-audio`, which varies
  by ~0.7% at Δ 1–4 between two runs of *any* flag set, the old one included. On
  Linux the new set is as repeatable as that (38-state tour and four shots, two
  runs). Which browser a given cloud session launches is not visible from the
  Mac; the harness prints `bundled Chromium unavailable — falling back to …`
  when it takes the fallback, and either browser works now.
  `shotFixtures.test.ts` keeps both flags out of `LAUNCH_ARGS`.

  Chromium itself is an input to the
  render, so **a `playwright` bump changes every capture**; if a `--diff`
  against a PNG taken before a dependency update shows a few thousand pixels
  everywhere, that is the cause, not your change. Re-shoot the baseline side.
  `--disable-lcd-text` costs a little fidelity — text renders with grayscale
  rather than subpixel anti-aliasing, so a capture is very slightly not what an
  iPad shows (measured at 179–4,187 px per frame, 0.01–0.30%, essentially all of
  it glyph edges). That is the right trade for a **regression** instrument: text
  AA was the largest nondeterministic term, and a measurement that cannot repeat
  itself measures nothing.
- **The browser rail is served from fixtures, not from your library.** The
  Places catalog is built by the Mac's Places service from whatever
  library the machine has (`/api/places/*`, since 2026-09-26), and is
  gitignored — so a capture that reads it is partly a photograph of one
  person's disk. `shot.mjs` routes `/api/places/*.json` to
  `scripts/shot/fixtures/data/places/` instead: always under `--fixture-data`,
  and as a 404 fallback otherwise, so a fresh clone paints a populated rail
  rather than a broken one. Only that folder is routed, so everything else under
  `/data/` passes through untouched. A Place
  with no fixture file is answered with a well-formed empty tree; commit a real
  trimmed fixture the day a capture clicks into one (`synth.json` and
  `synth-samples.json` are there for the swap pill). Guarded by
  `interface/src/__tests__/unit/scripts/shotFixtures.test.ts`.
- **The Permute mini-sequencer is fixture-driven.** `useTinySequencer`
  reads Permute's params *positionally* (1–8 mute, 11–18 pitch) and only
  after matching the M4L class name, so `scene.mjs` carries a full 38-param
  vector (`permuteParams()`, steps 9–16 after Temperature as on the device
  since ADR-443) and a `DEVICE_CLASS_NAMES` override. Three
  tracks carry one: Bass with both rows live, Keys with a dead pitch row,
  Lead with a dead mute row — enough to shoot every state of the strip's
  per-row inactive fade. A device entry may be `{ name, params }` instead
  of a bare name to vary one track's copy.
- **A short `--hold` can't catch its own build-up.** `page.screenshot`
  takes appreciably longer than a frame, so the DOM keeps advancing
  between the dwell ending and the shutter. Anything under a few hundred
  ms — the 200ms folder charge especially — has already fired by the time
  the PNG lands, even at `--hold-ms 1`. The 800ms holds are comfortably
  capturable mid-press; the 200ms one is only capturable *after*.
- **A device the fixture does not carry photographs as a ghost, and a ghost
  proves almost nothing.** The stock scene's master track carries `Mastering`
  and `Compressor` only (`pushDevices(treeArgs, 'master', …)`, `scene.mjs`), so
  a capture of master's fx1 column shows `OttControl` as a **ghost**. That still
  proves something — the `isMasterTrack` branch mounts and takes the whole
  column — but nothing whatever about the value it draws. To photograph a device
  the fixture lacks, add it to that track's list. **Whether you also need a
  `DEVICE_CLASS_NAMES` row depends on the name, and most of the time you do
  not:** `deviceClassName()` falls back to the device name with non-letters
  stripped, and an FX-grid tile matches that against the slot's
  `expectedClassName` in `devicePresets.ts`. `Multiband Dynamics` →
  `MultibandDynamics` and `Glue Compressor` → `GlueCompressor` both already
  land on it, so neither needs a row. A row is load-bearing only where Live's
  class genuinely differs from the letters of the name — `Reverb` → `Hybrid`,
  `Utility` → `StereoGain`, `Auto Filter` → `AutoFilter2`, `Chorus` → `Chorus2`,
  `Drum-Rack` → `DrumGroupDevice`. Get that backwards and the symptom is
  confusing in both directions: a missing row leaves the device visibly present
  in the tree with its tile still ghosted, which reads as a bug in the control.
  Revert whatever you add afterwards — it is a capture aid, not a fixture
  change, and the goldens are baked from the stock scene. The same applies to
  the Squash panel, whose Glue Compressor no fixture track carries.
  **Even with the device present the slider reads its rail minimum, not the
  preset's value**: the mock answers a device's *presence*, not its parameters
  (see "Writes are echoed, not simulated" below). So a capture like this
  exercises mount, slot resolution and layout, and cannot exercise a parameter
  read path — that half needs the rig. Say which of the two a screenshot is
  evidence for when you send one; a mounted-but-zeroed control otherwise reads
  as a working control showing a wrong number.
- **No meters, no playhead.** Nothing is playing, so meter wash and
  playhead position stay at rest. That's what makes diffs deterministic;
  it also means you can't screenshot motion.
- **Writes are echoed, not simulated.** `param/set` comes back as a
  `param/value` so knobs hold position in `--interactive`, but nothing
  else round-trips. Anything needing Live to *respond* — preset loads
  onto a track, track creation, sample-to-Simpler — will sit unanswered.
  The one simulated write is a `device/load` **into a drum pad** (issue
  #491): the mock grows that pad's chain and re-emits presence and the
  pad's bundle, because the tile's loading → active flip is the state
  the pad-scope recipes exist to photograph. The one simulated *failure*
  is the same load of a plug-in preset (Tremolo, `AuPluginDevice` in the
  class table): the surface would go through Live's browser for it and
  the mock has none, so it answers the scoped `load-failed`
  (`not-in-browser;scope=<padPath>`) and the tile falls back from loading
  to ghost for that pad alone — `--drag '.device-control:has-text("Tremolo")'`
  under a latch photographs it.

## Playing it with several fingers — `npm run multitouch`

A sibling harness on the same stack. Where `shot.mjs` photographs the UI,
`multitouch.mjs` **plays** it — several fingers at once — and asserts on
what reached the mock surface.

```bash
npm run multitouch                          # every scenario
npm run multitouch -- --list                # what they are
npm run multitouch -- --scenario two-mutes  # one of them (repeatable)
```

It exists because concurrency is exactly what a screenshot cannot
photograph and a unit test on a pure state machine cannot reach. The
machines behind `use:press` / `use:drag` are proved in
`interface/src/__tests__/unit/actions/`; this proves the **wiring** — that
the real components, mounted in a real browser, turn two fingers into two
writes.

**Fingers are dispatched through CDP `Input.dispatchTouchEvent`**, so they
enter Chromium's own input pipeline: real hit-testing, real pointer ids,
real `touch-action` arbitration. Dispatching `PointerEvent` objects from
page script would have been simpler — and would also have passed against
the code ADR-427 replaced, which was broken at the layer synthetic events
skip.

The recorder is `startMockSurface`'s `onInbound` hook: every message the
UI sends, already unwrapped from the outbound batcher's `/bridge/batch`
envelope, before the mock's own dispatch sees it.

### A second engine

```bash
npm run multitouch:webkit
```

Runs the tap-only scenarios on Playwright's WebKit — a genuinely
different engine, and the closer of the two to the iPad.
`page.touchscreen.tap()` there is **trusted** touch: `pointerdown` /
`pointerup` with `pointerType: 'touch'`, for every `touch-action` value,
inside a horizontal scroller or not. So it proves every migrated control
answers a real touch somewhere other than Chromium.

WebKit has **no multi-finger input**: CDP is Chromium-only, and
`page.touchscreen` exposes `tap` and nothing else — it cannot even hold
or drag one finger. Scenarios needing either are **skipped, not passed**,
and the summary line says how many.

What the WebKit pass is *not*: a net for an `onclick` regression. WebKit
synthesizes a click from a trusted tap just as it does on any website, so
a control reverted to `onclick` still fires there — measured, by
regressing mute on purpose and watching `tap-mutes` pass. What catches
that is the **`touch-action` assertion** every tap scenario makes before
it looks at the wire, which failed on both engines, plus the static
`npm run check:touch`.

**Neither engine can tell you about iOS.** iOS Safari layers its own
gesture recognizers — double-tap zoom, scroll momentum, touch-delay
heuristics — on top of WebKit.
`docs/reference/manual-test-checklist.md` §13 is that half, and
the claims must be reported separately.

Timing: nothing waits on `requestAnimationFrame` and no assertion races a
`setTimeout`. This page can be run hidden or throttled, where rAF never
fires at all. Where a scenario needs the clock — the 300 ms Solo hold, the 300 ms pad
hold — it spends real wall time with a generous margin and says so.

Both harnesses share their boot sequence: `stack.mjs` owns "refuse a
preview port something else answers on, build if needed, start `vite
preview` on :4173, wait until THAT server announces the port and answers,
launch Chromium", and stopping that server again (`stopPreview`), plus
"decide where the mock listens" (`resolveMockPort`).
Pointing a page at it is `startMockSurface`'s own `routePage` — a method on
the mock rather than a free function, so the port and the route cannot
disagree. Deliberately not in there: the preset-catalog fixture interception
and the raster-determinism flags, which belong to the screenshot harness
specifically.

## Keeping it working

The mock is a second implementation of the surface's half of the wire
protocol, so it drifts if the protocol moves. Two places bind it:

- **T/D/P/S/C record arity** (`scene.mjs`) tracks wire-protocol §3. A
  protocol bump that changes arity has to land here in the same commit,
  or replay produces a malformed-record bail.
- **The `state/full` checksum** (`computeTreeArgsChecksum` in
  `scene.mjs`) mirrors the reassembler's FNV-1a. The UI *validates* it,
  so a drifted copy shows up as a silently empty UI rather than an
  error.
- **The port the client dials** is read out of `WebSocketConnection.ts` — its
  own hardcoded `webSocket: { port: … }` block, which does **not** come from
  `config/constants.json` (it is inlined "to avoid import issues during SSR").
  Reshape that block and `stack.mjs`'s regex stops finding it; change one copy
  of the port and not the other and every harness refuses to run until they
  agree. `shotFixtures.test.ts` asserts both.

Both are noted in the files themselves.
