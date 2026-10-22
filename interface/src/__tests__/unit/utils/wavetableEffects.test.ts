import { describe, expect, it } from 'vitest';
import { applyOscEffect, effectModeFromLive, fold } from '$lib/utils/wavetableEffects';

const N = 256;
const sine = Float32Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i) / N));
const saw = Float32Array.from({ length: N }, (_, i) => 2 * (i / N) - 1);

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let d = 0;
	for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
	return d;
}

describe('effectModeFromLive', () => {
	it('reads the chooser value, None for anything unknown', () => {
		expect([0, 1, 2, 3].map(effectModeFromLive)).toEqual(['none', 'fm', 'classic', 'modern']);
		expect(effectModeFromLive(7)).toBe('none');
	});
});

describe('fold', () => {
	it('passes -1..1 through and reflects the overshoot', () => {
		expect(fold(0.5)).toBeCloseTo(0.5);
		expect(fold(-1)).toBeCloseTo(-1);
		expect(fold(1.5)).toBeCloseTo(0.5);
		expect(fold(3)).toBeCloseTo(-1);
		expect(fold(-1.25)).toBeCloseTo(-0.75);
	});
});

describe('applyOscEffect', () => {
	it('leaves the cycle alone with no mode', () => {
		expect(maxDiff(applyOscEffect(saw, 'none', 0.7, 0.9), saw)).toBeLessThan(1e-6);
	});

	it('leaves the cycle alone at each mode’s rest position (Effect 1 at 0.5 = 0 %)', () => {
		for (const mode of ['fm', 'classic', 'modern'] as const) {
			expect(maxDiff(applyOscEffect(saw, mode, 0.5, 0), saw)).toBeLessThan(1e-6);
		}
	});

	it('keeps every mode inside -1..1', () => {
		for (const mode of ['fm', 'classic', 'modern'] as const) {
			for (const e1 of [0, 0.35, 0.8, 1]) {
				const out = applyOscEffect(sine, mode, e1, 1);
				expect(Math.max(...out)).toBeLessThanOrEqual(1 + 1e-6);
				expect(Math.min(...out)).toBeGreaterThanOrEqual(-1 - 1e-6);
			}
		}
	});

	it('Fold turns the sine’s peak back down', () => {
		const out = applyOscEffect(sine, 'modern', 0.5, 0.5);
		expect(out[N / 4]).toBeLessThan(0.9);
		expect(Math.max(...out)).toBeCloseTo(1, 1);
	});

	it('Sync reads the cycle several times and resets at the end', () => {
		const out = applyOscEffect(saw, 'classic', 0.5, 1);
		const resets = Array.from(out).filter((y, i) => i > 0 && y < out[i - 1] - 1).length;
		expect(resets).toBeGreaterThanOrEqual(6);
	});

	it('PW moves the saw’s midpoint off center', () => {
		const out = applyOscEffect(saw, 'classic', 0.75, 0);
		expect(out[N / 2]).toBeLessThan(-0.1);
	});

	it('FM bends the sine without moving its ends', () => {
		const out = applyOscEffect(sine, 'fm', 0.5, 0.5);
		expect(maxDiff(out, sine)).toBeGreaterThan(0.2);
		expect(out[0]).toBeCloseTo(0, 5);
	});

	it('resamples to the requested length', () => {
		expect(applyOscEffect(sine, 'modern', 0.6, 0.2, 64)).toHaveLength(64);
	});
});
