/**
 * The Reverb view's EQ tab: the reverb's own four bands, their curves, and
 * what a drag on the pad writes.
 */
import { describe, it, expect } from 'vitest';
import {
	DB_CEIL,
	DB_FLOOR,
	EQ_X0,
	EQ_X1,
	EQ_Y0,
	EQ_Y1,
	bandCurveDb,
	bandReadout,
	dbY,
	dragWrites,
	eqBands,
	eqCurveDb,
	handleAt,
	hzX,
	nearestBand,
	wetLevelDb
} from '$lib/components/v6/central/views/reverb/reverbEq';
import { HYBRID, LIVE_DEFAULTS } from '$lib/components/v6/device-panel/hybridReverbParams';

const rawWith = (values: Record<number, number>) => (i: number) => values[i] ?? LIVE_DEFAULTS[i] ?? 0;
/** The raw value Live's EQ frequency rail (20·1000^v) gives a frequency. */
const v = (hz: number) => Math.log10(hz / 20) / 3;
const at = (hz: number, fn: (hzs: number[]) => number[]) => fn([hz])[0];

describe('the four bands', () => {
	it('read Cut or Shelf from each end’s type, and the peaks between', () => {
		const bands = eqBands(rawWith({ [HYBRID.eqLoType]: 0, [HYBRID.eqHiType]: 1 }));
		expect(bands.map((b) => [b.key, b.kind])).toEqual([
			['lo', 'cut'], ['peak1', 'peak'], ['peak2', 'peak'], ['hi', 'shelf']
		]);
		expect(bands.map((b) => b.freqIndex)).toEqual([HYBRID.eqLoFreq, HYBRID.eqPeak1Freq, HYBRID.eqPeak2Freq, HYBRID.eqHiFreq]);
	});
});

describe('the curves', () => {
	it('a cut is -3 dB at its corner and falls at its slope', () => {
		const [lo] = eqBands(rawWith({ [HYBRID.eqLoType]: 0, [HYBRID.eqLoFreq]: v(200), [HYBRID.eqLoSlope]: 2 })); // 18 dB
		expect(at(200, (h) => bandCurveDb(lo, h))).toBeCloseTo(-3, 1);
		expect(at(100, (h) => bandCurveDb(lo, h))).toBeCloseTo(-18.1, 0);
		expect(Math.abs(at(5000, (h) => bandCurveDb(lo, h)))).toBeLessThan(0.01);
		const [, , , hi] = eqBands(rawWith({ [HYBRID.eqHiType]: 0, [HYBRID.eqHiFreq]: v(5000), [HYBRID.eqHiSlope]: 0 })); // 6 dB
		expect(at(10000, (h) => bandCurveDb(hi, h))).toBeCloseTo(-7, 0);
	});

	it('a shelf holds its gain past its corner, a peak at its centre', () => {
		const bands = eqBands(
			rawWith({
				[HYBRID.eqLoType]: 1, [HYBRID.eqLoFreq]: v(200), [HYBRID.eqLoGain]: 0.75, // +6 dB
				[HYBRID.eqPeak1Freq]: v(1000), [HYBRID.eqPeak1Gain]: 0, [HYBRID.eqPeak1Q]: 0.5 // -12 dB
			})
		);
		expect(at(30, (h) => bandCurveDb(bands[0], h))).toBeCloseTo(6, 0);
		expect(Math.abs(at(5000, (h) => bandCurveDb(bands[0], h)))).toBeLessThan(0.5);
		expect(at(1000, (h) => bandCurveDb(bands[1], h))).toBeCloseTo(-12, 1);
		expect(Math.abs(at(30, (h) => bandCurveDb(bands[1], h)))).toBeLessThan(0.5);
	});

	it('sum, unless the EQ is off; the tail reads the same sum plus Send', () => {
		const bands = eqBands(rawWith({ [HYBRID.eqPeak1Freq]: v(1000), [HYBRID.eqPeak1Gain]: 0.75 }));
		const on = at(1000, (h) => eqCurveDb(bands, true, h));
		expect(on).toBeGreaterThan(5);
		expect(at(1000, (h) => eqCurveDb(bands, false, h))).toBe(0);
		expect(wetLevelDb(bands, true, 1)(1000)).toBeCloseTo(on, 6);
		expect(wetLevelDb(bands, true, 0.5)(1000)).toBeCloseTo(on - 6.02, 1);
	});
});

