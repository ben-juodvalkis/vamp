# ADR-499: One Data Folder, Three Folders by Name

## Status
**Accepted** (2026-11-01). Phase 1 of
[installer.plan.md](../plans/general-release/installer.plan.md). Nothing
changes on a checkout; the surface half takes effect after a full Live
restart.

## Context
Every part of Vamp found its files by walking up to the checkout: the
interface server (`repoRoot()`), the bridge (`__dirname` three folders up), the
control surface (its symlink's real path), Vamp for Mac (its recorded
`repoRoot`). They wrote into it too: `config/` (the local constants, the
WebSocket secret, paired iPads), `logs/`, `scripts/.cache/`. An installed app
has no checkout, its bundle is read-only, and Vamp Devices goes wherever the
user puts it.

## Decision
Three folders, named the same way everywhere:

| Folder | Holds | Installed | From a checkout |
|---|---|---|---|
| app | what ships: `config/constants.json`, `scripts/` | `VAMP_APP_ROOT` (the bundle's `Resources/vamp`) | the checkout |
| data | everything written: `config/`, `logs/`, `cache/` | `VAMP_DATA` (`~/Library/Application Support/Vamp`) | the checkout's `config/`, `logs/`, `scripts/.cache/` |
| devices | Vamp Devices | `VAMP_DEVICES` (the folder the user chose) | the checkout's `Vamp Devices` |

- The bridge reads them in `interface/bridge/utils/dataPaths.js`, the server in
  `runtimeConfig.ts` (`repoRoot`, `dataDir`, `devicesDir`), both from the
  environment Vamp for Mac passes (`VampPaths.environment`). Unset, they are
  the checkout, so the rig and every clone write where they always have.
- The control surface is copied into Remote Scripts when installed, so it
  cannot walk up to anything: it reads `vamp-paths.json` beside itself
  (`config_loader.vamp_paths`, `{app, data, devices}`), written by the app.
  Absent (the rig's symlink), it walks up as before.
- Vamp for Mac's `VampPaths` is the checkout when it has a `repoRoot`, else
  the bundle when the bundle carries the server.

## Consequences
- A test pointing `VAMP_DATA` at an empty folder writes only there.
- Nothing installed runs yet: Phases 2–4 put the server in the bundle, start
  it with these variables and write `vamp-paths.json`.
- `dataPaths.js` and `runtimeConfig.ts` must agree;
  `__tests__/unit/server/dataPaths.test.ts` checks both against each other.

## Tags
`installer`, `paths`, `general-release`
