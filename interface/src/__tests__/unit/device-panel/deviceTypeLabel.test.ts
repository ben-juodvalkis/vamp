/**
 * The caption under a chain cell's name (2026-11-08): Live's word for the
 * device's class, only where the name does not already say it.
 */
import { describe, it, expect } from 'vitest';
import { deviceTypeLabel } from '$lib/components/v6/device-panel/chain/deviceTypeLabel';

describe('deviceTypeLabel', () => {
	it('names the class under a preset name', () => {
		expect(deviceTypeLabel('AutoFilter2', 'Wobble')).toBe('Auto Filter');
		expect(deviceTypeLabel('Hybrid', 'Dub Space')).toBe('Hybrid Reverb');
		expect(deviceTypeLabel('AudioEffectGroupDevice', 'Grit')).toBe('Audio Effect Rack');
		expect(deviceTypeLabel('DrumGroupDevice', '32 Pads')).toBe('Drum Rack');
		expect(deviceTypeLabel('AuPluginDevice', 'Supermassive')).toBe('Audio Unit');
	});

	it('draws nothing where the name is the class', () => {
		expect(deviceTypeLabel('AutoFilter2', 'Auto Filter')).toBeNull();
		expect(deviceTypeLabel('Echo', 'echo')).toBeNull();
		expect(deviceTypeLabel('InstrumentVector', 'Wavetable')).toBeNull();
		expect(deviceTypeLabel('DrumGroupDevice', 'Drum-Rack')).toBeNull();
	});

	it("draws nothing where the name carries the class's word, either way round", () => {
		expect(deviceTypeLabel('AutoPan', 'Auto Pan Legacy')).toBeNull();
		expect(deviceTypeLabel('Hybrid', 'Reverb')).toBeNull();
	});

	it('guesses nothing for an unknown class or an empty name', () => {
		expect(deviceTypeLabel('SomethingNew', 'Thing')).toBeNull();
		expect(deviceTypeLabel('Echo', '')).toBeNull();
	});
});
