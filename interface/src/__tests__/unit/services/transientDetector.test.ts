import { describe, it, expect } from 'vitest';
import { findFirstTransient } from '../../../routes/api/sample-peaks/transientDetector.js';

const SR = 44100;

function silence(seconds: number): Float32Array {
	return new Float32Array(Math.round(SR * seconds));
}

/**
 * Append `tail` immediately after `lead` and return one Float32Array.
 */
function concat(...parts: Float32Array[]): Float32Array {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Float32Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/**
 * Synthetic kick: decaying 80Hz sine over `seconds`, starting at peak
 * `amp` and exponentially decaying so the tail isn't louder than the
 * onset.
 */
function syntheticKick(seconds: number, amp = 0.7): Float32Array {
	const n = Math.round(SR * seconds);
	const out = new Float32Array(n);
	const tau = seconds * 0.4;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const env = Math.exp(-t / tau);
		out[i] = amp * env * Math.sin(2 * Math.PI * 80 * t);
	}
	return out;
}

/**
 * Linear amplitude ramp from 0 to `peak` over `seconds` (sustained-note
 * onset). Frequency 220 Hz so a few cycles fit in the ramp window.
 */
function linearRamp(seconds: number, peak = 0.6): Float32Array {
	const n = Math.round(SR * seconds);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const env = (i / n) * peak;
		out[i] = env * Math.sin(2 * Math.PI * 220 * t);
	}
	return out;
}

/**
 * Pseudo-random noise at fixed amplitude. Deterministic — uses a
 * linear-congruential generator seeded by `seed` so test outputs
 * don't drift across runs.
 */
function noise(seconds: number, amp = 0.05, seed = 1): Float32Array {
	const n = Math.round(SR * seconds);
	const out = new Float32Array(n);
	let s = seed >>> 0;
	for (let i = 0; i < n; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		const u = (s / 0x100000000) * 2 - 1;
		out[i] = u * amp;
	}
	return out;
}

