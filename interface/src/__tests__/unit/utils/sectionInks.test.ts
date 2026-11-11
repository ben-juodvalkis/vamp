import { describe, expect, it } from 'vitest';
import { sectionInks } from '$lib/components/v6/browser/utils/sectionInks';
import { DEVICE_FAMILY_INKS } from '$lib/config/devicePresets';

describe('sectionInks', () => {
	// The rig's effects Place, 2026-10-26.
	const inks = sectionInks(['Distortion', 'Dynamics', 'Glitch', 'Guitar', 'Midi Effect', 'Modulation', 'Time', 'Tone', 'Utility']);

	it("gives a folder the device family its name says", () => {
		expect(inks.get('distortion')).toBe(DEVICE_FAMILY_INKS.distortion.primary);
		expect(inks.get('dynamics')).toBe(DEVICE_FAMILY_INKS.dynamics.primary);
		expect(inks.get('midi effect')).toBe(DEVICE_FAMILY_INKS.pitchSeq.primary);
		expect(inks.get('modulation')).toBe(DEVICE_FAMILY_INKS.modulation.primary);
		expect(inks.get('time')).toBe(DEVICE_FAMILY_INKS.timeSpace.primary);
		expect(inks.get('tone')).toBe(DEVICE_FAMILY_INKS.filter.primary);
		expect(inks.get('utility')).toBe(DEVICE_FAMILY_INKS.utility.primary);
		expect(inks.get('glitch')).toBe(DEVICE_FAMILY_INKS.glitch.primary);
		expect(inks.get('guitar')).toBe(DEVICE_FAMILY_INKS.guitar.primary);
	});

	it('gives a folder whose name says none a family no other folder took', () => {
		const more = sectionInks(['Distortion', 'Strange']);
		expect(more.get('strange')).not.toBe(DEVICE_FAMILY_INKS.distortion.primary);
		expect(new Set(inks.values()).size).toBe(9);
	});
});
