/**
 * Auto Pan Legacy's parameter map. The readout strings below were sampled
 * from the running device with `str_for_value` (an Auto Pan Legacy on
 * Memphis Studio, Live 12 Beta, 2026-10-01) — they are Live's.
 */
import { describe, it, expect } from 'vitest';
import {
	AUTO_PAN,
	syncRateLabel,
	frequencyLabel,
	tileSyncStep,
	tileXForSyncRate,
	tileFrequency,
	TILE_FREQ_MAX,
	tileAmount,
	tileYFor,
	shapeWrites,
	shapeIndex
} from '$lib/components/v6/device-panel/autoPanParams';

describe('autoPanParams', () => {
	it('labels sync rates as Live does', () => {
		expect([0, 4, 6, 8, 9, 13, 15, 21].map(syncRateLabel)).toEqual(['1/64', '1/16', '1/8', '3/16', '1/4', '1/2', '1', '8']);
	});

	it('labels the free rate as Live does', () => {
		const cases: [number, string][] = [
			[0, '0.05 Hz'],
			[0.3, '0.47 Hz'],
			[0.4, '1.00 Hz'],
			[0.5, '2.12 Hz'],
			[0.7, '9.50 Hz'],
			[0.75, '13.8 Hz'],
			[1, '90.0 Hz']
		];
		for (const [v, label] of cases) expect(frequencyLabel(v)).toBe(label);
	});

	it('tile X: four synced steps, free up to 10 Hz', () => {
		expect([0, 0.3, 0.6, 0.99].map(tileSyncStep)).toEqual([4, 6, 8, 9]);
		expect(tileXForSyncRate(8)).toBeCloseTo(0.625);
		expect(tileFrequency(0)).toBe(0);
		expect(frequencyLabel(tileFrequency(1))).toBe('10.0 Hz');
		expect(TILE_FREQ_MAX).toBeCloseTo(0.707, 3); // Live: 0.7063 reads 9.96 Hz, 0.7 reads 9.50
	});

	it('tile Y: amount folds about the middle, the lower half inverted', () => {
		expect(tileAmount(0)).toEqual({ amount: 1, invert: 1 });
		expect(tileAmount(0.5)).toEqual({ amount: 0, invert: 0 });
		expect(tileAmount(1)).toEqual({ amount: 1, invert: 0 });
		expect(tileAmount(0.25).amount).toBeCloseTo(0.5);
		expect(tileYFor(0.5, true)).toBeCloseTo(0.25);
		expect(tileYFor(0.5, false)).toBeCloseTo(0.75);
	});

	it('shapes write waveform, shape and phase, and read back', () => {
		expect(shapeWrites('square')).toEqual([
			[AUTO_PAN.waveform, 2],
			[AUTO_PAN.shape, 1],
			[AUTO_PAN.phase, 0]
		]);
		expect(shapeIndex(2, 0)).toBe(0);
		expect(shapeIndex(2, 1)).toBe(1);
		expect(shapeIndex(0, 0)).toBe(2);
		expect(shapeIndex(1, 0)).toBe(3);
		expect(shapeIndex(3, 0)).toBeNull();
	});
});
