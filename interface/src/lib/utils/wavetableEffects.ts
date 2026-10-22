/**
 * What Wavetable's oscillator effects do to one cycle of the wave, so the
 * Wavetable central view can draw the selected table as Live plays it.
 *
 * Each oscillator has an Effect Mode chooser and two sliders whose meaning
 * follows the mode (Live manual §31.13.2):
 *   FM       Effect 1 = Tune (±50 % = an octave, ±100 % = two; inharmonic
 *            in between), Effect 2 = Amount
 *   Classic  Effect 1 = PW (on any table, not only squares), Effect 2 = Sync
 *            (a hidden oscillator resetting the audible one's phase)
 *   Modern   Effect 1 = Warp ("similar to pulse width"), Effect 2 = Fold
 *            (wavefolding)
 * The slider values survive a mode change, so the same pad position draws
 * differently per mode.
 *
 * Measured off Live 12 Beta on 2026-10-22: `oscillator_{1,2}_effect_mode` is
 * a device property, not a parameter, so Live gives it no display labels;
 * its enum `Live.WavetableDevice.EffectMode` is none 0,
 * frequency_modulation 1, sync_and_pulse_width 2, warp_and_fold 3. Effect 1
 * (params 5/13) and Effect 2 (6/14) are both 0..1 in Live's units: Effect 1
 * shows 0 as -100 %, 0.5 as 0 % and 1 as +100 %; Effect 2 shows 0..100 %.
 *
 * NOT YET MEASURED: every constant in `EFFECT_TUNING`. Those are shapes of
 * the right kind with guessed depths, to be fitted against the calibration
 * renders (a sine and a saw swept through each mode's two sliders).
 */

export type WavetableEffectMode = 'none' | 'fm' | 'classic' | 'modern';

/** Index = Live's `oscillator_N_effect_mode`. */
export const EFFECT_MODES: readonly WavetableEffectMode[] = ['none', 'fm', 'classic', 'modern'];

export function effectModeFromLive(value: number): WavetableEffectMode {
	return EFFECT_MODES[Math.round(value)] ?? 'none';
}

/** Depths at each slider's end. Guesses until fitted to the renders. */
export const EFFECT_TUNING = {
	/** FM phase deviation at Amount 100 %, in cycles of the carrier. */
	fmMaxDeviation: 0.5,
	/** Classic Sync at 100 %: how many times faster the cycle is read. */
	syncMaxRatio: 8,
	/** Classic PW at ±100 %: how far the midpoint moves toward an edge (0..1). */
	pwMaxShift: 0.95,
	/** Modern Warp at ±100 %: the phase curve's exponent is 2^±this. */
	warpMaxOctaves: 3,
	/** Modern Fold at 100 %: input gain before folding. */
	foldMaxGain: 6
};

const TAU = Math.PI * 2;

function frac(x: number): number {
	return x - Math.floor(x);
}

/** The cycle at a phase 0..1, wrapping, linearly interpolated. */
function sampleAt(cycle: ArrayLike<number>, phase: number): number {
	const n = cycle.length;
	const pos = frac(phase) * n;
	const i = Math.floor(pos);
	const t = pos - i;
	return cycle[i % n] * (1 - t) + cycle[(i + 1) % n] * t;
}

/** Reflects anything past ±1 back inside, as many times as it overshoots. */
export function fold(x: number): number {
	const m = (((x + 1) % 4) + 4) % 4;
	return 1 - Math.abs(m - 2);
}

/** Where in the source cycle each output phase reads, for one mode. */
function phaseMap(mode: WavetableEffectMode, e1: number, e2: number): (t: number) => number {
	switch (mode) {
		case 'fm': {
			const ratio = 2 ** (2 * e1);
			const depth = e2 * EFFECT_TUNING.fmMaxDeviation;
			return (t) => t + depth * Math.sin(TAU * ratio * t);
		}
		case 'classic': {
			const ratio = 1 + e2 * (EFFECT_TUNING.syncMaxRatio - 1);
			const knee = 0.5 + 0.5 * e1 * EFFECT_TUNING.pwMaxShift;
			return (t) => {
				const p = frac(t * ratio);
				return p < knee ? (0.5 * p) / knee : 0.5 + (0.5 * (p - knee)) / (1 - knee);
			};
		}
		case 'modern': {
			const exponent = 2 ** (-e1 * EFFECT_TUNING.warpMaxOctaves);
			return (t) => t ** exponent;
		}
		default:
			return (t) => t;
	}
}

/**
 * One cycle as the oscillator plays it under its effect. `cycle` is the
 * raw frame (-1..1, any length); `effect1` and `effect2` are the
 * parameters' values as Live sends them (0..1); the result has `points`
 * samples.
 */
export function applyOscEffect(
	cycle: ArrayLike<number>,
	mode: WavetableEffectMode,
	effect1: number,
	effect2: number,
	points = cycle.length
): Float32Array {
	const e1 = Math.max(-1, Math.min(1, effect1 * 2 - 1));
	const e2 = Math.max(0, Math.min(1, effect2));
	const read = phaseMap(mode, e1, e2);
	const gain = mode === 'modern' ? 1 + e2 * (EFFECT_TUNING.foldMaxGain - 1) : 1;
	const out = new Float32Array(points);
	for (let i = 0; i < points; i++) {
		const y = sampleAt(cycle, read(i / points));
		out[i] = gain === 1 ? y : fold(y * gain);
	}
	return out;
}
