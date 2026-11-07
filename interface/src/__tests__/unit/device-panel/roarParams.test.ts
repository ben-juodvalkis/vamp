import { describe, expect, it } from 'vitest';
import {
	ROAR,
	ROAR_ROUTINGS,
	ROAR_SHAPERS,
	ROAR_FILTERS,
	roarDriveFromGain,
	roarFeedbackTimeParam,
	roarFilterExtra,
	roarFilterHasRes,
	roarHasBlend,
	roarRateParam,
	roarStageNames,
	roarStagesFor
} from '$lib/components/v6/device-panel/roarParams';
import { presetControl } from '$lib/components/v6/device-panel/deviceControls';

/** Roar as device_dump read it off the running Live (2026-11-07). */
describe('Roar, as Live reports it', () => {
	it("names the routing modes in Live's routing_mode_list order", () => {
		expect(ROAR_ROUTINGS).toEqual(['Single', 'Serial', 'Parallel', 'Multi Band', 'Mid Side', 'Feedback', 'Delay']);
	});

	it("lists the shapers and filters as Live's step labels do", () => {
		expect(ROAR_SHAPERS).toHaveLength(12);
		expect(ROAR_SHAPERS[4]).toBe('Tube Preamp');
		expect(ROAR_SHAPERS[11]).toBe('Shards');
		expect(ROAR_FILTERS).toEqual(['LP', 'BP', 'HP', 'Notch', 'Peak', 'Morph', 'Comb', 'Resampling', 'Dispersion']);
	});

	it('Drive reads a preset\'s gain factor onto the rail Live labels -24, -12, 0, 12, 24 dB at each quarter', () => {
		expect(roarDriveFromGain(1)).toBeCloseTo(0.5, 6); // 0.0 dB
		expect(roarDriveFromGain(10 ** (-12 / 20))).toBeCloseTo(0.25, 6); // -12 dB
		expect(roarDriveFromGain(10 ** (12 / 20))).toBeCloseTo(0.75, 6); // 12 dB
		expect(roarDriveFromGain(1.41253757)).toBeCloseTo(0.5625, 4); // Basic Mid Side: +3 dB
		expect(roarDriveFromGain(1000)).toBe(1);
		expect(roarDriveFromGain(0)).toBe(0);
	});

	it("a Roar preset's tile starts at its Drive and Dry/Wet", () => {
		// Bass Smasher's saved values (Core Library, 2026-11-07).
		const got = presetControl({ className: 'Roar', params: { Input_InputGain: 3.26802778, Output_DryWet: 0.8828125 } }, 'Bass Smasher');
		expect(got?.control.kind).toBe('xy');
		expect(got!.values[ROAR.drive]).toBeCloseTo((20 * Math.log10(3.26802778) + 24) / 48, 6);
		expect(got!.values[ROAR.dryWet]).toBe(0.8828125);
		expect(presetControl({ className: 'Roar', params: { Output_DryWet: 1 } }, 'Roar')).toBeNull();
	});
});

describe("Roar's routing (Live 12 manual, 29.33.1)", () => {
	it('runs one stage on Single, three on Multi Band, two on every other mode', () => {
		expect(roarStagesFor(0)).toBe(1);
		expect(roarStagesFor(3)).toBe(3);
		for (const mode of [1, 2, 4, 5, 6]) expect(roarStagesFor(mode)).toBe(2);
	});

	it('blends on every mode but Single and Multi Band', () => {
		expect(ROAR_ROUTINGS.map((_, i) => roarHasBlend(i))).toEqual([false, true, true, false, true, true, true]);
	});

	it("names Multi Band's stages as bands and Mid Side's as the mid and the side", () => {
		expect(roarStageNames(3)).toEqual(['Low', 'Mid', 'High']);
		expect(roarStageNames(4).slice(0, 2)).toEqual(['Mid', 'Side']);
		expect(roarStageNames(1)).toEqual(['Stage 1', 'Stage 2', 'Stage 3']);
	});

	it('a filter shows Peak gain or Morph shape for its type, and Resampling no resonance', () => {
		expect(roarFilterExtra(4)).toBe('Peak');
		expect(roarFilterExtra(5)).toBe('Morph');
		expect(roarFilterExtra(0)).toBeUndefined();
		expect(roarFilterHasRes(7)).toBe(false);
		expect(roarFilterHasRes(0)).toBe(true);
	});

	it('a rate mode moves its own parameter', () => {
		expect(roarRateParam('LFO 1', 0)).toBe('LFO 1 Freq');
		expect(roarRateParam('LFO 2', 2)).toBe('LFO 2 Synced');
		expect(roarRateParam('Noise', 4)).toBe('Noise 16th');
		expect(roarFeedbackTimeParam(0)).toBe('FB Time');
		expect(roarFeedbackTimeParam(1)).toBe('FB Synced');
		expect(roarFeedbackTimeParam(4)).toBe('FB Note');
	});
});
