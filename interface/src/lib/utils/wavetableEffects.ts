/**
 * What Wavetable's oscillator effects do to one cycle of the wave, so the
 * Wavetable central view can draw the selected table as Live plays it.
 *
 * Each oscillator has an Effect Mode chooser and two sliders whose meaning
 * follows the mode (Live manual §31.13.2):
 *   FM       Effect 1 = Tune, Effect 2 = Amount
 *   Classic  Effect 1 = PW, Effect 2 = Sync
 *   Modern   Effect 1 = Warp, Effect 2 = Fold
 * The slider values survive a mode change, so the same pad position draws
 * differently per mode.
 *
 * `oscillator_{1,2}_effect_mode` is a device property, not a parameter, so
 * Live gives it no display labels; its enum `Live.WavetableDevice.EffectMode`
 * is none 0, frequency_modulation 1, sync_and_pulse_width 2, warp_and_fold 3.
 * Effect 1 (params 5/13) and Effect 2 (6/14) are both 0..1 in Live's units:
 * Effect 1 shows 0 as -100 %, 0.5 as 0 % and 1 as +100 %; Effect 2 shows
 * 0..100 %.
 *
 * Every effect only moves WHERE in the cycle the oscillator reads; none
 * changes the level. Measured off Live 12.4 beta on 2026-10-22, from the
 * audio of Basic Shapes' sine, saw and square swept through each slider
 * alone and through Effect 1 with Effect 2 at 50 %
 * (`owner/probes/wavetable_render_run.js calib|joint`; the cycles are the
 * test fixture `wavetable-effect-calibration.json`). With P = Effect 1 as
 * -1..1 and A = Effect 2 as 0..1, and t the position in the output cycle:
 *   FM       reads t + 1.6·A·sin(2π·4^P·t): phase modulation by a sine 4^P
 *            times the note's pitch (±2 octaves at the ends), starting in
 *            phase with it. Between whole ratios the sound is inharmonic and
 *            one cycle cannot show it; the drawing is the first cycle.
 *   Classic  plays the cycle inside a window 1 − 0.97·|P| wide — at the END
 *            of the cycle for negative PW, the START for positive — and
 *            holds the cycle's first sample outside it. Sync reads the
 *            cycle 1 + 3·A times per period (4× at 100 %), inside the
 *            window.
 *   Modern   Fold reads forward to the middle of the cycle and back,
 *            reflecting off the cycle's ends: x = reflect((1 + 7·A) ·
 *            min(t, 1 − t)); at A = 0 it is off (x = t). Warp then bends that
 *            position, x / (x + a·(1 − x)), a = 1 + 32·P² for negative Warp
 *            (slow start, fast finish) and 1 / that for positive. (The
 *            other order misses the joint sweep by ~1.5.)
 * Against Live's audio the drawing is within 0.1 RMS (relative) on the sine
 * almost everywhere and mostly within 0.25 on the saw; the test holds it
 * there. Not reproduced: the level the square holds outside the PW window
 * (0.42 in Live — the first sample of Live's own table, which a rendered
 * cycle starting on the jump cannot know).
 */

export type WavetableEffectMode = 'none' | 'fm' | 'classic' | 'modern';

/** Index = Live's `oscillator_N_effect_mode`. */
export const EFFECT_MODES: readonly WavetableEffectMode[] = ['none', 'fm', 'classic', 'modern'];

export function effectModeFromLive(value: number): WavetableEffectMode {
	return EFFECT_MODES[Math.round(value)] ?? 'none';
}

/** The measured constants (see the module comment). */
export const EFFECT_MEASURED = {
	/** FM: phase deviation at Amount 100 %, in cycles. */
	fmDepth: 1.6,
	/** FM: the modulator's ratio is this to the power of Tune (-1..1). */
	fmRatioBase: 4,
	/** Classic: the PW window narrows by this much at ±100 %. */
	pwNarrowing: 0.97,
	/** Classic: extra reads per cycle at Sync 100 %. */
	syncExtra: 3,
	/** Modern: the Warp bend's a = 1 + this · Warp². */
	warpCurve: 32,
	/** Modern: extra half-cycle reads at Fold 100 %. */
	foldExtra: 7
} as const;

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

/** Reflects a position back into 0..1, as many times as it overshoots. */
export function reflect(x: number): number {
	return 1 - Math.abs((((x % 2) + 2) % 2) - 1);
}

/**
 * Where in the source cycle each output position reads, for one mode, or
 * `null` where the oscillator holds (Classic, outside the PW window).
 */
function phaseMap(mode: WavetableEffectMode, p: number, a: number): (t: number) => number | null {
	const m = EFFECT_MEASURED;
	switch (mode) {
		case 'fm': {
			const ratio = m.fmRatioBase ** p;
			const depth = m.fmDepth * a;
			return (t) => t + depth * Math.sin(TAU * ratio * t);
		}
		case 'classic': {
			const width = 1 - m.pwNarrowing * Math.abs(p);
			const start = p < 0 ? 1 - width : 0;
			const reads = 1 + m.syncExtra * a;
			return (t) => {
				const u = (t - start) / width;
				return u >= 0 && u < 1 ? frac(u * reads) : null;
			};
		}
		case 'modern': {
			const bend = 1 + m.warpCurve * p * p;
			const k = p < 0 ? bend : 1 / bend;
			const folds = 1 + m.foldExtra * a;
			return (t) => {
				const x = a > 0 ? reflect(folds * Math.min(t, 1 - t)) : t;
				return x / (x + k * (1 - x));
			};
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
	const p = Math.max(-1, Math.min(1, effect1 * 2 - 1));
	const a = Math.max(0, Math.min(1, effect2));
	const read = phaseMap(mode, p, a);
	const held = cycle[0];
	const out = new Float32Array(points);
	for (let i = 0; i < points; i++) {
		const phase = read(i / points);
		out[i] = phase === null ? held : sampleAt(cycle, phase);
	}
	return out;
}
