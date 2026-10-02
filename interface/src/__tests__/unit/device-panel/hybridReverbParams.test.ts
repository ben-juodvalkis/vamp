import { describe, it, expect } from 'vitest';
import {
	ALGORITHMS,
	HYBRID,
	algoDelaySeconds,
	algorithmFor,
	bassMult,
	bassXHz,
	controlPosition,
	controlRaw,
	decaySeconds,
	decayValue,
	degreeLabel,
	feedbackGain,
	hzLabel,
	multLabel,
	percentLabel,
	pitchLabel,
	predelaySeconds,
	prismMult,
	prismXOverHz,
	shapeLabel,
	shimmerSemitones,
	sixteenthsLabel,
	tidesRateBeats,
	tidesRateLabel,
	timeLabel,
	vintageLabel
} from '$lib/components/v6/device-panel/hybridReverbParams';

// Every expected string below is Live's own, from `str_for_value` on the
// rig (2026-10-02), whitespace collapsed ("2  / 16" → "2 / 16").

describe('Hybrid Reverb curves reproduce Live’s labels', () => {
	it('Decay: two power curves meeting, flat, at 3.5 s', () => {
		const live: [number, string][] = [
			[0, '100 ms'], [0.05, '141 ms'], [0.1, '255 ms'], [0.15, '438 ms'], [0.2, '687 ms'],
			[0.25, '1.00 s'], [0.3, '1.38 s'], [0.35, '1.82 s'], [0.4, '2.32 s'], [0.45, '2.88 s'],
			[0.5, '3.50 s'], [0.5125, '3.51 s'], [0.525, '3.56 s'], [0.5375, '3.65 s'], [0.55, '3.79 s'],
			[0.6, '4.90 s'], [0.65, '7.06 s'], [0.7, '10.4 s'], [0.75, '15.0 s'], [0.8, '21.0 s'],
			[0.85, '28.4 s'], [0.9, '37.3 s'], [0.95, '47.9 s'], [1, '60.0 s']
		];
		for (const [v, label] of live) expect(timeLabel(decaySeconds(v)), `Decay ${v}`).toBe(label);
	});

	it('Decay inverts', () => {
		for (const s of [0.1, 0.5, 1, 3.5, 7, 15, 60]) expect(decaySeconds(decayValue(s))).toBeCloseTo(s, 6);
		expect(decayValue(0.01)).toBe(0);
		expect(decayValue(600)).toBe(1);
	});

	it('Predelay, 0..4 s', () => {
		const live: [number, string][] = [
			[0, '0.00 ms'], [0.1, '1.87 ms'], [0.2, '18.8 ms'], [0.3, '72.6 ms'], [0.4, '189 ms'],
			[0.5, '398 ms'], [0.525, '468 ms'], [0.6, '730 ms'], [0.7, '1.22 s'], [0.8, '1.90 s'],
			[0.9, '2.82 s'], [1, '4.00 s']
		];
		for (const [v, label] of live) expect(timeLabel(predelaySeconds(v)), `Predelay ${v}`).toBe(label);
		expect(timeLabel(predelaySeconds(0.165425))).toBe('10.0 ms');
	});

	it('Delay (the algorithm’s own predelay), 0..1 s', () => {
		const live: [number, string][] = [
			[0, '0.00 ms'], [0.1, '0.47 ms'], [0.2, '4.70 ms'], [0.3, '18.1 ms'], [0.4, '47.3 ms'],
			[0.5, '99.4 ms'], [0.525, '117 ms'], [0.6, '182 ms'], [0.7, '305 ms'], [0.8, '476 ms'],
			[0.9, '704 ms'], [1, '1.00 s']
		];
		for (const [v, label] of live) expect(timeLabel(algoDelaySeconds(v)), `Delay ${v}`).toBe(label);
	});

	it('Dark Hall Bass Mult and Bass X', () => {
		const mult: [number, string][] = [
			[0, '25 %'], [0.125, '35 %'], [0.25, '50 %'], [0.375, '71 %'], [0.5, '100 %'],
			[0.625, '141 %'], [0.75, '200 %'], [0.875, '283 %'], [1, '400 %']
		];
		for (const [v, label] of mult) expect(multLabel(bassMult(v)), `Bass Mult ${v}`).toBe(label);
		const x: [number, string][] = [
			[0, '80.0 Hz'], [0.125, '110 Hz'], [0.25, '150 Hz'], [0.375, '206 Hz'], [0.5, '283 Hz'],
			[0.625, '388 Hz'], [0.75, '532 Hz'], [0.875, '729 Hz'], [1, '1.00 kHz'], [0.674953, '440 Hz']
		];
		for (const [v, label] of x) expect(hzLabel(bassXHz(v)), `Bass X ${v}`).toBe(label);
	});

	it('Prism mults and X-Over', () => {
		const mult: [number, string][] = [
			[0, '10 %'], [0.1, '15 %'], [0.2, '22 %'], [0.3, '32 %'], [0.4, '48 %'], [0.5, '71 %'],
			[0.6, '105 %'], [0.7, '155 %'], [0.8, '229 %'], [0.9, '338 %'], [1, '500 %'], [0.588592, '100 %']
		];
		for (const [v, label] of mult) expect(multLabel(prismMult(v)), `Mult ${v}`).toBe(label);
		const x: [number, string][] = [
			[0, '400 Hz'], [0.125, '555 Hz'], [0.25, '770 Hz'], [0.375, '1.07 kHz'], [0.5, '1.48 kHz'],
			[0.625, '2.06 kHz'], [0.75, '2.86 kHz'], [0.875, '3.96 kHz'], [1, '5.50 kHz'], [0.264455, '800 Hz']
		];
		for (const [v, label] of x) expect(hzLabel(prismXOverHz(v)), `X-Over ${v}`).toBe(label);
	});

	it('the linear rails', () => {
		const pct: [number, string][] = [[0, '0.0 %'], [0.25, '25 %'], [0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [0.31082, '31 %']];
		for (const [v, label] of pct) expect(percentLabel(v * 100), `Dry/Wet ${v}`).toBe(label);
		const width: [number, string][] = [[0, '0.0 %'], [0.25, '50 %'], [0.5, '100 %'], [0.75, '150 %'], [1, '200 %']];
		for (const [v, label] of width) expect(percentLabel(v * 200), `Width ${v}`).toBe(label);
		const fb: [number, string][] = [[0, '0.0 %'], [0.25, '24 %'], [0.5, '48 %'], [0.75, '71 %'], [1, '95 %']];
		for (const [v, label] of fb) expect(percentLabel(feedbackGain(v) * 100), `Feedback ${v}`).toBe(label);
		const shape: [number, string][] = [[0, '0.00'], [0.25, '25.0'], [0.5, '50.0'], [0.75, '75.0'], [1, '100']];
		for (const [v, label] of shape) expect(shapeLabel(v), `Shape ${v}`).toBe(label);
		const pitch: [number, string][] = [[0, '-12.00 st'], [0.25, '-6.00 st'], [0.5, '0.00 st'], [0.75, '6.00 st'], [1, '12.00 st']];
		for (const [v, label] of pitch) expect(pitchLabel(shimmerSemitones(v)), `Pitch ${v}`).toBe(label);
		const phase: [number, string][] = [[0, '0.0°'], [0.25, '45°'], [0.5, '90°'], [0.75, '135°'], [1, '180°']];
		for (const [v, label] of phase) expect(degreeLabel(v * 180), `Phase ${v}`).toBe(label);
	});

	it('the stepped rails', () => {
		expect(sixteenthsLabel(2)).toBe('2 / 16');
		expect(sixteenthsLabel(16)).toBe('16 / 16');
		expect([0, 1, 2, 3, 4].map(vintageLabel)).toEqual(['Off', 'Subtle', 'Old', 'Older', 'Extreme']);
		expect(tidesRateLabel(0)).toBe('1/128 T');
		expect(tidesRateLabel(3)).toBe('1/128 D');
		expect(tidesRateLabel(16)).toBe('1/4');
		expect(tidesRateLabel(22)).toBe('1');
		expect(tidesRateLabel(29)).toBe('4 D');
	});
});

describe('Ti Rate', () => {
	it('a cycle in beats', () => {
		expect(tidesRateBeats(16)).toBe(1); // 1/4
		expect(tidesRateBeats(22)).toBe(4); // 1 bar
		expect(tidesRateBeats(14)).toBeCloseTo(2 / 3); // 1/4 T
		expect(tidesRateBeats(18)).toBe(1.5); // 1/4 D
		expect(tidesRateBeats(29)).toBe(24); // 4 D
	});

	it('spans its 30 steps from a 0..1 slider', () => {
		const rate = ALGORITHMS.find((a) => a.key === 'tides')!.controls.find((c) => c.index === HYBRID.tidesRate)!;
		expect(controlRaw(rate, 0)).toBe(0);
		expect(controlRaw(rate, 1)).toBe(29);
		expect(controlRaw(rate, controlPosition(rate, 22))).toBe(22);
	});

	it('passes a 0..1 control through', () => {
		expect(controlRaw({}, 0.3)).toBe(0.3);
		expect(controlRaw({}, 1.4)).toBe(1);
		expect(controlPosition({}, 0.3)).toBe(0.3);
	});
});

describe('the algorithms', () => {
	it('carry the controls Ableton documents for each', () => {
		const names = Object.fromEntries(ALGORITHMS.map((a) => [a.key, a.controls.map((c) => c.name)]));
		expect(names).toEqual({
			darkHall: ['Shape', 'Bass Mult', 'Bass X', 'Damping', 'Mod'],
			quartz: ['Distance', 'Diffusion', 'Lo Damp', 'Damping', 'Mod'],
			shimmer: ['Shimmer', 'Pitch', 'Diffusion', 'Damping', 'Mod'],
			tides: ['Tide', 'Rate', 'Wave', 'Phase', 'Damping'],
			prism: ['Low Mult', 'High Mult', 'X-Over']
		});
	});

	it('resolve from Algo Type, clamped', () => {
		expect(algorithmFor(0).name).toBe('Dark Hall');
		expect(algorithmFor(4).name).toBe('Prism');
		expect(algorithmFor(9).name).toBe('Prism');
		expect(HYBRID.algoType).toBe(6);
	});
});
