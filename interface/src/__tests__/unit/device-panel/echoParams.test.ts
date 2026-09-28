/**
 * Echo's parameter map. The readout strings below were sampled from the
 * running device with `str_for_value` (an Echo on Shaker, Live 12.4.15b2,
 * 2026-09-14) — they are Live's, not a guess at Live's.
 */
import { describe, it, expect } from 'vitest';
import {
	ECHO,
	ECHO_LFO,
	lfoFreqLabel,
	lfoRateLabel,
	lfoRateT,
	lfoRateWrite
} from '$lib/components/v6/device-panel/echoParams';

describe('Echo LFO rate', () => {
	it("prints LFO Freq exactly as Live does", () => {
		const measured: [number, string][] = [
			[0, '0.01 Hz'],
			[0.2, '0.05 Hz'],
			[0.3, '0.12 Hz'],
			[0.4, '0.28 Hz'],
			[0.5, '0.63 Hz'],
			[0.6, '1.45 Hz'],
			[0.7, '3.32 Hz'],
			[0.8, '7.61 Hz'],
			[0.9, '17.5 Hz'],
			[1, '40.0 Hz']
		];
		for (const [v, s] of measured) expect(lfoFreqLabel(v)).toBe(s);
	});

	it('names the synced steps as Live does, slowest first', () => {
		expect(lfoRateLabel(true, undefined, 0)).toBe('8');
		expect(lfoRateLabel(true, undefined, 6)).toBe('1');
		expect(lfoRateLabel(true, undefined, 11)).toBe('5/16');
		expect(lfoRateLabel(true, undefined, 17)).toBe('1/16');
		expect(lfoRateLabel(true, undefined, 21)).toBe('1/64');
	});

	it('writes only the rate LFO Sync makes audible', () => {
		expect(lfoRateWrite(true, 1)).toEqual([ECHO_LFO.synced, 21]);
		expect(lfoRateWrite(true, 0.5)).toEqual([ECHO_LFO.synced, 11]);
		expect(lfoRateWrite(false, 0.5)).toEqual([ECHO_LFO.freq, 0.5]);
	});

	it('reads its position back from the same rate', () => {
		expect(lfoRateT(true, 0.9, 21)).toBe(1);
		expect(lfoRateT(false, 0.25, 21)).toBe(0.25);
	});
});

describe('Echo time', () => {
	it('writes both time controls: the tile 1..4 sixteenths, the view 1..16, free time 1 -> 0', () => {
		expect(ECHO.timeWrites(0)).toEqual([[ECHO.sixteenths, 1], [ECHO.time, 1]]);
		expect(ECHO.timeWrites(1)).toEqual([[ECHO.sixteenths, 4], [ECHO.time, 0]]);
		expect(ECHO.timeWrites(1, true)).toEqual([[ECHO.sixteenths, 16], [ECHO.time, 0]]);
	});

	it("the tile's Y moves feedback 0..1 and mix at half", () => {
		expect(ECHO.feedbackMixWrites(1)).toEqual([[ECHO.feedback, 1], [ECHO.mix, 0.5]]);
	});
});
