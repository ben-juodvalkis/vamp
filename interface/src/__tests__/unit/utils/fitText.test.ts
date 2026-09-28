import { describe, expect, it } from 'vitest';
import { longestWordEm } from '$lib/utils/fitText';

// A fake measure: 60px a character at the 100px measuring size (0.6em).
const measure = (word: string) => [...word].length * 60;

describe('longestWordEm', () => {
	it('is the widest word, since a label wraps only between words', () => {
		expect(longestWordEm('Saturator', measure)).toBeCloseTo(5.4);
		expect(longestWordEm('to Simpler', measure)).toBeCloseTo(4.2);
		expect(longestWordEm('LFO > Time', measure)).toBeCloseTo(2.4);
	});

	it('takes the measured width, not the character count', () => {
		const narrowI = (word: string) => [...word].reduce((w, c) => w + (c === 'i' ? 20 : 60), 0);
		expect(longestWordEm('iiii wm', narrowI)).toBeCloseTo(1.2);
	});

	it('ignores runs of whitespace', () => {
		expect(longestWordEm('  Rand   Oct ', measure)).toBeCloseTo(2.4);
	});

	it('is 0 for no text, which leaves a label its own size', () => {
		expect(longestWordEm('', measure)).toBe(0);
		expect(longestWordEm(null, measure)).toBe(0);
		expect(longestWordEm(undefined, measure)).toBe(0);
	});
});
