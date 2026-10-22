import { describe, it, expect } from 'vitest';
import {
	analogFilterCurve,
	driftFilterCurve,
	FILTER_FREQ_RANGE,
	hzToCurveX,
	liveFilterCurve,
	meldFilterCurve
} from '$lib/utils/instrumentFilterCurves';

// Live's labels, read with str_for_value on 2026-10-22 (Live 12.4.15).
describe('instrumentFilterCurves', () => {
	it('puts the measured cutoff labels where the curve draws them', () => {
		const at = ([lo, hi]: readonly [number, number], t: number) => lo * Math.pow(hi / lo, t);
		// Wavetable 0.5 = "640 Hz", Operator 0.5 = "745 Hz", Drift 0.5 = "632 Hz".
		expect(at(FILTER_FREQ_RANGE.wavetable, 0.5)).toBeCloseTo(640, 0);
		expect(at(FILTER_FREQ_RANGE.operator, 0.5)).toBeCloseTo(745, -1);
		expect(at(FILTER_FREQ_RANGE.drift, 0.5)).toBeCloseTo(632, 0);
		expect(hzToCurveX(20)).toBe(0);
		expect(hzToCurveX(20000)).toBeCloseTo(1);
	});

	it('reads the shared Live filter: type, slope and Morph', () => {
		expect(liveFilterCurve(1, 1)).toEqual({ curveType: 'highpass', order: 2 });
		expect(liveFilterCurve(3, 0)).toEqual({ curveType: 'notch', order: 1 });
		// Morph 0.5 is Live's "0 hp/no" — pure high-pass; 1 wraps back to LP.
		expect(liveFilterCurve(4, 0, 0.5).curveType).toBe('highpass');
		expect(liveFilterCurve(4, 0, 1).curveType).toBe('lowpass');
	});

	it('reads Analog, Meld and Drift types', () => {
		expect(analogFilterCurve(1)).toEqual({ curveType: 'lowpass', order: 2 }); // Low-pass 24dB/oct
		expect(analogFilterCurve(6)).toEqual({ curveType: 'highpass', order: 1 }); // High-pass 12dB/oct
		expect(meldFilterCurve(1, 2 / 3)).toEqual({ curveType: 'highpass', order: 2 }); // SVF 24dB at H
		expect(meldFilterCurve(8).curveType).toBe('peak');
		expect(meldFilterCurve(10).curveType).toBe('none'); // Phaser: no filter shape to draw
		expect(driftFilterCurve(1).order).toBe(2);
	});
});
