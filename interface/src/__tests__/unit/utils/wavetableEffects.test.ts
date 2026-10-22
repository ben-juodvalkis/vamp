import { describe, expect, it } from 'vitest';
import { applyOscEffect, effectModeFromLive, reflect, type WavetableEffectMode } from '$lib/utils/wavetableEffects';
import calibration from './fixtures/wavetable-effect-calibration.json';

const N = 256;
const sine = Float32Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i) / N));
const saw = Float32Array.from({ length: N }, (_, i) => 2 * (i / N) - 1);

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let d = 0;
	for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
	return d;
}

describe('effectModeFromLive', () => {
	it('reads the chooser value, None for anything unknown', () => {
		expect([0, 1, 2, 3].map(effectModeFromLive)).toEqual(['none', 'fm', 'classic', 'modern']);
		expect(effectModeFromLive(7)).toBe('none');
	});
});

describe('reflect', () => {
	it('passes 0..1 through and reflects the overshoot', () => {
		expect(reflect(0.3)).toBeCloseTo(0.3);
		expect(reflect(1.25)).toBeCloseTo(0.75);
		expect(reflect(2.25)).toBeCloseTo(0.25);
		expect(reflect(-0.25)).toBeCloseTo(0.25);
	});
});

describe('applyOscEffect', () => {
	it('leaves the cycle alone with no mode', () => {
		expect(maxDiff(applyOscEffect(saw, 'none', 0.7, 0.9), saw)).toBeLessThan(1e-6);
	});

	it('leaves the cycle alone at each mode’s rest position (Effect 1 at 0.5 = 0 %)', () => {
		for (const mode of ['fm', 'classic', 'modern'] as const) {
			expect(maxDiff(applyOscEffect(saw, mode, 0.5, 0), saw)).toBeLessThan(1e-6);
		}
	});

	it('keeps every mode inside the cycle’s own range: the effects only move where it reads', () => {
		for (const mode of ['fm', 'classic', 'modern'] as const) {
			for (const e1 of [0, 0.35, 0.8, 1]) {
				const out = applyOscEffect(sine, mode, e1, 1);
				expect(Math.max(...out)).toBeLessThanOrEqual(1 + 1e-6);
				expect(Math.min(...out)).toBeGreaterThanOrEqual(-1 - 1e-6);
			}
		}
	});

	it('holds Classic’s cycle at its first sample outside the PW window', () => {
		// PW -50 %: the cycle plays in the last 51.5 % and holds before it.
		const out = applyOscEffect(sine, 'classic', 0.25, 0);
		expect(maxDiff(out.slice(0, N / 3), new Float32Array(N / 3).fill(sine[0]))).toBeLessThan(1e-6);
	});

	it('resamples to the requested length', () => {
		expect(applyOscEffect(sine, 'modern', 0.6, 0.2, 64)).toHaveLength(64);
	});
});

/*
 * Against Live's own audio: Basic Shapes' sine, saw and square rendered
 * through each effect (`owner/probes/wavetable_render_run.js calib|joint`,
 * cut by `wavetable_render_audio.py`), each sweep aligned and scaled to its
 * own neutral cycle. The drawing is compared after band-limiting it the way
 * the render is (128 points, harmonics below 64), so a sharp edge is not
 * counted against it. The error is RMS relative to the frame.
 */
type Entry = {
	shape: string;
	mode: string;
	kind: string;
	modeIndex: number;
	values: { e1: number; e2: number }[];
	frames: number[][];
};
const entries = (calibration as { entries: Entry[] }).entries;

function bandLimit(x: ArrayLike<number>, n: number): number[] {
	const L = x.length;
	const out = new Array<number>(n).fill(0);
	for (let k = 0; k < n / 2; k++) {
		let re = 0;
		let im = 0;
		for (let i = 0; i < L; i++) {
			const a = (2 * Math.PI * k * i) / L;
			re += x[i] * Math.cos(a);
			im -= x[i] * Math.sin(a);
		}
		const w = (k === 0 ? 1 : 2) / L;
		for (let i = 0; i < n; i++) {
			const a = (2 * Math.PI * k * i) / n;
			out[i] += w * (re * Math.cos(a) - im * Math.sin(a));
		}
	}
	return out;
}

function errorsAgainstLive(e: Entry): number[] {
	const ref = e.kind === 'effect1' ? e.values.findIndex((v) => v.e1 === 0.5) : 0;
	const mode = effectModeFromLive(e.modeIndex) as WavetableEffectMode;
	return e.values.map((v, j) => {
		const drawn = bandLimit(applyOscEffect(e.frames[ref], mode, v.e1, v.e2, 1024), e.frames[j].length);
		const live = e.frames[j];
		let s = 0;
		let r = 0;
		for (let i = 0; i < live.length; i++) {
			s += (live[i] - drawn[i]) ** 2;
			r += live[i] ** 2;
		}
		return Math.sqrt(s / r);
	});
}

/**
 * The worst error each sweep may reach. Measured 2026-10-22; looser where a
 * known miss sits:
 * - the square's PW hold (Live holds 0.42, the first sample of its own
 *   table; the rendered cycle starts on the jump);
 * - Fold's first step (12 %), where Live folds a little earlier than 1 + 7·A;
 * - Classic at PW ±100 % with Sync up, a window 3 % of the cycle wide.
 * The joint FM sweep is left out: moving Tune through inharmonic ratios
 * while recording drifts the modulator's phase, so its frames are not the
 * phase a fresh note starts with.
 */
function limitFor(e: Entry): number | null {
	if (e.kind === 'joint' && e.mode === 'frequency_modulation') return null;
	if (e.shape === 'square' && e.mode === 'sync_and_pulse_width' && e.kind === 'effect1') return 0.75;
	if (e.kind === 'joint' && e.mode === 'sync_and_pulse_width') return 0.95;
	if (e.mode === 'warp_and_fold') return 0.65;
	return 0.35;
}

describe('applyOscEffect against Live’s renders', () => {
	for (const e of entries) {
		if (e.mode === 'none') continue;
		const limit = limitFor(e);
		if (limit === null) continue;
		it(`${e.shape}, ${e.mode}, ${e.kind}: every step within ${limit}`, () => {
			const errs = errorsAgainstLive(e);
			expect(Math.max(...errs)).toBeLessThanOrEqual(limit);
			// And typically well inside it.
			const sorted = [...errs].sort((a, b) => a - b);
			expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThanOrEqual(0.31);
		});
	}
});
