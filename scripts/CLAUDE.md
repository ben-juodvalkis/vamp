# scripts/

Automation, run from the repo root through `npm run`.

## The gate

- `gate.sh`: the pre-push gate (`npm run gate` runs it by hand). svelte-check,
  vitest, surface pytest, AX-helper pytest and the production build, at once,
  ~40 s. It tests the working tree. Each SvelteKit step gets its own outDir
  (`LOOPING_KIT_OUT_DIR`) because each rewrites the generated files when it
  starts. A push runs only the steps its changed files reach (the path
  rules are in the script; docs-only runs a NUL check and nothing else);
  `npm run gate` or `GATE_ALL=1` runs all five. A new test that reads a file
  outside its own tree means updating those rules.
- A build that dies on `ENOENT … service-worker.js` is hiding its real
  error: the server build produced nothing (a Svelte compile error, a bad CSS
  class). Run svelte-check on the changed files before blaming caches.

## Startup (`npm run dev`, `npm run ipad`)

- `setup-ipad.js`: `npm run ipad`. Launches Live, the browser blocker and the
  menu-bar agent right away, runs `prep:ipad` (the gated build) underneath, then starts the bridge and the :8889 preview under
  `concurrently`, which restarts them forever. A build failure stops it
  instead of looping.
- `staleness.mjs`: fingerprint gates for the catalog scan and the Vite build.
  A stat walk (path, size, mtime; symlinks hashed as links) is compared with
  `scripts/.cache/<name>-stamp.json`, and every artifact the last run wrote
  must still exist. `FORCE=1` bypasses. Two invariants keep it from missing
  on every run: `cleanup.sh` deletes `interface/.svelte-kit` only under
  `--caches`.
- `cleanup.sh`: stops this repo's dev servers and frees the reserved ports.
  It only signals processes whose working directory is inside the repo, by
  pattern or by port, and only LISTEN sockets (an unscoped sweep once killed
  Chrome's network process). A port held by anything else is named and left.
  `--list` prints what it would stop; `--caches` also clears build caches.
  `cleanupScoping.test.ts` drives `--list`.
- `setup.js` (`npm run setup`): Node, `npm install`, the surface's link
  into Live (`surface/install.sh`), then the setup check.
- `validate-setup.js` (`npm run validate`, `dev`'s and `ipad`'s first
  step): the setup check. Fails only on Node, dependencies or an unparsable
  config; the rest are warnings. (`copy-constants.js`, which copied the
  config into `interface/static/` for the build, went on 2026-09-26: the
  build holds code only, and machine values reach clients over
  `/bridge/machine`.)
- `open-live.js`: which Live `dev` and `ipad` open, and the check reports:
  `paths.abletonApp` if present, else the version Live's newest preferences
  folder names.
- `create-status-page.js`: the status page; `ready` resolves on the real bind.

## The Places catalog

Since 2026-09-26 the interface server builds the browser's catalog at runtime,
for the Places ticked in Settings, and serves it over `/api/places/*`
(`interface/src/lib/server/places/`: `service.ts`, the disk scan
`diskScan.ts`, Live's index `indexScan.ts`, `catalogShape.ts`, the thumbnail
baker `audioThumbnailCache.ts`, and `placesManifest.ts`, the alias map).
`dev` and `prep:ipad` no longer build one. Three scripts remain:

- `generate-places-catalog.ts` (`npm run generate-places`): warms the
  server's cache (`scripts/.cache/places/`) and reports what it would build;
  `FORCE=1` rebuilds.
- `places-diff.ts` (`npm run places:diff`): every ticked Place built from
  Live's index and from the disk, and every item the two disagree on
  (onboarding.plan.md §10). `-- --all`, `-- --name <Place>`.
- `bake-thumbnails.ts`: not run by hand. The service spawns it at low
  priority to decode sample thumbnails into the shared peaks cache, so a cold
  bake (about 16 minutes on the rig) leaves the server responsive; it exits
  when the server does, and if it cannot start the service decodes in-process.

All three run under `tsx --tsconfig interface/tsconfig.json`, which resolves the
server modules' `$lib` imports.

## Rig tools

- `install-ax-helper.sh` (`npm run install-ax-helper`, `-- --status`): builds,
  signs and loads the AX helper app and its LaunchAgent. Grant it
  Accessibility once in System Settings.
- `amxd-inventory.py <file.amxd>`: read-only inventory of a Max for Live
  device. After a Max save of Permute, its 22 pattern parameters must keep
  their long names and orders 1–22.
- `perf/scenario.mjs` + `perf/analyze.mjs`: bridge perf scenarios (idle,
  tempo-sweep, param-storm, clip-launch, track-storm) and their report.

## Screenshots and multitouch: `shot/` (details in `shot/README.md`)

- `npm run shot -- <view>`: the real UI against a mock surface
  (`shot/mock-surface.mjs` replaying a scene from `shot/scene.mjs`), no Live
  needed. It drives a warm `vite dev` on :5174 that it leaves running
  (`npm run shot:stop` ends it); `--prod` shoots the last production build.
- `npm run shot:tour -- central`: every central view in one boot, with a
  contact sheet and a layout check.
- `--diff <png>` compares two captures. Pass `--fixture-data` to both, or the
  machine's own catalogs add noise.
- Safe while the rig runs: the mock takes a free port and every page is
  routed to it. The port a page dials is `WebSocketConnection.ts`'s
  hardcoded copy, not the config's.
- The mock is a second implementation of the surface's side of the wire. A
  protocol bump changes `shot/scene.mjs` (`PROTOCOL_VERSION`, record arity)
  and `shot/capture.mjs` (`UI_SUPPORTED_VERSIONS`) in the same commit, or
  every shot shows an interface with no tracks.
- `npm run multitouch` (`-- --list`): several fingers at once through CDP,
  asserting on what reached the surface. `multitouch:webkit` runs the
  tap-only scenarios on WebKit. Neither sees iOS Safari's own gesture layer;
  only the iPad does.
