import { describe, expect, it } from 'vitest';
import { longestWordLength } from '$lib/utils/fitText';

describe('longestWordLength', () => {
	it('counts the longest word, since a label wraps only between words', () => {
		expect(longestWordLength('Saturator')).toBe(9);
		expect(longestWordLength('to Simpler')).toBe(7);
		expect(longestWordLength('LFO > Time')).toBe(4);
	});

	it('ignores runs of whitespace', () => {
		expect(longestWordLength('  Rand   Oct ')).toBe(4);
	});

	it('counts characters, not UTF-16 units', () => {
		expect(longestWordLength('−12')).toBe(3);
		expect(longestWordLength('🎸🎸')).toBe(2);
	});

	it('is 1 for no text, which leaves a label its own size', () => {
		expect(longestWordLength('')).toBe(1);
		expect(longestWordLength(null)).toBe(1);
		expect(longestWordLength(undefined)).toBe(1);
	});
});
