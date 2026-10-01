# CLAUDE.md

Vamp: live looping for Ableton Live, played from an iPad. SvelteKit interface
(`interface/`) ↔ OSC bridge (`interface/bridge/`) ↔ Python control surface
(`surface/`) ↔ Live. Ben is the only developer; he directs
agents and judges behavior, not code.

This is the living repo since 2026-09-27. `Looping`
(`/Users/Shared/DevWork/GitHub/Looping`) is frozen as the history: never
commit to it. Old Live sets and the Skaka rack still point into it, so it
stays on disk. "Looping" remains the internal name (the `/looping/v3` wire,
file and class names).

The tree: `surface/` (Live's Remote Script, linked as `Remote Scripts/Vamp`),
`Vamp Devices/` (the Max devices the app loads: the one Place a user adds in
Live), `owner/` (the owner's rig only, behind `features` switches: AX helper,
menubar app, Max patch, Skaka picker and rack, rig probes), `config/`,
`scripts/`, `data/`, and `docs/{reference,plans,adr}`.

## From edit to main

1. Work in the vamp checkout on `main`: `/Users/Shared/DevWork/GitHub/vamp`
   on the rig; on Ben's home computer, clone `ben-juodvalkis/vamp` beside the
   old Looping checkout.
   No feature branches, worktrees or PRs. If the session started in a
   worktree, use the checkout by absolute path instead.
2. While iterating, run only the tests for what you changed:
   `cd interface && npx vitest run <path>`,
   `cd surface && .venv/bin/python3 -m pytest -q tests/<file>`.
3. Commit your own files by path (`git add <paths>`, never `-A`): another
   session may be editing this checkout. The commit message is the record of
   what changed and why.
4. `git push origin main`, without asking. The pre-push hook is the whole
   gate (`scripts/gate.sh`, up to ~40 s): svelte-check, vitest, both pytest
   suites, the production build and a page load from it, at once, limited to
   the steps the pushed files reach (a docs-only push runs none; a full run
   at least daily). Never `--no-verify`.
   - Rejected because origin moved: `git pull --no-rebase origin main`, push again.
   - A test you didn't touch fails: run that file alone. If it passes, push
     again and name the test in your summary. If it's another session's work
     in progress, leave their files alone and say so.
5. Tell Ben what behaves differently now, and whether it needs a Live restart.

Ask first before force-push, `reset --hard`, rewriting pushed commits or
deleting branches. Cloud sessions push their own branch and stop there. A Mac
session merges a cloud branch only when Ben asks for that branch, with
`git merge` (no rebase); it never picks up cloud branches on its own.

## Seeing it work

- **UI:** `npm run shot -- <view>` renders the real interface against a mock
  surface into `screenshots/<view>.png`: no Live, bridge or iPad needed.
  `npm run shot:list` names the views; `scripts/shot/README.md` has the rest.
  Take one when Ben asks or is away from the rig, and send him the PNG.
- **Surface (Python):** Live loads it once. A changed surface runs only after
  a full Live restart, which Ben does. Until then the rig runs the old code,
  so before diagnosing odd rig behavior, compare Live's start time with the
  newest file under `surface/`.
- **Servers:** `npm run dev` serves the Mac at http://localhost:3000.
  `npm run ipad` serves a production build on :8889; the iPad is at
  http://192.168.100.1:8889.

## Where things are

- `docs/reference/architecture.md`: processes, ports, message flow
- `docs/reference/wire-protocol.md`: the OSC contract. Update it in the same
  commit as any address you add, change or remove.
- `docs/reference/toggles.md`: gated behaviors and the `features` switches
- `docs/plans/general-release/`: the public release (Vamp) and the general
  edition. Start at its `README.md`.
- `docs/reference/extending-devices.md`: adding a device control (or the
  `add-looping-device` skill)
- `docs/reference/live-api-measurements.md`: what Live's API does that its docs
  don't say, measured on the rig. Ask the running Live with the surface's probes
- `docs/reference/manual-test-checklist.md`: the rig smoke test
- `docs/adr/`: every decision record. The next number is one past the
  highest file there (455 on 2026-09-29)
- `interface/src/__tests__/`: the interface's tests. Mount components with
  `@testing-library/svelte`; read a store through a real `$derived` with
  `helpers/runeHarness.svelte.ts`.
- `scripts/perf/`: perf scenarios. A perf fix quotes before/after numbers.
- A subdirectory's `CLAUDE.md` describes that subsystem.

## Rules

- Shared values (paths, ports, timing) live in `config/constants.json`;
  import it as `$config/constants.json`. Never hard-code one. It holds the
  general edition's defaults: one Mac's own values (the rig's paths,
  addresses, pedals, switches on) go in `config/constants.local.json`,
  gitignored, which Mac-side code lays over it (`config/CLAUDE.md`).
- Log through `logger` (`$lib/utils/logger` in the browser, `./utils/logger`
  in the bridge), never `console.log`. `LOG_LEVEL=DEBUG npm run dev` for more.
- Write no new docs, ADRs or CLAUDE.md prose unless Ben asks. Edit a
  CLAUDE.md only where it now tells an agent something wrong; history
  belongs in commit messages.
- The browser's catalog is built at runtime by the interface server and
  cached under `scripts/.cache/places/` (gitignored); nothing generated is
  committed. Check `git status` after any `.gitignore` edit.
- The AX helper's tests run as `npm run test:ax-helper`, never `pytest` in
  its folder: its installed env has no pytest.
