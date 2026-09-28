import { describe, it, expect } from 'vitest';

import { paintTokens, paintMode, withAlpha } from '$lib/utils/paintTokens';

describe('paintTokens', () => {
	it('exposes a complete token set for the active mode', () => {
		const t = paintTokens();
		// Every field used by canvas fill sites must be present and canvas-safe.
		for (const key of [
			'RECORDING_RED',
			'DIM_GREY',
			'DIM_GREY_45',
			'EDITOR_ACCENT',
			'EDITOR_ACCENT_40',
			'MIDI_NOTE_FALLBACK',
			'SIMPLER_LOOP_OUT'
		] as const) {
			expect(typeof t[key]).toBe('string');
			expect(t[key].length).toBeGreaterThan(0);
		}
	});

	it('alpha-variant constants are canvas-safe rgba() strings (never var())', () => {
		const t = paintTokens();
		expect(t.DIM_GREY_45).toMatch(/^rgba\(/);
		expect(t.EDITOR_ACCENT_40).toMatch(/^rgba\(/);
		expect(t.SIMPLER_LOOP_OUT).toMatch(/^rgba\(/);
		for (const v of Object.values(t)) {
			expect(v).not.toContain('var(');
		}
	});

	it('paintMode() returns a valid mode (defaults to dark under SSR/test)', () => {
		expect(['dark', 'light']).toContain(paintMode());
	});

	describe('withAlpha', () => {
		it('converts #rrggbb to an rgba() string with the given alpha', () => {
			expect(withAlpha('#828A94', 0.45)).toBe('rgba(130,138,148,0.45)');
			expect(withAlpha('#000000', 1)).toBe('rgba(0,0,0,1)');
			expect(withAlpha('#ffffff', 0)).toBe('rgba(255,255,255,0)');
		});

		it('passes already-rgb()/rgba() or malformed input through untouched', () => {
			// Non-6-digit-hex falls through so callers never emit a broken canvas color.
			expect(withAlpha('rgb(1,2,3)', 0.4)).toBe('rgb(1,2,3)');
			expect(withAlpha('not-a-color', 0.4)).toBe('not-a-color');
			expect(withAlpha('#abc', 0.4)).toBe('#abc');
		});
	});
});
