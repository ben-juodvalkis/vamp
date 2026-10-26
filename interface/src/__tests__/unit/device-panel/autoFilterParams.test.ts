import { describe, expect, it } from 'vitest';
import {
	AUTO_FILTER_TYPE_LABELS,
	autoFilterCurve,
	autoFilterFromPreset,
	frequencyToValue,
	valueToFrequency
} from '$lib/components/v6/device-panel/autoFilterParams';

// Live's own words, from `device_dump.js` on the rig's Auto Filter (2026-10-25).
describe('Auto Filter, as Live reports it', () => {
	it('names the filter types as Live does', () => {
		expect(AUTO_FILTER_TYPE_LABELS).toEqual([
			'Low-pass', 'High-pass', 'Band-pass', 'Notch', 'Morph', 'DJ', 'Comb', 'Resampling', 'Notch+LP', 'Vowel'
		]);
	});

	it('maps Hz to the LOM value through Live labels (0 → 20 Hz, 0.5 → 632 Hz, 1 → 20 kHz)', () => {
		expect(valueToFrequency(0)).toBeCloseTo(20, 6);
		expect(valueToFrequency(0.25)).toBeCloseTo(112, 0);
		expect(valueToFrequency(0.5)).toBeCloseTo(632, 0);
		expect(valueToFrequency(0.75)).toBeCloseTo(3557, 0);
		expect(valueToFrequency(1)).toBeCloseTo(20000, 3);
	});

	it("reads Disco Filter's saved values as the LOM reads them once it is loaded", () => {
		// The .adv: Filter_Frequency 169.668594, Filter_Resonance 0.4453125, Filter_Type 2.
		// Loaded, Live reported Frequency 0.3095238208770752 ("170 Hz"), Resonance 0.4453125, Type 2.
		const v = autoFilterFromPreset({ Filter_Frequency: 169.668594, Filter_Resonance: 0.4453125, Filter_Type: 2 });
		expect(v?.frequency).toBeCloseTo(0.3095238208770752, 6);
		expect(v?.resonance).toBe(0.4453125);
		expect(v?.type).toBe(2);
	});

	it('clamps and refuses what is not a frequency', () => {
		expect(frequencyToValue(5)).toBe(0);
		expect(frequencyToValue(40000)).toBe(1);
		expect(autoFilterFromPreset({ Filter_Resonance: 0.5 })).toBeNull();
	});

	it('draws Comb as a comb and Vowel as a band', () => {
		expect(autoFilterCurve(6)).toBe('peak');
		expect(autoFilterCurve(9)).toBe('bandpass');
		expect(autoFilterCurve(8)).toBe('notch');
	});
});
