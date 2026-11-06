/**
 * Live's EQ Eight (class Eq8), measured off the running device
 * (device_dump, 2026-11-06). Eight bands of ten parameters from index 4:
 * band b's A half at 4 + 10 (b - 1) is Filter On, Filter Type, Frequency,
 * Gain, Q; its B half (+5) is the same five, used only in L/R or M/S mode.
 * The app edits the A half, Live's Stereo mode.
 *
 *   Frequency 0..1 = 10 Hz · 2200^v (Live's labels: 10.0 Hz, 469 Hz at 0.5, 22.0 kHz)
 *   Gain -15..15 dB, as the LOM
 *   Q 0..1 = 0.1 · 180^v (0.10 .. 18.0, 0.71 at 0.3767)
 *   Type 0..7: Low Cut 48, Low Cut 12, Low Shelf, Peak, Notch, High Shelf,
 *   High Cut 12, High Cut 48 (Live's labels say High/Low Pass)
 *
 * A preset saves the same bands in the same order, each half as IsOn,
 * Mode, Freq (Hz), Gain (dB), Q (as is): the server keys the n-th
 * occurrence of a repeated name `Freq#n` (`presetParams.ts`).
 */
import { FilterResponseCalculator, type FilterType } from '$lib/utils/filterResponseCalculator';

export const EQ8 = { output: 1, scale: 2, adaptiveQ: 3 } as const;
export const EQ8_BANDS = 8;
export const EQ8_GAIN_MAX = 15;
export const EQ8_FREQ_RANGE = [10, 22000] as const;

/** The manual's names for Live's eight responses (its chooser, top to bottom). */
export const EQ8_TYPES = ['Low Cut 48', 'Low Cut 12', 'Low Shelf', 'Peak', 'Notch', 'High Shelf', 'High Cut 12', 'High Cut 48'] as const;

/** Band b's (1..8) A half: its five LOM indices. */
export function eq8Band(b: number) {
	const base = 4 + 10 * (b - 1);
	return { on: base, type: base + 1, freq: base + 2, gain: base + 3, q: base + 4 };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export const eq8Hz = (v: number) => 10 * Math.pow(2200, clamp01(v));
export const eq8FreqValue = (hz: number) => clamp01(Math.log(hz / 10) / Math.log(2200));
export const eq8Q = (v: number) => 0.1 * Math.pow(180, clamp01(v));
export const eq8QValue = (q: number) => clamp01(Math.log(q / 0.1) / Math.log(180));

/** Whether a type has a gain (shelves and bell); the others' dot height is their Q. */
export const eq8HasGain = (type: number) => [2, 3, 5].includes(Math.round(type));

/** A freshly inserted EQ Eight on the rig (its User Library default, measured 2026-11-06), what a ghost draws. */
export const EQ8_REST = {
	on: [1, 1, 1, 1, 0, 0, 0, 1],
	type: [1, 3, 3, 5, 3, 3, 3, 6],
	freq: [eq8FreqValue(30), eq8FreqValue(200), eq8FreqValue(1000), eq8FreqValue(5000), eq8FreqValue(100), eq8FreqValue(10000), eq8FreqValue(5000), 1],
	gain: 0,
	q: eq8QValue(Math.SQRT1_2)
} as const;

export interface Eq8BandState {
	on: boolean;
	type: number;
	freq: number;
	gain: number;
	q: number;
}

const calculator = new FilterResponseCalculator(44100);
const BIQUAD: Record<number, { type: FilterType; stages: number }> = {
	0: { type: 'highpass', stages: 4 },
	1: { type: 'highpass', stages: 1 },
	2: { type: 'lowshelf', stages: 1 },
	3: { type: 'peak', stages: 1 },
	4: { type: 'notch', stages: 1 },
	5: { type: 'highshelf', stages: 1 },
	6: { type: 'lowpass', stages: 1 },
	7: { type: 'lowpass', stages: 4 }
};

/** One band's response in dB at `freqs`; a 48 dB filter is four 12 dB stages, the first resonant. */
export function eq8BandDb(band: Eq8BandState, freqs: number[]): number[] {
	const spec = BIQUAD[Math.round(band.type)] ?? BIQUAD[3];
	const at = (Q: number) =>
		calculator.calculateFrequencyResponse(
			calculator.calculateCoefficients({ type: spec.type, frequency: eq8Hz(band.freq), sampleRate: 44100, Q, gain: band.gain }),
			freqs
		).magnitude;
	const db = at(eq8Q(band.q));
	if (spec.stages === 1) return db;
	const flat = at(Math.SQRT1_2);
	return db.map((d, i) => d + flat[i] * (spec.stages - 1));
}

/** The whole EQ's response: every band that is on, in series. */
export function eq8Db(bands: readonly Eq8BandState[], freqs: number[]): number[] {
	const sum = freqs.map(() => 0);
	for (const band of bands) {
		if (!band.on) continue;
		eq8BandDb(band, freqs).forEach((d, i) => (sum[i] += d));
	}
	return sum;
}
