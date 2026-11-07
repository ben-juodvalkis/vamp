/**
 * Best-guess magnitude responses for the filters a biquad has no shape for
 * (user, 2026-11-07: "let's just do our best guess about what they would
 * look like"): Meld's combs, phaser, vowel, plate and membrane resonators
 * and Redux, and Analog's Formant. None is measured off Live; each is the
 * textbook response of the kind of filter its name says, placed on the
 * cutoff and sharpened by the resonance, so the picture moves the way the
 * sound does.
 *
 * Pure: frequencies in Hz in, dB out, on FilterCurve's ±24 dB scale.
 */

export type EsotericCurve =
	| 'comb-plus'
	| 'comb-minus'
	| 'phaser'
	| 'vowel'
	| 'plate'
	| 'membrane'
	| 'redux';

export const ESOTERIC_CURVES: readonly EsotericCurve[] = [
	'comb-plus',
	'comb-minus',
	'phaser',
	'vowel',
	'plate',
	'membrane',
	'redux'
];

export function isEsotericCurve(type: string): type is EsotericCurve {
	return (ESOTERIC_CURVES as readonly string[]).includes(type);
}

const FLOOR_DB = -30;
const toDb = (mag: number) => Math.max(FLOOR_DB, 20 * Math.log10(Math.max(mag, 1e-6)));

/** A resonant peak's linear magnitude at `f`: a second-order band-pass, 1 at `f0`. */
function resonance(f: number, f0: number, q: number): number {
	const r = f / f0 - f0 / f;
	return 1 / Math.sqrt(1 + q * q * r * r);
}

/**
 * The comb's teeth: a feedback comb tuned so its first peak (plus) or its
 * first trough (minus) sits on the cutoff, normalized so the teeth reach
 * about +12 dB and the gaps fall well below.
 */
function comb(f: number, f0: number, res: number, sign: 1 | -1): number {
	const g = 0.35 + 0.6 * res; // feedback 0.35..0.95
	const phase = (2 * Math.PI * f) / f0;
	const re = 1 - sign * g * Math.cos(phase);
	const im = sign * g * Math.sin(phase);
	const mag = (1 - g) / Math.sqrt(re * re + im * im); // 1 at a tooth
	return toDb(mag * 4); // the tooth at +12 dB
}

/** Three notches an octave apart around the cutoff, deeper and sharper with resonance. */
function phaser(f: number, f0: number, res: number): number {
	const q = 1.5 + 6 * res;
	let mag = 1;
	for (const k of [0.5, 1, 2]) {
		const peak = resonance(f, f0 * k, q);
		mag *= 1 - 0.97 * peak;
	}
	// Feedback lifts the shoulders between the notches.
	return toDb(mag * (1 + 0.6 * res));
}

/**
 * Three formants, an "ah" whose first formant is on the cutoff: F2 and F3
 * at the ratios a male "ah" holds (≈ 700 / 1220 / 2600 Hz), each a peak
 * over a low floor, the higher ones quieter.
 */
function vowel(f: number, f0: number, res: number): number {
	const q = 4 + 10 * res;
	const formants: [number, number][] = [
		[1, 1],
		[1.74, 0.6],
		[3.7, 0.35]
	];
	let mag = 0.08;
	for (const [ratio, level] of formants) mag += level * resonance(f, f0 * ratio, q);
	return toDb(mag * 4);
}

/** Many narrow modes over a low floor, the first on the cutoff, at `ratios` of it. */
function modes(f: number, f0: number, res: number, ratios: readonly number[]): number {
	const q = 12 + 40 * res;
	let mag = 0.04;
	ratios.forEach((ratio, i) => {
		mag += resonance(f, f0 * ratio, q) / (1 + 0.25 * i);
	});
	return toDb(mag * 4);
}

/** A thin plate's modes, (m² + n²) of the (1,1) mode: 2, 5, 8, 10, 13, 17, 18, 20, 25, 26. */
const PLATE = [1, 2.5, 4, 5, 6.5, 8.5, 9, 10, 12.5, 13];
/** A drumhead's modes, Bessel zeros over the first: (0,1), (1,1), (2,1), (0,2), (3,1), (1,2), ... */
const MEMBRANE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06];

/**
 * Sample-rate reduction: a zero-order hold at the cutoff as its rate, so the
 * response is a sinc with nulls on every multiple of it, rising images
 * between, and the top tilted down a little with resonance (Redux's
 * filter).
 */
function redux(f: number, f0: number, res: number): number {
	const x = (Math.PI * f) / f0;
	const sinc = x < 1e-6 ? 1 : Math.abs(Math.sin(x) / x);
	const tilt = 1 / (1 + (f / (f0 * 8)) * res);
	return toDb(sinc * tilt * 2);
}

/** The response at each of `frequencies` (Hz), in dB, for `cutoffHz` and resonance 0..1. */
export function esotericResponse(
	type: EsotericCurve,
	cutoffHz: number,
	res: number,
	frequencies: readonly number[]
): number[] {
	const r = Math.min(1, Math.max(0, res));
	const f0 = Math.max(20, cutoffHz);
	return frequencies.map((f) => {
		switch (type) {
			case 'comb-plus':
				return comb(f, f0, r, 1);
			case 'comb-minus':
				return comb(f, f0, r, -1);
			case 'phaser':
				return phaser(f, f0, r);
			case 'vowel':
				return vowel(f, f0, r);
			case 'plate':
				return modes(f, f0, r, PLATE);
			case 'membrane':
				return modes(f, f0, r, MEMBRANE);
			case 'redux':
				return redux(f, f0, r);
		}
	});
}
