import { describe, it, expect } from 'vitest';
import { linesThatFit } from '$lib/utils/clampLines';

describe('clampLines — linesThatFit', () => {
	it('fits whole lines only', () => {
		expect(linesThatFit(62, 18)).toBe(3);
		expect(linesThatFit(71, 18)).toBe(3);
	});

	it('absorbs subpixel rounding on a box sized for exactly N lines', () => {
		expect(linesThatFit(4 * 17.92 - 0.3, 17.92)).toBe(4);
	});

	it('always leaves at least one line', () => {
		expect(linesThatFit(5, 18)).toBe(1);
		expect(linesThatFit(0, 18)).toBe(1);
		expect(linesThatFit(60, 0)).toBe(1);
		expect(linesThatFit(Number.NaN, 18)).toBe(1);
	});
});
