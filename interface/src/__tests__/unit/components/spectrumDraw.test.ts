/**
 * The spectrum's motion and outline (ADR-542): a band rises fast and falls
 * gently, settles, and the outline is rounded but never leaves the box.
 */
import { describe, it, expect } from 'vitest';
import { easeBands, smoothPath, ATTACK_S, RELEASE_S } from '$lib/components/v6/central/views/panel/spectrumDraw';

describe('easeBands', () => {
	it('rises almost at once and falls back gently', () => {
		const shown = [-60, -10];
		easeBands(shown, [-10, -60], 1 / 60);
		// Up 50 dB: most of the way in one frame (attack 10 ms).
		expect(shown[0]).toBeGreaterThan(-10 - 50 * Math.exp(-1 / 60 / ATTACK_S) - 0.01);
		expect(shown[0]).toBeGreaterThan(-30);
		// Down 50 dB: a small part of the way (release 180 ms).
		expect(shown[1]).toBeGreaterThan(-15);
		expect(shown[1]).toBeCloseTo(-10 - 50 * (1 - Math.exp(-1 / 60 / RELEASE_S)), 6);
	});

	it('settles, and says so', () => {
		const shown = [-60];
		let moving = true;
		let frames = 0;
		while (moving && frames < 600) {
			moving = easeBands(shown, [-20], 1 / 60);
			frames++;
		}
		expect(moving).toBe(false);
		expect(shown[0]).toBeCloseTo(-20, 1);
		expect(frames).toBeLessThan(60);
	});

	it('takes a new band count, starting new bands at their target', () => {
		const shown: number[] = [];
		easeBands(shown, [-30, -40, -50], 1 / 60);
		expect(shown).toEqual([-30, -40, -50]);
	});
});

describe('smoothPath', () => {
	const ys = (d: string) => [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));

	it('draws one cubic segment between each pair of points', () => {
		const d = smoothPath([{ x: 0, y: 50 }, { x: 50, y: 10 }, { x: 100, y: 60 }]);
		expect(d.startsWith('M0.00,50.00')).toBe(true);
		expect(d.match(/C/g)).toHaveLength(2);
		expect(d.endsWith('100.00,60.00')).toBe(true);
	});

	it('keeps every handle inside the box, so a peak never overshoots', () => {
		const d = smoothPath([{ x: 0, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 100 }, { x: 30, y: 0 }, { x: 40, y: 100 }], 1);
		for (const y of ys(d)) {
			expect(y).toBeGreaterThanOrEqual(0);
			expect(y).toBeLessThanOrEqual(100);
		}
	});

	it('is empty with no points', () => {
		expect(smoothPath([])).toBe('');
	});
});
