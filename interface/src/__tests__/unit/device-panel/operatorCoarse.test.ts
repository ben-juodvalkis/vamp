/** Operator's relative Coarse: an octave either side of the ratio at touch-down. */
import { describe, it, expect } from 'vitest';
import { coarseRatio, coarseStep, coarseStepAt } from '$lib/components/v6/device-panel/chain/operatorCoarse';

describe('operatorCoarse', () => {
	it('reads step 0 as ratio 0.5 and every other step as itself', () => {
		expect([0, 1, 2, 24, 48].map(coarseRatio)).toEqual([0.5, 1, 2, 24, 48]);
		expect([0.5, 1, 2.4, 24, 99].map(coarseStep)).toEqual([0, 1, 2, 24, 48]);
	});

	it('a preset at 24 sweeps 12..48, resting on 24', () => {
		expect(coarseStepAt(24, 0)).toBe(12);
		expect(coarseStepAt(24, 0.5)).toBe(24);
		expect(coarseStepAt(24, 1)).toBe(48);
	});

	it('at ratio 1 reaches 0.5 and 2; at 0.5 it cannot go below its own floor', () => {
		expect(coarseStepAt(1, 0)).toBe(0);
		expect(coarseStepAt(1, 1)).toBe(2);
		expect(coarseStepAt(0.5, 0)).toBe(0);
		expect(coarseStepAt(0.5, 1)).toBe(1);
	});
});
