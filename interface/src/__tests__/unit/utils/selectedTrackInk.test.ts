/**
 * Unit tests for selectedTrackInk / selectedTrackScheme (ADR-402).
 *
 * These are the helpers every instrument + clip central view now uses to
 * paint its chrome in the focused track's ink, so the two branches —
 * track record present → calibrated ink/scheme; absent → null fallback —
 * are worth locking down: they're the contract the 14 views' fallback
 * logic is built on. The underlying OKLCH ink math is covered by
 * trackFormatters.test.ts; here we only assert the present/absent
 * branching and the schemeFromInk shape, with the three store deps mocked
 * so the real ink pipeline runs end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
	tracks: new Map<string, { color: number }>(),
	session: { selectedTrackIndex: 0 },
	mode: 'dark' as 'dark' | 'light'
}));

vi.mock('$lib/stores/v3/normalized.svelte', () => ({ v3Store: { tracks: h.tracks } }));
vi.mock('$lib/stores/session.svelte', () => ({ session: h.session }));
vi.mock('$lib/utils/paintMode.svelte', () => ({ paintModeReactive: () => h.mode }));

import { selectedAmountInk, selectedAmountScheme, selectedTrackInk, selectedTrackScheme } from '$lib/utils/selectedTrackInk';
import { DEVICE_FAMILY_INKS, familyScheme, getControlColor, setAmountInkSource } from '$lib/config/devicePresets';

// A real role color from constants.json:vendors.types (bass) — exercised
// through the actual rgbToHex → trackInk → schemeFromInk chain.
const BASS = 0x2a9d8f;

beforeEach(() => {
	h.tracks.clear();
	h.session.selectedTrackIndex = 0;
	h.mode = 'dark';
});

describe('selectedTrackInk', () => {
	it('returns a calibrated hex when the focused track has a record', () => {
		h.tracks.set('tracks/0', { color: BASS });
		expect(selectedTrackInk()).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('follows the selected index', () => {
		h.tracks.set('tracks/2', { color: BASS });
		h.session.selectedTrackIndex = 2;
		expect(selectedTrackInk()).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('returns null when no record exists for the selected index', () => {
		h.session.selectedTrackIndex = 3; // nothing set for tracks/3
		expect(selectedTrackInk()).toBeNull();
	});
});

describe('selectedTrackScheme', () => {
	it('wraps the track ink in a full scheme (primary === accent, rgba wash)', () => {
		h.tracks.set('tracks/0', { color: BASS });
		const scheme = selectedTrackScheme();
		expect(scheme).not.toBeNull();
		expect(scheme!.primary).toMatch(/^#[0-9a-f]{6}$/i);
		// schemeFromInk sets primary === accent (the trackTint shape)…
		expect(scheme!.accent).toBe(scheme!.primary);
		// …and secondary is the 10% rgba wash.
		expect(scheme!.secondary).toMatch(/^rgba\(/);
		// same ink source as selectedTrackInk.
		expect(scheme!.primary).toBe(selectedTrackInk());
	});

	it('returns null when the focused track has no record (cold start)', () => {
		h.session.selectedTrackIndex = 7;
		expect(selectedTrackScheme()).toBeNull();
	});
});

// ADR-544: colour is whose it is. Every amount is drawn in the selected
// track's ink, and a device family has no colour of its own.
describe('selectedAmountInk', () => {
	it('is the track ink in dark and a deeper ink of the same track in light', () => {
		h.tracks.set('tracks/0', { color: BASS });
		const dark = selectedAmountInk();
		expect(dark).toBe(selectedTrackInk());
		h.mode = 'light';
		const light = selectedAmountInk();
		expect(light).toMatch(/^#[0-9a-f]{6}$/i);
		expect(light).not.toBe(dark);
		// Deeper: every channel at or under the dark theme's.
		const sum = (hex: string) => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0);
		expect(sum(light)).toBeLessThan(sum(dark));
	});

	it('is a mid grey with no track selected (the master), never ON\'s white or black', () => {
		h.session.selectedTrackIndex = -1;
		expect(selectedAmountInk()).toBe('#a8a8a4');
		h.mode = 'light';
		expect(selectedAmountInk()).toBe('#55554f');
	});

	it('gives the scheme the controls take', () => {
		h.tracks.set('tracks/0', { color: BASS });
		const scheme = selectedAmountScheme();
		expect(scheme.primary).toBe(selectedAmountInk());
		expect(scheme.accent).toBe(scheme.primary);
		expect(scheme.secondary).toMatch(/^rgba\(\d+, \d+, \d+, 0\.1\)$/);
	});
});

describe('a device scheme answers with the amount ink', () => {
	it('follows the selected track, read when it is used', () => {
		const reverb = familyScheme('timeSpace');
		h.tracks.set('tracks/0', { color: BASS });
		h.tracks.set('tracks/1', { color: 0xff3636 });
		const onBass = reverb.primary;
		expect(onBass).toBe(selectedAmountInk());
		h.session.selectedTrackIndex = 1;
		expect(reverb.primary).toBe(selectedAmountInk());
		expect(reverb.primary).not.toBe(onBass);
		expect(reverb.accent).toBe(reverb.primary);
	});

	it('is one ink for every family and every macro', () => {
		h.tracks.set('tracks/0', { color: BASS });
		const ink = selectedAmountInk();
		for (const family of Object.keys(DEVICE_FAMILY_INKS) as (keyof typeof DEVICE_FAMILY_INKS)[]) {
			expect(familyScheme(family).primary).toBe(ink);
		}
		for (let i = 0; i < 8; i++) expect(getControlColor(i).primary).toBe(ink);
	});

	it('falls back to the family\'s own hex only with no source named', () => {
		setAmountInkSource(null);
		try {
			expect(familyScheme('filter').primary).toBe(DEVICE_FAMILY_INKS.filter.primary);
		} finally {
			setAmountInkSource(selectedAmountInk);
		}
	});
});
