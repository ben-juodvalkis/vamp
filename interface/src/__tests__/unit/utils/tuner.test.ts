import { describe, expect, it } from 'vitest';
import { noteOf } from '$lib/utils/tuner';

describe('the tuner names a pitch (ADR-539)', () => {
	it('reads the open strings in tune', () => {
		expect(noteOf(82.41)).toMatchObject({ name: 'E', octave: 2 });
		expect(noteOf(440)).toMatchObject({ name: 'A', octave: 4, cents: 0, midi: 69 });
		expect(Math.abs(noteOf(329.63)!.cents)).toBeLessThan(1);
	});

	it('says how sharp or flat, in cents', () => {
		expect(noteOf(440 * 2 ** (10 / 1200))!.cents).toBeCloseTo(10, 5);
		expect(noteOf(440 * 2 ** (-20 / 1200))!.cents).toBeCloseTo(-20, 5);
		expect(noteOf(466.16)).toMatchObject({ name: 'A♯', octave: 4 });
	});

	it('reads nothing for no pitch', () => {
		expect(noteOf(0)).toBeNull();
		expect(noteOf(NaN)).toBeNull();
	});
});
