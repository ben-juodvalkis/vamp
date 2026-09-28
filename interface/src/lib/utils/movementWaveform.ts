/**
 * Movement Waveform Utilities
 * Pure functions ported from movement-display.js (v8ui) for SVG waveform rendering.
 * Used by MovementTremoloCentralView.
 */

/** Movement parameter indices (1-indexed, matching device parameter numbers) */
export const MOVEMENT_PARAM = {
	amount: 1,
	syncMode: 2,
	rate: 3,
	division: 4,
	asym: 5,
	curve: 6,
	offset: 7,
	swing: 8,
	mode: 9,
	cutoff: 10,
	resonance: 11,
	squash: 12,
	fold: 13,
	filterType: 14,
} as const;

/** Division labels for sync mode display (1-16 sixteenths) */
export const DIVISION_LABELS: Record<number, string> = {
	1: '1/16', 2: '1/8', 3: '3/16', 4: '1/4',
	5: '5/16', 6: '3/8', 7: '7/16', 8: '1/2',
	9: '9/16', 10: '5/8', 11: '11/16', 12: '3/4',
	13: '13/16', 14: '7/8', 15: '15/16', 16: '1 bar'
};

/**
 * Apply swing to a pair phase position.
 * Swing stretches the first half of each beat pair and compresses the second.
 */
export function movementSwing(pairPhase: number, sw: number): number {
	sw = Math.max(0.05, Math.min(sw, 0.95));
	if (pairPhase < sw) {
		return pairPhase / Math.max(sw, 0.001);
	} else {
		return (pairPhase - sw) / Math.max(1 - sw, 0.001);
	}
}

/**
 * Compute LFO value from phase with asymmetry and curve shaping.
 * @param phase - 0-1 phase position
 * @param a - Asymmetry (0-1): position of the peak within the cycle
 * @param c - Curve (-1 to 1): waveshape bend (positive = exponential, negative = logarithmic)
 */
export function movementLfo(phase: number, a: number, c: number): number {
	let y: number;
	if (phase < a) {
		y = phase / Math.max(a, 0.001);
	} else {
		y = 1 - (phase - a) / Math.max(1 - a, 0.001);
	}
	const absc = Math.abs(c);
	if (absc < 0.001) return y;
	if (c > 0) return Math.pow(y, 1 + c * 3);
	return 1 - Math.pow(1 - y, 1 + absc * 3);
}

/**
 * Squeeze: compresses the entire LFO cycle into a shorter burst at the start
 * of the period, holding at the resting value (phase=1.0 → trough) for the remainder.
 * Applied BEFORE Asym+Curve shaping.
 * @param phase - Phase position in [0,1]
 * @param fold - Squeeze amount (0-1): 0 = passthrough, 0.5 = 55% active, 1.0 = 10% active
 */
export function movementFold(phase: number, fold: number): number {
	if (fold < 0.001) return phase;
	const activeWidth = 1 - fold * 0.9; // ranges from 1.0 down to 0.1
	if (phase < activeWidth) {
		return phase / activeWidth; // accelerated sweep through full [0,1]
	}
	return 1.0; // held at end-of-cycle (trough after Asym+Curve)
}

/**
 * Tanh saturation: pushes waveform toward square wave.
 * Applied after Fold, before Amount.
 * @param y - LFO value in [0,1]
 * @param squash - Squash amount (0-1): 0 = passthrough, 1 = hard square
 */
export function movementSquash(y: number, squash: number): number {
	if (squash < 0.001) return y;
	const drive = 0.1 + squash * 9.9;
	const bipolar = y * 2 - 1;
	const result = Math.tanh(bipolar * drive) / Math.tanh(drive);
	return (result + 1) * 0.5;
}

/**
 * Amplitude modulation: scale signal volume by LFO.
 * Returns 0-1 gain multiplier.
 */
export function movementMod(lfo: number, amt: number): number {
	const effectiveLfo = amt >= 0 ? lfo : 1 - lfo;
	const depth = Math.abs(amt);
	return 1 - depth * (1 - effectiveLfo);
}

/**
 * Filter modulation: bipolar sweep around resting cutoff.
 * Returns -1 to 1 sweep amount.
 */
export function movementFilterMod(lfo: number, amt: number): number {
	const bipolar = lfo * 2 - 1;
	const effective = amt >= 0 ? bipolar : -bipolar;
	const depth = Math.abs(amt);
	return effective * depth;
}
