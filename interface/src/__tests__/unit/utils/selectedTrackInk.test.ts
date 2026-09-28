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
	session: { selectedTrackIndex: 0 }
}));

vi.mock('$lib/stores/v3/normalized.svelte', () => ({ v3Store: { tracks: h.tracks } }));
vi.mock('$lib/stores/session.svelte', () => ({ session: h.session }));
vi.mock('$lib/utils/paintMode.svelte', () => ({ paintModeReactive: () => 'dark' }));

import { selectedTrackInk, selectedTrackScheme } from '$lib/utils/selectedTrackInk';

// A real role color from constants.json:vendors.types (bass) — exercised
// through the actual rgbToHex → trackInk → schemeFromInk chain.
const BASS = 0x2a9d8f;

beforeEach(() => {
	h.tracks.clear();
	h.session.selectedTrackIndex = 0;
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
