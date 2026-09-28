import { describe, it, expect } from 'vitest';
import {
	ROOT_NOTES,
	SCALE_NAMES,
	getRootNoteName,
	getScaleName,
	getRootNoteIndex,
	getScaleIndex
} from '$lib/data/scales';

describe('scales data', () => {
	describe('ROOT_NOTES', () => {
		it('should have 12 root notes', () => {
			expect(ROOT_NOTES).toHaveLength(12);
		});

		it('should start with C', () => {
			expect(ROOT_NOTES[0]).toBe('C');
		});

		it('should end with B', () => {
			expect(ROOT_NOTES[11]).toBe('B');
		});

		it('should contain all chromatic notes', () => {
			expect(ROOT_NOTES).toContain('C');
			expect(ROOT_NOTES).toContain('C#');
			expect(ROOT_NOTES).toContain('D');
			expect(ROOT_NOTES).toContain('F#');
			expect(ROOT_NOTES).toContain('A#');
		});
	});

	describe('SCALE_NAMES', () => {
		it('should have at least 7 basic scales', () => {
			expect(SCALE_NAMES.length).toBeGreaterThanOrEqual(7);
		});

		it('should start with Major', () => {
			expect(SCALE_NAMES[0]).toBe('Major');
		});

		it('should have Minor as second scale', () => {
			expect(SCALE_NAMES[1]).toBe('Minor');
		});

		it('should include common modes', () => {
			expect(SCALE_NAMES).toContain('Dorian');
			expect(SCALE_NAMES).toContain('Mixolydian');
			expect(SCALE_NAMES).toContain('Lydian');
			expect(SCALE_NAMES).toContain('Phrygian');
			expect(SCALE_NAMES).toContain('Locrian');
		});
	});

	describe('getRootNoteName', () => {
		it('should return correct note for valid indices', () => {
			expect(getRootNoteName(0)).toBe('C');
			expect(getRootNoteName(1)).toBe('C#');
			expect(getRootNoteName(9)).toBe('A');
			expect(getRootNoteName(11)).toBe('B');
		});

		it('should return C for negative indices', () => {
			expect(getRootNoteName(-1)).toBe('C');
		});

		it('should return C for out-of-range indices', () => {
			expect(getRootNoteName(12)).toBe('C');
		});
	});

	describe('getScaleName', () => {
		it('should return correct scale for valid indices', () => {
			expect(getScaleName(0)).toBe('Major');
			expect(getScaleName(1)).toBe('Minor');
			expect(getScaleName(2)).toBe('Dorian');
		});

		it('should return Major for negative indices', () => {
			expect(getScaleName(-1)).toBe('Major');
		});

		it('should return Major for out-of-range indices', () => {
			expect(getScaleName(100)).toBe('Major');
		});
	});

	describe('getRootNoteIndex', () => {
		it('should return correct index for valid note names', () => {
			expect(getRootNoteIndex('C')).toBe(0);
			expect(getRootNoteIndex('A')).toBe(9);
			expect(getRootNoteIndex('B')).toBe(11);
			expect(getRootNoteIndex('F#')).toBe(6);
		});

		it('should return 0 for unknown note names', () => {
			expect(getRootNoteIndex('X')).toBe(0);
			expect(getRootNoteIndex('invalid')).toBe(0);
		});

		it('should be case-sensitive', () => {
			expect(getRootNoteIndex('c')).toBe(0); // lowercase not in array, returns default
		});
	});

	describe('getScaleIndex', () => {
		it('should return correct index for valid scale names', () => {
			expect(getScaleIndex('Major')).toBe(0);
			expect(getScaleIndex('Minor')).toBe(1);
			expect(getScaleIndex('Dorian')).toBe(2);
		});

		it('should return 0 for unknown scale names', () => {
			expect(getScaleIndex('Unknown Scale')).toBe(0);
			expect(getScaleIndex('')).toBe(0);
		});
	});

	describe('round-trip conversions', () => {
		it('should maintain consistency for root notes', () => {
			for (let i = 0; i < ROOT_NOTES.length; i++) {
				const name = getRootNoteName(i);
				expect(getRootNoteIndex(name)).toBe(i);
			}
		});

		it('should maintain consistency for scales', () => {
			for (let i = 0; i < SCALE_NAMES.length; i++) {
				const name = getScaleName(i);
				expect(getScaleIndex(name)).toBe(i);
			}
		});
	});
});
