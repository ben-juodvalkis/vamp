import { describe, expect, it } from 'vitest';
import { controlFor } from '$lib/components/v6/device-panel/deviceControls';

describe("the Pedal's chain cell", () => {
	it('moves Drive (2) and Dry/Wet (9) together on one slider', () => {
		const control = controlFor('pedal');
		expect(control?.kind).toBe('slider');
		if (control?.kind !== 'slider') return;
		expect(control.write(0.4, () => undefined)).toEqual([
			[2, 0.4],
			[9, 0.4]
		]);
		expect(control.read((i) => (i === 2 ? 0.7 : 0.1))).toBe(0.7);
	});
});
