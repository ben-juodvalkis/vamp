import { describe, it, expect } from 'vitest';
import { ratioFromSlider, sliderFromRatio } from '$lib/components/v6/device-panel/multibandParams';

describe('Multiband ratio slider: 0 at the middle', () => {
	it('bottom half spans -3..0, top half 0..1', () => {
		expect(ratioFromSlider(0)).toBe(-3);
		expect(ratioFromSlider(0.25)).toBeCloseTo(-1.5);
		expect(ratioFromSlider(0.5)).toBeCloseTo(0);
		expect(ratioFromSlider(0.75)).toBeCloseTo(0.5);
		expect(ratioFromSlider(1)).toBe(1);
	});

	it('inverts, and clamps out-of-range values', () => {
		for (const r of [-3, -2, -0.4, 0, 0.3, 1]) expect(ratioFromSlider(sliderFromRatio(r))).toBeCloseTo(r);
		expect(sliderFromRatio(-9)).toBe(0);
		expect(sliderFromRatio(5)).toBe(1);
	});
});