describe('findFirstTransient', () => {
	it('returns 0 for a silent buffer', () => {
		const buf = silence(1);
		expect(findFirstTransient([buf], SR)).toBe(0);
	});

	it('returns 0 for an empty buffer', () => {
		expect(findFirstTransient([new Float32Array(0)], SR)).toBe(0);
	});

	it('returns 0 for a sample shorter than 4 windows (~32ms)', () => {
		// 10ms is well below the 32ms minimum.
		const buf = new Float32Array(Math.round(SR * 0.01));
		buf.fill(0.5);
		expect(findFirstTransient([buf], SR)).toBe(0);
	});

	it('returns 0 for sample rate of 0', () => {
		const buf = silence(1);
		expect(findFirstTransient([buf], 0)).toBe(0);
	});

	it('returns 0 for low-amplitude noise (no clear transient)', () => {
		// Noise σ ≈ 0.05 — comfortably above the absolute 0.003 floor,
		// but the noise floor itself is high enough that the *first*
		// frame the smoothed envelope crosses will be at the very start
		// of the buffer. We expect a frame near 0 or 0 outright.
		const buf = noise(1, 0.05);
		const frame = findFirstTransient([buf], SR);
		// Either we land at 0 outright, or within the first ~window
		// (~352 samples @ 8ms) — both indicate the detector didn't
		// pick out a meaningful onset, which is the right answer for
		// pure noise.
		expect(frame).toBeLessThan(SR * 0.05);
	});

	it('detects the onset of a synthetic kick after silence', () => {
		const lead = silence(0.25); // 250ms quiet pre-roll
		const kick = syntheticKick(0.05); // 50ms kick
		const buf = concat(lead, kick);
		const frame = findFirstTransient([buf], SR);
		const onsetFrame = lead.length;
		// Marker should land before the onset (lookback applied) but
		// within ~10ms of it.
		expect(frame).toBeGreaterThan(onsetFrame - SR * 0.015);
		expect(frame).toBeLessThanOrEqual(onsetFrame);
	});

	it('detects the onset of a sustained-note ramp', () => {
		const lead = silence(0.5);
		const tone = linearRamp(1.0, 0.6);
		const buf = concat(lead, tone);
		const frame = findFirstTransient([buf], SR);
		const onsetFrame = lead.length;
		// Ramps cross threshold somewhere into the ramp; allow a wider
		// window since the attack is gradual.
		expect(frame).toBeGreaterThan(onsetFrame - SR * 0.01);
		expect(frame).toBeLessThan(onsetFrame + SR * 0.5);
	});

	it('handles stereo by averaging channels', () => {
		const lead = silence(0.25);
		const kick = syntheticKick(0.05);
		const buf = concat(lead, kick);
		// Same data in both channels — should detect identically to mono.
		const monoFrame = findFirstTransient([buf], SR);
		const stereoFrame = findFirstTransient([buf, buf], SR);
		expect(stereoFrame).toBe(monoFrame);
	});

	it('returns 0 for noise-dominated samples (all-noise floor)', () => {
		// High-amplitude noise: floor estimate exceeds the 0.3 sentinel,
		// so the detector bails rather than picking a meaningless first
		// crossing.
		const buf = noise(1, 0.5);
		expect(findFirstTransient([buf], SR)).toBe(0);
	});

	it('lookback never lands the marker on a negative frame', () => {
		// Onset right at frame 0 — lookback would push to -220, must
		// clamp to 0.
		const kick = syntheticKick(1.0);
		const frame = findFirstTransient([kick], SR);
		expect(frame).toBeGreaterThanOrEqual(0);
	});

	it('detects a quiet capture below the old absolute floor', () => {
		// Peak ≈ 0.002 — under the retired 0.003 absolute threshold that
		// would have missed the onset entirely on a quiet recording.
		// The peak-relative floor (2% of peak) trips on the attack regardless.
		const lead = silence(0.25);
		const kick = syntheticKick(0.05, 0.002);
		const buf = concat(lead, kick);
		const frame = findFirstTransient([buf], SR);
		const onsetFrame = lead.length;
		expect(frame).toBeGreaterThan(onsetFrame - SR * 0.015);
		expect(frame).toBeLessThanOrEqual(onsetFrame);
	});

	it('skips a soft sound ahead of the first hit', () => {
		// The 2026-09-27 capture's shape: a bump ~22 dB under the take at
		// the top (room noise, handling), then the playing. The marker
		// belongs on the playing.
		const bump = syntheticKick(0.05, 0.7 * 0.08);
		const gap = silence(0.5);
		const buf = concat(silence(0.02), bump, gap, syntheticKick(0.05, 0.7));
		const onsetFrame = buf.length - Math.round(SR * 0.05);
		const frame = findFirstTransient([buf], SR);
		expect(frame).toBeGreaterThan(onsetFrame - SR * 0.015);
		expect(frame).toBeLessThanOrEqual(onsetFrame);
	});

	it('keeps the front of a hit that swells in', () => {
		// A 60 ms rise: the 12 dB mark is reached well into it, but the
		// marker goes back to where the rise began.
		const lead = silence(0.5);
		const buf = concat(lead, linearRamp(0.06, 0.6), syntheticKick(0.3, 0.6));
		const frame = findFirstTransient([buf], SR);
		expect(frame).toBeLessThan(lead.length + SR * 0.01);
		expect(frame).toBeGreaterThan(lead.length - SR * 0.015);
	});

	it('detects the same onset frame regardless of gain (scale-invariant)', () => {
		// A loud and a quiet copy of the same sample must trip at the same
		// point in the attack — the detector should be blind to absolute
		// level, since peak normalization is applied separately on gain.
		const lead = silence(0.25);
		const loud = concat(lead, syntheticKick(0.05, 0.7));
		const quiet = concat(lead, syntheticKick(0.05, 0.01));
		const loudFrame = findFirstTransient([loud], SR);
		const quietFrame = findFirstTransient([quiet], SR);
		// Within a couple ms of each other (smoothing-window jitter).
		expect(Math.abs(loudFrame - quietFrame)).toBeLessThan(SR * 0.003);
	});
});
