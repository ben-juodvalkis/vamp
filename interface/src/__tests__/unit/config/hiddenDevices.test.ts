/**
 * The devices Vamp keeps out of every chain it draws come from one list,
 * `constants.devices.hiddenFromChain`, matched by Live's class and name.
 */
import { describe, it, expect } from 'vitest';
import constants from '$config/constants.json';
import { isHiddenFromChain, visibleDevices } from '$lib/config/hiddenDevices';

describe('hiddenDevices', () => {
	it('hides every device the list names, by class and name together', () => {
		for (const r of constants.devices.hiddenFromChain) {
			const name = r.deviceName ?? 'Anything';
			expect(isHiddenFromChain({ className: r.className, name })).toBe(true);
			expect(isHiddenFromChain({ className: 'Saturator', name })).toBe(false);
		}
		expect(isHiddenFromChain({ className: 'MxDeviceAudioEffect', name: 'Vamp-Capture' })).toBe(true);
		expect(isHiddenFromChain({ className: 'MxDeviceAudioEffect', name: 'Permute' })).toBe(false);
	});

	it('hides every Tuner, renamed or not (the user, 2026-11-13)', () => {
		expect(isHiddenFromChain({ className: 'Tuner', name: 'Tuner' })).toBe(true);
		expect(isHiddenFromChain({ className: 'Tuner', name: 'Gtr Tuner' })).toBe(true);
		expect(isHiddenFromChain({ className: 'MxDeviceAudioEffect', name: 'Tuner' })).toBe(false);
	});

	it('keeps the rest in order', () => {
		const chain = [
			{ className: 'Saturator', name: 'Saturator' },
			{ className: 'MxDeviceAudioEffect', name: 'Vamp-Capture' },
			{ className: 'Delay', name: 'Delay' }
		];
		expect(visibleDevices(chain).map((d) => d.name)).toEqual(['Saturator', 'Delay']);
	});
});
