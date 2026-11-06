/** Operator's Coarse on the pads: two octaves either side of the ratio at arrival. */
import { describe, it, expect } from 'vitest';
import { coarseRatio, coarseStep, coarseX, coarseStepAtX } from '$lib/components/v6/device-panel/chain/operatorCoarse';

describe('operatorCoarse', () => {
	it('reads step 0 as ratio 0.5 and every other step as itself', () => {
		expect([0, 1, 2, 24, 48].map(coarseRatio)).toEqual([0.5, 1, 2, 24, 48]);
		expect([0.5, 1, 2.4, 24, 99].map(coarseStep)).toEqual([0, 1, 2, 24, 48]);
	});

	it('a preset at 24 spans 6..48 (96 past Live\'s top), resting mid-pad', () => {
		expect(coarseX(24, 24)).toBe(0.5);
		expect(coarseStepAtX(24, 0)).toBe(6);
		expect(coarseStepAtX(24, 1)).toBe(48);
		expect(coarseX(24, 6)).toBe(0);
		expect(coarseX(24, 12)).toBe(0.25);
	});

	it('the dot stays where the ratio is: 4 around an anchor of 1 sits at the right edge', () => {
		expect(coarseX(1, 4)).toBe(1);
		expect(coarseX(1, 2)).toBe(0.75);
		expect(coarseStepAtX(1, 0)).toBe(0); // 0.25, floored to Live's 0.5
	});

	it('every step in the window reads back from its own X', () => {
		for (const step of [6, 7, 12, 23, 24, 25, 40, 48]) expect(coarseStepAtX(24, coarseX(24, step))).toBe(step);
	});
});