describe('the pad', () => {
	it('puts a frequency where Live’s rail does, and the gains on one scale', () => {
		expect(hzX(20)).toBeCloseTo(EQ_X0, 9);
		expect(hzX(20000)).toBeCloseTo(EQ_X1, 9);
		expect(dbY(DB_FLOOR)).toBeCloseTo(EQ_Y0, 9);
		expect(dbY(DB_CEIL)).toBeCloseTo(EQ_Y1, 9);
		expect(dbY(-60)).toBe(EQ_Y0);
	});

	it('sits a cut’s handle on its -3 dB corner and a shelf’s on its gain', () => {
		const [lo, , , hi] = eqBands(rawWith({ [HYBRID.eqLoType]: 0, [HYBRID.eqHiType]: 1, [HYBRID.eqHiGain]: 1 }));
		expect(handleAt(lo).y).toBeCloseTo(dbY(-3), 9);
		expect(handleAt(hi).y).toBeCloseTo(dbY(12), 9);
	});

	it('a drag moves the frequency across and the gain up — but a cut only slides', () => {
		const [lo, peak] = eqBands(rawWith({ [HYBRID.eqLoType]: 0 }));
		const w = 400;
		const h = 300;
		const across = w * (EQ_X1 - EQ_X0) * 0.1;
		const up = (h * (EQ_Y1 - EQ_Y0) * 6) / (DB_CEIL - DB_FLOOR); // 6 dB
		const peakWrites = dragWrites(peak, { freq: 0.5, gain: 0.5 }, across, up, w, h);
		expect(peakWrites[0][0]).toBe(HYBRID.eqPeak1Freq);
		expect(peakWrites[0][1]).toBeCloseTo(0.6, 9);
		expect(peakWrites[1][0]).toBe(HYBRID.eqPeak1Gain);
		expect(peakWrites[1][1]).toBeCloseTo(0.75, 9);
		const cutWrites = dragWrites(lo, { freq: 0.2, gain: 0.5 }, across, up, w, h);
		expect(cutWrites).toEqual([[HYBRID.eqLoFreq, expect.closeTo(0.3, 9)]]);
		expect(dragWrites(peak, { freq: 0.95, gain: 0.9 }, w, h, w, h)).toEqual([
			[HYBRID.eqPeak1Freq, 1],
			[HYBRID.eqPeak1Gain, 1]
		]);
	});

	it('a press takes the nearest handle', () => {
		const bands = eqBands(rawWith({}));
		const p2 = handleAt(bands[2]);
		expect(nearestBand(bands, p2.x + 0.01, p2.y - 0.01, 400, 300).key).toBe('peak2');
	});
});

describe('the readout, in Live’s words', () => {
	it('names the band and what it holds', () => {
		// The rig's EQ (2026-10-02): Lo Cut 121 Hz 18 dB, Peak 1 700 Hz Q 0.71, Hi Shelf 5.00 kHz.
		const bands = eqBands(
			rawWith({
				[HYBRID.eqLoFreq]: 0.26008063554763794, [HYBRID.eqLoSlope]: 2,
				[HYBRID.eqHiFreq]: 0.7993133068084717, [HYBRID.eqHiType]: 1
			})
		);
		expect(bandReadout(bands[0])).toEqual({ name: 'Lo Cut', value: '121 Hz · 18 dB' });
		expect(bandReadout(bands[1])).toEqual({ name: 'Peak 1', value: '700 Hz · 0.0 dB · Q 0.71' });
		expect(bandReadout(bands[3])).toEqual({ name: 'Hi Shelf', value: '5.00 kHz · 0.0 dB' });
	});
});
