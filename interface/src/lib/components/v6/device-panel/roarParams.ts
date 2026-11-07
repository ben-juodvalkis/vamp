/**
 * Roar, as the running Live reports it (`device_dump.js`, Live 12 Beta,
 * 2026-11-07): 91 parameters, every continuous one a 0..1 rail with Live's
 * own label. The views bind by these names (`usePanelParams`); the chain
 * cell binds by index. The routing mode is not a parameter but the device
 * property `routing_mode_index` (PropertyComponent's allowlist).
 */

/** Indices the chain cell uses. */
export const ROAR = {
	drive: 1, //       0..1 = -24..+24 dB, linear in dB (0.5 = 0.0 dB)
	dryWet: 87 //      0..1 = 0..100 %
} as const;

/** Live's `routing_mode_list`, in index order (read off the rig). */
export const ROAR_ROUTINGS = ['Single', 'Serial', 'Parallel', 'Multi Band', 'Mid Side', 'Feedback', 'Delay'] as const;
export const ROAR_ROUTING_PROPERTY = 'routing_mode_index';

/**
 * The stages a routing mode runs (Live 12 manual, 29.33.1): Single runs
 * Stage 1, Multi Band all three (Low, Mid, High), the rest two.
 */
export function roarStagesFor(routing: number | undefined): 1 | 2 | 3 {
	if (routing === 0) return 1;
	if (routing === 3) return 3;
	return 2;
}

/** Blend is every routing's but Single's and Multi Band's (manual, 29.33.1). */
export function roarHasBlend(routing: number | undefined): boolean {
	return routing !== 0 && routing !== 3;
}

/** What Live calls each stage under a routing: Multi Band's are bands, Mid Side's the mid and the side. */
export function roarStageNames(routing: number | undefined): [string, string, string] {
	if (routing === 3) return ['Low', 'Mid', 'High'];
	if (routing === 4) return ['Mid', 'Side', 'Stage 3'];
	if (routing === 5) return ['Stage 1', 'Feedback', 'Stage 3'];
	return ['Stage 1', 'Stage 2', 'Stage 3'];
}

/** `Shaper N Type`, 0..11. */
export const ROAR_SHAPERS = [
	'Soft Sine', 'Digital Clip', 'Bit Crusher', 'Diode Clipper', 'Tube Preamp', 'Half Wave Rectifier',
	'Full Wave Rectifier', 'Polynomial', 'Fractal', 'Tri Fold', 'Noise Injection', 'Shards'
] as const;
/** `Flt N Type`, 0..8. */
export const ROAR_FILTERS = ['LP', 'BP', 'HP', 'Notch', 'Peak', 'Morph', 'Comb', 'Resampling', 'Dispersion'] as const;
/** `FB Time Mode`, 0..4. */
export const ROAR_FB_MODES = ['Time', 'Synced', 'Triplet', 'Dotted', 'Note'] as const;
/** `LFO N Mode` and `Noise Mode`, 0..4. */
export const ROAR_RATE_MODES = ['Free', 'Synced', 'Triplet', 'Dotted', 'Sixteenth'] as const;
/** `LFO N Wave`, 0..4. */
export const ROAR_LFO_WAVES = ['Sine', 'Triangle', 'Square', 'Ramp Up', 'Ramp Down'] as const;
/** `Noise Type`, 0..3 (Live's label for 2 is "Sample & Hold"; its panel and manual write "S & H"). */
export const ROAR_NOISES = ['Simplex', 'Wander', 'S & H', 'Brown'] as const;

/** The parameter that sets a stage's filter shape beyond Freq and Res: Peak's gain, Morph's shape. */
export function roarFilterExtra(type: number | undefined): 'Peak' | 'Morph' | undefined {
	return type === 4 ? 'Peak' : type === 5 ? 'Morph' : undefined;
}

/** Resampling has no resonance (manual, 29.33.2). */
export function roarFilterHasRes(type: number | undefined): boolean {
	return type !== 7;
}

/**
 * The parameter a rate mode moves: Free the rate in Hz, Sixteenth the
 * count of sixteenths, the three synced modes the division.
 */
export function roarRateParam(prefix: 'LFO 1' | 'LFO 2' | 'Noise', mode: number | undefined): string {
	if (mode === 0) return `${prefix} Freq`;
	if (mode === 4) return `${prefix} 16th`;
	return `${prefix} Synced`;
}

/** The feedback's time parameter for its mode: Time ms, the synced three a division, Note a pitch. */
export function roarFeedbackTimeParam(mode: number | undefined): string {
	if (mode === 0) return 'FB Time';
	if (mode === 4) return 'FB Note';
	return 'FB Synced';
}

