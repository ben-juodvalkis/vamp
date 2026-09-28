/**
 * paintMode.svelte.ts — REACTIVE theme-mode accessor.
 *
 * Companion to `paintTokens.ts`. That module caches the theme in a plain `let`
 * so canvas draw effects can read it WITHOUT creating a 30Hz reactive dependency
 * (DO-NOT #4). This module is the opposite: a rune-backed signal for use inside
 * Svelte `$derived` / template bindings, so `trackInk(color, paintModeReactive())`
 * ink twins recompute when the theme toggles at runtime (light/dark A-B, §2.6).
 *
 * Rule of thumb:
 *   - Canvas draw `$effect`s  → `paintMode()`        (paintTokens.ts, non-reactive)
 *   - `$derived` / templates  → `paintModeReactive()` (here, reactive)
 *
 * Because this lives in a `.svelte.ts` module, the `$state` is reactive across
 * imports in both `.svelte` components and other `.svelte.ts` modules.
 */

import { browser } from '$app/environment';
import { resolvedTheme } from '$lib/stores/theme';

let _reactiveMode = $state<'dark' | 'light'>('dark');

// Single module-level subscription: runs immediately with the current value,
// then on every theme change. SSR keeps the 'dark' default (no DOM to theme).
if (browser) {
	resolvedTheme.subscribe((v) => {
		_reactiveMode = v;
	});
}

/** The active theme mode, reactively. Use in `$derived`/template bindings. */
export function paintModeReactive(): 'dark' | 'light' {
	return _reactiveMode;
}
