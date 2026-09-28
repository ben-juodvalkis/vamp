import { describe, it, expect } from 'vitest';
import { roundGainDisplay } from '$lib/services/clipOperations';

describe('roundGainDisplay', () => {
	it('rounds Live\'s dB text to whole dB, halves away from zero', () => {
		expect(roundGainDisplay('-3.5 dB')).toBe('-4 dB');
		expect(roundGainDisplay('-3.4 dB')).toBe('-3 dB');
		expect(roundGainDisplay('2.5 dB')).toBe('3 dB');
		expect(roundGainDisplay('-12.5 dB')).toBe('-13 dB');
	});

	it('keeps a plus sign Live wrote, and never shows -0', () => {
		expect(roundGainDisplay('+2.0 dB')).toBe('+2 dB');
		expect(roundGainDisplay('-0.4 dB')).toBe('0 dB');
		expect(roundGainDisplay('0.0 dB')).toBe('0 dB');
	});

	it('leaves text with no number as Live wrote it', () => {
		expect(roundGainDisplay('-inf dB')).toBe('-inf dB');
		expect(roundGainDisplay('')).toBe('');
	});
});
