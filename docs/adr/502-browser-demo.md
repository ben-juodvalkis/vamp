# ADR-502: A Browser Demo of the Real Interface

## Status
**Proposed** (2026-11-02). A first slice, built from a cloud session for the
Vamp page on benjuodvalkis.com; nothing on the rig changes.

## Context
The Vamp guide on Ben's site shows the app in videos and stills. Ben asked
whether a visitor could instead play a working dummy of it: select tracks,
open instruments and effects and move their controls, load things.

Everything the interface knows about Live arrives over one WebSocket and
everything it does leaves over it (the `/looping/v3` wire). The screenshot
harness already stands in for the bridge, the surface and Live at that one
seam: `scripts/shot/mock-surface.mjs` answers the handshake, replays a scene
as `state/full`, and echoes the writes a shot needs (track select, param set,
device select and move, property set, pad loads). It ran only as a Node
WebSocket server.

## Decision
- **The mock's protocol half moves to `scripts/shot/mock-engine.mjs`**, with no
  transport and no Node built-ins: `createMockEngine({ scene, log, onInbound,
  live })` and `connect(ws)` for anything with `readyState`, `OPEN` and
  `send`. `mock-surface.mjs` keeps its API and is now the engine behind a
  `ws` server plus `routePage`. `scene.mjs` reads its fixtures through JSON
  imports instead of `readFileSync`, and the note blobs are packed with typed
  arrays instead of `Buffer` (the same bytes). Shots are unchanged:
  `default` and `central` diffed 0 px before and after.
- **`interface/src/lib/demo` runs the engine in the page.** `installDemo()`
  replaces `WebSocket` with an in-page socket to the engine, answers `/api/*`
  from the harness's committed fixtures, and removes `EventSource`. The app is
  not modified or aware, as under the harness. `hooks.client.ts` installs it
  only when `VITE_VAMP_DEMO=1`, so every other build compiles it out (checked:
  no demo code in the production client).
- **`live: true` makes the song play**, for the demo only: song time and
  playheads move at the scene's tempo, and clip and scene launch and stop,
  mute, solo, volume, pan, sends and a native effect loaded onto a track are
  answered (`appendTrackDevice` in `scene.mjs`). Off for the harnesses, whose
  captures must be the same frame every run.
- **`npm run demo`** serves it on :5180; **`npm run demo:build`** writes a static
  single-page app to `interface/build-demo/` (about 3 MB) through a small
  adapter in `svelte.config.js` that does what adapter-static's SPA mode does.

## Consequences
- The demo is the shipped interface, so it cannot fall behind the app. The
  mock can still drift from the surface, as the harness README warns, and now
  a drift shows in the demo too.
- The demo's set is `buildDemoScene` (`scripts/shot/demo-scene.mjs`): the
  synthetic default cut to six tracks, so a visitor meets a set small enough
  to take in, with the Guitar loop playing rather than frozen mid-recording
  and nothing muted.
- The default scene is synthetic (`buildDefaultScene`). A set captured with
  `npm run shot:capture` replays the same way and would make the demo a real
  set.
- **The browser has a library** (`scripts/shot/demo-catalog.mjs`): a few
  invented presets in every rail category, each standing for a device the
  scene has parameters for. An instrument loads through `prepare_for_preset`
  (onto the empty track the browser made, as the surface reuses it, else a
  new one; onto a pinned track by swapping its instrument), an effect through
  `device/load` onto the chain. The catalog keeps the fixture index's root:
  with another the interface drew no tracks.
- **A one-line hint** (`interface/src/lib/demo/hints.ts`) says what the last
  touch did, from the write it sent (the parameter, track or clip, named from
  the scene) or, for a press that sends nothing, the button. Framed, it is
  posted to the embedding page (`{ type: 'vamp-demo-hint', text }`); on its
  own, the demo draws it along the bottom of the screen.
- No sound. Recording, Capture, Record to Simpler, samples and clips from the
  browser, and anything else that needs Live, its index or the Mac's disk
  answer as on a Mac without the file: a "not available" or a load that fails.
- Effects the scene has no parameter table for load with ghosted controls.
- Hosting it on benjuodvalkis.com, a base path, and the phone fallback are not
  decided yet.

## Tags
`demo`, `mock-surface`, `website`, `static-build`
