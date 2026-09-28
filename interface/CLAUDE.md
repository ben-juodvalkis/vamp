# Live Looping Interface

## Tech Stack

- **Svelte 5 runes** — `$state()`, `$derived()`, `$effect()`, `let { prop } = $props()`. No legacy `$:` syntax.
- **Tailwind CSS 4** — CSS-first with `@import "tailwindcss"`, custom properties, `@custom-variant`
- **shadcn-svelte** — Primary UI library (button, card, input, badge, sheet, dialog). Add with `npx shadcn-svelte@latest add [name]`

## Development Commands

```bash
npm run dev          # Here: vite dev alone. From the repo root: the whole stack (stale servers killed, ports freed, caches KEPT)
npm run build        # Production build
npm run check        # Type checking
npm run ipad         # Repo root only: iPad setup (same cleanup, caches KEPT)
```

## Performance Focus

Optimize for iPad Safari: touch interactions, low-latency audio control, real-time visual feedback.

## Troubleshooting: Stale Caches

**The start scripts do not clear build caches.** `npm run dev` and `npm run ipad` run `cleanup`, which kills stale servers and frees ports but keeps `interface/.svelte-kit` and Vite's cache — the startup gates fingerprint them (`scripts/CLAUDE.md`). To wipe them by hand, e.g. when `$derived` stops working or the UI won't update after an edit:

```bash
npm run cleanup:caches   # also deletes interface/.svelte-kit, interface/node_modules/.vite, scripts/.cache
```

**UI up but no tracks, and `Cannot read properties of undefined (reading 'call')` in `get_next_sibling`** (in `logs/bridge.log` as a client `uncaught-error`, then `reactivity-stall`): the browser ran two copies of Svelte's runtime, one from old cached dependency files. Vite serves `node_modules/.vite/deps` under `?v=<hash>`, and 7.1.5 can give a rebuilt cache the same hash, so a copy the browser was told is immutable goes stale — and wiping caches server-side does not reach it. Since 2026-09-15 the dev server has browsers revalidate those files instead (`revalidateOptimizedDeps` in `vite.config.ts`), so it should not recur. The tell is a fresh browser profile loading the same server cleanly. If it does recur, move `interface/node_modules/.vite/deps` aside and `touch vite.config.ts`: Vite restarts in place and the bridge keeps running.
