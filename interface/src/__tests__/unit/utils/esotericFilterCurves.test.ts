import { describe, it, expect } from 'vitest';
import { esotericResponse, ESOTERIC_CURVES } from '$lib/utils/esotericFilterCurves';

const at = (type: Parameters<typeof esotericResponse>[0], f0: number, res: number, fs: number[]) =>
	esotericResponse(type, f0, res, fs);

describe('esotericFilterCurves', () => {
	it('Comb + peaks on every multiple of the cutoff and dips between', () => {
		const [tooth, gap, tooth2] = at('comb-plus', 500, 0.8, [1000, 1250, 1500]);
		expect(tooth).toBeGreaterThan(gap + 10);
		expect(tooth2).toBeGreaterThan(gap + 10);
	});

	it('Comb − has its trough on the cutoff and its teeth halfway between', () => {
		const [trough, tooth] = at('comb-minus', 500, 0.8, [500, 750]);
		expect(tooth).toBeGreaterThan(trough + 10);
	});

	it('the phaser notches the cutoff', () => {
		const [notch, shoulder] = at('phaser', 1000, 0.5, [1000, 1414]);
		expect(shoulder).toBeGreaterThan(notch + 10);
	});

	it('the vowel peaks on its first formant, above the floor', () => {
		const [formant, floor] = at('vowel', 700, 0.5, [700, 15000]);
		expect(formant).toBeGreaterThan(floor + 10);
	});

	it('the membrane rings at its inharmonic second mode, not at the octave', () => {
		const [mode2, octave] = at('membrane', 200, 0.8, [318, 400]);
		expect(mode2).toBeGreaterThan(octave + 6);
	});

	it('Redux nulls at its rate', () => {
		const [pass, nullAt] = at('redux', 2000, 0, [100, 2000]);
		expect(pass).toBeGreaterThan(nullAt + 20);
	});

	it('every curve stays on the drawing scale', () => {
		const fs = Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199));
		for (const type of ESOTERIC_CURVES) {
			for (const res of [0, 0.5, 1]) {
				for (const db of at(type, 300, res, fs)) {
					expect(Number.isFinite(db)).toBe(true);
					expect(db).toBeGreaterThanOrEqual(-30);
					expect(db).toBeLessThanOrEqual(24);
				}
			}
		}
	});
});
