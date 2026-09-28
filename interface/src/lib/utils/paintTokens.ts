/**
 * paintTokens.ts — JS-side canvas paint constants for the Hybrid skin (§2.11)
 *
 * Canvas 2D contexts cannot read CSS custom properties or resolve oklch
 * relative-color, so every color a `<canvas>` paints must be a literal string.
 * This module is the single source of those literals. Values are canonical as
 * HEX/RGBA at runtime; the oklch in each comment is the design reference.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KEEP IN SYNC with the token block in `interface/src/app.css` (the
 * `.dark[data-skin="hybrid"]` / `.light[data-skin="hybrid"]`
 * `--act-*` / `--signal-dim` / phosphor inks). A mismatch means the canvas signal
 * layer and the CSS chrome drift apart. When you tune one, tune the other.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THEME SELECTION (§2.11 / DO-NOT #4): the active set is chosen through a plain
 * module getter (`paintTokens()`), NOT a store read inside the draw effect. We
 * subscribe to `resolvedTheme` exactly ONCE at module load and cache the mode in
 * a plain variable; `paintTokens()` is then a pure property access at draw time,
 * introducing no reactive dependency (a store read inside a 30Hz draw effect
 * would retrigger the canvas at 30Hz). `fillStyle` must always be one of these
 * strings (or a `trackInk()` output) — never `var()`.
 */

import { browser } from '$app/environment';
import { resolvedTheme } from '$lib/stores/theme';

export interface PaintTokens {
	/** Recording waveform red. CSS mirror: --act-rec. */
	RECORDING_RED: string;
	/** Muted / out-of-band grey. CSS mirror: --signal-dim. */
	DIM_GREY: string;
	/** DIM_GREY @ 45% alpha (waveform outside the loop window). Canvas-safe rgba. */
	DIM_GREY_45: string;
	/** Waveform fallback when no track ink is available. CSS mirror: --editor-accent / --phosphor. */
	EDITOR_ACCENT: string;
	/** EDITOR_ACCENT @ 40% alpha (waveform fill gradient top stop). Canvas-safe rgba. */
	EDITOR_ACCENT_40: string;
	/** MIDI note fallback when no track ink is available. */
	MIDI_NOTE_FALLBACK: string;
	/** Simpler out-of-loop waveform/slices (dim grey @ 50% alpha). */
	SIMPLER_LOOP_OUT: string;
}

/** Dark performance theme (Hybrid). */
const DARK: PaintTokens = {
	RECORDING_RED: '#ff5559',
	DIM_GREY: '#7f848d',
	DIM_GREY_45: 'rgba(127,132,141,0.45)',
	EDITOR_ACCENT: '#ffad56',
	EDITOR_ACCENT_40: 'rgba(255,173,86,0.4)',
	MIDI_NOTE_FALLBACK: '#d3d6db',
	SIMPLER_LOOP_OUT: 'rgba(127,132,141,0.5)'
};

/** Light "paper instrument" theme (Hybrid). */
const LIGHT: PaintTokens = {
	RECORDING_RED: '#ff4d55',
	DIM_GREY: '#5c616a',
	DIM_GREY_45: 'rgba(92,97,106,0.45)',
	EDITOR_ACCENT: '#f5a524',
	EDITOR_ACCENT_40: 'rgba(245,165,36,0.4)',
	MIDI_NOTE_FALLBACK: '#14161a',
	SIMPLER_LOOP_OUT: 'rgba(92,97,106,0.5)'
};

const SETS: Record<'dark' | 'light', PaintTokens> = { dark: DARK, light: LIGHT };

// Cached mode — updated by a single module-level subscription (runs
// immediately with the current value, then on every change). Never read as a
// store at draw time.
let _mode: 'dark' | 'light' = 'dark';
// Subscribe only in the browser. There is no canvas to paint during SSR /
// prerender, so the defaults are correct there, and we keep a module-load
// store subscription out of the build graph entirely.
if (browser) {
	resolvedTheme.subscribe((v) => {
		_mode = v;
	});
}

/** The active paint set. Pure property access — safe to call inside draw effects. */
export function paintTokens(): PaintTokens {
	return SETS[_mode];
}

/**
 * The active theme mode for CANVAS draw paths — pass to `trackInk(hex, paintMode())`.
 * NON-REACTIVE on purpose (plain `let`, no rune): reading it inside a 30Hz draw effect
 * must not create a reactive dependency (DO-NOT #4). For `$derived` / template bindings
 * that must recompute on a runtime theme toggle, use `paintModeReactive()` from
 * `paintMode.svelte.ts` instead.
 */
export function paintMode(): 'dark' | 'light' {
	return _mode;
}

/**
 * Append an alpha channel to a `#rrggbb` hex, returning a canvas-safe `rgba()` string.
 * Replaces fragile `hex + 'NN'` string concatenation at canvas fill sites — works only
 * for 6-digit hex and passes anything else (already-`rgb()`/`rgba()`) through untouched.
 */
export function withAlpha(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return hex;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}
