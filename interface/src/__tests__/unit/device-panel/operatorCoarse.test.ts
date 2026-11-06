/** Operator's Coarse on the pads: two steps either side of the step at arrival. */
import { describe, it, expect } from 'vitest';
import { coarseRatio, coarseX, coarseStepAtX } from '$lib/components/v6/device-panel/chain/operatorCoarse';

describe('operatorCoarse', () => {
	it('reads Live\'s labels: step 0 is 0.5, every other step itself', () => {
		expect([0, 1, 2, 22, 48].map(coarseRatio)).toEqual([0.5, 1, 2, 22, 48]);
	});

	it('a preset at 8 spans 6..10, resting mid-pad', () => {
		expect(coarseX(8, 8)).toBe(0.5);
		expect(coarseStepAtX(8, 0)).toBe(6);
		expect(coarseStepAtX(8, 1)).toBe(10);
		expect(coarseX(8, 9)).toBe(0.75);
	});

	it('stops at Live\'s ends: 0 (ratio 0.5) and 48', () => {
		expect(coarseStepAtX(1, 0)).toBe(0);
		expect(coarseStepAtX(47, 1)).toBe(48);
	});

	it('every step in the window reads back from its own X', () => {
		for (const step of [6, 7, 8, 9, 10]) expect(coarseStepAtX(8, coarseX(8, step))).toBe(step);
	});
});
