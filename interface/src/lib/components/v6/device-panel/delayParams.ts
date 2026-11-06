/**
 * Live's Delay (class Delay) and Limiter, measured off the running devices
 * (device_dump, 2026-11-06).
 */
import { FilterResponseCalculator } from '$lib/utils/filterResponseCalculator';

/** Delay's LOM indices. */
export const DELAY = {
	smoothing: 1, // 0 Repitch, 1 Fade, 2 Jump
	link: 2,
	pingPong: 3,
	syncL: 4,
	syncR: 5,
	timeL: 6, // 0..1, 1 ms .. 5 s (DELAY_TIME_SECONDS)
	timeR: 7,
	sixteenthL: 8, // 0..7: 1, 2, 3, 4, 5, 6, 8, 16 sixteenths
	sixteenthR: 9,
	offsetL: 10, // 0..1, -33..33 % (0.5 = 0)
	offsetR: 11,
	feedback: 12, // 0..1, 0..95 %
	freeze: 13,
	filterOn: 14,
	filterFreq: 15, // 0..1, 50 Hz .. 18 kHz
	filterWidth: 16, // 0..1, 0.50 .. 9.00
	lfoMode: 17, // 0 Rate, 1 Time, 2 Synced, 3 Triplet, 4 Dotted, 5 16th
	lfoFreq: 18, // 0..1, 0.01 .. 40 Hz
	lfoTime: 19,
	lfoSynced: 20, // 0..21
	lfoSixteenth: 21, // 1..64
	lfoWave: 22,
	lfoMorph: 23,
	lfoToDelay: 24, // 0..100 %
	lfoToFilter: 25,
	dryWet: 26
} as const;

/** L 16th's eight steps, Live's labels. */
export const DELAY_SIXTEENTHS = ['1', '2', '3', '4', '5', '6', '8', '16'] as const;
export const DELAY_SIXTEENTH_MAX = DELAY_SIXTEENTHS.length - 1;
export const DELAY_SMOOTHING = ['Repitch', 'Fade', 'Jump'] as const;
/** Feedback's top: Live labels 1 as 95 %, and a preset saves the fraction (0.6 → 0.6316). */
export const DELAY_FEEDBACK_MAX = 0.95;

/** Limiter's LOM indices. */
export const LIMITER = {
	gain: 1, // 0..1, -24..24 dB (0.5 = 0 dB)
	ceiling: 2, // 0..1, -24..0 dB
	release: 3, // 0..1, 0.01 ms .. 3 s
	auto: 4,
	link: 5, // 0..100 %
	msLink: 6,
	lookahead: 7, // 0..2: 1.5, 3, 6 ms
	routing: 8, // 0 L/R, 1 M/S
	mode: 9, // 0 Standard, 1 Soft Clip, 2 True Peak
	maximize: 10,
	threshold: 11, // 0..1, -24..0 dB
	output: 12 // 0..1, -24..0 dB
} as const;

export const LIMITER_LOOKAHEAD = ['1.5 ms', '3 ms', '6 ms'] as const;
export const LIMITER_MODES = ['Standard', 'Soft Clip', 'True Peak'] as const;
export const LIMITER_ROUTING = ['L/R', 'M/S'] as const;

/** Delay's band-pass display axis, Hz: Filter Freq 0..1 is `50 Hz · 360^v` (Live's labels: 949 Hz at 0.5, 18.0 kHz at 1). */
export const DELAY_FILTER_RANGE = [50, 18000] as const;
/** Filter Width 0..1 → its 0.50 .. 9.00 (Live's labels, linear). */
export const delayFilterWidth = (v: number) => 0.5 + 8.5 * Math.min(1, Math.max(0, v));

const bandpass = new FilterResponseCalculator(44100);

/**
 * The band-pass's response in dB at `freqs`, peak at 0 dB, its width read
 * as octaves of bandwidth. A drawing of the filter, not a measurement of
 * Live's: the manual names the width but not its unit.
 */
export function delayFilterDb(freqV: number, widthV: number, freqs: number[]): number[] {
	const hz = DELAY_FILTER_RANGE[0] * Math.pow(DELAY_FILTER_RANGE[1] / DELAY_FILTER_RANGE[0], Math.min(1, Math.max(0, freqV)));
	const span = Math.pow(2, delayFilterWidth(widthV));
	const Q = Math.sqrt(span) / (span - 1);
	const db = bandpass.calculateFrequencyResponse(bandpass.calculateCoefficients({ type: 'bandpass', frequency: hz, sampleRate: 44100, Q }), freqs).magnitude;
	const peak = Math.max(...db.filter(Number.isFinite));
	return db.map((d) => d - peak);
}