/**
 * Drive as a preset saves it: `Input_InputGain`, a linear factor
 * (1.41254 = +3 dB), onto Live's rail, which is linear in dB from -24 to
 * +24 (the dump's labels at every quarter: -24, -12, 0, 12, 24 dB).
 */
export function roarDriveFromGain(gain: number): number {
	const dB = gain > 0 ? 20 * Math.log10(gain) : -24;
	return Math.min(1, Math.max(0, (dB + 24) / 48));
}

/** A stage filter's cutoff ends, Hz: Live's labels at 0 and 1 (20.0 Hz, 20.0 kHz), log between (632 Hz at 0.5). */
export const ROAR_FILTER_FREQ_RANGE = [20, 20000] as const;

/**
 * The response a stage's filter draws (FilterCurve's kinds). LP, BP, HP,
 * Notch and Peak are the house biquad's; Morph runs LP → BP → HP over its
 * Morph (manual 29.33.2) and is drawn as the nearest; Comb as a comb;
 * Resampling, a sample-rate reduction, as a low-pass; Dispersion moves
 * phase, not level, so flat. Best guesses where the biquad has no shape,
 * as `esotericFilterCurves.ts` says of its own.
 */
export function roarFilterCurve(type: number | undefined, morph = 0): 'lowpass' | 'bandpass' | 'highpass' | 'notch' | 'peak' | 'comb-plus' | 'none' {
	switch (type) {
		case 1: return 'bandpass';
		case 2: return 'highpass';
		case 3: return 'notch';
		case 4: return 'peak';
		case 5: return morph < 1 / 3 ? 'lowpass' : morph < 2 / 3 ? 'bandpass' : 'highpass';
		case 6: return 'comb-plus';
		case 8: return 'none';
		default: return 'lowpass';
	}
}

/**
 * A shaper's transfer curve, input -1..1 to output -1..1, by type, drive
 * (`Shaper N Amt` 0..1) and bias (`Shaper N Bias` 0..1, 0.5 none). Drawn
 * from the manual's description of each curve (29.33.2), not measured off
 * Live: a picture of what the type does as its amount rises.
 */
export function roarShaperCurve(type: number | undefined, amount: number, bias: number): (x: number) => number {
	const g = 1 + amount * 9;
	const b = (bias - 0.5) * 2;
	const clip = (v: number) => Math.max(-1, Math.min(1, v));
	const shape = (fn: (u: number) => number) => (x: number) => clip(fn(x + b * 0.5));
	switch (type) {
		case 1: return shape((u) => clip(g * u)); // Digital Clip: hard corners
		case 2: { // Bit Crusher: fewer steps as the amount rises
			const steps = Math.max(2, Math.round(2 ** (8 - amount * 6.5)));
			return shape((u) => Math.round(clip(u) * steps) / steps);
		}
		case 3: return shape((u) => Math.tanh(g * u * (u > 0 ? 1 : 0.8)) / Math.tanh(g)); // Diode Clipper
		case 4: return shape((u) => (u >= 0 ? Math.tanh(g * u) : Math.tanh(g * 0.6 * u) / 0.9) / Math.tanh(g)); // Tube Preamp: uneven
		case 5: return shape((u) => (u > 0 ? Math.tanh(g * u) / Math.tanh(g) : 0)); // Half Wave Rectifier
		case 6: return shape((u) => 2 * Math.abs(Math.tanh(g * u) / Math.tanh(g)) - 1); // Full Wave Rectifier: an octave up
		case 7: return shape((u) => clip(u + amount * (4 * u ** 3 - 3 * u))); // Polynomial: toward a third harmonic
		case 8: return shape((u) => clip(Math.sin(g * u) * 0.7 + Math.sin(3 * g * u) * 0.2 + Math.sin(9 * g * u) * 0.1)); // Fractal
		case 9: { // Tri Fold: folds back at the rails
			return shape((u) => {
				const v = (g * u + 1) / 4;
				const f = v - Math.floor(v);
				return 4 * Math.abs(f - 0.5) - 1;
			});
		}
		case 10: return shape((u) => Math.tanh(g * u) / Math.tanh(g) + 0.06 * amount * Math.sin(57 * u)); // Noise Injection
		case 11: { // Shards: segments of changing slope
			const seg = 6;
			return shape((u) => {
				const i = Math.floor(((u + 1) / 2) * seg);
				const slope = 1 + amount * ((i * 37) % 5) * 0.6;
				return clip(Math.tanh(u * slope * (1 + amount * 2)));
			});
		}
		default: return shape((u) => Math.sin((Math.PI / 2) * clip(g * u * 0.6))); // Soft Sine
	}
}
