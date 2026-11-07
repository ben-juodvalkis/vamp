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
